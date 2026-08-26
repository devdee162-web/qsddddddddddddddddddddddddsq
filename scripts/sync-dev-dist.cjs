/**
 * Sync dist/desktop → release/zcord-dist/resources/app/dist/desktop
 * Pour tester les plugins en local sans republier une release.
 */
const { existsSync, mkdirSync, cpSync, readdirSync, statSync } = require("fs");
const { join } = require("path");
const { execSync } = require("child_process");

const ROOT = join(__dirname, "..");
const SRC = join(ROOT, "dist", "desktop");
const DST = join(ROOT, "release", "zcord-dist", "resources", "app", "dist", "desktop");
const EXE = join(ROOT, "release", "zcord-dist", "Zcord.exe");

const FILES = ["patcher.js", "preload.js", "renderer.js", "renderer.css", "renderer.js.LEGAL.txt"];

function main() {
    if (!existsSync(SRC)) {
        console.error("[dev] dist/desktop absent — lance: npx pnpm run buildStandalone");
        process.exit(1);
    }

    execSync("node scripts/patch-desktop-preload.cjs", { cwd: ROOT, stdio: "inherit" });

    if (!existsSync(EXE)) {
        console.log("[dev] release/zcord-dist absent — build electron-builder...");
        execSync("node electron-builder.config.cjs", { cwd: ROOT, stdio: "inherit" });
    }

    mkdirSync(DST, { recursive: true });

    let n = 0;
    for (const f of FILES) {
        const s = join(SRC, f);
        if (!existsSync(s)) continue;
        cpSync(s, join(DST, f));
        n++;
        console.log(`[dev] ${f} (${(statSync(s).size / 1024 / 1024).toFixed(1)} Mo)`);
    }

    // Source maps utiles en dev
    for (const ent of readdirSync(SRC)) {
        if (!ent.endsWith(".map")) continue;
        cpSync(join(SRC, ent), join(DST, ent));
    }

    console.log(`[dev] ${n} fichiers sync → ${DST}`);
    console.log("[dev] Relance Zcord.exe pour charger les plugins.");
}

main();
