/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import type { Settings as TSettings, State as TState } from "shared/settings";
import { SettingsStore } from "shared/utils/SettingsStore";

import { DATA_DIR, VENCORD_SETTINGS_FILE } from "./constants";

const SETTINGS_FILE = VENCORD_SETTINGS_FILE;
const LEGACY_SETTINGS_FILE = join(DATA_DIR, "settings.json");
const STATE_FILE = join(DATA_DIR, "state.json");

// Migration: If legacy DATA_DIR/settings.json exists, copy it to VENCORD_SETTINGS_FILE
try {
    if (existsSync(LEGACY_SETTINGS_FILE)) {
        if (!existsSync(SETTINGS_FILE)) {
            mkdirSync(dirname(SETTINGS_FILE), { recursive: true });
            copyFileSync(LEGACY_SETTINGS_FILE, SETTINGS_FILE);
        }
    }
} catch (e) {
    console.error("Failed to migrate legacy settings.json:", e);
}

function loadSettings<T extends object = any>(file: string, name: string) {
    let settings = {} as T;
    try {
        const content = readFileSync(file, "utf8");
        try {
            settings = JSON.parse(content);
        } catch (err) {
            console.error(`Failed to parse ${name}.json:`, err);
            // Recover from the last good backup instead of silently resetting to defaults
            // (a kill/crash mid-write used to corrupt settings.json and wipe all plugin states)
            try {
                settings = JSON.parse(readFileSync(file + ".bak", "utf8"));
                console.error(`Recovered ${name}.json from backup`);
            } catch (err2) {
                console.error(`Backup unreadable too, falling back to defaults:`, err2);
            }
        }
    } catch {}

    const store = new SettingsStore(settings);
    store.addGlobalChangeListener(o => {
        try {
            mkdirSync(dirname(file), { recursive: true });
            // Atomic write: a process killed mid-write can no longer corrupt settings.json
            const tmp = file + ".tmp";
            const data = JSON.stringify(o, null, 4);
            writeFileSync(tmp, data);
            renameSync(tmp, file);
            try {
                writeFileSync(file + ".bak", data);
            } catch (err) {
                console.error(`Failed to save backup of ${name}.json:`, err);
            }
        } catch (err) {
            console.error(`Failed to save settings to ${name}.json:`, err);
        }
    });

    return store;
}

export const Settings = loadSettings<TSettings>(SETTINGS_FILE, "Zcord settings");
export const VencordSettings = loadSettings<any>(VENCORD_SETTINGS_FILE, "Vencord settings");
export const State = loadSettings<TState>(STATE_FILE, "Zcord state");

