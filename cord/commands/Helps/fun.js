const { language } = require('../../fonctions');
const database = require('../../database');

module.exports = {
  name: 'fun',
  description: 'Menu fun',

  run: async (client, message, args, db, prefix) => {
    try {
      const settings = await database.getSettings();
      const customName = settings?.customName || '[ sb ] Imperx';

      await message.edit(await language(
        client,
        `# ✨ ${customName} - Fun

╭ **🎮 Commandes**
\`\`\`yaml
${prefix}fun ➜ Ce menu
${prefix}add <@user> [message] ➜ Lien d'ajout ami
${prefix}say <@user> <message> ➜ Parler via webhook
${prefix}love <@user> ➜ Message animé
${prefix}thot <@user> ➜ Score aléatoire
${prefix}coinflip ➜ Pile ou face
${prefix}bonjour ➜ Message bonjour animé
${prefix}paypal ➜ Commande PayPal
${prefix}pignouf ➜ Pignouf
${prefix}antigroup <on/off> ➜ Anti-groupe
\`\`\`
╰`,
        `# ✨ ${customName} - Fun

╭ **🎮 Commands**
\`\`\`yaml
${prefix}fun ➜ This menu
${prefix}add <@user> [message] ➜ Friend add link
${prefix}say <@user> <message> ➜ Speak via webhook
${prefix}love <@user> ➜ Animated message
${prefix}thot <@user> ➜ Random score
${prefix}coinflip ➜ Heads or tails
${prefix}bonjour ➜ Animated hello
${prefix}paypal ➜ PayPal command
${prefix}pignouf ➜ Pignouf
${prefix}antigroup <on/off> ➜ Anti-group
\`\`\`
╰`,
      ));
    } catch (error) {
      console.error('Erreur fun:', error);
    }
  },
};
