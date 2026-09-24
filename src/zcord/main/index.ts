/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { CommandLine } from "./cli";
import { app } from "electron";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";

// Client indépendant : identité Zcord (pas Discord officiel).
try {
    app.setName("Zcord");
    if (process.platform === "win32") {
        app.setAppUserModelId("com.zcord.app");
    }
} catch { /* avant ready : OK */ }

// Même dossier que start-independent — avant tout le reste
try {
    const isHost =
        process.env.ZCORD_DISCORD_HOST === "1" ||
        existsSync(join(process.resourcesPath || "", "_app.asar"));
    if (!isHost) {
        const dataDir =
            process.env.Zcord_USER_DATA_DIR ||
            process.env.ZCORD_USER_DATA_DIR ||
            (process.platform === "win32" && process.env.APPDATA
                ? join(process.env.APPDATA, "zcord")
                : join(app.getPath("appData"), "zcord"));
        mkdirSync(dataDir, { recursive: true });
        process.env.Zcord_USER_DATA_DIR = dataDir;
        process.env.ZCORD_USER_DATA_DIR = dataDir;
        app.setPath("userData", dataDir);
    }
} catch { /* */ }

if (CommandLine.values.repair) {
    (async () => {
        const { State } = await import("./settings");
        if (State.store.ZcordDir) {
            console.error("Cannot repair: using custom Zcord directory.");
            process.exit(1);
        }
        console.log("Repairing Zcord...");
        const { downloadVencordAsar } = await import("./utils/vencordLoader");
        await downloadVencordAsar();
        console.log("Repair complete.");
        process.exit(0);
    })();
} else {
    require("./startup");
}
