/*
 * Zcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import type { Activity, ActivityAssets } from "@vencord/discord-types";
import { ActivityFlags, ActivityType } from "@vencord/discord-types/enums";
import { ApplicationAssetUtils, FluxDispatcher } from "@webpack/common";

const logger = new Logger("YTMDesktopRichPresence");
const APP_ID = "861154506544119869";
const SOCKET_ID = "YTMDesktopRichPresence";
const YTM_ICON = "https://www.gstatic.com/youtube/img/branding/favicon/favicon_144x144.png";
const TICK_MS = 20_000;

const DENY = /spotify|itunes|applemusic|vlc|foobar|tidal|deezer|discord|zcord/i;
const ALLOW = /youtube|ytmdesktop|ytm|chrome|msedge|brave|opera|chromium/i;

function native() {
    const n = VencordNative.pluginHelpers?.YTMDesktopRichPresence
        ?? VencordNative.pluginHelpers?.ytmDesktopRichPresence;
    if (!n?.getSmtcSessions) throw new Error("Native YTM manquant — rebuildStandalone");
    return n as PluginNative<typeof import("./native")>;
}

const settings = definePluginSettings({
    showButton: {
        description: 'Bouton "Play on YouTube Music"',
        type: OptionType.BOOLEAN,
        default: true,
    },
    showWhenPaused: {
        description: "Afficher en pause",
        type: OptionType.BOOLEAN,
        default: true,
    },
});

const assetCache = new Map<string, string>();
let lastFp = "";
let lastActivity: Activity | null = null;
let emptyStreak = 0;
let busy = false;
let smallIcon: string | undefined;
let interval: ReturnType<typeof setInterval> | undefined;
let onVis: (() => void) | undefined;

function setActivity(activity: Activity | null) {
    FluxDispatcher.dispatch({ type: "LOCAL_ACTIVITY_UPDATE", activity, socketId: SOCKET_ID });
    lastActivity = activity;
}

async function asset(url: string): Promise<string | undefined> {
    const hit = assetCache.get(url);
    if (hit) return hit;
    try {
        const id = (await ApplicationAssetUtils.fetchAssetIds(APP_ID, [url]))[0];
        if (id) assetCache.set(url, id);
        return id;
    } catch {
        return undefined;
    }
}

/** Chat focus = skip updates only (no IPC / no kill worker). */
function chatBusy(): boolean {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return false;
    return el.isContentEditable
        || el.getAttribute("role") === "textbox"
        || !!el.closest?.('[data-slate-editor="true"], [class*="textArea"], [role="textbox"]');
}

async function tick() {
    if (busy || chatBusy() || document.hidden) return;
    busy = true;
    try {
        const n = native();
        const res = await n.getSmtcSessions();
        if (chatBusy()) return;

        const sessions = (res.sessions || []).filter(s => s.title && ALLOW.test(s.app) && !DENY.test(s.app));
        const pick = sessions.find(s => /playing/i.test(s.status))
            || sessions.find(s => /paused/i.test(s.status));

        if (!pick) {
            if (++emptyStreak >= 3 && lastActivity) {
                lastFp = "";
                setActivity(null);
            }
            return;
        }
        emptyStreak = 0;

        const playing = /playing/i.test(pick.status);
        if (!playing && !settings.store.showWhenPaused) {
            setActivity(null);
            return;
        }

        const fp = `${pick.title}\0${pick.artist}\0${playing ? 1 : 0}`;
        if (fp === lastFp && lastActivity) return;

        let artUrl: string | undefined;
        let album = pick.album || undefined;
        try {
            const cover = await n.lookupCoverArt({ title: pick.title, artist: pick.artist, album: pick.album });
            if (chatBusy()) return;
            if (cover.ok && cover.artUrl) {
                artUrl = cover.artUrl;
                album ||= cover.album;
            }
        } catch { /* */ }

        const assets: ActivityAssets = {};
        if (artUrl) {
            const large = await asset(artUrl);
            if (large) {
                assets.large_image = large;
                assets.large_text = album || pick.artist || "YouTube Music";
            }
        }
        if (!smallIcon) smallIcon = await asset(YTM_ICON);
        if (smallIcon) {
            assets.small_image = smallIcon;
            assets.small_text = "YouTube Music";
        }

        const buttons = settings.store.showButton ? ["Play on YouTube Music"] : undefined;
        const activity: Activity = {
            application_id: APP_ID,
            name: "YouTube Music",
            details: pick.title,
            state: pick.artist || "YouTube Music",
            assets: Object.keys(assets).length ? assets : undefined,
            type: ActivityType.LISTENING,
            flags: ActivityFlags.INSTANCE,
            buttons,
            metadata: buttons ? { button_urls: ["https://music.youtube.com/"] } : undefined,
        };

        if (playing && pick.duration > 0) {
            const start = Date.now() - Math.max(0, pick.position) * 1000;
            activity.timestamps = { start, end: start + pick.duration * 1000 };
        }

        if (chatBusy()) return;
        lastFp = fp;
        setActivity(activity);
    } catch (e) {
        logger.error(e);
    } finally {
        busy = false;
    }
}

export default definePlugin({
    name: "YTMDesktopRichPresence",
    description: "YouTube Music Rich Presence (Windows Now Playing + pochette).",
    authors: [{ name: "Zcord", id: 0n }],
    tags: ["Activity", "Media", "YouTube", "Music"],
    enabledByDefault: true,
    settings,

    async start() {
        lastFp = "";
        lastActivity = null;
        emptyStreak = 0;
        busy = false;
        try { await native().initSmtcWorker?.(); } catch (e) { logger.warn(e); }
        const run = () => { if (!chatBusy() && !document.hidden) tick(); };
        onVis = run;
        run();
        interval = setInterval(run, TICK_MS);
        document.addEventListener("visibilitychange", onVis);
    },

    stop() {
        if (interval) clearInterval(interval);
        interval = undefined;
        if (onVis) {
            document.removeEventListener("visibilitychange", onVis);
            onVis = undefined;
        }
        try { native().shutdownSmtcWorker?.(); } catch { /* */ }
        lastFp = "";
        setActivity(null);
    },
});
