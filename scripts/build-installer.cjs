/**
 * Build Zcord-Setup.exe (Inno Setup) from release/zcord-dist
 */
const { execSync } = require("child_process");
const {
    existsSync, mkdirSync, rmSync, cpSync, readdirSync, statSync
} = require("fs");
const { join } = require("path");

const ROOT = join(__dirname, "..");
const PKG_VERSION = require(join(ROOT, "package.json")).version;
const DIST = join(ROOT, "release", "zcord-dist");
const STAGING = join(ROOT, "release", "zcord-staging");
const ISS = join(__dirname, "installer", "zcord.iss");
const OUT = join(ROOT, "release", "Zcord-Setup.exe");

/** Fichiers/dossiers utilisateur ou outils dev — pas dans l'installateur */
const SKIP_NAMES = new Set([
    "Data",
    "ZcordData",
    "Zcord",
    "Discord.exe",
    "Install Zcord.bat",
    "Launch Zcord.bat",
    "portable-setup.ps1",
    "Setup Shortcut.ps1",
]);

function shouldSkip(name) {
    if (SKIP_NAMES.has(name)) return true;
    if (name.endsWith(".lnk")) return true;
    return false;
}

function copyTree(src, dst) {
    mkdirSync(dst, { recursive: true });
    for (const ent of readdirSync(src)) {
        if (shouldSkip(ent)) continue;
        const s = join(src, ent);
        const d = join(dst, ent);
        const st = statSync(s);
        if (st.isDirectory()) copyTree(s, d);
        else cpSync(s, d);
    }
}

function ensureDist() {
    if (existsSync(join(DIST, "Zcord.exe"))) return;
    console.log("[installer] zcord-dist absent — build en cours...");
    execSync("node electron-builder.config.cjs", { cwd: ROOT, stdio: "inherit" });
    if (!existsSync(join(DIST, "Zcord.exe"))) {
        throw new Error("Build echoue: Zcord.exe introuvable dans release/zcord-dist");
    }
}

function prepareStaging() {
    console.log("[installer] Preparation du paquet propre...");
    if (existsSync(STAGING)) rmSync(STAGING, { recursive: true, force: true });
    copyTree(DIST, STAGING);

    const iconDst = join(STAGING, "app.ico");
    if (!existsSync(iconDst)) {
        const iconSrc = join(ROOT, "static", "icon.ico");
        if (existsSync(iconSrc)) cpSync(iconSrc, iconDst);
    }

    const exe = join(STAGING, "Zcord.exe");
    if (!existsSync(exe)) throw new Error("Staging invalide: Zcord.exe manquant");
    console.log("[installer] Staging OK ->", STAGING);
}

async function compileInstaller() {
    let compile;
    try {
        compile = require("innosetup-compiler");
    } catch {
        throw new Error("Installe innosetup-compiler: npx pnpm add -D innosetup-compiler");
    }

    console.log("[installer] Compilation Inno Setup (peut prendre plusieurs minutes)...");
    await compile(ISS, {
        gui: false,
        verbose: true,
        DMyAppVersion: PKG_VERSION
    });
}

async function main() {
    ensureDist();
    prepareStaging();
    await compileInstaller();

    if (existsSync(OUT)) {
        const mb = (statSync(OUT).size / (1024 * 1024)).toFixed(1);
        if (process.env.ZCORD_CERT_FILE) {
            console.log("[installer] Signature Authenticode...");
            execSync(
                `powershell -NoProfile -ExecutionPolicy Bypass -File "${join(__dirname, "sign-windows.ps1")}"`,
                { cwd: ROOT, stdio: "inherit" }
            );
        }
        console.log("");
        console.log("========================================");
        console.log(`  Zcord-Setup.exe pret (${mb} Mo)`);
        console.log(`  ${OUT}`);
        console.log("========================================");
    } else {
        console.warn("[installer] Compile termine mais Zcord-Setup.exe introuvable dans release/");
    }
}

main().catch(err => {
    console.error("[installer]", err.message || err);
    process.exit(1);
});
