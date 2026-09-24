/**
 * Applique static/icon.ico sur zcord.exe (évite l'atome Electron en barre des tâches).
 * Usage: node scripts/patch-electron-icon.cjs
 */
const { copyFileSync, existsSync, writeFileSync } = require("fs");
const { join, dirname } = require("path");

const ROOT = join(__dirname, "..");

async function main() {
    const icon = join(ROOT, "static", "icon.ico");
    if (!existsSync(icon)) {
        console.error("[patch-icon] Manquant:", icon);
        process.exit(1);
    }

    const exePath = require(join(ROOT, "node_modules", "electron"));
    const distDir = dirname(exePath);
    const electronExe = join(distDir, "electron.exe");
    const zcordExe = join(distDir, "zcord.exe");

    if (!existsSync(electronExe)) {
        console.error("[patch-icon] electron.exe introuvable:", electronExe);
        process.exit(1);
    }

    // Repartir d'une copie propre (le fichier cible ne doit pas être verrouillé)
    copyFileSync(electronExe, zcordExe);
    console.log("[patch-icon] Copié electron.exe → zcord.exe");

    const { rcedit } = await import("rcedit");
    await rcedit(zcordExe, {
        icon,
        "version-string": {
            ProductName: "Zcord",
            FileDescription: "Zcord",
            CompanyName: "Zcord",
            InternalName: "Zcord",
            OriginalFilename: "Zcord.exe",
        },
        "product-version": "1.26.9",
        "file-version": "1.26.9",
    });
    console.log("[patch-icon] Icône appliquée →", zcordExe);

    // Faire pointer require('electron') vers zcord.exe
    const pkgDir = join(ROOT, "node_modules", "electron");
    writeFileSync(join(pkgDir, "path.txt"), "zcord.exe");
    try {
        const realPkg = dirname(require.resolve("electron/package.json"));
        writeFileSync(join(realPkg, "path.txt"), "zcord.exe");
    } catch { /* */ }

    console.log("[patch-icon] OK — path.txt → zcord.exe");
}

main().catch(e => {
    console.error("[patch-icon]", e);
    process.exit(1);
});
