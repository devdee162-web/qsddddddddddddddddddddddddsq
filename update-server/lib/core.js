/**
 * Logique MAJ Zcord — partagée API (client C) + app bureau
 */
const { execSync, spawn } = require("child_process");
const crypto = require("crypto");
const {
    existsSync, readFileSync, writeFileSync, mkdirSync,
    statSync, copyFileSync
} = require("fs");
const { join } = require("path");

const ROOT = join(__dirname, "..", "..");
const DATA_DIR = join(__dirname, "..", "data");
const DATA = join(DATA_DIR, "db.json");
const UPLOADS = join(DATA_DIR, "uploads");
const RELEASE_DIR = join(ROOT, "release");

mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(UPLOADS, { recursive: true });

function loadDb() {
    if (!existsSync(DATA)) {
        return {
            settings: {
                autoCheck: true,
                checkIntervalHours: 6,
                maintenanceStart: "02:00",
                maintenanceEnd: "05:00",
                githubOwner: "devdee162-web",
                githubRepo: "qsddddddddddddddddddddddddsq"
            },
            releases: [],
            history: [],
            logs: [],
            reports: []
        };
    }
    return JSON.parse(readFileSync(DATA, "utf8"));
}

function saveDb(db) {
    writeFileSync(DATA, JSON.stringify(db, null, 2), "utf8");
}

function log(db, level, message, meta = {}) {
    db.logs.unshift({
        id: crypto.randomUUID(),
        level,
        message,
        meta,
        at: new Date().toISOString()
    });
    db.logs = db.logs.slice(0, 500);
}

function sha256File(p) {
    return crypto.createHash("sha256").update(readFileSync(p)).digest("hex");
}

function getPublished(db) {
    return db.releases.find(r => r.status === "published") || null;
}

function syncFromReleaseFolder(db) {
    const updateJson = join(RELEASE_DIR, "update.json");
    const setup = join(RELEASE_DIR, "Zcord-Setup.exe");
    const pkg = join(ROOT, "package.json");
    if (!existsSync(updateJson) || !existsSync(setup)) return;

    const update = JSON.parse(readFileSync(updateJson, "utf8"));
    const ver = (update.version || "").replace(/^v/i, "");
    const pkgVer = existsSync(pkg) ? JSON.parse(readFileSync(pkg, "utf8")).version : ver;
    const version = ver || pkgVer;
    const tag = version.startsWith("v") ? version : `v${version}`;

    let rel = db.releases.find(r => r.version === tag);
    if (!rel) {
        rel = {
            id: crypto.randomUUID(),
            name: `Zcord ${tag}`,
            version: tag,
            type: "minor",
            status: "published",
            notes: "",
            setupUrl: update.setupUrl,
            manifestUrl: update.manifestUrl,
            fileSize: statSync(setup).size,
            sha256: sha256File(setup),
            createdAt: new Date().toISOString(),
            publishedAt: new Date().toISOString()
        };
        db.releases.unshift(rel);
        log(db, "info", `Sync release ${tag} depuis release/`);
    } else {
        rel.setupUrl = update.setupUrl;
        rel.manifestUrl = update.manifestUrl;
        rel.fileSize = statSync(setup).size;
        rel.sha256 = sha256File(setup);
        rel.status = "published";
        rel.publishedAt = new Date().toISOString();
    }
}

function getStats() {
    const db = loadDb();
    syncFromReleaseFolder(db);
    saveDb(db);
    const published = getPublished(db);
    const pending = db.releases.filter(r => r.status === "draft" || r.status === "scheduled");
    const success = db.history.filter(h => h.result === "success").length;
    const failed = db.history.filter(h => h.result === "failed").length;
    const pendingCount = pending.length;
    const installed = success || (published ? 1 : 0);
    return {
        availableUpdates: pendingCount,
        systemHealth: published ? (pendingCount ? 75 : 100) : 60,
        lastCheck: db.logs.find(l => l.message.includes("check"))?.at || new Date().toISOString(),
        freedSpaceGb: 2.4,
        published: published?.version || null,
        counts: { success, failed, pending: pendingCount, installed, failedCount: failed }
    };
}

function getUpdates() {
    const db = loadDb();
    syncFromReleaseFolder(db);
    saveDb(db);
    return db.releases;
}

function createUpdate(body) {
    const db = loadDb();
    const { name, version, type, notes, autoCheck, autoBackup } = body;
    if (!version) throw new Error("version requise");
    const tag = version.startsWith("v") ? version : `v${version}`;
    const rel = {
        id: crypto.randomUUID(),
        name: name || `Zcord ${tag}`,
        version: tag,
        type: type || "minor",
        status: "draft",
        notes: notes || "",
        autoCheck: !!autoCheck,
        autoBackup: autoBackup !== false,
        setupUrl: "",
        manifestUrl: "",
        fileSize: 0,
        sha256: "",
        createdAt: new Date().toISOString()
    };
    db.releases.unshift(rel);
    log(db, "info", `Brouillon cree: ${tag}`, { id: rel.id });
    saveDb(db);
    return rel;
}

function uploadReleaseFile(id, sourcePath) {
    const db = loadDb();
    const rel = db.releases.find(r => r.id === id);
    if (!rel || !sourcePath || !existsSync(sourcePath)) throw new Error("fichier introuvable");

    const ext = sourcePath.toLowerCase().endsWith(".exe") ? ".exe" : ".zip";
    const dest = join(UPLOADS, `${rel.id}${ext}`);
    copyFileSync(sourcePath, dest);
    rel.packagePath = dest;
    rel.fileSize = statSync(dest).size;
    rel.sha256 = sha256File(dest);
    log(db, "info", `Fichier upload pour ${rel.version}`, { size: rel.fileSize });
    saveDb(db);
    return rel;
}

function resolvePnpmCmd() {
    const appdata = process.env.APPDATA || "";
    const local = process.env.LOCALAPPDATA || "";
    const tries = [
        "pnpm",
        join(appdata, "npm", "pnpm.cmd"),
        join(local, "pnpm", "pnpm.exe"),
        "npx pnpm"
    ];
    for (const cmd of tries) {
        try {
            execSync(`"${cmd}" --version`, { stdio: "pipe", shell: true, timeout: 15000 });
            return cmd;
        } catch {}
    }
    return null;
}

function runShell(cmd, cwd) {
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, [], {
            cwd,
            shell: true,
            stdio: "inherit",
            env: { ...process.env, FORCE_COLOR: "1" }
        });
        child.on("error", reject);
        child.on("close", code => {
            if (code === 0) resolve();
            else reject(new Error(`Commande echouee (code ${code}): ${cmd}`));
        });
    });
}

function publishUpdate(id) {
    const db = loadDb();
    const rel = db.releases.find(r => r.id === id);
    if (!rel) throw new Error("introuvable");

    return publishUpdateAsync(id).catch(e => {
        const db2 = loadDb();
        log(db2, "error", `Echec publish: ${e.message}`);
        db2.history.unshift({
            id: crypto.randomUUID(),
            version: rel.version,
            action: "publish",
            result: "failed",
            detail: e.message,
            at: new Date().toISOString()
        });
        saveDb(db2);
        throw e;
    });
}

async function publishUpdateAsync(id) {
    const db = loadDb();
    const rel = db.releases.find(r => r.id === id);
    if (!rel) throw new Error("introuvable");

    const pkg = join(ROOT, "package.json");
    const pkgJson = JSON.parse(readFileSync(pkg, "utf8"));
    pkgJson.version = rel.version.replace(/^v/i, "");
    writeFileSync(pkg, JSON.stringify(pkgJson, null, 2) + "\n");

    const setupOut = join(RELEASE_DIR, "Zcord-Setup.exe");
    const hasUpload = rel.packagePath && existsSync(rel.packagePath);

    log(db, "info", `Publish ${rel.version}...`);
    saveDb(db);

    if (hasUpload) {
        mkdirSync(RELEASE_DIR, { recursive: true });
        copyFileSync(rel.packagePath, setupOut);
        log(db, "info", "Setup upload copie vers release/");
        saveDb(db);
        await runShell("node scripts/publish-release.cjs --upload", ROOT);
    } else if (existsSync(setupOut) && statSync(setupOut).size > 20 * 1024 * 1024) {
        log(db, "info", "Setup existant — upload GitHub sans rebuild");
        saveDb(db);
        await runShell("node scripts/publish-release.cjs --upload", ROOT);
    } else {
        const pnpm = resolvePnpmCmd();
        if (!pnpm) {
            throw new Error("pnpm introuvable — installe-le ou uploade un Zcord-Setup.exe");
        }
        await runShell(`"${pnpm}" run buildInstaller:full`, ROOT);
        await runShell("node scripts/publish-release.cjs --upload", ROOT);
    }

    syncFromReleaseFolder(db);
    for (const r of db.releases) {
        if (r.id !== rel.id && r.status === "published") r.status = "archived";
    }
    rel.status = "published";
    rel.publishedAt = new Date().toISOString();
    db.history.unshift({
        id: crypto.randomUUID(),
        version: rel.version,
        action: "publish",
        result: "success",
        at: new Date().toISOString()
    });
    log(db, "success", `Publie sur GitHub: ${rel.version}`);
    saveDb(db);
    return { ok: true, release: rel };
}

function unpublishUpdate(id) {
    const db = loadDb();
    const rel = db.releases.find(r => r.id === id);
    if (!rel) throw new Error("introuvable");
    rel.status = "draft";
    log(db, "warn", `Depublie: ${rel.version}`);
    saveDb(db);
    return rel;
}

function checkUpdate(localVersion) {
    const db = loadDb();
    syncFromReleaseFolder(db);
    saveDb(db);

    const local = (localVersion || "0.0.0").replace(/^v/i, "");
    const published = getPublished(db);
    log(db, "info", `Check client v${local}`);

    if (!published) return { available: false, version: local };

    const remote = published.version.replace(/^v/i, "");
    const parse = v => v.split(".").map(n => parseInt(n, 10) || 0);
    const l = parse(local), r = parse(remote);
    let newer = false;
    for (let i = 0; i < 3; i++) {
        if ((r[i] || 0) > (l[i] || 0)) { newer = true; break; }
        if ((r[i] || 0) < (l[i] || 0)) break;
    }

    const setupPath = join(RELEASE_DIR, "Zcord-Setup.exe");
    const setupUrl = published.setupUrl
        || `https://github.com/${db.settings.githubOwner}/${db.settings.githubRepo}/releases/latest/download/Zcord-Setup.exe`;

    return {
        available: newer || !!published.force,
        force: !!published.force,
        version: published.version,
        name: published.name,
        type: published.type,
        setupUrl,
        manifestUrl: published.manifestUrl,
        notes: published.notes,
        sha256: published.sha256 || (existsSync(setupPath) ? sha256File(setupPath) : ""),
        fileSize: published.fileSize || (existsSync(setupPath) ? statSync(setupPath).size : 0)
    };
}

function reportClient(body) {
    const db = loadDb();
    db.reports.unshift({ id: crypto.randomUUID(), ...body, at: new Date().toISOString() });
    db.reports = db.reports.slice(0, 200);
    if (body.status === "success") {
        db.history.unshift({
            id: crypto.randomUUID(),
            version: body.version,
            action: "client_install",
            result: "success",
            at: new Date().toISOString()
        });
    }
    log(db, "info", `Client report: ${body.status} ${body.version || ""}`);
    saveDb(db);
    return { ok: true };
}

function getHistory() { return loadDb().history; }
function getLogs() { return loadDb().logs.slice(0, 100); }
function getReports() { return loadDb().reports.slice(0, 50); }
function getSettings() { return loadDb().settings; }

function saveSettings(body) {
    const db = loadDb();
    db.settings = { ...db.settings, ...body };
    saveDb(db);
    return db.settings;
}

function init() {
    const db = loadDb();
    syncFromReleaseFolder(db);
    saveDb(db);
}

module.exports = {
    init,
    getStats,
    getUpdates,
    createUpdate,
    uploadReleaseFile,
    publishUpdate,
    unpublishUpdate,
    checkUpdate,
    reportClient,
    getHistory,
    getLogs,
    getReports,
    getSettings,
    saveSettings,
    UPLOADS,
    RELEASE_DIR
};
