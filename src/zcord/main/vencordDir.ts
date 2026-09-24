/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { existsSync } from "fs";
import { app } from "electron";
import { join } from "path";

const packagedAsar = join(process.resourcesPath, "zcord.asar");

function resolveVencordDir(): string {
    const appPath = app.getAppPath();
    const candidates = [
        join(appPath, "dist", "zcord"),
        join(__dirname, "..", "zcord"),
        join(appPath, "dist", "zcord.asar"),
        join(__dirname, "..", "zcord.asar"),
        packagedAsar
    ];

    // En prod packagée, préférer le asar du package s'il existe.
    if (app.isPackaged && existsSync(packagedAsar)) {
        return packagedAsar;
    }

    for (const p of candidates) {
        if (!existsSync(p)) continue;
        if (p.endsWith(".asar")) return p;
        if (existsSync(join(p, "main.js"))) return p;
    }

    // Dernier recours : dossier dist relatif au cwd (npm run start:dev)
    const cwdDist = join(process.cwd(), "dist", "zcord");
    if (existsSync(join(cwdDist, "main.js"))) return cwdDist;

    return packagedAsar;
}

export const VENCORD_DIR = resolveVencordDir();
