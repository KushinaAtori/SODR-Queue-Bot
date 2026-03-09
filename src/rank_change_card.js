const { createCanvas, loadImage } = require("@napi-rs/canvas");
const path = require("path");
const fs = require("fs");
const { drawBackground, drawNoise, glowText, drawPill } = require("./ui_fx");

const logoPath = path.join(__dirname, "assets", "sod_ranked_logo.png");
const logoBuffer = fs.readFileSync(logoPath);

function tierFromElo(elo) {
  if (elo >= 2200) return { name: "DIAMOND", glow: "rgba(120,220,255,0.85)" };
  if (elo >= 1900) return { name: "GOLD", glow: "rgba(255,210,80,0.85)" };
  if (elo >= 1600) return { name: "SILVER", glow: "rgba(220,220,220,0.85)" };
  if (elo >= 1300) return { name: "BRONZE", glow: "rgba(240,140,90,0.85)" };
  return { name: "IRON", glow: "rgba(160,190,200,0.75)" };
}

async function fetchImage(url) {
  const res = await fetch(url);
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  return loadImage(buf);
}

async function renderRankChangeCard({
  username,
  avatarUrl,
  oldTier,
  newTier,
  newElo,
  isUp,
}) {
  const width = 1100;
  const height = 420;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  drawBackground(ctx, width, height);
  drawNoise(ctx, width, height, 0.05);

  try {
    const logo = await loadImage(logoBuffer);
    ctx.save();
    ctx.globalAlpha = 0.06;
    ctx.globalCompositeOperation = "screen";
    const wmW = width * 0.78;
    const aspect = logo.height / logo.width;
    ctx.drawImage(
      logo,
      (width - wmW) / 2,
      (height - wmW * aspect) / 2,
      wmW,
      wmW * aspect,
    );
    ctx.restore();
  } catch {}

  const headline = isUp ? "RANK UP!" : "RANK DOWN!";
  glowText(
    ctx,
    headline,
    52,
    82,
    "rgba(255,255,255,0.95)",
    isUp ? "rgba(57,255,20,0.55)" : "rgba(255,59,59,0.55)",
    22,
    "left",
  );

  ctx.font = "16px Sans";
  ctx.fillStyle = "rgba(255,255,255,0.65)";
  ctx.fillText(`${username} crossed a tier boundary`, 56, 110);

  const img = avatarUrl ? await fetchImage(avatarUrl) : null;

  const ax = 115;
  const ay = 235;
  const r = 58;

  ctx.save();
  ctx.beginPath();
  ctx.arc(ax, ay, r + 6, 0, Math.PI * 2);
  ctx.strokeStyle = isUp ? "rgba(57,255,20,0.70)" : "rgba(255,59,59,0.70)";
  ctx.lineWidth = 10;
  ctx.shadowColor = isUp ? "rgba(57,255,20,0.55)" : "rgba(255,59,59,0.55)";
  ctx.shadowBlur = 24;
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.arc(ax, ay, r, 0, Math.PI * 2);
  ctx.clip();
  if (img) ctx.drawImage(img, ax - r, ay - r, r * 2, r * 2);
  else {
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.fillRect(ax - r, ay - r, r * 2, r * 2);
  }
  ctx.restore();

  const newTierObj = tierFromElo(newElo);

  drawPill(ctx, 240, 190, 160, 34, 999, String(oldTier).toUpperCase(), {
    fill: "rgba(255,255,255,0.05)",
    stroke: "rgba(255,255,255,0.12)",
    glow: "rgba(255,255,255,0.18)",
    textColor: "rgba(255,255,255,0.88)",
    font: "bold 14px Sans",
  });

  ctx.font = "bold 22px Sans";
  glowText(
    ctx,
    "→",
    420,
    216,
    "rgba(255,255,255,0.85)",
    "rgba(80,200,255,0.35)",
    16,
  );

  drawPill(ctx, 458, 190, 180, 34, 999, newTierObj.name, {
    fill: "rgba(255,255,255,0.06)",
    stroke: "rgba(255,255,255,0.12)",
    glow: newTierObj.glow,
    textColor: "rgba(255,255,255,0.92)",
    font: "bold 14px Sans",
  });

  ctx.font = "bold 20px Sans";
  ctx.fillStyle = "rgba(255,255,255,0.88)";
  ctx.fillText(`New ELO: ${newElo}`, 240, 270);

  return canvas.toBuffer("image/png");
}

module.exports = { renderRankChangeCard };
