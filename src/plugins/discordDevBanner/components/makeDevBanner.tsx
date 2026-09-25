/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import SettingsPlugin from "@plugins/_core/settings";
import { detectClient } from "@plugins/_core/supportHelper";
import { gitHashShort } from "@shared/vencordUserAgent";
import { React } from "@webpack/common";
import { JSX } from "react";

import { ChromiumIcon, ClientIcon, DevBannerIcon, DiscordIcon, ElectronIcon, names, settings, ZcordIcon } from ".";

export function makeDevBanner(state?: string): string | JSX.Element {
    try {
        const env = (window as any).GLOBAL_ENV ?? {};
        const RELEASE_CHANNEL = String(env.RELEASE_CHANNEL ?? "stable");
        const BUILD_NUMBER = String(env.BUILD_NUMBER ?? "?");
        const VERSION_HASH = String(env.VERSION_HASH ?? "unknown");
        const buildChannel = names[RELEASE_CHANNEL] || (RELEASE_CHANNEL.charAt(0).toUpperCase() + RELEASE_CHANNEL.slice(1));
        const { chromiumVersion, electronVersion, getVersionInfo } = SettingsPlugin;
        const format = settings.store.format ?? "{zcordIcon} Zcord {zcordVersion} ({zcordHash})";
        const baseFormat = state ?? format;

        const clientInfo = detectClient();
        const zcordName = "Zcord";
        const zcordVersion = typeof VERSION !== "undefined" ? VERSION : "?";
        const zcordHash = gitHashShort || "unknown";
        const zcordPlatform = typeof getVersionInfo === "function" ? getVersionInfo(false) : "";

        const replaced = baseFormat
            .replace(/{buildChannel}/g, buildChannel)
            .replace(/{buildNumber}/g, BUILD_NUMBER)
            .replace(/{buildHash}/g, VERSION_HASH.slice(0, 9))
            .replace(/{zcordName}|{equicordName}/g, zcordName)
            .replace(/{zcordVersion}|{equicordVersion}/g, String(zcordVersion))
            .replace(/{zcordHash}|{equicordHash}/g, zcordHash)
            .replace(/{zcordPlatform}|{equicordPlatform}/g, String(zcordPlatform ?? ""))
            .replace(/{electronVersion}/g, String(electronVersion ?? ""))
            .replace(/{chromiumVersion}/g, String(chromiumVersion ?? ""))
            .replace(/{clientName}/g, clientInfo?.name ?? "Zcord")
            .replace(/{clientVersion}/g, `v${clientInfo?.version ?? "0.0.0"}`)
            .replace(/{equibopHash}/g, clientInfo?.shortHash ?? "Not Supported")
            .replace(/{equibopPlatform}/g, `v${clientInfo?.dev ? "Dev Build" : "Standalone"}`)
            .replace(/\\n|{newline}/g, "__NEWLINE__");

        if (!replaced.includes("__NEWLINE__") && !/{.*Icon}/.test(baseFormat)) {
            return replaced;
        }

        const parts = replaced.split(/({.*?}|__NEWLINE__)/).filter(Boolean).map((part, i) => {
            switch (part) {
                case "{discordIcon}":
                    return <span key={`icon-discord-${i}`} className="vc-discord-dev-banner-icons"><DiscordIcon /></span>;
                case "{zcordIcon}":
                case "{equicordIcon}":
                    return <span key={`icon-zcord-${i}`} className="vc-discord-dev-banner-icons"><ZcordIcon /></span>;
                case "{electronIcon}":
                    return <span key={`icon-electron-${i}`} className="vc-discord-dev-banner-icons"><ElectronIcon /></span>;
                case "{chromiumIcon}":
                    return <span key={`icon-chromium-${i}`} className="vc-discord-dev-banner-icons"><ChromiumIcon /></span>;
                case "{devbannerIcon}":
                    return <span key={`icon-dev-${i}`} className="vc-discord-dev-banner-icons"><DevBannerIcon /></span>;
                case "{clientIcon}":
                    return <span key={`icon-client-${i}`} className="vc-discord-dev-banner-icons"><ClientIcon /></span>;
                case "__NEWLINE__":
                    return <br key={`br-${i}`} />;
                default:
                    return <React.Fragment key={`text-${i}`}>{part}</React.Fragment>;
            }
        });

        return <div style={{ display: "inline" }}>{parts}</div>;
    } catch (e) {
        console.warn("[DiscordDevBanner] makeDevBanner failed:", e);
        return `Zcord ${typeof VERSION !== "undefined" ? VERSION : ""}`;
    }
}
