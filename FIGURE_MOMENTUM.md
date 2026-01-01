# Figure Momentum System

## Core Concept

Notable figures develop **momentum** - a dynamic reputation that rises with success and falls with failure. This creates emergent stars and spectacular collapses, adding drama to leadership and making figure selection meaningful.

```
Success → momentum rises → bonuses → more likely to succeed → star emerges
Failure → momentum falls → penalties → more likely to fail → crisis of confidence
```

Momentum is not permanent reputation - it's *current form*. A legendary general can have a bad year. A nobody can catch fire.

---

## Data Structure

```javascript
figure.momentum = {
    value: 0,           // -10 to +10
    streak: 0,          // consecutive same-direction results
    peakValue: 0,       // historical high
    troughValue: 0,     // historical low
    lastChangeDay: 0,
    history: []         // recent events that affected momentum
};
```

---

## Momentum Effects

### By Figure Type

| Figure Type | High Momentum | Low Momentum |
|-------------|---------------|--------------|
| **General** | War battles more likely won, troops don't break, enemies hesitate to engage | Defeats more likely, troops rout early, enemies smell blood |
| **Prophet** | Predictions believed, converts easily, schisms succeed | Dismissed as false, followers doubt, rivals embolden |
| **Scholar** | Discoveries credited, students flock, town gains education | Work questioned, funding cut, brain drain risk |
| **Ruler** | Legitimacy boosted, unrest suppressed, vassals compliant | Legitimacy crumbles, plots thicken, secession risk |
| **Merchant** | Trade deals favor town, routes open, prices good | Deals go sour, partners distrust, routes close |

### Thresholds

| Range | Label | Effect |
|-------|-------|--------|
| +7 to +10 | **Ascendant** | Major bonuses, rivals hesitate, followers inspired |
| +3 to +6 | **Rising** | Moderate bonuses, growing reputation |
| -2 to +2 | **Steady** | Baseline, no modifier |
| -6 to -3 | **Faltering** | Moderate penalties, doubts spread |
| -10 to -7 | **Collapsing** | Major penalties, vulnerable to replacement, exodus |

---

## Momentum Triggers

### Positive (momentum rises)

| Event | Shift | Notes |
|-------|-------|-------|
| War victory (participant) | +1 to +3 | Scaled by enemy strength |
| Successful prediction | +2 | Prophet only |
| Discovery/tech breakthrough | +1.5 | Scholar only |
| Survived assassination | +1 | "Blessed" or "unkillable" reputation |
| Negotiated favorable peace | +1 | |
| Famine avoided under their leadership | +1 | |
| Wonder completed | +2 | If they led the project |
| Rival publicly defeated | +1.5 | Debate, duel, or political outmaneuvering |

### Negative (momentum falls)

| Event | Shift | Notes |
|-------|-------|-------|
| War defeat (participant) | -1 to -3 | Scaled by expected outcome |
| Failed prediction | -2 | Prophet only |
| Plague under their watch | -1 | Rulers, healers |
| Assassination attempt (even if failed) | -0.5 | "Vulnerable" perception |
| Betrayal by ally | -1 | Their judgment questioned |
| Project failure | -1.5 | |
| Public humiliation | -2 | Lost debate, exposed scandal |
| Streak broken | -1 | Losing after a winning streak stings more |

### Streaks

Consecutive results amplify effect:

```javascript
function getStreakMultiplier(streak) {
    if (Math.abs(streak) <= 1) return 1.0;
    if (Math.abs(streak) <= 3) return 1.25;
    if (Math.abs(streak) <= 5) return 1.5;
    return 1.75; // 6+ streak
}
```

A general who wins 5 battles in a row gains more momentum per win. But when they finally lose, the streak-break penalty hits hard.

---

## Momentum Decay

Momentum drifts toward zero over time - staying on top requires continued success.

```javascript
const MOMENTUM_DECAY = {
    rate: 0.02,           // per day
    threshold: 1.5,       // don't decay below this absolute value
    inactivityBonus: 30   // days without events before faster decay
};

function decayMomentum(figure) {
    const m = figure.momentum;
    if (Math.abs(m.value) <= MOMENTUM_DECAY.threshold) return;

    const daysSinceChange = planet.day - m.lastChangeDay;
    let decay = MOMENTUM_DECAY.rate;

    // Faster decay if inactive
    if (daysSinceChange > MOMENTUM_DECAY.inactivityBonus) {
        decay *= 1.5;
    }

    // Decay toward zero
    if (m.value > 0) {
        m.value = Math.max(0, m.value - decay);
    } else {
        m.value = Math.min(0, m.value + decay);
    }
}
```

This means:
- You can't rest on past glory forever
- Retired figures fade from relevance
- Active figures stay in the spotlight

---

## Integration Points

### Legitimacy

Ruler momentum directly affects town legitimacy:

```javascript
function getRulerLegitimacyModifier(ruler) {
    if (!ruler || !ruler.momentum) return 0;
    return ruler.momentum.value * 0.15; // ±1.5 legitimacy at extremes
}
```

### Succession

When a ruler dies/is deposed, candidates compared partly by momentum:

```javascript
function getSuccessionScore(candidate) {
    let score = 0;
    score += candidate.claims || 0;          // legal right
    score += candidate.support || 0;          // faction backing
    score += (candidate.momentum?.value || 0) * 0.5;  // current form matters
    return score;
}
```

A high-momentum general is a natural usurper. A low-momentum heir is vulnerable.

### War Calculations

```javascript
function getWarModifier(figure) {
    if (!figure || !figure.momentum) return 1.0;
    const m = figure.momentum.value;

    if (m >= 7) return 1.3;      // ascendant: major advantage
    if (m >= 3) return 1.15;     // rising: moderate advantage
    if (m <= -7) return 0.7;     // collapsing: major disadvantage
    if (m <= -3) return 0.85;    // faltering: moderate disadvantage
    return 1.0;
}
```

### Loyalty/Defection

High-momentum figures attract followers. Low-momentum figures see defections:

```javascript
function getDefectionRisk(figure) {
    if (!figure || !figure.momentum) return 0.05;
    const m = figure.momentum.value;

    if (m >= 5) return 0.01;    // loyal followers
    if (m <= -5) return 0.15;   // rats leaving ship
    if (m <= -8) return 0.25;   // mass exodus
    return 0.05;
}
```

### Poaching/Recruitment

Towns can attempt to recruit foreign figures. Momentum affects willingness:

```javascript
function getRecruitmentDifficulty(figure, fromTown, toTown) {
    let difficulty = 0.5;
    const m = figure.momentum?.value || 0;

    // High momentum = loyal, hard to poach
    difficulty += m * 0.03;

    // Low momentum = looking for fresh start
    if (m < -3) difficulty -= 0.2;

    // Other factors...
    return clampChance(difficulty);
}
```

---

## Narrative Generation

Momentum enables richer figure descriptions:

```javascript
function getMomentumDescriptor(figure) {
    const m = figure.momentum?.value || 0;
    const type = figure.type;

    if (type === "GENERAL") {
        if (m >= 7) return "undefeated";
        if (m >= 3) return "ascendant";
        if (m <= -7) return "disgraced";
        if (m <= -3) return "struggling";
    }

    if (type === "PROPHET") {
        if (m >= 7) return "divinely touched";
        if (m >= 3) return "increasingly heeded";
        if (m <= -7) return "doubted";
        if (m <= -3) return "faltering";
    }

    // ... other types
    return null;
}
```

Annals entry:
> "The undefeated General Mira of Eastport crushed the Westmoor coalition."

vs.

> "The struggling General Mira of Eastport was routed by Westmoor."

---

## Edge Cases

### Death at Peak

Figures who die at high momentum become legends:

```javascript
function handleFigureDeath(figure) {
    const m = figure.momentum?.value || 0;

    if (m >= 7) {
        // Immortalized - permanent bonus to town prestige
        figure.legacy = "legendary";
        figure.originTown.culture.prestige += 3;
        logMessage(`{{b:${figure.name}}} dies at the height of glory. They will never be forgotten.`, "milestone");
    } else if (m <= -7) {
        // Forgotten or reviled
        figure.legacy = "forgotten";
        logMessage(`{{b:${figure.name}}} passes, unmourned.`);
    }
}
```

### Comeback Stories

Large momentum swings are notable:

```javascript
function checkComebackStory(figure, oldMomentum, newMomentum) {
    const swing = newMomentum - oldMomentum;

    // From negative to highly positive
    if (oldMomentum <= -5 && newMomentum >= 5) {
        logMessage(`{{b:${figure.name}}}'s remarkable comeback inspires the people.`, "milestone");
        figure.traits = figure.traits || [];
        figure.traits.push("comeback");
        // Bonus loyalty - people love a redemption arc
    }
}
```

---

## Configuration

```javascript
const MOMENTUM_CONFIG = {
    range: { min: -10, max: 10 },

    decay: {
        rate: 0.02,
        threshold: 1.5,
        inactivityDays: 30,
        inactivityMultiplier: 1.5
    },

    thresholds: {
        ascendant: 7,
        rising: 3,
        faltering: -3,
        collapsing: -7
    },

    effects: {
        warModifierScale: 0.03,       // per momentum point
        legitimacyScale: 0.15,
        defectionBaseRisk: 0.05,
        recruitmentScale: 0.03
    },

    streakMultipliers: [1.0, 1.0, 1.25, 1.25, 1.5, 1.5, 1.75]
};
```

---

## Summary

Momentum makes figures *dynamic*. Instead of static traits, they have arcs:

- Rising stars who seem unstoppable (until they're not)
- Veterans on losing streaks, one defeat from disgrace
- Comeback stories that inspire loyalty
- Legends who die at their peak and become myths

This connects to:
- **Legitimacy** - ruler momentum affects stability
- **Succession** - high-momentum figures are natural usurpers
- **Wars** - generals carry their form into battle
- **Defection** - failing figures lose followers
- **Memory** - peak/trough moments become historical touchstones
- **Prestige** - legendary deaths boost town culture

The system creates narratives that feel authored but emerge from mechanics.
