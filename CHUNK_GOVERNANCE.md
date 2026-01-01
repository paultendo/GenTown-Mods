# Chunk Governance System

## Core Concept

Territory isn't uniformly controlled. Each chunk has a **governance value** representing how effectively authority reaches it. Low governance spawns problems - bandits, heresy, smuggling, unrest. High governance is stable but expensive to maintain.

```
Neglect → governance decays → problems spawn → further decay
Investment → governance rises → stability → expansion possible
```

This creates natural frontiers, explains why empires struggle at edges, and makes territorial control an active challenge rather than a static fact.

---

## Data Structure

```javascript
// Stored on chunk
chunk.v.gov = {
    value: 0,           // 0-100, effective control
    source: null,       // town ID providing governance
    lastUpdate: 0,      // day of last calculation
    problems: []        // active issues spawned here
};
```

Governance is calculated, not just stored - it flows from towns outward and decays with distance.

---

## Governance Calculation

### Base Formula

```javascript
function calculateChunkGovernance(chunk, town) {
    if (!town || town.end) return 0;

    const distance = getChunkDistanceToTownCenter(chunk, town);
    const maxRange = getGovernanceRange(town);

    if (distance > maxRange) return 0;

    // Base governance from town
    let gov = getBaseTownGovernance(town);

    // Distance decay (exponential falloff)
    const distanceFactor = 1 - Math.pow(distance / maxRange, 1.5);
    gov *= distanceFactor;

    // Terrain difficulty
    gov *= getTerrainGovernanceFactor(chunk);

    // Infrastructure bonus
    gov += getInfrastructureBonus(chunk, town);

    return clampValue(gov, 0, 100);
}
```

### Town Base Governance

What makes a town project authority:

```javascript
function getBaseTownGovernance(town) {
    let base = 30;

    // Population provides administrators
    base += Math.sqrt(town.pop || 0) * 2;

    // Government type matters
    const govBonus = {
        "dictatorship": 15,
        "monarchy": 12,
        "theocracy": 10,
        "oligarchy": 8,
        "republic": 5,
        "democracy": 3,
        "tribal": 0,
        "commune": -5
    };
    base += govBonus[town.governmentType] || 0;

    // Military projects control
    base += (town.influences?.military || 0) * 2;

    // Legitimacy amplifies reach
    const legitimacy = town.legitimacy || 50;
    base *= (0.5 + legitimacy / 100);

    // Admin strain from vassals reduces home governance
    const strain = town._paultendoAdminStrain || 0;
    base -= strain * 3;

    return Math.max(10, base);
}
```

### Governance Range

How far authority extends:

```javascript
function getGovernanceRange(town) {
    let range = 5; // base chunks

    // Size extends reach
    range += Math.sqrt(town.size || 1) * 0.5;

    // Roads/infrastructure extend reach
    if (planet.unlocks?.travel >= 50) range += 2;  // roads
    if (planet.unlocks?.travel >= 80) range += 3;  // steam

    // Government type
    if (town.governmentType === "dictatorship") range += 2;
    if (town.governmentType === "monarchy") range += 1;

    // Overextension penalty
    const subjects = getTownSubjects(town).length;
    range -= subjects * 0.5;

    return Math.max(3, range);
}
```

### Terrain Factor

Some terrain is harder to govern:

| Terrain | Factor | Reason |
|---------|--------|--------|
| Grassland | 1.0 | Easy to patrol |
| Forest | 0.7 | Bandits hide easily |
| Mountain | 0.5 | Difficult access |
| Wetland | 0.6 | Hard to traverse |
| Desert | 0.8 | Sparse but visible |
| Tundra | 0.7 | Remote, harsh |

```javascript
function getTerrainGovernanceFactor(chunk) {
    const factors = {
        "grass": 1.0,
        "forest": 0.7,
        "mountain": 0.5,
        "wetland": 0.6,
        "desert": 0.8,
        "tundra": 0.7,
        "snow": 0.6,
        "badlands": 0.65
    };
    return factors[chunk.b] || 0.8;
}
```

### Infrastructure Bonus

Roads, forts, temples project governance:

```javascript
function getInfrastructureBonus(chunk, town) {
    let bonus = 0;

    // Road through chunk
    if (hasRoad(chunk)) bonus += 10;

    // Nearby fort/garrison
    if (hasNearbyMilitary(chunk, town, 3)) bonus += 15;

    // Temple/religious presence
    if (hasNearbyTemple(chunk, town, 4)) bonus += 8;

    // Trade route passes through
    if (isOnTradeRoute(chunk)) bonus += 5;

    return bonus;
}
```

---

## Governance Thresholds

| Range | Label | Effects |
|-------|-------|---------|
| 80-100 | **Heartland** | Stable, safe, full benefits, rare problems |
| 60-79 | **Governed** | Mostly stable, occasional issues |
| 40-59 | **Frontier** | Contested, regular problems spawn |
| 20-39 | **Lawless** | Bandits, smuggling, heresy likely |
| 0-19 | **Ungoverned** | No effective control, constant spawns |

---

## Problem Spawning

Low governance spawns problems. Problems persist until addressed.

### Spawn Checks

```javascript
function checkGovernanceSpawns(chunk) {
    const gov = chunk.v.gov?.value || 0;

    if (gov >= 60) return; // stable enough

    // Lower governance = higher spawn chance
    const spawnChance = (60 - gov) / 500; // max ~12% per day at 0 governance

    if (Math.random() > spawnChance) return;

    // What spawns depends on governance level and context
    const problem = selectProblemType(chunk, gov);
    spawnProblem(chunk, problem);
}
```

### Problem Types

| Problem | Gov Threshold | Effects | Resolution |
|---------|---------------|---------|------------|
| **Bandits** | <50 | Raid trade routes, steal from nearby chunks, reduce happiness | Military action, or governance rises above 60 |
| **Smugglers** | <45 | Bypass embargoes, reduce trade income, spread contraband | Governance >55, or dedicated crackdown |
| **Heresy cell** | <40 | Spread heterodox beliefs, increase sect drift, reduce faith influence | Religious action, or governance >50 |
| **Tax evasion** | <35 | Reduce tribute/tax income from chunk | Governance >45 |
| **Rebel camp** | <25 | Active recruitment, may trigger uprising, spreads unrest | Military action required |
| **Rival claimant** | <20 | Pretender emerges, legitimacy threat, may seek foreign backing | Must be defeated or co-opted |

### Spawn Selection

```javascript
function selectProblemType(chunk, gov) {
    const options = [];

    if (gov < 50) options.push({ type: "bandits", weight: 30 });
    if (gov < 45) options.push({ type: "smugglers", weight: 20 });
    if (gov < 40 && hasFaithPresence(chunk)) options.push({ type: "heresy", weight: 15 });
    if (gov < 35) options.push({ type: "taxEvasion", weight: 25 });
    if (gov < 25) options.push({ type: "rebelCamp", weight: 10 });
    if (gov < 20 && hasLegitimacyCrisis(chunk)) options.push({ type: "rivalClaimant", weight: 5 });

    if (options.length === 0) return null;

    return weightedChoice(options, o => o.weight)?.type;
}
```

---

## Problem Persistence

Problems don't vanish when governance rises - they must be addressed or slowly fade.

```javascript
function updateProblem(problem, chunk) {
    const gov = chunk.v.gov?.value || 0;
    const age = planet.day - problem.spawnDay;

    // Natural resolution if governance high enough
    if (gov > problem.resolutionThreshold && age > 10) {
        const fadeChance = (gov - problem.resolutionThreshold) / 200;
        if (Math.random() < fadeChance) {
            resolveProblem(problem, "faded");
            return;
        }
    }

    // Problem grows if governance stays low
    if (gov < problem.growthThreshold && age > 20) {
        problem.severity = Math.min(10, (problem.severity || 1) + 0.1);
    }

    // Apply ongoing effects
    applyProblemEffects(problem, chunk);
}
```

---

## Problem Effects

### Bandits

```javascript
function applyBanditEffects(problem, chunk) {
    const severity = problem.severity || 1;
    const town = regGet("town", chunk.v.s);
    if (!town) return;

    // Reduce happiness in affected area
    if (Math.random() < 0.1 * severity) {
        happen("Influence", null, town, { happy: -0.1 * severity, temp: true });
    }

    // Raid trade routes passing through
    const routes = getTradeRoutesThroughChunk(chunk);
    routes.forEach(route => {
        if (Math.random() < 0.05 * severity) {
            route.disrupted = (route.disrupted || 0) + 1;
            if (Math.random() < 0.3) {
                logMessage(`Bandits raid a caravan near {{regname:town|${town.id}}}.`, "warning");
            }
        }
    });
}
```

### Heresy Cell

```javascript
function applyHeresyEffects(problem, chunk) {
    const severity = problem.severity || 1;
    const town = regGet("town", chunk.v.s);
    if (!town) return;

    // Increase sect drift
    if (Math.random() < 0.08 * severity) {
        town.sectDrift = (town.sectDrift || 0) + 0.2;
    }

    // Reduce faith influence
    if (Math.random() < 0.05 * severity) {
        happen("Influence", null, town, { faith: -0.1 * severity, temp: true });
    }

    // Can spread to neighboring low-governance chunks
    if (Math.random() < 0.02 * severity) {
        const neighbors = getNeighborChunks(chunk);
        const target = neighbors.find(n =>
            (n.v.gov?.value || 0) < 40 &&
            !hasProblems(n, "heresy")
        );
        if (target) {
            spawnProblem(target, { type: "heresy", severity: 1, parent: problem.id });
        }
    }
}
```

### Rebel Camp

```javascript
function applyRebelCampEffects(problem, chunk) {
    const severity = problem.severity || 1;
    const town = regGet("town", chunk.v.s);
    if (!town) return;

    // Increase town unrest
    initUnrest(town);
    town.unrest += 0.15 * severity;

    // Recruit from dissatisfied population
    if (Math.random() < 0.03 * severity) {
        problem.strength = (problem.strength || 10) + Math.floor(severity * 2);
    }

    // At high severity, may trigger uprising
    if (severity >= 7 && (problem.strength || 0) >= 50 && Math.random() < 0.05) {
        triggerLocalUprising(chunk, town, problem);
    }
}
```

---

## Resolution Actions

### Military Crackdown

```javascript
function crackdownOnProblem(town, problem) {
    const military = town.influences?.military || 0;
    const soldiers = town.jobs?.soldier || 0;
    const severity = problem.severity || 1;

    const successChance = clampChance(
        0.3 + military * 0.05 + soldiers * 0.01 - severity * 0.05
    );

    if (Math.random() < successChance) {
        resolveProblem(problem, "crackdown");
        logMessage(`{{regname:town|${town.id}}} stamps out ${problem.type} in the frontier.`);

        // But crackdowns have costs
        happen("Influence", null, town, { happy: -0.5 });
        if (problem.type === "heresy") {
            // Martyr effect possible
            if (Math.random() < 0.2) {
                town.sectDrift = (town.sectDrift || 0) + 1;
                logMessage(`The crackdown creates martyrs. Whispers of the faith spread.`, "warning");
            }
        }
    } else {
        // Failed crackdown emboldens problem
        problem.severity = Math.min(10, severity + 1);
        logMessage(`The campaign against ${problem.type} falters.`, "warning");
    }
}
```

### Governance Investment

Towns can invest resources to boost governance in an area:

```javascript
function investInGovernance(town, targetChunk, investment) {
    const cost = investment * 10; // cash cost
    if ((town.resources?.cash || 0) < cost) return false;

    happen("Resource", null, town, { cash: -cost });

    // Temporary governance boost
    targetChunk.v.gov = targetChunk.v.gov || {};
    targetChunk.v.gov.investment = (targetChunk.v.gov.investment || 0) + investment;
    targetChunk.v.gov.investmentExpires = planet.day + 50;

    // May build permanent infrastructure
    if (investment >= 5 && Math.random() < 0.3) {
        buildInfrastructure(targetChunk, "road");
    }

    return true;
}
```

---

## Vassal Governance

Vassals govern their own territory, but overlord influence extends:

```javascript
function calculateVassalGovernance(chunk, subject, overlord) {
    // Subject provides base governance
    let gov = calculateChunkGovernance(chunk, subject);

    // Overlord influence based on relationship
    const rel = getVassalRelation(overlord.id, subject.id);
    if (rel) {
        // High autonomy = subject governs alone
        // Low autonomy = overlord's style applies
        const overlordInfluence = 1 - (rel.autonomy || 0.5);

        // Resentment undermines effective governance
        const resentmentPenalty = (rel.resentment || 0) * 2;

        gov -= resentmentPenalty;
        gov *= (1 - overlordInfluence * 0.2); // overlord control is less efficient
    }

    return Math.max(0, gov);
}
```

Resentful vassals have worse governance, spawning more problems, which increases resentment - a death spiral that leads to rebellion.

---

## Map Visualization

Governance can be rendered as an overlay:

```javascript
function getGovernanceColor(gov) {
    if (gov >= 80) return [50, 150, 50, 0.3];   // deep green - heartland
    if (gov >= 60) return [100, 180, 100, 0.3]; // green - governed
    if (gov >= 40) return [180, 180, 80, 0.3];  // yellow - frontier
    if (gov >= 20) return [200, 120, 50, 0.3];  // orange - lawless
    return [180, 50, 50, 0.3];                   // red - ungoverned
}
```

This creates visible "governance maps" showing where control is strong vs weak.

---

## Strategic Implications

### Natural Empire Limits

Governance range + terrain difficulty creates natural borders. A town can't effectively control:
- Distant territory
- Mountain regions
- Forest frontiers
- Areas beyond their admin capacity

Empires grow until governance costs exceed benefits.

### Conquest Burden

Conquering territory means inheriting its governance problems:

```javascript
function onTerritoryConquest(chunk, oldOwner, newOwner) {
    // Governance crashes during transition
    chunk.v.gov = chunk.v.gov || {};
    chunk.v.gov.value *= 0.3;

    // Problems proliferate
    if (Math.random() < 0.4) {
        spawnProblem(chunk, { type: "bandits", severity: 2 });
    }

    // Takes time to establish new authority
    chunk.v.gov.contested = planet.day + 30;
}
```

This makes conquest costly - you don't just win land, you inherit chaos.

### Defensive Depth

Low-governance frontier can be *strategic* - invaders struggle in lawless territory too:

```javascript
function getInvasionDifficulty(chunk) {
    const gov = chunk.v.gov?.value || 0;

    // Low governance = hostile territory for everyone
    if (gov < 30) {
        return 1.5; // 50% harder to traverse/supply
    }

    return 1.0;
}
```

Empires might deliberately under-govern buffer zones.

---

## Configuration

```javascript
const GOVERNANCE_CONFIG = {
    updateInterval: 3,          // days between full recalculation
    decayRate: 0.5,             // per day when unsupported
    spawnCheckInterval: 1,      // days between problem spawn checks

    thresholds: {
        heartland: 80,
        governed: 60,
        frontier: 40,
        lawless: 20
    },

    baseRange: 5,
    baseTownGovernance: 30,

    terrainFactors: {
        grass: 1.0,
        forest: 0.7,
        mountain: 0.5,
        wetland: 0.6,
        desert: 0.8,
        tundra: 0.7
    },

    problemTypes: {
        bandits: { threshold: 50, resolution: 60, weight: 30 },
        smugglers: { threshold: 45, resolution: 55, weight: 20 },
        heresy: { threshold: 40, resolution: 50, weight: 15 },
        taxEvasion: { threshold: 35, resolution: 45, weight: 25 },
        rebelCamp: { threshold: 25, resolution: 40, weight: 10 },
        rivalClaimant: { threshold: 20, resolution: 35, weight: 5 }
    }
};
```

---

## Summary

Governance creates *meaningful territory*. Land isn't just colored pixels - it's a liability or an asset depending on how well you control it.

This connects to:
- **Vassals** - resentment undermines governance, creating death spirals
- **Legitimacy** - illegitimate rulers can't project authority
- **Admin strain** - overextension literally spawns problems
- **Raiders** - low-governance areas attract external threats too
- **Secession** - frontier regions with rival claimants may break away
- **Religion** - heresy spawns in neglected territory
- **Trade** - bandits/smugglers disrupt routes
- **Military** - garrisons project governance, but cost resources

The system explains why empires fall: not from external conquest, but from internal decay at the edges that spreads inward.
