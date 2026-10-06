/*
 * Zcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { ChatBarButton } from "@api/ChatButtons";
import { definePluginSettings } from "@api/Settings";
import { tPlugin as t } from "@api/pluginI18n";
import { getUserSettingLazy } from "@api/UserSettings";
import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { Flex } from "@components/Flex";
import { settings as musicControlsSettings } from "@zcordplugins/musicControls/settings";
import { getLyrics } from "@zcordplugins/musicControls/spotify/lyrics/api";
import type { SyncedLyric } from "@zcordplugins/musicControls/spotify/lyrics/providers/types";
import { SpotifyStore as SpotifyPlayerStore } from "@zcordplugins/musicControls/spotify/SpotifyStore";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType, type PluginNative } from "@utils/types";
import { chooseFile } from "@utils/web";
import type { Channel, SpotifyTrack } from "@vencord/discord-types";
import { findComponentByCodeLazy } from "@webpack";
import { Alerts, ChannelStore, Clickable, EmojiStore, Popout, SelectedChannelStore, showToast, SpotifyStore as DiscordSpotifyStore, TextArea, TextInput, Toasts, useRef, useState, UserStore, useStateFromStores } from "@webpack/common";

interface CustomStatusSetting {
    createdAtMs?: string;
    emojiId: string;
    emojiName: string;
    expiresAtMs: string;
    text: string;
}

interface SpotifyPlayerState {
    isPlaying?: boolean;
    position?: number;
    track: SpotifyTrack | null;
}

interface StatusEmoji {
    emojiId: string;
    emojiName: string;
}

interface SpotifyLyricMatch {
    currentIndex?: number;
    nextIndex?: number;
    rawIndex: number;
    staleIndex?: number;
}

interface AccountStatusState {
    emojis?: string;
    phrases?: string;
    sourceFileName?: string;
}

interface StatusUpdate {
    errorMessage: string;
    spotify?: {
        clearStale?: boolean;
        lyricIndex: number;
        timeline: number;
        trackId: string;
    };
    value: CustomStatusSetting;
}

interface EmojiSelectPayload {
    animated?: boolean;
    id?: string | null;
    name?: string | null;
    optionallyDiverseSequence?: string;
}

interface ReactionEmojiPickerProps {
    channel?: Channel | null;
    closePopout(): void;
    onSelectEmoji(selection: {
        emoji: EmojiSelectPayload | null;
        willClose: boolean;
    }): void;
    pickerIntention?: number;
}

const ACCOUNT_SETTING_KEYS: "accountStates"[] = ["accountStates"];
const CUSTOM_EMOJI_REGEX = /^<a?:([\w-]+):(\d+)>$/;
const SHORTCODE_EMOJI_REGEX = /^:([\w+-]+):$/;
const INLINE_SHORTCODE_REGEX = /:([\w+-]+):/g;
const EMOJI_INTENTION = { STATUS: 1, CHAT: 3 } as const;
/** Common unicode shortcodes used in status phrases */
const DISABLED_PHRASE_PREFIX = "[off] ";
const UNICODE_SHORTCODES: Record<string, string> = {
    ring: "💍",
    heart: "❤️",
    hearts: "💕",
    sparkles: "✨",
    fire: "🔥",
    kiss: "💋",
    smile: "😊",
};
const SPOTIFY_LYRIC_STALE_AFTER_SECONDS = 8;
const SPOTIFY_LYRICS_END_GRACE_MS = 15_000;
const logger = new Logger("StatusCycler");
const CustomStatusSettings = getUserSettingLazy<CustomStatusSetting | null>("status", "customStatus");
const Native = VencordNative?.pluginHelpers?.StatusCycler as PluginNative<typeof import("./native")> | undefined;
const ReactionEmojiPicker = findComponentByCodeLazy<ReactionEmojiPickerProps>(
    "showAddEmojiButton:",
    "pickerIntention:",
    "messageId:"
);

/** Discord settings rate limit ~1/15s; stay >= 10s and add jitter to avoid bans / frozen presence. */
const MIN_ROTATION_SECONDS = 10;
const MAX_BACKOFF_MS = 120_000;
/** Empty by default — each user configures their own phrases/emojis in settings. */
const DEFAULT_PHRASES = "";
const DEFAULT_EMOJIS = "";

let active = false;
let rotationTimeoutId: ReturnType<typeof setTimeout> | undefined;
let lyricsTimeoutId: ReturnType<typeof setTimeout> | undefined;
let loadingSpotifyTrackId: string | undefined;
let spotifyLyrics: SyncedLyric[] = [];
let spotifyLyricsTrackId: string | undefined;
let spotifyOverrideActive = false;
let spotifyPlaybackActive = false;
let spotifyPlaybackTrackId: string | undefined;
let spotifyTimeline = 0;
let lastSpotifyLyricIndex: number | undefined;
let pendingSpotifyBackwardLyricIndex: number | undefined;
let spotifyBackwardConfirmations = 0;
let nextSpotifyLyricsUpdateAt = 0;
let pendingStatusUpdate: StatusUpdate | undefined;
let statusUpdateInFlight = false;
let lastSpotifyStatusText: string | undefined;
let lastAppliedStatusKey: string | undefined;
let consecutiveStatusFailures = 0;
const phraseIndexes = new Map<string, number>();
const emojiIndexes = new Map<string, number>();

function getCurrentUserId() {
    return UserStore.getCurrentUser()?.id;
}

function getAccountKey() {
    return getCurrentUserId() ?? "default";
}

function getAccountState() {
    const userId = getCurrentUserId();
    return userId ? settings.plain.accountStates?.[userId] : undefined;
}

function setAccountState(update: AccountStatusState) {
    const userId = getCurrentUserId();

    if (!userId) {
        if (update.phrases !== undefined) settings.store.phrases = update.phrases;
        if (update.emojis !== undefined) settings.store.emojis = update.emojis;
        if ("sourceFileName" in update) settings.store.sourceFileName = update.sourceFileName;
        return;
    }

    const accountStates = settings.plain.accountStates ?? {};

    settings.store.accountStates = {
        ...accountStates,
        [userId]: {
            ...accountStates[userId],
            ...update
        }
    };
}

function getAccountPhrases() {
    return getAccountState()?.phrases ?? settings.store.phrases;
}

function getAccountEmojis() {
    const fromAccount = getAccountState()?.emojis;
    if (typeof fromAccount === "string" && fromAccount.trim()) return fromAccount;
    return settings.store.emojis ?? "";
}

function getSeededIndex(seed: string, length: number) {
    let hash = 0;

    for (let i = 0; i < seed.length; i++) {
        hash = (hash * 31 + seed.charCodeAt(i)) % length;
    }

    return hash;
}

function takeNextIndex(indexes: Map<string, number>, length: number, seed: string) {
    const key = getAccountKey();
    const index = (indexes.get(key) ?? getSeededIndex(`${key}:${seed}`, length)) % length;
    indexes.set(key, (index + 1) % length);
    return index;
}

function resetCurrentIndex(indexes: Map<string, number>) {
    indexes.set(getAccountKey(), 0);
}

interface PhraseItem {
    text: string;
    enabled: boolean;
}

function isRotationEnabled() {
    return settings.store.rotationEnabled !== false;
}

function parsePhraseItems(value = getAccountPhrases()): PhraseItem[] {
    return value.split(/\r?\n|\r/).map(line => {
        const raw = line.trimEnd();
        if (!raw.trim()) return null;
        const disabled = raw.startsWith(DISABLED_PHRASE_PREFIX);
        const text = (disabled ? raw.slice(DISABLED_PHRASE_PREFIX.length) : raw).trim();
        if (!text) return null;
        return { text, enabled: !disabled };
    }).filter((item): item is PhraseItem => item != null);
}

function serializePhraseItems(items: PhraseItem[]) {
    return items.map(item => item.enabled ? item.text : `${DISABLED_PHRASE_PREFIX}${item.text}`).join("\n");
}

function savePhraseItems(items: PhraseItem[]) {
    setAccountState({
        phrases: serializePhraseItems(items),
        sourceFileName: undefined
    });
    restartPhraseRotation();
}

function expandPhraseShortcodes(text: string) {
    return text.replace(INLINE_SHORTCODE_REGEX, (full, name: string) => {
        const key = name.toLowerCase();
        if (UNICODE_SHORTCODES[key]) return UNICODE_SHORTCODES[key];
        // Keep custom shortcodes out of status text — they belong in the emoji field
        return full;
    });
}

function findCustomEmojiByName(name: string) {
    const lower = name.toLowerCase();
    const byName = EmojiStore?.getByName?.(name) ?? EmojiStore?.getByName?.(lower);
    if (byName?.id) return byName;

    const customMap = EmojiStore?.getCustomEmoji?.() ?? {};
    if (customMap[name]?.id) return customMap[name];
    if (customMap[lower]?.id) return customMap[lower];

    const fromValues = Object.values(customMap).find(
        (e: any) => String(e?.name ?? "").toLowerCase() === lower
    );
    if (fromValues?.id) return fromValues;

    try {
        const grouped = EmojiStore?.getGroupedCustomEmoji?.() ?? {};
        for (const list of Object.values(grouped)) {
            const hit = (list as any[])?.find?.(e => String(e?.name ?? "").toLowerCase() === lower);
            if (hit?.id) return hit;
        }
    } catch { /* ignore */ }

    return null;
}

function resolveStatusEmoji(raw: string): StatusEmoji | null {
    const emoji = raw.trim();
    if (!emoji) return null;

    const customMarkup = emoji.match(CUSTOM_EMOJI_REGEX) || emoji.match(/^<(a)?:([\w-]+):(\d+)>$/);
    if (customMarkup) {
        // Support both <a?:name:id> (2 groups) and <(a)?:name:id> (3 groups)
        const name = customMarkup[2] && customMarkup[3] ? customMarkup[2] : customMarkup[1];
        const id = customMarkup[3] ?? customMarkup[2];
        return { emojiId: id, emojiName: name };
    }

    const shortcode = emoji.match(SHORTCODE_EMOJI_REGEX);
    if (shortcode) {
        const name = shortcode[1];
        const fromStore = findCustomEmojiByName(name);
        if (fromStore?.id) {
            return { emojiId: String(fromStore.id), emojiName: String(fromStore.name ?? name) };
        }
        logger.warn(`Custom emoji :${name}: introuvable — choisis-le via le picker (<:nom:id>)`);
        return null;
    }

    const unicodeKey = emoji.toLowerCase().replace(/^:|:$/g, "");
    if (UNICODE_SHORTCODES[unicodeKey]) {
        return { emojiId: "0", emojiName: UNICODE_SHORTCODES[unicodeKey] };
    }

    return { emojiId: "0", emojiName: emoji };
}

function getPhrases(value = getAccountPhrases()) {
    return parsePhraseItems(value)
        .filter(item => item.enabled)
        .map(item => expandPhraseShortcodes(item.text))
        .filter(Boolean);
}

function getEmojis(value = getAccountEmojis()): StatusEmoji[] {
    return value
        .split(/\r?\n|\r/)
        .map(resolveStatusEmoji)
        .filter((emoji): emoji is StatusEmoji => !!emoji?.emojiName);
}

function formatPickerEmoji(emoji: EmojiSelectPayload | null) {
    if (!emoji) return null;
    if (emoji.id && emoji.name) {
        return `<${emoji.animated ? "a" : ""}:${emoji.name}:${emoji.id}>`;
    }
    return emoji.optionallyDiverseSequence?.trim() || emoji.name?.trim() || null;
}

function appendToLastLine(text: string, piece: string) {
    const lines = text.split(/\r?\n/);
    if (!lines.length || (lines.length === 1 && !lines[0])) return piece;
    const last = lines[lines.length - 1];
    lines[lines.length - 1] = `${last}${piece}`;
    return lines.join("\n");
}

function DiscordEmojiPickerButton({
    onSelect,
    intention = EMOJI_INTENTION.CHAT,
    label,
}: {
    onSelect(value: string): void;
    intention?: number;
    label?: string;
}) {
    const triggerRef = useRef<HTMLDivElement>(null);
    const channel = useStateFromStores([SelectedChannelStore, ChannelStore], () => {
        const channelId = SelectedChannelStore.getChannelId();
        return channelId ? ChannelStore.getChannel(channelId) : null;
    });

    return (
        <Popout
            position="top"
            align="left"
            targetElementRef={triggerRef}
            renderPopout={({ closePopout }) => (
                <ReactionEmojiPicker
                    channel={channel}
                    closePopout={closePopout}
                    pickerIntention={intention}
                    onSelectEmoji={({ emoji, willClose }) => {
                        const selected = formatPickerEmoji(emoji);
                        if (selected) onSelect(selected);
                        if (willClose) closePopout();
                    }}
                />
            )}
        >
            {popoutProps => (
                <div {...popoutProps} ref={triggerRef}>
                    <Clickable
                        aria-label={label ?? t("Ajouter un emoji Discord")}
                        className="vc-status-cycler-emoji-button"
                    >
                        😀
                    </Clickable>
                </div>
            )}
        </Popout>
    );
}

function phrasesHavePriority() {
    return settings.plain.prioritizePhrases && getPhrases().length > 0;
}

function setNextSpotifyLyricsUpdate() {
    const delay = settings.plain.spotifyLyricsUpdateDelay * 1_000;
    const variation = settings.plain.humanizeSpotifyLyricsDelay ? Math.random() * delay * 0.35 : 0;
    nextSpotifyLyricsUpdateAt = Date.now() + delay + variation;
}

function restartSpotifyLyricsDelay() {
    nextSpotifyLyricsUpdateAt = 0;
    scheduleSpotifyLyric();
}

function getSpotifyPositionMs(reportedPosition?: number) {
    if (reportedPosition !== undefined) return reportedPosition;
    if (SpotifyPlayerStore.track?.id === spotifyPlaybackTrackId) return SpotifyPlayerStore.position;
    const activity = DiscordSpotifyStore?.getActivity?.();

    return activity && DiscordSpotifyStore?.getTrack?.()?.id === spotifyPlaybackTrackId
        ? Math.max(0, Date.now() - activity.timestamps.start)
        : 0;
}

function getSpotifyPosition(reportedPosition?: number) {
    return (getSpotifyPositionMs(reportedPosition) + (musicControlsSettings.plain.lyricDelay ?? 0)) / 1_000;
}

function getSpotifyLyricMatch(position: number): SpotifyLyricMatch {
    let left = 0;
    let right = spotifyLyrics.length - 1;
    let currentIndex: number | undefined;

    while (left <= right) {
        const mid = Math.floor((left + right) / 2);
        const lyric = spotifyLyrics[mid];
        const nextLyric = spotifyLyrics[mid + 1];

        if (lyric.time <= position && (!nextLyric || nextLyric.time > position)) {
            currentIndex = mid;
            break;
        }

        if (lyric.time > position) {
            right = mid - 1;
        } else {
            left = mid + 1;
        }
    }

    const nextIndex = (currentIndex !== undefined ? currentIndex + 1 : left);
    const currentLyric = currentIndex !== undefined ? spotifyLyrics[currentIndex] : undefined;

    if (currentIndex !== undefined && currentLyric && position - currentLyric.time > SPOTIFY_LYRIC_STALE_AFTER_SECONDS) {
        return {
            currentIndex: undefined,
            nextIndex: nextIndex < spotifyLyrics.length ? nextIndex : undefined,
            rawIndex: currentIndex,
            staleIndex: currentIndex
        };
    }

    return {
        currentIndex,
        nextIndex: nextIndex < spotifyLyrics.length ? nextIndex : undefined,
        rawIndex: currentIndex ?? -1,
        staleIndex: undefined
    };
}

function isCurrentSpotifyUpdate(update: NonNullable<StatusUpdate["spotify"]>, text: string) {
    if (!active || !spotifyOverrideActive || !spotifyPlaybackActive || update.trackId !== spotifyPlaybackTrackId || update.timeline !== spotifyTimeline) return false;
    return true;
}

function statusKey(value: CustomStatusSetting) {
    return `${value.text}\0${value.emojiId}\0${value.emojiName}`;
}

function getSafeRotationMs() {
    const seconds = Math.max(MIN_ROTATION_SECONDS, Number(settings.store.rotationInterval) || MIN_ROTATION_SECONDS);
    // ±20% jitter so the cycle does not look mechanical / bot-like
    const jitter = 0.8 + Math.random() * 0.4;
    const backoff = consecutiveStatusFailures
        ? Math.min(MAX_BACKOFF_MS, MIN_ROTATION_SECONDS * 1_000 * 2 ** consecutiveStatusFailures)
        : 0;
    return Math.round(seconds * 1_000 * jitter) + backoff;
}

function clearRotationTimer() {
    if (rotationTimeoutId !== undefined) {
        clearTimeout(rotationTimeoutId);
        rotationTimeoutId = undefined;
    }
}

function scheduleNextRotation(immediate = false) {
    clearRotationTimer();
    if (!active || !isRotationEnabled() || spotifyOverrideActive) return;
    if (!getPhrases().length && !getEmojis().length) return;

    const delay = immediate ? 0 : getSafeRotationMs();
    rotationTimeoutId = setTimeout(() => {
        rotationTimeoutId = undefined;
        applyNextStatus();
        if (active && !spotifyOverrideActive) scheduleNextRotation();
    }, delay);
}

function updateStatus(update: StatusUpdate) {
    if (statusUpdateInFlight || !CustomStatusSettings) {
        pendingStatusUpdate = update;
        return;
    }

    if (update.spotify && !isCurrentSpotifyUpdate(update.spotify, update.value.text)) {
        if (pendingStatusUpdate) {
            const next = pendingStatusUpdate;
            pendingStatusUpdate = undefined;
            updateStatus(next);
        }
        return;
    }

    const key = statusKey(update.value);
    if (!update.spotify?.clearStale && key === lastAppliedStatusKey) {
        return;
    }

    statusUpdateInFlight = true;
    pendingStatusUpdate = undefined;

    if (update.spotify && !isCurrentSpotifyUpdate(update.spotify, update.value.text)) {
        statusUpdateInFlight = false;
        if (pendingStatusUpdate) updateStatus(pendingStatusUpdate);
        return;
    }

    if (update.spotify) {
        lastSpotifyLyricIndex = update.spotify.lyricIndex;
        lastSpotifyStatusText = update.spotify.clearStale ? undefined : update.value.text;
    }

    void CustomStatusSettings.updateSetting(update.value)
        .then(() => {
            consecutiveStatusFailures = 0;
            lastAppliedStatusKey = key;
        })
        .catch(error => {
            consecutiveStatusFailures = Math.min(6, consecutiveStatusFailures + 1);
            logger.error(update.errorMessage, error);
            // Soft backoff on next tick — never force reconnect / gateway spam
            if (active && !spotifyOverrideActive) scheduleNextRotation();
        })
        .finally(() => {
            statusUpdateInFlight = false;
            if (pendingStatusUpdate) updateStatus(pendingStatusUpdate);
        });
}

function clearStaleSpotifyLyricStatus(trackId: string, lyricIndex: number) {
    if (!CustomStatusSettings || !lastSpotifyStatusText || lastSpotifyLyricIndex !== lyricIndex) return;

    const current = CustomStatusSettings.getSetting();
    if (current?.text !== lastSpotifyStatusText) return;

    updateStatus({
        errorMessage: "Could not clear the stale Spotify lyric status.",
        spotify: {
            clearStale: true,
            lyricIndex,
            timeline: spotifyTimeline,
            trackId
        },
        value: {
            text: "",
            expiresAtMs: "0",
            emojiId: current.emojiId,
            emojiName: current.emojiName,
            createdAtMs: String(Date.now())
        }
    });
}

function applyNextStatus() {
    if (!active || !isRotationEnabled() || spotifyOverrideActive) return;

    const phrases = getPhrases();
    const emojis = getEmojis();
    if ((!phrases.length && !emojis.length) || !CustomStatusSettings) return;

    let text = "";
    // Always prefer configured status emoji (never keep a stale empty emoji)
    let emojiId = "0";
    let emojiName = "";

    if (phrases.length) {
        const nextIndex = takeNextIndex(phraseIndexes, phrases.length, "phrases");
        text = phrases[nextIndex];
    }

    if (emojis.length) {
        // Single emoji → pin it; multiple → rotate
        const nextEmojiIndex = emojis.length === 1
            ? 0
            : takeNextIndex(emojiIndexes, emojis.length, "emojis");
        ({ emojiId, emojiName } = emojis[nextEmojiIndex]);
    }

    setNextSpotifyLyricsUpdate();

    logger.info("Status →", { text, emojiName, emojiId });

    updateStatus({
        errorMessage: "Could not update the custom status.",
        value: {
            text: text.slice(0, 128),
            expiresAtMs: "0",
            emojiId: emojiId || "0",
            emojiName: emojiName || "",
            createdAtMs: String(Date.now())
        }
    });
}

function scheduleSpotifyLyric(reportedPosition?: number) {
    if (lyricsTimeoutId !== undefined) clearTimeout(lyricsTimeoutId);
    lyricsTimeoutId = undefined;

    const trackId = spotifyPlaybackTrackId;
    if (!active || !settings.plain.useSpotifyLyrics || phrasesHavePriority() || !spotifyPlaybackActive || !trackId || spotifyLyricsTrackId !== trackId || !spotifyLyrics.length) return;

    const position = getSpotifyPosition(reportedPosition);
    const match = getSpotifyLyricMatch(position);
    const { currentIndex } = match;

    if (lastSpotifyLyricIndex !== undefined && match.rawIndex < lastSpotifyLyricIndex) {
        if (reportedPosition !== undefined && pendingSpotifyBackwardLyricIndex !== undefined && match.rawIndex >= pendingSpotifyBackwardLyricIndex && match.rawIndex <= pendingSpotifyBackwardLyricIndex + 1) {
            spotifyBackwardConfirmations++;
            pendingSpotifyBackwardLyricIndex = match.rawIndex;
            if (spotifyBackwardConfirmations >= 3) {
                spotifyTimeline++;
                lastSpotifyLyricIndex = undefined;
                lastSpotifyStatusText = undefined;
                pendingSpotifyBackwardLyricIndex = undefined;
                spotifyBackwardConfirmations = 0;
                pendingStatusUpdate = undefined;
            } else {
                return;
            }
        } else {
            if (reportedPosition !== undefined) {
                pendingSpotifyBackwardLyricIndex = match.rawIndex;
                spotifyBackwardConfirmations = 1;
                return;
            } else {
                // We got a backward jump without a reportedPosition (e.g. from a timeout).
                // This could be because SpotifyPlayerStore temporarily lost the track state.
                // Try again in 1 second instead of killing the loop.
                lyricsTimeoutId = setTimeout(scheduleSpotifyLyric, 1_000);
                return;
            }
        }
    } else {
        pendingSpotifyBackwardLyricIndex = undefined;
        spotifyBackwardConfirmations = 0;
    }

    if (match.staleIndex !== undefined) clearStaleSpotifyLyricStatus(trackId, match.staleIndex);

    const text = currentIndex !== undefined ? spotifyLyrics[currentIndex]?.text?.trim() : undefined;
    if (currentIndex !== undefined && text && currentIndex !== lastSpotifyLyricIndex && CustomStatusSettings) {
        const remainingDelay = nextSpotifyLyricsUpdateAt - Date.now();
        if (remainingDelay > 0) {
            lyricsTimeoutId = setTimeout(scheduleSpotifyLyric, remainingDelay);
            return;
        }

        const current = CustomStatusSettings.getSetting();
        let emojiId = current?.emojiId ?? "0";
        let emojiName = current?.emojiName ?? "";
        const emojis = getEmojis();

        if (emojis.length) {
            const nextEmojiIndex = takeNextIndex(emojiIndexes, emojis.length, "emojis");
            ({ emojiId, emojiName } = emojis[nextEmojiIndex]);
        }

        setNextSpotifyLyricsUpdate();

        updateStatus({
            errorMessage: "Could not update the custom status with Spotify lyrics.",
            spotify: {
                lyricIndex: currentIndex,
                timeline: spotifyTimeline,
                trackId
            },
            value: {
                text: text.slice(0, 128),
                expiresAtMs: "0",
                emojiId,
                emojiName,
                createdAtMs: String(Date.now())
            }
        });
    }

    const nextTimes = [
        currentIndex !== undefined ? spotifyLyrics[currentIndex].time + SPOTIFY_LYRIC_STALE_AFTER_SECONDS : undefined,
        match.nextIndex !== undefined ? spotifyLyrics[match.nextIndex].time : undefined
    ].filter((time): time is number => time !== undefined && time > position);
    const nextTime = Math.min(...nextTimes);

    if (Number.isFinite(nextTime)) {
        lyricsTimeoutId = setTimeout(scheduleSpotifyLyric, Math.max(100, (nextTime - position) * 1_000));
    } else {
        lyricsTimeoutId = setTimeout(() => {
            lyricsTimeoutId = undefined;
            spotifyLyrics = [];
            resumePhraseRotation();
        }, SPOTIFY_LYRICS_END_GRACE_MS);
    }
}

function resumePhraseRotation() {
    if (lyricsTimeoutId !== undefined) clearTimeout(lyricsTimeoutId);
    lyricsTimeoutId = undefined;

    if (!spotifyOverrideActive) return;
    spotifyOverrideActive = false;
    spotifyTimeline++;
    lastSpotifyLyricIndex = undefined;
    lastSpotifyStatusText = undefined;
    pendingSpotifyBackwardLyricIndex = undefined;
    spotifyBackwardConfirmations = 0;
    restartRotation();
}

async function startSpotifyLyrics(track: SpotifyTrack, position?: number) {
    if (phrasesHavePriority()) return;

    const trackChanged = spotifyPlaybackTrackId !== track.id;
    spotifyPlaybackActive = true;
    spotifyPlaybackTrackId = track.id;

    if (spotifyLyricsTrackId === track.id && !spotifyLyrics.length) return;

    if (!spotifyOverrideActive || trackChanged) pendingStatusUpdate = undefined;
    spotifyOverrideActive = true;
    clearRotationTimer();

    if (trackChanged) {
        spotifyLyrics = [];
        spotifyLyricsTrackId = undefined;
        spotifyTimeline++;
        lastSpotifyLyricIndex = undefined;
        lastSpotifyStatusText = undefined;
        pendingSpotifyBackwardLyricIndex = undefined;
        spotifyBackwardConfirmations = 0;
        nextSpotifyLyricsUpdateAt = 0;
        if (lyricsTimeoutId !== undefined) clearTimeout(lyricsTimeoutId);
        lyricsTimeoutId = undefined;
    }

    if (spotifyLyricsTrackId === track.id) {
        if (spotifyLyrics.length) {
            scheduleSpotifyLyric(position);
        }
        return;
    }

    if (loadingSpotifyTrackId === track.id) return;
    loadingSpotifyTrackId = track.id;

    const lyricsTrack = {
        ...track,
        album: {
            name: track.album?.name ?? "",
            id: track.album?.id ?? "",
            image: track.album?.image ?? { height: 0, width: 0, url: "" }
        },
        artists: (track.artists || []).map(artist => ({
            id: artist.id ?? "",
            name: artist.name ?? "",
            href: "",
            type: "artist",
            uri: `spotify:artist:${artist.id ?? ""}`
        }))
    };
    const lyricsInfo = await getLyrics(lyricsTrack).catch(error => {
        logger.error("Could not load Spotify lyrics.", error);
        return null;
    });
    if (loadingSpotifyTrackId === track.id) loadingSpotifyTrackId = undefined;

    if (!active || !settings.plain.useSpotifyLyrics || phrasesHavePriority() || !spotifyPlaybackActive || DiscordSpotifyStore?.getTrack?.()?.id !== track.id) return;

    spotifyLyricsTrackId = track.id;
    spotifyLyrics = lyricsInfo?.lyricsVersions[lyricsInfo.useLyric]
        ?.filter(lyric => lyric.text?.trim())
        .sort((a, b) => a.time - b.time) ?? [];

    if (!spotifyLyrics.length) {
        resumePhraseRotation();
        return;
    }

    scheduleSpotifyLyric();
}

function clearCustomStatus() {
    if (!CustomStatusSettings) return;
    updateStatus({
        errorMessage: "Could not clear the custom status.",
        value: {
            text: "",
            expiresAtMs: "0",
            emojiId: "0",
            emojiName: "",
            createdAtMs: String(Date.now())
        }
    });
}

function stopSpotifyLyrics() {
    spotifyPlaybackActive = false;
    loadingSpotifyTrackId = undefined;
    clearCustomStatus();
    resumePhraseRotation();
}

function syncSpotifyLyrics(enabled: boolean) {
    if (!active) return;

    if (!enabled || phrasesHavePriority()) {
        stopSpotifyLyrics();
        return;
    }

    const track = DiscordSpotifyStore?.getTrack?.();
    const activity = DiscordSpotifyStore?.getActivity?.();
    if (!track || !activity) return;

    void startSpotifyLyrics(track, Math.max(0, Date.now() - activity.timestamps.start))
        .catch(error => logger.error("Could not load Spotify lyrics.", error));
}

function setRotationEnabled(enabled: boolean) {
    if (settings.store.rotationEnabled === enabled) {
        if (enabled) restartRotation();
        else clearRotationTimer();
        return;
    }
    settings.store.rotationEnabled = enabled;
}

function restartRotation() {
    if (!active || !isRotationEnabled() || spotifyOverrideActive) return;
    scheduleNextRotation(true);
}

function restartPhraseRotation() {
    resetCurrentIndex(phraseIndexes);
    restartRotation();
    syncSpotifyLyrics(settings.store.useSpotifyLyrics);
}

function restartWithFirstPhrase() {
    setAccountState({ sourceFileName: undefined });
    restartPhraseRotation();
}

function restartWithFirstEmoji() {
    resetCurrentIndex(emojiIndexes);
    restartRotation();
}

async function importPhrases() {
    const file = await chooseFile(".txt,text/plain");
    if (!file) return;

    try {
        const phrases = getPhrases(await file.text());
        if (!phrases.length) {
            showToast(t("The file does not contain any valid phrases."), Toasts.Type.FAILURE);
            return;
        }

        setAccountState({
            phrases: phrases.join("\n"),
            sourceFileName: file.name
        });
        restartPhraseRotation();
        showToast(`${t("Imported")} ${phrases.length} ${phrases.length === 1 ? t("phrase") : t("phrases")} ${t("from")} ${file.name}.`, Toasts.Type.SUCCESS);
    } catch (error) {
        logger.error("Could not read the selected text file.", error);
        showToast(t("Could not read the selected file."), Toasts.Type.FAILURE);
    }
}

function PhrasesSetting() {
    const currentUser = useStateFromStores([UserStore], () => UserStore.getCurrentUser());
    const { accountStates } = settings.use(ACCOUNT_SETTING_KEYS);
    const rawPhrases = currentUser ? accountStates?.[currentUser.id]?.phrases ?? settings.store.phrases : settings.store.phrases;
    const items = parsePhraseItems(rawPhrases);
    const [draft, setDraft] = useState("");

    const updateItem = (index: number, patch: Partial<PhraseItem>) => {
        savePhraseItems(items.map((item, i) => i === index ? { ...item, ...patch } : item));
    };

    const addPhrase = () => {
        const text = draft.trim();
        if (!text) return;
        savePhraseItems([...items, { text, enabled: true }]);
        setDraft("");
    };

    return (
        <Flex flexDirection="column" gap="8px">
            <span>
                {currentUser
                    ? `${t("Phrases de statut pour")} @${currentUser.username}`
                    : t("Phrases de statut pour ce compte")}
                {" — "}
                {t("Activer, désactiver ou supprimer chaque ligne.")}
            </span>
            {items.map((item, index) => (
                <div key={index} className={`vc-status-cycler-phrase-row${item.enabled ? "" : " is-off"}`}>
                    <TextInput
                        value={item.text}
                        onChange={value => updateItem(index, { text: value })}
                    />
                    <Button
                        size="small"
                        variant={item.enabled ? "secondary" : "positive"}
                        onClick={() => updateItem(index, { enabled: !item.enabled })}
                    >
                        {item.enabled ? t("Désactiver") : t("Activer")}
                    </Button>
                    <Button
                        size="small"
                        variant="dangerPrimary"
                        onClick={() => savePhraseItems(items.filter((_, i) => i !== index))}
                    >
                        {t("Supprimer")}
                    </Button>
                    <DiscordEmojiPickerButton
                        label={t("Ajouter un emoji dans la phrase")}
                        onSelect={selected => {
                            if (CUSTOM_EMOJI_REGEX.test(selected)) {
                                const currentEmojis = getAccountEmojis();
                                const nextEmojis = [...currentEmojis.split(/\r?\n|\r/).map(line => line.trim()).filter(Boolean), selected].join("\n");
                                setAccountState({ emojis: nextEmojis });
                                restartWithFirstEmoji();
                                return;
                            }
                            updateItem(index, { text: `${item.text}${selected}` });
                        }}
                    />
                </div>
            ))}
            <Flex alignItems="center" gap="8px">
                <TextInput
                    value={draft}
                    placeholder={t("Nouvelle phrase…")}
                    onChange={setDraft}
                />
                <Button size="small" onClick={addPhrase}>{t("Ajouter")}</Button>
            </Flex>
        </Flex>
    );
}

const SafePhrasesSetting = ErrorBoundary.wrap(PhrasesSetting, { noop: true });

function ImportSetting() {
    const currentUser = useStateFromStores([UserStore], () => UserStore.getCurrentUser());
    const { accountStates } = settings.use(ACCOUNT_SETTING_KEYS);
    const phrases = currentUser ? accountStates?.[currentUser.id]?.phrases ?? settings.store.phrases : settings.store.phrases;
    const sourceFileName = currentUser ? accountStates?.[currentUser.id]?.sourceFileName ?? settings.store.sourceFileName : settings.store.sourceFileName;
    const count = getPhrases(phrases).length;

    return (
        <Flex flexDirection="column" gap="8px">
            <Button onClick={() => void importPhrases()}>{t("Select TXT file")}</Button>
            <span>
                {sourceFileName
                    ? `${sourceFileName}: ${count} ${count === 1 ? t("phrase") : t("phrases")}.`
                    : t("No file selected.")}
            </span>
        </Flex>
    );
}

const SafeImportSetting = ErrorBoundary.wrap(ImportSetting, { noop: true });

function EmojiSetting() {
    const currentUser = useStateFromStores([UserStore], () => UserStore.getCurrentUser());
    const { accountStates } = settings.use(ACCOUNT_SETTING_KEYS);
    const emojis = currentUser ? accountStates?.[currentUser.id]?.emojis ?? settings.store.emojis : settings.store.emojis;

    return (
        <Flex flexDirection="column" gap="8px">
            <span>
                {currentUser
                    ? `${t("Status emojis for")} @${currentUser.username}, ${t("one per line. Unicode, custom and animated Discord emojis are supported.")}`
                    : t("Status emojis for this account, one per line. Unicode, custom and animated Discord emojis are supported.")}
            </span>
            <Flex alignItems="flex-start" gap="8px">
                <TextArea
                    value={emojis}
                    placeholder={"😀\n<:custom:123456789012345678>\n<a:animated:123456789012345678>"}
                    onChange={value => {
                        setAccountState({ emojis: value });
                        restartWithFirstEmoji();
                    }}
                />
                <DiscordEmojiPickerButton
                    intention={EMOJI_INTENTION.CHAT}
                    onSelect={selected => {
                        const nextEmojis = [...emojis.split(/\r?\n|\r/).map(line => line.trim()).filter(Boolean), selected].join("\n");
                        setAccountState({ emojis: nextEmojis });
                        restartWithFirstEmoji();
                    }}
                />
            </Flex>
        </Flex>
    );
}

const SafeEmojiSetting = ErrorBoundary.wrap(EmojiSetting, { noop: true });

function StatusEmojiIcon() {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24">
            <path fill="currentColor" d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2m-3.5 8.25a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5m8.25-1.25a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0M12 17.5c-2.538 0-4.71-1.528-5.708-3.7-.172-.375.086-.8.498-.8h10.42c.412 0 .67.425.498.8C16.71 15.972 14.538 17.5 12 17.5" />
        </svg>
    );
}

function StatusEmojiChatButton({ isMainChat }: { isMainChat: boolean; }) {
    const triggerRef = useRef<HTMLDivElement>(null);
    const { rotationEnabled } = settings.use(["rotationEnabled"]);
    const channel = useStateFromStores([SelectedChannelStore, ChannelStore], () => {
        const channelId = SelectedChannelStore.getChannelId();
        return channelId ? ChannelStore.getChannel(channelId) : null;
    });

    if (!isMainChat) return null;

    return (
        <Popout
            position="top"
            align="right"
            targetElementRef={triggerRef}
            renderPopout={({ closePopout }) => (
                <ReactionEmojiPicker
                    channel={channel}
                    closePopout={closePopout}
                    pickerIntention={EMOJI_INTENTION.CHAT}
                    onSelectEmoji={({ emoji, willClose }) => {
                        const selected = formatPickerEmoji(emoji);
                        if (selected) {
                            if (CUSTOM_EMOJI_REGEX.test(selected)) {
                                const currentEmojis = getAccountEmojis();
                                const nextEmojis = [...currentEmojis.split(/\r?\n|\r/).map(line => line.trim()).filter(Boolean), selected].join("\n");
                                setAccountState({ emojis: nextEmojis });
                                restartWithFirstEmoji();
                            } else {
                                setAccountState({
                                    phrases: appendToLastLine(getAccountPhrases(), selected),
                                    sourceFileName: undefined
                                });
                                restartPhraseRotation();
                            }
                        }
                        if (willClose) closePopout();
                    }}
                />
            )}
        >
            {popoutProps => (
                <div {...popoutProps} ref={triggerRef}>
                    <ChatBarButton
                        tooltip={rotationEnabled ? "Emoji du statut (clic droit = pause)" : "Rotation en pause (clic droit = activer)"}
                        onClick={popoutProps.onClick}
                        onContextMenu={e => {
                            e.preventDefault();
                            setRotationEnabled(!isRotationEnabled());
                        }}
                    >
                        <StatusEmojiIcon />
                    </ChatBarButton>
                </div>
            )}
        </Popout>
    );
}

function SpicetifyInstallerSetting() {
    const confirmInstall = () => Alerts.show({
        title: t("Install Spicetify?"),
        body: t("This downloads and runs the official Spicetify installer from GitHub in a terminal. Spicetify Marketplace will be selected automatically."),
        confirmText: t("Install"),
        cancelText: t("Cancel"),
        onConfirm: () => {
            if (!Native) {
                showToast(t("The Spicetify installer is only available in the desktop client."), Toasts.Type.FAILURE);
                return;
            }

            showToast(t("Opening the Spicetify installer."), Toasts.Type.MESSAGE);
            void Native.installSpicetify()
                .then(result => showToast(
                    result.success ? t("Spicetify installer opened in a terminal.") : result.error,
                    result.success ? Toasts.Type.SUCCESS : Toasts.Type.FAILURE
                ))
                .catch(error => {
                    logger.error("Could not open the Spicetify installer.", error);
                    showToast(t("Could not open the Spicetify installer."), Toasts.Type.FAILURE);
                });
        }
    });

    return (
        <Button onClick={confirmInstall}>{t("Install Spicetify")}</Button>
    );
}

const SafeSpicetifyInstallerSetting = ErrorBoundary.wrap(SpicetifyInstallerSetting, { noop: true });

const settings = definePluginSettings({
    rotationEnabled: {
        type: OptionType.BOOLEAN,
        description: t("Activer la rotation du custom status (désactiver = pause, sans tout supprimer)."),
        default: true,
        onChange(value: boolean) {
            if (value) restartRotation();
            else clearRotationTimer();
        }
    },
    phrases: {
        type: OptionType.COMPONENT,
        description: t("Custom status phrases, one per line."),
        component: SafePhrasesSetting,
        default: DEFAULT_PHRASES,
        onChange: restartWithFirstPhrase
    },
    emojis: {
        type: OptionType.COMPONENT,
        component: SafeEmojiSetting,
        default: DEFAULT_EMOJIS,
        onChange: restartWithFirstEmoji
    },
    rotationInterval: {
        type: OptionType.NUMBER,
        description: t("Seconds between each custom status change (min 10s — Discord rate limit safe, with random jitter)."),
        default: 10,
        isValid: (value: number) => value >= MIN_ROTATION_SECONDS || t("Rotation interval must be at least 10 seconds to avoid Discord rate limits."),
        onChange: restartRotation
    },
    useSpotifyLyrics: {
        type: OptionType.BOOLEAN,
        description: t("Use synchronized Spotify lyrics as your custom status while Spotify is playing."),
        default: false,
        onChange: syncSpotifyLyrics
    },
    prioritizePhrases: {
        type: OptionType.BOOLEAN,
        description: t("Give configured phrases priority over Spotify lyrics while music is playing."),
        default: false,
        onChange: () => syncSpotifyLyrics(settings.store.useSpotifyLyrics)
    },
    spotifyLyricsUpdateDelay: {
        type: OptionType.NUMBER,
        description: t("Minimum seconds between Spotify lyric status updates. Set to 0 to disable the delay."),
        default: 0,
        isValid: (value: number) => value >= 0 || t("Spotify lyrics update delay cannot be negative."),
        onChange: restartSpotifyLyricsDelay
    },
    humanizeSpotifyLyricsDelay: {
        type: OptionType.BOOLEAN,
        description: t("Add up to 35% random variation to the Spotify lyrics update delay."),
        default: false,
        onChange: restartSpotifyLyricsDelay
    },
    spicetifyInstaller: {
        type: OptionType.COMPONENT,
        description: t("Spicetify modifies the Spotify desktop client and adds support for themes, extensions, and custom apps. Marketplace is installed automatically."),
        component: SafeSpicetifyInstallerSetting
    },
    importFile: {
        type: OptionType.COMPONENT,
        description: t("Import phrases from a TXT file, one per line."),
        component: SafeImportSetting
    }
}).withPrivateSettings<{
    accountStates?: Record<string, AccountStatusState>;
    sourceFileName?: string;
}>();

export default definePlugin({
    name: "StatusCycler",
    description: "Automatically rotates through custom status phrases and emojis at a configurable interval.",
    authors: [{ name: "irritably",
     id: 928787166916640838n }],
    tags: ["Activity", "Utility"],
    dependencies: ["UserSettingsAPI", "ChatInputButtonAPI"],
    settings,
    chatBarButton: {
        icon: StatusEmojiIcon,
        render: StatusEmojiChatButton,
    },

    start() {
        active = true;
        consecutiveStatusFailures = 0;
        syncSpotifyLyrics(settings.store.useSpotifyLyrics);
        restartRotation();
    },

    stop() {
        active = false;
        spotifyPlaybackActive = false;
        spotifyOverrideActive = false;
        loadingSpotifyTrackId = undefined;
        spotifyTimeline++;
        lastSpotifyLyricIndex = undefined;
        lastSpotifyStatusText = undefined;
        pendingSpotifyBackwardLyricIndex = undefined;
        spotifyBackwardConfirmations = 0;
        pendingStatusUpdate = undefined;
        spotifyLyrics = [];
        spotifyLyricsTrackId = undefined;
        // Keep last custom status — no empty flash / "disconnect" look
        clearRotationTimer();
        if (lyricsTimeoutId !== undefined) {
            clearTimeout(lyricsTimeoutId);
            lyricsTimeoutId = undefined;
        }
    },

    flux: {
        CONNECTION_OPEN() {
            // Resume quietly after reconnect — never spam gateway
            pendingStatusUpdate = undefined;
            consecutiveStatusFailures = 0;
            if (settings.store.useSpotifyLyrics) {
                stopSpotifyLyrics();
                syncSpotifyLyrics(true);
            } else {
                restartRotation();
            }
        },

        async SPOTIFY_PLAYER_STATE({ track, position, isPlaying }: SpotifyPlayerState) {
            if (!settings.plain.useSpotifyLyrics || phrasesHavePriority()) return;

            if (!track || !isPlaying) {
                stopSpotifyLyrics();
                return;
            }

            await startSpotifyLyrics(track, position);
        }
    }
});
