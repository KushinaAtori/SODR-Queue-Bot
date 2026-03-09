const Database = require("better-sqlite3");
const db = new Database("elo.db");

db.prepare(
  `
  CREATE TABLE IF NOT EXISTS elo (
    user_id TEXT PRIMARY KEY,
    rating INTEGER NOT NULL
  )
`,
).run();

db.prepare(
  `
  CREATE TABLE IF NOT EXISTS elo_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    ts INTEGER NOT NULL,
    match_num INTEGER NOT NULL,
    result TEXT,                   -- "win" | "loss"
    old_rating INTEGER NOT NULL,
    delta INTEGER NOT NULL,
    new_rating INTEGER NOT NULL
  )
`,
).run();

db.prepare(
  `
  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )
`,
).run();

db.prepare(
  `
  CREATE TABLE IF NOT EXISTS seasons (
    season_id TEXT PRIMARY KEY,
    starts_at INTEGER NOT NULL,
    ends_at INTEGER NOT NULL
  )
`,
).run();

db.prepare(
  `
  CREATE TABLE IF NOT EXISTS elo_season (
    season_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    rating INTEGER NOT NULL,
    peak_rating INTEGER NOT NULL,
    placements_played INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (season_id, user_id)
  )
`,
).run();

db.prepare(
  `
  CREATE TABLE IF NOT EXISTS elo_history_season (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    season_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    ts INTEGER NOT NULL,
    match_num INTEGER NOT NULL,
    result TEXT,
    old_rating INTEGER NOT NULL,
    delta INTEGER NOT NULL,
    new_rating INTEGER NOT NULL
  )
`,
).run();

function getMeta(key) {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key);
  return row ? row.value : null;
}

function setMeta(key, value) {
  db.prepare(
    `
    INSERT INTO meta (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `,
  ).run(key, String(value));
}

function getCurrentSeasonId() {
  return getMeta("current_season_id");
}

function getCurrentSeason() {
  const seasonId = getCurrentSeasonId();
  if (!seasonId) return null;
  const row = db
    .prepare(
      `SELECT season_id, starts_at, ends_at FROM seasons WHERE season_id = ?`,
    )
    .get(seasonId);
  return row ?? null;
}

function ensureSeason(seasonId, endsAtTs) {
  const startsAt = Date.now();
  db.prepare(
    `
    INSERT INTO seasons (season_id, starts_at, ends_at)
    VALUES (?, ?, ?)
    ON CONFLICT(season_id) DO UPDATE SET ends_at = excluded.ends_at
  `,
  ).run(seasonId, startsAt, endsAtTs);
}

function setCurrentSeason(seasonId, endsAtTs) {
  ensureSeason(seasonId, endsAtTs);
  setMeta("current_season_id", seasonId);
}

function getSeasonEndsAt(seasonId) {
  const row = db
    .prepare(`SELECT ends_at FROM seasons WHERE season_id = ?`)
    .get(seasonId);
  return row ? row.ends_at : null;
}

function getElo(userId) {
  const row = db
    .prepare("SELECT rating FROM elo WHERE user_id = ?")
    .get(userId);
  if (!row) {
    db.prepare("INSERT INTO elo (user_id, rating) VALUES (?, 1000)").run(
      userId,
    );
    return 1000;
  }
  return row.rating;
}

function setElo(userId, rating) {
  db.prepare(
    `
    INSERT INTO elo (user_id, rating)
    VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET rating = excluded.rating
  `,
  ).run(userId, rating);
}

function addEloHistory({
  userId,
  ts,
  matchNum,
  result,
  oldRating,
  delta,
  newRating,
}) {
  db.prepare(
    `
    INSERT INTO elo_history (user_id, ts, match_num, result, old_rating, delta, new_rating)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(userId, ts, matchNum, result ?? null, oldRating, delta, newRating);
}

function getEloHistory(userId, limit = 25) {
  return db
    .prepare(
      `
    SELECT ts, match_num, result, old_rating, delta, new_rating
    FROM elo_history
    WHERE user_id = ?
    ORDER BY match_num DESC
    LIMIT ?
  `,
    )
    .all(userId, limit);
}

function getTopElo(limit = 10) {
  return db
    .prepare(
      `
    SELECT user_id, rating
    FROM elo
    ORDER BY rating DESC
    LIMIT ?
  `,
    )
    .all(limit);
}

function getSeasonElo(userId, seasonId) {
  const sid = seasonId ?? getCurrentSeasonId();
  if (!sid) return 1000;

  const row = db
    .prepare(
      `SELECT rating FROM elo_season WHERE season_id = ? AND user_id = ?`,
    )
    .get(sid, userId);

  if (!row) {
    db.prepare(
      `
      INSERT INTO elo_season (season_id, user_id, rating, peak_rating, placements_played)
      VALUES (?, ?, 1000, 1000, 0)
    `,
    ).run(sid, userId);
    return 1000;
  }

  return row.rating;
}

function setSeasonElo(userId, rating, seasonId) {
  const sid = seasonId ?? getCurrentSeasonId();
  if (!sid) return;

  const row = db
    .prepare(
      `
    SELECT peak_rating, placements_played, rating AS current_rating
    FROM elo_season
    WHERE season_id = ? AND user_id = ?
  `,
    )
    .get(sid, userId);

  const current = row?.current_rating ?? 1000;
  const peak = Math.max(row?.peak_rating ?? current, rating);
  const placementsPlayed = row?.placements_played ?? 0;

  db.prepare(
    `
    INSERT INTO elo_season (season_id, user_id, rating, peak_rating, placements_played)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(season_id, user_id) DO UPDATE SET
      rating = excluded.rating,
      peak_rating = excluded.peak_rating,
      placements_played = excluded.placements_played
  `,
  ).run(sid, userId, rating, peak, placementsPlayed);
}

function bumpPlacementsPlayed(userId, seasonId) {
  const sid = seasonId ?? getCurrentSeasonId();
  if (!sid) return;

  db.prepare(
    `
    INSERT INTO elo_season (season_id, user_id, rating, peak_rating, placements_played)
    VALUES (?, ?, 1000, 1000, 1)
    ON CONFLICT(season_id, user_id) DO UPDATE SET
      placements_played = placements_played + 1
  `,
  ).run(sid, userId);
}

function getPlacementsPlayed(userId, seasonId) {
  const sid = seasonId ?? getCurrentSeasonId();
  if (!sid) return 0;

  const row = db
    .prepare(
      `
    SELECT placements_played FROM elo_season WHERE season_id = ? AND user_id = ?
  `,
    )
    .get(sid, userId);

  return row?.placements_played ?? 0;
}

function getSeasonPeak(userId, seasonId) {
  const sid = seasonId ?? getCurrentSeasonId();
  if (!sid) return null;

  const row = db
    .prepare(
      `
    SELECT peak_rating FROM elo_season WHERE season_id = ? AND user_id = ?
  `,
    )
    .get(sid, userId);

  return row?.peak_rating ?? null;
}

function addSeasonHistory({
  seasonId,
  userId,
  ts,
  matchNum,
  result,
  oldRating,
  delta,
  newRating,
}) {
  const sid = seasonId ?? getCurrentSeasonId();
  if (!sid) return;

  db.prepare(
    `
    INSERT INTO elo_history_season (season_id, user_id, ts, match_num, result, old_rating, delta, new_rating)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(sid, userId, ts, matchNum, result ?? null, oldRating, delta, newRating);
}

function getSeasonHistory(userId, limit = 25, seasonId) {
  const sid = seasonId ?? getCurrentSeasonId();
  if (!sid) return [];

  return db
    .prepare(
      `
    SELECT ts, match_num, result, old_rating, delta, new_rating
    FROM elo_history_season
    WHERE season_id = ? AND user_id = ?
    ORDER BY match_num DESC
    LIMIT ?
  `,
    )
    .all(sid, userId, limit);
}

function getTopSeasonElo(limit = 10, seasonId) {
  const sid = seasonId ?? getCurrentSeasonId();
  if (!sid) return [];

  return db
    .prepare(
      `
    SELECT user_id, rating
    FROM elo_season
    WHERE season_id = ?
    ORDER BY rating DESC
    LIMIT ?
  `,
    )
    .all(sid, limit);
}

function hasPlayedSeason(userId, seasonId) {
  const sid = seasonId ?? getCurrentSeasonId();
  if (!sid) return false;

  const row = db
    .prepare(
      `
    SELECT 1 FROM elo_history_season WHERE season_id = ? AND user_id = ? LIMIT 1
  `,
    )
    .get(sid, userId);

  return !!row;
}

function getNextMatchNumber() {
  const row = db
    .prepare(`SELECT value FROM meta WHERE key = 'last_match_num'`)
    .get();
  const last = row ? parseInt(row.value, 10) : 0;
  const next = last + 1;

  db.prepare(
    `
    INSERT INTO meta (key, value)
    VALUES ('last_match_num', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `,
  ).run(String(next));

  return next;
}

function computeStreakFromResults(latestFirstResults) {
  if (!latestFirstResults.length) return { type: null, count: 0 };
  const first = latestFirstResults[0];
  if (first !== "win" && first !== "loss") return { type: null, count: 0 };

  let count = 0;
  for (const r of latestFirstResults) {
    if (r !== first) break;
    count++;
  }
  return { type: first, count };
}

function getSeasonForm(userId, n = 10, seasonId) {
  const hist = getSeasonHistory(userId, n, seasonId);
  const results = hist.map((h) => h.result);
  const form = results.map((r) => (r === "win" ? "W" : "L")).join(" ");
  const streak = computeStreakFromResults(results);
  return { form, streak, results, hist };
}

module.exports = {
  getElo,
  setElo,
  addEloHistory,
  getEloHistory,
  getTopElo,

  getCurrentSeasonId,
  getCurrentSeason,
  setCurrentSeason,
  getSeasonEndsAt,
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
};
