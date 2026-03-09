const { createCanvas } = require("@napi-rs/canvas");

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fillRoundedRect(ctx, x, y, w, h, r, fillStyle) {
  ctx.save();
  roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = fillStyle;
  ctx.fill();
  ctx.restore();
}

function strokeRoundedRect(
  ctx,
  x,
  y,
  w,
  h,
  r,
  strokeStyle,
  lineWidth = 2,
  glow = null,
  blur = 16,
) {
  ctx.save();
  roundRect(ctx, x, y, w, h, r);
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = lineWidth;
  if (glow) {
    ctx.shadowColor = glow;
    ctx.shadowBlur = blur;
  }
  ctx.stroke();
  ctx.restore();
}

function drawBackground(ctx, w, h) {
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, "#05070c");
  g.addColorStop(0.55, "#070b10");
  g.addColorStop(1, "#04060a");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  const bloom = ctx.createRadialGradient(
    w * 0.25,
    h * 0.25,
    40,
    w * 0.25,
    h * 0.25,
    Math.max(w, h) * 0.7,
  );
  bloom.addColorStop(0, "rgba(80,200,255,0.12)");
  bloom.addColorStop(1, "rgba(80,200,255,0)");
  ctx.fillStyle = bloom;
  ctx.fillRect(0, 0, w, h);

  const vign = ctx.createRadialGradient(
    w / 2,
    h / 2,
    80,
    w / 2,
    h / 2,
    Math.max(w, h) * 0.75,
  );
  vign.addColorStop(0, "rgba(0,0,0,0)");
  vign.addColorStop(1, "rgba(0,0,0,0.75)");
  ctx.fillStyle = vign;
  ctx.fillRect(0, 0, w, h);
}

function drawScanlines(ctx, w, h, alpha = 0.06, step = 4) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = "#ffffff";
  for (let y = 0; y < h; y += step) ctx.fillRect(0, y, w, 1);
  ctx.restore();
}

function drawNoise(ctx, w, h, alpha = 0.05) {
  const n = createCanvas(w, h);
  const nctx = n.getContext("2d");
  const img = nctx.createImageData(w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.floor(Math.random() * 255);
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  nctx.putImageData(img, 0, 0);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = "overlay";
  ctx.drawImage(n, 0, 0);
  ctx.restore();
}

function glowText(ctx, text, x, y, fill, glow, blur = 18, align = "left") {
  ctx.save();
  ctx.textAlign = align;
  ctx.shadowColor = glow;
  ctx.shadowBlur = blur;
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
  ctx.restore();
}

function drawPill(ctx, x, y, w, h, r, label, opts = {}) {
  const {
    fill = "rgba(255,255,255,0.06)",
    stroke = "rgba(255,255,255,0.10)",
    glow = null,
    textColor = "rgba(255,255,255,0.85)",
    font = "bold 14px Sans",
  } = opts;

  fillRoundedRect(ctx, x, y, w, h, r, fill);
  strokeRoundedRect(ctx, x, y, w, h, r, stroke, 1.5, glow, 14);

  ctx.save();
  ctx.font = font;
  ctx.fillStyle = textColor;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + w / 2, y + h / 2 + 0.5);
  ctx.restore();
}

module.exports = {
  roundRect,
  fillRoundedRect,
  strokeRoundedRect,
  drawBackground,

  drawNoise,
  glowText,
  drawPill,
};
