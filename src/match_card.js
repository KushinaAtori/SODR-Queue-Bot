const { createCanvas, loadImage, GlobalFonts } = require("@napi-rs/canvas");
const path = require("path");
const fs = require("fs");

const { drawBackground, drawNoise, glowText, drawPill } = require("./ui_fx");

const fetchFn =
  global.fetch ??
  ((...args) => import("node-fetch").then(({ default: f }) => f(...args)));

const logoPath = path.join(__dirname, "assets", "sod_ranked_logo.png");
const logoBuffer = fs.readFileSync(logoPath);

try {
  const fontsDir = path.join(__dirname, "assets", "fonts");
  const interReg = path.join(fontsDir, "Inter-Regular.ttf");
  const interBold = path.join(fontsDir, "Inter-Bold.ttf");
  const orbitronBold = path.join(fontsDir, "Orbitron-Bold.ttf");

  if (fs.existsSync(interReg)) GlobalFonts.registerFromPath(interReg, "Inter");
  if (fs.existsSync(interBold))
    GlobalFonts.registerFromPath(interBold, "Inter");
  if (fs.existsSync(orbitronBold))
    GlobalFonts.registerFromPath(orbitronBold, "Orbitron");
} catch {}

const FONT_TITLE = fs.existsSync(
  path.join(__dirname, "assets", "fonts", "Orbitron-Bold.ttf"),
)
  ? "Orbitron"
  : "Sans";
const FONT_BODY = fs.existsSync(
  path.join(__dirname, "assets", "fonts", "Inter-Regular.ttf"),
)
  ? "Inter"
  : "Sans";

async function fetchImage(url) {
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`Failed to fetch image: ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return loadImage(buf);
}

function truncate(str, max = 16) {
  if (!str) return "";
  return str.length > max ? str.slice(0, max - 1) + "…" : str;
}

function safeDeltaString(delta) {
  if (typeof delta !== "number") return "";
  return `${delta >= 0 ? "▲" : "▼"} ${Math.abs(delta)}`;
}

async function renderMatchResultsCard({
  matchNumber,
  players,
  winnerId,
  winnerStreakText,
}) {
  const width = 1100;
  const height = 560;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  drawBackground(ctx, width, height);

  const outerPad = 34;
  const headerH = 86;

  ctx.save();
  ctx.beginPath();

  const hx = outerPad;
  const hy = outerPad;
  const hw = width - outerPad * 2;
  const hh = headerH;
  const hr = 22;
  ctx.moveTo(hx + hr, hy);
  ctx.arcTo(hx + hw, hy, hx + hw, hy + hh, hr);
  ctx.arcTo(hx + hw, hy + hh, hx, hy + hh, hr);
  ctx.arcTo(hx, hy + hh, hx, hy, hr);
  ctx.arcTo(hx, hy, hx + hw, hy, hr);
  ctx.closePath();
  ctx.fillStyle = "rgba(255,255,255,0.055)";
  ctx.fill();
  ctx.strokeStyle = "rgba(80,200,255,0.26)";
  ctx.lineWidth = 2;
  ctx.shadowColor = "rgba(80,200,255,0.55)";
  ctx.shadowBlur = 18;
  ctx.stroke();
  ctx.restore();

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  ctx.font = `bold 30px ${FONT_TITLE}`;
  glowText(
    ctx,
    `MATCH #${matchNumber}`,
    outerPad + 22,
    outerPad + 52,
    "rgba(255,255,255,0.93)",
    "rgba(80,200,255,0.45)",
    16,
    "left",
  );

  ctx.font = `bold 22px ${FONT_BODY}`;
  ctx.fillStyle = "rgba(255,255,255,0.86)";
  ctx.fillText("— FFA RESULTS", outerPad + 265, outerPad + 52);

  ctx.font = `14px ${FONT_BODY}`;
  ctx.fillStyle = "rgba(255,255,255,0.62)";
  ctx.fillText("Shoot or Die Ranked", outerPad + 24, outerPad + 74);

  const panelX = outerPad;
  const panelY = outerPad + headerH + 18;
  const panelW = width - outerPad * 2;
  const panelH = height - panelY - outerPad;

  ctx.save();
  ctx.beginPath();
  const pr = 24;
  ctx.moveTo(panelX + pr, panelY);
  ctx.arcTo(panelX + panelW, panelY, panelX + panelW, panelY + panelH, pr);
  ctx.arcTo(panelX + panelW, panelY + panelH, panelX, panelY + panelH, pr);
  ctx.arcTo(panelX, panelY + panelH, panelX, panelY, pr);
  ctx.arcTo(panelX, panelY, panelX + panelW, panelY, pr);
  ctx.closePath();
  ctx.fillStyle = "rgba(255,255,255,0.04)";
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  try {
    const logoImg = await loadImage(logoBuffer);
    ctx.save();
    ctx.globalAlpha = 0.06;
    ctx.globalCompositeOperation = "screen";
    const wmW = panelW * 0.9;
    const aspect = logoImg.height / logoImg.width;
    const wmH = wmW * aspect;
    const x = panelX + (panelW - wmW) / 2;
    const y = panelY + (panelH - wmH) / 2;
    ctx.drawImage(logoImg, x, y, wmW, wmH);
    ctx.restore();
  } catch {}

  drawNoise(ctx, width, height, 0.05);

  const shown = (players ?? []).slice(0, 10);
  const n = shown.length;

  const cols = n <= 5 ? Math.max(1, n) : 5;
  const rows = n <= 5 ? 1 : 2;

  const panelPad = 26;
  const colGap = 54;
  const rowGap = 42;

  const avatarSize = 92;
  const radius = avatarSize / 2;
  const ringWidth = 9;

  const contentX = panelX + panelPad;
  const contentY = panelY + panelPad;
  const contentW = panelW - panelPad * 2;

  const totalColGaps = colGap * Math.max(0, cols - 1);
  const cellW = (contentW - totalColGaps) / cols;

  const rowW = cols * cellW + totalColGaps;
  const startX = contentX + (contentW - rowW) / 2;
  const startY = contentY + 8;

  const images = await Promise.all(
    shown.map(async (p) => {
      try {
        return await fetchImage(p.avatarUrl);
      } catch {
        return null;
      }
    }),
  );

  for (let i = 0; i < shown.length; i++) {
    const p = shown[i];

    const effectiveCols = rows === 1 ? cols : 5;
    const xIndex = i % effectiveCols;
    const yIndex = Math.floor(i / effectiveCols);

    const cx = startX + xIndex * (cellW + colGap) + cellW / 2;
    const cy = startY + yIndex * (avatarSize + 102 + rowGap) + radius;

    const isWinner = p.id === winnerId;
    const ring = isWinner ? "rgba(57,255,20,0.95)" : "rgba(255,59,59,0.95)";

    ctx.save();
    ctx.beginPath();
    ctx.ellipse(cx, cy + 8, radius + 6, radius + 10, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,0.42)";
    ctx.filter = "blur(8px)";
    ctx.fill();
    ctx.restore();
    ctx.filter = "none";

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius + ringWidth / 2, 0, Math.PI * 2);
    ctx.strokeStyle = ring;
    ctx.lineWidth = ringWidth;
    ctx.shadowColor = ring;
    ctx.shadowBlur = 18;
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius + 1, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.clip();

    const img = images[i];
    if (img)
      ctx.drawImage(img, cx - radius, cy - radius, avatarSize, avatarSize);
    else {
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.fillRect(cx - radius, cy - radius, avatarSize, avatarSize);
    }
    ctx.restore();

    if (isWinner) {
      drawPill(ctx, cx - 56, cy - radius - 30, 112, 26, 999, "👑 WINNER", {
        fill: "rgba(57,255,20,0.10)",
        stroke: "rgba(57,255,20,0.35)",
        glow: "rgba(57,255,20,0.55)",
        textColor: "rgba(255,255,255,0.92)",
        font: `bold 13px ${FONT_BODY}`,
      });

      if (winnerStreakText) {
        drawPill(
          ctx,
          cx - 70,
          cy - radius - 2,
          140,
          24,
          999,
          winnerStreakText,
          {
            fill: "rgba(255,255,255,0.06)",
            stroke: "rgba(255,255,255,0.12)",
            glow: "rgba(255,120,40,0.55)",
            textColor: "rgba(255,255,255,0.90)",
            font: `bold 12px ${FONT_BODY}`,
          },
        );
      }
    }

    ctx.save();
    ctx.font = `bold 18px ${FONT_BODY}`;
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.textAlign = "center";
    ctx.fillText(truncate(p.username, 16), cx, cy + radius + 34);
    ctx.restore();

    ctx.save();
    ctx.font = `bold 14px ${FONT_BODY}`;
    ctx.fillStyle = isWinner ? "rgba(57,255,20,0.92)" : "rgba(255,59,59,0.92)";
    ctx.textAlign = "center";
    ctx.fillText(isWinner ? "WIN" : "LOSS", cx, cy + radius + 56);
    ctx.restore();

    if (typeof p.elo === "number") {
      const dStr = safeDeltaString(p.delta);
      const line = dStr ? `ELO ${p.elo}   (${dStr})` : `ELO ${p.elo}`;

      ctx.save();
      ctx.font = `14px ${FONT_BODY}`;
      ctx.fillStyle = "rgba(255,255,255,0.72)";
      ctx.textAlign = "center";
      ctx.fillText(line, cx, cy + radius + 78);
      ctx.restore();
    }
  }

  ctx.save();
  ctx.font = `14px ${FONT_BODY}`;
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.textAlign = "left";
  ctx.fillText(
    "Tip: Use /profile to view your ELO graph and match history.",
    panelX + 26,
    height - outerPad + 6,
  );
  ctx.restore();

  return canvas.toBuffer("image/png");
}

module.exports = { renderMatchResultsCard };
