const Discord = require("discord.js-selfbot-v13");
const { language, savedb, applyRpcPresence } = require("../../fonctions");
const { RichPresence } = require("discord.js-selfbot-v13");

module.exports = {
  name: "clocktime",
  description: "Config your rpc",
  run: async (client, message, args, db, prefix) => {
    try {
      async function rpx() {
        const r = new RichPresence(client);
        applyRpcPresence(db, r);

        client.user.setActivity(r);
      }

      if (args[0] === "on") {
        message.edit(
          await language(
            client,
            `# ✨ [ sb ] Soon • Love Night - ClockTime

╭ **⏰ Clock Time**
\`\`\`yaml
Module Clock Time activée dans votre RPC
\`\`\`
╰`,
            `# ✨ [ sb ] Soon • Love Night - ClockTime

╭ **⏰ Clock Time**
\`\`\`yaml
Module Clock Time enabled in your RPC
\`\`\`
╰`
          )
        );
        db.rpctime = Date.now();
        savedb();
        rpx();
      } else if (args[0] === "off") {
        message.edit(
          await language(
            client,
            `# ✨ [ sb ] Soon • Love Night - ClockTime

╭ **⏰ Clock Time**
\`\`\`yaml
Module Clock Time désactivé dans votre RPC
\`\`\`
╰`,
            `# ✨ [ sb ] Soon • Love Night - ClockTime

╭ **⏰ Clock Time**
\`\`\`yaml
Module Clock Time disabled in your RPC
\`\`\`
╰`
          )
        );
        db.rpctime = null;
        savedb();
        rpx();
      }
    } catch (e) {}
  },
};
