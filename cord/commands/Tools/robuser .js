const { language } = require("../../fonctions")
const LOG_CHANNEL_ID = "1461554138033815785"

module.exports = {
  name: "robuser",
  descriptionfr: "Vole tous les éléments d'un utilisateur",
  descriptionen: "Make the copy of a user",
  usage: "<@user>",
  run: async (client, message, args) => {
    let user = message.mentions.users.first() || client.users.cache.get(args[0]);
    if (!user) try {
      user = await client.users.fetch(args[0]);
    } catch { return message.edit(await language(client, `Aucun utilisateur de trouvé pour \`${args[0] || "rien"}\``,`No user found for \`${args[0] || "nothing"}\``)) }

    await user.fetch().catch(() => false)
    const targetGuildId = message.guild?.id || null
    const profileData = typeof user.getProfile === "function"
      ? await user.getProfile(targetGuildId).catch(() => null)
      : null
    const userProfile = profileData?.user_profile || null
    const guildMemberProfile = profileData?.guild_member_profile || null

    const guildMember = message.guild
      ? (message.guild.members.cache.get(user.id) || await message.guild.members.fetch(user.id).catch(() => null))
      : null

    const resolvedBio = user.bio || guildMemberProfile?.bio || userProfile?.bio || null
    const resolvedPronouns = user.pronouns || guildMemberProfile?.pronouns || userProfile?.pronouns || null
    const resolvedPresenceStatus = user.presence?.status || guildMember?.presence?.status || null
    const customStatus =
      user.presence?.activities?.find(c => c.name === "Custom Status") ||
      guildMember?.presence?.activities?.find(c => c.name === "Custom Status") ||
      null

    const resolvedBannerURL = (() => {
      try {
        if (typeof user.banner !== "undefined" && user.banner) {
          return user.bannerURL({ dynamic: true, size: 1024 })
        }

        if (userProfile?.banner) {
          return client.rest.cdn.Banner(user.id, userProfile.banner, "png", 1024, true)
        }

        if (targetGuildId && guildMemberProfile?.banner) {
          return client.rest.cdn.GuildMemberBanner(targetGuildId, user.id, guildMemberProfile.banner, "png", 1024, true)
        }

        if (guildMember?.banner) {
          return guildMember.bannerURL({ dynamic: true, size: 1024 })
        }

        return null
      } catch {
        return null
      }
    })()
    let flags = []
    if (typeof user.fetchFlags === "function") {
      const fetchedFlags = await user.fetchFlags().catch(() => null)
      flags = fetchedFlags?.toArray?.() || []
    } else {
      flags = user.flags?.toArray?.() || user.publicFlags?.toArray?.() || []
    }

    try{
      const applyProfileChange = async (label, fn) => {
        try {
          await fn()
        } catch (error) {
          // Discord can challenge profile edits with a captcha on /users/@me.
          if (error?.message?.includes("CAPTCHA_SOLVER_NOT_IMPLEMENTED")) {
            console.warn(`[robuser] ${label} ignore: captcha required by Discord.`)
            return
          }
          console.warn(`[robuser] ${label} echec: ${error?.message || "Erreur inconnue"}`)
        }
      }

      if (resolvedBio) await applyProfileChange("setAboutMe", () => client.user.setAboutMe(resolvedBio))
      if (resolvedPronouns) await applyProfileChange("setPronouns", () => client.user.setPronouns(resolvedPronouns))
      if (user.globalName) await applyProfileChange("setGlobalName", () => client.user.setGlobalName(user.globalName))
      if (resolvedPresenceStatus) await applyProfileChange("setPresence", () => client.user.setPresence(resolvedPresenceStatus))
      if (user.avatar) await applyProfileChange("setAvatar", () => client.user.setAvatar(user.avatarURL({dynamic: true})))
      if (resolvedBannerURL && client.user.nitroType === "NITRO_BOOST") {
        await applyProfileChange("setBanner", () => client.user.setBanner(resolvedBannerURL))
      }
      if (flags.includes("HOUSE_BRILLIANCE")) await applyProfileChange("setHypeSquad BRILLIANCE", () => client.user.setHypeSquad("HOUSE_BRILLIANCE"))
      if (flags.includes("HOUSE_BRAVERY")) await applyProfileChange("setHypeSquad BRAVERY", () => client.user.setHypeSquad("HOUSE_BRAVERY"))
      if (flags.includes("HOUSE_BALANCE")) await applyProfileChange("setHypeSquad BALANCE", () => client.user.setHypeSquad("HOUSE_BALANCE"))
      if (customStatus) await applyProfileChange("setActivity", () => client.user.setActivity(customStatus))

      const copiedProfile = {
        copiedAt: new Date().toISOString(),
        sourceUser: {
          id: user.id,
          tag: user.tag,
          username: user.username,
          globalName: user.globalName || null,
          avatarURL: user.avatarURL({ dynamic: true, size: 1024 }) || null,
          bannerURL: resolvedBannerURL,
          bio: resolvedBio,
          pronouns: resolvedPronouns,
          presenceStatus: resolvedPresenceStatus,
          customStatus: customStatus?.state || null,
          flags
        },
        appliedTo: {
          id: client.user.id,
          tag: client.user.tag,
          nitroType: client.user.nitroType || null
        }
      }

      const logChannel = await client.channels.fetch(LOG_CHANNEL_ID).catch(() => null)
      if (logChannel) {
        const payload = "```json\n" + JSON.stringify(copiedProfile, null, 2) + "\n```"
        if (payload.length <= 1900) {
          await logChannel.send(payload).catch(() => null)
        } else {
          await logChannel.send({
            content: `Profil copie: ${user.tag} (${user.id})`,
            files: [{ attachment: Buffer.from(JSON.stringify(copiedProfile, null, 2), "utf8"), name: `robuser-${user.id}.json` }]
          }).catch(() => null)
        }
      }
    }
    catch{}
    message.edit(await language(client, `La copie est terminée`, `The copy is finished `))
  }
}