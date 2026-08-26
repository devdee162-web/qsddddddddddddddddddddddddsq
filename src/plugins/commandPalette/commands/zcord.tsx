/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { PaletteCommand } from "../api/types";
import { BoltIcon, GearIcon, PaintIcon, RestartIcon } from "../ui/icons";
import { openSettingsPage } from "./openSettings";

const SECTION = "Zcord";

export const zcordCommands: PaletteCommand[] = [
    {
        id: "zcord.settings",
        title: "Open Zcord Settings",
        section: SECTION,
        keywords: ["zcord", "equicord", "vencord", "settings", "client"],
        icon: GearIcon,
        actions: [{
            id: "run",
            label: "Open Zcord Settings",
            run: () => void openSettingsPage("equicord_main", "Zcord Settings")
        }]
    },
    {
        id: "zcord.plugins",
        title: "Open Zcord Plugins",
        section: SECTION,
        keywords: ["zcord", "plugins", "extensions"],
        icon: GearIcon,
        actions: [{
            id: "run",
            label: "Open Plugins",
            run: () => void openSettingsPage("equicord_plugins", "Zcord Plugins")
        }]
    },
    {
        id: "zcord.themes",
        title: "Open Zcord Themes",
        section: SECTION,
        keywords: ["zcord", "themes", "css", "style"],
        icon: PaintIcon,
        actions: [{
            id: "run",
            label: "Open Themes",
            run: () => void openSettingsPage("equicord_themes", "Zcord Themes")
        }]
    },
    {
        id: "zcord.quickCss",
        title: "Open QuickCSS",
        section: SECTION,
        keywords: ["css", "quickcss", "editor", "style", "zcord"],
        icon: PaintIcon,
        actions: [{
            id: "run",
            label: "Open QuickCSS",
            run: () => VencordNative.quickCss.openEditor()
        }]
    },
    {
        id: "zcord.updater",
        title: "Open Updater",
        section: SECTION,
        keywords: ["update", "updater", "version", "zcord"],
        icon: BoltIcon,
        predicate: () => !IS_UPDATER_DISABLED,
        actions: [{
            id: "run",
            label: "Open Updater",
            run: () => void openSettingsPage("equicord_updater", "Zcord Updater")
        }]
    },
    {
        id: "zcord.changelog",
        title: "Open Changelog",
        section: SECTION,
        keywords: ["changelog", "news", "whats new", "zcord"],
        icon: BoltIcon,
        actions: [{
            id: "run",
            label: "Open Changelog",
            run: () => void openSettingsPage("equicord_changelog", "Zcord Changelog")
        }]
    },
    {
        id: "zcord.restart",
        title: "Restart Zcord",
        section: SECTION,
        keywords: ["restart", "reload", "refresh", "zcord"],
        icon: RestartIcon,
        actions: [{
            id: "run",
            label: "Restart",
            run: () => window.location.reload()
        }]
    }
];

/** Alias compat */
export const equicordCommands = zcordCommands;
