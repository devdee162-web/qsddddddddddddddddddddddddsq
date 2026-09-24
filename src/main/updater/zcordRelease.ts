/*
 * MAJ Zcord — fichiers individuels (sans ZIP) + Setup 1ere install
 */

import { fetchJson, downloadToFile } from "../utils/http";
import { VENCORD_USER_AGENT } from "@shared/vencordUserAgent";
import { app } from "electron";
import { createHash } from "crypto";
import { spawn } from "child_process";
import { basename, dirname, join } from "path";
import {
    copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync,
    rmSync, statSync, writeFileSync
} from "original-fs";
import { owner as GITHUB_OWNER, repo as GITHUB_REPO } from "../../../GITHUB.json";

declare const VERSION: string;

export const CURRENT_VERSION = `v${VERSION}`;

export { GITHUB_OWNER, GITHUB_REPO };
export const REPO_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}`;
export const GITHUB_API = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}`;
export const RELEASE_BASE = `${REPO_URL}/releases/latest/download`;

export const SETUP_ASSETS = ["Zcord-Setup.exe", "Zcord-Installer.exe"];
export const MANIFEST_ASSET = "files-manifest.json";

export const DIRECT_SETUP_URLS = [
    `${RELEASE_BASE}/Zcord-Setup.exe`,
];

export const UPDATE_JSON_URLS = [
    `${RELEASE_BASE}/update.json`,
];

export const MANIFEST_URLS = [
    `${RELEASE_BASE}/${MANIFEST_ASSET}`,
];

export const SETUP_SILENT_ARGS = [
    "/VERYSILENT",
    "/SUPPRESSMSGBOXES",
    "/NORESTART",
    "/CLOSEAPPLICATIONS",
    "/RESTARTAPPLICATIONS",
    "/SP-"
];

const MIN_SETUP_BYTES = 20 * 1024 * 1024;
const SKIP_MERGE = new Set(["Data", "ZcordData", "Zcord"]);
const LOCKED_FILES = new Set(["Zcord.exe", "Discord.exe"]);
/** Toujours appliquer au redemarrage — preload charge par Electron, remplacement a chaud echoue souvent */
const RESTART_FILES = new Set(["resources/app/dist/desktop/preload.js"]);

export interface FileEntry {
    sha256: string;
    size: number;
    url?: string;
}

export interface FilesManifest {
    version: string;
    files: Record<string, FileEntry>;
}

export interface UpdateManifest {
    version?: string;
    setupUrl?: string;
    manifestUrl?: string;
    files?: Record<string, FileEntry>;
}

export interface ReleaseInfo {
    kind: "files" | "setup";
    url: string;
    version: string;
    fileName: string;
    manifest: FilesManifest;
    fileMap: Record<string, FileEntry>;
}

export function assetName(relPath: string): string {
    return "f_" + relPath.replace(/[/\\]/g, "__");
}

export function pathFromAssetName(name: string): string | null {
    if (!name.startsWith("f_")) return null;
    return name.slice(2).replace(/__/g, "/");
}

export function assetUrl(relPath: string): string {
    return `${RELEASE_BASE}/${assetName(relPath)}`;
}

export function getPendingUpdateMarker(): string {
    return join(getInstallRoot(), "Data", "zcord-pending-update.json");
}

export function getInstallRoot(): string {
    const local = process.env.LOCALAPPDATA
        ? join(process.env.LOCALAPPDATA, "Programs", "Zcord")
        : "";
    if (local && existsSync(join(local, "Zcord.exe"))) return local;
    return dirname(process.execPath);
}

/** Deja installe via Setup — MAJ fichier par fichier uniquement */
export function isZcordInstalled(): boolean {
    return existsSync(join(getInstallRoot(), "Zcord.exe"));
}

export function isAllowedUpdateHost(hostname: string): boolean {
    const h = hostname.toLowerCase();
    return (
        h === "github.com"
        || h === "api.github.com"
        || h.endsWith(".githubusercontent.com")
        || h.endsWith(".github.com")
    );
}

export function isAllowedUpdateUrl(url: string): boolean {
    try {
        return isAllowedUpdateHost(new URL(url).hostname);
    } catch {
        return false;
    }
}

export function isNewerVersion(local: string, remote: string): boolean {
    const parse = (v: string) => v.replace(/^v/i, "").split(".").map(n => parseInt(n, 10) || 0);
    const l = parse(local), r = parse(remote);
    for (let i = 0; i < Math.max(l.length, r.length); i++) {
        if ((r[i] ?? 0) > (l[i] ?? 0)) return true;
        if ((r[i] ?? 0) < (l[i] ?? 0)) return false;
    }
    return false;
}

function sha256File(filePath: string): string {
    return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

export function getNeededFiles(manifest: FilesManifest, root = getInstallRoot()): string[] {
    const needed: string[] = [];
    for (const [rel, meta] of Object.entries(manifest.files)) {
        const local = join(root, rel.replace(/\//g, "\\"));
        if (!existsSync(local)) {
            needed.push(rel);
            continue;
        }
        const st = statSync(local);
        if (st.size !== meta.size || sha256File(local) !== meta.sha256) {
            needed.push(rel);
        }
    }
    return needed;
}

async function githubGet<T = any>(endpoint: string): Promise<T> {
    return fetchJson<T>(GITHUB_API + endpoint, {
        headers: {
            Accept: "application/vnd.github+json",
            "User-Agent": VENCORD_USER_AGENT
        }
    });
}

export async function fetchUpdateJson(): Promise<UpdateManifest | null> {
    for (const url of UPDATE_JSON_URLS) {
        if (!isAllowedUpdateUrl(url)) continue;
        try {
            return await fetchJson<UpdateManifest>(url, {
                headers: { Accept: "application/json", "User-Agent": VENCORD_USER_AGENT }
            });
        } catch {
            continue;
        }
    }
    return null;
}

export async function fetchFilesManifest(): Promise<FilesManifest | null> {
    for (const url of MANIFEST_URLS) {
        if (!isAllowedUpdateUrl(url)) continue;
        try {
            const m = await fetchJson<FilesManifest>(url, {
                headers: { Accept: "application/json", "User-Agent": VENCORD_USER_AGENT }
            });
            if (m?.version && m.files) return m;
        } catch {
            continue;
        }
    }
    return null;
}

function buildFileMapFromGithubAssets(
    assets: Array<{ name?: string; browser_download_url?: string; size?: number }>,
    manifest: FilesManifest
): Record<string, FileEntry> {
    const map: Record<string, FileEntry> = {};
    for (const a of assets) {
        if (!a.name || !a.browser_download_url) continue;
        const rel = pathFromAssetName(a.name);
        if (!rel) continue;
        const meta = manifest.files[rel];
        if (!meta?.sha256) continue;
        if (!isAllowedUpdateUrl(a.browser_download_url)) continue;
        map[rel] = {
            sha256: meta.sha256,
            size: meta.size ?? a.size ?? 0,
            url: a.browser_download_url
        };
    }
    return map;
}

function buildFileMap(update: UpdateManifest, manifest: FilesManifest): Record<string, FileEntry> {
    const map: Record<string, FileEntry> = {};
    for (const [rel, meta] of Object.entries(update.files ?? {})) {
        if (!meta?.sha256) continue;
        map[rel] = {
            sha256: meta.sha256,
            size: meta.size,
            url: meta.url && isAllowedUpdateUrl(meta.url) ? meta.url : assetUrl(rel)
        };
    }
    return map;
}

function resolveSetupRelease(
    tag: string,
    ghRelease: { assets?: any[] } | null,
    baseManifest: FilesManifest,
    setupUrl?: string
): ReleaseInfo | null {
    if (ghRelease?.assets?.length) {
        const setup = pickSetupAsset(ghRelease.assets);
        if (setup) {
            setup.version = tag;
            setup.manifest = baseManifest;
            return setup;
        }
    }
    const url = setupUrl?.trim();
    if (url && isAllowedUpdateUrl(url)) {
        return {
            kind: "setup",
            url,
            version: tag,
            fileName: "Zcord-Setup.exe",
            manifest: baseManifest,
            fileMap: {}
        };
    }
    return null;
}

function pickSetupAsset(assets: any[]): ReleaseInfo | null {
    for (const name of SETUP_ASSETS) {
        const a = assets?.find((x: any) => x.name === name);
        if (a?.browser_download_url && isAllowedUpdateUrl(a.browser_download_url)) {
            return {
                kind: "setup",
                url: a.browser_download_url,
                version: "",
                fileName: name,
                manifest: { version: "", files: {} },
                fileMap: {}
            };
        }
    }
    return null;
}

export async function resolveLatestRelease(): Promise<ReleaseInfo | null> {
    let ghRelease: { tag_name?: string; assets?: any[] } | null = null;
    try {
        ghRelease = await githubGet("/releases/latest");
    } catch (e) {
        console.warn("[Zcord] GitHub releases/latest:", e instanceof Error ? e.message : e);
    }

    const update = await fetchUpdateJson();
    let manifest = await fetchFilesManifest();

    if (update?.manifestUrl && isAllowedUpdateUrl(update.manifestUrl)) {
        try {
            manifest = await fetchJson<FilesManifest>(update.manifestUrl, {
                headers: { Accept: "application/json", "User-Agent": VENCORD_USER_AGENT }
            });
        } catch {}
    }

    const ver = (
        update?.version
        ?? manifest?.version
        ?? ghRelease?.tag_name
        ?? ""
    ).trim();
    if (!ver) return null;

    const tag = ver.startsWith("v") ? ver : `v${ver}`;
    const baseManifest: FilesManifest = manifest ?? { version: tag, files: {} };
    baseManifest.version = tag;

    let fileMap = buildFileMap(update ?? {}, baseManifest);
    if (ghRelease?.assets?.length) {
        fileMap = { ...buildFileMapFromGithubAssets(ghRelease.assets, baseManifest), ...fileMap };
    }

    const needed = Object.keys(baseManifest.files).length
        ? getNeededFiles(baseManifest)
        : [];

    const versionOutdated = isNewerVersion(CURRENT_VERSION, tag);
    // Fichiers locaux != manifest (install cassee / sync dev) → proposer MAJ meme si VERSION compilee est a jour
    if (!versionOutdated && !needed.length) return null;

    const deltaNeeded = needed.filter(rel => fileMap[rel]?.sha256);
    const deltaIncomplete = needed.length > 0 && deltaNeeded.length < needed.length;

    if (needed.length) {
        // v1.26.4 → v1.26.6 : le delta GitHub ne couvre que les fichiers modifies entre releases —
        // si des fichiers manquent sur la release, on bascule sur Zcord-Setup.exe.
        if (deltaIncomplete && isZcordInstalled()) {
            const setup = resolveSetupRelease(tag, ghRelease, baseManifest, update?.setupUrl);
            if (setup) {
                console.log(`[Zcord] Delta partiel (${deltaNeeded.length}/${needed.length}) — Setup complet`);
                return setup;
            }
        }

        if (deltaNeeded.length) {
            const neededMap: Record<string, FileEntry> = {};
            for (const rel of deltaNeeded) {
                const entry = fileMap[rel]!;
                neededMap[rel] = { ...entry, url: entry.url ?? assetUrl(rel) };
            }
            return {
                kind: "files",
                url: "",
                version: tag,
                fileName: "",
                manifest: baseManifest,
                fileMap: neededMap
            };
        }

        if (isZcordInstalled()) {
            const setup = resolveSetupRelease(tag, ghRelease, baseManifest, update?.setupUrl);
            if (setup) {
                console.log("[Zcord] Aucun delta applicable — Setup complet");
                return setup;
            }
            console.warn("[Zcord] MAJ fichiers indisponibles — republie les assets sur GitHub");
            return null;
        }
    }

    if (!isZcordInstalled() && ghRelease?.assets?.length) {
        const setup = pickSetupAsset(ghRelease.assets);
        if (setup) {
            setup.version = tag;
            setup.manifest = baseManifest;
            return setup;
        }
    }

    const setupUrl = update?.setupUrl?.trim();
    if (!isZcordInstalled() && setupUrl && isAllowedUpdateUrl(setupUrl)) {
        return {
            kind: "setup",
            url: setupUrl,
            version: tag,
            fileName: "Zcord-Setup.exe",
            manifest: baseManifest,
            fileMap: {}
        };
    }

    return null;
}

function validateSetup(path: string): void {
    if (!existsSync(path)) throw new Error("Fichier introuvable");
    if (statSync(path).size < MIN_SETUP_BYTES) {
        throw new Error(`Setup invalide (${Math.round(statSync(path).size / 1024)} Ko)`);
    }
}

export async function downloadReleaseFile(info: ReleaseInfo, destPath: string): Promise<void> {
    if (info.kind !== "setup") throw new Error("downloadReleaseFile: setup uniquement");
    if (!isAllowedUpdateUrl(info.url)) throw new Error("URL non autorisee");

    let lastErr: unknown;
    for (const url of [info.url, ...DIRECT_SETUP_URLS]) {
        if (!isAllowedUpdateUrl(url)) continue;
        try {
            await downloadToFile(url, destPath, {
                headers: { "User-Agent": VENCORD_USER_AGENT }
            });
            validateSetup(destPath);
            return;
        } catch (e) {
            lastErr = e;
        }
    }
    throw lastErr ?? new Error("Telechargement echoue");
}

async function downloadOneFile(rel: string, entry: FileEntry): Promise<string> {
    const url = entry.url ?? assetUrl(rel);
    if (!isAllowedUpdateUrl(url)) throw new Error(`URL non autorisee: ${rel}`);

    const tmp = join(app.getPath("temp"), `zcord-${Date.now()}-${assetName(rel)}`);
    await downloadToFile(url, tmp, {
        headers: { "User-Agent": VENCORD_USER_AGENT }
    });

    if (!existsSync(tmp)) throw new Error(`Telechargement echoue: ${rel}`);
    const size = statSync(tmp).size;
    if (entry.size && size !== entry.size) {
        rmSync(tmp, { force: true });
        throw new Error(`Taille incorrecte: ${rel}`);
    }
    const hash = sha256File(tmp);
    if (hash !== entry.sha256) {
        rmSync(tmp, { force: true });
        throw new Error(`Hash incorrect: ${rel}`);
    }
    return tmp;
}

function mergeDir(src: string, dest: string) {
    mkdirSync(dest, { recursive: true });
    for (const ent of readdirSync(src, { withFileTypes: true })) {
        if (SKIP_MERGE.has(ent.name)) continue;
        const s = join(src, ent.name);
        const d = join(dest, ent.name);
        if (ent.isDirectory()) mergeDir(s, d);
        else {
            try { copyFileSync(s, d); } catch (e: any) {
                console.warn("[Zcord] MAJ skip:", s, e?.message);
            }
        }
    }
}

function stageForRestart(stagingDir: string, version: string): void {
    const marker = getPendingUpdateMarker();
    mkdirSync(dirname(marker), { recursive: true });
    writeFileSync(marker, JSON.stringify({
        version,
        stagingDir,
        destDir: getInstallRoot(),
        createdAt: Date.now()
    }));
}

function copyIntoStaging(stagingRoot: string, rel: string, tmpPath: string) {
    const dest = join(stagingRoot, rel.replace(/\//g, "\\"));
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(tmpPath, dest);
}

/** Telecharge et applique fichier par fichier — pas de ZIP */
export async function applyFileUpdates(
    manifest: FilesManifest,
    fileMap: Record<string, FileEntry>,
    onProgress?: (current: number, total: number, file: string) => void
): Promise<{ needsRestart: boolean }> {
    const root = getInstallRoot();
    const needed = getNeededFiles(manifest, root);
    const toApply = needed.filter(rel => fileMap[rel]?.sha256);
    if (!toApply.length) {
        if (needed.length) {
            throw new Error("Delta indisponible pour cette version — utilise Zcord-Setup.exe");
        }
        return { needsRestart: false };
    }

    const stagingDir = join(app.getPath("temp"), "zcord-file-update-staging");
    try { rmSync(stagingDir, { recursive: true, force: true }); } catch {}
    mkdirSync(stagingDir, { recursive: true });

    let needsRestart = false;
    let applied = 0;
    const total = toApply.length;

    for (const rel of toApply) {
        onProgress?.(applied + 1, total, rel);
        const entry = fileMap[rel]!;

        let tmp: string | null = null;
        try {
            tmp = await downloadOneFile(rel, { ...entry, url: entry.url ?? assetUrl(rel) });
        } catch (e) {
            console.warn("[Zcord] Echec", rel, e instanceof Error ? e.message : e);
            continue;
        }

        const dest = join(root, rel.replace(/\//g, "\\"));
        const locked = LOCKED_FILES.has(basename(rel));
        const restartOnly = RESTART_FILES.has(rel.replace(/\\/g, "/"));

        if (locked || restartOnly) {
            copyIntoStaging(stagingDir, rel, tmp);
            needsRestart = true;
            if (rel.replace(/\\/g, "/") === "resources/app/dist/desktop/preload.js") {
                copyIntoStaging(stagingDir, "resources/app/dist/desktop/preload.ref.js", tmp);
            }
        } else {
            mkdirSync(dirname(dest), { recursive: true });
            try {
                copyFileSync(tmp, dest);
            } catch {
                copyIntoStaging(stagingDir, rel, tmp);
                needsRestart = true;
            }
        }
        try { rmSync(tmp, { force: true }); } catch {}
        applied++;
    }

    if (applied === 0) {
        throw new Error("Aucun fichier telecharge — verifie la release GitHub");
    }

    const remaining = getNeededFiles(manifest, root);
    if (remaining.length && !needsRestart) {
        console.warn(`[Zcord] ${remaining.length} fichier(s) restant(s) — nouvel essai au prochain cycle`);
    }

    if (needsRestart && existsSync(stagingDir) && readdirSync(stagingDir).length) {
        stageForRestart(stagingDir, manifest.version);
    }

    try {
        const marker = join(getInstallRoot(), "Data", "zcord-version.json");
        mkdirSync(dirname(marker), { recursive: true });
        writeFileSync(marker, JSON.stringify({
            version: manifest.version,
            updatedAt: Date.now()
        }), "utf8");
    } catch {}

    return { needsRestart };
}

export function isAuthenticodeSigned(filePath: string): boolean {
    if (process.platform !== "win32") return false;
    try {
        const { execSync } = require("child_process");
        const out = execSync(
            `powershell -NoProfile -Command "(Get-AuthenticodeSignature -FilePath '${filePath.replace(/'/g, "''")}').Status"`,
            { encoding: "utf8", timeout: 15000 }
        ).trim();
        return out === "Valid";
    } catch {
        return false;
    }
}

export function runSetupInstaller(setupPath: string): Promise<void> {
    validateSetup(setupPath);
    return new Promise((resolve, reject) => {
        if (process.platform !== "win32") {
            reject(new Error("Setup Windows uniquement"));
            return;
        }

        let settled = false;
        const finish = (err?: Error) => {
            if (settled) return;
            settled = true;
            if (err) reject(err);
            else resolve();
        };

        const launchViaPowerShell = () => {
            const { execFile } = require("child_process") as typeof import("child_process");
            const argList = SETUP_SILENT_ARGS.map(a => `'${a}'`).join(",");
            const ps = `Start-Process -FilePath '${setupPath.replace(/'/g, "''")}' -ArgumentList ${argList} -WindowStyle Hidden`;
            execFile("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps], err => {
                if (err) finish(err);
                else {
                    console.log("[Zcord] Setup lance via PowerShell");
                    setTimeout(() => finish(), 3000);
                }
            });
        };

        const child = spawn(setupPath, SETUP_SILENT_ARGS, {
            detached: true,
            stdio: "ignore",
            windowsHide: true
        });

        child.once("error", err => {
            console.warn("[Zcord] spawn Setup echoue:", err.message);
            launchViaPowerShell();
        });

        child.once("spawn", () => {
            if (!child.pid) {
                launchViaPowerShell();
                return;
            }
            console.log("[Zcord] Setup lance (pid", child.pid, ")");
            child.unref();
            setTimeout(() => finish(), 3000);
        });
    });
}

/** Supprime le Setup temporaire apres que Inno Setup a eu le temps de le lire */
export function scheduleSetupCleanup(setupPath: string): void {
    setTimeout(() => {
        try { rmSync(setupPath, { force: true }); } catch {}
    }, 15 * 60 * 1000);
}

export function applyPendingUpdateSync(): void {
    const markerPath = getPendingUpdateMarker();
    if (!existsSync(markerPath)) return;

    let marker: { stagingDir?: string; destDir?: string };
    try {
        marker = JSON.parse(readFileSync(markerPath, "utf-8"));
    } catch {
        try { rmSync(markerPath, { force: true }); } catch {}
        return;
    }

    const { stagingDir, destDir } = marker;
    if (!stagingDir || !destDir || !existsSync(stagingDir)) {
        try { rmSync(markerPath, { force: true }); } catch {}
        return;
    }

    console.log("[Zcord] Application MAJ", stagingDir, "→", destDir);
    try {
        mergeDir(stagingDir, destDir);
    } catch (e: any) {
        console.error("[Zcord] MAJ echouee:", e?.message);
    }

    try { rmSync(markerPath, { force: true }); } catch {}
    try { rmSync(stagingDir, { recursive: true, force: true }); } catch {}
}

export function getOfficialUpdateUrl(): string {
    return DIRECT_SETUP_URLS[0];
}

export function isAutoUpdateEnabled(): boolean {
    const root = getInstallRoot();
    const candidates = [
        join(root, "ZcordData", "settings", "settings.json"),
        join(root, "Data", "ZcordData", "settings", "settings.json"),
        join(root, "Data", "settings", "settings.json"),
    ];
    for (const p of candidates) {
        if (!existsSync(p)) continue;
        try {
            const s = JSON.parse(readFileSync(p, "utf-8"));
            return !s.disableAutoUpdate;
        } catch {}
    }
    return true;
}

/** MAJ auto uniquement pour les installs Zcord reelles — pas dev/electron/release. */
export function shouldRunAutoUpdate(): boolean {
    if (process.platform !== "win32") return false;
    if (!isAutoUpdateEnabled()) return false;

    const exec = process.execPath.replace(/\//g, "\\").toLowerCase();
    if (exec.endsWith("\\electron.exe")) return false;
    if (exec.includes("\\node_modules\\electron\\")) return false;
    if (exec.includes("\\release\\zcord-dist\\")) return false;
    if (exec.includes("\\desktop\\zcord\\")) return false;

    return existsSync(join(getInstallRoot(), "Zcord.exe"));
}

if (process.platform === "win32") {
    applyPendingUpdateSync();
}
