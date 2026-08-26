/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { app } from "electron";
import { BrowserWindow } from "electron/main";
import { join } from "path";
import { SplashProps } from "shared/browserWinProperties";
import { STATIC_DIR } from "shared/paths";

import { createWindows } from "./mainWindow";
import { Settings, State } from "./settings";
import { makeLinksOpenExternally } from "./utils/makeLinksOpenExternally";
import { loadView } from "./vesktopStatic";

export function createFirstLaunchTour() {
    const win = new BrowserWindow({
        ...SplashProps,
        title: `Zcord Installer v${app.getVersion()}`,
        transparent: false,
        frame: true,
        alwaysOnTop: false,
        autoHideMenuBar: true,
        useContentSize: true,
        backgroundColor: "#111214",
        ...(process.platform === "win32"
            ? { icon: join(STATIC_DIR, "icon.ico") }
            : process.platform === "linux"
              ? { icon: join(STATIC_DIR, "icon.png") }
              : {}),
        height: 400,
        width: 600
    });

    makeLinksOpenExternally(win);

    loadView(win, "first-launch.html", new URLSearchParams({
        APP_VERSION: app.getVersion(),
        t: String(Date.now())
    }));

    win.webContents.addListener("console-message", e => {
        const msg = e.message;
        if (msg === "cancel") return app.exit();
        if (!msg.startsWith("install:")) return;

        const data = JSON.parse(msg.slice(8)) as {
            action: string;
            branch: "stable" | "ptb" | "canary";
        };

        State.store.firstLaunch = false;
        Settings.store.discordBranch = data.branch || "stable";
        win.close();
        createWindows();
    });
}
