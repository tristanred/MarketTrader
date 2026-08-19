---
'@markettrader/frontend': patch
---

Make the SPA behave like a real app when installed to the iOS home screen.

The page carried an `apple-touch-icon` and nothing else, so the home-screen
launcher opened inside Safari's chrome. It now declares
`apple-mobile-web-app-capable` / `mobile-web-app-capable`, a home-screen title,
`color-scheme`, and a `manifest.webmanifest` with `display: standalone`. The
viewport gained `viewport-fit=cover`, without which every
`env(safe-area-inset-*)` reports `0px`; a `.safe-area` utility pads the shell
and the full-height pages out of the home indicator and the landscape notch.

`apple-mobile-web-app-status-bar-style` is deliberately absent: the usual
`black-translucent` forces white status-bar text, which is unreadable over the
light "Paper" theme. iOS tints the bar from `theme-color` instead, so
`themeStore` now rewrites that meta tag on every theme change — the theme is a
class the user toggles independently of the OS preference, so a
`media="(prefers-color-scheme: …)"` pair of tags cannot express it.

Touch input fixes: username and symbol-search fields no longer get
auto-capitalised or autocorrected, quantity and price fields open the numeric
keypad, and fields below 16px are floored at 16px on coarse pointers — under
that size iOS zooms the page in on focus and never zooms back out. The desktop
scale is unchanged, and pinch-zoom is left enabled.

**Two things do not ship by deploying this.** The out-of-repo reverse proxy
needs `.webmanifest` mapped to `application/manifest+json` (the container
`nginx.conf` in this repo already has it), and iOS caches the install — an
existing home-screen icon must be removed and re-added before any of this
takes effect.
