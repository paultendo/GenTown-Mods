# GenTown Mod - Design Checklist and System Scores (v1.2.0)

This file captures the shared design checklist and a first-pass scoring of game systems.
Scores are 0-2 per criterion (max total 20). Update as systems evolve.

## Scoring rubric
- 0 = missing or weak
- 1 = partial or inconsistent
- 2 = strong and consistent

## Checklist criteria
1. Core Loop Fit
2. Emergence Over Script
3. Legibility
4. Agency Without Control
5. Pacing and Era Fit
6. Consequences Persist
7. Map Presence
8. Inter-System Synergy
9. Player Burden
10. Replay Variance

## System scores (first pass)
| System | Status | Loop | Emergence | Legibility | Agency | Pacing | Persistence | Map | Synergy | Burden | Replay | Total | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| World generation and terrain | Base | 1 | 2 | 2 | 0 | 2 | 2 | 2 | 1 | 2 | 2 | 16 | Strong foundation, not directly player-driven |
| Town growth and needs | Base | 2 | 2 | 1 | 1 | 2 | 2 | 1 | 2 | 1 | 2 | 16 | Clear core loop, could surface causes better |
| Discovery tiers and exploration | Mod | 2 | 2 | 1 | 1 | 2 | 2 | 2 | 2 | 1 | 2 | 17 | Good pacing, needs clearer UI on tier status |
| Fog of war and line of sight | Mod | 1 | 1 | 2 | 1 | 2 | 1 | 2 | 1 | 2 | 1 | 14 | Strong visual clarity, low agency
| Seasons | Mod | 1 | 1 | 1 | 0 | 2 | 1 | 0 | 2 | 2 | 1 | 11 | Light-touch, mostly background
| Climate effects (trade, migration, war) | Mod | 1 | 1 | 0 | 0 | 2 | 1 | 0 | 2 | 2 | 1 | 10 | Hidden influences, needs visibility hooks
| Government types and reforms | Mod | 2 | 1 | 1 | 2 | 2 | 2 | 0 | 2 | 1 | 2 | 15 | Strong agency, little map presence
| Alliances and diplomacy | Mod | 2 | 2 | 1 | 2 | 2 | 2 | 0 | 2 | 1 | 2 | 16 | Good emergence, map visibility is low
| War pressure and emergent wars | Mod | 2 | 2 | 1 | 1 | 2 | 2 | 2 | 2 | 1 | 2 | 17 | Strong emergence and map impact
| Coalition wars and territory shifts | Mod | 2 | 2 | 1 | 1 | 2 | 2 | 2 | 2 | 1 | 2 | 17 | Same strengths as wars, needs clearer front lines
| Trade routes (land and sea) | Mod | 2 | 1 | 1 | 1 | 2 | 2 | 1 | 2 | 1 | 2 | 15 | Valuable but low visibility
| Economy (loans, embargoes, banks, wealth) | Mod | 1 | 1 | 0 | 1 | 1 | 1 | 0 | 2 | 1 | 1 | 9 | Needs clearer signals and impact
| Education and innovation | Mod | 1 | 1 | 0 | 1 | 2 | 2 | 0 | 2 | 1 | 1 | 11 | Powerful but mostly invisible
| Espionage and secrets | Mod | 2 | 1 | 1 | 2 | 1 | 1 | 0 | 2 | 1 | 2 | 13 | Great agency, low persistence and map presence
| Religion and faith | Mod | 2 | 2 | 1 | 2 | 2 | 2 | 1 | 2 | 1 | 2 | 17 | Strong system, could surface influence levels more
| Culture, art, and specializations | Mod | 1 | 1 | 1 | 1 | 2 | 2 | 1 | 2 | 1 | 2 | 14 | Solid, can use more visual markers
| Legends, mythology, notable figures | Mod | 1 | 2 | 1 | 0 | 2 | 2 | 0 | 1 | 2 | 2 | 13 | Great narrative depth, low map presence
| Lore (Annals) | Mod | 1 | 1 | 2 | 0 | 2 | 2 | 0 | 1 | 2 | 1 | 12 | Strong legibility, no player agency
| Plagues and epidemics | Mod | 2 | 2 | 2 | 1 | 2 | 1 | 2 | 2 | 1 | 2 | 17 | Clear map effect, good emergence
| Monuments and projects | Mod | 1 | 1 | 1 | 1 | 1 | 2 | 2 | 1 | 1 | 1 | 12 | Visible but narrow scope
| Migration and population movement | Mod | 1 | 1 | 0 | 0 | 2 | 1 | 0 | 2 | 2 | 1 | 10 | Needs visible destinations or markers
| Space, solar system, and multi-world | Mod | 2 | 1 | 1 | 2 | 2 | 2 | 1 | 2 | 1 | 2 | 16 | Big new layer, needs more map hooks |

## Gaps and candidates for follow-up
- Infrastructure decay (not implemented)
- Resource scarcity by biome (partially modeled via drought and famine)

## Weaknesses (Design Standards Pass)
- Legibility: many systems rely on log text and lack persistent UI/map cues (economy, diplomacy, espionage, education).
- Feedback loops: players often can’t tell why a prompt failed or what changed, which blunts learning and strategy.
- Agency without control: long-form Lore is mostly observational; direct but subtle player steering is still thin.
- Pacing: late-game message volume spikes while early-game inter-town interplay can feel sparse.
- Persistence: several effects resolve without leaving visible traces or structured summaries.
- Synergy clarity: cross-system impacts exist but aren’t surfaced (education→tech→economy/war; faith→diplomacy/war).
- Era gating: some prompts feel too advanced for early settlements without stronger tech/pop checks.
