import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = join(root, "public");
const CHROME = process.env.CHROME_PATH || "/usr/bin/google-chrome-stable";
const PORT = 8891;
const MAX_MEAN = 0.08;
const MAX_BRIGHT_SHARE = 0.02;
const BRIGHT = 0.1;

async function withServer(fn) {
  const server = spawn("python3", ["-m", "http.server", String(PORT), "--directory", publicDir], {
    stdio: "ignore",
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 400));
    await fn();
  } finally {
    server.kill();
  }
}

test("hero canvas stays dark behind the lede at 390 and 1440", async () => {
  const require = createRequire(import.meta.url);
  let puppeteer;
  try {
    puppeteer = require("puppeteer-core");
  } catch {
    assert.fail("puppeteer-core is required for the hero contrast check");
  }
  await withServer(async () => {
    const browser = await puppeteer.launch({
      executablePath: CHROME,
      headless: "new",
      args: ["--no-sandbox", "--disable-gpu", "--hide-scrollbars"],
    });
    try {
      for (const width of [390, 1440]) {
        const page = await browser.newPage();
        await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
        await page.setViewport({ width, height: 900, deviceScaleFactor: 1 });
        await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle0", timeout: 20000 });
        await page.waitForSelector("#mycelium");
        await page.waitForSelector(".lede");
        await new Promise((resolve) => setTimeout(resolve, 200));
        const stats = await page.evaluate((bright) => {
          const canvas = document.querySelector("#mycelium");
          const lede = document.querySelector(".lede");
          const cbox = canvas.getBoundingClientRect();
          const lbox = lede.getBoundingClientRect();
          const ctx = canvas.getContext("2d");
          const sx = canvas.width / cbox.width;
          const sy = canvas.height / cbox.height;
          const x = Math.max(0, Math.floor((lbox.left - cbox.left) * sx));
          const y = Math.max(0, Math.floor((lbox.top - cbox.top) * sy));
          const w = Math.max(1, Math.floor(lbox.width * sx));
          const h = Math.max(1, Math.floor(lbox.height * sy));
          const data = ctx.getImageData(x, y, Math.min(w, canvas.width - x), Math.min(h, canvas.height - y)).data;
          let sum = 0;
          let brightCount = 0;
          const lin = (c) => {
            const n = c / 255;
            return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
          };
          const pixels = data.length / 4;
          for (let i = 0; i < data.length; i += 4) {
            const luma = 0.2126 * lin(data[i]) + 0.7152 * lin(data[i + 1]) + 0.0722 * lin(data[i + 2]);
            sum += luma;
            if (luma > bright) brightCount += 1;
          }
          return { mean: sum / pixels, brightShare: brightCount / pixels, pixels };
        }, BRIGHT);
        assert.ok(stats.pixels > 50, `no canvas samples at ${width}`);
        assert.ok(stats.mean <= MAX_MEAN, `${width}px mean luma ${stats.mean.toFixed(3)} > ${MAX_MEAN}`);
        assert.ok(
          stats.brightShare <= MAX_BRIGHT_SHARE,
          `${width}px bright share ${(stats.brightShare * 100).toFixed(1)}% > ${MAX_BRIGHT_SHARE * 100}%`
        );
        await page.close();
      }
    } finally {
      await browser.close();
    }
  });
});
