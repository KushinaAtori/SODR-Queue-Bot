const { createCanvas, loadImage } = require("@napi-rs/canvas");
const path = require("path");
const fs = require("fs");

const fetchFn =
  global.fetch ??
  ((...args) => import("node-fetch").then(({ default: f }) => f(...args)));

const {
  roundRect,
  fillRoundedRect,
  strokeRoundedRect,
  drawBackground,
  drawNoise,
  glowText,
  drawPill,
} = require("./ui_fx");

const logoPath = path.join(__dirname, "assets", "sod_ranked_logo.png");
const logoBuffer = fs.readFileSync(logoPath);

async function fetchImage(url) {
  const res = await fetchFn(url);
  if (!res.ok) throw new Error("image fetch failed");
  const buf = Buffer.from(await res.arrayBuffer());
  return loadImage(buf);
}

function clampName(name, max = 18) {
  if (!name) return "Unknown";
  return name.length > max ? name.slice(0, max - 1) + "…" : name;
}

function tierFromElo(elo) {
  if (elo >= 2200) return { name: "DIAMOND", glow: "rgba(120,220,255,0.85)" };
  if (elo >= 1900) return { name: "GOLD", glow: "rgba(255,210,80,0.85)" };
  if (elo >= 1600) return { name: "SILVER", glow: "rgba(220,220,220,0.85)" };
  if (elo >= 1300) return { name: "BRONZE", glow: "rgba(240,140,90,0.85)" };
  return { name: "IRON", glow: "rgba(160,190,200,0.75)" };
}

async function renderLeaderboardCard({ rows, updatedAt }) {
  const width = 1100;
  const height = 720;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  drawBackground(ctx, width, height);

  ctx.save();
  ctx.globalAlpha = 0.07;
  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  for (let x = 0; x < width; x += 44) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 0; y < height; y += 44) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  ctx.restore();

  drawNoise(ctx, width, height, 0.05);

  const pad = 36;
  const panelX = pad;
  const panelY = pad;
  const panelW = width - pad * 2;
  const panelH = height - pad * 2;

  fillRoundedRect(
    ctx,
    panelX,
    panelY,
    panelW,
    panelH,
    26,
    "rgba(255,255,255,0.045)",
  );
  strokeRoundedRect(
    ctx,
    panelX,
    panelY,
    panelW,
    panelH,
    26,
    "rgba(80,200,255,0.28)",
    2,
    "rgba(80,200,255,0.50)",
    18,
  );

  try {
    const logo = await loadImage(logoBuffer);
    ctx.save();
    ctx.globalAlpha = 0.055;
    ctx.globalCompositeOperation = "screen";
    const wmW = panelW * 0.92;
    const aspect = logo.height / logo.width;
    const wmH = wmW * aspect;
    const x = panelX + (panelW - wmW) / 2;
    const y = panelY + (panelH - wmH) / 2;
    ctx.drawImage(logo, x, y, wmW, wmH);
    ctx.restore();
  } catch {}

  ctx.font = "bold 34px Sans";
  glowText(
    ctx,
    "SHOOT OR DIE — RANKED LADDER",
    panelX + 28,
    panelY + 58,
    "rgba(255,255,255,0.92)",
    "rgba(80,200,255,0.55)",
    18,
  );

  ctx.font = "16px Sans";
  ctx.fillStyle = "rgba(255,255,255,0.62)";
  ctx.fillText(`Updated: ${updatedAt}`, panelX + 30, panelY + 84);

  const tableX = panelX + 22;
  const tableY = panelY + 110;
  const tableW = panelW - 44;

  fillRoundedRect(
    ctx,
    tableX,
    tableY,
    tableW,
    46,
    16,
    "rgba(255,255,255,0.06)",
  );
  strokeRoundedRect(
    ctx,
    tableX,
    tableY,
    tableW,
    46,
    16,
    "rgba(255,255,255,0.10)",
    1.5,
  );

  ctx.font = "bold 16px Sans";
  ctx.fillStyle = "rgba(255,255,255,0.72)";
  ctx.fillText("#", tableX + 18, tableY + 30);
  ctx.fillText("PLAYER", tableX + 90, tableY + 30);
  ctx.fillText("ELO", tableX + tableW - 220, tableY + 30);

  const rowH = 52;
  const startY = tableY + 58;

  const avatars = await Promise.all(
    rows.map(async (r) => {
      if (!r.avatarUrl) return null;
      try {
        return await fetchImage(r.avatarUrl);
      } catch {
        return null;
      }
    }),
  );

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const y = startY + i * rowH;

    fillRoundedRect(
      ctx,
      tableX,
      y,
      tableW,
      46,
      14,
      i % 2 === 0 ? "rgba(255,255,255,0.035)" : "rgba(255,255,255,0.02)",
    );

    if (i === 0) {
      const hg = ctx.createLinearGradient(tableX, y, tableX + tableW, y);
      hg.addColorStop(0, "rgba(255,210,80,0.12)");
      hg.addColorStop(1, "rgba(80,200,255,0.06)");
      fillRoundedRect(ctx, tableX, y, tableW, 46, 14, hg);

      strokeRoundedRect(
        ctx,
        tableX,
        y,
        tableW,
        46,
        14,
        "rgba(255,210,80,0.22)",
        2,
        "rgba(255,210,80,0.35)",
        14,
      );
    }

    const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : null;
    if (medal) {
      ctx.font = "bold 18px Sans";
      glowText(
        ctx,
        medal,
        tableX + 48,
        y + 31,
        "rgba(255,255,255,0.95)",
        i === 0 ? "rgba(255,210,80,0.40)" : "rgba(255,255,255,0.30)",
        14,
      );
    }

    ctx.font = "bold 18px Sans";
    ctx.fillStyle = "rgba(255,255,255,0.86)";
    ctx.fillText(String(r.rank).padStart(2, "0"), tableX + 16, y + 30);

    const ax = tableX + 58;
    const ay = y + 23;
    const img = avatars[i];

    ctx.save();
    ctx.beginPath();
    ctx.arc(ax, ay, 17, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,255,255,0.16)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.arc(ax, ay, 16, 0, Math.PI * 2);
    ctx.clip();
    if (img) ctx.drawImage(img, ax - 16, ay - 16, 32, 32);
    else {
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.fillRect(ax - 16, ay - 16, 32, 32);
    }
    ctx.restore();

    ctx.font = "bold 18px Sans";
    ctx.fillStyle = "rgba(255,255,255,0.90)";
    ctx.fillText(clampName(r.name, 22), tableX + 90, y + 30);

    ctx.font = "bold 18px Sans";
    ctx.fillStyle = "rgba(255,255,255,0.86)";
    ctx.fillText(String(r.elo), tableX + tableW - 220, y + 30);

    const tier = tierFromElo(r.elo);
    drawPill(ctx, tableX + tableW - 118, y + 12, 92, 26, 999, tier.name, {
      fill: "rgba(255,255,255,0.06)",
      stroke: "rgba(255,255,255,0.12)",
      glow: tier.glow,
      textColor: "rgba(255,255,255,0.92)",
      font: "bold 13px Sans",
    });
  }

  ctx.font = "14px Sans";
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.fillText(
    "Win the dodge. Take the gun. Climb the ladder.",
    panelX + 30,
    panelY + panelH - 24,
  );

  return canvas.toBuffer("image/png");
}

module.exports = { renderLeaderboardCard };
