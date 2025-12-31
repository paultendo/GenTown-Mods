# Tech Extension Draft

Building on the existing tech tree, extending each branch with more levels.
Maintaining the pattern: threshold → prompt → influences/effects.

## Design Principles

1. **Gradual progression** - No jarring jumps from medieval to modern
2. **Meaningful choices** - Rejecting tech should have consequences and flavor
3. **Cross-branch dependencies** - Later techs require multiple branches
4. **Specialization triggers** - Some techs unlock faster if towns have relevant specializations

---

## FARM Branch (currently ends at 40: Crop Rotation)

### Level 50: Fertilization
- **Message**: "{{people}} notice that certain waste makes crops grow stronger. {{should}}"
- **Done**: "Fields are enriched with natural fertilizers."
- **No**: "Waste is kept far from food sources."
- **Influences**: { farm: 2, disease: 0.2 }
- **Needs**: farm 40

### Level 60: Selective Breeding
- **Message**: "Farmers want to breed only the strongest livestock and heartiest seeds. {{should}}"
- **Done**: "Each generation grows stronger than the last."
- **No**: "Nature is left to decide which survive."
- **Influences**: { farm: 2, happy: 0.5 }
- **Needs**: farm 50, education 10

### Level 70: Mechanized Farming
- **Message**: "{{people}} dream of machines that could plant and harvest without rest. {{should}}"
- **Done**: "Mechanical implements transform agriculture."
- **No**: "Hands and simple tools remain the way of the field."
- **Influences**: { farm: 3, happy: -0.5 }
- **Needs**: farm 60, smith 50
- **Note**: This is the "industrial" gate - rejecting keeps world agrarian

### Level 80: Agricultural Science
- **Message**: "Scholars study soil, weather, and growth with scientific rigor. {{should}}"
- **Done**: "Farming becomes a science as much as a craft."
- **No**: "Traditional knowledge passed down through generations suffices."
- **Influences**: { farm: 2, education: 1 }
- **Needs**: farm 70, education 20

---

## TRAVEL Branch (currently ends at 40: Wheels)

### Level 50: Roads
- **Message**: "{{people}} propose laying stone paths between settlements. {{should}}"
- **Done**: "Paved roads connect the towns."
- **Tomorrow**: "{{randreg:town}} begins building roads."
- **No**: "Dirt paths serve well enough."
- **Influences**: { travel: 2, trade: 1 }
- **Needs**: travel 40, smith 10

### Level 60: Sailing Ships
- **Message**: "{{people}} want to build larger vessels with sails to catch the wind. {{should}}"
- **Done**: "Tall ships sail to distant shores."
- **No**: "The coast is far enough to venture."
- **Influences**: { travel: 2, trade: 1.5 }
- **Needs**: travel 50, trade 20

### Level 70: Navigation
- **Message**: "Scholars study the stars to chart courses across open water. {{should}}"
- **Done**: "Navigators guide ships by the heavens."
- **No**: "Sailors stay within sight of land."
- **Influences**: { travel: 2, education: 1 }
- **Needs**: travel 60, education 20

### Level 80: Steam Power
- **Message**: "{{people}} observe that boiling water creates great force. Could this move machines? {{should}}"
- **Done**: "Steam engines transform travel and industry."
- **No**: "Wind, water, and muscle remain the sources of power."
- **Influences**: { travel: 3, farm: 1 }
- **Needs**: travel 70, smith 50, fire 20
- **Note**: Major industrial gate

### Level 90: Railways
- **Message**: "Iron rails could guide steam-powered carriages between towns. {{should}}"
- **Done**: "Locomotives connect distant settlements."
- **Tomorrow**: "{{randreg:town}} builds a railway station."
- **No**: "The land should not be scarred by iron tracks."
- **Influences**: { travel: 3, trade: 2, happy: -0.5 }
- **Needs**: travel 80, smith 60

---

## FIRE Branch (currently ends at 30: Firebombing)

### Level 40: Kilns
- **Message**: "{{people}} want to build structures to contain and control intense heat. {{should}}"
- **Done**: "Kilns fire pottery and bricks with precision."
- **No**: "Open fires serve all heating needs."
- **Influences**: { trade: 1 }
- **Needs**: fire 20, smith 20

### Level 50: Forges
- **Message**: "Smiths dream of furnaces hot enough to melt any metal. {{should}}"
- **Done**: "Great forges produce stronger alloys."
- **No**: "Simple metalwork is sufficient."
- **Influences**: { military: 1, trade: 1 }
- **Needs**: fire 40, smith 30

### Level 60: Gunpowder
- **Message**: "A mixture of substances creates violent explosions. Should this be explored? {{should}}"
- **Done**: "Gunpowder changes the nature of warfare forever."
- **No**: "Such dangerous knowledge is forbidden."
- **Influences**: { military: 4, crime: 1, happy: -1 }
- **Needs**: fire 50, military 30, education 10
- **Note**: Major military divergence point

### Level 70: Engines
- **Message**: "Controlled explosions could drive pistons and machines. {{should}}"
- **Done**: "Combustion engines power a new age."
- **No**: "Steam and muscle are power enough."
- **Influences**: { travel: 2, farm: 1 }
- **Needs**: fire 60, travel 80

---

## SMITH Branch (currently ends at 40: Metal Tools)

### Level 50: Steel
- **Message**: "Smiths experiment with refining iron into something stronger. {{should}}"
- **Done**: "Steel transforms construction and warfare."
- **No**: "Iron serves all needs."
- **Influences**: { military: 2, trade: 1 }
- **Needs**: smith 40, fire 40

### Level 60: Architecture
- **Message**: "Builders dream of structures that touch the sky. {{should}}"
- **Done**: "Grand buildings rise in {{randreg:town}}."
- **No**: "Humble structures shelter the people."
- **Influences**: { happy: 2, faith: 1 }
- **Needs**: smith 50, education 10

### Level 70: Machinery
- **Message**: "Gears, levers, and pulleys could multiply human effort. {{should}}"
- **Done**: "Machines assist in labor across the land."
- **No**: "Hands are the proper tools of work."
- **Influences**: { farm: 1, trade: 1, happy: -0.5 }
- **Needs**: smith 60, education 20

### Level 80: Precision Engineering
- **Message**: "Craftsmen seek to build devices of exacting precision. {{should}}"
- **Done**: "Precision instruments advance all fields."
- **No**: "Approximate measures serve well enough."
- **Influences**: { education: 2, trade: 1 }
- **Needs**: smith 70, education 30

---

## TRADE Branch (currently ends at 30: Currency)

### Level 40: Banking
- **Message**: "Merchants want to store and lend currency through trusted institutions. {{should}}"
- **Done**: "Banks manage wealth across the settlements."
- **No**: "Each keeps their own wealth close."
- **Influences**: { trade: 2, crime: 0.5 }
- **Needs**: trade 30, government 10

### Level 50: Contracts
- **Message**: "Written agreements could bind parties to their promises. {{should}}"
- **Done**: "Legal contracts govern trade and property."
- **No**: "A handshake and one's word are bond enough."
- **Influences**: { trade: 1.5, crime: -0.5 }
- **Needs**: trade 40, education 20

### Level 60: Markets
- **Message**: "{{people}} want dedicated places where goods are bought and sold. {{should}}"
- **Done**: "Market squares bustle with commerce."
- **Tomorrow**: "{{randreg:town}} opens a market."
- **No**: "Trade happens wherever people meet."
- **Influences**: { trade: 2, happy: 1 }
- **Needs**: trade 50

### Level 70: Guilds
- **Message**: "Craftsmen want to organize to protect their trades. {{should}}"
- **Done**: "Guilds regulate crafts and train apprentices."
- **No**: "Any may practice any trade freely."
- **Influences**: { trade: 1.5, education: 1, happy: -0.5 }
- **Needs**: trade 60, education 20

### Level 80: Corporations
- **Message**: "Groups want to pool resources into entities that persist beyond individuals. {{should}}"
- **Done**: "Corporations pursue profit across settlements."
- **No**: "Business remains personal and local."
- **Influences**: { trade: 3, happy: -1 }
- **Needs**: trade 70, government 20

---

## GOVERNMENT Branch (currently ends at 10: Laws)

### Level 20: Taxation
- **Message**: "Leaders want to collect a portion of wealth to fund common works. {{should}}"
- **Done**: "Taxes fund roads, defenses, and public works."
- **No**: "The people keep what they earn."
- **Influences**: { trade: -0.5, military: 1, travel: 1 }
- **Needs**: government 10, trade 20

### Level 30: Bureaucracy
- **Message**: "Records and officials could manage the growing complexity of society. {{should}}"
- **Done**: "Scribes and officials administer the settlements."
- **No**: "Simple councils decide local matters."
- **Influences**: { crime: -1, happy: -0.5 }
- **Needs**: government 20, education 10

### Level 40: Courts
- **Message**: "Disputes could be settled by impartial judges rather than feuds. {{should}}"
- **Done**: "Courts of law deliver justice."
- **No**: "Communities settle their own disputes."
- **Influences**: { crime: -1.5, happy: 0.5 }
- **Needs**: government 30

### Level 50: Constitution
- **Message**: "{{people}} propose writing down the fundamental rules that govern society. {{should}}"
- **Done**: "A constitution limits power and protects rights."
- **No**: "Tradition and custom guide governance."
- **Influences**: { happy: 1.5, crime: -0.5 }
- **Needs**: government 40, education 20

### Level 60: Democracy
- **Message**: "Some argue that all citizens should have a voice in governance. {{should}}"
- **Done**: "Representatives are chosen by the people."
- **No**: "The wise and powerful guide society."
- **Influences**: { happy: 2, education: 1 }
- **Needs**: government 50, education 30
- **Note**: Could have alternative paths - Monarchy, Theocracy, etc.

---

## EDUCATION Branch (currently ends at 20: Higher Education)

### Level 30: Writing
- **Message**: "{{people}} want to record their words in lasting form. {{should}}"
- **Done**: "Written language preserves knowledge."
- **No**: "Memory and oral tradition carry wisdom forward."
- **Influences**: { education: 2, trade: 0.5 }
- **Needs**: education 20

### Level 40: Libraries
- **Message**: "Scholars want to gather written works in one place. {{should}}"
- **Done**: "Libraries preserve and share knowledge."
- **Tomorrow**: "{{randreg:town}} founds a library."
- **No**: "Knowledge stays with those who earned it."
- **Influences**: { education: 2 }
- **Needs**: education 30
- **Func**: Could spawn Grand Library specialization

### Level 50: Printing
- **Message**: "A device could copy written works quickly and cheaply. {{should}}"
- **Done**: "The printing press spreads ideas far and wide."
- **No**: "Hand-copied texts are precious and controlled."
- **Influences**: { education: 3, happy: 0.5, crime: 0.25 }
- **Needs**: education 40, smith 40

### Level 60: Universities
- **Message**: "Scholars want institutions dedicated to advancing knowledge. {{should}}"
- **Done**: "Universities become centers of learning."
- **Tomorrow**: "{{randreg:town}} founds a university."
- **No**: "Apprenticeship teaches all that's needed."
- **Influences**: { education: 3 }
- **Needs**: education 50

### Level 70: Scientific Method
- **Message**: "Some propose testing ideas through careful experiment rather than tradition. {{should}}"
- **Done**: "The scientific method transforms understanding."
- **No**: "Ancient wisdom guides inquiry."
- **Influences**: { education: 3, farm: 1, happy: 0.5 }
- **Needs**: education 60

### Level 80: Medicine
- **Message**: "Scholars study the body to understand and treat disease. {{should}}"
- **Done**: "Medical knowledge saves lives."
- **No**: "Healing remains a matter of tradition and faith."
- **Influences**: { disease: -2, happy: 1 }
- **Needs**: education 70

---

## MILITARY Branch (currently ends at 50: Combat Vehicles)

### Level 60: Fortifications
- **Message**: "Towns want walls and towers to defend against attack. {{should}}"
- **Done**: "Fortifications protect the settlements."
- **No**: "Open communities trust in peace."
- **Influences**: { military: 2, happy: -0.5 }
- **Needs**: military 50, smith 50

### Level 70: Standing Armies
- **Message**: "Some propose maintaining soldiers even in peacetime. {{should}}"
- **Done**: "Professional armies train and garrison."
- **No**: "Citizens take up arms only when needed."
- **Influences**: { military: 2, crime: -1, happy: -1 }
- **Needs**: military 60, government 30

### Level 80: Firearms
- **Message**: "Gunpowder could propel projectiles with devastating force. {{should}}"
- **Done**: "Firearms transform the battlefield."
- **No**: "Traditional weapons maintain honor in combat."
- **Influences**: { military: 3 }
- **Needs**: military 70, fire 60

### Level 90: Artillery
- **Message**: "Massive guns could demolish walls and armies from afar. {{should}}"
- **Done**: "Artillery dominates the battlefield."
- **No**: "Siege warfare relies on patience and will."
- **Influences**: { military: 3, happy: -1 }
- **Needs**: military 80

---

## NEW BRANCH: FAITH (currently only an influence, no tech)

### Level 10: Rituals
- **Message**: "{{people}} develop ceremonies to mark births, deaths, and seasons. {{should}}"
- **Done**: "Rituals bind communities together."
- **No**: "Each observes in their own way."
- **Influences**: { faith: 2, happy: 1 }
- **Needs**: farm 10

### Level 20: Temples
- **Message**: "{{people}} want to build sacred spaces for worship. {{should}}"
- **Done**: "Temples rise as centers of faith."
- **Tomorrow**: "{{randreg:town}} builds a temple."
- **No**: "The world itself is sacred enough."
- **Influences**: { faith: 2, happy: 0.5 }
- **Needs**: faith 10, smith 20

### Level 30: Priesthood
- **Message**: "Some wish to dedicate their lives to spiritual matters. {{should}}"
- **Done**: "Priests guide the faithful."
- **No**: "All commune with the divine equally."
- **Influences**: { faith: 2, education: 0.5 }
- **Needs**: faith 20

### Level 40: Scripture
- **Message**: "The faithful want to record sacred teachings in writing. {{should}}"
- **Done**: "Holy texts preserve and spread the faith."
- **No**: "Sacred knowledge passes through living tradition."
- **Influences**: { faith: 2, education: 1 }
- **Needs**: faith 30, education 30

### Level 50: Monasteries
- **Message**: "Some wish to withdraw from the world to focus on spiritual and scholarly pursuits. {{should}}"
- **Done**: "Monasteries become centers of faith and learning."
- **No**: "The faithful remain in the world."
- **Influences**: { faith: 2, education: 2 }
- **Needs**: faith 40, education 40

---

## Specialization Integration

Specializations could accelerate tech research:

- **Grand Library / Academy**: +50% to education tech progress
- **Master Smiths**: +50% to smith tech progress
- **Merchant Guild / Trading Hub**: +50% to trade tech progress
- **Warrior Clan / Fortress**: +50% to military tech progress
- **Holy Order / Sacred Site**: +50% to faith tech progress (new branch)

When a town develops a relevant specialization, it could:
1. Increase the global influence in that area (already does this via bonuses)
2. Trigger a check for tech unlocks
3. Or provide a "research bonus" that speeds progression

---

## Era Markers (Optional)

Could add invisible "era" tracking based on average tech level:

- **Stone Age**: Default starting
- **Bronze Age**: smith 30+ and farm 20+
- **Iron Age**: smith 40+ and military 20+
- **Classical**: government 30+ and education 30+
- **Medieval**: military 60+ and faith 30+ and trade 40+
- **Renaissance**: education 50+ and trade 50+
- **Industrial**: travel 80+ (steam) and smith 70+
- **Modern**: education 70+ and travel 90+

Eras could affect event flavor text, available landmarks, and specialization types.

---

## Implementation Notes

1. Follow existing pattern exactly - each level is an object with message, messageDone, messageNo, influences, influencesNo, needsUnlock
2. Use existing `planet.unlocks` structure
3. Hook into influence system for progression
4. Events can check tech levels for gating
5. Specializations already modify influences, so they naturally affect tech
