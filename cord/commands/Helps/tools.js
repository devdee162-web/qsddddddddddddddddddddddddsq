const { language } = require('../../fonctions');
const database = require('../../database');

module.exports = {
  name: 'tools',
  description: 'Menu outils',

  run: async (client, message, args, db, prefix) => {
    const settings = await database.getSettings();
    const customName = settings?.customName || '[ sb ] Imperx';

    await message.edit(await language(
      client,
      `# ✨ ${customName} - Tools

╭ **🔧 Commandes**
\`\`\`yaml
${prefix}tools ➜ Ce menu
${prefix}find [id] ➜ Trouver un membre en vocal
${prefix}lockurl [on/off/set/status] ➜ Protéger l'URL vanity
${prefix}closedms ➜ Fermer tous les MP
${prefix}emoji ➜ Créer un emoji
${prefix}ipinfo <ip> ➜ Infos IP
${prefix}rainbowrole <@role> [-stop] ➜ Rôle arc-en-ciel
${prefix}noadd <id> ➜ Verrouiller un groupe
${prefix}edituser list ➜ Modifier ton profil
${prefix}resetprofil ➜ Reset profil
${prefix}crown ➜ Voir le owner du serveur
${prefix}bump on/off/now/status ➜ Autobump Disboard (multi)
${prefix}setbump #s1 #s2 ➜ Ajouter des salons /bump
${prefix}vbh ➜ Commande VBH
\`\`\`
╰`,
      `# ✨ ${customName} - Tools

╭ **🔧 Commands**
\`\`\`yaml
${prefix}tools ➜ This menu
${prefix}find [id] ➜ Find a member in voice
${prefix}lockurl [on/off/set/status] ➜ Protect vanity URL
${prefix}closedms ➜ Close all DMs
${prefix}emoji ➜ Create an emoji
${prefix}ipinfo <ip> ➜ IP information
${prefix}rainbowrole <@role> [-stop] ➜ Rainbow role
${prefix}noadd <id> ➜ Lock a group
${prefix}edituser list ➜ Edit your profile
${prefix}resetprofil ➜ Reset profile
${prefix}crown ➜ Show server owner
${prefix}bump on/off/now/status ➜ Disboard autobump (multi)
${prefix}setbump #c1 #c2 ➜ Add /bump channels
${prefix}vbh ➜ VBH command
\`\`\`
╰`,
    ));
  },
};
