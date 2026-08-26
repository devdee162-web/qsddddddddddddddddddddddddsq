/**
 * Release GitHub: Setup + fichiers individuels (sans ZIP)
 */
const { execSync } = require("child_process");
const crypto = require("crypto");
const {
    existsSync, statSync, writeFileSync, rmSync,
    mkdirSync, readdirSync, readFileSync, cpSync
} = require("fs");
const { join, dirname } = require("path");

const ROOT = join(__dirname, "..");
const RELEASE = join(ROOT, "release");
const DIST = join(RELEASE, "zcord-dist");
const STAGING = join(RELEASE, "zcord-staging");
const UPDATE_ASSETS = join(RELEASE, "update-assets");
const SETUP = join(RELEASE, "Zcord-Setup.exe");
const MANIFEST_OUT = join(RELEASE, "files-manifest.json");
const MANIFEST_PREV = join(RELEASE, "files-manifest.prev.json");
const { owner, repo } = require(join(ROOT, "GITHUB.json"));

const REPO_URL = `https://github.com/${owner}/${repo}`;
const RELEASE_BASE = `${REPO_URL}/releases/latest/download`;

const SKIP = new Set([
    "Data", "ZcordData", "Zcord", "Discord.exe",
    "Install Zcord.bat", "Launch Zcord.bat",
    "portable-setup.ps1", "Setup Shortcut.ps1"
]);

function sha256File(p) {
    return crypto.createHash("sha256").update(readFileSync(p)).digest("hex");
}

function assetName(relPath) {
    return "f_" + relPath.replace(/[/\\]/g, "__");
}

function copyTree(src, dst) {
    mkdirSync(dst, { recursive: true });
    for (const ent of readdirSync(src)) {
        if (SKIP.has(ent) || ent.endsWith(".lnk")) continue;
        const s = join(src, ent);
        const d = join(dst, ent);
        if (statSync(s).isDirectory()) copyTree(s, d);
        else cpSync(s, d);
    }
}

function walkManifest(dir, base = "") {
    const files = {};
    for (const ent of readdirSync(dir)) {
        if (SKIP.has(ent)) continue;
        const s = join(dir, ent);
        const rel = (base ? `${base}/${ent}` : ent).replace(/\\/g, "/");
        if (statSync(s).isDirectory()) {
            Object.assign(files, walkManifest(s, rel));
        } else {
            files[rel] = { sha256: sha256File(s), size: statSync(s).size };
        }
    }
    return files;
}

function main() {
    if (!existsSync(SETUP)) {
        console.log("[publish] Build Zcord-Setup.exe...");
        execSync("node scripts/build-installer.cjs", { cwd: ROOT, stdio: "inherit" });
    }

    if (existsSync(STAGING)) rmSync(STAGING, { recursive: true, force: true });
    if (!existsSync(join(DIST, "Zcord.exe"))) {
        execSync("node electron-builder.config.cjs", { cwd: ROOT, stdio: "inherit" });
    }
    copyTree(DIST, STAGING);

    const ver = require(join(ROOT, "package.json")).version;
    const tag = ver.startsWith("v") ? ver : `v${ver}`;

    const files = walkManifest(STAGING);
    const manifest = { version: tag, files };
    writeFileSync(MANIFEST_OUT, JSON.stringify(manifest, null, 2), "utf8");
    console.log(`[publish] Manifest: ${Object.keys(files).length} fichiers`);

    let prevFiles = {};
    if (existsSync(MANIFEST_PREV)) {
        try { prevFiles = JSON.parse(readFileSync(MANIFEST_PREV, "utf8")).files ?? {}; } catch {}
    }

    const changed = Object.entries(files).filter(
        ([p, m]) => !prevFiles[p] || prevFiles[p].sha256 !== m.sha256
    );

    if (existsSync(UPDATE_ASSETS)) rmSync(UPDATE_ASSETS, { recursive: true, force: true });
    mkdirSync(UPDATE_ASSETS, { recursive: true });

    const updateFiles = {};
    let totalBytes = 0;

    for (const [rel, meta] of changed) {
        const src = join(STAGING, rel.replace(/\//g, "\\"));
        const asset = assetName(rel);
        const dst = join(UPDATE_ASSETS, asset);
        cpSync(src, dst);
        updateFiles[rel] = {
            sha256: meta.sha256,
            size: meta.size,
            url: `${RELEASE_BASE}/${asset}`
        };
        totalBytes += meta.size;
    }

    writeFileSync(MANIFEST_PREV, JSON.stringify(manifest, null, 2), "utf8");

    writeFileSync(join(RELEASE, "update.json"), JSON.stringify({
        version: tag,
        setupUrl: `${RELEASE_BASE}/Zcord-Setup.exe`,
        manifestUrl: `${RELEASE_BASE}/files-manifest.json`,
        files: updateFiles
    }, null, 2), "utf8");

    const setupMb = (statSync(SETUP).size / (1024 * 1024)).toFixed(1);
    const patchMb = (totalBytes / (1024 * 1024)).toFixed(1);

    console.log("");
    console.log("========================================");
    console.log(`  Publie sur GitHub: ${REPO_URL}/releases`);
    console.log(`  - Zcord-Setup.exe (${setupMb} Mo)  [1ere install]`);
    console.log("  - files-manifest.json");
    console.log("  - update.json");
    console.log(`  - update-assets/ (${changed.length} fichiers, ${patchMb} Mo)`);
    console.log(`  Tag: ${tag}`);
    console.log("");
    console.log("  gh release create " + tag + " \\");
    console.log("    release/Zcord-Setup.exe \\");
    console.log("    release/update.json \\");
    console.log("    release/files-manifest.json \\");
    console.log("    release/update-assets/*");
    console.log("========================================");
}

main();
