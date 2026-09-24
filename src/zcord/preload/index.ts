/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { contextBridge, ipcRenderer, webFrame } from "electron/renderer";

import { IpcEvents } from "../shared/IpcEvents";
import { VesktopNative } from "./VesktopNative";

contextBridge.exposeInMainWorld("VesktopNative", VesktopNative);
contextBridge.exposeInMainWorld("ZcordNative", VesktopNative);

// TODO: remove this legacy workaround once some time has passed
const isSandboxed = typeof __dirname === "undefined";
if (isSandboxed) {
    // While sandboxed, Electron "polyfills" these APIs as local variables.
    // We have to pass them as arguments as they are not global
    Function(
        "require",
        "Buffer",
        "process",
        "clearImmediate",
        "setImmediate",
        ipcRenderer.sendSync(IpcEvents.GET_VENCORD_PRELOAD_SCRIPT)
    )(require, Buffer, process, clearImmediate, setImmediate);
} else {
    require(ipcRenderer.sendSync(IpcEvents.DEPRECATED_GET_VENCORD_PRELOAD_SCRIPT_PATH));
}

// Injection SYNCHRONE (callback) : executeJavaScript est sync tant que le frame
// n'est pas suspendu — crucial pour patcher webpack avant Discord.
const t0 = Date.now();
const vencordRenderer = ipcRenderer.sendSync(IpcEvents.GET_VENCORD_RENDERER_SCRIPT) as string;
const vesktopRenderer = ipcRenderer.sendSync(IpcEvents.GET_VESKTOP_RENDERER_SCRIPT) as string;
console.log(
    `[Zcord] inject: vencord=${vencordRenderer?.length ?? 0}B vesktop=${vesktopRenderer?.length ?? 0}B fetch=${Date.now() - t0}ms`
);

if (!vencordRenderer) {
    console.error("[Zcord] Renderer Vencord vide — Plugins impossibles");
} else {
    // Deux appels séparés (comme Vesktop upstream) : un gros concat peut masquer l'erreur.
    webFrame.executeJavaScript(vencordRenderer, false, (_result, error) => {
        if (error) {
            console.error("[Zcord] Injection Vencord ÉCHOUÉE:", error);
        } else {
            console.log(`[Zcord] Vencord injecté OK en ${Date.now() - t0}ms`);
        }
    });
    if (vesktopRenderer) {
        webFrame.executeJavaScript(vesktopRenderer, false, (_result, error) => {
            if (error) console.error("[Zcord] Injection Vesktop échouée:", error);
        });
    }
}
