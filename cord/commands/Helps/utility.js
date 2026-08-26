const { language } = require('../../fonctions');
const database = require('../../database');

module.exports = {
  name: 'utility',
  description: 'Menu utilitaires',

  run: async (client, message, args, db, prefix) => {
    const settings = await database.getSettings();
    const customName = settings?.customName || '[ sb ] Imperx';

    await message.edit(await language(
      client,
      `# ✨ ${customName} - Utilitaires

╭ **📋 Commandes**
\`\`\`yaml
${prefix}utility ➜ Ce menu
${prefix}afk [on/off] [message] ➜ Mode AFK + anti-ping
${prefix}avatar [@user] ➜ Avatar d'un membre
${prefix}banner [@user] ➜ Bannière d'un membre
${prefix}userinfo [@user] ➜ Infos utilisateur
${prefix}serverinfo [id] ➜ Infos serveur
${prefix}ping ➜ Latence du selfbot
${prefix}setavatar ➜ Changer ton avatar
${prefix}clear [nombre] ➜ Supprimer tes messages
${prefix}snipe ➜ Dernier message supprimé
${prefix}ghostping [@user] ➜ Ghost ping
${prefix}notes add/list/del ➜ Bloc-notes perso
${prefix}search <texte> ➜ Recherche Google
${prefix}calcul <expression> ➜ Calcul mathématique
${prefix}leaveguild <id> ➜ Quitter un serveur
${prefix}leaveserver <id> ➜ Quitter un serveur
${prefix}leaveallguild ➜ Quitter tous les serveurs
\`\`\`
╰`,
      `# ✨ ${customName} - Utility

╭ **📋 Commands**
\`\`\`yaml
${prefix}utility ➜ This menu
${prefix}afk [on/off] [message] ➜ AFK mode + anti-ping
${prefix}avatar [@user] ➜ User avatar
${prefix}banner [@user] ➜ User banner
${prefix}userinfo [@user] ➜ User info
${prefix}serverinfo [id] ➜ Server info
${prefix}ping ➜ Selfbot latency
${prefix}setavatar ➜ Change your avatar
${prefix}clear [amount] ➜ Delete your messages
${prefix}snipe ➜ Last deleted message
${prefix}ghostping [@user] ➜ Ghost ping
${prefix}notes add/list/del ➜ Personal notes
${prefix}search <text> ➜ Google search
${prefix}calcul <expression> ➜ Math calculation
${prefix}leaveguild <id> ➜ Leave a server
${prefix}leaveserver <id> ➜ Leave a server
${prefix}leaveallguild ➜ Leave all servers
\`\`\`
╰`,
    ));
  },
};
