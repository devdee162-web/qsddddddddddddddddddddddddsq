/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./updater";
import "./ipc";
import "./userAssets";
import "./vesktopProtocol";

import { app, BrowserWindow, nativeTheme } from "electron";

import { DATA_DIR, IS_DISCORD_HOST_PACKAGE } from "./constants";
import { createFirstLaunchTour } from "./firstLaunch";
import { createWindows } from "./mainWindow";
import { registerMediaPermissionsHandler } from "./mediaPermissions";
import { registerScreenShareHandler } from "./screenShare";
import { Settings, State } from "./settings";
import { setAsDefaultProtocolClient } from "./utils/setAsDefaultProtocolClient";
import { isDeckGameMode } from "./utils/steamOS";

export let enableHardwareAcceleration = true;

const alreadyBootstrapped = !!(globalThis as any).__zcordDesktopInit;
(globalThis as any).__zcordDesktopInit = true;

if (!alreadyBootstrapped) {
    console.log("Zcord v" + app.getVersion());
    process.env.Zcord_USER_DATA_DIR = DATA_DIR;
    process.env.ZCORD_USER_DATA_DIR = DATA_DIR;
}

const isLinux = process.platform === "linux";

function init() {
    setAsDefaultProtocolClient("discord");

    const { disableSmoothScroll, hardwareAcceleration, hardwareVideoAcceleration } = Settings.store;
    const { launchArguments } = State.store;

    const enabledFeatures = new Set(app.commandLine.getSwitchValue("enable-features").split(","));
    const disabledFeatures = new Set(app.commandLine.getSwitchValue("disable-features").split(","));
    app.commandLine.removeSwitch("enable-features");
    app.commandLine.removeSwitch("disable-features");

    if (hardwareAcceleration === false || process.argv.includes("--disable-gpu")) {
        enableHardwareAcceleration = false;
        app.disableHardwareAcceleration();
    } else {
        if (hardwareVideoAcceleration) {
            enabledFeatures.add("AcceleratedVideoEncoder");
            enabledFeatures.add("AcceleratedVideoDecoder");

            if (isLinux) {
                enabledFeatures.add("AcceleratedVideoDecodeLinuxGL");
                enabledFeatures.add("AcceleratedVideoDecodeLinuxZeroCopyGL");
            }
        }
    }

    if (disableSmoothScroll) {
        app.commandLine.appendSwitch("disable-smooth-scrolling");
    }

    app.commandLine.appendSwitch("disable-renderer-backgrounding");
    app.commandLine.appendSwitch("disable-background-timer-throttling");
    app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
    if (process.platform === "win32") {
        disabledFeatures.add("CalculateNativeWinOcclusion");
    }

    if (launchArguments) {
        const args = launchArguments.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
        for (const arg of args) {
            const cleanArg = arg.replace(/^["']|["']$/g, "");
            if (cleanArg.startsWith("--")) {
                const eqIndex = cleanArg.indexOf("=");
                if (eqIndex !== -1) {
                    const key = cleanArg.slice(2, eqIndex);
                    const value = cleanArg.slice(eqIndex + 1);
                    app.commandLine.appendSwitch(key, value);
                } else {
                    app.commandLine.appendSwitch(cleanArg.slice(2));
                }
            }
        }
        console.log("Applied launch arguments:", launchArguments);
    }

    app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

    disabledFeatures.add("WinRetrieveSuggestionsOnlyOnDemand");
    disabledFeatures.add("HardwareMediaKeyHandling");
    disabledFeatures.add("MediaSessionService");
    disabledFeatures.add("WebBluetooth");
    disabledFeatures.add("WebBluetoothRemoteGatt");

    app.commandLine.appendSwitch("log-level", "3");

    if (isLinux) {
        app.commandLine.appendSwitch("enable-speech-dispatcher");
    }

    disabledFeatures.forEach(feat => enabledFeatures.delete(feat));

    const enabledFeaturesArray = [...enabledFeatures].filter(Boolean);
    const disabledFeaturesArray = [...disabledFeatures].filter(Boolean);

    if (enabledFeaturesArray.length) {
        app.commandLine.appendSwitch("enable-features", enabledFeaturesArray.join(","));
        console.log("Enabled Chromium features:", enabledFeaturesArray.join(", "));
    }

    if (disabledFeaturesArray.length) {
        app.commandLine.appendSwitch("disable-features", disabledFeaturesArray.join(","));
        console.log("Disabled Chromium features:", disabledFeaturesArray.join(", "));
    }

    if (isDeckGameMode) nativeTheme.themeSource = "dark";

    app.whenReady().then(async () => {
        if (process.platform === "win32") {
            app.setAppUserModelId("com.zcord.app");

            // Dev: electron.exe → enregistrer icon.ico (évite l'atome Electron en taskbar)
            if (process.execPath.toLowerCase().endsWith("electron.exe")) {
                try {
                    const { join } = require("path");
                    const { registerZcordTaskbar } = require(join(app.getAppPath(), "scripts", "register-zcord-taskbar.cjs"));
                    registerZcordTaskbar({
                        appRoot: app.getAppPath(),
                        exePath: process.execPath,
                        iconPath: join(app.getAppPath(), "static", "icon.ico"),
                        arguments: ".",
                        workDir: app.getAppPath(),
                        aumid: "com.zcord.app",
                    });
                } catch (e) {
                    console.warn("[Zcord] taskbar icon:", (e as Error)?.message || e);
                }
            }
        }

        registerScreenShareHandler();
        registerMediaPermissionsHandler();

        bootstrap();

        app.on("activate", () => {
            if (IS_DISCORD_HOST_PACKAGE) return;
            if (BrowserWindow.getAllWindows().length === 0) createWindows();
        });
    });
}

if (!alreadyBootstrapped) init();

async function bootstrap() {
    // Package Discord embarqué : le host ouvre déjà Discord — pas de tour Installer / fenêtre Vesktop.
    if (IS_DISCORD_HOST_PACKAGE) {
        if (!Object.hasOwn(State.store, "firstLaunch")) {
            State.store.firstLaunch = false;
        }
        return;
    }

    const isDevElectron = process.execPath.toLowerCase().endsWith("electron.exe");

    // Dev / package indépendant : ouvrir Discord directement (pas l'écran Installer).
    if (!Object.hasOwn(State.store, "firstLaunch")) {
        if (isDevElectron || app.isPackaged) {
            State.store.firstLaunch = false;
            if (!Settings.store.discordBranch) Settings.store.discordBranch = "stable";
            createWindows();
            return;
        }
        createFirstLaunchTour();
        return;
    }

    createWindows();
}

export let darwinURL: string | undefined;
app.on("open-url", (_, url) => {
    darwinURL = url;
});

app.on("window-all-closed", () => {
    // Le host Discord gère son cycle de vie ; ne pas quitter si une fenêtre splash se ferme.
    if (IS_DISCORD_HOST_PACKAGE) return;
    if (process.platform !== "darwin") app.quit();
});
