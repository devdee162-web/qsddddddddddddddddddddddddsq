const { language } = require('../../fonctions');
const database = require('../../database');

module.exports = {
  name: 'mod',
  description: 'Menu modération',

  run: async (client, message, args, db, prefix) => {
    const settings = await database.getSettings();
    const customName = settings?.customName || '[ sb ] Imperx';

    await message.edit(await language(
      client,
      `# ✨ ${customName} - Modération

╭ **🛡️ Commandes**
\`\`\`yaml
${prefix}mod ➜ Ce menu
${prefix}kickbots ➜ Expulser tous les bots
${prefix}clearperms ➜ Retirer les perms dangereuses
${prefix}syncperms ➜ Synchroniser les permissions
${prefix}renew ➜ Recréer le salon actuel
\`\`\`
╰`,
      `# ✨ ${customName} - Moderation

╭ **🛡️ Commands**
\`\`\`yaml
${prefix}mod ➜ This menu
${prefix}kickbots ➜ Kick all bots
${prefix}clearperms ➜ Remove dangerous permissions
${prefix}syncperms ➜ Sync permissions
${prefix}renew ➜ Recreate current channel
\`\`\`
╰`,
    ));
  },
};
