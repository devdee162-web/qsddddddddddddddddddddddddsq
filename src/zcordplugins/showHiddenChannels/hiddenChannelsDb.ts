/*
 * Zcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Base locale passive des salons masqués.
 *
 * Collecte uniquement des métadonnées déjà présentes dans les stores du
 * client (payload GUILD_CREATE) : aucun appel API, aucun trafic réseau
 * supplémentaire. Le contenu des messages n'est JAMAIS concerné — Discord
 * ne le transmet pas aux comptes sans VOIR_LE_CANAL.
 */

import { get as dataStoreGet, set as dataStoreSet } from "@api/DataStore";
import type { Channel } from "@vencord/discord-types";
import {
    ChannelStore,
    FluxDispatcher,
    GuildMemberStore,
    GuildRoleStore,
    GuildStore,
    PermissionsBits,
    SnowflakeUtils,
    UserStore
} from "@webpack/common";

import plugin, { settings } from ".";

const DB_KEY = "zcord-shc-hidden-channels-db";
const SCAN_DEBOUNCE_MS = 1500;
const INITIAL_SCAN_DELAY_MS = 5000;
const SCAN_INTERVAL_MS = 15 * 60 * 1000;

const TRACKED_EVENTS = [
    "CONNECTION_OPEN",
    "GUILD_CREATE",
    "GUILD_UPDATE",
    "GUILD_DELETE",
    "CHANNEL_CREATE",
    "CHANNEL_UPDATE",
    "CHANNEL_DELETE",
    "GUILD_ROLE_UPDATE"
] as const;

export interface KnownEntity {
    id: string;
    name: string;
}

export interface HiddenChannelRecord {
    id: string;
    name: string;
    type: number;
    topic: string | null;
    parentId: string | null;
    position: number;
    nsfw: boolean;
    slowmode: number;
    /** Décodé depuis l'ID snowflake du salon */
    createdTimestamp: number;
    lastMessageId: string | null;
    /** Décodé depuis l'ID snowflake du dernier message */
    lastMessageTimestamp: number;
    allowedRoles: KnownEntity[];
    deniedRoles: KnownEntity[];
    allowedUsers: KnownEntity[];
    deniedUsers: KnownEntity[];
    firstSeen: number;
    lastSeen: number;
}

export interface DbGuild {
    id: string;
    name: string;
    channels: Record<string, HiddenChannelRecord>;
}

export interface HiddenChannelsDb {
    version: 1;
    updatedAt: number;
    scanCount: number;
    guilds: Record<string, DbGuild>;
}

export interface ScanResult {
    ok: boolean;
    total: number;
    guilds: number;
    updatedAt: number;
}

function makeEmptyDb(): HiddenChannelsDb {
    return { version: 1, updatedAt: 0, scanCount: 0, guilds: {} };
}

let db: HiddenChannelsDb = makeEmptyDb();
let started = false;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let intervalTimer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

export function getDb(): HiddenChannelsDb {
    return db;
}

export function getDbStats() {
    const guilds = Object.values(db.guilds);
    return {
        guildCount: guilds.length,
        channelCount: guilds.reduce((n, g) => n + Object.keys(g.channels).length, 0),
        updatedAt: db.updatedAt,
        scanCount: db.scanCount
    };
}

/** Abonne un listener aux mises à jour de la base. Retourne la fonction de désabonnement. */
export function subscribeDb(cb: () => void) {
    listeners.add(cb);
    return () => { listeners.delete(cb); };
}

function notify() {
    for (const cb of [...listeners]) {
        try { cb(); } catch { /* ignore */ }
    }
}

function extractTimestamp(id: string): number {
    try {
        return SnowflakeUtils.extractTimestamp(id);
    } catch {
        return 0;
    }
}

function resolveOverwrites(channel: Channel, guildId: string): Pick<
    HiddenChannelRecord,
    "allowedRoles" | "deniedRoles" | "allowedUsers" | "deniedUsers"
> {
    const allowedRoles: KnownEntity[] = [];
    const deniedRoles: KnownEntity[] = [];
    const allowedUsers: KnownEntity[] = [];
    const deniedUsers: KnownEntity[] = [];

    const overwrites: Record<string, any> = (channel as any).permissionOverwrites ?? {};
    let roles: Record<string, { name?: string; }> = {};
    try {
        roles = GuildRoleStore.getRolesSnapshot(guildId) ?? {};
    } catch { /* roles may be unavailable */ }

    const VIEW = PermissionsBits.VIEW_CHANNEL;

    for (const ow of Object.values(overwrites)) {
        if (ow == null || typeof ow.id !== "string") continue;

        let allow = 0n;
        let deny = 0n;
        try { allow = BigInt(ow.allow ?? 0); } catch { /* keep 0 */ }
        try { deny = BigInt(ow.deny ?? 0); } catch { /* keep 0 */ }
        if (allow === 0n && deny === 0n) continue;

        // Classement selon VOIR_LE_CANAL d'abord, sinon selon le sens global
        let allowed: boolean;
        if ((deny & VIEW) !== 0n) allowed = false;
        else if ((allow & VIEW) !== 0n) allowed = true;
        else allowed = allow > 0n;

        const isMember = ow.type === 1 || ow.type === "member";
        if (isMember) {
            let name = ow.id;
            try {
                const member = GuildMemberStore.getMember(guildId, ow.id);
                const user = UserStore.getUser(ow.id);
                name = member?.nick || user?.globalName || user?.username || ow.id;
            } catch { /* unresolved */ }
            (allowed ? allowedUsers : deniedUsers).push({ id: ow.id, name });
        } else {
            const name = roles[ow.id]?.name ?? (ow.id === guildId ? "@everyone" : ow.id);
            (allowed ? allowedRoles : deniedRoles).push({ id: ow.id, name });
        }
    }

    return { allowedRoles, deniedRoles, allowedUsers, deniedUsers };
}

function buildRecord(channel: Channel, guildId: string, now: number, prev?: HiddenChannelRecord): HiddenChannelRecord {
    const c = channel as any;
    const id: string = c.id;
    const lastMessageId: string | null = c.lastMessageId ?? null;

    let overwrites: Pick<HiddenChannelRecord, "allowedRoles" | "deniedRoles" | "allowedUsers" | "deniedUsers"> = {
        allowedRoles: [],
        deniedRoles: [],
        allowedUsers: [],
        deniedUsers: []
    };
    try {
        overwrites = resolveOverwrites(channel, guildId);
    } catch (e) {
        console.error("[SHC/DB] overwrites failed for", id, e);
    }

    return {
        id,
        name: c.name ?? "#",
        type: Number(c.type ?? 0),
        topic: c.topic ?? c.topic_ ?? null,
        parentId: c.parentId ?? c.parent_id ?? null,
        position: Number(c.position ?? c.position_ ?? 0),
        nsfw: Boolean(c.nsfw ?? c.nsfw_ ?? false),
        slowmode: Number(c.rateLimitPerUser ?? c.rateLimitPerUser_ ?? 0),
        createdTimestamp: extractTimestamp(id),
        lastMessageId,
        lastMessageTimestamp: lastMessageId ? extractTimestamp(lastMessageId) : 0,
        ...overwrites,
        firstSeen: prev?.firstSeen ?? now,
        lastSeen: now
    };
}

async function persist() {
    try {
        await dataStoreSet(DB_KEY, db);
    } catch (e) {
        console.error("[SHC/DB] persist failed:", e);
    }
}

/**
 * Re-scan complet (passif) : parcourt les stores en mémoire et persiste la base.
 * Ne déclenche AUCUNE requête réseau.
 */
export function scanNow(): ScanResult {
    const fail: ScanResult = { ok: false, total: 0, guilds: 0, updatedAt: db.updatedAt };
    if (!settings.store.dbEnabled) return fail;

    try {
        const now = Date.now();
        const next: HiddenChannelsDb = {
            version: 1,
            updatedAt: now,
            scanCount: (db.scanCount ?? 0) + 1,
            guilds: {}
        };

        const guilds = GuildStore.getGuilds() ?? {};
        for (const [guildId, guild] of Object.entries<any>(guilds)) {
            const channels = ChannelStore.getMutableGuildChannelsForGuild(guildId);
            if (!channels) continue;

            const hidden: Record<string, HiddenChannelRecord> = {};
            for (const channel of Object.values<Channel>(channels)) {
                const c = channel as any;
                if (channel == null || c?.id == null) continue;

                // Ignorer les threads (les actifs sont livrés séparément)
                const type = Number(c.type);
                if (type === 10 || type === 11 || type === 12) continue;
                try { if (c.isThread?.()) continue; } catch { /* no isThread */ }

                if (!plugin.isHiddenChannel(channel)) continue;

                hidden[c.id] = buildRecord(channel, guildId, now, db.guilds[guildId]?.channels[c.id]);
            }

            if (Object.keys(hidden).length > 0) {
                next.guilds[guildId] = { id: guildId, name: guild?.name ?? guildId, channels: hidden };
            }
        }

        db = next;
        void persist();
        notify();

        return {
            ok: true,
            total: Object.values(db.guilds).reduce((n, g) => n + Object.keys(g.channels).length, 0),
            guilds: Object.keys(db.guilds).length,
            updatedAt: db.updatedAt
        };
    } catch (e) {
        console.error("[SHC/DB] scan failed:", e);
        return fail;
    }
}

function scheduleScan(delay: number) {
    if (!started) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        debounceTimer = null;
        scanNow();
    }, delay);
}

function onStoreEvent() {
    scheduleScan(SCAN_DEBOUNCE_MS);
}

export async function startDb() {
    if (started) return;
    started = true;

    try {
        const stored = await dataStoreGet<HiddenChannelsDb>(DB_KEY);
        if (stored && typeof stored === "object" && stored.guilds) {
            db = { ...makeEmptyDb(), ...stored };
            notify();
        }
    } catch (e) {
        console.error("[SHC/DB] load failed:", e);
    }

    for (const event of TRACKED_EVENTS) {
        try {
            (FluxDispatcher.subscribe as any)(event, onStoreEvent);
        } catch (e) {
            console.error("[SHC/DB] subscribe failed:", event, e);
        }
    }

    intervalTimer = setInterval(() => scheduleScan(0), SCAN_INTERVAL_MS);
    scheduleScan(INITIAL_SCAN_DELAY_MS);
}

export function stopDb() {
    if (!started) return;
    started = false;

    for (const event of TRACKED_EVENTS) {
        try {
            (FluxDispatcher.unsubscribe as any)(event, onStoreEvent);
        } catch { /* ignore */ }
    }

    if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
    }
    if (intervalTimer) {
        clearInterval(intervalTimer);
        intervalTimer = null;
    }
}

/** Exporte la base complète en JSON téléchargeable. Retourne la taille en octets. */
export function exportDbJson(): number {
    const json = JSON.stringify(db, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
    const a = document.createElement("a");
    a.href = url;
    a.download = `salons-masques-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);

    return json.length;
}

export async function clearDb() {
    db = makeEmptyDb();
    try {
        await dataStoreSet(DB_KEY, db);
    } catch (e) {
        console.error("[SHC/DB] clear failed:", e);
    }
    notify();
}
