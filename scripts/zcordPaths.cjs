/**
 * Chemins Zcord multiplateforme (Windows / Linux / macOS).
 */
const { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync } = require("fs");
const { homedir } = require("os");
const { join } = require("path");

/**
 * Dossier userData Zcord (settings, session…).
 * Même logique que Electron app.getPath("appData") + "/zcord".
 */
function getZcordUserDataDir() {
    const env = process.env.Zcord_USER_DATA_DIR || process.env.ZCORD_USER_DATA_DIR;
    if (env) return env;

    if (process.platform === "win32") {
        return join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "zcord");
    }
    if (process.platform === "darwin") {
        return join(homedir(), "Library", "Application Support", "zcord");
    }
    // Linux / BSD : XDG
    const xdg = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
    return join(xdg, "zcord");
}

/**
 * Emplacement install packagé (buildIndependent / package).
 */
function getZcordInstallDir() {
    if (process.platform === "win32") {
        return join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "Programs", "Zcord");
    }
    if (process.platform === "darwin") {
        return "/Applications/Zcord.app";
    }
    const xdgData = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
    return join(xdgData, "zcord");
}

/** Nom du binaire packagé selon la plateforme. */
function getZcordBinaryName() {
    return process.platform === "win32" ? "Zcord.exe" : "zcord";
}

/**
 * Sous Linux (dual-boot), importe les plugins depuis %AppData%\zcord Windows
 * si le settings Linux est vide / trop pauvre.
 */
function maybeMigrateWindowsPlugins(userDataDir = getZcordUserDataDir()) {
    if (process.platform === "win32") return false;

    const user = process.env.USER || "";
    const candidates = [
        process.env.ZCORD_WINDOWS_SETTINGS,
        "/mnt/windows/Users/rosea/AppData/Roaming/zcord/settings/settings.json",
        user ? join("/mnt/windows/Users", user, "AppData/Roaming/zcord/settings/settings.json") : "",
    ].filter(Boolean);

    const winSettings = candidates.find(p => existsSync(p));
    if (!winSettings) return false;

    const linSettingsDir = join(userDataDir, "settings");
    const linSettings = join(linSettingsDir, "settings.json");
    mkdirSync(linSettingsDir, { recursive: true });

    let win;
    try {
        win = JSON.parse(readFileSync(winSettings, "utf8").replace(/^\uFEFF/, ""));
    } catch {
        return false;
    }
    const winPlugins = win.plugins && typeof win.plugins === "object" ? win.plugins : null;
    if (!winPlugins || Object.keys(winPlugins).length < 50) return false;

    let lin = {};
    if (existsSync(linSettings)) {
        try {
            lin = JSON.parse(readFileSync(linSettings, "utf8").replace(/^\uFEFF/, ""));
        } catch {
            lin = {};
        }
    }

    const linCount = Object.keys(lin.plugins || {}).length;
    const winCount = Object.keys(winPlugins).length;
    if (lin.__zcord_win_plugins_migrated_v1__ && linCount >= Math.min(200, winCount * 0.5)) {
        return false;
    }

    if (existsSync(linSettings)) {
        try {
            copyFileSync(linSettings, linSettings + ".bak-pre-win-migrate");
        } catch (_) { }
    }

    const merged = { ...lin, ...win, plugins: { ...(lin.plugins || {}), ...winPlugins } };
    merged.__zcord_win_plugins_migrated_v1__ = true;
    merged.__zcord_default_off_v1__ = true;
    merged.__zcord_restore_plugins_v1__ = true;
    merged.__zcord_unlock_plugins_v4__ = true;
    delete merged.__zcord_perf_v3__;

    writeFileSync(linSettings, JSON.stringify(merged, null, 4), "utf8");
    console.log(`[zcord-paths] Plugins Windows importés (${winCount} → ${Object.keys(merged.plugins).length})`);
    return true;
}

module.exports = {
    getZcordUserDataDir,
    getZcordInstallDir,
    getZcordBinaryName,
    maybeMigrateWindowsPlugins,
};
