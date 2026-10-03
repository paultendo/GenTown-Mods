# paultendo’s GenTown overhaul

Version **1.6.38**, tested against the live **GenTown 1.4 / gt5** engine on 3 October 2026.

## Install in GenTown

Open [GenTown](https://r74n.com/gentown/), choose **Settings → Add mod**, and paste:

```text
https://cdn.jsdelivr.net/gh/paultendo/gentown-mods@v1.6.38/paultendo-mod.js
```

Reload the page after adding the URL. The new installation replaces previous paultendo URLs automatically, including when an older startup script tries to restore its own URL. The Chronicle will show `paultendo-mod active (v1.6.38)` after you settle a town and advance a day. Export your existing save from **Saves** before changing mods.

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

Discovery and road overlays preserve the painted terrain when added, including after reload and daily road updates. Background reports are dated, collapsed, and exclude decisions and routine sunsets. Unlocks clears its notification when opened and offers discovery stories and gameplay effects. Advanced menus appear as their discoveries become available. Unnamed species identify themselves as plants or animals, informational entries use an Info label, and Review decision takes you to a pending choice.

Town descriptions now begin with life in the settlement: its working population, food stores, research and construction. Discovery pages include short stories and facts about the player's towns. Farming towns have striped fields on the map, drawn only in visible territory or terrain views. Choices gain optional consequence previews and a saved town history. First adoption of new work and completed construction receive Chronicle follow-ups based on actual jobs and project landmarks. First harvests and livestock are recorded from actual farming and taming, with their original dates retained through reload. Discovery pages collect these town moments and describe their effects in words, with the numbers available on request. Town landmarks and known trade neighbours can be visited from the settlement view. Unlocks now includes all 41 later advances from the overhaul, grouped by branch. Each has a story, verified effects, town activity and the actual missing prerequisites for the next advance. The list counts discoveries, and procedural methods and schools sit behind Local tradition. These display changes preserve the native random unlock tree and the mod’s existing event eligibility. Existing saves keep their current activity without invented past choices or discovery dates. Phone controls and discovery navigation are also corrected.

Town choice history now opens into connected stories. Discovery adoption and first harvests sit beneath the choice that enabled them, with links back to the discovery or completed landmark. Each chapter keeps the original proposal and response, then shows current law, research, healthcare or diplomatic conditions separately. Advice that fails to take hold is remembered as such. Legacy histories retain their unknown consequences. [The Traveler roadmap](TRAVELER_ROADMAP.md) records the direction for exploration, individual reception and emergent local stories.

Species pages now open with field notes about their habitat and traits. Naming prompts describe what was found. New encounters retain their town and date, and actual improvements in cultivation or breeding and adoption as a town animal become part of the species history. The settlement links to its encountered and used species, and species pages lead back to known towns. Unknown and hidden towns stay out of these notes. Existing species retain their current traits and town roles without invented encounter dates or species-specific harvest quantities. The season indicator also advances with the day.

Meet the people in a known settlement to whisper through a worker or an established figure. Their outlook, trust, values and current pressures shape their response after two days. Advice can become lessons, drills, care, a real food gift along a trade route or an expedition that reveals terrain. Darker words can stir dissent, be twisted into tighter control, sour relations with a reachable neighbour or push tension into the existing war system. These interventions carry costs and can be refused. The world keeps moving while words settle, and pending whispers and their actual responses survive reloads. Each person and the town history link back to what was said and what they did. Names use a private random stream, so merely meeting someone does not change the simulation’s next roll.

Live decisions have a warm highlight and working buttons. Unanswered entries recede into the Chronicle without explanatory text. Advancing the day preserves GenTown's rules: most proposals lapse, while some events have a fallback, such as generating a discovery name. Autoplay pauses for decisions unless Auto-decide is enabled. GenTown does not save pending event callbacks across a reload.

```sh
npm run check
npm test
```

The 69 regression tests cover startup, late installation and redraw, overlay creation, asynchronous saved-mod restoration, the legacy gt3 dimension format, native customization, world travel and reload, Next Day dispatch, duplicate loading and URL replacement, background reports, unlock details and notifications, discovery menus, species naming, mod management, autoplay and decisions, settlement activity and lore, choice provenance, species encounters and local uses, individual whispers and their reception, actual food transfers and exploration, unrest and war pressure, adoption and construction follow-ups, fields and visibility, settings, saved Chronicle history and sanitized legacy markup, save integrity, server asset access, and three seeded 300-day simulations. Canvas calls are stubbed in these logic tests; rendering and controls are checked separately in Chrome at desktop and mobile sizes.

## Credits

[GenTown](https://r74n.com/gentown/) and the engine, styles, fonts, and icons are by **R74n**. The local snapshot retains the original engine source and credit. Its source URLs and SHA-256 hashes are recorded in [`vendor/gentown/upstream.json`](vendor/gentown/upstream.json); the [R74n Content License](vendor/gentown/LICENSE.txt) applies to those assets. `index.html` is adapted from the original game page for local loading. The paultendo overhaul is in `paultendo-mod.js` and can be installed independently.
