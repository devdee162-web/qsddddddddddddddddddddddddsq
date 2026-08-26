const Discord = require("discord.js-selfbot-v13");
const { language, savedb, nitrocode } = require("../../fonctions");

const nbLiensNitroParMessage = 3; // Nombre de liens Nitro par message

module.exports = {
  name: "gen",
  description: "Génère un nombre défini de codes Nitro aléatoires.",
  run: async (client, message, args, db) => {
    try {
      // Vérifier que le client est prêt et connecté
      // Pour discord.js-selfbot-v13, on vérifie si client.user existe
      if (!client || !client.user) {
        return message.edit(`❌ Le client n'est pas encore prêt. Veuillez patienter.`).catch(() => {});
      }

      // Vérifier que le token est disponible
      if (!client.token) {
        return message.edit(`❌ Le token n'est pas disponible pour ce client.`).catch(() => {});
      }

      // Vérifier le nombre d'arguments
      if (!args.length) {
        return message.edit(`❌ Veuillez fournir un nombre de codes Nitro à générer.`).catch(() => {});
      }

      // Analyser le nombre
      const nbCodes = parseInt(args[0]);
      if (isNaN(nbCodes) || nbCodes <= 0) {
        return message.edit(`❌ Veuillez fournir un nombre valide supérieur à 0.`).catch(() => {});
      }

      // Générer les codes Nitro
      const codesNitro = [];
      for (let i = 0; i < nbCodes; i++) {
        codesNitro.push(`https://discord.gift/${nitrocode(16, "0aA")}`);
      }

      // Envoyer les codes Nitro
      for (let i = 0; i < codesNitro.length; i += nbLiensNitroParMessage) {
        const messageContent = `${codesNitro.slice(i, i + nbLiensNitroParMessage).join("\n")}`;

        try {
          // Vérifier que le canal existe et est accessible
          if (message.channel && message.channel.send) {
            await message.channel.send(messageContent);
          } else {
            console.error('Canal non accessible pour l\'envoi');
            break;
          }
        } catch (sendError) {
          console.error('Erreur lors de l\'envoi du message:', sendError);
          // Continuer avec les autres messages même en cas d'erreur
        }
      }
    } catch (error) {
      console.error('Erreur dans la commande gen:', error);
      try {
        await message.edit(`❌\n Erreur : ${error.message || 'Erreur inconnue'}`).catch(() => {});
      } catch (editError) {
        console.error('Impossible d\'éditer le message:', editError);
      }
    }
  },
};

