const { execSync } = require("child_process");
const { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync, cpSync, renameSync, rmSync } = require("fs");
const { createHash } = require("crypto");
const { join } = require("path");

// ─── Configuration de Build Zcord ─────────────────────────────────────────

function killZcord() {
    const releaseDir = join(__dirname, "release", "zcord-dist");
    const releaseExes = [join(releaseDir, "Zcord.exe"), join(releaseDir, "Discord.exe")];

    for (const releaseExe of releaseExes) {
        try {
            execSync(
                `powershell -NoProfile -Command "Get-Process | Where-Object { $_.Path -eq '${releaseExe.replace(/'/g, "''")}' } | Stop-Process -Force"`,
                { stdio: "ignore", shell: true }
            );
        } catch (_) { }
    }

    const resDir = join(releaseDir, "resources");
    for (const name of ["app.asar", "_app.asar"]) {
        const p = join(resDir, name);
        if (!existsSync(p)) continue;
        try { rmSync(p, { recursive: true, force: true }); } catch (_) { }
    }
}

function findDiscordApp() {
    if (process.env.DISCORD_APP_PATH) {
        const p = process.env.DISCORD_APP_PATH;
        if (existsSync(p)) return p;
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
    console.log(`[zcord] bootstrap/manifest.json — ${Object.keys(manifest).length} modules (offline OK)`);
}

function getDesktopPath() {
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
    const ps1 = join(__dirname, "scripts", "create-zcord-shortcut.ps1");
    const py = join(__dirname, "scripts", "make-zcord-shortcut.py");
    const q = (s) => s.replace(/'/g, "''");

    try {
        execSync(
            `powershell -NoProfile -ExecutionPolicy Bypass -File "${ps1}" -ExePath "${exePath}" -IconPath "${iconPath}" -ShortcutPath "${lnkPath}" -WorkingDirectory "${workDir}"`,
            { stdio: "ignore" }
        );
        return;
    } catch (_) { }

    try {
        execSync(`py -3 "${py}" "${exePath}" "${iconPath}" "${lnkPath}" "${workDir}"`, { stdio: "ignore" });
        return;
    } catch (_) { }

    // Dernier recours : raccourci basique sans AUMID (tous les PC Windows)
    const vbs = join(require("os").tmpdir(), `zcord-lnk-${Date.now()}.vbs`);
    writeFileSync(vbs, [
        "Set sh = CreateObject(\"WScript.Shell\")",
        `Set sc = sh.CreateShortcut("${lnkPath.replace(/\\/g, "\\\\")}")`,
        `sc.TargetPath = "${exePath.replace(/\\/g, "\\\\")}"`,
        `sc.WorkingDirectory = "${workDir.replace(/\\/g, "\\\\")}"`,
        `sc.IconLocation = "${iconPath.replace(/\\/g, "\\\\")},0"`,
        "sc.Description = \"Zcord\"",
        "sc.Save",
    ].join("\r\n"));
    execSync(`cscript //nologo "${vbs}"`, { stdio: "ignore" });
    try { rmSync(vbs, { force: true }); } catch (_) { }
    console.warn(`[zcord] Raccourci basique (sans AUMID): ${lnkPath}`);
    void q;
}

function buildEquicord() {
    console.log("[build] Compilation de Zcord...");
    execSync("node --require=./scripts/suppressExperimentalWarnings.js scripts/build/build.mjs --standalone", { stdio: "inherit" });
}

function buildZcordFromDiscord(discordApp) {
    const discordRes = join(discordApp, "resources");
    const outDir = join(__dirname, "release", "zcord-dist");

    if (existsSync(outDir)) {
        try { rmSync(outDir, { recursive: true, force: true }); } catch (e) { }
    }

    console.log("[zcord] Copie des binaires Discord...");
    mkdirSync(outDir, { recursive: true });

    for (const f of readdirSync(discordApp)) {
        if (f === "resources" || f === "modules") continue;
        const src = join(discordApp, f);
        const dst = join(outDir, f);
        try { cpSync(src, dst, { recursive: true }); } catch (e) { }
    }

    const outModules = join(outDir, "modules");
    mkdirSync(outModules, { recursive: true });

    const discordModules = join(discordApp, "modules");
    if (existsSync(discordModules)) {
        for (const mod of readdirSync(discordModules)) {
            const src = join(discordModules, mod);
            if (!statSync(src).isDirectory()) continue;
            const dst = join(outModules, mod);
            try { cpSync(src, dst, { recursive: true }); } catch (e) { }
        }
    }

    const outRes = join(outDir, "resources");
    mkdirSync(outRes, { recursive: true });

    const buildInfoSrc = join(discordRes, "build_info.json");
    if (existsSync(buildInfoSrc)) {
        const buildInfo = JSON.parse(readFileSync(buildInfoSrc, "utf8"));
        buildInfo.newUpdater = false;
        buildInfo.disableUpdater = true;
        // Garder "stable" : l'API modules Discord (/modules/zcord/…) n'existe pas (404).
        // Isolation des données via setPath(userData) → dossier Data à côté de Zcord.exe.
        buildInfo.releaseChannel = "stable";
        writeFileSync(join(outRes, "build_info.json"), JSON.stringify(buildInfo, null, 2));
    }

    const bootstrapSrc = join(discordRes, "bootstrap");
    const bootstrapDst = join(outRes, "bootstrap");
    mkdirSync(bootstrapDst, { recursive: true });
    if (existsSync(bootstrapSrc)) {
        cpSync(bootstrapSrc, bootstrapDst, { recursive: true });
    }
    // Générer les zip bootstrap depuis les modules locaux (sinon splash « installing-updates » échoue)
    try {
        const { execFileSync } = require("child_process");
        const modsRoot = join(outDir, "modules");
        if (existsSync(modsRoot)) {
            for (const mod of readdirSync(modsRoot)) {
                const m = mod.match(/^(discord_.+)-\d+$/);
                if (!m) continue;
                const modName = m[1];
                const modDir = join(modsRoot, mod);
                const inner = readdirSync(modDir).find(n => statSync(join(modDir, n)).isDirectory());
                const zipSrc = inner ? join(modDir, inner) : modDir;
                const zipPath = join(bootstrapDst, `${modName}.zip`);
                try { if (existsSync(zipPath)) rmSync(zipPath, { force: true }); } catch (_) {}
                execFileSync("powershell", [
                    "-NoProfile", "-Command",
                    `Compress-Archive -Path '${zipSrc.replace(/'/g, "''")}\\*' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force`
                ], { stdio: "ignore" });
            }
            console.log("[zcord] bootstrap/*.zip générés depuis modules/");
        }
    } catch (e) {
        console.warn("[zcord] Génération bootstrap zip ignorée:", e.message);
    }
    syncBootstrapManifest(bootstrapDst);

    console.log("[zcord] Préparation de _app.asar...");
    let appAsarSrc = join(discordRes, "_app.asar");
    if (!existsSync(appAsarSrc)) appAsarSrc = join(discordRes, "app.asar");

    if (existsSync(appAsarSrc)) {
        cpSync(appAsarSrc, join(outRes, "_app.asar"), { recursive: statSync(appAsarSrc).isDirectory() });
    }

    // Ne jamais créer un dossier nommé app.asar (Electron le prendrait pour l'app)
    const badAppAsarDir = join(outRes, "app.asar");
    try {
        if (existsSync(badAppAsarDir) && statSync(badAppAsarDir).isDirectory()) {
            rmSync(badAppAsarDir, { recursive: true, force: true });
        }
    } catch (_) {}

    const outApp = join(outRes, "app");
    mkdirSync(outApp, { recursive: true });
    writeFileSync(join(outApp, "package.json"), JSON.stringify({ name: "zcord", main: "index.js", version: "1.26.2" }, null, 2));
    const hostLoader = join(__dirname, "scripts", "zcord-host-loader.js");
    if (!existsSync(hostLoader)) throw new Error("scripts/zcord-host-loader.js manquant");
    cpSync(hostLoader, join(outApp, "index.js"));

    // Isolation : modules + userData dans exeDir/Data uniquement (pas %AppData%/discord).
    const outDist = join(outApp, "dist", "desktop");
    mkdirSync(outDist, { recursive: true });
    const equicordDist = join(__dirname, "dist", "desktop");

    for (const f of ["patcher.js", "preload.js", "renderer.js", "renderer.css", "renderer.js.LEGAL.txt"]) {
        if (existsSync(join(equicordDist, f))) cpSync(join(equicordDist, f), join(outDist, f));
    }

    // Vues zcord://static/… (first-launch, about, …)
    const staticSrc = join(__dirname, "static");
    if (existsSync(staticSrc)) {
        cpSync(staticSrc, join(outApp, "static"), { recursive: true });
        console.log("[zcord] static/ copié dans resources/app/static");
    }

    const zcordPreload = join(__dirname, "zcord-preload.js");
    if (existsSync(zcordPreload)) {
        cpSync(zcordPreload, join(outDist, "preload.js"));
    } else if (existsSync(join(__dirname, "dist", "desktop", "preload.js"))) {
        cpSync(join(__dirname, "dist", "desktop", "preload.js"), join(outDist, "preload.js"));
    }

    // FFmpeg et YT-DLP (cherche dans le dossier local ou PATH)
    const binDir = join(__dirname, "static", "bin");
    for (const bin of ["ffmpeg.exe", "yt-dlp.exe"]) {
        const localBin = join(binDir, bin);
        if (existsSync(localBin)) cpSync(localBin, join(outDir, bin));
    }

    // Curseurs macOS (utilises par le plugin CursorMacOS) -> resourcesPath/mac/mac/...
    // native.ts cherche via process.resourcesPath, qui pointe vers outDir/resources (asar: false)
    const macCursorsSrc = join(__dirname, "mac");
    if (existsSync(macCursorsSrc)) {
        console.log("[zcord] Copie des curseurs macOS...");
        cpSync(macCursorsSrc, join(outRes, "mac"), { recursive: true });
    } else {
        console.warn("[zcord] ATTENTION: dossier 'mac' introuvable a la racine, le plugin CursorMacOS ne fonctionnera pas dans le build package.");
    }

    const discordExe = join(outDir, "Discord.exe");
    const zcordExe = join(outDir, "Zcord.exe");
    // Pas d'inject-discord.ps1 : Zcord s'installe via Zcord-Setup.exe (AppData\\Programs\\Zcord).

    const iconSrc = existsSync(join(__dirname, "static", "icon.ico"))
        ? join(__dirname, "static", "icon.ico")
        : join(__dirname, "zcord.ico");

    if (existsSync(iconSrc)) {
        cpSync(iconSrc, join(outDir, "app.ico"));
        cpSync(iconSrc, join(__dirname, "zcord.ico"));
    }

    if (existsSync(discordExe)) {
        try {
            if (existsSync(zcordExe)) rmSync(zcordExe, { force: true });
            renameSync(discordExe, zcordExe);
        } catch (e) {
            console.warn("[zcord] Rename Discord.exe -> Zcord.exe failed:", e.message);
        }
    }
    // Un seul exe visible — pas de doublon Discord.exe
    if (existsSync(discordExe) && existsSync(zcordExe)) {
        try { rmSync(discordExe, { force: true }); } catch (_) {}
    }

    // Ne JAMAIS modifier Zcord.exe avec rcedit : ça casse la signature Discord
    // et Windows Smart App Control / WDAC bloque alors le lancement.
    // L'icône Z passe par un raccourci .lnk à côté de l'exe.
    // Installateur uniquement — pas de scripts portable dans le dossier build (usage interne dev).
        const exePath = existsSync(zcordExe) ? zcordExe : discordExe;
        if (existsSync(exePath)) {
            const iconForLnk = existsSync(join(outDir, "app.ico"))
                ? join(outDir, "app.ico")
                : (existsSync(iconSrc) ? iconSrc : exePath);
            const desktop = getDesktopPath();
            const targets = [
                join(outDir, "Zcord.lnk"),
                join(process.env.APPDATA || "", "Microsoft", "Windows", "Start Menu", "Programs", "Zcord.lnk"),
            ];
            if (desktop && existsSync(join(desktop, ".."))) targets.push(join(desktop, "Zcord.lnk"));
            for (const lnk of targets) {
                try {
                    createZcordShortcut(exePath, iconForLnk, lnk, outDir);
                } catch (e) {
                    console.warn("[zcord] shortcut failed:", lnk, e.message);
                }
            }
            console.log("[zcord] Raccourcis Zcord.lnk (icone Z + menu Demarrer)");
            console.log("[zcord] Distribue: release\\Zcord-Setup.exe (pas le dossier zcord-dist)");
        }
    } catch (e) {
        console.warn("[zcord] Création du raccourci .lnk échouée:", e.message);
    }

    try {
        const sig = execSync(
            `powershell -NoProfile -Command "(Get-AuthenticodeSignature '${existsSync(zcordExe) ? zcordExe : discordExe}').Status"`,
            { encoding: "utf8" }
        ).trim();
        console.log(`[zcord] Signature Authenticode: ${sig}`);
        if (sig !== "Valid") {
            console.warn("[zcord] ATTENTION: EXE non signé — Smart App Control peut bloquer le lancement.");
        }
    } catch (_) {}

    console.log(`[zcord] Build terminé -> ${outDir}`);
    console.log(`[zcord] Lance: ${join(outDir, "Zcord.lnk")}  (ou Zcord.exe)`);
}

function obfuscateDesktop() {
    // Obfuscation légère pour la protection intellectuelle de base sans casser les perfs
    const obfArgs = ["--compact", "true", "--simplify", "true", "--string-array", "true"];
    const files = ["patcher.js", "preload.js", "renderer.js"];
    for (const f of files) {
        const fp = join(__dirname, "dist", "desktop", f);
        if (!existsSync(fp)) continue;
        try { execSync(`npx javascript-obfuscator "${fp}" --output "${fp}" ${obfArgs.join(" ")}`, { stdio: "ignore" }); } catch (e) { }
    }
}

// ─── Execution du build ───────────────────────────────────────────────────────

killZcord();
const discord = findDiscordApp();
buildEquicord();
// obfuscateDesktop(); // Optionnel pour l'open source
buildZcordFromDiscord(discord);

module.exports = {
    appId: "com.zcord.app",
    productName: "Zcord",
    executableName: "Zcord",
    copyright: "Copyright 2026 Zcord",
    extraMetadata: { main: "index.js" },
    asar: false,
    files: ["index.js", "dist/desktop/**/*", "!**/*.map", "!**/*.ts"],
    directories: { output: "release", buildResources: "desktop/assets" },
    win: {
        target: [{ target: "dir", arch: ["x64"] }],
        icon: "static/icon.ico",
        requestedExecutionLevel: "asInvoker"
    }
};
