const { language } = require('../../fonctions');
const database = require('../../database');

module.exports = {
  name: 'rpc',
  description: 'Menu RPC',

  run: async (client, message, args, db, prefix) => {
    try {
      const settings = await database.getSettings();
      const customName = settings?.customName || '[ sb ] Imperx';

      await message.edit(await language(
        client,
        `# ✨ ${customName} - RPC

╭ **📋 Commandes**
\`\`\`yaml
${prefix}rpc ➜ Ce menu
${prefix}configrpc list ➜ Configurer ton RPC
${prefix}setrpc [nom/list] ➜ Activer un RPC
${prefix}rpcsettings ➜ Paramètres RPC
${prefix}setstatus [online/idle/dnd/invisible] ➜ Changer le statut
${prefix}clearstatus ➜ Supprimer l'activité
${prefix}customstatus emoji/content ➜ Statut personnalisé
${prefix}spotify ➜ Activité Spotify
${prefix}configspotify ➜ Config Spotify
${prefix}clocktime [on/off] ➜ Heure en activité
\`\`\`
╰`,
        `# ✨ ${customName} - RPC

╭ **📋 Commands**
\`\`\`yaml
${prefix}rpc ➜ This menu
${prefix}configrpc list ➜ Configure your RPC
${prefix}setrpc [name/list] ➜ Enable an RPC
${prefix}rpcsettings ➜ RPC settings
${prefix}setstatus [online/idle/dnd/invisible] ➜ Change status
${prefix}clearstatus ➜ Remove activity
${prefix}customstatus emoji/content ➜ Custom status
${prefix}spotify ➜ Spotify activity
${prefix}configspotify ➜ Spotify config
${prefix}clocktime [on/off] ➜ Clock activity
\`\`\`
╰`,
      ));
    } catch (error) {
      console.error('Erreur rpc:', error);
    }
  },
};
