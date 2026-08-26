const { language } = require('../../fonctions');
const database = require('../../database');

module.exports = {
  name: 'voice',
  description: 'Menu vocal',

  run: async (client, message, args, db, prefix) => {
    try {
      const settings = await database.getSettings();
      const customName = settings?.customName || '[ sb ] Imperx';

      await message.edit(await language(
        client,
        `# ✨ ${customName} - Vocal

╭ **🎤 Commandes**
\`\`\`yaml
${prefix}voice ➜ Ce menu
${prefix}joinvc <#salon/id> ➜ Rejoindre un vocal
${prefix}voicesettings auto <#salon/id> ➜ Connexion auto
${prefix}voicesettings auto ➜ Désactiver l'auto
${prefix}voicesettings webcam on/off ➜ Webcam on/off
${prefix}voicesettings stream on/off ➜ Stream on/off
${prefix}setvc <id> ➜ Sauvegarder un vocal favori
\`\`\`
╰`,
        `# ✨ ${customName} - Voice

╭ **🎤 Commands**
\`\`\`yaml
${prefix}voice ➜ This menu
${prefix}joinvc <#channel/id> ➜ Join voice channel
${prefix}voicesettings auto <#channel/id> ➜ Auto-connect
${prefix}voicesettings auto ➜ Disable auto-connect
${prefix}voicesettings webcam on/off ➜ Webcam on/off
${prefix}voicesettings stream on/off ➜ Stream on/off
${prefix}setvc <id> ➜ Save favorite voice channel
\`\`\`
╰`,
      ));
    } catch (error) {
      console.error('Erreur voice:', error);
    }
  },
};
