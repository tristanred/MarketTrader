# Logo assets

Source files for the MarketTrader brand. The mark is a stylized candlestick monogram — green up-candle on the left, red down-candle on the right, joined by a cyan crosshair. It nods to the trading desk and reads cleanly at any size.

## Files

| File | Purpose |
|---|---|
| `mark.svg` | The standalone candlestick mark. Used at `packages/frontend/public/favicon.svg` (browser favicon) and inlined by `packages/frontend/src/components/BrandMark.tsx` for the app topbar. No text inside, so it renders pixel-perfect on GitHub. |
| `src/hero.html` | Source for the README hero image (`docs/screenshots/hero.png`). Renders the mark + `MARKET · TRADER` wordmark + tagline + live-data column on a 1280 × 360 canvas using Geist Mono. |
| `src/explorations.html` | The original three-variant exploration page that produced the chosen direction (variant A). Kept for future iteration. |

## Regenerating the README hero

The hero is a PNG (not an SVG) on purpose — GitHub strips font definitions from inline SVGs, which would degrade the distinctive Geist Mono wordmark to a system fallback.

```bash
# Start the dev server so the hero source can load fonts from the CDN.
pnpm dev

# In another shell, copy the source into the vite public dir and screenshot it.
cp tools/logo-assets/src/hero.html packages/frontend/public/__hero.html

# Capture at 1280x360 using whatever headless browser you have. With Playwright:
pnpm --filter @markettrader/frontend exec node -e "
  const { chromium } = require('@playwright/test');
  (async () => {
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 360 } });
    const page = await ctx.newPage();
    await page.goto('http://localhost:5173/__hero.html');
    await page.waitForFunction(() => document.fonts.ready);
    await page.locator('#hero').screenshot({ path: 'docs/screenshots/hero.png' });
    await browser.close();
  })();
"

# Clean up the public scaffold.
rm packages/frontend/public/__hero.html
```

## Regenerating the favicon / apple-touch icon

```bash
# favicon.svg — just copy the source mark.
cp tools/logo-assets/mark.svg packages/frontend/public/favicon.svg

# apple-touch-icon.png — open mark.svg in a browser at 180x180 and save the
# rendered image, or use ImageMagick / rsvg-convert:
rsvg-convert -w 180 -h 180 tools/logo-assets/mark.svg \
  -o packages/frontend/public/apple-touch-icon.png
```

## Iterating on the mark

If you want a new direction, edit `src/explorations.html` to add variants, drop it into `packages/frontend/public/`, and view it at `http://localhost:5173/<filename>` while the dev server runs.

## Color tokens

The mark hard-codes its colors so it renders correctly outside CSS-variable contexts (favicons, README on GitHub, OG cards). If the in-app rarity palette changes, update both `mark.svg` and `BrandMark.tsx` to match.

| Element | Color | Token |
|---|---|---|
| Frame fill | `#0c0d10` | `--panel` |
| Frame stroke | `#1d1f23` | `--hairline-strong` |
| Gridlines | `#161719` | `--hairline` |
| Up candle | `#10b981` | `--gain` |
| Down candle | `#ef4444` | `--loss` |
| Crosshair connector | `#67e8f9` | `--accent` |
