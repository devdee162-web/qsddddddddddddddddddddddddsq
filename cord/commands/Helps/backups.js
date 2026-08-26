const { language } = require('../../fonctions');
const database = require('../../database');

module.exports = {
  name: 'backups',
  description: 'Menu backups',

  run: async (client, message, args, db, prefix) => {
    const settings = await database.getSettings();
    const customName = settings?.customName || '[ sb ] Imperx';

    await message.edit(await language(
      client,
      `# ✨ ${customName} - Backups

╭ **💾 Serveur**
\`\`\`yaml
${prefix}backups ➜ Ce menu
${prefix}backup create ➜ Créer une backup serveur
${prefix}backup load ➜ Charger une backup
${prefix}backup list ➜ Liste des backups (dev)
${prefix}backup delete ➜ Supprimer une backup (dev)
\`\`\`

╭ **👤 Utilisateur**
\`\`\`yaml
${prefix}saveuser ➜ Backup de ton compte (dev)
${prefix}loaduser ➜ Restaurer ton compte (dev)
\`\`\`
╰`,
      `# ✨ ${customName} - Backups

╭ **💾 Server**
\`\`\`yaml
${prefix}backups ➜ This menu
${prefix}backup create ➜ Create server backup
${prefix}backup load ➜ Load a backup
${prefix}backup list ➜ Backup list (dev)
${prefix}backup delete ➜ Delete backup (dev)
\`\`\`

╭ **👤 User**
\`\`\`yaml
${prefix}saveuser ➜ Backup your account (dev)
${prefix}loaduser ➜ Restore your account (dev)
\`\`\`
╰`,
    ));
  },
};
