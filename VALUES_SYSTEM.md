# Town Values System - Design Document

## Overview

Towns develop **moral identities** through the decisions made during crises. Rather than having random or fixed personalities, towns earn their character through accumulated choices. This creates emergent civilizations with coherent worldviews that justify their actions.

### Core Principle

```
Crisis → Yes/No Decision → Value Shift → Identity Formed → Future Behavior Affected
```

Every significant decision slightly shifts a town's moral fingerprint. Over time, patterns emerge. A town that repeatedly chooses mercy becomes known for mercy. Their annals reflect it, their relations are shaped by it, and their future options are colored by it.

### Yes/No Design Constraint

GenTown uses yes/no prompts with `{{should}}`. The Values System works within this constraint:

- **Yes** shifts toward one value pole
- **No** shifts toward the opposite pole
- Both choices are morally valid—neither is "wrong"
- The prompt framing implies a direction without forcing judgment

---

## The Five Axes

Each town has five independent value axes, ranging from -10 to +10:

```javascript
town.values = {
    justice: 0,    // -10 harsh to +10 merciful
    wealth: 0,     // -10 hoarding to +10 sharing
    openness: 0,   // -10 closed to +10 open
    order: 0,      // -10 libertarian to +10 authoritarian
    change: 0      // -10 traditional to +10 progressive
};
```

### Axis Definitions

#### 1. JUSTICE: Harsh ←→ Merciful

How the town responds to wrongdoing, failure, and transgression.

| Harsh (-10) | Merciful (+10) |
|-------------|----------------|
| Punishment deters | Rehabilitation heals |
| Strength is virtue | Compassion is virtue |
| Justice is swift and final | Justice considers context |
| Eye for an eye | Turn the other cheek |
| Criminals are purged | Criminals are redeemed |

**Triggered by:** Crime, treason, heresy, war prisoners, failure

#### 2. WEALTH: Hoarding ←→ Sharing

How the town distributes resources and views economic inequality.

| Hoarding (-10) | Sharing (+10) |
|----------------|---------------|
| Earned wealth is sacred | Wealth belongs to all |
| Merit determines reward | Need determines distribution |
| Accumulation drives progress | Equality ensures stability |
| The strong should thrive | The weak must be protected |
| Trade for profit | Trade for mutual benefit |

**Triggered by:** Famine, windfalls, taxation, aid requests, trade deals

#### 3. OPENNESS: Closed ←→ Open

How the town relates to outsiders, foreign ideas, and cultural exchange.

| Closed (-10) | Open (+10) |
|--------------|------------|
| Our ways are sufficient | Other ways enrich us |
| Outsiders dilute us | Outsiders strengthen us |
| Borders protect identity | Borders limit potential |
| Purity of culture | Diversity of culture |
| Self-reliance | Interdependence |

**Triggered by:** Refugees, migration, foreign religions, trade routes, cultural exchange

#### 4. ORDER: Libertarian ←→ Authoritarian

How the town balances individual freedom against collective control.

| Libertarian (-10) | Authoritarian (+10) |
|-------------------|---------------------|
| Freedom above all | Order above all |
| Individuals decide | Leaders decide |
| Chaos is acceptable cost | Control is acceptable cost |
| Minimal governance | Strong governance |
| Rights are innate | Rights are granted |

**Triggered by:** Laws, governance, military, religious authority, emergencies

#### 5. CHANGE: Traditional ←→ Progressive

How the town views innovation, heritage, and the passage of time.

| Traditional (-10) | Progressive (+10) |
|-------------------|-------------------|
| Ancestors knew best | We can do better |
| Proven ways are safe | New ways bring growth |
| Change risks loss | Stagnation risks death |
| Heritage defines us | Future defines us |
| Wisdom of the old | Energy of the young |

**Triggered by:** Technology, education, religious reform, cultural shifts, discoveries

---

## Value Formation Events

### Yes/No Prompt Structure

Each formative event uses the standard GenTown format:

```javascript
{
    id: "famine_sharing",
    message: "The granary runs low. Some urge sharing equally with all, though it means everyone goes hungry. {{should}}",
    messageDone: "The grain is divided. All will suffer, but none alone.",
    messageNo: "The able-bodied receive full rations. The weak must endure.",

    // Yes = Sharing, Merciful
    influences: { happy: 0.5 },
    valuesYes: { wealth: 1, justice: 0.5 },

    // No = Hoarding, Harsh
    influencesNo: { happy: -0.5 },
    valuesNo: { wealth: -1, justice: -0.5 }
}
```

### Prompt Design Principles

1. **Frame the "yes" option explicitly** - The prompt proposes an action
2. **Make "no" defensible** - Rejecting isn't evil, it's a different value
3. **Imply stakes for both** - Each choice has costs and benefits
4. **Avoid obvious answers** - Both options should feel reasonable

### Bad vs Good Prompts

**Bad (obvious yes):**
> "Should we help the starving orphans? {{should}}"

**Good (genuine dilemma):**
> "Refugees from the southern drought beg entry. Our stores are low and winter approaches. Take them in? {{should}}"

**Bad (no has no moral weight):**
> "Should we execute the murderer? {{should}}"

**Good (both choices have values):**
> "The murderer kneels before the assembly. Some cry for blood, others for exile. Put him to death? {{should}}"
> - Yes: Harsh +1 ("Justice is served")
> - No: Merciful +1 ("He is banished, not broken")

---

## Sample Formative Events

### Justice Events

#### First Murder
```
Message: "Blood has been spilled—the first killing in {{regname:town|$subject}}. The murderer awaits judgment. The people cry out for execution. {{should}}"
Done: "The blade falls. Justice is absolute here."
No: "The killer is cast out into the wilds, spared but banished."

Yes: justice -1 (harsh)
No: justice +1 (merciful)
```

#### War Prisoners
```
Message: "Captured enemy soldiers await their fate in {{regname:town|$subject}}. Executing them would send a message. {{should}}"
Done: "No mercy for the enemy. Their fate serves as warning."
No: "The prisoners are ransomed back. War need not be butchery."

Yes: justice -1.5 (harsh), openness -0.5 (closed)
No: justice +1 (merciful), openness +0.5 (open)
```

#### The Thief's Hunger
```
Message: "A thief is caught in {{regname:town|$subject}}—but she stole bread for her starving children. Punish her as the law demands? {{should}}"
Done: "The law makes no exceptions. She is punished."
No: "Her need was real. The town finds another way."

Yes: justice -1 (harsh), order +0.5 (authoritarian)
No: justice +1 (merciful), wealth +0.5 (sharing)
```

#### Corrupt Official
```
Message: "A trusted elder of {{regname:town|$subject}} has been stealing from the granary. Make a public example of them? {{should}}"
Done: "Their shame is displayed for all. Trust is restored through fear."
No: "They are quietly removed. The town's dignity is preserved."

Yes: justice -1 (harsh), order +1 (authoritarian)
No: justice +0.5 (merciful), order -0.5 (libertarian)
```

### Wealth Events

#### Famine Distribution
```
Message: "Famine tightens its grip on {{regname:town|$subject}}. Some urge equal rations for all, though none will have enough. {{should}}"
Done: "All share the hunger together. None shall starve alone."
No: "The strong receive what they need to work. The rest make do."

Yes: wealth +1.5 (sharing), justice +0.5 (merciful)
No: wealth -1.5 (hoarding), justice -0.5 (harsh)
```

#### Windfall Distribution
```
Message: "A rich vein of silver is found near {{regname:town|$subject}}. Distribute the wealth equally among all families? {{should}}"
Done: "Every family receives their share. Prosperity is collective."
No: "Those who found it and work it shall profit. Merit earns reward."

Yes: wealth +1.5 (sharing)
No: wealth -1.5 (hoarding)
```

#### Aid Request
```
Message: "{{regname:town|$target}} sends word: their harvest failed and they beg assistance. {{regname:town|$subject}}'s own stores are adequate but not abundant. Send aid? {{should}}"
Done: "Wagons of grain roll out. Generosity will be remembered."
No: "Sympathy is offered, but the grain stays. Charity begins at home."

Yes: wealth +1 (sharing), openness +0.5 (open)
No: wealth -1 (hoarding), openness -0.5 (closed)
```

#### Wealthy Hoarder
```
Message: "A wealthy family in {{regname:town|$subject}} hoards grain while others go hungry. Seize their stores for redistribution? {{should}}"
Done: "Private greed yields to public need. The grain feeds all."
No: "Property is sacred. The hungry must find another way."

Yes: wealth +1.5 (sharing), order +1 (authoritarian)
No: wealth -1 (hoarding), order -1 (libertarian)
```

### Openness Events

#### Refugee Arrival
```
Message: "Refugees fleeing war arrive at {{regname:town|$subject}}'s borders. They have nothing but their lives. Open the gates? {{should}}"
Done: "The gates open. Strangers become neighbors."
No: "The gates remain shut. This tragedy is not ours to bear."

Yes: openness +1.5 (open), justice +0.5 (merciful)
No: openness -1.5 (closed), wealth -0.5 (hoarding)
```

#### Foreign Religion
```
Message: "Missionaries from distant lands seek to build a temple in {{regname:town|$subject}}. Their faith is strange but they come in peace. Permit it? {{should}}"
Done: "Let them build. Truth can withstand questions."
No: "Our traditions suffice. Foreign gods are not welcome."

Yes: openness +1.5 (open), change +0.5 (progressive)
No: openness -1 (closed), change -0.5 (traditional)
```

#### Foreign Merchants
```
Message: "Merchants from across the sea seek trading rights in {{regname:town|$subject}}. Local traders worry about competition. Grant them access? {{should}}"
Done: "Trade flows freely. Competition breeds prosperity."
No: "Our markets serve our people first."

Yes: openness +1 (open), wealth -0.5 (sharing/competitive)
No: openness -1 (closed), wealth +0.5 (protective)
```

#### Mixed Marriage
```
Message: "A prominent family of {{regname:town|$subject}} wishes to marry into a foreign clan. Some call it alliance, others dilution. Bless the union? {{should}}"
Done: "Love and alliance know no borders."
No: "Our bloodlines remain our own."

Yes: openness +1.5 (open), change +0.5 (progressive)
No: openness -1.5 (closed), change -0.5 (traditional)
```

### Order Events

#### Emergency Powers
```
Message: "Crisis threatens {{regname:town|$subject}}. The council requests emergency authority to act without assembly approval. Grant it? {{should}}"
Done: "Swift action requires unified command."
No: "Even in crisis, the people's voice matters."

Yes: order +1.5 (authoritarian)
No: order -1.5 (libertarian)
```

#### Succession Crisis
```
Message: "The leader of {{regname:town|$subject}} has died without clear heir. The elders wish to choose a successor. Let them decide? {{should}}"
Done: "Wisdom shall choose who leads."
No: "The people themselves shall choose."

Yes: order +1 (authoritarian), change -0.5 (traditional)
No: order -1 (libertarian), change +0.5 (progressive)
```

#### Dangerous Speech
```
Message: "A firebrand in {{regname:town|$subject}} preaches ideas that unsettle the peace. Silence them before unrest spreads? {{should}}"
Done: "Stability requires limits. They are silenced."
No: "Words alone are not crimes. Let them speak."

Yes: order +1.5 (authoritarian), change -0.5 (traditional)
No: order -1.5 (libertarian), change +0.5 (progressive)
```

#### Curfew Proposal
```
Message: "Crime rises in {{regname:town|$subject}}. The watch proposes a nighttime curfew. Impose it? {{should}}"
Done: "The streets will be safe, even if less free."
No: "Freedom of movement is not the price of safety."

Yes: order +1 (authoritarian), justice -0.5 (harsh)
No: order -1 (libertarian)
```

### Change Events

#### New Technique
```
Message: "Travelers bring word of a new farming method to {{regname:town|$subject}}. Untested here, but promising. Adopt it? {{should}}"
Done: "Innovation feeds progress. The new ways are tried."
No: "Our ancestors' methods have served us well enough."

Yes: change +1.5 (progressive)
No: change -1.5 (traditional)
```

#### Fading Tradition
```
Message: "The old harvest festival of {{regname:town|$subject}} draws fewer each year. The young find it tedious. Let it fade? {{should}}"
Done: "Times change. New traditions will arise."
No: "The old ways bind us together. The festival continues."

Yes: change +1 (progressive), openness +0.5 (open)
No: change -1.5 (traditional), openness -0.5 (closed)
```

#### Young Reformers
```
Message: "Young voices in {{regname:town|$subject}} challenge the elders' authority, demanding change. Hear them out? {{should}}"
Done: "Fresh perspectives deserve consideration."
No: "Experience guides better than impatience."

Yes: change +1.5 (progressive), order -0.5 (libertarian)
No: change -1 (traditional), order +0.5 (authoritarian)
```

#### Sacred Text Reinterpretation
```
Message: "Scholars in {{regname:town|$subject}} propose a new reading of ancient teachings. Traditionalists object. Allow the new interpretation? {{should}}"
Done: "Understanding deepens with study."
No: "The ancestors' meaning stands unchanged."

Yes: change +1.5 (progressive), order -0.5 (libertarian)
No: change -1.5 (traditional), order +0.5 (authoritarian)
```

---

## Derived Archetypes

From the five axes, compound archetypes emerge based on the 2-3 strongest values:

### Primary Archetypes (Single Axis Dominant, |value| > 6)

| Axis Extreme | Archetype Name | Description |
|--------------|----------------|-------------|
| Harsh | The Iron Hand | Justice through strength |
| Merciful | The Gentle Heart | Compassion above all |
| Hoarding | The Vault | Wealth is earned and kept |
| Sharing | The Commons | Wealth belongs to all |
| Closed | The Fortress | Purity and self-reliance |
| Open | The Crossroads | Diversity and exchange |
| Libertarian | The Free Folk | Individual liberty paramount |
| Authoritarian | The Ordered State | Collective discipline |
| Traditional | The Keepers | Ancestors guide us |
| Progressive | The Seekers | Tomorrow calls us forward |

### Compound Archetypes (Two Axes Dominant)

| Combination | Archetype | Example Ethos |
|-------------|-----------|---------------|
| Harsh + Authoritarian | The Iron Throne | "Order through strength" |
| Harsh + Traditional | The Old Guard | "As our fathers did" |
| Merciful + Sharing | The Commune | "All are cared for" |
| Merciful + Open | The Sanctuary | "All are welcome" |
| Hoarding + Closed | The Fortress Vault | "Ours and ours alone" |
| Hoarding + Libertarian | The Free Market | "Earn your keep" |
| Sharing + Authoritarian | The Collective | "The state provides" |
| Open + Progressive | The New Dawn | "The future is bright" |
| Closed + Traditional | The Eternal Way | "Unchanged, unchanging" |
| Progressive + Libertarian | The Innovators | "Think freely, build boldly" |

### Complex Archetypes (Three+ Axes)

| Combination | Archetype | Character |
|-------------|-----------|-----------|
| Harsh + Hoarding + Closed + Auth + Trad | Fortress Kingdom | Rigid, feared, enduring |
| Merciful + Sharing + Open + Libert + Prog | Utopian Republic | Idealistic, fragile, inspiring |
| Harsh + Hoarding + Open + Auth + Prog | Imperial Meritocracy | Expansive, efficient, ruthless |
| Merciful + Sharing + Closed + Auth + Trad | Pastoral Theocracy | Gentle internally, wary externally |
| Harsh + Sharing + Closed + Libert + Trad | Warrior Democracy | Egalitarian kin, fierce to others |

---

## Justification Generation

After a decision, the game can generate context-appropriate narrative based on established values.

### Function: getActionJustification(town, action, choice)

```javascript
function getActionJustification(town, action, choice) {
    const v = town.values;
    const dominant = getDominantAxes(v, 2);

    // Find justification matching strongest values
    const justifications = ACTION_JUSTIFICATIONS[action][choice];
    for (const axis of dominant) {
        if (justifications[axis]) {
            return justifications[axis];
        }
    }
    return justifications.default;
}
```

### Example: War Declaration Justifications

```javascript
WAR_JUSTIFICATIONS = {
    harsh: "They have shown weakness. Strength must answer.",
    merciful: "We fight to end greater suffering.",
    hoarding: "Their resources should fuel our prosperity.",
    sharing: "We will liberate their oppressed people.",
    closed: "They threaten our way of life.",
    open: "We will open their borders to the world.",
    authoritarian: "Our leaders have decreed this necessary.",
    libertarian: "They have trampled their people's freedoms.",
    traditional: "Our ancestors demand we answer this insult.",
    progressive: "The old order must fall for progress to rise.",
    default: "War has come."
}
```

### Example: Refugee Decision Justifications

```javascript
// If "Yes" to refugees
REFUGEE_ACCEPT_JUSTIFICATIONS = {
    merciful: "Compassion demands we open our doors.",
    open: "Newcomers enrich our community.",
    sharing: "We have enough to share with those in need.",
    progressive: "Our town grows by welcoming new blood.",
    default: "The gates open to those in need."
}

// If "No" to refugees
REFUGEE_REJECT_JUSTIFICATIONS = {
    harsh: "The weak cannot burden the strong.",
    closed: "Outsiders threaten what we have built.",
    hoarding: "Our resources serve our people first.",
    traditional: "Our ancestors built this for their children.",
    authoritarian: "The council has sealed the borders.",
    default: "The gates remain closed."
}
```

---

## Annals Integration

Values should color how events are recorded in the Annals.

### Value-Aware Narrative Voice

```javascript
function getAnnalsVoice(town, eventType) {
    const v = town.values;

    if (eventType === "war_victory") {
        if (v.justice < -5) return "crushed their enemies without mercy";
        if (v.justice > 5) return "achieved a hard-won peace";
        if (v.openness < -5) return "defended their sacred borders";
        if (v.openness > 5) return "brought their rivals into the fold";
        return "emerged victorious";
    }

    if (eventType === "famine_survived") {
        if (v.wealth > 5) return "shared their last grain and endured together";
        if (v.wealth < -5) return "the strong survived to rebuild";
        if (v.order > 5) return "strict rationing saw them through";
        if (v.order < -5) return "each family found their own way";
        return "weathered the hungry season";
    }
}
```

### Sample Annals Entries

**Merciful + Open town wins a war:**
> *"True to their nature, the people of Westmoor offered generous terms to the defeated. The war ended not with subjugation, but with reconciliation."*

**Harsh + Closed town wins a war:**
> *"Eastport crushed the invaders utterly. None were spared, and the borders were sealed tighter than before. Let all know the cost of threatening the Iron Gate."*

**Sharing + Progressive town survives famine:**
> *"When the harvests failed, Northdale shared equally—scholar and laborer ate the same thin soup. They emerged leaner but united, and the innovations born of necessity would feed generations."*

---

## System Integration

### Government Compatibility

Values push towns toward compatible government types:

| Government | Compatible Values | Incompatible Values |
|------------|-------------------|---------------------|
| Democracy | Libertarian, Progressive, Open | Harsh + Authoritarian |
| Monarchy | Authoritarian, Traditional | Libertarian, Progressive |
| Theocracy | Traditional, Authoritarian, Closed | Progressive, Open |
| Republic | Moderate Order, Progressive | Extreme Authoritarian |
| Oligarchy | Hoarding, Authoritarian | Sharing, Libertarian |
| Commune | Sharing, Libertarian | Hoarding, Authoritarian |

### Alliance Formation

Similar values = easier alliances, opposing values = tension:

```javascript
function getValueCompatibility(town1, town2) {
    let similarity = 0;
    for (const axis of VALUE_AXES) {
        const v1 = town1.values[axis] || 0;
        const v2 = town2.values[axis] || 0;
        const diff = Math.abs(v1 - v2);
        similarity += (20 - diff) / 20;
    }
    return similarity / VALUE_AXES.length; // 0.0 to 1.0
}
```

### War Triggers (Ideological)

Opposing values create casus belli:

```javascript
function getValueTension(town1, town2) {
    let tension = 0;
    for (const axis of VALUE_AXES) {
        const v1 = town1.values[axis] || 0;
        const v2 = town2.values[axis] || 0;

        // Tension when both are strong but opposite
        if (Math.sign(v1) !== Math.sign(v2)) {
            tension += Math.abs(v1) * Math.abs(v2) / 100;
        }
    }
    return tension;
}
```

### Migration Preferences

People migrate toward compatible or aspirational values:

```javascript
function getMigrationValueBonus(origin, destination) {
    const v1 = origin.values;
    const v2 = destination.values;

    let attraction = 0;

    // Flee harsh for merciful
    if (v1.justice < -3 && v2.justice > 3) attraction += 2;

    // Flee hoarding for sharing
    if (v1.wealth < -3 && v2.wealth > 3) attraction += 2;

    // Open towns attract migrants generally
    attraction += (v2.openness || 0) * 0.15;

    return attraction;
}
```

### Religion Compatibility

Religions spread more easily in compatible value environments:

| Religion Archetype | Compatible Values |
|--------------------|-------------------|
| Nature worship | Traditional, Closed |
| Solar/Sky worship | Authoritarian, Traditional |
| Ancestor worship | Traditional, Closed, Hoarding |
| Mystery cults | Progressive, Open, Libertarian |
| Martial faith | Harsh, Authoritarian |
| Ascetic faith | Sharing, Traditional |
| Prosperity faith | Hoarding, Open, Progressive |

---

## Visibility and UI

### Town Panel Display

Show values as bars in the town information panel:

```
═══ WESTMOOR ═══

Justice:   [░░░░░░░███] Merciful
Wealth:    [░░░░░██░░░] Slightly Sharing
Openness:  [░░░░░░████] Open
Order:     [██░░░░░░░░] Libertarian
Change:    [░░░░░░░███] Progressive

Archetype: The Sanctuary
"A haven for the weary and the free-thinking"
```

### Relationship Tooltips

When viewing relations between towns:

```
Westmoor → Eastport: -15 (Hostile)

Value Tensions:
  • Westmoor is Merciful, Eastport is Harsh
  • Westmoor is Open, Eastport is Closed

"These peoples see the world through very different eyes."
```

### Decision History

Track formative moments:

```
═══ WESTMOOR'S DEFINING MOMENTS ═══

Day 12: Showed mercy to the first murderer (Merciful +1)
Day 45: Welcomed refugees from the south (Open +1)
Day 89: Shared grain during famine (Sharing +1)
Day 134: Rejected emergency powers (Libertarian +1)

"A pattern of compassion and openness has defined this people."
```

---

## Implementation

### Data Structure

```javascript
// Initialize on town creation
function initTownValues(town) {
    if (!town.values) {
        town.values = {
            justice: 0,
            wealth: 0,
            openness: 0,
            order: 0,
            change: 0
        };
    }
    if (!town.valueHistory) {
        town.valueHistory = [];
    }
}

// Record a value shift
function shiftTownValue(town, axis, amount, reason) {
    initTownValues(town);

    const oldValue = town.values[axis] || 0;
    const newValue = clampValue(oldValue + amount, -10, 10);
    town.values[axis] = newValue;

    town.valueHistory.push({
        day: planet.day,
        axis: axis,
        change: amount,
        reason: reason,
        newValue: newValue
    });
}
```

### Event Integration

```javascript
// In event func, after choice is made
func: (subject, target, args) => {
    if (args.choice === "yes") {
        shiftTownValue(subject, "justice", 1, "Showed mercy to the condemned");
        logMessage(`{{regname:town|${subject.id}}} has chosen the path of mercy.`);
    } else {
        shiftTownValue(subject, "justice", -1, "Executed the condemned");
        logMessage(`{{regname:town|${subject.id}}} has chosen the path of iron.`);
    }
}
```

### Archetype Derivation

```javascript
function getTownArchetype(town) {
    const v = town.values;
    const dominated = [];

    for (const axis of VALUE_AXES) {
        const val = v[axis] || 0;
        if (Math.abs(val) >= 6) {
            dominated.push({
                axis: axis,
                pole: val > 0 ? "positive" : "negative",
                strength: Math.abs(val)
            });
        }
    }

    dominated.sort((a, b) => b.strength - a.strength);

    if (dominated.length === 0) return { name: "The Balanced", desc: "Pragmatic and adaptable" };
    if (dominated.length === 1) return PRIMARY_ARCHETYPES[dominated[0].axis][dominated[0].pole];

    // Compound archetype from top 2
    const key = `${dominated[0].axis}_${dominated[0].pole}_${dominated[1].axis}_${dominated[1].pole}`;
    return COMPOUND_ARCHETYPES[key] || { name: "The Complex", desc: "Defying simple labels" };
}
```

---

## Configuration

```javascript
const VALUES_CONFIG = {
    axes: ["justice", "wealth", "openness", "order", "change"],

    range: { min: -10, max: 10 },

    // How much each decision shifts values
    shift: {
        minor: 0.5,
        standard: 1,
        major: 1.5
    },

    // Natural drift toward center over time (optional)
    drift: {
        enabled: false,
        rate: 0.005,
        threshold: 3
    },

    // Threshold for "moderate" value (affects archetype)
    moderateThreshold: 3,

    // Threshold for "strong" value (affects archetype)
    strongThreshold: 6,

    // Threshold for "extreme" value
    extremeThreshold: 9
};
```

---

## Summary

The Values System transforms yes/no prompts from "do you want good thing?" into **"what kind of civilization is this?"**

Through accumulated decisions:
1. Towns develop coherent moral identities
2. Both "yes" and "no" carry moral weight
3. Actions are justified in the town's own terms
4. Relationships form around shared or opposing values
5. The annals tell stories of peoples, not just events

The player's choices matter not because they optimize outcomes, but because they answer the fundamental question: **"Who are these people becoming?"**
