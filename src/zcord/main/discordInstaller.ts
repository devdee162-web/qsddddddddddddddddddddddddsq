/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { execFile } from "child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "fs";
import { join } from "path";

export type DiscordChannelId = "stable" | "ptb" | "canary";
export type InstallerAction = "install" | "repair" | "uninstall" | "uninstall-others";

export interface DiscordInstall {
    id: DiscordChannelId;
    name: string;
    path: string;
    exe: string;
}

const CHANNELS: Array<{ id: DiscordChannelId; name: string; folder: string; exe: string; }> = [
    { id: "stable", name: "Discord (Stable)", folder: "Discord", exe: "Discord.exe" },
    { id: "ptb", name: "Discord PTB (Public Test Build)", folder: "DiscordPTB", exe: "DiscordPTB.exe" },
    { id: "canary", name: "Discord Canary", folder: "DiscordCanary", exe: "DiscordCanary.exe" }
];

function latestResources(base: string) {
    if (!existsSync(base)) return null;
    const versions = readdirSync(base)
        .filter(d => /^app-\d+\.\d+\.\d+$/.test(d))
        .sort()
        .reverse();

    for (const ver of versions) {
        const resources = join(base, ver, "resources");
        if (
            existsSync(join(resources, "app.asar")) ||
            existsSync(join(resources, "_app.asar")) ||
            existsSync(join(resources, "app"))
        ) {
            return resources;
        }
    }

    return null;
}

export function findDiscordInstalls(): DiscordInstall[] {
    if (process.platform !== "win32") return [];

    const localAppData = process.env.LOCALAPPDATA || "";
    const installs: DiscordInstall[] = [];

    for (const channel of CHANNELS) {
        const path = latestResources(join(localAppData, channel.folder));
        if (path) installs.push({ id: channel.id, name: channel.name, path, exe: channel.exe });
    }

    return installs;
}

export function isDiscordResourcesDir(path: string) {
    return (
        existsSync(join(path, "app.asar")) ||
        existsSync(join(path, "_app.asar")) ||
        existsSync(join(path, "app"))
    );
}

function patcherPath() {
    return join(__dirname, "..", "desktop", "patcher.js");
}

function readAppIndex(resourcesDir: string) {
    const index = join(resourcesDir, "app", "index.js");
    if (!existsSync(index)) return "";
    try {
        return readFileSync(index, "utf-8");
    } catch {
        return "";
    }
}

function isZcordInjected(resourcesDir: string) {
    const index = readAppIndex(resourcesDir);
    return index.includes("Zcord Injector") || index.includes("Zcord");
}

function isOtherModInjected(resourcesDir: string) {
    const index = readAppIndex(resourcesDir).toLowerCase();
    return /vencord|equicord|vesktop|nightcord/.test(index);
}

function closeDiscord(exe: string) {
    if (process.platform !== "win32") return Promise.resolve();
    return new Promise<void>(resolve => {
        execFile("taskkill", ["/IM", exe, "/F"], () => resolve());
    });
}

function launchDiscord(install: DiscordInstall) {
    if (process.platform !== "win32") return;
    const localAppData = process.env.LOCALAPPDATA || "";
    const folder = CHANNELS.find(c => c.id === install.id)?.folder;
    if (!folder) return;
    const updateExe = join(localAppData, folder, "Update.exe");
    if (existsSync(updateExe)) {
        execFile(updateExe, ["--processStart", install.exe], () => {});
    }
}

export function injectZcord(resourcesDir: string, force = false) {
    const appAsarPath = join(resourcesDir, "app.asar");
    const backupPath = join(resourcesDir, "_app.asar");
    const appDirPath = join(resourcesDir, "app");
    const patcher = patcherPath();

    if (!existsSync(patcher)) {
        throw new Error("dist/desktop/patcher.js introuvable. Build d'abord.");
    }

    if (!force && isZcordInjected(resourcesDir)) return "already";

    if (existsSync(appAsarPath) && !existsSync(backupPath)) {
        let isDir = false;
        try {
            isDir = statSync(appAsarPath).isDirectory();
        } catch {}
        if (isDir) rmSync(appAsarPath, { recursive: true, force: true });
        else renameSync(appAsarPath, backupPath);
    } else if (!existsSync(backupPath) && !existsSync(appAsarPath)) {
        throw new Error(`Aucun app.asar dans ${resourcesDir}`);
    }

    if (existsSync(appAsarPath)) rmSync(appAsarPath, { recursive: true, force: true });
    if (existsSync(appDirPath)) rmSync(appDirPath, { recursive: true, force: true });

    mkdirSync(appDirPath, { recursive: true });
    writeFileSync(join(appDirPath, "package.json"), JSON.stringify({ name: "discord", main: "index.js" }, null, 2));
    writeFileSync(
        join(appDirPath, "index.js"),
        `// Zcord Injector — auto-generated, do not edit\n"use strict";\nrequire(${JSON.stringify(patcher)});\n`
    );

    return "ok";
}

export function uninjectMod(resourcesDir: string, mode: "zcord" | "others" | "any") {
    const appDirPath = join(resourcesDir, "app");
    const backupPath = join(resourcesDir, "_app.asar");
    const appAsarPath = join(resourcesDir, "app.asar");
    const zcord = isZcordInjected(resourcesDir);
    const other = isOtherModInjected(resourcesDir);

    if (mode === "zcord" && !zcord && !existsSync(backupPath)) return "skip";
    if (mode === "others" && !other && !zcord) {
        if (!existsSync(appDirPath) && !existsSync(backupPath)) return "skip";
        if (zcord && !other) return "skip";
    }

    if (existsSync(appDirPath)) rmSync(appDirPath, { recursive: true, force: true });

    if (existsSync(backupPath) && !existsSync(appAsarPath)) {
        renameSync(backupPath, appAsarPath);
    } else if (existsSync(backupPath) && existsSync(appAsarPath)) {
        rmSync(backupPath, { force: true });
    }

    return "ok";
}

export async function runInstallerAction(action: InstallerAction, installs: DiscordInstall[]) {
    if (!installs.length) throw new Error("Aucune version Discord sélectionnée.");

    for (const install of installs) {
        await closeDiscord(install.exe);
    }

    const results: string[] = [];
    for (const install of installs) {
        if (action === "install" || action === "repair") {
            injectZcord(install.path, action === "repair");
            results.push(install.name);
        } else if (action === "uninstall") {
            uninjectMod(install.path, "zcord");
            results.push(install.name);
        } else {
            uninjectMod(install.path, "others");
            results.push(install.name);
        }
    }

    if (action === "install" || action === "repair") {
        launchDiscord(installs[0]);
    }

    return results;
}
