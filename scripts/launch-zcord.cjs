/**
 * Lance Zcord installé / packagé.
 * Windows : .lnk + explorer
 * Linux   : binaire zcord (release ou ~/.local/share/zcord)
 * macOS   : binaire zcord dans release/
 */
const { spawn, execSync } = require("child_process");
const { existsSync, writeFileSync, rmSync, chmodSync } = require("fs");
const { join } = require("path");
const { tmpdir, homedir } = require("os");
const { getZcordInstallDir, getZcordBinaryName } = require("./zcordPaths.cjs");

const ROOT = join(__dirname, "..");
const isWin = process.platform === "win32";
const binName = getZcordBinaryName();

function findExe() {
    const candidates = [
        join(getZcordInstallDir(), binName),
        join(ROOT, "release", "zcord-dist", binName),
    ];
    if (isWin) {
        candidates.unshift(join(process.env.LOCALAPPDATA || "", "Programs", "Zcord", "Zcord.exe"));
    }
    for (const p of candidates) {
        if (p && existsSync(p)) return p;
    }
    return null;
}

function makeLnk(exe, install, ico, lnkPath) {
    const vbs = join(tmpdir(), `zcord-launch-${Date.now()}.vbs`);
    const esc = s => String(s).replace(/"/g, '""');
    writeFileSync(vbs, [
        'Set sh = CreateObject("WScript.Shell")',
        `Set sc = sh.CreateShortcut("${esc(lnkPath)}")`,
        `sc.TargetPath = "${esc(exe)}"`,
        `sc.WorkingDirectory = "${esc(install)}"`,
        `sc.IconLocation = "${esc(ico)},0"`,
        'sc.Description = "Zcord"',
        "sc.Save",
    ].join("\r\n"));
    try {
        execSync(`cscript //nologo "${vbs}"`, { stdio: "ignore" });
    } finally {
        try { rmSync(vbs, { force: true }); } catch (_) { }
    }
}

const exe = findExe();
if (!exe) {
    console.error(`[launch] ${binName} introuvable.`);
    console.error("Lance: node scripts/build-independent.cjs");
    process.exit(1);
}

const install = join(exe, "..");
const icoWin = existsSync(join(install, "app.ico")) ? join(install, "app.ico") : exe;

if (isWin) {
    const lnk = join(install, "Zcord.lnk");
    makeLnk(exe, install, icoWin, lnk);
    makeLnk(exe, install, icoWin, join(process.env.APPDATA || "", "Microsoft", "Windows", "Start Menu", "Programs", "Zcord.lnk"));
    makeLnk(exe, install, icoWin, join(process.env.USERPROFILE || homedir(), "Desktop", "Zcord.lnk"));

    console.log("[launch] explorer →", lnk);
    const child = spawn("explorer.exe", [lnk], { detached: true, stdio: "ignore" });
    child.unref();
    console.log("[launch] Si rien ne s'ouvre: double-clique le raccourci Bureau Zcord.lnk");
} else {
    try { chmodSync(exe, 0o755); } catch (_) { }
    console.log("[launch] →", exe);
    const child = spawn(exe, process.platform === "linux" ? ["--no-sandbox"] : [], {
        cwd: install,
        detached: true,
        stdio: "ignore",
        env: {
            ...process.env,
            ZCORD_DISCORD_HOST: "0",
        },
    });
    child.unref();
    console.log("[launch] Zcord démarré en arrière-plan.");
}
