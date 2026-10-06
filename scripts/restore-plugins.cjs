/**
 * Active uniquement les plugins "safe" (pas ceux qui cassent MP / titlebar / overlays).
 */
const fs = require("fs");
const path = require("path");
const { getZcordUserDataDir } = require("./zcordPaths.cjs");

const file = path.join(getZcordUserDataDir(), "settings", "settings.json");
const pluginsJson = path.join(__dirname, "..", "plugins.json");

/** Toujours OFF — cassent UI / MP / spam */
const KEEP_OFF = new Set([
    "clientdiagnostics",
    "perfhud",
    "orbolaybridge",
    "discorddevbanner",
    "webrichpresence",
    "nodmwhilestreaming",
    "channeltabs",
    // ShowHiddenChannels must NEVER be listed here (see FORCE_ON + .cursor/rules/show-hidden-channels.mdc)
    "livewallpaper",
    "channelwallpaper",
    "compactmode",
    "stealthmode",
    "uioptimisations",
    "channelbadges",
    "toastnotifications",
    "messagenotifier",
    "pingnotifications",
    "keywordnotify",
    "xsoverlay",
    "notificationvolume",
    "dynamicislande",
    "themeattributes",
    "fakenitro",
    "leaveallservers",
    "cleargroups",
    "autoclaim",
    "fakedm",
    "headerbarapi", // patches titlebar vides / dangereux
]);

/** Essentiels toujours ON */
const FORCE_ON = [
    "Settings",
    "CommandsAPI",
    "NoTrack",
    "SupportHelper",
    "BadgeAPI",
    "ContextMenuAPI",
    "MessageAccessoriesAPI",
    "ChatInputButtonAPI",
    "MemberListDecoratorsAPI",
    "NoticesAPI",
    "CordCommands",
    "ZcordCommands",
    "ZcordAI",
    "YTMDesktopRichPresence",
    "SmoothType",
    "CallTimer",
    "MessageLogger",
    "PermissionsViewer",
    "ViewIcons",
    "CopyUserURLs",
    "QuickReply",
    "Translate",
    "SpotifyControls",
    "MusicControls",
    "VolumeBooster",
    "ImageZoom",
    "BetterSettings",
    "PinDMs",
    "ExpressionCloner",
    "EmoteCloner",
    "ShowMeYourName",
    "FriendsSince",
    "PlatformIndicators",
    "RoleColorEverywhere",
    "TypingIndicator",
    "TypingTweaks",
    "WhoReacted",
    "MessageLatency",
    "CustomIdle",
    "GameActivityToggle",
    "VoiceMessages",
    "SilentTyping",
    "OnePingPerDM",
    "NoTrack",
    "BetterFolders",
    "BetterRoleDot",
    "BetterRoleContext",
    // UI perso (OK si pas d'overlays flottants)
    "customProfile",
    "Decor",
    "MacOsButtons",
    "Snowfall",
    // Affiche les salons masqués (ne pas retirer — sinon "Aucun accès" / OFF auto)
    "ShowHiddenChannels",
    "Experiments",
];

const s = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const list = JSON.parse(fs.readFileSync(pluginsJson, "utf8"));
s.plugins = s.plugins || {};

const keyOf = n => String(n).toLowerCase().replace(/\s+/g, "");

/** Hard guard: these must stay ON and must never appear in KEEP_OFF */
const NEVER_KEEP_OFF = ["showhiddenchannels", "experiments"];
for (const k of NEVER_KEEP_OFF) {
    if (KEEP_OFF.has(k)) {
        console.error(`[restore-plugins] BUG: "${k}" is in KEEP_OFF — remove it (ShowHiddenChannels / Aucun accès regression).`);
        process.exit(1);
    }
}
if (!FORCE_ON.some(n => keyOf(n) === "showhiddenchannels")) {
    console.error("[restore-plugins] BUG: ShowHiddenChannels missing from FORCE_ON.");
    process.exit(1);
}

// 1) Tout OFF d'abord sauf required
let off = 0;
for (const p of list) {
    if (!p?.name) continue;
    const k = keyOf(p.name);
    if (p.required) {
        s.plugins[p.name] = s.plugins[p.name] || {};
        s.plugins[p.name].enabled = true;
        continue;
    }
    if (KEEP_OFF.has(k)) {
        s.plugins[p.name] = s.plugins[p.name] || {};
        s.plugins[p.name].enabled = false;
        off++;
        continue;
    }
    // non-safe par défaut OFF (on réactive FORCE_ON après)
    s.plugins[p.name] = s.plugins[p.name] || {};
    s.plugins[p.name].enabled = false;
}

// 2) Activer la liste safe + required déjà ON
let on = 0;
for (const name of FORCE_ON) {
    if (KEEP_OFF.has(keyOf(name))) continue;
    s.plugins[name] = s.plugins[name] || {};
    s.plugins[name].enabled = true;
    on++;
}

// required depuis plugins.json
for (const p of list) {
    if (!p?.name || !p.required) continue;
    if (KEEP_OFF.has(keyOf(p.name))) continue;
    s.plugins[p.name] = s.plugins[p.name] || {};
    s.plugins[p.name].enabled = true;
}

s.plugins.Settings = s.plugins.Settings || {};
s.plugins.Settings.enabled = true;
s.plugins.Settings.settingsLocation = "top";

s.arRPC = true;
s.__zcord_safe_plugins_v1__ = true;
s.__zcord_unlock_plugins_v5__ = true;
s.__zcord_unlock_plugins_v4__ = true;
s.__zcord_restore_plugins_v1__ = true;
s.__zcord_default_off_v1__ = true;

fs.writeFileSync(file, JSON.stringify(s, null, 4));
const enabled = Object.entries(s.plugins).filter(([, v]) => v && v.enabled).length;
console.log("[safe] force-on names:", on);
console.log("[safe] keep-off touches:", off);
console.log("[safe] total enabled:", enabled);
console.log("[safe] file:", file);
