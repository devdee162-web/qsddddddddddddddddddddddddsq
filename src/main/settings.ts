/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { Settings } from "@api/Settings";
import { IpcEvents } from "@shared/IpcEvents";
import { SettingsStore } from "@shared/SettingsStore";
import { mergeDefaults } from "@utils/mergeDefaults";
import { ipcMain } from "electron";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";

import { NATIVE_SETTINGS_FILE, SETTINGS_DIR, SETTINGS_FILE } from "./utils/constants";

mkdirSync(SETTINGS_DIR, { recursive: true });

function readSettings<T = object>(name: string, file: string): Partial<T> {
    try {
        return JSON.parse(readFileSync(file, "utf-8"));
    } catch (err: any) {
        if (err?.code !== "ENOENT")
            console.error(`Failed to read ${name} settings`, err);

        // Recover from the last good backup instead of silently resetting to defaults
        // (a kill/crash mid-write used to corrupt settings.json and wipe all plugin states)
        try {
            const backup = JSON.parse(readFileSync(file + ".bak", "utf-8"));
            console.error(`Recovered ${name} settings from backup`);
            return backup;
        } catch {
            return {};
        }
    }
}

/** Atomic write: a process killed mid-write can no longer corrupt the settings file. */
function writeSettingsAtomic(file: string, data: string) {
    const tmp = file + ".tmp";
    writeFileSync(tmp, data);
    renameSync(tmp, file);
    try {
        writeFileSync(file + ".bak", data);
    } catch (e) {
        console.error(`Failed to write settings backup for ${file}`, e);
    }
}

import { debounce } from "@shared/debounce";

export const RendererSettings = new SettingsStore(readSettings<Settings>("renderer", SETTINGS_FILE));

const saveRendererSettings = debounce(() => {
    try {
        writeSettingsAtomic(SETTINGS_FILE, JSON.stringify(RendererSettings.plain, null, 4));
    } catch (e) {
        console.error("Failed to write renderer settings", e);
    }
}, 500);

RendererSettings.addGlobalChangeListener(saveRendererSettings);

ipcMain.handle(IpcEvents.GET_SETTINGS_DIR, () => SETTINGS_DIR);
ipcMain.on(IpcEvents.GET_SETTINGS, e => e.returnValue = RendererSettings.plain);

ipcMain.handle(IpcEvents.SET_SETTINGS, (_, data: Settings, pathToNotify?: string) => {
    RendererSettings.setData(data, pathToNotify);
});

export interface NativeSettings {
    plugins: {
        [plugin: string]: {
            [setting: string]: any;
        };
    };
    customCspRules: Record<string, string[]>;
}

const DefaultNativeSettings: NativeSettings = {
    plugins: {},
    customCspRules: {}
};

const nativeSettings = readSettings<NativeSettings>("native", NATIVE_SETTINGS_FILE);
mergeDefaults(nativeSettings, DefaultNativeSettings);

export const NativeSettings = new SettingsStore(nativeSettings as NativeSettings);

const saveNativeSettings = debounce(() => {
    try {
        writeSettingsAtomic(NATIVE_SETTINGS_FILE, JSON.stringify(NativeSettings.plain, null, 4));
    } catch (e) {
        console.error("Failed to write native settings", e);
    }
}, 500);

NativeSettings.addGlobalChangeListener(saveNativeSettings);
