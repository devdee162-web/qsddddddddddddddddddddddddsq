const { language } = require('../../fonctions');
const database = require('../../database');
const { hasPremiumRole } = require('../../role-access');

function buildMenu(prefix, premium) {
  const lines = [
    `${prefix}help ➜ Menu principal`,
    `${prefix}utility ➜ Utilitaires`,
    `${prefix}tools ➜ Outils`,
    `${prefix}mod ➜ Modération`,
    `${prefix}fun ➜ Fun`,
    `${prefix}nsfw ➜ NSFW`,
    `${prefix}rpc ➜ RPC / Activité`,
  ];

  if (premium) {
    lines.push(`${prefix}statut ➜ Statut`);
  }

  lines.push(
    `${prefix}voice ➜ Vocal`,
    `${prefix}settings ➜ Paramètres`,
  );

  if (premium) {
    lines.push(
      `${prefix}crfast ➜ Création rapide`,
      `${prefix}backups ➜ Backups`,
    );
  }

  return lines.join('\n');
}

function buildMenuEn(prefix, premium) {
  const lines = [
    `${prefix}help ➜ Main menu`,
    `${prefix}utility ➜ Utility`,
    `${prefix}tools ➜ Tools`,
    `${prefix}mod ➜ Moderation`,
    `${prefix}fun ➜ Fun`,
    `${prefix}nsfw ➜ NSFW`,
    `${prefix}rpc ➜ RPC / Activity`,
  ];

  if (premium) {
    lines.push(`${prefix}statut ➜ Status`);
  }

  lines.push(
    `${prefix}voice ➜ Voice`,
    `${prefix}settings ➜ Settings`,
  );

  if (premium) {
    lines.push(
      `${prefix}crfast ➜ Fast create`,
      `${prefix}backups ➜ Backups`,
    );
  }

  return lines.join('\n');
}

module.exports = {
  name: 'help',
  description: 'Menu principal',

  run: async (client, message, args, db, prefix) => {
    try {
      const settings = await database.getSettings();
      const customName = settings?.customName || '[ sb ] Imperx';
      const premium = await hasPremiumRole(client);

      await message.edit(await language(
        client,
        `# ✨ ${customName}

╭ **📚 Catégories**
\`\`\`yaml
${buildMenu(prefix, premium)}
\`\`\`
╰`,
        `# ✨ ${customName}

╭ **📚 Categories**
\`\`\`yaml
${buildMenuEn(prefix, premium)}
\`\`\`
╰`,
      ));
    } catch (error) {
      console.error('Erreur help:', error);
    }
  },
};
