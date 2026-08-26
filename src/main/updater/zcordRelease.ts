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
    for (const rel of getNeededFiles(manifest)) {
        if (map[rel]) continue;
        const meta = manifest.files[rel];
        if (!meta) continue;
        map[rel] = { ...meta, url: assetUrl(rel) };
    }
    return map;
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
    const update = await fetchUpdateJson();
    let manifest = await fetchFilesManifest();

    if (update?.manifestUrl && isAllowedUpdateUrl(update.manifestUrl)) {
        try {
            manifest = await fetchJson<FilesManifest>(update.manifestUrl, {
                headers: { Accept: "application/json", "User-Agent": VENCORD_USER_AGENT }
            });
        } catch {}
    }

    const ver = (update?.version ?? manifest?.version ?? "").trim();
    if (!ver || !isNewerVersion(CURRENT_VERSION, ver)) return null;

    const tag = ver.startsWith("v") ? ver : `v${ver}`;
    if (manifest) manifest.version = tag;

    if (manifest && (update?.files || Object.keys(manifest.files).length)) {
        const fileMap = buildFileMap(update ?? {}, manifest);
        if (Object.keys(fileMap).length || getNeededFiles(manifest).length) {
            return {
                kind: "files",
                url: "",
                version: tag,
                fileName: "",
                manifest,
                fileMap
            };
        }
    }

    try {
        const data = await githubGet("/releases/latest");
        if (data.tag_name && isNewerVersion(CURRENT_VERSION, data.tag_name)) {
            const setup = pickSetupAsset(data.assets ?? []);
            if (setup) {
                setup.version = data.tag_name;
                if (manifest) setup.manifest = manifest;
                return setup;
            }
        }
    } catch (e) {
        console.warn("[Zcord] GitHub releases/latest:", e instanceof Error ? e.message : e);
    }

    const setupUrl = update?.setupUrl?.trim();
    if (setupUrl && isAllowedUpdateUrl(setupUrl)) {
        return {
            kind: "setup",
            url: setupUrl,
            version: tag,
            fileName: "Zcord-Setup.exe",
            manifest: manifest ?? { version: tag, files: {} },
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
    fileMap: Record<string, FileEntry>
): Promise<{ needsRestart: boolean }> {
    const root = getInstallRoot();
    const needed = getNeededFiles(manifest, root);
    if (!needed.length) return { needsRestart: false };

    const stagingDir = join(app.getPath("temp"), "zcord-file-update-staging");
    try { rmSync(stagingDir, { recursive: true, force: true }); } catch {}
    mkdirSync(stagingDir, { recursive: true });

    let needsRestart = false;
    let applied = 0;

    for (const rel of needed) {
        const entry = fileMap[rel] ?? manifest.files[rel];
        if (!entry?.sha256) {
            console.warn("[Zcord] Pas d'URL pour:", rel);
            continue;
        }
        const fullEntry = { ...entry, url: entry.url ?? assetUrl(rel) };

        let tmp: string | null = null;
        try {
            tmp = await downloadOneFile(rel, fullEntry);
        } catch (e) {
            console.warn("[Zcord] Echec", rel, e instanceof Error ? e.message : e);
            continue;
        }

        const dest = join(root, rel.replace(/\//g, "\\"));
        const locked = LOCKED_FILES.has(basename(rel));

        if (locked) {
            copyIntoStaging(stagingDir, rel, tmp);
            needsRestart = true;
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
        throw new Error(`${remaining.length} fichier(s) restant(s) — republie la release`);
    }

    if (needsRestart && existsSync(stagingDir) && readdirSync(stagingDir).length) {
        stageForRestart(stagingDir, manifest.version);
    }

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
        const child = spawn(setupPath, SETUP_SILENT_ARGS, {
            detached: true,
            stdio: "ignore",
            windowsHide: true
        });
        child.on("error", reject);
        child.unref();
        setTimeout(resolve, 2000);
    });
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

if (process.platform === "win32") {
    applyPendingUpdateSync();
}
