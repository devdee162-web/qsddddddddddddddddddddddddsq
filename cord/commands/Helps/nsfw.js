const { language } = require('../../fonctions');
const { NSFW_COMMANDS } = require('../../nekobot-cmd');
const database = require('../../database');

module.exports = {
  name: 'nsfw',
  description: 'Menu NSFW',

  run: async (client, message, args, db, prefix) => {
    try {
      const settings = await database.getSettings();
      const customName = settings?.customName || '[ sb ] Imperx';
      const lines = NSFW_COMMANDS.map((cmd) => `${prefix}${cmd.name} ➜ ${cmd.type}`);

      await message.edit(await language(
        client,
        `# ✨ ${customName} - NSFW

╭ **🔞 Commandes**
\`\`\`yaml
${prefix}nsfw ➜ Ce menu
${lines.join('\n')}
${prefix}nimg <type> ➜ Image par type
\`\`\`
╰`,
        `# ✨ ${customName} - NSFW

╭ **🔞 Commands**
\`\`\`yaml
${prefix}nsfw ➜ This menu
${lines.join('\n')}
${prefix}nimg <type> ➜ Image by type
\`\`\`
╰`,
      ));
    } catch (error) {
      console.error('Erreur nsfw:', error);
    }
  },
};
