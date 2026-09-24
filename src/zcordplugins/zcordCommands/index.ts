/*
 * Zcord, a Discord client mod
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, sendBotMessage } from "@api/Commands";
import { gitHashShort } from "@shared/vencordUserAgent";
import definePlugin from "@utils/types";
import { SettingsRouter } from "@webpack/common";

export default definePlugin({
    name: "ZcordCommands",
    description: "Commandes slash Zcord (/zcord, /zcord-plugins, /zcord-restart)",
    authors: [{ name: "Zcord", id: 0n }],
    required: true,
    dependencies: ["CommandsAPI"],
    commands: [
        {
            name: "zcord",
            description: "Affiche les infos du client Zcord",
            inputType: ApplicationCommandInputType.BUILT_IN_TEXT,
            options: [],
            execute: (_opts, ctx) => {
                sendBotMessage(ctx.channel.id, {
                    content: [
                        "**Zcord**",
                        `Version: \`${VERSION}\``,
                        `Hash: \`${gitHashShort}\``,
                        `Standalone: \`${IS_STANDALONE}\``,
                        "",
                        "Palette : filtre **Zcord** pour Settings / Plugins / Themes / QuickCSS."
                    ].join("\n")
                });
            }
        },
        {
            name: "zcord-plugins",
            description: "Ouvre les réglages plugins Zcord",
            inputType: ApplicationCommandInputType.BUILT_IN_TEXT,
            options: [],
            execute: async (_opts, ctx) => {
                try {
                    await SettingsRouter.openUserSettings("equicord_plugins_panel");
                } catch {
                    sendBotMessage(ctx.channel.id, {
                        content: "Impossible d’ouvrir les plugins. Utilise Paramètres → Zcord → Plugins."
                    });
                }
            }
        },
        {
            name: "zcord-restart",
            description: "Recharge Zcord",
            inputType: ApplicationCommandInputType.BUILT_IN_TEXT,
            options: [],
            execute: (_opts, ctx) => {
                sendBotMessage(ctx.channel.id, {
                    content: "Redémarrage de Zcord…"
                });
                setTimeout(() => window.location.reload(), 400);
            }
        }
    ]
});
