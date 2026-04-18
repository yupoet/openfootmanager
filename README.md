# Test evidence — PR #139 (Simplified Chinese i18n)

This branch holds UI smoke-test artifacts for [PR #139](https://github.com/openfootmanager/openfootmanager/pull/139).
It is intentionally separate from the PR branch so the PR diff stays focused on the locale file and i18n registration.

## How it was produced

- Ran `npm run dev` (Vite, without Tauri) bound to `127.0.0.1:1420`
- Stubbed `window.__TAURI_INTERNALS__.invoke` so `get_settings` / `save_settings` persist to `sessionStorage`
- Drove the UI with Playwright (Chromium) from the English main menu → Settings → language switch to "简体中文" → back to main menu, then direct-nav to `/select-team`, `/dashboard`, `/match`

## Files

| File | What it is |
| --- | --- |
| `01-menu-en.png` | Main menu before switching (English baseline) |
| `02-settings-en.png` | Settings page before switching (English baseline) |
| `03-settings-zhCN.png` | Settings page after switching to 简体中文 |
| `04-menu-zhCN.png` | Main menu after switching (all four entries translated) |
| `05-select-team-zhCN.png` / `05-dashboard-zhCN.png` / `05-match-zhCN.png` | Fallback / redirect behaviour for pages that require a loaded save — included for completeness |
| `*.txt` | Visible text dump of each page (dedup, up to 100 items) |
| `missing-keys.json` | Scan for i18n-key-shaped strings (e.g. `menu.newGame`) that would indicate a missing translation. `[]` = no missing keys. |
| `font-info.json` | Computed `font-family` / box metrics for the first Chinese element on the main menu |
| `font-fallback-report.json` | Width / height for `新游戏` under each CJK font candidate + system-font-availability check |
| `console-errors.txt` | Chromium console errors during the run (only `/match` complains — it requires a live match snapshot) |
| `i18n-zh-smoke.spec.ts` / `font-fallback.spec.ts` / `playwright.config.ts` | The Playwright harness. Not part of the PR — drop into `tests/` locally to reproduce. |

## Reproduce locally

```sh
# from the feature branch
npm install -D @playwright/test
npx playwright install chromium
# copy i18n-zh-smoke.spec.ts + font-fallback.spec.ts into tests/
# copy playwright.config.ts to the repo root
# in one shell:
TAURI_DEV_HOST=127.0.0.1 npm run dev
# in another:
npx playwright test --reporter=list
```
