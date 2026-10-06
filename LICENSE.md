# Ownership and licensing

This repository contains original work by paultendo, original GenTown content by R74n, and third-party dependencies. Each retains its own ownership and applicable terms.

## paultendo’s original work

Copyright © Paul Wood (paultendo). All rights reserved, except where permission has been expressly granted.

The original code, writing and other material authored by paultendo for this overhaul belong to paultendo. This includes the original mod code in `paultendo-mod.js` and the original supporting code and documentation. Original additions to adapted files also belong to paultendo.

Building a mod for GenTown, using its interfaces, crediting its creator or distributing the mod alongside GenTown does not attribute paultendo’s original work to R74n or transfer its copyright ownership to R74n.

No open-source licence or general permission to reuse, redistribute, publish modified versions of, or commercially exploit paultendo’s original work is granted by this notice. Obtain paultendo’s written permission for those uses unless they are already permitted by applicable law, an existing licence or another express grant. Rights provided by GitHub’s terms, including viewing and forking a public repository on GitHub, are unaffected.

The published mod may be downloaded, installed and run with GenTown for personal, non-commercial play and playtesting. This permission covers paultendo’s original mod code and the additional sprite assets supplied with it. GenTown and other third-party material remain subject to their own terms.

The additional artwork in `app/sprites/` and `artwork/paultendo-sprites/` was created for this overhaul using OpenAI’s image tools. It is separate from R74n’s original icons in `icons/`. Its prompts and source records are in `artwork/paultendo-sprites/manifest.json`. The original palette renderer, asset build scripts and integration code are paultendo’s code. The R74n Content License is not presented as a licence for those new assets or that original code.

## R74n’s GenTown content

R74n owns its original GenTown content, including its engine, original styles, icons and other original upstream material. The preserved engine and supporting files are in `vendor/gentown/`. The original game icons are in `icons/`. Upstream portions of `index.html` also remain R74n’s content. Source URLs and hashes are recorded in [vendor/gentown/upstream.json](vendor/gentown/upstream.json). Distribution through GenTown does not make the independently authored noise library, normalize.css or fonts R74n’s original work. Their authors and terms are identified below.

The [R74n Content License](vendor/gentown/LICENSE.txt) is retained for that content. It is not a repository-wide licence grant for paultendo’s original work. Original upstream credits and notices must remain intact.

This notice does not amend or override the R74n Content License, including its provisions concerning mods and derivative works. It makes no claim of ownership over R74n’s material.

## Adapted files and other third-party material

`index.html` adapts R74n’s original game page. Its upstream portions retain their original ownership and applicable terms. The original additions by paultendo remain paultendo’s work.

`vendor/gentown/perlin.js` is noisejs, converted to JavaScript by Joseph Gentle from Stefan Gustavson’s implementation, with optimisations by Peter Eastman. The source header retains the original public-domain statement and credits. The matching noisejs project supplies the [ISC License](vendor/gentown/licenses/noisejs-LICENSE.txt). This is an independently authored dependency distributed with GenTown.

`vendor/gentown/normalize.css` is normalize.css 8.0.1 by Nicolas Gallagher and Jonathan Neal under the [MIT License](vendor/gentown/licenses/normalize-LICENSE.txt). The GenTown copy has comments removed but preserves its CSS rules. It is an independently authored dependency.

`vendor/gentown/fonts/VT323-Regular.ttf` is by the VT323 Project Authors, including Peter Hull, under the [SIL Open Font License 1.1](vendor/gentown/fonts/VT323-LICENSE.txt). `vendor/gentown/fonts/PublicPixel.ttf` is by GGBotNet, released under [CC0 1.0 Universal](vendor/gentown/fonts/PublicPixel-LICENSE.txt). These fonts are not original work by paultendo or R74n.

The independent utilities `better_mod_loader.mjs`, `whirl-load.js` and `world-configurator.js`, and the metadata file `mods.json`, were inherited from contributions by Whirling. `example_mod.js` was inherited from contributions by slweeb. These are separate upstream contributions, not paultendo’s original mod code. They are retained in their original locations for existing links and are not loaded by the overhaul’s default launcher.

Any copied upstream material within another file retains its original ownership and applicable terms, regardless of where it appears. Third-party dependencies retain their respective licences and notices. Their inclusion grants no rights over paultendo’s original work beyond any applicable existing terms. [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt) records the source separation.

The [provenance audit dated 6 October 2026](docs/provenance-2026-10-06.txt) records the Git history, file hashes, shared engine bridge and artwork source records behind this separation. It distinguishes independently developed additions from preserved or adapted material. The audit documents provenance and does not grant additional reuse permissions.
