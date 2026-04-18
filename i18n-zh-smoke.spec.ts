import { test, expect, Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE_URL = "http://127.0.0.1:1420";
const OUT_DIR = path.join(__dirname, "artifacts");
fs.mkdirSync(OUT_DIR, { recursive: true });

// Stub the Tauri invoke channel so settings persistence & save-listing don't throw.
// Uses sessionStorage so settings persist across page.goto() reloads.
const TAURI_STUB = `
  const STORE_KEY = '__test_settings__';
  window.__TAURI_INTERNALS__ = {
    transformCallback: (cb) => { const id = Math.random(); window[id] = cb; return id; },
    invoke: async (cmd, args) => {
      if (cmd === 'get_settings') {
        try { return JSON.parse(sessionStorage.getItem(STORE_KEY) || '{}'); }
        catch { return {}; }
      }
      if (cmd === 'save_settings') {
        sessionStorage.setItem(STORE_KEY, JSON.stringify(args?.settings ?? {}));
        return null;
      }
      if (cmd === 'list_saves' || cmd === 'list_world_databases' || cmd === 'scan_world_databases') return [];
      return null;
    },
    ipc: { postMessage: () => {} },
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
  };
`;

async function installTauriStub(page: Page) {
  await page.addInitScript(TAURI_STUB);
}

async function getFontInfo(page: Page, selector: string) {
  return await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = window.getComputedStyle(el);
    const range = document.createRange();
    range.selectNodeContents(el);
    const rect = range.getBoundingClientRect();
    return {
      text: el.textContent?.trim().slice(0, 40),
      fontFamily: cs.fontFamily,
      fontSize: cs.fontSize,
      boxWidth: rect.width,
      boxHeight: rect.height,
    };
  }, selector);
}

async function detectMissingKeys(page: Page) {
  // Scan visible text for i18n-key-shaped strings (no Chinese, dotted path like "menu.newGame")
  return await page.evaluate(() => {
    const suspect: Array<{ text: string; selector: string }> = [];
    const re = /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9_]+)+$/;
    const cjkRe = /[\u4e00-\u9fff]/;
    const walk = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const t = node.textContent?.trim() || "";
        if (t.length >= 3 && re.test(t) && !cjkRe.test(t)) {
          let el = node.parentElement;
          let path = "";
          while (el && path.length < 120) {
            path =
              el.tagName.toLowerCase() +
              (el.id ? "#" + el.id : "") +
              (el.className && typeof el.className === "string"
                ? "." + el.className.split(" ").filter(Boolean).slice(0, 2).join(".")
                : "") +
              (path ? " > " + path : "");
            el = el.parentElement;
          }
          suspect.push({ text: t, selector: path });
        }
      }
      node.childNodes.forEach(walk);
    };
    walk(document.body);
    return suspect;
  });
}

async function dumpVisibleText(page: Page) {
  return await page.evaluate(() => {
    const texts: string[] = [];
    document.querySelectorAll("button, h1, h2, h3, label, a, span, li").forEach((el) => {
      const t = (el as HTMLElement).innerText?.trim();
      if (t && t.length > 0 && t.length < 80) texts.push(t);
    });
    return Array.from(new Set(texts)).slice(0, 100);
  });
}

test.describe("Simplified Chinese UI smoke", () => {
  test("switches to zh-CN and renders main menu + settings correctly", async ({ page }) => {
    await installTauriStub(page);
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    // 1. Main menu in English (default)
    await page.goto(BASE_URL + "/");
    await page.waitForLoadState("networkidle");
    await page.screenshot({
      path: path.join(OUT_DIR, "01-menu-en.png"),
      fullPage: true,
    });
    const enMenuTexts = await dumpVisibleText(page);
    fs.writeFileSync(
      path.join(OUT_DIR, "01-menu-en.txt"),
      enMenuTexts.join("\n"),
      "utf8",
    );

    // 2. Go to settings
    await page.goto(BASE_URL + "/settings");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(300);
    await page.screenshot({
      path: path.join(OUT_DIR, "02-settings-en.png"),
      fullPage: true,
    });

    // 3. Switch language to zh-CN (custom combobox component, not native <select>)
    // Find the combobox that currently shows "English" — that's the Language dropdown
    const languageCombobox = page
      .getByRole("combobox")
      .filter({ hasText: /^English$/ })
      .first();
    await expect(languageCombobox).toBeVisible();
    await languageCombobox.click();
    await page.waitForTimeout(200);
    // Now options appear as role="option". Click the one with "简体中文" text.
    await page.getByRole("option", { name: "简体中文" }).click();
    await page.waitForTimeout(500);
    await page.screenshot({
      path: path.join(OUT_DIR, "03-settings-zhCN.png"),
      fullPage: true,
    });
    const zhSettingsTexts = await dumpVisibleText(page);
    fs.writeFileSync(
      path.join(OUT_DIR, "03-settings-zhCN.txt"),
      zhSettingsTexts.join("\n"),
      "utf8",
    );

    // 4. Back to main menu — should now be Chinese
    await page.goto(BASE_URL + "/");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(300);
    await page.screenshot({
      path: path.join(OUT_DIR, "04-menu-zhCN.png"),
      fullPage: true,
    });
    const zhMenuTexts = await dumpVisibleText(page);
    fs.writeFileSync(
      path.join(OUT_DIR, "04-menu-zhCN.txt"),
      zhMenuTexts.join("\n"),
      "utf8",
    );

    // ASSERT: main menu has Chinese
    expect(zhMenuTexts.some((t) => /[\u4e00-\u9fff]/.test(t))).toBe(true);
    // ASSERT: main menu contains key phrases
    const joined = zhMenuTexts.join("|");
    expect(joined).toMatch(/新游戏|设置|退出游戏/);

    // 5. Try the other pages (will likely be empty/error without full Tauri backend,
    // but we still capture what renders)
    for (const route of ["/select-team", "/dashboard", "/match"]) {
      await page.goto(BASE_URL + route);
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(500);
      const name = route.replace(/\//g, "_").replace(/^_/, "");
      await page.screenshot({
        path: path.join(OUT_DIR, `05-${name}-zhCN.png`),
        fullPage: true,
      });
      fs.writeFileSync(
        path.join(OUT_DIR, `05-${name}-zhCN.txt`),
        (await dumpVisibleText(page)).join("\n"),
        "utf8",
      );
    }

    // 6. Missing-key scan across main menu and settings (which we know render)
    const missingKeys: Array<{ page: string; items: any[] }> = [];
    for (const route of ["/", "/settings"]) {
      await page.goto(BASE_URL + route);
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(300);
      const items = await detectMissingKeys(page);
      missingKeys.push({ page: route, items });
    }
    fs.writeFileSync(
      path.join(OUT_DIR, "missing-keys.json"),
      JSON.stringify(missingKeys, null, 2),
      "utf8",
    );
    for (const { page: r, items } of missingKeys) {
      expect(
        items.length,
        `Page ${r} should have no i18n-key-shaped raw strings, found: ${JSON.stringify(items).slice(0, 500)}`,
      ).toBe(0);
    }

    // 7. Font verification: pick the first visible Chinese text and report font info
    await page.goto(BASE_URL + "/");
    await page.waitForLoadState("networkidle");
    const fontInfo = await page.evaluate(() => {
      const cjkRe = /[\u4e00-\u9fff]/;
      const allEls = Array.from(document.querySelectorAll("button, h1, h2, h3, span, label, a, li"));
      for (const el of allEls) {
        const t = (el as HTMLElement).innerText;
        if (cjkRe.test(t || "")) {
          const cs = window.getComputedStyle(el);
          const r = (el as HTMLElement).getBoundingClientRect();
          return {
            sample: t.slice(0, 30),
            fontFamily: cs.fontFamily,
            fontSize: cs.fontSize,
            width: r.width,
            height: r.height,
            tag: el.tagName,
          };
        }
      }
      return null;
    });
    fs.writeFileSync(
      path.join(OUT_DIR, "font-info.json"),
      JSON.stringify(fontInfo, null, 2),
      "utf8",
    );
    expect(fontInfo, "Should find at least one Chinese text element").not.toBeNull();
    // Width must be > 0 — tofu boxes would still have width, but zero width would mean no render at all
    expect(fontInfo!.width).toBeGreaterThan(0);
    expect(fontInfo!.height).toBeGreaterThan(0);

    fs.writeFileSync(
      path.join(OUT_DIR, "console-errors.txt"),
      consoleErrors.join("\n"),
      "utf8",
    );
  });
});
