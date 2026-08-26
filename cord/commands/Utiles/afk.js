const { language, savedb, applyRpcPresence } = require("../../fonctions");
const { RichPresence } = require("discord.js-selfbot-v13");
const database = require("../../database");

module.exports = {
  name: "afk",
  description: "Activer/désactiver le mode AFK avec anti-ping",
  run: async (client, message, args, db, prefix) => {
    try {
      const settings = await database.getSettings();
      const customName = settings?.customName || '[ sb ] Soon • Love Night';

      async function refreshRpcPresence() {
        if (!(db.rpconoff === true || db.rpconoff === 1 || db.rpconoff === "dnd")) {
          return;
        }

        const rpc = new RichPresence(client);
        applyRpcPresence(db, rpc);
        client.user.setActivity(rpc);
      }

      // Afficher le statut si aucun argument
      if (!args[0]) {
        const isAFK = db.afk === true || db.afk === 1 || db.afk === "on";
        const afkMessage = db.afkMessage || "Je suis actuellement AFK";
        const afkTime = db.afkTime ? Math.floor((Date.now() - db.afkTime) / 1000) : 0;
        
        message.edit(
          await language(
            client,
            `# ✨ ${customName} - AFK

╭ **📊 Statut AFK**
\`\`\`diff
Statut: ${isAFK ? "Activé" : "Désactivé"}
${isAFK ? `Message: ${afkMessage}` : ""}
${isAFK && afkTime > 0 ? `Depuis: <t:${Math.floor(db.afkTime / 1000)}:R>` : ""}
${isAFK ? "Anti-ping: Activé (DM et mentions)" : ""}
\`\`\``,
            `# ✨ ${customName} - AFK

╭ **📊 AFK Status**
\`\`\`yaml
Status: ${isAFK ? "Enabled" : "Disabled"}
${isAFK ? `Message: ${afkMessage}` : ""}
${isAFK && afkTime > 0 ? `Since: <t:${Math.floor(db.afkTime / 1000)}:R>` : ""}
${isAFK ? "Anti-ping: Enabled (DMs and mentions)" : ""}
\`\`\``
          )
        );
        return;
      }

      // Si argument on ou off
      if (args[0] === "on" || args[0] === "off") {
        const isAFK = db.afk === true || db.afk === 1 || db.afk === "on";
        
        if (args[0] === "off") {
          // Désactiver AFK
          db.afk = 0; // Utiliser 0 au lieu de false pour MySQL TINYINT
          db.afkMessage = null;
          db.afkTime = null;
          await savedb(client, db);
          await refreshRpcPresence();
          
          message.edit(
            await language(
              client,
              `# ✨ ${customName}

╭ **✅ Mode AFK | anti-ping automatique **
\`\`\`yaml
Mode AFK  dessactivé
\`\`\``,
              `# ✨ ${customName}

╭ **✅ AFK mode disabled | automatic anti-ping**
\`\`\`
AFK mode disabled
\`\`\``
            )
          );
        } else {
          // Activer AFK
          const afkMessage = args.slice(1).join(' ') || "Je suis actuellement AFK";
          db.afk = 1; // Utiliser 1 au lieu de true pour MySQL TINYINT
          db.afkMessage = afkMessage;
          db.afkTime = Date.now();
          await savedb(client, db);
          await refreshRpcPresence();
          
          message.edit(
            await language(
              client,
              `# ✨ ${customName}

╭ ** Mode AFK | anti-ping automatique **
\`\`\`yaml
Mode AFK activé | anti-ping automatique
Message: ${afkMessage}
\`\`\``,
              `# ✨ ${customName}

╭ ** AFK mode enabled | automatic anti-ping **
\`\`\`yaml
AFK mode enabled | automatic anti-ping 
Message: ${afkMessage}
\`\`\``
            )
          );
        }
      } else {
        // Afficher l'aide
        message.edit(
          await language(
            client,
            `# ✨ ${customName} - AFK

╭ **📋 Commandes AFK**
\`\`\`yaml
${prefix}afk ➜ Afficher le statut AFK
${prefix}afk on [message] ➜ Activer le mode AFK + anti-ping
${prefix}afk off ➜ Désactiver le mode AFK
\`\`\`
\`\`\``,
            `# ✨ ${customName} - AFK

╭ **📋 AFK Commands**
\`\`\`yaml
${prefix}afk ➜ Show AFK status
${prefix}afk on [message] ➜ Enable AFK mode + anti-ping
${prefix}afk off ➜ Disable AFK mode
\`\`\`
\`\`\``
          )
        );
      }
    } catch (error) {
      console.error('Erreur dans la commande afk:', error);
      message.edit(`❌ Erreur: ${error.message}`).catch(() => {});
    }
  },
};

