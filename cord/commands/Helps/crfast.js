const { language } = require('../../fonctions');
const database = require('../../database');

module.exports = {
  name: 'crfast',
  description: 'Menu création rapide',

  run: async (client, message, args, db, prefix) => {
    const settings = await database.getSettings();
    const customName = settings?.customName || '[ sb ] Imperx';

    await message.edit(await language(
      client,
      `# ✨ ${customName} - Création rapide

╭ **⚡ Commandes**
\`\`\`yaml
${prefix}crfast ➜ Ce menu
${prefix}createchannel <nom> ➜ Créer un salon texte
${prefix}createvoice <nom> ➜ Créer un salon vocal
${prefix}createrole <nom> ➜ Créer un rôle
${prefix}createwebhook <nom> ➜ Créer un webhook
${prefix}createserver <nom> ➜ Créer un serveur
${prefix}create <emoji/lien> ➜ Créer un emoji
\`\`\`
╰`,
      `# ✨ ${customName} - Fast create

╭ **⚡ Commands**
\`\`\`yaml
${prefix}crfast ➜ This menu
${prefix}createchannel <name> ➜ Create text channel
${prefix}createvoice <name> ➜ Create voice channel
${prefix}createrole <name> ➜ Create role
${prefix}createwebhook <name> ➜ Create webhook
${prefix}createserver <name> ➜ Create server
${prefix}create <emoji/link> ➜ Create emoji
\`\`\`
╰`,
    ));
  },
};
