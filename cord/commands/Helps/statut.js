const { language } = require('../../fonctions');
const database = require('../../database');

module.exports = {
  name: 'statut',
  description: 'Menu statut',

  run: async (client, message, args, db, prefix) => {
    try {
      const settings = await database.getSettings();
      const customName = settings?.customName || '[ sb ] Imperx';

      await message.edit(await language(
        client,
        `# ✨ ${customName} - Statut

╭ **🎯 Commandes**
\`\`\`yaml
${prefix}statut ➜ Ce menu
${prefix}setstatus [online/idle/dnd/invisible] ➜ Changer le statut
${prefix}clearstatus ➜ Supprimer l'activité
${prefix}customstatus emoji [emoji] ➜ Emoji de statut
${prefix}customstatus content [texte] ➜ Texte de statut
${prefix}rpc ➜ Menu RPC complet
\`\`\`
╰`,
        `# ✨ ${customName} - Status

╭ **🎯 Commands**
\`\`\`yaml
${prefix}statut ➜ This menu
${prefix}setstatus [online/idle/dnd/invisible] ➜ Change status
${prefix}clearstatus ➜ Remove activity
${prefix}customstatus emoji [emoji] ➜ Status emoji
${prefix}customstatus content [text] ➜ Status text
${prefix}rpc ➜ Full RPC menu
\`\`\`
╰`,
      ));
    } catch (error) {
      console.error('Erreur statut:', error);
    }
  },
};
