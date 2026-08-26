/*
 * Zcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import electron, { app, nativeImage, Tray } from "electron";
import { existsSync } from "original-fs";
import { dirname, join } from "path";

function resolveZcordIconPath(injectorPath: string): string | null {
    const exeDir = dirname(process.execPath);
    const candidates = [
        join(exeDir, "app.png"),
        join(exeDir, "app.ico"),
        join(process.resourcesPath, "app.ico"),
        join(process.resourcesPath, "app.png"),
        join(dirname(injectorPath), "..", "..", "app.ico"),
        join(dirname(injectorPath), "..", "..", "app.png"),
    ];
    return candidates.find(p => existsSync(p)) ?? null;
}

function loadZcordTrayImage(injectorPath: string, size = 32): Electron.NativeImage {
    const iconPath = resolveZcordIconPath(injectorPath);
    if (!iconPath) return nativeImage.createEmpty();
    try {
        let img = nativeImage.createFromPath(iconPath);
        if (img.isEmpty()) return img;
        const s = img.getSize();
        if (s.width !== size || s.height !== size) {
            img = img.resize({ width: size, height: size });
        }
        return img;
    } catch {
        return nativeImage.createEmpty();
    }
}

/**
 * Force the Windows notification-area icon to Zcord's Z.
 * Only patches Tray.prototype (does not replace Tray) so Discord keeps working.
 */
export function initZcordTray(injectorPath: string) {
    if (process.platform !== "win32") return;

    const cachedTrayImage = loadZcordTrayImage(injectorPath, 32);
    const origSetImage = Tray.prototype.setImage;
    const origSetToolTip = Tray.prototype.setToolTip;
    const seen = new WeakSet<object>();

    Tray.prototype.setImage = function (this: Tray, img: Electron.NativeImage | string) {
        seen.add(this);
        return origSetImage.call(this, cachedTrayImage.isEmpty() ? img : cachedTrayImage);
    };

    Tray.prototype.setToolTip = function (this: Tray, tip: string) {
        const m = /(\d{1,4})/.exec(tip || "");
        const n = m ? Number(m[1]) : 0;
        return origSetToolTip.call(this, n > 0 ? `Zcord (${n})` : "Zcord");
    };

    app.whenReady().then(() => {
        const iconPath = resolveZcordIconPath(injectorPath);
        console.log("[Zcord] Systray prototype patch", iconPath ?? "(missing)");

        // Ensure at least one Z tray exists; also triggers Discord's later setImage → Z
        if (!cachedTrayImage.isEmpty()) {
            try {
                const tray = new Tray(cachedTrayImage);
                tray.setToolTip("Zcord");
                tray.on("click", () => {
                    const wins = electron.BrowserWindow.getAllWindows();
                    const main = wins.find(w => !w.isDestroyed()) ?? wins[0];
                    if (!main) return;
                    if (main.isVisible()) main.focus();
                    else main.show();
                });
            } catch (e) {
                console.error("[Zcord] Tray create failed:", e);
            }
        }
        void seen;
    });
}
