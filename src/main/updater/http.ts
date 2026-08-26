/*
 * Zcord HTTP updater — MAJ auto fichier par fichier (sans ZIP)
 */

import { app, BrowserWindow, ipcMain } from "electron";
import { existsSync, rmSync } from "original-fs";
import { join } from "path";
import { IpcEvents } from "@shared/IpcEvents";
import { serializeErrors } from "./common";
import {
    applyFileUpdates,
    downloadReleaseFile,
    fetchFilesManifest,
    getNeededFiles,
    getOfficialUpdateUrl,
    isAutoUpdateEnabled,
    REPO_URL,
    resolveLatestRelease,
    runSetupInstaller,
    type ReleaseInfo
} from "./zcordRelease";

let pending: ReleaseInfo | null = null;
let pendingLocalPath: string | null = null;
let isApplying = false;
let autoUpdateRunning = false;

function notifyRenderer(status: string, detail: string) {
    for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send(IpcEvents.ZCORD_UPDATE_STATUS, status, detail);
    }
}

async function fetchUpdates(): Promise<boolean> {
    const release = await resolveLatestRelease();
    if (!release) return false;
    pending = release;
    return true;
}

async function getUpdates() {
    try {
        const outdated = await fetchUpdates();
        if (!outdated || !pending) return [];
        const label = pending.kind === "files" ? "fichiers" : "setup";
        return [{
            hash: pending.version,
            author: "Zcord",
            message: `Mise a jour ${label} : ${pending.version}`
        }];
    } catch (err) {
        console.warn("[Zcord] Update check skipped:", err instanceof Error ? err.message : err);
        return [];
    }
}

async function downloadUpdate(): Promise<boolean> {
    if (!pending) {
        const ok = await fetchUpdates();
        if (!ok || !pending) return false;
    }
    if (pending.kind === "files") return true;

    const dest = join(app.getPath("temp"), `zcord-update-${Date.now()}-${pending.fileName}`);
    await downloadReleaseFile(pending, dest);
    pendingLocalPath = dest;
    return true;
}

async function applyUpdate(): Promise<boolean> {
    if (!pending) throw new Error("Aucune MAJ en attente");
    if (isApplying) return false;
    isApplying = true;

    try {
        if (pending.kind === "files") {
            await applyFileUpdates(pending.manifest, pending.fileMap, (cur, tot, file) => {
                notifyRenderer("downloading", `${cur}/${tot}`);
                console.log(`[Zcord] MAJ ${cur}/${tot}: ${file}`);
            });
            pending = null;
            pendingLocalPath = null;
            setImmediate(() => app.relaunch());
            setImmediate(() => app.quit());
            return true;
        }

        const localPath = pendingLocalPath;
        if (!localPath || !existsSync(localPath)) {
            throw new Error("Setup introuvable — reessaie");
        }
        await runSetupInstaller(localPath);
        try { rmSync(localPath, { force: true }); } catch {}
        pending = null;
        pendingLocalPath = null;
        setImmediate(() => app.quit());
        return true;
    } finally {
        isApplying = false;
    }
}

async function runSilentAutoUpdate(): Promise<void> {
    if (autoUpdateRunning || isApplying || !isAutoUpdateEnabled()) return;
    autoUpdateRunning = true;

    try {
        const release = await resolveLatestRelease();
        if (!release) return;

        pending = release;
        notifyRenderer("checking", release.version);

        if (release.kind === "files") {
            const manifest = release.manifest ?? await fetchFilesManifest();
            if (manifest) {
                const needed = getNeededFiles(manifest);
                if (needed.length === 0) {
                    console.log("[Zcord] Deja a jour");
                    pending = null;
                    return;
                }
                console.log(`[Zcord] ${needed.length} fichier(s) a mettre a jour`);
                notifyRenderer("downloading", `${needed.length} fichiers`);
            }
        } else {
            notifyRenderer("downloading", release.version);
            await downloadUpdate();
        }

        notifyRenderer("installing", release.version);
        await applyUpdate();
    } catch (e) {
        console.warn("[Zcord] MAJ auto:", e instanceof Error ? e.message : e);
        notifyRenderer("error", e instanceof Error ? e.message : String(e));
    } finally {
        autoUpdateRunning = false;
    }
}

function startBackgroundUpdater() {
    if (process.platform !== "win32") return;
    const run = () => { runSilentAutoUpdate().catch(() => {}); };
    setTimeout(run, 20_000);
    setInterval(run, 6 * 60 * 60 * 1000);
}

ipcMain.handle(IpcEvents.GET_REPO, serializeErrors(() => REPO_URL));
ipcMain.handle(IpcEvents.GET_UPDATES, serializeErrors(getUpdates));
ipcMain.handle(IpcEvents.UPDATE, serializeErrors(downloadUpdate));
ipcMain.handle(IpcEvents.BUILD, serializeErrors(applyUpdate));

app.whenReady().then(startBackgroundUpdater);

export { getOfficialUpdateUrl };
export {
    applyFileUpdates,
    applyPendingUpdateSync,
    downloadReleaseFile,
    isAllowedUpdateUrl,
    resolveLatestRelease,
    runSetupInstaller
} from "./zcordRelease";
