const { language } = require('../../fonctions');
const database = require('../../database');

module.exports = {
  name: 'settings',
  description: 'Menu paramètres',

  run: async (client, message, args, db, prefix) => {
    try {
      const settings = await database.getSettings();
      const customName = settings?.customName || '[ sb ] Imperx';

      await message.edit(await language(
        client,
        `# ✨ ${customName} - Paramètres

╭ **⚙️ Commandes**
\`\`\`yaml
${prefix}settings ➜ Voir ta configuration
${prefix}setprefix <prefix> ➜ Changer le prefix
${prefix}setlang <fr/en> ➜ Changer la langue
${prefix}setusername <nom> ➜ Changer le pseudo
${prefix}setbump #s1 #s2 ➜ Autobump multi-serveurs
${prefix}bump on/off/now/status ➜ Gérer l'autobump
${prefix}setwb ➜ Configurer les webhooks
\`\`\`
╰`,
        `# ✨ ${customName} - Settings

╭ **⚙️ Commands**
\`\`\`yaml
${prefix}settings ➜ View your config
${prefix}setprefix <prefix> ➜ Change prefix
${prefix}setlang <fr/en> ➜ Change language
${prefix}setusername <name> ➜ Change username
${prefix}setbump #c1 #c2 ➜ Multi-server autobump
${prefix}bump on/off/now/status ➜ Manage autobump
${prefix}setwb ➜ Configure webhooks
\`\`\`
╰`,
      ));
    } catch (error) {
      console.error('Erreur settings help:', error);
    }
  },
};
