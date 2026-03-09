const { createCanvas, loadImage } = require("@napi-rs/canvas");
const path = require("path");
const fs = require("fs");
const {
  drawBackground,
  drawNoise,
  glowText,
  fillRoundedRect,
  strokeRoundedRect,
  drawPill,
} = require("./ui_fx");

const logoPath = path.join(__dirname, "assets", "sod_ranked_logo.png");
const logoBuffer = fs.readFileSync(logoPath);

async function renderQueueStatusCard({
  queuedCount,
  avgElo,
  estimateText,
  updatedAt,
}) {
  const width = 1100;
  const height = 360;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  drawBackground(ctx, width, height);
  drawNoise(ctx, width, height, 0.05);

  const pad = 34;
  fillRoundedRect(
    ctx,
    pad,
    pad,
    width - pad * 2,
    height - pad * 2,
    26,
    "rgba(255,255,255,0.045)",
  );
  strokeRoundedRect(
    ctx,
    pad,
    pad,
    width - pad * 2,
    height - pad * 2,
    26,
    "rgba(80,200,255,0.28)",
    2,
    "rgba(80,200,255,0.50)",
    18,
  );

  try {
    const logo = await loadImage(logoBuffer);
    ctx.save();
    ctx.globalAlpha = 0.06;
    ctx.globalCompositeOperation = "screen";
    const wmW = (width - pad * 2) * 0.78;
    const aspect = logo.height / logo.width;
    ctx.drawImage(
      logo,
      pad + (width - pad * 2 - wmW) / 2,
      pad + 40,
      wmW,
      wmW * aspect,
    );
    ctx.restore();
  } catch {}

  glowText(
    ctx,
    "QUEUE STATUS",
    pad + 28,
    pad + 66,
    "rgba(255,255,255,0.92)",
    "rgba(80,200,255,0.55)",
    18,
  );

  ctx.font = "16px Sans";
  ctx.fillStyle = "rgba(255,255,255,0.62)";
  ctx.fillText(`Updated: ${updatedAt}`, pad + 28, pad + 92);

  drawPill(
    ctx,
    pad + 28,
    pad + 122,
    220,
    36,
    999,
    `🎧 In Queue: ${queuedCount}`,
    {
      fill: "rgba(255,255,255,0.06)",
      stroke: "rgba(255,255,255,0.12)",
      glow: "rgba(80,200,255,0.45)",
      textColor: "rgba(255,255,255,0.92)",
      font: "bold 14px Sans",
    },
  );

  drawPill(ctx, pad + 268, pad + 122, 220, 36, 999, `📈 Avg ELO: ${avgElo}`, {
    fill: "rgba(255,255,255,0.06)",
    stroke: "rgba(255,255,255,0.12)",
    glow: "rgba(80,200,255,0.45)",
    textColor: "rgba(255,255,255,0.92)",
    font: "bold 14px Sans",
  });

  drawPill(ctx, pad + 508, pad + 122, 520, 36, 999, `⏱ ${estimateText}`, {
    fill: "rgba(255,255,255,0.06)",
    stroke: "rgba(255,255,255,0.12)",
    glow: "rgba(120,220,255,0.45)",
    textColor: "rgba(255,255,255,0.92)",
    font: "bold 14px Sans",
  });

  ctx.font = "14px Sans";
  ctx.fillStyle = "rgba(255,255,255,0.55)";

  return canvas.toBuffer("image/png");
}

module.exports = { renderQueueStatusCard };
