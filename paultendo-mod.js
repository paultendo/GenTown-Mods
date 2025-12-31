// paultendo-mod.js
// GenTown mod by paultendo (github.com/paultendo)
//
// To install: In GenTown, go to Settings > Add mod > enter "paultendo-mod.js"
// Or use full URL during development
//
// Mod API:
//   Mod.event(id, data)          - Register a custom event
//   Mod.action(className, func) - Add action to existing event class
// Mod helper:
//   modEvent(id, data)          - Wraps Mod.event for safe per-town daily checks
//
// Available globals: Registry, towns, events, biomes, userSettings, etc.

(function() {
    "use strict";

    const MOD_VERSION = "1.2.5";
    if (typeof window !== "undefined") {
        window.PAULTENDO_MOD_VERSION = MOD_VERSION;
    }
    console.log(`[paultendo-mod] Loaded v${MOD_VERSION}`);

    // =========================================================================
    // EVENT WRAPPER (daily + subject/target all safe per-entity value/check)
    // =========================================================================

    const _paultendoEvent = Mod.event;
    function modEvent(id, data) {
        if (!data || typeof data !== "object") return _paultendoEvent(id, data);

        const hasAllSubject = !!(data.subject && data.subject.all);
        const hasAllTarget = !!(data.target && data.target.all);
        const isDaily = data.daily === true;

        const valueFn = typeof data.value === "function" ? data.value : null;
        const checkFn = typeof data.check === "function" ? data.check : null;
        let funcFn = typeof data.func === "function" ? data.func : null;
        let funcNoFn = typeof data.funcNo === "function" ? data.funcNo : null;

        const subjectIsTown = !!(data.subject && data.subject.reg === "town");
        const targetIsTown = !!(data.target && data.target.reg === "town");

        const prepEntities = (subject, target) => {
            ensurePlanetState();
            if (subjectIsTown) ensureTownState(subject);
            if (targetIsTown) ensureTownState(target);
        };

        const decisionConfig = (() => {
            const mapEntry = (typeof DECISION_VALUE_MAP !== "undefined") ? DECISION_VALUE_MAP[id] : null;
            const yesSpec = data.valuesYesFn || data.valuesYes || (mapEntry && mapEntry.yes);
            const noSpec = data.valuesNoFn || data.valuesNo || (mapEntry && mapEntry.no);
            if (!yesSpec && !noSpec) return null;
            return {
                yes: yesSpec,
                no: noSpec,
                town: data.valuesTown !== undefined ? data.valuesTown : (mapEntry && mapEntry.town),
                reasonYes: data.valuesReasonYes || (mapEntry && mapEntry.reasonYes),
                reasonNo: data.valuesReasonNo || (mapEntry && mapEntry.reasonNo)
            };
        })();

        const resolveDecisionTowns = (townSpec, subject, target, args) => {
            let spec = townSpec;
            if (typeof spec === "function") {
                spec = spec(subject, target, args);
            }

            if (spec === "all") {
                return regFilter("town", t => t && !t.end);
            }

            const towns = [];
            const addTown = (t) => {
                if (t && typeof t === "object" && t.id !== undefined && !t.end) {
                    towns.push(t);
                }
            };

            if (spec === "both") {
                if (subjectIsTown) addTown(subject);
                if (targetIsTown) addTown(target);
                return towns;
            }

            if (spec === "subject") {
                addTown(subject);
                return towns;
            }

            if (spec === "target") {
                addTown(target);
                return towns;
            }

            if (spec) {
                if (typeof spec === "object") addTown(spec);
                if (typeof spec === "number") {
                    const town = regGet("town", spec);
                    addTown(town);
                }
                return towns;
            }

            if (subjectIsTown) addTown(subject);
            else if (targetIsTown) addTown(target);

            return towns;
        };

        const applyDecisionValues = (choice, subject, target, args) => {
            if (!decisionConfig) return;
            const spec = choice === "yes" ? decisionConfig.yes : decisionConfig.no;
            if (!spec) return;
            const values = (typeof spec === "function") ? spec(subject, target, args) : spec;
            if (!values || typeof values !== "object") return;
            const towns = resolveDecisionTowns(decisionConfig.town, subject, target, args);
            if (!towns || towns.length === 0) return;
            const reason = choice === "yes" ? decisionConfig.reasonYes : decisionConfig.reasonNo;
            for (const town of towns) {
                ensureTownState(town);
                for (const [axis, amount] of Object.entries(values)) {
                    shiftTownValue(town, axis, amount, reason || `decision:${id}:${choice}`);
                }
            }
        };

        if (decisionConfig) {
            if (decisionConfig.yes) {
                const original = funcFn;
                funcFn = (subject, target, args) => {
                    let result;
                    if (original) result = original(subject, target, args);
                    applyDecisionValues("yes", subject, target, args);
                    return result;
                };
            }

            if (decisionConfig.no) {
                const originalNo = funcNoFn;
                funcNoFn = (subject, target, args) => {
                    let result;
                    if (originalNo) result = originalNo(subject, target, args);
                    applyDecisionValues("no", subject, target, args);
                    return result;
                };
            }
        }

        if (funcFn) data.func = funcFn;
        if (funcNoFn) data.funcNo = funcNoFn;

        // Base game runs value/check once with array when subject/target all.
        // For daily events, move value/check into per-entity func so logic runs per town.
        if (isDaily && (hasAllSubject || hasAllTarget) && (valueFn || checkFn)) {
            if (valueFn) data.value = undefined;
            if (checkFn) data.check = undefined;

            data.func = (subject, target, args) => {
                const subjects = Array.isArray(subject) ? subject : [subject];
                const targets = Array.isArray(target) ? target : [target];
                const baseArgs = (args && typeof args === "object") ? args : {};

                for (let i = 0; i < subjects.length; i++) {
                    const s = subjects[i];
                    for (let j = 0; j < targets.length; j++) {
                        const t = targets[j];
                        const localArgs = Object.assign({}, baseArgs);

                        prepEntities(s, t);

                        if (valueFn) {
                            const valueResult = valueFn(s, t, localArgs);
                            if (valueResult === false) continue;
                            if (localArgs.value === undefined && valueResult !== undefined) {
                                localArgs.value = valueResult;
                            }
                        }
                        if (checkFn && !checkFn(s, t, localArgs)) continue;
                        if (funcFn) funcFn(s, t, localArgs);
                        if (data.messageDone) {
                            Object.assign(baseArgs, localArgs);
                        }
                    }
                }
            };
        }

        if (!(isDaily && (hasAllSubject || hasAllTarget) && (valueFn || checkFn))) {
            if (valueFn) {
                data.value = (subject, target, args) => {
                    prepEntities(subject, target);
                    return valueFn(subject, target, args);
                };
            }
            if (checkFn) {
                data.check = (subject, target, args) => {
                    prepEntities(subject, target);
                    return checkFn(subject, target, args);
                };
            }
            if (funcFn) {
                data.func = (subject, target, args) => {
                    prepEntities(subject, target);
                    return funcFn(subject, target, args);
                };
            }
            if (funcNoFn) {
                data.funcNo = (subject, target, args) => {
                    prepEntities(subject, target);
                    return funcNoFn(subject, target, args);
                };
            }
        }

        return _paultendoEvent(id, data);
    }

    // =========================================================================
    // MOD STATUS (one-time Chronicle message after the first town exists)
    // =========================================================================

    modEvent("paultendoModStatus", {
        daily: true,
        subject: { reg: "town", all: true },
        check: () => {
            if (planet._paultendoModStatusShown) return false;
            const towns = regFilter("town", (t) => !t.end && t.pop > 0);
            if (!towns.length) return false;
            const settledDay = planet.settled || planet.day;
            // First day after the first town appears
            if (planet.day < settledDay) return false;
            return true;
        },
        func: () => {
            if (planet._paultendoModStatusShown) return;
            planet._paultendoModStatusShown = true;
            logMessage(`{{b:paultendo-mod}} active (v${MOD_VERSION}).`, "milestone");
        }
    });

    // =========================================================================
    // BASE-COMPAT HELPERS (relations + war)
    // =========================================================================

    function getRelations(town1, town2) {
        if (!town1 || !town2) return 0;
        return (town1.relations && town1.relations[town2.id]) || 0;
    }

    function improveRelations(town1, town2, amount = 1) {
        if (!town1 || !town2) return false;
        return happen("AddRelation", town1, town2, { amount: Math.abs(amount) });
    }

    function worsenRelations(town1, town2, amount = 1) {
        if (!town1 || !town2) return false;
        return happen("AddRelation", town1, town2, { amount: -Math.abs(amount) });
    }

    function areAtWar(town1, town2) {
        if (!town1 || !town2) return false;
        const warId1 = town1.issues?.war;
        const warId2 = town2.issues?.war;
        if (warId1 && warId1 === warId2) {
            const process = regGet("process", warId1);
            if (process && !process.done && process.type === "war") {
                if (process.sides) {
                    const side1 = getWarSideIndex(process, town1.id);
                    const side2 = getWarSideIndex(process, town2.id);
                    if (side1 !== null && side2 !== null) {
                        return side1 !== side2;
                    }
                }
                return true;
            }
        }
        const wars = regFilter("process", p =>
            p.type === "war" &&
            !p.done &&
            p.towns &&
            p.towns.includes(town1.id) &&
            p.towns.includes(town2.id)
        );
        if (wars.length === 0) return false;
        for (let i = 0; i < wars.length; i++) {
            const process = wars[i];
            if (!process || process.done) continue;
            if (process.sides) {
                const side1 = getWarSideIndex(process, town1.id);
                const side2 = getWarSideIndex(process, town2.id);
                if (side1 !== null && side2 !== null) {
                    if (side1 !== side2) return true;
                    continue;
                }
            }
            return true;
        }
        return false;
    }

    function startWar(town1, town2) {
        if (!town1 || !town2 || town1.id === town2.id) return false;
        if (areAtWar(town1, town2)) return false;
        const process = happen("Create", town1, null, {
            type: "war",
            towns: [town1.id, town2.id]
        }, "process");
        if (!process) return false;
        process.initiator = town1.id;
        process.defender = town2.id;
        process.sides = [[town1.id], [town2.id]];
        const early = isEarlyWarEra();
        if (early) {
            process._paultendoEarly = true;
            const min = EARLY_WAR_CONFIG.minDuration;
            const max = EARLY_WAR_CONFIG.maxDuration;
            process._paultendoEarlyDuration = min + Math.floor(Math.random() * (max - min + 1));
            process._paultendoEarlyStart = planet.day;
        }
        ensureIssues(town1);
        ensureIssues(town2);
        town1.issues.war = process.id;
        town2.issues.war = process.id;
        return process;
    }

    function ensureIssues(town) {
        if (town && !town.issues) town.issues = {};
    }

    function ensurePlanetState() {
        if (typeof planet === "undefined" || !planet) return;
        if (!planet.unlocks || typeof planet.unlocks !== "object") {
            planet.unlocks = {};
        }
    }

    function ensureTownState(town) {
        if (Array.isArray(town)) {
            town.forEach(ensureTownState);
            return;
        }
        if (!town || typeof town !== "object") return;
        if (!town.influences || typeof town.influences !== "object") {
            town.influences = {};
        }
        if (!town.jobs || typeof town.jobs !== "object") {
            town.jobs = {};
        }
        if (!town.relations || typeof town.relations !== "object") {
            town.relations = {};
        }
        ensureIssues(town);
        initTownCulture(town);
        initTownSpecializations(town);
        initTownValues(town);
    }

    function hasIssue(town, issueKey) {
        return !!(town && town.issues && town.issues[issueKey]);
    }

    // =========================================================================
    // GENERAL HELPERS
    // =========================================================================

    const SWAY_BASE_CHANCE = 0.4;
    const DEFAULT_CHANCE_MIN = 0.05;
    const DEFAULT_CHANCE_MAX = 0.95;

    function clampValue(value, min, max) {
        if (value < min) return min;
        if (value > max) return max;
        return value;
    }

    function clampChance(value, min = DEFAULT_CHANCE_MIN, max = DEFAULT_CHANCE_MAX) {
        return clampValue(value, min, max);
    }

    function weightedChoice(items, weightFn) {
        if (!Array.isArray(items) || items.length === 0) return null;
        let total = 0;
        const weights = items.map((item) => {
            const w = Math.max(0, weightFn(item));
            total += w;
            return w;
        });
        if (total <= 0) return null;
        let roll = Math.random() * total;
        for (let i = 0; i < items.length; i++) {
            roll -= weights[i];
            if (roll <= 0) return items[i];
        }
        return items[items.length - 1];
    }

    // =========================================================================
    // VALUES SYSTEM (moral axes + drift + revolution re-roll)
    // =========================================================================

    const VALUES_CONFIG = {
        axes: ["justice", "wealth", "openness", "order", "change"],
        range: { min: -10, max: 10 },
        shift: { minor: 0.5, standard: 1, major: 1.5 },
        drift: { enabled: true, rate: 0.005, threshold: 3 },
        historyLimit: 120
    };

    const VALUE_SHIFT = VALUES_CONFIG.shift;

    const GOVERNMENT_VALUE_BIASES = {
        tribal: { order: -1, change: -2, openness: -1 },
        council: { order: 1, change: -1, justice: 1 },
        anarchy: { order: -4, change: 2, openness: 1, wealth: 1, justice: 1 },
        chiefdom: { order: 2, change: -1, openness: -1, justice: -1 },
        monarchy: { order: 3, change: -2, openness: -1, justice: -1, wealth: -1 },
        dictatorship: { order: 4, change: -1, openness: -2, justice: -2, wealth: -1 },
        theocracy: { order: 3, change: -2, openness: -2, justice: 1 },
        oligarchy: { order: 2, change: -1, openness: -1, justice: -2, wealth: -3 },
        commune: { order: -1, change: 1, openness: 1, justice: 1, wealth: 3 },
        republic: { order: -1, change: 1, openness: 1, justice: 2, wealth: 1 },
        democracy: { order: -2, change: 2, openness: 2, justice: 2, wealth: 1 }
    };

    const REVOLUTION_VALUE_PROFILES = {
        military: { justice: -3, wealth: -2, openness: -3, order: 6, change: -1 },
        religious: { justice: 1, wealth: 0, openness: -3, order: 4, change: -3 },
        popular: { justice: 3, wealth: 1, openness: 2, order: -2, change: 2 },
        radical: { justice: 2, wealth: 3, openness: 1, order: -4, change: 4 },
        oligarchic: { justice: -2, wealth: -3, openness: -1, order: 2, change: -1 },
        reactionary: { justice: -1, wealth: -1, openness: -2, order: 3, change: -4 }
    };

    const REVOLUTION_REROLL_STRENGTH = {
        military: 0.65,
        religious: 0.75,
        popular: 0.8,
        radical: 0.95,
        oligarchic: 0.7,
        reactionary: 0.6
    };

    const REVOLUTION_REROLL_VARIANCE = {
        military: 1.8,
        religious: 1.6,
        popular: 2.4,
        radical: 3.0,
        oligarchic: 1.6,
        reactionary: 1.4
    };

    function initTownValues(town) {
        if (!town) return;
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

    function recordValueHistory(town, entry) {
        initTownValues(town);
        town.valueHistory.push(entry);
        if (town.valueHistory.length > VALUES_CONFIG.historyLimit) {
            town.valueHistory.splice(0, town.valueHistory.length - VALUES_CONFIG.historyLimit);
        }
    }

    function shiftTownValue(town, axis, amount, reason) {
        initTownValues(town);
        if (!VALUES_CONFIG.axes.includes(axis)) return false;
        const oldValue = town.values[axis] || 0;
        const newValue = clampValue(oldValue + amount, VALUES_CONFIG.range.min, VALUES_CONFIG.range.max);
        town.values[axis] = newValue;
        recordValueHistory(town, {
            day: planet.day,
            axis,
            change: amount,
            reason: reason || "value shift",
            newValue: newValue
        });
        return true;
    }

    function getRevolutionType(town, newGovId, oldGovId) {
        const scores = {
            military: 0,
            religious: 0,
            popular: 0,
            radical: 0,
            oligarchic: 0,
            reactionary: 0
        };

        const military = town.influences?.military || 0;
        const faith = town.influences?.faith || 0;
        const education = town.influences?.education || 0;
        const trade = town.influences?.trade || 0;
        const crime = town.influences?.crime || 0;

        if (military > 6) scores.military += 2;
        if (faith > 6) scores.religious += 2;
        if (education > 6) scores.popular += 2;
        if (trade > 6) scores.oligarchic += 2;
        if (crime > 6) scores.radical += 1;

        switch (newGovId) {
            case "dictatorship":
                scores.military += 3;
                break;
            case "theocracy":
                scores.religious += 3;
                break;
            case "democracy":
            case "republic":
                scores.popular += 3;
                break;
            case "commune":
            case "anarchy":
                scores.radical += 3;
                break;
            case "oligarchy":
                scores.oligarchic += 3;
                break;
            case "monarchy":
            case "chiefdom":
            case "council":
            case "tribal":
                scores.reactionary += 3;
                break;
            default:
                break;
        }

        if (oldGovId && oldGovId === "dictatorship" && newGovId !== "dictatorship") {
            scores.popular += 1;
        }

        const candidates = Object.entries(scores).map(([id, weight]) => ({ id, weight }));
        const pick = weightedChoice(candidates, c => c.weight);
        return pick ? pick.id : "popular";
    }

    function applyRevolutionValues(town, revolutionType, newGovId) {
        initTownValues(town);
        const profile = REVOLUTION_VALUE_PROFILES[revolutionType] || {};
        const govBias = GOVERNMENT_VALUE_BIASES[newGovId] || {};
        const strength = REVOLUTION_REROLL_STRENGTH[revolutionType] || 0.75;
        const variance = REVOLUTION_REROLL_VARIANCE[revolutionType] || 2;

        for (const axis of VALUES_CONFIG.axes) {
            const base = (profile[axis] || 0) + (govBias[axis] || 0);
            const target = clampValue(base + (Math.random() * (variance * 2) - variance), VALUES_CONFIG.range.min, VALUES_CONFIG.range.max);
            const oldValue = town.values[axis] || 0;
            const blended = (oldValue * (1 - strength)) + (target * strength);
            town.values[axis] = clampValue(blended, VALUES_CONFIG.range.min, VALUES_CONFIG.range.max);
        }

        recordValueHistory(town, {
            day: planet.day,
            axis: "revolution",
            change: strength,
            reason: `revolution:${revolutionType}`,
            newValue: null
        });
    }

    function invertValueMap(values) {
        if (!values || typeof values !== "object") return null;
        const inverted = {};
        for (const [axis, amount] of Object.entries(values)) {
            inverted[axis] = -amount;
        }
        return inverted;
    }

    function getLoreValueShift(theme) {
        switch (theme) {
            case "war":
                return { order: VALUE_SHIFT.minor, justice: -VALUE_SHIFT.minor, openness: -VALUE_SHIFT.minor };
            case "discovery":
                return { openness: VALUE_SHIFT.minor, change: VALUE_SHIFT.minor };
            case "faith":
            case "myth":
                return { order: VALUE_SHIFT.minor, change: -VALUE_SHIFT.minor };
            case "revolution":
                return { order: VALUE_SHIFT.minor, change: VALUE_SHIFT.minor };
            case "hardship":
                return { wealth: VALUE_SHIFT.minor, justice: VALUE_SHIFT.minor };
            case "diplomacy":
                return { openness: VALUE_SHIFT.minor, justice: VALUE_SHIFT.minor };
            case "expansion":
                return { openness: VALUE_SHIFT.minor, change: VALUE_SHIFT.minor };
            case "culture":
                return { change: -VALUE_SHIFT.minor, justice: VALUE_SHIFT.minor };
            default:
                return null;
        }
    }

    const DECISION_VALUE_MAP = {};

    function addDecisionValues(id, config) {
        DECISION_VALUE_MAP[id] = config;
    }

    const TECH_CHANGE_EVENTS = [
        "unlockFertilization",
        "unlockSelectiveBreeding",
        "unlockMechanizedFarming",
        "unlockAgriculturalScience",
        "unlockSteamPower",
        "unlockRailways",
        "unlockKilns",
        "unlockForges",
        "unlockEngines",
        "unlockSteel",
        "unlockArchitecture",
        "unlockMachinery",
        "unlockPrecisionEngineering"
    ];

    const TECH_TRAVEL_EVENTS = [
        "unlockRoads",
        "unlockSailingShips",
        "unlockNavigation"
    ];

    const TECH_ECON_EVENTS = [
        "unlockBanking",
        "unlockContracts",
        "unlockMarkets",
        "unlockGuilds",
        "unlockCorporations"
    ];

    const TECH_GOV_EVENTS = [
        "unlockBureaucracy",
        "unlockCourts",
        "unlockConstitution"
    ];

    const TECH_KNOWLEDGE_EVENTS = [
        "unlockWriting",
        "unlockLibraries",
        "unlockPrinting",
        "unlockUniversities",
        "unlockScientificMethod",
        "unlockMedicine"
    ];

    const TECH_MILITARY_EVENTS = [
        "unlockFortifications",
        "unlockStandingArmies",
        "unlockFirearms",
        "unlockArtillery"
    ];

    const TECH_FAITH_EVENTS = [
        "unlockRituals",
        "unlockTemples",
        "unlockPriesthood",
        "unlockScripture",
        "unlockMonasteries"
    ];

    TECH_CHANGE_EVENTS.forEach(id => addDecisionValues(id, {
        town: "all",
        yes: { change: VALUE_SHIFT.standard },
        no: { change: -VALUE_SHIFT.standard }
    }));

    TECH_TRAVEL_EVENTS.forEach(id => addDecisionValues(id, {
        town: "all",
        yes: { change: VALUE_SHIFT.standard, openness: VALUE_SHIFT.minor },
        no: { change: -VALUE_SHIFT.standard, openness: -VALUE_SHIFT.minor }
    }));

    TECH_ECON_EVENTS.forEach(id => addDecisionValues(id, {
        town: "all",
        yes: { change: VALUE_SHIFT.minor, wealth: -VALUE_SHIFT.minor, order: VALUE_SHIFT.minor },
        no: { change: -VALUE_SHIFT.minor, wealth: VALUE_SHIFT.minor, order: -VALUE_SHIFT.minor }
    }));

    TECH_GOV_EVENTS.forEach(id => addDecisionValues(id, {
        town: "all",
        yes: { order: VALUE_SHIFT.standard, change: VALUE_SHIFT.minor, justice: VALUE_SHIFT.minor },
        no: { order: -VALUE_SHIFT.standard, change: -VALUE_SHIFT.minor, justice: -VALUE_SHIFT.minor }
    }));

    TECH_KNOWLEDGE_EVENTS.forEach(id => addDecisionValues(id, {
        town: "all",
        yes: { change: VALUE_SHIFT.standard, openness: VALUE_SHIFT.minor },
        no: { change: -VALUE_SHIFT.standard, openness: -VALUE_SHIFT.minor }
    }));

    TECH_MILITARY_EVENTS.forEach(id => addDecisionValues(id, {
        town: "all",
        yes: { order: VALUE_SHIFT.standard, justice: -VALUE_SHIFT.minor, openness: -VALUE_SHIFT.minor, change: VALUE_SHIFT.minor },
        no: { order: -VALUE_SHIFT.standard, justice: VALUE_SHIFT.minor, openness: VALUE_SHIFT.minor, change: -VALUE_SHIFT.minor }
    }));

    TECH_FAITH_EVENTS.forEach(id => addDecisionValues(id, {
        town: "all",
        yes: { order: VALUE_SHIFT.minor, change: -VALUE_SHIFT.minor, openness: -VALUE_SHIFT.minor },
        no: { order: -VALUE_SHIFT.minor, change: VALUE_SHIFT.minor, openness: VALUE_SHIFT.minor }
    }));

    addDecisionValues("unlockTaxation", {
        town: "all",
        yes: { order: VALUE_SHIFT.standard, wealth: VALUE_SHIFT.minor, change: VALUE_SHIFT.minor },
        no: { order: -VALUE_SHIFT.standard, wealth: -VALUE_SHIFT.minor, change: -VALUE_SHIFT.minor }
    });

    addDecisionValues("swayDiscoveryExpedition", {
        town: "target",
        yes: { openness: VALUE_SHIFT.minor, change: VALUE_SHIFT.minor },
        no: { openness: -VALUE_SHIFT.minor, change: -VALUE_SHIFT.minor }
    });

    addDecisionValues("swayDisasterRelief", {
        town: "target",
        yes: { wealth: VALUE_SHIFT.minor, justice: VALUE_SHIFT.minor, openness: VALUE_SHIFT.minor },
        no: { wealth: -VALUE_SHIFT.minor, justice: -VALUE_SHIFT.minor, openness: -VALUE_SHIFT.minor }
    });

    addDecisionValues("disasterMemorial", {
        town: "subject",
        yes: { change: -VALUE_SHIFT.minor, justice: VALUE_SHIFT.minor },
        no: { change: VALUE_SHIFT.minor, justice: -VALUE_SHIFT.minor }
    });

    addDecisionValues("droughtBegins", {
        town: "subject",
        yes: { order: VALUE_SHIFT.minor, wealth: VALUE_SHIFT.minor },
        no: { order: -VALUE_SHIFT.minor, wealth: -VALUE_SHIFT.minor }
    });

    addDecisionValues("swayAddressGrievances", {
        town: "target",
        yes: { justice: VALUE_SHIFT.standard, order: -VALUE_SHIFT.minor, change: VALUE_SHIFT.minor },
        no: { justice: -VALUE_SHIFT.standard, order: VALUE_SHIFT.minor, change: -VALUE_SHIFT.minor }
    });

    addDecisionValues("religionEmerges", {
        town: "subject",
        yes: { openness: VALUE_SHIFT.standard, change: VALUE_SHIFT.minor },
        no: { openness: -VALUE_SHIFT.standard, change: -VALUE_SHIFT.minor, order: VALUE_SHIFT.minor }
    });

    addDecisionValues("religiousReform", {
        town: "subject",
        yes: { change: VALUE_SHIFT.standard, openness: VALUE_SHIFT.minor, order: -VALUE_SHIFT.minor },
        no: { change: -VALUE_SHIFT.standard, openness: -VALUE_SHIFT.minor, order: VALUE_SHIFT.minor }
    });

    addDecisionValues("swayReligiousConversion", {
        town: "target",
        yes: { openness: VALUE_SHIFT.minor, change: VALUE_SHIFT.minor, order: VALUE_SHIFT.minor },
        no: { openness: -VALUE_SHIFT.minor, change: -VALUE_SHIFT.minor, order: -VALUE_SHIFT.minor }
    });

    addDecisionValues("swayReligiousTolerance", {
        town: "target",
        yes: { openness: VALUE_SHIFT.standard, justice: VALUE_SHIFT.minor, order: -VALUE_SHIFT.minor },
        no: { openness: -VALUE_SHIFT.standard, justice: -VALUE_SHIFT.minor, order: VALUE_SHIFT.minor }
    });

    addDecisionValues("buildFigureMonument", {
        town: "subject",
        yes: { change: -VALUE_SHIFT.minor, justice: VALUE_SHIFT.minor },
        no: { change: VALUE_SHIFT.minor, justice: -VALUE_SHIFT.minor }
    });

    addDecisionValues("buildEventMonument", {
        town: "subject",
        yes: { change: -VALUE_SHIFT.minor, justice: VALUE_SHIFT.minor },
        no: { change: VALUE_SHIFT.minor, justice: -VALUE_SHIFT.minor }
    });

    addDecisionValues("greatWorkProposal", {
        town: (subject, target, args) => args.value?.town,
        yes: { change: VALUE_SHIFT.minor, wealth: VALUE_SHIFT.minor },
        no: { change: -VALUE_SHIFT.minor, wealth: -VALUE_SHIFT.minor }
    });

    addDecisionValues("loreGuidance", {
        town: (subject, target, args) => args.town,
        yes: (subject, target, args) => getLoreValueShift(args.entry?.theme),
        no: (subject, target, args) => invertValueMap(getLoreValueShift(args.entry?.theme))
    });

    addDecisionValues("establishTradeRoute", {
        town: "both",
        yes: { openness: VALUE_SHIFT.minor, wealth: VALUE_SHIFT.minor },
        no: { openness: -VALUE_SHIFT.minor, wealth: -VALUE_SHIFT.minor }
    });

    addDecisionValues("establishSeaRoute", {
        town: "both",
        yes: { openness: VALUE_SHIFT.minor, wealth: VALUE_SHIFT.minor },
        no: { openness: -VALUE_SHIFT.minor, wealth: -VALUE_SHIFT.minor }
    });

    addDecisionValues("tradeHubEmerges", {
        town: "subject",
        yes: { openness: VALUE_SHIFT.minor, wealth: -VALUE_SHIFT.minor, change: VALUE_SHIFT.minor },
        no: { openness: -VALUE_SHIFT.minor, wealth: VALUE_SHIFT.minor, change: -VALUE_SHIFT.minor }
    });

    addDecisionValues("climateDisease", {
        town: "subject",
        yes: { order: VALUE_SHIFT.minor, wealth: VALUE_SHIFT.minor },
        no: { order: -VALUE_SHIFT.minor, wealth: -VALUE_SHIFT.minor }
    });

    addDecisionValues("coldHardship", {
        town: "subject",
        yes: { wealth: VALUE_SHIFT.minor, justice: VALUE_SHIFT.minor },
        no: { wealth: -VALUE_SHIFT.minor, justice: -VALUE_SHIFT.minor }
    });

    addDecisionValues("heatWave", {
        town: "subject",
        yes: { order: VALUE_SHIFT.minor, wealth: VALUE_SHIFT.minor },
        no: { order: -VALUE_SHIFT.minor, wealth: -VALUE_SHIFT.minor }
    });

    addDecisionValues("localDeforestation", {
        town: "subject",
        yes: { change: VALUE_SHIFT.minor, wealth: VALUE_SHIFT.minor },
        no: { change: -VALUE_SHIFT.minor, wealth: -VALUE_SHIFT.minor }
    });

    addDecisionValues("soilExhaustion", {
        town: "subject",
        yes: { change: VALUE_SHIFT.minor, wealth: VALUE_SHIFT.minor },
        no: { change: -VALUE_SHIFT.minor, wealth: -VALUE_SHIFT.minor }
    });

    addDecisionValues("desertificationRisk", {
        town: "subject",
        yes: { change: VALUE_SHIFT.minor, order: VALUE_SHIFT.minor, wealth: VALUE_SHIFT.minor },
        no: { change: -VALUE_SHIFT.minor, order: -VALUE_SHIFT.minor, wealth: -VALUE_SHIFT.minor }
    });

    addDecisionValues("irrigationSuccess", {
        town: "subject",
        yes: { change: VALUE_SHIFT.minor, order: VALUE_SHIFT.minor },
        no: { change: -VALUE_SHIFT.minor, order: -VALUE_SHIFT.minor }
    });

    addDecisionValues("industrialPollution", {
        town: "subject",
        yes: { change: VALUE_SHIFT.minor, order: VALUE_SHIFT.minor },
        no: { change: -VALUE_SHIFT.minor, order: -VALUE_SHIFT.minor }
    });

    // Values drift slowly toward center over time
    modEvent("valuesDrift", {
        daily: true,
        subject: { reg: "town", all: true },
        value: (subject) => {
            if (!VALUES_CONFIG.drift.enabled) return false;
            initTownValues(subject);
            return VALUES_CONFIG.axes.some(axis => Math.abs(subject.values[axis] || 0) >= VALUES_CONFIG.drift.threshold);
        },
        func: (subject) => {
            const rate = VALUES_CONFIG.drift.rate;
            const threshold = VALUES_CONFIG.drift.threshold;
            for (const axis of VALUES_CONFIG.axes) {
                const current = subject.values[axis] || 0;
                if (Math.abs(current) < threshold) continue;
                let next = current - Math.sign(current) * rate;
                if (Math.abs(next) < rate) next = 0;
                subject.values[axis] = clampValue(next, VALUES_CONFIG.range.min, VALUES_CONFIG.range.max);
            }
        }
    });

    const MOD_LOG_BUDGETS = {
        migration: { perDay: 2, perTownCooldown: 12 },
        espionage: { perDay: 2, perTownCooldown: 10 },
        trade: { perDay: 2, perTownCooldown: 10 },
        lore: { perDay: 1 },
        governance: { perDay: 2, perTownCooldown: 15 },
        religion: { perDay: 2, perTownCooldown: 15 },
        season: { perDay: 2, perTownCooldown: 10 },
        resource: { perDay: 2, perTownCooldown: 20 }
    };

    function initLogBudgets() {
        if (typeof planet === "undefined") return null;
        const day = planet.day || 0;
        if (!planet._paultendoLogBudgets || planet._paultendoLogBudgets.day !== day) {
            planet._paultendoLogBudgets = { day, systems: {} };
        }
        return planet._paultendoLogBudgets;
    }

    function shouldLogSystem(system, options = {}) {
        if (!system) return true;
        if (options.force) return true;
        const type = options.type;
        if (type === "warning" || type === "milestone") return true;
        const cfg = MOD_LOG_BUDGETS[system];
        if (!cfg) return true;
        const state = initLogBudgets();
        if (!state) return true;
        if (!state.systems[system]) state.systems[system] = { count: 0, townLast: {} };
        const sys = state.systems[system];
        if (cfg.perDay && sys.count >= cfg.perDay) return false;
        if (cfg.perTownCooldown && options.town) {
            const townId = typeof options.town === "object" ? options.town.id : options.town;
            if (townId !== undefined && townId !== null) {
                const lastDay = sys.townLast[townId];
                if (lastDay !== undefined && (state.day - lastDay) < cfg.perTownCooldown) {
                    return false;
                }
            }
        }
        return true;
    }

    function noteLogSystem(system, town) {
        if (!system) return;
        const cfg = MOD_LOG_BUDGETS[system];
        if (!cfg) return;
        const state = initLogBudgets();
        if (!state) return;
        if (!state.systems[system]) state.systems[system] = { count: 0, townLast: {} };
        const sys = state.systems[system];
        sys.count += 1;
        if (cfg.perTownCooldown && town) {
            const townId = typeof town === "object" ? town.id : town;
            if (townId !== undefined && townId !== null) {
                sys.townLast[townId] = state.day;
            }
        }
    }

    function modLog(system, message, type, options = {}) {
        if (!message) return false;
        if (!shouldLogSystem(system, { ...options, type })) return false;
        const result = logMessage(message, type);
        noteLogSystem(system, options.town);
        return result;
    }

    function getTownCenter(town) {
        if (!town) return null;
        if (!town.center && typeof happen === "function") {
            try { happen("UpdateCenter", null, town); } catch {}
        }
        if (town.center && town.center.length >= 2) return town.center;
        if (typeof town.x === "number" && typeof town.y === "number") return [town.x, town.y];
        return null;
    }

    function getTownLandmassId(town) {
        if (!town || typeof chunkAt !== "function") return null;
        const center = getTownCenter(town);
        if (!center) return null;
        const chunk = chunkAt(center[0], center[1]);
        return (chunk && chunk.v) ? chunk.v.g : null;
    }

    // =========================================================================
    // SEASONS SYSTEM (global calendar + seasonal influences)
    // =========================================================================

    const SEASON_LENGTH_DAYS = 30;
    const YEAR_LENGTH_DAYS = SEASON_LENGTH_DAYS * 4;
    const SEASONS = [
        { id: "spring", name: "Spring", icon: "🌱" },
        { id: "summer", name: "Summer", icon: "☀" },
        { id: "autumn", name: "Autumn", icon: "🍂" },
        { id: "winter", name: "Winter", icon: "❄" }
    ];

    function getSeasonInfo(day = null) {
        if (!planet) return null;
        const currentDay = day || planet.day || 1;
        const dayIndex = Math.max(0, currentDay - 1);
        const year = Math.floor(dayIndex / YEAR_LENGTH_DAYS) + 1;
        const dayOfYear = (dayIndex % YEAR_LENGTH_DAYS) + 1;
        const seasonIndex = Math.floor((dayOfYear - 1) / SEASON_LENGTH_DAYS);
        const seasonDay = ((dayOfYear - 1) % SEASON_LENGTH_DAYS) + 1;
        const season = SEASONS[seasonIndex] || SEASONS[0];
        return {
            year,
            dayOfYear,
            seasonIndex,
            seasonDay,
            id: season.id,
            name: season.name,
            icon: season.icon
        };
    }

    function ensureSeasonIndicator() {
        if (typeof document === "undefined") return null;
        const statsMain = document.getElementById("statsMain");
        if (!statsMain) return null;
        let indicator = document.getElementById("paultendoSeasonIndicator");
        if (!indicator) {
            indicator = document.createElement("span");
            indicator.id = "paultendoSeasonIndicator";
            indicator.className = "panelSubtitle";
            const statsDiv = document.getElementById("statsDiv");
            if (statsDiv) statsMain.insertBefore(indicator, statsDiv);
            else statsMain.appendChild(indicator);
        }
        return indicator;
    }

    function updateSeasonIndicator() {
        const info = getSeasonInfo();
        if (!info) return;
        const indicator = ensureSeasonIndicator();
        if (!indicator) return;
        indicator.textContent = `${info.icon} ${info.name} ${info.seasonDay}/${SEASON_LENGTH_DAYS} · Year ${info.year}`;
    }

    function updateSeasonState() {
        const info = getSeasonInfo();
        if (!info) return;
        const prev = planet._paultendoSeason;
        planet._paultendoSeason = info;
        updateSeasonIndicator();
        try { updateDiscoveryIndicator(); } catch {}
        try { updateSystemIndicator(); } catch {}
        try { updateGreatWorkIndicator(); } catch {}

        if (!prev || prev.year !== info.year) {
            try {
                const stage = getAnnalsStage();
                const title = `Year ${info.year} Begins`;
                let body = stage === "oral"
                    ? `The year turns anew, and {{people}} mark the return of ${info.name}.`
                    : stage === "scribe"
                        ? `Records begin Year ${info.year} in ${info.name}.`
                        : `Archivists mark Year ${info.year} with the return of ${info.name}.`;
                recordAnnalsEntry({
                    theme: "nature",
                    title,
                    body,
                    sourceType: "year_start",
                    sourceId: info.year,
                    day: planet.day
                });
            } catch {}
        }
    }

    // -------------------------------------------------------------------------
    // UI INDICATORS (Discovery + Active Systems)
    // -------------------------------------------------------------------------

    function ensureStatsIndicator(id) {
        if (typeof document === "undefined") return null;
        const statsMain = document.getElementById("statsMain");
        if (!statsMain) return null;
        let indicator = document.getElementById(id);
        if (!indicator) {
            indicator = document.createElement("span");
            indicator.id = id;
            indicator.className = "panelSubtitle";
        }
        const statsDiv = document.getElementById("statsDiv");
        if (statsDiv && indicator.parentNode !== statsMain) {
            statsMain.insertBefore(indicator, statsDiv);
        } else if (!indicator.parentNode) {
            statsMain.appendChild(indicator);
        }
        return indicator;
    }

    function formatDiscoveryRequirement(req) {
        if (!req) return "";
        const parts = [];
        if (req.travel) parts.push(`Travel ${req.travel}`);
        if (req.trade) parts.push(`Trade ${req.trade}`);
        if (req.education) parts.push(`Education ${req.education}`);
        if (req.towns) parts.push(`${req.towns} towns`);
        return parts.join(", ");
    }

    function updateDiscoveryIndicator() {
        if (!initDiscoveryState()) return;
        const indicator = ensureStatsIndicator("paultendoDiscoveryIndicator");
        if (!indicator) return;
        const tier = getDiscoveryTier();
        const maxTier = getDiscoveryMaxTier();
        let nextText = "Maxed";
        if (tier < maxTier) {
            const req = DISCOVERY_TIER_REQUIREMENTS[tier + 1];
            nextText = req ? formatDiscoveryRequirement(req) : "Unknown";
        }
        indicator.textContent = `Discovery: ${getDiscoveryTierName(tier)}${tier < maxTier ? ` → ${nextText}` : ""}`;
    }

    function ensureSystemStyles() {
        if (typeof document === "undefined") return;
        if (document.getElementById("paultendoSystemStyles")) return;
        const style = document.createElement("style");
        style.id = "paultendoSystemStyles";
        style.textContent = `
            #paultendoSystemsIndicator { font-size: 0.95em; opacity: 0.9; }
            .paultendoSystemTag {
                display: inline-block;
                margin-right: 6px;
                padding: 0 4px;
                border-radius: 4px;
                font-size: 0.9em;
                border: 1px solid rgba(255,255,255,0.15);
                background: rgba(0,0,0,0.15);
            }
        `;
        document.head.appendChild(style);
    }

    function getActiveSystemTags() {
        const tags = [];
        const wars = regFilter("process", p => p.type === "war" && !p.done);
        if (wars.length) tags.push({ key: "WAR", count: wars.length, color: "rgba(255,120,120,0.9)" });
        const epidemics = planet.epidemics && planet.epidemics.length ? planet.epidemics.length : 0;
        if (epidemics) tags.push({ key: "PLAGUE", count: epidemics, color: "rgba(255,210,120,0.9)" });
        const alliances = planet.alliances && planet.alliances.length ? planet.alliances.length : 0;
        if (alliances) tags.push({ key: "ALLIANCE", count: alliances, color: "rgba(120,200,255,0.9)" });
        const routes = planet.tradeRoutes && planet.tradeRoutes.length ? planet.tradeRoutes.length : 0;
        if (routes) tags.push({ key: "TRADE", count: routes, color: "rgba(120,255,170,0.9)" });
        const secrets = planet._paultendoSecrets ? planet._paultendoSecrets.filter(s => !s.exposed).length : 0;
        if (secrets) tags.push({ key: "SECRETS", count: secrets, color: "rgba(200,200,200,0.9)" });

        const universe = getUniverse(false);
        if (universe) {
            const spaceRoutes = universe.spaceRoutes ? universe.spaceRoutes.filter(r => r.active).length : 0;
            const spaceWars = universe.spaceWars ? universe.spaceWars.filter(w => !w.endedDay).length : 0;
            if (spaceRoutes) tags.push({ key: "SPACE ROUTE", count: spaceRoutes, color: "rgba(170,170,255,0.9)" });
            if (spaceWars) tags.push({ key: "SPACE WAR", count: spaceWars, color: "rgba(255,170,170,0.9)" });
        }

        return tags;
    }

    function updateSystemIndicator() {
        ensureSystemStyles();
        const indicator = ensureStatsIndicator("paultendoSystemsIndicator");
        if (!indicator) return;
        const tags = getActiveSystemTags();
        if (!tags.length) {
            indicator.textContent = "Systems: calm";
            return;
        }
        indicator.innerHTML = "Systems: " + tags.map(tag => {
            const label = `${tag.key}${tag.count ? ` ${tag.count}` : ""}`;
            return `<span class="paultendoSystemTag" style="color:${tag.color}" title="${tag.key}">${label}</span>`;
        }).join("");
    }

    function getCurrentGreatWork() {
        if (!planet || !planet.currentEra) return null;
        return ensureGreatWorkForEra(planet.currentEra);
    }

    function formatGreatWorkStatus(work) {
        if (!work) return "Great Work: unavailable";
        if (work.status === "completed") return `Great Work: ${work.title} (completed)`;
        if (work.status === "started") {
            const town = work.townId ? regGet("town", work.townId) : null;
            const townName = town ? ` in ${town.name}` : "";
            return `Great Work: ${work.title} (building${townName})`;
        }
        return `Great Work: ${work.title} (pending)`;
    }

    function updateGreatWorkIndicator() {
        const indicator = ensureStatsIndicator("paultendoGreatWorkIndicator");
        if (!indicator) return;
        const work = getCurrentGreatWork();
        if (!work) {
            indicator.textContent = "Great Work: none";
            return;
        }
        indicator.textContent = formatGreatWorkStatus(work);
    }

    function getSeasonalInfluences(town) {
        const season = getSeasonInfo();
        if (!season || !town) return null;
        const climate = getTownClimate(town);
        const cold = clampValue((0.5 - climate.temp) / 0.25, 0, 1);
        const heat = clampValue((climate.temp - 0.55) / 0.25, 0, 1);
        const dry = clampValue((0.45 - climate.moisture) / 0.25, 0, 1);
        const wet = clampValue((climate.moisture - 0.6) / 0.25, 0, 1);

        const influences = {};

        if (season.id === "spring") {
            const growth = 0.08 * (1 - dry * 0.6);
            influences.farm = growth;
            influences.travel = 0.05;
            influences.happy = 0.04;
            if (wet > 0) influences.disease = 0.04 * wet;
            influences.hunger = -0.03;
        } else if (season.id === "summer") {
            const heatStress = clampValue(heat + dry * 0.8, 0, 1.5);
            influences.farm = 0.05 - 0.12 * heatStress;
            influences.travel = 0.04 - 0.06 * heatStress;
            influences.trade = 0.04 - 0.04 * heatStress;
            if (heatStress > 0) {
                influences.hunger = 0.05 * heatStress;
                influences.disease = 0.03 * heatStress;
                influences.happy = -0.03 * heatStress;
            }
        } else if (season.id === "autumn") {
            const harvest = 0.12 * (1 - dry * 0.5);
            influences.farm = harvest;
            influences.trade = 0.05;
            influences.happy = 0.05;
            influences.hunger = -0.04;
            if (wet > 0) influences.disease = 0.03 * wet;
        } else if (season.id === "winter") {
            const chill = clampValue(cold + wet * 0.2, 0, 1.2);
            influences.travel = -0.08 * (1 + chill);
            influences.trade = -0.05 * (1 + chill * 0.7);
            influences.farm = -0.12 * (1 + chill);
            influences.disease = 0.08 * (1 + chill);
            influences.hunger = 0.07 * (1 + chill);
            influences.happy = -0.04 * (1 + chill * 0.6);
        }

        return influences;
    }

    // =========================================================================
    // DISCOVERY TIERS (progressive world discovery, tiered expansion)
    // =========================================================================

    const DISCOVERY_CONFIG = {
        maxTier: 3, // 0 = homeland, 1..3 = farther horizons
        fogAlpha: 0.55,
        worldScaleDefault: 1.5
    };

    const FOG_CONFIG = {
        enabled: true,
        opaqueAlpha: 0.98,
        shroudAlpha: 0.55,
        baseSight: 3,
        sizeSight: 0.35,
        travelSight: 0.15,
        elevationSight: 4,
        maxSight: 12,
        falloffPower: 1.6,
        exploreThreshold: 0.15,
        hideMarkersOutsideSight: false,
        hideBiomeOutsideSight: true,
        townRevealRadius: 1,
        expeditionRevealRadius: 2,
        expeditionRevealCount: 3
    };

    const DISCOVERY_TIER_NAMES = {
        0: "Homelands",
        1: "Near Seas",
        2: "New World",
        3: "Far East"
    };

    const DISCOVERY_TIER_REQUIREMENTS = {
        1: { travel: 30, trade: 10, education: 5, towns: 2 },
        2: { travel: 60, trade: 25, education: 15, towns: 4 },
        3: { travel: 80, trade: 40, education: 30, towns: 6 }
    };

    function initDiscoveryState() {
        if (!planet || !reg || !reg.landmass) return false;
        if (!planet._paultendoDiscovery) {
            planet._paultendoDiscovery = {
                tier: 0,
                discovered: [],
                tiers: null,
                centers: null,
                maxTier: 0,
                boost: 0,
                boostUntil: 0
            };
        }
        if (!Array.isArray(planet._paultendoDiscovery.discovered)) {
            planet._paultendoDiscovery.discovered = [];
        }
        return true;
    }

    function getDiscoveryTier() {
        if (!initDiscoveryState()) return 0;
        return planet._paultendoDiscovery.tier || 0;
    }

    function setDiscoveryTier(tier) {
        if (!initDiscoveryState()) return;
        planet._paultendoDiscovery.tier = tier;
    }

    function getDiscoveryMaxTier() {
        if (!initDiscoveryState()) return 0;
        return planet._paultendoDiscovery.maxTier || 0;
    }

    function getDiscoveryTierName(tier) {
        return DISCOVERY_TIER_NAMES[tier] || `Tier ${tier}`;
    }

    // =========================================================================
    // TRUE FOG OF WAR (chunk-level exploration tracking)
    // =========================================================================

    function initFogOfWarState() {
        if (!planet) return false;
        if (!planet._paultendoFog) {
            planet._paultendoFog = {
                explored: {},
                lastUpdate: planet.day
            };
        }
        if (!planet._paultendoFog.explored || typeof planet._paultendoFog.explored !== "object") {
            planet._paultendoFog.explored = {};
        }
        return true;
    }

    function getChunkKey(x, y) {
        return `${x},${y}`;
    }

    function isFogActive() {
        if (!FOG_CONFIG.enabled) return false;
        if (!planet || typeof regCount !== "function") return false;
        if (regCount("town") <= 0) return false;
        return true;
    }

    function isChunkExplored(x, y) {
        if (!FOG_CONFIG.enabled) return true;
        if (!planet || typeof regCount !== "function") return true;
        if (regCount("town") <= 0) return true;
        if (!initFogOfWarState()) return true;
        return !!planet._paultendoFog.explored[getChunkKey(x, y)];
    }

    function markChunksExplored(chunks, opts = {}) {
        if (!initFogOfWarState() || !Array.isArray(chunks)) return 0;
        const fog = planet._paultendoFog;
        let added = 0;
        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            if (!chunk || typeof chunk.x !== "number" || typeof chunk.y !== "number") continue;
            if (!opts.force && chunk.v && chunk.v.g && !isLandmassDiscovered(chunk.v.g) && !isMountainChunk(chunk)) continue;
            const key = getChunkKey(chunk.x, chunk.y);
            if (fog.explored[key]) continue;
            fog.explored[key] = 1;
            added += 1;
        }
        if (added > 0 && !opts.deferRefresh) scheduleFogRefresh();
        return added;
    }

    function markChunkExplored(x, y) {
        const chunk = typeof x === "object" ? x : (typeof chunkAt === "function" ? chunkAt(x, y) : null);
        if (!chunk) return 0;
        return markChunksExplored([chunk]);
    }

    function getTownClaimedChunks(town) {
        if (!town) return [];
        if (!town.center && typeof happen === "function") {
            try { happen("UpdateCenter", null, town); } catch {}
        }
        if (town.center && typeof floodFill === "function") {
            const limit = Math.max(1, town.size || 1);
            const chunks = floodFill(
                town.center[0],
                town.center[1],
                (c) => c && c.v && c.v.s === town.id,
                limit
            );
            if (Array.isArray(chunks) && chunks.length) return chunks;
        }
        if (typeof filterChunks === "function") {
            return filterChunks((c) => c && c.v && c.v.s === town.id);
        }
        return [];
    }

    function getChunkDimensions() {
        const width = typeof planetWidth === "number" && typeof chunkSize === "number" ? Math.floor(planetWidth / chunkSize) : null;
        const height = typeof planetHeight === "number" && typeof chunkSize === "number" ? Math.floor(planetHeight / chunkSize) : null;
        return { width, height };
    }

    function resetFogVisibilityForDay(force = false) {
        if (!initFogOfWarState()) return false;
        if (force || planet._paultendoFog.visibilityDay !== planet.day) {
            planet._paultendoFog.visibilityDay = planet.day;
            planet._paultendoFog.visible = {};
        }
        return true;
    }

    function getChunkVisibility(x, y) {
        if (!initFogOfWarState()) return 0;
        return planet._paultendoFog.visible[getChunkKey(x, y)] || 0;
    }

    function setChunkVisibility(x, y, value) {
        if (!initFogOfWarState()) return;
        const key = getChunkKey(x, y);
        const existing = planet._paultendoFog.visible[key] || 0;
        if (value > existing) planet._paultendoFog.visible[key] = value;
    }

    function getChunkElevation(chunk) {
        if (!chunk) return 0;
        return typeof chunk.e === "number" ? chunk.e : 0;
    }

    function isMountainChunk(chunk) {
        if (!chunk) return false;
        if (chunk.b === "mountain") return true;
        if (chunk.v && chunk.v.g) {
            const landmass = regGet("landmass", chunk.v.g);
            return landmass && landmass.type === "mountain";
        }
        return false;
    }

    function computeTownSightRadius(town) {
        if (!town) return FOG_CONFIG.baseSight;
        const base = FOG_CONFIG.baseSight;
        const size = town.size || 1;
        const travel = town.influences?.travel || 0;
        const center = town.center ? chunkAt(town.center[0], town.center[1]) : null;
        const elevation = center ? getChunkElevation(center) : 0;
        const elevationBonus = Math.max(0, (elevation - (typeof waterLevel === "number" ? waterLevel : 0.3)) * FOG_CONFIG.elevationSight);
        const sizeBonus = Math.sqrt(Math.max(1, size)) * FOG_CONFIG.sizeSight;
        const travelBonus = Math.max(0, travel) * FOG_CONFIG.travelSight;
        const radius = base + sizeBonus + travelBonus + elevationBonus;
        return clampValue(radius, base, FOG_CONFIG.maxSight);
    }

    function computeVisibilityStrength(distance, radius, observerElev, targetElev) {
        if (radius <= 0) return 0;
        const ratio = clampValue(distance / radius, 0, 1);
        let strength = 1 - Math.pow(ratio, FOG_CONFIG.falloffPower);
        const elevBoost = Math.max(0, observerElev - (typeof waterLevel === "number" ? waterLevel : 0.3));
        strength *= 1 + elevBoost * 0.15;
        if (typeof targetElev === "number") {
            strength *= 0.85 + Math.min(0.3, targetElev * 0.3);
        }
        return clampValue(strength, 0, 1);
    }

    const FOG_SIGHT_OFFSETS = {};

    function getSightOffsets(radius) {
        const key = Math.max(1, Math.round(radius * 10) / 10);
        if (FOG_SIGHT_OFFSETS[key]) return FOG_SIGHT_OFFSETS[key];
        const rCeil = Math.ceil(radius);
        const list = [];
        for (let dx = -rCeil; dx <= rCeil; dx++) {
            for (let dy = -rCeil; dy <= rCeil; dy++) {
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist > radius) continue;
                list.push({ dx, dy, dist });
            }
        }
        FOG_SIGHT_OFFSETS[key] = list;
        return list;
    }

    function updateFogVisibilityForTown(town, opts = {}) {
        if (!town || town.end) return false;
        if (!resetFogVisibilityForDay(!!opts.forceReset)) return false;
        if (!town.center && typeof happen === "function") {
            try { happen("UpdateCenter", null, town); } catch {}
        }
        if (!town.center) return false;

        const { width, height } = getChunkDimensions();
        if (!width || !height) return false;
        const radius = computeTownSightRadius(town);

        const claimed = getTownClaimedChunks(town);
        const explored = [];
        const claimedSet = new Set();
        for (let i = 0; i < claimed.length; i++) {
            const c = claimed[i];
            if (!c) continue;
            claimedSet.add(getChunkKey(c.x, c.y));
            setChunkVisibility(c.x, c.y, 1); // 100% visibility inside town territory
        }

        const adjacency = (typeof adjacentCoords !== "undefined" && Array.isArray(adjacentCoords) && adjacentCoords.length)
            ? adjacentCoords
            : [[0, -1], [1, 0], [0, 1], [-1, 0]];

        const edgeChunks = [];
        for (let i = 0; i < claimed.length; i++) {
            const c = claimed[i];
            if (!c) continue;
            let isEdge = false;
            for (let j = 0; j < adjacency.length; j++) {
                const dx = adjacency[j][0];
                const dy = adjacency[j][1];
                const nx = c.x + dx;
                const ny = c.y + dy;
                if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
                    isEdge = true;
                    break;
                }
                if (!claimedSet.has(getChunkKey(nx, ny))) {
                    isEdge = true;
                    break;
                }
            }
            if (isEdge) edgeChunks.push(c);
        }

        const sources = edgeChunks.length ? edgeChunks : claimed;
        const offsets = getSightOffsets(radius);
        for (let i = 0; i < sources.length; i++) {
            const source = sources[i];
            if (!source) continue;
            const observerElev = getChunkElevation(source);

            for (let j = 0; j < offsets.length; j++) {
                const offset = offsets[j];
                const x = source.x + offset.dx;
                const y = source.y + offset.dy;
                if (x < 0 || y < 0 || x >= width || y >= height) continue;
                if (claimedSet.has(getChunkKey(x, y))) continue;

                const chunk = chunkAt(x, y);
                if (!chunk) continue;
                if (chunk.v && chunk.v.g && !isLandmassDiscovered(chunk.v.g) && !isMountainChunk(chunk)) continue;

                const targetElev = getChunkElevation(chunk);
                const visibility = computeVisibilityStrength(offset.dist, radius, observerElev, targetElev);
                if (visibility <= 0) continue;

                setChunkVisibility(x, y, visibility);
                if (visibility >= FOG_CONFIG.exploreThreshold) explored.push(chunk);
            }
        }

        if (explored.length) {
            markChunksExplored(explored, { deferRefresh: true });
        }
        if (claimed.length) {
            markChunksExplored(claimed, { deferRefresh: true, force: true });
        }

        town._paultendoFogInit = true;
        town._paultendoFogSize = town.size || 0;
        if (!opts.deferRefresh) scheduleFogRefresh();
        return true;
    }

    function rebuildFogVisibility() {
        if (!initFogOfWarState()) return false;
        resetFogVisibilityForDay(true);
        const towns = regFilter("town", t => t && !t.end && t.pop > 0);
        for (let i = 0; i < towns.length; i++) {
            updateFogVisibilityForTown(towns[i], { deferRefresh: true, forceReset: false });
        }
        scheduleFogRefresh();
        return true;
    }

    function isChunkVisible(x, y) {
        return getChunkVisibility(x, y) > 0;
    }

    function markTownExplored(town) {
        return updateFogVisibilityForTown(town);
    }

    function revealLandmassFootprint(landmassId, sourceTown) {
        if (!landmassId || !initFogOfWarState()) return false;
        if (typeof filterChunks !== "function") return false;
        const chunks = filterChunks((c) => c && c.v && c.v.g === landmassId);
        if (!chunks.length) return false;

        const revealCount = Math.max(1, Math.min(FOG_CONFIG.expeditionRevealCount, Math.ceil(chunks.length / 120)));
        const picks = [];
        for (let i = 0; i < revealCount; i++) {
            picks.push(choose(chunks));
        }

        const reveal = [];
        for (let i = 0; i < picks.length; i++) {
            const pick = picks[i];
            if (!pick) continue;
            reveal.push(pick);
            if (FOG_CONFIG.expeditionRevealRadius > 0 && typeof circleCoords === "function") {
                const coords = circleCoords(pick.x, pick.y, FOG_CONFIG.expeditionRevealRadius);
                for (let j = 0; j < coords.length; j++) {
                    const chunk = typeof chunkAt === "function" ? chunkAt(coords[j].x, coords[j].y) : null;
                    if (chunk) reveal.push(chunk);
                }
            }
        }

        if (sourceTown && sourceTown.center && typeof circleCoords === "function") {
            const coords = circleCoords(sourceTown.center[0], sourceTown.center[1], 1);
            for (let i = 0; i < coords.length; i++) {
                const chunk = typeof chunkAt === "function" ? chunkAt(coords[i].x, coords[i].y) : null;
                if (chunk) reveal.push(chunk);
            }
        }

        if (reveal.length) markChunksExplored(reveal);
        return true;
    }

    function ensureFogLayer() {
        if (typeof addCanvasLayer !== "function") return false;
        if (typeof canvasLayers === "undefined" || typeof canvasLayersOrder === "undefined") return false;
        if (!canvasLayers.fog) {
            addCanvasLayer("fog");
            const fogIndex = canvasLayersOrder.indexOf("fog");
            const cursorIndex = canvasLayersOrder.indexOf("cursor");
            if (cursorIndex >= 0 && fogIndex > cursorIndex) {
                canvasLayersOrder.splice(fogIndex, 1);
                canvasLayersOrder.splice(cursorIndex, 0, "fog");
            }
            if (typeof resizeCanvases === "function") {
                resizeCanvases();
            }
            try { rebuildFogVisibility(); } catch {}
        }
        return !!canvasLayers.fog;
    }

    function getFogOpacity() {
        const base = FOG_CONFIG.opaqueAlpha;
        return clampValue(base, 0.85, 1);
    }

    function renderFogOfWar() {
        if (!ensureFogLayer()) return;
        const ctx = canvasLayersCtx ? canvasLayersCtx.fog : null;
        if (!ctx || typeof canvasLayers === "undefined") return;
        const fogCanvas = canvasLayers.fog;
        if (!fogCanvas) return;

        ctx.clearRect(0, 0, fogCanvas.width, fogCanvas.height);
        if (!isFogActive()) return;
        if (!planet || !planet.chunks) return;
        if (typeof chunkSize === "undefined") return;
        if (!planet._paultendoDiscoveryReady) {
            try { ensureDiscoveryReadyForFog(); } catch {}
        }

        const opaqueAlpha = getFogOpacity();
        const shroudAlpha = clampValue(FOG_CONFIG.shroudAlpha, 0, 0.9);

        const fogState = planet._paultendoFog || {};
        const explored = fogState.explored || {};
        const visible = fogState.visible || {};

        for (const chunkKey in planet.chunks) {
            const chunk = planet.chunks[chunkKey];
            if (!chunk || !chunk.v) continue;
            if (chunk.v.g && !isLandmassDiscovered(chunk.v.g) && !chunk.v.s && !isMountainChunk(chunk)) {
                ctx.fillStyle = `rgba(8, 10, 14, ${opaqueAlpha})`;
                ctx.fillRect(chunk.x * chunkSize, chunk.y * chunkSize, chunkSize, chunkSize);
                continue;
            }

            const key = getChunkKey(chunk.x, chunk.y);
            if (!explored[key]) {
                ctx.fillStyle = `rgba(8, 10, 14, ${opaqueAlpha})`;
                ctx.fillRect(chunk.x * chunkSize, chunk.y * chunkSize, chunkSize, chunkSize);
                continue;
            }

            const visibility = visible[key] || 0;
            const alpha = visibility > 0 ? shroudAlpha * (1 - visibility) : shroudAlpha;
            if (alpha > 0.02) {
                ctx.fillStyle = `rgba(8, 10, 14, ${alpha})`;
                ctx.fillRect(chunk.x * chunkSize, chunk.y * chunkSize, chunkSize, chunkSize);
            }
        }
    }

    function scheduleFogRefresh() {
        if (!planet) return;
        if (planet._paultendoFogRefreshPending) return;
        planet._paultendoFogRefreshPending = true;

        const refresh = () => {
            planet._paultendoFogRefreshPending = false;
            try { renderFogOfWar(); } catch {}
            try { if (typeof updateCanvas === "function") updateCanvas(); } catch {}
        };

        if (typeof window !== "undefined" && typeof window.setTimeout === "function") {
            window.setTimeout(refresh, 30);
        } else {
            refresh();
        }
    }

    function computeLandmassCenters() {
        if (!planet || !planet.chunks) return null;
        const sums = {};
        const counts = {};
        for (const chunkKey in planet.chunks) {
            const chunk = planet.chunks[chunkKey];
            if (!chunk || !chunk.v || !chunk.v.g) continue;
            const id = chunk.v.g;
            if (!sums[id]) {
                sums[id] = { x: 0, y: 0 };
                counts[id] = 0;
            }
            sums[id].x += chunk.x;
            sums[id].y += chunk.y;
            counts[id] += 1;
        }
        const centers = {};
        for (const [id, sum] of Object.entries(sums)) {
            const count = counts[id] || 1;
            centers[id] = { x: sum.x / count, y: sum.y / count };
        }
        if (initDiscoveryState()) {
            planet._paultendoDiscovery.centers = centers;
        }
        return centers;
    }

    function getLandmassCenter(landmassId) {
        if (!initDiscoveryState()) return null;
        if (!planet._paultendoDiscovery.centers) {
            computeLandmassCenters();
        }
        return planet._paultendoDiscovery.centers ? planet._paultendoDiscovery.centers[landmassId] : null;
    }

    function computeLandmassTiers() {
        if (!initDiscoveryState()) return false;
        const originTown = getOriginTown();
        if (!originTown) return false;
        const originLandmass = getTownLandmassId(originTown);
        if (!originLandmass) return false;

        const centers = planet._paultendoDiscovery.centers || computeLandmassCenters();
        const originCenter = centers ? centers[originLandmass] : null;
        if (!originCenter) return false;

        const allLandmasses = regToArray("landmass");
        if (!allLandmasses || allLandmasses.length === 0) return false;

        const mainLandmasses = allLandmasses.filter(l => l && l.type !== "mountain");
        const mountains = allLandmasses.filter(l => l && l.type === "mountain");

        const others = mainLandmasses.filter(l => l.id !== originLandmass);
        const distances = others.map(l => {
            const center = centers[l.id];
            if (!center) return null;
            const dx = center.x - originCenter.x;
            const dy = center.y - originCenter.y;
            return { id: l.id, dist: Math.sqrt(dx * dx + dy * dy) };
        }).filter(Boolean);

        distances.sort((a, b) => a.dist - b.dist);

        const maxTier = Math.min(DISCOVERY_CONFIG.maxTier, distances.length > 0 ? DISCOVERY_CONFIG.maxTier : 0);
        const perTier = maxTier > 0 ? Math.ceil(distances.length / maxTier) : distances.length;

        const tiers = {};
        tiers[originLandmass] = 0;
        for (let i = 0; i < distances.length; i++) {
            const tier = maxTier > 0 ? Math.min(maxTier, Math.floor(i / perTier) + 1) : 0;
            tiers[distances[i].id] = tier;
        }

        // Assign mountain landmasses to nearest main landmass tier
        for (let i = 0; i < mountains.length; i++) {
            const mountain = mountains[i];
            const center = centers[mountain.id];
            if (!center) continue;
            const nearest = weightedChoice(mainLandmasses, (m) => {
                const mCenter = centers[m.id];
                if (!mCenter) return 0;
                const dx = mCenter.x - center.x;
                const dy = mCenter.y - center.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                return dist > 0 ? 1 / dist : 1;
            });
            if (nearest && tiers[nearest.id] !== undefined) {
                tiers[mountain.id] = tiers[nearest.id];
            } else {
                tiers[mountain.id] = 0;
            }
        }

        planet._paultendoDiscovery.tiers = tiers;
        planet._paultendoDiscovery.maxTier = maxTier;
        return true;
    }

    function getLandmassTier(landmassId) {
        if (!initDiscoveryState()) return 0;
        if (!planet._paultendoDiscovery.tiers) {
            computeLandmassTiers();
        }
        return planet._paultendoDiscovery.tiers && planet._paultendoDiscovery.tiers[landmassId] !== undefined
            ? planet._paultendoDiscovery.tiers[landmassId]
            : 0;
    }

    function isLandmassDiscovered(landmassId) {
        if (!initDiscoveryState()) return true;
        return planet._paultendoDiscovery.discovered.includes(landmassId);
    }

    function discoverLandmass(landmassId, town, reason = "discovered") {
        if (!initDiscoveryState()) return false;
        if (!landmassId) return false;
        if (planet._paultendoDiscovery.discovered.includes(landmassId)) return false;
        planet._paultendoDiscovery.discovered.push(landmassId);

        const landmass = regGet("landmass", landmassId);
        const name = landmass ? landmass.name : "unknown lands";
        if (town) {
            logMessage(`Explorers from {{regname:town|${town.id}}} ${reason} {{regname:landmass|${landmassId}}}!`, "milestone");
        } else {
            logMessage(`The ${name} are ${reason}.`, "milestone");
        }

        try {
            const stage = getAnnalsStage();
            const title = `Discovery of ${landmassRef(landmassId)}`;
            let body = stage === "oral"
                ? `Sailors returned with tales of ${landmassRef(landmassId)}.`
                : stage === "scribe"
                    ? `Charts now include ${landmassRef(landmassId)}, newly reached.`
                    : `Cartographers recorded the first firm knowledge of ${landmassRef(landmassId)}.`;
            const line = themeLine("discovery", stage);
            if (line) body += ` ${line}`;
            recordAnnalsEntry({
                theme: "discovery",
                title,
                body,
                sourceType: "discovery_landmass",
                sourceId: landmassId
            });
        } catch {}
        try { revealLandmassFootprint(landmassId, town); } catch {}
        try {
            if (typeof renderMap === "function" && typeof updateCanvas === "function") {
                renderMap();
                if (typeof renderHighlight === "function") {
                    renderHighlight();
                }
                updateCanvas();
            }
        } catch {}
        return true;
    }

    function isLandmassReachable(landmassId) {
        if (!initDiscoveryState()) return true;
        if (!landmassId) return false;
        if (isLandmassDiscovered(landmassId)) return true;
        return getLandmassTier(landmassId) <= getDiscoveryTier();
    }

    function getOriginTown() {
        const towns = regFilter("town", t => t && !t.end && t.pop > 0);
        if (!towns.length) return null;
        return towns.reduce((oldest, town) => {
            if (!oldest) return town;
            const oldStart = oldest.start || 0;
            const newStart = town.start || 0;
            return newStart < oldStart ? town : oldest;
        }, null);
    }

    function refreshDiscoveryForExistingTowns() {
        if (!initDiscoveryState()) return;
        const towns = regFilter("town", t => t && !t.end && t.pop > 0);
        for (const town of towns) {
            const landmassId = getTownLandmassId(town);
            if (landmassId && !isLandmassDiscovered(landmassId)) {
                discoverLandmass(landmassId, town, "establish contact with");
            }
        }
    }

    function discoveryTierPrereqsMet(tier) {
        const req = DISCOVERY_TIER_REQUIREMENTS[tier];
        if (!req) return false;
        const travel = planet.unlocks?.travel || 0;
        const trade = planet.unlocks?.trade || 0;
        const education = planet.unlocks?.education || 0;
        const towns = regCount("town");

        if (travel < req.travel) return false;
        if (trade < req.trade) return false;
        if (education < req.education) return false;
        if (towns < req.towns) return false;
        return true;
    }

    function getDiscoveryAdvanceChance(tier) {
        const req = DISCOVERY_TIER_REQUIREMENTS[tier];
        if (!req) return 0;
        const travel = planet.unlocks?.travel || 0;
        const trade = planet.unlocks?.trade || 0;
        const education = planet.unlocks?.education || 0;
        const towns = regCount("town");

        let chance = tier === 1 ? 0.002 : tier === 2 ? 0.0015 : 0.001;
        chance += Math.max(0, travel - req.travel) * 0.0002;
        chance += Math.max(0, trade - req.trade) * 0.00015;
        chance += Math.max(0, education - req.education) * 0.00015;
        chance += Math.max(0, towns - req.towns) * 0.0003;

        if (planet._paultendoDiscovery && planet._paultendoDiscovery.boostUntil > planet.day) {
            chance += planet._paultendoDiscovery.boost || 0;
        }

        return Math.min(0.05, chance);
    }

    function attemptDiscoveryTierAdvance() {
        if (!initDiscoveryState()) return false;
        if (!planet || !planet.unlocks) return false;
        if (!planet._paultendoDiscovery.tiers) {
            computeLandmassTiers();
        }
        const currentTier = getDiscoveryTier();
        const maxTier = getDiscoveryMaxTier();
        if (currentTier >= maxTier) return false;

        const nextTier = currentTier + 1;
        if (!discoveryTierPrereqsMet(nextTier)) return false;

        const chance = getDiscoveryAdvanceChance(nextTier);
        if (Math.random() < chance) {
            setDiscoveryTier(nextTier);
            logMessage(`New horizons open: {{b:${getDiscoveryTierName(nextTier)}}} now lie within reach.`, "milestone");
            try {
                const stage = getAnnalsStage();
                const tierName = getDiscoveryTierName(nextTier);
                const title = `${tierName} Opened`;
                let body = stage === "oral"
                    ? `The people whisper of the ${tierName}, and ships dare farther waters.`
                    : stage === "scribe"
                        ? `Navigators mark the ${tierName} as newly reachable.`
                        : `Expanded routes and charts brought the ${tierName} into the known world.`;
                const line = themeLine("discovery", stage);
                if (line) body += ` ${line}`;
                recordAnnalsEntry({
                    theme: "discovery",
                    title,
                    body,
                    sourceType: "discovery_tier",
                    sourceId: nextTier
                });
            } catch {}
            return true;
        }
        return false;
    }

    function discoverReachableLandmass() {
        if (!initDiscoveryState()) return false;
        const reachableTier = getDiscoveryTier();
        const undiscovered = regFilter("landmass", l =>
            l && !isLandmassDiscovered(l.id) && getLandmassTier(l.id) <= reachableTier
        );
        if (undiscovered.length === 0) return false;

        const towns = regFilter("town", t => t && !t.end && t.pop > 0);
        if (towns.length === 0) return false;

        const explorer = weightedChoice(towns, (t) => {
            const travel = t.influences?.travel || 0;
            const trade = t.influences?.trade || 0;
            const education = t.influences?.education || 0;
            return 1 + travel * 0.6 + trade * 0.4 + education * 0.2;
        }) || choose(towns);

        const targetLandmass = weightedChoice(undiscovered, (l) => {
            const tier = getLandmassTier(l.id);
            return tier === reachableTier ? 1.5 : 1;
        });

        if (!targetLandmass) return false;
        discoverLandmass(targetLandmass.id, explorer, "chart");
        return true;
    }

    function renderDiscoveryFog() {
        try { renderFogOfWar(); } catch {}
    }

    function ensureDiscoveryReadyForFog() {
        if (!initDiscoveryState()) return false;
        const townCount = regCount("town");
        if (townCount <= 0) return false;
        const ok = computeLandmassTiers();
        if (!ok) return false;
        refreshDiscoveryForExistingTowns();
        planet._paultendoDiscoveryReady = true;
        return true;
    }

    function getDiscoveryFogAlpha() {
        const base = DISCOVERY_CONFIG.fogAlpha;
        const scale = typeof getWorldScaleSetting === "function" ? getWorldScaleSetting() : 1;
        if (!scale || scale <= 1) return base;
        const divisor = 1 + (scale - 1) * 0.6;
        return clampValue(base / divisor, 0.25, base);
    }

    function getMarkerLandmassId(marker) {
        if (!marker || typeof chunkAt !== "function") return null;
        if (typeof marker.x === "number" && typeof marker.y === "number") {
            const chunk = chunkAt(marker.x, marker.y);
            return chunk && chunk.v ? chunk.v.g : null;
        }
        if (marker.town) {
            const town = regGet("town", marker.town);
            return town ? getTownLandmassId(town) : null;
        }
        return null;
    }

    function shouldShowMarker(marker) {
        const landmassId = getMarkerLandmassId(marker);
        if (!landmassId) return true;
        if (!isLandmassDiscovered(landmassId)) return false;
        if (!FOG_CONFIG.enabled || !isFogActive()) return true;
        if (marker && typeof marker.x === "number" && typeof marker.y === "number") {
            if (!isChunkExplored(marker.x, marker.y)) return false;
            if (FOG_CONFIG.hideMarkersOutsideSight && !isChunkVisible(marker.x, marker.y)) return false;
            return true;
        }
        if (marker && marker.town) {
            const town = regGet("town", marker.town);
            if (town && town.center) {
                if (!isChunkExplored(town.center[0], town.center[1])) return false;
                if (FOG_CONFIG.hideMarkersOutsideSight && !isChunkVisible(town.center[0], town.center[1])) return false;
                return true;
            }
        }
        return true;
    }

    // Apply discovery-aware filters to chunk selection during expansion
    function withDiscoveryFilter(filterFn, func) {
        const prev = window._paultendoDiscoveryFilter;
        window._paultendoDiscoveryFilter = filterFn;
        try { return func(); } finally { window._paultendoDiscoveryFilter = prev; }
    }

    function initDiscoveryChunkFilters() {
        if (typeof filterChunks === "function" && !filterChunks._paultendoDiscovery) {
            const baseFilterChunks = filterChunks;
            filterChunks = function(check) {
                const filter = window._paultendoDiscoveryFilter;
                if (!filter) return baseFilterChunks(check);
                const combined = (c) => filter(c) && check(c);
                return baseFilterChunks(combined);
            };
            filterChunks._paultendoDiscovery = true;
        }
        if (typeof nearestChunk === "function" && !nearestChunk._paultendoDiscovery) {
            const baseNearestChunk = nearestChunk;
            nearestChunk = function(chunkX, chunkY, check, stop) {
                const filter = window._paultendoDiscoveryFilter;
                if (!filter) return baseNearestChunk(chunkX, chunkY, check, stop);
                const combined = (c) => filter(c) && check(c);
                return baseNearestChunk(chunkX, chunkY, combined, stop);
            };
            nearestChunk._paultendoDiscovery = true;
        }
        if (typeof floodFill === "function" && !floodFill._paultendoDiscovery) {
            const baseFloodFill = floodFill;
            floodFill = function(chunkX, chunkY, check, limit, stopAt) {
                const filter = window._paultendoDiscoveryFilter;
                if (!filter) return baseFloodFill(chunkX, chunkY, check, limit, stopAt);
                const combined = (c) => filter(c) && check(c);
                return baseFloodFill(chunkX, chunkY, combined, limit, stopAt);
            };
            floodFill._paultendoDiscovery = true;
        }
    }

    function initDiscoveryHooks() {
        initDiscoveryChunkFilters();

        let hooked = false;
        if (typeof gameEvents !== "undefined" && gameEvents) {
            if (gameEvents.townExpand && typeof gameEvents.townExpand.func === "function" &&
                !gameEvents.townExpand.func._paultendoDiscovery) {
                const baseExpand = gameEvents.townExpand.func;
                gameEvents.townExpand.func = function(subject, target, args) {
                    return withDiscoveryFilter(
                        (chunk) => {
                            if (!chunk || !chunk.v || !chunk.v.g) return false;
                            return isLandmassReachable(chunk.v.g);
                        },
                        () => baseExpand(subject, target, args)
                    );
                };
                gameEvents.townExpand.func._paultendoDiscovery = true;
                hooked = true;
            }

            if (gameEvents.townBoat && typeof gameEvents.townBoat.func === "function" &&
                !gameEvents.townBoat.func._paultendoDiscovery) {
                const baseBoat = gameEvents.townBoat.func;
                gameEvents.townBoat.func = function(subject, target, args) {
                    return withDiscoveryFilter(
                        (chunk) => {
                            if (!chunk || !chunk.v || !chunk.v.g) return false;
                            return isLandmassReachable(chunk.v.g);
                        },
                        () => {
                            const result = baseBoat(subject, target, args);
                            if (args && args.value && args.value.v && args.value.v.g) {
                                const landmassId = args.value.v.g;
                                if (!isLandmassDiscovered(landmassId)) {
                                    discoverLandmass(landmassId, subject, "reach");
                                }
                            }
                            return result;
                        }
                    );
                };
                gameEvents.townBoat.func._paultendoDiscovery = true;
                hooked = true;
            }
        }
        return hooked;
    }

    // World scale adjustment (new worlds only, optional)
    function createGeneratedPerlinWithResizing(scale) {
        function generatePerlinNoise(x, y, octaves, persistence) {
            x *= scale;
            y *= scale;
            let total = 0;
            let frequency = 1;
            let amplitude = 1;
            let maxValue = 0;

            for (let i = 0; i < octaves; i++) {
                total += noise.perlin2(x * frequency, y * frequency) * amplitude;
                maxValue += amplitude;
                amplitude *= persistence;
                frequency *= 2;
            }
            return total / maxValue;
        }
        return generatePerlinNoise;
    }

    function getWorldScaleSetting() {
        if (typeof window !== "undefined" && window._paultendoWorldScaleOverride !== undefined && window._paultendoWorldScaleOverride !== null) {
            return window._paultendoWorldScaleOverride || 1;
        }
        if (typeof userSettings === "undefined" || !userSettings) return 1;
        if (userSettings.worldConfigurator__resolution ||
            userSettings.worldConfigurator__continentSize ||
            userSettings.worldConfigurator__chunkScale ||
            userSettings.worldConfigurator__waterLevel) {
            return 1;
        }
        if (userSettings.paultendoWorldScale === undefined) {
            userSettings.paultendoWorldScale = DISCOVERY_CONFIG.worldScaleDefault;
            if (typeof saveSettings === "function") saveSettings();
        }
        return userSettings.paultendoWorldScale || 1;
    }

    function updateMarkerResolutionForScale(scaleOverride = null) {
        if (typeof $c === "undefined") return;
        if (!$c._paultendoMarkerResolutionBase) {
            $c._paultendoMarkerResolutionBase = $c.markerResolution || 2;
        }
        const scale = scaleOverride || (typeof getWorldScaleSetting === "function" ? getWorldScaleSetting() : 1);
        if (!scale || scale <= 1) {
            $c.markerResolution = $c._paultendoMarkerResolutionBase;
            return;
        }
        const boost = 1 + (scale - 1) * 0.4;
        const target = $c._paultendoMarkerResolutionBase * boost;
        $c.markerResolution = Math.max(1.5, Math.min(3, target));
    }

    function setMapZoom(scale) {
        if (typeof mapCanvas === "undefined" || !mapCanvas) return false;
        const clamped = Math.max(0.6, Math.min(2, scale));
        mapCanvas.style.scale = clamped.toString();
        if (typeof currentZoom !== "undefined") currentZoom = clamped;
        if (clamped <= 1) {
            mapCanvas.classList.remove("zoomed");
            mapCanvas.style.translate = "";
        } else {
            mapCanvas.classList.add("zoomed");
        }
        return true;
    }

    function getMapFitScale() {
        if (typeof mapCanvas === "undefined" || !mapCanvas) return 1;
        const mapDiv = document.getElementById("mapDiv");
        if (!mapDiv) return 1;
        const canvasRect = mapCanvas.getBoundingClientRect();
        const divRect = mapDiv.getBoundingClientRect();
        if (!canvasRect.width || !canvasRect.height) return 1;
        const scaleW = divRect.width / canvasRect.width;
        const scaleH = divRect.height / canvasRect.height;
        return Math.min(1, scaleW, scaleH);
    }

    function applyScaleAwareZoom(force = false) {
        if (typeof mapCanvas === "undefined" || !mapCanvas) return false;
        const current = parseFloat(mapCanvas.style.scale) || 1;
        if (!force && current !== 1) return false;
        const scale = getWorldScaleSetting();
        if (!scale || scale <= 1) return false;
        const fitScale = getMapFitScale();
        if (fitScale >= 0.98) return false;
        return setMapZoom(fitScale);
    }

    function ensureMapControls() {
        if (typeof document === "undefined") return;
        const mapDiv = document.getElementById("mapDiv");
        if (!mapDiv || document.getElementById("paultendoMapControls")) return;

        const controls = document.createElement("div");
        controls.id = "paultendoMapControls";
        controls.style.position = "absolute";
        controls.style.top = "6px";
        controls.style.right = "6px";
        controls.style.display = "flex";
        controls.style.gap = "6px";
        controls.style.zIndex = "6";
        controls.style.pointerEvents = "auto";

        const makeButton = (label, handler) => {
            const btn = document.createElement("button");
            btn.textContent = label;
            btn.style.background = "rgba(40,40,40,0.8)";
            btn.style.color = "white";
            btn.style.border = "1px solid rgba(200,200,200,0.4)";
            btn.style.borderRadius = "6px";
            btn.style.padding = "2px 6px";
            btn.style.fontFamily = "VT323, monospace";
            btn.style.fontSize = "14px";
            btn.style.cursor = "pointer";
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                handler();
            });
            return btn;
        };

        controls.appendChild(makeButton("Fit", () => {
            applyScaleAwareZoom(true);
        }));
        controls.appendChild(makeButton("Reset", () => {
            setMapZoom(1);
        }));

        mapDiv.appendChild(controls);
    }

    function ensureMapHoverOverlay() {
        if (typeof document === "undefined") return null;
        const mapDiv = document.getElementById("mapDiv");
        if (!mapDiv) return null;
        let overlay = document.getElementById("paultendoMapHover");
        if (!overlay) {
            overlay = document.createElement("div");
            overlay.id = "paultendoMapHover";
            overlay.style.position = "absolute";
            overlay.style.left = "6px";
            overlay.style.bottom = "6px";
            overlay.style.padding = "2px 6px";
            overlay.style.borderRadius = "6px";
            overlay.style.background = "rgba(15,15,15,0.65)";
            overlay.style.color = "rgba(255,255,255,0.9)";
            overlay.style.fontFamily = "VT323, monospace";
            overlay.style.fontSize = "14px";
            overlay.style.pointerEvents = "none";
            overlay.style.zIndex = "6";
            mapDiv.appendChild(overlay);
        }
        return overlay;
    }

    function updateMapHoverOverlay() {
        const overlay = ensureMapHoverOverlay();
        if (!overlay) return;
        if (!mousePos) {
            overlay.style.opacity = "0";
            return;
        }
        overlay.style.opacity = "1";
        const chunkKey = mousePos.chunkX + "," + mousePos.chunkY;
        const chunk = planet && planet.chunks ? planet.chunks[chunkKey] : null;
        const biome = chunk?.b ? chunk.b : "unknown";
        const explored = chunk ? isChunkExplored(chunk.x, chunk.y) : true;
        const visible = chunk ? isChunkVisible(chunk.x, chunk.y) : true;
        const canShowBiome = explored && (!FOG_CONFIG.hideBiomeOutsideSight || visible);
        overlay.textContent = `x:${mousePos.x} y:${mousePos.y} · ${canShowBiome ? biome : "unknown"}`;
    }

    function drawCursorCrosshair() {
        if (!mousePos || typeof canvasLayersCtx === "undefined") return;
        const ctx = canvasLayersCtx.cursor;
        if (!ctx || typeof chunkSize === "undefined") return;
        const size = chunkSize;
        const x0 = mousePos.chunkX * size;
        const y0 = mousePos.chunkY * size;
        const midX = x0 + size / 2;
        const midY = y0 + size / 2;
        ctx.save();
        ctx.strokeStyle = "rgba(255,255,255,0.35)";
        ctx.lineWidth = Math.max(1, Math.floor(size / 4));
        ctx.beginPath();
        ctx.moveTo(x0, midY);
        ctx.lineTo(x0 + size, midY);
        ctx.moveTo(midX, y0);
        ctx.lineTo(midX, y0 + size);
        ctx.stroke();
        ctx.restore();
    }

    function applyWorldScale() {
        if (typeof generatePlanet !== "function") return;
        if (generatePlanet._paultendoWorldScale) return;

        const baseWidth = (typeof $c !== "undefined" && $c.defaultPlanetWidth) ? $c.defaultPlanetWidth : 200;
        const baseHeight = (typeof $c !== "undefined" && $c.defaultPlanetHeight) ? $c.defaultPlanetHeight : 120;
        const baseGeneratePlanet = generatePlanet;
        const basePerlin = typeof generatePerlinNoise === "function" ? generatePerlinNoise : null;

        generatePlanet = function(...args) {
            const scale = getWorldScaleSetting();
            if (scale && scale !== 1) {
                const scaledWidth = Math.round(baseWidth * scale);
                const scaledHeight = Math.round(baseHeight * scale);
                planetWidth = scaledWidth;
                planetHeight = scaledHeight;
                if (typeof $c !== "undefined") {
                    $c.defaultPlanetWidth = scaledWidth;
                    $c.defaultPlanetHeight = scaledHeight;
                }
                if (typeof noise !== "undefined" && typeof createGeneratedPerlinWithResizing === "function") {
                    generatePerlinNoise = createGeneratedPerlinWithResizing(1 / scale);
                }
            } else if (basePerlin) {
                generatePerlinNoise = basePerlin;
                if (typeof $c !== "undefined") {
                    $c.defaultPlanetWidth = baseWidth;
                    $c.defaultPlanetHeight = baseHeight;
                }
                planetWidth = baseWidth;
                planetHeight = baseHeight;
            }
            updateMarkerResolutionForScale(scale);
            const planet = baseGeneratePlanet.apply(this, args);
            if (typeof resizeCanvases === "function") {
                try { resizeCanvases(); } catch {}
            }
            if (typeof fitToScreen === "function") {
                try { fitToScreen(); } catch {}
            }
            try { applyScaleAwareZoom(); } catch {}
            try { ensureMapControls(); } catch {}
            return planet;
        };

        generatePlanet._paultendoWorldScale = true;
    }

    applyWorldScale();
    function ensureMapCanvasSync() {
        if (typeof mapCanvas === "undefined" || !mapCanvas) return false;
        if (typeof pixelSize === "undefined" || !pixelSize) return false;
        if (!planetWidth || !planetHeight) return false;
        const expectedW = planetWidth * pixelSize;
        const expectedH = planetHeight * pixelSize;
        const mismatch = mapCanvas.width !== expectedW || mapCanvas.height !== expectedH;
        if (!mismatch) return false;

        updateMarkerResolutionForScale();
        if (typeof resizeCanvases === "function") {
            try { resizeCanvases(); } catch {}
        } else {
            mapCanvas.width = expectedW;
            mapCanvas.height = expectedH;
        }
        if (typeof fitToScreen === "function") {
            try { fitToScreen(); } catch {}
        }
        try { applyScaleAwareZoom(); } catch {}
        try { ensureMapControls(); } catch {}
        try { ensureFogLayer(); } catch {}
        return true;
    }

    if (!initDiscoveryHooks() && typeof window !== "undefined") {
        window.addEventListener("load", () => { initDiscoveryHooks(); });
    }
    if (typeof window !== "undefined") {
        window.addEventListener("load", () => {
            try { ensureMapCanvasSync(); } catch {}
            try { ensureMapControls(); } catch {}
            try { applyScaleAwareZoom(); } catch {}
            try { ensureFogLayer(); } catch {}
        });
    }

    function initDiscoveryRenderHooks() {
        let hooked = false;
        if (typeof regToArray === "function" && !regToArray._paultendoMarkerFilter) {
            const baseRegToArray = regToArray;
            regToArray = function(regName, includeDead) {
                const results = baseRegToArray(regName, includeDead);
                if (regName !== "marker" || !window._paultendoMarkerFilter) return results;
                return results.filter(shouldShowMarker);
            };
            regToArray._paultendoMarkerFilter = true;
            hooked = true;
        }
        if (typeof renderMarkers === "function" && !renderMarkers._paultendoDiscovery) {
            const baseRenderMarkers = renderMarkers;
            renderMarkers = function() {
                if (!initDiscoveryState()) return baseRenderMarkers();
                const prev = window._paultendoMarkerFilter;
                window._paultendoMarkerFilter = true;
                try { return baseRenderMarkers(); }
                finally { window._paultendoMarkerFilter = prev; }
            };
            renderMarkers._paultendoDiscovery = true;
            hooked = true;
        }
        return hooked;
    }

    if (!initDiscoveryRenderHooks() && typeof window !== "undefined") {
        window.addEventListener("load", () => { initDiscoveryRenderHooks(); });
    }

    if (typeof renderCursor === "function" && !renderCursor._paultendoCrosshair) {
        const baseRenderCursor = renderCursor;
        renderCursor = function(...args) {
            const result = baseRenderCursor.apply(this, args);
            try { drawCursorCrosshair(); } catch {}
            try { updateMapHoverOverlay(); } catch {}
            return result;
        };
        renderCursor._paultendoCrosshair = true;
    }

    if (typeof handleCursor === "function" && !handleCursor._paultendoHoverOverlay) {
        const baseHandleCursor = handleCursor;
        handleCursor = function(...args) {
            const result = baseHandleCursor.apply(this, args);
            try { updateMapHoverOverlay(); } catch {}
            return result;
        };
        handleCursor._paultendoHoverOverlay = true;
    }

    // -------------------------------------------------------------------------
    // Discovery Events (tiers, expeditions, and landmass reveals)
    // -------------------------------------------------------------------------

    modEvent("discoveryInit", {
        daily: true,
        subject: { reg: "player", id: 1 },
        value: () => {
            if (!planet || !reg || !reg.landmass) return false;
            if (planet._paultendoDiscoveryReady) return false;
            return true;
        },
        func: () => {
            initDiscoveryState();
            const ok = computeLandmassTiers();
            if (ok) {
                refreshDiscoveryForExistingTowns();
                planet._paultendoDiscoveryReady = true;
            }
        }
    });

    modEvent("fogOfWarUpdate", {
        daily: true,
        subject: { reg: "town", all: true },
        value: (subject) => {
            if (!FOG_CONFIG.enabled) return false;
            if (!subject || subject.end) return false;
            if (!initFogOfWarState()) return false;
            if ((subject.size || 0) <= 0) return false;
            return true;
        },
        func: (subject) => {
            updateFogVisibilityForTown(subject);
        }
    });

    modEvent("discoveryTierAdvance", {
        daily: true,
        subject: { reg: "player", id: 1 },
        func: () => {
            attemptDiscoveryTierAdvance();
        }
    });

    modEvent("discoveryTownReveal", {
        daily: true,
        subject: { reg: "town", all: true },
        value: (subject, target, args) => {
            const landmassId = getTownLandmassId(subject);
            if (!landmassId) return false;
            if (isLandmassDiscovered(landmassId)) return false;
            args.landmassId = landmassId;
            return true;
        },
        func: (subject, target, args) => {
            discoverLandmass(args.landmassId, subject, "establish contact with");
        }
    });

    modEvent("discoveryExpedition", {
        random: true,
        weight: $c.RARE,
        subject: { reg: "town", random: true },
        value: (subject, target, args) => {
            if (!initDiscoveryState()) return false;
            if (!planet.unlocks?.travel || planet.unlocks.travel < 30) return false;
            const tier = getDiscoveryTier();
            if (tier < 1) return false;
            const undiscovered = regFilter("landmass", l =>
                l && !isLandmassDiscovered(l.id) && getLandmassTier(l.id) <= tier
            );
            if (undiscovered.length === 0) return false;
            if ((subject.influences?.travel || 0) < 1) return false;
            return true;
        },
        func: () => {
            discoverReachableLandmass();
        }
    });

    modEvent("swayDiscoveryExpedition", {
        random: true,
        weight: $c.VERY_RARE,
        subject: { reg: "player", id: 1 },
        target: { reg: "town", random: true },
        value: (subject, target, args) => {
            if (!initDiscoveryState()) return false;
            const nextTier = getDiscoveryTier() + 1;
            if (nextTier > getDiscoveryMaxTier()) return false;
            const req = DISCOVERY_TIER_REQUIREMENTS[nextTier];
            if (!req) return false;
            if ((planet.unlocks?.travel || 0) < Math.max(10, req.travel - 10)) return false;
            if ((target.influences?.travel || 0) < 1) return false;
            args.tier = nextTier;
            return true;
        },
        message: (subject, target, args) => {
            return `Navigators in {{regname:town|${target.id}}} propose an ambitious expedition toward the {{b:${getDiscoveryTierName(args.tier)}}}. Support it? {{should}}`;
        },
        messageDone: "You fund the expedition's preparations.",
        messageNo: "You let the idea fade for now.",
        func: (subject, target, args) => {
            initDiscoveryState();
            planet._paultendoDiscovery.boost = Math.min(0.01, (planet._paultendoDiscovery.boost || 0) + 0.002);
            planet._paultendoDiscovery.boostUntil = planet.day + 30;
            happen("Influence", null, target, { travel: 0.5, education: 0.2, temp: true });
            logMessage(`Explorers from {{regname:town|${target.id}}} outfit ships and charts for distant horizons.`);
        }
    });

    // -------------------------------------------------------------------------
    // Seasons: state + indicator + daily influences
    // -------------------------------------------------------------------------

    modEvent("seasonUpdate", {
        daily: true,
        subject: { reg: "player", id: 1 },
        func: () => {
            updateSeasonState();
        }
    });

    modEvent("seasonalInfluences", {
        daily: true,
        subject: { reg: "town", all: true },
        value: (subject) => {
            if (!subject || subject.end || subject.pop <= 0) return false;
            return true;
        },
        func: (subject) => {
            const influences = getSeasonalInfluences(subject);
            if (!influences) return;
            happen("Influence", null, subject, { ...influences, temp: true });
        }
    });

    // Seasonal strain on ongoing wars (strategic pressure)
    modEvent("seasonalWarStrain", {
        daily: true,
        subject: { reg: "town", all: true },
        value: (subject) => {
            if (!subject || subject.end) return false;
            const atWar = regFilter("process", p =>
                p.type === "war" && !p.done && p.towns?.includes(subject.id)
            );
            if (atWar.length === 0) return false;
            return true;
        },
        func: (subject) => {
            const season = getSeasonInfo();
            if (!season) return;
            const climate = getTownClimate(subject);
            if (!climate) return;

            let military = 0;
            let happy = 0;
            let disease = 0;
            let unrestDelta = 0;

            if (season.id === "winter") {
                const cold = clampValue((0.5 - climate.temp) / 0.25, 0, 1);
                if (cold > 0.1) {
                    military -= 0.3 * (0.6 + cold);
                    happy -= 0.2 * (0.5 + cold);
                    unrestDelta += 0.15 * (0.5 + cold);
                }
            } else if (season.id === "summer") {
                const heat = clampValue((climate.temp - 0.55) / 0.25, 0, 1);
                if (heat > 0.1) {
                    military -= 0.2 * (0.6 + heat);
                    disease += 0.2 * (0.6 + heat);
                    unrestDelta += 0.1 * heat;
                }
            } else if (season.id === "spring") {
                military += 0.1;
            } else if (season.id === "autumn") {
                happy += 0.1;
            }

            if (military || happy || disease) {
                happen("Influence", null, subject, { military, happy, disease, temp: true });
            }
            if (unrestDelta > 0) {
                initUnrest(subject);
                subject.unrest = Math.min(100, subject.unrest + unrestDelta);
            }
        }
    });

    // Autumn trade surge and diplomacy
    modEvent("seasonalHarvestSurge", {
        random: true,
        weight: $c.UNCOMMON,
        subject: { reg: "town", random: true },
        value: (subject) => {
            const season = getSeasonInfo();
            if (!season || season.id !== "autumn") return false;
            if ((subject.influences?.farm || 0) < 6) return false;
            if ((subject.influences?.trade || 0) < 3) return false;
            return true;
        },
        func: (subject) => {
            happen("Influence", null, subject, { trade: 0.4, happy: 0.3, temp: true });
            if (Math.random() < 0.2) {
                modLog(
                    "season",
                    `Harvest markets in {{regname:town|${subject.id}}} draw merchants from afar.`,
                    null,
                    { town: subject }
                );
            }
        }
    });

    // =========================================================================
    // SOLAR SYSTEM + MULTI-WORLD SUPPORT
    // =========================================================================

    const UNIVERSE_VERSION = 1;
    const SOLAR_SYSTEM_CONFIG = {
        mapSize: 220,
        orbitStart: 24,
        orbitGap: 26
    };
    const SPACE_TECH_THRESHOLDS = {
        orbit: 20,
        moon: 35,
        mars: 50,
        belt: 65,
        outer: 80
    };
    const SPACE_ROUTE_CONFIG = {
        minTech: 45,
        routeChance: 0.012,
        maxRoutes: 18,
        baseTravel: 8,
        orbitTravel: 4
    };
    const SPACE_WAR_CONFIG = {
        minTech: 55,
        baseChance: 0.003,
        raidChance: 0.12,
        peaceMinDays: 90,
        peaceChance: 0.02,
        maxActive: 3
    };

    const SOLAR_WORLD_TEMPLATES = [
        { id: 1, key: "home", type: "home", orbitIndex: 0, sizeScale: 1, waterLevel: null, habitable: true, harsh: false, label: "Homeworld", color: "#6eff6e" },
        { id: 2, key: "moon", type: "moon", orbitIndex: 1, sizeScale: 0.45, waterLevel: 0.12, habitable: true, harsh: true, label: "Moon", color: "#cfcfcf", discovery: "moon" },
        { id: 3, key: "mars", type: "mars", orbitIndex: 2, sizeScale: 0.7, waterLevel: 0.18, habitable: true, harsh: true, label: "Red Planet", color: "#ff8a65", discovery: "mars" },
        { id: 4, key: "belt", type: "belt", orbitIndex: 3, sizeScale: 0.6, waterLevel: 0.08, habitable: false, harsh: true, label: "Asteroid Belt", color: "#b6b6b6", discovery: "belt" },
        { id: 5, key: "outer", type: "outer", orbitIndex: 4, sizeScale: 1.2, waterLevel: 0.35, habitable: false, harsh: true, label: "Outer Planet", color: "#7aa7ff", discovery: "outer", rareHabitable: 0.15 }
    ];

    function getUniverseDay() {
        return planet && planet.day ? planet.day : 1;
    }

    function getWorldTemplate(id) {
        return SOLAR_WORLD_TEMPLATES.find(t => t.id === id) || null;
    }

    function generateWorldName(template) {
        if (!template) return generateWord(randRange(2, 3), true);
        if (template.key === "moon") {
            const universe = getUniverse(false);
            const homeName = universe?.worlds?.[universe.homeWorldId]?.name;
            if (homeName) return `${homeName}'s Moon`;
            if (planet && planet.name) return `${planet.name}'s Moon`;
        }
        if (template.key === "belt") {
            return generateWord(randRange(1, 2), true);
        }
        return generateWord(randRange(2, 3), true);
    }

    function createWorldEntry(template, overrides = {}) {
        const world = {
            id: template.id,
            key: template.key,
            type: template.type,
            orbitIndex: template.orbitIndex,
            sizeScale: template.sizeScale || 1,
            waterLevel: template.waterLevel,
            habitable: template.habitable !== undefined ? template.habitable : true,
            harsh: !!template.harsh,
            label: template.label || "World",
            color: template.color || "#cfcfcf",
            discovery: template.discovery,
            rareHabitable: template.rareHabitable,
            name: overrides.name || template.name || null,
            discovered: !!template.discovered,
            orbitAngle: overrides.orbitAngle !== undefined ? overrides.orbitAngle : Math.floor(Math.random() * 360),
            createdDay: getUniverseDay(),
            state: null
        };

        if (world.rareHabitable && Math.random() < world.rareHabitable) {
            world.habitable = true;
            world.harsh = false;
        }

        return world;
    }

    function captureWorldState() {
        return {
            planet: planet,
            planetWidth: planetWidth,
            planetHeight: planetHeight,
            chunkSize: chunkSize,
            waterLevel: waterLevel
        };
    }

    function applyWorldMetaToPlanet(world, state = null) {
        const planetObj = state ? state.planet : planet;
        if (!world || !planetObj) return;
        planetObj._paultendoWorldId = world.id;
        planetObj._paultendoWorldKey = world.key;
        planetObj._paultendoWorldType = world.type;
        planetObj._paultendoWorldHarsh = !!world.harsh;
        planetObj._paultendoWorldHabitable = !!world.habitable;
        planetObj._paultendoWorldName = world.name;
    }

    function applyWorldState(state, world = null) {
        if (!state || !state.planet) return false;
        planet = state.planet;
        reg = planet.reg;
        planetWidth = state.planetWidth;
        planetHeight = state.planetHeight;
        chunkSize = state.chunkSize;
        waterLevel = state.waterLevel;
        if (world) applyWorldMetaToPlanet(world, state);
        if (typeof regGet === "function") {
            try { currentPlayer = regGet("player", 1) || currentPlayer; } catch {}
        }
        return true;
    }

    function withWorldState(worldOrState, func, opts = {}) {
        if (!func) return;
        const state = worldOrState && worldOrState.state ? worldOrState.state : worldOrState;
        if (!state) return;

        const snapshot = {
            planet: planet,
            reg: reg,
            planetWidth: planetWidth,
            planetHeight: planetHeight,
            chunkSize: chunkSize,
            waterLevel: waterLevel,
            currentPlayer: currentPlayer
        };
        const baseLog = typeof logMessage === "function" ? logMessage : null;

        applyWorldState(state, worldOrState.state ? worldOrState : null);
        if (opts.silent && baseLog) {
            logMessage = function() {};
        }

        try {
            return func();
        } finally {
            if (opts.silent && baseLog) {
                logMessage = baseLog;
            }
            planet = snapshot.planet;
            reg = snapshot.reg;
            planetWidth = snapshot.planetWidth;
            planetHeight = snapshot.planetHeight;
            chunkSize = snapshot.chunkSize;
            waterLevel = snapshot.waterLevel;
            currentPlayer = snapshot.currentPlayer;
        }
    }

    function ensureUniverseBase(universe) {
        if (!universe.baseDims) {
            universe.baseDims = {
                width: planetWidth,
                height: planetHeight,
                chunkSize: chunkSize,
                waterLevel: waterLevel
            };
        }
    }

    function createDefaultUniverse() {
        if (!planet) return null;
        const base = {
            version: UNIVERSE_VERSION,
            currentWorldId: 1,
            homeWorldId: 1,
            worldOrder: [],
            worlds: {},
            baseDims: null,
            spaceTech: 0,
            spaceRoutes: [],
            spaceWars: [],
            nextSpaceRouteId: 1,
            nextSpaceWarId: 1,
            relations: {}
        };

        const homeTemplate = getWorldTemplate(1) || SOLAR_WORLD_TEMPLATES[0];
        const homeWorld = createWorldEntry(homeTemplate, { name: planet.name });
        homeWorld.discovered = true;
        homeWorld.state = captureWorldState();
        base.worlds[homeWorld.id] = homeWorld;
        base.worldOrder.push(homeWorld.id);
        base.currentWorldId = homeWorld.id;
        base.homeWorldId = homeWorld.id;

        for (let i = 0; i < SOLAR_WORLD_TEMPLATES.length; i++) {
            const template = SOLAR_WORLD_TEMPLATES[i];
            if (template.id === homeWorld.id) continue;
            const world = createWorldEntry(template);
            base.worlds[world.id] = world;
            base.worldOrder.push(world.id);
        }

        ensureUniverseBase(base);
        applyWorldMetaToPlanet(homeWorld);
        return base;
    }

    function getUniverse(createIfMissing = true) {
        if (typeof window === "undefined") return null;
        if (!window._paultendoUniverse && createIfMissing) {
            if (!planet) return null;
            window._paultendoUniverse = createDefaultUniverse();
        }
        return window._paultendoUniverse || null;
    }

    function syncCurrentWorldState(universe = null) {
        const uni = universe || getUniverse(false);
        if (!uni) return;
        const current = uni.worlds[uni.currentWorldId];
        if (!current) return;
        current.state = captureWorldState();
        applyWorldMetaToPlanet(current);
        ensureUniverseBase(uni);
    }

    function resolveWorldDimensions(universe, world) {
        const base = universe?.baseDims || { width: planetWidth, height: planetHeight, chunkSize: chunkSize, waterLevel: waterLevel };
        const scale = world?.sizeScale || 1;
        const chunk = base.chunkSize || chunkSize || 4;
        let width = Math.max(chunk * 4, Math.round((base.width || 200) * scale));
        let height = Math.max(chunk * 3, Math.round((base.height || 120) * scale));
        width -= (width % chunk);
        height -= (height % chunk);
        return { width, height, chunk, waterLevel: world?.waterLevel ?? base.waterLevel };
    }

    function suppressGenerationUI() {
        const snapshot = {
            resizeCanvases: typeof resizeCanvases === "function" ? resizeCanvases : null,
            fitToScreen: typeof fitToScreen === "function" ? fitToScreen : null,
            applyScaleAwareZoom: typeof applyScaleAwareZoom === "function" ? applyScaleAwareZoom : null,
            ensureMapControls: typeof ensureMapControls === "function" ? ensureMapControls : null,
            ensureFogLayer: typeof ensureFogLayer === "function" ? ensureFogLayer : null
        };
        if (snapshot.resizeCanvases) resizeCanvases = function() {};
        if (snapshot.fitToScreen) fitToScreen = function() {};
        if (snapshot.applyScaleAwareZoom) applyScaleAwareZoom = function() {};
        if (snapshot.ensureMapControls) ensureMapControls = function() {};
        if (snapshot.ensureFogLayer) ensureFogLayer = function() {};
        return snapshot;
    }

    function restoreGenerationUI(snapshot) {
        if (!snapshot) return;
        if (snapshot.resizeCanvases) resizeCanvases = snapshot.resizeCanvases;
        if (snapshot.fitToScreen) fitToScreen = snapshot.fitToScreen;
        if (snapshot.applyScaleAwareZoom) applyScaleAwareZoom = snapshot.applyScaleAwareZoom;
        if (snapshot.ensureMapControls) ensureMapControls = snapshot.ensureMapControls;
        if (snapshot.ensureFogLayer) ensureFogLayer = snapshot.ensureFogLayer;
    }

    function generateWorldState(world) {
        const universe = getUniverse(false);
        if (!universe || !world) return null;
        ensureUniverseBase(universe);
        const dims = resolveWorldDimensions(universe, world);

        const snapshot = captureWorldState();
        const uiSnapshot = suppressGenerationUI();
        const prevOverride = window._paultendoWorldScaleOverride;
        window._paultendoWorldScaleOverride = 1;

        try {
            planetWidth = dims.width;
            planetHeight = dims.height;
            chunkSize = dims.chunk;
            waterLevel = dims.waterLevel;

            const newPlanet = generatePlanet();
            planet = newPlanet;
            reg = planet.reg;

            updateBiomes();
            calculateLandmasses();

            if (!newPlanet.name) {
                newPlanet.name = world.name || generateWorldName(world);
            }
            world.name = newPlanet.name;

            const state = captureWorldState();
            applyWorldMetaToPlanet(world, state);
            return state;
        } finally {
            window._paultendoWorldScaleOverride = prevOverride;
            restoreGenerationUI(uiSnapshot);
            applyWorldState(snapshot);
        }
    }

    function ensureWorldState(world) {
        if (!world) return null;
        if (!world.state) {
            world.state = generateWorldState(world);
        }
        return world.state;
    }

    function getCurrentWorldId() {
        const universe = getUniverse(false);
        if (universe && universe.currentWorldId) return universe.currentWorldId;
        return planet?._paultendoWorldId || 1;
    }

    function getWorldById(id) {
        const universe = getUniverse(false);
        if (!universe) return null;
        return universe.worlds[id] || null;
    }

    function getWorldOrder() {
        const universe = getUniverse(false);
        if (!universe) return [];
        return (universe.worldOrder || []).map(id => universe.worlds[id]).filter(Boolean);
    }

    function syncLogToPlanet() {
        if (!planet || typeof document === "undefined") return;
        const logDiv = document.getElementById("logMessages");
        if (logDiv) planet._paultendoLogHTML = logDiv.innerHTML;
    }

    function restoreLogFromPlanet(options = {}) {
        if (!planet || typeof document === "undefined") return;
        const logDiv = document.getElementById("logMessages");
        if (!logDiv) return;
        if (planet._paultendoLogHTML !== undefined) {
            if (options.merge) {
                logDiv.innerHTML = (planet._paultendoLogHTML || "") + (logDiv.innerHTML || "");
            } else {
                logDiv.innerHTML = planet._paultendoLogHTML;
            }
        }
    }

    function switchWorld(worldId) {
        const universe = getUniverse();
        if (!universe) return false;
        const target = universe.worlds[worldId];
        if (!target) return false;

        if (!target.discovered) {
            logMessage("That world remains beyond reach.");
            return false;
        }

        if (universe.currentWorldId === worldId) return true;

        try { syncLogToPlanet(); } catch {}
        syncCurrentWorldState(universe);
        ensureWorldState(target);

        universe.currentWorldId = worldId;
        applyWorldState(target.state, target);
        if (planet && planet.unlocks) {
            planet.unlocks.space = Math.max(planet.unlocks.space || 0, universe.spaceTech || 0);
        }

        if (typeof initGame === "function") {
            let prevSuppress = undefined;
            if (typeof window !== "undefined") {
                prevSuppress = window._paultendoSuppressLogSync;
                window._paultendoSuppressLogSync = true;
            }
            initGame();
            if (typeof window !== "undefined") {
                window._paultendoSuppressLogSync = prevSuppress;
            }
            restoreLogFromPlanet({ merge: true });
            try { syncLogToPlanet(); } catch {}
        } else {
            if (typeof renderMap === "function") renderMap();
            if (typeof renderHighlight === "function") renderHighlight();
            if (typeof updateCanvas === "function") updateCanvas();
        }

        try { ensureMapCanvasSync(); } catch {}
        try { ensureFogLayer(); } catch {}
        try { applyScaleAwareZoom(true); } catch {}
        try { updateSeasonState(); } catch {}
        return true;
    }

    function getWorldTownStats(world) {
        if (!world || !world.state || !world.state.planet || !world.state.planet.reg) {
            return { towns: 0, pop: 0 };
        }
        const regTown = world.state.planet.reg.town || {};
        let towns = 0;
        let pop = 0;
        for (const key in regTown) {
            const town = regTown[key];
            if (!town || !isNaN(town)) continue;
            if (town.end) continue;
            towns += 1;
            pop += town.pop || 0;
        }
        return { towns, pop };
    }

    function isWorldHarsh(world) {
        if (!world) return false;
        if (world.harsh) return true;
        if (world.habitable === false) return true;
        return false;
    }

    function canDiscoverWorld(world, tech = null) {
        if (!world || world.discovered) return false;
        const universe = getUniverse(false);
        const score = tech !== null ? tech : universe?.spaceTech || 0;
        if (!world.discovery) return false;
        const threshold = SPACE_TECH_THRESHOLDS[world.discovery] || 0;
        return score >= threshold;
    }

    function discoverWorld(worldId, reason = "observe") {
        const universe = getUniverse();
        const world = universe?.worlds?.[worldId];
        if (!world || world.discovered) return false;
        const techScore = universe.spaceTech || 0;
        if (!canDiscoverWorld(world, techScore)) return false;

        world.discovered = true;
        if (!world.name) world.name = generateWorldName(world);
        ensureWorldState(world);

        let note = "New celestial charts are compiled.";
        if (reason === "mission") note = "A daring mission reaches new horizons.";
        const msg = `Astronomers reveal {{b:${world.name}}}. ${note}`;
        logMessage(msg, "milestone");
        noteSpaceEvent(msg);
        return true;
    }

    function computeSpaceTechScore(planetObj) {
        if (!planetObj || !planetObj.unlocks) return 0;
        const edu = planetObj.unlocks.education || 0;
        const smith = planetObj.unlocks.smith || 0;
        const fire = planetObj.unlocks.fire || 0;
        const travel = planetObj.unlocks.travel || 0;
        const trade = planetObj.unlocks.trade || 0;
        const military = planetObj.unlocks.military || 0;
        const avg = (edu + smith + fire + travel + trade + military) / 6;
        return Math.round(avg);
    }

    function noteSpaceEvent(text) {
        const universe = getUniverse(false);
        if (!universe || !text) return;
        universe.lastSpaceEvent = {
            day: getUniverseDay(),
            text: text
        };
    }

    function updateSpaceTech() {
        const universe = getUniverse(false);
        if (!universe) return 0;
        let maxScore = 0;
        for (const world of Object.values(universe.worlds)) {
            if (!world || !world.state || !world.state.planet) continue;
            const score = computeSpaceTechScore(world.state.planet);
            if (score > maxScore) maxScore = score;
        }
        if (maxScore > universe.spaceTech) {
            universe.spaceTech = maxScore;
            if (maxScore >= SPACE_TECH_THRESHOLDS.orbit && !universe._spaceOrbitNoted) {
                universe._spaceOrbitNoted = true;
                const msg = "Signals reach for the skies. The first satellites rise.";
                logMessage(msg, "milestone");
                noteSpaceEvent(msg);
            }
            if (maxScore >= SPACE_TECH_THRESHOLDS.moon && !universe._spaceMoonNoted) {
                universe._spaceMoonNoted = true;
                const msg = "A lunar mission becomes possible.";
                logMessage(msg, "milestone");
                noteSpaceEvent(msg);
            }
        }
        if (planet && planet.unlocks) {
            planet.unlocks.space = Math.max(planet.unlocks.space || 0, universe.spaceTech);
        }
        return universe.spaceTech;
    }

    function updateSpaceDiscovery() {
        const universe = getUniverse(false);
        if (!universe) return;
        const tech = universe.spaceTech || 0;
        getWorldOrder().forEach(world => {
            if (!world || world.id === universe.homeWorldId) return;
            if (!world.discovered && canDiscoverWorld(world, tech)) {
                discoverWorld(world.id, "observe");
            }
        });
    }

    function ensureSolarStyles() {
        if (typeof document === "undefined") return;
        if (document.getElementById("paultendoSolarStyles")) return;
        const style = document.createElement("style");
        style.id = "paultendoSolarStyles";
        style.textContent = `
            .paultendo-solar-map {
                position: relative;
                margin: 0.5em auto 0.9em;
                border: 1px solid rgba(255,255,255,0.15);
                background: radial-gradient(circle at center, rgba(255,255,255,0.08), rgba(0,0,0,0.65));
                border-radius: 12px;
                box-shadow: 0 0 14px rgba(0,0,0,0.35) inset;
            }
            .paultendo-solar-star {
                position: absolute;
                left: 50%;
                top: 50%;
                width: 12px;
                height: 12px;
                border-radius: 50%;
                background: #ffd166;
                transform: translate(-50%, -50%);
                box-shadow: 0 0 10px rgba(255,209,102,0.8);
            }
            .paultendo-solar-orbit {
                position: absolute;
                left: 50%;
                top: 50%;
                width: calc(var(--orbit) * 2);
                height: calc(var(--orbit) * 2);
                border: 1px dashed rgba(255,255,255,0.15);
                border-radius: 50%;
                transform: translate(-50%, -50%);
            }
            .paultendo-solar-world {
                position: absolute;
                border-radius: 50%;
                cursor: pointer;
                box-shadow: 0 0 6px rgba(0,0,0,0.5);
                border: 1px solid rgba(255,255,255,0.35);
            }
            .paultendo-solar-world.locked {
                opacity: 0.35;
                cursor: default;
                filter: grayscale(1);
            }
            .paultendo-solar-world.active {
                outline: 2px solid rgba(255,255,255,0.8);
            }
            .paultendo-solar-label {
                font-size: 0.95em;
                opacity: 0.9;
            }
        `;
        document.head.appendChild(style);
    }

    function buildSolarMapHTML() {
        const universe = getUniverse(false);
        if (!universe) return "";
        const size = SOLAR_SYSTEM_CONFIG.mapSize;
        const center = size / 2;
        let html = `<div class="paultendo-solar-map" style="width:${size}px;height:${size}px">`;
        html += `<div class="paultendo-solar-star"></div>`;

        const worlds = getWorldOrder();
        worlds.forEach(world => {
            const radius = SOLAR_SYSTEM_CONFIG.orbitStart + world.orbitIndex * SOLAR_SYSTEM_CONFIG.orbitGap;
            html += `<div class="paultendo-solar-orbit" style="--orbit:${radius}px"></div>`;
        });

        worlds.forEach(world => {
            const radius = SOLAR_SYSTEM_CONFIG.orbitStart + world.orbitIndex * SOLAR_SYSTEM_CONFIG.orbitGap;
            const angle = ((world.orbitAngle || 0) * Math.PI) / 180;
            const sizePx = Math.max(6, Math.round(6 + world.orbitIndex * 1.2));
            const x = center + radius * Math.cos(angle) - sizePx / 2;
            const y = center + radius * Math.sin(angle) - sizePx / 2;
            const classes = ["paultendo-solar-world"];
            if (!world.discovered) classes.push("locked");
            if (world.id === universe.currentWorldId) classes.push("active");
            html += `<div class="${classes.join(" ")}" data-world-id="${world.id}" style="left:${x}px;top:${y}px;width:${sizePx}px;height:${sizePx}px;background:${world.color};"></div>`;
        });

        html += `</div>`;
        return html;
    }

    function formatWorldListItem(world) {
        if (!world) return "{{none}}";
        const stats = getWorldTownStats(world);
        const name = world.discovered ? (world.name || "Unknown") : "???";
        const status = world.discovered ? `${stats.towns} town${stats.towns === 1 ? "" : "s"}` : "Undiscovered";
        const day = world.state?.planet?.day || (planet?.day || 1);
        return `<span class="paultendo-solar-label">${name}</span> <span style="opacity:0.7">(${status}, Day ${day})</span>`;
    }

    const SPACE_UNLOCK_LABELS = {
        orbit: "Orbital Satellites",
        moon: "Lunar Missions",
        mars: "Red Planet",
        belt: "Asteroid Belt",
        outer: "Outer Planet"
    };

    function getNextSpaceThreshold(tech) {
        const entries = Object.entries(SPACE_TECH_THRESHOLDS)
            .sort((a, b) => a[1] - b[1]);
        for (const [key, value] of entries) {
            if (tech < value) return { key, value, label: SPACE_UNLOCK_LABELS[key] || key };
        }
        return null;
    }

    function openSolarWorldDetail(worldId) {
        const universe = getUniverse(false);
        const world = universe?.worlds?.[worldId];
        if (!world) return;

        const items = [];
        const stats = getWorldTownStats(world);
        const name = world.discovered ? (world.name || "Unknown World") : "Unknown World";
        const typeLabel = world.label || "World";
        const habitability = world.habitable ? "Habitable" : "Harsh";
        const status = world.discovered ? `${stats.towns} town${stats.towns === 1 ? "" : "s"}, ${stats.pop} people` : "Undiscovered";

        items.push({ text: `{{b:${name}}}` });
        items.push({ text: `Type: ${typeLabel}` });
        items.push({ text: `Environment: ${habitability}` });
        items.push({ text: `Status: ${status}` });
        items.push({ spacer: true });

        if (!world.discovered && canDiscoverWorld(world)) {
            items.push({
                text: "Launch mission",
                func: () => {
                    discoverWorld(world.id, "mission");
                    openSolarWorldDetail(world.id);
                }
            });
        }

        if (world.discovered && world.state) {
            if (world.id === universe.currentWorldId) {
                items.push({ text: "Currently active" });
            } else {
                items.push({
                    text: "Switch to world",
                    func: () => {
                        switchWorld(world.id);
                    }
                });
            }
        }

        items.push({ spacer: true });
        items.push({
            text: "◁ Back to Solar System",
            func: () => openSolarPanel()
        });

        populateExecutive(items, "World Details");
    }

    function attachSolarMapHandlers() {
        if (typeof document === "undefined") return;
        const nodes = document.querySelectorAll(".paultendo-solar-world");
        nodes.forEach(node => {
            node.addEventListener("click", () => {
                const id = parseInt(node.getAttribute("data-world-id"));
                if (!id) return;
                openSolarWorldDetail(id);
            });
        });
    }

    function openSolarPanel() {
        ensureSolarStyles();
        const universe = getUniverse(false);
        if (!universe) return;

        const items = [];
        items.push({ spacer: true, text: buildSolarMapHTML() });
        const tech = universe.spaceTech || 0;
        const nextUnlock = getNextSpaceThreshold(tech);
        items.push({ spacer: true, text: `Space Tech: ${tech}` });
        if (nextUnlock) {
            items.push({ text: `Next: ${nextUnlock.label} (${tech}/${nextUnlock.value})` });
        } else {
            items.push({ text: "All known thresholds reached." });
        }
        if (universe.lastSpaceEvent && universe.lastSpaceEvent.text) {
            items.push({ spacer: true, text: `Recent: ${universe.lastSpaceEvent.text} (Day ${universe.lastSpaceEvent.day || getUniverseDay()})` });
        }
        items.push({ spacer: true, text: `Worlds (${getWorldOrder().length})` });

        getWorldOrder().forEach(world => {
            items.push({
                text: formatWorldListItem(world),
                func: () => openSolarWorldDetail(world.id)
            });
        });

        populateExecutive(items, "Solar System");
        attachSolarMapHandlers();
    }

    function addSolarButton() {
        const list = document.getElementById("actionMainList");
        if (!list || document.getElementById("actionItem-solar")) return;
        const button = document.createElement("span");
        button.className = "actionItem clickable";
        button.id = "actionItem-solar";
        button.innerHTML = "Solar";
        button.addEventListener("click", () => {
            openSolarPanel();
        });
        list.appendChild(button);
    }

    function initSpaceRoutes() {
        const universe = getUniverse(false);
        if (!universe) return;
        if (!Array.isArray(universe.spaceRoutes)) universe.spaceRoutes = [];
        if (!universe.nextSpaceRouteId) universe.nextSpaceRouteId = 1;
    }

    function getTownRefKey(ref) {
        return ref ? `${ref.worldId}:${ref.townId}` : "";
    }

    function getTownByRef(ref) {
        if (!ref) return null;
        const world = getWorldById(ref.worldId);
        if (!world || !world.state || !world.state.planet || !world.state.planet.reg) return null;
        return world.state.planet.reg.town?.[ref.townId] || null;
    }

    function formatTownRef(ref) {
        const town = getTownByRef(ref);
        if (!town) return "Unknown settlement";
        if (ref.worldId === getCurrentWorldId()) {
            return `{{regname:town|${town.id}}}`;
        }
        const world = getWorldById(ref.worldId);
        const worldName = world?.name || world?.label || "Unknown World";
        return `${town.name} of ${worldName}`;
    }

    function getWorldTownRefs(filterFn = null) {
        const universe = getUniverse(false);
        if (!universe) return [];
        const refs = [];
        for (const world of Object.values(universe.worlds)) {
            if (!world || !world.state || !world.state.planet || !world.state.planet.reg) continue;
            const regTown = world.state.planet.reg.town || {};
            for (const key in regTown) {
                const town = regTown[key];
                if (!town || !isNaN(town)) continue;
                if (town.end || town.pop <= 0) continue;
                if (filterFn && !filterFn(town, world)) continue;
                refs.push({ worldId: world.id, townId: town.id });
            }
        }
        return refs;
    }

    function isSpaceRouteBetween(refA, refB) {
        const universe = getUniverse(false);
        if (!universe || !Array.isArray(universe.spaceRoutes)) return false;
        const keyA = getTownRefKey(refA);
        const keyB = getTownRefKey(refB);
        return universe.spaceRoutes.some(route => {
            if (!route || !route.active) return false;
            const from = getTownRefKey(route.from);
            const to = getTownRefKey(route.to);
            return (from === keyA && to === keyB) || (from === keyB && to === keyA);
        });
    }

    function createSpaceRoute(refA, refB) {
        const universe = getUniverse(false);
        if (!universe) return null;
        if (isSpaceRouteBetween(refA, refB)) return null;
        if (universe.spaceRoutes.length >= SPACE_ROUTE_CONFIG.maxRoutes) return null;

        const worldA = getWorldById(refA.worldId);
        const worldB = getWorldById(refB.worldId);
        if (!worldA || !worldB) return null;

        const orbitDistance = Math.abs((worldA.orbitIndex || 0) - (worldB.orbitIndex || 0)) + 1;
        const travelTime = SPACE_ROUTE_CONFIG.baseTravel + orbitDistance * SPACE_ROUTE_CONFIG.orbitTravel;

        const route = {
            id: universe.nextSpaceRouteId++,
            from: refA,
            to: refB,
            established: getUniverseDay(),
            travelTime,
            nextArrivalDay: getUniverseDay() + travelTime,
            active: true,
            deliveries: 0
        };
        universe.spaceRoutes.push(route);
        addSpaceWarRelation(refA, refB, 1);
        const labelA = formatTownRef(refA);
        const labelB = formatTownRef(refB);
        noteSpaceEvent(`A space trade lane opens between ${labelA} and ${labelB}.`);
        return route;
    }

    function applySpaceRouteDelivery(route) {
        if (!route) return;
        const fromTown = getTownByRef(route.from);
        const toTown = getTownByRef(route.to);
        if (!fromTown || !toTown) return;

        const fromWorld = getWorldById(route.from.worldId);
        const toWorld = getWorldById(route.to.worldId);
        if (!fromWorld || !toWorld) return;

        const applyInfluence = (world, town) => {
            withWorldState(world, () => {
                happen("Influence", null, town, { trade: 0.3, happy: 0.1, temp: true });
                town.wealth = (town.wealth || 0) + 1;
            }, { silent: world.id !== getCurrentWorldId() });
        };

        applyInfluence(fromWorld, fromTown);
        applyInfluence(toWorld, toTown);
        route.deliveries = (route.deliveries || 0) + 1;
        addSpaceWarRelation(route.from, route.to, 0.2);
    }

    function processSpaceRoutes() {
        const universe = getUniverse(false);
        if (!universe || !Array.isArray(universe.spaceRoutes)) return;
        const day = getUniverseDay();

        universe.spaceRoutes.forEach(route => {
            if (!route || !route.active) return;
            const fromTown = getTownByRef(route.from);
            const toTown = getTownByRef(route.to);
            if (!fromTown || !toTown) {
                route.active = false;
                return;
            }
            if (day >= (route.nextArrivalDay || day)) {
                applySpaceRouteDelivery(route);
                route.nextArrivalDay = day + (route.travelTime || SPACE_ROUTE_CONFIG.baseTravel);
                const activeWorldId = getCurrentWorldId();
                if (route.from.worldId === activeWorldId || route.to.worldId === activeWorldId) {
                    if (fromTown && toTown) {
                        const fromLabel = formatTownRef(route.from);
                        const toLabel = formatTownRef(route.to);
                        logMessage(`Interworld shipments arrive between ${fromLabel} and ${toLabel}.`);
                    }
                }
            }
        });
    }

    function maybeCreateSpaceRoute() {
        const universe = getUniverse(false);
        if (!universe) return;
        if ((universe.spaceTech || 0) < SPACE_ROUTE_CONFIG.minTech) return;
        if (universe.spaceRoutes && universe.spaceRoutes.length >= SPACE_ROUTE_CONFIG.maxRoutes) return;
        if (Math.random() > SPACE_ROUTE_CONFIG.routeChance) return;

        const candidates = getWorldTownRefs((town, world) => {
            if (!world.discovered) return false;
            if ((town.influences?.trade || 0) < 4) return false;
            if (town.pop < 40) return false;
            return true;
        });

        if (candidates.length < 2) return;
        const refA = choose(candidates);
        const refB = choose(candidates.filter(r => r.worldId !== refA.worldId));
        if (!refB) return;

        const route = createSpaceRoute(refA, refB);
        if (route) {
            const townA = getTownByRef(refA);
            const townB = getTownByRef(refB);
            if (townA && townB) {
                const labelA = formatTownRef(refA);
                const labelB = formatTownRef(refB);
                logMessage(`A space trade lane opens between ${labelA} and ${labelB}.`, "milestone");
            }
        }
    }

    function initSpaceWars() {
        const universe = getUniverse(false);
        if (!universe) return;
        if (!Array.isArray(universe.spaceWars)) universe.spaceWars = [];
        if (!universe.nextSpaceWarId) universe.nextSpaceWarId = 1;
    }

    function normalizeSpaceWar(war) {
        if (!war) return null;
        if (!Array.isArray(war.sides)) war.sides = [[], []];
        war.sides = war.sides.map(side => Array.isArray(side) ? side : []);
        if (!war.worldFronts) war.worldFronts = {};
        return war;
    }

    function isSpaceWarBetween(refA, refB) {
        const universe = getUniverse(false);
        if (!universe) return false;
        const keyA = getTownRefKey(refA);
        const keyB = getTownRefKey(refB);
        return universe.spaceWars.some(war => {
            if (!war || war.endedDay) return false;
            normalizeSpaceWar(war);
            const sideA = war.sides[0].map(getTownRefKey);
            const sideB = war.sides[1].map(getTownRefKey);
            return (sideA.includes(keyA) && sideB.includes(keyB)) || (sideA.includes(keyB) && sideB.includes(keyA));
        });
    }

    function addSpaceWarRelation(refA, refB, amount) {
        const universe = getUniverse(false);
        if (!universe) return;
        const keyA = getTownRefKey(refA);
        const keyB = getTownRefKey(refB);
        if (!keyA || !keyB) return;
        const key = keyA < keyB ? `${keyA}|${keyB}` : `${keyB}|${keyA}`;
        universe.relations[key] = (universe.relations[key] || 0) + amount;
    }

    function getSpaceWarRelation(refA, refB) {
        const universe = getUniverse(false);
        if (!universe) return 0;
        const keyA = getTownRefKey(refA);
        const keyB = getTownRefKey(refB);
        if (!keyA || !keyB) return 0;
        const key = keyA < keyB ? `${keyA}|${keyB}` : `${keyB}|${keyA}`;
        return universe.relations[key] || 0;
    }

    function getAllianceMemberRefs(ref) {
        const world = getWorldById(ref.worldId);
        if (!world || !world.state) return [];
        const town = getTownByRef(ref);
        if (!town) return [];
        let members = [];
        withWorldState(world, () => {
            if (typeof getTownAlliance === "function") {
                const alliance = getTownAlliance(town);
                if (alliance && Array.isArray(alliance.members)) {
                    members = alliance.members.map(id => ({ worldId: world.id, townId: id }));
                }
            }
        }, { silent: true });
        return members;
    }

    function createSpaceWar(refA, refB) {
        const universe = getUniverse(false);
        if (!universe) return null;
        if (isSpaceWarBetween(refA, refB)) return null;
        if (universe.spaceWars.length >= SPACE_WAR_CONFIG.maxActive) return null;

        const war = {
            id: universe.nextSpaceWarId++,
            startDay: getUniverseDay(),
            sides: [[], []],
            worldFronts: {},
            endedDay: null,
            winnerSide: null
        };

        const sideA = [refA, ...getAllianceMemberRefs(refA)];
        const sideB = [refB, ...getAllianceMemberRefs(refB)];
        const seen = new Set();
        war.sides[0] = sideA.filter(ref => {
            const key = getTownRefKey(ref);
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
        });
        war.sides[1] = sideB.filter(ref => {
            const key = getTownRefKey(ref);
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
        });

        universe.spaceWars.push(war);

        const townA = getTownByRef(refA);
        const townB = getTownByRef(refB);
        const activeWorldId = getCurrentWorldId();
        if (townA && townB && (refA.worldId === activeWorldId || refB.worldId === activeWorldId)) {
            const labelA = formatTownRef(refA);
            const labelB = formatTownRef(refB);
            logMessage(`War reaches the stars: ${labelA} clashes with ${labelB}.`, "warning");
        }
        const labelA = formatTownRef(refA);
        const labelB = formatTownRef(refB);
        noteSpaceEvent(`War reaches the stars: ${labelA} clashes with ${labelB}.`);
        return war;
    }

    function maybeStartSpaceWar() {
        const universe = getUniverse(false);
        if (!universe) return;
        if ((universe.spaceTech || 0) < SPACE_WAR_CONFIG.minTech) return;
        if (Math.random() > SPACE_WAR_CONFIG.baseChance) return;

        const candidates = getWorldTownRefs((town, world) => {
            if (!world.discovered) return false;
            if (town.pop < 50) return false;
            const mil = town.influences?.military || 0;
            return mil > 2;
        });
        if (candidates.length < 2) return;

        const attacker = weightedChoice(candidates, (ref) => {
            const town = getTownByRef(ref);
            const mil = town?.influences?.military || 0;
            const pop = town?.pop || 0;
            return 1 + mil * 0.6 + pop / 120;
        });
        if (!attacker) return;
        const defenders = candidates.filter(ref => ref.worldId !== attacker.worldId);
        if (defenders.length === 0) return;

        const defender = weightedChoice(defenders, (ref) => {
            const town = getTownByRef(ref);
            const rel = getSpaceWarRelation(attacker, ref);
            const mil = town?.influences?.military || 0;
            return 1 + Math.max(0, -rel) * 0.4 + mil * 0.3;
        });
        if (!defender) return;

        const relation = getSpaceWarRelation(attacker, defender);
        if (relation > 4 && Math.random() < 0.7) return;

        createSpaceWar(attacker, defender);
    }

    function ensureLocalWarFront(war, worldId, sideARefs, sideBRefs) {
        if (!war || !worldId) return;
        if (!sideARefs.length || !sideBRefs.length) return;

        const world = getWorldById(worldId);
        if (!world || !world.state) return;

        withWorldState(world, () => {
            const processId = war.worldFronts[worldId];
            let process = processId ? regGet("process", processId) : null;
            const sideAIds = sideARefs.map(r => r.townId);
            const sideBIds = sideBRefs.map(r => r.townId);
            const towns = [...new Set([...sideAIds, ...sideBIds])];

            if (!process || process.done) {
                process = regAdd("process", {
                    type: "war",
                    towns: towns,
                    sides: [sideAIds, sideBIds],
                    start: planet.day,
                    _paultendoSpaceWarId: war.id
                });
                war.worldFronts[worldId] = process.id;
            } else {
                process.towns = towns;
                process.sides = [sideAIds, sideBIds];
            }

            towns.forEach(townId => {
                const town = regGet("town", townId);
                if (!town) return;
                ensureIssues(town);
                town.issues.war = process.id;
            });

            if (typeof metaEvents !== "undefined" && metaEvents.processWar && typeof metaEvents.processWar.func === "function") {
                metaEvents.processWar.func(process);
            } else if (typeof processCoalitionWar === "function") {
                processCoalitionWar(process);
            }
        }, { silent: worldId !== getCurrentWorldId() });
    }

    function processSpaceWarRaids(war) {
        if (!war || !war.sides) return;
        if (Math.random() > SPACE_WAR_CONFIG.raidChance) return;

        const sideIndex = Math.random() < 0.5 ? 0 : 1;
        const attackerRefs = war.sides[sideIndex] || [];
        const defenderRefs = war.sides[sideIndex === 0 ? 1 : 0] || [];
        if (!attackerRefs.length || !defenderRefs.length) return;

        const attacker = weightedChoice(attackerRefs, (ref) => {
            const town = getTownByRef(ref);
            return 1 + (town?.influences?.military || 0);
        });
        const defenderOptions = defenderRefs.filter(ref => ref.worldId !== attacker.worldId);
        const defender = defenderOptions.length ? choose(defenderOptions) : choose(defenderRefs);
        if (!attacker || !defender) return;

        const defenderTown = getTownByRef(defender);
        const attackerTown = getTownByRef(attacker);
        if (!defenderTown || !attackerTown) return;

        const attackPower = (attackerTown.influences?.military || 0) + (attackerTown.pop || 0) / 100;
        const defensePower = (defenderTown.influences?.military || 0) + (defenderTown.pop || 0) / 140;
        const ratio = attackPower / Math.max(1, attackPower + defensePower);
        const loss = Math.max(1, Math.floor((defenderTown.pop || 1) * (0.005 + ratio * 0.01)));

        const defenderWorld = getWorldById(defender.worldId);
        if (defenderWorld) {
            withWorldState(defenderWorld, () => {
                happen("Death", null, defenderTown, { count: loss, cause: "war" });
                defenderTown.wealth = Math.max(0, (defenderTown.wealth || 0) - 2);
            }, { silent: defenderWorld.id !== getCurrentWorldId() });
        }

        addSpaceWarRelation(attacker, defender, -0.5);

        const activeWorldId = getCurrentWorldId();
        if (defender.worldId === activeWorldId || attacker.worldId === activeWorldId) {
            const label = formatTownRef(defender);
            logMessage(`Orbital raids strike ${label}.`, "warning");
        }
    }

    function closeSpaceWarFronts(war, reason = "peace") {
        if (!war || !war.worldFronts) return;
        const winnerSide = war.winnerSide;
        const fronts = war.worldFronts;
        Object.keys(fronts).forEach((worldIdStr) => {
            const worldId = parseInt(worldIdStr);
            const processId = fronts[worldIdStr];
            if (!processId) return;
            const world = getWorldById(worldId);
            if (!world) return;
            withWorldState(world, () => {
                const process = regGet("process", processId);
                if (!process || process.done) return;
                if (reason === "victory" && winnerSide !== null && winnerSide !== undefined) {
                    endCoalitionWar(process, winnerSide, "victory");
                } else {
                    endCoalitionWar(process, null, "peace");
                }
            }, { silent: worldId !== getCurrentWorldId() });
        });
        war.worldFronts = {};
    }

    function warInvolvesActiveWorld(war) {
        if (!war || !war.sides) return false;
        const activeId = getCurrentWorldId();
        return war.sides.some(side => side.some(ref => ref.worldId === activeId));
    }

    function processSpaceWars() {
        const universe = getUniverse(false);
        if (!universe || !Array.isArray(universe.spaceWars)) return;
        const day = getUniverseDay();

        universe.spaceWars.forEach(war => {
            if (!war || war.endedDay) return;
            normalizeSpaceWar(war);

            war.sides = war.sides.map(side => side.filter(ref => {
                const town = getTownByRef(ref);
                return town && !town.end;
            }));

            const sideA = war.sides[0];
            const sideB = war.sides[1];
            if (sideA.length === 0 || sideB.length === 0) {
                war.endedDay = day;
                war.winnerSide = sideA.length ? 0 : 1;
                if (warInvolvesActiveWorld(war)) {
                    logMessage("A space war ends with one side scattered.", "milestone");
                }
                closeSpaceWarFronts(war, "victory");
                return;
            }

            const age = day - (war.startDay || day);
            if (age > SPACE_WAR_CONFIG.peaceMinDays && Math.random() < SPACE_WAR_CONFIG.peaceChance) {
                war.endedDay = day;
                war.winnerSide = null;
                if (warInvolvesActiveWorld(war)) {
                    logMessage("A tense truce halts a space war.", "milestone");
                }
                closeSpaceWarFronts(war, "peace");
                return;
            }

            const worlds = new Set();
            sideA.forEach(ref => worlds.add(ref.worldId));
            sideB.forEach(ref => worlds.add(ref.worldId));
            worlds.forEach(worldId => {
                const sideARefs = sideA.filter(ref => ref.worldId === worldId);
                const sideBRefs = sideB.filter(ref => ref.worldId === worldId);
                if (sideARefs.length && sideBRefs.length) {
                    ensureLocalWarFront(war, worldId, sideARefs, sideBRefs);
                }
            });

            processSpaceWarRaids(war);
        });
    }

    function tickInactiveWorlds() {
        const universe = getUniverse(false);
        if (!universe) return;
        const activeId = universe.currentWorldId;

        for (const world of Object.values(universe.worlds)) {
            if (!world || !world.state || world.id === activeId) continue;
            withWorldState(world, () => {
                planet.day = (planet.day || 1) + 1;

                // lightweight background growth
                const towns = regFilter("town", t => t && !t.end && t.pop > 0);
                towns.forEach(town => {
                    const growth = Math.max(0, Math.round((town.pop || 0) * 0.001));
                    if (growth > 0) {
                        town.pop = (town.pop || 0) + growth;
                        if (typeof statsAdd === "function") statsAdd("birth", growth);
                        else if (planet && planet.stats) {
                            planet.stats.birth = (planet.stats.birth || 0) + growth;
                        }
                    }
                });

                // keep local wars moving
                const processes = regFilter("process", p => p && !p.done && p.type === "war");
                processes.forEach(proc => {
                    if (typeof metaEvents !== "undefined" && metaEvents.processWar && typeof metaEvents.processWar.func === "function") {
                        metaEvents.processWar.func(proc);
                    } else if (typeof processCoalitionWar === "function") {
                        processCoalitionWar(proc);
                    }
                });
            }, { silent: true });
        }
    }

    function ensureSolarHooks() {
        if (typeof initExecutive === "function" && !initExecutive._paultendoSolar) {
            const baseInitExecutive = initExecutive;
            initExecutive = function(...args) {
                const result = baseInitExecutive.apply(this, args);
                try { addSolarButton(); } catch {}
                return result;
            };
            initExecutive._paultendoSolar = true;
        }
        if (typeof logMessage === "function" && !logMessage._paultendoLogSync) {
            const baseLogMessage = logMessage;
            logMessage = function(...args) {
                const result = baseLogMessage.apply(this, args);
                try {
                    if (typeof window === "undefined" || !window._paultendoSuppressLogSync) {
                        syncLogToPlanet();
                    }
                } catch {}
                return result;
            };
            logMessage._paultendoLogSync = true;
            logMessage._paultendoBase = baseLogMessage;
        }
    }

    function initSpaceSystems() {
        const universe = getUniverse(false);
        if (!universe) return;
        initSpaceRoutes();
        initSpaceWars();
    }

    function wrapNextDayForUniverse() {
        if (typeof nextDay !== "function" || nextDay._paultendoUniverse) return;
        const baseNextDay = nextDay;
        nextDay = function(...args) {
            const result = baseNextDay.apply(this, args);
            try { syncLogToPlanet(); } catch {}
            try { updateSpaceTech(); } catch {}
            try { updateSpaceDiscovery(); } catch {}
            try { maybeCreateSpaceRoute(); } catch {}
            try { maybeStartSpaceWar(); } catch {}
            try { tickInactiveWorlds(); } catch {}
            try { processSpaceRoutes(); } catch {}
            try { processSpaceWars(); } catch {}
            return result;
        };
        nextDay._paultendoUniverse = true;
    }

    function wrapInitGameForUniverse() {
        if (typeof initGame !== "function" || initGame._paultendoUniverse) return;
        const baseInitGame = initGame;
        initGame = function(...args) {
            const result = baseInitGame.apply(this, args);
            try {
                const universe = getUniverse();
                if (universe) {
                    universe.currentWorldId = getCurrentWorldId();
                    syncCurrentWorldState(universe);
                }
                restoreLogFromPlanet({ merge: true });
                syncLogToPlanet();
            } catch {}
            return result;
        };
        initGame._paultendoUniverse = true;
    }

    function wrapSaveLoadForUniverse() {
        if (typeof generateSave === "function" && !generateSave._paultendoUniverse) {
            const baseGenerateSave = generateSave;
            generateSave = function(...args) {
                const universe = getUniverse(false);
                if (universe) {
                    syncCurrentWorldState(universe);
                }
                const save = baseGenerateSave.apply(this, args);
                try {
                    save.paultendoUniverse = serializeUniverse(universe, baseGenerateSave);
                } catch {}
                return save;
            };
            generateSave._paultendoUniverse = true;
        }

        if (typeof parseSave === "function" && !parseSave._paultendoUniverse) {
            const baseParseSave = parseSave;
            parseSave = function(json) {
                baseParseSave(json);
                try { deserializeUniverse(json, baseParseSave); } catch {}
            };
            parseSave._paultendoUniverse = true;
        }
    }

    function serializeUniverse(universe, baseGenerateSave) {
        if (!universe) return null;
        const data = {
            version: UNIVERSE_VERSION,
            currentWorldId: universe.currentWorldId,
            homeWorldId: universe.homeWorldId,
            worldOrder: universe.worldOrder || [],
            baseDims: universe.baseDims || null,
            spaceTech: universe.spaceTech || 0,
            spaceFlags: {
                orbitNoted: !!universe._spaceOrbitNoted,
                moonNoted: !!universe._spaceMoonNoted
            },
            nextSpaceRouteId: universe.nextSpaceRouteId || 1,
            nextSpaceWarId: universe.nextSpaceWarId || 1,
            relations: universe.relations || {},
            worlds: {},
            worldSaves: {},
            spaceRoutes: universe.spaceRoutes || [],
            spaceWars: universe.spaceWars || []
        };

        for (const world of Object.values(universe.worlds || {})) {
            if (!world) continue;
            data.worlds[world.id] = {
                id: world.id,
                key: world.key,
                type: world.type,
                orbitIndex: world.orbitIndex,
                sizeScale: world.sizeScale,
                waterLevel: world.waterLevel,
                habitable: world.habitable,
                harsh: world.harsh,
                label: world.label,
                color: world.color,
                discovery: world.discovery,
                name: world.name,
                discovered: world.discovered,
                orbitAngle: world.orbitAngle,
                createdDay: world.createdDay
            };
        }

        if (baseGenerateSave) {
            for (const world of Object.values(universe.worlds || {})) {
                if (!world || !world.state) continue;
                if (world.id === universe.currentWorldId) continue;
                const state = world.state;
                const worldSave = withWorldState(state, () => baseGenerateSave());
                if (worldSave) data.worldSaves[world.id] = worldSave;
            }
        }

        return data;
    }

    function deserializeUniverse(saveJson, baseParseSave) {
        if (!saveJson || !saveJson.paultendoUniverse) return;
        const saved = saveJson.paultendoUniverse;
        const universe = getUniverse(false) || createDefaultUniverse();
        if (!universe) return;

        universe.version = saved.version || UNIVERSE_VERSION;
        universe.currentWorldId = saved.currentWorldId || universe.currentWorldId;
        universe.homeWorldId = saved.homeWorldId || universe.homeWorldId;
        universe.worldOrder = saved.worldOrder || universe.worldOrder || [];
        universe.baseDims = saved.baseDims || universe.baseDims;
        universe.spaceTech = saved.spaceTech || 0;
        if (saved.spaceFlags) {
            universe._spaceOrbitNoted = !!saved.spaceFlags.orbitNoted;
            universe._spaceMoonNoted = !!saved.spaceFlags.moonNoted;
        }
        universe.nextSpaceRouteId = saved.nextSpaceRouteId || 1;
        universe.nextSpaceWarId = saved.nextSpaceWarId || 1;
        universe.relations = saved.relations || {};
        universe.spaceRoutes = saved.spaceRoutes || [];
        universe.spaceWars = saved.spaceWars || [];

        universe.worlds = {};
        for (const id in saved.worlds || {}) {
            const meta = saved.worlds[id];
            universe.worlds[meta.id] = {
                ...meta,
                state: null
            };
        }

        SOLAR_WORLD_TEMPLATES.forEach(template => {
            if (!universe.worlds[template.id]) {
                universe.worlds[template.id] = createWorldEntry(template);
            }
        });

        if (!universe.worldOrder || universe.worldOrder.length === 0) {
            universe.worldOrder = SOLAR_WORLD_TEMPLATES.map(t => t.id);
        }

        // Ensure active world is current planet
        const activeId = universe.currentWorldId || 1;
        const activeTemplate = universe.worlds[activeId] || getWorldTemplate(activeId);
        if (activeTemplate) {
            activeTemplate.state = captureWorldState();
            applyWorldMetaToPlanet(activeTemplate);
            universe.worlds[activeId] = activeTemplate;
        }

        if (baseParseSave && saved.worldSaves) {
            for (const id in saved.worldSaves) {
                if (parseInt(id) === activeId) continue;
                const worldSave = saved.worldSaves[id];
                const state = parseSaveToWorldState(worldSave, baseParseSave);
                if (state) {
                    if (!universe.worlds[id]) universe.worlds[id] = { id: parseInt(id) };
                    universe.worlds[id].state = state;
                    applyWorldMetaToPlanet(universe.worlds[id], state);
                }
            }
        }

        window._paultendoUniverse = universe;
        ensureUniverseBase(universe);
    }

    function parseSaveToWorldState(saveObj, baseParseSave) {
        if (!saveObj || !baseParseSave) return null;
        const snapshot = {
            planet: planet,
            reg: reg,
            planetWidth: planetWidth,
            planetHeight: planetHeight,
            chunkSize: chunkSize,
            waterLevel: waterLevel,
            currentPlayer: currentPlayer,
            usedNames: typeof usedNames !== "undefined" ? JSON.parse(JSON.stringify(usedNames)) : null,
            userSettings: typeof userSettings !== "undefined" ? JSON.parse(JSON.stringify(userSettings)) : null
        };
        const stubs = {
            initGame: typeof initGame === "function" ? initGame : null,
            setView: typeof setView === "function" ? setView : null,
            logMessage: typeof logMessage === "function" ? logMessage : null,
            clearLog: typeof clearLog === "function" ? clearLog : null,
            updateStats: typeof updateStats === "function" ? updateStats : null,
            renderMap: typeof renderMap === "function" ? renderMap : null,
            renderHighlight: typeof renderHighlight === "function" ? renderHighlight : null,
            updateCanvas: typeof updateCanvas === "function" ? updateCanvas : null,
            fitToScreen: typeof fitToScreen === "function" ? fitToScreen : null,
            updateTitle: typeof updateTitle === "function" ? updateTitle : null,
            saveSettings: typeof saveSettings === "function" ? saveSettings : null,
            killPlanet: typeof killPlanet === "function" ? killPlanet : null
        };

        if (stubs.initGame) initGame = function() {};
        if (stubs.setView) setView = function() {};
        if (stubs.logMessage) logMessage = function() {};
        if (stubs.clearLog) clearLog = function() {};
        if (stubs.updateStats) updateStats = function() {};
        if (stubs.renderMap) renderMap = function() {};
        if (stubs.renderHighlight) renderHighlight = function() {};
        if (stubs.updateCanvas) updateCanvas = function() {};
        if (stubs.fitToScreen) fitToScreen = function() {};
        if (stubs.updateTitle) updateTitle = function() {};
        if (stubs.saveSettings) saveSettings = function() {};
        if (stubs.killPlanet) killPlanet = function() {};

        let state = null;
        try {
            baseParseSave(saveObj);
            state = captureWorldState();
        } catch {}
        finally {
            if (stubs.initGame) initGame = stubs.initGame;
            if (stubs.setView) setView = stubs.setView;
            if (stubs.logMessage) logMessage = stubs.logMessage;
            if (stubs.clearLog) clearLog = stubs.clearLog;
            if (stubs.updateStats) updateStats = stubs.updateStats;
            if (stubs.renderMap) renderMap = stubs.renderMap;
            if (stubs.renderHighlight) renderHighlight = stubs.renderHighlight;
            if (stubs.updateCanvas) updateCanvas = stubs.updateCanvas;
            if (stubs.fitToScreen) fitToScreen = stubs.fitToScreen;
            if (stubs.updateTitle) updateTitle = stubs.updateTitle;
            if (stubs.saveSettings) saveSettings = stubs.saveSettings;
            if (stubs.killPlanet) killPlanet = stubs.killPlanet;

            planet = snapshot.planet;
            reg = snapshot.reg;
            planetWidth = snapshot.planetWidth;
            planetHeight = snapshot.planetHeight;
            chunkSize = snapshot.chunkSize;
            waterLevel = snapshot.waterLevel;
            currentPlayer = snapshot.currentPlayer;
            if (snapshot.usedNames && typeof usedNames !== "undefined") {
                for (const key in usedNames) {
                    if (!(key in snapshot.usedNames)) delete usedNames[key];
                }
                for (const key in snapshot.usedNames) {
                    usedNames[key] = snapshot.usedNames[key];
                }
            }

            if (snapshot.userSettings && typeof userSettings !== "undefined") {
                for (const key in userSettings) {
                    if (!(key in snapshot.userSettings)) delete userSettings[key];
                }
                for (const key in snapshot.userSettings) {
                    userSettings[key] = snapshot.userSettings[key];
                }
            }
        }
        return state;
    }

    function initMultiWorldSystem() {
        ensureSolarHooks();
        wrapNextDayForUniverse();
        wrapInitGameForUniverse();
        wrapSaveLoadForUniverse();
        const universe = getUniverse();
        if (universe) {
            initSpaceSystems();
        }
        try { addSolarButton(); } catch {}
        try { updateSpaceTech(); } catch {}
        try { updateSpaceDiscovery(); } catch {}
    }

    // Harsh environments pressure early colonies
    modEvent("harshWorldConditions", {
        daily: true,
        subject: { reg: "town", all: true },
        check: () => {
            const world = getWorldById(getCurrentWorldId());
            if (!world || !isWorldHarsh(world)) return false;
            if ((planet.unlocks?.space || 0) >= 80) return false;
            return true;
        },
        func: (subject) => {
            if (!subject || subject.end) return;
            happen("Influence", null, subject, { farm: -0.2, happy: -0.15, temp: true });
            if (Math.random() < 0.05) {
                const loss = Math.max(1, Math.floor((subject.pop || 0) * 0.002));
                happen("Death", null, subject, { count: loss, cause: "environment" });
            }
        }
    });

    if (typeof window !== "undefined") {
        window.addEventListener("load", () => {
            try { initMultiWorldSystem(); } catch {}
        });
    }

    if (typeof document !== "undefined") {
        if (document.readyState === "complete" || document.readyState === "interactive") {
            try { initMultiWorldSystem(); } catch {}
        }
    }

    // =========================================================================
    // DIVINE GUIDANCE COOLDOWNS (subtle hints, not faith penalties)
    // =========================================================================

    function initGuidanceState(town) {
        if (!town) return null;
        if (!town._paultendoGuidance) {
            town._paultendoGuidance = { last: {}, fatigue: {} };
        }
        return town._paultendoGuidance;
    }

    function canReceiveGuidance(town, key, cooldownDays) {
        const state = initGuidanceState(town);
        if (!state) return false;
        const last = state.last[key];
        if (last === undefined) return true;
        return (planet.day - last) >= cooldownDays;
    }

    function guidanceFatigue(town, key) {
        const state = initGuidanceState(town);
        if (!state) return 0;
        return state.fatigue[key] || 0;
    }

    function noteGuidance(town, key, success) {
        const state = initGuidanceState(town);
        if (!state) return;
        state.last[key] = planet.day;
        if (success === true) {
            state.fatigue[key] = Math.max(0, (state.fatigue[key] || 0) - 1);
        } else if (success === false) {
            state.fatigue[key] = Math.min(3, (state.fatigue[key] || 0) + 1);
        }
    }

    // =========================================================================
    // HOSPITAL HELPERS (marker-backed when possible)
    // =========================================================================

    function getTownHospitalsRaw(town) {
        if (!town) return [];
        return regFilter("marker", m => m.town === town.id && m.subtype === "hospital");
    }

    function getTownMarkersBySubtype(town, subtype) {
        if (!town) return [];
        return regFilter("marker", m => m.town === town.id && m.subtype === subtype);
    }

    function attachMarkerToChunk(marker, chunk) {
        if (!marker || !chunk || !chunk.v || chunk.v.m) return;
        chunk.v.m = marker.id;
    }

    function attachMarkerToTownChunk(marker, town) {
        if (!marker || !town) return;
        if (typeof chunkAt !== "function") return;
        if (typeof town.x !== "number" || typeof town.y !== "number") return;
        const chunk = chunkAt(town.x, town.y);
        attachMarkerToChunk(marker, chunk);
    }

    function detachMarkerFromChunk(marker) {
        if (!marker || typeof chunkAt !== "function") return;
        if (typeof marker.x !== "number" || typeof marker.y !== "number") return;
        const chunk = chunkAt(marker.x, marker.y);
        if (chunk && chunk.v && chunk.v.m === marker.id) {
            delete chunk.v.m;
        }
    }

    function removeMarkerById(id) {
        if (!id || typeof regGet !== "function") return false;
        const marker = regGet("marker", id);
        if (!marker) return false;
        detachMarkerFromChunk(marker);
        if (typeof regRemove === "function") {
            regRemove("marker", id);
        } else {
            marker.delete = true;
        }
        return true;
    }

    function createTempMarker(town, def, durationDays = 12) {
        if (!town || !def) return null;
        const spot = findTownMarkerSpot(town);
        const x = spot ? spot.x : town.x;
        const y = spot ? spot.y : town.y;
        if (typeof x !== "number" || typeof y !== "number") return null;
        const marker = happen("Create", null, null, {
            type: "landmark",
            name: def.name || "Notice",
            subtype: def.subtype || "notice",
            symbol: def.symbol || "?",
            color: def.color || [200, 200, 200],
            x: x,
            y: y
        }, "marker");
        if (marker) {
            marker._paultendoTemp = true;
            marker.expires = planet.day + durationDays;
            if (spot) attachMarkerToChunk(marker, spot);
            else attachMarkerToTownChunk(marker, town);
            return marker;
        }
        return null;
    }

    function cleanupTempMarkers() {
        if (!planet || !reg || !reg.marker) return;
        const markers = regToArray("marker", true);
        markers.forEach(marker => {
            if (!marker || !marker._paultendoTemp || !marker.expires) return;
            if (planet.day >= marker.expires) {
                removeMarkerById(marker.id);
            }
        });
    }

    function findTownMarkerSpot(town) {
        if (!town) return null;
        if (typeof filterChunks !== "function" || typeof chunkAt !== "function") return null;
        if (typeof adjacentCoords === "undefined") return null;

        const choices = filterChunks((c) => {
            if (!c || !c.v) return false;
            if (c.v.s !== town.id) return false;
            if (c.v.m) return false;
            for (let i = 0; i < adjacentCoords.length; i++) {
                const coords = adjacentCoords[i];
                const c2 = chunkAt(c.x + coords[0], c.y + coords[1]);
                if (!c2 || !c2.v || c2.v.s !== c.v.s) return false;
            }
            return true;
        });
        if (!choices || choices.length === 0) return null;
        return choose(choices);
    }

    function ensureHospitalMarker(town) {
        if (!town || !town.hasHospital) return;
        const existing = getTownHospitalsRaw(town);
        if (existing.length === 0) {
            const created = createHospital(town);
            if (!created) return;
        }
        delete town.hasHospital;
    }

    function getTownHospitals(town) {
        ensureHospitalMarker(town);
        return getTownHospitalsRaw(town);
    }

    function hasHospital(town) {
        if (!town) return false;
        return getTownHospitals(town).length > 0;
    }

    function createHospital(town) {
        if (!town) return false;
        const existing = getTownHospitalsRaw(town);
        if (existing.length > 0) return false;
        const spot = findTownMarkerSpot(town);
        const x = spot ? spot.x : town.x;
        const y = spot ? spot.y : town.y;
        if (typeof x === "number" && typeof y === "number") {
            const marker = happen("Create", null, null, {
                type: "landmark",
                name: "Hospital",
                subtype: "hospital",
                symbol: "H",
                color: [200, 60, 60],
                x: x,
                y: y
            }, "marker");
            if (marker) {
                if (spot) attachMarkerToChunk(marker, spot);
                else attachMarkerToTownChunk(marker, town);
                return true;
            }
        }
        return false;
    }

    // =========================================================================
    // SWAY MECHANIC
    // Allows player to spread rumors and sow discord between towns
    // =========================================================================

    // Calculate success chance for swaying a town against another
    function calcSwaySuccess(town, targetTown) {
        if (!town || !targetTown) return 0.4;
        ensureTownState(town);
        ensureTownState(targetTown);
        // Base 40% chance
        let chance = SWAY_BASE_CHANCE;

        // Faith: +8% per point (towns that trust you believe you)
        const faith = town.influences.faith || 0;
        chance += faith * 0.08;

        // Existing tension: +5% per negative relation point (easier to inflame grudges)
        const relation = town.relations[targetTown.id] || 0;
        if (relation < 0) {
            chance += Math.abs(relation) * 0.05;
        } else {
            // Friendly with target: -5% per positive point (harder sell)
            chance -= relation * 0.05;
        }

        // Education: -4% per point (educated towns see through manipulation)
        const education = town.influences.education || 0;
        chance -= education * 0.04;

        // Trade: -4% per point (trading towns share information)
        const trade = town.influences.trade || 0;
        chance -= trade * 0.04;

        // Clamp between 5% and 95%
        return clampChance(chance);
    }

    // Helper: Get landmarks for a town
    function getTownLandmarks(town) {
        return regFilter("marker", (m) => m.town === town.id && m.subtype);
    }

    // Helper: Check if town has a temple (boosts sway via faith)
    function hasTemple(town) {
        return getTownLandmarks(town).some((m) => m.subtype === "temple");
    }

    // -------------------------------------------------------------------------
    // NEGATIVE SWAY: Spread rumors / sow discord
    // -------------------------------------------------------------------------

    modEvent("swayDiscord", {
        random: true,
        weight: $c.UNCOMMON,
        subject: {
            reg: "player", id: 1
        },
        target: {
            reg: "town", random: true
        },
        value: (subject, target, args) => {
            const otherTowns = regFilter("town", (t) =>
                t.id !== target.id && !t.end && t.pop > 0
            );
            if (!otherTowns.length) return false;
            args.otherTown = choose(otherTowns);
            args.successChance = calcSwaySuccess(target, args.otherTown);
            return true;
        },
        check: (subject, target, args) => {
            const towns = regFilter("town", (t) => !t.end && t.pop > 0);
            if (towns.length < 2) return false;
            if ((target.influences.faith || 0) < -5) return false;
            return true;
        },
        message: (subject, target, args) => {
            return `A {{c:quiet moment|private audience|hushed conversation}} with {{regname:town|${target.id}}}. You could {{c:whisper rumors|spread tales|sow doubt}} about {{regname:town|${args.otherTown.id}}}...`;
        },
        func: (subject, target, args) => {
            const success = Math.random() < args.successChance;
            args.success = success;

            if (success) {
                happen("AddRelation", target, args.otherTown, { amount: -3 });
                logMessage(`{{residents:${target.id}}} grow {{c:suspicious|distrustful|wary}} of {{regname:town|${args.otherTown.id}}}.`);
            } else {
                happen("Influence", subject, target, { faith: -2 });
                happen("Influence", subject, args.otherTown, { faith: -1 });
                happen("AddRelation", target, args.otherTown, { amount: 1 });
                logMessage(`Your {{c:rumors|whispers|machinations}} are exposed! {{regname:town|${target.id}}} and {{regname:town|${args.otherTown.id}}} {{c:see through your deception|discover your meddling|learn of your scheming}}.`, "warning");
            }
        },
        messageDone: (subject, target, args) => {
            if (args.success) {
                return `Seeds of discord planted between {{regname:town|${target.id}}} and {{regname:town|${args.otherTown.id}}}.`;
            }
            return null;
        },
        messageNo: () => `You hold your tongue. Perhaps {{c:honesty|patience|restraint}} is wiser.`
    });

    // -------------------------------------------------------------------------
    // POSITIVE SWAY: Encourage friendship / mend relations
    // -------------------------------------------------------------------------

    modEvent("swayFriendship", {
        random: true,
        weight: $c.UNCOMMON,
        subject: {
            reg: "player", id: 1
        },
        target: {
            reg: "town", random: true
        },
        value: (subject, target, args) => {
            const otherTowns = regFilter("town", (t) =>
                t.id !== target.id && !t.end && t.pop > 0
            );
            if (!otherTowns.length) return false;
            args.otherTown = choose(otherTowns);
            // Friendship is easier when they already like each other, harder with enemies
            args.successChance = calcSwaySuccess(target, args.otherTown);
            // Invert the relation modifier - easier to build on existing friendship
            const relation = target.relations[args.otherTown.id] || 0;
            if (relation > 0) {
                args.successChance += relation * 0.05;
            } else {
                args.successChance -= Math.abs(relation) * 0.03;
            }
            args.successChance = clampChance(args.successChance);
            return true;
        },
        check: (subject, target, args) => {
            const towns = regFilter("town", (t) => !t.end && t.pop > 0);
            if (towns.length < 2) return false;
            if ((target.influences.faith || 0) < -5) return false;
            return true;
        },
        message: (subject, target, args) => {
            return `{{regname:town|${target.id}}} seeks your counsel. You could {{c:speak well of|praise|encourage friendship with}} {{regname:town|${args.otherTown.id}}}...`;
        },
        func: (subject, target, args) => {
            const success = Math.random() < args.successChance;
            args.success = success;

            if (success) {
                happen("AddRelation", target, args.otherTown, { amount: 2 });
                happen("Influence", subject, target, { happy: 0.5 });
                logMessage(`{{residents:${target.id}}} warm to the idea of {{c:friendship|cooperation|alliance}} with {{regname:town|${args.otherTown.id}}}.`);
            } else {
                // Mild backfire - they see you as naive, slight faith loss
                happen("Influence", subject, target, { faith: -1 });
                logMessage(`{{residents:${target.id}}} {{c:dismiss|scoff at|ignore}} your {{c:optimistic|naive|idealistic}} words about {{regname:town|${args.otherTown.id}}}.`);
            }
        },
        messageDone: (subject, target, args) => {
            if (args.success) {
                return `Bonds strengthen between {{regname:town|${target.id}}} and {{regname:town|${args.otherTown.id}}}.`;
            }
            return null;
        },
        messageNo: () => `You remain silent. They will find their own path.`
    });

    // -------------------------------------------------------------------------
    // TEMPLE SWAY: Divine proclamation (high risk, high reward)
    // Requires a temple - speak through religious authority
    // -------------------------------------------------------------------------

    modEvent("swayTemple", {
        random: true,
        weight: $c.RARE,
        subject: {
            reg: "player", id: 1
        },
        target: {
            reg: "town", random: true
        },
        value: (subject, target, args) => {
            const otherTowns = regFilter("town", (t) =>
                t.id !== target.id && !t.end && t.pop > 0
            );
            if (!otherTowns.length) return false;
            args.otherTown = choose(otherTowns);
            // Temple proclamations are more powerful but riskier
            args.successChance = calcSwaySuccess(target, args.otherTown);
            // Faith bonus is doubled for temple proclamations
            const faith = target.influences.faith || 0;
            args.successChance += faith * 0.08; // Extra faith bonus on top of base
            args.successChance = clampChance(args.successChance, 0.10, 0.90);
            args.temple = getTownLandmarks(target).find((m) => m.subtype === "temple");
            return true;
        },
        check: (subject, target, args) => {
            const towns = regFilter("town", (t) => !t.end && t.pop > 0);
            if (towns.length < 2) return false;
            if (!hasTemple(target)) return false;
            if ((target.influences.faith || 0) < 0) return false;
            return true;
        },
        message: (subject, target, args) => {
            return `The priests of {{regname:marker|${args.temple.id}}} await your word. You could {{c:proclaim divine judgment|issue a holy decree|speak through the faith}} against {{regname:town|${args.otherTown.id}}}...`;
        },
        func: (subject, target, args) => {
            const success = Math.random() < args.successChance;
            args.success = success;

            if (success) {
                // Strong effect
                happen("AddRelation", target, args.otherTown, { amount: -5 });
                happen("Influence", subject, target, { faith: 1 });
                logMessage(`{{residents:${target.id}}} heed the {{c:divine word|holy proclamation|sacred decree}}. {{regname:town|${args.otherTown.id}}} is now seen as {{c:unworthy|sinful|fallen}}.`);
            } else {
                // Severe backfire - religious authority questioned
                happen("Influence", subject, target, { faith: -4 });
                happen("Influence", subject, args.otherTown, { faith: -2 });
                happen("AddRelation", target, args.otherTown, { amount: 2 });
                logMessage(`The proclamation rings hollow! {{residents:${target.id}}} {{c:question the divine|doubt the faith|lose trust in the temple}}. Word spreads to {{regname:town|${args.otherTown.id}}}.`, "warning");
            }
        },
        messageDone: (subject, target, args) => {
            if (args.success) {
                return `Divine judgment pronounced from {{regname:marker|${args.temple.id}}}.`;
            }
            return null;
        },
        messageNo: () => `The temple falls silent. Some matters are beyond divine meddling.`
    });

    // -------------------------------------------------------------------------
    // TRADE SWAY: Economic manipulation (works through trade routes)
    // -------------------------------------------------------------------------

    modEvent("swayTrade", {
        random: true,
        weight: $c.UNCOMMON,
        subject: {
            reg: "player", id: 1
        },
        target: {
            reg: "town", random: true
        },
        value: (subject, target, args) => {
            const otherTowns = regFilter("town", (t) =>
                t.id !== target.id && !t.end && t.pop > 0
            );
            if (!otherTowns.length) return false;
            args.otherTown = choose(otherTowns);
            args.successChance = calcSwaySuccess(target, args.otherTown);
            // Trade-focused towns are better at this but also harder to fool
            // Net effect: trade makes success slightly more reliable (less random)
            const trade = target.influences.trade || 0;
            if (trade > 0) {
                args.successChance = 0.5 + (args.successChance - 0.5) * 0.7; // Pull toward 50%
            }
            args.successChance = clampChance(args.successChance);
            return true;
        },
        check: (subject, target, args) => {
            const towns = regFilter("town", (t) => !t.end && t.pop > 0);
            if (towns.length < 2) return false;
            if ((target.influences.trade || 0) < 2) return false;
            if ((target.influences.faith || 0) < -5) return false;
            return true;
        },
        message: (subject, target, args) => {
            return `Merchants of {{regname:town|${target.id}}} seek trade advice. You could {{c:suggest|hint|imply}} that {{regname:town|${args.otherTown.id}}} is {{c:an unreliable partner|bad for business|not to be trusted}}...`;
        },
        func: (subject, target, args) => {
            const success = Math.random() < args.successChance;
            args.success = success;

            if (success) {
                happen("AddRelation", target, args.otherTown, { amount: -2 });
                happen("Influence", subject, target, { trade: -1 });
                happen("Influence", subject, args.otherTown, { trade: -1 });
                logMessage(`Trade {{c:slows|cools|diminishes}} between {{regname:town|${target.id}}} and {{regname:town|${args.otherTown.id}}}.`);
            } else {
                happen("Influence", subject, target, { faith: -1, trade: 1 });
                logMessage(`The merchants of {{regname:town|${target.id}}} {{c:ignore your advice|trust their own judgment|see through the suggestion}}.`);
            }
        },
        messageDone: (subject, target, args) => {
            if (args.success) {
                return `Economic ties strained between {{regname:town|${target.id}}} and {{regname:town|${args.otherTown.id}}}.`;
            }
            return null;
        },
        messageNo: () => `You let the merchants decide for themselves.`
    });

    // -------------------------------------------------------------------------
    // ENCOURAGE TRADE: Positive economic sway
    // -------------------------------------------------------------------------

    modEvent("swayTradePositive", {
        random: true,
        weight: $c.UNCOMMON,
        subject: {
            reg: "player", id: 1
        },
        target: {
            reg: "town", random: true
        },
        value: (subject, target, args) => {
            const otherTowns = regFilter("town", (t) =>
                t.id !== target.id && !t.end && t.pop > 0
            );
            if (!otherTowns.length) return false;
            args.otherTown = choose(otherTowns);
            args.successChance = calcSwaySuccess(target, args.otherTown);
            const relation = target.relations[args.otherTown.id] || 0;
            if (relation > 0) {
                args.successChance += 0.15; // Easier when already friendly
            }
            args.successChance = clampChance(args.successChance);
            return true;
        },
        check: (subject, target, args) => {
            const towns = regFilter("town", (t) => !t.end && t.pop > 0);
            if (towns.length < 2) return false;
            if ((target.influences.trade || 0) < 2) return false;
            if ((target.influences.faith || 0) < -5) return false;
            return true;
        },
        message: (subject, target, args) => {
            return `Merchants of {{regname:town|${target.id}}} seek trade advice. You could {{c:recommend|endorse|encourage}} trade with {{regname:town|${args.otherTown.id}}}...`;
        },
        func: (subject, target, args) => {
            const success = Math.random() < args.successChance;
            args.success = success;

            if (success) {
                happen("AddRelation", target, args.otherTown, { amount: 2 });
                happen("Influence", subject, target, { trade: 1 });
                happen("Influence", subject, args.otherTown, { trade: 1 });
                logMessage(`New trade routes open between {{regname:town|${target.id}}} and {{regname:town|${args.otherTown.id}}}.`);
            } else {
                happen("Influence", subject, target, { faith: -0.5 });
                logMessage(`The merchants of {{regname:town|${target.id}}} {{c:hesitate|are unconvinced|prefer existing partners}}.`);
            }
        },
        messageDone: (subject, target, args) => {
            if (args.success) {
                return `Trade flourishes between {{regname:town|${target.id}}} and {{regname:town|${args.otherTown.id}}}.`;
            }
            return null;
        },
        messageNo: () => `You let the merchants find their own opportunities.`
    });

    // -------------------------------------------------------------------------
    // MILITARY SWAY: Warn of threats (incite military buildup / fear)
    // -------------------------------------------------------------------------

    modEvent("swayMilitary", {
        random: true,
        weight: $c.UNCOMMON,
        subject: {
            reg: "player", id: 1
        },
        target: {
            reg: "town", random: true
        },
        value: (subject, target, args) => {
            const otherTowns = regFilter("town", (t) =>
                t.id !== target.id && !t.end && t.pop > 0
            );
            if (!otherTowns.length) return false;
            args.otherTown = choose(otherTowns);
            args.successChance = calcSwaySuccess(target, args.otherTown);
            // Military towns are more receptive to threat warnings
            const military = target.influences.military || 0;
            args.successChance += military * 0.05;
            args.successChance = clampChance(args.successChance);
            return true;
        },
        check: (subject, target, args) => {
            const towns = regFilter("town", (t) => !t.end && t.pop > 0);
            if (towns.length < 2) return false;
            if (!planet.unlocks.military) return false;
            if ((target.influences.faith || 0) < -5) return false;
            return true;
        },
        message: (subject, target, args) => {
            return `{{regname:town|${target.id}}}'s generals seek your wisdom. You could {{c:warn of|hint at|suggest}} a {{c:threat|danger|menace}} from {{regname:town|${args.otherTown.id}}}...`;
        },
        func: (subject, target, args) => {
            const success = Math.random() < args.successChance;
            args.success = success;

            if (success) {
                happen("AddRelation", target, args.otherTown, { amount: -3 });
                happen("Influence", subject, target, { military: 1 });
                logMessage(`{{residents:${target.id}}} {{c:fortify their borders|arm themselves|prepare for conflict}} against {{regname:town|${args.otherTown.id}}}.`);
            } else {
                happen("Influence", subject, target, { faith: -2, military: -1 });
                logMessage(`The generals of {{regname:town|${target.id}}} {{c:see through your warmongering|dismiss your warnings as fear-mongering|question your motives}}.`, "warning");
            }
        },
        messageDone: (subject, target, args) => {
            if (args.success) {
                return `{{regname:town|${target.id}}} now views {{regname:town|${args.otherTown.id}}} as a military threat.`;
            }
            return null;
        },
        messageNo: () => `You counsel peace. The generals return to their posts.`
    });

    // -------------------------------------------------------------------------
    // MILITARY ALLIANCE: Encourage mutual defense
    // -------------------------------------------------------------------------

    modEvent("swayAlliance", {
        random: true,
        weight: $c.UNCOMMON,
        subject: {
            reg: "player", id: 1
        },
        target: {
            reg: "town", random: true
        },
        value: (subject, target, args) => {
            const otherTowns = regFilter("town", (t) =>
                t.id !== target.id && !t.end && t.pop > 0
            );
            if (!otherTowns.length) return false;
            args.otherTown = choose(otherTowns);
            args.successChance = calcSwaySuccess(target, args.otherTown);
            // Easier if already friendly
            const relation = target.relations[args.otherTown.id] || 0;
            if (relation > 0) {
                args.successChance += relation * 0.06;
            } else {
                args.successChance -= Math.abs(relation) * 0.04;
            }
            args.successChance = clampChance(args.successChance);
            return true;
        },
        check: (subject, target, args) => {
            const towns = regFilter("town", (t) => !t.end && t.pop > 0);
            if (towns.length < 2) return false;
            if (!planet.unlocks.military) return false;
            if ((target.influences.faith || 0) < -5) return false;
            return true;
        },
        message: (subject, target, args) => {
            return `{{regname:town|${target.id}}}'s leaders discuss defense. You could suggest an {{c:alliance|pact|mutual defense treaty}} with {{regname:town|${args.otherTown.id}}}...`;
        },
        func: (subject, target, args) => {
            const success = Math.random() < args.successChance;
            args.success = success;

            if (success) {
                happen("AddRelation", target, args.otherTown, { amount: 3 });
                happen("Influence", subject, target, { military: 0.5 });
                happen("Influence", subject, args.otherTown, { military: 0.5 });
                logMessage(`{{regname:town|${target.id}}} and {{regname:town|${args.otherTown.id}}} {{c:form an alliance|pledge mutual defense|strengthen their bond}}.`);
            } else {
                happen("Influence", subject, target, { faith: -1 });
                logMessage(`{{residents:${target.id}}} {{c:prefer independence|distrust alliances|reject the proposal}}.`);
            }
        },
        messageDone: (subject, target, args) => {
            if (args.success) {
                return `Military alliance formed between {{regname:town|${target.id}}} and {{regname:town|${args.otherTown.id}}}.`;
            }
            return null;
        },
        messageNo: () => `You let them determine their own alliances.`
    });

    // -------------------------------------------------------------------------
    // EDUCATION SWAY: Spread intellectual rivalry / academic competition
    // -------------------------------------------------------------------------

    modEvent("swayScholars", {
        random: true,
        weight: $c.UNCOMMON,
        subject: {
            reg: "player", id: 1
        },
        target: {
            reg: "town", random: true
        },
        value: (subject, target, args) => {
            const otherTowns = regFilter("town", (t) =>
                t.id !== target.id && !t.end && t.pop > 0 &&
                (t.influences.education || 0) >= 1
            );
            if (!otherTowns.length) return false;
            args.otherTown = choose(otherTowns);
            args.successChance = calcSwaySuccess(target, args.otherTown);
            // Educated towns are harder to manipulate but also more competitive
            const education = target.influences.education || 0;
            args.successChance += education * 0.02; // Small boost for pride
            args.successChance = clampChance(args.successChance);
            return true;
        },
        check: (subject, target, args) => {
            const towns = regFilter("town", (t) => !t.end && t.pop > 0);
            if (towns.length < 2) return false;
            if ((target.influences.education || 0) < 2) return false;
            if ((target.influences.faith || 0) < -5) return false;
            return true;
        },
        message: (subject, target, args) => {
            return `Scholars of {{regname:town|${target.id}}} debate their standing. You could {{c:question|cast doubt on|challenge}} the {{c:wisdom|intellect|scholarship}} of {{regname:town|${args.otherTown.id}}}...`;
        },
        func: (subject, target, args) => {
            const success = Math.random() < args.successChance;
            args.success = success;

            if (success) {
                happen("AddRelation", target, args.otherTown, { amount: -2 });
                happen("Influence", subject, target, { education: 1 }); // Competition drives learning
                happen("Influence", subject, args.otherTown, { education: 1 });
                logMessage(`Academic rivalry {{c:ignites|sparks|emerges}} between {{regname:town|${target.id}}} and {{regname:town|${args.otherTown.id}}}.`);
            } else {
                happen("Influence", subject, target, { faith: -1, education: 0.5 });
                logMessage(`The scholars of {{regname:town|${target.id}}} {{c:see through your divisive words|value truth over rivalry|refuse to play games}}.`);
            }
        },
        messageDone: (subject, target, args) => {
            if (args.success) {
                return `Intellectual rivalry stoked between {{regname:town|${target.id}}} and {{regname:town|${args.otherTown.id}}}.`;
            }
            return null;
        },
        messageNo: () => `You praise both towns' scholars equally.`
    });

    // -------------------------------------------------------------------------
    // EDUCATION EXCHANGE: Encourage knowledge sharing
    // -------------------------------------------------------------------------

    modEvent("swayKnowledge", {
        random: true,
        weight: $c.UNCOMMON,
        subject: {
            reg: "player", id: 1
        },
        target: {
            reg: "town", random: true
        },
        value: (subject, target, args) => {
            const otherTowns = regFilter("town", (t) =>
                t.id !== target.id && !t.end && t.pop > 0
            );
            if (!otherTowns.length) return false;
            args.otherTown = choose(otherTowns);
            args.successChance = calcSwaySuccess(target, args.otherTown);
            // Easier with existing good relations
            const relation = target.relations[args.otherTown.id] || 0;
            if (relation > 0) args.successChance += 0.10;
            args.successChance = clampChance(args.successChance);
            return true;
        },
        check: (subject, target, args) => {
            const towns = regFilter("town", (t) => !t.end && t.pop > 0);
            if (towns.length < 2) return false;
            if ((target.influences.education || 0) < 1) return false;
            if ((target.influences.faith || 0) < -5) return false;
            return true;
        },
        message: (subject, target, args) => {
            return `{{regname:town|${target.id}}} considers its future. You could encourage {{c:scholarly exchange|shared learning|knowledge partnerships}} with {{regname:town|${args.otherTown.id}}}...`;
        },
        func: (subject, target, args) => {
            const success = Math.random() < args.successChance;
            args.success = success;

            if (success) {
                happen("AddRelation", target, args.otherTown, { amount: 2 });
                happen("Influence", subject, target, { education: 1.5 });
                happen("Influence", subject, args.otherTown, { education: 1 });
                logMessage(`Scholars travel between {{regname:town|${target.id}}} and {{regname:town|${args.otherTown.id}}}, {{c:sharing wisdom|exchanging knowledge|learning together}}.`);
            } else {
                happen("Influence", subject, target, { faith: -0.5 });
                logMessage(`{{residents:${target.id}}} {{c:prefer their own teachers|distrust outside knowledge|politely decline}}.`);
            }
        },
        messageDone: (subject, target, args) => {
            if (args.success) {
                return `Knowledge flows between {{regname:town|${target.id}}} and {{regname:town|${args.otherTown.id}}}.`;
            }
            return null;
        },
        messageNo: () => `You let scholarship develop naturally.`
    });

    // -------------------------------------------------------------------------
    // CULTURAL SWAY: Spread cultural superiority / rivalry
    // -------------------------------------------------------------------------

    modEvent("swayCulture", {
        random: true,
        weight: $c.RARE,
        subject: {
            reg: "player", id: 1
        },
        target: {
            reg: "town", random: true
        },
        value: (subject, target, args) => {
            const otherTowns = regFilter("town", (t) =>
                t.id !== target.id && !t.end && t.pop > 0
            );
            if (!otherTowns.length) return false;
            args.otherTown = choose(otherTowns);
            args.successChance = calcSwaySuccess(target, args.otherTown);
            return true;
        },
        check: (subject, target, args) => {
            const towns = regFilter("town", (t) => !t.end && t.pop > 0);
            if (towns.length < 2) return false;
            if ((target.influences.faith || 0) < -5) return false;
            // Need some cultural development
            if ((target.influences.happy || 0) < 0) return false;
            return true;
        },
        message: (subject, target, args) => {
            return `Pride swells in {{regname:town|${target.id}}}. You could {{c:suggest|imply|hint}} their culture is {{c:superior to|more refined than|greater than}} {{regname:town|${args.otherTown.id}}}'s...`;
        },
        func: (subject, target, args) => {
            const success = Math.random() < args.successChance;
            args.success = success;

            if (success) {
                happen("AddRelation", target, args.otherTown, { amount: -2 });
                happen("Influence", subject, target, { happy: 1 }); // Pride boost
                happen("Influence", subject, args.otherTown, { happy: -0.5 }); // Slight resentment
                logMessage(`{{residents:${target.id}}} grow {{c:proud|boastful|confident}} of their {{c:culture|heritage|traditions}}, looking down on {{regname:town|${args.otherTown.id}}}.`);
            } else {
                happen("Influence", subject, target, { faith: -1.5 });
                happen("AddRelation", target, args.otherTown, { amount: 1 });
                logMessage(`{{residents:${target.id}}} {{c:reject your divisive words|refuse to look down on neighbors|value humility}}.`);
            }
        },
        messageDone: (subject, target, args) => {
            if (args.success) {
                return `Cultural pride rises in {{regname:town|${target.id}}}, at {{regname:town|${args.otherTown.id}}}'s expense.`;
            }
            return null;
        },
        messageNo: () => `You encourage respect for all cultures.`
    });

    // -------------------------------------------------------------------------
    // CULTURAL EXCHANGE: Encourage festivals and shared celebrations
    // -------------------------------------------------------------------------

    modEvent("swayFestival", {
        random: true,
        weight: $c.UNCOMMON,
        subject: {
            reg: "player", id: 1
        },
        target: {
            reg: "town", random: true
        },
        value: (subject, target, args) => {
            const otherTowns = regFilter("town", (t) =>
                t.id !== target.id && !t.end && t.pop > 0
            );
            if (!otherTowns.length) return false;
            args.otherTown = choose(otherTowns);
            args.successChance = calcSwaySuccess(target, args.otherTown);
            // Happy towns are more receptive to festivals
            const happy = target.influences.happy || 0;
            args.successChance += happy * 0.04;
            args.successChance = clampChance(args.successChance);
            return true;
        },
        check: (subject, target, args) => {
            const towns = regFilter("town", (t) => !t.end && t.pop > 0);
            if (towns.length < 2) return false;
            if ((target.influences.faith || 0) < -5) return false;
            return true;
        },
        message: (subject, target, args) => {
            return `{{regname:town|${target.id}}} plans celebrations. You could suggest a {{c:joint festival|shared celebration|cultural exchange}} with {{regname:town|${args.otherTown.id}}}...`;
        },
        func: (subject, target, args) => {
            const success = Math.random() < args.successChance;
            args.success = success;

            if (success) {
                happen("AddRelation", target, args.otherTown, { amount: 3 });
                happen("Influence", subject, target, { happy: 1.5 });
                happen("Influence", subject, args.otherTown, { happy: 1 });
                logMessage(`{{c:Music|Dance|Celebration}} fills the air as {{regname:town|${target.id}}} and {{regname:town|${args.otherTown.id}}} {{c:celebrate together|share their traditions|feast as one}}.`);
            } else {
                happen("Influence", subject, target, { faith: -0.5, happy: 0.5 }); // At least they tried
                logMessage(`{{residents:${target.id}}} {{c:prefer to celebrate alone|aren't ready for joint festivities|politely decline}}.`);
            }
        },
        messageDone: (subject, target, args) => {
            if (args.success) {
                return `Joyful celebrations unite {{regname:town|${target.id}}} and {{regname:town|${args.otherTown.id}}}.`;
            }
            return null;
        },
        messageNo: () => `You let them plan their own festivities.`
    });

    // -------------------------------------------------------------------------
    // MEDIATE CONFLICT: Try to heal existing bad relations
    // -------------------------------------------------------------------------

    modEvent("swayMediate", {
        random: true,
        weight: $c.RARE,
        subject: {
            reg: "player", id: 1
        },
        target: {
            reg: "town", random: true
        },
        value: (subject, target, args) => {
            // Find a town they have BAD relations with
            const enemyTowns = regFilter("town", (t) => {
                if (t.id === target.id || t.end || t.pop <= 0) return false;
                const relation = target.relations[t.id] || 0;
                return relation < -2; // Must have existing tension
            });
            if (!enemyTowns.length) return false;
            args.otherTown = choose(enemyTowns);
            args.existingRelation = target.relations[args.otherTown.id] || 0;
            // Harder to mediate deep conflicts
            args.successChance = calcSwaySuccess(target, args.otherTown);
            args.successChance -= Math.abs(args.existingRelation) * 0.03;
            // But high faith helps a lot
            const faith = target.influences.faith || 0;
            args.successChance += faith * 0.06;
            args.successChance = clampChance(args.successChance, 0.10, 0.80);
            return true;
        },
        check: (subject, target, args) => {
            const towns = regFilter("town", (t) => !t.end && t.pop > 0);
            if (towns.length < 2) return false;
            if ((target.influences.faith || 0) < -3) return false;
            return true;
        },
        message: (subject, target, args) => {
            return `Tensions run high between {{regname:town|${target.id}}} and {{regname:town|${args.otherTown.id}}}. You could attempt to {{c:mediate|broker peace|heal the rift}}...`;
        },
        func: (subject, target, args) => {
            const success = Math.random() < args.successChance;
            args.success = success;

            if (success) {
                // Significant healing
                const healing = Math.min(5, Math.abs(args.existingRelation));
                happen("AddRelation", target, args.otherTown, { amount: healing });
                happen("Influence", subject, target, { faith: 1, happy: 0.5 });
                happen("Influence", subject, args.otherTown, { faith: 1, happy: 0.5 });
                logMessage(`Through your {{c:wisdom|guidance|counsel}}, {{regname:town|${target.id}}} and {{regname:town|${args.otherTown.id}}} {{c:find common ground|begin to reconcile|bury old grievances}}.`);
            } else {
                happen("Influence", subject, target, { faith: -1 });
                happen("Influence", subject, args.otherTown, { faith: -1 });
                happen("AddRelation", target, args.otherTown, { amount: -1 }); // Made it worse
                logMessage(`Your attempts at {{c:mediation|peace|reconciliation}} {{c:fail|backfire|fall on deaf ears}}. The wound between {{regname:town|${target.id}}} and {{regname:town|${args.otherTown.id}}} deepens.`, "warning");
            }
        },
        messageDone: (subject, target, args) => {
            if (args.success) {
                return `Old wounds begin to heal between {{regname:town|${target.id}}} and {{regname:town|${args.otherTown.id}}}.`;
            }
            return null;
        },
        messageNo: () => `You leave them to sort out their differences.`
    });

    // -------------------------------------------------------------------------
    // BLAME SHIFTING: Redirect anger from one town to another
    // -------------------------------------------------------------------------

    modEvent("swayBlame", {
        random: true,
        weight: $c.RARE,
        subject: {
            reg: "player", id: 1
        },
        target: {
            reg: "town", random: true
        },
        value: (subject, target, args) => {
            // Find a town they dislike
            const enemyTowns = regFilter("town", (t) => {
                if (t.id === target.id || t.end || t.pop <= 0) return false;
                const relation = target.relations[t.id] || 0;
                return relation < -1;
            });
            // Find a third town to redirect blame to
            const otherTowns = regFilter("town", (t) => {
                if (t.id === target.id || t.end || t.pop <= 0) return false;
                if (enemyTowns.some(e => e.id === t.id)) return false;
                return true;
            });
            if (!enemyTowns.length || !otherTowns.length) return false;
            args.currentEnemy = choose(enemyTowns);
            args.newTarget = choose(otherTowns);
            args.successChance = calcSwaySuccess(target, args.newTarget);
            // Riskier than normal sway
            args.successChance -= 0.10;
            args.successChance = clampChance(args.successChance, 0.05, 0.85);
            return true;
        },
        check: (subject, target, args) => {
            const towns = regFilter("town", (t) => !t.end && t.pop > 0);
            if (towns.length < 3) return false;
            if ((target.influences.faith || 0) < -3) return false;
            return true;
        },
        message: (subject, target, args) => {
            return `{{regname:town|${target.id}}} seethes with anger at {{regname:town|${args.currentEnemy.id}}}. You could {{c:suggest|imply|hint}} that {{regname:town|${args.newTarget.id}}} is the {{c:true culprit|real enemy|one to blame}}...`;
        },
        func: (subject, target, args) => {
            const success = Math.random() < args.successChance;
            args.success = success;

            if (success) {
                // Shift animosity
                happen("AddRelation", target, args.currentEnemy, { amount: 2 });
                happen("AddRelation", target, args.newTarget, { amount: -3 });
                logMessage(`{{residents:${target.id}}} redirect their {{c:anger|suspicion|hatred}} from {{regname:town|${args.currentEnemy.id}}} to {{regname:town|${args.newTarget.id}}}.`);
            } else {
                // Caught manipulating - all three towns lose faith
                happen("Influence", subject, target, { faith: -2 });
                happen("Influence", subject, args.currentEnemy, { faith: -1 });
                happen("Influence", subject, args.newTarget, { faith: -1 });
                logMessage(`Your {{c:manipulations|schemes|blame-shifting}} are exposed! {{regname:town|${target.id}}}, {{regname:town|${args.currentEnemy.id}}}, and {{regname:town|${args.newTarget.id}}} all {{c:question your motives|lose trust in you|see your true nature}}.`, "warning");
            }
        },
        messageDone: (subject, target, args) => {
            if (args.success) {
                return `Blame shifted from {{regname:town|${args.currentEnemy.id}}} to {{regname:town|${args.newTarget.id}}}.`;
            }
            return null;
        },
        messageNo: () => `You let old grudges lie where they fall.`
    });

    // =========================================================================
    // ALLIANCE SYSTEM
    // Towns can form formal alliances that persist and affect diplomacy/war
    // =========================================================================

    // Alliance data stored on planet object
    function initAlliances() {
        if (!planet.alliances) {
            planet.alliances = []; // Array of { id, name, members: [townId, ...], formed: day }
            planet.nextAllianceId = 1;
        }
    }

    // Get alliance a town belongs to (if any)
    function getTownAlliance(town) {
        initAlliances();
        return planet.alliances.find(a => a.members.includes(town.id));
    }

    // Check if two towns are allied
    function areAllied(town1, town2) {
        const alliance = getTownAlliance(town1);
        return alliance && alliance.members.includes(town2.id);
    }

    // Create a new alliance between two towns
    function formAlliance(town1, town2, name) {
        initAlliances();
        // Check neither is already in an alliance
        if (getTownAlliance(town1) || getTownAlliance(town2)) return null;

        const alliance = {
            id: planet.nextAllianceId++,
            name: name || generateAllianceName(town1, town2),
            members: [town1.id, town2.id],
            formed: planet.day
        };
        planet.alliances.push(alliance);
        return alliance;
    }

    // Join an existing alliance
    function joinAlliance(town, alliance) {
        if (getTownAlliance(town)) return false;
        if (!alliance || !alliance.members) return false;
        alliance.members.push(town.id);
        return true;
    }

    // Leave an alliance
    function leaveAlliance(town) {
        initAlliances();
        const alliance = getTownAlliance(town);
        if (!alliance) return false;

        alliance.members = alliance.members.filter(id => id !== town.id);

        // Dissolve if less than 2 members
        if (alliance.members.length < 2) {
            planet.alliances = planet.alliances.filter(a => a.id !== alliance.id);
            return { dissolved: true, alliance };
        }
        return { dissolved: false, alliance };
    }

    const ALLIANCE_MARKER_DEF = {
        name: "Alliance Hall",
        subtype: "allianceHall",
        symbol: "A",
        color: [120, 200, 255]
    };

    function getAllianceLeader(alliance) {
        if (!alliance || !Array.isArray(alliance.members)) return null;
        return alliance.members
            .map(id => regGet("town", id))
            .filter(t => t && !t.end)
            .sort((a, b) => (b.pop || 0) - (a.pop || 0))[0] || null;
    }

    function ensureAllianceMarker(alliance) {
        if (!alliance) return false;
        let marker = alliance.markerId ? regGet("marker", alliance.markerId) : null;
        const leader = getAllianceLeader(alliance);
        if (!leader) return false;
        const center = getTownCenter(leader);
        if (!center) return false;

        if (!marker) {
            marker = happen("Create", null, null, {
                type: "landmark",
                name: ALLIANCE_MARKER_DEF.name,
                subtype: ALLIANCE_MARKER_DEF.subtype,
                symbol: ALLIANCE_MARKER_DEF.symbol,
                color: ALLIANCE_MARKER_DEF.color,
                x: center[0],
                y: center[1]
            }, "marker");
            if (!marker) return false;
            marker._paultendoAllianceId = alliance.id;
            alliance.markerId = marker.id;
            attachMarkerToChunk(marker, chunkAt(center[0], center[1]));
            return true;
        }

        if (marker.x !== center[0] || marker.y !== center[1]) {
            detachMarkerFromChunk(marker);
            marker.x = center[0];
            marker.y = center[1];
            attachMarkerToChunk(marker, chunkAt(center[0], center[1]));
        }
        return true;
    }

    function removeAllianceMarker(alliance) {
        if (!alliance || !alliance.markerId) return false;
        const removed = removeMarkerById(alliance.markerId);
        delete alliance.markerId;
        return removed;
    }

    function syncAllianceMarkers() {
        initAlliances();
        if (!planet.alliances) return;
        planet.alliances.forEach(alliance => {
            ensureAllianceMarker(alliance);
        });
        const allianceMarkers = regFilter("marker", m => m.subtype === "allianceHall" && m._paultendoAllianceId);
        allianceMarkers.forEach(marker => {
            const alliance = planet.alliances.find(a => a.id === marker._paultendoAllianceId);
            if (!alliance) removeMarkerById(marker.id);
        });
    }

    // Generate alliance name from founding towns
    function generateAllianceName(town1, town2) {
        const prefixes = ["The", "Grand", "United", "Holy", "Free", "Noble"];
        const types = ["Alliance", "Pact", "League", "Accord", "Coalition", "Confederation", "Union"];
        const prefix = choose(prefixes);
        const type = choose(types);

        // Sometimes use town names, sometimes generic
        if (Math.random() < 0.4) {
            const t1Short = town1.name.split(" ")[0];
            const t2Short = town2.name.split(" ")[0];
            return `${prefix} ${t1Short}-${t2Short} ${type}`;
        }
        return `${prefix} ${type}`;
    }

    // -------------------------------------------------------------------------
    // ALLIANCE FORMATION: Towns with good relations may form alliances
    // -------------------------------------------------------------------------

    modEvent("allianceForm", {
        random: true,
        weight: $c.UNCOMMON,
        subject: {
            reg: "town", random: true
        },
        target: {
            reg: "town", nearby: true
        },
        value: (subject, target, args) => {
            initAlliances();
            const relation = subject.relations[target.id] || 0;
            args.relation = relation;
            return true;
        },
        check: (subject, target, args) => {
            // Need good relations
            const relation = subject.relations[target.id] || 0;
            if (relation < 4) return false;
            // Neither can be in an alliance already
            if (getTownAlliance(subject) || getTownAlliance(target)) return false;
            // Need military unlocked
            if (!planet.unlocks.military) return false;
            // Not during war
            if (hasIssue(subject, "war") || hasIssue(target, "war")) return false;
            return true;
        },
        func: (subject, target, args) => {
            const alliance = formAlliance(subject, target);
            if (!alliance) return;
            args.alliance = alliance;

            // Boost relations further
            happen("AddRelation", subject, target, { amount: 2 });

            logMessage(`{{regname:town|${subject.id}}} and {{regname:town|${target.id}}} form {{b:${alliance.name}}}!`, "milestone");
        },
        message: (subject, target, args) => {
            return `{{regname:town|${subject.id}}} proposes a formal alliance with {{regname:town|${target.id}}}.`;
        }
    });

    // -------------------------------------------------------------------------
    // ALLIANCE INVITATION: Existing alliance invites a third town
    // -------------------------------------------------------------------------

    modEvent("allianceInvite", {
        random: true,
        weight: $c.VERY_RARE,
        subject: {
            reg: "town", random: true
        },
        target: {
            reg: "town", nearby: true
        },
        value: (subject, target, args) => {
            initAlliances();
            args.alliance = getTownAlliance(subject);
            return true;
        },
        check: (subject, target, args) => {
            const alliance = getTownAlliance(subject);
            if (!alliance) return false;
            const allianceSize = alliance.members.length;
            // Expanding beyond small alliances should be exceptionally rare
            if (allianceSize >= 4 && Math.random() > 0.05) return false;
            if (allianceSize >= 3 && Math.random() > 0.2) return false;
            // Target must not be in an alliance
            if (getTownAlliance(target)) return false;
            // Need good relations with the inviting town
            const relation = subject.relations[target.id] || 0;
            const minRelation = allianceSize >= 3 ? 5 : 3;
            if (relation < minRelation) return false;
            // Check relations with all alliance members are positive
            for (const memberId of alliance.members) {
                if (memberId === subject.id) continue;
                const member = regGet("town", memberId);
                if (!member || member.end) continue;
                const memberRelation = target.relations[memberId] || 0;
                const minMemberRelation = allianceSize >= 3 ? 3 : 0;
                if (memberRelation < minMemberRelation) return false;
            }
            return true;
        },
        func: (subject, target, args) => {
            const alliance = args.alliance;
            if (!joinAlliance(target, alliance)) return;

            // Boost relations with all members
            for (const memberId of alliance.members) {
                if (memberId === target.id) continue;
                const member = regGet("town", memberId);
                if (member && !member.end) {
                    happen("AddRelation", target, member, { amount: 1 });
                }
            }

            logMessage(`{{regname:town|${target.id}}} joins {{b:${alliance.name}}}!`);
        },
        message: (subject, target, args) => {
            return `{{b:${args.alliance.name}}} invites {{regname:town|${target.id}}} to join their alliance.`;
        }
    });

    // -------------------------------------------------------------------------
    // ALLIANCE DISSOLUTION: Town leaves or alliance breaks apart
    // -------------------------------------------------------------------------

    modEvent("allianceLeave", {
        random: true,
        weight: $c.VERY_RARE,
        subject: {
            reg: "town", random: true
        },
        value: (subject, target, args) => {
            initAlliances();
            args.alliance = getTownAlliance(subject);
            if (!args.alliance) return false;
            // Find a member they have poor relations with
            for (const memberId of args.alliance.members) {
                if (memberId === subject.id) continue;
                const relation = subject.relations[memberId] || 0;
                if (relation < -2) {
                    args.reason = regGet("town", memberId);
                    return true;
                }
            }
            // Or just random chance if alliance is old
            if (planet.day - args.alliance.formed > 100) {
                return Math.random() < 0.3;
            }
            return false;
        },
        check: (subject, target, args) => {
            return getTownAlliance(subject) !== null;
        },
        func: (subject, target, args) => {
            const result = leaveAlliance(subject);
            if (!result) return;

            if (result.dissolved) {
                logMessage(`{{b:${args.alliance.name}}} has {{c:collapsed|dissolved|fallen apart}}!`, "warning");
            } else {
                if (args.reason) {
                    logMessage(`{{regname:town|${subject.id}}} {{c:leaves|withdraws from|abandons}} {{b:${args.alliance.name}}} due to tensions with {{regname:town|${args.reason.id}}}.`);
                } else {
                    logMessage(`{{regname:town|${subject.id}}} {{c:leaves|withdraws from|abandons}} {{b:${args.alliance.name}}}.`);
                }
            }
        },
        message: (subject, target, args) => {
            return `Tensions within {{b:${args.alliance.name}}} threaten its stability.`;
        }
    });

    // -------------------------------------------------------------------------
    // ALLIANCE DEFENSE: Allied towns join wars to defend each other
    // -------------------------------------------------------------------------

    modEvent("allianceDefend", {
        daily: true,
        subject: {
            reg: "town", all: true
        },
        check: (subject, target, args) => {
            // Subject must be in a war
            if (!hasIssue(subject, "war")) return false;
            // Must have an alliance
            const alliance = getTownAlliance(subject);
            if (!alliance) return false;
            return true;
        },
        func: (subject, target, args) => {
            const alliance = getTownAlliance(subject);
            if (!alliance) return;

            // Get the war process
            const warProcess = regGet("process", subject.issues.war);
            if (!warProcess || !warProcess.towns) return;
            ensureWarSides(warProcess);
            const subjectSide = getWarSideIndex(warProcess, subject.id);
            if (subjectSide === null || subjectSide === undefined) return;
            const enemySide = getOpposingSideIndex(warProcess, subjectSide);
            const enemies = getWarSideTowns(warProcess, enemySide);
            if (!enemies.length) return;
            const enemy = choose(enemies);
            const enemyId = enemy.id;

            // Check each ally
            for (const memberId of alliance.members) {
                if (memberId === subject.id) continue;
                const ally = regGet("town", memberId);
                if (!ally || ally.end || hasIssue(ally, "war")) continue;

                // Chance to join the war
                const relation = ally.relations[subject.id] || 0;
                const enemyRelation = ally.relations[enemyId] || 0;
                let joinChance = 0.15;
                joinChance += relation * 0.03;
                joinChance -= enemyRelation * 0.02;
                joinChance += (ally.influences.military || 0) * 0.02;
                // Larger alliances are less likely to cascade into full blocs
                joinChance -= Math.max(0, alliance.members.length - 2) * 0.03;
                joinChance = Math.max(0.02, Math.min(0.6, joinChance));

                if (Math.random() < joinChance) {
                    // Join the war on subject's side
                    ensureIssues(ally);
                    ally.issues.war = warProcess.id;
                    addTownToWarSide(warProcess, ally.id, subjectSide);
                    // Worsen relations with enemy
                    happen("AddRelation", ally, enemy, { amount: -3 });

                    logMessage(`{{regname:town|${ally.id}}} {{c:honors their alliance|comes to the defense of|joins the fight alongside}} {{regname:town|${subject.id}}} against {{regname:town|${enemyId}}}!`, "warning");
                }
            }
        }
    });

    // -------------------------------------------------------------------------
    // ALLIANCE RELATIONS BOOST: Being in an alliance gradually improves relations
    // -------------------------------------------------------------------------

    modEvent("allianceRelationsBoost", {
        daily: true,
        subject: {
            reg: "town", all: true
        },
        check: (subject, target, args) => {
            return getTownAlliance(subject) !== null;
        },
        func: (subject, target, args) => {
            const alliance = getTownAlliance(subject);
            if (!alliance) return;

            // Small chance each day to boost relations with a random ally
            const boostChance = alliance.members.length <= 2 ? 0.1 : 0.05;
            if (Math.random() > boostChance) return;

            const allyIds = alliance.members.filter(id => id !== subject.id);
            if (!allyIds.length) return;

            const allyId = choose(allyIds);
            const ally = regGet("town", allyId);
            if (!ally || ally.end) return;

            // Small boost (reduced for larger alliances)
            const boostAmount = alliance.members.length <= 2 ? 0.5 : 0.3;
            happen("AddRelation", subject, ally, { amount: boostAmount });
        }
    });

    // -------------------------------------------------------------------------
    // PLAYER SWAY: Suggest alliance formation
    // -------------------------------------------------------------------------

    modEvent("swayFormAlliance", {
        random: true,
        weight: $c.RARE,
        subject: {
            reg: "player", id: 1
        },
        target: {
            reg: "town", random: true
        },
        value: (subject, target, args) => {
            initAlliances();
            // Find another town with good relations
            const candidates = regFilter("town", (t) => {
                if (t.id === target.id || t.end || t.pop <= 0) return false;
                if (getTownAlliance(t)) return false;
                const relation = target.relations[t.id] || 0;
                return relation >= 2;
            });
            if (!candidates.length) return false;
            args.otherTown = choose(candidates);
            args.successChance = calcSwaySuccess(target, args.otherTown);
            // Easier when relations are better
            const relation = target.relations[args.otherTown.id] || 0;
            args.successChance += relation * 0.05;
            args.successChance = clampChance(args.successChance, 0.10, 0.90);
            return true;
        },
        check: (subject, target, args) => {
            if (!planet.unlocks.military) return false;
            if (getTownAlliance(target)) return false;
            if ((target.influences.faith || 0) < -5) return false;
            return true;
        },
        message: (subject, target, args) => {
            return `{{regname:town|${target.id}}} considers its future. You could suggest a {{c:formal alliance|defensive pact|lasting bond}} with {{regname:town|${args.otherTown.id}}}...`;
        },
        func: (subject, target, args) => {
            const success = Math.random() < args.successChance;
            args.success = success;

            if (success) {
                const alliance = formAlliance(target, args.otherTown);
                if (alliance) {
                    args.alliance = alliance;
                    happen("AddRelation", target, args.otherTown, { amount: 2 });
                    happen("Influence", subject, target, { faith: 1 });
                    happen("Influence", subject, args.otherTown, { faith: 1 });
                    logMessage(`Through your {{c:guidance|wisdom|counsel}}, {{regname:town|${target.id}}} and {{regname:town|${args.otherTown.id}}} form {{b:${alliance.name}}}!`, "milestone");
                }
            } else {
                happen("Influence", subject, target, { faith: -1 });
                logMessage(`{{residents:${target.id}}} {{c:prefer independence|aren't ready for formal ties|decline the suggestion}}.`);
            }
        },
        messageDone: (subject, target, args) => {
            if (args.success && args.alliance) {
                return `{{b:${args.alliance.name}}} is born.`;
            }
            return null;
        },
        messageNo: () => `You let diplomacy take its natural course.`
    });

    // -------------------------------------------------------------------------
    // PLAYER SWAY: Break an alliance apart
    // -------------------------------------------------------------------------

    modEvent("swayBreakAlliance", {
        random: true,
        weight: $c.VERY_RARE,
        subject: {
            reg: "player", id: 1
        },
        target: {
            reg: "town", random: true
        },
        value: (subject, target, args) => {
            initAlliances();
            args.alliance = getTownAlliance(target);
            if (!args.alliance) return false;
            // Find another member to target
            const otherMembers = args.alliance.members.filter(id => id !== target.id);
            if (!otherMembers.length) return false;
            args.otherMember = regGet("town", choose(otherMembers));
            if (!args.otherMember || args.otherMember.end) return false;
            args.successChance = calcSwaySuccess(target, args.otherMember);
            // Harder to break alliances
            args.successChance -= 0.15;
            args.successChance = clampChance(args.successChance, 0.05, 0.70);
            return true;
        },
        check: (subject, target, args) => {
            if (!getTownAlliance(target)) return false;
            if ((target.influences.faith || 0) < -3) return false;
            return true;
        },
        message: (subject, target, args) => {
            return `{{regname:town|${target.id}}} is part of {{b:${args.alliance.name}}}. You could {{c:sow doubt|whisper concerns|suggest mistrust}} about {{regname:town|${args.otherMember.id}}}...`;
        },
        func: (subject, target, args) => {
            const success = Math.random() < args.successChance;
            args.success = success;

            if (success) {
                // Damage relations within the alliance
                happen("AddRelation", target, args.otherMember, { amount: -4 });

                // Check if this causes them to leave
                const relation = target.relations[args.otherMember.id] || 0;
                if (relation < -2) {
                    const result = leaveAlliance(target);
                    if (result && result.dissolved) {
                        logMessage(`Your {{c:words|whispers|schemes}} bear fruit. {{b:${args.alliance.name}}} {{c:collapses|falls apart|dissolves}}!`, "warning");
                    } else {
                        logMessage(`{{regname:town|${target.id}}} {{c:abandons|leaves|withdraws from}} {{b:${args.alliance.name}}} in {{c:disgust|anger|frustration}}.`);
                    }
                } else {
                    logMessage(`Cracks form in {{b:${args.alliance.name}}} as {{regname:town|${target.id}}} grows {{c:suspicious|wary|distrustful}} of {{regname:town|${args.otherMember.id}}}.`);
                }
            } else {
                // Backfire - they see through you
                happen("Influence", subject, target, { faith: -2 });
                happen("Influence", subject, args.otherMember, { faith: -1 });
                happen("AddRelation", target, args.otherMember, { amount: 1 });
                logMessage(`Your attempts to {{c:divide|undermine|fracture}} {{b:${args.alliance.name}}} are {{c:exposed|discovered|revealed}}!`, "warning");
            }
        },
        messageDone: (subject, target, args) => {
            if (args.success) {
                return `Discord spreads within {{b:${args.alliance.name}}}.`;
            }
            return null;
        },
        messageNo: () => `You leave the alliance intact.`
    });

    // =========================================================================
    // ECONOMIC SYSTEM - Loans, Embargoes, Aid, Currency Spread
    // =========================================================================

    // Initialize economic data structures
    function initEconomics() {
        if (!planet.loans) planet.loans = [];
        if (!planet.embargoes) planet.embargoes = [];
    }

    // Loan system - simple flat repayment, no compounding interest
    function createLoan(lender, borrower, amount, repaymentAmount, turnsToRepay) {
        initEconomics();
        const loan = {
            id: Date.now(),
            lenderId: lender.id,
            borrowerId: borrower.id,
            originalAmount: amount,
            repaymentAmount: repaymentAmount, // Total to repay (slightly more than borrowed)
            remainingAmount: repaymentAmount,
            remainingPayments: turnsToRepay,
            paymentPerTurn: Math.ceil(repaymentAmount / turnsToRepay)
        };
        planet.loans.push(loan);
        return loan;
    }

    function getLoansFor(town) {
        initEconomics();
        return planet.loans.filter(l => l.borrowerId === town.id);
    }

    function getLoansFrom(town) {
        initEconomics();
        return planet.loans.filter(l => l.lenderId === town.id);
    }

    function processLoanPayment(loan) {
        const borrower = regGet("town", loan.borrowerId);
        const lender = regGet("town", loan.lenderId);
        if (!borrower || !lender) {
            // Town no longer exists, cancel loan
            planet.loans = planet.loans.filter(l => l.id !== loan.id);
            return null;
        }

        if (loan.remainingAmount === undefined) {
            loan.remainingAmount = loan.repaymentAmount || 0;
        }

        const borrowerCash = borrower.resources?.cash || 0;
        const payment = Math.min(loan.paymentPerTurn, borrowerCash, loan.remainingAmount);

        if (payment > 0) {
            happen("Resource", null, borrower, { cash: -payment });
            happen("Resource", null, lender, { cash: payment });
            loan.remainingAmount -= payment;
            loan.remainingPayments = Math.max(
                0,
                Math.ceil(loan.remainingAmount / Math.max(1, loan.paymentPerTurn))
            );

            if (loan.remainingAmount <= 0) {
                // Loan fully repaid
                planet.loans = planet.loans.filter(l => l.id !== loan.id);
                happen("AddRelation", borrower, lender, { amount: 2 });
                return "repaid";
            }
            return "payment";
        } else {
            // Can't pay - damage relations
            happen("AddRelation", borrower, lender, { amount: -1 });
            return "default";
        }
    }

    // Embargo system
    function hasEmbargo(town1, town2) {
        initEconomics();
        return planet.embargoes.some(e =>
            (e.fromId === town1.id && e.toId === town2.id) ||
            (e.fromId === town2.id && e.toId === town1.id)
        );
    }

    function createEmbargo(fromTown, toTown) {
        initEconomics();
        if (hasEmbargo(fromTown, toTown)) return false;
        planet.embargoes.push({
            id: Date.now(),
            fromId: fromTown.id,
            toId: toTown.id,
            createdAt: planet.year || 0
        });
        return true;
    }

    function liftEmbargo(fromTown, toTown) {
        initEconomics();
        planet.embargoes = planet.embargoes.filter(e =>
            !(e.fromId === fromTown.id && e.toId === toTown.id)
        );
    }

    // Currency adoption
    function adoptCurrency(town, sourceTown) {
        if (sourceTown.currency) {
            town.currency = sourceTown.currency;
            if (sourceTown.currencySign) town.currencySign = sourceTown.currencySign;
            return true;
        }
        return false;
    }

    // -------------------------------------------------------------------------
    // Economic Events - Autonomous town behavior
    // -------------------------------------------------------------------------

    // Towns request loans from wealthier towns
    modEvent("townRequestLoan", {
        random: true,
        weight: $c.UNCOMMON,
        target: {
            reg: "town", random: true
        },
        value: (subject, target, args) => {
            const towns = regFilter("town", t => t.id !== target.id && (t.resources?.cash || 0) > 100);
            if (towns.length === 0) return false;
            const lender = choose(towns);
            const targetCash = target.resources?.cash || 0;
            const lenderCash = lender.resources?.cash || 0;

            // Only borrow if struggling and lender has means
            if (targetCash > 30) return false;
            if (lenderCash < 80) return false;

            const relation = target.relations[lender.id] || 0;
            if (relation < -2) return false; // Won't lend to enemies

            args.lender = lender;
            args.amount = Math.min(50, Math.floor(lenderCash * 0.3));
            args.repayment = Math.floor(args.amount * 1.2); // 20% fee, not interest
            args.turns = 10;
            return true;
        },
        message: (subject, target, args) => {
            return `{{regname:town|${target.id}}} seeks a loan of {{b:${args.amount}}} {{currency:${target.id}}} from {{regname:town|${args.lender.id}}}. They would repay {{b:${args.repayment}}} over time.`;
        },
        func: (subject, target, args) => {
            const relation = target.relations[args.lender.id] || 0;
            const approved = relation >= 0 || Math.random() < 0.3;
            args.approved = approved;

            if (approved) {
                happen("Resource", null, args.lender, { cash: -args.amount });
                happen("Resource", null, target, { cash: args.amount });
                createLoan(args.lender, target, args.amount, args.repayment, args.turns);
                happen("AddRelation", target, args.lender, { amount: 1 });
            }
        },
        messageDone: (subject, target, args) => {
            if (args.approved) {
                return `{{regname:town|${args.lender.id}}} {{c:agrees|grants|approves}} the loan. {{regname:town|${target.id}}} receives {{b:${args.amount}}} {{currency:${target.id}}}.`;
            }
            return `{{regname:town|${args.lender.id}}} {{c:declines|refuses|denies}} the loan request.`;
        }
    });

    // Process loan repayments daily
    modEvent("townLoanRepayment", {
        daily: true,
        weight: $c.ALWAYS,
        target: {
            reg: "town", all: true
        },
        value: (subject, target, args) => {
            initEconomics();
            const loans = getLoansFor(target);
            if (loans.length === 0) return false;
            args.loan = loans[0]; // Process one loan at a time
            return true;
        },
        func: (subject, target, args) => {
            args.result = processLoanPayment(args.loan);
        },
        messageDone: (subject, target, args) => {
            if (args.result === "repaid") {
                const lender = regGet("town", args.loan.lenderId);
                if (lender) {
                    return `{{regname:town|${target.id}}} {{c:repays|settles|completes}} their debt to {{regname:town|${lender.id}}}. Relations {{c:warm|improve|strengthen}}.`;
                }
            } else if (args.result === "default") {
                const lender = regGet("town", args.loan.lenderId);
                if (lender) {
                    return `{{regname:town|${target.id}}} {{c:cannot pay|defaults on|misses payment to}} {{regname:town|${lender.id}}}. Trust {{c:erodes|falters|wanes}}.`;
                }
            }
            return null; // Regular payments are silent
        }
    });

    // Towns declare embargoes on enemies
    modEvent("townDeclareEmbargo", {
        random: true,
        weight: $c.RARE,
        target: {
            reg: "town", random: true
        },
        value: (subject, target, args) => {
            const enemies = regFilter("town", t => {
                if (t.id === target.id) return false;
                const relation = target.relations[t.id] || 0;
                return relation < -3 && !hasEmbargo(target, t);
            });
            if (enemies.length === 0) return false;
            args.enemy = choose(enemies);
            return true;
        },
        message: (subject, target, args) => {
            return `{{regname:town|${target.id}}} is {{c:furious with|outraged by|seething at}} {{regname:town|${args.enemy.id}}}. They consider an {{b:economic embargo}}.`;
        },
        func: (subject, target, args) => {
            createEmbargo(target, args.enemy);
            happen("AddRelation", target, args.enemy, { amount: -2 });

            // Reduce trade influence for both
            happen("Influence", subject, target, { trade: -1 });
            happen("Influence", subject, args.enemy, { trade: -1 });
        },
        messageDone: (subject, target, args) => {
            return `{{regname:town|${target.id}}} {{c:declares|imposes|enacts}} an embargo on {{regname:town|${args.enemy.id}}}. Trade {{c:halts|ceases|stops}} between them.`;
        }
    });

    // Embargoes can be lifted when relations improve
    modEvent("townLiftEmbargo", {
        random: true,
        weight: $c.UNCOMMON,
        target: {
            reg: "town", random: true
        },
        value: (subject, target, args) => {
            initEconomics();
            const embargoedTowns = planet.embargoes
                .filter(e => e.fromId === target.id)
                .map(e => regGet("town", e.toId))
                .filter(Boolean);

            const reconcilable = embargoedTowns.filter(t => {
                const relation = target.relations[t.id] || 0;
                return relation >= 0;
            });

            if (reconcilable.length === 0) return false;
            args.other = choose(reconcilable);
            return true;
        },
        message: (subject, target, args) => {
            return `Relations have {{c:thawed|improved|warmed}} between {{regname:town|${target.id}}} and {{regname:town|${args.other.id}}}. The embargo {{c:seems|feels|appears}} {{c:outdated|unnecessary|pointless}}...`;
        },
        func: (subject, target, args) => {
            liftEmbargo(target, args.other);
            happen("Influence", subject, target, { trade: 1 });
            happen("Influence", subject, args.other, { trade: 1 });
        },
        messageDone: (subject, target, args) => {
            return `{{regname:town|${target.id}}} {{c:lifts|ends|removes}} the embargo on {{regname:town|${args.other.id}}}. Trade {{c:resumes|flows again|reopens}}.`;
        }
    });

    // Towns send economic aid to struggling allies
    modEvent("townEconomicAid", {
        random: true,
        weight: $c.UNCOMMON,
        target: {
            reg: "town", random: true
        },
        value: (subject, target, args) => {
            const targetCash = target.resources?.cash || 0;
            if (targetCash < 80) return false; // Need to be wealthy to give aid

            const needyAllies = regFilter("town", t => {
                if (t.id === target.id) return false;
                const relation = target.relations[t.id] || 0;
                const theirCash = t.resources?.cash || 0;
                return relation >= 2 && theirCash < 20;
            });

            if (needyAllies.length === 0) return false;
            args.recipient = choose(needyAllies);
            args.amount = Math.min(30, Math.floor(targetCash * 0.2));
            return true;
        },
        message: (subject, target, args) => {
            return `{{regname:town|${target.id}}} sees {{regname:town|${args.recipient.id}}} {{c:struggling|suffering|in hardship}}. They could send {{b:${args.amount}}} {{currency:${target.id}}} in aid.`;
        },
        func: (subject, target, args) => {
            happen("Resource", null, target, { cash: -args.amount });
            happen("Resource", null, args.recipient, { cash: args.amount });
            happen("AddRelation", args.recipient, target, { amount: 3 });
        },
        messageDone: (subject, target, args) => {
            return `{{regname:town|${target.id}}} sends aid to {{regname:town|${args.recipient.id}}}. The {{residents:${args.recipient.id}}} are {{c:grateful|thankful|moved}}.`;
        }
    });

    // Currency adoption through strong trade ties
    modEvent("townAdoptCurrency", {
        random: true,
        weight: $c.VERY_RARE,
        target: {
            reg: "town", random: true
        },
        value: (subject, target, args) => {
            // Only towns without a dominant trade partner's currency
            const partners = regFilter("town", t => {
                if (t.id === target.id) return false;
                const relation = target.relations[t.id] || 0;
                const theirTrade = t.influences?.trade || 0;
                return relation >= 3 && theirTrade >= 5 && t.currency;
            });

            if (partners.length === 0) return false;

            // Pick the strongest trading partner
            partners.sort((a, b) => (b.influences?.trade || 0) - (a.influences?.trade || 0));
            args.source = partners[0];
            return true;
        },
        message: (subject, target, args) => {
            const currencyName = args.source.currency || "currency";
            return `{{regname:town|${target.id}}} considers adopting the {{b:${currencyName}}} of {{regname:town|${args.source.id}}} for easier trade.`;
        },
        func: (subject, target, args) => {
            adoptCurrency(target, args.source);
            happen("AddRelation", target, args.source, { amount: 2 });
            happen("Influence", subject, target, { trade: 2 });
        },
        messageDone: (subject, target, args) => {
            const currencyName = target.currency || "currency";
            return `{{regname:town|${target.id}}} now uses the {{b:${currencyName}}}. Economic {{c:ties|bonds|links}} with {{regname:town|${args.source.id}}} {{c:deepen|strengthen|grow}}.`;
        }
    });

    // -------------------------------------------------------------------------
    // Player Sway - Economic Manipulation
    // -------------------------------------------------------------------------

    // Suggest a town request a loan
    modEvent("swayRequestLoan", {
        random: true,
        weight: $c.UNCOMMON,
        subject: {
            reg: "player", id: 1
        },
        target: {
            reg: "town", random: true
        },
        value: (subject, target, args) => {
            if ((target.influences.faith || 0) < -2) return false;

            const wealthyTowns = regFilter("town", t =>
                t.id !== target.id && (t.resources?.cash || 0) > 100
            );
            if (wealthyTowns.length === 0) return false;

            args.lender = choose(wealthyTowns);
            args.amount = Math.min(50, Math.floor((args.lender.resources?.cash || 0) * 0.3));
            args.repayment = Math.floor(args.amount * 1.2);
            args.successChance = calcSwaySuccess(target, args.lender);
            return true;
        },
        message: (subject, target, args) => {
            return `{{regname:town|${target.id}}} could use more funds. You could {{c:suggest|encourage|recommend}} they seek a loan from {{regname:town|${args.lender.id}}}...`;
        },
        func: (subject, target, args) => {
            const success = Math.random() < args.successChance;
            args.success = success;

            if (success) {
                const relation = target.relations[args.lender.id] || 0;
                const approved = relation >= -1 || Math.random() < 0.4;
                args.approved = approved;

                if (approved) {
                    happen("Resource", null, args.lender, { cash: -args.amount });
                    happen("Resource", null, target, { cash: args.amount });
                    createLoan(args.lender, target, args.amount, args.repayment, 10);
                    happen("AddRelation", target, args.lender, { amount: 1 });
                }
            } else {
                happen("Influence", subject, target, { faith: -1 });
            }
        },
        messageDone: (subject, target, args) => {
            if (!args.success) {
                return `{{regname:town|${target.id}}} {{c:ignores|dismisses|disregards}} your financial advice.`;
            }
            if (args.approved) {
                return `{{regname:town|${args.lender.id}}} grants the loan. {{regname:town|${target.id}}} has new funds to work with.`;
            }
            return `{{regname:town|${target.id}}} asks, but {{regname:town|${args.lender.id}}} {{c:refuses|declines|denies}} the loan.`;
        },
        messageNo: () => `You let them manage their own finances.`
    });

    // Encourage embargo
    modEvent("swayEmbargo", {
        random: true,
        weight: $c.RARE,
        subject: {
            reg: "player", id: 1
        },
        target: {
            reg: "town", random: true
        },
        value: (subject, target, args) => {
            if ((target.influences.faith || 0) < -1) return false;

            const potentialTargets = regFilter("town", t => {
                if (t.id === target.id) return false;
                const relation = target.relations[t.id] || 0;
                return relation < 0 && !hasEmbargo(target, t);
            });
            if (potentialTargets.length === 0) return false;

            args.enemy = choose(potentialTargets);
            args.successChance = calcSwaySuccess(target, args.enemy);
            return true;
        },
        message: (subject, target, args) => {
            return `{{regname:town|${target.id}}} has {{c:tensions|friction|disputes}} with {{regname:town|${args.enemy.id}}}. You could {{c:fan the flames|stoke anger|push them}} toward an {{b:economic embargo}}...`;
        },
        func: (subject, target, args) => {
            const success = Math.random() < args.successChance;
            args.success = success;

            if (success) {
                createEmbargo(target, args.enemy);
                happen("AddRelation", target, args.enemy, { amount: -2 });
                happen("Influence", subject, target, { trade: -1 });
                happen("Influence", subject, args.enemy, { trade: -1 });
            } else {
                happen("Influence", subject, target, { faith: -2 });
                happen("AddRelation", target, args.enemy, { amount: 1 });
            }
        },
        messageDone: (subject, target, args) => {
            if (args.success) {
                return `{{regname:town|${target.id}}} {{c:declares|imposes|enacts}} an embargo on {{regname:town|${args.enemy.id}}}!`;
            }
            return `{{regname:town|${target.id}}} {{c:sees through|recognizes|notices}} your manipulation. They grow {{c:closer|friendlier|warmer}} to {{regname:town|${args.enemy.id}}} instead.`;
        },
        messageNo: () => `You leave trade relations be.`
    });

    // Encourage lifting an embargo
    modEvent("swayLiftEmbargo", {
        random: true,
        weight: $c.UNCOMMON,
        subject: {
            reg: "player", id: 1
        },
        target: {
            reg: "town", random: true
        },
        value: (subject, target, args) => {
            if ((target.influences.faith || 0) < -2) return false;
            initEconomics();

            const embargoedTowns = planet.embargoes
                .filter(e => e.fromId === target.id)
                .map(e => regGet("town", e.toId))
                .filter(Boolean);

            if (embargoedTowns.length === 0) return false;
            args.other = choose(embargoedTowns);
            args.successChance = calcSwaySuccess(target, args.other);
            return true;
        },
        message: (subject, target, args) => {
            return `{{regname:town|${target.id}}} maintains an embargo on {{regname:town|${args.other.id}}}. You could {{c:counsel peace|suggest reconciliation|advise forgiveness}}...`;
        },
        func: (subject, target, args) => {
            const success = Math.random() < args.successChance;
            args.success = success;

            if (success) {
                liftEmbargo(target, args.other);
                happen("Influence", subject, target, { trade: 1 });
                happen("Influence", subject, args.other, { trade: 1 });
                happen("AddRelation", target, args.other, { amount: 2 });
            } else {
                happen("Influence", subject, target, { faith: -1 });
            }
        },
        messageDone: (subject, target, args) => {
            if (args.success) {
                return `{{regname:town|${target.id}}} {{c:lifts|ends|removes}} the embargo. Trade with {{regname:town|${args.other.id}}} {{c:resumes|begins anew|flows once more}}.`;
            }
            return `{{regname:town|${target.id}}} {{c:refuses|declines|won't listen}}. The embargo {{c:continues|remains|persists}}.`;
        },
        messageNo: () => `You let the embargo continue.`
    });

    // Suggest sending economic aid
    modEvent("swayEconomicAid", {
        random: true,
        weight: $c.UNCOMMON,
        subject: {
            reg: "player", id: 1
        },
        target: {
            reg: "town", random: true
        },
        value: (subject, target, args) => {
            if ((target.influences.faith || 0) < -1) return false;

            const targetCash = target.resources?.cash || 0;
            if (targetCash < 50) return false;

            const needyTowns = regFilter("town", t => {
                if (t.id === target.id) return false;
                const theirCash = t.resources?.cash || 0;
                return theirCash < 15;
            });

            if (needyTowns.length === 0) return false;
            args.recipient = choose(needyTowns);
            args.amount = Math.min(25, Math.floor(targetCash * 0.2));
            args.successChance = calcSwaySuccess(target, args.recipient);
            return true;
        },
        message: (subject, target, args) => {
            return `{{regname:town|${args.recipient.id}}} is {{c:struggling|suffering|in need}}. You could {{c:encourage|suggest|persuade}} {{regname:town|${target.id}}} to send {{b:${args.amount}}} {{currency:${target.id}}} in aid...`;
        },
        func: (subject, target, args) => {
            const success = Math.random() < args.successChance;
            args.success = success;

            if (success) {
                happen("Resource", null, target, { cash: -args.amount });
                happen("Resource", null, args.recipient, { cash: args.amount });
                happen("AddRelation", args.recipient, target, { amount: 3 });
                happen("Influence", subject, args.recipient, { faith: 1 });
            } else {
                happen("Influence", subject, target, { faith: -1 });
            }
        },
        messageDone: (subject, target, args) => {
            if (args.success) {
                return `{{regname:town|${target.id}}} sends aid to {{regname:town|${args.recipient.id}}}. Your {{c:compassion|kindness|generosity}} is {{c:noted|appreciated|remembered}}.`;
            }
            return `{{regname:town|${target.id}}} {{c:keeps|holds onto|retains}} their wealth. Your plea falls on deaf ears.`;
        },
        messageNo: () => `You don't intervene in economic matters.`
    });

    // Suggest currency adoption
    modEvent("swayCurrencyAdoption", {
        random: true,
        weight: $c.VERY_RARE,
        subject: {
            reg: "player", id: 1
        },
        target: {
            reg: "town", random: true
        },
        value: (subject, target, args) => {
            if ((target.influences.faith || 0) < 0) return false;

            const currencyTowns = regFilter("town", t =>
                t.id !== target.id && t.currency && (t.influences?.trade || 0) >= 3
            );

            if (currencyTowns.length === 0) return false;
            args.source = choose(currencyTowns);
            args.successChance = calcSwaySuccess(target, args.source);
            return true;
        },
        message: (subject, target, args) => {
            const currencyName = args.source.currency || "currency";
            return `{{regname:town|${args.source.id}}} has a {{c:strong|stable|trusted}} {{b:${currencyName}}}. You could {{c:suggest|recommend|advise}} {{regname:town|${target.id}}} adopt it for trade...`;
        },
        func: (subject, target, args) => {
            const success = Math.random() < args.successChance;
            args.success = success;

            if (success) {
                adoptCurrency(target, args.source);
                happen("AddRelation", target, args.source, { amount: 2 });
                happen("Influence", subject, target, { trade: 2 });
            } else {
                happen("Influence", subject, target, { faith: -1 });
            }
        },
        messageDone: (subject, target, args) => {
            if (args.success) {
                const currencyName = target.currency || "currency";
                return `{{regname:town|${target.id}}} adopts the {{b:${currencyName}}}. Trade {{c:flourishes|grows|expands}}.`;
            }
            return `{{regname:town|${target.id}}} {{c:prefers|keeps|maintains}} their own currency.`;
        },
        messageNo: () => `You let them use their own currency.`
    });

    // =========================================================================
    // SPECIALIZATION SYSTEM
    // Towns develop specializations based on high influence levels
    // Creates emergent behaviors: trade targets, raid motivations, migration
    // =========================================================================

    // Specialization definitions - each tied to an influence type
    const SPECIALIZATIONS = {
        // Education specializations
        grandLibrary: {
            name: "Grand Library",
            influence: "education",
            threshold: 6,
            description: "a center of knowledge and learning",
            bonuses: { education: 2 },
            tradeValue: 3, // How attractive for trade
            raidValue: 4   // How attractive for raiding/conquest
        },
        academy: {
            name: "Academy",
            influence: "education",
            threshold: 8,
            description: "a renowned academy of scholars",
            bonuses: { education: 3 },
            tradeValue: 4,
            raidValue: 5
        },
        healers: {
            name: "Healers",
            influence: "education",
            threshold: 5,
            secondaryInfluence: "faith",
            secondaryThreshold: 2,
            description: "renowned healers and physicians",
            bonuses: { disease: -1, education: 1 },
            tradeValue: 2,
            raidValue: 3
        },
        // Trade specializations
        merchants: {
            name: "Merchant Class",
            influence: "trade",
            threshold: 4,
            description: "a thriving merchant class",
            bonuses: { trade: 1 },
            tradeValue: 2,
            raidValue: 2
        },
        merchantGuild: {
            name: "Merchant Guild",
            influence: "trade",
            threshold: 6,
            description: "a powerful guild of merchants",
            bonuses: { trade: 2 },
            tradeValue: 4,
            raidValue: 3
        },
        tradingHub: {
            name: "Trading Hub",
            influence: "trade",
            threshold: 8,
            description: "a hub of commerce and trade",
            bonuses: { trade: 3, happy: 1 },
            tradeValue: 5,
            raidValue: 4
        },
        // Military specializations
        warriorClan: {
            name: "Warrior Clan",
            influence: "military",
            threshold: 6,
            description: "a clan of renowned warriors",
            bonuses: { military: 2 },
            tradeValue: 1,
            raidValue: -2 // Negative = harder to raid
        },
        fortress: {
            name: "Fortress",
            influence: "military",
            threshold: 8,
            description: "an impenetrable fortress",
            bonuses: { military: 3 },
            tradeValue: 1,
            raidValue: -4
        },
        // Faith specializations
        holyOrder: {
            name: "Holy Order",
            influence: "faith",
            threshold: 6,
            description: "a seat of religious authority",
            bonuses: { faith: 2 },
            tradeValue: 2,
            raidValue: 2
        },
        sacredSite: {
            name: "Sacred Site",
            influence: "faith",
            threshold: 8,
            description: "a pilgrimage destination",
            bonuses: { faith: 3, happy: 1 },
            tradeValue: 3,
            raidValue: 3
        },
        // Happy/cultural specializations
        festivalCity: {
            name: "Festival City",
            influence: "happy",
            threshold: 6,
            description: "renowned for celebrations",
            bonuses: { happy: 2 },
            tradeValue: 3,
            raidValue: 2
        },
        culturalCapital: {
            name: "Cultural Capital",
            influence: "happy",
            threshold: 8,
            description: "a beacon of art and culture",
            bonuses: { happy: 3, education: 1 },
            tradeValue: 4,
            raidValue: 3
        },
        // Crafting/smith specializations
        masterSmiths: {
            name: "Master Smiths",
            influence: "trade", // Trade as proxy for crafting
            threshold: 5,
            secondaryInfluence: "military",
            secondaryThreshold: 3,
            description: "home to legendary smiths",
            bonuses: { trade: 1, military: 1 },
            tradeValue: 4,
            raidValue: 4
        }
    };

    const SPECIALIZATION_ALIASES = {
        holy_order: "holyOrder",
        trade_hub: "tradingHub",
        tradeHub: "tradingHub"
    };

    function normalizeSpecId(specId) {
        return SPECIALIZATION_ALIASES[specId] || specId;
    }

    // Specializations that imply a notable place get map markers
    const SPECIALIZATION_MARKERS = {
        grandLibrary: {
            name: "Grand Library",
            subtype: "grandLibrary",
            symbol: "L",
            color: [214, 180, 79]
        },
        academy: {
            name: "Academy",
            subtype: "academy",
            symbol: "A",
            color: [235, 218, 66]
        },
        merchantGuild: {
            name: "Merchant Guildhall",
            subtype: "merchantGuild",
            symbol: "G",
            color: [0, 145, 82]
        },
        tradingHub: {
            name: "Trading Hub",
            subtype: "tradingHub",
            symbol: "$",
            color: [0, 170, 100]
        },
        fortress: {
            name: "Fortress",
            subtype: "fortress",
            symbol: "F",
            color: [176, 148, 172]
        },
        sacredSite: {
            name: "Sacred Site",
            subtype: "sacredSite",
            symbol: "*",
            color: [204, 82, 192]
        },
        masterSmiths: {
            name: "Great Forge",
            subtype: "masterSmiths",
            symbol: "S",
            color: [176, 176, 176],
            condition: (town) => (planet.unlocks?.smith || 0) >= 30
        },
        holyOrder: {
            name: "Holy Order",
            subtype: "holyOrder",
            symbol: "O",
            color: [204, 82, 192],
            condition: (town) => getTownMarkersBySubtype(town, "temple").length > 0 ||
                ((town.influences?.faith || 0) >= 8 && (town.pop || 0) >= 80)
        },
        warriorClan: {
            name: "Warrior Hall",
            subtype: "warriorClan",
            symbol: "W",
            color: [176, 148, 172],
            condition: (town) => (
                ((planet.unlocks?.military || 0) >= 20 || (town.influences?.military || 0) >= 8) &&
                (town.pop || 0) >= 80 &&
                getTownMarkersBySubtype(town, "fortress").length === 0
            )
        },
        healers: {
            name: "Clinic",
            subtype: "clinic",
            symbol: "+",
            color: [200, 60, 60],
            condition: (town) => !hasHospital(town) &&
                (planet.unlocks?.education || 0) >= 40 &&
                (town.pop || 0) >= 80
        }
    };

    // Initialize specializations for a town
    function initTownSpecializations(town) {
        if (!town.specializations) {
            town.specializations = {}; // { specId: level }
        }
    }

    // Get all specializations a town has
    function getTownSpecializations(town) {
        initTownSpecializations(town);
        const specsById = {};
        for (const [id, level] of Object.entries(town.specializations)) {
            const normalizedId = normalizeSpecId(id);
            if (level > 0 && SPECIALIZATIONS[normalizedId]) {
                if (!specsById[normalizedId]) {
                    specsById[normalizedId] = { id: normalizedId, level, ...SPECIALIZATIONS[normalizedId] };
                } else {
                    specsById[normalizedId].level = Math.max(specsById[normalizedId].level, level);
                }
            }
        }
        return Object.values(specsById);
    }

    // Check if town has a specific specialization
    function hasSpecialization(town, specId) {
        initTownSpecializations(town);
        const normalizedId = normalizeSpecId(specId);
        if ((town.specializations[normalizedId] || 0) > 0) return true;
        if (normalizedId !== specId && (town.specializations[specId] || 0) > 0) return true;
        return false;
    }

    // Add or increase a specialization
    function addSpecialization(town, specId, amount = 1) {
        ensureTownState(town);
        const rawId = specId;
        specId = normalizeSpecId(specId);
        const spec = SPECIALIZATIONS[specId];
        if (!spec) return false;

        if (rawId !== specId && town.specializations[rawId]) {
            town.specializations[specId] = Math.max(town.specializations[specId] || 0, town.specializations[rawId]);
            delete town.specializations[rawId];
        }

        const oldLevel = town.specializations[specId] || 0;
        town.specializations[specId] = oldLevel + amount;

        // Apply bonuses when first gained
        if (oldLevel === 0 && amount > 0) {
            for (const [influence, bonus] of Object.entries(spec.bonuses)) {
                town.influences[influence] = (town.influences[influence] || 0) + bonus;
            }
            ensureSpecializationMarker(town, specId);
        }
        return true;
    }

    // Remove or decrease a specialization
    function removeSpecialization(town, specId, amount = 1) {
        ensureTownState(town);
        const rawId = specId;
        specId = normalizeSpecId(specId);
        const spec = SPECIALIZATIONS[specId];
        if (!spec) return false;

        if (rawId !== specId && town.specializations[rawId]) {
            town.specializations[specId] = Math.max(town.specializations[specId] || 0, town.specializations[rawId]);
            delete town.specializations[rawId];
        }

        const oldLevel = town.specializations[specId] || 0;
        town.specializations[specId] = Math.max(0, oldLevel - amount);

        // Remove bonuses when completely lost
        if (oldLevel > 0 && town.specializations[specId] === 0) {
            for (const [influence, bonus] of Object.entries(spec.bonuses)) {
                town.influences[influence] = (town.influences[influence] || 0) - bonus;
            }
        }
        return true;
    }

    function hasTownSpecialization(town, specId) {
        return hasSpecialization(town, specId);
    }

    function ensureSpecializationMarker(town, specId) {
        const normalizedId = normalizeSpecId(specId);
        const def = SPECIALIZATION_MARKERS[normalizedId];
        if (!def) return false;
        if (def.condition && !def.condition(town)) return false;
        if (getTownMarkersBySubtype(town, def.subtype).length > 0) return false;
        const spot = findTownMarkerSpot(town);
        const x = spot ? spot.x : town.x;
        const y = spot ? spot.y : town.y;
        if (typeof x !== "number" || typeof y !== "number") return false;
        const marker = happen("Create", null, null, {
            type: "landmark",
            name: def.name,
            subtype: def.subtype,
            symbol: def.symbol,
            color: def.color,
            x: x,
            y: y
        }, "marker");
        if (marker) {
            if (spot) attachMarkerToChunk(marker, spot);
            else attachMarkerToTownChunk(marker, town);
            return true;
        }
        return false;
    }

    function syncSpecializationMarkers(town) {
        const specs = getTownSpecializations(town);
        for (const spec of specs) {
            ensureSpecializationMarker(town, spec.id);
        }
    }

    // Check if a town qualifies to develop a specialization
    function canDevelopSpecialization(town, specId) {
        const spec = SPECIALIZATIONS[specId];
        if (!spec) return false;

        const primaryInfluence = town.influences[spec.influence] || 0;
        if (primaryInfluence < spec.threshold) return false;

        // Check secondary requirement if present
        if (spec.secondaryInfluence) {
            const secondaryInfluence = town.influences[spec.secondaryInfluence] || 0;
            if (secondaryInfluence < spec.secondaryThreshold) return false;
        }

        return true;
    }

    // Get specializations a town could potentially develop
    function getAvailableSpecializations(town) {
        initTownSpecializations(town);
        const available = [];
        for (const [id, spec] of Object.entries(SPECIALIZATIONS)) {
            if (!hasSpecialization(town, id) && canDevelopSpecialization(town, id)) {
                available.push({ id, ...spec });
            }
        }
        return available;
    }

    // Calculate how attractive a town is for trade based on specializations
    function getTradeAttractiveness(town) {
        const specs = getTownSpecializations(town);
        let value = 0;
        for (const spec of specs) {
            value += spec.tradeValue * spec.level;
        }
        return value;
    }

    // Calculate how attractive a town is for raiding based on specializations
    function getRaidAttractiveness(town) {
        const specs = getTownSpecializations(town);
        let value = 0;
        for (const spec of specs) {
            value += spec.raidValue * spec.level;
        }
        return value;
    }

    // -------------------------------------------------------------------------
    // Specialization Emergence - Towns develop specializations naturally
    // -------------------------------------------------------------------------

    modEvent("specializationEmerge", {
        daily: true,
        subject: {
            reg: "town", all: true
        },
        value: (subject, target, args) => {
            const available = getAvailableSpecializations(subject);
            if (available.length === 0) return false;

            // Small daily chance to develop a specialization
            if (Math.random() > 0.02) return false;

            args.spec = choose(available);
            return true;
        },
        func: (subject, target, args) => {
            addSpecialization(subject, args.spec.id);
            logMessage(`{{regname:town|${subject.id}}} has become known as {{b:${args.spec.name}}}, ${args.spec.description}.`, "milestone");
        }
    });

    // Specializations can fade if influence drops too low
    modEvent("specializationFade", {
        daily: true,
        subject: {
            reg: "town", all: true
        },
        value: (subject, target, args) => {
            const specs = getTownSpecializations(subject);
            if (specs.length === 0) return false;

            // Check each specialization
            for (const spec of specs) {
                const def = SPECIALIZATIONS[spec.id];
                const influence = subject.influences[def.influence] || 0;
                // Fade if influence drops significantly below threshold
                if (influence < def.threshold - 3) {
                    if (Math.random() < 0.05) {
                        args.fadingSpec = spec;
                        return true;
                    }
                }
            }
            return false;
        },
        func: (subject, target, args) => {
            removeSpecialization(subject, args.fadingSpec.id);
            logMessage(`{{regname:town|${subject.id}}} {{c:loses|forgets|abandons}} its reputation as {{b:${args.fadingSpec.name}}}.`, "warning");
        }
    });

    // Ensure specialization landmarks appear once conditions are met
    modEvent("specializationMarkerSync", {
        daily: true,
        subject: {
            reg: "town", all: true
        },
        func: (subject) => {
            syncSpecializationMarkers(subject);
        }
    });

    // -------------------------------------------------------------------------
    // Specialization Spread - Knowledge travels through trade and alliances
    // -------------------------------------------------------------------------

    // Trade partners can learn specializations from each other
    modEvent("specializationTradeSpread", {
        random: true,
        weight: $c.VERY_RARE,
        subject: {
            reg: "town", random: true
        },
        target: {
            reg: "town", nearby: true
        },
        value: (subject, target, args) => {
            // Subject needs to have a specialization
            const subjectSpecs = getTownSpecializations(subject);
            if (subjectSpecs.length === 0) return false;

            // Need good relations (trade partners)
            const relation = subject.relations[target.id] || 0;
            if (relation < 2) return false;

            // Target needs high trade
            const targetTrade = target.influences.trade || 0;
            if (targetTrade < 3) return false;

            // Find a specialization target doesn't have and could potentially learn
            const learnable = subjectSpecs.filter(s => {
                if (hasSpecialization(target, s.id)) return false;
                // Need at least half the threshold in the relevant influence
                const def = SPECIALIZATIONS[s.id];
                const targetInfluence = target.influences[def.influence] || 0;
                return targetInfluence >= Math.floor(def.threshold / 2);
            });

            if (learnable.length === 0) return false;
            args.spec = choose(learnable);
            return true;
        },
        message: (subject, target, args) => {
            return `Traders from {{regname:town|${subject.id}}} share tales of their {{b:${args.spec.name}}}. {{regname:town|${target.id}}} could {{c:learn|adopt|embrace}} these ways...`;
        },
        func: (subject, target, args) => {
            addSpecialization(target, args.spec.id);
            happen("AddRelation", subject, target, { amount: 1 });
        },
        messageDone: (subject, target, args) => {
            return `{{regname:town|${target.id}}} develops its own {{b:${args.spec.name}}}, inspired by {{regname:town|${subject.id}}}.`;
        },
        messageNo: () => `They {{c:keep to|prefer|maintain}} their own traditions.`
    });

    // Allied towns share knowledge more readily
    modEvent("specializationAllianceSpread", {
        random: true,
        weight: $c.RARE,
        subject: {
            reg: "town", random: true
        },
        value: (subject, target, args) => {
            const subjectSpecs = getTownSpecializations(subject);
            if (subjectSpecs.length === 0) return false;

            const alliance = getTownAlliance(subject);
            if (!alliance) return false;

            // Find an ally without this specialization
            for (const memberId of alliance.members) {
                if (memberId === subject.id) continue;
                const ally = regGet("town", memberId);
                if (!ally || ally.end) continue;

                const learnable = subjectSpecs.filter(s => {
                    if (hasSpecialization(ally, s.id)) return false;
                    const def = SPECIALIZATIONS[s.id];
                    const allyInfluence = ally.influences[def.influence] || 0;
                    return allyInfluence >= Math.floor(def.threshold / 2);
                });

                if (learnable.length > 0) {
                    args.ally = ally;
                    args.spec = choose(learnable);
                    args.alliance = alliance;
                    return true;
                }
            }
            return false;
        },
        message: (subject, target, args) => {
            return `Through {{b:${args.alliance.name}}}, {{regname:town|${subject.id}}} offers to share their {{b:${args.spec.name}}} with {{regname:town|${args.ally.id}}}...`;
        },
        func: (subject, target, args) => {
            addSpecialization(args.ally, args.spec.id);
            happen("AddRelation", subject, args.ally, { amount: 2 });
        },
        messageDone: (subject, target, args) => {
            return `{{regname:town|${args.ally.id}}} gains the {{b:${args.spec.name}}} tradition from their allies.`;
        },
        messageNo: () => `The knowledge remains with its originators.`
    });

    // Conquest can transfer specializations (knowledge plundered)
    modEvent("specializationConquest", {
        daily: true,
        subject: {
            reg: "process",
            filter: (p) => p.type === "war" && p.done && !p._specPlundered
        },
        func: (subject) => {
            // subject is the war process
            subject._specPlundered = true;

            const winnerId = subject.winner;
            if (!winnerId || !subject.towns || subject.towns.length < 2) return;

            const winner = regGet("town", winnerId);
            const defeatedId = (subject.losers && subject.losers.length)
                ? choose(subject.losers)
                : subject.towns.find(id => id !== winnerId);
            const defeated = regGet("town", defeatedId);
            if (!winner || !defeated || defeated.end) return;

            const defeatedSpecs = getTownSpecializations(defeated);
            if (defeatedSpecs.length === 0) return;

            if (Math.random() >= 0.3) return; // 30% chance to plunder knowledge

            const spec = choose(defeatedSpecs);
            removeSpecialization(defeated, spec.id);
            addSpecialization(winner, spec.id);

            logMessage(`{{regname:town|${winner.id}}} {{c:plunders|seizes|captures}} the {{b:${spec.name}}} knowledge from conquered {{regname:town|${defeated.id}}}.`, "warning");
        }
    });

    // -------------------------------------------------------------------------
    // Emergent Behaviors - Specializations drive new interactions
    // -------------------------------------------------------------------------

    // Towns with valuable specializations become trade targets
    modEvent("specializationTradeAttract", {
        random: true,
        weight: $c.UNCOMMON,
        subject: {
            reg: "town", random: true
        },
        target: {
            reg: "town", random: true
        },
        value: (subject, target, args) => {
            if (subject.id === target.id) return false;

            // Target should have valuable specializations
            const attractiveness = getTradeAttractiveness(target);
            if (attractiveness < 3) return false;

            // Subject should have trade capability
            const subjectTrade = subject.influences.trade || 0;
            if (subjectTrade < 2) return false;

            // Not already great friends
            const relation = subject.relations[target.id] || 0;
            if (relation > 4) return false;

            args.attractiveness = attractiveness;
            args.targetSpecs = getTownSpecializations(target);
            return true;
        },
        func: (subject, target, args) => {
            // Improve relations through trade interest
            happen("AddRelation", subject, target, { amount: 2 });
            happen("Influence", null, subject, { trade: 0.5 });
            happen("Influence", null, target, { trade: 0.5 });

            const specNames = args.targetSpecs.slice(0, 2).map(s => s.name).join(" and ");
            logMessage(`{{regname:town|${subject.id}}} sends merchants to {{regname:town|${target.id}}}, drawn by their {{b:${specNames}}}.`);
        }
    });

    // Towns with valuable specializations become raid targets
    modEvent("specializationRaidTarget", {
        random: true,
        weight: $c.RARE,
        subject: {
            reg: "town", random: true
        },
        target: {
            reg: "town", random: true
        },
        value: (subject, target, args) => {
            if (subject.id === target.id) return false;
            if (!planet.unlocks.military) return false;

            // Subject needs military focus
            const subjectMilitary = subject.influences.military || 0;
            if (subjectMilitary < 4) return false;

            // Target should be raid-attractive (valuable but not too defended)
            const raidValue = getRaidAttractiveness(target);
            if (raidValue < 2) return false;

            // Already at war?
            if (hasIssue(subject, "war") || hasIssue(target, "war")) return false;

            // Check relations (need to be neutral or bad)
            const relation = subject.relations[target.id] || 0;
            if (relation > 1) return false;

            args.raidValue = raidValue;
            args.targetSpecs = getTownSpecializations(target);
            return true;
        },
        func: (subject, target, args) => {
            // Worsen relations, increase military tension
            happen("AddRelation", subject, target, { amount: -3 });
            happen("Influence", null, subject, { military: 1 });

            const specNames = args.targetSpecs.slice(0, 2).map(s => s.name).join(" and ");
            logMessage(`{{regname:town|${subject.id}}} {{c:eyes|covets|desires}} the {{b:${specNames}}} of {{regname:town|${target.id}}}. Tensions {{c:rise|grow|mount}}.`, "warning");
        }
    });

    // Winter raids intensify skirmishes (more raids, fewer full wars)
    modEvent("winterRaidSkirmish", {
        random: true,
        weight: $c.RARE,
        subject: { reg: "town", random: true },
        target: { reg: "town", random: true },
        value: (subject, target, args) => {
            if (!subject || !target) return false;
            if (subject.id === target.id) return false;
            if (!planet.unlocks?.military) return false;
            const season = getSeasonInfo();
            if (!season || season.id !== "winter") return false;
            if (subject.end || target.end) return false;
            if (hasIssue(subject, "war") || hasIssue(target, "war")) return false;
            if (areAllied(subject, target)) return false;

            const subjectMilitary = subject.influences?.military || 0;
            if (subjectMilitary < 3) return false;

            const raidValue = typeof getRaidAttractiveness === "function" ? getRaidAttractiveness(target) : 0;
            if (raidValue < 2) return false;

            const relation = getRelations(subject, target);
            if (relation > 2) return false;

            args.raidValue = raidValue;
            return true;
        },
        func: (subject, target, args) => {
            const profile = getSeasonWarProfile();
            const pressure = 1 * (profile.raidBoost || 1);
            bumpWarPressure(subject, target, pressure);
            worsenRelations(target, subject, 1);
            happen("Influence", null, subject, { military: 0.4, temp: true });
            happen("Influence", null, target, { happy: -0.2, temp: true });
            logMessage(`Winter raiders from {{regname:town|${subject.id}}} harry the outskirts of {{regname:town|${target.id}}}.`, "warning");
        }
    });

    // People migrate toward towns with cultural specializations
    modEvent("specializationMigration", {
        random: true,
        weight: $c.UNCOMMON,
        subject: {
            reg: "town", random: true
        },
        target: {
            reg: "town", random: true
        },
        value: (subject, target, args) => {
            if (subject.id === target.id) return false;

            // Target should have cultural/happy specializations
            const targetSpecs = getTownSpecializations(target);
            const culturalSpecs = targetSpecs.filter(s =>
                s.influence === "happy" || s.influence === "education" || s.influence === "faith"
            );
            if (culturalSpecs.length === 0) return false;

            // Subject should be less happy
            const subjectHappy = subject.influences.happy || 0;
            const targetHappy = target.influences.happy || 0;
            if (subjectHappy >= targetHappy) return false;

            args.spec = choose(culturalSpecs);
            return true;
        },
        func: (subject, target, args) => {
            // Small population shift
            if (subject.pop > 10) {
                const migrants = Math.min(3, Math.floor(subject.pop * 0.05));
                subject.pop -= migrants;
                target.pop += migrants;

                logMessage(`{{residents:${subject.id}}} {{c:leave for|migrate to|are drawn to}} {{regname:town|${target.id}}}, seeking the {{b:${args.spec.name}}}.`);
            }
        }
    });

    // -------------------------------------------------------------------------
    // Player Sway - Specialization Manipulation
    // -------------------------------------------------------------------------

    // Encourage a town to develop a specialization
    modEvent("swayDevelopSpecialization", {
        random: true,
        weight: $c.RARE,
        subject: {
            reg: "player", id: 1
        },
        target: {
            reg: "town", random: true
        },
        value: (subject, target, args) => {
            if ((target.influences.faith || 0) < -2) return false;

            const available = getAvailableSpecializations(target);
            if (available.length === 0) return false;

            args.spec = choose(available);
            args.successChance = 0.40;
            // Higher faith = more likely to follow guidance
            args.successChance += (target.influences.faith || 0) * 0.05;
            args.successChance = clampChance(args.successChance, 0.10, 0.80);
            return true;
        },
        message: (subject, target, args) => {
            return `{{regname:town|${target.id}}} excels in ${args.spec.influence}. You could {{c:encourage|guide|inspire}} them to become a {{b:${args.spec.name}}}...`;
        },
        func: (subject, target, args) => {
            const success = Math.random() < args.successChance;
            args.success = success;

            if (success) {
                addSpecialization(target, args.spec.id);
                happen("Influence", subject, target, { faith: 1 });
            } else {
                happen("Influence", subject, target, { faith: -1 });
            }
        },
        messageDone: (subject, target, args) => {
            if (args.success) {
                return `{{regname:town|${target.id}}} embraces your guidance and becomes known as a {{b:${args.spec.name}}}.`;
            }
            return `{{residents:${target.id}}} {{c:resist|ignore|dismiss}} your suggestion.`;
        },
        messageNo: () => `You let them find their own path.`
    });

    // Encourage knowledge theft between towns
    modEvent("swayStealKnowledge", {
        random: true,
        weight: $c.VERY_RARE,
        subject: {
            reg: "player", id: 1
        },
        target: {
            reg: "town", random: true
        },
        value: (subject, target, args) => {
            if ((target.influences.faith || 0) < 0) return false;

            // Find a nearby town with specializations target could steal
            const candidates = regFilter("town", t => {
                if (t.id === target.id) return false;
                const specs = getTownSpecializations(t);
                return specs.some(s => !hasSpecialization(target, s.id));
            });

            if (candidates.length === 0) return false;

            args.victim = choose(candidates);
            ensureTownState(args.victim);
            const victimSpecs = getTownSpecializations(args.victim);
            const stealable = victimSpecs.filter(s => !hasSpecialization(target, s.id));
            args.spec = choose(stealable);

            args.successChance = 0.30;
            // Education helps with stealing knowledge
            args.successChance += (target.influences.education || 0) * 0.05;
            // But victim's education makes it harder
            args.successChance -= (args.victim.influences.education || 0) * 0.03;
            args.successChance = clampChance(args.successChance, 0.05, 0.60);
            return true;
        },
        message: (subject, target, args) => {
            return `{{regname:town|${args.victim.id}}} has valuable {{b:${args.spec.name}}} knowledge. You could {{c:suggest|encourage|guide}} {{regname:town|${target.id}}} to {{c:learn|acquire|take}} these secrets...`;
        },
        func: (subject, target, args) => {
            const success = Math.random() < args.successChance;
            args.success = success;

            if (success) {
                addSpecialization(target, args.spec.id);
                happen("AddRelation", target, args.victim, { amount: -3 });
                happen("Influence", subject, target, { education: 1 });
                logMessage(`{{regname:town|${target.id}}} {{c:learns|acquires|steals}} the secrets of {{b:${args.spec.name}}} from {{regname:town|${args.victim.id}}}!`);
            } else {
                happen("Influence", subject, target, { faith: -2 });
                happen("AddRelation", target, args.victim, { amount: -2 });
                logMessage(`{{regname:town|${args.victim.id}}} {{c:catches|discovers|uncovers}} {{regname:town|${target.id}}}'s {{c:spies|agents|scholars}} trying to steal their secrets!`, "warning");
            }
        },
        messageDone: (subject, target, args) => {
            if (args.success) {
                return `Knowledge stolen. {{regname:town|${target.id}}} gains the {{b:${args.spec.name}}} tradition.`;
            }
            return null;
        },
        messageNo: () => `You respect the boundaries of knowledge.`
    });

    // Encourage knowledge sharing (the nice version)
    modEvent("swayShareKnowledge", {
        random: true,
        weight: $c.RARE,
        subject: {
            reg: "player", id: 1
        },
        target: {
            reg: "town", random: true
        },
        value: (subject, target, args) => {
            if ((target.influences.faith || 0) < -1) return false;

            const targetSpecs = getTownSpecializations(target);
            if (targetSpecs.length === 0) return false;

            // Find a friendly town that could benefit
            const friends = regFilter("town", t => {
                if (t.id === target.id) return false;
                const relation = target.relations[t.id] || 0;
                if (relation < 1) return false;
                // Check they don't have the specialization and could learn it
                return targetSpecs.some(s => {
                    if (hasSpecialization(t, s.id)) return false;
                    const def = SPECIALIZATIONS[s.id];
                    const influence = t.influences[def.influence] || 0;
                    return influence >= Math.floor(def.threshold / 2);
                });
            });

            if (friends.length === 0) return false;

            args.friend = choose(friends);
            ensureTownState(args.friend);
            const teachable = targetSpecs.filter(s => {
                if (hasSpecialization(args.friend, s.id)) return false;
                const def = SPECIALIZATIONS[s.id];
                const influence = args.friend.influences[def.influence] || 0;
                return influence >= Math.floor(def.threshold / 2);
            });
            args.spec = choose(teachable);

            args.successChance = 0.50;
            // Good relations help
            const relation = target.relations[args.friend.id] || 0;
            args.successChance += relation * 0.05;
            args.successChance = clampChance(args.successChance, 0.20, 0.90);
            return true;
        },
        message: (subject, target, args) => {
            return `{{regname:town|${target.id}}} has {{b:${args.spec.name}}} traditions. You could {{c:suggest|encourage|inspire}} them to share this with {{regname:town|${args.friend.id}}}...`;
        },
        func: (subject, target, args) => {
            const success = Math.random() < args.successChance;
            args.success = success;

            if (success) {
                addSpecialization(args.friend, args.spec.id);
                happen("AddRelation", target, args.friend, { amount: 3 });
                happen("Influence", subject, target, { faith: 1 });
                happen("Influence", subject, args.friend, { faith: 1 });
            } else {
                happen("Influence", subject, target, { faith: -1 });
            }
        },
        messageDone: (subject, target, args) => {
            if (args.success) {
                return `{{regname:town|${target.id}}} generously shares their {{b:${args.spec.name}}} traditions with {{regname:town|${args.friend.id}}}. Bonds {{c:deepen|strengthen|grow}}.`;
            }
            return `{{residents:${target.id}}} {{c:prefer|choose|decide}} to keep their traditions to themselves.`;
        },
        messageNo: () => `You let knowledge stay where it is.`
    });

    // Suggest abandoning a specialization
    modEvent("swayAbandonSpecialization", {
        random: true,
        weight: $c.VERY_RARE,
        subject: {
            reg: "player", id: 1
        },
        target: {
            reg: "town", random: true
        },
        value: (subject, target, args) => {
            if ((target.influences.faith || 0) < 1) return false;

            const specs = getTownSpecializations(target);
            if (specs.length === 0) return false;

            args.spec = choose(specs);
            args.successChance = 0.25;
            // High faith needed for such drastic change
            args.successChance += (target.influences.faith || 0) * 0.08;
            args.successChance = clampChance(args.successChance, 0.05, 0.50);
            return true;
        },
        message: (subject, target, args) => {
            return `{{regname:town|${target.id}}} is known for its {{b:${args.spec.name}}}. You could {{c:suggest|counsel|advise}} they {{c:let go of|abandon|move beyond}} this tradition...`;
        },
        func: (subject, target, args) => {
            const success = Math.random() < args.successChance;
            args.success = success;

            if (success) {
                removeSpecialization(target, args.spec.id);
                happen("Influence", subject, target, { faith: -2 });
                logMessage(`{{regname:town|${target.id}}} {{c:abandons|releases|lets go of}} their {{b:${args.spec.name}}} traditions at your guidance.`);
            } else {
                happen("Influence", subject, target, { faith: -3 });
                logMessage(`{{residents:${target.id}}} {{c:reject|refuse|resist}} abandoning their {{b:${args.spec.name}}} traditions. Your influence {{c:wanes|fades|weakens}}.`, "warning");
            }
        },
        messageDone: (subject, target, args) => {
            if (args.success) {
                return `The {{b:${args.spec.name}}} tradition fades from {{regname:town|${target.id}}}.`;
            }
            return null;
        },
        messageNo: () => `You respect their traditions.`
    });

    // -------------------------------------------------------------------------
    // Complementary Alliances - Towns seek allies with different specializations
    // -------------------------------------------------------------------------

    modEvent("specializationComplementaryAlliance", {
        random: true,
        weight: $c.RARE,
        subject: {
            reg: "town", random: true
        },
        target: {
            reg: "town", nearby: true
        },
        value: (subject, target, args) => {
            initAlliances();
            if (getTownAlliance(subject) || getTownAlliance(target)) return false;

            const subjectSpecs = getTownSpecializations(subject);
            const targetSpecs = getTownSpecializations(target);

            // Need complementary specializations (different types)
            if (subjectSpecs.length === 0 || targetSpecs.length === 0) return false;

            const subjectInfluences = new Set(subjectSpecs.map(s => s.influence));
            const targetInfluences = new Set(targetSpecs.map(s => s.influence));

            // Check for complementary (non-overlapping) specializations
            let hasComplement = false;
            for (const inf of targetInfluences) {
                if (!subjectInfluences.has(inf)) {
                    hasComplement = true;
                    break;
                }
            }
            if (!hasComplement) return false;

            // Need decent relations
            const relation = subject.relations[target.id] || 0;
            if (relation < 1) return false;

            args.subjectSpec = choose(subjectSpecs);
            args.targetSpec = choose(targetSpecs);
            return true;
        },
        message: (subject, target, args) => {
            return `{{regname:town|${subject.id}}}'s {{b:${args.subjectSpec.name}}} and {{regname:town|${target.id}}}'s {{b:${args.targetSpec.name}}} would {{c:complement|strengthen|enhance}} each other. An alliance beckons...`;
        },
        func: (subject, target, args) => {
            if (!planet.unlocks.military) return;

            const alliance = formAlliance(subject, target);
            if (!alliance) return;
            args.alliance = alliance;

            happen("AddRelation", subject, target, { amount: 3 });
            logMessage(`{{regname:town|${subject.id}}} and {{regname:town|${target.id}}} form {{b:${alliance.name}}}, combining their {{b:${args.subjectSpec.name}}} and {{b:${args.targetSpec.name}}} traditions!`, "milestone");
        }
    });

    // =========================================================================
    // EXTENDED TECHNOLOGY TREE
    // Adds more levels to existing branches and a new Faith branch
    // =========================================================================

    // Farm branch extensions (currently ends at 40: Crop Rotation)
    modEvent("unlockFertilization", {
        random: true,
        weight: $c.UNCOMMON,
        subject: { reg: "player", id: 1 },
        check: () => {
            if (planet.unlocks.farm < 50 && planet.unlocks.farm >= 40) return true;
            return false;
        },
        message: () => "{{people}} notice that certain waste makes crops grow stronger. {{should}}",
        func: () => {
            planet.unlocks.farm = 50;
            happen("Influence", null, null, { farm: 2, disease: 0.2 });
            logMessage("Fields are enriched with natural fertilizers.", "milestone");
        },
        messageNo: () => "Waste is kept far from food sources."
    });

    modEvent("unlockSelectiveBreeding", {
        random: true,
        weight: $c.UNCOMMON,
        subject: { reg: "player", id: 1 },
        check: () => {
            if (planet.unlocks.farm < 60 && planet.unlocks.farm >= 50 && planet.unlocks.education >= 10) return true;
            return false;
        },
        message: () => "Farmers want to breed only the strongest livestock and heartiest seeds. {{should}}",
        func: () => {
            planet.unlocks.farm = 60;
            happen("Influence", null, null, { farm: 2, happy: 0.5 });
            logMessage("Each generation grows stronger than the last.", "milestone");
        },
        messageNo: () => "Nature is left to decide which survive."
    });

    modEvent("unlockMechanizedFarming", {
        random: true,
        weight: $c.RARE,
        subject: { reg: "player", id: 1 },
        check: () => {
            if (planet.unlocks.farm < 70 && planet.unlocks.farm >= 60 && planet.unlocks.smith >= 50) return true;
            return false;
        },
        message: () => "{{people}} dream of machines that could plant and harvest without rest. {{should}}",
        func: () => {
            planet.unlocks.farm = 70;
            happen("Influence", null, null, { farm: 3, happy: -0.5 });
            logMessage("Mechanical implements transform agriculture.", "milestone");
        },
        messageNo: () => "Hands and simple tools remain the way of the field.",
        funcNo: () => {
            happen("Influence", null, null, { happy: 0.5 });
        }
    });

    modEvent("unlockAgriculturalScience", {
        random: true,
        weight: $c.RARE,
        subject: { reg: "player", id: 1 },
        check: () => {
            if (planet.unlocks.farm < 80 && planet.unlocks.farm >= 70 && planet.unlocks.education >= 20) return true;
            return false;
        },
        message: () => "Scholars study soil, weather, and growth with scientific rigor. {{should}}",
        func: () => {
            planet.unlocks.farm = 80;
            happen("Influence", null, null, { farm: 2, education: 1 });
            logMessage("Farming becomes a science as much as a craft.", "milestone");
        },
        messageNo: () => "Traditional knowledge passed down through generations suffices."
    });

    // Travel branch extensions (currently ends at 40: Wheels)
    modEvent("unlockRoads", {
        random: true,
        weight: $c.UNCOMMON,
        subject: { reg: "player", id: 1 },
        check: () => {
            if (planet.unlocks.travel < 50 && planet.unlocks.travel >= 40 && planet.unlocks.smith >= 10) return true;
            return false;
        },
        message: () => "{{people}} propose laying stone paths between settlements. {{should}}",
        func: () => {
            planet.unlocks.travel = 50;
            happen("Influence", null, null, { travel: 2, trade: 1 });
            logMessage("Paved roads connect the towns.", "milestone");
        },
        messageNo: () => "Dirt paths serve well enough."
    });

    modEvent("unlockSailingShips", {
        random: true,
        weight: $c.UNCOMMON,
        subject: { reg: "player", id: 1 },
        check: () => {
            if (planet.unlocks.travel < 60 && planet.unlocks.travel >= 50 && planet.unlocks.trade >= 20) return true;
            return false;
        },
        message: () => "{{people}} want to build larger vessels with sails to catch the wind. {{should}}",
        func: () => {
            planet.unlocks.travel = 60;
            happen("Influence", null, null, { travel: 2, trade: 1.5 });
            logMessage("Tall ships sail to distant shores.", "milestone");
        },
        messageNo: () => "The coast is far enough to venture."
    });

    modEvent("unlockNavigation", {
        random: true,
        weight: $c.UNCOMMON,
        subject: { reg: "player", id: 1 },
        check: () => {
            if (planet.unlocks.travel < 70 && planet.unlocks.travel >= 60 && planet.unlocks.education >= 20) return true;
            return false;
        },
        message: () => "Scholars study the stars to chart courses across open water. {{should}}",
        func: () => {
            planet.unlocks.travel = 70;
            happen("Influence", null, null, { travel: 2, education: 1 });
            logMessage("Navigators guide ships by the heavens.", "milestone");
        },
        messageNo: () => "Sailors stay within sight of land."
    });

    modEvent("unlockSteamPower", {
        random: true,
        weight: $c.RARE,
        subject: { reg: "player", id: 1 },
        check: () => {
            if (planet.unlocks.travel < 80 && planet.unlocks.travel >= 70 &&
                planet.unlocks.smith >= 50 && planet.unlocks.fire >= 20) return true;
            return false;
        },
        message: () => "{{people}} observe that boiling water creates great force. Could this move machines? {{should}}",
        func: () => {
            planet.unlocks.travel = 80;
            happen("Influence", null, null, { travel: 3, farm: 1 });
            logMessage("Steam engines transform travel and industry.", "milestone");
        },
        messageNo: () => "Wind, water, and muscle remain the sources of power.",
        funcNo: () => {
            happen("Influence", null, null, { happy: 0.5 });
        }
    });

    modEvent("unlockRailways", {
        random: true,
        weight: $c.RARE,
        subject: { reg: "player", id: 1 },
        check: () => {
            if (planet.unlocks.travel < 90 && planet.unlocks.travel >= 80 && planet.unlocks.smith >= 60) return true;
            return false;
        },
        message: () => "Iron rails could guide steam-powered carriages between towns. {{should}}",
        func: () => {
            planet.unlocks.travel = 90;
            happen("Influence", null, null, { travel: 3, trade: 2, happy: -0.5 });
            logMessage("Locomotives connect distant settlements.", "milestone");
        },
        messageNo: () => "The land should not be scarred by iron tracks."
    });

    // Fire branch extensions (currently ends at 30: Firebombing)
    modEvent("unlockKilns", {
        random: true,
        weight: $c.UNCOMMON,
        subject: { reg: "player", id: 1 },
        check: () => {
            if (planet.unlocks.fire < 40 && planet.unlocks.fire >= 20 && planet.unlocks.smith >= 20) return true;
            return false;
        },
        message: () => "{{people}} want to build structures to contain and control intense heat. {{should}}",
        func: () => {
            planet.unlocks.fire = 40;
            happen("Influence", null, null, { trade: 1 });
            logMessage("Kilns fire pottery and bricks with precision.", "milestone");
        },
        messageNo: () => "Open fires serve all heating needs."
    });

    modEvent("unlockForges", {
        random: true,
        weight: $c.UNCOMMON,
        subject: { reg: "player", id: 1 },
        check: () => {
            if (planet.unlocks.fire < 50 && planet.unlocks.fire >= 40 && planet.unlocks.smith >= 30) return true;
            return false;
        },
        message: () => "Smiths dream of furnaces hot enough to melt any metal. {{should}}",
        func: () => {
            planet.unlocks.fire = 50;
            happen("Influence", null, null, { military: 1, trade: 1 });
            logMessage("Great forges produce stronger alloys.", "milestone");
        },
        messageNo: () => "Simple metalwork is sufficient."
    });

    modEvent("unlockGunpowder", {
        random: true,
        weight: $c.RARE,
        subject: { reg: "player", id: 1 },
        check: () => {
            if (planet.unlocks.fire < 60 && planet.unlocks.fire >= 50 &&
                planet.unlocks.military >= 30 && planet.unlocks.education >= 10) return true;
            return false;
        },
        message: () => "A mixture of substances creates violent explosions. Should this be explored?",
        func: () => {
            planet.unlocks.fire = 60;
            happen("Influence", null, null, { military: 4, crime: 1, happy: -1 });
            logMessage("Gunpowder changes the nature of warfare forever.", "milestone");
        },
        messageNo: () => "Such dangerous knowledge is forbidden.",
        funcNo: () => {
            happen("Influence", null, null, { happy: 1 });
        }
    });

    modEvent("unlockEngines", {
        random: true,
        weight: $c.RARE,
        subject: { reg: "player", id: 1 },
        check: () => {
            if (planet.unlocks.fire < 70 && planet.unlocks.fire >= 60 && planet.unlocks.travel >= 80) return true;
            return false;
        },
        message: () => "Controlled explosions could drive pistons and machines. {{should}}",
        func: () => {
            planet.unlocks.fire = 70;
            happen("Influence", null, null, { travel: 2, farm: 1 });
            logMessage("Combustion engines power a new age.", "milestone");
        },
        messageNo: () => "Steam and muscle are power enough."
    });

    // Smith branch extensions (currently ends at 40: Metal Tools)
    modEvent("unlockSteel", {
        random: true,
        weight: $c.UNCOMMON,
        subject: { reg: "player", id: 1 },
        check: () => {
            if (planet.unlocks.smith < 50 && planet.unlocks.smith >= 40 && planet.unlocks.fire >= 40) return true;
            return false;
        },
        message: () => "Smiths experiment with refining iron into something stronger. {{should}}",
        func: () => {
            planet.unlocks.smith = 50;
            happen("Influence", null, null, { military: 2, trade: 1 });
            logMessage("Steel transforms construction and warfare.", "milestone");
        },
        messageNo: () => "Iron serves all needs."
    });

    modEvent("unlockArchitecture", {
        random: true,
        weight: $c.UNCOMMON,
        subject: { reg: "player", id: 1 },
        check: () => {
            if (planet.unlocks.smith < 60 && planet.unlocks.smith >= 50 && planet.unlocks.education >= 10) return true;
            return false;
        },
        message: () => "Builders dream of structures that touch the sky. {{should}}",
        func: () => {
            planet.unlocks.smith = 60;
            happen("Influence", null, null, { happy: 2, faith: 1 });
            logMessage("Grand buildings rise across the land.", "milestone");
        },
        messageNo: () => "Humble structures shelter the people."
    });

    modEvent("unlockMachinery", {
        random: true,
        weight: $c.UNCOMMON,
        subject: { reg: "player", id: 1 },
        check: () => {
            if (planet.unlocks.smith < 70 && planet.unlocks.smith >= 60 && planet.unlocks.education >= 20) return true;
            return false;
        },
        message: () => "Gears, levers, and pulleys could multiply human effort. {{should}}",
        func: () => {
            planet.unlocks.smith = 70;
            happen("Influence", null, null, { farm: 1, trade: 1, happy: -0.5 });
            logMessage("Machines assist in labor across the land.", "milestone");
        },
        messageNo: () => "Hands are the proper tools of work."
    });

    modEvent("unlockPrecisionEngineering", {
        random: true,
        weight: $c.RARE,
        subject: { reg: "player", id: 1 },
        check: () => {
            if (planet.unlocks.smith < 80 && planet.unlocks.smith >= 70 && planet.unlocks.education >= 30) return true;
            return false;
        },
        message: () => "Craftsmen seek to build devices of exacting precision. {{should}}",
        func: () => {
            planet.unlocks.smith = 80;
            happen("Influence", null, null, { education: 2, trade: 1 });
            logMessage("Precision instruments advance all fields.", "milestone");
        },
        messageNo: () => "Approximate measures serve well enough."
    });

    // Trade branch extensions (currently ends at 30: Currency)
    modEvent("unlockBanking", {
        random: true,
        weight: $c.UNCOMMON,
        subject: { reg: "player", id: 1 },
        check: () => {
            if (planet.unlocks.trade < 40 && planet.unlocks.trade >= 30 && planet.unlocks.government >= 10) return true;
            return false;
        },
        message: () => "Merchants want to store and lend currency through trusted institutions. {{should}}",
        func: () => {
            planet.unlocks.trade = 40;
            happen("Influence", null, null, { trade: 2, crime: 0.5 });
            logMessage("Banks manage wealth across the settlements.", "milestone");
        },
        messageNo: () => "Each keeps their own wealth close."
    });

    modEvent("unlockContracts", {
        random: true,
        weight: $c.UNCOMMON,
        subject: { reg: "player", id: 1 },
        check: () => {
            if (planet.unlocks.trade < 50 && planet.unlocks.trade >= 40 && planet.unlocks.education >= 20) return true;
            return false;
        },
        message: () => "Written agreements could bind parties to their promises. {{should}}",
        func: () => {
            planet.unlocks.trade = 50;
            happen("Influence", null, null, { trade: 1.5, crime: -0.5 });
            logMessage("Legal contracts govern trade and property.", "milestone");
        },
        messageNo: () => "A handshake and one's word are bond enough."
    });

    modEvent("unlockMarkets", {
        random: true,
        weight: $c.UNCOMMON,
        subject: { reg: "player", id: 1 },
        check: () => {
            if (planet.unlocks.trade < 60 && planet.unlocks.trade >= 50) return true;
            return false;
        },
        message: () => "{{people}} want dedicated places where goods are bought and sold. {{should}}",
        func: () => {
            planet.unlocks.trade = 60;
            happen("Influence", null, null, { trade: 2, happy: 1 });
            logMessage("Market squares bustle with commerce.", "milestone");
        },
        messageNo: () => "Trade happens wherever people meet."
    });

    modEvent("unlockGuilds", {
        random: true,
        weight: $c.UNCOMMON,
        subject: { reg: "player", id: 1 },
        check: () => {
            if (planet.unlocks.trade < 70 && planet.unlocks.trade >= 60 && planet.unlocks.education >= 20) return true;
            return false;
        },
        message: () => "Craftsmen want to organize to protect their trades. {{should}}",
        func: () => {
            planet.unlocks.trade = 70;
            happen("Influence", null, null, { trade: 1.5, education: 1, happy: -0.5 });
            logMessage("Guilds regulate crafts and train apprentices.", "milestone");
        },
        messageNo: () => "Any may practice any trade freely."
    });

    modEvent("unlockCorporations", {
        random: true,
        weight: $c.RARE,
        subject: { reg: "player", id: 1 },
        check: () => {
            if (planet.unlocks.trade < 80 && planet.unlocks.trade >= 70 && planet.unlocks.government >= 20) return true;
            return false;
        },
        message: () => "Groups want to pool resources into entities that persist beyond individuals. {{should}}",
        func: () => {
            planet.unlocks.trade = 80;
            happen("Influence", null, null, { trade: 3, happy: -1 });
            logMessage("Corporations pursue profit across settlements.", "milestone");
        },
        messageNo: () => "Business remains personal and local."
    });

    // Government branch extensions (currently ends at 10: Laws)
    modEvent("unlockTaxation", {
        random: true,
        weight: $c.UNCOMMON,
        subject: { reg: "player", id: 1 },
        check: () => {
            if (planet.unlocks.government < 20 && planet.unlocks.government >= 10 && planet.unlocks.trade >= 20) return true;
            return false;
        },
        message: () => "Leaders want to collect a portion of wealth to fund common works. {{should}}",
        func: () => {
            planet.unlocks.government = 20;
            happen("Influence", null, null, { trade: -0.5, military: 1, travel: 1 });
            logMessage("Taxes fund roads, defenses, and public works.", "milestone");
        },
        messageNo: () => "The people keep what they earn."
    });

    modEvent("unlockBureaucracy", {
        random: true,
        weight: $c.UNCOMMON,
        subject: { reg: "player", id: 1 },
        check: () => {
            if (planet.unlocks.government < 30 && planet.unlocks.government >= 20 && planet.unlocks.education >= 10) return true;
            return false;
        },
        message: () => "Records and officials could manage the growing complexity of society. {{should}}",
        func: () => {
            planet.unlocks.government = 30;
            happen("Influence", null, null, { crime: -1, happy: -0.5 });
            logMessage("Scribes and officials administer the settlements.", "milestone");
        },
        messageNo: () => "Simple councils decide local matters."
    });

    modEvent("unlockCourts", {
        random: true,
        weight: $c.UNCOMMON,
        subject: { reg: "player", id: 1 },
        check: () => {
            if (planet.unlocks.government < 40 && planet.unlocks.government >= 30) return true;
            return false;
        },
        message: () => "Disputes could be settled by impartial judges rather than feuds. {{should}}",
        func: () => {
            planet.unlocks.government = 40;
            happen("Influence", null, null, { crime: -1.5, happy: 0.5 });
            logMessage("Courts of law deliver justice.", "milestone");
        },
        messageNo: () => "Communities settle their own disputes."
    });

    modEvent("unlockConstitution", {
        random: true,
        weight: $c.RARE,
        subject: { reg: "player", id: 1 },
        check: () => {
            if (planet.unlocks.government < 50 && planet.unlocks.government >= 40 && planet.unlocks.education >= 20) return true;
            return false;
        },
        message: () => "{{people}} propose writing down the fundamental rules that govern society. {{should}}",
        func: () => {
            planet.unlocks.government = 50;
            happen("Influence", null, null, { happy: 1.5, crime: -0.5 });
            logMessage("A constitution limits power and protects rights.", "milestone");
        },
        messageNo: () => "Tradition and custom guide governance."
    });

    // Education branch extensions (currently ends at 20: Higher Education)
    modEvent("unlockWriting", {
        random: true,
        weight: $c.UNCOMMON,
        subject: { reg: "player", id: 1 },
        check: () => {
            if (planet.unlocks.education < 30 && planet.unlocks.education >= 20) return true;
            return false;
        },
        message: () => "{{people}} want to record their words in lasting form. {{should}}",
        func: () => {
            planet.unlocks.education = 30;
            happen("Influence", null, null, { education: 2, trade: 0.5 });
            logMessage("Written language preserves knowledge.", "milestone");
        },
        messageNo: () => "Memory and oral tradition carry wisdom forward."
    });

    modEvent("unlockLibraries", {
        random: true,
        weight: $c.UNCOMMON,
        subject: { reg: "player", id: 1 },
        check: () => {
            if (planet.unlocks.education < 40 && planet.unlocks.education >= 30) return true;
            return false;
        },
        message: () => "Scholars want to gather written works in one place. {{should}}",
        func: () => {
            planet.unlocks.education = 40;
            happen("Influence", null, null, { education: 2 });
            logMessage("Libraries preserve and share knowledge.", "milestone");
        },
        messageNo: () => "Knowledge stays with those who earned it."
    });

    modEvent("unlockPrinting", {
        random: true,
        weight: $c.RARE,
        subject: { reg: "player", id: 1 },
        check: () => {
            if (planet.unlocks.education < 50 && planet.unlocks.education >= 40 && planet.unlocks.smith >= 40) return true;
            return false;
        },
        message: () => "A device could copy written works quickly and cheaply. {{should}}",
        func: () => {
            planet.unlocks.education = 50;
            happen("Influence", null, null, { education: 3, happy: 0.5, crime: 0.25 });
            logMessage("The printing press spreads ideas far and wide.", "milestone");
        },
        messageNo: () => "Hand-copied texts are precious and controlled."
    });

    modEvent("unlockUniversities", {
        random: true,
        weight: $c.RARE,
        subject: { reg: "player", id: 1 },
        check: () => {
            if (planet.unlocks.education < 60 && planet.unlocks.education >= 50) return true;
            return false;
        },
        message: () => "Scholars want institutions dedicated to advancing knowledge. {{should}}",
        func: () => {
            planet.unlocks.education = 60;
            happen("Influence", null, null, { education: 3 });
            logMessage("Universities become centers of learning.", "milestone");
        },
        messageNo: () => "Apprenticeship teaches all that's needed."
    });

    modEvent("unlockScientificMethod", {
        random: true,
        weight: $c.RARE,
        subject: { reg: "player", id: 1 },
        check: () => {
            if (planet.unlocks.education < 70 && planet.unlocks.education >= 60) return true;
            return false;
        },
        message: () => "Some propose testing ideas through careful experiment rather than tradition. {{should}}",
        func: () => {
            planet.unlocks.education = 70;
            happen("Influence", null, null, { education: 3, farm: 1, happy: 0.5 });
            logMessage("The scientific method transforms understanding.", "milestone");
        },
        messageNo: () => "Ancient wisdom guides inquiry."
    });

    modEvent("unlockMedicine", {
        random: true,
        weight: $c.RARE,
        subject: { reg: "player", id: 1 },
        check: () => {
            if (planet.unlocks.education < 80 && planet.unlocks.education >= 70) return true;
            return false;
        },
        message: () => "Scholars study the body to understand and treat disease. {{should}}",
        func: () => {
            planet.unlocks.education = 80;
            happen("Influence", null, null, { disease: -2, happy: 1 });
            logMessage("Medical knowledge saves lives.", "milestone");
        },
        messageNo: () => "Healing remains a matter of tradition and faith."
    });

    // Military branch extensions (currently ends at 50: Combat Vehicles)
    modEvent("unlockFortifications", {
        random: true,
        weight: $c.UNCOMMON,
        subject: { reg: "player", id: 1 },
        check: () => {
            if (planet.unlocks.military < 60 && planet.unlocks.military >= 50 && planet.unlocks.smith >= 50) return true;
            return false;
        },
        message: () => "Towns want walls and towers to defend against attack. {{should}}",
        func: () => {
            planet.unlocks.military = 60;
            happen("Influence", null, null, { military: 2, happy: -0.5 });
            logMessage("Fortifications protect the settlements.", "milestone");
        },
        messageNo: () => "Open communities trust in peace."
    });

    modEvent("unlockStandingArmies", {
        random: true,
        weight: $c.UNCOMMON,
        subject: { reg: "player", id: 1 },
        check: () => {
            if (planet.unlocks.military < 70 && planet.unlocks.military >= 60 && planet.unlocks.government >= 30) return true;
            return false;
        },
        message: () => "Some propose maintaining soldiers even in peacetime. {{should}}",
        func: () => {
            planet.unlocks.military = 70;
            happen("Influence", null, null, { military: 2, crime: -1, happy: -1 });
            logMessage("Professional armies train and garrison.", "milestone");
        },
        messageNo: () => "Citizens take up arms only when needed."
    });

    modEvent("unlockFirearms", {
        random: true,
        weight: $c.RARE,
        subject: { reg: "player", id: 1 },
        check: () => {
            if (planet.unlocks.military < 80 && planet.unlocks.military >= 70 && planet.unlocks.fire >= 60) return true;
            return false;
        },
        message: () => "Gunpowder could propel projectiles with devastating force. {{should}}",
        func: () => {
            planet.unlocks.military = 80;
            happen("Influence", null, null, { military: 3 });
            logMessage("Firearms transform the battlefield.", "milestone");
        },
        messageNo: () => "Traditional weapons maintain honor in combat."
    });

    modEvent("unlockArtillery", {
        random: true,
        weight: $c.RARE,
        subject: { reg: "player", id: 1 },
        check: () => {
            if (planet.unlocks.military < 90 && planet.unlocks.military >= 80) return true;
            return false;
        },
        message: () => "Massive guns could demolish walls and armies from afar. {{should}}",
        func: () => {
            planet.unlocks.military = 90;
            happen("Influence", null, null, { military: 3, happy: -1 });
            logMessage("Artillery dominates the battlefield.", "milestone");
        },
        messageNo: () => "Siege warfare relies on patience and will."
    });

    // =========================================================================
    // NEW FAITH TECH BRANCH
    // =========================================================================

    // Initialize faith unlock tracking
    function initFaithUnlocks() {
        if (planet.unlocks.faith === undefined) {
            planet.unlocks.faith = 0;
        }
    }

    modEvent("unlockRituals", {
        random: true,
        weight: $c.UNCOMMON,
        subject: { reg: "player", id: 1 },
        check: () => {
            initFaithUnlocks();
            if (planet.unlocks.faith < 10 && planet.unlocks.farm >= 10) return true;
            return false;
        },
        message: () => "{{people}} develop ceremonies to mark births, deaths, and seasons. {{should}}",
        func: () => {
            initFaithUnlocks();
            planet.unlocks.faith = 10;
            happen("Influence", null, null, { faith: 2, happy: 1 });
            logMessage("Rituals bind communities together.", "milestone");
        },
        messageNo: () => "Each observes in their own way."
    });

    modEvent("unlockTemples", {
        random: true,
        weight: $c.UNCOMMON,
        subject: { reg: "player", id: 1 },
        check: () => {
            initFaithUnlocks();
            if (planet.unlocks.faith < 20 && planet.unlocks.faith >= 10 && planet.unlocks.smith >= 20) return true;
            return false;
        },
        message: () => "{{people}} want to build sacred spaces for worship. {{should}}",
        func: () => {
            planet.unlocks.faith = 20;
            happen("Influence", null, null, { faith: 2, happy: 0.5 });
            logMessage("Temples rise as centers of faith.", "milestone");
        },
        messageNo: () => "The world itself is sacred enough."
    });

    modEvent("unlockPriesthood", {
        random: true,
        weight: $c.UNCOMMON,
        subject: { reg: "player", id: 1 },
        check: () => {
            initFaithUnlocks();
            if (planet.unlocks.faith < 30 && planet.unlocks.faith >= 20) return true;
            return false;
        },
        message: () => "Some wish to dedicate their lives to spiritual matters. {{should}}",
        func: () => {
            planet.unlocks.faith = 30;
            happen("Influence", null, null, { faith: 2, education: 0.5 });
            logMessage("Priests guide the faithful.", "milestone");
        },
        messageNo: () => "All commune with the divine equally."
    });

    modEvent("unlockScripture", {
        random: true,
        weight: $c.UNCOMMON,
        subject: { reg: "player", id: 1 },
        check: () => {
            initFaithUnlocks();
            if (planet.unlocks.faith < 40 && planet.unlocks.faith >= 30 && planet.unlocks.education >= 30) return true;
            return false;
        },
        message: () => "The faithful want to record sacred teachings in writing. {{should}}",
        func: () => {
            planet.unlocks.faith = 40;
            happen("Influence", null, null, { faith: 2, education: 1 });
            logMessage("Holy texts preserve and spread the faith.", "milestone");
        },
        messageNo: () => "Sacred knowledge passes through living tradition."
    });

    modEvent("unlockMonasteries", {
        random: true,
        weight: $c.RARE,
        subject: { reg: "player", id: 1 },
        check: () => {
            initFaithUnlocks();
            if (planet.unlocks.faith < 50 && planet.unlocks.faith >= 40 && planet.unlocks.education >= 40) return true;
            return false;
        },
        message: () => "Some wish to withdraw from the world to focus on spiritual and scholarly pursuits. {{should}}",
        func: () => {
            planet.unlocks.faith = 50;
            happen("Influence", null, null, { faith: 2, education: 2 });
            logMessage("Monasteries become centers of faith and learning.", "milestone");
        },
        messageNo: () => "The faithful remain in the world."
    });

    // =========================================================================
    // GOVERNMENT TYPES SYSTEM
    // Towns develop different government types that affect relations
    // =========================================================================

    const GOVERNMENT_TYPES = {
        tribal: {
            name: "Tribal",
            description: "led by traditional elders",
            requires: { government: 0 },
            tensions: { democracy: 2, theocracy: 1, monarchy: 1 },
            bonuses: { happy: 0.5, military: 0.5 }
        },
        council: {
            name: "Council",
            description: "led by a council of elders",
            requires: { government: 0 },
            tensions: { dictatorship: 1 },
            bonuses: { happy: 0.5, law: 0.5 }
        },
        anarchy: {
            name: "Anarchy",
            description: "without formal governance",
            requires: { government: 0 },
            tensions: { monarchy: 3, theocracy: 2, oligarchy: 2, democracy: 1 },
            bonuses: { happy: 1, crime: 2 }
        },
        chiefdom: {
            name: "Chiefdom",
            description: "ruled by a chief",
            requires: { government: 10 },
            tensions: { democracy: 2, anarchy: 2 },
            bonuses: { military: 1 }
        },
        monarchy: {
            name: "Monarchy",
            description: "ruled by a monarch",
            requires: { government: 20 },
            tensions: { democracy: 3, anarchy: 3, republic: 2 },
            bonuses: { military: 1, happy: -0.5 }
        },
        dictatorship: {
            name: "Dictatorship",
            description: "ruled by a dictator",
            requires: { government: 30 },
            tensions: { democracy: 3, republic: 2, commune: 2, anarchy: 2 },
            bonuses: { military: 2, law: 1, happy: -1, crime: -0.5 }
        },
        theocracy: {
            name: "Theocracy",
            description: "ruled by religious leaders",
            requires: { faith: 30 },
            tensions: { anarchy: 3, democracy: 2, republic: 1 },
            bonuses: { faith: 2, education: -0.5 }
        },
        oligarchy: {
            name: "Oligarchy",
            description: "ruled by wealthy merchants",
            requires: { trade: 40 },
            tensions: { anarchy: 2, democracy: 2, theocracy: 1 },
            bonuses: { trade: 2, happy: -1 }
        },
        commune: {
            name: "Commune",
            description: "collectively governed community",
            requires: { government: 20 },
            tensions: { oligarchy: 2, dictatorship: 2, monarchy: 1 },
            bonuses: { happy: 1, trade: -0.5, crime: -0.5 }
        },
        republic: {
            name: "Republic",
            description: "governed by elected representatives",
            requires: { government: 40, education: 20 },
            tensions: { monarchy: 2, theocracy: 1, anarchy: 1 },
            bonuses: { happy: 1, education: 0.5 }
        },
        democracy: {
            name: "Democracy",
            description: "governed by the people",
            requires: { government: 50, education: 30 },
            tensions: { monarchy: 3, theocracy: 2, oligarchy: 2, anarchy: 1 },
            bonuses: { happy: 1.5, education: 1 }
        }
    };

    function initGovernment(town) {
        if (!town) return;

        const hadGovType = !!town.governmentType;
        if (!hadGovType) {
            if (town.gov && GOVERNMENT_TYPES[town.gov]) {
                town.governmentType = town.gov;
            } else {
                town.governmentType = "tribal";
            }
        }

        if (town._governmentBonusId === undefined && hadGovType && GOVERNMENT_TYPES[town.governmentType]) {
            town._governmentBonusId = town.governmentType;
        }

        if (typeof govForms !== "undefined" && town.governmentType && govForms[town.governmentType]) {
            town.gov = town.governmentType;
        }
    }

    function applyGovernmentType(town, newGovId) {
        if (!town || !GOVERNMENT_TYPES[newGovId]) return false;
        initGovernment(town);

        const oldBonusId = town._governmentBonusId;
        if (oldBonusId && GOVERNMENT_TYPES[oldBonusId] && GOVERNMENT_TYPES[oldBonusId].bonuses) {
            for (const [influence, amount] of Object.entries(GOVERNMENT_TYPES[oldBonusId].bonuses)) {
                town.influences[influence] = (town.influences[influence] || 0) - amount;
            }
        }

        town.governmentType = newGovId;
        const newGov = GOVERNMENT_TYPES[newGovId];
        if (newGov.bonuses) {
            for (const [influence, amount] of Object.entries(newGov.bonuses)) {
                town.influences[influence] = (town.influences[influence] || 0) + amount;
            }
        }

        town._governmentBonusId = newGovId;
        if (typeof govForms !== "undefined" && govForms[newGovId]) {
            town.gov = newGovId;
        }
        return true;
    }

    // Get a town's government type
    function getTownGovernment(town) {
        initGovernment(town);
        if (town.governmentType && GOVERNMENT_TYPES[town.governmentType]) {
            return { id: town.governmentType, ...GOVERNMENT_TYPES[town.governmentType] };
        }
        // Default to tribal if not set
        return { id: "tribal", ...GOVERNMENT_TYPES.tribal };
    }

    function isAutocraticGov(govId) {
        return ["dictatorship", "monarchy", "chiefdom", "oligarchy"].includes(govId);
    }

    function isCollectiveGov(govId) {
        return ["commune", "council", "democracy", "republic"].includes(govId);
    }

    // Check if a town qualifies for a government type
    function canHaveGovernment(town, govId) {
        const gov = GOVERNMENT_TYPES[govId];
        if (!gov) return false;

        for (const [key, value] of Object.entries(gov.requires)) {
            if (key === "government" || key === "faith" || key === "trade") {
                // Check global unlocks
                if ((planet.unlocks[key] || 0) < value) return false;
            }
        }
        return true;
    }

    // Get available governments for a town
    function getAvailableGovernments(town) {
        const available = [];
        const currentGov = getTownGovernment(town);

        for (const [id, gov] of Object.entries(GOVERNMENT_TYPES)) {
            if (id !== currentGov.id && canHaveGovernment(town, id)) {
                available.push({ id, ...gov });
            }
        }
        return available;
    }

    // Calculate tension between two government types
    function getGovernmentTension(gov1Id, gov2Id) {
        const gov1 = GOVERNMENT_TYPES[gov1Id];
        const gov2 = GOVERNMENT_TYPES[gov2Id];
        if (!gov1 || !gov2) return 0;

        let tension = 0;
        if (gov1.tensions && gov1.tensions[gov2Id]) {
            tension += gov1.tensions[gov2Id];
        }
        if (gov2.tensions && gov2.tensions[gov1Id]) {
            tension += gov2.tensions[gov1Id];
        }
        return tension;
    }

    // -------------------------------------------------------------------------
    // Government Evolution Events
    // -------------------------------------------------------------------------

    // Towns can evolve their government type
    modEvent("governmentEvolution", {
        daily: true,
        subject: { reg: "town", all: true },
        value: (subject, target, args) => {
            const available = getAvailableGovernments(subject);
            if (available.length === 0) return false;

            // Small daily chance
            if (Math.random() > 0.01) return false;

            // Pick a government that matches their strongest influence
            const currentGov = getTownGovernment(subject);
            let bestMatch = null;
            let bestScore = -Infinity;

            for (const gov of available) {
                let score = 0;
                // Prefer governments that match town's character
                if (gov.requires.faith && (subject.influences.faith || 0) > 3) score += 2;
                if (gov.requires.trade && (subject.influences.trade || 0) > 3) score += 2;
                if (gov.id === "democracy" && (subject.influences.education || 0) > 4) score += 3;
                if (gov.id === "monarchy" && (subject.influences.military || 0) > 3) score += 2;
                if (gov.id === "anarchy" && (subject.influences.crime || 0) > 2) score += 2;

                // Add randomness
                score += Math.random() * 2;

                if (score > bestScore) {
                    bestScore = score;
                    bestMatch = gov;
                }
            }

            if (bestMatch) {
                args.newGov = bestMatch;
                args.oldGov = currentGov;
                return true;
            }
            return false;
        },
        func: (subject, target, args) => {
            applyGovernmentType(subject, args.newGov.id);

            logMessage(`{{regname:town|${subject.id}}} becomes a {{b:${args.newGov.name}}}, ${args.newGov.description}.`, "milestone");
        }
    });

    // Government tensions affect relations
    modEvent("governmentTensions", {
        daily: true,
        subject: { reg: "town", all: true },
        value: (subject, target, args) => {
            // 5% daily chance to check tensions
            if (Math.random() > 0.05) return false;

            const subjectGov = getTownGovernment(subject);

            // Find a town with a different, conflicting government
            const conflictTowns = regFilter("town", t => {
                if (t.id === subject.id || t.end || t.pop <= 0) return false;
                const otherGov = getTownGovernment(t);
                const tension = getGovernmentTension(subjectGov.id, otherGov.id);
                return tension >= 2;
            });

            if (conflictTowns.length === 0) return false;

            args.other = choose(conflictTowns);
            args.otherGov = getTownGovernment(args.other);
            args.tension = getGovernmentTension(subjectGov.id, args.otherGov.id);
            args.subjectGov = subjectGov;
            return true;
        },
        func: (subject, target, args) => {
            // Worsen relations based on tension level
            const amount = -Math.floor(args.tension / 2);
            happen("AddRelation", subject, args.other, { amount });

            // Only log if significant
            if (Math.random() < 0.2) {
                logMessage(`{{regname:town|${subject.id}}}'s {{b:${args.subjectGov.name}}} clashes with {{regname:town|${args.other.id}}}'s {{b:${args.otherGov.name}}}. Tensions {{c:rise|grow|mount}}.`);
            }
        }
    });

    // Similar governments get along better
    modEvent("governmentHarmony", {
        daily: true,
        subject: { reg: "town", all: true },
        value: (subject, target, args) => {
            // 3% daily chance
            if (Math.random() > 0.03) return false;

            const subjectGov = getTownGovernment(subject);

            // Find a town with the same government type
            const similarTowns = regFilter("town", t => {
                if (t.id === subject.id || t.end || t.pop <= 0) return false;
                const otherGov = getTownGovernment(t);
                return otherGov.id === subjectGov.id;
            });

            if (similarTowns.length === 0) return false;

            args.other = choose(similarTowns);
            args.gov = subjectGov;
            return true;
        },
        func: (subject, target, args) => {
            happen("AddRelation", subject, args.other, { amount: 1 });

            // Rarely log
            if (Math.random() < 0.1) {
                logMessage(`{{regname:town|${subject.id}}} and {{regname:town|${args.other.id}}} bond over their shared {{b:${args.gov.name}}} values.`);
            }
        }
    });

    // Governance ⇄ Economy feedback
    modEvent("governanceEconomyFeedback", {
        daily: true,
        subject: { reg: "town", all: true },
        value: (subject) => {
            if (!subject || subject.end) return false;
            if (Math.random() > 0.04) return false;
            return true;
        },
        func: (subject) => {
            const gov = getTownGovernment(subject).id;
            const law = subject.influences?.law || 0;
            const trade = subject.influences?.trade || 0;
            const education = subject.influences?.education || 0;
            const happy = subject.influences?.happy || 0;
            const crime = subject.influences?.crime || 0;
            const faith = subject.influences?.faith || 0;

            let influences = null;
            let unrestDelta = 0;
            let log = null;

            if (gov === "democracy" || gov === "republic") {
                if (education > 5 && law > 3 && trade > 3) {
                    influences = { trade: 0.25, law: 0.2, temp: true };
                    log = "Civic institutions in {{regname:town|ID}} smooth trade and law.";
                } else if (education < 2 && trade > 4) {
                    influences = { crime: 0.3, law: -0.1, temp: true };
                    log = "Weak civic literacy in {{regname:town|ID}} strains institutions.";
                }
            } else if (gov === "oligarchy") {
                if (trade > 6 && happy < 0) {
                    influences = { crime: 0.3, trade: -0.2, temp: true };
                    unrestDelta += 0.3;
                    log = "Merchant elites in {{regname:town|ID}} face popular resentment.";
                } else if (law > 3 && trade > 4) {
                    influences = { trade: 0.2, temp: true };
                }
            } else if (gov === "dictatorship" || gov === "monarchy" || gov === "chiefdom") {
                if (trade > 6 && law < 2) {
                    influences = { crime: 0.4, trade: -0.3, temp: true };
                    unrestDelta += 0.3;
                    log = "Corruption sours commerce in {{regname:town|ID}}.";
                } else if (law > 4 && trade > 3) {
                    influences = { trade: 0.15, temp: true };
                }
            } else if (gov === "theocracy") {
                if (faith > 5) {
                    influences = { crime: -0.2, happy: 0.1, temp: true };
                } else if (education > 6 && faith < 2) {
                    influences = { law: -0.2, happy: -0.2, temp: true };
                    unrestDelta += 0.4;
                    log = "Doubt spreads in {{regname:town|ID}}'s halls of faith.";
                }
            } else if (gov === "commune" || gov === "council" || gov === "tribal") {
                if (happy > 2 && trade > 2) {
                    influences = { trade: 0.15, temp: true };
                } else if (trade < 2 && happy < 0) {
                    unrestDelta += 0.2;
                }
            } else if (gov === "anarchy") {
                if (crime > 3) {
                    influences = { trade: -0.3, temp: true };
                    log = "Lawlessness in {{regname:town|ID}} disrupts commerce.";
                } else if (happy > 3) {
                    influences = { trade: 0.1, temp: true };
                }
            }

            if (influences) {
                happen("Influence", null, subject, influences);
            }
            if (unrestDelta > 0) {
                initUnrest(subject);
                subject.unrest = Math.min(100, subject.unrest + unrestDelta);
            }
            if (log && Math.random() < 0.35) {
                modLog("governance", log.replace("ID", subject.id), null, { town: subject });
            }
        }
    });

    // Education drives reform pressure (or civic stability)
    modEvent("educationReformPressure", {
        random: true,
        weight: $c.UNCOMMON,
        subject: { reg: "town", random: true },
        value: (subject, target, args) => {
            if (!subject || subject.end) return false;
            const gov = getTownGovernment(subject).id;
            const education = subject.influences?.education || 0;
            if (education < 6) return false;
            args.gov = gov;
            return true;
        },
        func: (subject, target, args) => {
            const gov = args.gov;
            const education = subject.influences?.education || 0;
            const happy = subject.influences?.happy || 0;
            if (isAutocraticGov(gov) && happy < 1) {
                initUnrest(subject);
                subject.unrest = Math.min(100, subject.unrest + 1.2);
                happen("Influence", null, subject, { law: -0.2, happy: -0.2, temp: true });
                if (Math.random() < 0.25) {
                    modLog(
                        "governance",
                        `Educated voices in {{regname:town|${subject.id}}} press for reform.`,
                        null,
                        { town: subject }
                    );
                }
            } else if (isCollectiveGov(gov) && education > 7) {
                happen("Influence", null, subject, { law: 0.2, trade: 0.2, temp: true });
                if (Math.random() < 0.2) {
                    modLog(
                        "governance",
                        `Civic literacy strengthens institutions in {{regname:town|${subject.id}}}.`,
                        null,
                        { town: subject }
                    );
                }
            }
        }
    });

    // -------------------------------------------------------------------------
    // EMERGENT WAR PRESSURE SYSTEM (no arbitrary timers)
    // -------------------------------------------------------------------------

    const EARLY_WAR_CONFIG = {
        eraThreshold: 10,
        minDuration: 6,
        maxDuration: 14,
        raidDistance: 7,
        raidChance: 0.2,
        transferChance: 0.35,
        casualtyRate: 0.003
    };

    const COALITION_WAR_CONFIG = {
        participationBase: 0.6,
        participationSpread: 0.6,
        surrenderThreshold: 0.25,
        surrenderMinDays: 6,
        surrenderChance: 0.25,
        peaceMinDays: 4,
        peaceRelationRatio: 0.6,
        allySlackRatio: 0.5,
        allySlackGrace: 3,
        allySlackPenalty: -0.5,
        allySlackMax: 3
    };

    const GOVERNMENT_WAR_PROFILE = {
        tribal: { aggression: 1.05, diplomacy: 0.95 },
        council: { aggression: 0.9, diplomacy: 1.1 },
        anarchy: { aggression: 1.0, diplomacy: 0.9 },
        chiefdom: { aggression: 1.15, diplomacy: 0.9 },
        monarchy: { aggression: 1.2, diplomacy: 0.95 },
        dictatorship: { aggression: 1.3, diplomacy: 0.8 },
        theocracy: { aggression: 1.15, diplomacy: 0.9 },
        oligarchy: { aggression: 0.95, diplomacy: 1.05 },
        commune: { aggression: 0.85, diplomacy: 1.15 },
        republic: { aggression: 0.8, diplomacy: 1.2 },
        democracy: { aggression: 0.75, diplomacy: 1.25 }
    };

    function getGovernmentWarProfile(govId) {
        return GOVERNMENT_WAR_PROFILE[govId] || { aggression: 1, diplomacy: 1 };
    }

    function getMilitaryLevel() {
        return planet && planet.unlocks && planet.unlocks.military ? planet.unlocks.military : 0;
    }

    function isEarlyWarEra() {
        return getMilitaryLevel() < EARLY_WAR_CONFIG.eraThreshold;
    }

    function getEarlyWarStrength(town) {
        if (!town) return 1;
        const pop = town.pop || 0;
        const military = town.influences?.military || 0;
        const unrest = town.unrest || 0;
        let strength = Math.max(1, pop) * (1 + military * 0.04);
        if (hasTradition(town, "martial")) strength *= 1.15;
        if (unrest > 60) strength *= 0.9;
        if (town.famine && !town.famine.ended) strength *= 0.8;
        return strength;
    }

    function getEarlyWarReadiness(town, other) {
        if (!town) return 0.7;
        let readiness = 0.85;
        const strength = getEarlyWarStrength(town);
        const otherStrength = getEarlyWarStrength(other);
        const ratio = strength / Math.max(1, strength + otherStrength);
        readiness += (ratio - 0.5) * 0.3;

        if (hasTradition(town, "martial")) readiness += 0.1;
        if (hasTradition(town, "festive")) readiness -= 0.05;

        const scarcity = getTownScarcityPressure(town);
        readiness += Math.min(0.2, scarcity * 0.05);

        if (hasIssue(town, "disaster") || hasIssue(town, "revolution")) readiness -= 0.15;
        if (town.drought && !town.drought.ended) readiness -= 0.05;
        if (town.famine && !town.famine.ended) readiness -= 0.08;

        return clampValue(readiness, 0.5, 1.25);
    }

    function getTownAggression(town) {
        const gov = getTownGovernment(town);
        const profile = getGovernmentWarProfile(gov.id);
        let score = profile.aggression || 1;

        const religion = getTownReligion(town);
        if (religion) {
            if (religion.tenets.includes("militarism")) score += 0.2;
            if (religion.tenets.includes("pacifism")) score -= 0.2;
        }

        if (hasTradition(town, "martial")) score += 0.15;
        if (hasTradition(town, "festive")) score -= 0.05;

        const unrest = town.unrest || 0;
        if (unrest > 30 && unrest < 70) score += 0.1;
        if (unrest >= 70) score -= 0.1;

        const happy = town.influences?.happy || 0;
        const trade = town.influences?.trade || 0;
        const law = town.influences?.law || 0;
        if (happy > 4) score -= 0.05;
        if (trade > 5) score -= 0.05;
        if (law > 3) score -= 0.05;

        const military = town.influences?.military || 0;
        if (military > 5 && (trade > 4 || happy > 4 || (religion && religion.tenets.includes("pacifism")))) {
            score -= 0.1; // armed but defensive
        }

        return clampValue(score, 0.6, 1.6);
    }

    function getTownDiplomacyBias(town) {
        const gov = getTownGovernment(town);
        const profile = getGovernmentWarProfile(gov.id);
        return profile.diplomacy || 1;
    }

    function getTownWarReadiness(town, other) {
        const military = town.influences?.military || 0;
        const otherMilitary = other?.influences?.military || 0;
        const ratio = (military + 2) / (otherMilitary + 2);
        let readiness = 0.85 + (ratio - 1) * 0.2;

        const soldierRatio = (town.jobs?.soldier || 0) / Math.max(1, town.pop || 1);
        if (soldierRatio < 0.02) readiness -= 0.1;
        if (soldierRatio > 0.06) readiness += 0.1;

        if (hasIssue(town, "disaster") || hasIssue(town, "revolution")) readiness -= 0.2;
        if (town.famine && !town.famine.ended) readiness -= 0.1;
        if (town.drought && !town.drought.ended) readiness -= 0.1;

        return clampValue(readiness, 0.5, 1.4);
    }

    function getTownDeterrence(town) {
        let deterrence = (town.influences?.military || 0) * 0.02;
        if (hasTownSpecialization(town, "fortress")) deterrence += 0.08;
        if (hasTownSpecialization(town, "warriorClan")) deterrence += 0.05;
        return clampValue(deterrence, 0, 0.5);
    }

    function ensureWarSides(process) {
        if (!process || process.type !== "war") return null;
        if (!process.towns || process.towns.length < 2) return null;

        const uniqueTowns = [...new Set(process.towns)];
        if (!process.sides || !Array.isArray(process.sides) || process.sides.length < 2) {
            const sideA = [];
            const sideB = [];
            if (uniqueTowns[0] !== undefined) sideA.push(uniqueTowns[0]);
            if (uniqueTowns[1] !== undefined) sideB.push(uniqueTowns[1]);

            for (let i = 2; i < uniqueTowns.length; i++) {
                const townId = uniqueTowns[i];
                const town = regGet("town", townId);
                if (!town || town.end) continue;

                const affinityA = getSideAffinity(town, sideA);
                const affinityB = getSideAffinity(town, sideB);

                if (affinityA === affinityB) {
                    (Math.random() < 0.5 ? sideA : sideB).push(townId);
                } else if (affinityA > affinityB) {
                    sideA.push(townId);
                } else {
                    sideB.push(townId);
                }
            }

            process.sides = [sideA, sideB];
        }

        const sideMap = {};
        process.sides = process.sides.map((side, index) => {
            const clean = [];
            if (!Array.isArray(side)) return clean;
            for (let i = 0; i < side.length; i++) {
                const townId = side[i];
                if (townId === undefined || townId === null) continue;
                if (clean.includes(townId)) continue;
                clean.push(townId);
                sideMap[townId] = index;
            }
            return clean;
        });
        process._paultendoSideMap = sideMap;

        const allTowns = new Set(uniqueTowns);
        process.sides.forEach(side => side.forEach(id => allTowns.add(id)));
        process.towns = [...allTowns];
        return process.sides;
    }

    function getSideAffinity(town, side) {
        if (!town || !Array.isArray(side) || side.length === 0) return 0;
        let score = 0;
        let allied = false;
        for (let i = 0; i < side.length; i++) {
            const member = regGet("town", side[i]);
            if (!member || member.end) continue;
            score += getRelations(town, member);
            if (areAllied(town, member)) allied = true;
        }
        if (allied) score += 6;
        return score;
    }

    function getWarSideIndex(process, townId) {
        if (!process || !process.sides) return null;
        if (!process._paultendoSideMap) ensureWarSides(process);
        const map = process._paultendoSideMap || {};
        if (map[townId] !== undefined) return map[townId];
        for (let i = 0; i < process.sides.length; i++) {
            if (process.sides[i].includes(townId)) return i;
        }
        return null;
    }

    function addTownToWarSide(process, townId, sideIndex) {
        if (!process || !townId || sideIndex === null || sideIndex === undefined) return false;
        ensureWarSides(process);
        if (!process.sides || !process.sides[sideIndex]) return false;
        const currentSide = getWarSideIndex(process, townId);
        if (currentSide !== null && currentSide !== undefined) return currentSide === sideIndex;
        process.sides[sideIndex].push(townId);
        if (!process.towns.includes(townId)) process.towns.push(townId);
        if (!process._paultendoSideMap) process._paultendoSideMap = {};
        process._paultendoSideMap[townId] = sideIndex;
        return true;
    }

    function getOpposingSideIndex(process, sideIndex) {
        if (!process || !process.sides || process.sides.length < 2) return null;
        return sideIndex === 0 ? 1 : 0;
    }

    function getWarSideTowns(process, sideIndex) {
        if (!process || !process.sides || !process.sides[sideIndex]) return [];
        return process.sides[sideIndex].map(id => regGet("town", id)).filter(t => t && !t.end);
    }

    function getWarSideStrength(towns, early = false) {
        if (!towns || towns.length === 0) return 0;
        let strength = 0;
        for (let i = 0; i < towns.length; i++) {
            const town = towns[i];
            if (!town || town.end) continue;
            if (early) strength += getEarlyWarStrength(town);
            else {
                const soldiers = town.jobs?.soldier || 0;
                const military = town.influences?.military || 0;
                strength += soldiers * (1 + military * 0.05) + (town.pop || 0) * 0.05;
            }
        }
        return strength;
    }

    function computeWarParticipation(town, enemies, process) {
        if (!town || town.end) return 0.4;
        let score = 1;
        const military = town.influences?.military || 0;
        score += military * 0.05;
        if (hasTradition(town, "martial")) score += 0.12;
        if (hasTradition(town, "festive")) score -= 0.06;

        const distance = getClosestEnemyDistance(town, enemies);
        if (distance !== null) {
            const maxDist = Math.max(planetWidth || 0, planetHeight || 0) || 200;
            const proximity = 1 - Math.min(distance / (maxDist * 0.6), 1);
            score *= 0.7 + proximity * 0.6;
        }

        const unrest = town.unrest || 0;
        if (unrest > 60) score *= 0.75;
        if (hasIssue(town, "disaster") || hasIssue(town, "revolution")) score *= 0.6;
        if (town.famine && !town.famine.ended) score *= 0.8;

        const diplomacy = getTownDiplomacyBias(town);
        if (diplomacy > 1.1) score *= 0.85;

        const age = process ? (planet.day - (process.start || planet.day)) : 0;
        if (age > 20) score *= 0.9;

        return clampValue(score, 0.3, 1.6);
    }

    function getClosestEnemyDistance(town, enemies) {
        if (!town || !enemies || enemies.length === 0) return null;
        let best = null;
        for (let i = 0; i < enemies.length; i++) {
            const enemy = enemies[i];
            if (!enemy || enemy.end) continue;
            const dist = getTownDistance(town, enemy);
            if (dist === null) continue;
            if (best === null || dist < best) best = dist;
        }
        return best;
    }

    function handleAllyInvolvement(process, sideIndex, participationMap) {
        if (!process || !process.sides || !process.sides[sideIndex]) return;
        const sideIds = process.sides[sideIndex];
        if (sideIds.length < 2) return;

        const scores = sideIds.map(id => participationMap[id] || 0.4);
        const avg = scores.reduce((sum, v) => sum + v, 0) / scores.length;
        if (!process._paultendoAllySlack) process._paultendoAllySlack = {};
        const slackMap = process._paultendoAllySlack;

        for (let i = 0; i < sideIds.length; i++) {
            const townId = sideIds[i];
            const score = participationMap[townId] || 0;
            if (score >= avg * COALITION_WAR_CONFIG.allySlackRatio) {
                if (slackMap[townId]) slackMap[townId] = Math.max(0, slackMap[townId] - 1);
                continue;
            }
            slackMap[townId] = (slackMap[townId] || 0) + 1;
            if (slackMap[townId] <= COALITION_WAR_CONFIG.allySlackGrace) continue;
            if (slackMap[townId] > COALITION_WAR_CONFIG.allySlackMax) continue;

            const slacker = regGet("town", townId);
            if (!slacker || slacker.end) continue;

            for (let j = 0; j < sideIds.length; j++) {
                const allyId = sideIds[j];
                if (allyId === townId) continue;
                const ally = regGet("town", allyId);
                if (!ally || ally.end) continue;
                happen("AddRelation", slacker, ally, { amount: COALITION_WAR_CONFIG.allySlackPenalty });
            }

            if (Math.random() < 0.3) {
                logMessage(`Allies in the war grumble that {{regname:town|${townId}}} is not pulling their weight.`, "warning");
            }
        }
    }

    function getSideRelationStats(sideA, sideB) {
        let total = 0;
        let count = 0;
        let positive = 0;
        for (let i = 0; i < sideA.length; i++) {
            const a = sideA[i];
            if (!a || a.end) continue;
            for (let j = 0; j < sideB.length; j++) {
                const b = sideB[j];
                if (!b || b.end) continue;
                const rel = getRelations(a, b);
                total += rel;
                count += 1;
                if (rel >= 0) positive += 1;
            }
        }
        return {
            avg: count ? total / count : 0,
            positiveRatio: count ? positive / count : 0
        };
    }

    function chooseEnemyTarget(attacker, enemies) {
        if (!attacker || !enemies || enemies.length === 0) return null;
        return weightedChoice(enemies, (enemy) => {
            if (!enemy || enemy.end) return 0;
            const dist = getTownDistance(attacker, enemy);
            const maxDist = Math.max(planetWidth || 0, planetHeight || 0) || 200;
            const proximity = dist === null ? 0.5 : (1 - Math.min(dist / (maxDist * 0.7), 1));
            let weight = 1 + proximity * 2;
            const deterrence = getTownDeterrence(enemy);
            weight *= (1 - deterrence * 0.5);
            return Math.max(0.05, weight);
        });
    }

    function pickWarLeader(towns) {
        if (!towns || towns.length === 0) return null;
        return towns.reduce((best, town) => {
            if (!best) return town;
            const bestScore = (best.pop || 0) + (best.influences?.military || 0);
            const score = (town.pop || 0) + (town.influences?.military || 0);
            return score > bestScore ? town : best;
        }, null);
    }

    function endCoalitionWar(process, winningSideIndex = null, reason = "peace") {
        if (!process) return;
        ensureWarSides(process);
        if (winningSideIndex === null || winningSideIndex === undefined) {
            process.winner = null;
            process.winnerSide = null;
            process.losers = [];
            process.loserSide = null;
        } else {
            const winningTowns = getWarSideTowns(process, winningSideIndex);
            const losingSideIndex = getOpposingSideIndex(process, winningSideIndex);
            const losingTowns = getWarSideTowns(process, losingSideIndex);

            const winnerTown = pickWarLeader(winningTowns);
            process.winnerSide = winningSideIndex;
            process.loserSide = losingSideIndex;
            process.winner = winnerTown ? winnerTown.id : null;
            process.losers = losingTowns.map(t => t.id);
            if (winnerTown) {
                winnerTown.won = (winnerTown.won || 0) + 1;
            }
        }

        if (reason === "victory" && process.winner) {
            const winnerTown = regGet("town", process.winner);
            if (winnerTown) {
                logMessage(`Victory! {{regadj:town|${winnerTown.id}}} forces prevail.`, "warning");
            }
        } else if (reason === "peace") {
            logMessage(`{{c:Peace|Truce|Ceasefire}} settles between ${commaList(process.towns.map(t => `{{regname:town|${t}}}`))}.`);
        }
        happen("Finish", null, process);
    }

    const WARFRONT_MARKER_DEF = {
        name: "War Front",
        subtype: "warFront",
        symbol: "X",
        color: [255, 120, 120]
    };

    function getWarFrontPoint(process) {
        if (!process) return null;
        ensureWarSides(process);
        const sideA = getWarSideTowns(process, 0);
        const sideB = getWarSideTowns(process, 1);
        if (!sideA.length || !sideB.length) return null;
        const leaderA = pickWarLeader(sideA) || sideA[0];
        const leaderB = pickWarLeader(sideB) || sideB[0];
        const centerA = getTownCenter(leaderA);
        const centerB = getTownCenter(leaderB);
        if (!centerA || !centerB) return null;
        return {
            x: Math.round((centerA[0] + centerB[0]) / 2),
            y: Math.round((centerA[1] + centerB[1]) / 2)
        };
    }

    function ensureWarfrontMarker(process) {
        if (!process || process.done) return false;
        const point = getWarFrontPoint(process);
        if (!point) return false;
        let marker = process._paultendoWarMarker ? regGet("marker", process._paultendoWarMarker) : null;
        if (!marker) {
            marker = happen("Create", null, null, {
                type: "landmark",
                name: WARFRONT_MARKER_DEF.name,
                subtype: WARFRONT_MARKER_DEF.subtype,
                symbol: WARFRONT_MARKER_DEF.symbol,
                color: WARFRONT_MARKER_DEF.color,
                x: point.x,
                y: point.y
            }, "marker");
            if (!marker) return false;
            marker._paultendoWarProcess = process.id;
            process._paultendoWarMarker = marker.id;
            attachMarkerToChunk(marker, chunkAt(point.x, point.y));
            return true;
        }

        if (marker.x !== point.x || marker.y !== point.y) {
            detachMarkerFromChunk(marker);
            marker.x = point.x;
            marker.y = point.y;
            attachMarkerToChunk(marker, chunkAt(point.x, point.y));
        }
        return true;
    }

    function syncWarfrontMarkers() {
        const activeWars = regFilter("process", p => p.type === "war" && !p.done);
        const activeMarkers = new Set();
        activeWars.forEach(process => {
            if (ensureWarfrontMarker(process) && process._paultendoWarMarker) {
                activeMarkers.add(process._paultendoWarMarker);
            }
        });

        const warMarkers = regFilter("marker", m => m.subtype === "warFront" && m._paultendoWarProcess);
        warMarkers.forEach(marker => {
            if (activeMarkers.has(marker.id)) return;
            const process = regGet("process", marker._paultendoWarProcess);
            if (!process || process.done) {
                removeMarkerById(marker.id);
            }
        });
    }

    function getSeasonWarProfile() {
        const season = getSeasonInfo();
        if (!season) return { warChance: 1, raidBoost: 1 };
        switch (season.id) {
            case "winter":
                return { warChance: 0.6, raidBoost: 1.6 };
            case "summer":
                return { warChance: 1.25, raidBoost: 0.9 };
            case "spring":
                return { warChance: 1.05, raidBoost: 1 };
            case "autumn":
                return { warChance: 0.9, raidBoost: 1.1 };
            default:
                return { warChance: 1, raidBoost: 1 };
        }
    }

    function hasEmbargoBetween(town1, town2) {
        if (!planet.embargoes) return false;
        return planet.embargoes.some(e =>
            (e.from === town1.id && e.to === town2.id) ||
            (e.from === town2.id && e.to === town1.id)
        );
    }

    function getTownScarcityPressure(town) {
        let pressure = 0;
        if (town.famine && !town.famine.ended) pressure += 1.5;
        if (town.drought && !town.drought.ended) pressure += 1;
        if ((town.influences?.hunger || 0) > 4) pressure += 0.5;
        return pressure;
    }

    function getTownDistance(town1, town2) {
        const c1 = getTownCenter(town1);
        const c2 = getTownCenter(town2);
        if (!c1 || !c2) return null;
        const dx = c1[0] - c2[0];
        const dy = c1[1] - c2[1];
        return Math.sqrt(dx * dx + dy * dy);
    }

    function getWarPressureKey(town1, town2) {
        return town1.id < town2.id ? `${town1.id}|${town2.id}` : `${town2.id}|${town1.id}`;
    }

    function initWarPressure() {
        if (!planet._paultendoWarPressure) {
            planet._paultendoWarPressure = {};
        }
    }

    function getWarPressureRecord(town1, town2) {
        initWarPressure();
        const key = getWarPressureKey(town1, town2);
        if (!planet._paultendoWarPressure[key]) {
            planet._paultendoWarPressure[key] = { value: 0, lastDay: planet.day };
        }
        return planet._paultendoWarPressure[key];
    }

    function getWarPressureValue(town1, town2) {
        initWarPressure();
        const key = getWarPressureKey(town1, town2);
        const record = planet._paultendoWarPressure[key];
        return record ? (record.value || 0) : 0;
    }

    function getPairRelation(town1, town2) {
        const rel1 = getRelations(town1, town2);
        const rel2 = getRelations(town2, town1);
        return (rel1 + rel2) / 2;
    }

    function computeWarPressureDelta(town1, town2) {
        let delta = 0;

        const relation = getPairRelation(town1, town2);
        if (relation < 0) delta += Math.min(30, -relation) * 0.25;
        if (relation > 5) delta -= (relation - 5) * 0.2;

        const govTension = getGovernmentTension(getTownGovernment(town1).id, getTownGovernment(town2).id);
        delta += govTension * 0.8;

        const religion1 = getTownReligion(town1);
        const religion2 = getTownReligion(town2);
        if (religion1 && religion2) {
            const compat = getReligiousCompatibility(religion1, religion2);
            if (compat < 0.2) delta += (0.2 - compat) * 2;
            if (compat > 0.5) delta -= (compat - 0.5);
        }

        if (hasGrudge(town1, town2.id)) {
            delta += (town1.memory?.grudges?.[town2.id]?.severity || 1) * 0.4;
        }
        if (hasGrudge(town2, town1.id)) {
            delta += (town2.memory?.grudges?.[town1.id]?.severity || 1) * 0.4;
        }

        if (hasEmbargoBetween(town1, town2)) delta += 1.5;

        const distance = getTownDistance(town1, town2);
        if (distance !== null) {
            const maxDist = Math.max(planetWidth || 0, planetHeight || 0) || 200;
            const proximity = 1 - Math.min(distance / (maxDist * 0.8), 1);
            delta += proximity * 2;
        }

        const landmass1 = getTownLandmassId(town1);
        const landmass2 = getTownLandmassId(town2);
        if (landmass1 && landmass1 === landmass2) delta += 0.5;

        delta += (getTownScarcityPressure(town1) + getTownScarcityPressure(town2)) * 0.5;

        const raidValue = typeof getRaidAttractiveness === "function" ? getRaidAttractiveness(town2) : 0;
        if (raidValue > 2) delta += Math.min(2, raidValue * 0.2);

        // Alliances and strong bonds dampen pressure
        if (areAllied(town1, town2)) delta -= 3;
        if (hasBond(town1, town2.id) || hasBond(town2, town1.id)) delta -= 1;

        const aggression = (getTownAggression(town1) + getTownAggression(town2)) / 2;
        delta *= aggression;

        return delta;
    }

    function getWarPressureDecay(town1, town2) {
        const diplomacy = (getTownDiplomacyBias(town1) + getTownDiplomacyBias(town2)) / 2;
        let decay = 0.2 * diplomacy;
        if (areAllied(town1, town2)) decay += 1;
        return decay;
    }

    function updateWarPressure(town1, town2) {
        const record = getWarPressureRecord(town1, town2);
        const daysSince = Math.max(0, planet.day - (record.lastDay || planet.day));
        let pressure = record.value || 0;

        if (daysSince > 0) {
            pressure = Math.max(0, pressure - daysSince * getWarPressureDecay(town1, town2));
        }

        pressure = clampValue(pressure + computeWarPressureDelta(town1, town2), 0, 100);
        record.value = pressure;
        record.lastDay = planet.day;
        return pressure;
    }

    function hadRecentWar(town1, town2, withinDays = 60) {
        if (!planet.history) return false;
        const id1 = town1.id;
        const id2 = town2.id;
        return planet.history.some(h => {
            if (!h || !h.day || planet.day - h.day > withinDays) return false;
            if (h.type !== HISTORY_TYPES.WAR) return false;
            if (h.towns && h.towns.includes(id1) && h.towns.includes(id2)) return true;
            if ((h.victor === id1 && h.loser === id2) || (h.victor === id2 && h.loser === id1)) return true;
            return false;
        });
    }

    function maybeStartWarFromPressure(town1, town2, pressure) {
        if (town1.end || town2.end) return false;
        if (areAllied(town1, town2)) return false;
        if (hasIssue(town1, "war") || hasIssue(town2, "war")) return false;
        if (hasIssue(town1, "revolution") || hasIssue(town2, "revolution")) return false;
        if (hadRecentWar(town1, town2, 50)) return false;

        const aggression1 = getTownAggression(town1);
        const aggression2 = getTownAggression(town2);
        const earlyEra = isEarlyWarEra();
        const readiness1 = earlyEra ? getEarlyWarReadiness(town1, town2) : getTownWarReadiness(town1, town2);
        const readiness2 = earlyEra ? getEarlyWarReadiness(town2, town1) : getTownWarReadiness(town2, town1);

        const thresholdBase = earlyEra ? 45 : 35;
        const threshold = thresholdBase - (aggression1 + aggression2 - 2) * 6;
        if (pressure < threshold) return false;

        const instigator = (aggression1 * readiness1) >= (aggression2 * readiness2) ? town1 : town2;
        const defender = instigator.id === town1.id ? town2 : town1;
        const deterrence = getTownDeterrence(defender);

        if (earlyEra) {
            const distance = getTownDistance(instigator, defender);
            const maxDist = Math.max(planetWidth || 0, planetHeight || 0) || 200;
            const limit = Math.min(maxDist * 0.25, EARLY_WAR_CONFIG.raidDistance * 2);
            if (distance !== null && distance > limit) return false;
        }

        const baseChance = Math.max(0, (pressure - threshold) / 200);
        const readiness = earlyEra ? getEarlyWarReadiness(instigator, defender) : getTownWarReadiness(instigator, defender);
        const deterrenceFactor = earlyEra ? (1 - deterrence * 0.6) : (1 - deterrence);
        const maxChance = earlyEra ? 0.08 : 0.2;
        const chance = clampValue(baseChance * getTownAggression(instigator) * readiness * deterrenceFactor, 0, maxChance);
        const seasonProfile = getSeasonWarProfile();
        const adjustedChance = clampValue(chance * seasonProfile.warChance, 0, earlyEra ? 0.12 : 0.25);

        if (Math.random() < adjustedChance) {
            startWar(instigator, defender);
            if (earlyEra) {
                logMessage(`Skirmishes erupt between {{regname:town|${instigator.id}}} and {{regname:town|${defender.id}}}!`, "warning");
            } else {
                logMessage(`Tensions boil over. {{regname:town|${instigator.id}}} declares war on {{regname:town|${defender.id}}}!`, "warning");
            }
            return true;
        }
        return false;
    }

    modEvent("warPressureDynamics", {
        daily: true,
        subject: { reg: "town", all: true },
        value: (subject, target, args) => {
            if (subject.end || subject.pop <= 0) return false;
            if (planet.day < 5) return false;
            const earlyEra = isEarlyWarEra();
            if (earlyEra && subject.pop < 4) return false;
            const sampleRate = earlyEra ? 0.35 : 0.5;
            if (Math.random() > sampleRate) return false; // sample a subset each day

            const candidates = regFilter("town", t => t && !t.end && t.pop > 0 && t.id !== subject.id);
            if (candidates.length === 0) return false;

            const picked = weightedChoice(candidates, (t) => {
                const relation = getRelations(subject, t);
                const distance = getTownDistance(subject, t);
                const maxDist = Math.max(planetWidth || 0, planetHeight || 0) || 200;
                const proximity = distance === null ? 0.5 : (1 - Math.min(distance / (maxDist * 0.8), 1));
                let weight = 1 + proximity;
                if (relation < 0) weight += Math.min(10, -relation) * 0.2;
                if (relation > 4) weight -= 0.3;
                weight += getWarPressureValue(subject, t) / 30;
                return weight;
            });

            if (!picked) return false;
            args.other = picked;
            return true;
        },
        func: (subject, target, args) => {
            const other = args.other;
            if (!other) return;
            const pressure = updateWarPressure(subject, other);
            maybeStartWarFromPressure(subject, other, pressure);
        }
    });

    // Sync warfront markers once per day for visibility
    modEvent("warfrontMarkerSync", {
        daily: true,
        subject: { reg: "nature", id: 1 },
        func: () => {
            try { syncWarfrontMarkers(); } catch {}
        }
    });

    modEvent("allianceMarkerSync", {
        daily: true,
        subject: { reg: "nature", id: 1 },
        func: () => {
            try { syncAllianceMarkers(); } catch {}
        }
    });

    modEvent("tempMarkerCleanup", {
        daily: true,
        subject: { reg: "nature", id: 1 },
        func: () => {
            try { cleanupTempMarkers(); } catch {}
        }
    });

    function isEarlyWarProcess(process) {
        if (!process || process.type !== "war") return false;
        if (process._paultendoEarly) return true;
        return isEarlyWarEra();
    }

    function getEarlyWarDuration(process) {
        if (!process) return EARLY_WAR_CONFIG.minDuration;
        if (!process._paultendoEarlyDuration) {
            const min = EARLY_WAR_CONFIG.minDuration;
            const max = EARLY_WAR_CONFIG.maxDuration;
            process._paultendoEarlyDuration = min + Math.floor(Math.random() * (max - min + 1));
        }
        return process._paultendoEarlyDuration;
    }

    function attemptEarlyRaid(attacker, defender, power = 0.5) {
        if (!attacker || !defender || attacker.end || defender.end) return false;
        if (!attacker.center || !defender.center) return false;
        if (Math.random() > EARLY_WAR_CONFIG.raidChance) return false;

        const distance = getTownDistance(attacker, defender);
        if (distance !== null && distance > EARLY_WAR_CONFIG.raidDistance) return false;

        const chunk = typeof nearestChunk === "function"
            ? nearestChunk(attacker.center[0], attacker.center[1], (c) => c && c.v && c.v.s === defender.id)
            : null;
        if (!chunk) return false;

        if (typeof distanceCoords === "function") {
            const distToChunk = distanceCoords(attacker.center[0], attacker.center[1], chunk.x, chunk.y);
            if (distToChunk > EARLY_WAR_CONFIG.raidDistance) return false;
        }

        happen("Unclaim", attacker, defender, { x: chunk.x, y: chunk.y });

        if (!defender.end && Math.random() < EARLY_WAR_CONFIG.transferChance) {
            chunk.v.s = attacker.id;
            attacker.size = (attacker.size || 0) + 1;
        }

        if (typeof happen === "function") {
            try { happen("UpdateCenter", null, attacker); } catch {}
            try { happen("UpdateCenter", null, defender); } catch {}
        }

        if (Math.random() < 0.2) {
            logMessage(`Border raids between {{regname:town|${attacker.id}}} and {{regname:town|${defender.id}}} flare up.`);
        }

        return true;
    }

    function processEarlyWar(process) {
        if (!process || !process.towns || process.towns.length < 2) {
            happen("Finish", null, process);
            return true;
        }

        ensureWarSides(process);
        let sideA = getWarSideTowns(process, 0);
        let sideB = getWarSideTowns(process, 1);
        if (sideA.length === 0 || sideB.length === 0) {
            const winnerSide = sideA.length ? 0 : 1;
            endCoalitionWar(process, winnerSide, "victory");
            return true;
        }

        const age = planet.day - (process.start || planet.day);
        const duration = getEarlyWarDuration(process);
        let endNow = age >= duration;

        const relationStats = getSideRelationStats(sideA, sideB);
        if (age >= COALITION_WAR_CONFIG.peaceMinDays &&
            relationStats.positiveRatio >= COALITION_WAR_CONFIG.peaceRelationRatio) {
            endNow = true;
        }

        const participation = {};
        const sides = [sideA, sideB];
        for (let s = 0; s < sides.length; s++) {
            const towns = sides[s];
            const enemies = sides[s === 0 ? 1 : 0];
            for (let i = 0; i < towns.length; i++) {
                const town = towns[i];
                participation[town.id] = computeWarParticipation(town, enemies, process);
            }
            handleAllyInvolvement(process, s, participation);

            for (let i = 0; i < towns.length; i++) {
                const town = towns[i];
                const participateChance = clampValue(COALITION_WAR_CONFIG.participationBase * (participation[town.id] || 0.5), 0.1, 0.85);
                if (Math.random() > participateChance) continue;

                const target = chooseEnemyTarget(town, enemies);
                if (!target) continue;

                happen("AddRelation", town, target, { amount: -0.05 });
                happen("Influence", null, town, { happy: -0.05, temp: true });
                happen("Influence", null, target, { happy: -0.05, temp: true });

                const strength1 = getEarlyWarStrength(town);
                const strength2 = getEarlyWarStrength(target);
                const power = strength1 / Math.max(1, strength1 + strength2);

                const scarcity = getTownScarcityPressure(town) + getTownScarcityPressure(target);
                const skirmishChance = 0.12 + Math.min(0.12, scarcity * 0.03);
                if (Math.random() < skirmishChance) {
                    const loss = Math.max(1, Math.floor((target.pop || 1) * EARLY_WAR_CONFIG.casualtyRate));
                    if (loss > 0) {
                        happen("Death", null, target, { count: loss, cause: "war" });
                        process.deaths = (process.deaths || 0) + loss;
                    }
                    attemptEarlyRaid(town, target, power);
                }
            }
        }

        sideA = getWarSideTowns(process, 0);
        sideB = getWarSideTowns(process, 1);
        if (sideA.length === 0 || sideB.length === 0) {
            const winnerSide = sideA.length ? 0 : 1;
            endCoalitionWar(process, winnerSide, "victory");
            return true;
        }

        if (!endNow) {
            const diplomacy = [...sideA, ...sideB].reduce((sum, t) => sum + getTownDiplomacyBias(t), 0) / (sideA.length + sideB.length);
            const endChance = 0.015 * diplomacy + Math.min(0.12, age / Math.max(1, duration) * 0.08);
            if (Math.random() < endChance) endNow = true;
        }

        if (endNow) {
            logMessage(`Skirmishes between ${commaList(process.towns.map(t => `{{regname:town|${t}}}`))} fade into an uneasy peace.`);
            endCoalitionWar(process, null, "peace");
            return true;
        }

        return false;
    }

    function performLateWarAttack(attacker, defender, participation, warStats) {
        if (!attacker || !defender || attacker.end || defender.end) return;
        if (!attacker.center) { try { happen("UpdateCenter", null, attacker); } catch {} }
        if (!defender.center) { try { happen("UpdateCenter", null, defender); } catch {} }

        const attackerSoldiers = attacker.jobs?.soldier || 0;
        const defenderSoldiers = defender.jobs?.soldier || 0;
        const power = attackerSoldiers / Math.max(1, attackerSoldiers + defenderSoldiers);

        let chunkCount = (Math.floor((planet.unlocks?.military || 0) / 10) + 2) * power;
        chunkCount *= (0.6 + (participation || 0.6) * 0.6);
        if (chunkCount < 1 && Math.random() < chunkCount) chunkCount = 1;
        chunkCount = Math.floor(chunkCount);
        chunkCount = Math.min(chunkCount, defender.size || 0);

        let kill = 0;
        for (let i = 0; i < chunkCount; i++) {
            if (defender.end) break;
            let chunk = nearestChunk(attacker.center[0], attacker.center[1], (c) => c && c.v && c.v.s === defender.id);
            if (!chunk) break;

            const density = (defender.pop || 0) / Math.max(1, defender.size || 1);
            if (density < 1 && Math.random() < density) kill += 1;
            else kill += Math.round(density);

            const unclaimed = happen("Unclaim", attacker, defender, { x: chunk.x, y: chunk.y });
            if (unclaimed && unclaimed.marker && warStats) {
                warStats.destroyed.push(unclaimed.marker);
            }

            if (!defender.end && Math.random() < 0.5) {
                chunk.v.s = attacker.id;
                attacker.size = (attacker.size || 0) + 1;
            }
            happen("UpdateCenter", null, attacker);
            happen("UpdateCenter", null, defender);
        }

        if (kill && !defender.end) {
            const deaths = happen("Death", null, defender, { count: kill, cause: "war" }).count;
            if (warStats) warStats.deaths += deaths;
        }
    }

    function processCoalitionWar(process) {
        if (!process || !process.towns || process.towns.length < 2) {
            happen("Finish", null, process);
            return true;
        }

        ensureWarSides(process);
        let sideA = getWarSideTowns(process, 0);
        let sideB = getWarSideTowns(process, 1);
        if (sideA.length === 0 || sideB.length === 0) {
            const winnerSide = sideA.length ? 0 : 1;
            endCoalitionWar(process, winnerSide, "victory");
            return true;
        }

        const age = planet.day - (process.start || planet.day);
        const relationStats = getSideRelationStats(sideA, sideB);
        if (age >= COALITION_WAR_CONFIG.peaceMinDays &&
            relationStats.positiveRatio >= COALITION_WAR_CONFIG.peaceRelationRatio) {
            endCoalitionWar(process, null, "peace");
            return true;
        }

        const participation = {};
        const sides = [sideA, sideB];
        const warStats = { deaths: 0, destroyed: [] };

        for (let s = 0; s < sides.length; s++) {
            const towns = sides[s];
            const enemies = sides[s === 0 ? 1 : 0];
            for (let i = 0; i < towns.length; i++) {
                const town = towns[i];
                participation[town.id] = computeWarParticipation(town, enemies, process);
            }
            handleAllyInvolvement(process, s, participation);

            for (let i = 0; i < towns.length; i++) {
                const town = towns[i];
                const participateChance = clampValue(COALITION_WAR_CONFIG.participationBase * (participation[town.id] || 0.5), 0.1, 0.85);
                if (Math.random() > participateChance) continue;

                const target = chooseEnemyTarget(town, enemies);
                if (!target) continue;

                happen("AddRelation", town, target, { amount: -0.1 });
                happen("Influence", null, town, { happy: -0.1, temp: true });
                happen("Influence", null, target, { happy: -0.1, temp: true });

                performLateWarAttack(town, target, participation[town.id], warStats);
            }
        }

        sideA = getWarSideTowns(process, 0);
        sideB = getWarSideTowns(process, 1);
        if (sideA.length === 0 || sideB.length === 0) {
            const winnerSide = sideA.length ? 0 : 1;
            endCoalitionWar(process, winnerSide, "victory");
            return true;
        }

        if (age >= COALITION_WAR_CONFIG.surrenderMinDays) {
            const strengthA = getWarSideStrength(sideA, false);
            const strengthB = getWarSideStrength(sideB, false);
            if (strengthA > 0 && strengthB > 0) {
                if (strengthA < strengthB * COALITION_WAR_CONFIG.surrenderThreshold && Math.random() < COALITION_WAR_CONFIG.surrenderChance) {
                    endCoalitionWar(process, 1, "victory");
                    return true;
                }
                if (strengthB < strengthA * COALITION_WAR_CONFIG.surrenderThreshold && Math.random() < COALITION_WAR_CONFIG.surrenderChance) {
                    endCoalitionWar(process, 0, "victory");
                    return true;
                }
            }
        }

        if (warStats.deaths) {
            process.deaths = (process.deaths || 0) + warStats.deaths;
            logMessage(
                `War between ${commaList(process.towns.map((t) => `{{regname:town|${t}}}`))} kills ${warStats.deaths}.` +
                (warStats.destroyed.length ? " " + commaList(warStats.destroyed.map((id) => `{{regname:marker|${id}}}`)) + " " + (warStats.destroyed.length === 1 ? "was" : "were") + " destroyed." : "")
            , "warning");
        }

        return false;
    }

    if (typeof metaEvents !== "undefined" && metaEvents.processWar && typeof metaEvents.processWar.func === "function" &&
        !metaEvents.processWar.func._paultendoEarlyWar) {
        const baseProcessWar = metaEvents.processWar.func;
        metaEvents.processWar.func = function(subject, target, args) {
            const hasSides = ensureWarSides(subject);
            if (hasSides) {
                if (isEarlyWarProcess(subject)) {
                    processEarlyWar(subject);
                    return;
                }
                processCoalitionWar(subject);
                return;
            }
            return baseProcessWar(subject, target, args);
        };
        metaEvents.processWar.func._paultendoEarlyWar = true;
    }

    // -------------------------------------------------------------------------
    // Player Sway - Government Manipulation
    // -------------------------------------------------------------------------

    modEvent("swayGovernmentChange", {
        random: true,
        weight: $c.VERY_RARE,
        subject: { reg: "player", id: 1 },
        target: { reg: "town", random: true },
        value: (subject, target, args) => {
            if ((target.influences.faith || 0) < 0) return false;

            const available = getAvailableGovernments(target);
            if (available.length === 0) return false;

            args.newGov = choose(available);
            args.oldGov = getTownGovernment(target);
            args.successChance = 0.25;
            args.successChance += (target.influences.faith || 0) * 0.05;
            args.successChance = clampChance(args.successChance, 0.05, 0.60);
            return true;
        },
        message: (subject, target, args) => {
            return `{{regname:town|${target.id}}} is ${args.oldGov.description}. You could {{c:guide|encourage|inspire}} them toward a {{b:${args.newGov.name}}}...`;
        },
        func: (subject, target, args) => {
            const success = Math.random() < args.successChance;
            args.success = success;

            if (success) {
                applyGovernmentType(target, args.newGov.id);
                happen("Influence", subject, target, { faith: 1 });
            } else {
                happen("Influence", subject, target, { faith: -2 });
            }
        },
        messageDone: (subject, target, args) => {
            if (args.success) {
                return `{{regname:town|${target.id}}} transforms into a {{b:${args.newGov.name}}}. A new era begins.`;
            }
            return `{{residents:${target.id}}} {{c:resist|reject|refuse}} change. Your influence {{c:wanes|fades|weakens}}.`;
        },
        messageNo: () => `You let them find their own path.`
    });

    // Incite revolution against a government type
    modEvent("swayRevolution", {
        random: true,
        weight: $c.VERY_RARE,
        subject: { reg: "player", id: 1 },
        target: { reg: "town", random: true },
        value: (subject, target, args) => {
            if ((target.influences.faith || 0) < 1) return false;

            const currentGov = getTownGovernment(target);
            // Can only incite revolution against certain types
            if (!["monarchy", "oligarchy", "theocracy"].includes(currentGov.id)) return false;

            const available = getAvailableGovernments(target);
            const revolutionary = available.filter(g =>
                g.id === "democracy" || g.id === "republic" || g.id === "anarchy"
            );
            if (revolutionary.length === 0) return false;

            args.newGov = choose(revolutionary);
            args.oldGov = currentGov;
            args.successChance = 0.20;
            args.successChance += (target.influences.education || 0) * 0.03;
            args.successChance += (target.influences.crime || 0) * 0.02;
            args.successChance -= (target.influences.military || 0) * 0.02;
            args.successChance = clampChance(args.successChance, 0.05, 0.50);
            return true;
        },
        message: (subject, target, args) => {
            return `{{regname:town|${target.id}}}'s {{b:${args.oldGov.name}}} could be overthrown. You could {{c:whisper|encourage|inspire}} thoughts of {{b:${args.newGov.name}}}...`;
        },
        func: (subject, target, args) => {
            const success = Math.random() < args.successChance;
            args.success = success;

            if (success) {
                applyGovernmentType(target, args.newGov.id);
                // Revolution is violent
                happen("Influence", subject, target, { happy: -2, crime: 1, military: -1 });
                logMessage(`Revolution in {{regname:town|${target.id}}}! The {{b:${args.oldGov.name}}} falls. A {{b:${args.newGov.name}}} rises.`, "warning");
            } else {
                happen("Influence", subject, target, { faith: -3 });
                happen("Influence", subject, target, { military: 1, crime: -1 });
                logMessage(`The {{b:${args.oldGov.name}}} of {{regname:town|${target.id}}} {{c:crushes|suppresses|quells}} the uprising. Your meddling is {{c:suspected|discovered|known}}.`, "warning");
            }
        },
        messageDone: (subject, target, args) => {
            if (args.success) {
                return `The old order crumbles. {{regname:town|${target.id}}} embraces {{b:${args.newGov.name}}}.`;
            }
            return null;
        },
        messageNo: () => `You leave politics to the people.`
    });

    // -------------------------------------------------------------------------
    // Specialization boosts tech progress
    // -------------------------------------------------------------------------

    // When a town gains a relevant specialization, it can boost global research
    modEvent("specializationResearchBoost", {
        daily: true,
        subject: { reg: "town", all: true },
        value: (subject, target, args) => {
            const specs = getTownSpecializations(subject);
            if (specs.length === 0) return false;

            // 2% daily chance per specialization
            if (Math.random() > 0.02 * specs.length) return false;

            // Pick a specialization that could boost research
            const boostableSpecs = specs.filter(s => {
                if (s.influence === "education" && planet.unlocks.education < 80) return true;
                if (s.influence === "trade" && planet.unlocks.trade < 80) return true;
                if (s.influence === "military" && planet.unlocks.military < 90) return true;
                if (s.influence === "faith" && (planet.unlocks.faith || 0) < 50) return true;
                return false;
            });

            if (boostableSpecs.length === 0) return false;

            args.spec = choose(boostableSpecs);
            return true;
        },
        func: (subject, target, args) => {
            // Boost the relevant influence globally, which speeds tech progress
            const influence = args.spec.influence;
            const amount = 0.5;

            // Apply to all towns
            const towns = regFilter("town", t => !t.end && t.pop > 0);
            for (const town of towns) {
                town.influences[influence] = (town.influences[influence] || 0) + amount * 0.2;
            }

            if (Math.random() < 0.15) {
                logMessage(`Scholars from {{regname:town|${subject.id}}}'s {{b:${args.spec.name}}} advance the world's understanding of ${influence}.`);
            }
        }
    });

    // =========================================================================
    // EXTENDED JOBS SYSTEM
    // Adds new jobs tied to the extended tech tree
    // =========================================================================

    // Register new jobs by extending the global arrays
    // Jobs: merchant, priest, scholar, doctor, craftsman, builder, sailor

    function initExtendedJobs() {
        // Only add once
        if (window._paultendoJobsInit) return;
        window._paultendoJobsInit = true;

        // Add new jobs to defaultJobs
        if (!defaultJobs.includes("merchant")) defaultJobs.push("merchant");
        if (!defaultJobs.includes("priest")) defaultJobs.push("priest");
        if (!defaultJobs.includes("scholar")) defaultJobs.push("scholar");
        if (!defaultJobs.includes("doctor")) defaultJobs.push("doctor");
        if (!defaultJobs.includes("craftsman")) defaultJobs.push("craftsman");
        if (!defaultJobs.includes("builder")) defaultJobs.push("builder");
        if (!defaultJobs.includes("sailor")) defaultJobs.push("sailor");

        // Job influences - what influence each job contributes to
        jobInfluences.merchant = "trade";
        jobInfluences.priest = "faith";
        jobInfluences.scholar = "education";
        jobInfluences.doctor = null; // Special handling - reduces disease
        jobInfluences.craftsman = "trade";
        jobInfluences.builder = null;
        jobInfluences.sailor = "travel";

        // Job unlock requirements - [unlock branch, level required]
        jobNeedsUnlock.merchant = ["trade", 10];
        jobNeedsUnlock.priest = ["faith", 20];
        jobNeedsUnlock.scholar = ["education", 20];
        jobNeedsUnlock.doctor = ["education", 40];
        jobNeedsUnlock.craftsman = ["trade", 70]; // Guilds
        jobNeedsUnlock.builder = ["smith", 60]; // Architecture
        jobNeedsUnlock.sailor = ["travel", 60]; // Sailing Ships
    }

    // Initialize jobs on load
    initExtendedJobs();

    // -------------------------------------------------------------------------
    // Doctor Job Special Effect - Reduces disease in town
    // -------------------------------------------------------------------------

    modEvent("doctorEffect", {
        daily: true,
        subject: { reg: "town", all: true },
        value: (subject, target, args) => {
            const doctors = subject.jobs?.doctor || 0;
            if (doctors <= 0) return false;
            args.doctors = doctors;
            return true;
        },
        func: (subject, target, args) => {
            // Each doctor reduces disease slightly
            // Diminishing returns - first doctors help most
            const reduction = Math.min(2, args.doctors * 0.1);
            subject.influences.disease = (subject.influences.disease || 0) - reduction;

            // Clamp to min influence
            subject.influences.disease = Math.max($c.minInfluence, subject.influences.disease);
        }
    });

    // -------------------------------------------------------------------------
    // Builder Job Special Effect - Speeds construction/repairs
    // -------------------------------------------------------------------------

    modEvent("builderEffect", {
        daily: true,
        subject: { reg: "town", all: true },
        value: (subject, target, args) => {
            const builders = subject.jobs?.builder || 0;
            if (builders <= 0) return false;

            // Builders help recover from disasters
            if (!hasIssue(subject, "disaster")) return false;

            args.builders = builders;
            return true;
        },
        func: (subject, target, args) => {
            // Chance to speed up disaster recovery
            const speedChance = Math.min(0.3, args.builders * 0.05);
            if (Math.random() < speedChance) {
                const disaster = regGet("process", subject.issues.disaster);
                if (disaster && disaster.duration) {
                    disaster.duration = Math.max(1, disaster.duration - 1);
                }
            }
        }
    });

    // =========================================================================
    // HEALTH & DISEASE IMPROVEMENTS
    // Epidemics, contagion, hospitals that work, quarantine
    // =========================================================================

    // Track active epidemics on planet
    function initEpidemics() {
        if (!planet.epidemics) {
            planet.epidemics = []; // { id, name, severity, originTownId, affectedTowns: [], startDay }
            planet.nextEpidemicId = 1;
        }
    }

    // Epidemic definitions
    const EPIDEMIC_TYPES = {
        plague: {
            name: "Plague",
            baseSeverity: 3,
            spreadRate: 0.15,
            duration: [20, 40],
            diseaseInfluence: 4,
            deathMultiplier: 2.0,
            description: "A deadly plague"
        },
        fever: {
            name: "Fever",
            baseSeverity: 1,
            spreadRate: 0.25,
            duration: [10, 20],
            diseaseInfluence: 2,
            deathMultiplier: 1.3,
            description: "A sweeping fever"
        },
        pox: {
            name: "Pox",
            baseSeverity: 2,
            spreadRate: 0.20,
            duration: [15, 30],
            diseaseInfluence: 3,
            deathMultiplier: 1.5,
            description: "A disfiguring pox"
        },
        flux: {
            name: "Flux",
            baseSeverity: 1,
            spreadRate: 0.30,
            duration: [8, 15],
            diseaseInfluence: 2,
            deathMultiplier: 1.2,
            description: "A debilitating flux"
        },
        consumption: {
            name: "Consumption",
            baseSeverity: 2,
            spreadRate: 0.10,
            duration: [30, 60],
            diseaseInfluence: 2,
            deathMultiplier: 1.4,
            description: "A wasting consumption"
        }
    };

    const EPIDEMIC_COLORS = {
        plague: [90, 170, 120],
        fever: [120, 200, 130],
        pox: [160, 150, 200],
        consumption: [110, 170, 200]
    };

    // Check if a town has an active epidemic
    function getTownEpidemic(town) {
        initEpidemics();
        return planet.epidemics.find(e => e.affectedTowns.includes(town.id));
    }

    // Check if town is quarantined
    function isQuarantined(town) {
        return town.quarantine === true;
    }

    // Get town's disease resistance (doctors, hospitals, medicine tech)
    function getDiseaseResistance(town) {
        let resistance = 0;

        // Doctors help
        const doctors = town.jobs?.doctor || 0;
        resistance += doctors * 0.5;

        // Hospitals help
        const hospitals = getTownHospitals(town);
        resistance += hospitals.length * 1.0;

        // Medicine tech helps
        if (planet.unlocks.education >= 80) resistance += 2;

        // Scientific Method helps
        if (planet.unlocks.education >= 70) resistance += 1;

        // Cooking helps
        if (planet.unlocks.fire >= 20) resistance += 0.5;

        return resistance;
    }

    // Start a new epidemic
    function startEpidemic(originTown, type) {
        initEpidemics();
        const epidemicDef = EPIDEMIC_TYPES[type];
        if (!epidemicDef) return null;

        const duration = epidemicDef.duration[0] +
            Math.floor(Math.random() * (epidemicDef.duration[1] - epidemicDef.duration[0]));

        const epidemic = {
            id: planet.nextEpidemicId++,
            type: type,
            name: epidemicDef.name,
            severity: epidemicDef.baseSeverity,
            originTownId: originTown.id,
            affectedTowns: [originTown.id],
            startDay: planet.day,
            endDay: planet.day + duration,
            diseaseInfluence: epidemicDef.diseaseInfluence,
            deathMultiplier: epidemicDef.deathMultiplier,
            spreadRate: epidemicDef.spreadRate,
            color: EPIDEMIC_COLORS[type] || [110, 180, 140],
            spreadLog: []
        };

        planet.epidemics.push(epidemic);
        return epidemic;
    }

    // End an epidemic
    function endEpidemic(epidemic) {
        initEpidemics();
        planet.epidemics = planet.epidemics.filter(e => e.id !== epidemic.id);

        // Remove disease influence from affected towns
        for (const townId of epidemic.affectedTowns) {
            const town = regGet("town", townId);
            if (town && !town.end) {
                town.influences.disease = (town.influences.disease || 0) - epidemic.diseaseInfluence;
            }
        }
    }

    // Spread epidemic to a new town
    function spreadEpidemicTo(epidemic, town, sourceTown) {
        if (epidemic.affectedTowns.includes(town.id)) return false;

        // Check resistance
        const resistance = getDiseaseResistance(town);
        const spreadChance = epidemic.spreadRate - (resistance * 0.02);

        if (Math.random() > spreadChance) return false;

        epidemic.affectedTowns.push(town.id);
        town.influences.disease = (town.influences.disease || 0) + epidemic.diseaseInfluence;
        if (sourceTown) {
            epidemic.spreadLog = epidemic.spreadLog || [];
            epidemic.spreadLog.push({ from: sourceTown.id, to: town.id, day: planet.day });
        }

        return true;
    }

    // -------------------------------------------------------------------------
    // Epidemic Events
    // -------------------------------------------------------------------------

    // Epidemics can spontaneously start
    modEvent("epidemicStart", {
        random: true,
        weight: $c.VERY_RARE,
        subject: { reg: "player", id: 1 },
        target: { reg: "town", random: true },
        value: (subject, target, args) => {
            initEpidemics();

            // Less likely if already epidemics active
            if (planet.epidemics.length >= 2) return false;

            // More likely with high travel/trade, dense population
            let chance = 0.3;
            chance += (target.influences.travel || 0) * 0.03;
            chance += (target.influences.trade || 0) * 0.02;
            chance += (target.pop / 100) * 0.05;
            chance -= getDiseaseResistance(target) * 0.05;

            if (Math.random() > chance) return false;

            // Pick epidemic type
            const types = Object.keys(EPIDEMIC_TYPES);
            args.type = choose(types);
            args.epidemicDef = EPIDEMIC_TYPES[args.type];

            return true;
        },
        message: (subject, target, args) => {
            return `${args.epidemicDef.description} emerges in {{regname:town|${target.id}}}. Should efforts be made to contain it?`;
        },
        func: (subject, target, args) => {
            const epidemic = startEpidemic(target, args.type);
            args.epidemic = epidemic;

            // Apply initial disease influence
            target.influences.disease = (target.influences.disease || 0) + epidemic.diseaseInfluence;

            logMessage(`{{b:${epidemic.name}}} breaks out in {{regname:town|${target.id}}}!`, "warning");
        },
        messageDone: (subject, target, args) => {
            return `Quarantine measures are attempted, but the {{b:${args.epidemic.name}}} takes hold.`;
        },
        messageNo: (subject, target, args) => {
            // Saying no still starts epidemic but with slightly higher severity
            const epidemic = startEpidemic(target, args.type);
            epidemic.severity += 0.5;
            epidemic.spreadRate += 0.05;

            target.influences.disease = (target.influences.disease || 0) + epidemic.diseaseInfluence;

            logMessage(`{{b:${epidemic.name}}} spreads unchecked in {{regname:town|${target.id}}}!`, "warning");
            return `Without containment, the {{b:${epidemic.name}}} worsens.`;
        }
    });

    // Epidemics spread between towns
    modEvent("epidemicSpread", {
        daily: true,
        subject: { reg: "town", all: true },
        value: (subject, target, args) => {
            initEpidemics();
            if (planet.epidemics.length === 0) return false;

            // Check if this town is NOT infected but a neighbor is
            const epidemic = planet.epidemics.find(e => !e.affectedTowns.includes(subject.id));
            if (!epidemic) return false;

            // Find an infected neighbor
            const infectedNeighbor = regFilter("town", t => {
                if (t.id === subject.id || t.end) return false;
                if (!epidemic.affectedTowns.includes(t.id)) return false;
                // Check if nearby (simplified - could use actual distance)
                return true;
            });

            if (infectedNeighbor.length === 0) return false;

            args.epidemic = epidemic;
            args.source = choose(infectedNeighbor);
            return true;
        },
        func: (subject, target, args) => {
            // Check for quarantine
            if (isQuarantined(subject)) {
                // Quarantine reduces spread significantly
                if (Math.random() > 0.1) return;
            }
            if (isQuarantined(args.source)) {
                if (Math.random() > 0.2) return;
            }

            // Trade routes increase spread
            let spreadBonus = 0;
            const relation = subject.relations[args.source.id] || 0;
            if (relation > 0) spreadBonus += 0.05;
            if ((subject.influences.trade || 0) > 3) spreadBonus += 0.05;
            if ((subject.influences.travel || 0) > 3) spreadBonus += 0.05;

            // Alliance increases spread
            if (areAllied(subject, args.source)) spreadBonus += 0.05;

            // Embargo reduces spread
            if (hasEmbargo(subject, args.source)) spreadBonus -= 0.10;

            const baseSpread = args.epidemic.spreadRate + spreadBonus;
            const resistance = getDiseaseResistance(subject);
            const finalChance = Math.max(0.01, baseSpread - (resistance * 0.03));

            if (Math.random() < finalChance) {
                spreadEpidemicTo(args.epidemic, subject, args.source);
                logMessage(`The {{b:${args.epidemic.name}}} spreads to {{regname:town|${subject.id}}} from {{regname:town|${args.source.id}}}.`, "warning");
            }
        }
    });

    // Epidemics end naturally over time
    modEvent("epidemicEnd", {
        daily: true,
        subject: { reg: "town", all: true },
        value: (subject, target, args) => {
            initEpidemics();
            if (planet.epidemics.length === 0) return false;

            // Find an epidemic that has passed its end day
            const endingEpidemic = planet.epidemics.find(e => planet.day >= e.endDay);
            if (!endingEpidemic) return false;

            // Only process once
            if (endingEpidemic._ending) return false;
            endingEpidemic._ending = true;

            args.epidemic = endingEpidemic;
            return true;
        },
        func: (subject, target, args) => {
            endEpidemic(args.epidemic);
            logMessage(`The {{b:${args.epidemic.name}}} finally subsides. The survivors recover.`, "milestone");
        }
    });

    // -------------------------------------------------------------------------
    // Epidemic Map Visualization (overlay + spread lines)
    // -------------------------------------------------------------------------

    function renderEpidemicOverlay() {
        if (!planet || !planet.epidemics || planet.epidemics.length === 0) return;
        if (!canvasLayersCtx || !canvasLayersCtx.terrain) return;
        if (typeof chunkSize === "undefined") return;
        if (typeof filterChunks !== "function") return;

        const ctx = canvasLayersCtx.terrain;
        const size = chunkSize;

        planet.epidemics.forEach((epidemic) => {
            if (!epidemic || !Array.isArray(epidemic.affectedTowns) || epidemic.affectedTowns.length === 0) return;

            const color = epidemic.color || [110, 180, 140];
            const alpha = Math.min(0.15 + (epidemic.severity || 1) * 0.08, 0.5);
            ctx.fillStyle = `rgba(${color.join(",")}, ${alpha})`;

            epidemic.affectedTowns.forEach((townId) => {
                const town = regGet("town", townId);
                if (!town || town.end) return;
                const chunks = filterChunks(c => c.v.s === town.id);
                for (let i = 0; i < chunks.length; i++) {
                    const c = chunks[i];
                    ctx.fillRect(c.x * size, c.y * size, size, size);
                }
            });

            if (Array.isArray(epidemic.spreadLog) && epidemic.spreadLog.length > 0) {
                const recent = epidemic.spreadLog.filter(s => (planet.day - s.day) <= 20);
                if (recent.length > 0) {
                    ctx.strokeStyle = `rgba(${color.join(",")}, 0.6)`;
                    ctx.lineWidth = Math.max(1, Math.floor(size / 4));
                    for (let i = 0; i < recent.length; i++) {
                        const step = recent[i];
                        const fromTown = regGet("town", step.from);
                        const toTown = regGet("town", step.to);
                        if (!fromTown || !toTown || fromTown.end || toTown.end) continue;
                        if (typeof fromTown.x !== "number" || typeof fromTown.y !== "number") continue;
                        if (typeof toTown.x !== "number" || typeof toTown.y !== "number") continue;
                        ctx.beginPath();
                        ctx.moveTo((fromTown.x + 0.5) * size, (fromTown.y + 0.5) * size);
                        ctx.lineTo((toTown.x + 0.5) * size, (toTown.y + 0.5) * size);
                        ctx.stroke();
                    }
                }
            }
        });
    }

    if (typeof renderMap === "function" && !renderMap._paultendoEpidemicOverlay) {
        const baseRenderMap = renderMap;
        const wrappedRenderMap = function() {
            baseRenderMap();
            try { renderEpidemicOverlay(); } catch {}
            try { renderDiscoveryFog(); } catch {}
            try { renderMarkers(); } catch {}
        };
        wrappedRenderMap._paultendoEpidemicOverlay = true;
        wrappedRenderMap._paultendoBase = baseRenderMap;
        renderMap = wrappedRenderMap;
    }

    // Epidemics cause extra deaths
    modEvent("epidemicDeaths", {
        daily: true,
        subject: { reg: "town", all: true },
        value: (subject, target, args) => {
            const epidemic = getTownEpidemic(subject);
            if (!epidemic) return false;

            args.epidemic = epidemic;
            return true;
        },
        func: (subject, target, args) => {
            // Extra deaths based on epidemic severity and town conditions
            const baseDeath = 0.005 * args.epidemic.severity;
            const resistance = getDiseaseResistance(subject);
            const deathRate = Math.max(0.001, baseDeath - (resistance * 0.001));

            const deaths = Math.floor(subject.pop * deathRate);
            if (deaths > 0) {
                happen("Death", null, subject, { count: deaths, cause: "epidemic" });

                // Occasionally log
                if (Math.random() < 0.1) {
                    logMessage(`The {{b:${args.epidemic.name}}} claims ${deaths} in {{regname:town|${subject.id}}}.`);
                }
            }
        }
    });

    // -------------------------------------------------------------------------
    // Quarantine System
    // -------------------------------------------------------------------------

    // Player can suggest quarantine
    modEvent("swayQuarantine", {
        random: true,
        weight: $c.UNCOMMON,
        subject: { reg: "player", id: 1 },
        target: { reg: "town", random: true },
        value: (subject, target, args) => {
            initEpidemics();

            // Only offer during epidemics
            if (planet.epidemics.length === 0) return false;

            // Town must be infected or at risk
            const epidemic = getTownEpidemic(target);
            const atRisk = !epidemic && planet.epidemics.some(e =>
                e.affectedTowns.some(id => {
                    const t = regGet("town", id);
                    return t && !t.end;
                })
            );

            if (!epidemic && !atRisk) return false;
            if (isQuarantined(target)) return false;

            args.epidemic = epidemic;
            args.atRisk = atRisk;
            args.successChance = 0.50;
            args.successChance += (target.influences.faith || 0) * 0.05;
            args.successChance -= (target.influences.trade || 0) * 0.03;
            args.successChance = clampChance(args.successChance, 0.20, 0.80);
            return true;
        },
        message: (subject, target, args) => {
            if (args.epidemic) {
                return `{{regname:town|${target.id}}} suffers from {{b:${args.epidemic.name}}}. You could suggest they {{c:quarantine|isolate|close their gates}}...`;
            }
            return `Disease spreads nearby. You could suggest {{regname:town|${target.id}}} {{c:quarantine|isolate|close their gates}}...`;
        },
        func: (subject, target, args) => {
            const success = Math.random() < args.successChance;
            args.success = success;

            if (success) {
                target.quarantine = true;
                target.quarantineDay = planet.day;
                happen("Influence", subject, target, { trade: -2, travel: -2, happy: -1 });
                logMessage(`{{regname:town|${target.id}}} {{c:closes its gates|enters quarantine|isolates itself}}.`);
            } else {
                happen("Influence", subject, target, { faith: -1 });
            }
        },
        messageDone: (subject, target, args) => {
            if (args.success) {
                return `Trade halts, but the spread may slow.`;
            }
            return `{{residents:${target.id}}} {{c:refuse|reject|won't accept}} isolation. Commerce continues.`;
        },
        messageNo: () => `You let them decide their own fate.`
    });

    // Quarantine ends naturally after epidemic passes or by choice
    modEvent("quarantineEnd", {
        daily: true,
        subject: { reg: "town", all: true },
        value: (subject, target, args) => {
            if (!isQuarantined(subject)) return false;

            // End quarantine if no active epidemics affect this town
            const epidemic = getTownEpidemic(subject);
            if (epidemic) return false;

            // Or if quarantine has been active for a while
            const daysQuarantined = planet.day - (subject.quarantineDay || 0);
            if (daysQuarantined < 10) return false;

            return true;
        },
        func: (subject, target, args) => {
            subject.quarantine = false;
            delete subject.quarantineDay;

            // Restore some trade/travel
            happen("Influence", null, subject, { trade: 1, travel: 1 });

            logMessage(`{{regname:town|${subject.id}}} {{c:opens its gates|ends quarantine|rejoins the world}}.`);
        }
    });

    // -------------------------------------------------------------------------
    // Hospital Improvements - Actually heal injured people
    // -------------------------------------------------------------------------

    // Hospitals heal injuries over time
    modEvent("hospitalHealing", {
        daily: true,
        subject: { reg: "town", all: true },
        value: (subject, target, args) => {
            // Need injuries to heal
            if (!subject.injuries || subject.injuries <= 0) return false;

            // Need a hospital or doctors
            const hospitals = getTownHospitals(subject);
            const doctors = subject.jobs?.doctor || 0;

            if (hospitals.length === 0 && doctors === 0) return false;

            args.hospitals = hospitals.length;
            args.doctors = doctors;
            args.injuries = subject.injuries;
            return true;
        },
        func: (subject, target, args) => {
            // Healing rate based on doctors and hospitals
            let healRate = 0.05; // Base 5% of injuries heal per day
            healRate += args.hospitals * 0.05;
            healRate += args.doctors * 0.02;

            // Medicine tech helps
            if (planet.unlocks.education >= 80) healRate += 0.10;

            const healed = Math.max(1, Math.floor(args.injuries * healRate));
            subject.injuries = Math.max(0, subject.injuries - healed);

            // Occasionally log
            if (Math.random() < 0.05 && healed > 1) {
                logMessage(`${healed} injured recover in {{regname:town|${subject.id}}}'s care.`);
            }
        }
    });

    // Doctors reduce death rate during disasters
    modEvent("doctorDisasterHelp", {
        daily: true,
        subject: { reg: "town", all: true },
        value: (subject, target, args) => {
            if (!hasIssue(subject, "disaster")) return false;

            const doctors = subject.jobs?.doctor || 0;
            if (doctors === 0) return false;

            args.doctors = doctors;
            return true;
        },
        func: (subject, target, args) => {
            // Doctors save some lives during disasters
            // This works by giving a small happy/disease boost during disaster
            const bonus = Math.min(1, args.doctors * 0.1);
            subject.influences.disease = (subject.influences.disease || 0) - bonus;
        }
    });

    // -------------------------------------------------------------------------
    // Healthcare Policy Events
    // -------------------------------------------------------------------------

    // Towns can establish public healthcare
    modEvent("establishHealthcare", {
        random: true,
        weight: $c.RARE,
        subject: { reg: "player", id: 1 },
        target: { reg: "town", random: true },
        value: (subject, target, args) => {
            if ((target.influences.faith || 0) < -2) return false;
            if (planet.unlocks.education < 40) return false; // Need Libraries
            if (target.publicHealthcare) return false;
            if ((target.pop || 0) < 80) return false;
            if (!canReceiveGuidance(target, "publicHealthcare", 60)) return false;

            args.successChance = 0.40;
            args.successChance += (target.influences.education || 0) * 0.05;
            args.successChance += (target.influences.faith || 0) * 0.03;

            // Government type affects it
            const gov = getTownGovernment(target);
            if (gov.id === "democracy" || gov.id === "republic") args.successChance += 0.15;
            if (gov.id === "oligarchy") args.successChance -= 0.15;

            const fatigue = guidanceFatigue(target, "publicHealthcare");
            args.successChance -= fatigue * 0.05;
            args.successChance = clampChance(args.successChance, 0.10, 0.80);
            return true;
        },
        message: (subject, target, args) => {
            return `{{regname:town|${target.id}}} could establish {{c:public healthcare|free healing|care for all}}. This would cost wealth but save lives...`;
        },
        func: (subject, target, args) => {
            const success = Math.random() < args.successChance;
            args.success = success;

            if (success) {
                target.publicHealthcare = true;
                happen("Influence", subject, target, { disease: -2, happy: 1, trade: -1 });
                happen("Influence", subject, target, { faith: 1 });
            }
            noteGuidance(target, "publicHealthcare", success);
        },
        messageDone: (subject, target, args) => {
            if (args.success) {
                return `{{regname:town|${target.id}}} establishes public healthcare. The sick are tended to.`;
            }
            return `{{regname:town|${target.id}}} decides to delay public healthcare for now.`;
        },
        messageNo: () => `Healthcare remains a private matter.`,
        funcNo: (subject, target) => {
            noteGuidance(target, "publicHealthcare", null);
        }
    });

    // Public healthcare provides ongoing benefits
    modEvent("publicHealthcareEffect", {
        daily: true,
        subject: { reg: "town", all: true },
        value: (subject, target, args) => {
            return subject.publicHealthcare === true;
        },
        func: (subject, target, args) => {
            // Small ongoing disease reduction
            if (Math.random() < 0.1) {
                subject.influences.disease = Math.max(
                    $c.minInfluence,
                    (subject.influences.disease || 0) - 0.1
                );
            }

            // Attract doctors
            if (Math.random() < 0.02 && planet.unlocks.education >= 40) {
                subject.jobs = subject.jobs || {};
                subject.jobs.doctor = (subject.jobs.doctor || 0) + 1;
            }
        }
    });

    // -------------------------------------------------------------------------
    // Disease-related sway events
    // -------------------------------------------------------------------------

    // Sway a town to build a hospital
    modEvent("swayBuildHospital", {
        random: true,
        weight: $c.UNCOMMON,
        subject: { reg: "player", id: 1 },
        target: { reg: "town", random: true },
        value: (subject, target, args) => {
            if ((target.influences.faith || 0) < -2) return false;
            if (planet.unlocks.smith < 20) return false;
            if (planet.unlocks.education < 40) return false;
            if ((target.pop || 0) < 80) return false;
            if (!canReceiveGuidance(target, "buildHospital", 45)) return false;

            // Check if they already have a hospital
            if (hasHospital(target)) return false;

            // More likely if disease is high
            const disease = target.influences.disease || 0;
            args.successChance = 0.30;
            args.successChance += disease * 0.05;
            args.successChance += (target.influences.faith || 0) * 0.05;
            const fatigue = guidanceFatigue(target, "buildHospital");
            args.successChance -= fatigue * 0.05;
            args.successChance = clampChance(args.successChance, 0.15, 0.75);
            return true;
        },
        message: (subject, target, args) => {
            return `{{regname:town|${target.id}}} lacks a hospital. You could {{c:encourage|suggest|inspire}} them to build one...`;
        },
        func: (subject, target, args) => {
            const success = Math.random() < args.successChance;
            args.success = success;

            if (success) {
                // Create a hospital marker when possible
                createHospital(target);
                happen("Influence", subject, target, { disease: -2 });
                happen("Influence", subject, target, { faith: 1 });
                logMessage(`{{regname:town|${target.id}}} {{c:builds|establishes|founds}} a hospital.`, "milestone");
            }
            noteGuidance(target, "buildHospital", success);
        },
        messageDone: (subject, target, args) => {
            if (args.success) {
                return `The sick now have a place to heal.`;
            }
            return `{{regname:town|${target.id}}} is not ready to fund a hospital yet.`;
        },
        messageNo: () => `You leave their health in their own hands.`,
        funcNo: (subject, target) => {
            noteGuidance(target, "buildHospital", null);
        }
    });

    // Sway to train doctors
    modEvent("swayTrainDoctors", {
        random: true,
        weight: $c.UNCOMMON,
        subject: { reg: "player", id: 1 },
        target: { reg: "town", random: true },
        value: (subject, target, args) => {
            if ((target.influences.faith || 0) < -1) return false;
            if (planet.unlocks.education < 40 && (target.influences.faith || 0) < 4) return false;
            if (!canReceiveGuidance(target, "trainHealers", 25)) return false;

            const doctors = target.jobs?.doctor || 0;
            if (doctors >= 5) return false; // Enough doctors

            args.currentDoctors = doctors;
            args.successChance = 0.40;
            args.successChance += (target.influences.education || 0) * 0.05;
            args.successChance += (target.influences.faith || 0) * 0.03;
            const fatigue = guidanceFatigue(target, "trainHealers");
            args.successChance -= fatigue * 0.05;
            args.successChance = clampChance(args.successChance, 0.20, 0.80);
            return true;
        },
        message: (subject, target, args) => {
            if (args.currentDoctors === 0) {
                return `{{regname:town|${target.id}}} has no trained healers. You could {{c:encourage|suggest|inspire}} them to train doctors...`;
            }
            return `{{regname:town|${target.id}}} could use more healers. You could {{c:encourage|suggest|inspire}} medical training...`;
        },
        func: (subject, target, args) => {
            const success = Math.random() < args.successChance;
            args.success = success;

            if (success) {
                target.jobs = target.jobs || {};
                target.jobs.doctor = (target.jobs.doctor || 0) + 1;
                happen("Influence", subject, target, { education: 0.5 });
            }
            noteGuidance(target, "trainHealers", success);
        },
        messageDone: (subject, target, args) => {
            if (args.success) {
                return `A new healer begins training in {{regname:town|${target.id}}}.`;
            }
            return `{{regname:town|${target.id}}} delays expanding healer training for now.`;
        },
        messageNo: () => `You let them choose their own trades.`,
        funcNo: (subject, target) => {
            noteGuidance(target, "trainHealers", null);
        }
    });

    // =========================================================================
    // CULTURE SYSTEM
    // Towns develop cultural identities, produce art, hold festivals
    // Culture affects happiness, migration, relations, and soft power
    // =========================================================================

    const ART_LOG_TOWN_COOLDOWN_DAYS = 20;
    const ART_LOG_GLOBAL_MAX_PER_DAY = 2;

    function initArtLogState() {
        if (!planet._paultendoArtLog) {
            planet._paultendoArtLog = { day: planet.day, count: 0 };
        }
        if (planet._paultendoArtLog.day !== planet.day) {
            planet._paultendoArtLog.day = planet.day;
            planet._paultendoArtLog.count = 0;
        }
    }

    function canLogArtMessage(town) {
        initArtLogState();
        if (planet._paultendoArtLog.count >= ART_LOG_GLOBAL_MAX_PER_DAY) return false;
        if (!town) return true;
        if (!town._paultendoArtLog) {
            town._paultendoArtLog = { lastDay: -999 };
        }
        return (planet.day - town._paultendoArtLog.lastDay) >= ART_LOG_TOWN_COOLDOWN_DAYS;
    }

    function noteArtMessage(town) {
        initArtLogState();
        planet._paultendoArtLog.count += 1;
        if (town) {
            if (!town._paultendoArtLog) town._paultendoArtLog = { lastDay: planet.day };
            town._paultendoArtLog.lastDay = planet.day;
        }
    }

    function logArtMessage(town, message, type) {
        if (!message) return false;
        if (!canLogArtMessage(town)) return false;
        const result = logMessage(message, type);
        noteArtMessage(town);
        return result;
    }

    // Cultural tradition types - each town can develop these
    const CULTURAL_TRADITIONS = {
        music: {
            name: "Musical",
            description: "known for song and melody",
            icon: "♪",
            happyBonus: 1,
            attractiveness: 2
        },
        art: {
            name: "Artistic",
            description: "celebrated for visual arts",
            icon: "🎨",
            happyBonus: 1,
            attractiveness: 2
        },
        literary: {
            name: "Literary",
            description: "home to poets and writers",
            icon: "📜",
            happyBonus: 0.5,
            attractiveness: 1,
            educationBonus: 1
        },
        theatrical: {
            name: "Theatrical",
            description: "famous for drama and performance",
            icon: "🎭",
            happyBonus: 1.5,
            attractiveness: 3
        },
        culinary: {
            name: "Culinary",
            description: "renowned for fine cuisine",
            icon: "🍷",
            happyBonus: 1,
            attractiveness: 2,
            tradeBonus: 0.5
        },
        martial: {
            name: "Martial",
            description: "proud of warrior traditions",
            icon: "⚔",
            happyBonus: 0.5,
            attractiveness: 1,
            militaryBonus: 1
        },
        crafts: {
            name: "Artisanal",
            description: "masters of fine crafts",
            icon: "⚒",
            happyBonus: 0.5,
            attractiveness: 1,
            tradeBonus: 1
        },
        spiritual: {
            name: "Spiritual",
            description: "steeped in mysticism",
            icon: "✦",
            happyBonus: 0.5,
            attractiveness: 2,
            faithBonus: 1
        },
        festive: {
            name: "Festive",
            description: "always celebrating",
            icon: "🎉",
            happyBonus: 2,
            attractiveness: 3
        },
        scholarly: {
            name: "Scholarly",
            description: "devoted to learning",
            icon: "📚",
            happyBonus: 0.5,
            attractiveness: 1,
            educationBonus: 2
        }
    };

    // Initialize culture for a town
    function initTownCulture(town) {
        if (!town.culture) {
            town.culture = {
                traditions: {}, // { traditionId: strength (1-5) }
                prestige: 0,    // Cultural prestige/renown
                works: []       // Notable cultural works produced
            };
        }
    }

    // Get a town's cultural traditions
    function getTownTraditions(town) {
        initTownCulture(town);
        const traditions = [];
        for (const [id, strength] of Object.entries(town.culture.traditions)) {
            if (strength > 0 && CULTURAL_TRADITIONS[id]) {
                traditions.push({ id, strength, ...CULTURAL_TRADITIONS[id] });
            }
        }
        return traditions;
    }

    // Check if town has a tradition
    function hasTradition(town, traditionId) {
        initTownCulture(town);
        return (town.culture.traditions[traditionId] || 0) > 0;
    }

    // Add or strengthen a tradition
    function addTradition(town, traditionId, amount = 1) {
        ensureTownState(town);
        const tradition = CULTURAL_TRADITIONS[traditionId];
        if (!tradition) return false;

        const oldStrength = town.culture.traditions[traditionId] || 0;
        town.culture.traditions[traditionId] = Math.min(5, oldStrength + amount);

        // Apply bonuses when first gained
        if (oldStrength === 0 && amount > 0) {
            if (tradition.happyBonus) {
                town.influences.happy = (town.influences.happy || 0) + tradition.happyBonus;
            }
            if (tradition.educationBonus) {
                town.influences.education = (town.influences.education || 0) + tradition.educationBonus;
            }
            if (tradition.tradeBonus) {
                town.influences.trade = (town.influences.trade || 0) + tradition.tradeBonus;
            }
            if (tradition.militaryBonus) {
                town.influences.military = (town.influences.military || 0) + tradition.militaryBonus;
            }
            if (tradition.faithBonus) {
                town.influences.faith = (town.influences.faith || 0) + tradition.faithBonus;
            }
        }
        return true;
    }

    // Weaken or remove a tradition
    function weakenTradition(town, traditionId, amount = 1) {
        ensureTownState(town);
        const tradition = CULTURAL_TRADITIONS[traditionId];
        if (!tradition) return false;

        const oldStrength = town.culture.traditions[traditionId] || 0;
        if (oldStrength <= 0) return false;

        town.culture.traditions[traditionId] = Math.max(0, oldStrength - amount);

        // Remove bonuses when lost completely
        if (oldStrength > 0 && town.culture.traditions[traditionId] === 0) {
            if (tradition.happyBonus) {
                town.influences.happy = (town.influences.happy || 0) - tradition.happyBonus;
            }
            if (tradition.educationBonus) {
                town.influences.education = (town.influences.education || 0) - tradition.educationBonus;
            }
            if (tradition.tradeBonus) {
                town.influences.trade = (town.influences.trade || 0) - tradition.tradeBonus;
            }
            if (tradition.militaryBonus) {
                town.influences.military = (town.influences.military || 0) - tradition.militaryBonus;
            }
            if (tradition.faithBonus) {
                town.influences.faith = (town.influences.faith || 0) - tradition.faithBonus;
            }
        }
        return true;
    }

    // Calculate cultural attractiveness (for migration)
    function getCulturalAttractiveness(town) {
        const traditions = getTownTraditions(town);
        let attractiveness = 0;
        for (const t of traditions) {
            attractiveness += t.attractiveness * t.strength;
        }
        initTownCulture(town);
        attractiveness += town.culture.prestige * 0.5;
        return attractiveness;
    }

    // Calculate cultural similarity between two towns
    function getCulturalSimilarity(town1, town2) {
        const t1 = getTownTraditions(town1);
        const t2 = getTownTraditions(town2);

        if (t1.length === 0 || t2.length === 0) return 0;

        let shared = 0;
        for (const trad1 of t1) {
            const match = t2.find(t => t.id === trad1.id);
            if (match) {
                shared += Math.min(trad1.strength, match.strength);
            }
        }
        return shared;
    }

    // Add cultural jobs
    function initCulturalJobs() {
        if (window._paultendoCultureJobsInit) return;
        window._paultendoCultureJobsInit = true;

        if (!defaultJobs.includes("artist")) defaultJobs.push("artist");
        if (!defaultJobs.includes("musician")) defaultJobs.push("musician");
        if (!defaultJobs.includes("performer")) defaultJobs.push("performer");

        jobInfluences.artist = "happy";
        jobInfluences.musician = "happy";
        jobInfluences.performer = "happy";

        jobNeedsUnlock.artist = ["education", 20];
        jobNeedsUnlock.musician = ["education", 10];
        jobNeedsUnlock.performer = ["education", 20];
    }

    initCulturalJobs();

    // -------------------------------------------------------------------------
    // Cultural Development - Towns naturally develop traditions
    // -------------------------------------------------------------------------

    // Traditions emerge based on town character
    modEvent("traditionEmerge", {
        daily: true,
        subject: { reg: "town", all: true },
        value: (subject, target, args) => {
            initTownCulture(subject);

            // Small daily chance
            if (Math.random() > 0.01) return false;

            // Need some population and stability
            if (subject.pop < 20) return false;
            if ((subject.influences.happy || 0) < -3) return false;

            // Determine which tradition might emerge based on town's character
            const candidates = [];

            // Music and performance emerge from happiness
            if ((subject.influences.happy || 0) > 2) {
                candidates.push("music", "theatrical", "festive");
            }

            // Art emerges from education or wealth
            if ((subject.influences.education || 0) > 2 || (subject.influences.trade || 0) > 3) {
                candidates.push("art", "literary");
            }

            // Scholarly from education
            if ((subject.influences.education || 0) > 4) {
                candidates.push("scholarly");
            }

            // Culinary from trade
            if ((subject.influences.trade || 0) > 3) {
                candidates.push("culinary");
            }

            // Martial from military
            if ((subject.influences.military || 0) > 3) {
                candidates.push("martial");
            }

            // Crafts from trade and smithing
            if ((subject.influences.trade || 0) > 2 && planet.unlocks.smith >= 30) {
                candidates.push("crafts");
            }

            // Spiritual from faith
            if ((subject.influences.faith || 0) > 2) {
                candidates.push("spiritual");
            }

            if (candidates.length === 0) return false;

            // Pick one they don't already have (or strengthen existing)
            const newCandidates = candidates.filter(c => !hasTradition(subject, c));
            if (newCandidates.length > 0) {
                args.tradition = choose(newCandidates);
                args.isNew = true;
            } else {
                // Strengthen existing
                args.tradition = choose(candidates);
                args.isNew = false;
            }

            args.traditionDef = CULTURAL_TRADITIONS[args.tradition];
            return true;
        },
        func: (subject, target, args) => {
            addTradition(subject, args.tradition);

            if (args.isNew) {
                logMessage(`{{regname:town|${subject.id}}} develops a {{b:${args.traditionDef.name}}} tradition, ${args.traditionDef.description}.`, "milestone");
            }
        }
    });

    // Traditions can fade if conditions change
    modEvent("traditionFade", {
        daily: true,
        subject: { reg: "town", all: true },
        value: (subject, target, args) => {
            const traditions = getTownTraditions(subject);
            if (traditions.length === 0) return false;

            // Very unhappy towns lose culture
            if ((subject.influences.happy || 0) > -5) return false;

            // Small chance
            if (Math.random() > 0.02) return false;

            args.tradition = choose(traditions);
            return true;
        },
        func: (subject, target, args) => {
            weakenTradition(subject, args.tradition.id);

            if (!hasTradition(subject, args.tradition.id)) {
                logMessage(`{{regname:town|${subject.id}}} loses its {{b:${args.tradition.name}}} tradition in hard times.`, "warning");
            }
        }
    });

    // -------------------------------------------------------------------------
    // Cultural Jobs Effects
    // -------------------------------------------------------------------------

    // Artists can create cultural works
    modEvent("artistCreateWork", {
        daily: true,
        subject: { reg: "town", all: true },
        value: (subject, target, args) => {
            const artists = subject.jobs?.artist || 0;
            if (artists === 0) return false;

            // Small chance based on number of artists
            if (Math.random() > 0.005 * artists) return false;

            return true;
        },
        func: (subject, target, args) => {
            initTownCulture(subject);
            subject.culture.prestige += 1;

            // May develop art tradition
            if (Math.random() < 0.3) {
                addTradition(subject, "art");
            }

            if (Math.random() < 0.2) {
                logArtMessage(subject, `An artist in {{regname:town|${subject.id}}} creates a {{c:masterpiece|renowned work|celebrated piece}}.`);
            }
        }
    });

    // Musicians boost happiness and may create music tradition
    modEvent("musicianEffect", {
        daily: true,
        subject: { reg: "town", all: true },
        value: (subject, target, args) => {
            const musicians = subject.jobs?.musician || 0;
            if (musicians === 0) return false;
            args.musicians = musicians;
            return true;
        },
        func: (subject, target, args) => {
            // Small happiness boost
            const bonus = Math.min(1, args.musicians * 0.1);
            subject.influences.happy = (subject.influences.happy || 0) + bonus * 0.1;

            // May develop music tradition
            if (Math.random() < 0.01 * args.musicians) {
                if (addTradition(subject, "music") && !hasTradition(subject, "music")) {
                    logArtMessage(subject, `Musicians in {{regname:town|${subject.id}}} establish a {{b:Musical}} tradition.`);
                }
            }
        }
    });

    // Performers boost happiness significantly and attract visitors
    modEvent("performerEffect", {
        daily: true,
        subject: { reg: "town", all: true },
        value: (subject, target, args) => {
            const performers = subject.jobs?.performer || 0;
            if (performers === 0) return false;
            args.performers = performers;
            return true;
        },
        func: (subject, target, args) => {
            // Happiness boost
            const bonus = Math.min(1.5, args.performers * 0.15);
            subject.influences.happy = (subject.influences.happy || 0) + bonus * 0.1;

            // May develop theatrical tradition
            if (Math.random() < 0.01 * args.performers) {
                addTradition(subject, "theatrical");
            }

            // Attract small population from cultural draw
            if (Math.random() < 0.02 * args.performers) {
                subject.pop += 1;
            }
        }
    });

    // -------------------------------------------------------------------------
    // Cultural Events - Festivals
    // -------------------------------------------------------------------------

    // Towns with festive tradition hold festivals
    modEvent("festival", {
        random: true,
        weight: $c.UNCOMMON,
        subject: { reg: "player", id: 1 },
        target: { reg: "town", random: true },
        value: (subject, target, args) => {
            // Need festive tradition or high happiness
            const hasFestive = hasTradition(target, "festive");
            const isHappy = (target.influences.happy || 0) > 3;

            if (!hasFestive && !isHappy) return false;

            // Not during disasters or war
            if (hasIssue(target, "disaster") || hasIssue(target, "war")) return false;

            return true;
        },
        message: (subject, target, args) => {
            return `{{regname:town|${target.id}}} wants to hold a {{c:festival|celebration|grand feast}}. This will cost resources but boost morale...`;
        },
        func: (subject, target, args) => {
            // Big happiness boost
            happen("Influence", subject, target, { happy: 3, temp: true });

            // Boost relations with nearby towns
            const nearby = regFilter("town", t => t.id !== target.id && !t.end);
            for (const town of nearby.slice(0, 3)) {
                happen("AddRelation", target, town, { amount: 1 });
            }

            // May strengthen festive tradition
            if (Math.random() < 0.3) {
                addTradition(target, "festive");
            }

            // Gain prestige
            initTownCulture(target);
            target.culture.prestige += 2;

            logMessage(`{{regname:town|${target.id}}} holds a grand festival! Joy spreads.`, "milestone");
        },
        messageDone: (subject, target, args) => {
            return `The celebration is a success. {{residents:${target.id}}} are {{c:joyful|elated|merry}}.`;
        },
        messageNo: () => `The festival is postponed. Resources are conserved.`
    });

    // Cultural competitions between towns
    modEvent("culturalCompetition", {
        random: true,
        weight: $c.RARE,
        subject: { reg: "town", random: true },
        target: { reg: "town", random: true },
        value: (subject, target, args) => {
            if (subject.id === target.id) return false;

            // Both need some culture
            const subjectTraditions = getTownTraditions(subject);
            const targetTraditions = getTownTraditions(target);

            if (subjectTraditions.length === 0 || targetTraditions.length === 0) return false;

            // Need decent relations
            const relation = subject.relations[target.id] || 0;
            if (relation < -2) return false;

            // Find a shared tradition to compete in
            const shared = subjectTraditions.filter(t =>
                targetTraditions.some(tt => tt.id === t.id)
            );

            if (shared.length === 0) return false;

            args.tradition = choose(shared);
            args.targetStrength = targetTraditions.find(t => t.id === args.tradition.id).strength;
            return true;
        },
        message: (subject, target, args) => {
            return `{{regname:town|${subject.id}}} and {{regname:town|${target.id}}} propose a {{b:${args.tradition.name}}} competition. Should this friendly rivalry proceed?`;
        },
        func: (subject, target, args) => {
            // Compare tradition strengths with some randomness
            const subjectPower = args.tradition.strength + Math.random() * 2;
            const targetPower = args.targetStrength + Math.random() * 2;

            initTownCulture(subject);
            initTownCulture(target);

            if (subjectPower > targetPower) {
                subject.culture.prestige += 3;
                target.culture.prestige += 1;
                args.winner = subject;
                args.loser = target;
            } else {
                target.culture.prestige += 3;
                subject.culture.prestige += 1;
                args.winner = target;
                args.loser = subject;
            }

            // Both gain some happiness from the event
            happen("Influence", null, subject, { happy: 1, temp: true });
            happen("Influence", null, target, { happy: 1, temp: true });

            // Improves relations
            happen("AddRelation", subject, target, { amount: 1 });
        },
        messageDone: (subject, target, args) => {
            return `{{regname:town|${args.winner.id}}} wins the {{b:${args.tradition.name}}} competition! Both towns {{c:celebrate|enjoy|revel in}} the event.`;
        },
        messageNo: () => `The competition is called off.`
    });

    // -------------------------------------------------------------------------
    // Cultural Spread - Traditions spread between towns
    // -------------------------------------------------------------------------

    // Trade spreads culture
    modEvent("culturalTradeSpread", {
        daily: true,
        subject: { reg: "town", all: true },
        value: (subject, target, args) => {
            const traditions = getTownTraditions(subject);
            if (traditions.length === 0) return false;

            // Need trade connections
            if ((subject.influences.trade || 0) < 2) return false;

            // Small chance
            if (Math.random() > 0.02) return false;

            // Find a trade partner
            const partners = regFilter("town", t => {
                if (t.id === subject.id || t.end) return false;
                const relation = subject.relations[t.id] || 0;
                return relation > 0 && (t.influences.trade || 0) > 1;
            });

            if (partners.length === 0) return false;

            args.partner = choose(partners);
            args.tradition = choose(traditions);
            return true;
        },
        func: (subject, target, args) => {
            // Partner may adopt the tradition
            if (!hasTradition(args.partner, args.tradition.id)) {
                if (Math.random() < 0.3) {
                    addTradition(args.partner, args.tradition.id);
                    logMessage(`{{b:${args.tradition.name}}} traditions spread from {{regname:town|${subject.id}}} to {{regname:town|${args.partner.id}}} through trade.`);
                }
            }
        }
    });

    // Alliance spreads culture faster
    modEvent("culturalAllianceSpread", {
        daily: true,
        subject: { reg: "town", all: true },
        value: (subject, target, args) => {
            const traditions = getTownTraditions(subject);
            if (traditions.length === 0) return false;

            const alliance = getTownAlliance(subject);
            if (!alliance) return false;

            // Small chance
            if (Math.random() > 0.03) return false;

            // Find an ally without this tradition
            for (const memberId of alliance.members) {
                if (memberId === subject.id) continue;
                const ally = regGet("town", memberId);
                if (!ally || ally.end) continue;

                const spreadable = traditions.filter(t => !hasTradition(ally, t.id));
                if (spreadable.length > 0) {
                    args.ally = ally;
                    args.tradition = choose(spreadable);
                    args.alliance = alliance;
                    return true;
                }
            }
            return false;
        },
        func: (subject, target, args) => {
            addTradition(args.ally, args.tradition.id);
            logMessage(`{{b:${args.tradition.name}}} traditions spread to {{regname:town|${args.ally.id}}} through the {{b:${args.alliance.name}}} alliance.`);
        }
    });

    // -------------------------------------------------------------------------
    // Cultural Relations Effects
    // -------------------------------------------------------------------------

    // Similar cultures get along better
    modEvent("culturalAffinity", {
        daily: true,
        subject: { reg: "town", all: true },
        value: (subject, target, args) => {
            const traditions = getTownTraditions(subject);
            if (traditions.length === 0) return false;

            // Small chance
            if (Math.random() > 0.02) return false;

            // Find a town with similar culture
            const similar = regFilter("town", t => {
                if (t.id === subject.id || t.end) return false;
                return getCulturalSimilarity(subject, t) >= 2;
            });

            if (similar.length === 0) return false;

            args.other = choose(similar);
            args.similarity = getCulturalSimilarity(subject, args.other);
            return true;
        },
        func: (subject, target, args) => {
            happen("AddRelation", subject, args.other, { amount: 1 });

            if (Math.random() < 0.1) {
                logMessage(`{{regname:town|${subject.id}}} and {{regname:town|${args.other.id}}} bond over shared cultural traditions.`);
            }
        }
    });

    // Cultural migration - people move to culturally rich towns
    modEvent("culturalMigration", {
        daily: true,
        subject: { reg: "town", all: true },
        value: (subject, target, args) => {
            const attractiveness = getCulturalAttractiveness(subject);
            if (attractiveness < 5) return false;

            // Small chance based on attractiveness
            if (Math.random() > 0.01 * attractiveness) return false;

            // Find a less culturally developed town
            const sources = regFilter("town", t => {
                if (t.id === subject.id || t.end || t.pop < 15) return false;
                return getCulturalAttractiveness(t) < attractiveness - 3;
            });

            if (sources.length === 0) return false;

            args.source = choose(sources);
            return true;
        },
        func: (subject, target, args) => {
            const migrants = Math.min(3, Math.floor(args.source.pop * 0.02));
            if (migrants > 0) {
                args.source.pop -= migrants;
                subject.pop += migrants;
                try { markMigration(subject); } catch {}

                if (Math.random() < 0.1) {
                    const traditions = getTownTraditions(subject);
                    const traditionName = traditions.length > 0 ? traditions[0].name : "rich";
                    modLog(
                        "migration",
                        `Drawn by {{regname:town|${subject.id}}}'s {{b:${traditionName}}} culture, ${migrants} {{c:migrate|move|relocate}} from {{regname:town|${args.source.id}}}.`,
                        null,
                        { town: args.source }
                    );
                }
            }
        }
    });

    // -------------------------------------------------------------------------
    // Player Sway - Cultural Manipulation
    // -------------------------------------------------------------------------

    // Encourage a tradition
    modEvent("swayDevelopTradition", {
        random: true,
        weight: $c.UNCOMMON,
        subject: { reg: "player", id: 1 },
        target: { reg: "town", random: true },
        value: (subject, target, args) => {
            if ((target.influences.faith || 0) < -2) return false;
            if (target.pop < 15) return false;

            // Pick a tradition that suits them
            const candidates = [];

            if ((target.influences.happy || 0) > 0) candidates.push("music", "theatrical", "festive");
            if ((target.influences.education || 0) > 1) candidates.push("art", "literary", "scholarly");
            if ((target.influences.trade || 0) > 1) candidates.push("culinary", "crafts");
            if ((target.influences.military || 0) > 1) candidates.push("martial");
            if ((target.influences.faith || 0) > 1) candidates.push("spiritual");

            if (candidates.length === 0) candidates.push("music", "festive"); // Default options

            // Prefer ones they don't have
            const newOnes = candidates.filter(c => !hasTradition(target, c));
            args.tradition = newOnes.length > 0 ? choose(newOnes) : choose(candidates);
            args.traditionDef = CULTURAL_TRADITIONS[args.tradition];
            args.isNew = !hasTradition(target, args.tradition);

            args.successChance = 0.40;
            args.successChance += (target.influences.faith || 0) * 0.05;
            args.successChance += (target.influences.happy || 0) * 0.03;
            args.successChance = clampChance(args.successChance, 0.15, 0.80);
            return true;
        },
        message: (subject, target, args) => {
            if (args.isNew) {
                return `You could {{c:encourage|inspire|guide}} {{regname:town|${target.id}}} to develop a {{b:${args.traditionDef.name}}} tradition...`;
            }
            return `You could {{c:encourage|inspire|guide}} {{regname:town|${target.id}}} to strengthen their {{b:${args.traditionDef.name}}} tradition...`;
        },
        func: (subject, target, args) => {
            const success = Math.random() < args.successChance;
            args.success = success;

            if (success) {
                addTradition(target, args.tradition);
                happen("Influence", subject, target, { faith: 1, happy: 0.5 });
            } else {
                happen("Influence", subject, target, { faith: -0.5 });
            }
        },
        messageDone: (subject, target, args) => {
            if (args.success) {
                if (args.isNew) {
                    return `{{regname:town|${target.id}}} embraces a {{b:${args.traditionDef.name}}} tradition.`;
                }
                return `{{regname:town|${target.id}}}'s {{b:${args.traditionDef.name}}} tradition grows stronger.`;
            }
            return `{{residents:${target.id}}} {{c:aren't interested|don't embrace|resist}} this cultural direction.`;
        },
        messageNo: () => `You let their culture develop naturally.`
    });

    // Encourage a festival
    modEvent("swayHoldFestival", {
        random: true,
        weight: $c.UNCOMMON,
        subject: { reg: "player", id: 1 },
        target: { reg: "town", random: true },
        value: (subject, target, args) => {
            if ((target.influences.faith || 0) < -1) return false;
            if (hasIssue(target, "disaster") || hasIssue(target, "war")) return false;

            args.successChance = 0.50;
            args.successChance += (target.influences.faith || 0) * 0.05;
            args.successChance += (target.influences.happy || 0) * 0.05;
            if (hasTradition(target, "festive")) args.successChance += 0.20;
            args.successChance = clampChance(args.successChance, 0.20, 0.90);
            return true;
        },
        message: (subject, target, args) => {
            return `You could {{c:suggest|encourage|inspire}} {{regname:town|${target.id}}} to hold a {{c:festival|celebration|grand feast}}...`;
        },
        func: (subject, target, args) => {
            const success = Math.random() < args.successChance;
            args.success = success;

            if (success) {
                happen("Influence", subject, target, { happy: 2, temp: true });
                happen("Influence", subject, target, { faith: 1 });

                initTownCulture(target);
                target.culture.prestige += 1;

                if (Math.random() < 0.2) {
                    addTradition(target, "festive");
                }

                logMessage(`{{regname:town|${target.id}}} holds a festival at your encouragement!`);
            } else {
                happen("Influence", subject, target, { faith: -0.5 });
            }
        },
        messageDone: (subject, target, args) => {
            if (args.success) {
                return `Joy spreads through {{regname:town|${target.id}}}.`;
            }
            return `{{residents:${target.id}}} {{c:aren't in the mood|decline|prefer}} to conserve resources.`;
        },
        messageNo: () => `You let them decide when to celebrate.`
    });

    // Encourage cultural exchange between towns
    modEvent("swayCulturalExchange", {
        random: true,
        weight: $c.RARE,
        subject: { reg: "player", id: 1 },
        target: { reg: "town", random: true },
        value: (subject, target, args) => {
            if ((target.influences.faith || 0) < 0) return false;

            const targetTraditions = getTownTraditions(target);
            if (targetTraditions.length === 0) return false;

            // Find another town with different traditions
            const partners = regFilter("town", t => {
                if (t.id === target.id || t.end) return false;
                const relation = target.relations[t.id] || 0;
                if (relation < -1) return false;

                const theirTraditions = getTownTraditions(t);
                if (theirTraditions.length === 0) return false;

                // Must have at least one different tradition
                return theirTraditions.some(tt => !hasTradition(target, tt.id)) ||
                       targetTraditions.some(tt => !hasTradition(t, tt.id));
            });

            if (partners.length === 0) return false;

            args.partner = choose(partners);
            args.partnerTraditions = getTownTraditions(args.partner);
            args.targetTraditions = targetTraditions;

            args.successChance = 0.40;
            args.successChance += (target.influences.faith || 0) * 0.05;
            const relation = target.relations[args.partner.id] || 0;
            args.successChance += relation * 0.05;
            args.successChance = clampChance(args.successChance, 0.15, 0.75);
            return true;
        },
        message: (subject, target, args) => {
            return `You could {{c:arrange|encourage|facilitate}} a cultural exchange between {{regname:town|${target.id}}} and {{regname:town|${args.partner.id}}}...`;
        },
        func: (subject, target, args) => {
            const success = Math.random() < args.successChance;
            args.success = success;

            if (success) {
                // Exchange one tradition each way
                const targetGives = args.targetTraditions.find(t => !hasTradition(args.partner, t.id));
                const partnerGives = args.partnerTraditions.find(t => !hasTradition(target, t.id));

                if (targetGives) {
                    addTradition(args.partner, targetGives.id);
                    args.given = targetGives;
                }
                if (partnerGives) {
                    addTradition(target, partnerGives.id);
                    args.received = partnerGives;
                }

                happen("AddRelation", target, args.partner, { amount: 2 });
                happen("Influence", subject, target, { faith: 1 });
                happen("Influence", subject, args.partner, { faith: 1 });
            } else {
                happen("Influence", subject, target, { faith: -1 });
            }
        },
        messageDone: (subject, target, args) => {
            if (args.success) {
                let msg = `Cultural exchange succeeds! `;
                if (args.given && args.received) {
                    msg += `{{b:${args.given.name}}} and {{b:${args.received.name}}} traditions are shared.`;
                } else if (args.given) {
                    msg += `{{b:${args.given.name}}} traditions spread to {{regname:town|${args.partner.id}}}.`;
                } else if (args.received) {
                    msg += `{{b:${args.received.name}}} traditions spread to {{regname:town|${target.id}}}.`;
                }
                return msg;
            }
            return `The cultural exchange falls through. Perhaps relations need improvement first.`;
        },
        messageNo: () => `You let cultures develop independently.`
    });

    // Suppress a tradition (controversial)
    modEvent("swaySuppressTradition", {
        random: true,
        weight: $c.VERY_RARE,
        subject: { reg: "player", id: 1 },
        target: { reg: "town", random: true },
        value: (subject, target, args) => {
            if ((target.influences.faith || 0) < 2) return false;

            const traditions = getTownTraditions(target);
            if (traditions.length === 0) return false;

            args.tradition = choose(traditions);
            args.successChance = 0.20;
            args.successChance += (target.influences.faith || 0) * 0.05;
            args.successChance = clampChance(args.successChance, 0.05, 0.50);
            return true;
        },
        message: (subject, target, args) => {
            return `{{regname:town|${target.id}}}'s {{b:${args.tradition.name}}} tradition could be {{c:discouraged|suppressed|diminished}}. This is controversial...`;
        },
        func: (subject, target, args) => {
            const success = Math.random() < args.successChance;
            args.success = success;

            if (success) {
                weakenTradition(target, args.tradition.id);
                happen("Influence", subject, target, { happy: -1, faith: -1 });
            } else {
                happen("Influence", subject, target, { faith: -3, happy: -1 });
                logMessage(`{{residents:${target.id}}} {{c:resist|reject|oppose}} attempts to suppress their {{b:${args.tradition.name}}} tradition.`, "warning");
            }
        },
        messageDone: (subject, target, args) => {
            if (args.success) {
                return `The {{b:${args.tradition.name}}} tradition weakens in {{regname:town|${target.id}}}. The people are {{c:resentful|unhappy|discontent}}.`;
            }
            return null;
        },
        messageNo: () => `You respect their cultural heritage.`
    });

    // =========================================================================
    // CULTURAL LANDMARKS
    // Theater, Museum, Gallery - provide cultural bonuses
    // =========================================================================

    // Cultural landmarks now use the base marker system so they appear on the map.

    const CULTURAL_LANDMARK_DEFS = {
        theater: {
            name: "Theater",
            symbol: "T",
            color: [180, 120, 200]
        },
        museum: {
            name: "Museum",
            symbol: "M",
            color: [120, 150, 200]
        },
        gallery: {
            name: "Gallery",
            symbol: "G",
            color: [200, 160, 100]
        }
    };

    function createCulturalLandmarkMarker(town, type) {
        const def = CULTURAL_LANDMARK_DEFS[type];
        if (!def || !town) return false;
        const spot = findTownMarkerSpot(town);
        const x = spot ? spot.x : town.x;
        const y = spot ? spot.y : town.y;
        if (typeof x !== "number" || typeof y !== "number") return false;
        const marker = happen("Create", null, null, {
            type: "landmark",
            name: def.name,
            subtype: type,
            symbol: def.symbol,
            color: def.color,
            x: x,
            y: y
        }, "marker");
        if (marker) {
            if (spot) attachMarkerToChunk(marker, spot);
            else attachMarkerToTownChunk(marker, town);
            return true;
        }
        return false;
    }

    function createWarMemorialMarker(town, wasVictor) {
        if (!town) return false;
        const spot = findTownMarkerSpot(town);
        const x = spot ? spot.x : town.x;
        const y = spot ? spot.y : town.y;
        if (typeof x !== "number" || typeof y !== "number") return false;
        const marker = happen("Create", null, null, {
            type: "landmark",
            name: wasVictor ? "Victory Monument" : "War Memorial",
            subtype: "warMemorial",
            symbol: wasVictor ? "V" : "W",
            color: wasVictor ? [170, 150, 90] : [150, 150, 150],
            x: x,
            y: y
        }, "marker");
        if (marker) {
            if (spot) attachMarkerToChunk(marker, spot);
            else attachMarkerToTownChunk(marker, town);
            return true;
        }
        return false;
    }

    function migrateLegacyCulturalLandmarks(town) {
        if (!town || !town.culturalLandmarks) return;
        const legacy = town.culturalLandmarks;
        let migratedAll = true;
        const theaterCount = legacy.theater || 0;
        const museumCount = legacy.museum || 0;
        const galleryCount = legacy.gallery || 0;
        const memorialCount = legacy.warMemorial || 0;

        if (theaterCount > 0 && getTownMarkersBySubtype(town, "theater").length === 0) {
            if (!createCulturalLandmarkMarker(town, "theater")) migratedAll = false;
        }
        if (museumCount > 0 && getTownMarkersBySubtype(town, "museum").length === 0) {
            if (!createCulturalLandmarkMarker(town, "museum")) migratedAll = false;
        }
        if (galleryCount > 0 && getTownMarkersBySubtype(town, "gallery").length === 0) {
            if (!createCulturalLandmarkMarker(town, "gallery")) migratedAll = false;
        }
        if (memorialCount > 0 && getTownMarkersBySubtype(town, "warMemorial").length === 0) {
            if (!createWarMemorialMarker(town, false)) migratedAll = false;
        }

        if (migratedAll) {
            delete town.culturalLandmarks;
        }
    }

    // Check if town has a cultural landmark
    function hasCulturalLandmark(town, type) {
        migrateLegacyCulturalLandmarks(town);
        return getTownMarkersBySubtype(town, type).length > 0;
    }

    function getCulturalLandmarkCount(town, type) {
        migrateLegacyCulturalLandmarks(town);
        return getTownMarkersBySubtype(town, type).length;
    }

    // Add a cultural landmark
    function addCulturalLandmark(town, type) {
        migrateLegacyCulturalLandmarks(town);
        if (hasCulturalLandmark(town, type)) return false;
        if (!createCulturalLandmarkMarker(town, type)) return false;

        // Apply one-time bonuses
        if (type === "theater") {
            town.influences.happy = (town.influences.happy || 0) + 2;
            addTradition(town, "theatrical");
        } else if (type === "museum") {
            town.influences.education = (town.influences.education || 0) + 1;
            town.influences.happy = (town.influences.happy || 0) + 1;
            initTownCulture(town);
            town.culture.prestige += 3;
        } else if (type === "gallery") {
            town.influences.happy = (town.influences.happy || 0) + 1.5;
            addTradition(town, "art");
        }
        return true;
    }

    // Player can encourage building cultural landmarks
    modEvent("swayBuildTheater", {
        random: true,
        weight: $c.RARE,
        subject: { reg: "player", id: 1 },
        target: { reg: "town", random: true },
        value: (subject, target, args) => {
            if ((target.influences.faith || 0) < -1) return false;
            if (planet.unlocks.education < 20) return false;
            if (hasCulturalLandmark(target, "theater")) return false;

            args.successChance = 0.35;
            args.successChance += (target.influences.happy || 0) * 0.05;
            args.successChance += (target.influences.faith || 0) * 0.05;
            if (hasTradition(target, "theatrical")) args.successChance += 0.15;
            args.successChance = clampChance(args.successChance, 0.15, 0.75);
            return true;
        },
        message: (subject, target, args) => {
            return `{{regname:town|${target.id}}} could build a {{b:Theater}} for drama and performance. The arts would flourish...`;
        },
        func: (subject, target, args) => {
            const success = Math.random() < args.successChance;
            args.success = success;

            if (success) {
                const built = addCulturalLandmark(target, "theater");
                args.success = built;
                if (built) {
                    happen("Influence", subject, target, { faith: 1 });
                    logMessage(`{{regname:town|${target.id}}} builds a grand {{b:Theater}}!`, "milestone");
                }
            }
            if (!args.success) {
                happen("Influence", subject, target, { faith: -0.5 });
            }
        },
        messageDone: (subject, target, args) => {
            if (args.success) {
                return `Drama and performance thrive in {{regname:town|${target.id}}}.`;
            }
            return `{{residents:${target.id}}} {{c:aren't interested|decline|prefer}} other priorities.`;
        },
        messageNo: () => `You let them build what they will.`
    });

    modEvent("swayBuildMuseum", {
        random: true,
        weight: $c.RARE,
        subject: { reg: "player", id: 1 },
        target: { reg: "town", random: true },
        value: (subject, target, args) => {
            if ((target.influences.faith || 0) < -1) return false;
            if (planet.unlocks.education < 40) return false;
            if (hasCulturalLandmark(target, "museum")) return false;

            args.successChance = 0.30;
            args.successChance += (target.influences.education || 0) * 0.05;
            args.successChance += (target.influences.faith || 0) * 0.05;
            args.successChance = clampChance(args.successChance, 0.15, 0.70);
            return true;
        },
        message: (subject, target, args) => {
            return `{{regname:town|${target.id}}} could build a {{b:Museum}} to preserve history and culture...`;
        },
        func: (subject, target, args) => {
            const success = Math.random() < args.successChance;
            args.success = success;

            if (success) {
                const built = addCulturalLandmark(target, "museum");
                args.success = built;
                if (built) {
                    happen("Influence", subject, target, { faith: 1 });
                    logMessage(`{{regname:town|${target.id}}} opens a {{b:Museum}}!`, "milestone");
                }
            }
            if (!args.success) {
                happen("Influence", subject, target, { faith: -0.5 });
            }
        },
        messageDone: (subject, target, args) => {
            if (args.success) {
                return `History is preserved. Knowledge grows.`;
            }
            return `{{residents:${target.id}}} {{c:see no need|don't prioritize|decline}} a museum.`;
        },
        messageNo: () => `You let them decide what to build.`
    });

    modEvent("swayBuildGallery", {
        random: true,
        weight: $c.RARE,
        subject: { reg: "player", id: 1 },
        target: { reg: "town", random: true },
        value: (subject, target, args) => {
            if ((target.influences.faith || 0) < -1) return false;
            if (planet.unlocks.education < 30) return false;
            if (hasCulturalLandmark(target, "gallery")) return false;

            args.successChance = 0.35;
            args.successChance += (target.influences.trade || 0) * 0.03;
            args.successChance += (target.influences.faith || 0) * 0.05;
            if (hasTradition(target, "art")) args.successChance += 0.15;
            args.successChance = clampChance(args.successChance, 0.15, 0.75);
            return true;
        },
        message: (subject, target, args) => {
            return `{{regname:town|${target.id}}} could build an {{b:Art Gallery}} to display and celebrate visual arts...`;
        },
        func: (subject, target, args) => {
            const success = Math.random() < args.successChance;
            args.success = success;

            if (success) {
                const built = addCulturalLandmark(target, "gallery");
                args.success = built;
                if (built) {
                    happen("Influence", subject, target, { faith: 1 });
                    logMessage(`{{regname:town|${target.id}}} opens an {{b:Art Gallery}}!`, "milestone");
                }
            }
            if (!args.success) {
                happen("Influence", subject, target, { faith: -0.5 });
            }
        },
        messageDone: (subject, target, args) => {
            if (args.success) {
                return `Art flourishes in {{regname:town|${target.id}}}.`;
            }
            return `{{residents:${target.id}}} {{c:aren't ready|decline|don't prioritize}} an art gallery.`;
        },
        messageNo: () => `You let them decide what to build.`
    });

    // Cultural landmarks provide ongoing effects
    modEvent("culturalLandmarkEffects", {
        daily: true,
        subject: { reg: "town", all: true },
        value: (subject, target, args) => {
            const hasAny = getCulturalLandmarkCount(subject, "theater") > 0 ||
                           getCulturalLandmarkCount(subject, "museum") > 0 ||
                           getCulturalLandmarkCount(subject, "gallery") > 0;
            return hasAny;
        },
        func: (subject, target, args) => {
            initTownCulture(subject);

            // Theater attracts performers
            if (getCulturalLandmarkCount(subject, "theater") > 0 && Math.random() < 0.02) {
                subject.jobs = subject.jobs || {};
                subject.jobs.performer = (subject.jobs.performer || 0) + 1;
            }

            // Museum builds prestige slowly
            if (getCulturalLandmarkCount(subject, "museum") > 0 && Math.random() < 0.05) {
                subject.culture.prestige += 0.5;
            }

            // Gallery attracts artists
            if (getCulturalLandmarkCount(subject, "gallery") > 0 && Math.random() < 0.02) {
                subject.jobs = subject.jobs || {};
                subject.jobs.artist = (subject.jobs.artist || 0) + 1;
            }
        }
    });

    // =========================================================================
    // WAR AND CULTURE INTERACTIONS
    // Victory celebrations, war memorials, conquest culture effects,
    // propaganda, martial traditions, poets/artists on war
    // =========================================================================

    // Victory celebration - winning a war triggers cultural boost
    modEvent("victoryCelebration", {
        daily: true,
        subject: { reg: "town", all: true },
        value: (subject, target, args) => {
            // Check if this town just won a war (check for recent war process where they're winner)
            const recentWars = regFilter("process", p =>
                p.type === "war" &&
                p.winner === subject.id &&
                p.done &&
                planet.day - p.done <= 5
            );

            if (recentWars.length === 0) return false;

            // Only trigger once per war
            const war = recentWars[0];
            if (subject._celebratedWar === war.id) return false;

            args.war = war;
            return true;
        },
        func: (subject, target, args) => {
            subject._celebratedWar = args.war.id;

            // Big happiness boost
            happen("Influence", null, subject, { happy: 3, temp: true });

            // Strengthen martial tradition
            addTradition(subject, "martial");

            // Gain cultural prestige from victory
            initTownCulture(subject);
            subject.culture.prestige += 5;

            // May develop festive tradition from celebration
            if (Math.random() < 0.3) {
                addTradition(subject, "festive");
            }

            logMessage(`{{regname:town|${subject.id}}} celebrates victory! Parades fill the streets.`, "milestone");
        }
    });

    // War memorial - towns that fought in wars may build memorials
    modEvent("warMemorial", {
        random: true,
        weight: $c.RARE,
        subject: { reg: "player", id: 1 },
        target: { reg: "town", random: true },
        value: (subject, target, args) => {
            migrateLegacyCulturalLandmarks(target);
            // Need to have been in a war
            const pastWars = regFilter("process", p =>
                p.type === "war" &&
                p.done &&
                p.towns &&
                p.towns.includes(target.id)
            );

            if (pastWars.length === 0) return false;

            // Check if already has memorial
            if (getTownMarkersBySubtype(target, "warMemorial").length > 0) return false;

            args.war = pastWars[pastWars.length - 1];
            args.wasVictor = args.war.winner === target.id;
            return true;
        },
        message: (subject, target, args) => {
            if (args.wasVictor) {
                return `{{regname:town|${target.id}}} could build a {{b:Victory Monument}} to commemorate their triumph...`;
            }
            return `{{regname:town|${target.id}}} could build a {{b:War Memorial}} to honor the fallen...`;
        },
        func: (subject, target, args) => {
            const built = createWarMemorialMarker(target, args.wasVictor);
            args.built = built;
            if (!built) return;
            initTownCulture(target);
            target.culture.prestige += 2;

            if (args.wasVictor) {
                happen("Influence", subject, target, { military: 1, happy: 1 });
                addTradition(target, "martial");
                logMessage(`{{regname:town|${target.id}}} unveils a {{b:Victory Monument}}.`, "milestone");
            } else {
                happen("Influence", subject, target, { faith: 1, happy: 0.5 });
                logMessage(`{{regname:town|${target.id}}} dedicates a {{b:War Memorial}} to the fallen.`, "milestone");
            }
        },
        messageDone: (subject, target, args) => {
            if (!args.built) return null;
            if (args.wasVictor) {
                return `The monument stands as a symbol of {{regadj:town|${target.id}}} might.`;
            }
            return `The memorial ensures the fallen are never forgotten.`;
        },
        messageNo: () => `The past is left unmarked.`
    });

    // Conquest culture effects - conquering towns can spread or suppress culture
    modEvent("conquestCultureSpread", {
        daily: true,
        subject: { reg: "town", all: true },
        value: (subject, target, args) => {
            // Check if this town conquered another recently
            const recentConquests = regFilter("town", t =>
                t.end &&
                t.ender === subject.id &&
                planet.day - (t.endDay || 0) <= 10
            );

            if (recentConquests.length === 0) return false;

            // Only process once
            const conquered = recentConquests[0];
            if (subject._processedConquest === conquered.id) return false;

            // Need some culture to spread
            const traditions = getTownTraditions(subject);
            if (traditions.length === 0) return false;

            args.conquered = conquered;
            args.traditions = traditions;
            return true;
        },
        func: (subject, target, args) => {
            subject._processedConquest = args.conquered.id;

            // Conquering town's culture becomes more dominant
            initTownCulture(subject);
            subject.culture.prestige += 3;

            // Strengthen martial tradition from conquest
            addTradition(subject, "martial");

            // Log cultural dominance
            if (Math.random() < 0.5) {
                const tradition = choose(args.traditions);
                logMessage(`{{regadj:town|${subject.id}}} {{b:${tradition.name}}} culture spreads through conquered lands.`);
            }
        }
    });

    // War poets and artists - war inspires cultural works
    modEvent("warArt", {
        daily: true,
        subject: { reg: "town", all: true },
        value: (subject, target, args) => {
            // Need to be at war or recently at war
            const atWar = subject.issues?.war;
            const recentWar = regFilter("process", p =>
                p.type === "war" &&
                p.towns &&
                p.towns.includes(subject.id) &&
                (!p.done || planet.day - p.done <= 20)
            ).length > 0;

            if (!atWar && !recentWar) return false;

            // Need artists, musicians, or scholars
            const artists = subject.jobs?.artist || 0;
            const musicians = subject.jobs?.musician || 0;
            const scholars = subject.jobs?.scholar || 0;
            const cultural = artists + musicians + scholars;

            if (cultural === 0) return false;

            // Small chance
            if (Math.random() > 0.02 * cultural) return false;

            args.atWar = atWar;
            args.artists = artists;
            args.musicians = musicians;
            args.scholars = scholars;
            return true;
        },
        func: (subject, target, args) => {
            initTownCulture(subject);
            subject.culture.prestige += 2;

            // Different types of war art
            if (args.musicians > 0 && Math.random() < 0.4) {
                addTradition(subject, "music");
                if (Math.random() < 0.3) {
                    logArtMessage(subject, `A {{regadj:town|${subject.id}}} composer writes a {{c:stirring|haunting|powerful}} war {{c:anthem|symphony|ballad}}.`);
                }
            } else if (args.artists > 0 && Math.random() < 0.4) {
                addTradition(subject, "art");
                if (Math.random() < 0.3) {
                    logArtMessage(subject, `An artist in {{regname:town|${subject.id}}} creates a {{c:powerful|moving|striking}} war {{c:painting|sculpture|mural}}.`);
                }
            } else if (args.scholars > 0 && Math.random() < 0.4) {
                addTradition(subject, "literary");
                if (Math.random() < 0.3) {
                    logArtMessage(subject, `A poet in {{regname:town|${subject.id}}} writes {{c:verses|an epic|poetry}} about the {{c:conflict|war|struggle}}.`);
                }
            }
        }
    });

    // Propaganda during war - governments can boost martial spirit
    modEvent("warPropaganda", {
        random: true,
        weight: $c.UNCOMMON,
        subject: { reg: "player", id: 1 },
        target: { reg: "town", random: true },
        value: (subject, target, args) => {
            if (!target.issues?.war) return false;
            if ((target.influences.faith || 0) < -2) return false;

            args.successChance = 0.50;
            args.successChance += (target.influences.faith || 0) * 0.05;
            args.successChance += (target.influences.military || 0) * 0.03;
            args.successChance = clampChance(args.successChance, 0.25, 0.85);
            return true;
        },
        message: (subject, target, args) => {
            return `{{regname:town|${target.id}}} is at war. You could {{c:encourage|inspire|promote}} patriotic {{c:fervor|spirit|unity}}...`;
        },
        func: (subject, target, args) => {
            const success = Math.random() < args.successChance;
            args.success = success;

            if (success) {
                happen("Influence", subject, target, { military: 2, happy: 1, temp: true });
                addTradition(target, "martial");

                initTownCulture(target);
                target.culture.prestige += 1;
            } else {
                happen("Influence", subject, target, { faith: -1, happy: -0.5 });
            }
        },
        messageDone: (subject, target, args) => {
            if (args.success) {
                return `Patriotic spirit surges in {{regname:town|${target.id}}}. The war effort intensifies.`;
            }
            return `{{residents:${target.id}}} {{c:grow weary|tire|are skeptical}} of the war.`;
        },
        messageNo: () => `You let them feel what they feel about the war.`
    });

    // War weariness affects culture - long wars damage cultural traditions
    modEvent("warWeariness", {
        daily: true,
        subject: { reg: "town", all: true },
        value: (subject, target, args) => {
            if (!subject.issues?.war) return false;

            if (!hasIssue(subject, "war")) return false;
            const war = regGet("process", subject.issues.war);
            if (!war) return false;

            // War needs to have been going on for a while
            const warDuration = planet.day - war.start;
            if (warDuration < 15) return false;

            // Small chance based on war length
            if (Math.random() > 0.01 * (warDuration / 10)) return false;

            const traditions = getTownTraditions(subject);
            // Non-martial traditions can fade
            const nonMartial = traditions.filter(t => t.id !== "martial");
            if (nonMartial.length === 0) return false;

            args.tradition = choose(nonMartial);
            args.warDuration = warDuration;
            return true;
        },
        func: (subject, target, args) => {
            weakenTradition(subject, args.tradition.id);

            if (!hasTradition(subject, args.tradition.id)) {
                logMessage(`War weariness causes {{regname:town|${subject.id}}} to lose its {{b:${args.tradition.name}}} tradition.`, "warning");
            }

            // Also hurt happiness
            happen("Influence", null, subject, { happy: -0.5 });
        }
    });

    // Cultural resistance - conquered peoples resist cultural suppression
    modEvent("culturalResistance", {
        daily: true,
        subject: { reg: "town", all: true },
        value: (subject, target, args) => {
            // Recently conquered (lost war in last 30 days)
            const lostWar = regFilter("process", p =>
                p.type === "war" &&
                p.done &&
                p.winner &&
                p.winner !== subject.id &&
                p.towns &&
                p.towns.includes(subject.id) &&
                planet.day - p.done <= 30
            );

            if (lostWar.length === 0) return false;

            // Need cultural traditions to resist for
            const traditions = getTownTraditions(subject);
            if (traditions.length === 0) return false;

            // Small chance
            if (Math.random() > 0.03) return false;

            args.war = lostWar[0];
            args.victor = regGet("town", args.war.winner);
            if (!args.victor || args.victor.end) return false;

            args.tradition = choose(traditions);
            return true;
        },
        func: (subject, target, args) => {
            // Strengthen their own tradition as resistance
            addTradition(subject, args.tradition.id);

            // Worsen relations with conqueror
            happen("AddRelation", subject, args.victor, { amount: -1 });

            if (Math.random() < 0.2) {
                logMessage(`{{residents:${subject.id}}} {{c:cling to|preserve|defend}} their {{b:${args.tradition.name}}} traditions against {{regadj:town|${args.victor.id}}} influence.`);
            }
        }
    });

    // Peace brings cultural flourishing
    modEvent("peaceCulture", {
        daily: true,
        subject: { reg: "town", all: true },
        value: (subject, target, args) => {
            // Not at war
            if (subject.issues?.war) return false;

            // Not recently at war (peace for at least 20 days)
            const recentWar = regFilter("process", p =>
                p.type === "war" &&
                p.towns &&
                p.towns.includes(subject.id) &&
                p.done &&
                planet.day - p.done < 20
            );

            if (recentWar.length > 0) return false;

            // Need reasonable happiness
            if ((subject.influences.happy || 0) < 1) return false;

            // Small chance
            if (Math.random() > 0.005) return false;

            return true;
        },
        func: (subject, target, args) => {
            // Peace allows non-martial culture to flourish
            const candidates = ["music", "art", "literary", "theatrical", "culinary", "festive"];
            const tradition = choose(candidates);

            if (addTradition(subject, tradition)) {
                const def = CULTURAL_TRADITIONS[tradition];
                if (Math.random() < 0.15) {
                    logMessage(`In peaceful times, {{regname:town|${subject.id}}} develops a {{b:${def.name}}} tradition.`);
                }
            }

            initTownCulture(subject);
            subject.culture.prestige += 0.5;
        }
    });

    // Allies share war glory - allied victories boost culture
    modEvent("alliedVictoryGlory", {
        daily: true,
        subject: { reg: "town", all: true },
        value: (subject, target, args) => {
            const alliance = getTownAlliance(subject);
            if (!alliance) return false;

            // Check if an ally just won a war
            for (const memberId of alliance.members) {
                if (memberId === subject.id) continue;

                const ally = regGet("town", memberId);
                if (!ally || ally.end) continue;

                const allyVictories = regFilter("process", p =>
                    p.type === "war" &&
                    p.winner === ally.id &&
                    p.done &&
                    planet.day - p.done <= 3
                );

                if (allyVictories.length > 0) {
                    // Only trigger once per victory
                    const victory = allyVictories[0];
                    if (subject._celebratedAllyVictory === victory.id) continue;

                    args.ally = ally;
                    args.victory = victory;
                    args.alliance = alliance;
                    return true;
                }
            }
            return false;
        },
        func: (subject, target, args) => {
            subject._celebratedAllyVictory = args.victory.id;

            // Share in the glory, but less than the actual victor
            happen("Influence", null, subject, { happy: 1, temp: true });

            initTownCulture(subject);
            subject.culture.prestige += 1;

            if (Math.random() < 0.1) {
                logMessage(`{{regname:town|${subject.id}}} celebrates their ally {{regname:town|${args.ally.id}}}'s victory through the {{b:${args.alliance.name}}}.`);
            }
        }
    });

    // ============================================================
    // DISASTER INTERACTIONS SYSTEM
    // Connects disasters with economics, diplomacy, migration,
    // culture, health, and government systems
    // ============================================================

    // Helper to check if a town is currently affected by a disaster
    function getTownDisaster(town) {
        if (!town.issues || !town.issues.disaster) return null;
        return regGet("process", town.issues.disaster);
    }

    // Helper to check if town was recently affected by disaster
    function getRecentDisaster(town, daysAgo = 30) {
        const disasters = regFilter("process", p =>
            p.type === "disaster" &&
            p.done &&
            planet.day - p.done <= daysAgo &&
            p.towns && p.towns.includes(town.id)
        );
        return disasters.length > 0 ? disasters[0] : null;
    }

    // Helper to get disaster severity (based on deaths and type)
    function getDisasterSeverity(disaster) {
        if (!disaster) return 0;
        const deaths = disaster.deaths || 0;
        if (deaths >= 50) return 3; // Catastrophic
        if (deaths >= 20) return 2; // Severe
        if (deaths >= 5) return 1;  // Moderate
        return 0; // Minor
    }

    // Track disaster impact on towns
    function initTownDisasterData(town) {
        if (!town.disasterHistory) {
            town.disasterHistory = [];
        }
        if (town.disasterRecovery === undefined) {
            town.disasterRecovery = 0; // 0 = normal, positive = recovering
        }
    }

    // ----------------------------------------
    // DISASTER-ECONOMIC INTERACTIONS
    // ----------------------------------------

    // Track when a disaster ends and mark town as recovering
    modEvent("disasterEndsRecovery", {
        daily: true,
        subject: { reg: "town", all: true },
        value: (subject, target, args) => {
            // Check for disasters that just ended affecting this town
            const recentlyEnded = regFilter("process", p =>
                p.type === "disaster" &&
                p.done === planet.day &&
                p.towns && p.towns.includes(subject.id)
            );

            if (recentlyEnded.length === 0) return false;

            args.disaster = recentlyEnded[0];
            return true;
        },
        func: (subject, target, args) => {
            initTownDisasterData(subject);

            const severity = getDisasterSeverity(args.disaster);

            // Record in history
            subject.disasterHistory.push({
                type: args.disaster.subtype,
                day: planet.day,
                deaths: args.disaster.deaths || 0,
                severity: severity
            });

            // Set recovery period based on severity
            subject.disasterRecovery = severity * 20; // 20-60 days recovery

            // Immediate economic impact - damage trade
            if (severity >= 2) {
                happen("Influence", null, subject, { trade: -severity, temp: true });
                logMessage(`{{regname:town|${subject.id}}} begins recovering from the ${args.disaster.subtype}.`, "warning");
            }
        }
    });

    // Recovery period ticks down and affects town
    modEvent("disasterRecoveryTick", {
        daily: true,
        subject: { reg: "town", all: true },
        value: (subject) => {
            initTownDisasterData(subject);
            return subject.disasterRecovery > 0;
        },
        func: (subject) => {
            subject.disasterRecovery--;

            // Ongoing negative effects during recovery
            if (subject.disasterRecovery > 40) {
                // Severe recovery phase
                happen("Influence", null, subject, { happy: -0.5, temp: true });
            }

            // Recovery complete
            if (subject.disasterRecovery === 0) {
                logMessage(`{{regname:town|${subject.id}}} has recovered from the disaster.`);
                happen("Influence", null, subject, { happy: 1, temp: true });
            }
        }
    });

    // Disaster triggers emergency aid requests to allies
    modEvent("disasterAidRequest", {
        random: true,
        weight: $c.UNCOMMON,
        subject: { reg: "town", random: true },
        value: (subject, target, args) => {
            const disaster = getRecentDisaster(subject, 10);
            if (!disaster) return false;
            if (getDisasterSeverity(disaster) < 1) return false;

            // Must have an alliance
            const alliance = getTownAlliance(subject);
            if (!alliance) return false;

            // Find an ally that hasn't sent aid yet
            for (const memberId of alliance.members) {
                if (memberId === subject.id) continue;
                const ally = regGet("town", memberId);
                if (!ally || ally.end) continue;

                // Check if this ally already sent aid for this disaster
                if (!subject._disasterAidReceived) subject._disasterAidReceived = {};
                if (subject._disasterAidReceived[disaster.id + "_" + ally.id]) continue;

                args.ally = ally;
                args.disaster = disaster;
                args.alliance = alliance;
                return true;
            }
            return false;
        },
        func: (subject, target, args) => {
            if (!subject._disasterAidReceived) subject._disasterAidReceived = {};
            subject._disasterAidReceived[args.disaster.id + "_" + args.ally.id] = true;

            // Ally sends aid
            const aidAmount = 50 + Math.floor(Math.random() * 100);

            // Speed up recovery
            if (subject.disasterRecovery > 10) {
                subject.disasterRecovery -= 10;
            }

            // Boost happiness
            happen("Influence", null, subject, { happy: 1, temp: true });

            // Strengthen alliance bonds
            improveRelations(subject, args.ally, 5);

            logMessage(`{{regname:town|${args.ally.id}}} sends ${aidAmount} in disaster relief to ally {{regname:town|${subject.id}}} through the {{b:${args.alliance.name}}}.`);
        }
    });

    // Disaster-struck towns may seek emergency loans
    modEvent("disasterEmergencyLoan", {
        random: true,
        weight: $c.UNCOMMON,
        subject: { reg: "town", random: true },
        value: (subject, target, args) => {
            const disaster = getRecentDisaster(subject, 15);
            if (!disaster) return false;
            if (getDisasterSeverity(disaster) < 2) return false;

            // Don't already have too many loans
            initEconomy();
            const existingLoans = planet.loans.filter(l => l.borrower === subject.id && !l.repaid);
            if (existingLoans.length >= 2) return false;

            // Find a wealthy neighbor to borrow from
            const neighbors = regFilter("town", t =>
                t.id !== subject.id &&
                !t.end &&
                getRelations(subject, t) > -6 // Not hostile
            );

            if (neighbors.length === 0) return false;

            // Pick richest neighbor
            const lender = neighbors.sort((a, b) => (b.influences?.trade || 0) - (a.influences?.trade || 0))[0];
            args.lender = lender;
            args.disaster = disaster;
            return true;
        },
        func: (subject, target, args) => {
            const amount = 100 + Math.floor(Math.random() * 150);
            const interest = 0.15 + Math.random() * 0.1; // 15-25% interest for emergency

            createLoan(args.lender, subject, amount, interest);

            // Loan helps recovery
            if (subject.disasterRecovery > 5) {
                subject.disasterRecovery -= 5;
            }

            logMessage(`{{regname:town|${subject.id}}} takes an emergency loan of ${amount} from {{regname:town|${args.lender.id}}} for disaster recovery.`);
        }
    });

    // Trade routes disrupted during active disasters
    modEvent("disasterTradeDisruption", {
        daily: true,
        subject: { reg: "town", all: true },
        value: (subject) => {
            return getTownDisaster(subject) !== null;
        },
        func: (subject) => {
            // Ongoing trade penalty during disaster
            happen("Influence", null, subject, { trade: -1, temp: true });
        }
    });

    // ----------------------------------------
    // DISASTER-MIGRATION INTERACTIONS
    // ----------------------------------------

    // Refugees flee disaster-struck towns
    modEvent("disasterRefugees", {
        random: true,
        weight: $c.COMMON,
        subject: { reg: "town", random: true },
        value: (subject, target, args) => {
            const disaster = getTownDisaster(subject);
            if (!disaster) return false;
            if (getDisasterSeverity(disaster) < 1) return false;

            // Find a safe neighbor to flee to
            const safeNeighbors = regFilter("town", t =>
                t.id !== subject.id &&
                !t.end &&
                !getTownDisaster(t) && // Not also in disaster
                getRelations(subject, t) > -6 // Not enemies
            );

            if (safeNeighbors.length === 0) return false;

            // Prefer allies, then neutral, then others
            const alliance = getTownAlliance(subject);
            let destination;

            if (alliance) {
                const allyDestinations = safeNeighbors.filter(t =>
                    alliance.members.includes(t.id)
                );
                if (allyDestinations.length > 0) {
                    destination = choose(allyDestinations);
                }
            }

            if (!destination) {
                destination = choose(safeNeighbors);
            }

            args.destination = destination;
            ensureTownState(args.destination);
            args.disaster = disaster;
            return true;
        },
        func: (subject, target, args) => {
            const severity = getDisasterSeverity(args.disaster);
            const refugees = severity * 5 + Math.floor(Math.random() * 10);

            // Population loss from source
            if (subject.pop > refugees + 10) {
                subject.pop -= refugees;
            }

            // Population gain at destination
            args.destination.pop = (args.destination.pop || 0) + refugees;

            // This can strain relations if not allies
            const alliance = getTownAlliance(subject);
            const isAlly = alliance && alliance.members.includes(args.destination.id);

            if (!isAlly && Math.random() < 0.3) {
                // Refugees strain the destination
                happen("Influence", null, args.destination, { happy: -0.5, temp: true });
            }

            if (Math.random() < 0.2) {
                modLog(
                    "migration",
                    `${refugees} refugees flee from {{regname:town|${subject.id}}} to {{regname:town|${args.destination.id}}} during the ${args.disaster.subtype}.`,
                    null,
                    { town: subject }
                );
            }
            if (refugees > 0) {
                try { markMigration(args.destination, true); } catch {}
            }
        }
    });

    // Skilled workers emigrate after major disasters
    modEvent("disasterBrainDrain", {
        random: true,
        weight: $c.RARE,
        subject: { reg: "town", random: true },
        value: (subject, target, args) => {
            const disaster = getRecentDisaster(subject, 20);
            if (!disaster) return false;
            if (getDisasterSeverity(disaster) < 2) return false;

            // Must have scholars or doctors to lose
            if (!subject.jobs) return false;
            const hasSkilled = (subject.jobs.scholar > 0) || (subject.jobs.doctor > 0);
            if (!hasSkilled) return false;

            // Find a town with universities/hospitals
            const betterTowns = regFilter("town", t =>
                t.id !== subject.id &&
                !t.end &&
                !getRecentDisaster(t, 30) &&
                (hasTownSpecialization(t, "academy") || hasTownSpecialization(t, "healers"))
            );

            if (betterTowns.length === 0) return false;

            args.destination = choose(betterTowns);
            ensureTownState(args.destination);
            args.disaster = disaster;
            return true;
        },
        func: (subject, target, args) => {
            const jobType = subject.jobs.scholar > 0 ? "scholar" : "doctor";
            const count = 1;

            subject.jobs[jobType] = Math.max(0, (subject.jobs[jobType] || 0) - count);
            args.destination.jobs = args.destination.jobs || {};
            args.destination.jobs[jobType] = (args.destination.jobs[jobType] || 0) + count;

            // Education/health impact
            if (jobType === "scholar") {
                happen("Influence", null, subject, { education: -0.5 });
                happen("Influence", null, args.destination, { education: 0.5 });
            } else {
                happen("Influence", null, subject, { disease: 0.3 });
            }

            modLog(
                "migration",
                `A ${jobType} leaves disaster-struck {{regname:town|${subject.id}}} for opportunities in {{regname:town|${args.destination.id}}}.`,
                null,
                { town: subject }
            );
            try { markMigration(args.destination); } catch {}
        }
    });

    // ----------------------------------------
    // DISASTER-DIPLOMACY INTERACTIONS
    // ----------------------------------------

    // Player sway: Offer disaster relief to improve relations
    modEvent("swayDisasterRelief", {
        random: true,
        weight: $c.UNCOMMON,
        subject: { reg: "player", id: 1 },
        target: { reg: "town", random: true },
        value: (subject, target, args) => {
            const disaster = getRecentDisaster(target, 15);
            if (!disaster) return false;
            if (getDisasterSeverity(disaster) < 1) return false;

            args.disaster = disaster;
            return true;
        },
        message: (subject, target, args) => {
            return `{{regname:town|${target.id}}} is recovering from a devastating ${args.disaster.subtype}. Sending relief supplies would earn their gratitude. {{should}}`;
        },
        messageDone: "Aid convoys are dispatched to help the survivors.",
        messageNo: "They must fend for themselves.",
        func: (subject, target, args) => {
            const severity = getDisasterSeverity(args.disaster);

            // Big relations boost
            improveRelations(target, regFilter("town", t => !t.end)[0], severity * 10);

            // Speed their recovery
            if (target.disasterRecovery > 10) {
                target.disasterRecovery -= 10;
            }

            happen("Influence", null, target, { happy: 2, temp: true });

            logMessage(`Relief supplies arrive in {{regname:town|${target.id}}}, speeding recovery from the ${args.disaster.subtype}.`, "milestone");
        }
    });

    // Rivals may exploit disaster-weakened towns
    modEvent("disasterExploitation", {
        random: true,
        weight: $c.RARE,
        subject: { reg: "town", random: true },
        target: { reg: "town", random: true },
        value: (subject, target, args) => {
            if (subject.id === target.id) return false;

            // Subject is recovering from disaster
            const disaster = getRecentDisaster(subject, 20);
            if (!disaster) return false;
            if (getDisasterSeverity(disaster) < 2) return false;

            // Target is a rival
            const relations = getRelations(subject, target);
            if (relations > -20) return false;

            // Not already at war
            const atWar = regFilter("process", p =>
                p.type === "war" &&
                !p.done &&
                p.towns &&
                p.towns.includes(subject.id) &&
                p.towns.includes(target.id)
            );
            if (atWar.length > 0) return false;

            args.disaster = disaster;
            return true;
        },
        func: (subject, target, args) => {
            // Rival makes demands or attacks
            if (Math.random() < 0.5) {
                // Extortion - demand tribute
                logMessage(`{{regname:town|${target.id}}} demands tribute from disaster-weakened {{regname:town|${subject.id}}}.`, "warning");
                worsenRelations(subject, target, 15);
            } else {
                // Declaration of war while weak
                startWar(target, subject);
                logMessage(`{{regname:town|${target.id}}} attacks disaster-weakened {{regname:town|${subject.id}}}!`, "warning");
            }
        }
    });

    // Helping disaster victims improves global reputation
    modEvent("disasterReliefReputation", {
        daily: true,
        subject: { reg: "town", all: true },
        value: (subject, target, args) => {
            // Check if this town sent aid recently (tracked in recipient)
            const recipients = regFilter("town", t =>
                t._disasterAidReceived &&
                Object.keys(t._disasterAidReceived).some(key => key.includes("_" + subject.id))
            );

            if (recipients.length === 0) return false;

            // Only boost once per disaster cycle
            if (subject._lastReliefReputationBoost &&
                planet.day - subject._lastReliefReputationBoost < 30) return false;

            args.recipients = recipients;
            return true;
        },
        func: (subject, target, args) => {
            subject._lastReliefReputationBoost = planet.day;

            // Small relations boost with all towns
            const allTowns = regFilter("town", t => t.id !== subject.id && !t.end);
            for (const town of allTowns) {
                improveRelations(subject, town, 1);
            }

            if (Math.random() < 0.3) {
                logMessage(`{{regname:town|${subject.id}}}'s disaster relief efforts earn respect across the region.`);
            }
        }
    });

    // ----------------------------------------
    // DISASTER-CULTURE INTERACTIONS
    // ----------------------------------------

    // Major disasters inspire memorial construction
    modEvent("disasterMemorial", {
        random: true,
        weight: $c.RARE,
        subject: { reg: "town", random: true },
        value: (subject, target, args) => {
            initTownDisasterData(subject);

            // Check for significant disaster in history
            const majorDisaster = subject.disasterHistory.find(d =>
                d.severity >= 2 &&
                planet.day - d.day >= 30 && // Some time has passed
                planet.day - d.day <= 365   // But not too long ago
            );

            if (!majorDisaster) return false;

            // Haven't built memorial for this disaster
            if (!subject._disasterMemorials) subject._disasterMemorials = [];
            if (subject._disasterMemorials.includes(majorDisaster.day)) return false;

            args.disaster = majorDisaster;
            return true;
        },
        message: (subject, target, args) => {
            return `{{people}} propose building a memorial to honor those lost in the ${args.disaster.type}. {{should}}`;
        },
        messageDone: "A solemn memorial stands as testament to tragedy and resilience.",
        messageNo: "The past is best left buried.",
        func: (subject, target, args) => {
            if (!subject._disasterMemorials) subject._disasterMemorials = [];
            subject._disasterMemorials.push(args.disaster.day);

            // Create landmark
            happen("Create", null, null, {
                type: "landmark",
                subtype: "memorial",
                name: `${args.disaster.type.charAt(0).toUpperCase() + args.disaster.type.slice(1)} Memorial`,
                symbol: "🕯",
                x: getTownCenter(subject)?.[0],
                y: getTownCenter(subject)?.[1]
            });

            // Cultural impact
            initTownCulture(subject);
            subject.culture.prestige += 3;
            addTradition(subject, "spiritual");

            happen("Influence", null, subject, { happy: 1, faith: 1 });
        }
    });

    // Disaster survivors inspire stories and art
    modEvent("disasterSurvivorStories", {
        random: true,
        weight: $c.UNCOMMON,
        subject: { reg: "town", random: true },
        value: (subject) => {
            const disaster = getRecentDisaster(subject, 60);
            if (!disaster) return false;
            if (getDisasterSeverity(disaster) < 1) return false;

            initTownCulture(subject);
            return hasTradition(subject, "literary") || hasTradition(subject, "art");
        },
        func: (subject, target, args) => {
            const disaster = getRecentDisaster(subject, 60);
            const tradition = hasTradition(subject, "literary") ? "literary" : "art";

            subject.culture.prestige += 2;

            if (tradition === "literary") {
                logArtMessage(subject, `Writers in {{regname:town|${subject.id}}} chronicle the ${disaster.subtype} in powerful accounts.`);
            } else {
                logArtMessage(subject, `Artists in {{regname:town|${subject.id}}} create moving works depicting the ${disaster.subtype}.`);
            }
        }
    });

    // Surviving disaster together strengthens community
    modEvent("disasterCommunityBonds", {
        random: true,
        weight: $c.COMMON,
        subject: { reg: "town", random: true },
        value: (subject) => {
            const disaster = getRecentDisaster(subject, 30);
            if (!disaster) return false;
            return getDisasterSeverity(disaster) >= 2;
        },
        func: (subject) => {
            // Surviving tragedy together builds bonds
            happen("Influence", null, subject, { happy: 0.5 });

            // May develop festive tradition (celebrating survival)
            if (Math.random() < 0.1) {
                addTradition(subject, "festive");
                logMessage(`{{regname:town|${subject.id}}} establishes an annual day of remembrance and gratitude.`);
            }
        }
    });

    // ----------------------------------------
    // DISASTER-HEALTH INTERACTIONS
    // ----------------------------------------

    // Earthquakes and floods can trigger disease outbreaks
    modEvent("disasterDiseaseOutbreak", {
        random: true,
        weight: $c.UNCOMMON,
        subject: { reg: "town", random: true },
        value: (subject, target, args) => {
            const disaster = getRecentDisaster(subject, 10);
            if (!disaster) return false;

            // Earthquakes and hurricanes can contaminate water
            if (disaster.subtype !== "earthquake" && disaster.subtype !== "hurricane") return false;

            if (getDisasterSeverity(disaster) < 2) return false;

            // Check if already has active epidemic
            if (subject.activeEpidemic) return false;

            args.disaster = disaster;
            return true;
        },
        func: (subject, target, args) => {
            // Trigger epidemic (using our epidemic system)
            const diseaseTypes = ["fever", "flux"]; // Water-borne diseases
            const disease = choose(diseaseTypes);

            subject.activeEpidemic = {
                type: disease,
                severity: 1,
                day: planet.day,
                source: "disaster"
            };

            happen("Influence", null, subject, { disease: 2 });

            logMessage(`Contaminated water following the ${args.disaster.subtype} causes a ${disease} outbreak in {{regname:town|${subject.id}}}.`, "warning");
        }
    });

    // Hospitals help disaster recovery
    modEvent("disasterHospitalRelief", {
        daily: true,
        subject: { reg: "town", all: true },
        value: (subject) => {
            if (subject.disasterRecovery <= 0) return false;
            return hasTownSpecialization(subject, "healers");
        },
        func: (subject) => {
            // Hospitals speed recovery
            if (subject.disasterRecovery > 1) {
                subject.disasterRecovery--;
            }
        }
    });

    // Disaster overwhelms medical capacity
    modEvent("disasterMedicalCrisis", {
        daily: true,
        subject: { reg: "town", all: true },
        value: (subject) => {
            const disaster = getTownDisaster(subject);
            if (!disaster) return false;
            return getDisasterSeverity(disaster) >= 2;
        },
        func: (subject) => {
            // Disaster strains health system
            happen("Influence", null, subject, { disease: 0.5, temp: true });

            // Doctors work overtime (small chance of burnout)
            if (subject.jobs && subject.jobs.doctor > 0 && Math.random() < 0.05) {
                subject.jobs.doctor--;
                logMessage(`A doctor in {{regname:town|${subject.id}}} collapses from exhaustion during the disaster.`);
            }
        }
    });

    // ----------------------------------------
    // DISASTER-GOVERNMENT INTERACTIONS
    // ----------------------------------------

    // Government response affects satisfaction
    modEvent("disasterGovernmentResponse", {
        random: true,
        weight: $c.COMMON,
        subject: { reg: "town", random: true },
        value: (subject, target, args) => {
            const disaster = getRecentDisaster(subject, 20);
            if (!disaster) return false;
            if (getDisasterSeverity(disaster) < 1) return false;

            // Only trigger once per disaster
            if (subject._disasterResponseChecked === disaster.id) return false;

            args.disaster = disaster;
            return true;
        },
        func: (subject, target, args) => {
            subject._disasterResponseChecked = args.disaster.id;

            initGovernment(subject);
            const govType = subject.governmentType || "council";
            const severity = getDisasterSeverity(args.disaster);

            // Different governments handle disasters differently
            let responseQuality = 0;

            switch (govType) {
                case "democracy":
                case "republic":
                    // Bureaucratic but fair distribution
                    responseQuality = 1;
                    break;
                case "monarchy":
                case "dictatorship":
                    // Can be fast but may favor elites
                    responseQuality = Math.random() < 0.5 ? 2 : -1;
                    break;
                case "theocracy":
                    // Faith-based support networks
                    responseQuality = 1;
                    happen("Influence", null, subject, { faith: 1, temp: true });
                    break;
                case "oligarchy":
                    // Resources exist but may not reach everyone
                    responseQuality = Math.random() < 0.3 ? 1 : -1;
                    break;
                case "commune":
                    // Community pulls together
                    responseQuality = 2;
                    break;
                case "anarchy":
                    // No organized response
                    responseQuality = -2;
                    break;
                default:
                    responseQuality = 0;
            }

            if (responseQuality > 0) {
                happen("Influence", null, subject, { happy: responseQuality, temp: true });
                if (responseQuality >= 2) {
                    logMessage(`{{regname:town|${subject.id}}}'s ${govType} government mounts an effective disaster response.`);
                }
            } else if (responseQuality < 0) {
                happen("Influence", null, subject, { happy: responseQuality, temp: true });
                if (responseQuality <= -1) {
                    logMessage(`{{regname:town|${subject.id}}}'s ${govType} government struggles to respond to the disaster.`, "warning");
                }
            }

            // Poor response in severe disasters can trigger unrest
            if (severity >= 2 && responseQuality <= -1) {
                happen("Influence", null, subject, { crime: 1, temp: true });
            }
        }
    });

    // Failed disaster response can trigger revolution
    modEvent("disasterRevolutionTrigger", {
        random: true,
        weight: $c.VERY_RARE,
        subject: { reg: "town", random: true },
        value: (subject) => {
            initTownDisasterData(subject);

            // Multiple recent disasters with poor recovery
            const recentDisasters = subject.disasterHistory.filter(d =>
                planet.day - d.day <= 180 &&
                d.severity >= 2
            );

            if (recentDisasters.length < 2) return false;

            // Still recovering (government failed)
            if (subject.disasterRecovery <= 20) return false;

            // Already unstable
            const happiness = subject.influences?.happy || 0;
            return happiness < -5;
        },
        func: (subject) => {
            // Revolution triggered by government failure
            happen("Influence", null, subject, { crime: 3, happy: -3, temp: true });

            logMessage(`Years of disasters and government failure ignite revolution in {{regname:town|${subject.id}}}!`, "warning");

            // Could change government type
            if (Math.random() < 0.5) {
                const alternatives = ["democracy", "commune", "anarchy"];
                const newGov = choose(alternatives);
                applyGovernmentType(subject, newGov);
                logMessage(`{{regname:town|${subject.id}}} overthrows its government and establishes a ${newGov}.`, "milestone");
            }
        }
    });

    // ----------------------------------------
    // NEW DISASTER TYPE: DROUGHT/FAMINE
    // ----------------------------------------

    // Drought event - slow-burn agricultural disaster
    modEvent("droughtBegins", {
        random: true,
        weight: $c.RARE,
        subject: { reg: "town", random: true },
        value: (subject) => {
            // Must be agricultural
            if ((subject.influences?.farm || 0) < 10) return false;

            // Not already in drought
            if (subject.drought) return false;

            // Not in wet biomes
            // (Would need chunk data to check biome, simplified here)
            return Math.random() < 0.3;
        },
        message: (subject) => {
            return `The rains have not come to {{regname:town|${subject.id}}}. The crops wither. {{should}}`;
        },
        messageDone: "The people pray for rain.",
        messageNo: "Surely the rains will come soon.",
        func: (subject) => {
            subject.drought = {
                day: planet.day,
                severity: 1
            };

            happen("Influence", null, subject, { farm: -1, temp: true });

            logMessage(`Drought begins in {{regname:town|${subject.id}}}.`, "warning");
        }
    });

    // Drought worsens over time
    modEvent("droughtWorsens", {
        daily: true,
        subject: { reg: "town", all: true },
        value: (subject) => {
            if (!subject.drought || subject.drought.ended) return false;
            return true;
        },
        func: (subject) => {
            const daysSinceStart = planet.day - subject.drought.day;

            // Drought intensifies
            if (daysSinceStart % 15 === 0 && subject.drought.severity < 3) {
                subject.drought.severity++;
                logMessage(`The drought in {{regname:town|${subject.id}}} worsens.`, "warning");
            }

            // Ongoing effects based on severity
            happen("Influence", null, subject, {
                farm: -0.2 * subject.drought.severity,
                happy: -0.1 * subject.drought.severity,
                temp: true
            });

            // Severe drought causes deaths
            if (subject.drought.severity >= 3 && Math.random() < 0.1) {
                const deaths = Math.floor(Math.random() * 5) + 1;
                happen("Death", null, subject, { count: deaths, cause: "famine" });
            }

            // Drought eventually ends (10-50 days based on severity)
            const endChance = 0.02 / subject.drought.severity;
            if (daysSinceStart > 20 && Math.random() < endChance) {
                subject.drought.ended = true;
                logMessage(`The rains finally return to {{regname:town|${subject.id}}}.`, "milestone");
                happen("Influence", null, subject, { happy: 2, temp: true });
            }
        }
    });

    // Famine follows severe drought
    modEvent("famine", {
        random: true,
        weight: $c.UNCOMMON,
        subject: { reg: "town", random: true },
        value: (subject) => {
            if (!subject.drought) return false;
            if (subject.drought.severity < 2) return false;
            if (subject.famine) return false;

            const daysSinceStart = planet.day - subject.drought.day;
            return daysSinceStart > 20;
        },
        func: (subject) => {
            subject.famine = {
                day: planet.day
            };

            logMessage(`Famine strikes {{regname:town|${subject.id}}} as food stores run out!`, "warning");

            // Massive negative effects
            happen("Influence", null, subject, { happy: -3, crime: 2, temp: true });
        }
    });

    // Famine effects
    modEvent("famineEffects", {
        daily: true,
        subject: { reg: "town", all: true },
        value: (subject) => {
            if (!subject.famine || subject.famine.ended) return false;
            return true;
        },
        func: (subject) => {
            // Ongoing deaths
            if (Math.random() < 0.2) {
                const deaths = Math.floor(Math.random() * 10) + 1;
                happen("Death", null, subject, { count: deaths, cause: "famine" });
            }

            // Ongoing misery
            happen("Influence", null, subject, { happy: -0.5, crime: 0.2, temp: true });

            // Famine ends when drought ends and some time passes
            if (subject.drought && subject.drought.ended) {
                const daysSinceDroughtEnd = planet.day - subject.drought.day;
                if (daysSinceDroughtEnd > 30) {
                    subject.famine.ended = true;
                    logMessage(`The famine in {{regname:town|${subject.id}}} subsides as crops begin to grow again.`);
                }
            }
        }
    });

    // Food aid during famine
    modEvent("famineAid", {
        random: true,
        weight: $c.UNCOMMON,
        subject: { reg: "town", random: true },
        target: { reg: "town", random: true },
        value: (subject, target) => {
            if (subject.id === target.id) return false;

            // Subject has famine
            if (!subject.famine || subject.famine.ended) return false;

            // Target is ally or friend
            const alliance = getTownAlliance(subject);
            const isAlly = alliance && alliance.members.includes(target.id);
            const relations = getRelations(subject, target);

            return isAlly || relations > 6;
        },
        func: (subject, target) => {
            // Food aid arrives
            happen("Influence", null, subject, { happy: 1, temp: true });

            // Reduce famine deaths
            if (Math.random() < 0.5 && subject.famine) {
                subject.famine.ended = true;
                logMessage(`Food aid from {{regname:town|${target.id}}} ends the famine in {{regname:town|${subject.id}}}.`, "milestone");
            } else {
                logMessage(`{{regname:town|${target.id}}} sends food aid to famine-struck {{regname:town|${subject.id}}}.`);
            }

            improveRelations(subject, target, 10);
        }
    });

    // ============================================================
    // MIGRATION SYSTEM
    // Expands on base game's massMigrate with targeted reasons
    // ============================================================

    // Helper to calculate town attractiveness for migration
    function getTownAttractiveness(town) {
        let score = 0;

        // Economic factors
        score += (town.influences?.trade || 0) * 0.5;
        score += (town.influences?.happy || 0) * 2;

        // Safety
        score -= (town.influences?.crime || 0) * 1;
        score -= (town.influences?.disease || 0) * 1;

        // Opportunities
        if (hasTownSpecialization(town, "merchants")) score += 3;
        if (hasTownSpecialization(town, "academy")) score += 2;
        if (hasTownSpecialization(town, "healers")) score += 2;

        // Trade routes boost attraction, disrupted routes hurt
        if (planet.tradeRoutes && planet.tradeRoutes.length) {
            const routes = planet.tradeRoutes.filter(r =>
                (r.town1 === town.id || r.town2 === town.id)
            );
            const active = routes.filter(r => r.active !== false).length;
            const inactive = routes.length - active;
            if (active > 0) score += active * 1.2;
            if (inactive > 0) score -= inactive * 1.5;
        }

        // Great Works bring prestige and migrants
        const greatWorks = getTownGreatWorkCount(town, "completed");
        if (greatWorks > 0) score += Math.min(8, greatWorks * 2);

        // Cultural prestige
        initTownCulture(town);
        score += (town.culture?.prestige || 0) * 0.1;

        // Disasters are bad
        if (getTownDisaster(town)) score -= 10;
        if (town.drought && !town.drought.ended) score -= 5;
        if (town.famine && !town.famine.ended) score -= 10;

        // War is bad
        const atWar = regFilter("process", p =>
            p.type === "war" &&
            !p.done &&
            p.towns && p.towns.includes(town.id)
        );
        if (atWar.length > 0) score -= 5;

        return score;
    }

    function getTownBiomeStats(town) {
        if (!town) return null;
        if (town._paultendoBiomeStatsDay === planet.day && town._paultendoBiomeStats) {
            return town._paultendoBiomeStats;
        }
        const chunks = filterChunks(c => c.v.s === town.id);
        if (!chunks.length) return null;
        const counts = {};
        chunks.forEach(c => {
            const biome = c.b || "unknown";
            counts[biome] = (counts[biome] || 0) + 1;
        });
        const total = chunks.length;
        const shares = {};
        Object.keys(counts).forEach(key => {
            shares[key] = counts[key] / total;
        });
        town._paultendoBiomeStats = { counts, shares, total };
        town._paultendoBiomeStatsDay = planet.day;
        return town._paultendoBiomeStats;
    }

    function getTownResourceProfile(town) {
        const stats = getTownBiomeStats(town);
        if (!stats) return null;
        let lumber = 0;
        let fertile = 0;
        let mineral = 0;
        let arid = 0;

        Object.entries(stats.shares).forEach(([biome, share]) => {
            const def = biomes[biome] || {};
            if (def.hasLumber) lumber += share;
            if (!def.infertile && biome !== "mountain" && biome !== "water") fertile += share;
            if (biome === "mountain" || biome === "badlands") mineral += share * 1.2;
            if (biome === "desert" || biome === "badlands") arid += share;
        });

        const coastal = isTownCoastal(town) ? 1 : 0;
        return {
            lumber,
            fertile,
            mineral,
            arid,
            coastal
        };
    }

    function getTownResourceTags(town) {
        const profile = getTownResourceProfile(town);
        if (!profile) return [];
        const tags = [];
        if (profile.mineral > 0.35) tags.push("mineral");
        if (profile.lumber > 0.45) tags.push("lumber");
        if (profile.fertile > 0.55) tags.push("fertile");
        if (profile.coastal) tags.push("coastal");
        if (profile.arid > 0.5) tags.push("arid");
        return tags;
    }

    const MIGRATION_MARKER_DEF = {
        name: "Migration",
        subtype: "migration",
        symbol: ">",
        color: [120, 255, 170]
    };
    const REFUGEE_MARKER_DEF = {
        name: "Refugees",
        subtype: "refugees",
        symbol: "!",
        color: [255, 190, 120]
    };

    function markMigration(target, isRefugee = false) {
        const def = isRefugee ? REFUGEE_MARKER_DEF : MIGRATION_MARKER_DEF;
        return createTempMarker(target, def, isRefugee ? 16 : 10);
    }

    function getMigrationReason(subject, target) {
        if (!subject || !target) return null;
        if (subject.issues?.war) return `as war weighs on {{regname:town|${subject.id}}}`;
        if (subject.activeEpidemic) return `as disease spreads in {{regname:town|${subject.id}}}`;
        if (subject.famine && !subject.famine.ended) return `as famine grips {{regname:town|${subject.id}}}`;
        if (subject.drought && !subject.drought.ended) return `as drought lingers in {{regname:town|${subject.id}}}`;

        const tradeGap = (target.influences?.trade || 0) - (subject.influences?.trade || 0);
        if (tradeGap >= 4) return `drawn by trade in {{regname:town|${target.id}}}`;
        const eduGap = (target.influences?.education || 0) - (subject.influences?.education || 0);
        if (eduGap >= 4) return `seeking learning in {{regname:town|${target.id}}}`;
        const happyGap = (target.influences?.happy || 0) - (subject.influences?.happy || 0);
        if (happyGap >= 3) return `hoping for better lives in {{regname:town|${target.id}}}`;
        return null;
    }

    // Economic migration - people move toward prosperity
    modEvent("economicMigration", {
        random: true,
        weight: $c.COMMON,
        subject: { reg: "town", random: true },
        target: { reg: "town", random: true },
        value: (subject, target, args) => {
            if (subject.id === target.id) return false;
            if (subject.end || target.end) return false;

            // Subject must have decent population
            if (subject.pop < 30) return false;

            // Compare attractiveness
            const subjectScore = getTownAttractiveness(subject);
            const targetScore = getTownAttractiveness(target);

            // Target must be significantly more attractive
            if (targetScore <= subjectScore + 5) return false;

            args.difference = targetScore - subjectScore;
            return true;
        },
        func: (subject, target, args) => {
            // More migrate if difference is larger
            const migrants = Math.min(
                Math.floor(args.difference / 2) + Math.floor(Math.random() * 5),
                Math.floor(subject.pop * 0.1)
            );

            if (migrants < 1) return;

            happen("Migrate", subject, target, { count: migrants });
            try { markMigration(target); } catch {}

            if (Math.random() < 0.15) {
                const reason = getMigrationReason(subject, target);
                const line = reason
                    ? `${migrants} people leave {{regname:town|${subject.id}}} ${reason}.`
                    : `${migrants} people leave {{regname:town|${subject.id}}} seeking opportunity in {{regname:town|${target.id}}}.`;
                modLog("migration", line, null, { town: subject });
            }
        }
    });

    // Skilled worker migration - scholars seek academies
    modEvent("scholarMigration", {
        random: true,
        weight: $c.UNCOMMON,
        subject: { reg: "town", random: true },
        target: { reg: "town", random: true },
        value: (subject, target) => {
            if (subject.id === target.id) return false;

            // Subject has scholars but no academy
            if (!subject.jobs || !subject.jobs.scholar) return false;
            if (hasTownSpecialization(subject, "academy")) return false;

            // Target has academy
            if (!hasTownSpecialization(target, "academy")) return false;

            return true;
        },
        func: (subject, target) => {
            // One scholar migrates
            subject.jobs.scholar--;
            target.jobs = target.jobs || {};
            target.jobs.scholar = (target.jobs.scholar || 0) + 1;

            happen("Influence", null, subject, { education: -0.3 });
            happen("Influence", null, target, { education: 0.3 });

            modLog(
                "migration",
                `A scholar leaves {{regname:town|${subject.id}}} for the academy in {{regname:town|${target.id}}}.`,
                null,
                { town: subject }
            );
            try { markMigration(target); } catch {}
        }
    });

    // Doctor migration - doctors seek hospitals/healer towns
    modEvent("doctorMigration", {
        random: true,
        weight: $c.UNCOMMON,
        subject: { reg: "town", random: true },
        target: { reg: "town", random: true },
        value: (subject, target) => {
            if (subject.id === target.id) return false;

            // Subject has doctors but no hospital
            if (!subject.jobs || !subject.jobs.doctor) return false;
            if (hasTownSpecialization(subject, "healers")) return false;

            // Target has hospital/healers
            if (!hasTownSpecialization(target, "healers")) return false;

            return true;
        },
        func: (subject, target) => {
            subject.jobs.doctor--;
            target.jobs = target.jobs || {};
            target.jobs.doctor = (target.jobs.doctor || 0) + 1;

            modLog(
                "migration",
                `A doctor leaves {{regname:town|${subject.id}}} to practice in {{regname:town|${target.id}}}.`,
                null,
                { town: subject }
            );
            try { markMigration(target); } catch {}
        }
    });

    // Artist migration - artists seek cultural centers
    modEvent("artistMigration", {
        random: true,
        weight: $c.UNCOMMON,
        subject: { reg: "town", random: true },
        target: { reg: "town", random: true },
        value: (subject, target) => {
            if (subject.id === target.id) return false;

            // Subject has cultural workers
            if (!subject.jobs) return false;
            const hasArtist = (subject.jobs.artist || 0) > 0 ||
                              (subject.jobs.musician || 0) > 0 ||
                              (subject.jobs.performer || 0) > 0;
            if (!hasArtist) return false;

            // Compare cultural prestige
            initTownCulture(subject);
            initTownCulture(target);

            if ((target.culture?.prestige || 0) <= (subject.culture?.prestige || 0) + 5) return false;

            return true;
        },
        func: (subject, target) => {
            // Pick which type of artist migrates
            let jobType;
            if (subject.jobs.artist > 0) jobType = "artist";
            else if (subject.jobs.musician > 0) jobType = "musician";
            else jobType = "performer";

            subject.jobs[jobType]--;
            target.jobs = target.jobs || {};
            target.jobs[jobType] = (target.jobs[jobType] || 0) + 1;

            modLog(
                "migration",
                `A ${jobType} leaves {{regname:town|${subject.id}}} for the cultural scene in {{regname:town|${target.id}}}.`,
                null,
                { town: subject }
            );
            try { markMigration(target); } catch {}
        }
    });

    // Religious migration - faithful move toward holy sites
    modEvent("religiousMigration", {
        random: true,
        weight: $c.RARE,
        subject: { reg: "town", random: true },
        target: { reg: "town", random: true },
        value: (subject, target) => {
            if (subject.id === target.id) return false;
            if (subject.pop < 20) return false;

            // Target has high faith or holy order
            const targetFaith = target.influences?.faith || 0;
            const subjectFaith = subject.influences?.faith || 0;

            if (targetFaith <= subjectFaith + 2) return false;

            // Or target has holy order specialization
            if (!hasTownSpecialization(target, "holyOrder") && targetFaith < 6) return false;

            return true;
        },
        func: (subject, target) => {
            const pilgrims = Math.floor(Math.random() * 5) + 1;
            const actualMigrants = Math.min(pilgrims, Math.floor(subject.pop * 0.05));

            if (actualMigrants < 1) return;

            happen("Migrate", subject, target, { count: actualMigrants });
            try { markMigration(target); } catch {}

            // Priests may accompany
            if (subject.jobs && subject.jobs.priest > 0 && Math.random() < 0.2) {
                subject.jobs.priest--;
                target.jobs = target.jobs || {};
                target.jobs.priest = (target.jobs.priest || 0) + 1;
            }

            if (Math.random() < 0.2) {
                modLog(
                    "migration",
                    `Pilgrims from {{regname:town|${subject.id}}} settle in holy {{regname:town|${target.id}}}.`,
                    null,
                    { town: subject }
                );
            }
        }
    });

    // Religious refugees - flee persecution
    modEvent("religiousRefugees", {
        random: true,
        weight: $c.RARE,
        subject: { reg: "town", random: true },
        target: { reg: "town", random: true },
        value: (subject, target) => {
            if (subject.id === target.id) return false;
            if (subject.pop < 30) return false;

            // Subject has low faith but neighboring high faith town
            // (Suggests religious tension/persecution)
            const subjectFaith = subject.influences?.faith || 0;
            const targetFaith = target.influences?.faith || 0;

            // Faith difference creates "persecution" narrative
            if (Math.abs(subjectFaith - targetFaith) < 4) return false;

            // Unhappy people flee
            if ((subject.influences?.happy || 0) > -2) return false;

            return true;
        },
        func: (subject, target) => {
            const refugees = Math.floor(Math.random() * 10) + 5;
            const actualRefugees = Math.min(refugees, Math.floor(subject.pop * 0.1));

            happen("Migrate", subject, target, { count: actualRefugees });
            try { markMigration(target, true); } catch {}

            modLog(
                "migration",
                `Religious refugees flee {{regname:town|${subject.id}}} for {{regname:town|${target.id}}}.`,
                null,
                { town: subject }
            );

            // This worsens relations
            worsenRelations(subject, target, 3);
        }
    });

    // War refugees - flee conflict zones
    modEvent("warRefugees", {
        random: true,
        weight: $c.COMMON,
        subject: { reg: "town", random: true },
        target: { reg: "town", random: true },
        value: (subject, target) => {
            if (subject.id === target.id) return false;
            if (subject.pop < 20) return false;

            // Subject is at war
            const atWar = regFilter("process", p =>
                p.type === "war" &&
                !p.done &&
                p.towns && p.towns.includes(subject.id)
            );
            if (atWar.length === 0) return false;

            // Target is not at war (and not enemy)
            const targetAtWar = regFilter("process", p =>
                p.type === "war" &&
                !p.done &&
                p.towns && p.towns.includes(target.id)
            );
            if (targetAtWar.length > 0) return false;

            // Not fleeing to enemy
            const war = atWar[0];
            if (war.towns.includes(target.id)) return false;

            return true;
        },
        func: (subject, target) => {
            const refugees = Math.floor(Math.random() * 15) + 5;
            const actualRefugees = Math.min(refugees, Math.floor(subject.pop * 0.1));

            happen("Migrate", subject, target, { count: actualRefugees });
            try { markMigration(target, true); } catch {}

            if (Math.random() < 0.2) {
                modLog(
                    "migration",
                    `${actualRefugees} refugees flee the war in {{regname:town|${subject.id}}} for safety in {{regname:town|${target.id}}}.`,
                    null,
                    { town: subject }
                );
            }
        }
    });

    // Return migration - refugees return home after crisis ends
    modEvent("returnMigration", {
        random: true,
        weight: $c.UNCOMMON,
        subject: { reg: "town", random: true },
        value: (subject, target, args) => {
            // Check if this town received refugees recently
            // and source town has recovered
            initTownDisasterData(subject);

            // This is simplified - tracking actual refugee origins would need more data
            // Instead, we simulate return migration based on recovery of nearby towns
            const recoveredNeighbors = regFilter("town", t =>
                t.id !== subject.id &&
                !t.end &&
                t.disasterHistory &&
                t.disasterHistory.some(d =>
                    d.severity >= 2 &&
                    planet.day - d.day >= 60 &&
                    planet.day - d.day <= 180
                ) &&
                t.disasterRecovery === 0 && // Fully recovered
                (t.influences?.happy || 0) > 0 // Happy now
            );

            if (recoveredNeighbors.length === 0) return false;
            if (subject.pop < 20) return false;

            args.destination = choose(recoveredNeighbors);
            ensureTownState(args.destination);
            return true;
        },
        func: (subject, target, args) => {
            const returnees = Math.floor(Math.random() * 5) + 1;
            const actualReturnees = Math.min(returnees, Math.floor(subject.pop * 0.03));

            if (actualReturnees < 1) return;

            happen("Migrate", subject, args.destination, { count: actualReturnees });
            try { markMigration(args.destination); } catch {}

            if (Math.random() < 0.15) {
                modLog(
                    "migration",
                    `Refugees return to rebuilt {{regname:town|${args.destination.id}}} from {{regname:town|${subject.id}}}.`,
                    null,
                    { town: subject }
                );
            }
        }
    });

    // ============================================================
    // CIVIL UNREST & REVOLUTION EXPANSION
    // Adds more triggers and pre-revolution warning signs
    // ============================================================

    // Track unrest level in towns
    function initUnrest(town) {
        if (town.unrest === undefined) {
            town.unrest = 0;
        }
    }

    // Helper to check for economic inequality
    function hasEconomicInequality(town) {
        initGovernment(town);
        const govType = town.governmentType || "tribal";

        // Oligarchy and some other types have inherent inequality
        if (govType === "oligarchy") return true;

        // High trade but low happiness suggests inequality
        const trade = town.influences?.trade || 0;
        const happy = town.influences?.happy || 0;

        return trade > 6 && happy < 0;
    }

    // Check if government matches population desires
    function hasGovernmentMismatch(town) {
        initGovernment(town);
        const govType = town.governmentType || "tribal";
        const education = town.influences?.education || 0;
        const faith = town.influences?.faith || 0;
        const happy = town.influences?.happy || 0;

        // Educated populations chafe under dictatorships
        if (education > 6 && (govType === "dictatorship" || govType === "monarchy")) {
            return true;
        }

        // Low faith populations dislike theocracy
        if (faith < 3 && govType === "theocracy") {
            return true;
        }

        // Very unhappy under any government is mismatch
        if (happy < -4) {
            return true;
        }

        return false;
    }

    // Unrest builds up from various factors
    modEvent("unrestBuildup", {
        daily: true,
        subject: { reg: "town", all: true },
        value: (subject) => {
            if (subject.end) return false;
            if (subject.pop < 20) return false;
            return true;
        },
        func: (subject) => {
            initUnrest(subject);

            let unrestChange = 0;

            // Happiness is primary driver
            const happy = subject.influences?.happy || 0;
            if (happy < -3) unrestChange += 0.2;
            if (happy < -5) unrestChange += 0.3;
            if (happy > 2) unrestChange -= 0.2;
            if (happy > 5) unrestChange -= 0.2;

            // Economic inequality
            if (hasEconomicInequality(subject)) {
                unrestChange += 0.1;
            }

            // Government mismatch
            if (hasGovernmentMismatch(subject)) {
                unrestChange += 0.15;
            }

            // High crime breeds discontent
            const crime = subject.influences?.crime || 0;
            if (crime > 5) unrestChange += 0.1;

            // Disease/disaster add stress
            if (subject.activeEpidemic) unrestChange += 0.1;
            if (subject.drought && !subject.drought.ended) unrestChange += 0.15;
            if (subject.famine && !subject.famine.ended) unrestChange += 0.3;

            // War weariness
            const atWar = regFilter("process", p =>
                p.type === "war" &&
                !p.done &&
                p.towns && p.towns.includes(subject.id)
            );
            if (atWar.length > 0) {
                const warDuration = planet.day - atWar[0].start;
                if (warDuration > 30) unrestChange += 0.1;
                if (warDuration > 60) unrestChange += 0.1;
            }

            // Faith provides stability
            const faith = subject.influences?.faith || 0;
            if (faith > 6) unrestChange -= 0.05;

            // Military suppresses unrest (but at cost)
            const soldiers = subject.jobs?.soldier || 0;
            const soldierRatio = soldiers / subject.pop;
            if (soldierRatio > 0.05) unrestChange -= 0.1;

            // Apply change (clamp 0-100)
            subject.unrest = Math.max(0, Math.min(100, subject.unrest + unrestChange));
        }
    });

    // Protests - warning sign before revolution
    modEvent("protests", {
        random: true,
        weight: $c.UNCOMMON,
        subject: { reg: "town", random: true },
        value: (subject) => {
            initUnrest(subject);
            return subject.unrest >= 20 && subject.unrest < 50;
        },
        func: (subject) => {
            logMessage(`Protests break out in {{regname:town|${subject.id}}} over living conditions.`, "warning");

            // Protests can go either way
            if (Math.random() < 0.3) {
                // Government responds, reduces unrest
                subject.unrest -= 10;
                happen("Influence", null, subject, { happy: 1, temp: true });
            } else {
                // Protests escalate
                subject.unrest += 5;
                happen("Influence", null, subject, { happy: -0.5, temp: true });
            }
        }
    });

    // Strikes - workers refuse to work
    modEvent("strikes", {
        random: true,
        weight: $c.UNCOMMON,
        subject: { reg: "town", random: true },
        value: (subject) => {
            initUnrest(subject);
            if (subject.unrest < 30) return false;

            // Need workers to strike
            return (subject.influences?.trade || 0) > 6 ||
                   (subject.influences?.farm || 0) > 6;
        },
        func: (subject) => {
            logMessage(`Workers in {{regname:town|${subject.id}}} go on strike!`, "warning");

            // Economic damage
            happen("Influence", null, subject, { trade: -2, farm: -1, temp: true });

            // Can reduce unrest if successful
            if (Math.random() < 0.4) {
                subject.unrest -= 15;
                happen("Influence", null, subject, { happy: 2, temp: true });
                logMessage(`Strike in {{regname:town|${subject.id}}} ends with worker concessions.`);
            } else {
                subject.unrest += 5;
            }
        }
    });

    // Riots - violent unrest
    modEvent("riots", {
        random: true,
        weight: $c.UNCOMMON,
        subject: { reg: "town", random: true },
        value: (subject) => {
            initUnrest(subject);
            return subject.unrest >= 50 && subject.unrest < 75;
        },
        func: (subject) => {
            logMessage(`Riots erupt in {{regname:town|${subject.id}}}!`, "warning");

            // Violence and destruction
            happen("Influence", null, subject, { crime: 2, happy: -2, temp: true });

            // Some deaths
            if (Math.random() < 0.5) {
                const deaths = Math.floor(Math.random() * 5) + 1;
                happen("Death", null, subject, { count: deaths, cause: "riot" });
            }

            subject.unrest += 10;
        }
    });

    // Player can try to address unrest
    modEvent("swayAddressGrievances", {
        random: true,
        weight: $c.UNCOMMON,
        subject: { reg: "player", id: 1 },
        target: { reg: "town", random: true },
        value: (subject, target) => {
            initUnrest(target);
            return target.unrest >= 30;
        },
        message: (subject, target) => {
            return `Unrest grows in {{regname:town|${target.id}}}. The people demand change. Address their grievances? {{should}}`;
        },
        messageDone: "Reforms are enacted to calm the populace.",
        messageNo: "The troublemakers will tire eventually.",
        func: (subject, target) => {
            target.unrest -= 30;
            happen("Influence", null, target, { happy: 3, temp: true });
            logMessage(`Reforms in {{regname:town|${target.id}}} ease tensions.`, "milestone");
        },
        funcNo: (subject, target) => {
            target.unrest += 10;
        }
    });

    // Unrest-triggered revolution (supplements base game)
    modEvent("unrestRevolution", {
        random: true,
        weight: $c.RARE,
        subject: { reg: "town", random: true },
        value: (subject) => {
            initUnrest(subject);
            if (subject.unrest < 75) return false;

            // Not already in revolution
            if (subject.issues && subject.issues.revolution) return false;

            // Cooldown
            if (subject.lastRevolution && planet.day - subject.lastRevolution < 25) return false;

            return true;
        },
        func: (subject) => {
            // Trigger base game revolution
            const process = happen("Create", subject, null, {
                type: "revolution",
                town: subject.id,
                duration: Math.max(Math.floor(subject.size / 10), 5)
            }, "process");

            subject.issues = subject.issues || {};
            subject.issues.revolution = process.id;

            // Reset unrest
            subject.unrest = 0;

            logMessage(`Revolution erupts in {{regname:town|${subject.id}}} after months of unrest!`, "warning");
        }
    });

    // Revolution outcomes use our government types
    modEvent("revolutionGovernmentChange", {
        daily: true,
        subject: { reg: "town", all: true },
        value: (subject) => {
            // Check if revolution just ended
            if (!subject._revolutionEndedDay) return false;
            if (subject._revolutionEndedDay !== planet.day - 1) return false;
            if (subject._revolutionGovChanged) return false;

            return true;
        },
        func: (subject) => {
            subject._revolutionGovChanged = true;
            initGovernment(subject);

            const oldGov = subject.governmentType;

            // Revolution outcomes depend on factors
            const education = subject.influences?.education || 0;
            const faith = subject.influences?.faith || 0;
            const military = subject.influences?.military || 0;

            let newGov;

            if (military > 7 && Math.random() < 0.4) {
                // Military takes over
                newGov = "dictatorship";
            } else if (faith > 7 && Math.random() < 0.3) {
                // Religious revolution
                newGov = "theocracy";
            } else if (education > 7 && Math.random() < 0.5) {
                // Educated populace demands representation
                newGov = choose(["democracy", "republic"]);
            } else if (Math.random() < 0.2) {
                // Radical outcome
                newGov = choose(["commune", "anarchy"]);
            } else {
                // Default - something different from before
                const options = Object.keys(GOVERNMENT_TYPES).filter(g => g !== oldGov);
                newGov = choose(options);
            }

            applyGovernmentType(subject, newGov);
            const revolutionType = getRevolutionType(subject, newGov, oldGov);
            applyRevolutionValues(subject, revolutionType, newGov);
            subject._lastRevolutionType = revolutionType;

            // Apply government tensions with neighbors
            const neighbors = regFilter("town", t => t.id !== subject.id && !t.end);
            for (const neighbor of neighbors) {
                const tension = getGovernmentTension(
                    getTownGovernment(subject).id,
                    getTownGovernment(neighbor).id
                );
                if (tension > 0) {
                    worsenRelations(subject, neighbor, tension);
                }
            }
        }
    });

    // Track when revolutions end
    modEvent("trackRevolutionEnd", {
        daily: true,
        subject: { reg: "town", all: true },
        value: (subject) => {
            // Was in revolution, now isn't
            if (subject._wasInRevolution && (!subject.issues || !subject.issues.revolution)) {
                return true;
            }

            // Track current state for next check
            subject._wasInRevolution = subject.issues && subject.issues.revolution;
            return false;
        },
        func: (subject) => {
            subject._wasInRevolution = false;
            subject._revolutionEndedDay = planet.day;
            delete subject._revolutionGovChanged;
        }
    });

    // Coup - military takeover without full revolution
    modEvent("militaryCoup", {
        random: true,
        weight: $c.VERY_RARE,
        subject: { reg: "town", random: true },
        value: (subject) => {
            initUnrest(subject);
            initGovernment(subject);

            // Need significant military
            const soldiers = subject.jobs?.soldier || 0;
            const soldierRatio = soldiers / subject.pop;
            if (soldierRatio < 0.03) return false;

            // Need some unrest but not full revolution
            if (subject.unrest < 40 || subject.unrest > 70) return false;

            // Not already military government
            if (subject.governmentType === "dictatorship") return false;

            // Cooldown
            if (subject._lastCoup && planet.day - subject._lastCoup < 100) return false;

            return true;
        },
        func: (subject) => {
            subject._lastCoup = planet.day;

            const oldGov = subject.governmentType;
            applyGovernmentType(subject, "dictatorship");

            // Coup suppresses unrest
            subject.unrest = 10;

            // Some violence
            const deaths = Math.floor(Math.random() * 10) + 1;
            happen("Death", null, subject, { count: deaths, cause: "coup" });

            logMessage(`Military coup in {{regname:town|${subject.id}}}! The ${oldGov} is overthrown.`, "warning");

            // Relations impact
            const neighbors = regFilter("town", t => t.id !== subject.id && !t.end);
            for (const neighbor of neighbors) {
                initGovernment(neighbor);
                // Democracies condemn coups
                if (neighbor.governmentType === "democracy" || neighbor.governmentType === "republic") {
                    worsenRelations(subject, neighbor, 10);
                }
                // Dictatorships quietly approve
                if (neighbor.governmentType === "dictatorship") {
                    improveRelations(subject, neighbor, 3);
                }
            }
        }
    });

    // Counter-revolution - attempt to restore old order
    modEvent("counterRevolution", {
        random: true,
        weight: $c.VERY_RARE,
        subject: { reg: "town", random: true },
        value: (subject) => {
            // Recently had revolution
            if (!subject.lastRevolution) return false;
            if (planet.day - subject.lastRevolution < 30) return false;
            if (planet.day - subject.lastRevolution > 180) return false;

            // Current government is unstable
            initUnrest(subject);
            if (subject.unrest < 30) return false;

            return true;
        },
        func: (subject) => {
            logMessage(`Counter-revolutionary forces rise in {{regname:town|${subject.id}}}!`, "warning");

            // 50/50 success
            if (Math.random() < 0.5) {
                // Counter-revolution succeeds
                initGovernment(subject);
                const options = ["monarchy", "oligarchy", "republic"];
                const newGov = choose(options);
                applyGovernmentType(subject, newGov);
                applyRevolutionValues(subject, "reactionary", newGov);
                subject._lastRevolutionType = "reactionary";
                subject.unrest = 20;

                logMessage(`Counter-revolution succeeds in {{regname:town|${subject.id}}}. Order is restored.`);
            } else {
                // Fails, increases unrest
                subject.unrest += 20;
                happen("Influence", null, subject, { happy: -2, crime: 2, temp: true });

                const deaths = Math.floor(Math.random() * 15) + 5;
                happen("Death", null, subject, { count: deaths, cause: "counter-revolution" });
            }
        }
    });

    // ============================================================
    // RELIGION SYSTEM
    // Dynamically generated religions with beliefs, spread,
    // reform, schism, and cultural integration
    // ============================================================

    // Religion archetypes that influence generated traits
    const RELIGION_ARCHETYPES = {
        nature: {
            name: "nature-worship",
            prefixes: ["Green", "Wild", "Ancient", "Primal", "Earth"],
            suffixes: ["Way", "Path", "Circle", "Grove", "Faith"],
            deityTypes: ["spirits", "the earth mother", "the wild gods", "nature itself"],
            baseInfluences: { farm: 1, happy: 0.5 },
            practices: ["seasonal festivals", "sacred groves", "animal totems"]
        },
        solar: {
            name: "solar worship",
            prefixes: ["Solar", "Radiant", "Dawn", "Golden", "Bright"],
            suffixes: ["Church", "Order", "Light", "Faith", "Way"],
            deityTypes: ["the sun god", "the light divine", "the radiant one"],
            baseInfluences: { happy: 1, farm: 0.5 },
            practices: ["dawn prayers", "sun temples", "fire rituals"]
        },
        ancestor: {
            name: "ancestor veneration",
            prefixes: ["Elder", "Ancient", "Honored", "Eternal", "Ancestral"],
            suffixes: ["Way", "Tradition", "Path", "Rite", "Custom"],
            deityTypes: ["the honored dead", "ancestral spirits", "the forebears"],
            baseInfluences: { education: 0.5, happy: 0.5 },
            practices: ["tomb shrines", "lineage records", "memorial feasts"]
        },
        mystery: {
            name: "mystery cult",
            prefixes: ["Hidden", "Secret", "Veiled", "Shadow", "Mystic"],
            suffixes: ["Mysteries", "Secrets", "Order", "Brotherhood", "Circle"],
            deityTypes: ["the hidden truth", "the veiled one", "the mysteries"],
            baseInfluences: { education: 1, crime: 0.3 },
            practices: ["initiation rites", "secret knowledge", "hidden temples"]
        },
        martial: {
            name: "warrior cult",
            prefixes: ["Iron", "Steel", "War", "Battle", "Valor"],
            suffixes: ["Creed", "Code", "Order", "Brotherhood", "Way"],
            deityTypes: ["the war god", "the iron lord", "the battle spirits"],
            baseInfluences: { military: 1, happy: -0.3 },
            practices: ["combat trials", "weapon blessings", "warrior burials"]
        },
        ascetic: {
            name: "ascetic tradition",
            prefixes: ["Pure", "Silent", "Empty", "Humble", "Simple"],
            suffixes: ["Path", "Way", "Teaching", "Discipline", "Truth"],
            deityTypes: ["the void", "inner peace", "the absolute"],
            baseInfluences: { education: 0.5, trade: -0.5, happy: 0.5 },
            practices: ["meditation", "fasting", "renunciation"]
        },
        prosperity: {
            name: "prosperity faith",
            prefixes: ["Golden", "Blessed", "Fortune", "Abundant", "Wealthy"],
            suffixes: ["Church", "Faith", "Temple", "Order", "Way"],
            deityTypes: ["the provider", "fortune's grace", "the generous one"],
            baseInfluences: { trade: 1, happy: 0.5 },
            practices: ["tithing", "merchant blessings", "wealth offerings"]
        },
        cosmic: {
            name: "cosmic religion",
            prefixes: ["Celestial", "Star", "Cosmic", "Eternal", "Infinite"],
            suffixes: ["Order", "Church", "Truth", "Way", "Faith"],
            deityTypes: ["the stars", "the cosmic order", "the heavens"],
            baseInfluences: { education: 1, travel: 0.5 },
            practices: ["astrology", "star temples", "celestial calendars"]
        }
    };

    // Track global religions
    function initReligions() {
        if (!planet.religions) {
            planet.religions = [];
        }
    }

    // Generate a unique religion name
    function generateReligionName(archetype, foundingTown) {
        const arch = RELIGION_ARCHETYPES[archetype];

        // Different naming patterns
        const pattern = Math.floor(Math.random() * 5);

        let name;
        switch (pattern) {
            case 0:
                // Prefix + Suffix: "The Golden Faith"
                name = "The " + choose(arch.prefixes) + " " + choose(arch.suffixes);
                break;
            case 1:
                // Town-based: "Townism" or "Church of Town"
                const townRoot = foundingTown.name.split(" ")[0];
                if (Math.random() < 0.5) {
                    name = townRoot + choose(["ism", "ism", "ian Faith", "an Way"]);
                } else {
                    name = choose(["Church", "Temple", "Order", "Path"]) + " of " + townRoot;
                }
                break;
            case 2:
                // Deity-based: "Followers of the Sun God"
                name = choose(["Followers", "Children", "Servants", "Disciples"]) + " of " + choose(arch.deityTypes);
                break;
            case 3:
                // Generated word + suffix
                name = "The " + generateWord(2, true) + " " + choose(arch.suffixes);
                break;
            case 4:
                // Pure generated: "Koralith"
                name = generateWord(3, true);
                break;
        }

        return name;
    }

    // Create a new religion
    function createReligion(foundingTown, parentReligion = null) {
        initReligions();

        // Pick archetype (influenced by town characteristics)
        let archetype;
        if (parentReligion) {
            // Reforms often keep similar archetype but can shift
            archetype = Math.random() < 0.7 ? parentReligion.archetype : choose(Object.keys(RELIGION_ARCHETYPES));
        } else {
            // New religions based on town traits
            const weights = {};
            for (const [key, arch] of Object.entries(RELIGION_ARCHETYPES)) {
                weights[key] = 1;
            }
            // Boost relevant archetypes
            if ((foundingTown.influences?.farm || 0) > 6) weights.nature += 2;
            if ((foundingTown.influences?.military || 0) > 6) weights.martial += 2;
            if ((foundingTown.influences?.trade || 0) > 6) weights.prosperity += 2;
            if ((foundingTown.influences?.education || 0) > 6) {
                weights.cosmic += 2;
                weights.mystery += 1;
            }
            if (hasTownSpecialization(foundingTown, "holyOrder")) weights.ascetic += 2;

            // Weighted random selection
            const total = Object.values(weights).reduce((a, b) => a + b, 0);
            let roll = Math.random() * total;
            for (const [key, weight] of Object.entries(weights)) {
                roll -= weight;
                if (roll <= 0) {
                    archetype = key;
                    break;
                }
            }
            archetype = archetype || choose(Object.keys(RELIGION_ARCHETYPES));
        }

        const arch = RELIGION_ARCHETYPES[archetype];

        // Generate influences with some randomization
        const influences = { ...arch.baseInfluences };
        // Add random minor influences
        const possibleInfluences = ["farm", "trade", "education", "military", "happy", "crime"];
        for (const inf of possibleInfluences) {
            if (Math.random() < 0.2 && !influences[inf]) {
                influences[inf] = (Math.random() - 0.5) * 0.5;
            }
        }

        // Generate tenets (beliefs that can change during reform)
        const tenets = [];
        const possibleTenets = [
            { id: "education", name: "scholarly", effect: { education: 0.5 } },
            { id: "trade", name: "mercantile", effect: { trade: 0.5 } },
            { id: "militarism", name: "militant", effect: { military: 0.5 } },
            { id: "pacifism", name: "pacifist", effect: { military: -0.3, happy: 0.3 } },
            { id: "austerity", name: "austere", effect: { trade: -0.3, happy: 0.3 } },
            { id: "festive", name: "celebratory", effect: { happy: 0.5 } },
            { id: "proselytizing", name: "proselytizing", effect: {} }, // Spreads faster
            { id: "insular", name: "insular", effect: {} }, // Spreads slower, more stable
            { id: "hierarchical", name: "hierarchical", effect: { crime: -0.3 } },
            { id: "egalitarian", name: "egalitarian", effect: { happy: 0.3 } }
        ];

        // Pick 1-3 tenets
        const tenetCount = 1 + Math.floor(Math.random() * 3);
        const availableTenets = [...possibleTenets];
        for (let i = 0; i < tenetCount && availableTenets.length > 0; i++) {
            const idx = Math.floor(Math.random() * availableTenets.length);
            tenets.push(availableTenets.splice(idx, 1)[0]);
        }

        // Apply tenet effects to influences
        for (const tenet of tenets) {
            for (const [key, value] of Object.entries(tenet.effect)) {
                influences[key] = (influences[key] || 0) + value;
            }
        }

        const religion = {
            id: planet.religions.length + 1,
            name: generateReligionName(archetype, foundingTown),
            archetype: archetype,
            foundingTown: foundingTown.id,
            founded: planet.day,
            influences: influences,
            tenets: tenets.map(t => t.id),
            tenetNames: tenets.map(t => t.name),
            practices: choose(arch.practices),
            deityType: choose(arch.deityTypes),
            followers: [foundingTown.id], // Towns that follow this religion
            parent: parentReligion ? parentReligion.id : null,
            reformed: false,
            extinct: false
        };

        planet.religions.push(religion);
        foundingTown.religion = religion.id;

        return religion;
    }

    // Get a town's religion
    function getTownReligion(town) {
        initReligions();
        if (!town.religion) return null;
        return planet.religions.find(r => r.id === town.religion && !r.extinct);
    }

    // Calculate religious compatibility (for relations, spread, etc.)
    function getReligiousCompatibility(religion1, religion2) {
        if (!religion1 || !religion2) return 0;
        if (religion1.id === religion2.id) return 1; // Same religion

        // Same archetype = somewhat compatible
        if (religion1.archetype === religion2.archetype) return 0.5;

        // Parent/child = somewhat compatible
        if (religion1.parent === religion2.id || religion2.parent === religion1.id) return 0.3;

        // Shared tenets = some compatibility
        const shared = religion1.tenets.filter(t => religion2.tenets.includes(t)).length;
        if (shared > 0) return 0.2 * shared;

        // Default incompatible
        return -0.3;
    }

    // Apply religion's influences to a town
    function applyReligionInfluences(town) {
        const religion = getTownReligion(town);
        if (!religion) return;

        for (const [key, value] of Object.entries(religion.influences)) {
            happen("Influence", null, town, { [key]: value * 0.08, temp: true });
        }
    }

    // ----------------------------------------
    // RELIGION EMERGENCE
    // ----------------------------------------

    // New religion emerges in a town without one
    modEvent("religionEmerges", {
        random: true,
        weight: $c.RARE,
        subject: { reg: "town", random: true },
        value: (subject) => {
            // Town needs decent faith but no established religion
            const faith = subject.influences?.faith || 0;
            if (faith < 5) return false;
            if (getTownReligion(subject)) return false;

            // Need some population
            if (subject.pop < 50) return false;

            return true;
        },
        message: (subject) => {
            return `In {{regname:town|${subject.id}}}, a new spiritual movement is taking shape. Allow it to flourish? {{should}}`;
        },
        messageDone: "A new faith is born.",
        messageNo: "The movement fades into obscurity.",
        func: (subject) => {
            const religion = createReligion(subject);

            logMessage(`{{b:${religion.name}}} emerges in {{regname:town|${subject.id}}}, worshipping ${religion.deityType}.`, "milestone");

            happen("Influence", null, subject, { faith: 1, happy: 0.5 });

            // May gain a priest
            if (Math.random() < 0.4) {
                subject.jobs = subject.jobs || {};
                subject.jobs.priest = (subject.jobs.priest || 0) + 1;
            }
        }
    });

    // ----------------------------------------
    // RELIGION SPREAD
    // ----------------------------------------

    // Religion spreads to neighboring towns
    modEvent("religionSpreads", {
        random: true,
        weight: $c.RARE,
        subject: { reg: "town", random: true },
        target: { reg: "town", random: true },
        value: (subject, target, args) => {
            if (subject.id === target.id) return false;

            const subjectReligion = getTownReligion(subject);
            if (!subjectReligion) return false;

            // Target doesn't have a religion, or has a weaker one
            const targetReligion = getTownReligion(target);
            if (targetReligion && targetReligion.id === subjectReligion.id) return false;

            // Check if religion is proselytizing (spreads faster)
            const isProselytizing = subjectReligion.tenets.includes("proselytizing");
            const isInsular = subjectReligion.tenets.includes("insular");

            if (isInsular && Math.random() < 0.7) return false; // Insular spreads slowly

            // Need good relations or trade connection
            const relations = getRelations(subject, target);
            if (relations < -5 && !isProselytizing) return false;

            // Priests help spread
            const priests = subject.jobs?.priest || 0;

            args.religion = subjectReligion;
            args.targetReligion = targetReligion;
            args.priests = priests;
            args.isProselytizing = isProselytizing;
            return true;
        },
        func: (subject, target, args) => {
            const targetReligion = args.targetReligion;

            // Calculate conversion chance
            let chance = 0.2;
            if (args.isProselytizing) chance += 0.1;
            if (args.priests > 0) chance += 0.05 * Math.min(args.priests, 3);
            if (!targetReligion) chance += 0.1; // Easier to convert unreligious

            // Target's faith resistance
            const targetFaith = target.influences?.faith || 0;
            if (targetReligion && targetFaith > 6) chance -= 0.1;

            // Dominance penalty: large faiths spread more slowly
            const totalTowns = regFilter("town", t => !t.end && t.pop > 0).length || 1;
            const share = args.religion.followers.length / totalTowns;
            if (share > 0.4) chance -= 0.05;
            if (share > 0.6) chance -= 0.1;
            if (share > 0.75) chance -= 0.15;

            // Alliance helps
            const alliance = getTownAlliance(subject);
            if (alliance && alliance.members.includes(target.id)) chance += 0.05;

            chance = clampChance(chance, 0.05, 0.7);

            if (Math.random() > chance) return;

            // Conversion happens
            if (targetReligion) {
                // Remove from old religion
                targetReligion.followers = targetReligion.followers.filter(id => id !== target.id);

                // Religious tension
                worsenRelations(subject, target, 3);

                logMessage(`{{b:${args.religion.name}}} spreads to {{regname:town|${target.id}}}, displacing ${targetReligion.name}.`);
            } else {
                logMessage(`{{b:${args.religion.name}}} spreads to {{regname:town|${target.id}}}.`);
            }

            target.religion = args.religion.id;
            args.religion.followers.push(target.id);

            happen("Influence", null, target, { faith: 0.5 });
        }
    });

    // Missionaries actively spread religion
    modEvent("missionaries", {
        random: true,
        weight: $c.RARE,
        subject: { reg: "town", random: true },
        target: { reg: "town", random: true },
        value: (subject, target, args) => {
            if (subject.id === target.id) return false;

            // Need priests to send missionaries
            if (!subject.jobs || subject.jobs.priest < 3) return false;

            const religion = getTownReligion(subject);
            if (!religion) return false;

            // Target doesn't follow this religion
            if (target.religion === religion.id) return false;

            args.religion = religion;
            return true;
        },
        func: (subject, target, args) => {
            const targetReligion = getTownReligion(target);

            // Missionary attempt
            let chance = 0.25;
            if (args.religion.tenets.includes("proselytizing")) chance += 0.1;
            if (targetReligion) chance -= 0.05;
            const totalTowns = regFilter("town", t => !t.end && t.pop > 0).length || 1;
            const share = args.religion.followers.length / totalTowns;
            if (share > 0.5) chance -= 0.1;
            if (share > 0.7) chance -= 0.15;
            chance = clampChance(chance, 0.05, 0.6);

            if (Math.random() < chance) {
                // Success
                if (targetReligion) {
                    targetReligion.followers = targetReligion.followers.filter(id => id !== target.id);
                    logMessage(`Missionaries from {{regname:town|${subject.id}}} convert {{regname:town|${target.id}}} to {{b:${args.religion.name}}}.`);
                    worsenRelations(subject, target, 2);
                } else {
                    logMessage(`Missionaries bring {{b:${args.religion.name}}} to {{regname:town|${target.id}}}.`);
                }

                target.religion = args.religion.id;
                args.religion.followers.push(target.id);
                happen("Influence", null, target, { faith: 1 });
            } else {
                // Failure - may create tension
                if (targetReligion && Math.random() < 0.2) {
                    worsenRelations(subject, target, 3);
                    logMessage(`Missionaries from {{regname:town|${subject.id}}} are rejected by {{regname:town|${target.id}}}.`);
                }
            }
        }
    });

    // ----------------------------------------
    // RELIGION REFORM & SCHISM
    // ----------------------------------------

    // Religious reform - religion updates its tenets
    modEvent("religiousReform", {
        random: true,
        weight: $c.VERY_RARE,
        subject: { reg: "town", random: true },
        value: (subject, target, args) => {
            const religion = getTownReligion(subject);
            if (!religion) return false;

            // Religion needs to be old enough
            if (planet.day - religion.founded < 100) return false;

            // Already reformed recently
            if (religion.reformed && planet.day - religion.reformed < 200) return false;

            // Need education for reform
            if ((subject.influences?.education || 0) < 6) return false;

            // Must be founding town or major center
            if (religion.foundingTown !== subject.id && religion.followers.length < 3) return false;

            args.religion = religion;
            return true;
        },
        message: (subject, target, args) => {
            return `Scholars in {{regname:town|${subject.id}}} propose reforms to {{b:${args.religion.name}}}. Allow the reformation? {{should}}`;
        },
        messageDone: "The faith evolves with new interpretations.",
        messageNo: "Tradition must be preserved.",
        func: (subject, target, args) => {
            const religion = args.religion;

            // Change one tenet
            const possibleTenets = [
                { id: "education", name: "scholarly", effect: { education: 0.5 } },
                { id: "trade", name: "mercantile", effect: { trade: 0.5 } },
                { id: "pacifism", name: "pacifist", effect: { military: -0.3, happy: 0.3 } },
                { id: "festive", name: "celebratory", effect: { happy: 0.5 } },
                { id: "egalitarian", name: "egalitarian", effect: { happy: 0.3 } }
            ];

            const newTenet = choose(possibleTenets.filter(t => !religion.tenets.includes(t.id)));
            if (newTenet) {
                religion.tenets.push(newTenet.id);
                religion.tenetNames.push(newTenet.name);

                // Update influences
                for (const [key, value] of Object.entries(newTenet.effect)) {
                    religion.influences[key] = (religion.influences[key] || 0) + value;
                }
            }

            religion.reformed = planet.day;

            logMessage(`{{b:${religion.name}}} undergoes reformation in {{regname:town|${subject.id}}}, embracing ${newTenet?.name || "new"} teachings.`, "milestone");

            happen("Influence", null, subject, { education: 1, happy: 1 });
        },
        funcNo: (subject, target, args) => {
            // Rejection may cause schism
            if (Math.random() < 0.3) {
                args._causeSchism = true;
            }
        }
    });

    // Religious schism - religion splits into two
    modEvent("religiousSchism", {
        random: true,
        weight: $c.VERY_RARE,
        subject: { reg: "town", random: true },
        value: (subject, target, args) => {
            const religion = getTownReligion(subject);
            if (!religion) return false;

            // Religion needs multiple followers
            if (religion.followers.length < 3) return false;

            // Old enough to have divisions
            if (planet.day - religion.founded < 150) return false;

            // Not founding town (they split off)
            if (religion.foundingTown === subject.id) return false;

            // Need some reason for schism
            const foundingTown = regGet("town", religion.foundingTown);
            if (!foundingTown || foundingTown.end) return false;

            // Different government or bad relations can cause schism
            initGovernment(subject);
            initGovernment(foundingTown);
            const govTension = getGovernmentTension(
                getTownGovernment(subject).id,
                getTownGovernment(foundingTown).id
            );
            const relations = getRelations(subject, foundingTown);

            if (govTension < 2 && relations > -10) return false;

            args.religion = religion;
            args.foundingTown = foundingTown;
            return true;
        },
        func: (subject, target, args) => {
            const oldReligion = args.religion;

            // Create splinter religion
            const newReligion = createReligion(subject, oldReligion);

            // Some followers join the new religion
            const splinterFollowers = oldReligion.followers.filter(id => {
                if (id === oldReligion.foundingTown) return false;
                if (id === subject.id) return true;
                // Nearby towns may join schism
                return Math.random() < 0.3;
            });

            for (const followerId of splinterFollowers) {
                oldReligion.followers = oldReligion.followers.filter(id => id !== followerId);
                newReligion.followers.push(followerId);
                const followerTown = regGet("town", followerId);
                if (followerTown && !followerTown.end) {
                    followerTown.religion = newReligion.id;
                }
            }

            logMessage(`{{b:${newReligion.name}}} splits from {{b:${oldReligion.name}}} in {{regname:town|${subject.id}}}!`, "warning");

            // Schism causes tension between religions
            for (const oldFollowerId of oldReligion.followers) {
                for (const newFollowerId of newReligion.followers) {
                    const oldTown = regGet("town", oldFollowerId);
                    const newTown = regGet("town", newFollowerId);
                    if (oldTown && newTown && !oldTown.end && !newTown.end) {
                        worsenRelations(oldTown, newTown, 5);
                    }
                }
            }
        }
    });

    // ----------------------------------------
    // RELIGION-CULTURE INTEGRATION
    // ----------------------------------------

    // Religious festivals boost culture
    modEvent("religiousFestival", {
        random: true,
        weight: $c.UNCOMMON,
        subject: { reg: "town", random: true },
        value: (subject) => {
            const religion = getTownReligion(subject);
            if (!religion) return false;

            // Religion must have festive tenet or nature archetype
            if (!religion.tenets.includes("festive") && religion.archetype !== "nature") {
                return Math.random() < 0.3; // Others can still have festivals, just rarer
            }
            return true;
        },
        func: (subject) => {
            const religion = getTownReligion(subject);

            happen("Influence", null, subject, { happy: 1.5, faith: 0.5, temp: true });

            initTownCulture(subject);
            if (Math.random() < 0.1) {
                addTradition(subject, "festive");
            }

            if (Math.random() < 0.3) {
                logMessage(`{{regname:town|${subject.id}}} celebrates a festival of {{b:${religion.name}}}.`);
            }
        }
    });

    // Religion inspires art and architecture
    modEvent("religiousArt", {
        random: true,
        weight: $c.UNCOMMON,
        subject: { reg: "town", random: true },
        value: (subject) => {
            const religion = getTownReligion(subject);
            if (!religion) return false;

            initTownCulture(subject);
            return hasTradition(subject, "art") || hasTradition(subject, "music");
        },
        func: (subject) => {
            const religion = getTownReligion(subject);
            initTownCulture(subject);

            subject.culture.prestige += 1;
            happen("Influence", null, subject, { faith: 0.3 });

            const artType = hasTradition(subject, "art") ? "artwork" : "hymns";
            if (Math.random() < 0.2) {
                logArtMessage(subject, `Artists in {{regname:town|${subject.id}}} create ${artType} honoring {{b:${religion.name}}}.`);
            }
        }
    });

    // Religion influences scholarly tradition
    modEvent("religiousScholarship", {
        random: true,
        weight: $c.UNCOMMON,
        subject: { reg: "town", random: true },
        value: (subject) => {
            const religion = getTownReligion(subject);
            if (!religion) return false;

            // Need scholarly tenet or cosmic/mystery archetype
            if (!religion.tenets.includes("education") &&
                religion.archetype !== "cosmic" &&
                religion.archetype !== "mystery") return false;

            return (subject.influences?.education || 0) > 6;
        },
        func: (subject) => {
            const religion = getTownReligion(subject);

            happen("Influence", null, subject, { education: 0.5, faith: 0.2 });

            initTownCulture(subject);
            if (Math.random() < 0.1) {
                addTradition(subject, "scholarly");
            }

            if (Math.random() < 0.2) {
                logMessage(`Scholars of {{b:${religion.name}}} advance learning in {{regname:town|${subject.id}}}.`);
            }
        }
    });

    // ----------------------------------------
    // RELIGION-GOVERNMENT INTERACTIONS
    // ----------------------------------------

    // Theocracy strengthens state religion
    modEvent("theocracyReligion", {
        daily: true,
        subject: { reg: "town", all: true },
        value: (subject) => {
            initGovernment(subject);
            return subject.governmentType === "theocracy";
        },
        func: (subject) => {
            const religion = getTownReligion(subject);
            const faith = subject.influences?.faith || 0;

            if (religion) {
                // Theocracy strengthens existing religion
                if (faith < 8) {
                    happen("Influence", null, subject, { faith: 0.05, temp: true });
                }
            } else if (Math.random() < 0.01) {
                // Theocracy without religion creates one
                const newReligion = createReligion(subject);
                logMessage(`{{regname:town|${subject.id}}}'s theocracy establishes {{b:${newReligion.name}}} as the state faith.`);
            }
        }
    });

    // ----------------------------------------
    // RELIGION EFFECTS (DAILY)
    // ----------------------------------------

    // Apply religion influences daily
    modEvent("religionDailyEffects", {
        daily: true,
        subject: { reg: "town", all: true },
        value: (subject) => {
            return getTownReligion(subject) !== null;
        },
        func: (subject) => {
            applyReligionInfluences(subject);
        }
    });

    // Religion provides stability
    modEvent("religiousStability", {
        daily: true,
        subject: { reg: "town", all: true },
        value: (subject) => {
            const religion = getTownReligion(subject);
            if (!religion) return false;

            initUnrest(subject);
            return subject.unrest > 0;
        },
        func: (subject) => {
            const religion = getTownReligion(subject);
            const faith = subject.influences?.faith || 0;

            // Religion reduces unrest
            if (faith > 4) {
                subject.unrest = Math.max(0, subject.unrest - 0.05);
            }

            // Hierarchical religions are especially stabilizing
            if (religion.tenets.includes("hierarchical") && subject.unrest > 10) {
                subject.unrest -= 0.05;
            }
        }
    });

    // Faith inspires culture and learning
    modEvent("sacredArtsBloom", {
        random: true,
        weight: $c.RARE,
        subject: { reg: "town", random: true },
        value: (subject, target, args) => {
            const religion = getTownReligion(subject);
            if (!religion) return false;
            if ((subject.influences?.faith || 0) < 4) return false;
            if (!hasTradition(subject, "art") &&
                !hasTradition(subject, "music") &&
                !hasTradition(subject, "literary") &&
                !hasCulturalLandmark(subject, "theater") &&
                !hasCulturalLandmark(subject, "gallery")) {
                return false;
            }
            args.religion = religion;
            return true;
        },
        func: (subject, target, args) => {
            initTownCulture(subject);
            subject.culture.prestige += 1;
            happen("Influence", null, subject, { happy: 0.3, education: 0.2, temp: true });
            if (Math.random() < 0.35) {
                modLog(
                    "religion",
                    `Artisans in {{regname:town|${subject.id}}} create works honoring {{b:${args.religion.name}}}.`,
                    null,
                    { town: subject }
                );
            }
        }
    });

    // Education-driven secular debates
    modEvent("secularDebate", {
        random: true,
        weight: $c.RARE,
        subject: { reg: "town", random: true },
        value: (subject) => {
            if ((subject.influences?.education || 0) < 7) return false;
            if ((subject.influences?.faith || 0) > 2) return false;
            return true;
        },
        func: (subject) => {
            const gov = getTownGovernment(subject).id;
            if (gov === "theocracy") {
                initUnrest(subject);
                subject.unrest = Math.min(100, subject.unrest + 0.8);
                happen("Influence", null, subject, { faith: -0.4, happy: -0.2, temp: true });
                if (Math.random() < 0.3) {
                    modLog(
                        "religion",
                        `Secular debates shake {{regname:town|${subject.id}}}'s theocracy.`,
                        "warning",
                        { town: subject }
                    );
                }
            } else {
                happen("Influence", null, subject, { education: 0.3, trade: 0.2, temp: true });
                if (Math.random() < 0.2) {
                    modLog(
                        "religion",
                        `Secular scholars in {{regname:town|${subject.id}}} reshape public life.`,
                        null,
                        { town: subject }
                    );
                }
            }
        }
    });

    // ----------------------------------------
    // RELIGIOUS CONFLICTS
    // ----------------------------------------

    // Religious tensions between towns
    modEvent("religiousTension", {
        random: true,
        weight: $c.RARE,
        subject: { reg: "town", random: true },
        target: { reg: "town", random: true },
        value: (subject, target, args) => {
            if (subject.id === target.id) return false;

            const subjectReligion = getTownReligion(subject);
            const targetReligion = getTownReligion(target);

            if (!subjectReligion || !targetReligion) return false;
            if (subjectReligion.id === targetReligion.id) return false;

            // Check compatibility
            const compatibility = getReligiousCompatibility(subjectReligion, targetReligion);
            if (compatibility >= 0) return false;

            args.subjectReligion = subjectReligion;
            args.targetReligion = targetReligion;
            args.compatibility = compatibility;
            return true;
        },
        func: (subject, target, args) => {
            // Religious differences strain relations
            const tensionAmount = Math.abs(args.compatibility) * 2;
            worsenRelations(subject, target, tensionAmount);

            if (Math.random() < 0.2) {
                logMessage(`Religious differences between {{b:${args.subjectReligion.name}}} and {{b:${args.targetReligion.name}}} strain relations between {{regname:town|${subject.id}}} and {{regname:town|${target.id}}}.`);
            }
        }
    });

    // Holy war - war triggered by religious differences
    modEvent("holyWar", {
        random: true,
        weight: $c.VERY_RARE,
        subject: { reg: "town", random: true },
        target: { reg: "town", random: true },
        value: (subject, target, args) => {
            if (subject.id === target.id) return false;

            const subjectReligion = getTownReligion(subject);
            const targetReligion = getTownReligion(target);

            if (!subjectReligion) return false;
            if (!targetReligion || subjectReligion.id === targetReligion.id) return false;
            if (subjectReligion.followers.length < 3) return false;

            // Need militant religion or martial tenet
            if (subjectReligion.archetype !== "martial" &&
                !subjectReligion.tenets.includes("militarism")) return false;

            // Faith must be strong enough to fuel conflict
            const subjectFaith = subject.influences?.faith || 0;
            const targetFaith = target.influences?.faith || 0;
            if (subjectFaith < 6 || targetFaith < 4) return false;

            // Avoid frequent holy wars
            if (planet.lastHolyWar && planet.day - planet.lastHolyWar < 120) return false;

            // Already bad relations
            const relations = getRelations(subject, target);
            if (relations > -7) return false;

            // Not already at war
            const atWar = regFilter("process", p =>
                p.type === "war" &&
                !p.done &&
                p.towns &&
                p.towns.includes(subject.id) &&
                p.towns.includes(target.id)
            );
            if (atWar.length > 0) return false;

            args.subjectReligion = subjectReligion;
            args.targetReligion = targetReligion;
            return true;
        },
        func: (subject, target, args) => {
            startWar(subject, target);

            logMessage(`{{regname:town|${subject.id}}} declares holy war on {{regname:town|${target.id}}} in the name of {{b:${args.subjectReligion.name}}}!`, "warning");

            // Holy war boosts faith and military
            planet.lastHolyWar = planet.day;
            happen("Influence", null, subject, { faith: 1, military: 0.5, temp: true });
        }
    });

    // ----------------------------------------
    // PLAYER SWAY EVENTS
    // ----------------------------------------

    // Player can encourage religious conversion
    modEvent("swayReligiousConversion", {
        random: true,
        weight: $c.RARE,
        subject: { reg: "player", id: 1 },
        target: { reg: "town", random: true },
        value: (subject, target, args) => {
            // Target has no religion
            if (getTownReligion(target)) return false;

            // There are religions to convert to
            initReligions();
            if (planet.religions.length === 0) return false;

            // Find a nearby religion
            const nearbyReligion = planet.religions.find(r =>
                !r.extinct &&
                r.followers.some(id => {
                    const town = regGet("town", id);
                    return town && !town.end && getRelations(target, town) > -6;
                })
            );

            if (!nearbyReligion) return false;

            args.religion = nearbyReligion;
            return true;
        },
        message: (subject, target, args) => {
            return `{{regname:town|${target.id}}} has no established faith. Encourage them to embrace {{b:${args.religion.name}}}? {{should}}`;
        },
        messageDone: "The faith finds new followers.",
        messageNo: "They will find their own spiritual path.",
        func: (subject, target, args) => {
            target.religion = args.religion.id;
            args.religion.followers.push(target.id);

            happen("Influence", null, target, { faith: 1, happy: 0.5 });

            logMessage(`{{regname:town|${target.id}}} embraces {{b:${args.religion.name}}}.`, "milestone");
        }
    });

    // Player can encourage religious tolerance
    modEvent("swayReligiousTolerance", {
        random: true,
        weight: $c.RARE,
        subject: { reg: "player", id: 1 },
        target: { reg: "town", random: true },
        value: (subject, target, args) => {
            const religion = getTownReligion(target);
            if (!religion) return false;

            // Find a town with different religion and bad relations
            initReligions();
            const rivalTown = regFilter("town", t => {
                if (t.id === target.id || t.end) return false;
                const theirReligion = getTownReligion(t);
                if (!theirReligion || theirReligion.id === religion.id) return false;
                return getRelations(target, t) < -5;
            })[0];

            if (!rivalTown) return false;

            args.religion = religion;
            args.rivalTown = rivalTown;
            args.rivalReligion = getTownReligion(rivalTown);
            return true;
        },
        message: (subject, target, args) => {
            return `Religious tensions simmer between {{regname:town|${target.id}}} and {{regname:town|${args.rivalTown.id}}}. Encourage tolerance? {{should}}`;
        },
        messageDone: "Peace is urged between the faiths.",
        messageNo: "Faith must be defended.",
        func: (subject, target, args) => {
            improveRelations(target, args.rivalTown, 10);
            happen("Influence", null, target, { happy: 1 });
            happen("Influence", null, args.rivalTown, { happy: 1 });

            logMessage(`{{regname:town|${target.id}}} and {{regname:town|${args.rivalTown.id}}} agree to religious tolerance.`, "milestone");
        }
    });

    // ============================================================
    // LEGACY & HISTORY SYSTEM
    // Tracks significant events, notable figures, historical
    // grudges/bonds, and eras for richer emergent storytelling
    // ============================================================

    // History entry types
    const HISTORY_TYPES = {
        WAR: "war",
        DISASTER: "disaster",
        REVOLUTION: "revolution",
        RELIGION_FOUNDED: "religion_founded",
        RELIGION_SCHISM: "religion_schism",
        ALLIANCE_FORMED: "alliance_formed",
        ALLIANCE_DISSOLVED: "alliance_dissolved",
        TOWN_FOUNDED: "town_founded",
        TOWN_FALLEN: "town_fallen",
        FIGURE_BORN: "figure_born",
        FIGURE_DIED: "figure_died",
        ERA_BEGAN: "era_began",
        TECHNOLOGY: "technology",
        CULTURAL_ACHIEVEMENT: "cultural_achievement"
    };

    const HISTORY_DETAIL_TYPE_MAP = {
        art: HISTORY_TYPES.CULTURAL_ACHIEVEMENT,
        scholarship: HISTORY_TYPES.CULTURAL_ACHIEVEMENT,
        desertification: "ENVIRONMENTAL"
    };

    // Figure types
    const FIGURE_TYPES = {
        HERO: { title: "Hero", adjectives: ["brave", "valiant", "legendary", "renowned"] },
        MARTYR: { title: "Martyr", adjectives: ["tragic", "beloved", "sacrificed", "remembered"] },
        PROPHET: { title: "Prophet", adjectives: ["holy", "enlightened", "visionary", "blessed"] },
        SCHOLAR: { title: "Scholar", adjectives: ["wise", "brilliant", "learned", "great"] },
        TYRANT: { title: "Tyrant", adjectives: ["cruel", "feared", "despised", "ruthless"] },
        REVOLUTIONARY: { title: "Revolutionary", adjectives: ["bold", "defiant", "legendary", "inspiring"] },
        GENERAL: { title: "General", adjectives: ["cunning", "victorious", "feared", "celebrated"] },
        FOUNDER: { title: "Founder", adjectives: ["visionary", "pioneering", "revered", "first"] },
        ARTIST: { title: "Artist", adjectives: ["gifted", "celebrated", "inspired", "master"] },
        HEALER: { title: "Healer", adjectives: ["compassionate", "miraculous", "selfless", "beloved"] }
    };

    // Initialize history system
    function initHistory() {
        if (!planet.history) {
            planet.history = [];
        }
        if (!planet.figures) {
            planet.figures = [];
        }
        if (!planet.eras) {
            planet.eras = [];
        }
        if (!planet.currentEra) {
            planet.currentEra = null;
        }
        if (!planet._paultendoHistoryNormalized) {
            for (const entry of planet.history) {
                normalizeHistoryEntry(entry);
            }
            planet._paultendoHistoryNormalized = true;
        }
        if (!planet._paultendoFiguresNormalized) {
            for (const figure of planet.figures) {
                normalizeFigure(figure);
            }
            planet._paultendoFiguresNormalized = true;
        }
    }

    function normalizeHistoryEntry(entry) {
        if (!entry) return;
        if (entry.historyType) {
            ensureHistoryName(entry);
            return;
        }
        const knownTypes = Object.values(HISTORY_TYPES);
        if (knownTypes.includes(entry.type)) {
            entry.historyType = entry.type;
            ensureHistoryName(entry);
            return;
        }
        const mapped = HISTORY_DETAIL_TYPE_MAP[entry.type];
        if (mapped) {
            entry.historyType = mapped;
            if (mapped === HISTORY_TYPES.CULTURAL_ACHIEVEMENT && !entry.achievementType) {
                entry.achievementType = entry.type;
            }
            if (entry.subtype === undefined) entry.subtype = entry.type;
            ensureHistoryName(entry);
            return;
        }
        if (entry.type) entry.historyType = entry.type;
        ensureHistoryName(entry);
    }

    function safeTitleCase(value) {
        if (!value) return "";
        if (typeof titleCase === "function") return titleCase(value);
        return value.toString().replace(/\b\w/g, (c) => c.toUpperCase());
    }

    function getTownNameById(id) {
        if (!id) return null;
        const town = regGet("town", id);
        return town && town.name ? town.name : null;
    }

    function getAllianceNameById(id) {
        if (!id || !planet.alliances) return null;
        const alliance = planet.alliances.find(a => a.id === id);
        return alliance ? alliance.name : null;
    }

    function getReligionNameById(id) {
        if (!id || !planet.religions) return null;
        const religion = planet.religions.find(r => r.id === id);
        return religion ? religion.name : null;
    }

    function getFigureDisplayNameById(id) {
        if (!id || !planet.figures) return null;
        const figure = planet.figures.find(f => f.id === id);
        if (!figure) return null;
        return figure.fullTitle || figure.name || null;
    }

    function normalizeFigure(figure) {
        if (!figure) return;
        const typeDef = FIGURE_TYPES[figure.type] || { title: "Figure", adjectives: ["noted"] };
        if (!figure.title) figure.title = typeDef.title;
        if (!figure.adjective) figure.adjective = (typeDef.adjectives && typeDef.adjectives[0]) ? typeDef.adjectives[0] : "noted";
        if (!figure.name) figure.name = "Unknown";
        if (!figure.fullTitle) {
            figure.fullTitle = figure.adjective && figure.name
                ? `${figure.name} the ${figure.adjective}`
                : (figure.name || figure.title || "Figure");
        }
    }

    function getFigureDisplayName(figure) {
        if (!figure) return "a figure";
        normalizeFigure(figure);
        return figure.fullTitle || figure.name || "a figure";
    }

    function ensureHistoryName(entry) {
        if (!entry) return null;
        if (entry.name && entry.name !== "undefined") return entry.name;

        const type = entry.historyType || entry.type;
        const day = entry.day !== undefined ? entry.day : (planet ? planet.day : 0);
        let name = null;

        switch (type) {
            case HISTORY_TYPES.WAR: {
                const victor = entry.victorName || getTownNameById(entry.victor);
                const loser = entry.loserName || getTownNameById(entry.loser);
                if (victor && loser) name = `The ${victor}-${loser} War`;
                else if (Array.isArray(entry.towns) && entry.towns.length >= 2) {
                    const t1 = getTownNameById(entry.towns[0]);
                    const t2 = getTownNameById(entry.towns[1]);
                    if (t1 && t2) name = `The ${t1}-${t2} War`;
                }
                if (!name) name = `War of Day ${day}`;
                break;
            }
            case HISTORY_TYPES.TOWN_FOUNDED: {
                const townName = entry.townName || getTownNameById(entry.town);
                name = townName ? `Founding of ${townName}` : `Founding Day ${day}`;
                break;
            }
            case HISTORY_TYPES.TOWN_FALLEN: {
                const townName = entry.townName || getTownNameById(entry.town);
                name = townName ? `Fall of ${townName}` : `A Town Falls (Day ${day})`;
                break;
            }
            case HISTORY_TYPES.ALLIANCE_FORMED: {
                const allianceName = entry.allianceName || getAllianceNameById(entry.alliance);
                name = allianceName ? `Formation of ${allianceName}` : `Alliance Forged (Day ${day})`;
                break;
            }
            case HISTORY_TYPES.ALLIANCE_DISSOLVED: {
                const allianceName = entry.allianceName || getAllianceNameById(entry.alliance);
                name = allianceName ? `Dissolution of ${allianceName}` : `Alliance Dissolved (Day ${day})`;
                break;
            }
            case HISTORY_TYPES.RELIGION_FOUNDED: {
                const religionName = entry.religionName || getReligionNameById(entry.religion);
                name = religionName ? `${religionName} Founded` : `Religion Founded (Day ${day})`;
                break;
            }
            case HISTORY_TYPES.RELIGION_SCHISM: {
                const religionName = entry.religionName || getReligionNameById(entry.religion);
                name = religionName ? `${religionName} Schism` : `Religious Schism (Day ${day})`;
                break;
            }
            case HISTORY_TYPES.REVOLUTION: {
                const townName = entry.townName || getTownNameById(entry.town);
                name = townName ? `The ${townName} Revolution` : `Revolution of Day ${day}`;
                break;
            }
            case HISTORY_TYPES.DISASTER: {
                const subtype = entry.subtype || entry.detailType || entry.disasterType;
                if (subtype) name = `The ${safeTitleCase(subtype)} of Day ${day}`;
                else name = `Disaster of Day ${day}`;
                break;
            }
            case HISTORY_TYPES.ERA_BEGAN: {
                const eraName = entry.eraName || entry.era;
                name = eraName ? `Beginning of the ${eraName} Era` : `Era Begins (Day ${day})`;
                break;
            }
            case HISTORY_TYPES.FIGURE_BORN: {
                const figureName = entry.figureName || getFigureDisplayNameById(entry.figureId);
                name = figureName ? `Birth of ${figureName}` : `Birth of a Figure (Day ${day})`;
                break;
            }
            case HISTORY_TYPES.FIGURE_DIED: {
                const figureName = entry.figureName || getFigureDisplayNameById(entry.figureId);
                name = figureName ? `Death of ${figureName}` : `Death of a Figure (Day ${day})`;
                break;
            }
            case HISTORY_TYPES.CULTURAL_ACHIEVEMENT: {
                if (entry.title) name = entry.title;
                else if (entry.achievementType) name = `${safeTitleCase(entry.achievementType)} Achievement`;
                else name = `Cultural Achievement (Day ${day})`;
                break;
            }
            default: {
                if (entry.title) name = entry.title;
                else if (entry.subtype) name = safeTitleCase(entry.subtype);
                else name = `${safeTitleCase(type || "Event")} (Day ${day})`;
            }
        }

        entry.name = name || entry.name || `Event (Day ${day})`;
        return entry.name;
    }

    function getHistoryDisplayName(entry) {
        if (!entry) return "an event";
        return ensureHistoryName(entry) || "an event";
    }

    // Record a historical event
    function recordHistory(type, data) {
        initHistory();

        const payload = data ? { ...data } : {};
        let detailType;
        if (payload && Object.prototype.hasOwnProperty.call(payload, "type")) {
            detailType = payload.type;
            delete payload.type;
        }

        const entry = {
            id: planet.history.length + 1,
            type: type,
            historyType: type,
            day: planet.day,
            ...payload
        };

        if (detailType !== undefined) {
            entry.detailType = detailType;
            if (entry.subtype === undefined) entry.subtype = detailType;
        }

        ensureHistoryName(entry);
        planet.history.push(entry);
        return entry;
    }

    // ----------------------------------------
    // ANNALS SYSTEM (long-form storytelling)
    // ----------------------------------------

    const ANNALS_THEME_NAMES = {
        era: "Era",
        war: "War",
        discovery: "Discovery",
        faith: "Faith",
        diplomacy: "Diplomacy",
        culture: "Culture",
        revolution: "Revolution",
        expansion: "Expansion",
        learning: "Learning",
        hardship: "Hardship",
        myth: "Myth",
        nature: "Nature"
    };

    const ANNALS_MAX_ENTRIES = 200;

    function initAnnals() {
        if (!planet.annals) {
            planet.annals = [];
        }
        if (!planet._paultendoAnnalsMeta) {
            const maxId = planet.annals.reduce((max, entry) => Math.max(max, entry.id || 0), 0);
            planet._paultendoAnnalsMeta = { lastId: maxId };
        }
        if (!planet._paultendoAnnalsNormalized) {
            for (const entry of planet.annals) {
                if (!entry) continue;
                if (typeof entry.title === "string") entry.title = normalizeLoreEntities(entry.title);
                if (typeof entry.body === "string") entry.body = normalizeLoreEntities(entry.body);
            }
            planet._paultendoAnnalsNormalized = true;
        }
    }

    function getAnnalsEraContext() {
        initHistory();
        if (planet.currentEra) {
            return { type: planet.currentEra.type, name: planet.currentEra.name };
        }
        if (planet.eras && planet.eras.length) {
            const lastEra = planet.eras[planet.eras.length - 1];
            return { type: lastEra.type, name: lastEra.name };
        }
        return { type: "early", name: "The Early Days" };
    }

    function getAnnalsStage() {
        const edu = planet.unlocks?.education || 0;
        if (planet.day < 200 || edu < 10) return "oral";
        if (planet.day < 600 || edu < 30) return "scribe";
        return "scholar";
    }

    const ANNALS_VOICES = {
        oral: { id: "oral", name: "The Hearth-Teller" },
        scribe: { id: "scribe", name: "The Chronicler" },
        scholar: { id: "scholar", name: "The Archivist" }
    };

    function getAnnalsVoice(theme) {
        const stage = getAnnalsStage();
        return ANNALS_VOICES[stage] || ANNALS_VOICES.scribe;
    }

    function townRef(townId) {
        if (!townId) return "a distant town";
        return `{{regname:town|${townId}}}`;
    }

    function landmassRef(landmassId) {
        if (!landmassId) return "unknown lands";
        return `{{regname:landmass|${landmassId}}}`;
    }

    function recordAnnalsEntry(data) {
        if (!data || !data.title || !data.body) return null;
        initAnnals();

        if (typeof data.title === "string") data.title = normalizeLoreEntities(data.title);
        if (typeof data.body === "string") data.body = normalizeLoreEntities(data.body);

        if (data.sourceType && data.sourceId) {
            const existing = planet.annals.find(a =>
                a.sourceType === data.sourceType && a.sourceId === data.sourceId
            );
            if (existing) return existing;
        }

        const era = getAnnalsEraContext();
        const voice = getAnnalsVoice(data.theme);

        const entryDay = data.day !== undefined ? data.day : planet.day;
        const entry = {
            id: planet._paultendoAnnalsMeta.lastId + 1,
            day: entryDay,
            theme: data.theme || "era",
            eraType: data.eraType || era.type,
            eraName: data.eraName || era.name,
            title: data.title,
            body: data.body,
            voiceId: voice.id,
            voiceName: voice.name,
            townId: data.townId || null,
            historyId: data.historyId || null,
            religionId: data.religionId || null,
            figureId: data.figureId || null,
            sourceType: data.sourceType,
            sourceId: data.sourceId
        };

        planet._paultendoAnnalsMeta.lastId = entry.id;
        planet.annals.push(entry);

        if (planet.annals.length > ANNALS_MAX_ENTRIES) {
            planet.annals.splice(0, planet.annals.length - ANNALS_MAX_ENTRIES);
        }
        try { noteLoreEntry(entry); } catch {}
        return entry;
    }

    function themeLine(theme, stage) {
        if (Math.random() > 0.3) return null;
        switch (theme) {
            case "war":
                return stage === "oral"
                    ? "The warriors still sing of those days."
                    : stage === "scribe"
                        ? "The war-scribes note the hardening of borders."
                        : "Analysts later called it a turning point in power.";
            case "faith":
                return stage === "oral"
                    ? "The faithful say the signs were clear."
                    : stage === "scribe"
                        ? "Clerics recorded omens in the margins of their texts."
                        : "Doctrine shifted alongside the politics of the day.";
            case "discovery":
                return stage === "oral"
                    ? "Sailors returned with tales of strange horizons."
                    : stage === "scribe"
                        ? "Maps gained new edges and names."
                        : "Cartographers revised the known world accordingly.";
            case "culture":
                return stage === "oral"
                    ? "Songs carried the story to distant fires."
                    : stage === "scribe"
                        ? "Patrons commissioned works to remember it."
                        : "Later critics traced a flourishing of the arts to this time.";
            case "revolution":
                return stage === "oral"
                    ? "The old oaths were broken in the streets."
                    : stage === "scribe"
                        ? "The archives describe a sudden change of rule."
                        : "Political scholars cite this as a decisive rupture.";
            case "diplomacy":
                return stage === "oral"
                    ? "Messengers walked dusty roads bearing promises."
                    : stage === "scribe"
                        ? "Seals were pressed into wax and kept in record."
                        : "The treaty shaped the balance of the region.";
            case "expansion":
                return stage === "oral"
                    ? "Families set out toward empty lands."
                    : stage === "scribe"
                        ? "Settlers crossed rivers and staked new ground."
                        : "Demographers marked a clear frontier shift.";
            case "myth":
                return stage === "oral"
                    ? "Old tales grow taller with each retelling."
                    : stage === "scribe"
                        ? "The story passes into copied lore."
                        : "Scholars debate how truth became legend.";
            default:
                return null;
        }
    }

    function stripHtmlTags(text) {
        if (!text || typeof text !== "string") return text;
        if (text.indexOf("<") === -1) return text;
        return text
            .replace(/<[^>]*>/g, "")
            .replace(/&nbsp;/g, " ")
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, "\"")
            .replace(/&#39;/g, "'")
            .trim();
    }

    function normalizeLoreEntities(text) {
        if (!text || typeof text !== "string" || text.indexOf("entityName") === -1) return text;
        let result = text;
        result = result.replace(/<span[^>]*class=['"]entityName[^'"]*['"][^>]*data-reg=['"]([^'"]+)['"][^>]*data-id=['"]([^'"]+)['"][^>]*>[^<]*<\/span>/gi, (match, reg, id) => {
            if (!reg || !id) return match;
            return `{{regname:${reg}|${id}}}`;
        });
        return stripHtmlTags(result);
    }

    function formatLoreTitle(entry) {
        const rawTitle = entry && entry.title ? normalizeLoreEntities(entry.title) : "a tale";
        if (rawTitle.includes("{{")) return rawTitle;
        return `{{b:${rawTitle}}}`;
    }

    const LORE_NUDGE_THEMES = ["war", "discovery", "faith", "revolution", "hardship", "myth", "diplomacy", "expansion", "culture"];
    const LORE_ENDORSE_COOLDOWN = 12;

    function initLoreNudges() {
        if (!planet._paultendoLoreNudges) {
            planet._paultendoLoreNudges = { lastDay: 0, lastEndorseDay: -999 };
        }
    }

    function canEndorseLore() {
        initLoreNudges();
        const last = planet._paultendoLoreNudges.lastEndorseDay || -999;
        return (planet.day - last) >= LORE_ENDORSE_COOLDOWN;
    }

    function isLoreNudgeCandidate(entry) {
        if (!entry || !entry.day) return false;
        if (!LORE_NUDGE_THEMES.includes(entry.theme)) return false;
        return true;
    }

    function noteLoreEntry(entry) {
        if (!entry) return;
        initLoreNudges();
        if (isLoreNudgeCandidate(entry)) {
            planet._paultendoLoreNudges.lastEntryId = entry.id;
        }
    }

    function resolveLoreTown(entry) {
        if (!entry) return null;
        if (entry.townId) {
            const town = regGet("town", entry.townId);
            if (town && !town.end) return town;
        }

        if (entry.historyId && planet.history) {
            const hist = planet.history.find(h => h.id === entry.historyId);
            if (hist) {
                const candidates = [hist.town, hist.victor, hist.loser]
                    .filter(id => id !== undefined && id !== null)
                    .map(id => regGet("town", id))
                    .filter(t => t && !t.end);
                if (candidates.length) return choose(candidates);
            }
        }

        if (entry.sourceId && planet.history) {
            const hist = planet.history.find(h =>
                h.id === entry.sourceId && (h.type === entry.sourceType || h.historyType === entry.sourceType)
            );
            if (hist) {
                const candidates = [hist.town, hist.victor, hist.loser]
                    .filter(id => id !== undefined && id !== null)
                    .map(id => regGet("town", id))
                    .filter(t => t && !t.end);
                if (candidates.length) return choose(candidates);
            }
        }

        if (entry.sourceType && entry.sourceType.startsWith("discovery")) {
            const towns = regFilter("town", t => t && !t.end && t.pop > 0);
            return towns.length ? weightedChoice(towns, t => 1 + (t.influences?.travel || 0)) : null;
        }

        const fallback = regFilter("town", t => t && !t.end && t.pop > 0);
        return fallback.length ? choose(fallback) : null;
    }

    function getLoreNudgeEffect(entry) {
        if (!entry) return null;
        switch (entry.theme) {
            case "war":
                return { label: "prepare their defenses", influence: { military: 0.6, happy: 0.1 } };
            case "discovery":
                return { label: "sponsor exploration and travel", influence: { travel: 0.6, education: 0.3 } };
            case "faith":
            case "myth":
                return { label: "honor their traditions", influence: { faith: 0.6, happy: 0.2 } };
            case "revolution":
                return { label: "steady their institutions", influence: { law: 0.5, happy: 0.1 } };
            case "hardship":
                return { label: "secure stores and relief", influence: { farm: 0.5, happy: 0.1 } };
            case "diplomacy":
                return { label: "seek wiser counsel", influence: { trade: 0.4, happy: 0.1 } };
            case "expansion":
                return { label: "open new paths", influence: { travel: 0.4, trade: 0.2 } };
            case "culture":
                return { label: "celebrate memory", influence: { education: 0.2, happy: 0.3 } };
            default:
                return null;
        }
    }

    function endorseLoreEntry(entry) {
        if (!entry) return false;
        initLoreNudges();
        if (!canEndorseLore()) {
            logMessage("The Lore must settle before another endorsement.");
            return false;
        }

        const town = resolveLoreTown(entry);
        if (!town || town.end) {
            planet._paultendoLoreNudges.lastEndorseDay = planet.day;
            logMessage("The tale finds no immediate echo.");
            return false;
        }

        if (!canReceiveGuidance(town, "loreEndorse", 25)) {
            planet._paultendoLoreNudges.lastEndorseDay = planet.day;
            logMessage(`The people of {{regname:town|${town.id}}} are unreceptive to omens right now.`);
            return false;
        }

        const effect = getLoreNudgeEffect(entry);
        if (!effect) {
            planet._paultendoLoreNudges.lastEndorseDay = planet.day;
            logMessage("The tale does not lend itself to action.");
            return false;
        }

        const faith = town.influences?.faith || 0;
        const successChance = clampValue(0.4 + Math.max(0, faith) * 0.04, 0.25, 0.8);
        const success = Math.random() < successChance;

        if (success) {
            happen("Influence", null, town, { ...effect.influence, temp: true });
            logMessage(`You bless the memory of ${formatLoreTitle(entry)} in {{regname:town|${town.id}}}.`);
        } else {
            logMessage(`{{regname:town|${town.id}}} hears ${formatLoreTitle(entry)}, but hesitates to act.`);
        }

        noteGuidance(town, "loreEndorse", success);
        planet._paultendoLoreNudges.lastEndorseDay = planet.day;
        return success;
    }

    // ----------------------------------------
    // LEGENDS & MYTHOLOGY
    // ----------------------------------------

    const MYTH_CONFIG = {
        originMinDays: 50,
        figureMinDays: 80,
        historyMinDays: 100,
        dailyChance: 0.015,
        maxGlobal: 120,
        maxPerTown: 5
    };

    function initMyths() {
        if (!planet._paultendoMyths) {
            planet._paultendoMyths = [];
        }
        if (!planet._paultendoMythId) {
            planet._paultendoMythId = 1;
        }
    }

    function getTownMyths(town) {
        initMyths();
        const townId = typeof town === "object" ? town.id : town;
        if (!townId) return [];
        return planet._paultendoMyths.filter(m => m.townId === townId);
    }

    function canAddTownMyth(town) {
        if (!town) return false;
        return getTownMyths(town).length < MYTH_CONFIG.maxPerTown;
    }

    function recordMyth(data) {
        if (!data || !data.title || !data.body) return null;
        initMyths();

        if (data.sourceType && data.sourceId !== undefined) {
            const existing = planet._paultendoMyths.find(m =>
                m.sourceType === data.sourceType && m.sourceId === data.sourceId
            );
            if (existing) return existing;
        }

        const myth = {
            id: planet._paultendoMythId++,
            type: data.type || "legend",
            title: data.title,
            body: data.body,
            theme: data.theme || "myth",
            townId: data.townId || null,
            religionId: data.religionId || null,
            figureId: data.figureId || null,
            historyId: data.historyId || null,
            day: data.day !== undefined ? data.day : planet.day,
            sourceType: data.sourceType,
            sourceId: data.sourceId
        };

        planet._paultendoMyths.push(myth);
        if (planet._paultendoMyths.length > MYTH_CONFIG.maxGlobal) {
            planet._paultendoMyths.splice(0, planet._paultendoMyths.length - MYTH_CONFIG.maxGlobal);
        }

        try {
            recordAnnalsEntry({
                theme: myth.theme || "myth",
                title: myth.title,
                body: myth.body,
                townId: myth.townId,
                religionId: myth.religionId,
                figureId: myth.figureId,
                historyId: myth.historyId,
                sourceType: "myth",
                sourceId: myth.id,
                day: myth.day
            });
        } catch {}

        return myth;
    }

    function getReligionMyths(religion) {
        if (!religion || !religion._paultendoMyths || !religion._paultendoMyths.length) return [];
        initMyths();
        return religion._paultendoMyths
            .map(id => planet._paultendoMyths.find(m => m.id === id))
            .filter(m => m);
    }

    function getMythTown(myth) {
        if (!myth || !myth.townId) return null;
        return regGet("town", myth.townId);
    }

    function createOriginMyth(town, force = false) {
        if (!town || town.end) return null;
        if (!force && planet.day - (town.start || planet.day) < MYTH_CONFIG.originMinDays) return null;
        if (town._paultendoOriginMythId) return null;
        if (!canAddTownMyth(town)) return null;

        const stage = getAnnalsStage();
        const townName = townRef(town.id);
        const climate = getTownClimate(town);
        const climateDesc = getClimateDescription(climate.temp, climate.moisture).full;

        const title = choose([
            `The Founding of ${town.name}`,
            `The First Fire of ${town.name}`,
            `${town.name}'s Origin`
        ]);

        let body = stage === "oral"
            ? `${townName} tells how its founders followed signs to a ${climateDesc} land and raised the first hearth.`
            : stage === "scribe"
                ? `Early chronicles of ${townName} describe a journey to a ${climateDesc} land and the lighting of the first fire.`
                : `Later historians trace ${townName}'s beginnings to a migration into a ${climateDesc} land.`;

        const myth = recordMyth({
            type: "origin",
            theme: "myth",
            title,
            body,
            townId: town.id,
            sourceType: "origin_story",
            sourceId: town.id,
            day: town.start || planet.day
        });

        if (myth) {
            town._paultendoOriginMythId = myth.id;
            happen("Influence", null, town, { faith: 0.3, happy: 0.2, temp: true });
        }

        return myth;
    }

    function createFigureLegend(figure) {
        if (!figure || !figure.died) return null;
        if (figure._paultendoLegendId) return null;
        if (planet.day - figure.died < MYTH_CONFIG.figureMinDays) return null;

        const townId = figure.hometown;
        const town = townId ? regGet("town", townId) : null;
        if (town && !canAddTownMyth(town)) return null;

        const stage = getAnnalsStage();
        const townName = town ? townRef(town.id) : "the people";
        const deed = figure.deeds && figure.deeds.length ? choose(figure.deeds) : null;

        const title = `The Legend of ${figure.name}`;
        let body = stage === "oral"
            ? `${townName} keep songs of {{b:${figure.fullTitle}}}, who ${deed || "walked with purpose and courage"}.`
            : stage === "scribe"
                ? `Scribes note {{b:${figure.fullTitle}}} of ${townName}, remembered for ${deed || "remarkable deeds"}.`
                : `Later scholars frame {{b:${figure.fullTitle}}} of ${townName} as a figure whose ${deed || "deeds shaped local memory"}.`;

        const myth = recordMyth({
            type: "figure",
            theme: "myth",
            title,
            body,
            townId: town ? town.id : null,
            figureId: figure.id,
            sourceType: "figure_legend",
            sourceId: figure.id
        });

        if (myth) {
            figure._paultendoLegendId = myth.id;
            if (town) {
                initTownCulture(town);
                town.culture.prestige += 1;
                happen("Influence", null, town, { faith: 0.4, happy: 0.2, temp: true });
            }
        }

        return myth;
    }

    function isMythworthyHistory(entry) {
        if (!entry) return false;
        if (entry._paultendoMythId) return false;
        if (planet.day - entry.day < MYTH_CONFIG.historyMinDays) return false;
        const historyType = entry.historyType || entry.type;

        switch (historyType) {
            case HISTORY_TYPES.WAR:
                return (entry.deaths || 0) >= 15 || (entry.duration || 0) >= 20;
            case HISTORY_TYPES.DISASTER:
                return (entry.deaths || 0) >= 10 || entry.subtype === "epidemic";
            case HISTORY_TYPES.REVOLUTION:
                return true;
            case HISTORY_TYPES.RELIGION_FOUNDED:
                return true;
            case HISTORY_TYPES.ALLIANCE_FORMED:
                return (entry.founders || []).length >= 2;
            case HISTORY_TYPES.CULTURAL_ACHIEVEMENT:
                return true;
            case HISTORY_TYPES.TOWN_FOUNDED:
                return false;
            default:
                return false;
        }
    }

    function historyMythWeight(entry) {
        const historyType = entry.historyType || entry.type;
        if (historyType === HISTORY_TYPES.WAR) return 1.4 + Math.min(2, (entry.deaths || 0) / 20);
        if (historyType === HISTORY_TYPES.DISASTER) return 1.2 + Math.min(2, (entry.deaths || 0) / 15);
        if (historyType === HISTORY_TYPES.REVOLUTION) return 1.4;
        if (historyType === HISTORY_TYPES.RELIGION_FOUNDED) return 1.2;
        if (historyType === HISTORY_TYPES.ALLIANCE_FORMED) return 0.9;
        if (historyType === HISTORY_TYPES.CULTURAL_ACHIEVEMENT) return 0.8;
        return 0.6;
    }

    function createHistoryMyth(entry) {
        if (!entry) return null;
        const historyType = entry.historyType || entry.type;
        const stage = getAnnalsStage();

        let title = "A Legend Emerges";
        let body = "A story passes into legend.";
        let townId = entry.town || entry.victor || entry.loser || null;
        let theme = "myth";

        if (historyType === HISTORY_TYPES.WAR) {
            const victor = entry.victor ? townRef(entry.victor) : "a kingdom";
            const loser = entry.loser ? townRef(entry.loser) : "their foes";
            title = `The Tale of ${entry.name || "a Great War"}`;
            body = stage === "oral"
                ? `Around the fires, ${victor} and ${loser} are said to have clashed in ${entry.name || "a war of old"}.`
                : stage === "scribe"
                    ? `Records preserve ${entry.name || "a war"} between ${victor} and ${loser}.`
                    : `Historians debate how ${entry.name || "the war"} reshaped the balance between ${victor} and ${loser}.`;
        } else if (historyType === HISTORY_TYPES.DISASTER) {
            const townName = entry.town ? townRef(entry.town) : "a town";
            const subtype = entry.subtype || "disaster";
            title = `The ${subtype} of ${townName}`;
            body = stage === "oral"
                ? `${townName} speaks in hushed tones of the ${subtype} and the scars it left.`
                : stage === "scribe"
                    ? `Chroniclers describe the ${subtype} that struck ${townName}.`
                    : `Later accounts place the ${subtype} among the defining trials of ${townName}.`;
            theme = "hardship";
        } else if (historyType === HISTORY_TYPES.REVOLUTION) {
            const townName = entry.town ? townRef(entry.town) : "a town";
            title = `The Turning of ${townName}`;
            body = stage === "oral"
                ? `${townName} tells of the day the old order fell and new banners rose.`
                : stage === "scribe"
                    ? `The revolution in ${townName} is recorded as a watershed.`
                    : `Later scholars cite the revolution in ${townName} as a decisive break.`;
            theme = "revolution";
        } else if (historyType === HISTORY_TYPES.RELIGION_FOUNDED) {
            const townName = entry.town ? townRef(entry.town) : "a town";
            const name = entry.religionName || "a faith";
            title = `The Dawn of ${name}`;
            body = stage === "oral"
                ? `${townName} tells how ${name} first took root among their people.`
                : stage === "scribe"
                    ? `Accounts from ${townName} describe the founding of ${name}.`
                    : `Later commentators frame ${name}'s founding in ${townName} as a lasting spiritual shift.`;
            theme = "faith";
        } else if (historyType === HISTORY_TYPES.ALLIANCE_FORMED) {
            const founders = (entry.founders || []).map(id => townRef(id)).join(" and ");
            title = `The Pact of ${entry.allianceName || "the Allies"}`;
            body = stage === "oral"
                ? `The pact between ${founders || "old rivals"} is told as a turning point.`
                : stage === "scribe"
                    ? `The alliance between ${founders || "founders"} is remembered in treaty-lists.`
                    : `Scholars note how the alliance between ${founders || "founders"} reshaped the region.`;
            theme = "diplomacy";
        } else if (historyType === HISTORY_TYPES.CULTURAL_ACHIEVEMENT) {
            const townName = entry.town ? townRef(entry.town) : "a town";
            title = `The Masterwork of ${townName}`;
            body = stage === "oral"
                ? `${townName} remembers a work of art that lives on in memory.`
                : stage === "scribe"
                    ? `Scribes record a cultural achievement in ${townName}.`
                    : `Later critics trace a local legend to a masterwork in ${townName}.`;
            theme = "culture";
        }

        const myth = recordMyth({
            type: "event",
            theme,
            title,
            body,
            townId,
            historyId: entry.id,
            sourceType: "history_myth",
            sourceId: entry.id
        });

        if (myth) {
            entry._paultendoMythId = myth.id;
            if (townId) {
                const town = regGet("town", townId);
                if (town) {
                    initTownCulture(town);
                    town.culture.prestige += 0.6;
                    happen("Influence", null, town, { faith: 0.3, happy: 0.2, temp: true });
                }
            }
        }

        return myth;
    }

    function incorporateMythIntoReligion(religion, town) {
        if (!religion || !town) return null;
        initMyths();
        const myths = getTownMyths(town);
        let myth = myths.length ? choose(myths) : null;
        if (!myth && Math.random() < 0.4) {
            myth = createOriginMyth(town, true);
        }
        if (!myth) return null;

        if (!religion._paultendoMyths) religion._paultendoMyths = [];
        if (!religion._paultendoMyths.includes(myth.id)) {
            religion._paultendoMyths.push(myth.id);
        }

        try {
            const stage = getAnnalsStage();
            const townName = townRef(town.id);
            const title = `${religion.name} Embraces a Local Legend`;
            let body = stage === "oral"
                ? `In ${townName}, ${religion.name} folds the tale of ${myth.title} into its rites.`
                : stage === "scribe"
                    ? `Clerics in ${townName} note that ${religion.name} adopts the legend of ${myth.title}.`
                    : `Later histories show ${religion.name} weaving the legend of ${myth.title} into doctrine.`;
            recordAnnalsEntry({
                theme: "faith",
                title,
                body,
                sourceType: "religion_myth",
                sourceId: `${religion.id}-${myth.id}`
            });
        } catch {}

        return myth;
    }

    function pickMythCandidate() {
        if (!planet) return null;
        initHistory();
        initMyths();

        const candidates = [];

        if (typeof regToArray === "function") {
            const towns = regToArray("town");
            towns.forEach(town => {
                if (!town || town.end) return;
                if (town._paultendoOriginMythId) return;
                if (planet.day - (town.start || planet.day) < MYTH_CONFIG.originMinDays) return;
                if (!canAddTownMyth(town)) return;
                candidates.push({ type: "origin", town, weight: 1.6 });
            });
        }

        if (planet.figures && planet.figures.length) {
            planet.figures.forEach(figure => {
                if (!figure || !figure.died) return;
                if (figure._paultendoLegendId) return;
                if (planet.day - figure.died < MYTH_CONFIG.figureMinDays) return;
                const weight = ["HERO", "GENERAL", "PROPHET", "FOUNDER", "MARTYR"].includes(figure.type) ? 1.6 : 1.1;
                candidates.push({ type: "figure", figure, weight });
            });
        }

        if (planet.history && planet.history.length) {
            planet.history.forEach(entry => {
                if (!isMythworthyHistory(entry)) return;
                candidates.push({ type: "history", entry, weight: historyMythWeight(entry) });
            });
        }

        if (candidates.length === 0) return null;
        return weightedChoice(candidates, c => c.weight);
    }

    function buildAnnalsFromHistory(entry) {
        if (!entry || (!entry.type && !entry.historyType)) return null;
        const historyType = entry.historyType || entry.type;
        const stage = getAnnalsStage();

        switch (historyType) {
            case HISTORY_TYPES.ERA_BEGAN: {
                const title = `${entry.eraName} Begins`;
                const body = stage === "oral"
                    ? `A new age begins, and {{people}} speak its name with wonder.`
                    : stage === "scribe"
                        ? `Records mark the beginning of {{b:${entry.eraName}}}.`
                        : `Historians date the start of {{b:${entry.eraName}}} to this day.`;
                return recordAnnalsEntry({
                    theme: "era",
                    title,
                    body,
                    eraType: entry.eraType,
                    eraName: entry.eraName,
                    sourceType: historyType,
                    sourceId: entry.id,
                    day: entry.day
                });
            }
            case HISTORY_TYPES.WAR: {
                const victor = entry.victor ? townRef(entry.victor) : "one town";
                const loser = entry.loser ? townRef(entry.loser) : "another";
                const duration = entry.duration ? `${entry.duration} days` : "many days";
                const deaths = entry.deaths ? `${entry.deaths}` : null;

                let body = stage === "oral"
                    ? `${victor} and ${loser} clashed in bitter days. Smoke and sorrow lingered.`
                    : stage === "scribe"
                        ? `Scribes record a war between ${victor} and ${loser}, lasting ${duration}.`
                        : `The conflict between ${victor} and ${loser} concluded after ${duration}${deaths ? `, with ${deaths} deaths recorded` : ""}.`;

                const line = themeLine("war", stage);
                if (line) body += ` ${line}`;

                return recordAnnalsEntry({
                    theme: "war",
                    title: entry.name || "A War is Recorded",
                    body,
                    sourceType: historyType,
                    sourceId: entry.id,
                    day: entry.day
                });
            }
            case HISTORY_TYPES.ALLIANCE_FORMED: {
                const founders = entry.founders || [];
                const founderText = founders.length >= 2
                    ? `${townRef(founders[0])} and ${townRef(founders[1])}`
                    : "two towns";
                let body = stage === "oral"
                    ? `${founderText} swore bonds of mutual aid. The pact was spoken aloud.`
                    : stage === "scribe"
                        ? `A formal alliance, {{b:${entry.allianceName}}}, is recorded between ${founderText}.`
                        : `The alliance {{b:${entry.allianceName}}} bound ${founderText} to shared defense and trade.`;
                const line = themeLine("diplomacy", stage);
                if (line) body += ` ${line}`;
                return recordAnnalsEntry({
                    theme: "diplomacy",
                    title: `{{b:${entry.allianceName}}} Formed`,
                    body,
                    sourceType: historyType,
                    sourceId: entry.id,
                    day: entry.day
                });
            }
            case HISTORY_TYPES.ALLIANCE_DISSOLVED: {
                const title = `{{b:${entry.allianceName || "An Alliance"}}} Dissolves`;
                let body = stage === "oral"
                    ? "The old pact frayed and fell apart."
                    : stage === "scribe"
                        ? "Records mark the dissolution of an alliance."
                        : "Diplomatic ties unravelled, leaving the region less stable.";
                const line = themeLine("diplomacy", stage);
                if (line) body += ` ${line}`;
                return recordAnnalsEntry({
                    theme: "diplomacy",
                    title,
                    body,
                    sourceType: historyType,
                    sourceId: entry.id,
                    day: entry.day
                });
            }
            case HISTORY_TYPES.RELIGION_FOUNDED: {
                const town = entry.town ? townRef(entry.town) : "a town";
                let body = stage === "oral"
                    ? `A new faith, {{b:${entry.religionName}}}, rose among ${town}.`
                    : stage === "scribe"
                        ? `Clerics record the founding of {{b:${entry.religionName}}} in ${town}.`
                        : `The faith of {{b:${entry.religionName}}} was established in ${town}, reshaping belief.`;
                const line = themeLine("faith", stage);
                if (line) body += ` ${line}`;
                return recordAnnalsEntry({
                    theme: "faith",
                    title: `{{b:${entry.religionName}}} Established`,
                    body,
                    sourceType: historyType,
                    sourceId: entry.id,
                    day: entry.day
                });
            }
            case HISTORY_TYPES.RELIGION_SCHISM: {
                const town = entry.town ? townRef(entry.town) : "a town";
                let body = stage === "oral"
                    ? `In ${town}, {{b:${entry.religionName}}} split from {{b:${entry.parentName}}}.`
                    : stage === "scribe"
                        ? `A schism divides {{b:${entry.parentName}}}; {{b:${entry.religionName}}} emerges in ${town}.`
                        : `The schism between {{b:${entry.parentName}}} and {{b:${entry.religionName}}} began in ${town}.`;
                const line = themeLine("faith", stage);
                if (line) body += ` ${line}`;
                return recordAnnalsEntry({
                    theme: "faith",
                    title: `Schism of {{b:${entry.parentName}}}`,
                    body,
                    sourceType: historyType,
                    sourceId: entry.id,
                    day: entry.day
                });
            }
            case HISTORY_TYPES.REVOLUTION: {
                const town = entry.town ? townRef(entry.town) : "a town";
                let body = stage === "oral"
                    ? `${town} cast off its old rulers. A new order rose.`
                    : stage === "scribe"
                        ? `The {{b:${entry.name}}} reshaped governance in ${town}.`
                        : `${town} underwent revolution, adopting ${entry.newGovernment ? `a ${entry.newGovernment} government` : "a new order"}.`;
                const line = themeLine("revolution", stage);
                if (line) body += ` ${line}`;
                return recordAnnalsEntry({
                    theme: "revolution",
                    title: entry.name || "A Revolution",
                    body,
                    sourceType: historyType,
                    sourceId: entry.id,
                    day: entry.day
                });
            }
            case HISTORY_TYPES.TOWN_FOUNDED: {
                const town = entry.town ? townRef(entry.town) : "a new town";
                const parent = entry.parentTown ? townRef(entry.parentTown) : null;
                let body = stage === "oral"
                    ? `${town} was founded${parent ? ` by settlers from ${parent}` : ""}.`
                    : stage === "scribe"
                        ? `Records mark the founding of ${town}${parent ? `, settled from ${parent}` : ""}.`
                        : `A new settlement, ${town}, was established${parent ? ` by migrants from ${parent}` : ""}.`;
                const line = themeLine("expansion", stage);
                if (line) body += ` ${line}`;
                return recordAnnalsEntry({
                    theme: "expansion",
                    title: `Founding of ${town}`,
                    body,
                    sourceType: historyType,
                    sourceId: entry.id,
                    day: entry.day
                });
            }
            case HISTORY_TYPES.DISASTER: {
                if ((entry.deaths || 0) < 20) return null;
                const title = entry.name || "A Great Disaster";
                let body = stage === "oral"
                    ? `A ${entry.subtype} swept the land, and many were lost.`
                    : stage === "scribe"
                        ? `The ${entry.subtype} is recorded as a grievous disaster.`
                        : `The ${entry.subtype} claimed ${entry.deaths || "many"} lives and left long scars.`;
                return recordAnnalsEntry({
                    theme: "hardship",
                    title,
                    body,
                    sourceType: historyType,
                    sourceId: entry.id,
                    day: entry.day
                });
            }
            case HISTORY_TYPES.CULTURAL_ACHIEVEMENT: {
                const town = entry.town ? townRef(entry.town) : "a town";
                const achievementType = entry.achievementType || entry.type;
                const title = achievementType === "scholarship"
                    ? `Scholarship in ${town}`
                    : `A Masterwork in ${town}`;
                let body = stage === "oral"
                    ? `Stories from ${town} speak of a great ${achievementType === "scholarship" ? "discovery" : "work"}.`
                    : stage === "scribe"
                        ? `${town} is noted for a cultural achievement of lasting memory.`
                        : `Cultural records from ${town} highlight a period of notable ${achievementType === "scholarship" ? "learning" : "artistry"}.`;
                const line = themeLine("culture", stage);
                if (line) body += ` ${line}`;
                return recordAnnalsEntry({
                    theme: "culture",
                    title,
                    body,
                    sourceType: historyType,
                    sourceId: entry.id,
                    day: entry.day
                });
            }
            default:
                return null;
        }
    }

    if (typeof recordHistory === "function" && !recordHistory._paultendoAnnals) {
        const baseRecordHistory = recordHistory;
        recordHistory = function(type, data) {
            const entry = baseRecordHistory(type, data);
            if (entry && !entry.historyType) entry.historyType = type;
            if (entry && type === HISTORY_TYPES.CULTURAL_ACHIEVEMENT && data && data.type) {
                entry.achievementType = data.type;
            }
            try { buildAnnalsFromHistory(entry); } catch {}
            return entry;
        };
        recordHistory._paultendoAnnals = true;
    }

    // ----------------------------------------
    // Lore UI (Executive panel)
    // ----------------------------------------

    function getAnnalsViewState() {
        if (typeof userSettings === "undefined") return { era: "all", theme: "all" };
        if (!userSettings.paultendoAnnalsEra) userSettings.paultendoAnnalsEra = "all";
        if (!userSettings.paultendoAnnalsTheme) userSettings.paultendoAnnalsTheme = "all";
        return { era: userSettings.paultendoAnnalsEra, theme: userSettings.paultendoAnnalsTheme };
    }

    function setAnnalsViewState(state) {
        if (typeof userSettings === "undefined") return;
        if (state.era) userSettings.paultendoAnnalsEra = state.era;
        if (state.theme) userSettings.paultendoAnnalsTheme = state.theme;
        if (typeof saveSettings === "function") saveSettings();
    }

    function getLoreFocusSetting() {
        if (typeof userSettings === "undefined") return "balanced";
        if (!userSettings.paultendoLoreFocus) userSettings.paultendoLoreFocus = "balanced";
        return userSettings.paultendoLoreFocus;
    }

    function setLoreFocusSetting(value) {
        if (typeof userSettings === "undefined") return;
        userSettings.paultendoLoreFocus = value || "balanced";
        if (typeof saveSettings === "function") saveSettings();
    }

    function getLoreFocusOptions() {
        const options = [{ id: "balanced", label: "Balanced" }];
        LORE_NUDGE_THEMES.forEach(theme => {
            const label = ANNALS_THEME_NAMES[theme] || titleCase(theme);
            options.push({ id: theme, label });
        });
        return options;
    }

    function chooseLoreFocus() {
        const options = getLoreFocusOptions();
        const current = getLoreFocusSetting();
        doPrompt({
            type: "choose",
            message: "Select Lore focus:",
            choices: options.map(o => o.label),
            choiceValues: options.map(o => o.id),
            selected: options.findIndex(o => o.id === current),
            func: (value) => {
                setLoreFocusSetting(value);
                openAnnalsPanel();
            }
        });
    }

    function getAnnalsEraOptions() {
        const options = [{ id: "all", label: "All Eras" }];
        if (planet.currentEra) {
            options.push({ id: "current", label: `Current: ${planet.currentEra.name}` });
        }
        const eraNames = new Set();
        if (planet.eras && planet.eras.length) {
            planet.eras.forEach(era => {
                if (era && era.name && !eraNames.has(era.name)) {
                    options.push({ id: `name:${era.name}`, label: era.name });
                    eraNames.add(era.name);
                }
            });
        }
        return options;
    }

    function getAnnalsThemeOptions() {
        const options = [{ id: "all", label: "All Themes" }];
        for (const [key, label] of Object.entries(ANNALS_THEME_NAMES)) {
            options.push({ id: key, label });
        }
        return options;
    }

    function formatAnnalsListItem(entry) {
        const themeLabel = ANNALS_THEME_NAMES[entry.theme] || "Theme";
        const datePart = `{{color:[{{date:${entry.day}|s}}]|rgba(255,255,0,0.75)}}`;
        return `${datePart} ${entry.title} {{color:[${themeLabel}]|rgba(160,160,160,0.7)}}`;
    }

    function formatAnnalsBody(entry) {
        return entry.body.replace(/\n/g, "<br>");
    }

    function getFilteredAnnalsEntries() {
        initAnnals();
        const state = getAnnalsViewState();
        const eraFilter = state.era;
        const themeFilter = state.theme;
        const currentEraName = planet.currentEra?.name;

        return planet.annals.filter(entry => {
            if (themeFilter !== "all" && entry.theme !== themeFilter) return false;
            if (eraFilter === "all") return true;
            if (eraFilter === "current") return entry.eraName === currentEraName;
            if (eraFilter.startsWith("name:")) {
                const name = eraFilter.slice(5);
                return entry.eraName === name;
            }
            return true;
        }).sort((a, b) => b.day - a.day);
    }

    function openAnnalsEntry(entry) {
        if (!entry) return;
        const items = [];
        items.push({ text: `{{color:[{{date:${entry.day}|s}}]|rgba(255,255,0,0.75)}} ${entry.title}` });
        items.push({ text: `{{i:Theme:}} ${ANNALS_THEME_NAMES[entry.theme] || "Theme"}` });
        items.push({ text: `{{i:Era:}} ${entry.eraName || "The Early Days"}` });
        items.push({ text: `{{i:Voice:}} ${entry.voiceName || "Chronicler"}` });
        items.push({ spacer: true, text: formatAnnalsBody(entry) });
        items.push({ spacer: true });
        const canEndorse = canEndorseLore();
        items.push({
            text: canEndorse ? "Endorse this tale" : "Endorse this tale (resting)",
            func: () => {
                endorseLoreEntry(entry);
                openAnnalsEntry(entry);
            }
        });
        items.push({
            text: "◁ Back to Lore",
            func: () => openAnnalsPanel()
        });
        populateExecutive(items, "Lore Entry");
    }

    function chooseAnnalsFilter(type, options) {
        const state = getAnnalsViewState();
        const current = type === "era" ? state.era : state.theme;
        doPrompt({
            type: "choose",
            message: `Select ${type} filter:`,
            choices: options.map(o => o.label),
            choiceValues: options.map(o => o.id),
            selected: options.findIndex(o => o.id === current),
            func: (value) => {
                if (type === "era") state.era = value;
                else state.theme = value;
                setAnnalsViewState(state);
                openAnnalsPanel();
            }
        });
    }

    function openAnnalsPanel() {
        initAnnals();
        if (!planet._paultendoAnnalsBackfill && planet.history && planet.history.length) {
            planet._paultendoAnnalsBackfill = true;
            const historySorted = [...planet.history].sort((a, b) => (a.day || 0) - (b.day || 0));
            historySorted.forEach(h => {
                try { buildAnnalsFromHistory(h); } catch {}
            });
            if (planet.eras && planet.eras.length) {
                planet.eras.forEach(era => {
                    if (!era || !era.ended) return;
                    recordAnnalsEntry({
                        theme: "era",
                        title: `${era.name} Ends`,
                        body: `The age called {{b:${era.name}}} passed into memory.`,
                        eraType: era.type,
                        eraName: era.name,
                        sourceType: "era_end",
                        sourceId: era.started,
                        day: era.ended
                    });
                });
            }
        }
        const entries = getFilteredAnnalsEntries();
        const state = getAnnalsViewState();

        const eraOptions = getAnnalsEraOptions();
        const themeOptions = getAnnalsThemeOptions();
        const eraLabel = (eraOptions.find(o => o.id === state.era) || eraOptions[0]).label;
        const themeLabel = (themeOptions.find(o => o.id === state.theme) || themeOptions[0]).label;
        const focusOptions = getLoreFocusOptions();
        const focusSetting = getLoreFocusSetting();
        const focusLabel = (focusOptions.find(o => o.id === focusSetting) || focusOptions[0]).label;

        const items = [];
        items.push({
            text: `Era: ${eraLabel}`,
            func: () => chooseAnnalsFilter("era", eraOptions)
        });
        items.push({
            text: `Theme: ${themeLabel}`,
            func: () => chooseAnnalsFilter("theme", themeOptions)
        });
        items.push({
            text: `Focus: ${focusLabel}`,
            func: () => chooseLoreFocus()
        });
        items.push({ spacer: true, text: `Entries (${entries.length})` });

        if (entries.length === 0) {
            items.push({ text: "{{none}}" });
        } else {
            entries.forEach((entry) => {
                items.push({
                    text: formatAnnalsListItem(entry),
                    func: () => openAnnalsEntry(entry)
                });
            });
        }

        populateExecutive(items, `Lore (${entries.length})`);
    }

    function addAnnalsButton() {
        const list = document.getElementById("actionMainList");
        if (!list || document.getElementById("actionItem-annals")) return;

        const button = document.createElement("span");
        button.className = "actionItem clickable";
        button.id = "actionItem-annals";
        button.innerHTML = "Lore";
        button.addEventListener("click", () => {
            openAnnalsPanel();
        });
        list.appendChild(button);
    }

    if (typeof initExecutive === "function" && !initExecutive._paultendoAnnals) {
        const baseInitExecutive = initExecutive;
        initExecutive = function(...args) {
            const result = baseInitExecutive.apply(this, args);
            try { addAnnalsButton(); } catch {}
            return result;
        };
        initExecutive._paultendoAnnals = true;
    }

    if (typeof window !== "undefined") {
        window.addEventListener("load", () => {
            try { addAnnalsButton(); } catch {}
            try { updateSeasonState(); } catch {}
            try { ensureGreatWorkForEra(planet.currentEra); } catch {}
        });
    }

    if (typeof document !== "undefined") {
        if (document.readyState === "complete" || document.readyState === "interactive") {
            try { updateSeasonState(); } catch {}
        }
    }

    // Create a notable figure
    function createFigure(type, data) {
        initHistory();

        const figureType = FIGURE_TYPES[type];
        const name = generateHumanName();
        const adjective = choose(figureType.adjectives);

        const figure = {
            id: planet.figures.length + 1,
            name: name,
            type: type,
            title: figureType.title,
            adjective: adjective,
            fullTitle: `${name} the ${adjective}`,
            born: planet.day,
            died: null,
            hometown: data.town,
            deeds: data.deeds || [],
            ...data
        };

        planet.figures.push(figure);

        // Record the birth in history
        recordHistory(HISTORY_TYPES.FIGURE_BORN, {
            figureId: figure.id,
            figureName: figure.name,
            figureType: type,
            town: data.town
        });

        return figure;
    }

    // Get living figures
    function getLivingFigures(type = null) {
        initHistory();
        return planet.figures.filter(f => {
            if (f.died) return false;
            if (type && f.type !== type) return false;
            return true;
        });
    }

    // Get figures from a specific town
    function getTownFigures(townId, livingOnly = false) {
        initHistory();
        return planet.figures.filter(f => {
            if (f.hometown !== townId) return false;
            if (livingOnly && f.died) return false;
            return true;
        });
    }

    // Kill a figure (natural death, battle, etc.)
    function killFigure(figure, cause, location = null) {
        if (figure.died) return;

        figure.died = planet.day;
        figure.deathCause = cause;

        recordHistory(HISTORY_TYPES.FIGURE_DIED, {
            figureId: figure.id,
            figureName: figure.name,
            figureType: figure.type,
            cause: cause,
            location: location
        });

        return figure;
    }

    // Query history by type
    function getHistoryByType(type, limit = null) {
        initHistory();
        let results = planet.history.filter(h => (h.historyType || h.type) === type);
        if (limit) results = results.slice(-limit);
        return results;
    }

    // Query history involving a town
    function getTownHistory(townId, limit = null) {
        initHistory();
        let results = planet.history.filter(h =>
            h.town === townId ||
            h.towns?.includes(townId) ||
            h.victor === townId ||
            h.loser === townId
        );
        if (limit) results = results.slice(-limit);
        return results;
    }

    // Get recent significant events
    function getRecentHistory(days = 100, types = null) {
        initHistory();
        return planet.history.filter(h => {
            if (planet.day - h.day > days) return false;
            const historyType = h.historyType || h.type;
            if (types && !types.includes(historyType)) return false;
            return true;
        });
    }

    // ----------------------------------------
    // HISTORICAL GRUDGES & BONDS
    // ----------------------------------------

    // Initialize town memory
    function initTownMemory(town) {
        if (!town.memory) {
            town.memory = {
                grudges: {},   // townId -> { reason, severity, day }
                bonds: {},     // townId -> { reason, strength, day }
                betrayals: [], // Array of betrayal events
                honors: []     // Array of honorable deeds received
            };
        }
    }

    // Record a grudge against another town
    function recordGrudge(town, targetId, reason, severity) {
        initTownMemory(town);

        const existing = town.memory.grudges[targetId];
        if (existing) {
            // Grudges compound
            existing.severity = Math.min(10, existing.severity + severity);
            existing.reasons = existing.reasons || [existing.reason];
            if (!existing.reasons.includes(reason)) {
                existing.reasons.push(reason);
            }
            existing.lastDay = planet.day;
        } else {
            town.memory.grudges[targetId] = {
                reason: reason,
                severity: severity,
                day: planet.day,
                lastDay: planet.day
            };
        }
    }

    // Record a bond with another town
    function recordBond(town, targetId, reason, strength) {
        initTownMemory(town);

        const existing = town.memory.bonds[targetId];
        if (existing) {
            existing.strength = Math.min(10, existing.strength + strength);
            existing.reasons = existing.reasons || [existing.reason];
            if (!existing.reasons.includes(reason)) {
                existing.reasons.push(reason);
            }
            existing.lastDay = planet.day;
        } else {
            town.memory.bonds[targetId] = {
                reason: reason,
                strength: strength,
                day: planet.day,
                lastDay: planet.day
            };
        }
    }

    // Check if town holds a grudge
    function hasGrudge(town, targetId) {
        initTownMemory(town);
        return town.memory.grudges[targetId] && town.memory.grudges[targetId].severity > 0;
    }

    // Check if town has a bond
    function hasBond(town, targetId) {
        initTownMemory(town);
        return town.memory.bonds[targetId] && town.memory.bonds[targetId].strength > 0;
    }

    // Grudges and bonds decay over time
    modEvent("memoryDecay", {
        daily: true,
        subject: { reg: "town", all: true },
        value: (subject) => {
            initTownMemory(subject);
            return Object.keys(subject.memory.grudges).length > 0 ||
                   Object.keys(subject.memory.bonds).length > 0;
        },
        func: (subject) => {
            // Grudges decay slowly
            for (const [targetId, grudge] of Object.entries(subject.memory.grudges)) {
                const daysSince = planet.day - grudge.lastDay;
                if (daysSince > 100) {
                    grudge.severity = Math.max(0, grudge.severity - 0.01);
                    if (grudge.severity <= 0) {
                        delete subject.memory.grudges[targetId];
                    }
                }
            }

            // Bonds decay even slower
            for (const [targetId, bond] of Object.entries(subject.memory.bonds)) {
                const daysSince = planet.day - bond.lastDay;
                if (daysSince > 200) {
                    bond.strength = Math.max(0, bond.strength - 0.005);
                    if (bond.strength <= 0) {
                        delete subject.memory.bonds[targetId];
                    }
                }
            }
        }
    });

    // Grudges influence relations
    modEvent("grudgeInfluence", {
        daily: true,
        subject: { reg: "town", all: true },
        value: (subject) => {
            initTownMemory(subject);
            return Object.keys(subject.memory.grudges).length > 0;
        },
        func: (subject) => {
            for (const [targetId, grudge] of Object.entries(subject.memory.grudges)) {
                if (grudge.severity >= 3) {
                    const target = regGet("town", parseInt(targetId));
                    if (target && !target.end) {
                        // Grudges make it harder to improve relations
                        const currentRelations = getRelations(subject, target);
                        if (currentRelations > -grudge.severity * 2) {
                            worsenRelations(subject, target, 0.1);
                        }
                    }
                }
            }
        }
    });

    // Bonds influence relations
    modEvent("bondInfluence", {
        daily: true,
        subject: { reg: "town", all: true },
        value: (subject) => {
            initTownMemory(subject);
            return Object.keys(subject.memory.bonds).length > 0;
        },
        func: (subject) => {
            for (const [targetId, bond] of Object.entries(subject.memory.bonds)) {
                if (bond.strength >= 3) {
                    const target = regGet("town", parseInt(targetId));
                    if (target && !target.end) {
                        // Bonds make it easier to maintain good relations
                        const currentRelations = getRelations(subject, target);
                        if (currentRelations < bond.strength * 2) {
                            improveRelations(subject, target, 0.05);
                        }
                    }
                }
            }
        }
    });

    // ----------------------------------------
    // ESPIONAGE & SECRETS SYSTEM
    // ----------------------------------------

    const SECRET_TYPE_DEFS = {
        military: {
            id: "military",
            name: "military plans",
            theme: "war",
            weight: (town) => 1 + (town.influences?.military || 0) * 0.3 + (hasTradition(town, "martial") ? 1 : 0)
        },
        trade: {
            id: "trade",
            name: "trade arrangements",
            theme: "diplomacy",
            weight: (town) => 1 + (town.influences?.trade || 0) * 0.3 + (getTownGovernment(town).id === "oligarchy" ? 1 : 0)
        },
        faith: {
            id: "faith",
            name: "religious dispute",
            theme: "faith",
            weight: (town) => 1 + (town.influences?.faith || 0) * 0.3 + (getTownGovernment(town).id === "theocracy" ? 1 : 0)
        },
        succession: {
            id: "succession",
            name: "succession intrigue",
            theme: "revolution",
            weight: (town) => 1 + (["monarchy", "dictatorship", "chiefdom"].includes(getTownGovernment(town).id) ? 2 : 0)
        },
        scandal: {
            id: "scandal",
            name: "public scandal",
            theme: "diplomacy",
            weight: (town) => 1 + (town.influences?.crime || 0) * 0.3
        },
        knowledge: {
            id: "knowledge",
            name: "technical knowledge",
            theme: "learning",
            weight: (town) => 1 + (town.influences?.education || 0) * 0.3 + (hasTownSpecialization(town, "academy") ? 1 : 0)
        }
    };

    const MAX_SECRETS_PER_TOWN = 3;

    function initSecrets() {
        if (!planet._paultendoSecrets) {
            planet._paultendoSecrets = [];
        }
        if (!planet._paultendoSecretId) {
            planet._paultendoSecretId = 1;
        }
    }

    function getTownSecrets(town, includeExposed = false) {
        initSecrets();
        return planet._paultendoSecrets.filter(s =>
            s.owner === town.id && (includeExposed || !s.exposed)
        );
    }

    function chooseSecretType(town) {
        const defs = Object.values(SECRET_TYPE_DEFS);
        const chosen = weightedChoice(defs, def => def.weight(town));
        return chosen || SECRET_TYPE_DEFS.scandal;
    }

    function createSecret(owner, typeDef) {
        initSecrets();
        const def = typeDef || chooseSecretType(owner);
        const secret = {
            id: planet._paultendoSecretId++,
            type: def.id,
            title: def.name,
            theme: def.theme,
            owner: owner.id,
            created: planet.day,
            knownBy: [owner.id],
            exposed: false
        };
        planet._paultendoSecrets.push(secret);
        return secret;
    }

    function addSecretKnowledge(secret, town) {
        if (!secret.knownBy) secret.knownBy = [];
        if (!secret.knownBy.includes(town.id)) {
            secret.knownBy.push(town.id);
        }
    }

    function getSpyCapability(town) {
        const education = town.influences?.education || 0;
        const crime = town.influences?.crime || 0;
        const trade = town.influences?.trade || 0;
        return Math.max(0, education * 0.4 + crime * 0.6 + trade * 0.2);
    }

    function getEspionageStageProfile() {
        const stage = getAnnalsStage();
        if (stage === "oral") return { scale: 0.5, minCapability: 0.2 };
        if (stage === "scribe") return { scale: 0.8, minCapability: 0.35 };
        return { scale: 1, minCapability: 0.5 };
    }

    function getEspionageMotive(subject, target) {
        let motive = 0;
        const relation = getRelations(subject, target);
        if (relation < 0) motive += Math.min(5, -relation) * 0.2 + 0.5;
        if (relation > 3) motive -= 0.5;

        if (hasGrudge(subject, target.id) || hasGrudge(target, subject.id)) motive += 1;
        if (hasEmbargoBetween(subject, target)) motive += 0.5;

        const pressure = getWarPressureValue(subject, target);
        if (pressure > 10) motive += 0.5;
        if (pressure > 25) motive += 0.5;

        const govTension = getGovernmentTension(getTownGovernment(subject).id, getTownGovernment(target).id);
        motive += govTension * 0.2;

        return Math.max(0, motive);
    }

    function computeSpySuccessChance(subject, target) {
        const capability = getSpyCapability(subject);
        const counter = (target.influences?.education || 0) * 0.3 + (target.influences?.law || 0) * 0.4;
        let chance = 0.25 + capability * 0.03 - counter * 0.03;
        if (areAllied(subject, target)) chance -= 0.1;
        const stageScale = getEspionageStageProfile().scale;
        chance *= stageScale;
        return clampValue(chance, 0.05, 0.75);
    }

    function bumpWarPressure(town1, town2, amount) {
        const record = getWarPressureRecord(town1, town2);
        record.value = clampValue((record.value || 0) + amount, 0, 100);
        record.lastDay = planet.day;
    }

    function applySecretLeverage(secret, subject, target, scale = 1) {
        const effect = clampValue(scale, 0.25, 1);
        switch (secret.type) {
            case "military":
                bumpWarPressure(subject, target, 3 * effect);
                happen("Influence", null, subject, { military: 0.5 * effect, temp: true });
                happen("Influence", null, target, { military: -0.2 * effect, temp: true });
                break;
            case "trade":
                happen("Influence", null, subject, { trade: 0.5 * effect, temp: true });
                happen("Influence", null, target, { trade: -0.3 * effect, temp: true });
                worsenRelations(target, subject, Math.max(1, Math.round(1 * effect)));
                break;
            case "faith":
                happen("Influence", null, target, { faith: -0.6 * effect, happy: -0.2 * effect, temp: true });
                initUnrest(target);
                target.unrest = Math.min(100, target.unrest + Math.round(2 * effect));
                break;
            case "succession":
                initUnrest(target);
                target.unrest = Math.min(100, target.unrest + Math.round(5 * effect));
                happen("Influence", null, target, { happy: -0.4 * effect, temp: true });
                bumpWarPressure(subject, target, 1.5 * effect);
                break;
            case "scandal":
                happen("Influence", null, target, { happy: -0.5 * effect, faith: -0.3 * effect, crime: 0.3 * effect, temp: true });
                worsenRelations(target, subject, Math.max(1, Math.round(1 * effect)));
                break;
            case "knowledge": {
                const targetSpecs = getTownSpecializations(target);
                const stealable = targetSpecs.filter(s => !hasSpecialization(subject, s.id));
                if (stealable.length > 0 && Math.random() < 0.4 * effect) {
                    const spec = choose(stealable);
                    addSpecialization(subject, spec.id);
                    happen("Influence", null, subject, { education: 0.5 * effect, temp: true });
                } else {
                    happen("Influence", null, subject, { education: 0.5 * effect, temp: true });
                }
                worsenRelations(target, subject, Math.max(1, Math.round(1 * effect)));
                break;
            }
            default:
                break;
        }
    }

    function maybeStealMaps(subject, target, scale = 1) {
        if (!subject || !target) return false;
        if (!initDiscoveryState()) return false;
        const travel = target.influences?.travel || 0;
        const trade = target.influences?.trade || 0;
        const education = target.influences?.education || 0;
        const mapValue = travel * 0.6 + trade * 0.3 + education * 0.2;

        const hasRouteKnowledge = hasTownSpecialization(target, "tradingHub") || hasTownSpecialization(target, "merchantGuild");
        const hasScholars = hasTownSpecialization(target, "grandLibrary") || hasTownSpecialization(target, "academy");
        const bonus = (hasRouteKnowledge ? 0.6 : 0) + (hasScholars ? 0.4 : 0);

        if ((mapValue + bonus) < 2.5) return false;

        const boost = clampValue((0.0009 * (mapValue + bonus)) * scale, 0.0006, 0.008);
        const duration = Math.max(10, Math.round(20 * scale));

        planet._paultendoDiscovery.boost = Math.min(0.02, (planet._paultendoDiscovery.boost || 0) + boost);
        planet._paultendoDiscovery.boostUntil = Math.max(planet._paultendoDiscovery.boostUntil || 0, planet.day + duration);

        if (Math.random() < 0.18 * scale) {
            modLog(
                "espionage",
                `Stolen charts from {{regname:town|${target.id}}} spur new explorations in {{regname:town|${subject.id}}}.`,
                null,
                { town: subject }
            );
        }
        return true;
    }

    const SHADOW_MARKER_DEF = {
        name: "Shadow Activity",
        subtype: "shadowActivity",
        symbol: "?",
        color: [160, 160, 160]
    };

    function markEspionageActivity(town, duration = 12) {
        if (!town) return null;
        return createTempMarker(town, SHADOW_MARKER_DEF, duration);
    }

    function findActiveGreatWorkProject(town) {
        if (!town) return null;
        const projects = regFilter("process", p =>
            p.type === "project" &&
            !p.done &&
            !p.end &&
            p.town === town.id &&
            isGreatWorkSubtype(p.subtype)
        );
        if (!projects.length) return null;
        return choose(projects);
    }

    function maybeSabotageGreatWork(subject, target, scale = 1) {
        if (!target || target.end) return false;
        if (Math.random() > 0.12 * scale) return false;
        const project = findActiveGreatWorkProject(target);
        if (!project) return false;

        const base = project.total || project.cost || 200;
        const penalty = Math.max(10, Math.round(base * (0.05 + Math.random() * 0.05) * scale));
        project.cost = Math.max(0, Math.round((project.cost || 0) + penalty));
        project.total = Math.max(project.total || 0, project.cost);

        const work = getGreatWorkBySubtype(project.subtype);
        const title = work?.title || project.name || "a Great Work";
        modLog(
            "espionage",
            `Saboteurs delay {{regname:town|${target.id}}}'s ${title}, draining resources from the project.`,
            "warning",
            { town: target }
        );
        try { markEspionageActivity(target, 16); } catch {}
        return true;
    }

    function exposeSecret(secret, exposedBy = null) {
        if (!secret || secret.exposed) return false;
        secret.exposed = true;
        secret.exposedDay = planet.day;

        const owner = regGet("town", secret.owner);
        if (owner && !owner.end) {
            if (secret.type === "military") {
                happen("Influence", null, owner, { military: -0.5, temp: true });
            } else if (secret.type === "trade") {
                happen("Influence", null, owner, { trade: -0.5, temp: true });
            } else if (secret.type === "faith") {
                happen("Influence", null, owner, { faith: -0.8, temp: true });
            } else if (secret.type === "succession") {
                initUnrest(owner);
                owner.unrest = Math.min(100, owner.unrest + 6);
            } else if (secret.type === "scandal") {
                happen("Influence", null, owner, { happy: -0.7, crime: 0.5, temp: true });
            }
        }

        const ownerName = owner ? `{{regname:town|${owner.id}}}` : "A town";
        logMessage(`${ownerName}'s ${secret.title} are exposed to the world.`, "warning");
        if (owner) {
            try { markEspionageActivity(owner, 18); } catch {}
        }

        try {
            const stage = getAnnalsStage();
            const title = `Secrets of ${ownerName} Revealed`;
            let body = stage === "oral"
                ? `Rumors about ${ownerName} spread along the roads.`
                : stage === "scribe"
                    ? `Records note the exposure of ${ownerName}'s ${secret.title}.`
                    : `Later historians cite the revelation of ${ownerName}'s ${secret.title} as a turning point.`;
            recordAnnalsEntry({
                theme: secret.theme || "diplomacy",
                title,
                body,
                sourceType: "secret_exposed",
                sourceId: secret.id
            });
        } catch {}

        return true;
    }

    modEvent("secretGeneration", {
        daily: true,
        subject: { reg: "town", all: true },
        value: (subject) => {
            if (!subject || subject.end || subject.pop < 10) return false;
            const secrets = getTownSecrets(subject, true);
            if (secrets.length >= MAX_SECRETS_PER_TOWN) return false;
            if (Math.random() > 0.002) return false;
            return true;
        },
        func: (subject) => {
            createSecret(subject, chooseSecretType(subject));
        }
    });

    modEvent("espionageAttempt", {
        random: true,
        weight: $c.RARE,
        subject: { reg: "town", random: true },
        target: { reg: "town", random: true },
        value: (subject, target, args) => {
            if (!subject || !target) return false;
            if (subject.id === target.id) return false;
            if (subject.end || target.end) return false;
            if (subject.pop < 20 || target.pop < 20) return false;

            const profile = getEspionageStageProfile();
            const capability = getSpyCapability(subject);
            if (capability < profile.minCapability) return false;

            const motive = getEspionageMotive(subject, target);
            if (motive <= 0) return false;

            if (Math.random() > Math.min(0.3, 0.1 + motive * 0.1)) return false;

            args.motive = motive;
            args.stageScale = profile.scale;
            args.successChance = computeSpySuccessChance(subject, target);
            return true;
        },
        func: (subject, target, args) => {
            const effectScale = args.stageScale || 1;
            const success = Math.random() < args.successChance;
            args.success = success;

            if (success) {
                const secrets = getTownSecrets(target, false);
                const secret = secrets.length > 0 ? choose(secrets) : createSecret(target, chooseSecretType(target));
                addSecretKnowledge(secret, subject);
                applySecretLeverage(secret, subject, target, effectScale);
                maybeStealMaps(subject, target, effectScale);
                maybeSabotageGreatWork(subject, target, effectScale);
                bumpWarPressure(subject, target, 1 * effectScale);

                if (Math.random() < 0.15 * effectScale) {
                    modLog(
                        "espionage",
                        `Whispers say agents from {{regname:town|${subject.id}}} returned from {{regname:town|${target.id}}} with ${secret.title}.`,
                        null,
                        { town: subject }
                    );
                }
                if (Math.random() < 0.2 * effectScale) {
                    markEspionageActivity(target, 10);
                }
            } else {
                const fallout = effectScale;
                const relationHit = Math.max(1, Math.round(3 * fallout));
                const grudgeHit = Math.max(1, Math.round(3 * fallout));
                worsenRelations(target, subject, relationHit);
                recordGrudge(target, subject.id, "Espionage exposed", grudgeHit);
                bumpWarPressure(target, subject, 2 * fallout);
                logMessage(`Spies from {{regname:town|${subject.id}}} are caught in {{regname:town|${target.id}}}!`, "warning");
                markEspionageActivity(target, 18);
            }
        }
    });

    modEvent("secretLeak", {
        random: true,
        weight: $c.VERY_RARE,
        subject: { reg: "player", id: 1 },
        value: (subject, target, args) => {
            initSecrets();
            const candidates = planet._paultendoSecrets.filter(s =>
                !s.exposed && s.knownBy && s.knownBy.length > 1
            );
            if (candidates.length === 0) return false;
            args.secret = choose(candidates);
            return true;
        },
        func: (subject, target, args) => {
            exposeSecret(args.secret);
        }
    });

    modEvent("secretDecay", {
        daily: true,
        subject: { reg: "player", id: 1 },
        func: () => {
            initSecrets();
            planet._paultendoSecrets = planet._paultendoSecrets.filter(s =>
                !s.exposed || planet.day - (s.exposedDay || s.created) < 200
            );
        }
    });

    // ----------------------------------------
    // ERA SYSTEM
    // ----------------------------------------

    // Era types with conditions
    const ERA_TYPES = {
        peace: {
            name: ["The Long Peace", "The Golden Age", "Era of Harmony", "The Peaceful Years"],
            condition: (history) => {
                const recentWars = getRecentHistory(50, [HISTORY_TYPES.WAR]);
                return recentWars.length === 0;
            }
        },
        war: {
            name: ["The Great War", "Age of Conflict", "The Warring Period", "Time of Strife"],
            condition: (history) => {
                const recentWars = getRecentHistory(30, [HISTORY_TYPES.WAR]);
                return recentWars.length >= 2;
            }
        },
        plague: {
            name: ["The Great Plague", "Years of Sickness", "The Dying Time", "The Pestilence"],
            condition: (history) => {
                const recentDisasters = getRecentHistory(30, [HISTORY_TYPES.DISASTER]);
                return recentDisasters.filter(d => d.subtype === "epidemic" || d.deaths > 50).length >= 1;
            }
        },
        expansion: {
            name: ["Age of Expansion", "The Founding Era", "Time of Growth", "The New Frontier"],
            condition: (history) => {
                const recentFoundings = getRecentHistory(50, [HISTORY_TYPES.TOWN_FOUNDED]);
                return recentFoundings.length >= 3;
            }
        },
        faith: {
            name: ["The Religious Age", "Era of Faith", "The Spiritual Awakening", "Time of Devotion"],
            condition: (history) => {
                const recentReligion = getRecentHistory(50, [HISTORY_TYPES.RELIGION_FOUNDED, HISTORY_TYPES.RELIGION_SCHISM]);
                return recentReligion.length >= 2;
            }
        },
        revolution: {
            name: ["Age of Revolution", "The Upheaval", "Time of Change", "The Reckoning"],
            condition: (history) => {
                const recentRevolutions = getRecentHistory(50, [HISTORY_TYPES.REVOLUTION]);
                return recentRevolutions.length >= 2;
            }
        },
        learning: {
            name: ["The Enlightenment", "Age of Reason", "Era of Discovery", "The Renaissance"],
            condition: (history) => {
                const recentTech = getRecentHistory(50, [HISTORY_TYPES.TECHNOLOGY]);
                return recentTech.length >= 3;
            }
        },
        culture: {
            name: ["The Cultural Flowering", "Age of Art", "The Golden Renaissance", "Era of Beauty"],
            condition: (history) => {
                const recentCulture = getRecentHistory(50, [HISTORY_TYPES.CULTURAL_ACHIEVEMENT]);
                return recentCulture.length >= 2;
            }
        }
    };

    // Check for era changes
    modEvent("eraCheck", {
        daily: true,
        subject: { reg: "nature", id: 1 },
        value: () => {
            // Only check every 10 days
            return planet.day % 10 === 0;
        },
        func: () => {
            initHistory();

            // Need some history before eras start
            if (planet.history.length < 5) return;

            // Check if current era should end
            if (planet.currentEra) {
                const eraType = ERA_TYPES[planet.currentEra.type];
                if (eraType && !eraType.condition(planet.history)) {
                    // Era ends
                    planet.currentEra.ended = planet.day;
                    planet.currentEra.duration = planet.day - planet.currentEra.started;

                    logMessage(`{{b:${planet.currentEra.name}}} comes to an end after ${planet.currentEra.duration} days.`, "milestone");
                    try {
                        const stage = getAnnalsStage();
                        const title = `${planet.currentEra.name} Ends`;
                        let body = stage === "oral"
                            ? `The age called {{b:${planet.currentEra.name}}} fades into memory.`
                            : stage === "scribe"
                                ? `Records mark the end of {{b:${planet.currentEra.name}}} after ${planet.currentEra.duration} days.`
                                : `Historians close the chapter on {{b:${planet.currentEra.name}}}, lasting ${planet.currentEra.duration} days.`;
                        recordAnnalsEntry({
                            theme: "era",
                            title,
                            body,
                            eraType: planet.currentEra.type,
                            eraName: planet.currentEra.name,
                            sourceType: "era_end",
                            sourceId: planet.currentEra.started
                        });
                    } catch {}

                    planet.eras.push(planet.currentEra);
                    planet.currentEra = null;
                }
            }

            // Check if a new era should begin
            if (!planet.currentEra) {
                for (const [type, era] of Object.entries(ERA_TYPES)) {
                    if (era.condition(planet.history)) {
                        const name = choose(era.name);
                        planet.currentEra = {
                            type: type,
                            name: name,
                            started: planet.day
                        };

                        recordHistory(HISTORY_TYPES.ERA_BEGAN, {
                            eraType: type,
                            eraName: name
                        });

                        logMessage(`A new age begins: {{b:${name}}}.`, "milestone");
                        try { onEraBegan(planet.currentEra); } catch {}
                        break;
                    }
                }
            }
        }
    });

    // ----------------------------------------
    // HISTORY RECORDING HOOKS
    // ----------------------------------------

    // Record wars when they end
    modEvent("recordWarHistory", {
        daily: true,
        subject: { reg: "process", all: true },
        value: (subject) => {
            if (subject.type !== "war") return false;
            if (!subject.done) return false;
            if (subject._historyRecorded) return false;
            return true;
        },
        func: (subject) => {
            subject._historyRecorded = true;

            ensureWarSides(subject);
            const towns = subject.towns || [];
            const winnerSide = subject.winnerSide !== undefined ? subject.winnerSide : null;
            let victorTown = subject.winner ? regGet("town", subject.winner) : null;
            if (!victorTown && winnerSide !== null) {
                victorTown = pickWarLeader(getWarSideTowns(subject, winnerSide));
                if (victorTown) subject.winner = victorTown.id;
            }

            let losers = Array.isArray(subject.losers) ? subject.losers.slice() : [];
            if (losers.length === 0 && winnerSide !== null) {
                const losingSideIndex = getOpposingSideIndex(subject, winnerSide);
                losers = getWarSideTowns(subject, losingSideIndex).map(t => t.id);
            }
            const losingSideTowns = losers.map(id => regGet("town", id)).filter(t => t && !t.end);
            const loserLeader = pickWarLeader(losingSideTowns);

            const entry = recordHistory(HISTORY_TYPES.WAR, {
                victor: victorTown ? victorTown.id : null,
                victorName: victorTown?.name,
                loser: loserLeader ? loserLeader.id : (losers[0] || null),
                loserName: loserLeader?.name || (losers[0] ? getTownNameById(losers[0]) : null),
                losers: losers,
                towns: towns,
                winnerSide: winnerSide,
                loserSide: subject.loserSide,
                deaths: subject.deaths || 0,
                duration: subject.done - subject.start,
                name: victorTown && loserLeader ?
                    `The ${victorTown.name}-${loserLeader.name} War` :
                    `The War of Day ${subject.start}`
            });

            // Create war hero from victor
            if (victorTown && !victorTown.end && subject.deaths > 10 && Math.random() < 0.3) {
                const hero = createFigure("GENERAL", {
                    town: victorTown.id,
                    deeds: [`Led ${victorTown.name} to victory in ${entry.name}`]
                });
                logMessage(`{{b:${hero.fullTitle}}} emerges as a celebrated general in {{regname:town|${victorTown.id}}}.`);
            }

            // Record grudges
            if (victorTown && losingSideTowns.length) {
                for (let i = 0; i < losingSideTowns.length; i++) {
                    const losingTown = losingSideTowns[i];
                    if (!losingTown || losingTown.end) continue;
                    recordGrudge(losingTown, victorTown.id, `Defeated in ${entry.name}`, 5);

                    if (subject.deaths > 20 && Math.random() < 0.15) {
                        const martyr = createFigure("MARTYR", {
                            town: losingTown.id,
                            deeds: [`Fell defending ${losingTown.name} in ${entry.name}`]
                        });
                        killFigure(martyr, "battle", losingTown.id);
                        logMessage(`{{regname:town|${losingTown.id}}} mourns {{b:${martyr.name}}}, martyred in the war.`);
                    }
                }
            }
        }
    });

    // Record town foundings
    modEvent("recordTownFounding", {
        daily: true,
        subject: { reg: "town", all: true },
        value: (subject) => {
            if (subject._foundingRecorded) return false;
            if (planet.day - subject.start > 1) return false;
            return true;
        },
        func: (subject) => {
            subject._foundingRecorded = true;

            recordHistory(HISTORY_TYPES.TOWN_FOUNDED, {
                town: subject.id,
                townName: subject.name,
                parentTown: subject.former
            });

            // Founders are created for significant new towns
            if (Math.random() < 0.2) {
                const founder = createFigure("FOUNDER", {
                    town: subject.id,
                    deeds: [`Founded the settlement of ${subject.name}`]
                });
                logMessage(`{{b:${founder.fullTitle}}} leads the founding of {{regname:town|${subject.id}}}.`);
            }
        }
    });

    // Record disasters
    modEvent("recordDisasterHistory", {
        daily: true,
        subject: { reg: "process", all: true },
        value: (subject) => {
            if (subject.type !== "disaster") return false;
            if (!subject.done) return false;
            if (subject._historyRecorded) return false;
            if ((subject.deaths || 0) < 5) return false; // Only significant disasters
            return true;
        },
        func: (subject) => {
            subject._historyRecorded = true;

            recordHistory(HISTORY_TYPES.DISASTER, {
                subtype: subject.subtype,
                towns: subject.towns || [],
                deaths: subject.deaths || 0,
                name: subject.name || `The ${subject.subtype} of Day ${subject.start}`
            });

            // Healers may emerge from disaster response
            if (subject.deaths > 20 && Math.random() < 0.2) {
                const town = subject.towns?.[0] ? regGet("town", subject.towns[0]) : null;
                if (town && !town.end) {
                    const healer = createFigure("HEALER", {
                        town: town.id,
                        deeds: [`Saved countless lives during the ${subject.subtype}`]
                    });
                    logMessage(`{{b:${healer.fullTitle}}} is celebrated for heroism during the disaster in {{regname:town|${town.id}}}.`);
                }
            }
        }
    });

    // Record revolutions
    modEvent("recordRevolutionHistory", {
        daily: true,
        subject: { reg: "town", all: true },
        value: (subject) => {
            // Check if revolution just ended
            if (!subject._revolutionEndedDay) return false;
            if (subject._revolutionEndedDay !== planet.day - 1) return false;
            if (subject._revolutionHistoryRecorded) return false;
            return true;
        },
        func: (subject) => {
            subject._revolutionHistoryRecorded = true;

            const newGov = subject.governmentType || subject.gov;

            recordHistory(HISTORY_TYPES.REVOLUTION, {
                town: subject.id,
                townName: subject.name,
                newGovernment: newGov,
                name: `The ${subject.name} Revolution`
            });

            // Revolutionary leader emerges
            if (Math.random() < 0.4) {
                const revolutionary = createFigure("REVOLUTIONARY", {
                    town: subject.id,
                    deeds: [`Led the revolution in ${subject.name}`]
                });
                logMessage(`{{b:${revolutionary.fullTitle}}} is remembered for leading the revolution in {{regname:town|${subject.id}}}.`);
            }
        }
    });

    // Record religion founding (hook into existing event)
    // We already create religions - add history recording
    const originalCreateReligion = createReligion;
    createReligion = function(foundingTown, parentReligion = null) {
        const religion = originalCreateReligion(foundingTown, parentReligion);

        if (parentReligion) {
            recordHistory(HISTORY_TYPES.RELIGION_SCHISM, {
                religion: religion.id,
                religionName: religion.name,
                parentReligion: parentReligion.id,
                parentName: parentReligion.name,
                town: foundingTown.id
            });
        } else {
            recordHistory(HISTORY_TYPES.RELIGION_FOUNDED, {
                religion: religion.id,
                religionName: religion.name,
                town: foundingTown.id,
                archetype: religion.archetype
            });

            // Prophet figure for new religions
            if (Math.random() < 0.5) {
                const prophet = createFigure("PROPHET", {
                    town: foundingTown.id,
                    religion: religion.id,
                    deeds: [`Founded ${religion.name}`]
                });
                logMessage(`{{b:${prophet.fullTitle}}} establishes {{b:${religion.name}}} in {{regname:town|${foundingTown.id}}}.`);
            }
        }

        if (foundingTown && Math.random() < 0.6) {
            try { incorporateMythIntoReligion(religion, foundingTown); } catch {}
        }

        return religion;
    };

    // Record alliance formations (hook into existing)
    const originalFormAlliance = formAlliance;
    formAlliance = function(town1, town2, name = null) {
        const alliance = originalFormAlliance(town1, town2, name);

        if (alliance) {
            recordHistory(HISTORY_TYPES.ALLIANCE_FORMED, {
                alliance: alliance.id,
                allianceName: alliance.name,
                founders: [town1.id, town2.id],
                founderNames: [town1.name, town2.name]
            });

            // Record bonds between founding members
            recordBond(town1, town2.id, `Co-founded ${alliance.name}`, 3);
            recordBond(town2, town1.id, `Co-founded ${alliance.name}`, 3);
            try { ensureAllianceMarker(alliance); } catch {}
        }

        return alliance;
    };

    const originalLeaveAlliance = leaveAlliance;
    leaveAlliance = function(town) {
        const result = originalLeaveAlliance(town);
        if (result && result.dissolved && result.alliance) {
            try { removeAllianceMarker(result.alliance); } catch {}
        }
        return result;
    };

    // ----------------------------------------
    // ANNIVERSARY EVENTS
    // ----------------------------------------

    // Commemorate significant historical events
    modEvent("warAnniversary", {
        random: true,
        weight: $c.UNCOMMON,
        subject: { reg: "town", random: true },
        value: (subject, target, args) => {
            initHistory();

            // Find wars this town was involved in
            const warHistory = planet.history.filter(h =>
                h.type === HISTORY_TYPES.WAR &&
                (h.victor === subject.id || h.loser === subject.id) &&
                planet.day - h.day >= 100 && // At least 100 days ago
                planet.day - h.day <= 500    // Not ancient history
            );

            if (warHistory.length === 0) return false;

            const war = choose(warHistory);
            const wasVictor = war.victor === subject.id;
            const daysSince = planet.day - war.day;

            // Anniversary near multiples of 100
            const nearAnniversary = daysSince % 100 < 10 || daysSince % 100 > 90;
            if (!nearAnniversary) return false;

            args.war = war;
            args.wasVictor = wasVictor;
            args.years = Math.floor(daysSince / 100);
            return true;
        },
        func: (subject, target, args) => {
            if (args.wasVictor) {
                happen("Influence", null, subject, { happy: 1, military: 0.3, temp: true });
                if (Math.random() < 0.3) {
                    logMessage(`{{regname:town|${subject.id}}} commemorates their victory in {{b:${getHistoryDisplayName(args.war)}}} ${args.years * 100} days ago.`);
                }
            } else {
                // Defeated side may still hold grudge
                if (args.war.victor) {
                    const victor = regGet("town", args.war.victor);
                    if (victor && !victor.end && hasGrudge(subject, args.war.victor)) {
                        happen("Influence", null, subject, { military: 0.5, happy: -0.3, temp: true });
                        if (Math.random() < 0.3) {
                            logMessage(`{{regname:town|${subject.id}}} grimly remembers their defeat in {{b:${getHistoryDisplayName(args.war)}}}.`);
                        }
                    }
                }
            }
        }
    });

    // Remember fallen figures
    modEvent("figureRemembrance", {
        random: true,
        weight: $c.RARE,
        subject: { reg: "town", random: true },
        value: (subject, target, args) => {
            const figures = getTownFigures(subject.id, false);
            const deadFigures = figures.filter(f => f.died);

            if (deadFigures.length === 0) return false;

            const figure = choose(deadFigures);
            const daysSinceDeath = planet.day - figure.died;

            // Anniversary near multiples of 100
            if (daysSinceDeath < 50) return false;
            const nearAnniversary = daysSinceDeath % 100 < 10;
            if (!nearAnniversary) return false;

            args.figure = figure;
            return true;
        },
        func: (subject, target, args) => {
            const figure = args.figure;

            happen("Influence", null, subject, { faith: 0.5, happy: 0.3, temp: true });

            if (Math.random() < 0.4) {
                logMessage(`{{regname:town|${subject.id}}} honors the memory of {{b:${getFigureDisplayName(figure)}}}.`);
            }
        }
    });

    // Historical references in events
    modEvent("historicalParallel", {
        random: true,
        weight: $c.RARE,
        subject: { reg: "town", random: true },
        value: (subject, target, args) => {
            initHistory();

            // Current situation matches historical event
            const atWar = regFilter("process", p =>
                p.type === "war" && !p.done && p.towns?.includes(subject.id)
            );

            if (atWar.length === 0) return false;

            // Find past war with same enemy
            const currentEnemy = atWar[0].towns.find(id => id !== subject.id);
            const pastWars = planet.history.filter(h =>
                h.type === HISTORY_TYPES.WAR &&
                h.towns?.includes(subject.id) &&
                h.towns?.includes(currentEnemy) &&
                planet.day - h.day >= 50
            );

            if (pastWars.length === 0) return false;

            args.pastWar = choose(pastWars);
            args.currentEnemy = currentEnemy;
            return true;
        },
        func: (subject, target, args) => {
            const enemy = regGet("town", args.currentEnemy);
            if (!enemy) return;

            const wasVictor = args.pastWar.victor === subject.id;

            if (wasVictor) {
                happen("Influence", null, subject, { military: 1, happy: 0.5, temp: true });
                logMessage(`{{regname:town|${subject.id}}} draws courage from their past victory over {{regname:town|${enemy.id}}} in {{b:${getHistoryDisplayName(args.pastWar)}}}.`);
            } else {
                // Could go either way - revenge motivation or fear
                if (Math.random() < 0.5) {
                    happen("Influence", null, subject, { military: 1.5, temp: true });
                    logMessage(`{{regname:town|${subject.id}}} seeks revenge for their defeat in {{b:${getHistoryDisplayName(args.pastWar)}}}.`);
                } else {
                    happen("Influence", null, subject, { happy: -0.5, temp: true });
                    logMessage(`The specter of {{b:${getHistoryDisplayName(args.pastWar)}}} haunts {{regname:town|${subject.id}}} as they face {{regname:town|${enemy.id}}} again.`);
                }
            }
        }
    });

    // ----------------------------------------
    // HISTORICAL MONUMENTS
    // ----------------------------------------

    // Build monuments to historical figures
    modEvent("buildFigureMonument", {
        random: true,
        weight: $c.RARE,
        subject: { reg: "town", random: true },
        value: (subject, target, args) => {
            const figures = getTownFigures(subject.id, false);
            const deadHeroes = figures.filter(f =>
                f.died &&
                ["HERO", "GENERAL", "PROPHET", "FOUNDER", "MARTYR"].includes(f.type) &&
                planet.day - f.died >= 50 &&
                !f.hasMonument
            );

            if (deadHeroes.length === 0) return false;

            args.figure = choose(deadHeroes);
            return true;
        },
        message: (subject, target, args) => {
            const displayName = getFigureDisplayName(args.figure);
            return `{{people}} wish to build a monument to {{b:${displayName}}}. {{should}}`;
        },
        messageDone: "A statue is raised in their honor.",
        messageNo: "Their memory lives on without stone.",
        func: (subject, target, args) => {
            args.figure.hasMonument = true;
            args.figure.monumentLocation = subject.id;

            happen("Create", null, null, {
                type: "landmark",
                subtype: "monument",
                name: `Statue of ${getFigureDisplayName(args.figure)}`,
                symbol: "🗿",
                x: getTownCenter(subject)?.[0],
                y: getTownCenter(subject)?.[1]
            });

            initTownCulture(subject);
            subject.culture.prestige += 3;

            happen("Influence", null, subject, { happy: 1, faith: 0.5 });

            logMessage(`A monument to {{b:${getFigureDisplayName(args.figure)}}} is unveiled in {{regname:town|${subject.id}}}.`, "milestone");
        }
    });

    // Build monuments to historical events
    modEvent("buildEventMonument", {
        random: true,
        weight: $c.RARE,
        subject: { reg: "town", random: true },
        value: (subject, target, args) => {
            initHistory();

            // Find significant events involving this town
            const events = planet.history.filter(h =>
                (h.victor === subject.id ||
                 h.town === subject.id ||
                 (h.type === HISTORY_TYPES.ALLIANCE_FORMED && h.founders?.includes(subject.id))) &&
                planet.day - h.day >= 100 &&
                !h.hasMonument
            );

            if (events.length === 0) return false;

            args.event = choose(events);
            return true;
        },
        message: (subject, target, args) => {
            const eventName = getHistoryDisplayName(args.event);
            return `{{people}} propose a monument commemorating {{b:${eventName}}}. {{should}}`;
        },
        messageDone: "History is preserved in stone.",
        messageNo: "The past needs no monuments.",
        func: (subject, target, args) => {
            args.event.hasMonument = true;
            args.event.monumentLocation = subject.id;

            const symbolMap = {
                [HISTORY_TYPES.WAR]: "⚔",
                [HISTORY_TYPES.ALLIANCE_FORMED]: "🤝",
                [HISTORY_TYPES.REVOLUTION]: "✊",
                [HISTORY_TYPES.TOWN_FOUNDED]: "🏛",
                [HISTORY_TYPES.RELIGION_FOUNDED]: "⛪"
            };

            happen("Create", null, null, {
                type: "landmark",
                subtype: "monument",
                name: `${getHistoryDisplayName(args.event)} Monument`,
                symbol: symbolMap[args.event.type] || "🗿",
                x: getTownCenter(subject)?.[0],
                y: getTownCenter(subject)?.[1]
            });

            initTownCulture(subject);
            subject.culture.prestige += 2;

            happen("Influence", null, subject, { happy: 1 });

            logMessage(`{{regname:town|${subject.id}}} erects a monument to {{b:${getHistoryDisplayName(args.event)}}}.`, "milestone");
        }
    });

    // ----------------------------------------
    // GREAT WORKS & WONDERS (one per era, dynamic, sometimes autonomous)
    // ----------------------------------------

    const GREAT_WORK_CONFIG = {
        minPop: 70,
        minTowns: 3,
        baseCost: 240,
        costPerPop: 4.5,
        costPerTown: 45,
        eraCostScale: 0.08,
        proposalCooldown: 40,
        declineCooldown: 30,
        autonomousChance: 0.06,
        contributionChance: 0.22,
        contributionBase: 8,
        contributionMax: 30
    };

    const GREAT_WORK_EPITHETS = [
        "Radiant", "Eternal", "Golden", "Obsidian", "Ivory", "Luminous",
        "Verdant", "Crimson", "Sapphire", "Starlit", "Silent", "Iron",
        "Hallowed", "Enduring", "Celestial", "Ancient", "Emerald", "Azure"
    ];

    const GREAT_WORK_TEMPLATES = [
        {
            id: "library",
            baseNames: ["Great Library", "Grand Archive", "Vault of Knowledge", "Hall of Records"],
            tags: ["learning", "culture"],
            symbol: "☗",
            color: [235, 218, 120],
            influences: { education: [2, 3, 0.5], trade: [0.5, 1, 0.5], happy: [0.5, 1, 0.5] },
            needsUnlock: { education: 20 },
            effect: "library",
            theme: "learning",
            description: "A monumental archive meant to preserve the knowledge of the age."
        },
        {
            id: "observatory",
            baseNames: ["Grand Observatory", "Celestial Watch", "Sky Compass", "Astral Vault"],
            tags: ["learning", "expansion"],
            symbol: "✶",
            color: [180, 200, 255],
            influences: { education: [2, 2.5, 0.5], travel: [1, 1.5, 0.5] },
            needsUnlock: { education: 30, travel: 30 },
            effect: "observatory",
            theme: "discovery",
            description: "The heavens are charted in stone and brass, guiding explorers beyond the horizon."
        },
        {
            id: "cathedral",
            baseNames: ["Grand Temple", "Sacred Basilica", "Hallowed Spire", "Pilgrim's Sanctuary"],
            tags: ["faith", "peace"],
            symbol: "⛪",
            color: [220, 160, 220],
            influences: { faith: [2.5, 3.5, 0.5], happy: [0.5, 1, 0.5] },
            needsUnlock: { farm: 20 },
            effect: "cathedral",
            theme: "faith",
            description: "A sacred center that draws the faithful from across the world."
        },
        {
            id: "monument",
            baseNames: ["World Monument", "Triumphal Colossus", "Pillar of Ages", "Stone of Unity"],
            tags: ["peace", "culture", "diplomacy"],
            symbol: "⟡",
            color: [190, 190, 170],
            influences: { happy: [1.5, 2.5, 0.5], law: [0.5, 1.5, 0.5] },
            needsUnlock: { government: 10 },
            effect: "monument",
            theme: "culture",
            description: "A colossal monument meant to remind the world of unity and shared memory."
        },
        {
            id: "citadel",
            baseNames: ["Great Citadel", "Iron Bastion", "Crown Fortress", "Shield Wall"],
            tags: ["war", "military"],
            symbol: "▟",
            color: [180, 150, 160],
            influences: { military: [2, 3, 0.5], law: [0.5, 1.5, 0.5] },
            needsUnlock: { military: 15 },
            effect: "citadel",
            theme: "war",
            description: "A fortress of legend, built to stand against any foe."
        },
        {
            id: "harbor",
            baseNames: ["Great Harbor", "Lighthouse of Nations", "Ocean Gate", "Mariner's Beacon"],
            tags: ["expansion", "trade"],
            symbol: "⚓",
            color: [120, 200, 200],
            influences: { trade: [2, 3, 0.5], travel: [1, 1.5, 0.5] },
            needsUnlock: { travel: 40, trade: 20 },
            effect: "harbor",
            theme: "diplomacy",
            description: "A vast harbor whose beacons draw ships from distant shores."
        },
        {
            id: "sanctuary",
            baseNames: ["Healing Sanctuary", "Grand Infirmary", "House of Mercy", "Garden of Remedies"],
            tags: ["health", "plague"],
            symbol: "+",
            color: [200, 120, 120],
            influences: { disease: [-2.5, -1.5, 0.5], happy: [0.5, 1, 0.5] },
            needsUnlock: { smith: 20, education: 20 },
            effect: "sanctuary",
            theme: "hardship",
            description: "A haven for the sick, where knowledge and compassion meet."
        },
        {
            id: "charter",
            baseNames: ["Charter Hall", "Hall of Justice", "Civic Forum", "Council Rotunda"],
            tags: ["revolution", "governance", "peace"],
            symbol: "⚖",
            color: [200, 200, 140],
            influences: { law: [2, 3, 0.5], happy: [0.5, 1, 0.5] },
            needsUnlock: { government: 15 },
            effect: "charter",
            theme: "revolution",
            description: "A chamber where laws are forged and disputes settled."
        }
    ];

    const GREAT_WORK_ERA_TAGS = {
        peace: ["peace", "culture", "diplomacy"],
        war: ["war", "military"],
        plague: ["health", "plague"],
        expansion: ["expansion", "trade", "learning"],
        faith: ["faith"],
        revolution: ["revolution", "governance"],
        learning: ["learning"],
        culture: ["culture"]
    };

    function initGreatWorks() {
        if (!planet._paultendoGreatWorks) {
            planet._paultendoGreatWorks = {
                works: {},
                bySubtype: {},
                lastProposalDay: -999,
                lastAutonomousDay: -999
            };
        }
        if (!planet._paultendoGreatWorks.bySubtype) {
            planet._paultendoGreatWorks.bySubtype = {};
        }
        if (planet._paultendoGreatWorks.works && Object.keys(planet._paultendoGreatWorks.bySubtype).length === 0) {
            Object.values(planet._paultendoGreatWorks.works).forEach(work => {
                if (work && work.subtype) {
                    planet._paultendoGreatWorks.bySubtype[work.subtype] = work.id;
                }
            });
        }
    }

    function getGreatWorkEraKey(era) {
        if (!era) return null;
        const type = era.type || era.eraType || "era";
        const name = era.name || era.eraName || "Era";
        const started = era.started || era.start || 0;
        return `${type}:${name}:${started}`;
    }

    function sanitizeGreatWorkId(text) {
        if (!text) return "great_work";
        return text.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    }

    function generateGreatWorkEpithet() {
        if (typeof generateWord === "function" && Math.random() < 0.35) {
            return titleCase(generateWord(randRange(2, 3), true));
        }
        return choose(GREAT_WORK_EPITHETS);
    }

    function rollInfluenceValue(value) {
        if (Array.isArray(value)) {
            const min = value[0];
            const max = value[1];
            const step = value[2] || 0.1;
            const raw = min + Math.random() * (max - min);
            return Math.round(raw / step) * step;
        }
        return value;
    }

    function selectGreatWorkTemplate(eraType) {
        const tags = getGreatWorkContextTags(eraType);
        return weightedChoice(GREAT_WORK_TEMPLATES, (template) => {
            let weight = 1;
            if (tags.length) {
                const matches = template.tags.filter(tag => tags.includes(tag)).length;
                weight += matches * 2;
            }

            // Pressure-driven nudges
            const wars = regFilter("process", p => p.type === "war" && !p.done);
            const epidemics = planet.epidemics && planet.epidemics.length ? planet.epidemics.length : 0;
            const alliances = planet.alliances && planet.alliances.length ? planet.alliances.length : 0;
            const routes = planet.tradeRoutes && planet.tradeRoutes.length ? planet.tradeRoutes.length : 0;

            if (wars.length && template.id === "citadel") weight += 3;
            if (epidemics && template.id === "sanctuary") weight += 3;
            if (alliances >= 2 && (template.id === "monument" || template.id === "charter")) weight += 2;
            if (routes >= 3 && template.id === "harbor") weight += 2;

            return weight;
        });
    }

    function getGreatWorkContextTags(eraType) {
        const tagSet = new Set(GREAT_WORK_ERA_TAGS[eraType] || []);
        const wars = regFilter("process", p => p.type === "war" && !p.done);
        if (wars.length) {
            tagSet.add("war");
            tagSet.add("military");
        }
        if (planet.epidemics && planet.epidemics.length) {
            tagSet.add("plague");
            tagSet.add("health");
        }
        if (planet.alliances && planet.alliances.length >= 2) {
            tagSet.add("diplomacy");
            tagSet.add("peace");
        }
        if (planet.tradeRoutes && planet.tradeRoutes.length >= 3) {
            tagSet.add("trade");
            tagSet.add("expansion");
        }
        if (planet._paultendoDiscovery && planet._paultendoDiscovery.tier >= 2) {
            tagSet.add("expansion");
        }
        try {
            const universe = getUniverse(false);
            if (universe && (universe.spaceTech || 0) > 0) tagSet.add("learning");
        } catch {}
        return Array.from(tagSet);
    }

    function buildGreatWorkTitle(work, town) {
        const base = work.baseName || "Great Work";
        const epithet = work.epithet || generateGreatWorkEpithet();
        const pattern = work.namePattern || "{Base} of {Epithet}";
        return pattern
            .replace(/\{Base\}/g, base)
            .replace(/\{Epithet\}/g, epithet)
            .replace(/\{Town\}/g, town ? town.name : "")
            .replace(/\{Era\}/g, work.eraName || "the Age")
            .replace(/\s+/g, " ")
            .trim();
    }

    function registerGreatWorkSubtype(work) {
        if (typeof actionables === "undefined" || !actionables.process || !actionables.process._projectSubtypes) return false;
        actionables.process._projectSubtypes[work.subtype] = {
            symbol: work.symbol,
            color: work.color,
            influences: work.influences,
            nameTemplate: work.nameTemplate || work.title
        };
        return true;
    }

    function generateGreatWorkDefinition(era) {
        const template = selectGreatWorkTemplate(era.type);
        if (!template) return null;
        const eraKey = getGreatWorkEraKey(era);
        const subtype = `greatwork_${sanitizeGreatWorkId(eraKey)}_${template.id}`;
        const namePatterns = template.namePatterns || [
            "{Base} of {Epithet}",
            "The {Epithet} {Base}"
        ];
        const baseName = choose(template.baseNames);
        const epithet = generateGreatWorkEpithet();
        const namePattern = choose(namePatterns);
        const influences = {};
        Object.entries(template.influences).forEach(([key, value]) => {
            influences[key] = rollInfluenceValue(value);
        });
        const work = {
            id: `${subtype}_${Math.floor(Math.random() * 10000)}`,
            eraKey,
            eraType: era.type,
            eraName: era.name,
            templateId: template.id,
            subtype,
            baseName,
            epithet,
            namePattern,
            title: "",
            symbol: template.symbol,
            color: template.color,
            influences,
            needsUnlock: template.needsUnlock || null,
            effect: template.effect,
            theme: template.theme || "culture",
            description: template.description,
            status: "available"
        };
        work.title = buildGreatWorkTitle(work, null);
        return work;
    }

    function ensureGreatWorkForEra(era) {
        if (!era) return null;
        initGreatWorks();
        const eraKey = getGreatWorkEraKey(era);
        if (!eraKey) return null;
        if (planet._paultendoGreatWorks.works[eraKey]) {
            const existing = planet._paultendoGreatWorks.works[eraKey];
            registerGreatWorkSubtype(existing);
            return existing;
        }
        const work = generateGreatWorkDefinition(era);
        if (!work) return null;
        planet._paultendoGreatWorks.works[eraKey] = work;
        planet._paultendoGreatWorks.bySubtype[work.subtype] = work.id;
        registerGreatWorkSubtype(work);
        return work;
    }

    function getGreatWorkBySubtype(subtype) {
        initGreatWorks();
        const workId = planet._paultendoGreatWorks.bySubtype[subtype];
        const works = Object.values(planet._paultendoGreatWorks.works);
        if (!workId) {
            return works.find(w => w.subtype === subtype) || null;
        }
        return works.find(w => w.id === workId || w.subtype === subtype) || null;
    }

    function isGreatWorkSubtype(subtype) {
        return !!getGreatWorkBySubtype(subtype);
    }

    function canStartGreatWork(work) {
        if (!work) return false;
        if (work.status === "started" || work.status === "completed") return false;
        if (work.declinedDay && planet.day - work.declinedDay < GREAT_WORK_CONFIG.declineCooldown) return false;
        return true;
    }

    function meetsGreatWorkUnlocks(work) {
        if (!work || !work.needsUnlock) return true;
        const needs = work.needsUnlock;
        for (const key of Object.keys(needs)) {
            if ((planet.unlocks?.[key] || 0) < needs[key]) return false;
        }
        return true;
    }

    function getGreatWorkLeadScore(town, work) {
        if (!town) return 0;
        let score = (town.pop || 0) * 0.02;
        score += (town.influences?.trade || 0) * 1.2;
        score += (town.influences?.education || 0) * 1.2;
        score += (town.influences?.faith || 0) * 0.8;
        score += (town.influences?.military || 0) * 0.6;
        score += (town.influences?.happy || 0) * 0.5;
        if (work && work.influences) {
            Object.keys(work.influences).forEach(key => {
                score += (town.influences?.[key] || 0) * 1.5;
            });
        }
        return Math.max(0, score);
    }

    function getGreatWorkPartners(town) {
        if (!town) return [];
        const partners = new Map();
        const alliance = getTownAlliance(town);
        if (alliance && alliance.members) {
            alliance.members.forEach(id => {
                if (id === town.id) return;
                const ally = regGet("town", id);
                if (ally && !ally.end) partners.set(id, ally);
            });
        }
        try {
            const routes = getTownRoutes(town) || [];
            routes.forEach(route => {
                const partner = getRoutePartner(route, town);
                if (partner && !partner.end && partner.id !== town.id) {
                    partners.set(partner.id, partner);
                }
            });
        } catch {}
        return Array.from(partners.values());
    }

    function greatWorkNeedsPartners(work) {
        if (!work) return false;
        const template = GREAT_WORK_TEMPLATES.find(t => t.id === work.templateId);
        const tags = template?.tags || [];
        return tags.some(tag => ["diplomacy", "trade", "peace", "expansion"].includes(tag));
    }

    function getTownGreatWorkCount(town, status = "completed") {
        if (!town) return 0;
        initGreatWorks();
        const works = Object.values(planet._paultendoGreatWorks.works || {});
        return works.filter(w =>
            w &&
            w.townId === town.id &&
            (!status || w.status === status)
        ).length;
    }

    function pickGreatWorkLeadTown(work) {
        const towns = regFilter("town", t => {
            if (!t || t.end) return false;
            if ((t.pop || 0) < GREAT_WORK_CONFIG.minPop) return false;
            if (regExists("process", p => p.type === "project" && !p.done && p.town === t.id)) return false;
            if (greatWorkNeedsPartners(work)) {
                const partners = getGreatWorkPartners(t);
                if (partners.length === 0) return false;
            }
            return true;
        });
        if (towns.length < 1) return null;
        return weightedChoice(towns, t => getGreatWorkLeadScore(t, work) + 1);
    }

    function computeGreatWorkCost(town) {
        const townCount = regCount("town");
        const eraIndex = planet.eras ? planet.eras.length : 0;
        let cost = GREAT_WORK_CONFIG.baseCost;
        cost += (town.pop || 0) * GREAT_WORK_CONFIG.costPerPop;
        cost += townCount * GREAT_WORK_CONFIG.costPerTown;
        cost *= (1 + eraIndex * GREAT_WORK_CONFIG.eraCostScale);
        return Math.round(cost);
    }

    function startGreatWork(work, town, options = {}) {
        if (!work || !town) return null;
        if (!canStartGreatWork(work)) return null;
        if (!meetsGreatWorkUnlocks(work)) return null;

        const title = buildGreatWorkTitle(work, town);
        work.title = title;
        try {
            if (actionables?.process?._projectSubtypes?.[work.subtype]) {
                actionables.process._projectSubtypes[work.subtype].nameTemplate = work.title;
            }
        } catch {}

        const cost = computeGreatWorkCost(town);
        const project = happen("Create", town, null, {
            type: "project",
            subtype: work.subtype,
            cost: cost,
            name: title
        }, "process");

        if (!project) return null;
        project._paultendoGreatWork = true;
        project.greatWorkId = work.id;
        project.workName = title;
        project.eraKey = work.eraKey;

        work.status = "started";
        work.startedDay = planet.day;
        work.projectId = project.id;
        work.townId = town.id;
        work.startedBy = options.autonomous ? "autonomous" : "prompt";

        const prefix = getGreatWorkContextPrefix(work, town);
        logMessage(`${prefix}{{regname:town|${town.id}}} begins construction of the {{b:${title}}}.`, "milestone");
        try {
            recordAnnalsEntry({
                theme: work.theme || "culture",
                title: `${title} Begins`,
                body: `${townRef(town.id)} sets its hands to the ${title}, seeking to shape the era.`,
                sourceType: "great_work_start",
                sourceId: project.id
            });
        } catch {}

        return project;
    }

    function getGreatWorkRegionTowns(town) {
        const ids = new Set();
        if (!town) return [];
        ids.add(town.id);
        const alliance = getTownAlliance(town);
        if (alliance && alliance.members) {
            alliance.members.forEach(id => ids.add(id));
        }
        try {
            const routes = getTownRoutes(town) || [];
            routes.forEach(route => {
                const partner = getRoutePartner(route, town);
                if (partner) ids.add(partner.id);
            });
        } catch {}
        return Array.from(ids)
            .map(id => regGet("town", id))
            .filter(t => t && !t.end);
    }

    function applyGreatWorkCompletion(work, town, process) {
        if (!work || !town) return;
        const region = getGreatWorkRegionTowns(town);

        switch (work.effect) {
            case "library":
                region.forEach(t => happen("Influence", null, t, { education: 0.3, temp: true }));
                if (planet._paultendoDiscovery) {
                    planet._paultendoDiscovery.boost = Math.min(0.03, (planet._paultendoDiscovery.boost || 0) + 0.006);
                    planet._paultendoDiscovery.boostUntil = Math.max(planet._paultendoDiscovery.boostUntil || 0, planet.day + 80);
                }
                break;
            case "observatory":
                region.forEach(t => happen("Influence", null, t, { travel: 0.3, education: 0.2, temp: true }));
                try {
                    const universe = getUniverse(false);
                    if (universe) universe.spaceTech = (universe.spaceTech || 0) + 1;
                } catch {}
                break;
            case "cathedral":
                region.forEach(t => happen("Influence", null, t, { faith: 0.4, happy: 0.2, temp: true }));
                break;
            case "monument":
                region.forEach(t => happen("Influence", null, t, { happy: 0.3, law: 0.2, temp: true }));
                initTownCulture(town);
                town.culture.prestige += 2;
                break;
            case "citadel":
                region.forEach(t => happen("Influence", null, t, { military: 0.3, law: 0.2, temp: true }));
                break;
            case "harbor":
                region.forEach(t => happen("Influence", null, t, { trade: 0.3, travel: 0.2, temp: true }));
                try {
                    const candidates = regFilter("town", t => !t.end && t.id !== town.id && (t.influences?.trade || 0) > 4);
                    if (candidates.length > 0) {
                        const partner = choose(candidates);
                        createTradeRoute(town, partner);
                    }
                } catch {}
                break;
            case "sanctuary":
                region.forEach(t => happen("Influence", null, t, { disease: -0.4, happy: 0.2, temp: true }));
                if (town.activeEpidemic) {
                    town.activeEpidemic.ended = true;
                }
                break;
            case "charter":
                region.forEach(t => happen("Influence", null, t, { law: 0.4, happy: 0.2, temp: true }));
                initUnrest(town);
                town.unrest = Math.max(0, town.unrest - 5);
                break;
            default:
                break;
        }

        try {
            recordHistory("great_work", {
                town: town.id,
                name: work.title,
                eraName: work.eraName,
                subtype: work.templateId
            });
        } catch {}

        try {
            recordAnnalsEntry({
                theme: work.theme || "culture",
                title: `${work.title} Completed`,
                body: `${townRef(town.id)} completes the ${work.title}. The era remembers.`,
                sourceType: "great_work_complete",
                sourceId: work.id
            });
        } catch {}

        if (process && process.marker) {
            const marker = regGet("marker", process.marker);
            if (marker) {
                marker.name = work.title;
                marker.named = true;
                if (work.description) marker.desc = work.description;
            }
        }
    }

    function onEraBegan(era) {
        if (!era) return;
        ensureGreatWorkForEra(era);
    }

    // Player prompt to begin a Great Work
    modEvent("greatWorkProposal", {
        random: true,
        weight: $c.VERY_RARE,
        subject: { reg: "player", id: 1 },
        value: () => {
            if (!planet.currentEra) return false;
            if (planet.day - planet.currentEra.started < 20) return false;
            if (regCount("town") < GREAT_WORK_CONFIG.minTowns) return false;
            initGreatWorks();

            const work = ensureGreatWorkForEra(planet.currentEra);
            if (!work || !canStartGreatWork(work)) return false;
            if (!meetsGreatWorkUnlocks(work)) return false;

            if (planet.day - planet._paultendoGreatWorks.lastProposalDay < GREAT_WORK_CONFIG.proposalCooldown) return false;

            const town = pickGreatWorkLeadTown(work);
            if (!town) return false;

            return { work, town };
        },
        message: (subject, target, args) => {
            const work = args.value.work;
            const town = args.value.town;
            const desc = work.description ? ` ${work.description}` : "";
            const context = getGreatWorkContextPrefix(work, town);
            const note = context ? `${context}the era calls for bold works.` : "";
            return `In ${planet.currentEra.name}, {{regname:town|${town.id}}} proposes the {{b:${work.title}}}.${desc} ${note} Endorse the undertaking? {{should}}`;
        },
        func: (subject, target, args) => {
            const work = args.value.work;
            const town = args.value.town;
            const project = startGreatWork(work, town, { autonomous: false });
        if (project) {
            planet._paultendoGreatWorks.lastProposalDay = planet.day;
        }
        },
        messageDone: () => "Plans are set in motion for the Great Work.",
        messageNo: () => "The proposal is set aside for now.",
        funcNo: (subject, target, args) => {
            const work = args.value?.work;
            if (work) work.declinedDay = planet.day;
            planet._paultendoGreatWorks.lastProposalDay = planet.day;
        }
    });

    // Sometimes towns begin Great Works on their own
    modEvent("greatWorkAutonomousStart", {
        daily: true,
        subject: { reg: "player", id: 1 },
        value: () => {
            if (!planet.currentEra) return false;
            if (planet.day - planet.currentEra.started < 20) return false;
            if (Math.random() > GREAT_WORK_CONFIG.autonomousChance) return false;
            if (regCount("town") < GREAT_WORK_CONFIG.minTowns) return false;
            initGreatWorks();

            const work = ensureGreatWorkForEra(planet.currentEra);
            if (!work || !canStartGreatWork(work)) return false;
            if (!meetsGreatWorkUnlocks(work)) return false;

            const town = pickGreatWorkLeadTown(work);
            if (!town) return false;

            return { work, town };
        },
        func: (subject, target, args) => {
            const work = args.value.work;
            const town = args.value.town;
            const project = startGreatWork(work, town, { autonomous: true });
            if (project) {
                planet._paultendoGreatWorks.lastAutonomousDay = planet.day;
            }
        }
    });

    // Allies and trade partners contribute to Great Works
    modEvent("greatWorkContributions", {
        daily: true,
        subject: { reg: "process", all: true },
        value: (subject) => {
            if (!subject || subject.type !== "project" || subject.done || subject.end) return false;
            if (!isGreatWorkSubtype(subject.subtype)) return false;
            return true;
        },
        func: (subject) => {
            const work = getGreatWorkBySubtype(subject.subtype);
            if (!work) return;
            const town = regGet("town", subject.town);
            if (!town || town.end) return;

            const contributors = getGreatWorkRegionTowns(town).filter(t => t.id !== town.id);
            contributors.forEach(contributor => {
                if (Math.random() > GREAT_WORK_CONFIG.contributionChance) return;
                const cash = contributor.resources?.cash || 0;
                if (cash <= 0) return;
                const trade = contributor.influences?.trade || 0;
                let amount = Math.min(
                    GREAT_WORK_CONFIG.contributionMax,
                    Math.round(GREAT_WORK_CONFIG.contributionBase + trade * 2)
                );
                let multiplier = 1;
                const alliance = getTownAlliance(town);
                const isAlly = alliance && alliance.members.includes(contributor.id);
                if (isAlly) multiplier += 0.4;
                const relation = getRelations(contributor, town);
                if (relation > 6) multiplier += 0.2;
                if (work.theme === "faith") {
                    const townReligion = getTownReligion(town);
                    const contributorReligion = getTownReligion(contributor);
                    if (townReligion && contributorReligion && townReligion.id === contributorReligion.id) {
                        multiplier += 0.2;
                    }
                }
                amount = Math.round(amount * multiplier);
                const contribution = Math.min(amount, cash);
                if (contribution <= 0) return;
                happen("RemoveResource", null, contributor, { type: "cash", count: contribution });
                subject.cost = Math.max(0, Math.round((subject.cost || 0) - contribution));

                if (Math.random() < 0.15) {
                    modLog(
                        "trade",
                        `Support arrives from {{regname:town|${contributor.id}}} to aid the {{b:${work.title}}}.`,
                        null,
                        { town: contributor }
                    );
                }
            });
        }
    });

    // War/peace conditions influence Great Work progress
    modEvent("greatWorkMomentum", {
        daily: true,
        subject: { reg: "process", all: true },
        value: (subject) => {
            if (!subject || subject.type !== "project" || subject.done || subject.end) return false;
            if (!isGreatWorkSubtype(subject.subtype)) return false;
            return true;
        },
        func: (subject) => {
            const town = regGet("town", subject.town);
            if (!town || town.end) return;
            const work = getGreatWorkBySubtype(subject.subtype);
            if (!work) return;

            const atWar = regFilter("process", p =>
                p.type === "war" && !p.done && p.towns?.includes(town.id)
            ).length > 0;

            if (atWar && Math.random() < 0.06) {
                const base = subject.total || subject.cost || 200;
                const penalty = Math.max(8, Math.round(base * 0.03));
                subject.cost = Math.round((subject.cost || 0) + penalty);
                subject.total = Math.max(subject.total || 0, subject.cost);
                if (Math.random() < 0.3) {
                    modLog(
                        "governance",
                        `War pressures slow work on the {{b:${work.title}}} in {{regname:town|${town.id}}}.`,
                        "warning",
                        { town }
                    );
                }
                return;
            }

            if (!atWar && (town.influences?.trade || 0) > 6 && Math.random() < 0.05) {
                const boost = Math.max(6, Math.round((subject.total || 200) * 0.02));
                subject.cost = Math.max(0, Math.round((subject.cost || 0) - boost));
                if (Math.random() < 0.25) {
                    modLog(
                        "trade",
                        `Prosperity accelerates work on the {{b:${work.title}}} in {{regname:town|${town.id}}}.`,
                        null,
                        { town }
                    );
                }
            }
        }
    });

    // Detect Great Work completion to apply extra effects
    modEvent("greatWorkCompletion", {
        daily: true,
        subject: { reg: "process", all: true },
        value: (subject) => {
            if (!subject || subject.type !== "project" || !subject.done) return false;
            if (!isGreatWorkSubtype(subject.subtype)) return false;
            if (subject._paultendoGreatWorkCompleted) return false;
            return true;
        },
        func: (subject) => {
            subject._paultendoGreatWorkCompleted = true;
            const work = getGreatWorkBySubtype(subject.subtype);
            if (work) {
                work.status = "completed";
                work.completedDay = planet.day;
                work.projectId = subject.id;
            }

            const town = regGet("town", subject.town);
            if (town && work) {
                logMessage(`The {{b:${work.title}}} stands completed in {{regname:town|${town.id}}}.`, "milestone");
                applyGreatWorkCompletion(work, town, subject);
            }
        }
    });

    // Recover from abandoned Great Works (town falls or project canceled)
    modEvent("greatWorkRecovery", {
        daily: true,
        subject: { reg: "player", id: 1 },
        func: () => {
            initGreatWorks();
            const works = Object.values(planet._paultendoGreatWorks.works);
            works.forEach(work => {
                if (!work || work.status !== "started") return;
                const process = work.projectId ? regGet("process", work.projectId) : null;
                if (process && !process.end) return;
                work.status = "available";
                work.projectId = null;
                work.declinedDay = planet.day;
                if (work.townId) {
                    logMessage(`Work on the {{b:${work.title}}} falters after hardship in {{regname:town|${work.townId}}}.`, "warning");
                } else {
                    logMessage(`Work on the {{b:${work.title}}} falters.`, "warning");
                }
            });
        }
    });

    // ----------------------------------------
    // LEGENDS & MYTHOLOGY EVENTS
    // ----------------------------------------

    modEvent("mythFormation", {
        daily: true,
        subject: { reg: "player", id: 1 },
        value: (subject, target, args) => {
            if (Math.random() > MYTH_CONFIG.dailyChance) return false;
            const candidate = pickMythCandidate();
            if (!candidate) return false;
            args.candidate = candidate;
            return true;
        },
        func: (subject, target, args) => {
            const candidate = args.candidate;
            let myth = null;
            if (candidate.type === "origin") {
                myth = createOriginMyth(candidate.town);
            } else if (candidate.type === "figure") {
                myth = createFigureLegend(candidate.figure);
            } else if (candidate.type === "history") {
                myth = createHistoryMyth(candidate.entry);
            }

            if (myth && Math.random() < 0.35) {
                const townName = myth.townId ? townRef(myth.townId) : "the world";
                logMessage(`A legend spreads from ${townName}: {{b:${myth.title}}}.`);
            }
        }
    });

    modEvent("mythRetelling", {
        random: true,
        weight: $c.VERY_RARE,
        subject: { reg: "town", random: true },
        value: (subject, target, args) => {
            const myths = getTownMyths(subject);
            if (myths.length === 0) return false;
            args.myth = choose(myths);
            return true;
        },
        func: (subject, target, args) => {
            const myth = args.myth;
            happen("Influence", null, subject, { faith: 0.2, happy: 0.2, temp: true });
            logMessage(`{{regname:town|${subject.id}}} retells the legend of {{b:${myth.title}}}.`);
        }
    });

    // Myth-driven pilgrimages establish routes and boost travel/trade
    modEvent("mythPilgrimageRoute", {
        random: true,
        weight: $c.RARE,
        subject: { reg: "player", id: 1 },
        value: (subject, target, args) => {
            if (!planet.religions || planet.religions.length === 0) return false;
            if ((planet.unlocks?.travel || 0) < 20) return false;
            const season = getSeasonInfo();
            if (season && season.id === "winter" && Math.random() < 0.6) return false;

            const religions = planet.religions.filter(r => !r.extinct && r.followers && r.followers.length >= 2);
            if (religions.length === 0) return false;

            const candidates = religions.map(r => {
                const myths = getReligionMyths(r);
                return { religion: r, myths, weight: 1 + myths.length * 0.6 };
            }).filter(r => r.myths.length > 0);

            if (candidates.length === 0) return false;

            const pick = weightedChoice(candidates, c => c.weight);
            const religion = pick.religion;
            const myth = choose(pick.myths);
            const destination = getMythTown(myth);
            if (!destination || destination.end) return false;

            const followerIds = religion.followers.filter(id => id !== destination.id);
            if (followerIds.length === 0) return false;
            const sources = followerIds.map(id => regGet("town", id)).filter(t => t && !t.end && t.pop >= 20);
            if (sources.length === 0) return false;

            const source = choose(sources);
            if (!source || source.id === destination.id) return false;

            args.religion = religion;
            args.myth = myth;
            args.source = source;
            args.destination = destination;
            ensureTownState(args.source);
            ensureTownState(args.destination);
            return true;
        },
        func: (subject, target, args) => {
            const source = args.source;
            const destination = args.destination;
            const myth = args.myth;

            const existingRoute = getTradeRouteBetween(source, destination);
            const route = existingRoute || createTradeRoute(source, destination);
            if (route) {
                route.purpose = route.purpose || "pilgrimage";
                route.pilgrimage = true;
            }

            const pilgrims = Math.min(4, Math.max(1, Math.floor((source.pop || 0) * 0.02)));
            if (pilgrims > 0) {
                happen("Migrate", source, destination, { count: pilgrims });
                try { markMigration(destination); } catch {}
            }

            happen("Influence", null, source, { travel: 0.4, faith: 0.3, temp: true });
            happen("Influence", null, destination, { trade: 0.3, faith: 0.4, happy: 0.2, temp: true });

            const routeLine = route?.needsShips ? "by sea" : "along well-worn roads";
            logMessage(`Pilgrims from {{regname:town|${source.id}}} journey ${routeLine} to honor {{b:${myth.title}}} in {{regname:town|${destination.id}}}.`);
        }
    });

    // Lore-guided nudges (rare, optional, gentle)
    modEvent("loreGuidance", {
        random: true,
        weight: $c.VERY_RARE,
        subject: { reg: "player", id: 1 },
        value: (subject, target, args) => {
            if (!planet.annals || planet.annals.length === 0) return false;
            initLoreNudges();

            let candidates = planet.annals.filter(entry => {
                if (!isLoreNudgeCandidate(entry)) return false;
                if (entry._paultendoNudgedDay) return false;
                if (planet.day - entry.day > 120) return false;
                return true;
            });

            const focus = getLoreFocusSetting();
            if (focus && focus !== "balanced") {
                const focused = candidates.filter(entry => entry.theme === focus);
                if (focused.length) candidates = focused;
            }

            if (candidates.length === 0) return false;
            const entry = choose(candidates);
            const town = resolveLoreTown(entry);
            if (!town || town.end) return false;
            if (!canReceiveGuidance(town, "loreNudge", 40)) return false;

            const effect = getLoreNudgeEffect(entry);
            if (!effect) return false;

            args.entry = entry;
            args.town = town;
            args.effect = effect;
            return true;
        },
        message: (subject, target, args) => {
            const townName = `{{regname:town|${args.town.id}}}`;
            return `The Lore recalls ${formatLoreTitle(args.entry)}. Perhaps you subtly encourage ${townName} to ${args.effect.label}? {{should}}`;
        },
        func: (subject, target, args) => {
            const town = args.town;
            const effect = args.effect;
            happen("Influence", null, town, { ...effect.influence, temp: true });
            args.entry._paultendoNudgedDay = planet.day;
            noteGuidance(town, "loreNudge", true);
        },
        messageDone: () => "You offer a gentle nudge. The lesson settles.",
        messageNo: () => "You let the lesson rest."
    });

    // ----------------------------------------
    // LIVING FIGURES EVENTS
    // ----------------------------------------

    // Living heroes boost morale during war
    modEvent("heroRallies", {
        random: true,
        weight: $c.UNCOMMON,
        subject: { reg: "town", random: true },
        value: (subject) => {
            // Town at war
            const atWar = regFilter("process", p =>
                p.type === "war" && !p.done && p.towns?.includes(subject.id)
            );
            if (atWar.length === 0) return false;

            // Has living hero or general
            const heroes = getLivingFigures().filter(f =>
                f.hometown === subject.id &&
                (f.type === "HERO" || f.type === "GENERAL")
            );

            return heroes.length > 0;
        },
        func: (subject) => {
            const heroes = getLivingFigures().filter(f =>
                f.hometown === subject.id &&
                (f.type === "HERO" || f.type === "GENERAL")
            );
            const hero = choose(heroes);

            happen("Influence", null, subject, { military: 1, happy: 1, temp: true });

            logMessage(`{{b:${hero.fullTitle}}} rallies {{regname:town|${subject.id}}} for battle!`);
        }
    });

    // Scholars advance learning
    modEvent("scholarAdvances", {
        random: true,
        weight: $c.UNCOMMON,
        subject: { reg: "town", random: true },
        value: (subject) => {
            const scholars = getLivingFigures().filter(f =>
                f.hometown === subject.id && f.type === "SCHOLAR"
            );
            return scholars.length > 0 && (subject.influences?.education || 0) > 6;
        },
        func: (subject) => {
            const scholars = getLivingFigures().filter(f =>
                f.hometown === subject.id && f.type === "SCHOLAR"
            );
            const scholar = choose(scholars);

            happen("Influence", null, subject, { education: 1 });

            // Add deed to scholar
            scholar.deeds.push(`Advanced learning in ${subject.name}`);

            // Record as cultural achievement
            recordHistory(HISTORY_TYPES.CULTURAL_ACHIEVEMENT, {
                town: subject.id,
                figureId: scholar.id,
                figureName: scholar.name,
                type: "scholarship"
            });

            if (Math.random() < 0.3) {
                logMessage(`{{b:${scholar.fullTitle}}} makes a breakthrough in {{regname:town|${subject.id}}}.`);
            }
        }
    });

    // Figures can die of old age
    modEvent("figureAges", {
        daily: true,
        subject: { reg: "nature", id: 1 },
        value: () => {
            const living = getLivingFigures();
            return living.length > 0;
        },
        func: () => {
            const living = getLivingFigures();

            for (const figure of living) {
                const age = planet.day - figure.born;

                // Chance of death increases with age
                let deathChance = 0;
                if (age > 200) deathChance = 0.001;
                if (age > 300) deathChance = 0.005;
                if (age > 400) deathChance = 0.01;
                if (age > 500) deathChance = 0.02;

                if (Math.random() < deathChance) {
                    killFigure(figure, "old age", figure.hometown);

                    const town = regGet("town", figure.hometown);
                    if (town && !town.end) {
                        happen("Influence", null, town, { happy: -1, faith: 0.5, temp: true });
                        logMessage(`{{b:${figure.fullTitle}}} of {{regname:town|${town.id}}} passes away after a long life.`, "warning");
                    }
                }
            }
        }
    });

    // Create scholars in academic towns
    modEvent("scholarEmerges", {
        random: true,
        weight: $c.RARE,
        subject: { reg: "town", random: true },
        value: (subject) => {
            if (!hasTownSpecialization(subject, "academy")) return false;
            if ((subject.influences?.education || 0) < 6) return false;

            // Limit scholars per town
            const existingScholars = getTownFigures(subject.id, true).filter(f => f.type === "SCHOLAR");
            return existingScholars.length < 2;
        },
        func: (subject) => {
            const scholar = createFigure("SCHOLAR", {
                town: subject.id,
                deeds: [`Studied at the academy of ${subject.name}`]
            });

            logMessage(`{{b:${scholar.fullTitle}}} rises to prominence in {{regname:town|${subject.id}}}.`);

            happen("Influence", null, subject, { education: 0.5 });
        }
    });

    // Create artists in cultural towns
    modEvent("artistEmerges", {
        random: true,
        weight: $c.RARE,
        subject: { reg: "town", random: true },
        value: (subject) => {
            initTownCulture(subject);
            if ((subject.culture?.prestige || 0) < 10) return false;
            if (!hasTradition(subject, "art") && !hasTradition(subject, "music")) return false;

            const existingArtists = getTownFigures(subject.id, true).filter(f => f.type === "ARTIST");
            return existingArtists.length < 2;
        },
        func: (subject) => {
            const artist = createFigure("ARTIST", {
                town: subject.id,
                deeds: [`Created masterworks in ${subject.name}`]
            });

            recordHistory(HISTORY_TYPES.CULTURAL_ACHIEVEMENT, {
                town: subject.id,
                figureId: artist.id,
                figureName: artist.name,
                type: "art"
            });

            logArtMessage(subject, `{{b:${artist.fullTitle}}} becomes renowned in {{regname:town|${subject.id}}}.`);

            subject.culture.prestige += 2;
        }
    });

    // ========================================
    // CLIMATE & ENVIRONMENT SYSTEM
    // ========================================
    // Subtle environmental changes over time based on civilization activity
    // Climate affects trade, disease, agriculture, and migration

    // ----------------------------------------
    // CLIMATE HELPER FUNCTIONS
    // ----------------------------------------

    // Get the average climate for a town's territory
    function getTownClimate(town) {
        const chunks = filterChunks(c => c.v.s === town.id);
        if (chunks.length === 0) return { temp: 0.5, moisture: 0.5 };

        let totalTemp = 0;
        let totalMoisture = 0;

        chunks.forEach(c => {
            totalTemp += c.t || 0.5;
            totalMoisture += c.m || 0.5;
        });

        return {
            temp: totalTemp / chunks.length,
            moisture: totalMoisture / chunks.length
        };
    }

    function getGreatWorkContextPrefix(work, town) {
        if (!work) return "";
        const wars = regFilter("process", p => p.type === "war" && !p.done);
        const epidemics = planet.epidemics && planet.epidemics.length ? planet.epidemics.length : 0;
        const alliances = planet.alliances && planet.alliances.length ? planet.alliances.length : 0;
        const routes = planet.tradeRoutes && planet.tradeRoutes.length ? planet.tradeRoutes.length : 0;

        if (wars.length && work.effect === "citadel") return "With war on the horizon, ";
        if (epidemics && work.effect === "sanctuary") return "As sickness spreads, ";
        if (alliances >= 2 && (work.effect === "monument" || work.effect === "charter")) return "In an age of alliances, ";
        if (routes >= 3 && work.effect === "harbor") return "With trade booming, ";
        if (work.effect === "library" && (planet.unlocks?.education || 0) > 20) return "As learning deepens, ";
        if (work.effect === "observatory" && (planet.unlocks?.travel || 0) > 30) return "As horizons widen, ";
        if (work.effect === "cathedral" && town && (town.influences?.faith || 0) > 4) return "With faith ascendant, ";
        return "";
    }

    // Climate descriptors for flavor text
    function getClimateDescription(temp, moisture) {
        let tempDesc = "";
        let moistDesc = "";

        if (temp < 0.3) tempDesc = "frigid";
        else if (temp < 0.45) tempDesc = "cold";
        else if (temp < 0.55) tempDesc = "temperate";
        else if (temp < 0.7) tempDesc = "warm";
        else tempDesc = "hot";

        if (moisture < 0.3) moistDesc = "arid";
        else if (moisture < 0.45) moistDesc = "dry";
        else if (moisture < 0.55) moistDesc = "moderate";
        else if (moisture < 0.7) moistDesc = "humid";
        else moistDesc = "wet";

        return { tempDesc, moistDesc, full: `${tempDesc} and ${moistDesc}` };
    }

    // Check if a chunk is near water
    function isCoastal(chunk) {
        return chunkIsNearby(chunk.x, chunk.y, c => c.b === "water", 2);
    }

    // Check if a town has coastal territory
    function isTownCoastal(town) {
        const chunks = filterChunks(c => c.v.s === town.id);
        return chunks.some(c => isCoastal(c));
    }

    // Get terrain difficulty for travel/trade
    function getTerrainDifficulty(chunk) {
        let difficulty = 1.0;

        // Biome modifiers
        const biome = chunk.b;
        if (biome === "mountain") difficulty = 3.0;
        else if (biome === "wetland") difficulty = 1.8;
        else if (biome === "desert") difficulty = 1.6;
        else if (biome === "snow") difficulty = 1.7;
        else if (biome === "tundra") difficulty = 1.4;
        else if (biome === "badlands") difficulty = 1.5;
        // grass is baseline 1.0

        // Temperature extremes make travel harder
        const temp = chunk.t || 0.5;
        if (temp < 0.2 || temp > 0.8) difficulty *= 1.2;

        // Very low moisture (desert conditions) is harder
        const moisture = chunk.m || 0.5;
        if (moisture < 0.25) difficulty *= 1.15;

        return difficulty;
    }

    // ----------------------------------------
    // TRADE ROUTES SYSTEM
    // ----------------------------------------

    // Initialize trade routes on planet
    function initTradeRoutes() {
        if (!planet.tradeRoutes) {
            planet.tradeRoutes = [];
        }
    }

    // Calculate path difficulty between two towns
    function calculateRouteDifficulty(town1, town2) {
        // Simple distance-based calculation with terrain sampling
        const dx = (town1.x || 0) - (town2.x || 0);
        const dy = (town1.y || 0) - (town2.y || 0);
        const distance = Math.sqrt(dx * dx + dy * dy);

        // Sample chunks along the route
        let totalDifficulty = 0;
        let samples = Math.max(3, Math.floor(distance / 10));
        let waterCrossings = 0;

        for (let i = 0; i <= samples; i++) {
            const t = i / samples;
            const x = Math.floor((town1.x || 0) + t * dx);
            const y = Math.floor((town1.y || 0) + t * dy);
            const chunkX = Math.floor(x / (planet.chunkSize || 4));
            const chunkY = Math.floor(y / (planet.chunkSize || 4));
            const chunk = planet.chunks[chunkX + "," + chunkY];

            if (chunk) {
                if (chunk.b === "water") {
                    waterCrossings++;
                } else {
                    totalDifficulty += getTerrainDifficulty(chunk);
                }
            }
        }

        const avgDifficulty = totalDifficulty / (samples - waterCrossings + 1);

        return {
            distance: distance,
            difficulty: avgDifficulty,
            waterCrossings: waterCrossings,
            needsShips: waterCrossings > 1,
            baseTravelTime: Math.ceil(distance * avgDifficulty / 10)
        };
    }

    // Create a trade route between two towns
    function createTradeRoute(town1, town2) {
        initTradeRoutes();

        // Check if route already exists
        const existing = planet.tradeRoutes.find(r =>
            (r.town1 === town1.id && r.town2 === town2.id) ||
            (r.town1 === town2.id && r.town2 === town1.id)
        );
        if (existing) return existing;

        const routeInfo = calculateRouteDifficulty(town1, town2);

        const route = {
            id: planet.tradeRoutes.length + 1,
            town1: town1.id,
            town2: town2.id,
            established: planet.day,
            distance: routeInfo.distance,
            difficulty: routeInfo.difficulty,
            needsShips: routeInfo.needsShips,
            travelTime: routeInfo.baseTravelTime,
            active: true,
            caravans: 0,
            totalGoods: 0
        };

        planet.tradeRoutes.push(route);
        return route;
    }

    // Get all routes for a town
    function getTownRoutes(town) {
        initTradeRoutes();
        return planet.tradeRoutes.filter(r =>
            (r.town1 === town.id || r.town2 === town.id) && r.active
        );
    }

    function getTradeRouteBetween(town1, town2) {
        initTradeRoutes();
        if (!town1 || !town2) return null;
        return planet.tradeRoutes.find(r =>
            (r.town1 === town1.id && r.town2 === town2.id) ||
            (r.town1 === town2.id && r.town2 === town1.id)
        );
    }

    // Get trade partner from a route
    function getRoutePartner(route, town) {
        if (route.town1 === town.id) return regGet("town", route.town2);
        if (route.town2 === town.id) return regGet("town", route.town1);
        return null;
    }

    function initTradeBrowserExtra() {
        if (typeof regBrowserExtra === "undefined") return;
        if (window._paultendoTradeBrowserExtra) return;
        window._paultendoTradeBrowserExtra = true;

        if (typeof regBrowserKeys === "undefined") regBrowserKeys = {};
        if (typeof regBrowserValues === "undefined") regBrowserValues = {};

        if (!regBrowserKeys.trade_) regBrowserKeys.trade_ = "Trade";
        if (!regBrowserKeys.trade_routes) regBrowserKeys.trade_routes = "Routes";
        if (!regBrowserKeys.trade_embargoes) regBrowserKeys.trade_embargoes = "Embargoes";
        if (!regBrowserKeys.trade_loans) regBrowserKeys.trade_loans = "Loans";
        if (!regBrowserKeys.trade_space) regBrowserKeys.trade_space = "Space Links";
        if (!regBrowserKeys.trade_goods) regBrowserKeys.trade_goods = "Goods Moved";
        if (!regBrowserKeys.trade_cash) regBrowserKeys.trade_cash = "Cash";
        if (!regBrowserKeys.trade_wealth) regBrowserKeys.trade_wealth = "Wealth";

        if (!regBrowserValues.trade_cash) {
            regBrowserValues.trade_cash = (value, town) => `{{currency:${town.id}}}{{num:${Math.round(value)}|K}}`;
        }
        if (!regBrowserValues.trade_wealth) {
            regBrowserValues.trade_wealth = (value, town) => `{{currency:${town.id}}}{{num:${Math.round(value)}|K}}`;
        }

        if (!regBrowserExtra.town) regBrowserExtra.town = {};
        if (regBrowserExtra.town._paultendoTradeExtra) return;
        regBrowserExtra.town._paultendoTradeExtra = true;

        regBrowserExtra.town.trade_ = (town) => {
            if (!town || town.end) return;
            const data = {};

            if (planet.tradeRoutes && planet.tradeRoutes.length) {
                const routes = planet.tradeRoutes.filter(r =>
                    (r.town1 === town.id || r.town2 === town.id)
                );
                if (routes.length) {
                    const active = routes.filter(r => r.active !== false).length;
                    data.trade_routes = active === routes.length
                        ? `${active}`
                        : `${active} active / ${routes.length}`;
                    const goods = routes.reduce((sum, r) => sum + (r.totalGoods || 0), 0);
                    if (goods > 0) data.trade_goods = Math.round(goods);
                }
            }

            if (planet.embargoes && planet.embargoes.length) {
                const outgoing = planet.embargoes.filter(e => e.fromId === town.id).length;
                const incoming = planet.embargoes.filter(e => e.toId === town.id).length;
                const total = outgoing + incoming;
                if (total > 0) {
                    data.trade_embargoes = (outgoing && incoming)
                        ? `${total} (${outgoing} out / ${incoming} in)`
                        : `${total}`;
                }
            }

            if (planet.loans && planet.loans.length) {
                const owed = getLoansFor(town).length;
                const owedTo = getLoansFrom(town).length;
                if (owed || owedTo) {
                    data.trade_loans = (owed && owedTo)
                        ? `${owed} owed / ${owedTo} lent`
                        : (owed ? `${owed} owed` : `${owedTo} lent`);
                }
            }

            const universe = getUniverse(false);
            if (universe && Array.isArray(universe.spaceRoutes)) {
                const currentWorld = getCurrentWorldId();
                const spaceLinks = universe.spaceRoutes.filter(route =>
                    route &&
                    route.active &&
                    ((route.from.worldId === currentWorld && route.from.townId === town.id) ||
                     (route.to.worldId === currentWorld && route.to.townId === town.id))
                ).length;
                if (spaceLinks > 0) data.trade_space = spaceLinks;
            }

            if (town.resources && town.resources.cash) data.trade_cash = town.resources.cash;
            if (town.wealth) data.trade_wealth = town.wealth;

            return Object.keys(data).length ? data : undefined;
        };
    }

    try { initTradeBrowserExtra(); } catch {}

    // ----------------------------------------
    // TRADE ROUTE EVENTS
    // ----------------------------------------

    // Establish new trade routes between nearby prosperous towns
    modEvent("establishTradeRoute", {
        random: true,
        weight: $c.UNCOMMON,
        subject: { reg: "town", random: true },
        target: { reg: "town", nearby: true },
        check: (subject, target) => {
            if (!subject || !target) return false;
            if (subject.id === target.id) return false;

            // Need basic trade infrastructure
            if ((planet.unlocks?.trade || 0) < 20) return false;

            // Both towns need some trade influence
            if ((subject.influences?.trade || 0) < 5) return false;
            if ((target.influences?.trade || 0) < 5) return false;

            // Not at war
            if (areAtWar(subject, target)) return false;

            // Check if route already exists
            initTradeRoutes();
            const existing = planet.tradeRoutes.find(r =>
                (r.town1 === subject.id && r.town2 === target.id) ||
                (r.town1 === target.id && r.town2 === subject.id)
            );
            if (existing) return false;

            return true;
        },
        message: (subject, target) => {
            return `Merchants from {{regname:town|${subject.id}}} propose establishing a formal trade route with {{regname:town|${target.id}}}. {{should}}`;
        },
        messageDone: "A trade route is established between the two settlements.",
        messageNo: "Trade continues informally, without official routes.",
        func: (subject, target) => {
            const route = createTradeRoute(subject, target);

            // Log based on route difficulty
            if (route.needsShips) {
                modLog(
                    "trade",
                    `A sea trade route connects {{regname:town|${subject.id}}} and {{regname:town|${target.id}}}.`,
                    null,
                    { town: subject }
                );
            } else if (route.difficulty > 1.5) {
                modLog(
                    "trade",
                    `A challenging trade route through difficult terrain links {{regname:town|${subject.id}}} and {{regname:town|${target.id}}}.`,
                    null,
                    { town: subject }
                );
            }

            // Initial trade boost
            happen("Influence", null, subject, { trade: 0.5, temp: true });
            happen("Influence", null, target, { trade: 0.5, temp: true });

            // Record as a bond if history system is active
            if (typeof recordBond === "function") {
                recordBond(subject, target, "trade_partners", 10);
            }
        }
    });

    // Caravans travel along trade routes
    modEvent("caravanDeparts", {
        random: true,
        weight: $c.COMMON,
        subject: { reg: "town", random: true },
        value: (subject) => {
            const routes = getTownRoutes(subject);
            if (routes.length === 0) return null;

            // Pick a random active route
            const route = choose(routes);
            return route;
        },
        check: (subject, _, args) => {
            if (!args.value) return false;

            // Need resources to trade
            if ((subject.influences?.trade || 0) < 3) return false;

            return true;
        },
        func: (subject, _, args) => {
            const route = args.value;
            const partner = getRoutePartner(route, subject);
            if (!partner) return;

            route.caravans++;

            // Calculate goods based on route difficulty and town prosperity
            const prosperity = (subject.influences?.trade || 0) + (subject.influences?.farm || 0);
            const goods = Math.max(1, Math.floor(prosperity / route.difficulty));
            route.totalGoods += goods;

            // Climate affects caravan success
            const climate = getTownClimate(subject);
            let successChance = 0.85;

            // Extreme temperatures reduce success
            if (climate.temp < 0.25 || climate.temp > 0.75) {
                successChance -= 0.1;
            }

            // Low moisture (desert crossing) is risky
            if (climate.moisture < 0.3) {
                successChance -= 0.1;
            }

            // Route difficulty
            successChance -= (route.difficulty - 1) * 0.05;

            if (Math.random() < successChance) {
                // Successful trade
                happen("Influence", null, subject, { trade: 0.2, temp: true });
                happen("Influence", null, partner, { trade: 0.2, temp: true });

                // Occasional notable trade
                if (Math.random() < 0.1) {
                    modLog(
                        "trade",
                        `A prosperous caravan arrives in {{regname:town|${partner.id}}} from {{regname:town|${subject.id}}}.`,
                        null,
                        { town: subject }
                    );
                }
            } else {
                // Caravan lost or delayed
                if (Math.random() < 0.3) {
                    logMessage(`A caravan from {{regname:town|${subject.id}}} is lost in the ${getClimateDescription(climate.temp, climate.moisture).full} conditions.`, "warning");
                }
            }
        }
    });

    // Trade routes can be disrupted by war
    modEvent("tradeRouteDisrupted", {
        daily: true,
        subject: { reg: "town", all: true },
        func: (subject) => {
            const routes = getTownRoutes(subject);

            routes.forEach(route => {
                const partner = getRoutePartner(route, subject);
                if (!partner) return;

                // War disrupts trade
                if (areAtWar(subject, partner)) {
                    if (route.active) {
                        route.active = false;
                        logMessage(`War disrupts the trade route between {{regname:town|${subject.id}}} and {{regname:town|${partner.id}}}.`, "warning");
                        happen("Influence", null, subject, { trade: -0.4, temp: true });
                        happen("Influence", null, partner, { trade: -0.4, temp: true });
                    }
                } else if (!route.active) {
                    // Restore after peace (with some delay)
                    if (Math.random() < 0.05) {
                        route.active = true;
                        modLog(
                            "trade",
                            `Trade resumes between {{regname:town|${subject.id}}} and {{regname:town|${partner.id}}}.`,
                            null,
                            { town: subject }
                        );
                        happen("Influence", null, subject, { trade: 0.2, temp: true });
                        happen("Influence", null, partner, { trade: 0.2, temp: true });
                    }
                }
            });
        }
    });

    // Major trade hub emerges
    modEvent("tradeHubEmerges", {
        random: true,
        weight: $c.RARE,
        subject: { reg: "town", random: true },
        check: (subject) => {
            const routes = getTownRoutes(subject);

            // Need multiple active routes
            if (routes.length < 3) return false;

            // And significant trade
            if ((subject.influences?.trade || 0) < 7) return false;

            // Not already a trade hub
            if (hasSpecialization(subject, "tradingHub")) return false;

            return true;
        },
        message: (subject) => {
            return `{{regname:town|${subject.id}}} has become a crossroads of commerce. Merchants propose formalizing it as a major trade hub. {{should}}`;
        },
        messageDone: "The settlement becomes renowned as a center of trade.",
        messageNo: "Trade continues without formal recognition.",
        func: (subject) => {
            addSpecialization(subject, "tradingHub");
            logMessage(`{{regname:town|${subject.id}}} becomes a renowned trade hub.`, "milestone");

            // Create figure: famous merchant
            if (typeof createFigure === "function") {
                createFigure("SCHOLAR", {
                    town: subject.id,
                    deeds: ["established great trade networks", "brought prosperity through commerce"]
                });
            }
        }
    });

    // ----------------------------------------
    // CLIMATE EFFECTS ON EXISTING SYSTEMS
    // ----------------------------------------

    // Climate affects disease spread
    modEvent("climateDisease", {
        random: true,
        weight: $c.UNCOMMON,
        subject: { reg: "town", random: true },
        check: (subject) => {
            const climate = getTownClimate(subject);

            // Hot and wet = disease breeding ground
            if (climate.temp > 0.65 && climate.moisture > 0.7) {
                return Math.random() < 0.3;
            }

            // Wetlands are particularly risky
            const chunks = filterChunks(c => c.v.s === subject.id);
            const wetlandChunks = chunks.filter(c => c.b === "wetland");
            if (wetlandChunks.length > chunks.length * 0.3) {
                return Math.random() < 0.2;
            }

            return false;
        },
        message: (subject) => {
            const climate = getTownClimate(subject);
            const desc = getClimateDescription(climate.temp, climate.moisture);
            return `The ${desc.full} conditions around {{regname:town|${subject.id}}} breed illness. Healers urge preventive measures. {{should}}`;
        },
        messageDone: "Efforts are made to combat the spread of disease.",
        messageNo: "The people trust their natural resilience.",
        influences: { disease: 1.5 },
        influencesNo: { disease: 2.5 },
        func: (subject) => {
            const climate = getTownClimate(subject);
            const desc = getClimateDescription(climate.temp, climate.moisture);
            logMessage(`The ${desc.full} climate of {{regname:town|${subject.id}}} challenges public health.`);
        }
    });

    // Cold climates affect happiness in winter (simulated by random checks)
    modEvent("coldHardship", {
        random: true,
        weight: $c.UNCOMMON,
        subject: { reg: "town", random: true },
        check: (subject) => {
            const climate = getTownClimate(subject);

            // Cold climates
            if (climate.temp < 0.35) {
                // Worse if low on resources
                const farmLevel = subject.influences?.farm || 0;
                if (farmLevel < 10) return Math.random() < 0.4;
                return Math.random() < 0.15;
            }

            return false;
        },
        message: (subject) => {
            return `The bitter cold tests {{regname:town|${subject.id}}}. Extra provisions could ease the hardship. {{should}}`;
        },
        messageDone: "The settlement weathers the cold season.",
        messageNo: "The people endure as best they can.",
        influences: { happy: 0.5 },
        influencesNo: { happy: -1, disease: 0.5 }
    });

    // Hot climates can cause heat-related issues
    modEvent("heatWave", {
        random: true,
        weight: $c.UNCOMMON,
        subject: { reg: "town", random: true },
        check: (subject) => {
            const climate = getTownClimate(subject);

            // Hot and dry = heat wave risk
            if (climate.temp > 0.7 && climate.moisture < 0.4) {
                return Math.random() < 0.25;
            }

            return false;
        },
        message: (subject) => {
            return `A scorching heat wave strikes {{regname:town|${subject.id}}}. Water must be rationed carefully. {{should}}`;
        },
        messageDone: "The settlement survives the heat.",
        messageNo: "The people suffer through without intervention.",
        influences: { farm: -0.5 },
        influencesNo: { farm: -1.5, happy: -1 },
        func: (subject, _, args) => {
            if (args.choice === "no") {
                // Chance of deaths in severe cases
                if (Math.random() < 0.2) {
                    const deaths = Math.floor(Math.random() * 3) + 1;
                    happen("Death", null, subject, { count: deaths, cause: "heat" });
                }
            }
        }
    });

    // Climate affects migration attractiveness (hook into existing migration)
    // Extreme climates are less attractive for migrants
    const originalGetTownAttractiveness = typeof getTownAttractiveness === "function" ? getTownAttractiveness : null;
    if (originalGetTownAttractiveness) {
        getTownAttractiveness = function(town) {
            let score = originalGetTownAttractiveness(town);

            const climate = getTownClimate(town);

            // Temperate climates are more attractive
            const tempDeviation = Math.abs(0.5 - climate.temp);
            score -= tempDeviation * 3; // Extreme temps reduce attractiveness

            // Very dry or very wet is less attractive
            if (climate.moisture < 0.25 || climate.moisture > 0.85) {
                score -= 2;
            }

            return score;
        };
    }

    // ----------------------------------------
    // GRADUAL ENVIRONMENTAL CHANGES
    // ----------------------------------------

    // Track environmental pressure on chunks
    function initEnvironmentalPressure(town) {
        if (!town.environmentalPressure) {
            town.environmentalPressure = {
                deforestation: 0,    // From lumber use
                overfarming: 0,      // From intensive agriculture
                pollution: 0,        // From industry (smith, fire techs)
                irrigation: 0        // Positive - from agricultural tech
            };
        }
    }

    // Daily environmental pressure accumulation
    modEvent("environmentalPressure", {
        daily: true,
        subject: { reg: "town", all: true },
        func: (subject) => {
            initEnvironmentalPressure(subject);

            const pressure = subject.environmentalPressure;
            const pop = subject.pop || 0;
            const size = subject.size || 1;

            // Population density creates pressure
            const density = pop / Math.max(1, size);

            // Lumber use creates deforestation pressure
            const chunks = filterChunks(c => c.v.s === subject.id);
            const forestChunks = chunks.filter(c => biomes[c.b]?.hasLumber);
            if (forestChunks.length > 0 && density > 5) {
                pressure.deforestation += 0.001 * density;
            }

            // High farm influence without agricultural science = overfarming
            const farmLevel = subject.influences?.farm || 0;
            const hasAgriScience = (planet.unlocks?.farm || 0) >= 80;
            if (farmLevel > 6 && !hasAgriScience) {
                pressure.overfarming += 0.0005 * (farmLevel / 6);
            }

            // Industrial techs create pollution
            const smithLevel = planet.unlocks?.smith || 0;
            const fireLevel = planet.unlocks?.fire || 0;
            if (smithLevel > 50 || fireLevel > 50) {
                pressure.pollution += 0.0002 * ((smithLevel + fireLevel) / 100);
            }

            // Agricultural science provides irrigation benefits
            if (hasAgriScience && farmLevel > 7) {
                pressure.irrigation += 0.001;
                // Irrigation counters overfarming
                pressure.overfarming = Math.max(0, pressure.overfarming - 0.0003);
            }

            // Cap pressures
            pressure.deforestation = Math.min(1, pressure.deforestation);
            pressure.overfarming = Math.min(1, pressure.overfarming);
            pressure.pollution = Math.min(1, pressure.pollution);
            pressure.irrigation = Math.min(1, pressure.irrigation);

            // Natural recovery (very slow)
            if (density < 3) {
                pressure.deforestation = Math.max(0, pressure.deforestation - 0.0001);
                pressure.overfarming = Math.max(0, pressure.overfarming - 0.0001);
            }
        }
    });

    // Environmental degradation events (rare, subtle changes)
    modEvent("localDeforestation", {
        random: true,
        weight: $c.VERY_RARE,
        subject: { reg: "town", random: true },
        check: (subject) => {
            initEnvironmentalPressure(subject);
            return subject.environmentalPressure.deforestation > 0.5;
        },
        message: (subject) => {
            return `The forests around {{regname:town|${subject.id}}} are thinning. Some urge replanting efforts. {{should}}`;
        },
        messageDone: "Trees are planted to restore the woodland.",
        messageNo: "The demand for lumber continues unabated.",
        func: (subject, _, args) => {
            if (args.choice === "yes") {
                subject.environmentalPressure.deforestation -= 0.2;
                happen("Influence", null, subject, { happy: 0.5 });
            } else {
                // Subtle moisture reduction in one chunk
                const chunks = filterChunks(c => c.v.s === subject.id && biomes[c.b]?.hasLumber);
                if (chunks.length > 0) {
                    const chunk = choose(chunks);
                    // Very subtle change - reduce moisture slightly
                    chunk.m = Math.max(0.2, (chunk.m || 0.5) - 0.05);
                    subject.environmentalPressure.deforestation -= 0.1;
                }
            }
        }
    });

    // Soil exhaustion from overfarming
    modEvent("soilExhaustion", {
        random: true,
        weight: $c.VERY_RARE,
        subject: { reg: "town", random: true },
        check: (subject) => {
            initEnvironmentalPressure(subject);
            return subject.environmentalPressure.overfarming > 0.6;
        },
        message: (subject) => {
            return `The soil around {{regname:town|${subject.id}}} grows less fertile. Farmers urge letting fields lie fallow. {{should}}`;
        },
        messageDone: "Fields are rotated to restore the soil.",
        messageNo: "Every plot must produce to feed the people.",
        influences: { farm: -1 },
        influencesNo: { farm: -0.5 },
        func: (subject, _, args) => {
            if (args.choice === "yes") {
                subject.environmentalPressure.overfarming -= 0.3;
            } else {
                // Subtle fertility reduction
                const chunks = filterChunks(c => c.v.s === subject.id && !biomes[c.b]?.infertile);
                if (chunks.length > 0) {
                    const chunk = choose(chunks);
                    // Reduce moisture slightly (affects fertility calculation)
                    chunk.m = Math.max(0.3, (chunk.m || 0.5) - 0.03);
                }
            }
        }
    });

    // Desertification (extreme case, very rare)
    modEvent("desertificationRisk", {
        random: true,
        weight: $c.VERY_RARE * 0.5, // Even rarer
        subject: { reg: "town", random: true },
        check: (subject) => {
            initEnvironmentalPressure(subject);
            const pressure = subject.environmentalPressure;

            // Need both deforestation and overfarming
            if (pressure.deforestation < 0.7 || pressure.overfarming < 0.7) return false;

            // Must be in a vulnerable biome (not already desert, not wet)
            const climate = getTownClimate(subject);
            if (climate.moisture > 0.5) return false;

            return true;
        },
        message: (subject) => {
            return `The land around {{regname:town|${subject.id}}} shows signs of turning to dust. Drastic measures may be needed. {{should}}`;
        },
        messageDone: "Major efforts begin to restore the land.",
        messageNo: "The land must provide, whatever the cost.",
        func: (subject, _, args) => {
            if (args.choice === "yes") {
                subject.environmentalPressure.deforestation -= 0.4;
                subject.environmentalPressure.overfarming -= 0.4;
                happen("Influence", null, subject, { farm: -2, happy: -1 });
                logMessage(`{{regname:town|${subject.id}}} begins land restoration efforts.`);
            } else {
                // One chunk shifts toward badlands
                const chunks = filterChunks(c => c.v.s === subject.id && c.b === "grass");
                if (chunks.length > 0) {
                    const chunk = choose(chunks);
                    chunk.b = "badlands";
                    chunk.m = Math.max(0.2, (chunk.m || 0.5) - 0.1);
                    logMessage(`The land around {{regname:town|${subject.id}}} grows barren.`, "warning");

                    // Record in history
                    if (typeof recordHistory === "function") {
                        recordHistory("ENVIRONMENTAL", {
                            town: subject.id,
                            type: "desertification",
                            description: "fertile land turned to badlands"
                        });
                    }
                }
            }
        }
    });

    // Irrigation improves local conditions
    modEvent("irrigationSuccess", {
        random: true,
        weight: $c.RARE,
        subject: { reg: "town", random: true },
        check: (subject) => {
            initEnvironmentalPressure(subject);

            // Need irrigation pressure built up
            if (subject.environmentalPressure.irrigation < 0.5) return false;

            // And agricultural science
            if ((planet.unlocks?.farm || 0) < 80) return false;

            // Must have dry land to improve
            const climate = getTownClimate(subject);
            return climate.moisture < 0.45;
        },
        message: (subject) => {
            return `Irrigation projects around {{regname:town|${subject.id}}} could make the land more fertile. {{should}}`;
        },
        messageDone: "Canals and wells bring water to thirsty fields.",
        messageNo: "The land remains as nature made it.",
        func: (subject) => {
            // Improve moisture in dry chunks
            const chunks = filterChunks(c => c.v.s === subject.id && (c.m || 0.5) < 0.5);
            const toImprove = chunks.slice(0, 3); // Improve up to 3 chunks

            toImprove.forEach(chunk => {
                chunk.m = Math.min(0.7, (chunk.m || 0.5) + 0.1);
            });

            if (toImprove.length > 0) {
                happen("Influence", null, subject, { farm: 2, happy: 1 });
                logMessage(`Irrigation transforms the land around {{regname:town|${subject.id}}}.`, "milestone");

                subject.environmentalPressure.irrigation -= 0.3;
            }
        }
    });

    // Pollution affects nearby areas (industrial era)
    modEvent("industrialPollution", {
        random: true,
        weight: $c.RARE,
        subject: { reg: "town", random: true },
        check: (subject) => {
            initEnvironmentalPressure(subject);

            // Need significant pollution
            if (subject.environmentalPressure.pollution < 0.4) return false;

            // Industrial techs present
            return (planet.unlocks?.smith || 0) >= 60 || (planet.unlocks?.fire || 0) >= 60;
        },
        message: (subject) => {
            return `Smoke and waste from {{regname:town|${subject.id}}} darken the skies. Some call for cleaner methods. {{should}}`;
        },
        messageDone: "Efforts are made to reduce pollution.",
        messageNo: "Progress has its costs.",
        influences: { happy: 0.5, disease: -0.5 },
        influencesNo: { disease: 1, happy: -0.5 },
        func: (subject, _, args) => {
            if (args.choice === "yes") {
                subject.environmentalPressure.pollution -= 0.2;
            } else {
                // Pollution can spread to nearby chunks (very subtle)
                const chunks = filterChunks(c => c.v.s === subject.id);
                if (chunks.length > 0) {
                    const chunk = choose(chunks);
                    // Slight temperature increase (urban heat island effect)
                    chunk.t = Math.min(0.9, (chunk.t || 0.5) + 0.02);
                }
            }
        }
    });

    // ----------------------------------------
    // COASTAL & MARITIME TRADE
    // ----------------------------------------

    // Coastal towns can establish sea trade routes
    modEvent("establishSeaRoute", {
        random: true,
        weight: $c.UNCOMMON,
        subject: { reg: "town", random: true },
        target: { reg: "town", random: true },
        check: (subject, target) => {
            if (!subject || !target) return false;
            if (subject.id === target.id) return false;

            // Both must be coastal
            if (!isTownCoastal(subject) || !isTownCoastal(target)) return false;

            // Need sailing ships tech
            if ((planet.unlocks?.travel || 0) < 60) return false;

            // Both need trade
            if ((subject.influences?.trade || 0) < 10) return false;
            if ((target.influences?.trade || 0) < 10) return false;

            // Not at war
            if (areAtWar(subject, target)) return false;

            // Check if route already exists
            initTradeRoutes();
            const existing = planet.tradeRoutes.find(r =>
                (r.town1 === subject.id && r.town2 === target.id) ||
                (r.town1 === target.id && r.town2 === subject.id)
            );
            if (existing) return false;

            return true;
        },
        message: (subject, target) => {
            return `Sailors from {{regname:town|${subject.id}}} propose a sea trade route to {{regname:town|${target.id}}}. {{should}}`;
        },
        messageDone: "Ships begin sailing between the two ports.",
        messageNo: "The seas remain uncrossed.",
        func: (subject, target) => {
            initTradeRoutes();

            const route = {
                id: planet.tradeRoutes.length + 1,
                town1: subject.id,
                town2: target.id,
                established: planet.day,
                distance: 50, // Sea routes have fixed "distance"
                difficulty: 1.2, // Moderate difficulty
                needsShips: true,
                isSeaRoute: true,
                travelTime: 10,
                active: true,
                caravans: 0,
                totalGoods: 0
            };

            planet.tradeRoutes.push(route);

            logMessage(`A sea route connects {{regname:town|${subject.id}}} and {{regname:town|${target.id}}}.`, "milestone");

            happen("Influence", null, subject, { trade: 1, travel: 0.5, temp: true });
            happen("Influence", null, target, { trade: 1, travel: 0.5, temp: true });

            if (typeof recordBond === "function") {
                recordBond(subject, target, "maritime_partners", 15);
            }
        }
    });

    // Coastal towns benefit from fishing
    modEvent("coastalFishing", {
        random: true,
        weight: $c.COMMON,
        subject: { reg: "town", random: true },
        check: (subject) => {
            return isTownCoastal(subject);
        },
        func: (subject) => {
            // Small steady food bonus for coastal towns
            if (Math.random() < 0.2) {
                happen("Influence", null, subject, { farm: 0.1, temp: true });
            }
        }
    });

    // ----------------------------------------
    // CLIMATE-AWARE RESOURCE DISTRIBUTION
    // ----------------------------------------

    // Certain goods are only available in certain climates
    // This affects trade value
    modEvent("climateTradeGoods", {
        random: true,
        weight: $c.COMMON,
        subject: { reg: "town", random: true },
        check: (subject) => {
            const routes = getTownRoutes(subject);
            return routes.length > 0;
        },
        func: (subject) => {
            const climate = getTownClimate(subject);
            const routes = getTownRoutes(subject);

            routes.forEach(route => {
                const partner = getRoutePartner(route, subject);
                if (!partner) return;

                const partnerClimate = getTownClimate(partner);

                // Different climates = more valuable trade
                const tempDiff = Math.abs(climate.temp - partnerClimate.temp);
                const moistDiff = Math.abs(climate.moisture - partnerClimate.moisture);
                const climateDiff = tempDiff + moistDiff;

                if (climateDiff > 0.3) {
                    // Significant climate difference = exotic goods trade
                    if (Math.random() < 0.1) {
                        happen("Influence", null, subject, { trade: 0.3, happy: 0.1, temp: true });
                        happen("Influence", null, partner, { trade: 0.3, happy: 0.1, temp: true });

                        // Occasional flavor message
                        if (Math.random() < 0.2) {
                            const goods = climate.temp > partnerClimate.temp ?
                                "spices and exotic fruits" : "furs and preserved meats";
                            modLog(
                                "trade",
                                `Merchants bring ${goods} from {{regname:town|${subject.id}}} to {{regname:town|${partner.id}}}.`,
                                null,
                                { town: subject }
                            );
                        }
                    }
                }
            });
        }
    });

    // Resource advantages drive trade or conflict
    modEvent("resourceDrivenTensions", {
        random: true,
        weight: $c.UNCOMMON,
        subject: { reg: "town", random: true },
        value: (subject, target, args) => {
            if (!subject || subject.end) return false;
            const tags = getTownResourceTags(subject);
            if (tags.length === 0) return false;

            const candidates = regFilter("town", t => {
                if (!t || t.end || t.id === subject.id) return false;
                const otherTags = getTownResourceTags(t);
                if (otherTags.length === 0) return false;
                const shared = tags.filter(tag => otherTags.includes(tag));
                return shared.length < tags.length;
            });
            if (candidates.length === 0) return false;

            args.target = choose(candidates);
            args.tags = tags;
            return true;
        },
        func: (subject, target, args) => {
            const other = args.target;
            if (!other) return;
            const relation = getRelations(subject, other);
            const tag = choose(args.tags);

            if (relation > 2) {
                // Trade synergy
                const route = createTradeRoute(subject, other);
                happen("Influence", null, subject, { trade: 0.3, temp: true });
                happen("Influence", null, other, { trade: 0.3, temp: true });
                if (Math.random() < 0.3) {
                    modLog(
                        "resource",
                        `Resource exchanges deepen between {{regname:town|${subject.id}}} and {{regname:town|${other.id}}}.`,
                        null,
                        { town: subject }
                    );
                }
                if (route && typeof recordBond === "function") {
                    recordBond(subject, other, "resource_trade", 6);
                }
            } else if (relation < -5) {
                // Competition fuels conflict
                bumpWarPressure(subject, other, 2);
                if (Math.random() < 0.25) {
                    modLog(
                        "resource",
                        `Competition for scarce ${tag} resources strains {{regname:town|${subject.id}}} and {{regname:town|${other.id}}}.`,
                        "warning",
                        { town: subject }
                    );
                }
            }
        }
    });

})();
