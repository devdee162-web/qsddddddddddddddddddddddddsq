/**
 * Sync client indépendant → release/zcord-dist + install locale
 * - dist/js → resources/app/dist/js
 * - dist/zcord.asar → resources/zcord.asar
 */
const { existsSync, mkdirSync, cpSync, readdirSync, statSync } = require("fs");
const { join } = require("path");
const { execSync } = require("child_process");

const ROOT = join(__dirname, "..");
const JS_SRC = join(ROOT, "dist", "js");
const ZCORD_ASAR = join(ROOT, "dist", "zcord.asar");
const DIST_ROOT = join(ROOT, "release", "zcord-dist");
const EXE = join(DIST_ROOT, "Zcord.exe");
const INSTALL = join(process.env.LOCALAPPDATA || "", "Programs", "Zcord");

function copyJs(destApp) {
    const dest = join(destApp, "dist", "js");
    mkdirSync(dest, { recursive: true });
    let n = 0;
    for (const f of readdirSync(JS_SRC)) {
        if (f.endsWith(".map")) continue;
        const s = join(JS_SRC, f);
        if (!statSync(s).isFile()) continue;
        cpSync(s, join(dest, f));
        n++;
        console.log(`[dev] js/${f} (${(statSync(s).size / 1024).toFixed(0)} Ko)`);
    }
    return n;
}

function copyStatic(destApp) {
    const src = join(ROOT, "static");
    if (!existsSync(src)) return 0;
    const dest = join(destApp, "static");
    cpSync(src, dest, { recursive: true });
    return 1;
}

function syncTree(label, root) {
    if (!existsSync(join(root, "Zcord.exe"))) {
        console.warn(`[dev] skip ${label}: pas de Zcord.exe`);
        return;
    }
    // Refuse d'écraser un vieux host Discord sans migration claire
    const hostAsar = join(root, "resources", "_app.asar");
    const appDir = join(root, "resources", "app");
    if (existsSync(hostAsar) && !existsSync(join(appDir, "dist", "js", "main.js"))) {
        console.warn(`[dev] ${label} est encore un host Discord — rebuild indépendant requis:`);
        console.warn("      node electron-builder.config.cjs");
        return;
    }

    mkdirSync(appDir, { recursive: true });
    const n = copyJs(appDir);
    copyStatic(appDir);

    // package.json entry
    const pkgSrc = join(ROOT, "package.json");
    const pkgDst = join(appDir, "package.json");
    if (existsSync(pkgSrc)) {
        const pkg = JSON.parse(require("fs").readFileSync(pkgSrc, "utf8"));
        require("fs").writeFileSync(pkgDst, JSON.stringify({
            name: "zcord",
            version: pkg.version,
            main: "dist/js/main.js",
        }, null, 2));
    }

    if (existsSync(ZCORD_ASAR)) {
        cpSync(ZCORD_ASAR, join(root, "resources", "zcord.asar"));
        console.log(`[dev] zcord.asar → ${label}`);
    }

    // arRPC (Rich Presence / YTMDesktop Discord plugin)
    const platformName = process.platform === "win32" ? "windows" : process.platform;
    const archName = process.arch === "arm64" ? "arm64" : "x64";
    const arrpcSrcName = `arrpc-${platformName}-${archName}${process.platform === "win32" ? ".exe" : ""}`;
    let arrpcSrc = join(ROOT, "static", "dist", arrpcSrcName);
    if (!existsSync(arrpcSrc)) {
        try {
            execSync("node scripts/fetch-arrpc.cjs", { cwd: ROOT, stdio: "inherit" });
        } catch (_) { }
        arrpcSrc = join(ROOT, "static", "dist", arrpcSrcName);
    }
    if (existsSync(arrpcSrc)) {
        const arrpcDir = join(root, "resources", "arrpc");
        mkdirSync(arrpcDir, { recursive: true });
        const destName = process.platform === "win32" ? "arrpc.exe" : "arrpc";
        cpSync(arrpcSrc, join(arrpcDir, destName));
        console.log(`[dev] arrpc → ${label}/resources/arrpc/${destName}`);
    } else {
        console.warn(`[dev] arRPC absent (${arrpcSrcName}) — Rich Presence externe KO`);
    }

    const icon = join(ROOT, "static", "icon.ico");
    if (existsSync(icon)) {
        cpSync(icon, join(root, "app.ico"));
        cpSync(icon, join(root, "resources", "app.ico"));
    }

    console.log(`[dev] ${n} fichiers js sync → ${label}`);
}

function main() {
    if (!existsSync(join(JS_SRC, "main.js"))) {
        console.error("[dev] dist/js absent — lance: pnpm run buildDesktop");
        process.exit(1);
    }
    if (!existsSync(ZCORD_ASAR)) {
        console.error("[dev] dist/zcord.asar absent — lance: pnpm run buildStandalone");
        process.exit(1);
    }

    if (!existsSync(EXE)) {
        console.log("[dev] release/zcord-dist absent — build indépendant...");
        execSync("node electron-builder.config.cjs", { cwd: ROOT, stdio: "inherit" });
    }

    syncTree("release/zcord-dist", DIST_ROOT);
    if (existsSync(join(INSTALL, "Zcord.exe"))) {
        syncTree("install locale", INSTALL);
        try {
            execSync("node scripts/register-zcord-taskbar.cjs", {
                cwd: ROOT,
                stdio: "inherit",
                env: { ...process.env, ZCORD_REPAIR_ONLY: "1" },
            });
        } catch (_) { }
    }

    console.log("[dev] Relance Zcord.exe (client indépendant).");
}

main();
