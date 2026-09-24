/**
 * Client Zcord INDÉPENDANT (Vesktop-style).
 * - Electron dédié (pas Discord.exe / pas host Discord)
 * - Données : %AppData%\zcord (Win) / ~/.config/zcord (Linux) / Application Support (macOS)
 * - Plugins injectés depuis dist/zcord
 * - Aucune dépendance au Discord officiel installé
 */
const { spawn, execFileSync } = require("child_process");
const { join } = require("path");
const { existsSync, mkdirSync, writeFileSync, readFileSync } = require("fs");
const { getZcordUserDataDir, maybeMigrateWindowsPlugins } = require("./zcordPaths.cjs");
const { ensureNativeElectronRuntime } = require("./ensureElectronRuntime.cjs");

const ROOT = join(__dirname, "..");
const userData = getZcordUserDataDir();
const isWin = process.platform === "win32";
const isLinux = process.platform === "linux";

function writeJson(path, data) {
    writeFileSync(path, JSON.stringify(data, null, 4), { encoding: "utf8" });
}

function readJson(path) {
    const raw = readFileSync(path, "utf8").replace(/^\uFEFF/, "");
    return JSON.parse(raw);
}

function mustExist(p, label) {
    if (!existsSync(p)) {
        console.error(`[zcord-indep] Manquant: ${label}\n  → ${p}`);
        console.error("Lance d'abord: npx pnpm@10.30.3 run buildDesktop -- --dev");
        console.error("Puis:          npx pnpm@10.30.3 run buildStandalone:dev");
        process.exit(1);
    }
}

async function main() {
    mustExist(join(ROOT, "dist", "js", "main.js"), "desktop main");
    mustExist(join(ROOT, "dist", "js", "preload.js"), "desktop preload");
    mustExist(join(ROOT, "dist", "zcord", "main.js"), "zcord main");
    mustExist(join(ROOT, "dist", "zcord", "renderer.js"), "zcord renderer");
    mustExist(join(ROOT, "dist", "zcord", "preload.js"), "zcord preload");

    maybeMigrateWindowsPlugins(userData);

    mkdirSync(join(userData, "settings"), { recursive: true });

    const statePath = join(userData, "state.json");
    try {
        let state = existsSync(statePath) ? readJson(statePath) : {};
        state.firstLaunch = false;
        writeJson(statePath, state);
    } catch {
        writeJson(statePath, { firstLaunch: false });
    }

    const settingsPath = join(userData, "settings", "settings.json");
    try {
        const settings = existsSync(settingsPath) ? readJson(settingsPath) : {};
        settings.discordBranch = settings.discordBranch || "stable";
        settings.plugins = settings.plugins || {};
        for (const name of ["Settings", "CommandsAPI", "CordCommands", "NoTrack", "YTMDesktopRichPresence", "PerfHud", "UI Optimisations"]) {
            settings.plugins[name] = settings.plugins[name] || {};
            settings.plugins[name].enabled = true;
        }
        writeJson(settingsPath, settings);
    } catch (e) {
        console.warn("[zcord-indep] settings:", e.message);
    }

    const { electronPath: launchExe } = await ensureNativeElectronRuntime();
    mustExist(launchExe, isWin ? "electron/zcord.exe" : "electron");

    // Windows only : icône dans l'exe + AUMID / Start Menu
    if (isWin) {
        try {
            execFileSync(process.execPath, [join(ROOT, "scripts", "patch-electron-icon.cjs")], {
                cwd: ROOT,
                stdio: "inherit",
            });
        } catch (e) {
            console.warn("[zcord-indep] patch-icon:", e?.message || e);
        }

        try {
            const { registerZcordTaskbar, AUMID } = require(join(ROOT, "scripts", "register-zcord-taskbar.cjs"));
            const patchedExe = require(join(ROOT, "node_modules", "electron"));
            registerZcordTaskbar({
                appRoot: ROOT,
                exePath: patchedExe,
                iconPath: join(ROOT, "static", "icon.ico"),
                arguments: ".",
                workDir: ROOT,
                aumid: AUMID,
                ps1Path: join(ROOT, "scripts", "create-zcord-shortcut.ps1"),
            });
        } catch (e) {
            console.warn("[zcord-indep] icône taskbar:", e?.message || e);
        }
    }

    console.log("========================================");
    console.log("  Zcord — client indépendant");
    console.log("  (pas Discord.exe / pas host Discord)");
    console.log(`  platform: ${process.platform}`);
    console.log(`  electron: ${launchExe}`);
    console.log(`  userData: ${userData}`);
    console.log("========================================");

    const child = spawn(launchExe, isLinux ? [".", "--no-sandbox"] : ["."], {
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
    console.error("[zcord-indep]", err.message || err);
    process.exit(1);
});
