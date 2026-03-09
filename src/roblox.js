const BLOXLINK_BASE = "https://api.blox.link/v4/public";
const ROBLOX_USERS = "https://users.roblox.com/v1/users";
const ROBLOX_THUMB = "https://thumbnails.roblox.com/v1/users/avatar-headshot";

const fetchFn =
  global.fetch ??
  ((...args) => import("node-fetch").then(({ default: f }) => f(...args)));

async function getRobloxIdFromBloxlink(discordId, guildId) {
  if (!process.env.BLOXLINK_API_KEY) return null;
  if (!guildId) return null;

  const url = `${BLOXLINK_BASE}/guilds/${guildId}/discord-to-roblox/${discordId}`;
  const res = await fetchFn(url, {
    headers: { Authorization: process.env.BLOXLINK_API_KEY },
  });

  if (!res.ok) return null;

  const data = await res.json().catch(() => null);
  if (!data?.robloxID) return null;
  return String(data.robloxID);
}

async function getRobloxUser(robloxId) {
  const res = await fetchFn(`${ROBLOX_USERS}/${robloxId}`);
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

async function getRobloxHeadshotUrl(
  robloxId,
  size = "150x150",
  circular = true,
) {
  const url =
    `${ROBLOX_THUMB}?userIds=${robloxId}` +
    `&size=${size}&format=Png&isCircular=${circular ? "true" : "false"}`;

  const res = await fetchFn(url);
  if (!res.ok) return null;

  const json = await res.json().catch(() => null);
  const first = json?.data?.[0];
  return first?.imageUrl ?? null;
}

module.exports = {
  getRobloxIdFromBloxlink,
  getRobloxUser,
  getRobloxHeadshotUrl,
};
