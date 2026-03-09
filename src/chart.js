const { ChartJSNodeCanvas } = require("chartjs-node-canvas");
const path = require("path");
const fs = require("fs");

let ImageCtor;
try {
  ({ Image: ImageCtor } = require("canvas"));
} catch {
  ({ Image: ImageCtor } = require("@napi-rs/canvas"));
}

const width = 1100;
const height = 440;

const logoPath = path.join(__dirname, "assets", "sod_ranked_logo.png");
const logoBuffer = fs.readFileSync(logoPath);

const chartJSNodeCanvas = new ChartJSNodeCanvas({
  width,
  height,
  backgroundColour: "transparent",
});

function makeFullWatermarkPlugin() {
  const img = new ImageCtor();
  img.src = logoBuffer;

  return {
    id: "sodFullWatermark",
    beforeDatasetsDraw: (chart) => {
      const { ctx, chartArea } = chart;
      if (!chartArea) return;

      const { left, top, width: w, height: h } = chartArea;

      const wmW = w * 0.92;
      const aspect = img.width ? img.height / img.width : 1;
      const wmH = wmW * aspect;

      const x = left + (w - wmW) / 2;
      const y = top + (h - wmH) / 2;

      ctx.save();
      ctx.globalAlpha = 0.055;
      ctx.globalCompositeOperation = "screen";
      ctx.drawImage(img, x, y, wmW, wmH);
      ctx.restore();
    },
  };
}

function makePremiumBackdropPlugin() {
  return {
    id: "sodPremiumBackdrop",
    beforeDraw: (chart) => {
      const { ctx, width: W, height: H } = chart;

      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, "#05070c");
      g.addColorStop(0.55, "#070b10");
      g.addColorStop(1, "#04060a");
      ctx.save();
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();

      const bloom = ctx.createRadialGradient(
        W * 0.25,
        H * 0.25,
        40,
        W * 0.25,
        H * 0.25,
        Math.max(W, H) * 0.7,
      );
      bloom.addColorStop(0, "rgba(80,200,255,0.14)");
      bloom.addColorStop(1, "rgba(80,200,255,0)");
      ctx.save();
      ctx.fillStyle = bloom;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();

      const vign = ctx.createRadialGradient(
        W / 2,
        H / 2,
        80,
        W / 2,
        H / 2,
        Math.max(W, H) * 0.78,
      );
      vign.addColorStop(0, "rgba(0,0,0,0)");
      vign.addColorStop(1, "rgba(0,0,0,0.78)");
      ctx.save();
      ctx.fillStyle = vign;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();

      ctx.save();
      ctx.globalAlpha = 0.05;
      ctx.globalCompositeOperation = "overlay";
      for (let i = 0; i < 1800; i++) {
        const x = (Math.random() * W) | 0;
        const y = (Math.random() * H) | 0;
        const a = Math.random();
        ctx.fillStyle = `rgba(255,255,255,${a})`;
        ctx.fillRect(x, y, 1, 1);
      }
      ctx.restore();
    },
  };
}

function makeNeonFramePlugin() {
  return {
    id: "sodNeonFrame",
    beforeDraw: (chart) => {
      const { ctx, chartArea } = chart;
      if (!chartArea) return;

      const pad = 10;
      const x = chartArea.left - pad;
      const y = chartArea.top - pad;
      const w = chartArea.right - chartArea.left + pad * 2;
      const h = chartArea.bottom - chartArea.top + pad * 2;

      ctx.save();
      ctx.strokeStyle = "rgba(80,200,255,0.26)";
      ctx.lineWidth = 2;
      ctx.shadowColor = "rgba(80,200,255,0.50)";
      ctx.shadowBlur = 18;
      ctx.strokeRect(x, y, w, h);
      ctx.restore();
    },
  };
}

function makeGlowTitlePlugin() {
  return {
    id: "sodGlowTitle",
    afterDraw: (chart, _args, opts) => {
      const { ctx, width: W } = chart;
      const title = opts?.title ?? "";
      if (!title) return;

      const x = 22;
      const y = 34;

      ctx.save();
      ctx.font = "bold 18px Sans";

      ctx.shadowColor = "rgba(80,200,255,0.45)";
      ctx.shadowBlur = 16;
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.fillText(title, x, y);

      if (opts?.subtitle) {
        ctx.shadowBlur = 0;
        ctx.font = "14px Sans";
        ctx.fillStyle = "rgba(255,255,255,0.62)";
        ctx.fillText(opts.subtitle, x, y + 20);
      }

      ctx.shadowBlur = 0;
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(18, 54);
      ctx.lineTo(W - 18, 54);
      ctx.stroke();

      ctx.restore();
    },
  };
}

async function renderEloChart({ labels, data, title, results }) {
  const backdropPlugin = makePremiumBackdropPlugin();
  const framePlugin = makeNeonFramePlugin();
  const watermarkPlugin = makeFullWatermarkPlugin();
  const glowTitlePlugin = makeGlowTitlePlugin();

  const configuration = {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          data,
          borderWidth: 0,
          pointRadius: 0,
          fill: true,
          tension: 0.33,
          backgroundColor: "rgba(80, 200, 255, 0.09)",
        },

        {
          data,
          fill: false,
          tension: 0.33,
          borderWidth: 10,
          pointRadius: 0,
          borderColor: "rgba(80,200,255,0.20)",
        },

        {
          data,
          fill: false,
          tension: 0.33,
          borderWidth: 4,
          pointRadius: 0,
          pointHoverRadius: 4,
          segment: {
            borderColor: (ctx) => {
              const i = ctx.p1DataIndex;
              return results?.[i] === "win"
                ? "rgba(57,255,20,0.95)"
                : "rgba(255,59,59,0.95)";
            },
          },
        },
      ],
    },
    options: {
      plugins: {
        legend: { display: false },
        title: { display: false },
        tooltip: {
          backgroundColor: "rgba(0,0,0,0.86)",
          titleColor: "#fff",
          bodyColor: "#fff",
          borderColor: "rgba(255,255,255,0.10)",
          borderWidth: 1,
          callbacks: {
            label: (ctx) => {
              if (ctx.datasetIndex !== 2) return null;
              const i = ctx.dataIndex;
              const r = results?.[i] === "win" ? "W" : "L";
              return `${r} — ELO: ${ctx.parsed.y}`;
            },
          },
        },
        sodGlowTitle: {
          title,
          subtitle: "ELO per match",
        },
      },
      layout: {
        padding: { left: 18, right: 18, top: 64, bottom: 18 },
      },
      scales: {
        x: {
          ticks: {
            color: "rgba(255,255,255,0.62)",
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 12,
          },
          grid: { color: "rgba(255,255,255,0.045)" },
          border: { color: "rgba(255,255,255,0.10)" },
        },
        y: {
          ticks: { color: "rgba(255,255,255,0.62)" },
          grid: { color: "rgba(255,255,255,0.045)" },
          border: { color: "rgba(255,255,255,0.10)" },
        },
      },
    },
    plugins: [backdropPlugin, framePlugin, watermarkPlugin, glowTitlePlugin],
  };

  return chartJSNodeCanvas.renderToBuffer(configuration, "image/png");
}

module.exports = { renderEloChart };
