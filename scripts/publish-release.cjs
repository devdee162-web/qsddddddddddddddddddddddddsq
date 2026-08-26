/**
 * Release GitHub: build + fichiers individuels + upload optionnel (gh cli)
 *
 * Usage:
 *   node scripts/publish-release.cjs          — prepare release/ locally
 *   node scripts/publish-release.cjs --upload — prepare + gh release create/upload
 */
const { execSync, spawnSync } = require("child_process");
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
const UPDATE_JSON = join(RELEASE, "update.json");
const { owner, repo } = require(join(ROOT, "GITHUB.json"));

const UPLOAD = process.argv.includes("--upload");
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

function collectUploadPaths() {
    const paths = [SETUP, UPDATE_JSON, MANIFEST_OUT];
    if (existsSync(UPDATE_ASSETS)) {
        for (const f of readdirSync(UPDATE_ASSETS)) {
            paths.push(join(UPDATE_ASSETS, f));
        }
    }
    return paths.filter(p => existsSync(p));
}

function ghAvailable() {
    const r = spawnSync("gh", ["--version"], { encoding: "utf8", shell: true });
    return r.status === 0;
}

function uploadToGithub(tag) {
    if (!ghAvailable()) {
        console.error("[publish] GitHub CLI (gh) introuvable.");
        console.error("  Installe: winget install GitHub.cli");
        console.error("  Puis: gh auth login");
        process.exit(1);
    }

    const allFiles = collectUploadPaths();
    if (!allFiles.length) {
        console.error("[publish] Aucun fichier a uploader.");
        process.exit(1);
    }

    const core = [SETUP, UPDATE_JSON, MANIFEST_OUT].filter(p => existsSync(p));
    const assets = allFiles.filter(p => !core.includes(p));

    const view = spawnSync("gh", ["release", "view", tag, "-R", `${owner}/${repo}`], {
        encoding: "utf8",
        shell: true
    });
    const releaseExists = view.status === 0;

    console.log(`[publish] Upload GitHub ${tag} — ${core.length} core + ${assets.length} assets`);

    if (!releaseExists) {
        console.log("[publish] Premiere release — Setup + manifests (assets MAJ au prochain publish)");
        const create = spawnSync(
            "gh",
            [
                "release", "create", tag,
                ...core,
                "--title", tag,
                "--notes", `Zcord ${tag}\n\nInstall: Zcord-Setup.exe\nMAJ auto via GitHub Releases.`,
                "-R", `${owner}/${repo}`
            ],
            { cwd: ROOT, stdio: "inherit", shell: true }
        );
        if (create.status !== 0) process.exit(create.status ?? 1);
    } else {
        const upCore = spawnSync(
            "gh",
            ["release", "upload", tag, ...core, "--clobber", "-R", `${owner}/${repo}`],
            { cwd: ROOT, stdio: "inherit", shell: true }
        );
        if (upCore.status !== 0) process.exit(upCore.status ?? 1);
    }

    if (assets.length && releaseExists) {
        const BATCH = 40;
        for (let i = 0; i < assets.length; i += BATCH) {
            const batch = assets.slice(i, i + BATCH);
            console.log(`[publish] Assets ${i + 1}-${Math.min(i + BATCH, assets.length)} / ${assets.length}`);
            const up = spawnSync(
                "gh",
                ["release", "upload", tag, ...batch, "--clobber", "-R", `${owner}/${repo}`],
                { cwd: ROOT, stdio: "inherit", shell: true }
            );
            if (up.status !== 0) process.exit(up.status ?? 1);
        }
    }

    console.log(`[publish] OK — ${REPO_URL}/releases/tag/${tag}`);
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
    const toPublish = changed.length ? changed : Object.entries(files);

    for (const [rel, meta] of toPublish) {
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

    writeFileSync(UPDATE_JSON, JSON.stringify({
        version: tag,
        setupUrl: `${RELEASE_BASE}/Zcord-Setup.exe`,
        manifestUrl: `${RELEASE_BASE}/files-manifest.json`,
        files: updateFiles
    }, null, 2), "utf8");

    const setupMb = (statSync(SETUP).size / (1024 * 1024)).toFixed(1);
    const patchMb = (totalBytes / (1024 * 1024)).toFixed(1);

    console.log("");
    console.log("========================================");
    console.log(`  GitHub: ${REPO_URL}/releases`);
    console.log(`  Tag: ${tag}`);
    console.log(`  - Zcord-Setup.exe (${setupMb} Mo)`);
    console.log(`  - update.json + files-manifest.json`);
    console.log(`  - ${toPublish.length} fichiers MAJ (${patchMb} Mo)`);
    console.log("========================================");

    if (UPLOAD) {
        uploadToGithub(tag);
    } else {
        console.log("");
        console.log("  Upload:");
        console.log("  node scripts/publish-release.cjs --upload");
        console.log("  (requiert: gh auth login)");
    }
}

main();
