/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { existsSync } from "fs";
import { app } from "electron";
import { join } from "path";

const packagedAsar = join(process.resourcesPath, "zcord.asar");
const devAsar = join(__dirname, "..", "zcord.asar");
const devDir = join(__dirname, "..", "zcord");

export const VENCORD_DIR = app.isPackaged
    ? packagedAsar
    : existsSync(devDir) ? devDir : devAsar;
