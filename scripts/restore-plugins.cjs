/**
 * Restore default plugins + soft perf flags (no mass disable).
 */
const fs = require("fs");
const path = require("path");
const { getZcordUserDataDir } = require("./zcordPaths.cjs");

const file = path.join(getZcordUserDataDir(), "settings", "settings.json");
const pluginsJson = path.join(__dirname, "..", "plugins.json");

const s = JSON.parse(fs.readFileSync(file, "utf8"));
const list = JSON.parse(fs.readFileSync(pluginsJson, "utf8"));
s.plugins = s.plugins || {};

let on = 0;
for (const p of list) {
    const name = p.name;
    if (!name) continue;
    if (String(name).toLowerCase() === "clientdiagnostics") {
        s.plugins[name] = s.plugins[name] || {};
        s.plugins[name].enabled = false;
        continue;
    }
    if (p.required || p.enabledByDefault) {
        s.plugins[name] = s.plugins[name] || {};
        if (!s.plugins[name].enabled) on++;
        s.plugins[name].enabled = true;
    }
}

for (const name of [
    "PerfHud",
    "YTMDesktopRichPresence",
    "UI Optimisations",
    "NoTrack",
    "CommandsAPI",
    "Settings",
    "CordCommands",
    "ZcordCommands",
]) {
    s.plugins[name] = s.plugins[name] || {};
    s.plugins[name].enabled = true;
}

s.plugins.Settings = s.plugins.Settings || {};
s.plugins.Settings.settingsLocation = "top";

s.__zcord_unlock_plugins_v4__ = true;
s.__zcord_restore_plugins_v1__ = true;
s.__zcord_default_off_v1__ = true;
delete s.__zcord_perf_v3__;
delete s.__zcord_perf_v2__;

fs.writeFileSync(file, JSON.stringify(s, null, 4));
const enabled = Object.entries(s.plugins).filter(([, v]) => v && v.enabled).length;
console.log("re-enabled touches:", on);
console.log("enabled count:", enabled);
