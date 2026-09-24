/*
 * Zcord, a Discord client mod
 * Copyright (c) 2026 contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Port des utilitaires cord → slash commands client (pas de selfbot).
 * Exclus : nitro fake/gen/snipe, leave-all, mass DM, impersonation webhook, paypal scam.
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import { DataStore } from "@api/index";
import { getUserSettingLazy } from "@api/UserSettings";
import { sendMessage } from "@utils/discord";
import definePlugin from "@utils/types";
import { findByPropsLazy } from "@webpack";
import {
    ChannelStore,
    GuildMemberStore,
    GuildStore,
    IconUtils,
    MessageStore,
    RestAPI,
    UserGuildSettingsStore,
    UserStore,
    VoiceStateStore
} from "@webpack/common";

import {
    bumpStatusLines,
    getBumpState,
    restoreAutobump,
    sendDisboardBump,
    startChannelBump,
    stopAllBumps,
    stopAutobump,
    stopChannelBump,
} from "./autobump";

const GuildActions = findByPropsLazy("leaveGuild");
const ChannelActions = findByPropsLazy("selectVoiceChannel", "disconnect");
const PrivateChannelSortStore = findByPropsLazy("getPrivateChannelIds");
const StatusModule = findByPropsLazy("setStatus");
const CustomStatusSettings = getUserSettingLazy<{ text?: string; emojiName?: string; emojiId?: string; } | null>("status", "customStatus");

const NOTES_KEY = "cordCommands_notes";
const AFK_KEY = "cordCommands_afk";
const SETTINGS_KEY = "cordCommands_settings";

interface NoteEntry { id: string; content: string; createdAt: number; }
interface SnipeEntry { author: string; authorId: string; content: string; image?: string; date: number; }
interface AfkState {
    on: boolean;
    message: string;
    since: number;
    /** User IDs en WL manuelle (jamais de réponse AFK) */
    whitelist: string[];
}
interface CordSettings { lang: "fr" | "en"; }

const snipes = new Map<string, SnipeEntry>();
const recentMsgs = new Map<string, SnipeEntry>();
let afk: AfkState = {
    on: false,
    message: "Je suis AFK",
    since: 0,
    whitelist: [],
};
let settings: CordSettings = { lang: "fr" };
const afkReplied = new Set<string>();

const NSFW_TYPES = [
    "hentai", "ass", "boobs", "pgif", "pussy", "thigh", "anal", "4k",
    "gonewild", "hass", "hboobs", "hanal", "hneko", "hkitsune", "hmidriff",
    "hthigh", "tentacle", "yaoi", "holo", "kemonomimi", "kanna", "gah", "paizuri"
] as const;

async function loadPersisted() {
    const raw = await DataStore.get<Partial<AfkState> & { skipPinned?: boolean; }>(AFK_KEY);
    if (raw) {
        afk = {
            on: !!raw.on,
            message: raw.message || "Je suis AFK",
            since: Number(raw.since) || 0,
            whitelist: Array.isArray(raw.whitelist) ? raw.whitelist.map(String) : [],
        };
    }
    settings = (await DataStore.get<CordSettings>(SETTINGS_KEY)) ?? settings;
}

async function saveAfk() {
    await DataStore.set(AFK_KEY, afk);
}

function getPinDmsPlugin(): { isPinned?: (id: string) => boolean; } | null {
    try {
        const plugins = (window as any).Vencord?.Plugins?.plugins
            ?? (window as any).Zcord?.Plugins?.plugins;
        return plugins?.PinDMs ?? null;
    } catch {
        return null;
    }
}

/** Favori Discord natif (épingle MP) OU catégorie PinDMs */
function isPinnedDm(channelId: string): boolean {
    try {
        const ugs = UserGuildSettingsStore as any;
        if (ugs?.isMessagesFavorite?.(channelId)) return true;
        if (ugs?.isAddedToMessages?.(channelId)) return true;
        if (ugs?.isFavorite?.(null, channelId) || ugs?.isFavorite?.("@me", channelId)) return true;
    } catch { /* */ }
    try {
        const pin = getPinDmsPlugin();
        if (typeof pin?.isPinned === "function" && pin.isPinned(channelId)) return true;
    } catch { /* */ }
    // Fallback : lire les catégories PinDMs dans les settings (sans dépendre de init())
    try {
        const me = UserStore.getCurrentUser()?.id;
        const settingsRoot = (window as any).Vencord?.Settings?.plugins?.PinDMs
            ?? (window as any).Zcord?.Settings?.plugins?.PinDMs;
        const cats = me && settingsRoot?.userBasedCategoryList?.[me];
        if (Array.isArray(cats) && cats.some((c: any) => Array.isArray(c?.channels) && c.channels.includes(channelId))) {
            return true;
        }
    } catch { /* */ }
    return false;
}

/** IDs des gens dont le MP est épinglé/favori (= auto WL) */
function getPinnedDmUserIds(): string[] {
    const out: string[] = [];
    try {
        const channels: string[] = PrivateChannelSortStore.getPrivateChannelIds?.() ?? [];
        for (const chId of channels) {
            if (!isPinnedDm(chId)) continue;
            const partner = dmPartnerId(chId);
            if (partner && !out.includes(partner)) out.push(partner);
        }
    } catch { /* */ }
    return out;
}

/** WL manuelle OU personne épinglée/favorite en MP */
function isAfkWhitelisted(userId: string, channelId?: string): boolean {
    if (afk.whitelist.includes(userId)) return true;
    if (channelId && isPinnedDm(channelId)) return true;
    try {
        // DM 1:1 : l'id salon peut être l'id user selon le cache
        if (UserGuildSettingsStore?.isMessagesFavorite?.(userId)) return true;
    } catch { /* */ }
    return getPinnedDmUserIds().includes(userId);
}

function dmPartnerId(channelId: string): string | undefined {
    try {
        const ch = ChannelStore.getChannel(channelId);
        if (!ch) return;
        const me = UserStore.getCurrentUser()?.id;
        const recipients: string[] = ch.recipients ?? [];
        if (recipients.length) return recipients.find(id => id !== me) ?? recipients[0];
        if (ch.recipientId) return ch.recipientId;
    } catch { /* */ }
}

async function loadNotes() {
    return (await DataStore.get<NoteEntry[]>(NOTES_KEY)) ?? [];
}

async function saveNotes(notes: NoteEntry[]) {
    await DataStore.set(NOTES_KEY, notes);
}

function t(fr: string, en: string) {
    return settings.lang === "en" ? en : fr;
}

/** Réponse slash (BUILT_IN_TEXT) : Discord envoie ce `{ content }` comme ton message. */
function reply(_channelId: string, content: string) {
    return { content };
}

/** Feedback local immédiat (Clyde), sans passer par l'envoi Discord. */
function say(channelId: string, content: string) {
    sendBotMessage(channelId, { content });
}

/** Supprime l'écho `/commande` que Discord poste avec BUILT_IN_TEXT + content vide. */
async function scrubSlashEcho(channelId: string) {
    const me = UserStore.getCurrentUser()?.id;
    if (!me) return;
    for (const delay of [200, 600, 1200]) {
        await new Promise(r => setTimeout(r, delay));
        try {
            const msgs = MessageStore.getMessages(channelId)?.toArray?.() ?? [];
            for (const m of msgs.slice(0, 12)) {
                if (m.author?.id !== me && m.authorId !== me) continue;
                const c = String(m.content ?? "");
                const isEcho = c === ""
                    || c.startsWith("/cord-afk")
                    || /\bcord-afk\b/.test(c)
                    || (m.interaction && String(m.interaction?.name ?? "").includes("cord-afk"));
                if (!isEcho) continue;
                try {
                    await RestAPI.del({ url: `/channels/${channelId}/messages/${m.id}` });
                    return;
                } catch { /* rate / déjà parti */ }
            }
        } catch { /* */ }
    }
}

/** Clyde only — pas de message public / pas d'écho slash. */
function saySilent(channelId: string, content: string) {
    say(channelId, content);
    void scrubSlashEcho(channelId);
    return undefined;
}

function safeEval(expr: string): number {
    const cleaned = expr.replace(/\s+/g, "");
    if (!/^[\d+\-*/().,%^]+$/.test(cleaned)) throw new Error("Expression invalide");
    // eslint-disable-next-line no-new-func
    const result = Function(`"use strict"; return (${cleaned.replace(/\^/g, "**")})`)();
    if (typeof result !== "number" || !Number.isFinite(result)) throw new Error("Résultat invalide");
    return result;
}

function resolveUser(opts: any[]) {
    const id = findOption(opts, "user") as string | undefined;
    return id ? UserStore.getUser(id) : UserStore.getCurrentUser();
}

function avatarUrl(user: any, size = 1024) {
    if (!user) return null;
    try { return IconUtils.getUserAvatarURL(user, true, size); }
    catch {
        return user.avatar
            ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${String(user.avatar).startsWith("a_") ? "gif" : "png"}?size=${size}`
            : null;
    }
}

function bannerUrl(user: any, size = 2048) {
    if (!user?.banner) return null;
    const ext = String(user.banner).startsWith("a_") ? "gif" : "png";
    return `https://cdn.discordapp.com/banners/${user.id}/${user.banner}.${ext}?size=${size}`;
}

function snowflakeCreated(id: string) {
    return Math.floor(Number((BigInt(id) >> 22n) + 1420070400000n) / 1000);
}

function entryFromMessage(msg: any): SnipeEntry | null {
    if (!msg) return null;
    const author = msg.author;
    if (author?.bot || msg.bot) return null;
    const attachment = msg.attachments?.[0];
    return {
        author: author?.username ?? author?.globalName ?? "Inconnu",
        authorId: author?.id ?? "?",
        content: msg.content || "(vide / embed)",
        image: attachment?.url ?? attachment?.proxy_url,
        date: Date.now()
    };
}

/** Un seul bloc ANSI — même format qu'un collage manuel Discord. */
function afkAnsiBanner(extra = "") {
    const ESC = String.fromCharCode(27);
    const msg = String(extra ?? "").replaceAll("```", "").trim();
    const line = msg
        ? `${ESC}[32m AFK ACTIVE ${ESC}[0m  ${msg}`
        : `${ESC}[32m AFK ACTIVE ${ESC}[0m`;
    return ["```ansi", line, "```"].join("\n");
}

function afkOffBanner() {
    const ESC = String.fromCharCode(27);
    return ["```ansi", `${ESC}[31m AFK OFF ${ESC}[0m`, "```"].join("\n");
}

function channelIdOf(msg: any): string | undefined {
    return msg?.channel_id ?? msg?.channelId;
}

function isPrivateChannel(channelId: string, guildId?: string | null) {
    if (guildId) return false;
    try {
        const ch = ChannelStore.getChannel(channelId);
        if (!ch) return true; // pas de guild_id → traiter comme MP
        return Boolean(ch.isDM?.() || ch.isGroupDM?.() || ch.isPrivate?.() || ch.type === 1 || ch.type === 3);
    } catch {
        return true;
    }
}

async function postAfkMessage(channelId: string, content: string, replyToId?: string) {
    try {
        await RestAPI.post({
            url: `/channels/${channelId}/messages`,
            body: {
                content,
                ...(replyToId ? {
                    message_reference: {
                        message_id: replyToId,
                        channel_id: channelId,
                        fail_if_not_exists: false
                    },
                    allowed_mentions: { parse: [], replied_user: false }
                } : {})
            }
        });
        return true;
    } catch {
        try {
            await sendMessage(channelId, { content });
            return true;
        } catch {
            return false;
        }
    }
}

function onMessageCreate(payload: any) {
    // Ignorer les messages optimistes (pas encore confirmés par Discord)
    if (payload?.optimistic) return;

    const msg = payload?.message ?? payload;
    const channelId = channelIdOf(msg);
    if (!msg?.id || !channelId) return;

    const entry = entryFromMessage(msg);
    if (entry) {
        recentMsgs.set(msg.id, entry);
        if (recentMsgs.size > 500) {
            const first = recentMsgs.keys().next().value;
            if (first) recentMsgs.delete(first);
        }
    }

    // AFK : répondre aux mentions + MP
    if (!afk.on) return;
    const me = UserStore.getCurrentUser();
    const authorId = msg.author?.id ?? msg.authorId;
    if (!me || !authorId || authorId === me.id || msg.author?.bot) return;

    // Whitelist manuelle + auto WL des MP épinglés / favoris Discord
    const isDmEarly = isPrivateChannel(channelId, msg.guild_id ?? msg.guildId);
    if (isAfkWhitelisted(authorId, isDmEarly ? channelId : undefined)) return;

    const mentioned = Array.isArray(msg.mentions)
        ? msg.mentions.some((u: any) => (u.id ?? u) === me.id)
        : false;
    const mentionInText = typeof msg.content === "string"
        && (msg.content.includes(`<@${me.id}>`) || msg.content.includes(`<@!${me.id}>`));
    // Réponse à un de tes messages = ping implicite
    const repliedToMe = msg.message_reference?.message_id
        && (() => {
            try {
                const ref = MessageStore.getMessage(channelId, msg.message_reference.message_id);
                return ref?.author?.id === me.id;
            } catch { return false; }
        })();
    const isDm = isPrivateChannel(channelId, msg.guild_id ?? msg.guildId);

    if (!isDm && !mentioned && !mentionInText && !repliedToMe) return;

    const key = `${channelId}:${authorId}`;
    if (afkReplied.has(key)) return;
    // Réserver le slot tout de suite pour éviter les doubles réponses
    afkReplied.add(key);
    setTimeout(() => afkReplied.delete(key), 60_000);

    const since = afk.since ? `depuis <t:${Math.floor(afk.since / 1000)}:R>` : "";
    const body = afkAnsiBanner(afk.message);
    const content = since ? `${body}\n-# ${since}` : body;

    void postAfkMessage(channelId, content, msg.id).then(ok => {
        if (!ok) afkReplied.delete(key);
    });
}

function onMessageDelete(payload: any) {
    if (payload?.mlDeleted) return;
    const channelId = payload?.channelId ?? payload?.channel_id;
    const id = payload?.id;
    if (!channelId || !id) return;
    let entry = recentMsgs.get(id) ?? null;
    recentMsgs.delete(id);
    if (!entry) {
        try { entry = entryFromMessage(MessageStore.getMessage(channelId, id)); } catch { /* */ }
    }
    if (entry) snipes.set(channelId, entry);
}

async function deleteOwnMessages(channelId: string, limit: number) {
    const me = UserStore.getCurrentUser()?.id;
    if (!me) return 0;
    let deleted = 0;
    try {
        const msgs = MessageStore.getMessages(channelId)?.toArray?.() ?? [];
        for (const m of msgs) {
            if (deleted >= limit) break;
            if (m.author?.id !== me && m.authorId !== me) continue;
            try {
                await RestAPI.del({ url: `/channels/${channelId}/messages/${m.id}` });
                deleted++;
                await new Promise(r => setTimeout(r, 350));
            } catch { /* rate limit / perm */ }
        }
    } catch { /* */ }
    return deleted;
}

const cmd = (
    name: string,
    description: string,
    options: any[] | undefined,
    execute: (opts: any[], ctx: any) => any
) => ({
    name,
    description,
    // BUILT_IN_TEXT = visible dans le menu / (filtre Discord getBuiltInCommands)
    inputType: ApplicationCommandInputType.BUILT_IN_TEXT,
    ...(options?.length ? { options } : {}),
    async execute(opts: any[], ctx: any) {
        const result = await execute(opts, ctx);
        // Discord envoie le { content } retourné ; ignore les Message corrompus
        if (result && typeof result === "object" && typeof result.content === "string") {
            return { content: result.content };
        }
        return result;
    }
});

const userOpt = { name: "user", description: "Utilisateur", type: ApplicationCommandOptionType.USER, required: false };

export default definePlugin({
    name: "CordCommands",
    description: "Toutes les commandes cord utiles dans le client Discord (slash)",
    authors: [{ name: "Zcord", id: 0n }],
    dependencies: ["CommandsAPI"],
    tags: ["Commands", "Utility"],
    enabledByDefault: true,

    async start() {
        await loadPersisted();
        await restoreAutobump();
    },

    stop() {
        snipes.clear();
        recentMsgs.clear();
        afkReplied.clear();
        stopAllBumps();
    },

    // Plus fiable que subscribe manuel (Vencord wire le flux automatiquement)
    flux: {
        MESSAGE_CREATE: onMessageCreate,
        MESSAGE_DELETE: onMessageDelete,
    },

    commands: [
        // ── Help ──────────────────────────────────────────────
        cmd("cord-help", "Liste toutes les commandes Cord", undefined, async (_o, ctx) => {
            return reply(ctx.channel.id, [
                "**CordCommands — aide**",
                "**Utiles:** `cord-ping` `cord-avatar` `cord-banner` `cord-userinfo` `cord-serverinfo` `cord-calcul` `cord-search` `cord-snipe` `cord-notes` `cord-clear` `cord-leave` `cord-afk` `cord-bump`",
                "**Fun:** `cord-coinflip` `cord-love` `cord-thot` `cord-bonjour` `cord-add`",
                "**Tools:** `cord-crown` `cord-find` `cord-ipinfo` `cord-emoji` `cord-closedms`",
                "**Mod:** `cord-renew` `cord-kickbots` `cord-createchannel` `cord-createvoice` `cord-createrole` `cord-createwebhook`",
                "**Statut:** `cord-status` `cord-customstatus` `cord-language`",
                "**Vocal:** `cord-joinvc` `cord-leavevc`",
                "**NSFW:** `cord-nsfw` (salon NSFW uniquement)",
                "_Exclus: nitro fake/gen/snipe, leave-all, mass DM, impersonation, paypal scam_"
            ].join("\n"));
        }),

        // ── Utiles ────────────────────────────────────────────
        cmd("cord-ping", "Latence client", undefined, async (_o, ctx) => {
            const t0 = performance.now();
            await new Promise(r => requestAnimationFrame(() => r(null)));
            return reply(ctx.channel.id, `🏓 \`${Math.round(performance.now() - t0)} ms\``);
        }),

        cmd("cord-avatar", "Avatar", [userOpt], async (opts, ctx) => {
            const user = resolveUser(opts);
            if (!user) return reply(ctx.channel.id, "Introuvable.");
            return reply(ctx.channel.id, `**Avatar <@${user.id}>**\n${avatarUrl(user)}`);
        }),

        cmd("cord-banner", "Bannière", [userOpt], async (opts, ctx) => {
            const user = resolveUser(opts);
            if (!user) return reply(ctx.channel.id, "Introuvable.");
            const url = bannerUrl(user);
            return reply(ctx.channel.id, url ? `**Bannière <@${user.id}>**\n${url}` : "Pas de bannière.");
        }),

        cmd("cord-userinfo", "Infos utilisateur", [userOpt], async (opts, ctx) => {
            const user = resolveUser(opts);
            if (!user) return reply(ctx.channel.id, "Introuvable.");
            const created = snowflakeCreated(user.id);
            return reply(ctx.channel.id, [
                `**👤 ${user.username}** (\`${user.id}\`)`,
                `Créé : <t:${created}:F> · <t:${created}:R>`,
                `Avatar : ${avatarUrl(user) ?? "—"}`,
                `Bannière : ${bannerUrl(user) ?? "—"}`
            ].join("\n"));
        }),

        cmd("cord-serverinfo", "Infos serveur", [{
            name: "id", description: "ID serveur", type: ApplicationCommandOptionType.STRING, required: false
        }], async (opts, ctx) => {
            const id = (findOption(opts, "id") as string) || ctx.guild?.id;
            if (!id) return reply(ctx.channel.id, "Pas de serveur.");
            const guild = GuildStore.getGuild(id);
            if (!guild) return reply(ctx.channel.id, `Serveur \`${id}\` pas en cache.`);
            const created = snowflakeCreated(guild.id);
            const icon = guild.icon
                ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.${String(guild.icon).startsWith("a_") ? "gif" : "png"}?size=1024`
                : "—";
            return reply(ctx.channel.id, [
                `**🏰 ${guild.name}** (\`${guild.id}\`)`,
                `Owner : <@${guild.ownerId}>`,
                `Créé : <t:${created}:F> · <t:${created}:R>`,
                `Icône : ${icon}`
            ].join("\n"));
        }),

        cmd("cord-calcul", "Calculatrice", [{
            name: "expression", description: "2+2*3", type: ApplicationCommandOptionType.STRING, required: true
        }], async (opts, ctx) => {
            const expr = findOption(opts, "expression", "") as string;
            try { return reply(ctx.channel.id, `\`${expr}\` = **${safeEval(expr)}**`); }
            catch (e: any) { return reply(ctx.channel.id, `Erreur : ${e.message}`); }
        }),

        cmd("cord-search", "Recherche Google", [{
            name: "query", description: "Texte", type: ApplicationCommandOptionType.STRING, required: true
        }], async (opts, ctx) => {
            const q = findOption(opts, "query", "") as string;
            return reply(ctx.channel.id, `🔍 [${q}](https://www.google.com/search?q=${encodeURIComponent(q)})`);
        }),

        cmd("cord-snipe", "Dernier message supprimé", undefined, async (_o, ctx) => {
            const s = snipes.get(ctx.channel.id);
            if (!s) return reply(ctx.channel.id, "Rien à sniper.");
            return reply(ctx.channel.id, [
                "**📝 Snipe**",
                `Auteur : **${s.author}** (\`${s.authorId}\`)`,
                `Message : ${s.content.slice(0, 1500)}`,
                s.image ? `Image : ${s.image}` : null,
                `Date : <t:${Math.floor(s.date / 1000)}:R>`
            ].filter(Boolean).join("\n"));
        }),

        cmd("cord-notes", "Notes perso", [
            {
                name: "action", description: "Action", type: ApplicationCommandOptionType.STRING, required: true,
                choices: [
                    { name: "add", value: "add", label: "Ajouter" },
                    { name: "list", value: "list", label: "Lister" },
                    { name: "delete", value: "delete", label: "Supprimer" }
                ]
            },
            { name: "text", description: "Contenu ou ID", type: ApplicationCommandOptionType.STRING, required: false }
        ], async (opts, ctx) => {
            const action = findOption(opts, "action", "list") as string;
            const text = (findOption(opts, "text", "") as string).trim();
            const notes = await loadNotes();
            if (action === "add") {
                if (!text) return reply(ctx.channel.id, "Texte requis.");
                const entry = { id: String(Date.now()), content: text, createdAt: Date.now() };
                notes.unshift(entry);
                await saveNotes(notes.slice(0, 100));
                return reply(ctx.channel.id, `Note \`${entry.id}\` ajoutée.`);
            }
            if (action === "delete") {
                if (!notes.some(n => n.id === text)) return reply(ctx.channel.id, "ID invalide.");
                await saveNotes(notes.filter(n => n.id !== text));
                return reply(ctx.channel.id, `Note \`${text}\` supprimée.`);
            }
            if (!notes.length) return reply(ctx.channel.id, "Aucune note.");
            return reply(ctx.channel.id, notes.slice(0, 25).map(n => `• \`${n.id}\` — ${n.content.slice(0, 100)}`).join("\n"));
        }),

        cmd("cord-clear", "Supprime tes messages dans ce salon", [{
            name: "nombre", description: "Max 50", type: ApplicationCommandOptionType.INTEGER, required: false
        }], async (opts, ctx) => {
            const n = Math.min(50, Math.max(1, Number(findOption(opts, "nombre", 10)) || 10));
            say(ctx.channel.id, `Suppression de jusqu'à ${n} messages…`);
            const deleted = await deleteOwnMessages(ctx.channel.id, n);
            return reply(ctx.channel.id, `✅ ${deleted} message(s) supprimé(s).`);
        }),

        cmd("cord-leave", "Quitter un serveur (un seul)", [{
            name: "id", description: "ID serveur (défaut: actuel)", type: ApplicationCommandOptionType.STRING, required: false
        }], async (opts, ctx) => {
            const id = (findOption(opts, "id") as string) || ctx.guild?.id;
            if (!id) return reply(ctx.channel.id, "ID requis.");
            const guild = GuildStore.getGuild(id);
            try {
                await GuildActions.leaveGuild(id);
                return reply(ctx.channel.id, `Quité **${guild?.name ?? id}**.`);
            } catch (e: any) {
                return reply(ctx.channel.id, `Échec : ${e?.message ?? e}`);
            }
        }),

        {
            ...cmd("cord-afk", "AFK auto (MP/pings) — épinglés = WL auto", [
            {
                name: "action", description: "Action", type: ApplicationCommandOptionType.STRING, required: true,
                choices: [
                    { name: "on", value: "on", label: "Activer" },
                    { name: "off", value: "off", label: "Désactiver" },
                    { name: "status", value: "status", label: "Statut" },
                    { name: "wl_add", value: "wl_add", label: "Whitelist + (pas d'AFK)" },
                    { name: "wl_remove", value: "wl_remove", label: "Whitelist −" },
                    { name: "wl_list", value: "wl_list", label: "Liste whitelist" },
                ]
            },
            { name: "message", description: "Message AFK (action on)", type: ApplicationCommandOptionType.STRING, required: false },
            { name: "user", description: "Personne (wl_add / wl_remove)", type: ApplicationCommandOptionType.USER, required: false },
        ], async (opts, ctx) => {
            const action = findOption(opts, "action", "status") as string;
            const message = (findOption(opts, "message", "") as string).trim();
            const channelId = ctx.channel.id;
            const userOptId = findOption(opts, "user") as string | undefined;
            const pinnedAuto = getPinnedDmUserIds();

            if (action === "on") {
                afk = {
                    ...afk,
                    on: true,
                    message: message || afk.message || "Je suis AFK",
                    since: Date.now(),
                };
                await saveAfk();
                afkReplied.clear();
                await postAfkMessage(channelId, afkAnsiBanner(afk.message));
                return saySilent(channelId, [
                    "✅ AFK activé — MP + mentions/réponses.",
                    `📌 Épinglés : **WL auto** (${pinnedAuto.length})`,
                    afk.whitelist.length ? `WL manuelle : **${afk.whitelist.length}**` : "WL manuelle : vide",
                ].join(" · "));
            }
            if (action === "off") {
                afk = { ...afk, on: false, since: 0 };
                await saveAfk();
                await postAfkMessage(channelId, afkOffBanner());
                return saySilent(channelId, "AFK désactivé.");
            }
            if (action === "wl_add") {
                const id = userOptId || dmPartnerId(channelId);
                if (!id) {
                    return saySilent(channelId, "Choisis `user:` ou lance la commande dans un MP.");
                }
                if (!afk.whitelist.includes(id)) afk.whitelist.push(id);
                await saveAfk();
                return saySilent(channelId, `Whitelist + <@${id}> — pas de réponse AFK.`);
            }
            if (action === "wl_remove") {
                const id = userOptId || dmPartnerId(channelId);
                if (!id) {
                    return saySilent(channelId, "Choisis `user:` ou lance dans un MP.");
                }
                afk.whitelist = afk.whitelist.filter(x => x !== id);
                await saveAfk();
                return saySilent(channelId, `Whitelist − <@${id}>.`);
            }
            if (action === "wl_list") {
                const lines: string[] = [];
                if (pinnedAuto.length) {
                    lines.push("**📌 Auto (MP épinglés)**");
                    for (const id of pinnedAuto) lines.push(`• <@${id}>`);
                }
                if (afk.whitelist.length) {
                    lines.push("**✍️ Manuelle**");
                    for (const id of afk.whitelist) lines.push(`• <@${id}>`);
                }
                return saySilent(channelId, lines.length ? lines.join("\n") : "Aucune WL (épingle des MP pour WL auto).");
            }

            // status
            const status = afk.on
                ? `${afkAnsiBanner(afk.message)}\n-# depuis <t:${Math.floor(afk.since / 1000)}:R>`
                : afkOffBanner();
            await postAfkMessage(channelId, status);
            return saySilent(channelId, [
                `📌 Épinglés WL auto : ${pinnedAuto.length}`,
                `WL manuelle : ${afk.whitelist.length}`,
            ].join(" · "));
        }),
            // BUILT_IN = pas d'écho `/cord-afk …` dans le chat (seulement Clyde + bannières)
            inputType: ApplicationCommandInputType.BUILT_IN,
        },

        {
            ...cmd("cord-bump", "Autobump Disboard (/bump ~toutes les 2h)", [
                {
                    name: "action", description: "Action", type: ApplicationCommandOptionType.STRING, required: true,
                    choices: [
                        { name: "on", value: "on", label: "Activer (salon actuel)" },
                        { name: "off", value: "off", label: "Tout désactiver" },
                        { name: "add", value: "add", label: "Ajouter salon" },
                        { name: "remove", value: "remove", label: "Retirer salon" },
                        { name: "now", value: "now", label: "Bumper maintenant" },
                        { name: "status", value: "status", label: "Statut" },
                    ]
                },
                { name: "channel", description: "Salon (défaut: actuel)", type: ApplicationCommandOptionType.CHANNEL, required: false },
            ], async (opts, ctx) => {
                const action = findOption(opts, "action", "status") as string;
                const channelOpt = findOption(opts, "channel") as string | undefined;
                const channelId = channelOpt || ctx.channel?.id;
                const channelIdStr = channelId ? String(channelId) : "";

                if (action === "status") {
                    const st = getBumpState();
                    return saySilent(ctx.channel.id, [
                        `Autobump : **${st.enabled ? "ON" : "OFF"}** · ${st.channels.length} salon(s)`,
                        ...bumpStatusLines(),
                    ].join("\n"));
                }

                if (action === "off") {
                    stopAutobump();
                    return saySilent(ctx.channel.id, "Autobump désactivé.");
                }

                if (!channelIdStr || !ChannelStore.getChannel(channelIdStr)?.guild_id) {
                    return saySilent(ctx.channel.id, "Choisis un salon serveur (ou lance la commande dedans).");
                }

                if (action === "remove") {
                    stopChannelBump(channelIdStr);
                    return saySilent(ctx.channel.id, `Retiré <#${channelIdStr}> de l'autobump.`);
                }

                if (action === "now") {
                    saySilent(ctx.channel.id, "Bump en cours…");
                    const r = await sendDisboardBump(channelIdStr);
                    if (!r.ok) return saySilent(ctx.channel.id, `❌ ${r.error}`);
                    if (getBumpState().channels.includes(channelIdStr)) {
                        startChannelBump(channelIdStr, { immediate: false, delayMs: 2 * 60 * 60 * 1000 });
                    }
                    return saySilent(ctx.channel.id, `Disboard : ${r.text.slice(0, 180)}`);
                }

                startChannelBump(channelIdStr, { immediate: true, delayMs: 0 });
                return saySilent(ctx.channel.id, [
                    `✅ Autobump **ON** pour <#${channelIdStr}>`,
                    "Disboard `/bump` ~toutes les 2h (invite DISBOARD + permission commandes d'appli).",
                    "Voir : `/cord-bump action:status`",
                ].join("\n"));
            }),
            inputType: ApplicationCommandInputType.BUILT_IN,
        },

        // ── Fun ───────────────────────────────────────────────
        cmd("cord-coinflip", "Pile ou face", [{
            name: "choix", description: "pile ou face", type: ApplicationCommandOptionType.STRING, required: true,
            choices: [
                { name: "pile", value: "pile", label: "Pile" },
                { name: "face", value: "face", label: "Face" }
            ]
        }], async (opts, ctx) => {
            const choice = findOption(opts, "choix", "pile") as string;
            const result = Math.random() < 0.5 ? "pile" : "face";
            return reply(ctx.channel.id, `🪙 Tu : **${choice}** · Tirage : **${result}** → ${choice === result ? "Gagné !" : "Perdu."}`);
        }),

        cmd("cord-love", "Message d'amour", [userOpt], async (opts, ctx) => {
            const user = resolveUser(opts);
            return { content: `Je t'aime ❤️ <@${user?.id ?? ctx.channel.id}>` };
        }),

        cmd("cord-thot", "Score aléatoire (fun)", [userOpt], async (opts, ctx) => {
            const user = resolveUser(opts);
            const rating = Math.floor(Math.random() * 100) + 1;
            return reply(ctx.channel.id, `Score de <@${user?.id}> : \`${rating}%\``);
        }),

        cmd("cord-bonjour", "Dire bonjour", undefined, async () => ({ content: "Bonjour ! 👋" })),

        cmd("cord-add", "Lien d'ajout ami Discord", undefined, async (_o, ctx) => {
            try {
                const res = await RestAPI.post({ url: "/users/@me/invites" });
                const code = res?.body?.code;
                if (!code) return reply(ctx.channel.id, "Impossible de créer l'invite ami.");
            return reply(ctx.channel.id, `https://discord.gg/${code}`);
            } catch {
            return reply(ctx.channel.id, "Échec (fonction Discord limitée / rate limit).");
            }
        }),

        // ── Tools ─────────────────────────────────────────────
        cmd("cord-crown", "Propriétaire du serveur", undefined, async (_o, ctx) => {
            const g = ctx.guild;
            if (!g) return reply(ctx.channel.id, "Serveur uniquement.");
            return reply(ctx.channel.id, `👑 **${g.name}** — owner <@${g.ownerId}> (\`${g.ownerId}\`)`);
        }),

        cmd("cord-find", "Trouver un user en vocal", [{
            name: "user", description: "Utilisateur", type: ApplicationCommandOptionType.USER, required: true
        }], async (opts, ctx) => {
            const id = findOption(opts, "user") as string;
            const states = VoiceStateStore.getAllVoiceStates?.() ?? {};
            const hits: string[] = [];
            for (const [guildId, map] of Object.entries(states as Record<string, any>)) {
                const st = map?.[id];
                if (st?.channelId) {
                    const ch = ChannelStore.getChannel(st.channelId);
                    const g = GuildStore.getGuild(guildId);
                    hits.push(`• **${g?.name ?? guildId}** → <#${st.channelId}>${ch?.name ? ` (${ch.name})` : ""}`);
                }
            }
            return reply(ctx.channel.id, hits.length ? hits.join("\n") : "Pas en vocal (dans ton cache).");
        }),

        cmd("cord-ipinfo", "Infos IP (ip-api.com)", [{
            name: "ip", description: "Adresse IP", type: ApplicationCommandOptionType.STRING, required: true
        }], async (opts, ctx) => {
            const ip = (findOption(opts, "ip", "") as string).trim();
            if (!/^[0-9a-fA-F.:]+$/.test(ip)) return reply(ctx.channel.id, "IP invalide.");
            try {
                const res = await fetch(`http://ip-api.com/json/${encodeURIComponent(ip)}`);
                const json = await res.json();
                if (json.status !== "success") return reply(ctx.channel.id, "Lookup échoué.");
            return reply(ctx.channel.id, "```json\n" + JSON.stringify({
                    query: json.query, country: json.country, region: json.regionName,
                    city: json.city, isp: json.isp, org: json.org, as: json.as
                }, null, 2) + "\n```");
            } catch {
            return reply(ctx.channel.id, "Erreur réseau.");
            }
        }),

        cmd("cord-emoji", "Créer un emoji (URL + nom)", [
            { name: "nom", description: "Nom emoji", type: ApplicationCommandOptionType.STRING, required: true },
            { name: "url", description: "URL image", type: ApplicationCommandOptionType.STRING, required: true }
        ], async (opts, ctx) => {
            const guildId = ctx.guild?.id;
            if (!guildId) return reply(ctx.channel.id, "Serveur uniquement.");
            const name = (findOption(opts, "nom", "") as string).replace(/\W/g, "").slice(0, 32);
            const image = findOption(opts, "url", "") as string;
            try {
                const imgRes = await fetch(image);
                const buf = await imgRes.arrayBuffer();
                const bytes = new Uint8Array(buf);
                if (bytes.length > 256_000) return reply(ctx.channel.id, "Image trop lourde (max ~256 Ko).");
                let binary = "";
                for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
                const b64 = btoa(binary);
                const mime = imgRes.headers.get("content-type") || "image/png";
                await RestAPI.post({
                    url: `/guilds/${guildId}/emojis`,
                    body: { name, image: `data:${mime};base64,${b64}` }
                });
            return reply(ctx.channel.id, `Emoji \`:${name}:\` créé.`);
            } catch (e: any) {
            return reply(ctx.channel.id, `Échec emoji (perms / taille) : ${e?.body?.message ?? e?.message ?? e}`);
            }
        }),

        cmd("cord-closedms", "Ferme tous les MP / groupes", [{
            name: "confirm", description: "Écrire oui", type: ApplicationCommandOptionType.STRING, required: true
        }], async (opts, ctx) => {
            if ((findOption(opts, "confirm", "") as string).toLowerCase() !== "oui") {
                return reply(ctx.channel.id, 'Tape `confirm: oui` pour confirmer.');
            }
            const ids: string[] = PrivateChannelSortStore.getPrivateChannelIds?.() ?? [];
            let closed = 0;
            for (const id of ids) {
                try {
                    await RestAPI.del({ url: `/channels/${id}` });
                    closed++;
                    await new Promise(r => setTimeout(r, 200));
                } catch { /* */ }
            }
            return reply(ctx.channel.id, `✅ ${closed} salon(s) privé(s) fermé(s).`);
        }),

        // ── Mod / create ──────────────────────────────────────
        cmd("cord-renew", "Recrée le salon actuel (clone + delete)", [{
            name: "confirm", description: "Écrire oui", type: ApplicationCommandOptionType.STRING, required: true
        }], async (opts, ctx) => {
            if ((findOption(opts, "confirm", "") as string).toLowerCase() !== "oui") {
                return reply(ctx.channel.id, 'Tape `confirm: oui`.');
            }
            const ch = ctx.channel;
            const guildId = ctx.guild?.id;
            if (!guildId || !ch?.id) return reply(ctx.channel.id, "Salon serveur requis.");
            try {
                const created = await RestAPI.post({
                    url: `/guilds/${guildId}/channels`,
                    body: {
                        name: ch.name,
                        type: ch.type,
                        topic: ch.topic,
                        nsfw: ch.nsfw,
                        parent_id: ch.parent_id,
                        rate_limit_per_user: ch.rateLimitPerUser,
                        bitrate: ch.bitrate,
                        user_limit: ch.userLimit,
                        permission_overwrites: ch.permissionOverwrites
                            ? Object.values(ch.permissionOverwrites).map((ow: any) => ({
                                id: ow.id, type: ow.type, allow: String(ow.allow), deny: String(ow.deny)
                            }))
                            : undefined,
                        position: ch.position
                    }
                });
                await RestAPI.del({ url: `/channels/${ch.id}` });
                say(created.body.id, `Salon renouvelé → <#${created.body.id}>`);
                return;
            } catch (e: any) {
                return reply(ctx.channel.id, `Échec renew : ${e?.body?.message ?? e?.message ?? e}`);
            }
        }),

        cmd("cord-kickbots", "Expulse les bots (max 15) — perms kick requises", [
            { name: "confirm", description: "Écrire oui", type: ApplicationCommandOptionType.STRING, required: true },
            { name: "max", description: "Max bots (défaut 10, max 15)", type: ApplicationCommandOptionType.INTEGER, required: false }
        ], async (opts, ctx) => {
            if ((findOption(opts, "confirm", "") as string).toLowerCase() !== "oui") {
                return reply(ctx.channel.id, 'Tape `confirm: oui`.');
            }
            const guildId = ctx.guild?.id;
            if (!guildId) return reply(ctx.channel.id, "Serveur requis.");
            const max = Math.min(15, Math.max(1, Number(findOption(opts, "max", 10)) || 10));
            const memberIds: string[] = GuildMemberStore.getMemberIds?.(guildId)
                ?? (GuildMemberStore.getMembers?.(guildId) ?? []).map((m: any) => m.userId ?? m.user?.id);
            const bots = memberIds.filter(uid => UserStore.getUser(uid)?.bot).slice(0, max);
            let kicked = 0;
            for (const uid of bots) {
                try {
                    await RestAPI.del({ url: `/guilds/${guildId}/members/${uid}`, query: { reason: "cord-kickbots" } });
                    kicked++;
                    await new Promise(r => setTimeout(r, 500));
                } catch { /* */ }
            }
            return reply(ctx.channel.id, `👢 ${kicked}/${bots.length} bot(s) expulsé(s).`);
        }),

        cmd("cord-createchannel", "Créer un salon texte", [{
            name: "nom", description: "Nom", type: ApplicationCommandOptionType.STRING, required: true
        }], async (opts, ctx) => {
            const guildId = ctx.guild?.id;
            if (!guildId) return reply(ctx.channel.id, "Serveur requis.");
            const name = (findOption(opts, "nom", "salon") as string).slice(0, 100);
            try {
                const res = await RestAPI.post({ url: `/guilds/${guildId}/channels`, body: { name, type: 0 } });
            return reply(ctx.channel.id, `Créé <#${res.body.id}>`);
            } catch (e: any) {
            return reply(ctx.channel.id, `Échec : ${e?.body?.message ?? e?.message ?? e}`);
            }
        }),

        cmd("cord-createvoice", "Créer un salon vocal", [{
            name: "nom", description: "Nom", type: ApplicationCommandOptionType.STRING, required: true
        }], async (opts, ctx) => {
            const guildId = ctx.guild?.id;
            if (!guildId) return reply(ctx.channel.id, "Serveur requis.");
            const name = (findOption(opts, "nom", "Vocal") as string).slice(0, 100);
            try {
                const res = await RestAPI.post({ url: `/guilds/${guildId}/channels`, body: { name, type: 2 } });
            return reply(ctx.channel.id, `Vocal créé <#${res.body.id}>`);
            } catch (e: any) {
            return reply(ctx.channel.id, `Échec : ${e?.body?.message ?? e?.message ?? e}`);
            }
        }),

        cmd("cord-createrole", "Créer un rôle", [
            { name: "nom", description: "Nom", type: ApplicationCommandOptionType.STRING, required: true },
            { name: "couleur", description: "Hex #rrggbb", type: ApplicationCommandOptionType.STRING, required: false }
        ], async (opts, ctx) => {
            const guildId = ctx.guild?.id;
            if (!guildId) return reply(ctx.channel.id, "Serveur requis.");
            const name = findOption(opts, "nom", "role") as string;
            const hex = (findOption(opts, "couleur", "") as string).replace("#", "");
            const color = /^[0-9a-fA-F]{6}$/.test(hex) ? parseInt(hex, 16) : 0;
            try {
                const res = await RestAPI.post({ url: `/guilds/${guildId}/roles`, body: { name, color } });
            return reply(ctx.channel.id, `Rôle **${res.body.name}** créé (\`${res.body.id}\`).`);
            } catch (e: any) {
            return reply(ctx.channel.id, `Échec : ${e?.body?.message ?? e?.message ?? e}`);
            }
        }),

        cmd("cord-createwebhook", "Créer un webhook sur ce salon", [{
            name: "nom", description: "Nom", type: ApplicationCommandOptionType.STRING, required: true
        }], async (opts, ctx) => {
            const name = findOption(opts, "nom", "Webhook") as string;
            try {
                const res = await RestAPI.post({
                    url: `/channels/${ctx.channel.id}/webhooks`,
                    body: { name }
                });
            return reply(ctx.channel.id, `Webhook créé · URL (garde-la privée) :\n||${res.body.url}||`);
            } catch (e: any) {
            return reply(ctx.channel.id, `Échec : ${e?.body?.message ?? e?.message ?? e}`);
            }
        }),

        // ── Status / settings ─────────────────────────────────
        cmd("cord-status", "Statut Discord (online/idle/dnd/invisible)", [{
            name: "status", description: "Statut", type: ApplicationCommandOptionType.STRING, required: true,
            choices: [
                { name: "online", value: "online", label: "En ligne" },
                { name: "idle", value: "idle", label: "Inactif" },
                { name: "dnd", value: "dnd", label: "Ne pas déranger" },
                { name: "invisible", value: "invisible", label: "Invisible" }
            ]
        }], async (opts, ctx) => {
            const status = findOption(opts, "status", "online") as string;
            try {
                if (typeof StatusModule?.setStatus === "function") StatusModule.setStatus(status);
                else await RestAPI.patch({ url: "/users/@me/settings", body: { status } });
            return reply(ctx.channel.id, `Statut → **${status}**`);
            } catch (e: any) {
            return reply(ctx.channel.id, `Échec : ${e?.message ?? e}`);
            }
        }),

        cmd("cord-customstatus", "Statut personnalisé (texte)", [
            { name: "texte", description: "Texte (vide = clear)", type: ApplicationCommandOptionType.STRING, required: false }
        ], async (opts, ctx) => {
            const text = (findOption(opts, "texte", "") as string).trim();
            try {
                if (CustomStatusSettings?.updateSetting) {
                    await CustomStatusSettings.updateSetting(
                        text ? { text, emojiName: "", emojiId: "0", expiresAtMs: "0" } as any : null
                    );
                } else {
                    await RestAPI.patch({
                        url: "/users/@me/settings",
                        body: { custom_status: text ? { text } : null }
                    });
                }
            return reply(ctx.channel.id, text ? `Custom status : **${text}**` : "Custom status effacé.");
            } catch (e: any) {
            return reply(ctx.channel.id, `Échec : ${e?.message ?? e}`);
            }
        }),

        cmd("cord-language", "Langue des messages Cord", [{
            name: "lang", description: "fr / en", type: ApplicationCommandOptionType.STRING, required: true,
            choices: [
                { name: "fr", value: "fr", label: "Français" },
                { name: "en", value: "en", label: "English" }
            ]
        }], async (opts, ctx) => {
            settings.lang = findOption(opts, "lang", "fr") as "fr" | "en";
            await DataStore.set(SETTINGS_KEY, settings);
            return reply(ctx.channel.id, t("Langue : français", "Language: English"));
        }),

        // ── Voice ─────────────────────────────────────────────
        cmd("cord-joinvc", "Rejoindre un salon vocal", [{
            name: "channel", description: "Salon vocal", type: ApplicationCommandOptionType.CHANNEL, required: true
        }], async (opts, ctx) => {
            const id = findOption(opts, "channel") as string;
            const ch = ChannelStore.getChannel(id);
            if (!ch || (ch.type !== 2 && ch.type !== 13)) {
                return reply(ctx.channel.id, "Choisis un salon vocal / stage.");
            }
            try {
                ChannelActions.selectVoiceChannel(id);
            return reply(ctx.channel.id, `🔊 Connexion à <#${id}>`);
            } catch (e: any) {
            return reply(ctx.channel.id, `Échec : ${e?.message ?? e}`);
            }
        }),

        cmd("cord-leavevc", "Quitter le vocal", undefined, async (_o, ctx) => {
            try {
                ChannelActions.selectVoiceChannel(null);
            return reply(ctx.channel.id, "Déconnecté du vocal.");
            } catch {
            return reply(ctx.channel.id, "Pas en vocal.");
            }
        }),

        // ── NSFW (gated) ──────────────────────────────────────
        cmd("cord-nsfw", "Image NSFW (nekobot) — salon NSFW / MP seulement", [{
            name: "type", description: "Type", type: ApplicationCommandOptionType.STRING, required: true,
            choices: NSFW_TYPES.slice(0, 25).map(v => ({ name: v, value: v, label: v }))
        }], async (opts, ctx) => {
            const ch = ctx.channel;
            const isDm = !ctx.guild;
            if (!isDm && !ch?.nsfw) {
                return reply(ctx.channel.id, "Salon NSFW (ou MP) uniquement.");
            }
            const type = findOption(opts, "type", "hentai") as string;
            try {
                const res = await fetch(`https://nekobot.xyz/api/image?type=${encodeURIComponent(type)}`);
                const json = await res.json();
                if (!json?.message) return reply(ctx.channel.id, "Pas d'image.");
                return { content: json.message };
            } catch {
            return reply(ctx.channel.id, "API NSFW indisponible.");
            }
        })
    ]
});
