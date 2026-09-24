/**
 * Enregistre l'AUMID Windows + icône Z pour la barre des tâches.
 * Couvre Zcord.exe packagé ET electron.exe (dev / start-independent).
 */
const { execSync } = require("child_process");
const { existsSync, writeFileSync, rmSync, mkdirSync } = require("fs");
const { join, dirname } = require("path");
const { tmpdir } = require("os");

/** AUMID du client indépendant / electron-builder (voir src/zcord/main/index.ts) */
const AUMID = "com.zcord.app";
/** AUMID host Discord embarqué (patcher) — on enregistre aussi l'icône pour compat */
const AUMID_PORTABLE = "com.zcord.portable";

function findIcon(exeDir, resourcesPath, appRoot) {
    for (const p of [
        join(exeDir, "app.ico"),
        join(resourcesPath || "", "app.ico"),
        join(exeDir, "app.png"),
        appRoot && join(appRoot, "static", "icon.ico"),
        appRoot && join(appRoot, "static", "icon.png"),
        appRoot && join(appRoot, "zcord.ico"),
    ].filter(Boolean)) {
        if (existsSync(p)) return p;
    }
    return null;
}

function registerRegistry(iconPath, aumid = AUMID) {
    const base = `HKCU\\Software\\Classes\\AppUserModelID\\${aumid}`;
    execSync(`reg add "${base}" /ve /d "Zcord" /f`, { stdio: "ignore" });
    execSync(`reg add "${base}\\DefaultIcon" /ve /d "${iconPath},0" /f`, { stdio: "ignore" });
}

function repairShortcut(exePath, iconPath, lnkPath, workDir, ps1Path, aumid, args) {
    if (existsSync(ps1Path)) {
        try {
            const q = (s) => String(s).replace(/'/g, "''");
            let cmd =
                `powershell -NoProfile -ExecutionPolicy Bypass -File "${q(ps1Path)}"` +
                ` -ExePath "${q(exePath)}" -IconPath "${q(iconPath)}"` +
                ` -ShortcutPath "${q(lnkPath)}" -WorkingDirectory "${q(workDir)}"` +
                ` -AppUserModelId "${q(aumid)}"`;
            if (args) cmd += ` -Arguments "${q(args)}"`;
            execSync(cmd, { stdio: "ignore" });
            if (existsSync(lnkPath)) return true;
        } catch (_) { /* fallback VBS */ }
    }
    return repairShortcutVbs(exePath, iconPath, lnkPath, workDir, args);
}

function repairShortcutVbs(exePath, iconPath, lnkPath, workDir, args = "") {
    mkdirSync(dirname(lnkPath), { recursive: true });
    const vbs = join(tmpdir(), `zcord-lnk-${Date.now()}.vbs`);
    const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/"/g, "\"\"");
    writeFileSync(vbs, [
        "Set sh = CreateObject(\"WScript.Shell\")",
        `Set sc = sh.CreateShortcut("${esc(lnkPath)}")`,
        `sc.TargetPath = "${esc(exePath)}"`,
        `sc.WorkingDirectory = "${esc(workDir)}"`,
        args ? `sc.Arguments = "${esc(args)}"` : "",
        `sc.IconLocation = "${esc(iconPath)},0"`,
        "sc.Description = \"Zcord\"",
        "sc.Save",
    ].filter(Boolean).join("\r\n"));
    try {
        execSync(`cscript //nologo "${vbs}"`, { stdio: "ignore" });
        return existsSync(lnkPath);
    } finally {
        try { rmSync(vbs, { force: true }); } catch (_) {}
    }
}

/**
 * @param {{
 *   appRoot?: string,
 *   resourcesPath?: string,
 *   ps1Path?: string,
 *   exePath?: string,
 *   iconPath?: string,
 *   aumid?: string,
 *   arguments?: string,
 *   workDir?: string,
 * }} opts
 */
function registerZcordTaskbar(opts = {}) {
    if (process.platform !== "win32") return;

    const exePath = opts.exePath || process.env.ZCORD_EXE_PATH || process.execPath;
    const exeDir = dirname(exePath);
    const appRoot = opts.appRoot || join(__dirname, "..");
    const resourcesPath = opts.resourcesPath || process.resourcesPath || join(exeDir, "resources");
    const iconPath = opts.iconPath || findIcon(exeDir, resourcesPath, appRoot);
    const aumid = opts.aumid || AUMID;
    const workDir = opts.workDir || appRoot || exeDir;
    const args = opts.arguments || "";

    if (!iconPath) {
        console.warn("[Zcord] icon.ico introuvable — icône barre des tâches non enregistrée");
        return;
    }

    try {
        registerRegistry(iconPath, aumid);
        // Compat host Discord (AUMID portable)
        if (aumid !== AUMID_PORTABLE) registerRegistry(iconPath, AUMID_PORTABLE);
    } catch (e) {
        console.warn("[Zcord] Registry AUMID:", e?.message || e);
    }

    const ps1 = opts.ps1Path || join(appRoot, "scripts", "create-zcord-shortcut.ps1");
    const lnkTargets = [
        join(workDir, "Zcord.lnk"),
        join(process.env.APPDATA || "", "Microsoft", "Windows", "Start Menu", "Programs", "Zcord.lnk"),
    ];

    for (const lnk of lnkTargets) {
        try {
            mkdirSync(dirname(lnk), { recursive: true });
            if (repairShortcut(exePath, iconPath, lnk, workDir, ps1, aumid, args)) {
                console.log("[Zcord] Raccourci OK:", lnk);
            }
        } catch (e) {
            console.warn("[Zcord] Raccourci", lnk, ":", e?.message || e);
        }
    }
}

module.exports = { registerZcordTaskbar, AUMID, AUMID_PORTABLE };

if (require.main === module || process.env.ZCORD_REPAIR_ONLY) {
    const ROOT = join(__dirname, "..");
    const install = process.env.LOCALAPPDATA
        ? join(process.env.LOCALAPPDATA, "Programs", "Zcord")
        : "";

    if (install && existsSync(join(install, "Zcord.exe"))) {
        process.env.ZCORD_EXE_PATH = join(install, "Zcord.exe");
        registerZcordTaskbar({
            appRoot: join(install, "resources", "app"),
            resourcesPath: join(install, "resources"),
            ps1Path: join(install, "resources", "app", "create-zcord-shortcut.ps1"),
            aumid: AUMID_PORTABLE,
        });
        console.log("[Zcord] Icône barre des tâches enregistrée pour", install);
    } else {
        // Mode repo / electron
        let electronPath = "";
        try {
            electronPath = require(join(ROOT, "node_modules", "electron"));
        } catch { /* */ }
        registerZcordTaskbar({
            appRoot: ROOT,
            exePath: electronPath || undefined,
            iconPath: join(ROOT, "static", "icon.ico"),
            arguments: electronPath ? "." : "",
            workDir: ROOT,
            aumid: AUMID,
            ps1Path: join(ROOT, "scripts", "create-zcord-shortcut.ps1"),
        });
        console.log("[Zcord] Icône barre des tâches enregistrée (dev/electron)");
    }
}
