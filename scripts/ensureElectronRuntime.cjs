/**
 * Garantit un runtime Electron natif pour process.platform.
 * Utile quand node_modules/electron contient un build Windows
 * (projet sur partition NTFS montée sous Linux).
 *
 * Cache: ~/.cache/zcord/electron-runtime/<platform>-<arch>/
 * (évite d'écrire un gros binaire ELF sur NTFS pendant le extract)
 */
const {
    existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, cpSync, chmodSync,
} = require("fs");
const { join, dirname, basename, resolve } = require("path");
const { homedir, tmpdir } = require("os");
const { execFileSync, spawnSync } = require("child_process");

const ROOT = join(__dirname, "..");

function electronPkgDir() {
    return dirname(require.resolve("electron/package.json", { paths: [ROOT] }));
}

function expectedBinaryName(platform = process.platform) {
    if (platform === "win32") return "electron.exe";
    if (platform === "darwin") return "Electron.app/Contents/MacOS/Electron";
    return "electron";
}

function runtimeCacheDir(platform = process.platform, arch = process.arch) {
    const base = process.env.XDG_CACHE_HOME || join(homedir(), ".cache");
    return join(base, "zcord", "electron-runtime", `${platform}-${arch}`);
}

function looksLikeNativeBinary(binPath) {
    if (!binPath || !existsSync(binPath)) return false;
    const base = basename(binPath).toLowerCase();
    if (process.platform === "win32") {
        return base.endsWith(".exe");
    }
    if (base.endsWith(".exe")) return false;
    return true;
}

function extractZip(zipPath, destDir) {
    mkdirSync(destDir, { recursive: true });
    // extract-zip est fragile ici (process exit silencieux) → unzip / PowerShell
    if (process.platform === "win32") {
        execFileSync(
            "powershell",
            ["-NoProfile", "-Command", `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`],
            { stdio: "inherit" }
        );
        return;
    }
    const unzip = spawnSync("unzip", ["-o", "-q", zipPath, "-d", destDir], { stdio: "inherit" });
    if (unzip.status === 0) return;
    // fallback extract-zip
    const extract = require("extract-zip");
    return extract(zipPath, { dir: resolve(destDir) });
}

/**
 * @returns {Promise<{ distDir: string, electronPath: string, source: "bundled"|"cache" }>}
 */
async function ensureNativeElectronRuntime() {
    const pkgDir = electronPkgDir();
    const { version } = require(join(pkgDir, "package.json"));
    const bundledPath = require(join(pkgDir, "index.js"));

    if (looksLikeNativeBinary(bundledPath)) {
        return {
            distDir: dirname(bundledPath),
            electronPath: bundledPath,
            source: "bundled",
        };
    }

    const cacheDir = runtimeCacheDir();
    const relBin = expectedBinaryName();
    const cachedBin = join(cacheDir, relBin);
    const stamp = join(cacheDir, ".zcord-electron-version");

    if (existsSync(cachedBin) && existsSync(stamp) && readFileSync(stamp, "utf8").trim() === version) {
        return { distDir: cacheDir, electronPath: cachedBin, source: "cache" };
    }

    console.log(`[electron-runtime] node_modules/electron est pour une autre plateforme (${basename(bundledPath)})`);
    console.log(`[electron-runtime] Téléchargement Electron ${version} (${process.platform}-${process.arch})…`);

    const { downloadArtifact } = require("@electron/get");
    const zipPath = await downloadArtifact({
        version,
        artifactName: "electron",
        platform: process.platform,
        arch: process.arch,
        cacheRoot: process.env.electron_config_cache || join(homedir(), ".cache", "electron"),
    });
    console.log(`[electron-runtime] zip: ${zipPath}`);

    const tmpExtract = join(tmpdir(), `zcord-electron-${process.platform}-${process.arch}-${Date.now()}`);
    try {
        await Promise.resolve(extractZip(zipPath, tmpExtract));
        if (!existsSync(join(tmpExtract, relBin.split("/")[0]))) {
            throw new Error(`Extraction incomplète: ${tmpExtract}`);
        }
        if (existsSync(cacheDir)) {
            try { rmSync(cacheDir, { recursive: true, force: true }); } catch (_) { }
        }
        mkdirSync(dirname(cacheDir), { recursive: true });
        cpSync(tmpExtract, cacheDir, { recursive: true });
    } finally {
        try { rmSync(tmpExtract, { recursive: true, force: true }); } catch (_) { }
    }

    writeFileSync(stamp, version, "utf8");

    if (!existsSync(cachedBin)) {
        throw new Error(`Electron extrait mais binaire manquant: ${cachedBin}`);
    }

    if (process.platform !== "win32") {
        try { chmodSync(cachedBin, 0o755); } catch (_) { }
    }

    console.log(`[electron-runtime] OK → ${cachedBin}`);
    return { distDir: cacheDir, electronPath: cachedBin, source: "cache" };
}

module.exports = {
    ensureNativeElectronRuntime,
    expectedBinaryName,
    runtimeCacheDir,
    looksLikeNativeBinary,
};
