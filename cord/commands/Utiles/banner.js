const Discord = require("discord.js-selfbot-v13");
const { language } = require("../../fonctions");

module.exports = {
  name: "banner",
  description: "Get a user's banner",
  run: async (client, message, args) => {
    try {
      let user;
      if (args.length > 0) {
        const mention = args[0];
        const userID = mention.replace(/[^0-9]/g, "");

        user = client.users.cache.get(userID);
        if (!user) {
          user = await client.users.fetch(userID).catch(() => null);
        }

        if (!user) {
          return message.edit(
            await language(
              client,
              `# ✨ [ sb ] Soon • Love Night

╭ **⚠️ Erreur**
\`\`\`yaml
Utilisateur introuvable. Veuillez spécifier un utilisateur valide.
\`\`\`
╰`,
              `# ✨ [ sb ] Soon • Love Night

╭ **⚠️ Error**
\`\`\`yaml
User not found. Please specify a valid user.
\`\`\`
╰`
            )
          );
        }
      } else {
        user = message.author;
      }

      const freshUser = await client.users.fetch(user.id, { force: true }).catch((error) => {
        if (error?.message?.includes("Unauthorized") || error?.status === 401) {
          return null;
        }
        throw error;
      });
      if (freshUser) user = freshUser;

      const bannerOptions = {
        dynamic: true,
        format: "png",
        size: 1024,
      };

      const getSafeUserBanner = (targetUser) => {
        try {
          if (!targetUser || targetUser.banner == null) return null;
          return targetUser.bannerURL(bannerOptions);
        } catch {
          return null;
        }
      };

      const getSafeMemberBanner = (member) => {
        try {
          if (!member) return null;
          if (member.banner) return member.bannerURL(bannerOptions);
          return getSafeUserBanner(member.user);
        } catch {
          return null;
        }
      };

      let bannerURL = getSafeUserBanner(user);

      if (!bannerURL && message.guild) {
        const member =
          message.guild.members.cache.get(user.id) ||
          (await message.guild.members.fetch(user.id).catch(() => null));
        bannerURL = getSafeMemberBanner(member);
      }

      if (!bannerURL) {
        return message.edit(
          await language(
            client,
            `# ✨ [ sb ] Soon • Love Night

╭ **⚠️ Information**
\`\`\`yaml
L'utilisateur ${user} ne possède pas de bannière visible (globale ou serveur).
\`\`\`
╰`,
            `# ✨ [ sb ] Soon • Love Night

╭ **⚠️ Information**
\`\`\`yaml
User ${user} has no visible banner (global or server profile).
\`\`\`
╰`
          )
        );
      }

      return message.edit(
        await language(
          client,
          `# ✨ [ sb ] Soon • Love Night

╭ **🖼️ Bannière**

Bannière de ${user}: ${bannerURL}

╰`,
          `# ✨ [ sb ] Soon • Love Night

╭ **🖼️ Banner**
Banner of ${user}: ${bannerURL}
╰`
        )
      );
    } catch (error) {
      const unauthorized = error?.message?.includes("Unauthorized") || error?.status === 401;
      return message.edit(
        await language(
          client,
          unauthorized
            ? "❌ Impossible d'acceder a cette banniere (Unauthorized)."
            : `❌ Erreur : ${error?.message || "Erreur inconnue"}`,
          unauthorized
            ? "❌ Unable to access this banner (Unauthorized)."
            : `❌ Error: ${error?.message || "Unknown error"}`
        )
      );
    }
  },
};
