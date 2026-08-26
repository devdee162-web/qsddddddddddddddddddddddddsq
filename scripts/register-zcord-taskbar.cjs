/**
 * Enregistre l'AUMID Windows + icône Z pour la barre des tâches.
 * Zcord.exe = Discord signé → icône Discord si l'AUMID n'est pas enregistré.
 */
const { execSync } = require("child_process");
const { existsSync, writeFileSync, rmSync } = require("fs");
const { join, dirname } = require("path");
const { tmpdir } = require("os");

const AUMID = "com.zcord.portable";

function findIcon(exeDir, resourcesPath) {
    for (const p of [
        join(exeDir, "app.ico"),
        join(resourcesPath, "app.ico"),
        join(exeDir, "app.png"),
    ]) {
        if (existsSync(p)) return p;
    }
    return null;
}

function registerRegistry(iconPath) {
    const base = `HKCU\\Software\\Classes\\AppUserModelID\\${AUMID}`;
    execSync(`reg add "${base}" /ve /d "Zcord" /f`, { stdio: "ignore" });
    execSync(`reg add "${base}\\DefaultIcon" /ve /d "${iconPath},0" /f`, { stdio: "ignore" });
}

function repairShortcut(exePath, iconPath, lnkPath, workDir, ps1Path) {
    if (existsSync(ps1Path)) {
        try {
            const q = (s) => s.replace(/'/g, "''");
            execSync(
                `powershell -NoProfile -ExecutionPolicy Bypass -File "${q(ps1Path)}"` +
                ` -ExePath "${q(exePath)}" -IconPath "${q(iconPath)}"` +
                ` -ShortcutPath "${q(lnkPath)}" -WorkingDirectory "${q(workDir)}"` +
                ` -AppUserModelId "${AUMID}"`,
                { stdio: "ignore" }
            );
            if (existsSync(lnkPath)) return true;
        } catch (_) { /* fallback VBS */ }
    }
    return repairShortcutVbs(exePath, iconPath, lnkPath, workDir);
}

function repairShortcutVbs(exePath, iconPath, lnkPath, workDir) {
    const vbs = join(tmpdir(), `zcord-lnk-${Date.now()}.vbs`);
    const esc = (s) => s.replace(/\\/g, "\\\\");
    writeFileSync(vbs, [
        "Set sh = CreateObject(\"WScript.Shell\")",
        `Set sc = sh.CreateShortcut("${esc(lnkPath)}")`,
        `sc.TargetPath = "${esc(exePath)}"`,
        `sc.WorkingDirectory = "${esc(workDir)}"`,
        `sc.IconLocation = "${esc(iconPath)},0"`,
        "sc.Description = \"Zcord\"",
        "sc.Save",
    ].join("\r\n"));
    try {
        execSync(`cscript //nologo "${vbs}"`, { stdio: "ignore" });
        return existsSync(lnkPath);
    } finally {
        try { rmSync(vbs, { force: true }); } catch (_) {}
    }
}

/** @param {{ appRoot?: string, resourcesPath?: string, ps1Path?: string }} opts */
function registerZcordTaskbar(opts = {}) {
    if (process.platform !== "win32") return;

    const exePath = process.env.ZCORD_EXE_PATH || process.execPath;
    const exeDir = dirname(exePath);
    const resourcesPath = opts.resourcesPath || process.resourcesPath || join(exeDir, "resources");
    const iconPath = findIcon(exeDir, resourcesPath);
    if (!iconPath) {
        console.warn("[Zcord] app.ico introuvable — icone barre des taches non enregistree");
        return;
    }

    try {
        registerRegistry(iconPath);
    } catch (e) {
        console.warn("[Zcord] Registry AUMID:", e?.message || e);
    }

    const ps1 = opts.ps1Path || join(opts.appRoot || join(resourcesPath, "app"), "create-zcord-shortcut.ps1");
    const lnkTargets = [
        join(exeDir, "Zcord.lnk"),
        join(process.env.APPDATA || "", "Microsoft", "Windows", "Start Menu", "Programs", "Zcord.lnk"),
    ];

    for (const lnk of lnkTargets) {
        try {
            if (repairShortcut(exePath, iconPath, lnk, exeDir, ps1)) {
                console.log("[Zcord] Raccourci OK:", lnk);
            }
        } catch (e) {
            console.warn("[Zcord] Raccourci", lnk, ":", e?.message || e);
        }
    }
}

module.exports = { registerZcordTaskbar, AUMID };

if (require.main === module || process.env.ZCORD_REPAIR_ONLY) {
    const install = process.env.LOCALAPPDATA
        ? join(process.env.LOCALAPPDATA, "Programs", "Zcord")
        : "";
    if (install && existsSync(join(install, "Zcord.exe"))) {
        process.env.ZCORD_EXE_PATH = join(install, "Zcord.exe");
        registerZcordTaskbar({
            appRoot: join(install, "resources", "app"),
            resourcesPath: join(install, "resources"),
            ps1Path: join(install, "resources", "app", "create-zcord-shortcut.ps1"),
        });
        console.log("[Zcord] Icone barre des taches enregistree pour", install);
    }
}
