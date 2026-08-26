const { language } = require('../../fonctions');
const { getGuildConfig, upsertGuildConfig } = require('../../lockvanity-store');

function normalizeVanityCode(input) {
  return String(input || '')
    .trim()
    .replace(/^https?:\/\/(www\.)?discord\.gg\//i, '')
    .replace(/^discord\.gg\//i, '');
}

module.exports = {
  name: 'lockurl',
  description: "Protège l'URL vanity d'un serveur contre les modifications",

  run: async (client, message, args) => {
    try {
      if (!message.guild) {
        return message.edit(await language(
          client,
          '> Cette commande ne peut être utilisée que dans un serveur.',
          '> This command can only be used in a server.',
        ));
      }

      if (!message.member?.permissions?.has?.('ADMINISTRATOR')) {
        return message.edit(await language(
          client,
          '> Vous devez être administrateur pour utiliser cette commande.',
          '> You must be an administrator to use this command.',
        ));
      }

      const guildId = message.guild.id;
      let guildConfig = getGuildConfig(client.user.id, guildId);

      if (!args[0]) {
        if (!guildConfig) {
          return message.edit(await language(
            client,
            "> La protection d'URL vanity n'est pas configurée pour ce serveur.",
            '> Vanity URL protection is not configured for this server.',
          ));
        }

        const info = [
          `**Configuration vanity — ${message.guild.name}**`,
          `**Statut :** ${guildConfig.status ? 'Activée' : 'Désactivée'}`,
          `**URL protégée :** \`${guildConfig.vanityUrl || 'Non définie'}\``,
          '',
          '**Commandes :**',
          '`on` · activer la protection',
          '`off` · désactiver la protection',
          '`set <url>` · définir l\'URL à protéger',
          '`status` · voir l\'état actuel',
        ].join('\n');

        return message.edit(info);
      }

      const action = args[0].toLowerCase();

      if (action === 'on') {
        if (!guildConfig) {
          const vanityData = await message.guild.fetchVanityData().catch(() => null);
          if (!vanityData?.code) {
            return message.edit(await language(
              client,
              "> Ce serveur n'a pas d'URL vanity. Définissez-en une d'abord.",
              "> This server doesn't have a vanity URL. Set one first.",
            ));
          }

          guildConfig = upsertGuildConfig(client.user.id, {
            id: guildId,
            status: true,
            vanityUrl: vanityData.code,
            logChannelId: message.channel.id,
          });
        } else {
          guildConfig = upsertGuildConfig(client.user.id, {
            id: guildId,
            status: true,
          });
        }

        return message.edit(await language(
          client,
          `> Protection vanity activée pour \`${guildConfig.vanityUrl}\``,
          `> Vanity protection enabled for \`${guildConfig.vanityUrl}\``,
        ));
      }

      if (action === 'off') {
        if (guildConfig) {
          upsertGuildConfig(client.user.id, {
            id: guildId,
            status: false,
          });
        }

        return message.edit(await language(
          client,
          '> Protection vanity désactivée pour ce serveur.',
          '> Vanity protection disabled for this server.',
        ));
      }

      if (action === 'set') {
        if (!args[1]) {
          return message.edit(await language(
            client,
            '> Veuillez spécifier une URL vanity à protéger.',
            '> Please specify a vanity URL to protect.',
          ));
        }

        const vanityUrl = normalizeVanityCode(args[1]);
        guildConfig = upsertGuildConfig(client.user.id, {
          id: guildId,
          status: true,
          vanityUrl,
          logChannelId: message.channel.id,
        });

        return message.edit(await language(
          client,
          `> URL vanity définie sur \`${vanityUrl}\` et sera protégée.`,
          `> Vanity URL set to \`${vanityUrl}\` and will be protected.`,
        ));
      }

      if (action === 'status') {
        if (!guildConfig) {
          return message.edit(await language(
            client,
            "> La protection d'URL vanity n'est pas configurée pour ce serveur.",
            '> Vanity URL protection is not configured for this server.',
          ));
        }

        const vanityData = await message.guild.fetchVanityData().catch(() => null);
        const currentVanity = vanityData?.code || 'Aucune';
        const protectedVanity = guildConfig.vanityUrl || 'Non définie';
        const status = guildConfig.status ? 'Activée' : 'Désactivée';

        const info = [
          `**État vanity — ${message.guild.name}**`,
          `**Statut :** ${status}`,
          `**URL actuelle :** \`${currentVanity}\``,
          `**URL protégée :** \`${protectedVanity}\``,
          `**Protection :** ${guildConfig.status ? 'active' : 'inactive'}`,
        ].join('\n');

        return message.edit(info);
      }

      return message.edit(await language(
        client,
        '> Commande non reconnue. Utilise `lockurl` sans argument pour voir les options.',
        '> Unknown command. Use `lockurl` with no arguments to see options.',
      ));
    } catch (error) {
      console.error('Erreur lockurl:', error);
      message.edit(`❌ Erreur : ${error.message}`).catch(() => {});
    }
  },
};
