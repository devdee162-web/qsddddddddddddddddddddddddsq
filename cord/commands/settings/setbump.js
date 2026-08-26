const { language, savedb } = require('../../fonctions');
const { startAutobump, isAutobumpActive } = require('../Tools/bump');

function parseChannelId(raw) {
  if (!raw) return null;
  const mention = String(raw).match(/^<#(\d+)>$/);
  if (mention) return mention[1];
  const id = String(raw).replace(/[<#>]/g, '');
  return /^\d{17,20}$/.test(id) ? id : null;
}

function parseChannelIds(args, fallbackId) {
  const ids = [];
  for (const arg of args || []) {
    const id = parseChannelId(arg);
    if (id && !ids.includes(id)) ids.push(id);
  }
  if (ids.length === 0 && fallbackId) ids.push(fallbackId);
  return ids;
}

module.exports = {
  name: 'setbump',
  description: 'Ajoute un ou plusieurs salons pour l\'autobump Disboard (multi-serveurs)',
  run: async (client, message, args, db, prefix) => {
    const channelIDs = parseChannelIds(args, message.channel?.id);

    if (channelIDs.length === 0) {
      return message.edit(await language(
        client,
        `Usage multi-serveurs :\n\`${prefix}setbump\` — salon actuel\n\`${prefix}setbump #salon\`\n\`${prefix}setbump #s1 #s2 #s3\` — plusieurs serveurs\n\`${prefix}bump status\` — voir la liste`,
        `Multi-server usage:\n\`${prefix}setbump\` — current channel\n\`${prefix}setbump #channel\`\n\`${prefix}setbump #c1 #c2 #c3\` — multiple servers\n\`${prefix}bump status\` — view list`,
      ));
    }

    if (!Array.isArray(db.bumpchannels)) db.bumpchannels = [];

    const added = [];
    const failed = [];
    const labels = [];

    for (let i = 0; i < channelIDs.length; i++) {
      const channelID = channelIDs[i];
      const channel = await client.channels.fetch(channelID).catch(() => null);
      if (!channel) {
        failed.push(channelID);
        continue;
      }

      if (!db.bumpchannels.includes(channelID)) {
        db.bumpchannels.push(channelID);
        added.push(channelID);
      }

      db.bumpchannel = channelID;
      labels.push(`**${channel.guild?.name || '?'}** → <#${channelID}>`);

    if (!isAutobumpActive(channelID)) {
      startAutobump(channelID, channel, {
        immediate: true,
        delayMs: i * 15_000,
      });
    } else {
      startAutobump(channelID, channel, {
        immediate: true,
        delayMs: i * 15_000,
        force: true,
      });
    }
    }

    db.autobump = db.bumpchannels.length > 0;
    await savedb(client, db);

    return message.edit(await language(
      client,
      `✅ Autobump **Disboard** multi-serveurs\n\n${labels.join('\n') || 'aucun'}\n\n📦 Total : **${db.bumpchannels.length}** salon(s)${added.length ? ` · +${added.length} ajouté(s)` : ''}${failed.length ? `\n❌ Introuvables : ${failed.join(', ')}` : ''}\n\n⚠️ Si le bump échoue : dans <#${channelIDs[0] || 'salon'}>, active la permission **Utiliser les commandes d'application** pour ton compte selfbot (ou @everyone).\nTest : \`${prefix}bump now\``,
      `✅ **Disboard** multi-server autobump\n\n${labels.join('\n') || 'none'}\n\n📦 Total: **${db.bumpchannels.length}** channel(s)${added.length ? ` · +${added.length} added` : ''}${failed.length ? `\n❌ Not found: ${failed.join(', ')}` : ''}\n\n⚠️ If bump fails: enable **Use Application Commands** for the selfbot in the channel.\nTest: \`${prefix}bump now\``,
    ));
  },
};
