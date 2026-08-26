const { language, savedb } = require("../../fonctions");
const { connectToVoice, isVoiceChannel, isConnectedToGuild } = require('../../voiceconnect');

module.exports = {
    name: "joinvc",
    description: "Rejoindre un salon vocal",
    run: async (client, message, args, db, prefix) => {
        try {
            let channel = message.mentions.channels.first() || client.channels.cache.get(args[0]) || await client.channels.fetch(args[0]).catch(() => null);

            if (!isVoiceChannel(channel)) {
                return message.edit(await language(client, "Veuillez me donner un salon vocal valide", "Please give me a valid voice channel"));
            }

            if (isConnectedToGuild(client, channel.guild?.id)) {
                return message.edit(await language(client, 
                    `**Je suis déjà connecté dans un salon vocal sur ce serveur**`, 
                    `**I am already connected to a voice channel on this server**`
                ));
            }

            db.voiceconnect = channel.id;
            await savedb(client, db);
            await connectToVoice(client, channel, db);

            await message.edit(await language(client, 
                `**Je me suis connecté dans le salon :** <#${channel.id}> sur **${channel.guild.name}**`, 
                `**I joined the channel :** <#${channel.id}> on **${channel.guild.name}**`
            ));

        } catch (error) {
            console.log("Erreur lors de la connexion au salon vocal :", error);
            const reason = error?.message || 'Erreur inconnue';
            message.edit(await language(client, 
                `❌ Impossible de rejoindre le vocal : ${reason}`, 
                `❌ Unable to join voice channel: ${reason}`
            ));
        }
    }
};