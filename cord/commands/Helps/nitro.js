const { language } = require('../../fonctions');
const database = require('../../database');

module.exports = {
  name: 'nitro',
  description: 'Menu nitro',

  run: async (client, message, args, db, prefix) => {
    try {
      const settings = await database.getSettings();
      const customName = settings?.customName || '[ sb ] Imperx';

      await message.edit(await language(
        client,
        `# ✨ ${customName} - Nitro

╭ **💎 Commandes**
\`\`\`yaml
${prefix}nitro ➜ Ce menu
${prefix}gen <nombre> ➜ Générer des codes nitro
${prefix}fakenitro ➜ Drop faux nitro
${prefix}nitrotroll ➜ Faux nitro personnalisé
${prefix}togglesniper <on/off> ➜ Sniper nitro on/off
\`\`\`
╰`,
        `# ✨ ${customName} - Nitro

╭ **💎 Commands**
\`\`\`yaml
${prefix}nitro ➜ This menu
${prefix}gen <amount> ➜ Generate nitro codes
${prefix}fakenitro ➜ Drop fake nitro
${prefix}nitrotroll ➜ Custom fake nitro
${prefix}togglesniper <on/off> ➜ Nitro sniper on/off
\`\`\`
╰`,
      ));
    } catch (error) {
      console.error('Erreur nitro:', error);
    }
  },
};
