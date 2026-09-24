const { execSync } = require("child_process");
const { existsSync, mkdirSync, cpSync, rmSync, renameSync, writeFileSync, readdirSync, statSync, readFileSync } = require("fs");
const { join } = require("path");

const ROOT = __dirname;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function killZcord() {
    if (process.platform !== "win32") {
        try {
            require("child_process").spawnSync("pkill", ["-f", "[Zz]cord"], { stdio: "ignore" });
        } catch (_) { }
        return;
    }
    const releaseDir = join(ROOT, "release", "zcord-dist");
    const releaseExes = [join(releaseDir, "Zcord.exe"), join(releaseDir, "Discord.exe")];
    for (const releaseExe of releaseExes) {
        try {
            execSync(
                `powershell -NoProfile -Command "Get-Process | Where-Object { $_.Path -eq '${releaseExe.replace(/'/g, "''")}' } | Stop-Process -Force"`,
                { stdio: "ignore", shell: true }
            );
        } catch (_) { }
    }
    try {
        execSync(
            `powershell -NoProfile -Command "Get-Process Zcord -ErrorAction SilentlyContinue | Stop-Process -Force"`,
            { stdio: "ignore", shell: true }
        );
    } catch (_) { }
}

function getDesktopPath() {
    if (process.platform !== "win32") {
        const { homedir } = require("os");
        const desktop = join(homedir(), "Desktop");
        if (require("fs").existsSync(desktop)) return desktop;
        const bureau = join(homedir(), "Bureau");
        if (require("fs").existsSync(bureau)) return bureau;
        return desktop;
    }
    try {
        return execSync(
            "powershell -NoProfile -Command \"[Environment]::GetFolderPath('Desktop')\"",
            { encoding: "utf8" }
        ).trim();
    } catch {
        return join(require("os").homedir(), "Desktop");
    }
}

function createZcordShortcut(exePath, iconPath, lnkPath, workDir) {
    const ps1 = join(ROOT, "scripts", "create-zcord-shortcut.ps1");
    try {
        execSync(
            `powershell -NoProfile -ExecutionPolicy Bypass -File "${ps1}" -ExePath "${exePath}" -IconPath "${iconPath}" -ShortcutPath "${lnkPath}" -WorkingDirectory "${workDir}" -AppUserModelId "com.zcord.app"`,
            { stdio: "ignore" }
        );
    } catch (_) {
        console.warn("[zcord] shortcut failed:", lnkPath);
    }
}

function ensureBuilt() {
    const mainJs = join(ROOT, "dist", "js", "main.js");
    const zcordAsar = join(ROOT, "dist", "zcord.asar");
    if (!existsSync(mainJs)) {
        console.log("[zcord] buildDesktop...");
        execSync("npx --yes pnpm@10.30.3 run buildDesktop", { cwd: ROOT, stdio: "inherit" });
    }
    if (!existsSync(zcordAsar) || !existsSync(join(ROOT, "dist", "zcord", "main.js"))) {
        console.log("[zcord] buildStandalone...");
        execSync("npx --yes pnpm@10.30.3 run buildStandalone", { cwd: ROOT, stdio: "inherit" });
    }
    if (!existsSync(mainJs)) throw new Error("dist/js/main.js manquant");
    if (!existsSync(zcordAsar)) throw new Error("dist/zcord.asar manquant — lance buildStandalone");
}

/**
 * Client INDÉPENDANT — délégué à scripts/build-independent.cjs
 * (évite winCodeSign / symlinks admin d'electron-builder sur Windows).
 */
function buildIndependent() {
    execSync("node scripts/build-independent.cjs", { cwd: ROOT, stdio: "inherit" });
}

// ─── Legacy Discord-host (opt-in: --host) ────────────────────────────────────

function findDiscordApp() {
    if (process.env.DISCORD_APP_PATH && existsSync(process.env.DISCORD_APP_PATH)) {
        return process.env.DISCORD_APP_PATH;
    }
    const bases = [
        join(process.env.LOCALAPPDATA || "", "Discord"),
        join(process.env.ProgramFiles || "", "Discord"),
        join(process.env["ProgramFiles(x86)"] || "", "Discord"),
    ].filter(Boolean);
    let best = null, bestVer = [0, 0, 0];
    for (const base of bases) {
        try {
            for (const e of readdirSync(base)) {
                const m = e.match(/^app-(\d+)\.(\d+)\.(\d+)$/);
                if (!m) continue;
                const v = [+m[1], +m[2], +m[3]];
                if (v[0] > bestVer[0] || (v[0] === bestVer[0] && v[1] > bestVer[1]) || (v[0] === bestVer[0] && v[1] === bestVer[1] && v[2] > bestVer[2])) {
                    bestVer = v;
                    best = join(base, e);
                }
            }
        } catch { }
    }
    if (!best) throw new Error("Discord introuvable. Installe Discord ou définis DISCORD_APP_PATH.");
    return best;
}

function syncBootstrapManifest(bootstrapDst) {
    if (!existsSync(bootstrapDst)) return;
    const manifest = {};
    for (const f of readdirSync(bootstrapDst)) {
        if (f.endsWith(".zip")) manifest[f.slice(0, -4)] = 0;
    }
    writeFileSync(join(bootstrapDst, "manifest.json"), JSON.stringify(manifest, null, 2));
}

function buildZcordFromDiscord(discordApp) {
    console.warn("[zcord] Mode --host (Discord renommé) — déprécié. Préfère le build indépendant.");
    const discordRes = join(discordApp, "resources");
    const outDir = join(ROOT, "release", "zcord-dist");
    if (existsSync(outDir)) {
        try { rmSync(outDir, { recursive: true, force: true }); } catch (_) { }
    }
    mkdirSync(outDir, { recursive: true });
    for (const f of readdirSync(discordApp)) {
        if (f === "resources" || f === "modules") continue;
        try { cpSync(join(discordApp, f), join(outDir, f), { recursive: true }); } catch (_) { }
    }
    const outModules = join(outDir, "modules");
    mkdirSync(outModules, { recursive: true });
    const discordModules = join(discordApp, "modules");
    if (existsSync(discordModules)) {
        for (const mod of readdirSync(discordModules)) {
            const src = join(discordModules, mod);
            if (!statSync(src).isDirectory()) continue;
            try { cpSync(src, join(outModules, mod), { recursive: true }); } catch (_) { }
        }
    }
    const outRes = join(outDir, "resources");
    mkdirSync(outRes, { recursive: true });
    const buildInfoSrc = join(discordRes, "build_info.json");
    if (existsSync(buildInfoSrc)) {
        const buildInfo = JSON.parse(readFileSync(buildInfoSrc, "utf8"));
        buildInfo.newUpdater = false;
        buildInfo.disableUpdater = true;
        buildInfo.releaseChannel = "stable";
        writeFileSync(join(outRes, "build_info.json"), JSON.stringify(buildInfo, null, 2));
    }
    const bootstrapSrc = join(discordRes, "bootstrap");
    const bootstrapDst = join(outRes, "bootstrap");
    mkdirSync(bootstrapDst, { recursive: true });
    if (existsSync(bootstrapSrc)) cpSync(bootstrapSrc, bootstrapDst, { recursive: true });
    syncBootstrapManifest(bootstrapDst);

    let appAsarSrc = join(discordRes, "_app.asar");
    if (!existsSync(appAsarSrc)) appAsarSrc = join(discordRes, "app.asar");
    if (existsSync(appAsarSrc)) cpSync(appAsarSrc, join(outRes, "_app.asar"), { recursive: statSync(appAsarSrc).isDirectory() });

    const outApp = join(outRes, "app");
    mkdirSync(outApp, { recursive: true });
    writeFileSync(join(outApp, "package.json"), JSON.stringify({
        name: "zcord",
        main: "index.js",
        version: require(join(ROOT, "package.json")).version
    }, null, 2));
    cpSync(join(ROOT, "scripts", "zcord-host-loader.js"), join(outApp, "index.js"));
    const equicordDist = join(ROOT, "dist", "desktop");
    const outDist = join(outApp, "dist", "desktop");
    mkdirSync(outDist, { recursive: true });
    for (const f of ["patcher.js", "preload.js", "renderer.js", "renderer.css", "renderer.js.LEGAL.txt"]) {
        if (existsSync(join(equicordDist, f))) cpSync(join(equicordDist, f), join(outDist, f));
    }
    if (existsSync(join(equicordDist, "preload.js"))) cpSync(join(equicordDist, "preload.js"), join(outDist, "preload.ref.js"));
    const staticSrc = join(ROOT, "static");
    if (existsSync(staticSrc)) cpSync(staticSrc, join(outApp, "static"), { recursive: true });
    const discordExe = join(outDir, "Discord.exe");
    const zcordExe = join(outDir, "Zcord.exe");
    if (existsSync(discordExe)) {
        try {
            if (existsSync(zcordExe)) rmSync(zcordExe, { force: true });
            renameSync(discordExe, zcordExe);
        } catch (_) { }
    }
    console.log(`[zcord] Host build → ${outDir}`);
}

// ─── electron-builder config (client indépendant) ────────────────────────────

module.exports = {
    appId: "com.zcord.app",
    productName: "Zcord",
    executableName: "Zcord",
    copyright: "Copyright 2026 Zcord",
    extraMetadata: {
        name: "zcord",
        main: "dist/js/main.js",
    },
    asar: false,
    directories: {
        output: "release",
        buildResources: "static",
    },
    files: [
        "package.json",
        "DOMAIN.json",
        "GITHUB.json",
        "dist/js/**/*",
        "static/**/*",
        "!**/*.map",
        "!static/bin/**",
        "!static/dist/**",
    ],
    extraResources: [
        { from: "dist/zcord.asar", to: "zcord.asar" },
        { from: "static/icon.ico", to: "app.ico" },
    ],
    afterPack: "./scripts/build/afterPack.mjs",
    win: {
        target: [{ target: "dir", arch: ["x64"] }],
        icon: "static/icon.ico",
        artifactName: "Zcord.${ext}",
        requestedExecutionLevel: "asInvoker",
    },
    linux: {
        target: [{ target: "dir", arch: ["x64"] }],
        icon: "static/icon.png",
        category: "Network",
        desktop: {
            Name: "Zcord",
            Comment: "Zcord — client Discord indépendant",
            Categories: "Network;InstantMessaging;",
            StartupWMClass: "Zcord",
        },
        executableName: "zcord",
        artifactName: "Zcord-${version}.${ext}",
    },
    nsis: {
        oneClick: false,
        allowToChangeInstallationDirectory: true,
        createDesktopShortcut: true,
        createStartMenuShortcut: true,
        shortcutName: "Zcord",
    },
};

// ─── Direct run ──────────────────────────────────────────────────────────────

const isDirectRun = require.main?.filename?.replace(/\\/g, "/").endsWith("electron-builder.config.cjs");

if (isDirectRun) {
    (async () => {
        if (process.argv.includes("--host")) {
            killZcord();
            execSync("node --require=./scripts/suppressExperimentalWarnings.js scripts/build/build.mjs --standalone", {
                cwd: ROOT,
                stdio: "inherit",
            });
            buildZcordFromDiscord(findDiscordApp());
        } else {
            await buildIndependent();
        }
    })().catch(err => {
        console.error("[zcord]", err.message || err);
        process.exit(1);
    });
}
