/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2022 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import { onceDefined } from "@shared/onceDefined";
import electron, { app, BrowserWindowConstructorOptions, Menu, session } from "electron";
import { existsSync as fsExistsSync, statSync as fsStatSync } from "original-fs";
import { dirname, join } from "path";

import { registerMediaPermissionsForSession } from "../zcord/main/mediaPermissions";
import { RendererSettings } from "./settings";
import { patchTrayMenu } from "./trayMenu";
import { initZcordTray } from "./zcordTray";
import { IS_VANILLA } from "./utils/constants";

console.log("[Zcord] Starting up...");

/** Ne jamais ouvrir Discord / handoff dans Chrome — reste dans Zcord */
function isDiscordAppUrl(rawUrl: string): boolean {
    if (!rawUrl) return false;
    if (rawUrl.startsWith("discord://") || rawUrl.startsWith("zcord://")) return true;
    try {
        const u = new URL(rawUrl);
        const host = u.hostname.toLowerCase();
        return (
            host === "discord.com" ||
            host.endsWith(".discord.com") ||
            host === "discordapp.com" ||
            host.endsWith(".discordapp.com") ||
            host === "discordapp.net" ||
            host.endsWith(".discordapp.net") ||
            host === "discord.gg" ||
            host.endsWith(".discord.media") ||
            host.includes("discordcdn")
        );
    } catch {
        return false;
    }
}

const _origOpenExternal = electron.shell.openExternal.bind(electron.shell);
electron.shell.openExternal = ((url: string, options?: Electron.OpenExternalOptions) => {
    if (isDiscordAppUrl(url)) {
        console.log("[Zcord] Ouverture navigateur bloquée (reste dans le client):", url);
        // handoff = page blanche inutile dans Chrome ; on ignore
        if (url.toLowerCase().includes("/handoff")) {
            return Promise.resolve();
        }
        try {
            const wins = electron.BrowserWindow.getAllWindows().filter(w => !w.isDestroyed());
            const main = wins.find(w => {
                const t = (w.getTitle() || "").toLowerCase();
                return t === "zcord" || t.includes("discord");
            }) || wins[0];
            if (main) {
                main.show();
                main.focus();
                if (url.startsWith("http")) {
                    main.webContents.loadURL(url).catch(() => {});
                }
            }
        } catch {}
        return Promise.resolve();
    }
    return _origOpenExternal(url, options);
}) as typeof electron.shell.openExternal;


// Our injector file at app/index.js
const injectorPath = require.main!.filename;

// The original app.asar
const _asarFromInjector = join(dirname(injectorPath), "..", "_app.asar");
const _asarFromResources = join(process.resourcesPath, "_app.asar");
const asarPath = (fsExistsSync(_asarFromInjector) && !fsStatSync(_asarFromInjector).isDirectory())
    ? _asarFromInjector
    : _asarFromResources;

const discordPkg = require(join(asarPath, "package.json"));
require.main!.filename = join(asarPath, discordPkg.main);
if (IS_VESKTOP || IS_EQUIBOP) require.main!.filename = join(dirname(injectorPath), "..", "..", "package.json");

// @ts-expect-error Untyped method? Dies from cringe
app.setAppPath(asarPath);

if (!IS_VANILLA) {
    const settings = RendererSettings.store;

    patchTrayMenu();
    initZcordTray(injectorPath);

    // Repatch after host updates on Windows
    if (process.platform === "win32") {
        require("./patchWin32Updater");

        if (settings.winCtrlQ) {
            const originalBuild = Menu.buildFromTemplate;
            Menu.buildFromTemplate = function (template) {
                if (template[0]?.label === "&File") {
                    const { submenu } = template[0];
                    if (Array.isArray(submenu)) {
                        submenu.push({
                            label: "Quit (Hidden)",
                            visible: false,
                            acceleratorWorksWhenHidden: true,
                            accelerator: "Control+Q",
                            click: () => app.quit()
                        });
                    }
                }
                return originalBuild.call(this, template);
            };
        }
    }

    class BrowserWindow extends electron.BrowserWindow {
        constructor(options: BrowserWindowConstructorOptions) {
            const titleLower = (options?.title ?? "").toLowerCase();
            const preloadLower = (options?.webPreferences?.preload ?? "").toLowerCase();
            const isOverlay = titleLower.includes("overlay") || preloadLower.includes("overlay") || (options as any)?.isOverlay;

            if (isOverlay) {
                options.transparent = true;
                options.backgroundColor = "#00000000";
                options.hasShadow = false;
                options.frame = false;
                super(options);
                try {
                    this.setBackgroundColor("#00000000");
                } catch {}
                return;
            }

            // Comme Vencord : injecter dès qu'il y a un preload Discord + un titre (pas seulement "Discord").
            // L'ancien filtre KNOWN_TITLES bloquait l'injection → pas de Zcord/Plugins dans les réglages.
            if (!options?.webPreferences?.preload || !options.title) {
                if (options && options.title !== "Discord") {
                    options.backgroundColor ??= "#1e1f22";
                }
                super(options);
                return;
            }

            const original = options.webPreferences.preload;
            const isMainWindow = options.title === "Discord" || options.title === "Zcord";
            options.webPreferences.preload = join(__dirname, "preload.js");
            options.webPreferences.sandbox = false;
            options.webPreferences.backgroundThrottling = false;
            options.webPreferences.webviewTag = true;

            let ses = options.webPreferences.session;
            if (!ses && options.webPreferences.partition) {
                ses = electron.session.fromPartition(options.webPreferences.partition);
            }
            ses ??= electron.session.defaultSession;
            registerMediaPermissionsForSession(ses);

            if (settings.frameless) {
                options.frame = false;
            } else if (settings.mainWindowFrameless && isMainWindow) {
                options.frame = false;
            } else if (process.platform === "win32" && settings.winNativeTitleBar) {
                delete options.frame;
            }

            if (settings.transparent) {
                options.transparent = true;
                options.backgroundColor = "#00000000";
            }

            // Windows 11 acrylic/mica effect
            const winMaterial = settings.windowMaterial as string | undefined;
            if (process.platform === "win32" && winMaterial && winMaterial !== "none") {
                options.transparent = true;
                options.backgroundColor = "#00000000";
            }

            if (settings.disableMinSize) {
                options.minWidth = 0;
                options.minHeight = 0;
            }

            const needsVibrancy = process.platform === "darwin" && settings.macosVibrancyStyle;

            if (needsVibrancy) {
                options.backgroundColor = "#00000000";
                if (settings.macosVibrancyStyle) {
                    options.vibrancy = settings.macosVibrancyStyle;
                }
            }

            options.fullscreenable = true;

            process.env.DISCORD_PRELOAD = original;

            // Icône Z avant création HWND (sinon barre des tâches = atome Electron)
            try {
                const iconPng = join(dirname(process.execPath), "app.png");
                const iconIco = join(dirname(process.execPath), "app.ico");
                const resIco = join(process.resourcesPath, "app.ico");
                const iconPath = [iconPng, iconIco, resIco].find(p => fsExistsSync(p));
                if (iconPath) options.icon = iconPath;
            } catch {}

            super(options);

            try {
                const iconPng = join(dirname(process.execPath), "app.png");
                const iconIco = join(dirname(process.execPath), "app.ico");
                const resIco = join(process.resourcesPath, "app.ico");
                const iconPath = [iconPng, iconIco, resIco].find(p => fsExistsSync(p)) ?? null;
                if (iconPath) {
                    const nativeSetIcon = this.setIcon.bind(this);
                    this.setIcon = () => nativeSetIcon(iconPath);
                    nativeSetIcon(iconPath);
                    this.once("ready-to-show", () => { try { nativeSetIcon(iconPath); } catch {} });
                    this.webContents?.on("did-finish-load", () => { try { nativeSetIcon(iconPath); } catch {} });
                    this.on("show", () => { try { nativeSetIcon(iconPath); } catch {} });
                    this.on("focus", () => { try { nativeSetIcon(iconPath); } catch {} });
                }
            } catch {}

            // Titre fixe (pas discord.com/app?... dans la barre de titre)
            try {
                const nativeSetTitle = this.setTitle.bind(this);
                this.setTitle = (title?: string) => {
                    const next = title || "";
                    if (/overlay/i.test(next)) return nativeSetTitle(next);
                    return nativeSetTitle("Zcord");
                };
                this.setTitle("Zcord");
                this.on("page-title-updated", e => {
                    e.preventDefault();
                    try { nativeSetTitle("Zcord"); } catch {}
                });
            } catch {}

            if (settings.streamProof) {
                try {
                    this.setContentProtection(true);
                } catch (e) {
                    console.error("Failed to set content protection on startup:", e);
                }
            }

            const isTransparent = !!options.transparent;
                let isFakeFullScreen = false;
                let originalBounds: electron.Rectangle | null = null;
                let isMaximizedBefore = false;
                let transitioning = false;

                const superSetFullScreen = this.setFullScreen.bind(this);
                const superIsFullScreen = this.isFullScreen.bind(this);

                this.setFullScreen = (flag: boolean) => {
                    if (transitioning) return;
                    transitioning = true;
                    try {
                        if (isTransparent) {
                            if (flag) {
                                if (isFakeFullScreen) return;
                                isFakeFullScreen = true;
                                originalBounds = this.getBounds();
                                isMaximizedBefore = this.isMaximized();
                                const display = electron.screen.getDisplayMatching(originalBounds).bounds;
                                this.setResizable(false);
                                this.setBounds(display);
                                this.setAlwaysOnTop(true, "screen-saver");
                                this.emit("enter-full-screen");
                            } else {
                                if (!isFakeFullScreen) return;
                                isFakeFullScreen = false;
                                this.setAlwaysOnTop(false);
                                this.setResizable(true);
                                if (isMaximizedBefore) {
                                    this.maximize();
                                } else if (originalBounds) {
                                    this.setBounds(originalBounds);
                                }
                                this.emit("leave-full-screen");
                            }
                        } else {
                            superSetFullScreen(flag);
                        }
                    } finally {
                        transitioning = false;
                    }
                };

                this.isFullScreen = () => {
                    if (isTransparent) return isFakeFullScreen;
                    return superIsFullScreen();
                };

                if (isTransparent) {
                    this.on("enter-html-full-screen", () => {
                        if (!isFakeFullScreen) this.setFullScreen(true);
                    });
                    this.on("leave-html-full-screen", () => {
                        if (isFakeFullScreen) this.setFullScreen(false);
                    });
                } else {
                    this.on("enter-html-full-screen", () => {
                        if (!superIsFullScreen()) superSetFullScreen(true);
                    });
                    this.on("leave-html-full-screen", () => {
                        if (superIsFullScreen()) superSetFullScreen(false);
                    });
                }

                this.webContents.on("before-input-event", (event, input) => {
                    if (input.type === "keyDown" && input.key === "F11" && !input.control && !input.shift && !input.alt && !input.meta) {
                        event.preventDefault();
                        this.setFullScreen(!this.isFullScreen());
                    }
                });

                if (process.platform === "win32" && winMaterial && winMaterial !== "none") {
                    try {
                        let applied = false;
                        if (typeof this.setBackgroundMaterial === "function") {
                            this.setBackgroundMaterial(winMaterial);
                            applied = true;
                        }
                        if (!applied && typeof this.setVibrancy === "function") {
                            this.setVibrancy(winMaterial === "acrylic" ? "acrylic" : "under-window");
                            applied = true;
                        }
                        if (!applied) {
                            console.warn("[Zcord] No background material API available on this system");
                        }
                    } catch (e) {
                        console.error("[Zcord] setBackgroundMaterial failed:", e);
                    }
                }

            if (settings.disableMinSize) {
                this.setMinimumSize = (_width: number, _height: number) => { };
            }
        }
    }
    Object.assign(BrowserWindow, electron.BrowserWindow);
    Object.defineProperty(BrowserWindow, "name", { value: "BrowserWindow", configurable: true });

    const electronPath = require.resolve("electron");
    delete require.cache[electronPath]!.exports;
    require.cache[electronPath]!.exports = {
        ...electron,
        BrowserWindow
    };

    onceDefined(global, "appSettings", s => {
        s.set("DANGEROUS_ENABLE_DEVTOOLS_ONLY_ENABLE_IF_YOU_KNOW_WHAT_YOURE_DOING", true);
    });

function isInternalAppUrl(rawUrl: string): boolean {
    if (!rawUrl || rawUrl === "about:blank") return true;
    if (
        rawUrl.startsWith("file://") ||
        rawUrl.startsWith("devtools://") ||
        rawUrl.startsWith("about:") ||
        rawUrl.startsWith("discord://") ||
        rawUrl.startsWith("zcord://")
    ) {
        return true;
    }

    try {
        const u = new URL(rawUrl);
        const host = u.hostname.toLowerCase();
        const path = u.pathname.toLowerCase();

        // Captchas inside Discord
        if (host.includes("hcaptcha.com") || host.includes("recaptcha.net")) return true;
        if (host.includes("google.com") && path.startsWith("/recaptcha")) return true;

        // Tout Discord reste dans Electron — jamais le navigateur système
        // (avant: seul /channels et /popout étaient internes → /app ouvrait Chrome)
        if (
            host === "discord.com" ||
            host.endsWith(".discord.com") ||
            host === "discordapp.com" ||
            host.endsWith(".discordapp.com") ||
            host === "discordapp.net" ||
            host.endsWith(".discordapp.net") ||
            host === "discord.gg" ||
            host.endsWith(".discord.media") ||
            host.includes("discordcdn")
        ) {
            return true;
        }
    } catch {}

    return false;
}

function patchWebContents(wc: electron.WebContents) {
    if ((wc as any)._zcordPatched) return;
    (wc as any)._zcordPatched = true;

    wc.setWindowOpenHandler(({ url, frameName }) => {
        const isOverlay = frameName && (frameName.toLowerCase().includes("overlay") || frameName.startsWith("DISCORD_"));
        if (isOverlay) {
            return {
                action: "allow",
                overrideBrowserWindowOptions: {
                    transparent: true,
                    backgroundColor: "#00000000",
                    frame: false,
                    hasShadow: false
                }
            };
        }
        if (!url || url === "about:blank" || url.startsWith("devtools://")) {
            return {
                action: "allow",
                overrideBrowserWindowOptions: {
                    show: false,
                    width: 0,
                    height: 0,
                    x: -9999,
                    y: -9999,
                    skipTaskbar: true,
                    frame: false,
                    transparent: true,
                    backgroundColor: "#00000000"
                }
            };
        }
        if (!isInternalAppUrl(url)) {
            electron.shell.openExternal(url).catch(() => {});
            return { action: "deny" };
        }
        return { action: "allow" };
    });

    wc.on("did-create-window", (childWin, details) => {
        const title = childWin.getTitle();
        const isOverlay = title && title.toLowerCase().includes("overlay");

        if (isOverlay) {
            try {
                childWin.setBackgroundColor("#00000000");
            } catch {}
            return;
        }

        // Ne jamais cacher/détruire la fenêtre principale Discord (splash → main via window.open).
        // Avant: hide + destroy sur about:blank / titre "discord" → client invisible / process zombie.
        let w = 0, h = 0;
        try {
            [w, h] = childWin.getSize();
        } catch {}
        const openUrl = (details && details.url) || "";
        const isLikelyMain =
            w >= 800 ||
            h >= 500 ||
            /discord\.com\/(app|channels|login)/i.test(openUrl) ||
            title === "Discord" ||
            title === "Zcord";

        if (isLikelyMain) {
            try {
                childWin.setOpacity(1);
                childWin.setSkipTaskbar(false);
                childWin.show();
            } catch {}
            return;
        }

        const childWc = childWin.webContents;

        if (openUrl && openUrl !== "about:blank" && !openUrl.startsWith("devtools://") && !isInternalAppUrl(openUrl)) {
            electron.shell.openExternal(openUrl).catch(() => {});
            try { childWin.destroy(); } catch (_) {}
            return;
        }

        childWc.once("will-navigate", (event, url) => {
            if (!isInternalAppUrl(url)) {
                event.preventDefault();
                electron.shell.openExternal(url).catch(() => {});
                try { childWin.destroy(); } catch (_) {}
            }
        });

        childWc.setWindowOpenHandler(({ url }) => {
            if (!url || url === "about:blank" || url.startsWith("devtools://")) {
                return { action: "allow" };
            }
            if (isInternalAppUrl(url)) return { action: "allow" };
            electron.shell.openExternal(url).catch(() => {});
            return { action: "deny" };
        });
    });

    wc.on("will-navigate", (event, url) => {
        const currentUrl = wc.getURL();
        if (url !== currentUrl && !isInternalAppUrl(url)) {
            event.preventDefault();
            electron.shell.openExternal(url).catch(() => {});
        }
    });
}

app.on("browser-window-created", (_, win) => {
    patchWebContents(win.webContents);

    // Titre fixe "Zcord" — Discord appelle setTitle("discord.com/app?...") directement
    try {
        const t = (win.getTitle() || "").toLowerCase();
        if (t.includes("overlay")) return;

        const nativeSetTitle = win.setTitle.bind(win);
        win.setTitle = (title?: string) => {
            const next = title || "";
            if (/overlay/i.test(next)) return nativeSetTitle(next);
            return nativeSetTitle("Zcord");
        };
        win.setTitle("Zcord");
        win.on("page-title-updated", e => {
            e.preventDefault();
            try { nativeSetTitle("Zcord"); } catch {}
        });
    } catch {}
});

app.on("web-contents-created", (_, wc) => {
    patchWebContents(wc);
});

process.env.DATA_DIR = join(app.getPath("userData"), "..", "Zcord");

const ZCORD_AUMID = "com.zcord.portable";
const _setAumid = app.setAppUserModelId.bind(app);
app.setAppUserModelId = (_id?: string) => {
    try { return _setAumid(ZCORD_AUMID); } catch { return undefined as never; }
};

app.whenReady().then(() => {
    // AUMID figé — Discord ne doit plus pouvoir remettre l'icône Discord en barre des tâches
    try { app.setAppUserModelId(ZCORD_AUMID); } catch {}
    registerMediaPermissionsForSession(session.defaultSession);
    for (const wc of electron.webContents.getAllWebContents()) {
        patchWebContents(wc);
    }
    const iconPng = join(dirname(process.execPath), "app.png");
    const iconIco = join(dirname(process.execPath), "app.ico");
    const cachedIconPath = [iconPng, iconIco].find(p => fsExistsSync(p));
    const reassert = () => {
        try { app.setAppUserModelId(ZCORD_AUMID); } catch {}
        try { app.setName("Zcord"); } catch {}
        if (!cachedIconPath) return;
        try {
            for (const win of electron.BrowserWindow.getAllWindows()) {
                if (win.isDestroyed()) continue;
                win.setIcon(cachedIconPath);
            }
        } catch {}
    };
    reassert();
    setTimeout(reassert, 500);
    setTimeout(reassert, 2000);
    setTimeout(reassert, 5000);
});

    // ── Neutralisation de DISCORD_WINDOW_TOGGLE_FULLSCREEN ──
    //
    // PROBLÈME RACINE : Discord émet cet IPC automatiquement à chaque démarrage
    // ET à chaque rechargement de thème pour "synchroniser" son état interne.
    // L'ancien handler faisait `win.setFullScreen(!win.isFullScreen())` — un toggle
    // aveugle. Résultat : fenêtre maximisée + isFullScreen()=false → setFullScreen(true)
    // → overlay OS fullscreen → tous les inputs bloqués, app figée. F11 sortait du
    // fullscreen et débloquait. Le fix du délai de 2s ne suffisait pas car les thèmes
    // rechargent Discord après ce délai.
    //
    // SOLUTION : on intercepte le handler Discord et on le remplace par un no-op
    // complet. Le fullscreen utilisateur est désormais géré exclusivement via F11
    // intercepté dans before-input-event ci-dessus — ce qui est à la fois plus propre
    // et impossible à déclencher accidentellement par Discord.
    {
        const _originalHandle = electron.ipcMain.handle.bind(electron.ipcMain);
        const FULLSCREEN_CHANNEL = "DISCORD_WINDOW_TOGGLE_FULLSCREEN";
        let _fullscreenPatched = false;

        (electron.ipcMain as any).handle = function(channel: string, listener: any) {
            if (channel === FULLSCREEN_CHANNEL) {
                if (_fullscreenPatched) return;
                _fullscreenPatched = true;
                try { electron.ipcMain.removeHandler(FULLSCREEN_CHANNEL); } catch {}
                // No-op : on enregistre un handler vide pour que Discord ne crash pas
                // ("no handler registered"), mais on ne fait RIEN — le fullscreen est
                // géré par before-input-event (F11) côté main process.
                _originalHandle(FULLSCREEN_CHANNEL, (_event: electron.IpcMainInvokeEvent) => {
                    // Intentionnellement vide.
                });
                return;
            }
            try {
                electron.ipcMain.removeHandler(channel);
            } catch {}
            try {
                return _originalHandle(channel, listener);
            } catch (e: any) {
                if (e?.message?.includes?.("Attempted to register a second handler")) {
                    console.warn(`[Zcord] Ignored duplicate IPC handler for '${channel}'`);
                    return;
                }
                throw e;
            }
        };
    }

    const originalAppend = app.commandLine.appendSwitch;
    const _ncDisabledFeatures = new Set(["WidgetLayering", "UseEcoQoSForBackgroundProcess", "CalculateNativeWinOcclusion"]);
    app.commandLine.appendSwitch = function (...args) {
        if (args[0] === "process-per-site") return;
        if (args[0] === "disable-features") {
            (args[1] ?? "").split(",").filter(Boolean).forEach((f: string) => _ncDisabledFeatures.add(f));
            args[1] = [..._ncDisabledFeatures].join(",");
        }
        return originalAppend.apply(this, args);
    };

    app.commandLine.appendSwitch("disable-renderer-backgrounding");
    app.commandLine.appendSwitch("disable-background-timer-throttling");
    app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
} else {
    console.log("[Zcord] Running in vanilla mode. Not loading Zcord");
}

console.log("[Zcord] Loading original Discord app.asar");
require(require.main!.filename);
