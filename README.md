# paultendo’s GenTown overhaul

Version **1.6.28**, tested against the live **GenTown 1.4 / gt5** engine on 2 October 2026.

## Install in GenTown

Open [GenTown](https://r74n.com/gentown/), choose **Settings → Add mod**, and paste:

```text
https://cdn.jsdelivr.net/gh/paultendo/gentown-mods@v1.6.28/paultendo-mod.js
```

Remove any previous paultendo URL from **Enabled mods**, then reload the page. The Chronicle will show `paultendo-mod active (v1.6.28)` after you settle a town and advance a day. Export your existing save from **Saves** before changing mods.

Use the versioned URL above. Raw GitHub URLs serve `text/plain` with `nosniff`, which browsers reject as scripts. GenTown also lowercases entered URLs, so the mixed-case GitHub Pages path `GenTown-Mods` fails. The CDN URL avoids both issues and pins the tested release. This fixes the installation problem reported in [upstream issue #19](https://github.com/R74nCom/GenTown-Mods/issues/19).

## Run locally

With Node.js 22 or newer:

```sh
npm ci
npm start
```

Open `http://localhost:4173/`. This loads the mod with the current engine snapshot. To test a late installation, open `http://localhost:4173/?vanilla` and use **Settings → Add mod** with `http://localhost:4173/paultendo-mod.js`.

The local origin has its own saves; it does not share storage with r74n.com. The development server listens on loopback and serves only game assets. It does not expose repository configuration.

## Compatibility and verification

The overhaul now reads per-planet configuration, preserves native custom map sizes, initializes save hooks before autoload, restores inactive worlds, and redraws the map when installed after the game is already running. Chronicle history is encoded for GenTown's save import format and restored with sanitized markup. Play/Pause uses one timer, pauses for decisions or hidden pages, and does not automatically confirm destructive dialogs. Runtime caches stay out of saved games.

```sh
npm run check
npm test
```

The 19 regression tests cover startup, late installation and redraw, the legacy gt3 dimension format, native customization, world travel and reload, Next Day dispatch, duplicate loading, autoplay and decisions, settings, saved Chronicle history and sanitized legacy markup, save integrity, server asset access, and three seeded 300-day simulations. Canvas calls are stubbed in these logic tests; rendering and controls are checked separately in Chrome at desktop and mobile sizes.

## Credits

[GenTown](https://r74n.com/gentown/) and the engine, styles, fonts, and icons are by **R74n**. The local snapshot retains the original engine source and credit. Its source URLs and SHA-256 hashes are recorded in [`vendor/gentown/upstream.json`](vendor/gentown/upstream.json); the [R74n Content License](vendor/gentown/LICENSE.txt) applies to those assets. `index.html` is adapted from the original game page for local loading. The paultendo overhaul is in `paultendo-mod.js` and can be installed independently.
