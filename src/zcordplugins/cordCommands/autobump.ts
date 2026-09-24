/*
 * Autobump Disboard pour CordCommands (client Zcord).
 * Envoie /bump via POST /interactions, planning ~2h.
 */

import { DataStore } from "@api/index";
import { findByPropsLazy } from "@webpack";
import { ChannelStore, MessageStore, RestAPI } from "@webpack/common";

const AuthStore = findByPropsLazy("getToken", "getSessionId");

export const DISBOARD_BOT_ID = "302050872383242240";
const BUMP_KEY = "cordCommands_autobump";
const BUMP_COOLDOWN_MS = 2 * 60 * 60 * 1000;
const BUMP_JITTER_MS = 3 * 60 * 1000;
const RETRY_ON_ERROR_MS = 2 * 60 * 1000;
const RETRY_ON_PERMS_MS = 30 * 60 * 1000;
const DISBOARD_WAIT_MS = 20_000;

export interface BumpState {
    enabled: boolean;
    channels: string[];
    nextAt: Record<string, number>;
}

const jobs = new Map<string, ReturnType<typeof setTimeout>>();
let state: BumpState = { enabled: false, channels: [], nextAt: {} };

function nonce() {
    return String((BigInt(Date.now() - 1420070400000) << 22n));
}

function nextDelayAfterSuccess() {
    return BUMP_COOLDOWN_MS + Math.floor(Math.random() * BUMP_JITTER_MS);
}

export async function loadBumpState() {
    const raw = await DataStore.get<Partial<BumpState>>(BUMP_KEY);
    if (raw) {
        state = {
            enabled: !!raw.enabled,
            channels: Array.isArray(raw.channels) ? raw.channels.map(String) : [],
            nextAt: raw.nextAt && typeof raw.nextAt === "object" ? { ...raw.nextAt } : {},
        };
    }
}

async function saveBumpState() {
    await DataStore.set(BUMP_KEY, state);
}

export function getBumpState(): BumpState {
    return state;
}

function clearJob(channelId: string) {
    const t = jobs.get(channelId);
    if (t) clearTimeout(t);
    jobs.delete(channelId);
}

export function stopAllBumps() {
    for (const id of [...jobs.keys()]) clearJob(id);
}

function extractText(message: any) {
    if (!message) return "";
    const parts = [message.content || ""];
    for (const embed of message.embeds || []) {
        if (embed.title) parts.push(embed.title);
        if (embed.description) parts.push(embed.description);
        for (const field of embed.fields || []) {
            if (field.name) parts.push(field.name);
            if (field.value) parts.push(field.value);
        }
    }
    return parts.join("\n");
}

function isBumpSuccess(text: string) {
    const lower = text.toLowerCase();
    return lower.includes("bump effectué")
        || lower.includes("bump done")
        || lower.includes("bumped")
        || (lower.includes("bump!") && !lower.includes("attends") && !lower.includes("wait"));
}

function isBumpCooldown(text: string) {
    const lower = text.toLowerCase();
    return lower.includes("attends encore")
        || lower.includes("please wait")
        || lower.includes("avant que le serveur")
        || lower.includes("until the server can be bumped");
}

function parseCooldownMs(text: string) {
    if (!text) return null;
    const lower = text.toLowerCase();
    const hours = lower.match(/(?:encore|another|wait(?:ing)?(?:\s+another)?)\s+(\d+)\s*(?:heure|hour)/i)
        || lower.match(/(\d+)\s*(?:heure|hour)/i);
    const minutes = lower.match(/(?:encore|another|wait(?:ing)?(?:\s+another)?)\s+(\d+)\s*(?:minute|min)/i)
        || lower.match(/(\d+)\s*(?:minute|min)/i);
    if (hours) return (Number(hours[1]) * 60 + 1) * 60 * 1000;
    if (minutes) return (Number(minutes[1]) + 1) * 60 * 1000;
    return null;
}

async function findDisboardCommand(guildId: string, channelId: string) {
    const tries = [
        `/guilds/${guildId}/application-command-index`,
        `/channels/${channelId}/application-command-index`,
        `/guilds/${guildId}/application-commands/search?type=1&query=bump&limit=10&include_applications=true`,
    ];

    for (const url of tries) {
        try {
            const res = await RestAPI.get({ url });
            const body = res?.body ?? res;
            const applications = body?.applications ?? body?.application_commands_applications ?? [];
            const commands = body?.application_commands
                ?? body?.commands
                ?? body?.application_commands_index
                ?? [];

            const list = Array.isArray(commands) ? commands : Object.values(commands || {});
            const apps = Array.isArray(applications) ? applications : Object.values(applications || {});

            const application = apps.find((app: any) =>
                String(app?.id) === DISBOARD_BOT_ID || String(app?.bot_id) === DISBOARD_BOT_ID
            );

            const command = list.find((cmd: any) =>
                (String(cmd?.application_id) === DISBOARD_BOT_ID
                    || (application && String(cmd?.application_id) === String(application.id)))
                && (cmd?.name === "bump" || cmd?.name_default === "bump")
            );

            if (command) {
                return {
                    applicationId: String(command.application_id || application?.id || DISBOARD_BOT_ID),
                    command,
                };
            }
        } catch { /* next */ }
    }

    // Dernier recours : endpoints globaux connus parfois cachés
    try {
        const res = await RestAPI.get({
            url: `/applications/${DISBOARD_BOT_ID}/commands`,
        });
        const list = res?.body ?? res;
        const arr = Array.isArray(list) ? list : [];
        const command = arr.find((c: any) => c?.name === "bump");
        if (command) return { applicationId: DISBOARD_BOT_ID, command };
    } catch { /* */ }

    return null;
}

async function waitDisboardReply(channelId: string, startedAt: number) {
    const deadline = Date.now() + DISBOARD_WAIT_MS;
    while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 800));
        try {
            const msgs = MessageStore.getMessages(channelId)?.toArray?.() ?? [];
            for (const m of msgs.slice(0, 15)) {
                const authorId = m.author?.id;
                if (String(authorId) !== DISBOARD_BOT_ID) continue;
                const ts = m.timestamp ? new Date(m.timestamp).getTime() : (m.editedTimestamp ? new Date(m.editedTimestamp).getTime() : 0);
                if (ts && ts < startedAt - 2000) continue;
                const text = extractText(m);
                if (isBumpSuccess(text) || isBumpCooldown(text)) return m;
            }
        } catch { /* */ }
    }
    return null;
}

export async function sendDisboardBump(channelId: string): Promise<{ ok: boolean; text: string; error?: string; }> {
    const ch = ChannelStore.getChannel(channelId);
    if (!ch?.guild_id) {
        return { ok: false, text: "", error: "Salon serveur requis (Disboard)." };
    }

    const sessionId = AuthStore?.getSessionId?.() ?? "";
    if (!sessionId) {
        return { ok: false, text: "", error: "Session Discord invalide." };
    }

    const found = await findDisboardCommand(ch.guild_id, channelId);
    if (!found) {
        return { ok: false, text: "", error: "Disboard /bump introuvable (invite DISBOARD + sync slash)." };
    }

    const { applicationId, command } = found;
    const startedAt = Date.now();

    const body: Record<string, any> = {
        type: 2,
        application_id: applicationId,
        guild_id: ch.guild_id,
        channel_id: channelId,
        session_id: sessionId,
        data: {
            version: command.version,
            id: command.id,
            name: command.name_default || command.name,
            type: command.type ?? 1,
            options: [],
            attachments: [],
            guild_id: ch.guild_id,
        },
        nonce: nonce(),
        analytics_location: "slash",
    };

    try {
        await RestAPI.post({ url: "/interactions", body });
    } catch (e: any) {
        const msg = e?.body?.message ?? e?.message ?? String(e);
        return { ok: false, text: "", error: `Interaction échouée: ${msg}` };
    }

    const reply = await waitDisboardReply(channelId, startedAt);
    const text = extractText(reply);
    if (!text) {
        return { ok: false, text: "", error: "Pas de réponse Disboard (perms slash / bot muet ?)." };
    }
    return { ok: true, text };
}

function scheduleNext(channelId: string, delayMs: number) {
    clearJob(channelId);
    const wait = Math.max(delayMs, 30_000);
    const nextAt = Date.now() + wait;
    state.nextAt[channelId] = nextAt;
    void saveBumpState();

    const t = setTimeout(() => {
        void runBump(channelId);
    }, wait);
    jobs.set(channelId, t);
}

async function runBump(channelId: string) {
    if (!state.enabled || !state.channels.includes(channelId)) {
        clearJob(channelId);
        return;
    }

    const result = await sendDisboardBump(channelId);
    if (!result.ok) {
        const isPerm = /Missing Access|Missing Permissions|50013|50001|commandes/i.test(result.error || "");
        scheduleNext(channelId, isPerm ? RETRY_ON_PERMS_MS : RETRY_ON_ERROR_MS);
        console.warn(`[CordBump] #${channelId}: ${result.error}`);
        return;
    }

    if (isBumpCooldown(result.text)) {
        scheduleNext(channelId, parseCooldownMs(result.text) || BUMP_COOLDOWN_MS);
        return;
    }

    if (isBumpSuccess(result.text)) {
        scheduleNext(channelId, nextDelayAfterSuccess());
        return;
    }

    scheduleNext(channelId, RETRY_ON_ERROR_MS);
}

export function startChannelBump(channelId: string, { immediate = true, delayMs = 0 } = {}) {
    if (!state.channels.includes(channelId)) {
        state.channels.push(channelId);
    }
    state.enabled = true;
    void saveBumpState();

    if (immediate && delayMs <= 0) {
        void runBump(channelId);
    } else {
        scheduleNext(channelId, delayMs > 0 ? delayMs : nextDelayAfterSuccess());
    }
}

export function stopChannelBump(channelId: string) {
    clearJob(channelId);
    state.channels = state.channels.filter(id => id !== channelId);
    delete state.nextAt[channelId];
    if (state.channels.length === 0) state.enabled = false;
    void saveBumpState();
}

export function stopAutobump() {
    stopAllBumps();
    state.enabled = false;
    void saveBumpState();
}

export async function restoreAutobump() {
    await loadBumpState();
    if (!state.enabled || state.channels.length === 0) return;

    state.channels.forEach((channelId, i) => {
        const next = state.nextAt[channelId];
        const delay = next && next > Date.now() ? next - Date.now() : i * 15_000;
        startChannelBump(channelId, { immediate: delay <= 0, delayMs: Math.max(delay, 0) });
    });
}

export function bumpStatusLines() {
    if (!state.channels.length) return ["Aucun salon autobump."];
    return state.channels.map(id => {
        const ch = ChannelStore.getChannel(id);
        const guild = ch?.guild_id ? (ch as any).guild?.name : null;
        const next = state.nextAt[id];
        const when = next ? `<t:${Math.floor(next / 1000)}:R>` : "—";
        const active = jobs.has(id) ? "ON" : "off";
        return `• <#${id}>${guild ? ` (${guild})` : ""} · ${active} · prochain ${when}`;
    });
}
