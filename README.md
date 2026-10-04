# paultendo’s GenTown overhaul

A world of towns with their own needs, discoveries and beliefs. People explore, make things, trade, argue and sometimes go to war. You can lend a hand, plant an idea or stir up trouble. The consequences belong to the world.

Built on **[GenTown by R74n](https://r74n.com/gentown/)**. Version **1.6.92**, tested with the **GenTown 1.4 / gt5** engine snapshot on 4 October 2026.

## Install

Export your existing save from **Saves** first. In GenTown, choose **Settings → Add mod** and paste:

```text
https://cdn.jsdelivr.net/gh/paultendo/gentown-mods@v1.6.92/paultendo-mod.js
```

Reload after adding it. This replaces older paultendo mod URLs automatically. The Chronicle shows `paultendo-mod active (v1.6.92)` after settling a town and advancing a day. Use the versioned CDN URL. Raw GitHub script URLs and the mixed-case GitHub Pages path do not install reliably through GenTown’s loader. Avoid combining this with other large overhaul mods.

This addresses the installation issue reported in [GenTown-Mods #19](https://github.com/R74nCom/GenTown-Mods/issues/19).

## Find your way

- **Start a town** on habitable ground. Advance a day at a time while getting to know it.
- **Follow Today’s news** for recent changes. Open a headline for the full story. The Chronicle keeps the history and actual choices.
- **Answer the choices you care about.** Yes, No and Act belong to live entries. Old proposals fade into the record. Next Day follows GenTown’s normal lapse and fallback behaviour, which varies by event. It is not always a Yes or a No. Autoplay pauses for an unanswered live choice by default. **Review decision** takes you to it, even from another panel.
- **Visit a town** to meet its people, inspect materials and follow **Work and inventions**. A current job shows what holds it up, who is doing it and where its supplies came from. Looking at work never advances it.
- **Explore through actual journeys.** Newly found places and useful samples can lead to later work, trade and settlement. Unknown ground stays hidden.
- **Visit the Council** once communities have reasons to deal with one another. Check the proposed obligations before speaking for or against an agreement. The towns retain their own opinions and decide after the talks.
- **Meet the Traveler** when you want to influence someone directly. An object or a whispered idea can meet curiosity, resistance or a different purpose. People also act without you.
- **Watch the discoveries.** Later systems appear when they have a place in the world. Astronomy precedes rockets, and rockets precede the preparation needed to settle another planet.

You do not have to manage every project. Short replies, journeys, workshop work and slower changes of custom have different rhythms. Hunger, available hands, knowledge, routes and competing needs can delay them. A scarce material might be wanted for a building, a tool or someone’s experiment. Trade can carry a method as well as goods. A helpful gift can earn trust, while taking a neighbour’s supplies leaves a grievance.

Objects keep their makers and histories. A rare object finished during war can gain a meaning its maker never intended. Player-named work can travel through the Traveler’s later passages, carrying the story of where it came from.

## This finishing pass

Towns now grow within the room their land, local building methods and maintained buildings provide. Recent meals matter. Hunger slows growth, and famine follows sustained missed meals. A food delivery helps, but people need to eat regularly before recovery is recorded.

Migrants carry actual inhabitants, occupations, supplies and their share of private wealth. A crowded destination can limit a voluntary move. A conquered town's people still transfer with it. Occupations cannot appear without an available inhabitant. Events that report their own consequences now happen without an invisible unanswered question.

An unfinished instrument can send the workshop looking for glass, and glass can create demand for fuel. A maker waiting for missing supplies can do other work. Repeated orders share the workshop with other unmet needs, so farm tools cannot keep a crew's boat waiting forever. Ingredients still take knowledge, materials and time. Route caches rebuild from the map instead of filling saved games with copied tiles.

Research, workshop batches, personal inventions and sample journeys share one work overview. Active work comes first, with smaller, muted status text and folded older histories. Council talks retain the actual obligations, votes and outcomes. Story links work with a keyboard, and pending decisions are easier to reach on phones.

## Playtesting

Try a new town as well as an existing save. Follow one shortage through its work, exchanges and eventual result. Speak for or against a council proposal, then return when the talks end. Reload while something is underway and check that its progress, map and history survive.

Useful feedback includes the mod version, day, what you expected, what happened and an exported save where possible. Quiet stretches, repeated interruptions and advances that arrive too easily matter as much as crashes. Longer campaign balance still needs human playtesting.

The towns use representative people and occupations. They do not simulate every inhabitant as an individual. New advanced discoveries are local, but some original GenTown technologies still have shared legacy behaviour. The [implementation notes](docs/mod-notes.txt) retain the detailed mechanics, compatibility work and remaining limits.

## Run locally

With Node.js 22 or newer:

```sh
npm ci
npm start
```

Open `http://localhost:4173/`. To test a late installation, open `http://localhost:4173/?vanilla` and add `http://localhost:4173/paultendo-mod.js` through Settings. Local saves are separate from r74n.com. The development server listens on loopback and serves only game assets.

Run `npm run check` and `npm test` for the automated checks. These verify behaviour and conservation. They do not establish that a whole campaign feels balanced.

To run a campaign without waiting through the front end:

```sh
npm run simulate -- --days 1000 --seeds 7,42,123 --policies yes,mixed,skip
```

The runner uses actual game turns and decisions. It writes campaign reports, a timeline and importable world saves to an isolated output directory. Reports track discoveries, population, shortages, unfinished work and events without usable controls. Continue an exported save with `--save /path/to/world.planet`. The [campaign harness guide](docs/campaign-harness.txt) explains the policies, checks and reproduction limits.

## Credits

**R74n created GenTown**, including its engine, styles, fonts and icons. Its framework made this mod possible. The local snapshot retains the original source and credit. Source URLs and SHA-256 hashes are recorded in [vendor/gentown/upstream.json](vendor/gentown/upstream.json). The [R74n Content License](vendor/gentown/LICENSE.txt) applies to those assets. `index.html` adapts the original game page for local loading. The paultendo overhaul lives in `paultendo-mod.js` and can be installed independently.
