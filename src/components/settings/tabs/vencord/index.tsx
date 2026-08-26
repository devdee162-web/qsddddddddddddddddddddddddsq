/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./VencordTab.css";

import { isCompactModeEnabled, isStealthModeEnabled, toggleCompactMode, toggleStealthMode } from "@api/HeaderBar";
import { openNotificationLogModal } from "@api/Notifications/notificationLog";
import { plugins } from "@api/PluginManager";
import { useSettings } from "@api/Settings";
import { t } from "@api/i18n";

import { Button } from "@components/Button";
import { Card } from "@components/Card";
import { Divider } from "@components/Divider";
import { Flex } from "@components/Flex";
import { FormSwitch } from "@components/FormSwitch";
import { Heading } from "@components/Heading";
import { LogIcon, OwnerCrownIcon, RestartIcon } from "@components/Icons";
import { Notice } from "@components/Notice";
import { Paragraph } from "@components/Paragraph";
import { openPluginModal, SettingsTab, wrapTab } from "@components/settings";
import { QuickAction, QuickActionCard } from "@components/settings/QuickAction";
import { IS_MAC, IS_WINDOWS } from "@utils/constants";
import { classNameFactory } from "@utils/css";
import { Margins } from "@utils/margins";
import { identity } from "@utils/misc";
import { relaunch } from "@utils/native";
import { Constants, FluxDispatcher, OAuth2AuthorizeModal, React, RestAPI, Select, UserStore, UserUtils, showToast, Toasts, useStateFromStores } from "@webpack/common";

import { copyToClipboard } from "@utils/clipboard";
import { openNotificationSettingsModal } from "./NotificationSettings";
import creatorAvatarB64 from "file://../../../../assets/creator-avatar.png?base64";

const cl = classNameFactory("vc-vencord-tab-");

const CREATOR_AVATAR = `data:image/png;base64,${creatorAvatarB64}`;

const DEV_TEAM_IDS = [
    {
        id: "1400111418358894646",
        role: "Creator",
        name: "11.01rosea0064v1.2009",
        avatar: CREATOR_AVATAR,
        description: "Manager of app, site visuals, communication & ads"
    }
];

function defaultAvatar(userId: string) {
    return `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(userId) >> 22n) % 6}.png`;
}

function resolveStoredUser(userId: string) {
    const current = UserStore?.getCurrentUser?.();
    return UserStore?.getUser?.(userId) ?? (current?.id === userId ? current : null);
}

function toCardUser(userId: string, u: any) {
    const name = u?.globalName || u?.global_name || u?.username;
    if (!name) return null;
    let pfp = defaultAvatar(userId);
    try {
        if (typeof u.getAvatarURL === "function")
            pfp = u.getAvatarURL(undefined, 128, true) || pfp;
        else if (u.avatar)
            pfp = `https://cdn.discordapp.com/avatars/${userId}/${u.avatar}.webp?size=128`;
    } catch { /* keep default */ }
    return { name, pfp };
}

function useDiscordUser(userId: string) {
    const stored = useStateFromStores([UserStore], () => resolveStoredUser(userId), [userId]);
    const [fetched, setFetched] = React.useState<{ name: string; pfp: string; } | null>(null);

    React.useEffect(() => {
        if (resolveStoredUser(userId)) return;

        let cancelled = false;
        (async () => {
            try {
                const u = await UserUtils.getUser(userId);
                if (!cancelled) setFetched(toCardUser(userId, u));
            } catch {
                try {
                    const response = await RestAPI.get({ url: Constants.Endpoints.USER(userId) });
                    const body = response?.body;
                    if (body) {
                        FluxDispatcher.dispatch({ type: "USER_UPDATE", user: body });
                        if (!cancelled) setFetched(toCardUser(userId, UserStore.getUser(userId) ?? body));
                    }
                } catch {
                    if (!cancelled) setFetched(null);
                }
            }
        })();

        return () => { cancelled = true; };
    }, [userId]);

    return toCardUser(userId, stored) ?? fetched;
}

function DevCard({ id, role, description, name, avatar }: { id: string; role: string; description: string; name?: string; avatar?: string; }) {
    const user = useDiscordUser(id);
    const displayName = user?.name ?? name ?? "...";
    const displayAvatar = user?.pfp ?? avatar ?? defaultAvatar(id);
    const [copied, setCopied] = React.useState(false);

    const handleCopy = (e: React.MouseEvent) => {
        e.stopPropagation();
        try {
            copyToClipboard(id);
        } catch {
            navigator.clipboard.writeText(id);
        }
        setCopied(true);
        try { showToast("ID copié !", Toasts.Type.SUCCESS); } catch {}
        setTimeout(() => setCopied(false), 1500);
    };

    return (
        <Card variant="primary" outline style={{ padding: "12px" }}>
            <Flex align={Flex.Align.CENTER} gap="12px">
                <img
                    src={displayAvatar}
                    alt=""
                    style={{ width: 48, height: 48, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }}
                />
                <Flex direction={Flex.Direction.VERTICAL} style={{ flex: 1, gap: "2px" }}>
                    <Flex align={Flex.Align.CENTER} justify={Flex.Justify.BETWEEN} style={{ width: "100%" }}>
                        <Heading tag="h3" style={{ marginBottom: "0px", fontSize: "14px", fontWeight: "bold" }}>{displayName}</Heading>
                        <Heading tag="h4" style={{ color: "var(--brand-experiment)", fontWeight: "bold", fontSize: "12px" }}>{role}</Heading>
                    </Flex>

                    <div 
                        onClick={handleCopy}
                        title="Cliquer pour copier l'ID"
                        style={{ 
                            display: "inline-flex", 
                            alignItems: "center", 
                            gap: "6px", 
                            cursor: "pointer",
                            fontSize: "11px",
                            color: "var(--text-muted)",
                            background: "var(--background-secondary-alt, rgba(0,0,0,0.2))",
                            padding: "2px 6px",
                            borderRadius: "4px",
                            width: "fit-content",
                            marginTop: "2px",
                            marginBottom: "4px",
                            userSelect: "all",
                            transition: "all 0.15s ease"
                        }}
                    >
                        <span>{id}</span>
                        {copied ? (
                            <span style={{ color: "var(--status-positive, #43b581)", fontWeight: "bold", fontSize: "10px" }}>✓ Copié</span>
                        ) : (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                            </svg>
                        )}
                    </div>

                    <Paragraph size="xs" color="text-muted" style={{ fontSize: "12px", lineHeight: "1.3" }}>{description}</Paragraph>
                </Flex>
            </Flex>
        </Card>
    );
}

function DevTeamSection() {
    const [showDevs, setShowDevs] = React.useState(false);

    return (
        <>
            <QuickActionCard>
                {!IS_WEB && (
                    <QuickAction
                        Icon={RestartIcon}
                        text="Relaunch Discord"
                        action={relaunch}
                    />
                )}
                <QuickAction
                    Icon={OwnerCrownIcon}
                    text="DEV Team"
                    action={() => setShowDevs(!showDevs)}
                />
            </QuickActionCard>

            {showDevs && (
                <div style={{ marginTop: "16px", display: "grid", gridTemplateColumns: DEV_TEAM_IDS.length > 1 ? "repeat(2, 1fr)" : "1fr", gap: "10px", maxWidth: DEV_TEAM_IDS.length > 1 ? undefined : 420, animation: "slideIn 0.3s ease-out" }}>
                    <style>{`
                        @keyframes slideIn {
                            from { opacity: 0; transform: translateY(-10px); }
                            to { opacity: 1; transform: translateY(0); }
                        }
                    `}</style>
                    {DEV_TEAM_IDS.map(dev => (
                        <DevCard key={dev.id} id={dev.id} role={dev.role} description={dev.description} name={dev.name} avatar={dev.avatar} />
                    ))}
                </div>
            )}
        </>
    );
}

type KeysOfType<Object, Type> = {
    [K in keyof Object]: Object[K] extends Type ? K : never;
}[keyof Object];

function useCompactActive() {
    const [active, setActive] = React.useState(isCompactModeEnabled);
    React.useEffect(() => {
        const handler = () => setActive(isCompactModeEnabled());
        window.addEventListener("zcord-compact-change", handler);
        return () => window.removeEventListener("zcord-compact-change", handler);
    }, []);
    return active;
}

function useStealthActive() {
    const [active, setActive] = React.useState(isStealthModeEnabled);
    React.useEffect(() => {
        const handler = () => setActive(isStealthModeEnabled());
        window.addEventListener("zcord-stealth-change", handler);
        return () => window.removeEventListener("zcord-stealth-change", handler);
    }, []);
    return active;
}

function StealthModeSection() {
    const enabled = useStealthActive();

    return (
        <>
            <Heading className={Margins.top20}>{t("Stealth Mode")}</Heading>
            <Paragraph className={Margins.bottom16}>
                {enabled
                    ? "Stealth mode is enabled â€” all Zcord visual elements are hidden. Shortcut: Ctrl+Shift+H"
                    : t("Hides all Zcord visual elements without disabling plugins. Shortcut: Ctrl+Shift+H")}
            </Paragraph>
            <Button
                onClick={toggleStealthMode}
                variant={enabled ? "secondary" : "primary"}
            >
                {enabled ? t("Disable Stealth Mode") : t("Enable Stealth Mode")}
            </Button>
        </>
    );
}

function StealthModeButton() {
    const enabled = useStealthActive();

    return (
        <Button
            onClick={toggleStealthMode}
            variant={enabled ? "dangerPrimary" : "primary"}
        >
            {enabled ? t("✓ Stealth Mode Enabled — Click to disable") : t("Enable Stealth Mode")}
        </Button>
    );
}



function EquicordSettings() {
    const settings = useSettings();
    const stealthActive = useStealthActive();
    const compactActive = useCompactActive();

    const needsVibrancySettings = IS_DISCORD_DESKTOP && IS_MAC;

    const user = UserStore?.getCurrentUser();

    const Switches: Array<false | {
        key: KeysOfType<typeof settings, boolean>;
        title: string;
        description?: string;
        restartRequired?: boolean;
        warning: { enabled: boolean; message?: string; };
    }>
        = [

            {
                key: "useQuickCss",
                title: t("Enable Custom CSS"),
                description: t("Load custom CSS from the QuickCSS editor. This allows you to customize Discord's appearance with your own styles."),
                restartRequired: true,
                warning: { enabled: false },
            },
            !IS_WEB && {
                key: "enableReactDevtools",
                title: t("Enable React Developer Tools"),
                description: t("Enable the React Developer Tools extension for debugging Discord's React components. Useful for plugin development."),
                restartRequired: true,
                warning: { enabled: false },
            },
            (!IS_WEB && !IS_DISCORD_DESKTOP || !IS_WINDOWS) && {
                key: "mainWindowFrameless",
                title: t("Disable the Main Window Frame"),
                description: t("Remove the native window frame for a cleaner look. You can still move the window by dragging the title bar area."),
                restartRequired: true,
                warning: { enabled: false },
            },
            !IS_WEB &&
            (!IS_DISCORD_DESKTOP || !IS_WINDOWS
                ? {
                    key: "frameless",
                    title: t("Disable All Window Frames"),
                    description: t("Remove the native window frame for a cleaner look. You can still move the window by dragging the title bar area."),
                    restartRequired: true,
                    warning: { enabled: false },
                }
                : {
                    key: "winNativeTitleBar",
                    title: t("Use Windows' native title bar instead of Discord's custom one"),
                    description: t("Replace Discord's custom title bar with the standard Windows title bar. This may improve compatibility with some window management tools."),
                    restartRequired: true,
                    warning: { enabled: false },
                }
            ),

            !IS_WEB && {
                key: "transparent",
                title: t("Enable Window Transparency"),
                description: t("Make the Discord window transparent. A theme that supports transparency is required or this will do nothing."),
                restartRequired: true,
                warning: {
                    enabled: true,
                    message: IS_WINDOWS
                        ? t("This will stop the window from being resizable and prevents you from snapping the window to screen edges.")
                        : t("This will stop the window from being resizable."),
                },
            },
            IS_DISCORD_DESKTOP && {
                key: "disableMinSize",
                title: t("Disable Minimum Window Size"),
                description: t("Allow the Discord window to be resized smaller than its default minimum size. Useful for tiling window managers or small screens."),
                restartRequired: true,
                warning: { enabled: false },
            },
            !IS_WEB &&
            IS_WINDOWS && {
                key: "winCtrlQ",
                title: t("Register Ctrl+Q as shortcut to close Discord"),
                description: t("Add Ctrl+Q as a keyboard shortcut to close Discord. This provides an alternative to Alt+F4 for quickly closing the application."),
                restartRequired: true,
                warning: { enabled: false },
            },
            !IS_WEB && {
                key: "streamProof",
                title: t("Enable StreamProof"),
                description: t("Hide the entire Discord window from streams, screen recordings, and screenshots. Shortcut: Ctrl+Shift+G. When enabled, capturing software will see a black window."),
                restartRequired: false,
                warning: { enabled: false },
            },
            !IS_WEB && {
                key: "disableAutoUpdate",
                title: t("Disable Automatic Updates"),
                description: t("Prevent Zcord from automatically checking, downloading, or prompting for updates on startup. You can still update manually in the \"Updater\" settings tab."),
                restartRequired: false,
                warning: { enabled: false },
            },
        ];

    return (
        <SettingsTab>

            {!stealthActive && (<>

                <Divider className={Margins.top20} />

                <Heading className={Margins.top16}>{t("Quick Actions")}</Heading>
                <Paragraph className={Margins.bottom16}>
                    {t("Common actions you might want to perform. These shortcuts give you quick access to frequently used features without navigating through menus.")}
                </Paragraph>

                <DevTeamSection />

                <Divider className={Margins.top20} />

                <Heading className={Margins.top20}>{t("Client Settings")}</Heading>
                <Paragraph className={Margins.bottom16}>
                    {t("Configure how Zcord behaves and integrates with Discord. These settings affect the Discord client's appearance and behavior.")}
                </Paragraph>
                <Notice.Info className={Margins.bottom20} style={{ width: "100%" }}>
                    {t("You can customize where this settings section appears in Discord's settings menu by configuring the")} {" "}
                    <a
                        role="button"
                        onClick={() => openPluginModal(plugins.Settings)}
                        style={{ cursor: "pointer", color: "var(--text-link)" }}
                    >
                        {t("Settings Plugin")}
                    </a>.
                </Notice.Info>



                {Switches.filter((s): s is Exclude<typeof s, false> => !!s).map(
                    s => (
                        <FormSwitch
                            key={s.key}
                            value={settings[s.key]}
                             onChange={v => {
                                 settings[s.key] = v;
                                 if (s.key === "streamProof" && typeof VencordNative !== "undefined") {
                                     VencordNative?.setContentProtection?.(v);
                                 }
                             }}
                            title={s.title}
                            description={
                                s.warning.enabled ? (
                                    <>
                                        {s.description}
                                        <Notice.Warning className={Margins.top8} style={{ width: "100%" }}>
                                            {s.warning.message}
                                        </Notice.Warning>
                                    </>
                                ) : (
                                    s.description
                                )
                            }
                            hideBorder
                        />
                    ),
                )}

                {needsVibrancySettings && (
                    <>
                        <Divider className={Margins.top20} />

                        <Heading className={Margins.top20}>Window Vibrancy</Heading>
                        <Paragraph className={Margins.bottom16}>
                            Customize the macOS window vibrancy effect. This controls the blur and transparency style of the Discord window. Changes require a restart to take effect.
                        </Paragraph>
                        <Select
                            className={Margins.bottom20}
                            placeholder="Window vibrancy style"
                            options={[
                                // Sorted from most opaque to most transparent
                                {
                                    label: "No vibrancy",
                                    value: undefined,
                                },
                                {
                                    label: "Under Page (window tinting)",
                                    value: "under-page",
                                },
                                {
                                    label: "Content",
                                    value: "content",
                                },
                                {
                                    label: "Window",
                                    value: "window",
                                },
                                {
                                    label: "Selection",
                                    value: "selection",
                                },
                                {
                                    label: "Titlebar",
                                    value: "titlebar",
                                },
                                {
                                    label: "Header",
                                    value: "header",
                                },
                                {
                                    label: "Sidebar",
                                    value: "sidebar",
                                },
                                {
                                    label: "Tooltip",
                                    value: "tooltip",
                                },
                                {
                                    label: "Menu",
                                    value: "menu",
                                },
                                {
                                    label: "Popover",
                                    value: "popover",
                                },
                                {
                                    label: "Fullscreen UI (transparent but slightly muted)",
                                    value: "fullscreen-ui",
                                },
                                {
                                    label: "HUD (Most transparent)",
                                    value: "hud",
                                },
                            ]}
                            select={v => (settings.macosVibrancyStyle = v)}
                            isSelected={v => settings.macosVibrancyStyle === v}
                            serialize={identity}
                        />
                    </>
                )}

                <Divider className={Margins.top20} />

                <Heading className={Margins.top20}>{t("Notifications")}</Heading>
                <Paragraph className={Margins.bottom16}>
                    {t("Configure how Zcord handles notifications. You can customize when and how you receive alerts, or view a history of past notifications.")}
                </Paragraph>

                <Flex gap="16px">
                    <Button onClick={openNotificationSettingsModal}>
                        {t("Notification Settings")}
                    </Button>
                    <Button variant="secondary" onClick={openNotificationLogModal}>
                        {t("View Notification Log")}
                    </Button>
                </Flex>

            </>)}

            <Divider className={Margins.top20} />

            <Heading className={Margins.top20}>{t("Compact Mode")}</Heading>
            <Paragraph className={Margins.bottom16}>
                {t("Replaces all Zcord buttons with a single compact toggle icon. Click the icon in the header bar, channel toolbar, or chat bar to restore all buttons.")}
            </Paragraph>
            <Button
                onClick={toggleCompactMode}
                variant={compactActive ? "dangerPrimary" : "primary"}
            >
                {compactActive ? t("✓ Compact Mode Enabled — Click to disable") : t("Enable Compact Mode")}
            </Button>

            <Divider className={Margins.top20} />

            <Heading className={Margins.top20}>{t("Stealth Mode")}</Heading>
            <Paragraph className={Margins.bottom16}>
                {t("Hides all Zcord visual elements without disabling plugins. Shortcut: Ctrl+Shift+H")}
            </Paragraph>
            <StealthModeButton />

        </SettingsTab>
    );
}

export default wrapTab(EquicordSettings, "Zcord Settings");



