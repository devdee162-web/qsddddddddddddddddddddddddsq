const Discord = require("discord.js-selfbot-v13");
const { language, savedb } = require("../../fonctions");
const database = require("../../database");

module.exports = {
  name: "settings",
  description: "Affiche les paramètres du selfbot",
  run: async (client, message, args, db, prefix) => {
    try {
      const settings = await database.getSettings();
      const customName = settings?.customName || '[ sb ] Soon • Love Night';
      
      // Convertir les valeurs booléennes pour l'affichage
      const getStatusText = (value) => {
        if (value === 1 || value === true || value === "1") return "✅ Activé";
        if (value === 0 || value === false || value === "0" || value === "off") return "❌ Désactivé";
        return value || "Aucun";
      };

      const getLangText = (lang) => {
        return lang === "fr" ? "🇫🇷 Français" : lang === "en" ? "🇬🇧 English" : lang || "Aucun";
      };

      message.edit(
        await language(
          client,
          `# ✨ ${customName} - Paramètres

╭ **⚙️ Paramètres Généraux**
\`\`\`yaml
Préfixe: ${db.prefix || "&"}
Langue: ${getLangText(db.langue)}
Statut: ${db.status || "dnd"}
\`\`\`

╭ **🔔 Notifications & Anti-Groupe**
\`\`\`yaml
Anti-Groupe: ${getStatusText(db.noaddgrp)}
Message Anti-Groupe: ${db.noaddgrptext || "Aucun"}
\`\`\`

╭ **🎮 Vocal**
\`\`\`yaml
Salon Vocal: ${db.voiceconnect || "Aucun"}
Muet: ${getStatusText(db.voicemute)}
Sourd: ${getStatusText(db.voicedeaf)}
Webcam: ${getStatusText(db.voicewebcam)}
Stream: ${getStatusText(db.voicestream)}
\`\`\`

╭ **💤 AFK**
\`\`\`yaml
Mode AFK: ${getStatusText(db.afk)}
Message AFK: ${db.afkMessage || "Aucun"}
\`\`\`

╭ **🔗 Webhooks & Autres**
\`\`\`yaml
Webhook Logs: ${db.webhooklogs || "Aucun"}
About Me: ${db.aboutme || "Aucun"}
Hype: ${db.hype || "Aucun"}
\`\`\`
╰`,
          `# ✨ ${customName} - Settings

╭ **⚙️ General Settings**
\`\`\`yaml
Prefix: ${db.prefix || "&"}
Language: ${getLangText(db.langue)}
Status: ${db.status || "dnd"}
\`\`\`

╭ **🔔 Notifications & Anti-Group**
\`\`\`yaml
Anti-Group: ${getStatusText(db.noaddgrp)}
Anti-Group Message: ${db.noaddgrptext || "None"}
\`\`\`

╭ **🎮 Voice**
\`\`\`yaml
Voice Channel: ${db.voiceconnect || "None"}
Muted: ${getStatusText(db.voicemute)}
Deafened: ${getStatusText(db.voicedeaf)}
Webcam: ${getStatusText(db.voicewebcam)}
Stream: ${getStatusText(db.voicestream)}
\`\`\`

╭ **💤 AFK**
\`\`\`yaml
AFK Mode: ${getStatusText(db.afk)}
AFK Message: ${db.afkMessage || "None"}
\`\`\`

╭ **🔗 Webhooks & Others**
\`\`\`yaml
Webhook Logs: ${db.webhooklogs || "None"}
About Me: ${db.aboutme || "None"}
Hype: ${db.hype || "None"}
\`\`\`
╰`
        )
      );
    } catch (error) {
      console.error('Erreur dans la commande settings:', error);
      console.error(error.stack);
    }
  },
};


