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

    const MOD_VERSION = "1.0.2";
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
        const funcFn = typeof data.func === "function" ? data.func : null;

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

                        if (valueFn) {
                            const valueResult = valueFn(s, t, localArgs);
                            if (valueResult === false) continue;
                            if (localArgs.value === undefined && valueResult !== undefined) {
                                localArgs.value = valueResult;
                            }
                        }
                        if (checkFn && !checkFn(s, t, localArgs)) continue;
                        if (funcFn) funcFn(s, t, localArgs);
                    }
                }
            };
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
            if (process && !process.done && process.type === "war") return true;
        }
        const wars = regFilter("process", p =>
            p.type === "war" &&
            !p.done &&
            p.towns &&
            p.towns.includes(town1.id) &&
            p.towns.includes(town2.id)
        );
        return wars.length > 0;
    }

    function startWar(town1, town2) {
        if (!town1 || !town2 || town1.id === town2.id) return false;
        if (areAtWar(town1, town2)) return false;
        const process = happen("Create", town1, null, {
            type: "war",
            towns: [town1.id, town2.id]
        }, "process");
        if (!process) return false;
        ensureIssues(town1);
        ensureIssues(town2);
        town1.issues.war = process.id;
        town2.issues.war = process.id;
        return process;
    }

    function ensureIssues(town) {
        if (town && !town.issues) town.issues = {};
    }

    function hasIssue(town, issueKey) {
        return !!(town && town.issues && town.issues[issueKey]);
    }

    // =========================================================================
    // SWAY MECHANIC
    // Allows player to spread rumors and sow discord between towns
    // =========================================================================

    // Calculate success chance for swaying a town against another
    function calcSwaySuccess(town, targetTown) {
        // Base 40% chance
        let chance = 0.40;

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
        return Math.max(0.05, Math.min(0.95, chance));
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
            args.successChance = Math.max(0.05, Math.min(0.95, args.successChance));
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
            args.successChance = Math.max(0.10, Math.min(0.90, args.successChance));
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
            args.successChance = Math.max(0.05, Math.min(0.95, args.successChance));
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
            args.successChance = Math.max(0.05, Math.min(0.95, args.successChance));
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
            args.successChance = Math.max(0.05, Math.min(0.95, args.successChance));
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
            args.successChance = Math.max(0.05, Math.min(0.95, args.successChance));
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
            args.successChance = Math.max(0.05, Math.min(0.95, args.successChance));
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
            args.successChance = Math.max(0.05, Math.min(0.95, args.successChance));
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
            args.successChance = Math.max(0.05, Math.min(0.95, args.successChance));
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
            args.successChance = Math.max(0.10, Math.min(0.80, args.successChance));
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
            args.successChance = Math.max(0.05, Math.min(0.85, args.successChance));
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

            // Find the enemy (the town in the war that's not the subject)
            const enemyId = warProcess.towns.find(id => id !== subject.id);
            if (!enemyId) return;
            const enemy = regGet("town", enemyId);
            if (!enemy || enemy.end) return;

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
                    if (!warProcess.towns.includes(ally.id)) {
                        warProcess.towns.push(ally.id);
                    }
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
            args.successChance = Math.max(0.10, Math.min(0.90, args.successChance));
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
            args.successChance = Math.max(0.05, Math.min(0.70, args.successChance));
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
        holy_order: "holyOrder"
    };

    function normalizeSpecId(specId) {
        return SPECIALIZATION_ALIASES[specId] || specId;
    }

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
        initTownSpecializations(town);
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
        }
        return true;
    }

    // Remove or decrease a specialization
    function removeSpecialization(town, specId, amount = 1) {
        initTownSpecializations(town);
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
            const defeatedId = subject.towns.find(id => id !== winnerId);
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
            args.successChance = Math.max(0.10, Math.min(0.80, args.successChance));
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
            const victimSpecs = getTownSpecializations(args.victim);
            const stealable = victimSpecs.filter(s => !hasSpecialization(target, s.id));
            args.spec = choose(stealable);

            args.successChance = 0.30;
            // Education helps with stealing knowledge
            args.successChance += (target.influences.education || 0) * 0.05;
            // But victim's education makes it harder
            args.successChance -= (args.victim.influences.education || 0) * 0.03;
            args.successChance = Math.max(0.05, Math.min(0.60, args.successChance));
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
            args.successChance = Math.max(0.20, Math.min(0.90, args.successChance));
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
            args.successChance = Math.max(0.05, Math.min(0.50, args.successChance));
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
            args.successChance = Math.max(0.05, Math.min(0.60, args.successChance));
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
            args.successChance = Math.max(0.05, Math.min(0.50, args.successChance));
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
        const hospitals = regFilter("marker", m => m.town === town.id && m.subtype === "hospital");
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
            spreadRate: epidemicDef.spreadRate
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
    function spreadEpidemicTo(epidemic, town) {
        if (epidemic.affectedTowns.includes(town.id)) return false;

        // Check resistance
        const resistance = getDiseaseResistance(town);
        const spreadChance = epidemic.spreadRate - (resistance * 0.02);

        if (Math.random() > spreadChance) return false;

        epidemic.affectedTowns.push(town.id);
        town.influences.disease = (town.influences.disease || 0) + epidemic.diseaseInfluence;

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
                spreadEpidemicTo(args.epidemic, subject);
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
            args.successChance = Math.max(0.20, Math.min(0.80, args.successChance));
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
            const hospitals = regFilter("marker", m => m.town === subject.id && m.subtype === "hospital");
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

            args.successChance = 0.40;
            args.successChance += (target.influences.education || 0) * 0.05;
            args.successChance += (target.influences.faith || 0) * 0.03;

            // Government type affects it
            const gov = getTownGovernment(target);
            if (gov.id === "democracy" || gov.id === "republic") args.successChance += 0.15;
            if (gov.id === "oligarchy") args.successChance -= 0.15;

            args.successChance = Math.max(0.10, Math.min(0.80, args.successChance));
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
            } else {
                happen("Influence", subject, target, { faith: -1 });
            }
        },
        messageDone: (subject, target, args) => {
            if (args.success) {
                return `{{regname:town|${target.id}}} establishes public healthcare. The sick are tended to.`;
            }
            return `{{residents:${target.id}}} {{c:reject|refuse|won't fund}} public healthcare.`;
        },
        messageNo: () => `Healthcare remains a private matter.`
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

            // Check if they already have a hospital
            const hospitals = regFilter("marker", m => m.town === target.id && m.subtype === "hospital");
            if (hospitals.length > 0) return false;

            // More likely if disease is high
            const disease = target.influences.disease || 0;
            args.successChance = 0.30;
            args.successChance += disease * 0.05;
            args.successChance += (target.influences.faith || 0) * 0.05;
            args.successChance = Math.max(0.15, Math.min(0.75, args.successChance));
            return true;
        },
        message: (subject, target, args) => {
            return `{{regname:town|${target.id}}} lacks a hospital. You could {{c:encourage|suggest|inspire}} them to build one...`;
        },
        func: (subject, target, args) => {
            const success = Math.random() < args.successChance;
            args.success = success;

            if (success) {
                // Create a hospital marker
                // Note: This is a simplified version - the base game has more complex marker creation
                happen("Influence", subject, target, { disease: -2 });
                happen("Influence", subject, target, { faith: 1 });
                logMessage(`{{regname:town|${target.id}}} {{c:builds|establishes|founds}} a hospital.`, "milestone");
            } else {
                happen("Influence", subject, target, { faith: -1 });
            }
        },
        messageDone: (subject, target, args) => {
            if (args.success) {
                return `The sick now have a place to heal.`;
            }
            return `{{residents:${target.id}}} {{c:see no need|refuse|won't prioritize}} a hospital.`;
        },
        messageNo: () => `You leave their health in their own hands.`
    });

    // Sway to train doctors
    modEvent("swayTrainDoctors", {
        random: true,
        weight: $c.UNCOMMON,
        subject: { reg: "player", id: 1 },
        target: { reg: "town", random: true },
        value: (subject, target, args) => {
            if ((target.influences.faith || 0) < -1) return false;
            if (planet.unlocks.education < 40) return false;

            const doctors = target.jobs?.doctor || 0;
            if (doctors >= 5) return false; // Enough doctors

            args.currentDoctors = doctors;
            args.successChance = 0.45;
            args.successChance += (target.influences.education || 0) * 0.05;
            args.successChance += (target.influences.faith || 0) * 0.03;
            args.successChance = Math.max(0.20, Math.min(0.80, args.successChance));
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
            } else {
                happen("Influence", subject, target, { faith: -0.5 });
            }
        },
        messageDone: (subject, target, args) => {
            if (args.success) {
                return `A new healer begins training in {{regname:town|${target.id}}}.`;
            }
            return `{{residents:${target.id}}} {{c:prefer|choose|favor}} other professions.`;
        },
        messageNo: () => `You let them choose their own trades.`
    });

    // =========================================================================
    // CULTURE SYSTEM
    // Towns develop cultural identities, produce art, hold festivals
    // Culture affects happiness, migration, relations, and soft power
    // =========================================================================

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
        initTownCulture(town);
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
        initTownCulture(town);
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
                logMessage(`An artist in {{regname:town|${subject.id}}} creates a {{c:masterpiece|renowned work|celebrated piece}}.`);
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
                    logMessage(`Musicians in {{regname:town|${subject.id}}} establish a {{b:Musical}} tradition.`);
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

                if (Math.random() < 0.1) {
                    const traditions = getTownTraditions(subject);
                    const traditionName = traditions.length > 0 ? traditions[0].name : "rich";
                    logMessage(`Drawn by {{regname:town|${subject.id}}}'s {{b:${traditionName}}} culture, ${migrants} {{c:migrate|move|relocate}} from {{regname:town|${args.source.id}}}.`);
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
            args.successChance = Math.max(0.15, Math.min(0.80, args.successChance));
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
            args.successChance = Math.max(0.20, Math.min(0.90, args.successChance));
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
            args.successChance = Math.max(0.15, Math.min(0.75, args.successChance));
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
            args.successChance = Math.max(0.05, Math.min(0.50, args.successChance));
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

    // Track cultural landmarks (since we can't easily add to the base game's marker system,
    // we'll track them on the town and provide their effects)

    function initCulturalLandmarks(town) {
        if (!town.culturalLandmarks) {
            town.culturalLandmarks = {
                theater: 0,
                museum: 0,
                gallery: 0
            };
        }
    }

    // Check if town has a cultural landmark
    function hasCulturalLandmark(town, type) {
        initCulturalLandmarks(town);
        return (town.culturalLandmarks[type] || 0) > 0;
    }

    // Add a cultural landmark
    function addCulturalLandmark(town, type) {
        initCulturalLandmarks(town);
        town.culturalLandmarks[type] = (town.culturalLandmarks[type] || 0) + 1;

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
            args.successChance = Math.max(0.15, Math.min(0.75, args.successChance));
            return true;
        },
        message: (subject, target, args) => {
            return `{{regname:town|${target.id}}} could build a {{b:Theater}} for drama and performance. The arts would flourish...`;
        },
        func: (subject, target, args) => {
            const success = Math.random() < args.successChance;
            args.success = success;

            if (success) {
                addCulturalLandmark(target, "theater");
                happen("Influence", subject, target, { faith: 1 });
                logMessage(`{{regname:town|${target.id}}} builds a grand {{b:Theater}}!`, "milestone");
            } else {
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
            args.successChance = Math.max(0.15, Math.min(0.70, args.successChance));
            return true;
        },
        message: (subject, target, args) => {
            return `{{regname:town|${target.id}}} could build a {{b:Museum}} to preserve history and culture...`;
        },
        func: (subject, target, args) => {
            const success = Math.random() < args.successChance;
            args.success = success;

            if (success) {
                addCulturalLandmark(target, "museum");
                happen("Influence", subject, target, { faith: 1 });
                logMessage(`{{regname:town|${target.id}}} opens a {{b:Museum}}!`, "milestone");
            } else {
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
            args.successChance = Math.max(0.15, Math.min(0.75, args.successChance));
            return true;
        },
        message: (subject, target, args) => {
            return `{{regname:town|${target.id}}} could build an {{b:Art Gallery}} to display and celebrate visual arts...`;
        },
        func: (subject, target, args) => {
            const success = Math.random() < args.successChance;
            args.success = success;

            if (success) {
                addCulturalLandmark(target, "gallery");
                happen("Influence", subject, target, { faith: 1 });
                logMessage(`{{regname:town|${target.id}}} opens an {{b:Art Gallery}}!`, "milestone");
            } else {
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
            initCulturalLandmarks(subject);
            const hasAny = subject.culturalLandmarks.theater > 0 ||
                           subject.culturalLandmarks.museum > 0 ||
                           subject.culturalLandmarks.gallery > 0;
            return hasAny;
        },
        func: (subject, target, args) => {
            initTownCulture(subject);

            // Theater attracts performers
            if (subject.culturalLandmarks.theater > 0 && Math.random() < 0.02) {
                subject.jobs = subject.jobs || {};
                subject.jobs.performer = (subject.jobs.performer || 0) + 1;
            }

            // Museum builds prestige slowly
            if (subject.culturalLandmarks.museum > 0 && Math.random() < 0.05) {
                subject.culture.prestige += 0.5;
            }

            // Gallery attracts artists
            if (subject.culturalLandmarks.gallery > 0 && Math.random() < 0.02) {
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
            // Need to have been in a war
            const pastWars = regFilter("process", p =>
                p.type === "war" &&
                p.done &&
                p.towns &&
                p.towns.includes(target.id)
            );

            if (pastWars.length === 0) return false;

            // Check if already has memorial
            initCulturalLandmarks(target);
            if (target.culturalLandmarks.warMemorial) return false;

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
            initCulturalLandmarks(target);
            target.culturalLandmarks.warMemorial = 1;

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
                    logMessage(`A {{regadj:town|${subject.id}}} composer writes a {{c:stirring|haunting|powerful}} war {{c:anthem|symphony|ballad}}.`);
                }
            } else if (args.artists > 0 && Math.random() < 0.4) {
                addTradition(subject, "art");
                if (Math.random() < 0.3) {
                    logMessage(`An artist in {{regname:town|${subject.id}}} creates a {{c:powerful|moving|striking}} war {{c:painting|sculpture|mural}}.`);
                }
            } else if (args.scholars > 0 && Math.random() < 0.4) {
                addTradition(subject, "literary");
                if (Math.random() < 0.3) {
                    logMessage(`A poet in {{regname:town|${subject.id}}} writes {{c:verses|an epic|poetry}} about the {{c:conflict|war|struggle}}.`);
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
            args.successChance = Math.max(0.25, Math.min(0.85, args.successChance));
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
                logMessage(`${refugees} refugees flee from {{regname:town|${subject.id}}} to {{regname:town|${args.destination.id}}} during the ${args.disaster.subtype}.`);
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

            logMessage(`A ${jobType} leaves disaster-struck {{regname:town|${subject.id}}} for opportunities in {{regname:town|${args.destination.id}}}.`);
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
        message: "{{regname:town|$target.id}} is recovering from a devastating $args.disaster.subtype. Sending relief supplies would earn their gratitude. {{should}}",
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
        message: "{{people}} propose building a memorial to honor those lost in the $args.disaster.type. {{should}}",
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
                x: subject.x,
                y: subject.y
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
                logMessage(`Writers in {{regname:town|${subject.id}}} chronicle the ${disaster.subtype} in powerful accounts.`);
            } else {
                logMessage(`Artists in {{regname:town|${subject.id}}} create moving works depicting the ${disaster.subtype}.`);
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
        message: "The rains have not come to {{regname:town|$subject.id}}. The crops wither. {{should}}",
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
            return subject.drought && !subject.drought.ended;
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
            return subject.famine && !subject.famine.ended;
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

            if (Math.random() < 0.15) {
                logMessage(`${migrants} people leave {{regname:town|${subject.id}}} seeking opportunity in {{regname:town|${target.id}}}.`);
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

            logMessage(`A scholar leaves {{regname:town|${subject.id}}} for the academy in {{regname:town|${target.id}}}.`);
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

            logMessage(`A doctor leaves {{regname:town|${subject.id}}} to practice in {{regname:town|${target.id}}}.`);
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

            logMessage(`A ${jobType} leaves {{regname:town|${subject.id}}} for the cultural scene in {{regname:town|${target.id}}}.`);
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

            // Priests may accompany
            if (subject.jobs && subject.jobs.priest > 0 && Math.random() < 0.2) {
                subject.jobs.priest--;
                target.jobs = target.jobs || {};
                target.jobs.priest = (target.jobs.priest || 0) + 1;
            }

            if (Math.random() < 0.2) {
                logMessage(`Pilgrims from {{regname:town|${subject.id}}} settle in holy {{regname:town|${target.id}}}.`);
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

            logMessage(`Religious refugees flee {{regname:town|${subject.id}}} for {{regname:town|${target.id}}}.`);

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

            if (Math.random() < 0.2) {
                logMessage(`${actualRefugees} refugees flee the war in {{regname:town|${subject.id}}} for safety in {{regname:town|${target.id}}}.`);
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
            return true;
        },
        func: (subject, target, args) => {
            const returnees = Math.floor(Math.random() * 5) + 1;
            const actualReturnees = Math.min(returnees, Math.floor(subject.pop * 0.03));

            if (actualReturnees < 1) return;

            happen("Migrate", subject, args.destination, { count: actualReturnees });

            if (Math.random() < 0.15) {
                logMessage(`Refugees return to rebuilt {{regname:town|${args.destination.id}}} from {{regname:town|${subject.id}}}.`);
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
        message: "Unrest grows in {{regname:town|$target.id}}. The people demand change. Address their grievances? {{should}}",
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
                applyGovernmentType(subject, choose(options));
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
        message: "In {{regname:town|$subject.id}}, a new spiritual movement is taking shape. Allow it to flourish? {{should}}",
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

            chance = Math.max(0.05, Math.min(0.7, chance));

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
            chance = Math.max(0.05, Math.min(0.6, chance));

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
        message: "Scholars in {{regname:town|$subject.id}} propose reforms to {{b:$args.religion.name}}. Allow the reformation? {{should}}",
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
                logMessage(`Artists in {{regname:town|${subject.id}}} create ${artType} honoring {{b:${religion.name}}}.`);
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
        message: "{{regname:town|$target.id}} has no established faith. Encourage them to embrace {{b:$args.religion.name}}? {{should}}",
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
        message: "Religious tensions simmer between {{regname:town|$target.id}} and {{regname:town|$args.rivalTown.id}}. Encourage tolerance? {{should}}",
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
    }

    // Record a historical event
    function recordHistory(type, data) {
        initHistory();

        const entry = {
            id: planet.history.length + 1,
            type: type,
            day: planet.day,
            ...data
        };

        planet.history.push(entry);
        return entry;
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
        let results = planet.history.filter(h => h.type === type);
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
            if (types && !types.includes(h.type)) return false;
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

            const victor = subject.winner ? regGet("town", subject.winner) : null;
            const towns = subject.towns || [];
            const loser = towns.find(id => id !== subject.winner);
            const loserTown = loser ? regGet("town", loser) : null;

            const entry = recordHistory(HISTORY_TYPES.WAR, {
                victor: subject.winner,
                victorName: victor?.name,
                loser: loser,
                loserName: loserTown?.name,
                towns: towns,
                deaths: subject.deaths || 0,
                duration: subject.done - subject.start,
                name: victor && loserTown ?
                    `The ${victor.name}-${loserTown.name} War` :
                    `The War of Day ${subject.start}`
            });

            // Create war hero from victor
            if (victor && !victor.end && subject.deaths > 10 && Math.random() < 0.3) {
                const hero = createFigure("GENERAL", {
                    town: victor.id,
                    deeds: [`Led ${victor.name} to victory in ${entry.name}`]
                });
                logMessage(`{{b:${hero.fullTitle}}} emerges as a celebrated general in {{regname:town|${victor.id}}}.`);
            }

            // Record grudges
            if (victor && loserTown && !loserTown.end) {
                recordGrudge(loserTown, victor.id, `Defeated in ${entry.name}`, 5);

                // Martyr may emerge from defeated side
                if (subject.deaths > 20 && Math.random() < 0.2) {
                    const martyr = createFigure("MARTYR", {
                        town: loser,
                        deeds: [`Fell defending ${loserTown.name} in ${entry.name}`]
                    });
                    killFigure(martyr, "battle", loser);
                    logMessage(`{{regname:town|${loser}}} mourns {{b:${martyr.name}}}, martyred in the war.`);
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
        }

        return alliance;
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
                    logMessage(`{{regname:town|${subject.id}}} commemorates their victory in {{b:${args.war.name}}} ${args.years * 100} days ago.`);
                }
            } else {
                // Defeated side may still hold grudge
                if (args.war.victor) {
                    const victor = regGet("town", args.war.victor);
                    if (victor && !victor.end && hasGrudge(subject, args.war.victor)) {
                        happen("Influence", null, subject, { military: 0.5, happy: -0.3, temp: true });
                        if (Math.random() < 0.3) {
                            logMessage(`{{regname:town|${subject.id}}} grimly remembers their defeat in {{b:${args.war.name}}}.`);
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
                logMessage(`{{regname:town|${subject.id}}} honors the memory of {{b:${figure.fullTitle}}}.`);
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
                logMessage(`{{regname:town|${subject.id}}} draws courage from their past victory over {{regname:town|${enemy.id}}} in {{b:${args.pastWar.name}}}.`);
            } else {
                // Could go either way - revenge motivation or fear
                if (Math.random() < 0.5) {
                    happen("Influence", null, subject, { military: 1.5, temp: true });
                    logMessage(`{{regname:town|${subject.id}}} seeks revenge for their defeat in {{b:${args.pastWar.name}}}.`);
                } else {
                    happen("Influence", null, subject, { happy: -0.5, temp: true });
                    logMessage(`The specter of {{b:${args.pastWar.name}}} haunts {{regname:town|${subject.id}}} as they face {{regname:town|${enemy.id}}} again.`);
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
        message: "{{people}} wish to build a monument to {{b:$args.figure.fullTitle}}. {{should}}",
        messageDone: "A statue is raised in their honor.",
        messageNo: "Their memory lives on without stone.",
        func: (subject, target, args) => {
            args.figure.hasMonument = true;
            args.figure.monumentLocation = subject.id;

            happen("Create", null, null, {
                type: "landmark",
                subtype: "monument",
                name: `Statue of ${args.figure.name}`,
                symbol: "🗿",
                x: subject.x,
                y: subject.y
            });

            initTownCulture(subject);
            subject.culture.prestige += 3;

            happen("Influence", null, subject, { happy: 1, faith: 0.5 });

            logMessage(`A monument to {{b:${args.figure.fullTitle}}} is unveiled in {{regname:town|${subject.id}}}.`, "milestone");
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
        message: "{{people}} propose a monument commemorating {{b:$args.event.name}}. {{should}}",
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
                name: `${args.event.name} Monument`,
                symbol: symbolMap[args.event.type] || "🗿",
                x: subject.x,
                y: subject.y
            });

            initTownCulture(subject);
            subject.culture.prestige += 2;

            happen("Influence", null, subject, { happy: 1 });

            logMessage(`{{regname:town|${subject.id}}} erects a monument to {{b:${args.event.name}}}.`, "milestone");
        }
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

            logMessage(`{{b:${artist.fullTitle}}} becomes renowned in {{regname:town|${subject.id}}}.`);

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

    // Get trade partner from a route
    function getRoutePartner(route, town) {
        if (route.town1 === town.id) return regGet("town", route.town2);
        if (route.town2 === town.id) return regGet("town", route.town1);
        return null;
    }

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
        message: "Merchants from {{regname:town|$subject}} propose establishing a formal trade route with {{regname:town|$target}}. {{should}}",
        messageDone: "A trade route is established between the two settlements.",
        messageNo: "Trade continues informally, without official routes.",
        func: (subject, target) => {
            const route = createTradeRoute(subject, target);

            // Log based on route difficulty
            if (route.needsShips) {
                logMessage(`A sea trade route connects {{regname:town|${subject.id}}} and {{regname:town|${target.id}}}.`);
            } else if (route.difficulty > 1.5) {
                logMessage(`A challenging trade route through difficult terrain links {{regname:town|${subject.id}}} and {{regname:town|${target.id}}}.`);
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
                    logMessage(`A prosperous caravan arrives in {{regname:town|${partner.id}}} from {{regname:town|${subject.id}}}.`);
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
                    }
                } else if (!route.active) {
                    // Restore after peace (with some delay)
                    if (Math.random() < 0.05) {
                        route.active = true;
                        logMessage(`Trade resumes between {{regname:town|${subject.id}}} and {{regname:town|${partner.id}}}.`);
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
            if (subject.specializations?.some(s => s.type === "trade_hub")) return false;

            return true;
        },
        message: "{{regname:town|$subject}} has become a crossroads of commerce. Merchants propose formalizing it as a major trade hub. {{should}}",
        messageDone: "The settlement becomes renowned as a center of trade.",
        messageNo: "Trade continues without formal recognition.",
        func: (subject) => {
            if (!subject.specializations) subject.specializations = [];
            subject.specializations.push({
                type: "trade_hub",
                established: planet.day
            });

            happen("Influence", null, subject, { trade: 3, happy: 1 });
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
        message: "The {{climate:hot and humid/swampy}} conditions around {{regname:town|$subject}} breed illness. Healers urge preventive measures. {{should}}",
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
        message: "The bitter cold tests {{regname:town|$subject}}. Extra provisions could ease the hardship. {{should}}",
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
        message: "A scorching heat wave strikes {{regname:town|$subject}}. Water must be rationed carefully. {{should}}",
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
        message: "The forests around {{regname:town|$subject}} are thinning. Some urge replanting efforts. {{should}}",
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
        message: "The soil around {{regname:town|$subject}} grows less fertile. Farmers urge letting fields lie fallow. {{should}}",
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
        message: "The land around {{regname:town|$subject}} shows signs of turning to dust. Drastic measures may be needed. {{should}}",
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
        message: "Irrigation projects around {{regname:town|$subject}} could make the land more fertile. {{should}}",
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
        message: "Smoke and waste from {{regname:town|$subject}} darken the skies. Some call for cleaner methods. {{should}}",
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
        message: "Sailors from {{regname:town|$subject}} propose a sea trade route to {{regname:town|$target}}. {{should}}",
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
                            logMessage(`Merchants bring ${goods} from {{regname:town|${subject.id}}} to {{regname:town|${partner.id}}}.`);
                        }
                    }
                }
            });
        }
    });

})();
