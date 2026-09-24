/**
 * Download prebuilt arrpc-bun binaries into static/dist/
 * (needed for afterPack + build-independent — not committed, *.exe is gitignored)
 */
const { existsSync, mkdirSync, createWriteStream, unlinkSync, renameSync } = require("fs");
const { join } = require("path");
const { pipeline } = require("stream/promises");
const { Readable } = require("stream");

const ROOT = join(__dirname, "..");
const OUT_DIR = join(ROOT, "static", "dist");
const REPO = "Creationsss/arrpc-bun";
const DEFAULT_TAG = process.env.ARRPC_TAG || "v1.4.0";

/** Maps release asset → static/dist name expected by afterPack / arrpc/index.ts */
const ASSETS = [
    { asset: "arrpc-bun-windows-x64.exe", dest: "arrpc-windows-x64.exe" },
    { asset: "arrpc-bun-linux-x64", dest: "arrpc-linux-x64" },
    { asset: "arrpc-bun-linux-arm64", dest: "arrpc-linux-arm64" },
    { asset: "arrpc-bun-darwin-x64", dest: "arrpc-darwin-x64" },
    { asset: "arrpc-bun-darwin-arm64", dest: "arrpc-darwin-arm64" },
];

function neededForHost() {
    const { platform, arch } = process;
    if (platform === "win32") return ASSETS.filter(a => a.dest.includes("windows"));
    if (platform === "linux") return ASSETS.filter(a => a.dest.includes(`linux-${arch === "arm64" ? "arm64" : "x64"}`));
    if (platform === "darwin") return ASSETS.filter(a => a.dest.includes(`darwin-${arch === "arm64" ? "arm64" : "x64"}`));
    return [];
}

async function download(url, dest) {
    const tmp = `${dest}.tmp`;
    if (existsSync(tmp)) {
        try { unlinkSync(tmp); } catch (_) { }
    }

    // curl est plus fiable que fetch+pipeline vers NTFS (exit silencieux observé)
    const { spawnSync } = require("child_process");
    if (process.platform !== "win32") {
        const r = spawnSync("curl", ["-fsSL", "-L", "--retry", "3", "-o", tmp, url], { stdio: "inherit" });
        if (r.status !== 0) throw new Error(`curl failed (${r.status}) for ${url}`);
    } else {
        const res = await fetch(url, { redirect: "follow" });
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
        await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
    }

    if (existsSync(dest)) unlinkSync(dest);
    renameSync(tmp, dest);
    if (process.platform !== "win32") {
        try { require("fs").chmodSync(dest, 0o755); } catch (_) { }
    }
}

async function main() {
    const force = process.argv.includes("--force");
    const all = process.argv.includes("--all");
    const list = all ? ASSETS : neededForHost();
    if (!list.length) {
        console.warn("[arrpc] No binary mapping for", process.platform, process.arch);
        return;
    }

    mkdirSync(OUT_DIR, { recursive: true });
    const tag = DEFAULT_TAG;
    const base = `https://github.com/${REPO}/releases/download/${tag}`;

    for (const { asset, dest } of list) {
        const out = join(OUT_DIR, dest);
        if (existsSync(out) && !force) {
            console.log(`[arrpc] OK (cached) ${dest}`);
            continue;
        }
        const url = `${base}/${asset}`;
        console.log(`[arrpc] Download ${asset} → ${dest}…`);
        await download(url, out);
        console.log(`[arrpc] Wrote ${out}`);
    }
}

main().catch(err => {
    console.error("[arrpc]", err.message || err);
    process.exit(1);
});
