import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "artifacts");

test("CJK font fallback chain: identify which font actually renders", async ({ page }) => {
  // Minimal HTML page with the same fallback chain as src/App.css
  await page.setContent(`
    <!DOCTYPE html><html><head><style>
      body { font-family: "Inter", "Avenir", "Helvetica", "Arial",
             "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", "Source Han Sans SC", sans-serif;
             font-size: 24px; }
      span { display: inline-block; margin: 10px; }
      .sans { font-family: sans-serif; }
      .pf   { font-family: "PingFang SC", sans-serif; }
      .my   { font-family: "Microsoft YaHei", sans-serif; }
      .noto { font-family: "Noto Sans CJK SC", sans-serif; }
      .han  { font-family: "Source Han Sans SC", sans-serif; }
      .chain{ font-family: "Inter","PingFang SC","Microsoft YaHei","Noto Sans CJK SC","Source Han Sans SC",sans-serif; }
    </style></head><body>
      <span id="sans" class="sans">新游戏</span>
      <span id="pf"   class="pf">新游戏</span>
      <span id="my"   class="my">新游戏</span>
      <span id="noto" class="noto">新游戏</span>
      <span id="han"  class="han">新游戏</span>
      <span id="chain" class="chain">新游戏</span>
    </body></html>`);

  const results = await page.evaluate(() => {
    const ids = ["sans", "pf", "my", "noto", "han", "chain"];
    const out: Record<string, { width: number; height: number; fontFamily: string }> = {};
    for (const id of ids) {
      const el = document.getElementById(id)!;
      const r = el.getBoundingClientRect();
      out[id] = {
        width: r.width,
        height: r.height,
        fontFamily: getComputedStyle(el).fontFamily,
      };
    }
    return out;
  });

  // document.fonts.check() can tell us if specific fonts are available
  const availability = await page.evaluate(() => {
    const fonts = ["PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", "Source Han Sans SC"];
    const out: Record<string, boolean> = {};
    for (const f of fonts) {
      // check if font is installed system-wide
      out[f] = document.fonts.check(`16px "${f}"`);
    }
    return out;
  });

  const report = {
    boxMetrics: results,
    fontAvailability: availability,
    conclusion: {
      // The 'chain' box should render CJK (non-zero width) even if PingFang SC missing.
      chainRendersCJK: results.chain.width > 0 && results.chain.height > 0,
      // 'sans' may render tofu boxes (zero or small width) on systems lacking CJK fallback.
      sansWouldFail: results.sans.width < results.chain.width * 0.5,
    },
  };
  fs.writeFileSync(
    path.join(OUT_DIR, "font-fallback-report.json"),
    JSON.stringify(report, null, 2),
    "utf8",
  );

  // Assertions
  expect(results.chain.width).toBeGreaterThan(0);
  // At least one of the CJK fonts must be available for the chain to render well
  const anyCjkAvailable =
    availability["PingFang SC"] ||
    availability["Microsoft YaHei"] ||
    availability["Noto Sans CJK SC"] ||
    availability["Source Han Sans SC"];
  expect(anyCjkAvailable, "At least one CJK font from the fallback chain must be installed").toBe(true);
});
