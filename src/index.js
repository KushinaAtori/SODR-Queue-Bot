require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  AttachmentBuilder,
} = require("discord.js");


const {
  getElo,
  setElo,
  addEloHistory,

  getCurrentSeasonId,
  getCurrentSeason,
  setCurrentSeason,
  getSeasonElo,
  setSeasonElo,
  addSeasonHistory,
  getSeasonHistory,
  getTopSeasonElo,
  hasPlayedSeason,
  bumpPlacementsPlayed,
  getPlacementsPlayed,
  getSeasonPeak,
  getSeasonForm,

  getNextMatchNumber,
  getMeta,
  setMeta,
} = require("./elo");

const { renderEloChart } = require("./chart");
const { renderMatchResultsCard } = require("./match_card");
const { renderLeaderboardCard } = require("./leaderboard_card");
const { renderRankChangeCard } = require("./rank_change_card");
const { renderQueueStatusCard } = require("./queue_status_card");

const {
  getRobloxIdFromBloxlink,
  getRobloxUser,
  getRobloxHeadshotUrl,
} = require("./roblox");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
});

const activeMatches = new Map();

const MATCH_VCS = {
  1: process.env.MATCH1_VC_ID,
  2: process.env.MATCH2_VC_ID,
};

const K = 25;

const RANK_ROLES = {
  unranked: process.env.ROLE_UNRANKED_ID,
  iron: process.env.ROLE_IRON_ID,
  bronze: process.env.ROLE_BRONZE_ID,
  silver: process.env.ROLE_SILVER_ID,
  gold: process.env.ROLE_GOLD_ID,
  diamond: process.env.ROLE_DIAMOND_ID,
};

const ALL_RANK_ROLE_IDS = Object.values(RANK_ROLES).filter(Boolean);

function getRankKeyFromElo(elo) {
  if (elo >= 2200) return "diamond";
  if (elo >= 1900) return "gold";
  if (elo >= 1600) return "silver";
  if (elo >= 1300) return "bronze";
  return "iron";
}

const TIER_ORDER = ["iron", "bronze", "silver", "gold", "diamond"];

async function syncMemberRankRoles(member) {
  if (!member || member.user?.bot) return;
  if (!ALL_RANK_ROLE_IDS.length) return;

  const toRemove = member.roles.cache
    .filter((r) => ALL_RANK_ROLE_IDS.includes(r.id))
    .map((r) => r.id);

  if (toRemove.length) {
    await member.roles.remove(toRemove).catch(() => null);
  }

  const played = hasPlayedSeason(member.id);

  if (!played) {
    if (RANK_ROLES.unranked) {
      await member.roles.add(RANK_ROLES.unranked).catch(() => null);
    }
    return;
  }

  const elo = getSeasonElo(member.id);
  const rankKey = getRankKeyFromElo(elo);
  const roleId = RANK_ROLES[rankKey];
  if (roleId) {
    await member.roles.add(roleId).catch(() => null);
  }
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function computeFfaEloDeltas(playerRatings, winnerId) {
  const ids = [...playerRatings.keys()];
  if (ids.length < 2) throw new Error("Need at least 2 players.");
  if (!playerRatings.has(winnerId))
    throw new Error("Winner is not in this match.");

  const strengths = new Map();
  let sum = 0;
  for (const id of ids) {
    const r = playerRatings.get(id);
    const s = Math.pow(10, r / 400);
    strengths.set(id, s);
    sum += s;
  }

  const deltas = new Map();
  for (const id of ids) {
    const expected = strengths.get(id) / sum;
    const score = id === winnerId ? 1 : 0;
    deltas.set(id, Math.round(K * (score - expected)));
  }

  let total = 0;
  for (const v of deltas.values()) total += v;

  if (total !== 0) {
    const sorted = ids
      .map((id) => ({ id, d: deltas.get(id) }))
      .sort((a, b) => (total > 0 ? b.d - a.d : a.d - b.d));

    let i = 0;
    while (total !== 0) {
      const id = sorted[i].id;
      deltas.set(id, deltas.get(id) + (total > 0 ? -1 : 1));
      total += total > 0 ? -1 : 1;
      i = (i + 1) % sorted.length;
    }
  }

  return deltas;
}

function formatUpdatedAt(ts = Date.now()) {
  const d = new Date(ts);
  return d.toLocaleString();
}

function formatDuration(ms) {
  if (ms <= 0) return "now";
  const s = Math.ceil(ms / 1000);
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return m > 0 ? `${m}m ${rem}s` : `${rem}s`;
}

async function getBestAvatarUrl(discordUser, guildId, size = 150) {
  try {
    const robloxId = await getRobloxIdFromBloxlink(discordUser.id, guildId);
    if (robloxId) {
      const headshot = await getRobloxHeadshotUrl(
        robloxId,
        `${size}x${size}`,
        true,
      );
      if (headshot) return headshot;
    }
  } catch {}

  try {
    return discordUser.displayAvatarURL({ extension: "png", size: 256 });
  } catch {
    return "https://cdn.discordapp.com/embed/avatars/0.png";
  }
}

async function upsertLeaderboardMessage(guild) {
  const channelId = process.env.LEADERBOARD_CHANNEL_ID;
  if (!channelId) return;

  const ch = guild.channels.cache.get(channelId);
  if (!ch?.isTextBased()) return;

  const limit = 10;

  const seasonId = getCurrentSeasonId() ?? "Season";
  const top = getTopSeasonElo(limit);

  if (!top.length) return;

  const rows = await Promise.all(
    top.map(async (row, idx) => {
      const user = await client.users.fetch(row.user_id).catch(() => null);
      const name = user?.username ?? "Unknown";
      const avatarUrl = user
        ? await getBestAvatarUrl(user, guild.id, 150)
        : null;
      return { rank: idx + 1, name, elo: row.rating, avatarUrl };
    }),
  );

  const png = await renderLeaderboardCard({
    rows,
    updatedAt: formatUpdatedAt(),
  });

  const file = new AttachmentBuilder(png, { name: "leaderboard.png" });

  const embed = new EmbedBuilder()
    .setTitle(`🏆 Ranked Leaderboard — ${seasonId}`)
    .setDescription("Updated automatically every 3 hours.")
    .setImage("attachment://leaderboard.png")
    .setTimestamp(new Date());

  const metaKey = `leaderboard_msg_${guild.id}`;
  const existingId = getMeta(metaKey);

  if (existingId) {
    const msg = await ch.messages.fetch(existingId).catch(() => null);
    if (msg) {
      await msg.edit({ embeds: [embed], files: [file] }).catch(() => null);
      return;
    }
  }

  const sent = await ch
    .send({ embeds: [embed], files: [file] })
    .catch(() => null);
  if (sent) setMeta(metaKey, sent.id);
}

function scheduleLeaderboard(guild) {
  const interval =
    parseInt(process.env.LEADERBOARD_INTERVAL_MS ?? "", 10) ||
    3 * 60 * 60 * 1000;

  upsertLeaderboardMessage(guild).catch(() => null);

  setInterval(() => {
    upsertLeaderboardMessage(guild).catch(() => null);
  }, interval);
}

async function upsertQueueStatusMessage(guild) {
  const channelId = process.env.QUEUE_INFO_CHANNEL_ID;
  const queueVcId = process.env.QUEUE_VC_ID;
  if (!channelId || !queueVcId) return;

  const ch = guild.channels.cache.get(channelId);
  if (!ch?.isTextBased()) return;

  const queueVc = guild.channels.cache.get(queueVcId);
  if (!queueVc?.isVoiceBased()) return;

  const queued = [...queueVc.members.values()].filter((m) => !m.user.bot);
  const queuedIds = queued.map((m) => m.id);

  let avgElo = 0;
  if (queuedIds.length) {
    const sum = queuedIds.reduce((acc, id) => acc + getSeasonElo(id), 0);
    avgElo = Math.round(sum / queuedIds.length);
  }

  const matchSize = parseInt(process.env.QUEUE_MATCH_SIZE ?? "10", 10) || 10;

  let estimateText = "Waiting...";
  if (queuedIds.length < matchSize) {
    estimateText = `Waiting for ${matchSize - queuedIds.length} more player(s)`;
  } else {
    const match1Busy = activeMatches.has(1);
    const match2Busy = activeMatches.has(2);

    if (!match1Busy || !match2Busy) {
      estimateText = "Estimated start: ready now";
    } else {
      const avgMatchMs =
        parseInt(getMeta("avg_match_ms") ?? "", 10) || 9 * 60 * 1000;
      const now = Date.now();
      const remaining = [];
      for (const m of activeMatches.values()) {
        const eta = m.startedAt + avgMatchMs - now;
        remaining.push(Math.max(0, eta));
      }
      const soonest = remaining.length ? Math.min(...remaining) : 0;
      estimateText = `Estimated start: ~${formatDuration(soonest)}`;
    }
  }

  const png = await renderQueueStatusCard({
    queuedCount: queuedIds.length,
    avgElo,
    estimateText,
    updatedAt: formatUpdatedAt(),
  });

  const file = new AttachmentBuilder(png, { name: "queue.png" });
  const embed = new EmbedBuilder()
    .setTitle("🎮 Queue Status")
    .setDescription("Auto-refreshing status card.")
    .setImage("attachment://queue.png")
    .setTimestamp(new Date());

  const metaKey = `queue_status_msg_${guild.id}`;
  const existingId = getMeta(metaKey);

  if (existingId) {
    const msg = await ch.messages.fetch(existingId).catch(() => null);
    if (msg) {
      await msg.edit({ embeds: [embed], files: [file] }).catch(() => null);
      return;
    }
  }

  const sent = await ch
    .send({ embeds: [embed], files: [file] })
    .catch(() => null);
  if (sent) setMeta(metaKey, sent.id);
}

function scheduleQueueStatus(guild) {
  const interval =
    parseInt(process.env.QUEUE_STATUS_INTERVAL_MS ?? "", 10) || 30000;
  upsertQueueStatusMessage(guild).catch(() => null);
  setInterval(
    () => upsertQueueStatusMessage(guild).catch(() => null),
    interval,
  );
}

const startMatchCmd = new SlashCommandBuilder()
  .setName("startmatch")
  .setDescription(
    "Pull players from queue VC, DM link, move them into a match VC",
  )
  .addIntegerOption((opt) =>
    opt
      .setName("match")
      .setDescription("Which match VC to use (1, 2)")
      .setRequired(true)
      .addChoices({ name: "Match 1", value: 1 }, { name: "Match 2", value: 2 }),
  )
  .addStringOption((opt) =>
    opt
      .setName("link")
      .setDescription("Roblox private server link to DM")
      .setRequired(true),
  )
  .addIntegerOption((opt) =>
    opt
      .setName("size")
      .setDescription("How many players to pull (default 10)")
      .setRequired(false)
      .setMinValue(1)
      .setMaxValue(50),
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.MoveMembers);

const reportWinnerCmd = new SlashCommandBuilder()
  .setName("reportwinner")
  .setDescription("Report winner for a match and apply ELO (FFA fair)")
  .addIntegerOption((opt) =>
    opt
      .setName("match")
      .setDescription("VC match number (1, 2)")
      .setRequired(true),
  )
  .addUserOption((opt) =>
    opt
      .setName("winner")
      .setDescription("Winner of the match")
      .setRequired(true),
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.MoveMembers);

const leaderboardCmd = new SlashCommandBuilder()
  .setName("leaderboard")
  .setDescription("Show the top ELO players (season ladder).")
  .addIntegerOption((opt) =>
    opt
      .setName("limit")
      .setDescription("How many players to show (default 10, max 25).")
      .setRequired(false)
      .setMinValue(1)
      .setMaxValue(25),
  );

const profileCmd = new SlashCommandBuilder()
  .setName("profile")
  .setDescription("Show a player's profile with graph + match history.")
  .addUserOption((opt) =>
    opt
      .setName("user")
      .setDescription("User to view (defaults to you)")
      .setRequired(false),
  );

const newSeasonCmd = new SlashCommandBuilder()
  .setName("newseason")
  .setDescription("Start a new ranked season (resets seasonal ladder).")
  .addStringOption((opt) =>
    opt.setName("season_id").setDescription("e.g. S2").setRequired(true),
  )
  .addIntegerOption((opt) =>
    opt.setName("ends_in_days").setDescription("default 30").setRequired(false),
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

const fakeStartMatchCmd = new SlashCommandBuilder()
  .setName("fakestartmatch")
  .setDescription("Create a fake match with simulated players (no VC required)")
  .addIntegerOption((opt) =>
    opt
      .setName("match")
      .setDescription("Match number (1 or 2)")
      .setRequired(true)
      .addChoices({ name: "Match 1", value: 1 }, { name: "Match 2", value: 2 }),
  )
  .addIntegerOption((opt) =>
    opt
      .setName("size")
      .setDescription("How many fake players (2-10)")
      .setRequired(true)
      .setMinValue(2)
      .setMaxValue(10),
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

const reportFakeWinnerCmd = new SlashCommandBuilder()
  .setName("reportfakewinner")
  .setDescription(
    "Report a winner for a FAKE match (9990xxxx ids) and apply ELO.",
  )
  .addIntegerOption((opt) =>
    opt
      .setName("match")
      .setDescription("VC match number (1, 2)")
      .setRequired(true),
  )
  .addStringOption((opt) =>
    opt
      .setName("winner_id")
      .setDescription("Fake winner id (example: 99900001)")
      .setRequired(true),
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);
  await rest.put(
    Routes.applicationGuildCommands(client.user.id, process.env.GUILD_ID),
    {
      body: [
        startMatchCmd.toJSON(),
        reportWinnerCmd.toJSON(),
        leaderboardCmd.toJSON(),
        profileCmd.toJSON(),
        newSeasonCmd.toJSON(),
        fakeStartMatchCmd.toJSON(),
        reportFakeWinnerCmd.toJSON(),
      ],
    },
  );
  console.log("Running.");
}

client.once("ready", async () => {
  await registerCommands();

  if (!getCurrentSeasonId()) {
    const seasonId = "S1";
    const endsAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
    setCurrentSeason(seasonId, endsAt);
    console.log(`🌙 Created default season ${seasonId}`);
  }

  const guild = await client.guilds
    .fetch(process.env.GUILD_ID)
    .catch(() => null);
  if (guild) {
    scheduleLeaderboard(guild);
    scheduleQueueStatus(guild);
  }
});

client.on("guildMemberAdd", async (member) => {
  await syncMemberRankRoles(member);
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const staffOnly = new Set(["startmatch", "reportwinner"]);
  const staffRoleId = process.env.MATCH_STAFF_ROLE_ID;
  if (staffOnly.has(interaction.commandName) && staffRoleId) {
    if (!interaction.member?.roles?.cache?.has(staffRoleId)) {
      return interaction.reply({
        content: "❌ Match Staff only.",
        ephemeral: true,
      });
    }
  }

  if (interaction.commandName === "newseason") {
    const seasonId = interaction.options.getString("season_id", true);
    const days = interaction.options.getInteger("ends_in_days") ?? 30;
    const endsAt = Date.now() + days * 24 * 60 * 60 * 1000;

    setCurrentSeason(seasonId, endsAt);
    await interaction.reply({
      content: `✅ Started season **${seasonId}** (ends in ${days} days).`,
      ephemeral: true,
    });

    const guild = interaction.guild;
    upsertLeaderboardMessage(guild).catch(() => null);
    upsertQueueStatusMessage(guild).catch(() => null);
    return;
  }

  if (interaction.commandName === "startmatch") {
    const guild = interaction.guild;

    const vcMatchNum = interaction.options.getInteger("match", true);
    const size = interaction.options.getInteger("size") ?? 10;
    const link = interaction.options.getString("link", true);

    const queueVc = guild.channels.cache.get(process.env.QUEUE_VC_ID);
    const matchVc = guild.channels.cache.get(MATCH_VCS[vcMatchNum]);

    if (!queueVc || !queueVc.isVoiceBased()) {
      return interaction.reply({
        content: "❌ Queue VC misconfigured.",
        ephemeral: true,
      });
    }
    if (!matchVc || !matchVc.isVoiceBased()) {
      return interaction.reply({
        content: "❌ Match VC misconfigured.",
        ephemeral: true,
      });
    }

    const queued = [...queueVc.members.values()].filter((m) => !m.user.bot);
    if (queued.length < size) {
      return interaction.reply({
        content: `❌ Not enough players.\nNeed **${size}**, have **${queued.length}**.`,
        ephemeral: true,
      });
    }

    shuffle(queued);
    const picked = queued.slice(0, size);

    activeMatches.set(vcMatchNum, {
      players: picked.map((m) => m.id),
      startedAt: Date.now(),
      link,
    });

    await interaction.reply({
      content: `🎮 VC Match ${vcMatchNum} starting with **${picked.length}** players.`,
      ephemeral: true,
    });

    const dmFails = [];
    const moveFails = [];

    for (const m of picked) {
      try {
        await m.send(`🎮 **Match ${vcMatchNum}**\nPrivate server:\n${link}`);
      } catch {
        dmFails.push(m.user.tag);
      }

      try {
        await m.voice.setChannel(matchVc);
      } catch {
        moveFails.push(m.user.tag);
      }
    }

    const logCh = guild.channels.cache.get(process.env.LOG_CHANNEL_ID);
    if (logCh?.isTextBased()) {
      await logCh.send(
        `**VC Match ${vcMatchNum} started**\nPlayers:\n${picked.map((p) => `<@${p.id}>`).join(", ")}`,
      );
      if (dmFails.length)
        await logCh.send(`⚠️ DM failed: ${dmFails.join(", ")}`);
      if (moveFails.length)
        await logCh.send(`⚠️ Move failed: ${moveFails.join(", ")}`);
    }

    upsertQueueStatusMessage(guild).catch(() => null);
  }

  if (interaction.commandName === "reportwinner") {
    await interaction.deferReply({ ephemeral: true }).catch(() => null);
    const guild = interaction.guild;
    const vcMatchNum = interaction.options.getInteger("match", true);
    const winner = interaction.options.getUser("winner", true);

    const match = activeMatches.get(vcMatchNum);
    if (!match)
      return interaction
        .editReply({ content: "❌ No active match found." })
        .catch(() => null);
    if (!match.players.includes(winner.id)) {
      return interaction
        .editReply({ content: "❌ That winner is not in this match." })
        .catch(() => null);
    }

    const seasonId = getCurrentSeasonId();
    const matchNumber = getNextMatchNumber();
    const ts = Date.now();

    const ratingsSeason = new Map();
    const ratingsAllTime = new Map();
    for (const id of match.players) {
      ratingsSeason.set(id, getSeasonElo(id, seasonId));
      ratingsAllTime.set(id, getElo(id));
    }

    const deltas = computeFfaEloDeltas(ratingsSeason, winner.id);

    const placementMax =
      parseInt(process.env.PLACEMENT_MATCHES ?? "5", 10) || 5;

    for (const id of match.players) {
      const oldSeason = ratingsSeason.get(id);
      const delta = deltas.get(id);
      const newSeason = oldSeason + delta;

      const oldTier = getRankKeyFromElo(oldSeason);
      const newTier = getRankKeyFromElo(newSeason);

      setSeasonElo(id, newSeason, seasonId);
      bumpPlacementsPlayed(id, seasonId);

      addSeasonHistory({
        seasonId,
        userId: id,
        ts,
        matchNum: matchNumber,
        result: id === winner.id ? "win" : "loss",
        oldRating: oldSeason,
        delta,
        newRating: newSeason,
      });

      const oldAll = ratingsAllTime.get(id);
      const newAll = oldAll + delta;
      setElo(id, newAll);

      addEloHistory({
        userId: id,
        ts,
        matchNum: matchNumber,
        result: id === winner.id ? "win" : "loss",
        oldRating: oldAll,
        delta,
        newRating: newAll,
      });

      if (oldTier !== newTier) {
        const rankChId =
          process.env.RANK_CHANGE_CHANNEL_ID ||
          process.env.MATCH_RESULTS_CHANNEL_ID;
        const rankCh = guild.channels.cache.get(rankChId);

        if (rankCh?.isTextBased()) {
          const member = await guild.members.fetch(id).catch(() => null);
          const username = member?.user?.username ?? `Player-${id.slice(-4)}`;
          const avatarUrl =
            member?.user?.displayAvatarURL({ extension: "png", size: 256 }) ??
            "https://cdn.discordapp.com/embed/avatars/0.png";

          const isUp =
            TIER_ORDER.indexOf(newTier) > TIER_ORDER.indexOf(oldTier);

          const card = await renderRankChangeCard({
            username,
            avatarUrl,
            oldTier,
            newTier,
            newElo: newSeason,
            isUp,
          });

          const file = new AttachmentBuilder(card, { name: "rank.png" });
          const embed = new EmbedBuilder()
            .setTitle(isUp ? "⬆️ Rank Up" : "⬇️ Rank Down")
            .setImage("attachment://rank.png")
            .setTimestamp(new Date(ts));

          await rankCh
            .send({ embeds: [embed], files: [file] })
            .catch(() => null);
        }
      }
    }

    activeMatches.delete(vcMatchNum);

    const dur = Date.now() - match.startedAt;
    const prev = parseInt(getMeta("avg_match_ms") ?? "", 10) || dur;
    const nextAvg = Math.round(prev * 0.85 + dur * 0.15);
    setMeta("avg_match_ms", nextAvg);

    for (const id of match.players) {
      const member = await guild.members.fetch(id).catch(() => null);
      if (member) await syncMemberRankRoles(member);
    }

    const { streak: winnerStreak } = getSeasonForm(winner.id, 10, seasonId);
    let winnerStreakText = null;
    if (winnerStreak?.type === "win" && winnerStreak.count >= 2) {
      winnerStreakText = `🔥 ${winnerStreak.count} win streak`;
    } else if (winnerStreak?.type === "loss" && winnerStreak.count >= 2) {
      winnerStreakText = `💀 ${winnerStreak.count} loss streak`;
    }

    const resultsCh = guild.channels.cache.get(
      process.env.MATCH_RESULTS_CHANNEL_ID,
    );
    if (resultsCh?.isTextBased()) {
      const bloxGuildId = interaction.guildId;

      const users = await Promise.all(
        match.players.map(async (id) => {
          let u = null;
          if (!id.startsWith("9990")) {
            u = await client.users.fetch(id).catch(() => null);
          }

          const oldElo = ratingsSeason.get(id);
          const delta = deltas.get(id);
          const newElo = oldElo + delta;

          let headshot = null;
          try {
            const robloxId = await getRobloxIdFromBloxlink(id, bloxGuildId);
            if (robloxId)
              headshot = await getRobloxHeadshotUrl(robloxId, "150x150", true);
          } catch {}

          const discordAvatar = u
            ? u.displayAvatarURL({ extension: "png", size: 128 })
            : "https://cdn.discordapp.com/embed/avatars/0.png";

          return {
            id,
            username: u?.username ?? `BOT-${id.slice(-2)}`,
            avatarUrl: headshot ?? discordAvatar,
            elo: newElo,
            delta,
          };
        }),
      );

      const cardPng = await renderMatchResultsCard({
        matchNumber,
        players: users,
        winnerId: winner.id,
        winnerStreakText,
      });

      const file = new AttachmentBuilder(cardPng, { name: "match.png" });

      const lines = users
        .slice()
        .sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0))
        .map((p) => {
          const d = p.delta >= 0 ? `+${p.delta}` : `${p.delta}`;
          return `<@${p.id}> — **${p.elo}** (${d})`;
        })
        .join("\n");

      const winnerPlacementsPlayed = getPlacementsPlayed(winner.id, seasonId);
      const placementsLeft = Math.max(
        0,
        (parseInt(process.env.PLACEMENT_MATCHES ?? "5", 10) || 5) -
          winnerPlacementsPlayed,
      );

      const embed = new EmbedBuilder()
        .setTitle(`🏁 Match #${matchNumber} Results`)
        .setDescription(
          `👑 Winner: <@${winner.id}>\n` +
            (placementsLeft > 0
              ? `🧪 Placements left (winner): **${placementsLeft}**\n\n`
              : `\n`) +
            `${lines}`,
        )
        .setImage("attachment://match.png")
        .setTimestamp(new Date(ts));

      await resultsCh
        .send({ embeds: [embed], files: [file] })
        .catch(() => null);
    }

    const logCh = guild.channels.cache.get(process.env.LOG_CHANNEL_ID);
    if (logCh?.isTextBased()) {
      await logCh.send(
        `🏁 Match #${matchNumber} finished (VC Match ${vcMatchNum}) — Winner: <@${winner.id}>`,
      );
    }

    upsertLeaderboardMessage(guild).catch(() => null);
    upsertQueueStatusMessage(guild).catch(() => null);

    await interaction
      .editReply({ content: `✅ Logged Match #${matchNumber}.` })
      .catch(() => null);
  }

  if (interaction.commandName === "leaderboard") {
    const limit = interaction.options.getInteger("limit") ?? 10;
    const top = getTopSeasonElo(limit);

    if (!top.length) {
      return interaction.reply({
        content: "No ELO data yet for this season.",
        ephemeral: true,
      });
    }

    const lines = top.map((row, i) => {
      const rank = `${i + 1}`.padStart(2, "0");
      return `**#${rank}** <@${row.user_id}> — **${row.rating}**`;
    });

    const embed = new EmbedBuilder()
      .setTitle(`🏆 Season Leaderboard — ${getCurrentSeasonId() ?? "Season"}`)
      .setDescription(lines.join("\n"))
      .setTimestamp(new Date());

    return interaction.reply({ embeds: [embed] });
  }

  if (interaction.commandName === "profile") {
    const target = interaction.options.getUser("user") ?? interaction.user;
    const bloxGuildId = interaction.guildId;

    const season = getCurrentSeason();
    const seasonId = getCurrentSeasonId();
    const currentSeasonElo = getSeasonElo(target.id, seasonId);

    let robloxId = null;
    let robloxUser = null;
    let robloxHeadshot = null;

    try {
      robloxId = await getRobloxIdFromBloxlink(target.id, bloxGuildId);
      if (robloxId) {
        robloxUser = await getRobloxUser(robloxId);
        robloxHeadshot = await getRobloxHeadshotUrl(robloxId, "180x180", true);
      }
    } catch {}

    const discordAvatar = target.displayAvatarURL({
      extension: "png",
      size: 256,
    });
    const avatar = robloxHeadshot ?? discordAvatar;

    const titleName =
      robloxUser?.displayName && robloxUser?.name
        ? `${robloxUser.displayName} (@${robloxUser.name})`
        : target.username;

    const hist = getSeasonHistory(target.id, 50, seasonId).reverse();

    const placementMax =
      parseInt(process.env.PLACEMENT_MATCHES ?? "5", 10) || 5;
    const playedPlacements = getPlacementsPlayed(target.id, seasonId);
    const placementsLeft = Math.max(0, placementMax - playedPlacements);

    const peak = getSeasonPeak(target.id, seasonId) ?? currentSeasonElo;

    const endsAt = season?.ends_at ?? null;
    let endsIn = "Unknown";
    if (endsAt) {
      const ms = endsAt - Date.now();
      if (ms <= 0) endsIn = "Ended";
      else {
        const hrs = Math.floor(ms / (60 * 60 * 1000));
        const days = Math.floor(hrs / 24);
        const remH = hrs % 24;
        endsIn = days > 0 ? `${days}d ${remH}h` : `${remH}h`;
      }
    }

    const { form, streak } = getSeasonForm(target.id, 10, seasonId);
    const streakText =
      streak?.type === "win"
        ? `🔥 ${streak.count}W`
        : streak?.type === "loss"
          ? `💀 ${streak.count}L`
          : "—";

    if (!hist.length) {
      const embed = new EmbedBuilder()
        .setTitle(`${titleName}'s Profile`)
        .setThumbnail(avatar)
        .setDescription(
          `**Season:** ${seasonId ?? "—"}\n` +
            `**Season ELO:** **${currentSeasonElo}**\n` +
            `**Season Peak:** **${peak}**\n` +
            `**Season Ends In:** **${endsIn}**\n` +
            `**Placement Matches:** **${placementsLeft}** remaining\n` +
            `**Streak:** **${streakText}**\n` +
            `**Form (last 10):** ${form || "—"}\n\n` +
            `No match history yet this season.`,
        );

      return interaction.reply({ embeds: [embed], ephemeral: false });
    }

    const labels = hist.map((h) => String(h.match_num));
    const data = hist.map((h) => h.new_rating);
    const results = hist.map((h) => (h.result === "win" ? "win" : "loss"));

    const png = await renderEloChart({
      labels,
      data,
      results,
      title: `ELO per Match — ${titleName}`,
    });

    const file = new AttachmentBuilder(png, { name: "elo.png" });

    const recent = [...hist].slice(-10).reverse();
    const recentLines = recent
      .map((h) => {
        const r = h.result === "win" ? "W" : "L";
        const d = h.delta >= 0 ? `+${h.delta}` : `${h.delta}`;
        return `#${h.match_num} — **${r}** (${d}) → **${h.new_rating}**`;
      })
      .join("\n");

    const embed = new EmbedBuilder()
      .setTitle(`${titleName}'s Profile`)
      .setThumbnail(avatar)
      .setDescription(
        `**Season:** ${seasonId ?? "—"}\n` +
          `**Season ELO:** **${currentSeasonElo}**\n` +
          `**Season Peak:** **${peak}**\n` +
          `**Season Ends In:** **${endsIn}**\n` +
          `**Placement Matches:** **${placementsLeft}** remaining\n` +
          `**Streak:** **${streakText}**\n` +
          `**Form (last 10):** ${form || "—"}\n\n` +
          `**Recent Matches**\n${recentLines}`,
      )
      .setImage("attachment://elo.png")
      .setTimestamp(new Date());

    return interaction.reply({ embeds: [embed], files: [file] });
  }

  if (interaction.commandName === "fakestartmatch") {
    await interaction.deferReply({ ephemeral: true }).catch(() => null);

    const vcMatchNum = interaction.options.getInteger("match", true);
    const size = interaction.options.getInteger("size", true);

    const fakePlayers = [];
    for (let i = 1; i <= size; i++) {
      fakePlayers.push(String(99900000 + i));
    }

    activeMatches.set(vcMatchNum, {
      players: fakePlayers,
      startedAt: Date.now(),
      link: null,
    });

    await interaction.editReply({
      content: `🧪 Fake match ${vcMatchNum} created with ${size} players:\n${fakePlayers.map((id) => `<@${id}>`).join(", ")}`,
    });

    return;
  }

  if (interaction.commandName === "reportfakewinner") {
    await interaction.deferReply({ ephemeral: true }).catch(() => null);

    const guild = interaction.guild;
    const vcMatchNum = interaction.options.getInteger("match", true);
    const winnerIdRaw = interaction.options.getString("winner_id", true).trim();
    const winnerId = winnerIdRaw.replace(/[<@!>]/g, "");

    const match = activeMatches.get(vcMatchNum);
    if (!match)
      return interaction
        .editReply("❌ No active match found.")
        .catch(() => null);

    if (!match.players.includes(winnerId)) {
      return interaction
        .editReply(`❌ Winner ${winnerIdRaw} is not in this fake match.`)
        .catch(() => null);
    }

    const matchNumber = getNextMatchNumber();
    const ts = Date.now();

    const ratings = new Map();
    for (const id of match.players) ratings.set(id, getElo(id));

    const deltas = computeFfaEloDeltas(ratings, winnerId);

    for (const id of match.players) {
      const oldElo = ratings.get(id);
      const delta = deltas.get(id);
      const newElo = oldElo + delta;

      setElo(id, newElo);
      addEloHistory({
        userId: id,
        ts,
        matchNum: matchNumber,
        result: id === winnerId ? "win" : "loss",
        oldRating: oldElo,
        delta,
        newRating: newElo,
      });
    }

    activeMatches.delete(vcMatchNum);

    const users = match.players.map((id) => {
      const oldElo = ratings.get(id);
      const delta = deltas.get(id);
      const newElo = oldElo + delta;

      const isFake = id.startsWith("9990");
      return {
        id,
        username: isFake ? `BOT-${id.slice(-2)}` : "Unknown",
        avatarUrl: "https://cdn.discordapp.com/embed/avatars/0.png",
        elo: newElo,
        delta,
      };
    });

    const cardPng = await renderMatchResultsCard({
      matchNumber,
      players: users,
      winnerId,
      winnerStreakText: null,
    });

    const resultsCh = guild.channels.cache.get(
      process.env.MATCH_RESULTS_CHANNEL_ID,
    );
    if (resultsCh?.isTextBased()) {
      const file = new AttachmentBuilder(cardPng, { name: "match.png" });

      const embed = new EmbedBuilder()
        .setTitle(`🧪 Fake Match #${matchNumber} Results`)
        .setDescription(
          `👑 Winner: **${winnerId.startsWith("9990") ? `BOT-${winnerId.slice(-2)}` : winnerId}**`,
        )
        .setImage("attachment://match.png")
        .setTimestamp(new Date(ts));

      await resultsCh
        .send({ embeds: [embed], files: [file] })
        .catch(() => null);
    }

    await upsertLeaderboardMessage(guild).catch(() => null);

    return interaction
      .editReply(`✅ Logged FAKE Match #${matchNumber}. Winner: ${winnerIdRaw}`)
      .catch(() => null);
  }
});

client.login(process.env.TOKEN);
