/**
 * Dev local : build plugins + sync dans release/zcord-dist + lance Zcord.exe
 * N’upload rien sur GitHub — usage développeur uniquement.
 */
const { execSync, spawn } = require("child_process");
const { existsSync } = require("fs");
const { join } = require("path");

const ROOT = join(__dirname, "..");
const EXE = join(ROOT, "release", "zcord-dist", "Zcord.exe");

function run(cmd, label) {
    console.log(`\n[dev:zcord] ${label}...`);
    execSync(cmd, { cwd: ROOT, stdio: "inherit", shell: true });
}

function main() {
    run("npx pnpm run buildStandalone:dev", "Build plugins (standalone --dev)");
    execSync("node scripts/sync-dev-dist.cjs", { cwd: ROOT, stdio: "inherit" });

    if (!existsSync(EXE)) {
        console.error("[dev:zcord] Zcord.exe introuvable après sync.");
        process.exit(1);
    }

    console.log("\n[dev:zcord] Lancement Zcord.exe — section Zcord + Plugins dans Réglages\n");
    const child = spawn(EXE, [], { cwd: join(ROOT, "release", "zcord-dist"), stdio: "inherit", detached: true });
    child.unref();
}

main();
