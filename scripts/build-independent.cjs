/**
 * Client Zcord INDÉPENDANT packagé.
 *
 * Windows:
 * - Zcord.exe = Discord.exe renommé SANS rcedit (Authenticode → Smart App Control OK)
 * - Fallback: Electron npm si Discord absent
 * - Raccourcis .lnk + Launch Zcord.cmd
 *
 * Linux / macOS:
 * - Runtime Electron npm → binaire `zcord`
 * - Launcher shell + .desktop (Linux)
 *
 * Sortie: release/zcord-dist/
 */
const { execSync, spawnSync } = require("child_process");
const {
    existsSync, mkdirSync, cpSync, rmSync, writeFileSync,
    readdirSync, statSync, renameSync, readFileSync, chmodSync,
} = require("fs");
const { join, dirname } = require("path");
const { homedir } = require("os");
const { getZcordInstallDir, getZcordBinaryName } = require("./zcordPaths.cjs");

const ROOT = join(__dirname, "..");
const isWin = process.platform === "win32";
const isLinux = process.platform === "linux";
const isDarwin = process.platform === "darwin";

function killZcord() {
    if (isWin) {
        try {
            execSync(
                `powershell -NoProfile -Command "Get-Process Zcord,electron,Discord -ErrorAction SilentlyContinue | Stop-Process -Force"`,
                { stdio: "ignore", shell: true }
            );
        } catch (_) { }
        return;
    }
    try {
        spawnSync("pkill", ["-f", "[Zz]cord"], { stdio: "ignore" });
    } catch (_) { }
}

/** arRPC binary → resources/arrpc/arrpc(.exe) */
function ensureArRPCBinary() {
    const platformName = isWin ? "windows" : process.platform;
    const archName = process.arch === "arm64" ? "arm64" : "x64";
    const name = `arrpc-${platformName}-${archName}${isWin ? ".exe" : ""}`;
    const src = join(ROOT, "static", "dist", name);
    if (!existsSync(src)) {
        console.log("[indep] arRPC manquant — téléchargement…");
        execSync("node scripts/fetch-arrpc.cjs", { cwd: ROOT, stdio: "inherit" });
    }
    if (!existsSync(src)) throw new Error(`arRPC binary introuvable: ${src}`);
    return src;
}

function copyArRPC(resDir) {
    const src = ensureArRPCBinary();
    const destDir = join(resDir, "arrpc");
    mkdirSync(destDir, { recursive: true });
    const destName = isWin ? "arrpc.exe" : "arrpc";
    const dest = join(destDir, destName);
    cpSync(src, dest);
    if (!isWin) {
        try { chmodSync(dest, 0o755); } catch (_) { }
    }
    console.log(`[indep] arRPC → resources/arrpc/${destName}`);
}

function getDesktopPath() {
    if (isWin) {
        try {
            return execSync(
                "powershell -NoProfile -Command \"[Environment]::GetFolderPath('Desktop')\"",
                { encoding: "utf8" }
            ).trim();
        } catch {
            return join(homedir(), "Desktop");
        }
    }
    const xdg = process.env.XDG_DESKTOP_DIR;
    if (xdg) return xdg;
    const desktop = join(homedir(), "Desktop");
    if (existsSync(desktop)) return desktop;
    const bureau = join(homedir(), "Bureau");
    if (existsSync(bureau)) return bureau;
    return desktop;
}

function createShortcutBasic(exePath, iconPath, lnkPath, workDir) {
    const vbs = join(require("os").tmpdir(), `zcord-lnk-${Date.now()}.vbs`);
    const esc = s => String(s).replace(/"/g, '""');
    writeFileSync(vbs, [
        'Set sh = CreateObject("WScript.Shell")',
        `Set sc = sh.CreateShortcut("${esc(lnkPath)}")`,
        `sc.TargetPath = "${esc(exePath)}"`,
        `sc.WorkingDirectory = "${esc(workDir)}"`,
        `sc.IconLocation = "${esc(iconPath)},0"`,
        'sc.Description = "Zcord"',
        "sc.Save",
    ].join("\r\n"));
    try {
        execSync(`cscript //nologo "${vbs}"`, { stdio: "ignore" });
        return true;
    } catch {
        return false;
    } finally {
        try { rmSync(vbs, { force: true }); } catch (_) { }
    }
}

function createShortcut(exePath, iconPath, lnkPath, workDir) {
    const ps1 = join(ROOT, "scripts", "create-zcord-shortcut.ps1");
    try {
        execSync(
            `powershell -NoProfile -ExecutionPolicy Bypass -File "${ps1}" -ExePath "${exePath}" -IconPath "${iconPath}" -ShortcutPath "${lnkPath}" -WorkingDirectory "${workDir}" -AppUserModelId "com.zcord.app"`,
            { stdio: "ignore" }
        );
        return;
    } catch (_) { /* fallback */ }
    if (createShortcutBasic(exePath, iconPath, lnkPath, workDir)) {
        console.log("[indep] Raccourci OK:", lnkPath);
    } else {
        console.warn("[indep] shortcut failed:", lnkPath);
    }
}

function createDesktopEntry(exePath, iconPath, desktopPath, workDir) {
    const esc = s => String(s).replace(/\\/g, "\\\\").replace(/ /g, "\\ ");
    const content = [
        "[Desktop Entry]",
        "Version=1.0",
        "Type=Application",
        "Name=Zcord",
        "Comment=Zcord — client Discord indépendant",
        `Exec=${esc(exePath)} --no-sandbox`,
        `Path=${workDir}`,
        `Icon=${iconPath}`,
        "Terminal=false",
        "Categories=Network;InstantMessaging;",
        "StartupWMClass=Zcord",
        "",
    ].join("\n");
    mkdirSync(dirname(desktopPath), { recursive: true });
    writeFileSync(desktopPath, content, "utf8");
    try { chmodSync(desktopPath, 0o755); } catch (_) { }
    console.log("[indep] .desktop →", desktopPath);
}

function ensureBuilt() {
    if (!existsSync(join(ROOT, "dist", "js", "main.js"))) {
        execSync("npx --yes pnpm@10.30.3 run buildDesktop", { cwd: ROOT, stdio: "inherit" });
    }
    if (!existsSync(join(ROOT, "dist", "zcord.asar"))) {
        execSync("npx --yes pnpm@10.30.3 run buildStandalone", { cwd: ROOT, stdio: "inherit" });
    }
    if (!existsSync(join(ROOT, "dist", "js", "main.js"))) throw new Error("dist/js/main.js manquant");
    if (!existsSync(join(ROOT, "dist", "zcord.asar"))) throw new Error("dist/zcord.asar manquant");
}

function findDiscordApp() {
    if (!isWin) return null;
    if (process.env.DISCORD_APP_PATH && existsSync(process.env.DISCORD_APP_PATH)) {
        return process.env.DISCORD_APP_PATH;
    }
    const bases = [
        join(process.env.LOCALAPPDATA || "", "Discord"),
        join(process.env.ProgramFiles || "", "Discord"),
        join(process.env["ProgramFiles(x86)"] || "", "Discord"),
    ].filter(Boolean);

    let best = null;
    let bestVer = [0, 0, 0];
    for (const base of bases) {
        try {
            for (const e of readdirSync(base)) {
                const m = e.match(/^app-(\d+)\.(\d+)\.(\d+)$/);
                if (!m) continue;
                const v = [+m[1], +m[2], +m[3]];
                const better =
                    v[0] > bestVer[0] ||
                    (v[0] === bestVer[0] && v[1] > bestVer[1]) ||
                    (v[0] === bestVer[0] && v[1] === bestVer[1] && v[2] > bestVer[2]);
                if (better && existsSync(join(base, e, "Discord.exe"))) {
                    bestVer = v;
                    best = join(base, e);
                }
            }
        } catch (_) { }
    }
    return best;
}

function writeVesktopApp(resDir, version) {
    for (const dead of ["app.asar", "_app.asar", "default_app.asar"]) {
        const p = join(resDir, dead);
        if (!existsSync(p)) continue;
        try { rmSync(p, { recursive: true, force: true }); } catch (_) { }
    }

    const appDir = join(resDir, "app");
    if (existsSync(appDir)) {
        try { rmSync(appDir, { recursive: true, force: true }); } catch (_) { }
    }
    mkdirSync(join(appDir, "dist", "js"), { recursive: true });

    for (const f of readdirSync(join(ROOT, "dist", "js"))) {
        if (f.endsWith(".map")) continue;
        const s = join(ROOT, "dist", "js", f);
        if (!statSync(s).isFile()) continue;
        cpSync(s, join(appDir, "dist", "js", f));
    }

    cpSync(join(ROOT, "static"), join(appDir, "static"), { recursive: true });
    for (const meta of ["DOMAIN.json", "GITHUB.json"]) {
        if (existsSync(join(ROOT, meta))) cpSync(join(ROOT, meta), join(appDir, meta));
    }

    writeFileSync(join(appDir, "index.js"), [
        '"use strict";',
        'process.env.ZCORD_DISCORD_HOST = "0";',
        "try {",
        '  const { app } = require("electron");',
        '  app.setName("Zcord");',
        '  if (process.platform === "win32") app.setAppUserModelId("com.zcord.app");',
        "} catch (_) {}",
        'require("./dist/js/main.js");',
        "",
    ].join("\n"));

    writeFileSync(join(appDir, "package.json"), JSON.stringify({
        name: "zcord",
        version,
        main: "index.js",
        productName: "Zcord",
    }, null, 2));
}

function copyDiscordRuntime(discordApp, outDir) {
    console.log("[indep] Runtime SIGNÉ Discord →", discordApp);

    for (const f of readdirSync(discordApp)) {
        if (f === "resources" || f === "modules") continue;
        try {
            cpSync(join(discordApp, f), join(outDir, f), { recursive: true });
        } catch (e) {
            console.warn("[indep] skip", f, e.message);
        }
    }

    const discordRes = join(discordApp, "resources");
    const outRes = join(outDir, "resources");
    mkdirSync(outRes, { recursive: true });
    if (existsSync(discordRes)) {
        for (const f of readdirSync(discordRes)) {
            if (f === "app.asar" || f === "_app.asar" || f === "app" || f === "bootstrap") continue;
            try {
                cpSync(join(discordRes, f), join(outRes, f), { recursive: true });
            } catch (e) {
                console.warn("[indep] res skip", f, e.message);
            }
        }
        const biSrc = join(discordRes, "build_info.json");
        if (existsSync(biSrc)) {
            try {
                const bi = JSON.parse(readFileSync(biSrc, "utf8"));
                bi.newUpdater = false;
                bi.disableUpdater = true;
                writeFileSync(join(outRes, "build_info.json"), JSON.stringify(bi, null, 2));
            } catch (_) { }
        }
    }

    const discordExe = join(outDir, "Discord.exe");
    const zcordExe = join(outDir, "Zcord.exe");
    if (existsSync(discordExe)) {
        if (existsSync(zcordExe)) rmSync(zcordExe, { force: true });
        renameSync(discordExe, zcordExe);
    }
    if (existsSync(discordExe)) {
        try { rmSync(discordExe, { force: true }); } catch (_) { }
    }

    return zcordExe;
}

async function copyNpmElectronRuntime(outDir) {
    if (isWin) {
        console.warn("[indep] Discord introuvable — fallback Electron npm (risque Smart App Control)");
    } else {
        console.log("[indep] Runtime Electron npm →", process.platform);
    }

    const { ensureNativeElectronRuntime } = require("./ensureElectronRuntime.cjs");
    const { distDir: electronDist, electronPath } = await ensureNativeElectronRuntime();
    console.log("[indep] Electron source:", electronPath);

    const binName = getZcordBinaryName();

    for (const name of readdirSync(electronDist)) {
        if (name === "Data" || name === "zcord.exe" || name === "zcord" || name === ".zcord-electron-version") continue;
        const src = join(electronDist, name);
        let dstName = name;
        if (name === "electron.exe") dstName = "Zcord.exe";
        else if (name === "electron") dstName = "zcord";
        try {
            cpSync(src, join(outDir, dstName), { recursive: true });
        } catch (e) {
            console.warn("[indep] skip", name, e.message);
        }
    }

    const bin = join(outDir, binName);
    if (!isWin && existsSync(bin)) {
        try { chmodSync(bin, 0o755); } catch (_) { }
    }
    if (!existsSync(bin)) throw new Error(`Binaire manquant après copie Electron: ${bin}`);
    return bin;
}

function writeLinuxLaunchers(outDir, exePath, iconPath) {
    const launchSh = join(outDir, "launch-zcord.sh");
    writeFileSync(launchSh, [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        'DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
        `# chrome-sandbox sans setuid → --no-sandbox sur Linux`,
        `exec "$DIR/${getZcordBinaryName()}" --no-sandbox "$@"`,
        "",
    ].join("\n"), "utf8");
    try { chmodSync(launchSh, 0o755); } catch (_) { }

    const desktop = getDesktopPath();
    const appsDir = join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "applications");
    const targets = [
        join(outDir, "zcord.desktop"),
        join(appsDir, "zcord.desktop"),
    ];
    if (desktop) targets.push(join(desktop, "zcord.desktop"));
    for (const p of targets) createDesktopEntry(exePath, iconPath, p, outDir);

    // Copie optionnelle vers install XDG
    const installDir = getZcordInstallDir();
    try {
        mkdirSync(installDir, { recursive: true });
        cpSync(outDir, installDir, { recursive: true });
        console.log("[indep] Install →", installDir);
    } catch (e) {
        console.warn("[indep] install copy:", e.message);
    }
}

async function main() {
    console.log(`[indep] Build client INDÉPENDANT (${process.platform})...`);
    killZcord();
    ensureBuilt();

    const outDir = join(ROOT, "release", "zcord-dist");
    const version = require(join(ROOT, "package.json")).version;
    const iconIco = existsSync(join(ROOT, "static", "icon.ico"))
        ? join(ROOT, "static", "icon.ico")
        : join(ROOT, "zcord.ico");
    const iconPng = existsSync(join(ROOT, "static", "icon.png"))
        ? join(ROOT, "static", "icon.png")
        : iconIco;

    if (existsSync(outDir)) {
        try { rmSync(outDir, { recursive: true, force: true }); } catch (e) {
            console.warn("[indep] cleanup:", e.message);
        }
    }
    mkdirSync(outDir, { recursive: true });

    const discordApp = findDiscordApp();
    let exePath;
    let runtime = "electron-npm";
    if (discordApp) {
        exePath = copyDiscordRuntime(discordApp, outDir);
        runtime = "discord-signed";
    } else {
        exePath = await copyNpmElectronRuntime(outDir);
    }

    const resDir = join(outDir, "resources");
    mkdirSync(resDir, { recursive: true });
    writeVesktopApp(resDir, version);
    cpSync(join(ROOT, "dist", "zcord.asar"), join(resDir, "zcord.asar"));
    copyArRPC(resDir);

    if (existsSync(iconIco)) {
        cpSync(iconIco, join(outDir, "app.ico"));
        cpSync(iconIco, join(resDir, "app.ico"));
    }
    if (existsSync(iconPng)) {
        cpSync(iconPng, join(outDir, "app.png"));
        cpSync(iconPng, join(resDir, "app.png"));
    }

    writeFileSync(join(resDir, "zcord-mode.json"), JSON.stringify({
        mode: "independent",
        runtime,
        platform: process.platform,
        version,
    }, null, 2));

    if (isWin && runtime === "discord-signed") {
        console.log("[indep] Zcord.exe = Discord.exe signé (pas de rcedit)");
        try {
            const status = execSync(
                `powershell -NoProfile -Command "(Get-AuthenticodeSignature '${exePath.replace(/'/g, "''")}').Status"`,
                { encoding: "utf8" }
            ).trim();
            console.log("[indep] Authenticode:", status);
        } catch (_) { }
    } else if (isWin && process.env.ZCORD_CERT_FILE && existsSync(process.env.ZCORD_CERT_FILE)) {
        try {
            execSync(
                `powershell -NoProfile -ExecutionPolicy Bypass -File "${join(ROOT, "scripts", "sign-windows.ps1")}" -File "${exePath}"`,
                { cwd: ROOT, stdio: "inherit" }
            );
        } catch (_) { }
    }

    if (isWin) {
        writeFileSync(join(outDir, "Launch Zcord.cmd"), [
            "@echo off",
            "set \"DIR=%~dp0\"",
            "if exist \"%DIR%Zcord.lnk\" (",
            "  start \"\" explorer.exe \"%DIR%Zcord.lnk\"",
            ") else (",
            "  start \"\" /D \"%DIR%\" \"%DIR%Zcord.exe\"",
            ")",
        ].join("\r\n"), "utf8");

        const iconForLnk = existsSync(join(outDir, "app.ico")) ? join(outDir, "app.ico") : exePath;
        const desktop = getDesktopPath();
        const targets = [
            join(outDir, "Zcord.lnk"),
            join(process.env.APPDATA || "", "Microsoft", "Windows", "Start Menu", "Programs", "Zcord.lnk"),
        ];
        if (desktop) targets.push(join(desktop, "Zcord.lnk"));
        for (const lnk of targets) createShortcut(exePath, iconForLnk, lnk, outDir);

        console.log(`[indep] OK → ${outDir} (runtime=${runtime})`);
        console.log(`[indep] Lance: Zcord.lnk  ou  Launch Zcord.cmd`);
    } else if (isLinux) {
        const iconForDesk = existsSync(join(outDir, "app.png")) ? join(outDir, "app.png") : exePath;
        writeLinuxLaunchers(outDir, exePath, iconForDesk);
        console.log(`[indep] OK → ${outDir} (runtime=${runtime})`);
        console.log(`[indep] Lance: ./launch-zcord.sh  ou  ~/.local/share/zcord/zcord`);
    } else if (isDarwin) {
        writeFileSync(join(outDir, "launch-zcord.sh"), [
            "#!/usr/bin/env bash",
            "set -euo pipefail",
            'DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
            `exec "$DIR/${getZcordBinaryName()}" "$@"`,
            "",
        ].join("\n"), "utf8");
        try { chmodSync(join(outDir, "launch-zcord.sh"), 0o755); } catch (_) { }
        console.log(`[indep] OK → ${outDir} (runtime=${runtime})`);
        console.log(`[indep] Lance: ./launch-zcord.sh`);
    } else {
        console.log(`[indep] OK → ${outDir} (runtime=${runtime})`);
    }
}

main().catch(err => {
    console.error("[indep]", err.message || err);
    process.exit(1);
});
