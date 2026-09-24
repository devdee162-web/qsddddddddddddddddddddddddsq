/**
 * Force-disable heavy plugins in zcord settings (AppData / ~/.config/zcord).
 */
const fs = require("fs");
const path = require("path");
const { getZcordUserDataDir } = require("./zcordPaths.cjs");

const HEAVY = new Set([
    "clientdiagnostics", "messagelogger", "messageloggerenhanced", "autocorrect", "autoreply",
    "autoresponder", "autotranslatezcord", "translate", "encryptedmessage", "eventlogs", "fakedm",
    "fakevoice", "channelwallpaper", "livewallpaper", "imagezoom", "musiccontrols", "zcordai",
    "shareperms", "voicedictation", "messagecleaner", "whoswatching", "followuser", "gifconvertor",
    "exportdm", "soundcordplayer", "compactmode", "backpack", "themelibrary", "equicordhelper",
    "bulkfriendremove", "selfdestruct", "iconviewer", "smoothtype", "previewmessage", "abreviation",
    "fakefriends", "fakeaccount", "privatebrowser", "passcodelock", "qxchat", "wordbomb",
    "multiinstance", "uncompressedimages", "volumebooster", "voicemessages", "voicedownload",
    "membercount", "uservoiceshow", "viewicons", "doubleemoji", "silentdelete", "silentedit",
    "antimovedeco", "spotifycrack", "voicechannelsearch", "hypesquadchanger", "lockgroup",
    "cancelfriendrequest", "reverseimagesearch", "pindms", "validuser", "fastpfp", "fixscreenshare",
    "stereoinstaller", "streamproof", "showhiddenthings", "nounblocktojump", "zcordhelper",
    "zcordofficialdm", "disablecallidle",
]);

const KEEP_ON = new Set([
    "settings", "commandsapi", "notrack", "crashhandler", "cordcommands", "zcordcommands",
    "ytmdesktoprichpresence", "perfhud", "uioptimisations", "titlebarupdate", "stealthmode",
    "unlimitedaccounts", "webcontextmenus", "webkeybinds", "supporthelper", "disabledeeplinks",
    "hidenativebuttons", "noticesapi", "badgeapi", "chatinputbuttonapi", "contextmenuapi",
    "messageeventsapi", "messagepopoverapi", "messageaccessoriesapi", "messagedecorationsapi",
    "messageupdaterapi", "memberlistdecoratorsapi", "nicknameiconsapi", "headerbarapi",
    "userareaapi", "usersettingsapi", "profilecollectionsapi", "menuitemdemanglerapi",
    "dynamicimagemodalapi", "concatenatedmodules", "concatenatedcomponentextractor",
]);

const file = path.join(getZcordUserDataDir(), "settings", "settings.json");
if (!fs.existsSync(file)) {
    console.error("missing", file);
    process.exit(1);
}

const s = JSON.parse(fs.readFileSync(file, "utf8"));
s.plugins = s.plugins || {};
let off = 0;
for (const [name, st] of Object.entries(s.plugins)) {
    if (!st || typeof st !== "object") continue;
    const key = name.toLowerCase().replace(/\s+/g, "");
    if (HEAVY.has(key) || (!KEEP_ON.has(key) && !key.endsWith("api") && key !== "settings")) {
        if (st.enabled) off++;
        st.enabled = false;
    }
}
for (const name of ["PerfHud", "YTMDesktopRichPresence", "UI Optimisations", "NoTrack", "CommandsAPI", "Settings", "CordCommands", "ZcordCommands"]) {
    s.plugins[name] = s.plugins[name] || {};
    s.plugins[name].enabled = true;
}
s.__zcord_perf_v3__ = true;
s.__zcord_default_off_v1__ = true;
s.__zcord_restore_plugins_v1__ = true;
if (s.cloud) s.cloud.settingsSync = false;

fs.writeFileSync(file, JSON.stringify(s, null, 4));
const enabled = Object.entries(s.plugins).filter(([, v]) => v && v.enabled).map(([k]) => k).sort();
console.log("disabled touches:", off);
console.log("enabled count:", enabled.length);
console.log(enabled.join(", "));
