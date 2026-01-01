# War, Vassals, Wonders, and Memory — Roadmap

This document captures the planned implementation order and design intent for the next major mod systems:
- Casus belli (why wars start) + war objectives (what’s at stake)
- Vassal/tributary relationships (subjugation as an end-state)
- Wonders/landmarks as strategic objectives
- Holy politics (holy wars/alliances/excommunications), kept rare
- Generational memory with distortion into myth/legend

Constraints:
- Mod-only changes (no base game edits).
- Prefer autonomy over prompts: systems should run mostly via `auto: true` events and persistent state, with prompts reserved for rare, high-leverage choices.
- Avoid snowballing: subjugation must create internal instability and administrative strain.

## 1) Casus Belli + War Objectives (Foundation)

Goal: make wars legible and “about something” without requiring strict, gamey rules.

Implementation:
- When a war begins, assign and store:
  - `cause` (why it started)
  - `demand` / `objective` (what the initiator wants)
- Persist these on the war `process` and in `planet.history` so other systems can reference them.
- Log a short Chronicle/Lore line on declaration: who, why, and the primary demand.

Candidate causes:
- Revenge / grudge escalation
- Claims / irredentism (lost territory)
- Tribute refusal / vassal rebellion
- Religion: excommunication / schism / seized holy site
- Seize wonder / pillage landmark
- Alliance obligation / coalition enforcement

Why first:
- Everything else (vassals, wonders, holy wars, memory) becomes more coherent when wars have a stored “reason” and “stakes”.

## Tech: Making Technology Feel Dynamically Generated (Mod Layer)

Goal: keep base-game tech balance/ranges intact while making tech feel “authored by the world” and different each run.

Principle:
- Do not change the underlying `planet.unlocks` meaning/thresholds.
- Instead, layer procedural flavor, local diffusion, and context-driven ordering on top.

Implementation options (compatible with low-prompt design):
- **World tech seed + variants**
  - On world start, roll a “variant” for each major unlock milestone:
    - unique name (e.g., “Lateen Sails”, “Junk Rigging”, “Caravel Design”)
    - short description + a small side-effect (kept minor to preserve balance)
  - Log tech breakthroughs as world-specific discoveries.
- **Problem-driven discovery bias**
  - Bias the probability of upcoming unlocks based on world conditions:
    - drought/famine pressure → irrigation/agriculture advances
    - recurring epidemics → medicine/public health
    - high war pressure → fortifications/logistics
  - This changes the *feel* of progression without forcing a fixed schedule.
- **Town-local adoption and diffusion**
  - Track `town.techAdoption[...]` separately from global unlocks.
  - Adoption spreads via trade routes, alliances, and education; resisted by high-order/traditional towns.
  - Benefits arrive unevenly, creating geographic “tech maps” and catch-up stories.
- **Inventors/schools as history**
  - When an unlock occurs, generate:
    - an origin town
    - an inventor/scholar figure
    - a “school”/tradition name
  - Record to history/Lore so tech becomes part of the world’s narrative.
- **Milestone + applications**
  - Keep milestones stable, but procedurally generate 1–2 “applications” as:
    - specializations, projects, or Great Work variants
  - Different runs get different downstream consequences and synergies.

Success criteria:
- Tech feels like it emerges from pressures, places, and people.
- Different towns lead different eras; diffusion creates visible inequality and catch-up drama.
- Balance stays consistent with base ranges (no runaway power spikes).

## 2) Vassal / Tributary Relationships (Subjugation, Not Just Peace)

Goal: wars can end in subjugation as a third path between “peace” and “wipeout”.

Core state:
- Relationship object `{ overlordId, subjectId, startDay, autonomy, resentment, terms, lastTributeDay, adminStrain }`
- Two key tracks per subject:
  - **Autonomy**: structural independence (limits tribute, limits war contribution)
  - **Resentment**: political anger (drives rebellion/sabotage/defection)

Dynamic tribute (lord-driven, subject-limited):
- Each tribute cycle, the overlord selects from what the subject can actually provide:
  - `cash`, `food`, `trade concessions` (open routes / lift embargo), `levies` (soldiers/war participation),
  - `project contributions` (e.g., wonders), or other material/influence equivalents.
- If the subject can’t meet it: partial payment + resentment increase (and legitimacy effects later).

War participation:
- Vassals/tributaries auto-join overlord wars by default.
- Exception: a subject can seek a **rebellion alliance** (joining external alliances as part of a revolt/independence move).

Anti-snowball design (required):
- **Administrative strain** on the overlord:
  - More subjects ⇒ higher ongoing strain ⇒ higher unrest/crime/happy penalties and/or reduced effective yields.
  - Disloyal subjects add disproportionate strain.
- Crackdowns have costs:
  - Short-term compliance, long-term resentment.
- Subject levers (rebellion ladder):
  - petition for lower tribute → stall payments → refuse tribute → sabotage → rebellion → independence war
  - defect to rival patron under pressure
  - coordinate “rebellion alliance” with other subjects

### Debt Diplomacy (Economic Vassalage)

Goal: turn lending and default into emergent political relationships and occasional debt wars, rather than isolated relation ticks.

Design:
- Loans should track “arrears” over time:
  - `missedPayments`, `daysInArrears`, and an escalating “pressure/patience” score for the lender→borrower relationship.
- Default should not instantly cause war; repeated non-payment (especially on large loans) should enable escalation.

Lender escalation ladder (chosen dynamically):
- **Restructure**: extend term / reduce payment / partial forgiveness
  - more likely for high-justice/high-openness lenders, or when borrower is disaster-hit
- **Concessions**: trade concessions, currency adoption, embargo lifting, access rights
- **Tributary terms**: borrower pays ongoing dynamic tribute (cash/food/levies/projects) based on:
  - what the borrower can actually provide
  - what the lender currently “wants” (resources, soldiers, project contributions, trade access)
- **Collateral seizure** (prefer legible assets):
  - wonders/landmarks as the first “collateral” target
  - territory seizure should generally be via a war objective, not instant paper transfer
- **Debt war**: casus belli “debt enforcement / seizure of collateral”

Borrower responses (autonomous):
- comply → stall → refuse → seek patron (rival lender) → coordinate “debtors’ league” → rebellion/war

Guardrails (anti-snowball):
- Gate harsh escalation behind:
  - big debt, multiple missed payments, significant power imbalance, and strong cooldowns.
- “Territory for debt” should be rare and usually require a debt-war victory.
- Debt empires should be brittle:
  - administrative strain + resentment should scale with number of debt-subjects and how hard the lender squeezes.

## 3) Wonders/Landmarks as Strategic War Objectives

Goal: make wars have map-visible stakes beyond territory and generic relation shifts.

Implementation:
- Mark certain Great Works / major landmarks as **strategic assets**.
- Add war demands:
  - “seize wonder” (transfer control/benefit)
  - “pillage wonder” (one-time benefit + degradation)
  - “destroy wonder” (rare)
- Tie outcomes to coalition participation when relevant (who gets credit/benefit, who resents the distribution).

Balance:
- Transfer is most common.
- Pillage is uncommon.
- Destruction is rare and tied to extreme conditions (high resentment, holy war escalation, total war).

## 4) Holy Politics (Rare Escalations)

Goal: religion should be an interesting presence throughout the game, but not the dominant system except in rare emergent “holy war” cases.

Authority:
- Excommunication/holy decrees should originate from:
  - the religion’s **holy city** (founding town), or
  - the **founder** of a holy wonder/site (when applicable).

Mechanics:
- **Excommunication** as soft-power:
  - fractures alliances/trade, raises unrest, increases coalition pressure, can provide casus belli
- **Holy alliances**:
  - faith-aligned coalitions that form around shared threats or sacred objectives
- **Holy wars**:
  - rare escalation when multiple triggers align (seized sacred site, repeated persecution, major schism, prophecy/legend pressure)

### Heresy → Hardening → Schism (Sect System)

Goal: add internal religious politics without constantly creating new religions. Heresies remain “same religion, different sect” until they harden into a formal split.

Design (3-stage pipeline):
- **Reform**: official change to a religion’s tenets/doctrine
  - driven from the holy city / authority seat (when implemented)
  - mostly autonomous; prompts reserved for rare, high-impact moments
- **Heresy (sect)**: a local variant inside the same religion
  - town keeps `town.religion = X`
  - town gains a sect tag/state (e.g. `town.religionSectId` + `sectZeal`/`sectDrift`)
  - can spread to nearby/connected towns and cause tension/unrest
- **Hardening / Schism**: a sect becomes a formal split (rare)
  - occurs when the sect persists over time, spreads, and/or is condemned/persecuted
  - promoted into a new religion ID only at this point

Triggers and pressures:
- Higher education + writing/printing increase reform pressure (doctrinal debate, reinterpretation).
- High faith + spiritual/literary culture increase myth-making and sect cohesion.
- Political tension (different governments, bad relations with holy city) increases heresy risk.
- Excommunication/suppression can backfire and accelerate hardening (“martyr effect”).

Player experience goals:
- Minimal prompt spam: sect drift and local controversy run autonomously.
- Rare “big” prompts only when it matters (e.g., excommunicate vs tolerate), with strong cooldowns.
- Strong synergy with memory distortion: heresies can become legends/myths that later drive casus belli and holy alliances/holy wars (kept rare).

## 5) Generational Memory → Distortion → Myth/Legend

Goal: long-term storytelling and emergent conflict driven by how societies remember (and misremember) events.

Key principle:
- Separate **canonical truth** from **belief**:
  - Canonical truth: `planet.history` (what happened)
  - Belief memory: town-level memory (what people think happened)

Memory items (examples):
- “They raided us.”
- “They destroyed our landmark.”
- “They betrayed an alliance.”
- “They saved us during famine.”
- Include: actor, target, event type, day, severity/importance.

Distortion over time:
- Memories can drift:
  - exaggerated severity
  - misattributed blame/credit
  - moralized retellings (“divine punishment”, “prophecy fulfilled”)
- Distortion modifiers:
  - **Reduced by** education/writing/printing (better record-keeping)
  - **Increased by** high faith + spiritual/literary culture (myth-making pressure)

Myth/legend formation:
- Some distorted memories “harden” into legends.
- Legends can:
  - influence religion tenets/spread (local saints, cursed enemies, holy sites)
  - generate casus belli (“ancestral wrongs”, “sacred reclamation”)
  - affect legitimacy (a regime’s story of itself vs rivals)

## Success Criteria (Playtest)

- Wars feel more frequent *emergently* (not on a timer), and players can understand “why”.
- Vassalage creates interesting mid/late-game political webs without runaway snowballing.
- Wonders/landmarks are visible stakes that produce strategic geography and memorable wars.
- Holy politics happens throughout but rarely dominates; holy wars remain exceptional.
- Long-term memory produces believable “history as story”, with occasional myths that ripple into diplomacy and conflict.

## Optional Modules (After Core Systems Stabilize)

These add pressure and dynamism without resorting to “war every X days”. They should be implemented with strict guardrails and strong cooldowns.

### Doomsday / World Crisis Events (Very Rare Cooperative Threats)

Goal: introduce extremely rare, high-stakes threats that push towns into cooperation (often reluctantly) and create memorable late-game arcs.

Implementation direction:
- Model each crisis as a global `process` with phases:
  - **omen** → **escalation** → **response window** → **resolution** → **aftermath**
- Town participation should be mostly autonomous:
  - towns contribute based on capacity (cash/food/scholars/soldiers/ships/projects) and incentives
  - contributions weighted by values/government/legitimacy and self-interest (proximity, vulnerability)
- Form an implicit “crisis coalition”:
  - contributors gain bonds/legitimacy; free-riders lose legitimacy/relations
  - heavy contributors may leverage post-crisis influence (tribute terms, debt diplomacy, alliance leadership)

Outcomes (avoid binary pass/fail):
- Partial success reduces severity; failure creates persistent world scars:
  - famine/trade collapse, mass refugees/diaspora, unrest/legitimacy shocks, myth/prophecy spikes
- Success still has costs:
  - resource depletion, temporary unhappiness, political backlash, new rivalries over who “paid most”

Guardrails (required):
- Hard global cooldown in the hundreds of days.
- Strong era gates and prerequisites (some crises only possible after certain tech/world size).
- Clear omens/telegraphing so it feels fair and legible, not random punishment.

Example crisis types (fit existing systems):
- **Great plague wave** (disease spread, quarantine, hospitals, trade disruption)
- **Supervolcano / solar winter** (food crisis, migration, trade reroutes, coalition logistics)
- **Meteor impact** (map scars, refugees, legitimacy shock, myth-making)
- **Rogue fleet / space hazard** (future space layer: cross-world routes and cooperative defense)

### Pirates / Bandits (Dynamic Faction)

Goal: add external disruption that creates emergent skirmishes, trade risk, and occasional local crises.

Implementation direction:
- Represent as `process` + map-visible markers (e.g., bandit camp / pirate cove).
- Primary behaviors:
  - raid trade routes (reduce goods/wealth, create “unsafe route” pressure)
  - plunder nearby towns (resource loss, happiness dip, local unrest)
  - trigger small skirmishes (towns usually drive them off)
- Rare “settle” outcome:
  - the faction stabilizes into a new town (usually low faith initially; can develop faith later).

Guardrails:
- Hard caps on concurrent camps/coves.
- Long global cooldown between spawns; per-region cooldown to avoid repeated harassment.
- Territory effects should be small and reversible (mostly disruption, not map-wrecking).

Synergies:
- Trade risk, legitimacy (can rulers protect routes?), refugees/diaspora, grudges/memory (“the raid of day 130”), casus belli (“pirate suppression”), coalitions (joint patrols).

### Secession (Large Towns Splitting / Regional Breakaways)

Goal: prevent late-game stability from becoming static; create believable internal fracturing and reunification wars.

Trigger direction:
- Low legitimacy + high unrest + large/remote territory.
- Distance/terrain and cultural/religious mismatch increase breakaway pressure.

Outcomes:
- Split off a cluster of chunks into a new town (or a rebel polity).
- Seed the new entity with inherited culture/memory and an initial political stance.
- Create an immediate conflict state (civil war / secession war) and a casus belli (“reunification”).
- Allow “rebellion alliances” as an exception to normal vassal/war-join rules.

Guardrails:
- Only eligible above a meaningful size threshold (pop/land).
- Strong per-town secession cooldown (no repeated splits).
- Avoid cascade failures: limit chain reactions unless multiple pressures align (e.g., overlord at war + famine + low legitimacy).

Synergies:
- Legitimacy/unrest, vassals (subject revolts), casus belli, irredentism/claims, diaspora networks, coalition wars, lore/myth (“the rightful homeland” narratives).
