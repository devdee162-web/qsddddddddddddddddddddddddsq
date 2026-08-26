const { language, savedb, getdb } = require('../../fonctions');

// ID application Disboard (bot /bump)
const DISBOARD_BOT_ID = '302050872383242240';
const BUMP_COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2h
const BUMP_JITTER_MS = 3 * 60 * 1000; // +0–3 min
const RETRY_ON_ERROR_MS = 2 * 60 * 1000; // 2 min si échec réel
const RETRY_ON_PERMS_MS = 30 * 60 * 1000; // 30 min si Missing Permissions (évite le spam)
const MULTI_STAGGER_MS = 15_000; // décalage entre serveurs au démarrage
const DISBOARD_WAIT_MS = 20_000;

/** @type {Record<string, { timeout: NodeJS.Timeout | null, client: any, permWarned?: boolean, nextAt?: number }>} */
const autobumpJobs = {};

const { SnowflakeUtil } = require('discord.js-selfbot-v13');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseBumpNext(db) {
  if (!db) return {};
  if (typeof db.bumpnext === 'string') {
    try {
      const parsed = JSON.parse(db.bumpnext);
      db.bumpnext = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      db.bumpnext = {};
    }
  }
  if (!db.bumpnext || typeof db.bumpnext !== 'object' || Array.isArray(db.bumpnext)) {
    db.bumpnext = {};
  }
  return db.bumpnext;
}

async function persistBumpSchedule(client, channelID, nextAt, { ensureChannel = true } = {}) {
  if (!client?.user?.id) return;
  try {
    const db = await getdb(client);
    ensureBumpList(db);
    parseBumpNext(db);

    const id = String(channelID);
    if (ensureChannel && !db.bumpchannels.includes(id)) {
      db.bumpchannels.push(id);
    }
    if (db.bumpchannels.length > 0) {
      db.autobump = true;
      if (!db.bumpchannel) db.bumpchannel = id;
    }

    if (nextAt && nextAt > 0) {
      db.bumpnext[id] = nextAt;
    } else {
      delete db.bumpnext[id];
    }

    await savedb(client, db);
  } catch (error) {
    console.error(`Autobump: impossible de sauver le planning #${channelID}:`, error.message);
  }
}

function diagnoseChannelPerms(channel, user) {
  try {
    const perms = channel.permissionsFor(user);
    if (!perms) {
      return { ok: false, detail: 'Impossible de lire les permissions (membre hors cache)' };
    }
    const checks = {
      VIEW_CHANNEL: perms.has('VIEW_CHANNEL'),
      SEND_MESSAGES: perms.has('SEND_MESSAGES'),
      USE_APPLICATION_COMMANDS: perms.has('USE_APPLICATION_COMMANDS'),
      MANAGE_CHANNELS: perms.has('MANAGE_CHANNELS'),
      ADMINISTRATOR: perms.has('ADMINISTRATOR'),
    };
    const missing = Object.entries(checks)
      .filter(([k, v]) => !v && k !== 'MANAGE_CHANNELS' && k !== 'ADMINISTRATOR')
      .map(([k]) => k);
    return {
      ok: checks.USE_APPLICATION_COMMANDS || checks.ADMINISTRATOR,
      canFix: checks.MANAGE_CHANNELS || checks.ADMINISTRATOR,
      checks,
      missing,
    };
  } catch (e) {
    return { ok: false, detail: e.message };
  }
}

/**
 * Accorde automatiquement USE_APPLICATION_COMMANDS au selfbot si possible.
 */
async function ensureApplicationCommandsPermission(channel, client) {
  if (!channel?.guild) return { ok: false, fixed: false, reason: 'Pas un salon de serveur' };

  const member = await channel.guild.members.fetch(client.user.id).catch(() => null);
  if (!member) return { ok: false, fixed: false, reason: 'Membre introuvable sur le serveur' };

  let diag = diagnoseChannelPerms(channel, member);
  if (diag.ok) return { ok: true, fixed: false, diag };

  if (!diag.canFix) {
    return {
      ok: false,
      fixed: false,
      diag,
      reason: 'Le selfbot n\'a pas Manage Channels pour s\'auto-accorder la permission',
    };
  }

  try {
    // Accorder la perm au compte selfbot sur ce salon
    await channel.permissionOverwrites.edit(
      client.user.id,
      {
        VIEW_CHANNEL: true,
        SEND_MESSAGES: true,
        USE_APPLICATION_COMMANDS: true,
      },
      { reason: 'Autobump Disboard — auto-permission slash' },
    );

    // Petit délai pour que Discord propage
    await sleep(1500);

    // Re-fetch member/channel perms
    await channel.guild.members.fetch(client.user.id).catch(() => null);
    diag = diagnoseChannelPerms(channel, client.user);

    if (diag.ok) {
      console.log(`Autobump: permission /bump auto-accordée sur #${channel.id}`);
      return { ok: true, fixed: true, diag };
    }

    // Fallback: autoriser @everyone sur ce salon
    await channel.permissionOverwrites.edit(
      channel.guild.id,
      { USE_APPLICATION_COMMANDS: true },
      { reason: 'Autobump Disboard — enable slash @everyone' },
    );
    await sleep(1500);
    diag = diagnoseChannelPerms(channel, client.user);

    return {
      ok: Boolean(diag.ok),
      fixed: true,
      diag,
      reason: diag.ok ? null : 'Permission modifiée mais toujours refusée (overwrite rôle plus haut ?)',
    };
  } catch (error) {
    return {
      ok: false,
      fixed: false,
      diag,
      reason: `Impossible de modifier les permissions: ${error.message}`,
    };
  }
}

function permissionHelpMessage(channel, client) {
  const tag = client.user?.tag || client.user?.username || 'selfbot';
  return [
    `❌ **${tag}** ne peut pas lancer \`/bump\` dans <#${channel.id}>`,
    `Active **Utiliser les commandes d'application** pour ce compte (ou @everyone) dans ce salon.`,
    `Sinon : connecte un compte qui a déjà cette perm, puis \`&bump now\`.`,
  ].join('\n');
}

function parseChannelId(raw) {
  if (!raw) return null;
  if (['here', 'ici', 'this'].includes(String(raw).toLowerCase())) return null;
  const mention = String(raw).match(/^<#(\d+)>$/);
  if (mention) return mention[1];
  const id = String(raw).replace(/[<#>]/g, '');
  return /^\d{17,20}$/.test(id) ? id : null;
}

function parseChannelIds(args, fallbackChannelId = null) {
  const ids = [];
  for (const arg of args || []) {
    const id = parseChannelId(arg);
    if (id && !ids.includes(id)) ids.push(id);
  }
  if (ids.length === 0 && fallbackChannelId) ids.push(fallbackChannelId);
  return ids;
}

function ensureBumpList(db) {
  if (!db) return [];

  // MySQL TEXT peut renvoyer une string JSON
  if (typeof db.bumpchannels === 'string') {
    try {
      const parsed = JSON.parse(db.bumpchannels);
      db.bumpchannels = Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      db.bumpchannels = db.bumpchannels
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter((s) => /^\d{17,20}$/.test(s));
    }
  }

  if (!Array.isArray(db.bumpchannels)) db.bumpchannels = [];
  db.bumpchannels = db.bumpchannels.map(String).filter((id) => /^\d{17,20}$/.test(id));

  if (db.bumpchannel) {
    db.bumpchannel = String(db.bumpchannel);
    if (!db.bumpchannels.includes(db.bumpchannel)) {
      db.bumpchannels.push(db.bumpchannel);
    }
  }

  db.autobump = db.autobump === true || db.autobump === 1 || db.autobump === '1';
  parseBumpNext(db);
  return db.bumpchannels;
}

function extractText(message) {
  if (!message) return '';
  const parts = [message.content || ''];
  for (const embed of message.embeds || []) {
    if (embed.title) parts.push(embed.title);
    if (embed.description) parts.push(embed.description);
    for (const field of embed.fields || []) {
      if (field.name) parts.push(field.name);
      if (field.value) parts.push(field.value);
    }
  }
  return parts.join('\n');
}

function parseCooldownMs(text) {
  if (!text) return null;
  const lower = text.toLowerCase();

  const minutes = lower.match(/(?:encore|another|wait(?:ing)?(?:\s+another)?)\s+(\d+)\s*(?:minute|min)/i)
    || lower.match(/(\d+)\s*(?:minute|min)/i);
  const hours = lower.match(/(?:encore|another|wait(?:ing)?(?:\s+another)?)\s+(\d+)\s*(?:heure|hour)/i)
    || lower.match(/(\d+)\s*(?:heure|hour)/i);

  if (hours) return (Number(hours[1]) * 60 + 1) * 60 * 1000;
  if (minutes) return (Number(minutes[1]) + 1) * 60 * 1000;
  return null;
}

function isBumpSuccess(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return lower.includes('bump effectué')
    || lower.includes('bump done')
    || lower.includes('bumped')
    || (lower.includes('bump!') && !lower.includes('attends') && !lower.includes('wait'));
}

function isBumpCooldown(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return lower.includes('attends encore')
    || lower.includes('please wait')
    || lower.includes('avant que le serveur')
    || lower.includes('until the server can be bumped');
}

function nextDelayAfterSuccess() {
  return BUMP_COOLDOWN_MS + Math.floor(Math.random() * BUMP_JITTER_MS);
}

function formatChannelLabel(client, channelID) {
  const ch = client.channels.cache.get(channelID);
  if (!ch) return `<#${channelID}>`;
  const guildName = ch.guild?.name || '?';
  return `**${guildName}** → <#${channelID}>`;
}

function clearJob(channelID) {
  const job = autobumpJobs[channelID];
  if (job?.timeout) clearTimeout(job.timeout);
  delete autobumpJobs[channelID];
}

function scheduleNext(channelID, channel, delayMs) {
  const job = autobumpJobs[channelID];
  if (!job) return;

  if (job.timeout) clearTimeout(job.timeout);
  const wait = Math.max(delayMs, 30_000);
  const nextAt = Date.now() + wait;
  job.nextAt = nextAt;

  job.timeout = setTimeout(() => {
    runBump(channelID, channel).catch((err) => {
      console.error(`Autobump [${channelID}]:`, err.message);
    });
  }, wait);

  const client = job.client || channel.client;
  persistBumpSchedule(client, channelID, nextAt).catch(() => {});

  const mins = Math.round(wait / 60000);
  const guild = channel.guild?.name || channelID;
  console.log(`Autobump: prochain /bump Disboard sur ${guild} (#${channelID}) dans ~${mins} min`);
}

async function findDisboardMessage(channel, startedAt, botIds) {
  const messages = await channel.messages.fetch({ limit: 20 }).catch(() => null);
  if (!messages) return null;

  return messages.find((m) => {
    const authorId = m.author?.id;
    if (!authorId || !botIds.has(authorId)) return false;
    if (m.createdTimestamp && m.createdTimestamp < startedAt - 2000) return false;
    const text = extractText(m);
    return isBumpSuccess(text) || isBumpCooldown(text);
  }) || null;
}

/**
 * Envoie /bump Disboard correctement (POST await) et exige une vraie réponse publique.
 * Plus de faux "bump OK" si Disboard ne répond pas.
 */
async function sendBump(channel) {
  const client = channel.client;
  const startedAt = Date.now();

  if (!client?.sessionId) {
    throw new Error('Session Discord invalide (reconnecte le selfbot)');
  }

  if (typeof channel.searchInteraction !== 'function') {
    throw new Error('Salon incompatible avec les slash commands');
  }

  const index = await channel.searchInteraction();
  const applications = index.applications || [];
  const commands = index.application_commands || [];

  const application = applications.find(
    (app) => String(app.id) === DISBOARD_BOT_ID || String(app.bot_id) === DISBOARD_BOT_ID,
  );

  if (!application) {
    throw new Error('Disboard introuvable ici (invite le bot DISBOARD dans le serveur)');
  }

  const command = commands.find(
    (cmd) => String(cmd.application_id) === String(application.id)
      && (cmd.name === 'bump' || cmd.name_default === 'bump'),
  );

  if (!command) {
    throw new Error('Commande /bump introuvable (Disboard pas synchronisé sur ce salon)');
  }

  const nonce = SnowflakeUtil.generate();
  const body = {
    type: 2, // APPLICATION_COMMAND
    application_id: application.id,
    guild_id: channel.guild?.id,
    channel_id: channel.id,
    session_id: client.sessionId,
    data: {
      version: command.version,
      id: command.id,
      name: command.name_default || command.name,
      type: command.type,
      options: [],
      attachments: [],
    },
    nonce,
    analytics_location: 'slash',
  };

  if (command.guild_id) {
    body.data.guild_id = channel.guild?.id;
  }

  if (channel.guild) {
    await channel.guild.members.fetch(client.user.id).catch(() => null);
  }

  // Tente un auto-fix SI possible, mais ne bloque JAMAIS avant d'essayer /bump
  const ensured = await ensureApplicationCommandsPermission(channel, client).catch(() => ({ ok: false }));
  if (ensured?.fixed) {
    console.log(`Autobump: permissions slash auto-corrigées sur #${channel.id}`);
  }

  const botIds = new Set(
    [DISBOARD_BOT_ID, application.id, application.bot_id].filter(Boolean).map(String),
  );

  const collectorPromise = channel.awaitMessages({
    filter: (m) => botIds.has(String(m.author?.id)) && (!m.createdTimestamp || m.createdTimestamp >= startedAt - 2000),
    max: 1,
    time: DISBOARD_WAIT_MS,
  }).then((col) => col.first() || null).catch(() => null);

  async function postInteraction(payload) {
    await client.api.interactions.post({
      data: payload,
      usePayloadJSON: true,
    });
  }

  let postError = null;
  let interactionSent = false;

  try {
    await postInteraction(body);
    interactionSent = true;
  } catch (error) {
    postError = error;
    try {
      const slashMsg = await channel.sendSlash(DISBOARD_BOT_ID, 'bump');
      if (slashMsg) return slashMsg;
      interactionSent = true;
      postError = null;
    } catch (error2) {
      const msg2 = String(error2?.message || error2);
      // Timeout lib 5s = l'interaction est souvent déjà partie
      if (/no responsed|interaction_failed/i.test(msg2)) {
        interactionSent = true;
        postError = null;
      } else {
        postError = error2;
      }
    }
  }

  if (postError && !interactionSent) {
    const code2 = postError?.code;
    const msg2 = String(postError?.message || postError);

    if (code2 === 50013 || /missing permissions/i.test(msg2)) {
      const retryFix = await ensureApplicationCommandsPermission(channel, client).catch(() => ({ ok: false }));
      if (retryFix?.ok || retryFix?.fixed) {
        try {
          await postInteraction({ ...body, nonce: SnowflakeUtil.generate() });
          interactionSent = true;
          postError = null;
        } catch (_) {
          const err = new Error('Discord refuse /bump : active « Utiliser les commandes d\'application » dans ce salon.');
          err.code = 'PERM_APPLICATION_COMMANDS';
          throw err;
        }
      } else {
        const err = new Error('Discord refuse /bump : active « Utiliser les commandes d\'application » dans ce salon.');
        err.code = 'PERM_APPLICATION_COMMANDS';
        throw err;
      }
    } else if (code2 === 50001 || /missing access/i.test(msg2)) {
      throw new Error('Missing Access: le selfbot n\'a pas accès à ce salon');
    } else if (/no responsed|interaction_failed/i.test(msg2)) {
      interactionSent = true;
    } else {
      throw new Error(`Envoi /bump refusé: ${msg2}`);
    }
  }

  console.log(`Autobump: /bump envoyé → ${channel.guild?.name || '?'} #${channel.id}`);

  let reply = await collectorPromise;
  if (!reply) {
    const deadline = Date.now() + 15_000;
    while (!reply && Date.now() < deadline) {
      await sleep(1500);
      reply = await findDisboardMessage(channel, startedAt, botIds);
    }
  }

  if (!reply) {
    // POST peut « réussir » côté HTTP alors que Discord bloque le slash sans réponse publique
    const member = channel.guild
      ? await channel.guild.members.fetch(client.user.id).catch(() => null)
      : null;
    const diag = diagnoseChannelPerms(channel, member || client.user);
    if (!diag.ok) {
      const err = new Error(
        'Discord bloque /bump : active « Utiliser les commandes d\'application » pour ce compte dans ce salon (sinon Disboard ne répond jamais).',
      );
      err.code = 'PERM_APPLICATION_COMMANDS';
      throw err;
    }
    throw new Error('Disboard n\'a pas confirmé le bump (aucune réponse publique)');
  }

  return reply;
}

async function runBump(channelID, channel) {
  if (!autobumpJobs[channelID]) return;

  let response = null;
  try {
    const fresh = await channel.client.channels.fetch(channelID).catch(() => channel);
    if (!fresh) throw new Error('Salon introuvable');
    response = await sendBump(fresh);
  } catch (error) {
    const isPerm = error?.code === 'PERM_APPLICATION_COMMANDS'
      || /PERM_APPLICATION_COMMANDS|Missing Permissions|commandes applicatives/i.test(String(error.message || ''));

    if (isPerm) {
      const job = autobumpJobs[channelID];
      if (job && !job.permWarned) {
        job.permWarned = true;
        const help = permissionHelpMessage(channel, channel.client);
        console.error(`Autobump: ÉCHEC permissions sur #${channelID}`);
        console.error(help.replace(/\*\*/g, '').replace(/<#(\d+)>/g, '#$1'));
        await channel.send(help).catch(() => {});
      } else {
        console.error(`Autobump: toujours pas de permission /bump sur #${channelID} — retry dans 30 min`);
      }
      scheduleNext(channelID, channel, RETRY_ON_PERMS_MS);
      return;
    }

    console.error(`Autobump: ÉCHEC sur #${channelID}: ${error.message}`);
    scheduleNext(channelID, channel, RETRY_ON_ERROR_MS);
    return;
  }

  const text = extractText(response);
  const guild = channel.guild?.name || channelID;

  if (autobumpJobs[channelID]) {
    autobumpJobs[channelID].permWarned = false;
  }

  if (isBumpCooldown(text)) {
    const cooldown = parseCooldownMs(text) || BUMP_COOLDOWN_MS;
    console.log(`Autobump: cooldown Disboard (${guild}) — encore ~${Math.round(cooldown / 60000)} min`);
    scheduleNext(channelID, channel, cooldown);
    return;
  }

  if (isBumpSuccess(text)) {
    console.log(`Autobump: ✅ Bump confirmé Disboard sur ${guild}`);
    scheduleNext(channelID, channel, nextDelayAfterSuccess());
    return;
  }

  console.log(`Autobump: réponse Disboard inattendue (${guild}): ${text.slice(0, 160)}`);
  scheduleNext(channelID, channel, RETRY_ON_ERROR_MS);
}

function startAutobump(channelID, channel, { immediate = true, delayMs = 0, force = false } = {}) {
  if (autobumpJobs[channelID]) {
    if (!force) return false;
    clearJob(channelID);
  }

  autobumpJobs[channelID] = {
    timeout: null,
    client: channel.client,
  };

  if (immediate && delayMs <= 0) {
    runBump(channelID, channel).catch((err) => {
      console.error(`Autobump [${channelID}]:`, err.message);
    });
  } else {
    scheduleNext(channelID, channel, delayMs > 0 ? delayMs : nextDelayAfterSuccess());
  }

  return true;
}

function stopAutobump(channelID) {
  clearJob(channelID);
}

function stopAllAutobump() {
  for (const channelID of Object.keys(autobumpJobs)) {
    clearJob(channelID);
  }
}

async function restoreAutobump(client, db) {
  const channels = ensureBumpList(db);
  if (channels.length === 0) return;

  // Si des salons sont sauvés, forcer autobump ON (guérit un flag perdu)
  if (!db.autobump) {
    db.autobump = true;
    await savedb(client, db).catch(() => {});
  }

  const bumpnext = parseBumpNext(db);
  let index = 0;
  let restored = 0;

  for (const channelID of channels) {
    if (autobumpJobs[channelID]) {
      restored += 1;
      continue;
    }

    let channel = null;
    for (let attempt = 0; attempt < 3 && !channel; attempt++) {
      channel = await client.channels.fetch(channelID).catch(() => null);
      if (!channel && attempt < 2) await sleep(2000 * (attempt + 1));
    }

    if (!channel) {
      console.error(`Autobump: impossible de restaurer le salon ${channelID} (introuvable)`);
      continue;
    }

    const savedNext = Number(bumpnext[channelID]) || 0;
    const remaining = savedNext - Date.now();

    // Respecte le cooldown sauvé ; sinon bump décalé au démarrage
    const delayMs = remaining > 30_000
      ? remaining
      : index * MULTI_STAGGER_MS;

    startAutobump(channelID, channel, {
      immediate: remaining <= 30_000,
      delayMs,
    });
    restored += 1;
    index += 1;
  }

  if (restored > 0) {
    console.log(`Autobump: restauré sur ${restored} salon(s) (persistant après restart)`);
  }
}

function isAutobumpActive(channelID) {
  return Boolean(autobumpJobs[channelID]);
}

async function addChannels(client, db, channelIDs, { start = true } = {}) {
  ensureBumpList(db);
  const added = [];
  const skipped = [];
  const failed = [];

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
    } else {
      skipped.push(channelID);
    }

    db.bumpchannel = channelID;
    db.autobump = true;

    if (start && !isAutobumpActive(channelID)) {
      startAutobump(channelID, channel, {
        immediate: true,
        delayMs: i * MULTI_STAGGER_MS,
      });
    }
  }

  await savedb(client, db);
  return { added, skipped, failed };
}

async function removeChannels(client, db, channelIDs) {
  ensureBumpList(db);
  parseBumpNext(db);
  const removed = [];

  for (const channelID of channelIDs) {
    if (db.bumpchannels.includes(channelID)) {
      db.bumpchannels = db.bumpchannels.filter((id) => id !== channelID);
      removed.push(channelID);
    }
    delete db.bumpnext[channelID];
    stopAutobump(channelID);
  }

  if (db.bumpchannel && !db.bumpchannels.includes(db.bumpchannel)) {
    db.bumpchannel = db.bumpchannels[0] || null;
  }
  db.autobump = db.bumpchannels.length > 0;
  await savedb(client, db);
  return removed;
}

module.exports = {
  name: 'bump',
  description: 'Autobump Disboard multi-serveurs',
  startAutobump,
  stopAutobump,
  stopAllAutobump,
  restoreAutobump,
  isAutobumpActive,
  DISBOARD_BOT_ID,
  run: async (client, message, args, db, prefix) => {
    ensureBumpList(db);
    const currentChannelId = message.channel?.id || null;
    const action = (args[0] || '').toLowerCase();

    // Compat ancien format
    if (args[0] && String(args[0]).includes('bump:')) {
      const channelIDs = parseChannelIds(args.slice(1), currentChannelId);
      const result = await addChannels(client, db, channelIDs);
      return message.edit(await language(
        client,
        `✅ Autobump Disboard activé sur **${result.added.length + result.skipped.length}** salon(s).`,
        `✅ Disboard autobump enabled on **${result.added.length + result.skipped.length}** channel(s).`,
      ));
    }

    if (!action || !['on', 'off', 'now', 'force', 'status', 'list', 'add', 'remove', 'all', 'check'].includes(action)) {
      return message.edit(await language(
        client,
        `# Autobump Disboard (multi-serveurs)

\`\`\`yaml
${prefix}setbump #salon          ➜ Ajouter un salon
${prefix}setbump #s1 #s2 #s3     ➜ Ajouter plusieurs serveurs
${prefix}bump add #salon         ➜ Ajouter sans remplacer
${prefix}bump on                 ➜ Activer tous les salons sauvés
${prefix}bump on #salon          ➜ Activer un salon
${prefix}bump off #salon         ➜ Désactiver un salon
${prefix}bump off all            ➜ Tout désactiver
${prefix}bump now                ➜ Bump le salon actuel
${prefix}bump now all            ➜ Bump tous les serveurs
${prefix}bump check              ➜ Vérifier les permissions
${prefix}bump status             ➜ Liste + état
\`\`\``,
        `# Disboard autobump (multi-server)

\`\`\`yaml
${prefix}setbump #channel        ➜ Add a channel
${prefix}setbump #c1 #c2 #c3     ➜ Add multiple servers
${prefix}bump add #channel       ➜ Add without replacing
${prefix}bump on                 ➜ Enable all saved channels
${prefix}bump on #channel        ➜ Enable one channel
${prefix}bump off #channel       ➜ Disable one channel
${prefix}bump off all            ➜ Disable all
${prefix}bump now                ➜ Bump current channel
${prefix}bump now all            ➜ Bump all servers
${prefix}bump check              ➜ Check permissions
${prefix}bump status             ➜ List + status
\`\`\``,
      ));
    }

    if (action === 'check') {
      const channelID = parseChannelId(args[1]) || currentChannelId || db.bumpchannel || db.bumpchannels[0];
      if (!channelID) {
        return message.edit(await language(client, 'Aucun salon à vérifier.', 'No channel to check.'));
      }
      const channel = await client.channels.fetch(channelID).catch(() => null);
      if (!channel) {
        return message.edit(await language(client, 'Salon introuvable.', 'Channel not found.'));
      }
      if (channel.guild) {
        await channel.guild.members.fetch(client.user.id).catch(() => null);
      }

      const ensured = await ensureApplicationCommandsPermission(channel, client);
      const diag = ensured.diag || diagnoseChannelPerms(channel, client.user);
      const lines = diag.checks
        ? Object.entries(diag.checks).map(([k, v]) => `${v ? '✅' : '❌'} ${k}`).join('\n')
        : (diag.detail || ensured.reason || '?');

      let footer;
      if (ensured.ok && ensured.fixed) {
        footer = '✅ Permission **auto-accordée** — lance `&bump now`';
      } else if (ensured.ok) {
        footer = '✅ OK pour /bump';
      } else {
        footer = '❌ Il faut **Utiliser les commandes d\'application** pour ce compte dans ce salon.\nSans ça Discord bloque `/bump` — aucun script ne peut le contourner.';
      }

      return message.edit(await language(
        client,
        `🔍 Permissions de **${client.user.tag}** dans <#${channelID}> :\n${lines}\n\n${footer}`,
        `🔍 Permissions for **${client.user.tag}** in <#${channelID}>:\n${lines}\n\n${footer}`,
      ));
    }

    if (action === 'status' || action === 'list') {
      if (db.bumpchannels.length === 0) {
        return message.edit(await language(
          client,
          `📊 Autobump Disboard : **OFF**\nAucun salon. Ajoute-en avec \`${prefix}setbump #salon\`.`,
          `📊 Disboard autobump: **OFF**\nNo channels. Add one with \`${prefix}setbump #channel\`.`,
        ));
      }

      const lines = db.bumpchannels.map((id) => {
        const state = isAutobumpActive(id) ? '✅' : '⏸';
        return `${state} ${formatChannelLabel(client, id)}`;
      });

      return message.edit(await language(
        client,
        `📊 Autobump Disboard : **${db.autobump ? 'ON' : 'OFF'}** · **${db.bumpchannels.length}** serveur(s)\n\n${lines.join('\n')}`,
        `📊 Disboard autobump: **${db.autobump ? 'ON' : 'OFF'}** · **${db.bumpchannels.length}** server(s)\n\n${lines.join('\n')}`,
      ));
    }

    if (action === 'add' || action === 'on') {
      const wantAll = !args[1] && action === 'on';
      let channelIDs = parseChannelIds(args.slice(1));

      if (wantAll) {
        channelIDs = [...db.bumpchannels];
        if (channelIDs.length === 0 && currentChannelId) {
          channelIDs = [currentChannelId];
        }
      } else if (channelIDs.length === 0) {
        channelIDs = currentChannelId ? [currentChannelId] : [];
      }

      if (channelIDs.length === 0) {
        return message.edit(await language(
          client,
          `Aucun salon. Exemple : \`${prefix}bump on #salon\` ou \`${prefix}setbump #s1 #s2\`.`,
          `No channel. Example: \`${prefix}bump on #channel\` or \`${prefix}setbump #c1 #c2\`.`,
        ));
      }

      const result = await addChannels(client, db, channelIDs);
      const labels = [...result.added, ...result.skipped].map((id) => formatChannelLabel(client, id));

      return message.edit(await language(
        client,
        `✅ Autobump Disboard actif sur **${labels.length}** serveur(s) :\n${labels.join('\n')}${result.failed.length ? `\n❌ Introuvables : ${result.failed.join(', ')}` : ''}`,
        `✅ Disboard autobump active on **${labels.length}** server(s):\n${labels.join('\n')}${result.failed.length ? `\n❌ Not found: ${result.failed.join(', ')}` : ''}`,
      ));
    }

    if (action === 'now' || action === 'force') {
      let channelIDs;
      if (!args[1]) {
        channelIDs = currentChannelId ? [currentChannelId] : [];
      } else if (['all', 'tous', '*'].includes(String(args[1]).toLowerCase())) {
        channelIDs = [...db.bumpchannels];
      } else {
        channelIDs = parseChannelIds(args.slice(1));
      }

      if (channelIDs.length === 0) {
        return message.edit(await language(
          client,
          `Aucun salon. Utilise \`${prefix}bump now\` ici, ou \`${prefix}bump now all\`.`,
          `No channel. Use \`${prefix}bump now\` here, or \`${prefix}bump now all\`.`,
        ));
      }

      const results = [];
      for (let i = 0; i < channelIDs.length; i++) {
        const channelID = channelIDs[i];
        const channel = await client.channels.fetch(channelID).catch(() => null);
        if (!channel) {
          results.push(`❌ <#${channelID}> introuvable`);
          continue;
        }

        if (i > 0) {
          await new Promise((r) => setTimeout(r, MULTI_STAGGER_MS));
        }

        try {
          const response = await sendBump(channel);
          const text = extractText(response);
          if (isBumpCooldown(text)) {
            const ms = parseCooldownMs(text) || BUMP_COOLDOWN_MS;
            results.push(`⏳ ${formatChannelLabel(client, channelID)} — cooldown ~${Math.round(ms / 60000)} min`);
            // Garde l'autobump + sauve le prochain passage
            if (!isAutobumpActive(channelID)) {
              startAutobump(channelID, channel, { immediate: false, delayMs: ms, force: true });
            } else {
              scheduleNext(channelID, channel, ms);
            }
            ensureBumpList(db);
            if (!db.bumpchannels.includes(channelID)) db.bumpchannels.push(channelID);
            db.autobump = true;
            await savedb(client, db);
          } else {
            results.push(`✅ ${formatChannelLabel(client, channelID)} — bump OK`);
            const delay = nextDelayAfterSuccess();
            if (!isAutobumpActive(channelID)) {
              startAutobump(channelID, channel, { immediate: false, delayMs: delay, force: true });
            } else {
              scheduleNext(channelID, channel, delay);
            }
            ensureBumpList(db);
            if (!db.bumpchannels.includes(channelID)) db.bumpchannels.push(channelID);
            db.autobump = true;
            await savedb(client, db);
          }
        } catch (error) {
          if (error?.code === 'PERM_APPLICATION_COMMANDS') {
            results.push(`❌ ${formatChannelLabel(client, channelID)} — active **Utiliser les commandes d'application** pour ce compte dans le salon`);
          } else {
            results.push(`❌ ${formatChannelLabel(client, channelID)} — ${error.message}`);
          }
        }
      }

      return message.edit(await language(
        client,
        `🚀 Bump Disboard (\`${channelIDs.length}\`) :\n${results.join('\n')}`,
        `🚀 Disboard bump (\`${channelIDs.length}\`):\n${results.join('\n')}`,
      ));
    }

    // off / remove
    if (action === 'off' || action === 'remove') {
      const wantAll = args[1] && ['all', 'tous', '*'].includes(String(args[1]).toLowerCase());

      if (wantAll) {
        const all = [...db.bumpchannels];
        await removeChannels(client, db, all);
        stopAllAutobump();
        db.bumpchannels = [];
        db.bumpchannel = null;
        db.bumpnext = {};
        db.autobump = false;
        await savedb(client, db);
        return message.edit(await language(
          client,
          `⏹️ Autobump Disboard désactivé sur **tous** les serveurs (${all.length}).`,
          `⏹️ Disboard autobump disabled on **all** servers (${all.length}).`,
        ));
      }

      let channelIDs = parseChannelIds(args.slice(1), currentChannelId);
      if (channelIDs.length === 0) {
        return message.edit(await language(
          client,
          `Précise le salon : \`${prefix}bump off #salon\` ou \`${prefix}bump off all\`.`,
          `Specify a channel: \`${prefix}bump off #channel\` or \`${prefix}bump off all\`.`,
        ));
      }

      const removed = await removeChannels(client, db, channelIDs);
      return message.edit(await language(
        client,
        `⏹️ Autobump désactivé : ${removed.map((id) => formatChannelLabel(client, id)).join('\n') || 'aucun'}`,
        `⏹️ Autobump disabled: ${removed.map((id) => formatChannelLabel(client, id)).join('\n') || 'none'}`,
      ));
    }
  },
};
