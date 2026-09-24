/**
 * Zcord Update Manager — application bureau (Electron)
 * Pas de navigateur : fenêtre native Windows
 */
const { app, BrowserWindow, ipcMain, dialog, Menu } = require("electron");
const { join } = require("path");
const core = require("../lib/core");
const { createApiApp } = require("../lib/createApiApp");

const PORT = process.env.ZCORD_UPDATE_PORT || 8743;
const UI = join(__dirname, "..", "public");

let mainWindow = null;

let publishing = false;

function registerIpc() {
    ipcMain.handle("stats", () => core.getStats());
    ipcMain.handle("updates-list", () => core.getUpdates());
    ipcMain.handle("updates-create", (_e, body) => core.createUpdate(body));
    ipcMain.handle("updates-upload", (_e, { id, filePath }) => core.uploadReleaseFile(id, filePath));
    ipcMain.handle("updates-publish", async (_e, id) => {
        publishing = true;
        try {
            return await core.publishUpdate(id);
        } finally {
            publishing = false;
        }
    });
    ipcMain.handle("updates-unpublish", (_e, id) => core.unpublishUpdate(id));
    ipcMain.handle("history", () => core.getHistory());
    ipcMain.handle("logs", () => core.getLogs());
    ipcMain.handle("reports", () => core.getReports());
    ipcMain.handle("settings-get", () => core.getSettings());
    ipcMain.handle("settings-save", (_e, body) => core.saveSettings(body));
    ipcMain.handle("pick-file", async () => {
        const r = await dialog.showOpenDialog(mainWindow, {
            title: "Choisir un fichier MAJ",
            filters: [
                { name: "Installateur", extensions: ["exe"] },
                { name: "Archive", extensions: ["zip"] },
                { name: "Tous", extensions: ["*"] }
            ],
            properties: ["openFile"]
        });
        return r.canceled ? null : r.filePaths[0];
    });
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1100,
        minHeight: 700,
        title: "Zcord Update Manager",
        backgroundColor: "#0f1419",
        autoHideMenuBar: true,
        webPreferences: {
            preload: join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false
        }
    });

    Menu.setApplicationMenu(null);
    mainWindow.loadFile(join(UI, "index.html"));

    mainWindow.on("close", (e) => {
        if (publishing) {
            e.preventDefault();
            dialog.showMessageBox(mainWindow, {
                type: "info",
                title: "Publication en cours",
                message: "Ne ferme pas la fenetre — build + upload GitHub en cours (plusieurs minutes)."
            });
        }
    });

    mainWindow.on("closed", () => { mainWindow = null; });
}

function startApiServer() {
    const api = createApiApp();
    api.listen(PORT, "127.0.0.1", () => {
        console.log(`[Zcord] API client C → http://127.0.0.1:${PORT}/api/check`);
    });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.quit();
} else {
    app.on("second-instance", () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });

    app.whenReady().then(() => {
        core.init();
        registerIpc();
        startApiServer();
        createWindow();
    });

    app.on("window-all-closed", () => app.quit());
}
