const { language, savedb } = require("../../fonctions");
const { CustomStatus } = require("discord.js-selfbot-v13");

module.exports = {
    name: "customstatus",
    description: "Config your status",

    run: async (client, message, args, db, prefix) => {
        try {

            function updateStatus() {
                try {

                    const texts = Array.isArray(db.rpctextstatus)
                        ? db.rpctextstatus
                        : [];

                    let currentText = "";

                    if (texts.length > 0) {
                        const index =
                            Math.floor(Date.now() / 20000) % texts.length;

                        currentText = texts[index];
                    }

                    const status = new CustomStatus(client);

                    if (db.rpcemoji) {
                        status.setEmoji(db.rpcemoji);
                    }

                    if (currentText) {
                        status.setState(currentText);
                    }

                    client.user.setActivity(status);

                } catch (err) {
                    console.log("Custom Status Error:", err);
                }
            }

            async function rpx() {

                updateStatus();

                if (client.customStatusInterval) {
                    clearInterval(client.customStatusInterval);
                }

                client.customStatusInterval = setInterval(() => {
                    updateStatus();
                }, 20000);
            }

            if (!args[0]) {
                return message.edit(
                    await language(
                        client,
                        `# ✨ [ sb ] Soon • Love Night - STATUS

╭ **📋 Commandes Custom Status**
\`\`\`yaml
${prefix}customstatus emoji [emoji]
${prefix}customstatus content [texte1] [texte2] [texte3]
\`\`\`

Exemple :
\`\`\`
${prefix}customstatus emoji ❤️
${prefix}customstatus content [text1] [text2] [text3]
\`\`\`
╰`,
                        `# ✨ [ sb ] Soon • Love Night - STATUS

╭ **📋 Custom Status Commands**
\`\`\`yaml
${prefix}customstatus emoji [emoji]
${prefix}customstatus content [text1] [text2] [text3]
\`\`\`
╰`
                    )
                );
            }

            switch (args[0].toLowerCase()) {

                case "emoji": {

                    if (!args[1]) {

                        db.rpcemoji = null;

                        savedb(client, db);

                        await message.edit(
                            await language(
                                client,
                                "✅ Emoji supprimé du statut",
                                "✅ Status emoji removed"
                            )
                        );

                        return rpx();
                    }

                    db.rpcemoji = args.slice(1).join(" ");

                    savedb(client, db);

                    await message.edit(
                        await language(
                            client,
                            `✅ Emoji défini sur ${db.rpcemoji}`,
                            `✅ Emoji set to ${db.rpcemoji}`
                        )
                    );

                    return rpx();
                }

                case "content": {

                    if (args.length < 2) {

                        db.rpctextstatus = [];

                        savedb(client, db);

                        await message.edit(
                            await language(
                                client,
                                "✅ Textes supprimés",
                                "✅ Status texts removed"
                            )
                        );

                        return rpx();
                    }

                    const content = args.slice(1).join(" ");

                    const matches = [
                        ...content.matchAll(/\[(.*?)\]/g)
                    ];

                    if (!matches.length) {

                        return message.edit(
                            await language(
                                client,
                                `❌ Format invalide

Exemple :

${prefix}customstatus content [Texte 1] [Texte 2] [Texte 3]`,
                                `❌ Invalid format

Example :

${prefix}customstatus content [Text 1] [Text 2] [Text 3]`
                            )
                        );
                    }

                    db.rpctextstatus = matches.map(
                        x => x[1].trim()
                    );

                    savedb(client, db);

                    await message.edit(
                        await language(
                            client,
                            `✅ ${db.rpctextstatus.length} statut(s) enregistré(s)

${db.rpctextstatus
    .map((s, i) => `${i + 1}. ${s}`)
    .join("\n")}`,
                            `✅ ${db.rpctextstatus.length} status(es) saved`
                        )
                    );

                    return rpx();
                }

                default: {

                    return message.edit(
                        await language(
                            client,
                            `❌ Commande inconnue

Utilisation :

${prefix}customstatus emoji ❤️
${prefix}customstatus content [Texte 1] [Texte 2] [Texte 3]`,
                            `❌ Unknown command`
                        )
                    );
                }
            }

        } catch (e) {
            console.log(e);
        }
    }
};