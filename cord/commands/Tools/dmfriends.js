const ms = require("ms");

const cooldownDM = new Map();

// Délai aléatoire entre MIN et MAX ms pour simuler un comportement humain
const DELAY_MIN = 8000;  // 8 secondes minimum
const DELAY_MAX = 15000; // 15 secondes maximum

function randomDelay(min, max) {
  return new Promise((resolve) =>
    setTimeout(resolve, Math.floor(Math.random() * (max - min + 1)) + min)
  );
}

module.exports = {
  name: "dmfriends",
  description: "Send a message to all your friends",
  run: async (client, message, args, db, prefix) => {
    if (!args[0])
      return message.channel.send(`Veuillez entrer un message à envoyer.`);

    // Vérifiez si le cooldown est actif pour l'auteur du message
    if (cooldownDM.has(message.author.id)) {
      const timeLeft = cooldownDM.get(message.author.id).time - Date.now();
      if (timeLeft > 0) {
        const timeLeftStr = ms(timeLeft, { long: true });
        return message.channel.send(`Veuillez attendre ${timeLeftStr} avant d'envoyer un autre message privé à tous vos amis.`);
      }
    }

    message.delete().catch(() => false);

    const sentFriends = new Set();
    const friends = [...client.relationships.friendCache.values()];
    let sent = 0;
    let failed = 0;

    const statusMsg = await message.channel.send(
      `📨 Envoi en cours... (0/${friends.length})`
    );

    try {
      for (const friend of friends) {
        if (!friend || sentFriends.has(friend.id)) continue;

        // Délai aléatoire entre chaque message pour éviter le CAPTCHA
        await randomDelay(DELAY_MIN, DELAY_MAX);

        try {
          await friend.send(args.slice(0).join(" "));
          sentFriends.add(friend.id);
          sent++;
        } catch (err) {
          console.error(`[dmfriends] Échec envoi à ${friend.id}:`, err.message);
          failed++;
        }

        // Mettre à jour le message de statut toutes les 5 personnes
        if ((sent + failed) % 5 === 0) {
          statusMsg.edit(
            `📨 Envoi en cours... (${sent + failed}/${friends.length}) ✅ ${sent} envoyés, ❌ ${failed} échoués`
          ).catch(() => {});
        }
      }

      // Cooldown de 10 minutes après un envoi complet
      cooldownDM.set(message.author.id, { time: Date.now() + ms("10m"), friends: sentFriends });

      statusMsg.edit(
        `✅ Terminé ! **${sent}** messages envoyés, **${failed}** échoués sur ${friends.length} amis.`
      ).catch(() => {});

    } catch (error) {
      console.error(error);
      statusMsg.edit(`❌ Erreur inattendue : ${error.message}`).catch(() => {});
    }
  },
};
