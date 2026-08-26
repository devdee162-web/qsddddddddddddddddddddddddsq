const { language } = require("../../fonctions");
const fs = require('fs').promises;

module.exports = {
    name: "setvc",
    description: "Sauvegarder un salon vocal",
    run: async (client, message, args, db, prefix) => {
        try {
            const channelId = args[0];
            
            if (!channelId) {
                return message.edit("Usage: `setvc [ID du salon vocal]`");
            }

            let channel;
            try {
                channel = await client.channels.fetch(channelId);
            } catch (e) {
                return message.edit("❌ ID invalide ou salon introuvable");
            }

            // Vérification du type (2 = vocal)
            if (channel.type !== 2) {
                return message.edit(`❌ Type ${channel.type} détecté - Ce n'est pas un salon vocal`);
            }

            const userId = message.author.id;
            const userFilePath = `./db/voice_fav_${userId}.json`;
            
            let favs = {};
            try {
                const data = await fs.readFile(userFilePath, 'utf-8');
                favs = JSON.parse(data);
            } catch (e) {}

            const key = `vc_${channel.guild.id}`;
            favs[key] = {
                channelId: channel.id,
                channelName: channel.name,
                guildName: channel.guild.name
            };

            await fs.writeFile(userFilePath, JSON.stringify(favs, null, 2));

            message.edit(`✅ **Salon sauvegardé :** ${channel.name} (${channel.guild.name})`);

        } catch (error) {
            console.error(error);
            message.edit("Erreur: " + error.message);
        }
    }
};