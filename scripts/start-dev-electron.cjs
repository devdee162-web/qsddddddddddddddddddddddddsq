/**
 * Lance Electron en mode dev avec le userData Zcord existant
 * (évite l'écran Installer / Choose Discord Versions).
 */
const { spawn } = require("child_process");
const { join } = require("path");
const { existsSync, mkdirSync, writeFileSync, readFileSync } = require("fs");
const { getZcordUserDataDir } = require("./zcordPaths.cjs");
const { ensureNativeElectronRuntime } = require("./ensureElectronRuntime.cjs");

const ROOT = join(__dirname, "..");
const userData = getZcordUserDataDir();

async function main() {
    mkdirSync(userData, { recursive: true });

    const statePath = join(userData, "state.json");
    try {
        let state = {};
        if (existsSync(statePath)) state = JSON.parse(readFileSync(statePath, "utf8"));
        state.firstLaunch = false;
        writeFileSync(statePath, JSON.stringify(state, null, 4), "utf8");
    } catch {
        writeFileSync(statePath, JSON.stringify({ firstLaunch: false }, null, 4), "utf8");
    }

    const settingsPath = join(userData, "settings", "settings.json");
    try {
        mkdirSync(join(userData, "settings"), { recursive: true });
        if (existsSync(settingsPath)) {
            const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
            settings.discordBranch = settings.discordBranch || "stable";
            settings.plugins = settings.plugins || {};
            if (!settings.plugins.CordCommands) settings.plugins.CordCommands = {};
            settings.plugins.CordCommands.enabled = true;
            if (!settings.plugins.CommandsAPI) settings.plugins.CommandsAPI = {};
            settings.plugins.CommandsAPI.enabled = true;
            writeFileSync(settingsPath, JSON.stringify(settings, null, 4), "utf8");
        }
    } catch (e) {
        console.warn("[start-dev] CordCommands:", e.message);
    }

    const { electronPath } = await ensureNativeElectronRuntime();
    if (!existsSync(electronPath)) {
        console.error("[start-dev] binaire electron manquant:", electronPath);
        process.exit(1);
    }

    console.log(`[start-dev] platform → ${process.platform}`);
    console.log(`[start-dev] userData → ${userData}`);
    console.log(`[start-dev] electron → ${electronPath}`);
    console.log("[start-dev] Lancement client Discord Zcord (pas l'installateur)…");

    const child = spawn(electronPath, ["."], {
        cwd: ROOT,
        stdio: "inherit",
        env: {
            ...process.env,
            Zcord_USER_DATA_DIR: userData,
            ZCORD_USER_DATA_DIR: userData,
            ZCORD_DISCORD_HOST: "0",
        },
    });

    child.on("exit", code => process.exit(code ?? 0));
}

main().catch(err => {
    console.error("[start-dev]", err.message || err);
    process.exit(1);
});
