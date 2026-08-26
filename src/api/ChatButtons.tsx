/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./ChatButton.css";

import ErrorBoundary from "@components/ErrorBoundary";
import { Logger } from "@utils/Logger";
import { classes } from "@utils/misc";
import { IconComponent } from "@utils/types";
import { Channel } from "@vencord/discord-types";
import { findCssClassesLazy } from "@webpack";
import { Clickable, Tooltip, useEffect, useState, Popout, useRef } from "@webpack/common";
import { HTMLProps, JSX, MouseEventHandler, ReactNode } from "react";

import { addCompactListener, addStealthListener, isStealthModeEnabled, removeCompactListener, removeStealthListener } from "./HeaderBar";
import { useSettings } from "./Settings";

const ButtonWrapperClasses = findCssClassesLazy("button", "buttonWrapper", "notificationDot");
const ChannelTextAreaClasses = findCssClassesLazy("buttonContainer", "channelTextArea", "button");

export interface ChatBarProps {
    channel: Channel;
    disabled: boolean;
    isEmpty: boolean;
    type: {
        analyticsName: string;
        attachments: boolean;
        autocomplete: {
            addReactionShortcut: boolean,
            forceChatLayer: boolean,
            reactions: boolean;
        },
        commands: {
            enabled: boolean;
        },
        drafts: {
            type: number,
            commandType: number,
            autoSave: boolean;
        },
        emojis: {
            button: boolean;
        },
        gifs: {
            button: boolean,
            allowSending: boolean;
        },
        gifts: {
            button: boolean;
        },
        permissions: {
            requireSendMessages: boolean;
        },
        showThreadPromptOnReply: boolean,
        stickers: {
            button: boolean,
            allowSending: boolean,
            autoSuggest: boolean;
        },
        users: {
            allowMentioning: boolean;
        },
        submit: {
            button: boolean,
            ignorePreference: boolean,
            disableEnterToSubmit: boolean,
            clearOnSubmit: boolean,
            useDisabledStylesOnSubmit: boolean;
        },
        uploadLongMessages: boolean,
        upsellLongMessages: {
            iconOnly: boolean;
        },
        showCharacterCount: boolean,
        sedReplace: boolean;
    };
}

export type ChatBarButtonFactory = (props: ChatBarProps & { isMainChat: boolean; isAnyChat: boolean; }) => JSX.Element | null;
export type ChatBarButtonData = {
    render: ChatBarButtonFactory;
    /**
     * This icon is used only for Settings UI. Your render function must still render an icon,
     * and it can be different from this one.
     */
    icon: IconComponent;
};

/**
 * Don't use this directly, use {@link addChatBarButton} and {@link removeChatBarButton} instead.
 */
export const ChatBarButtonMap = new Map<string, ChatBarButtonData>();
const logger = new Logger("ChatButtons");

/**
 * Set of button IDs hidden by the Backpack plugin.
 * Buttons in this set are rendered inside the Backpack popout instead of the main bar.
 */
export const BackpackedButtons = new Set<string>();
export const backpackListeners = new Set<() => void>();
export function notifyBackpackChange() { backpackListeners.forEach(l => l()); }

function VencordChatBarButtons(props: ChatBarProps) {
    const [, forceUpdate] = useState(0);

    useEffect(() => {
        const listener = () => forceUpdate(n => n + 1);
        addStealthListener(listener);
        addCompactListener(listener);
        window.addEventListener("zcord-stealth-change", listener);
        window.addEventListener("zcord-compact-change", listener);
        backpackListeners.add(listener);
        return () => {
            removeStealthListener(listener);
            removeCompactListener(listener);
            window.removeEventListener("zcord-stealth-change", listener);
            window.removeEventListener("zcord-compact-change", listener);
            backpackListeners.delete(listener);
        };
    }, []);

    if (isStealthModeEnabled()) return null;

    return (
        <div className="vc-chat-bar-btns" style={{ display: "contents" }}>
            <CompactChatBarToggle chatBarProps={props} />
        </div>
    );
}

export function _injectButtons(buttons: ReactNode[], props: ChatBarProps) {
    if (props.disabled || buttons.length === 0) return;
    // Guard: don't inject if already present (patch may fire in multiple bundle modules)
    if ((buttons as any[]).some((b: any) => b?.key === "vencord-chat-buttons")) return;

    buttons.unshift(<VencordChatBarButtons key="vencord-chat-buttons" {...props} />);
}

/**
 * The icon argument is used only for Settings UI. Your render function must still render an icon,
 * and it can be different from this one.
 */
export const addChatBarButton = (id: string, render: ChatBarButtonFactory, icon: IconComponent) => ChatBarButtonMap.set(id, { render, icon });
export const removeChatBarButton = (id: string) => ChatBarButtonMap.delete(id);

export interface ChatBarButtonProps {
    children: ReactNode;
    tooltip: string;
    onClick: MouseEventHandler;
    onContextMenu?: MouseEventHandler;
    onAuxClick?: MouseEventHandler;
    buttonProps?: Omit<HTMLProps<HTMLDivElement>, "size" | "onClick" | "onContextMenu" | "onAuxClick">;
}

export const ChatBarButton = ErrorBoundary.wrap((props: ChatBarButtonProps) => {
    return (
        <Tooltip text={props.tooltip}>
            {({ onMouseEnter, onMouseLeave }) => (
                <div className={`expression-picker-chat-input-button ${ChannelTextAreaClasses?.buttonContainer ?? ""}`}>
                    <Clickable
                        aria-label={props.tooltip}
                        onMouseEnter={onMouseEnter}
                        onMouseLeave={onMouseLeave}
                        className={classes(ButtonWrapperClasses.button, ChannelTextAreaClasses?.button)}
                        onClick={props.onClick}
                        onContextMenu={props.onContextMenu}
                        onAuxClick={props.onAuxClick}
                        {...props.buttonProps}
                    >
                        <div className={ButtonWrapperClasses.buttonWrapper}>
                            {props.children}
                        </div>
                    </Clickable>
                </div>
            )}
        </Tooltip>
    );
}, { noop: true });

/* Vencord Buttons context menu removed — managed by Backpack plugin */

function CompactChatPopout({ chatBarProps, closePopout }: any) {
    const { chatBarButtons } = useSettings(["uiElements.chatBarButtons.*"]).uiElements;
    const { analyticsName } = chatBarProps.type;
    return (
        <div className="compact-popout-container">
            <div className="compact-popout-grid">
                {Array.from(ChatBarButtonMap)
                    .filter(([key]) => chatBarButtons[key]?.enabled !== false)
                    .sort(([a], [b]) => (a === "Backpack" ? -1 : b === "Backpack" ? 1 : 0))
                    .map(([key, { render: Button }]) => (
                        <div key={key} style={{ display: "contents" }} onClick={closePopout}>
                            <ErrorBoundary noop>
                                <Button {...chatBarProps} isMainChat={analyticsName === "normal"} isAnyChat={["normal", "sidebar"].includes(analyticsName)} />
                            </ErrorBoundary>
                        </div>
                    ))}
            </div>
        </div>
    );
}

function CompactChatBarToggle({ chatBarProps }: any) {
    const [, forceUpdate] = useState(0);
    const [isOpen, setIsOpen] = useState(false);
    const popoutRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const listener = () => forceUpdate(n => n + 1);
        addCompactListener(listener);
        window.addEventListener("zcord-compact-change", listener);
        return () => {
            removeCompactListener(listener);
            window.removeEventListener("zcord-compact-change", listener);
        };
    }, []);

    const ChevronIcon = () => (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z" />
        </svg>
    );

    return (
        <Popout
            targetElementRef={popoutRef}
            renderPopout={() => <CompactChatPopout chatBarProps={chatBarProps} closePopout={() => setIsOpen(false)} />}
            shouldShow={isOpen}
            onRequestClose={() => setIsOpen(false)}
            position="top"
            align="right"
            spacing={8}
        >
            {() => (
                <div ref={popoutRef as any} style={{ display: "flex", alignItems: "center" }}>
                    <ChatBarButton
                        tooltip="Menu Zcord"
                        onClick={() => setIsOpen(v => !v)}
                    >
                        <ChevronIcon />
                    </ChatBarButton>
                </div>
            )}
        </Popout>
    );
}
