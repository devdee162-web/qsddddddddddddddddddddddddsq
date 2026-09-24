/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { disableStyle, enableStyle } from "@api/Styles";
import { BackupRestoreIcon, LogIcon, MagnifyingGlassIcon, PaintbrushIcon, PatchHelperIcon, PluginsIcon, UpdaterIcon, ZcordIcon } from "@components/Icons";
import iconStyles from "../../components/iconStyles.css?managed";
import zcordHomeIconStyle from "./zcordHomeIcon.css?managed";
import { LangIcon } from "@components/LangIcon";
import {
    BackupAndRestoreTab,
    ChangelogTab,
    LanguageTab,
    PatchHelperTab,
    PluginsTab,
    ThemesTab,
    UpdaterTab,
    VencordTab,
} from "@components/settings";
import { openSettingsTabModal } from "@components/settings/tabs/BaseTab";
import { CreateThemeTab } from "@components/settings/tabs/createTheme/CreateThemeTab";
import { PencilSparkleIcon } from "@components/settings/tabs/createTheme/PencilSparkleIcon";
import IconsTab from "@zcordplugins/iconViewer/components/IconsTab";
import ErrorBoundary from "@components/ErrorBoundary";
import { gitHashShort } from "@shared/vencordUserAgent";
import { Devs } from "@utils/constants";
import definePlugin, { IconProps, OptionType } from "@utils/types";
import { waitFor } from "@webpack";
import { t } from "@api/i18n";
import { React } from "@webpack/common";
import type { ComponentType, PropsWithChildren, ReactNode } from "react";

const FAB_ID = "zcord-plugins-fab";
const FAB_STYLE_ID = "zcord-plugins-fab-style";
const BANNER_ID = "zcord-settings-plugins-banner";

function ensurePluginsFab() {
    if (document.getElementById(FAB_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = FAB_STYLE_ID;
    style.textContent = `
#${FAB_ID}{
  position:fixed;right:18px;bottom:72px;z-index:2147483647;
  display:flex;align-items:center;gap:8px;
  padding:12px 16px;border-radius:999px;border:none;cursor:pointer;
  background:#5865f2;color:#fff;font:700 14px/1.2 gg sans,system-ui,sans-serif;
  box-shadow:0 10px 28px rgba(0,0,0,.45);
  -webkit-app-region:no-drag;pointer-events:auto;
}
#${FAB_ID}:hover{filter:brightness(1.08)}
body.zcord-stealth #${FAB_ID},
body.zcord-compact #${FAB_ID}{display:flex !important}
#${BANNER_ID}{
  position:sticky;top:0;z-index:1000;
  display:flex;align-items:center;justify-content:space-between;gap:12px;
  margin:0 0 12px;padding:12px 14px;border-radius:8px;
  background:#5865f2;color:#fff;font:600 13px/1.3 gg sans,system-ui,sans-serif;
  box-shadow:0 4px 16px rgba(0,0,0,.25);
}
#${BANNER_ID} button{
  border:none;border-radius:6px;padding:8px 12px;cursor:pointer;
  background:#fff;color:#5865f2;font:700 12px/1 gg sans,system-ui,sans-serif;
}
`;
    document.head.appendChild(style);
}

function openPluginsUi() {
    openSettingsTabModal(PluginsTab);
}

function openZcordUi() {
    // Lazy: évite de casser le plugin Settings core au chargement
    try {
        const mod = require("@zcordplugins/compactMode/ZcordModal");
        mod.openZcordModal?.(null);
    } catch {
        openSettingsTabModal(PluginsTab);
    }
}

function mountPluginsFab() {
    ensurePluginsFab();
    let btn = document.getElementById(FAB_ID) as HTMLButtonElement | null;
    if (!btn) {
        btn = document.createElement("button");
        btn.id = FAB_ID;
        btn.type = "button";
        document.body.appendChild(btn);
    }
    btn.textContent = "Zcord";
    btn.title = "Réglages Zcord indépendants — Plugins / Thèmes (Ctrl+Shift+P)";
    btn.onclick = e => {
        e.preventDefault();
        e.stopPropagation();
        openZcordUi();
    };
}

function findSettingsSidebarRoot(): HTMLElement | null {
    // Cherche la colonne gauche des User Settings (Déconnexion / Log Out en bas)
    const nodes = Array.from(document.querySelectorAll<HTMLElement>("div,nav,aside"));
    for (const el of nodes) {
        const t = (el.innerText || "").replace(/\s+/g, " ");
        if (!t.includes("Déconnexion") && !t.includes("Log Out")) continue;
        if (!(t.includes("Apparence") || t.includes("Appearance") || t.includes("Nitro"))) continue;
        if (el.clientWidth < 180 || el.clientWidth > 420) continue;
        if (el.clientHeight < 300) continue;
        return el;
    }
    return null;
}

function mountSettingsBanner() {
    ensurePluginsFab();
    const side = findSettingsSidebarRoot();
    if (!side) {
        document.getElementById(BANNER_ID)?.remove();
        return;
    }
    if (document.getElementById(BANNER_ID)) return;

    const banner = document.createElement("div");
    banner.id = BANNER_ID;
    banner.innerHTML = `<span>Zcord indépendant</span>`;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Plugins & réglages";
    btn.addEventListener("click", e => {
        e.preventDefault();
        e.stopPropagation();
        openZcordUi();
    });
    banner.appendChild(btn);

    // Insère en haut de la sidebar settings
    side.insertBefore(banner, side.firstChild);
}

function unmountPluginsFab() {
    document.getElementById(FAB_ID)?.remove();
    document.getElementById(BANNER_ID)?.remove();
    document.getElementById(FAB_STYLE_ID)?.remove();
}

const enum LayoutType {
    ROOT = 0,
    SECTION = 1,
    SIDEBAR_ITEM = 2,
    PANEL = 3,
    SPLIT = 4,
    CATEGORY = 5,
    ACCORDION = 6,
    LIST = 7,
    RELATED = 8,
    FIELD_SET = 9,
    TAB_ITEM = 10,
    STATIC = 11,
    BUTTON = 12,
    TOGGLE = 13,
    SLIDER = 14,
    SELECT = 15,
    RADIO = 16,
    NAVIGATOR = 17,
    CUSTOM = 19
}

let LayoutTypes = {
    SECTION: 1,
    SIDEBAR_ITEM: 2,
    PANEL: 3,
    CATEGORY: 5,
    CUSTOM: 19,
};
waitFor(["SECTION", "SIDEBAR_ITEM", "PANEL", "CUSTOM"], v => LayoutTypes = v);

function alwaysVisible() {
    return true;
}
alwaysVisible.useSetting = alwaysVisible;
alwaysVisible.getSetting = () => true;
alwaysVisible.supports = () => true;

function settingsIcon(Icon: ComponentType<IconProps>, keepColors = false) {
    const render = () => (
        <span className={keepColors ? "zc-settings-icon zc-settings-icon--logo" : "zc-settings-icon"} aria-hidden="true">
            <Icon width={20} height={20} className="zc-settings-icon-svg" />
        </span>
    );
    (render as any).supports = () => true;
    (render as any).useSetting = alwaysVisible;
    return render;
}

const enum SectionType {
    HEADER = "HEADER",
    DIVIDER = "DIVIDER",
    CUSTOM = "CUSTOM"
}

type SettingsLocation =
    | "top"
    | "aboveNitro"
    | "belowNitro"
    | "aboveActivity"
    | "belowActivity"
    | "bottom";

interface SettingsLayoutNode {
    type: LayoutType;
    key?: string;
    legacySearchKey?: string;
    getLegacySearchKey?(): string;
    useLabel?(): string;
    useTitle?(): string;
    useSetting?: (() => boolean) & { useSetting?: () => boolean; getSetting?: () => boolean; supports?: () => boolean; };
    buildLayout?(): SettingsLayoutNode[];
    icon?(): ReactNode;
    render?(): ReactNode;
    Component?: ComponentType<{}>;
    useSearchTerms?(): string[];
    StronglyDiscouragedCustomComponent?(): ReactNode;
}

interface EntryOptions {
    key: string;
    title: string;
    panelTitle?: string;
    Component: ComponentType<{}>;
    Icon: ComponentType<IconProps>;
}

interface SettingsLayoutBuilder {
    key?: string;
    buildLayout(): SettingsLayoutNode[];
}

const settings = definePluginSettings({
    settingsLocation: {
        type: OptionType.SELECT,
        description: "Where to put the Zcord settings section",
        options: [
            { label: "At the very top", value: "top", default: true },
            { label: "Above the Nitro section", value: "aboveNitro" },
            { label: "Below the Nitro section", value: "belowNitro" },
            { label: "Above Activity Settings", value: "aboveActivity" },
            { label: "Below Activity Settings", value: "belowActivity" },
            { label: "At the very bottom", value: "bottom" },
        ] as { label: string; value: SettingsLocation; default?: boolean; }[]
    }
});

const settingsSectionMap: [string, string][] = [
    ["EquicordSettings", "equicord_main_panel"],
    ["EquicordPlugins", "equicord_plugins_panel"],
    ["EquicordThemes", "equicord_themes_panel"],
    ["EquicordCreateTheme", "equicord_create_theme_panel"],
    ["EquicordUpdater", "equicord_updater_panel"],
    ["EquicordChangelog", "equicord_changelog_panel"],
    ["EquicordCloud", "equicord_cloud_panel"],
    ["EquicordBackupAndRestore", "equicord_backup_restore_panel"],
    ["EquicordPatchHelper", "equicord_patch_helper_panel"],
    ["EquibopSettings", "equicord_equibop_settings_panel"],
];

export default definePlugin({
    name: "Settings",
    description: "Adds Settings UI and debug info",
    authors: [Devs.Ven, Devs.Megu],
    required: true,

    settings,
    settingsSectionMap,

    patches: [
        {
            find: ".buildLayout()",
            replacement: [
                {
                    match: /(\i)\.buildLayout\(\)(?=\.map)/,
                    replace: "$self.buildLayout($1)"
                },
                {
                    match: /(\i)\.buildLayout\(\)(?=\?\.)/,
                    replace: "$self.buildLayout($1)"
                }
            ]
        },
        {
            find: "getWebUserSettingFromSection",
            replacement: {
                match: /new Map\(\[(?=\[.{0,10}\.ACCOUNT,.{0,10}\.ACCOUNT_PANEL)/,
                replace: "new Map([...$self.getSettingsSectionMappings(),"
            }
        },
        {
            find: "#{intl::DISCODO_DISABLED}",
            replacement: [
                {
                    // Remplace l'icône Accueil Discord par le logo Zcord
                    match: /(?<=BUTTON_HOME.{0,40}children:)(\(0,\i\.jsxs?\)\(\i(?:,\{[^}]*\})?\))/,
                    replace: "$self.ZcordHomeIcon()"
                },
                {
                    // Fallback: composant Logo Discord vide utilisé comme children du home
                    match: /(?<=BUTTON_HOME.{0,80}children:)(\(0,\i\.jsxs?\)\(\i,\{\}\))/,
                    replace: "$self.ZcordHomeIcon()"
                }
            ]
        }
    ],

    ZcordHomeIcon: () => <ZcordIcon width={28} height={28} />,

    start() {
        enableStyle(iconStyles);
        enableStyle(zcordHomeIconStyle);
        const mount = () => {
            mountPluginsFab();
            mountSettingsBanner();
        };
        if (document.body) mount();
        else document.addEventListener("DOMContentLoaded", mount, { once: true });

        this._settingsObs = new MutationObserver(() => mountSettingsBanner());
        this._settingsObs.observe(document.documentElement, { childList: true, subtree: true });

        // Secours : Ctrl+Shift+P → modal Plugins
        this._onKey = (e: KeyboardEvent) => {
            if (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && e.code === "KeyP") {
                e.preventDefault();
                e.stopPropagation();
                openPluginsUi();
            }
            if (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && e.code === "KeyZ") {
                e.preventDefault();
                e.stopPropagation();
                openZcordUi();
            }
        };
        document.addEventListener("keydown", this._onKey, true);
    },

    stop() {
        disableStyle(iconStyles);
        disableStyle(zcordHomeIconStyle);
        unmountPluginsFab();
        this._settingsObs?.disconnect();
        this._settingsObs = undefined;
        if (this._onKey) document.removeEventListener("keydown", this._onKey, true);
    },

    _onKey: undefined as ((e: KeyboardEvent) => void) | undefined,
    _settingsObs: undefined as MutationObserver | undefined,

    buildEntry(options: EntryOptions): SettingsLayoutNode {
        const { key, title, panelTitle = title, Component, Icon } = options;

        // Structure alignée Vencord upstream — pas de useSetting custom (Discord les filtre)
        const panel: SettingsLayoutNode = {
            key: key + "_panel",
            type: LayoutTypes.PANEL,
            useTitle: () => t(panelTitle),
            buildLayout: () => [{
                type: LayoutTypes.CATEGORY,
                key: key + "_category",
                buildLayout: () => [{
                    type: LayoutTypes.CUSTOM,
                    key: key + "_custom",
                    Component: () => (
                        <ErrorBoundary>
                            <Component />
                        </ErrorBoundary>
                    ),
                    useSearchTerms: () => [t(title)]
                }]
            }]
        };

        return ({
            key,
            type: LayoutTypes.SIDEBAR_ITEM,
            useTitle: () => t(title),
            legacySearchKey: title.toUpperCase(),
            getLegacySearchKey: () => title.toUpperCase(),
            icon: () => (
                <span className={Icon === ZcordIcon ? "zc-settings-icon zc-settings-icon--logo" : "zc-settings-icon"} aria-hidden="true">
                    <Icon width={20} height={20} className="zc-settings-icon-svg" />
                </span>
            ),
            buildLayout: () => [panel]
        });
    },

    getSettingsSectionMappings() {
        return settingsSectionMap;
    },

    buildLayout(originalLayoutBuilder: SettingsLayoutBuilder) {
        try {
            const layout = originalLayoutBuilder.buildLayout();
            if (!Array.isArray(layout)) return layout;

            const builderKey = String(originalLayoutBuilder?.key ?? "");
            const looksLikeRootKey = /^(?:\$)?root$/i.test(builderKey);
            const looksLikeRootLayout = layout.some(s =>
                typeof s?.key === "string" && /^(?:user|billing|games_and_apps|activity|utility|logout|profile)_section$/.test(s.key)
            );
            // Ancien Discord: key === "$Root". Nouveau: ROOT / heuristique sections.
            if (!looksLikeRootKey && !looksLikeRootLayout) return layout;
            // Éviter d'injecter dans des sous-layouts trop petits
            if (!looksLikeRootKey && layout.length < 4) return layout;

            if (layout.some(s => s?.key === "equicord_section" || s?.key === "zcord_section" || s?.key === "vencord_section")) {
                return layout;
            }

            const { buildEntry } = this;
            const fullEntries: SettingsLayoutNode[] = [
                buildEntry({
                    key: "equicord_main",
                    title: "Zcord",
                    panelTitle: "Zcord Settings",
                    Component: VencordTab,
                    Icon: ZcordIcon
                }),
                buildEntry({
                    key: "equicord_plugins",
                    title: "Plugins",
                    Component: PluginsTab,
                    Icon: PluginsIcon
                }),
                buildEntry({
                    key: "equicord_themes",
                    title: "Themes",
                    Component: ThemesTab,
                    Icon: PaintbrushIcon
                }),
                buildEntry({
                    key: "equicord_create_theme",
                    title: "Create Theme",
                    panelTitle: "Theme Creator",
                    Component: CreateThemeTab,
                    Icon: PencilSparkleIcon
                }),
                buildEntry({
                    key: "equicord_changelog",
                    title: "Changelog",
                    Component: ChangelogTab,
                    Icon: LogIcon,
                }),
                buildEntry({
                    key: "equicord_backup_restore",
                    title: "Backup & Restore",
                    Component: BackupAndRestoreTab,
                    Icon: BackupRestoreIcon
                }),
                buildEntry({
                    key: "zcord_language",
                    title: "Language",
                    Component: LanguageTab,
                    Icon: LangIcon
                }),
                buildEntry({
                    key: "zcord_icon_finder",
                    title: "Icon Finder",
                    Component: IconsTab,
                    Icon: MagnifyingGlassIcon
                }),
                ...this.customEntries.map(buildEntry)
            ];

            if (!IS_UPDATER_DISABLED && UpdaterTab) {
                fullEntries.splice(4, 0, buildEntry({
                    key: "equicord_updater",
                    title: "Updater",
                    panelTitle: "Zcord Updater",
                    Component: UpdaterTab,
                    Icon: UpdaterIcon
                }));
            }

            if (IS_DEV && PatchHelperTab) {
                fullEntries.push(buildEntry({
                    key: "equicord_patch_helper",
                    title: "Patch Helper",
                    Component: PatchHelperTab,
                    Icon: PatchHelperIcon
                }));
            }

            const entries = fullEntries.filter(entry => !!entry && typeof entry === "object");

            const equicordSection: SettingsLayoutNode = {
                key: "zcord_section",
                type: LayoutTypes.SECTION,
                useTitle: () => t("Zcord Settings"),
                buildLayout: () => entries
            };

            const { settingsLocation } = settings.store;
            const places: Record<SettingsLocation, string[]> = {
                top: ["user_section"],
                aboveNitro: ["billing_section"],
                belowNitro: ["billing_section"],
                aboveActivity: ["games_and_apps_section", "activity_section"],
                belowActivity: ["games_and_apps_section", "activity_section"],
                bottom: ["utility_section", "logout_section"]
            };

            const loc = (settingsLocation ?? "top") as SettingsLocation;
            const keys = places[loc] ?? places.top;
            let idx = -1;
            for (const k of keys) {
                idx = layout.findIndex(s => typeof s?.key === "string" && s.key === k);
                if (idx !== -1) break;
            }
            // Toujours visible : en tête si introuvable / si top
            if (idx === -1 || loc === "top") idx = 0;
            else if (String(loc).startsWith("below")) idx += 1;

            layout.splice(idx, 0, equicordSection);
            return layout;
        } catch (e) {
            console.error("[Zcord Settings] buildLayout failed", e);
            try {
                return originalLayoutBuilder.buildLayout();
            } catch {
                return [];
            }
        }
    },

    customSections: [] as ((SectionTypes: Record<string, string>) => { section: string; element: ComponentType; label: string; id?: string; })[],
    customEntries: [] as EntryOptions[],

    get electronVersion() {
        return VencordNative.native.getVersions().electron ?? window.legcord?.electron ?? null;
    },

    get chromiumVersion() {
        try {
            return (
                VencordNative.native.getVersions().chrome ??
                // @ts-expect-error userAgentData types
                navigator.userAgentData?.brands?.find(
                    (b: { brand: string; }) => b.brand === "Chromium" || b.brand === "Google Chrome",
                )?.version ??
                null
            );
        } catch {
            return null;
        }
    },

    getVersionInfo(support = true) {
        let version = "";

        if (IS_DEV) version = "Dev Build";
        if (IS_WEB) version = "Web";
        if (IS_VESKTOP) version = `Vesktop v${VesktopNative.app.getVersion()}`;
        if (IS_EQUIBOP) version = `Equibop v${VesktopNative.app.getVersion()}`;
        if (IS_STANDALONE) version = "Standalone";

        return support && version ? ` (${version})` : version;
    },

    getInfoRows() {
        const { electronVersion, chromiumVersion, getVersionInfo } = this;

        const rows = [`Zcord ${gitHashShort}${getVersionInfo()}`];

        if (electronVersion) rows.push(`Electron ${electronVersion}`);
        if (chromiumVersion) rows.push(`Chromium ${chromiumVersion}`);

        return rows;
    },

    getInfoString() {
        return "\n" + this.getInfoRows().join("\n");
    },

    makeInfoElements(
        Component: ComponentType<React.PropsWithChildren>,
        props: PropsWithChildren,
    ) {
        return this.getInfoRows().map((text, i) => (
            <Component key={i} {...props}>
                {text}
            </Component>
        ));
    },
});
