# Road Network System

## Core Concept

Roads emerge organically from traffic. Routes create tracks, tracks become roads, roads attract more traffic. The network crystallizes over time into major arteries connecting centers of activity.

```
Trade route crosses wilderness
    ↓
Traffic accumulates on chunks
    ↓
High-traffic chunks become tracks
    ↓
Tracks reduce movement cost
    ↓
More routes prefer tracks
    ↓
Tracks upgrade to roads
    ↓
Crossroads emerge at junctions
    ↓
Crossroads attract settlement
```

No explicit road-building required. Infrastructure follows behavior, then behavior follows infrastructure.

**Decisions locked in:**
- Roads are **visible by default** on the map.
- Roads are **world‑persistent** (they don’t disappear), but they **decay** and can downgrade.
- Religious pilgrimages **use the shared path cache**.
- Road damage is **explicit only for notable events** (major raids/war impacts/high‑level roads).

**Performance guardrails (required):**
- Avoid full‑map scans each day; update **only road chunks** or **batched regions**.
- Throttle heavy updates (roads/segments/crossroads) to multi‑day intervals.
- Use shared path caching for **all** traffic types.
- Landmark traffic generation should be **spatially filtered** or **round‑robin** processed.

---

## Data Structure

### Per-Chunk State

```javascript
chunk.v.road = {
    traffic: 0,         // accumulated usage (decays slowly)
    level: 0,           // 0=none, 1=track, 2=road, 3=highway
    condition: 1.0,     // 0-1, degrades with use and neglect
    builtDay: null,     // when level first rose above 0
    lastMaintenance: 0  // day of last repair
};
```

### Network Overlay (for routing/rendering)

The network connects **significant places**, not just towns:

```javascript
// Optional, if needed for UI/analytics. Keep in sync on a slower cadence (e.g., every 30 days).
planet.roadNetwork = {
    nodes: [
        // Towns
        { id: 1, type: "town", chunkX: 50, chunkY: 30, townId: 1 },
        { id: 2, type: "town", chunkX: 80, chunkY: 40, townId: 2 },

        // Landmarks generate traffic too
        { id: 3, type: "wonder", chunkX: 65, chunkY: 35, markerId: 5, subtype: "cathedral" },
        { id: 4, type: "holy_site", chunkX: 70, chunkY: 50, markerId: 8 },
        { id: 5, type: "resource", chunkX: 55, chunkY: 45, markerId: 12, subtype: "mine" },
        { id: 6, type: "fort", chunkX: 60, chunkY: 30, markerId: 15 },

        // Emergent nodes
        { id: 7, type: "crossroads", chunkX: 62, chunkY: 38, formed: 150 }
    ],
    segments: [
        { from: 1, to: 3, level: 2, path: ["50,30", "51,31", ...] },
        { from: 3, to: 7, level: 2, path: ["65,35", "63,36", ...] },
        { from: 7, to: 2, level: 1, path: ["62,38", "65,39", ...] }
    ],
    lastUpdate: 0
};
```

### Node Types

| Type | Traffic Source | Notes |
|------|----------------|-------|
| `town` | Trade, military, migration | Primary network anchors |
| `wonder` | Pilgrims, scholars, tourists | Great works draw visitors |
| `holy_site` | Religious pilgrimage | Persistent even if nearby town falls |
| `resource` | Extraction, trade caravans | Mines, forests, quarries |
| `fort` | Military supply lines | Strategic roads to garrisons |
| `cultural` | Visitors, performers | Theaters, museums, galleries |
| `crossroads` | Emergent from traffic | Can become towns |
| `port` | Sea/land trade interface | Where land routes meet water |

---

## Configuration

```javascript
const ROAD_CONFIG = {
    // Traffic thresholds for road levels
    thresholds: {
        track: 20,      // dirt track forms
        road: 60,       // proper road
        highway: 150    // major highway
    },

    // Movement cost multipliers by road level
    costMultiplier: {
        0: 1.0,         // no road
        1: 0.7,         // track
        2: 0.4,         // road
        3: 0.25         // highway
    },

    // Traffic decay per day (old traffic fades)
    trafficDecay: 0.005,

    // Condition decay per day
    conditionDecay: {
        base: 0.002,            // neglect
        perTraffic: 0.0001      // wear from use
    },

    // Condition threshold for downgrade
    degradeThreshold: 0.25,

    // Governance bonus per road level
    governanceBonus: {
        0: 0,
        1: 5,
        2: 12,
        3: 20
    },

    // Crossroads detection
    crossroads: {
        minRoadLevel: 2,        // need proper roads
        minConnections: 3,      // 3+ directions
        minDistance: 5          // chunks between crossroads
    },

    // Rendering
    colors: {
        1: "rgba(139, 119, 101, 0.8)",  // brown track
        2: "rgba(128, 128, 128, 0.9)",  // gray road
        3: "rgba(220, 220, 220, 1.0)"   // white highway
    },
    widths: {
        1: 1,
        2: 2,
        3: 3
    }
};
```

---

## Base Terrain Costs

Movement cost before roads:

| Terrain | Cost | Reason |
|---------|------|--------|
| Grass | 1.0 | Easy travel |
| Forest | 2.0 | Dense, slow |
| Desert | 1.5 | Open but harsh |
| Wetland | 2.5 | Boggy, difficult |
| Tundra | 1.8 | Cold, sparse |
| Hill | 2.0 | Elevation |
| Mountain | 8.0 | Nearly impassable |
| Snow | 2.5 | Cold, deep |
| Badlands | 2.2 | Rough terrain |
| Water | ∞ | Requires ships |

```javascript
const BASE_TERRAIN_COST = {
    grass: 1.0,
    forest: 2.0,
    desert: 1.5,
    wetland: 2.5,
    tundra: 1.8,
    mountain: 8.0,
    snow: 2.5,
    badlands: 2.2,
    water: Infinity
};
```

---

## Core Functions

### Traffic Recording

Every movement (trade, military, migration) records traffic:

```javascript
function recordTraffic(path, amount = 1) {
    if (!path || !Array.isArray(path)) return;

    path.forEach(chunk => {
        if (!chunk || chunk.b === "water") return;

        chunk.v.road = chunk.v.road || {
            traffic: 0,
            level: 0,
            condition: 1.0,
            builtDay: null,
            lastMaintenance: 0
        };

        chunk.v.road.traffic += amount;
    });
}

// Usage examples:
// recordTraffic(tradeRoutePath, 2);      // trade caravans
// recordTraffic(armyPath, 5);            // military movement
// recordTraffic(migrationPath, 1);       // population movement
// recordTraffic(pilgrimagePath, 1.5);    // religious pilgrimage
// recordTraffic(resourcePath, 3);        // extraction hauling
```

**Performance note:** Traffic should only be recorded for paths pulled from the shared cache; avoid recomputing paths per‑movement.

### Movement Cost Calculation

```javascript
function getMovementCost(chunk) {
    if (!chunk) return Infinity;
    if (chunk.b === "water") return Infinity;

    // Base terrain cost
    let cost = BASE_TERRAIN_COST[chunk.b] || 1.5;

    // Road reduction
    const road = chunk.v.road;
    if (road && road.level > 0 && road.condition > 0.1) {
        const reduction = ROAD_CONFIG.costMultiplier[road.level] || 1.0;
        // Poor condition reduces benefit
        const conditionFactor = 0.5 + (road.condition * 0.5);
        cost *= reduction / conditionFactor;
    }

    return Math.max(0.1, cost);
}
```

### Road Level Updates

```javascript
function updateRoadLevels() {
    forEachChunk(chunk => {
        const r = chunk.v.road;
        if (!r) return;

        const oldLevel = r.level;
        let newLevel = 0;

        if (r.traffic >= ROAD_CONFIG.thresholds.highway) {
            newLevel = 3;
        } else if (r.traffic >= ROAD_CONFIG.thresholds.road) {
            newLevel = 2;
        } else if (r.traffic >= ROAD_CONFIG.thresholds.track) {
            newLevel = 1;
        }

        // Can only upgrade, not instant downgrade (that's from decay)
        if (newLevel > r.level) {
            r.level = newLevel;
            if (!r.builtDay) r.builtDay = planet.day;
        }
    });
}
```

### Traffic and Condition Decay

Roads are world‑persistent: once a chunk has road data, it stays, even if the town collapses. Decay should downgrade level/condition rather than delete the road object.

```javascript
function decayRoads() {
    forEachChunk(chunk => {
        const r = chunk.v.road;
        if (!r) return;

        // Traffic fades over time (old activity doesn't count forever)
        r.traffic *= (1 - ROAD_CONFIG.trafficDecay);

        // No decay for non-roads
        if (r.level === 0) return;

        // Condition decay from neglect
        let decay = ROAD_CONFIG.conditionDecay.base;

        // Additional wear from heavy traffic
        decay += r.traffic * ROAD_CONFIG.conditionDecay.perTraffic;

        // Higher level roads decay faster (more to maintain)
        decay *= (1 + r.level * 0.2);

        r.condition = Math.max(0, r.condition - decay);

        // Downgrade if condition too low
        if (r.condition < ROAD_CONFIG.degradeThreshold) {
            r.level = Math.max(0, r.level - 1);
            r.condition = 0.7; // partial reset after downgrade

            if (r.level === 0) {
                // Road fully degraded
                r.traffic *= 0.5; // lose accumulated traffic too
            }
        }
    });
}
```

**Performance note:** `decayRoads` should iterate only over chunks that already have `chunk.v.road` (or maintain a list of road chunks) rather than scanning the whole world.

### Road Maintenance

Towns can invest to maintain roads:

```javascript
function maintainRoads(town, investmentLevel = 1) {
    const territory = filterChunks(c => c.v.s === town.id);
    const roadChunks = territory.filter(c => c.v.road && c.v.road.level > 0);

    if (roadChunks.length === 0) return;

    // Cost scales with road network size
    const cost = roadChunks.length * investmentLevel * 2;
    if ((town.resources?.cash || 0) < cost) return false;

    happen("Resource", null, town, { cash: -cost });

    roadChunks.forEach(chunk => {
        const repair = 0.1 * investmentLevel;
        chunk.v.road.condition = Math.min(1.0, chunk.v.road.condition + repair);
        chunk.v.road.lastMaintenance = planet.day;
    });

    return true;
}
```

---

## Landmark Traffic Generation

Landmarks generate traffic independently of trade routes. Each type attracts different volumes and types of visitors.

### Traffic by Landmark Type

| Landmark | Base Traffic | Modifiers | Path Target |
|----------|--------------|-----------|-------------|
| Wonder (cathedral, monument) | 3-5 | +faith influence, +prestige | Nearest towns + religious centers |
| Holy site | 2-4 | +religion followers, +faith | All towns sharing religion |
| Mine/quarry | 2-3 | +town wealth, +trade influence | Owning town + trade partners |
| Fort/garrison | 1-2 | +military influence, +war state | Owning town capital |
| Theater/museum/gallery | 1-2 | +education, +culture prestige | Nearby towns |
| Library | 1-2 | +education influence | Towns with scholars |
| Port | 2-3 | +trade routes through | Connected coastal towns |

### Landmark Traffic Function

```javascript
function generateLandmarkTraffic() {
    const landmarks = regFilter("marker", m => m && !m.end && isTrafficLandmark(m));

    landmarks.forEach(marker => {
        const chunk = getMarkerChunk(marker);
        if (!chunk) return;

        const trafficSources = getLandmarkTrafficSources(marker);
        const baseTraffic = getLandmarkBaseTraffic(marker);

        trafficSources.forEach(source => {
            const path = getCachedPath(source, { x: chunk.x, y: chunk.y });
            if (path && path.length > 0) {
                const traffic = baseTraffic * getLandmarkTrafficModifier(marker, source);
                recordTraffic(path, traffic);
            }
        });
    });
}

function isTrafficLandmark(marker) {
    const trafficTypes = [
        "wonder", "holy_site", "cathedral", "monument",
        "mine", "quarry", "fort", "garrison",
        "theater", "museum", "gallery", "library", "port"
    ];
    return trafficTypes.includes(marker.subtype) || trafficTypes.includes(marker.type);
}

function getLandmarkBaseTraffic(marker) {
    const trafficMap = {
        wonder: 4,
        cathedral: 4,
        monument: 3,
        holy_site: 3,
        mine: 2.5,
        quarry: 2,
        fort: 1.5,
        garrison: 1.5,
        theater: 1.5,
        museum: 1.5,
        gallery: 1,
        library: 1.5,
        port: 2.5
    };
    return trafficMap[marker.subtype] || trafficMap[marker.type] || 1;
}

function getLandmarkTrafficSources(marker) {
    const sources = [];
    const chunk = getMarkerChunk(marker);
    if (!chunk) return sources;

    const ownerTown = chunk.v.s ? regGet("town", chunk.v.s) : null;

    switch (marker.subtype || marker.type) {
        case "wonder":
        case "cathedral":
        case "monument":
            // Draw from nearby towns + religious centers
            sources.push(...regFilter("town", t =>
                !t.end && getDistance(t, chunk) < 50
            ));
            break;

        case "holy_site":
            // Draw from all towns sharing religion
            if (marker.religion) {
                sources.push(...regFilter("town", t =>
                    !t.end && t.religion === marker.religion
                ));
            }
            break;

        case "mine":
        case "quarry":
            // Draw from owner + trade partners
            if (ownerTown) {
                sources.push(ownerTown);
                const partners = getTradePartners(ownerTown);
                sources.push(...partners);
            }
            break;

        case "fort":
        case "garrison":
            // Supply line from owner capital
            if (ownerTown) {
                sources.push(ownerTown);
            }
            break;

        case "theater":
        case "museum":
        case "gallery":
        case "library":
            // Draw from nearby educated/cultured towns
            sources.push(...regFilter("town", t =>
                !t.end &&
                getDistance(t, chunk) < 30 &&
                ((t.influences?.education || 0) > 3 || (t.culture?.prestige || 0) > 5)
            ));
            break;

        case "port":
            // Draw from connected coastal towns
            if (ownerTown) {
                sources.push(ownerTown);
                sources.push(...regFilter("town", t =>
                    !t.end && isTownCoastal(t) && t.id !== ownerTown.id
                ));
            }
            break;

        default:
            // Default: nearby towns
            sources.push(...regFilter("town", t =>
                !t.end && getDistance(t, chunk) < 20
            ));
    }

    return sources.filter(s => s && !s.end);
}

function getLandmarkTrafficModifier(marker, source) {
    let modifier = 1.0;

    // Religious sites get boost from faith
    if (["holy_site", "cathedral"].includes(marker.subtype)) {
        modifier += (source.influences?.faith || 0) * 0.1;
    }

    // Cultural sites get boost from education
    if (["library", "museum", "theater"].includes(marker.subtype)) {
        modifier += (source.influences?.education || 0) * 0.08;
    }

    // Wonders get boost from prestige
    if (marker.subtype === "wonder" || marker.subtype === "monument") {
        const prestige = source.culture?.prestige || 0;
        modifier += prestige * 0.05;
    }

    // Resource sites get boost from trade
    if (["mine", "quarry", "port"].includes(marker.subtype)) {
        modifier += (source.influences?.trade || 0) * 0.08;
    }

    // Distance penalty
    const chunk = getMarkerChunk(marker);
    if (chunk && source.x !== undefined) {
        const dist = getDistance(source, chunk);
        modifier *= Math.max(0.3, 1 - dist / 100);
    }

    return Math.max(0.1, modifier);
}
```

### Pilgrimage Routes

Holy sites create persistent pilgrimage routes that maintain roads even without trade. Pilgrimages should use the **same cached paths** as other traffic.

```javascript
function generatePilgrimageRoutes() {
    if (!planet.religions) return;

    planet.religions.forEach(religion => {
        const holySite = getHolySite(religion);
        if (!holySite) return;

        const followers = regFilter("town", t =>
            !t.end && t.religion === religion.id
        );

        followers.forEach(town => {
            const path = getCachedPath(town, holySite);
            if (!path) return;

            // Pilgrimage traffic scales with faith and distance
            const faith = town.influences?.faith || 0;
            const distance = path.length;
            const traffic = Math.max(0.5, 2 + faith * 0.3 - distance * 0.02);

            recordTraffic(path, traffic);

            // Mark as pilgrimage route for rendering
            path.forEach(chunk => {
                if (chunk.v.road) {
                    chunk.v.road.pilgrimage = true;
                }
            });
        });
    });
}
```

### Resource Extraction Routes

Mines and quarries create heavy traffic that builds roads quickly:

```javascript
function generateResourceRoutes() {
    const resourceMarkers = regFilter("marker", m =>
        m && !m.end && ["mine", "quarry", "lumber"].includes(m.subtype)
    );

    resourceMarkers.forEach(marker => {
        const chunk = getMarkerChunk(marker);
        const owner = chunk?.v.s ? regGet("town", chunk.v.s) : null;
        if (!owner) return;

        // Heavy extraction traffic
        const path = getCachedPath(owner, { x: chunk.x, y: chunk.y });
        if (!path) return;

        // Resource traffic scales with town trade/industry
        const trade = owner.influences?.trade || 0;
        const traffic = 2 + trade * 0.3;

        recordTraffic(path, traffic);

        // Also record to trade partners
        const partners = getTradePartners(owner);
        partners.forEach(partner => {
            const partnerPath = getCachedPath(partner, { x: chunk.x, y: chunk.y });
            if (partnerPath) {
                recordTraffic(partnerPath, traffic * 0.5);
            }
        });
    });
}
```

### Daily Landmark Traffic Event

```javascript
modEvent("landmarkTrafficUpdate", {
    daily: true,
    subject: { reg: "player", id: 1 },
    value: () => planet.day % 3 === 0, // every 3 days
    func: () => {
        // Process a subset each tick (round-robin or spatially filtered)
        generateLandmarkTraffic();
        generatePilgrimageRoutes();
        generateResourceRoutes();
    }
});
```

**Performance note:** Landmark traffic generation should be batched (e.g., 1/3 of landmarks per day or per‑region), not full‑scan each tick on large worlds.

---

## Pathfinding (A*)

Standard A* with terrain + road costs:

```javascript
function findPath(startChunk, endChunk) {
    const openSet = new PriorityQueue();
    const cameFrom = new Map();
    const gScore = new Map();
    const fScore = new Map();

    const startKey = chunkKey(startChunk);
    const endKey = chunkKey(endChunk);

    gScore.set(startKey, 0);
    fScore.set(startKey, heuristic(startChunk, endChunk));
    openSet.enqueue(startChunk, fScore.get(startKey));

    while (!openSet.isEmpty()) {
        const current = openSet.dequeue();
        const currentKey = chunkKey(current);

        if (currentKey === endKey) {
            return reconstructPath(cameFrom, current);
        }

        const neighbors = getNeighborChunks(current);

        for (const neighbor of neighbors) {
            const neighborKey = chunkKey(neighbor);
            const moveCost = getMovementCost(neighbor);

            if (moveCost === Infinity) continue; // impassable

            const tentativeG = gScore.get(currentKey) + moveCost;

            if (!gScore.has(neighborKey) || tentativeG < gScore.get(neighborKey)) {
                cameFrom.set(neighborKey, current);
                gScore.set(neighborKey, tentativeG);
                fScore.set(neighborKey, tentativeG + heuristic(neighbor, endChunk));

                if (!openSet.contains(neighborKey)) {
                    openSet.enqueue(neighbor, fScore.get(neighborKey));
                }
            }
        }
    }

    return null; // no path found
}

function heuristic(a, b) {
    // Manhattan distance, scaled by minimum terrain cost
    return (Math.abs(a.x - b.x) + Math.abs(a.y - b.y)) * 0.9;
}

function reconstructPath(cameFrom, current) {
    const path = [current];
    let key = chunkKey(current);

    while (cameFrom.has(key)) {
        current = cameFrom.get(key);
        key = chunkKey(current);
        path.unshift(current);
    }

    return path;
}

function chunkKey(chunk) {
    return `${chunk.x},${chunk.y}`;
}
```

### Path Caching

Routes don't need to recalculate every day:

```javascript
function getCachedPath(from, to, maxAge = 30) {
    const cacheKey = `${from.id}-${to.id}`;

    if (!planet._pathCache) planet._pathCache = {};

    const cached = planet._pathCache[cacheKey];
    if (cached && (planet.day - cached.day) < maxAge) {
        return cached.path;
    }

    const fromChunk = getTownCenterChunk(from);
    const toChunk = getTownCenterChunk(to);
    const path = findPath(fromChunk, toChunk);

    planet._pathCache[cacheKey] = {
        path: path,
        day: planet.day
    };

    return path;
}

function invalidatePathCache() {
    // Call when roads significantly change
    planet._pathCache = {};
}
```

**Policy:** All movement types (trade, migration, pilgrimage, military, resource hauling) must use `getCachedPath` rather than fresh pathfinding. Only invalidate the cache on major road‑level changes or periodic long‑interval refresh.

---

## Crossroads Detection

Junctions become significant locations:

```javascript
function detectCrossroads() {
    const candidates = [];

    forEachChunk(chunk => {
        const r = chunk.v.road;
        if (!r || r.level < ROAD_CONFIG.crossroads.minRoadLevel) return;

        const roadNeighbors = getNeighborChunks(chunk).filter(n =>
            n.v.road && n.v.road.level >= 1
        );

        if (roadNeighbors.length >= ROAD_CONFIG.crossroads.minConnections) {
            candidates.push(chunk);
        }
    });

    // Filter out chunks too close to existing nodes
    const newCrossroads = candidates.filter(chunk => {
        const nearbyNode = planet.roadNetwork?.nodes?.find(node => {
            const dist = Math.abs(node.chunkX - chunk.x) + Math.abs(node.chunkY - chunk.y);
            return dist < ROAD_CONFIG.crossroads.minDistance;
        });
        return !nearbyNode;
    });

    // Create crossroads nodes
    newCrossroads.forEach(chunk => {
        createCrossroadsNode(chunk);
    });
}

function createCrossroadsNode(chunk) {
    if (!planet.roadNetwork) {
        planet.roadNetwork = { nodes: [], segments: [], lastUpdate: 0 };
    }

    const node = {
        id: Date.now(),
        type: "crossroads",
        chunkX: chunk.x,
        chunkY: chunk.y,
        formed: planet.day,
        traffic: chunk.v.road?.traffic || 0
    };

    planet.roadNetwork.nodes.push(node);

    // Crossroads can attract settlement
    chunk.v.crossroads = node.id;

    logMessage(`A crossroads forms where the roads meet.`);
}
```

### Crossroads → Town

Busy crossroads can become towns:

```javascript
function checkCrossroadsSettlement() {
    if (!planet.roadNetwork?.nodes) return;

    const crossroads = planet.roadNetwork.nodes.filter(n => n.type === "crossroads");

    crossroads.forEach(node => {
        const chunk = planet.chunks[`${node.chunkX},${node.chunkY}`];
        if (!chunk || chunk.v.s) return; // already claimed

        const age = planet.day - node.formed;
        const traffic = chunk.v.road?.traffic || 0;

        // Needs age and sustained traffic
        if (age < 50) return;
        if (traffic < 100) return;

        // Random chance, higher with more traffic
        const chance = 0.01 + (traffic / 10000);
        if (Math.random() > chance) return;

        // Found a new town at the crossroads
        // Respect base settlement pacing (e.g., daysPerColony, planet.lastColony)
        const newTown = happen("Create", null, null, {
            type: "town",
            x: node.chunkX * chunkSize,
            y: node.chunkY * chunkSize,
            pop: 10 + Math.floor(traffic / 20),
            name: generateCrossroadsName()
        }, "town");

        if (newTown) {
            node.type = "town";
            node.townId = newTown.id;
            logMessage(`A town rises at the crossroads: {{regname:town|${newTown.id}}}.`, "milestone");
        }
    });
}

function generateCrossroadsName() {
    const prefixes = ["Cross", "Meeting", "Junction", "Fork", "Middle"];
    const suffixes = ["ford", "way", "ton", "stead", "haven", "gate"];
    return choose(prefixes) + choose(suffixes);
}
```

---

## Rendering

Roads are rendered **by default** (no toggle required). Canvas layer for road visualization:

```javascript
function initRoadLayer() {
    if (typeof addCanvasLayer !== "function") return false;
    if (!canvasLayers.roads) {
        addCanvasLayer("roads");

        // Position below towns, above terrain
        const roadsIndex = canvasLayersOrder.indexOf("roads");
        const townsIndex = canvasLayersOrder.indexOf("towns");
        if (roadsIndex > townsIndex) {
            canvasLayersOrder.splice(roadsIndex, 1);
            canvasLayersOrder.splice(townsIndex, 0, "roads");
        }
    }
    return true;
}

function renderRoads() {
    if (!canvasLayersCtx?.roads) return;

    const ctx = canvasLayersCtx.roads;
    const canvas = canvasLayers.roads;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Build segments from adjacent road chunks
    const segments = buildRoadSegments();

    segments.forEach(segment => {
        if (segment.level === 0) return;

        ctx.strokeStyle = ROAD_CONFIG.colors[segment.level];
        ctx.lineWidth = ROAD_CONFIG.widths[segment.level];
        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        ctx.beginPath();

        segment.chunks.forEach((chunk, i) => {
            const x = chunk.x * chunkSize + chunkSize / 2;
            const y = chunk.y * chunkSize + chunkSize / 2;

            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        });

        ctx.stroke();
    });

    // Draw crossroads markers
    if (planet.roadNetwork?.nodes) {
        planet.roadNetwork.nodes
            .filter(n => n.type === "crossroads")
            .forEach(node => {
                const x = node.chunkX * chunkSize + chunkSize / 2;
                const y = node.chunkY * chunkSize + chunkSize / 2;

                ctx.fillStyle = "rgba(200, 180, 100, 0.9)";
                ctx.beginPath();
                ctx.arc(x, y, 3, 0, Math.PI * 2);
                ctx.fill();
            });
    }
}

function buildRoadSegments() {
    const visited = new Set();
    const segments = [];

    // Prefer iterating only road chunks rather than every chunk in the world.
    forEachChunk(chunk => {
        const key = chunkKey(chunk);
        if (visited.has(key)) return;
        if (!chunk.v.road || chunk.v.road.level === 0) return;

        // Start a new segment
        const segment = {
            level: chunk.v.road.level,
            chunks: []
        };

        // Follow connected road chunks
        const queue = [chunk];
        while (queue.length > 0) {
            const current = queue.shift();
            const currentKey = chunkKey(current);

            if (visited.has(currentKey)) continue;
            visited.add(currentKey);

            segment.chunks.push(current);

            // Find connected road chunks at same or higher level
            const neighbors = getNeighborChunks(current).filter(n =>
                n.v.road &&
                n.v.road.level >= segment.level &&
                !visited.has(chunkKey(n))
            );

            queue.push(...neighbors);
        }

        if (segment.chunks.length > 0) {
            segments.push(segment);
        }
    });

    return segments;
}
```

---

## Integration with Existing Systems

### Trade Routes

```javascript
function updateTradeRoute(route) {
    const town1 = regGet("town", route.town1);
    const town2 = regGet("town", route.town2);
    if (!town1 || !town2) return;

    // Get current best path (may have changed as roads formed)
    const path = getCachedPath(town1, town2);
    if (!path) return;

    route.currentPath = path;
    route.pathLength = path.length;

    // Calculate travel time based on actual path costs
    let totalCost = 0;
    path.forEach(chunk => {
        totalCost += getMovementCost(chunk);
    });
    route.travelTime = Math.ceil(totalCost);

    // Record traffic from trade activity
    if (route.active) {
        recordTraffic(path, route.caravans || 1);
    }
}
```

### Infrastructure

Road condition should **feed into town infrastructure** (or vice‑versa) rather than running as a totally separate decay loop. Keep a single source of truth for road quality penalties:

- If chunk roads are the source, aggregate an average road condition per town and map it to `town.infrastructure.roads`.
- If town infrastructure is the source, use it to bias road condition decay/repair.

### Governance

Roads project authority:

```javascript
function getRoadGovernanceBonus(chunk) {
    const road = chunk.v.road;
    if (!road || road.level === 0) return 0;

    let bonus = ROAD_CONFIG.governanceBonus[road.level] || 0;

    // Poor condition reduces bonus
    bonus *= road.condition;

    return bonus;
}

// In calculateChunkGovernance:
// gov += getRoadGovernanceBonus(chunk);
```

### Raiders

Roads are targets and enablers:
Road damage should only be explicitly logged when notable (e.g., a level‑2/3 road is damaged, or a major raid/war causes a visible downgrade).

```javascript
function getRaiderTargetValue(chunk) {
    let value = 0;

    // Roads mean traffic to raid
    if (chunk.v.road && chunk.v.road.level > 0) {
        value += chunk.v.road.traffic * 0.1;
        value += chunk.v.road.level * 5;
    }

    // Crossroads are prime targets
    if (chunk.v.crossroads) {
        value += 20;
    }

    return value;
}

function applyRaiderRoadDamage(chunk) {
    if (!chunk.v.road) return;

    // Raiders damage road condition
    chunk.v.road.condition -= 0.1;

    // Disrupt traffic
    chunk.v.road.traffic *= 0.8;
}
```

### Military Movement

Armies move faster on roads:

```javascript
function calculateArmyTravelTime(from, to) {
    const path = getCachedPath(from, to);
    if (!path) return Infinity;

    let totalCost = 0;
    path.forEach(chunk => {
        totalCost += getMovementCost(chunk);
    });

    // Record military traffic (heavier than trade)
    recordTraffic(path, 3);

    return Math.ceil(totalCost);
}
```

### Vassals

Overlord roads extend into subject territory:

```javascript
function getVassalRoadIntegration(overlord, subject) {
    // Check if road connects overlord to subject
    const path = getCachedPath(overlord, subject);
    if (!path) return 0;

    // Average road level along path
    let totalLevel = 0;
    path.forEach(chunk => {
        totalLevel += chunk.v.road?.level || 0;
    });

    const avgLevel = totalLevel / path.length;

    // Better roads = more control but also easier rebellion coordination
    return avgLevel;
}
```

---

## Daily Update Event

```javascript
modEvent("roadNetworkUpdate", {
    daily: true,
    subject: { reg: "player", id: 1 },
    func: () => {
        // Decay traffic and condition (throttled to reduce per-day cost)
        if (planet.day % 3 === 0) {
            decayRoads();
        }

        // Update road levels based on current traffic (throttled)
        if (planet.day % 3 === 0) {
            updateRoadLevels();
        }

        // Detect new crossroads (less frequent)
        if (planet.day % 10 === 0) {
            detectCrossroads();
        }

        // Check for crossroads settlement (rare)
        if (planet.day % 30 === 0) {
            checkCrossroadsSettlement();
        }

        // Re-render roads layer
        if (typeof renderRoads === "function") {
            renderRoads();
        }
    }
});
```

---

## Automatic Maintenance Event

Towns maintain their roads based on wealth and priorities:

```javascript
modEvent("townRoadMaintenance", {
    daily: true,
    subject: { reg: "town", all: true },
    value: (subject) => {
        if (subject.end) return false;
        if (planet.day % 10 !== 0) return false; // every 10 days
        return true;
    },
    func: (subject) => {
        const territory = filterChunks(c => c.v.s === subject.id);
        const roadChunks = territory.filter(c => c.v.road && c.v.road.level > 0);

        if (roadChunks.length === 0) return;

        // Wealthy towns maintain roads better
        const wealth = subject.resources?.cash || 0;
        const trade = subject.influences?.trade || 0;

        // Base investment level
        let investment = 0.5;
        if (wealth > 100) investment += 0.3;
        if (trade > 5) investment += 0.2;

        // Authoritarian governments maintain infrastructure better
        if (subject.governmentType === "dictatorship") investment += 0.2;
        if (subject.governmentType === "monarchy") investment += 0.1;

        // Values affect priorities
        if (subject.values?.order > 3) investment += 0.1;
        if (subject.values?.wealth < -3) investment -= 0.2; // sharing = less infrastructure

        if (investment > 0 && Math.random() < investment) {
            maintainRoads(subject, 1);
        }
    }
});
```

---

## Strategic Implications

### Roads as Assets

| Situation | Implication |
|-----------|-------------|
| War | Cut enemy roads to slow reinforcements, damage trade |
| Defense | Roads let you respond quickly to threats |
| Expansion | Settle along roads or pioneer new routes |
| Investment | Maintain roads or let frontier decay |
| Raiders | Roads attract raiders but also enable response |

### Network Effects

- Early roads attract more traffic → self-reinforcing
- Major arteries become strategic
- Alternative routes matter when main road cut
- Isolated towns stay isolated (no traffic → no roads)

### Emergence

- No one "builds" the road network
- It crystallizes from accumulated activity
- Reflects actual patterns of movement and trade
- Changes over time as traffic patterns shift

---

## Summary

Roads emerge from traffic, creating visible infrastructure that:

- **Reduces movement costs** - Faster trade, military, migration
- **Projects governance** - Authority follows roads
- **Attracts raiders** - Traffic means targets
- **Creates strategic geography** - Crossroads, chokepoints, arteries
- **Requires maintenance** - Investment or decay
- **Spawns settlements** - Crossroads become towns

The system is self-organizing: roads form where needed, strengthen with use, and decay when neglected. The map becomes a record of accumulated activity, showing where civilization flows.
