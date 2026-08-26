const { language } = require('../../fonctions');
const { NSFW_COMMANDS } = require('../../nekobot-cmd');
const { fetchNekoImage, sendNekoImage } = require('../../nekobot-api');
const database = require('../../database');

module.exports = {
  name: 'nimg',
  description: 'Image NSFW NekoBot par type',

  run: async (client, message, args, db, prefix) => {
    try {
      const type = args[0]?.toLowerCase();
      const validTypes = NSFW_COMMANDS.map((cmd) => cmd.type);

      if (!type) {
        const settings = await database.getSettings();
        const customName = settings?.customName || '[ sb ] Imperx';
        const list = NSFW_COMMANDS.map((cmd) => `${prefix}${cmd.name}`).join(', ');

        return message.edit(await language(
          client,
          `# ✨ ${customName} - NSFW\n> Types : \`${validTypes.join('`, `')}\`\n> Raccourcis : ${list}\n> \`${prefix}nimg <type>\``,
          `# ✨ ${customName} - NSFW\n> Types: \`${validTypes.join('`, `')}\`\n> Shortcuts: ${list}\n> \`${prefix}nimg <type>\``,
        ));
      }

      if (!validTypes.includes(type)) {
        return message.edit(await language(
          client,
          `> Type invalide. Disponibles : \`${validTypes.join('`, `')}\``,
          `> Invalid type. Available: \`${validTypes.join('`, `')}\``,
        ));
      }

      await message.delete().catch(() => {});

      const image = await fetchNekoImage(type);
      if (!image) {
        return message.channel.send(await language(
          client,
          "Impossible de récupérer l'image. Veuillez réessayer plus tard.",
          'Unable to fetch the image. Please try again later.',
        )).catch(() => {});
      }

      await sendNekoImage(message.channel, image);
    } catch (error) {
      console.error('Erreur nimg:', error.message);
      message.edit(`❌ Erreur : ${error.message}`).catch(() => {});
    }
  },
};
