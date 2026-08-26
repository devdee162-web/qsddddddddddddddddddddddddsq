/**
 * Prepend globalPaths fix to dist/desktop/preload.js (preload.ts compilé + fix modules Discord).
 * Remplace l'ancien zcord-preload.js monolithique — API VencordNative complète pour tous les users.
 */
const { existsSync, readFileSync, writeFileSync } = require("fs");
const { join } = require("path");

const ROOT = join(__dirname, "..");
const PRELOAD = join(ROOT, "dist", "desktop", "preload.js");
const FIX = join(__dirname, "globalPaths-fix.js");

if (!existsSync(PRELOAD)) {
    console.warn("[patch-preload] dist/desktop/preload.js absent — skip");
    process.exit(0);
}

const fix = readFileSync(FIX, "utf8");
const body = readFileSync(PRELOAD, "utf8");

if (body.includes("module_data resolution fix")) {
    process.exit(0);
}

writeFileSync(PRELOAD, `${fix}\n${body}`, "utf8");
console.log("[patch-preload] globalPaths fix → dist/desktop/preload.js");
