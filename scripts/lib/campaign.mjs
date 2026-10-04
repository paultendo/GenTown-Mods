import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { makeGame } from './game.mjs';

export const POLICIES = ['yes', 'no', 'mixed', 'skip'];
const closed = new Set(['made', 'finished', 'completed', 'failed', 'withdrawn', 'abandoned', 'arrived', 'returned', 'lost', 'left', 'refused', 'cancelled', 'learned', 'superseded', 'closed']);
const plain = value => JSON.parse(JSON.stringify(value));
const root = new URL('../../', import.meta.url);
const codeFiles = ['index.html', 'paultendo-mod.js', 'vendor/gentown/load.js', 'vendor/gentown/perlin.js', 'vendor/gentown/standalone.js', 'vendor/gentown/gentown.js', 'vendor/gentown/gentown-data.js', 'vendor/gentown/gentown-mass.js', 'app/boot.js', 'app/ready.js', 'scripts/lib/game.mjs', 'scripts/lib/campaign.mjs', 'scripts/simulate.mjs'];
const digest = text => createHash('sha256').update(text).digest('hex');
const sourceHashes = () => Object.fromEntries(codeFiles.map(path => [path, digest(readFileSync(new URL(path, root)))]));
const loadedSourceHashes = sourceHashes();

export function validateOptions({ days = 1000, seed = 42, policy = 'mixed', checkpointEvery = 100, site = 'fertile', stallAfter = 30 } = {}) {
  if (!Number.isSafeInteger(days) || days < 1 || days > 100000) throw new Error('Days must be an integer from 1 to 100000');
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xFFFFFFFF) throw new Error('Seed must be an unsigned 32-bit integer');
  if (!POLICIES.includes(policy)) throw new Error(`Policy must be ${POLICIES.join(', ')}`);
  if (!Number.isSafeInteger(checkpointEvery) || checkpointEvery < 1) throw new Error('Checkpoint interval must be a positive integer');
  if (!Number.isSafeInteger(stallAfter) || stallAfter < 1) throw new Error('Stall threshold must be a positive integer');
  if (!['fertile', 'first'].includes(site)) throw new Error('Site must be fertile or first');
  return { days, seed, policy, checkpointEvery, site, stallAfter };
}

function planets(window) {
  const universe = window._paultendoUniverse;
  const currentId = universe?.currentWorldId ?? 1;
  return [{ id: currentId, planet: window.planet }, ...Object.values(universe?.worlds || {})
    .filter(world => world.id !== currentId && world.state?.planet)
    .map(world => ({ id: world.id, planet: world.state.planet }))];
}

function townKnowledge(planet, town) {
  const levels = { ...planet.unlocks };
  for (const [id, advance] of Object.entries(planet._paultendoLocalKnowledge || {})) {
    if (!town._paultendoLocalDiscoveries?.[id]) levels[advance.key] = Math.min(levels[advance.key] || 0, advance.before);
  }
  return levels;
}

export function campaignSnapshot(window) {
  return plain({ worlds: planets(window).map(({ id, planet }) => {
    const towns = Object.values(planet.reg.town || {}).filter(t => t && typeof t === 'object' && !t.delete);
    const life = planet._paultendoLife || {};
    const work = ['inquiries', 'materialWork', 'artifactWork', 'sampling', 'seaVoyages', 'exchanges', 'teachings'].flatMap(kind => (life[kind] || []).map(w => ({
      kind, id: w.id, town: w.town ?? w.buyer, name: w.title || w.name || w.type || w.event,
      status: w.status, started: w.started ?? w.day, finished: w.finished, remaining: w.remaining,
      pause: w.pause || w.delay || w.blocked, resolved: !!w.resolved,
      cost: w.cost, cause: w.cause, latestStep: w.steps?.at(-1)?.text,
      lastChange: w.steps?.at(-1)?.day ?? w.lastProgressDay ?? w.started ?? w.day,
      active: !w.resolved && !closed.has(w.status)
    })));
    const processes = Object.values(planet.reg.process || {}).filter(p => p && typeof p === 'object' && !p.delete);
    return {
      id, name: planet.name, day: planet.day, dead: !!planet.dead, locked: !!planet.locked,
      population: towns.reduce((n, t) => n + t.pop, 0), livingTowns: towns.filter(t => t.pop > 0).length,
      sharedUnlocks: planet.unlocks,
      towns: towns.map(t => ({ id: t.id, name: t.name, pop: t.pop, type: t.type, resources: t.resources,
        jobs: t.jobs, wealth: t.wealth, hunger: t.influences?.hunger, unrest: t.unrest,
        knowledge: townKnowledge(planet, t), discoveries: t._paultendoLocalDiscoveries || {},
        end: t.end, foodFlow: t._paultendoFoodFlow?.slice(-3) })),
      work, processTypes: processes.reduce((counts, p) => { counts[p.type] = (counts[p.type] || 0) + 1; return counts; }, {}),
      artifacts: (life.artifacts || []).length,
      discoveredPlaces: Object.keys(life.places || {}).length,
      speciesEncounters: Object.values(life.species || {}).filter(s => s.encounter).length,
      clues: (life.clues || []).length
    };
  }) });
}

export function checkInvariants(window) {
  for (const { id, planet } of planets(window)) {
    if (!Number.isSafeInteger(planet.day) || planet.day < 1) throw new Error(`World ${id} has an invalid day: ${planet.day}`);
    for (const town of Object.values(planet.reg.town || {})) {
      if (!town || typeof town !== 'object' || town.delete) continue;
      for (const [key, value] of [['population', town.pop], ['wealth', town.wealth], ...Object.entries(town.resources || {}).map(([k, v]) => [`resource.${k}`, v]), ...Object.entries(town.jobs || {}).map(([k, v]) => [`job.${k}`, v])]) {
        if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`World ${id}, town ${town.id}: ${key} is not finite (${value})`);
        // Debt can be negative. People, occupations and physical goods cannot.
        if (value < 0 && key !== 'wealth' && key !== 'resource.cash') throw new Error(`World ${id}, town ${town.id}: ${key} is negative (${value})`);
      }
    }
  }
}

function policyRandom(seed) {
  let state = (seed ^ 0xA341316C) >>> 0;
  return () => { state = Math.imul(state, 1664525) + 1013904223 >>> 0; return state / 4294967296; };
}

function settle(window, site) {
  const chunks = window.filterChunks(c => c.b !== 'water' && c.b !== 'mountain');
  if (site === 'fertile') chunks.sort((a, b) => siteScore(b) - siteScore(a));
  const chunk = chunks[0];
  if (!chunk) throw new Error('Seed contains no habitable land');
  window.mousePos = { chunkX: chunk.x, chunkY: chunk.y };
  if (typeof window.onMapClick !== 'function') throw new Error('World cannot be settled through the native founding action');
  window.onMapClick();
  return { x: chunk.x, y: chunk.y, biome: chunk.b };
}
function siteScore(c) { return (c.b === 'grass' ? 10 : c.b === 'wetland' ? 5 : 0) - Math.abs(c.t - 0.6) - Math.abs(c.m - 0.6); }

// Operate the engine's live controls. Never fabricate a caller, bypass a cost,
// invoke an event's func directly or turn a skipped proposal into a No.
export function answerChoices(window, policy, random, record) {
  for (const caller of Object.values(window.currentEvents || {})) {
    if (caller.done || !caller.needsInput) continue;
    const row = window.document.getElementById('logMessage-' + caller.logID);
    const choices = [...(row?.querySelectorAll('.logAct [type]') || [])];
    const entry = { event: caller.eventClass, subject: caller.subject?.id, target: caller.target?.id };
    if (!choices.length) {
      record({ kind: 'unavailable-choice', ...entry, reason: caller.message ? 'Missing live controls' : 'Event requests input but has no message' });
      continue; // Leave it for the real native lapse path, and expose the defect.
    }
    if (policy === 'skip') { record({ kind: 'choice', ...entry, answer: 'skip', done: false }); continue; }
    const yes = choices.find(c => c.getAttribute('type') === 'yes');
    const no = choices.find(c => c.getAttribute('type') === 'no');
    const chosen = yes && no ? (policy === 'yes' || policy === 'mixed' && random() >= 0.5 ? yes : no)
      : choices[policy === 'mixed' ? Math.floor(random() * choices.length) : policy === 'no' ? choices.length - 1 : 0];
    chosen.click();
    if (window.promptState) answerPrompt(window, policy, random, record);
    record({ kind: 'choice', ...entry, answer: chosen.getAttribute('type'), value: caller.args?.value, done: !!caller.done });
    if (!caller.done) throw new Error(`Choice ${caller.eventClass} did not complete through its control`);
  }
}

function answerPrompt(window, policy, random, record) {
  for (let count = 0; window.promptState; count++) {
    if (count >= 32) throw new Error('More than 32 chained prompts in one campaign step');
    const prompt = window.promptState;
    let value;
    if (prompt.type === 'ask') {
      const input = window.document.getElementById('popupText');
      value = input.value.trim() || `Wayfarer ${window.planet.day}`;
      input.value = value;
      if (prompt.preview) window.previewPrompt();
    }
    else if (prompt.type === 'choose') {
      const choices = prompt.choices;
      if (!choices?.length) throw new Error('Prompt has no choices');
      value = choices[policy === 'mixed' ? Math.floor(random() * choices.length) : policy === 'no' ? choices.length - 1 : 0];
    } else if (prompt.type === 'confirm') value = policy === 'yes' || policy === 'mixed' && random() >= 0.5;
    else if (prompt.type === 'text') value = null;
    else throw new Error(`Unsupported prompt: ${prompt.type}`);
    record({ kind: 'prompt', type: prompt.type, answer: value });
    window.handlePrompt(value);
  }
}

function readLetter(window, record) {
  if (!window.planet.letter) return;
  const letter = window.planet.letter;
  const read = [...window.document.querySelectorAll('.logAct [type=act]')].find(b => b.textContent.trim() === 'Read');
  if (!read) throw new Error(`Letter ${letter} blocks the world without a Read control`);
  read.click();
  record({ kind: 'letter', letter });
  if (window.planet.letter || window.planet.locked) throw new Error('Reading the letter did not unlock the world');
}

function problemText(error) {
  if (Array.isArray(error)) return error.map(problemText).join(' ');
  return error?.stack || String(error);
}

export async function runCampaign(options = {}) {
  const config = validateOptions(options);
  const { directory, save, onProgress, gameFactory = makeGame, signal } = options;
  if (directory) mkdirSync(directory, { recursive: false });
  const started = performance.now();
  const timeline = [], counters = {}, snapshots = [], milestones = [], firstExtinction = {}, workProgress = new Map();
  const report = { schema: 1, ...config, version: JSON.parse(readFileSync(new URL('package.json', root))).version,
    sourceHashes: loadedSourceHashes, imported: !!save, inputHash: save ? digest(JSON.stringify(save)) : null, status: 'running', turns: 0, milestones, firstExtinction, snapshots, counters };
  let game, initial, final, lastMeaningfulTurn = 0, longestQuietStretch = 0;
  const record = event => {
    const entry = plain({ turn: report.turns, world: game?.window._paultendoUniverse?.currentWorldId ?? 1, day: game?.window.planet?.day, ...event });
    timeline.push(entry);
    if (directory) appendFileSync(join(directory, 'timeline.jsonl'), JSON.stringify(entry) + '\n');
  };
  const health = () => {
    if (game.errors.length || game.warnings.length) throw new Error([...game.errors, ...game.warnings].map(problemText).join('\n'));
    checkInvariants(game.window);
  };
  const exportSave = name => {
    if (directory) writeFileSync(join(directory, name), JSON.stringify(game.window.generateSave()));
  };
  try {
    game = await gameFactory({ seed: config.seed, save: save && plain(save), virtualTime: true });
    const w = game.window;
    if (!save) report.foundingSite = settle(w, config.site);
    health();
    report.startDay = w.planet.day;
    report.terrainSeed = w.planet.config.seed;
    exportSave('initial.planet');
    initial = campaignSnapshot(w); snapshots.push(initial);
    for (const world of initial.worlds) for (const work of world.work) workProgress.set(`${world.id}:${work.kind}:${work.id}`, { signature: JSON.stringify([work.status, work.remaining, work.pause, work.resolved]), day: world.day });
    let previous = initial;
    const random = policyRandom(config.seed);
    const baseEvent = w.doEvent;
    w.doEvent = function(event, ...args) {
      counters[event] = (counters[event] || 0) + 1;
      return baseEvent.call(this, event, ...args);
    };
    const baseLog = w.logMessage;
    w.logMessage = function(...args) {
      const id = baseLog.apply(this, args);
      if (!id) return id; // Queued daily messages are recorded when they actually appear.
      const node = w.document.getElementById('logMessage-' + id);
      const text = node?.querySelector('.logText')?.textContent || node?.textContent || String(args[0]);
      if (text && !/^The Sun (rises|sets)/.test(text.trim())) record({ kind: 'news', text, story: args[2]?._paultendoStory });
      return id;
    };
    for (let turn = 1; turn <= config.days; turn++) {
      if (signal?.aborted) { report.status = 'interrupted'; break; }
      readLetter(w, record);
      if (w.promptState) answerPrompt(w, config.policy, random, record);
      if (w.planet.locked) throw new Error('World remains locked after handling its actual prompts');
      // Resolve a saved/current proposal before advancing, then the new day's
      // proposal immediately. Skipped entries reach the native lapse path.
      if (turn === 1) answerChoices(w, config.policy, random, record);
      const beforeDays = new Map(planets(w).map(({ id, planet }) => [id, planet.day]));
      report.turns = turn;
      w.nextDay();
      for (const { id, planet } of planets(w)) if (beforeDays.has(id) && planet.day !== beforeDays.get(id) + 1) throw new Error(`World ${id} advanced from ${beforeDays.get(id)} to ${planet.day}, expected exactly one day`);
      readLetter(w, record);
      answerChoices(w, config.policy, random, record);
      if (w.promptState) answerPrompt(w, config.policy, random, record);
      game.clock.advance(1000);
      await new Promise(resolve => setImmediate(resolve)); // Flush observers and allow interruption, without real-time day delays.
      // Deferred callbacks and choice handlers must not advance another day.
      for (const { id, planet } of planets(w)) if (beforeDays.has(id) && planet.day !== beforeDays.get(id) + 1) throw new Error(`World ${id} advanced from ${beforeDays.get(id)} to ${planet.day}, expected exactly one day including timers`);
      health();
      final = campaignSnapshot(w);
      let meaningful = false;
      for (const world of final.worlds) {
        const old = previous.worlds.find(p => p.id === world.id);
        if (!old || old.livingTowns !== world.livingTowns) { record({ kind: 'towns', world: world.id, living: world.livingTowns, population: world.population }); meaningful = true; }
        if (!world.livingTowns && firstExtinction[world.id] === undefined) firstExtinction[world.id] = world.day;
        if (!old) continue;
        for (const [key, value] of Object.entries(world.sharedUnlocks || {})) if (value !== old.sharedUnlocks[key]) {
          const before = old.sharedUnlocks[key] || 0;
          // Legacy technology scores can grow fractionally. Only crossing a
          // real unlock-tree threshold counts as a discovered technology.
          for (const level of (w.unlockTree[key]?.levels || []).map(l => l.level).filter(level => level > before && level <= value)) {
            const entry = { kind: 'discovery', world: world.id, day: world.day, key, level, previous: before };
            milestones.push(entry); record(entry); meaningful = true;
          }
        }
        for (const work of world.work) {
          const key = `${world.id}:${work.kind}:${work.id}`, signature = JSON.stringify([work.status, work.remaining, work.pause, work.resolved]);
          if (workProgress.get(key)?.signature !== signature) workProgress.set(key, { signature, day: world.day });
          const held = old.work.find(item => item.id === work.id && item.kind === work.kind);
          if (!held || held.status !== work.status || held.pause !== work.pause || held.resolved !== work.resolved) {
            record({ kind: 'work', world: world.id, work }); meaningful = true;
          }
        }
        for (const key of ['artifacts', 'discoveredPlaces', 'speciesEncounters', 'clues', 'processTypes']) if (JSON.stringify(world[key]) !== JSON.stringify(old[key])) meaningful = true;
      }
      if (meaningful) { longestQuietStretch = Math.max(longestQuietStretch, turn - lastMeaningfulTurn - 1); lastMeaningfulTurn = turn; }
      previous = final;
      if (turn % config.checkpointEvery === 0 || turn === config.days) {
        snapshots.push(final);
        exportSave(`day-${w.planet.day}.planet`);
        onProgress?.({ seed: config.seed, policy: config.policy, turns: turn, day: w.planet.day, population: final.worlds.reduce((n, p) => n + p.population, 0), elapsedMs: performance.now() - started });
      }
    }
    if (report.status === 'running') report.status = 'passed';
  } catch (error) {
    report.status = 'failed'; report.failure = problemText(error);
    record({ kind: 'failure', error: report.failure });
  } finally {
    if (game) {
      try { final = campaignSnapshot(game.window); exportSave('final.planet'); }
      catch (error) { report.exportFailure = problemText(error); report.status = 'failed'; }
      report.errors = game.errors.map(problemText); report.warnings = game.warnings.map(problemText);
      report.randomState = game.randomState();
      game.close();
    }
  }
  report.elapsedMs = Math.round(performance.now() - started);
  report.daysPerSecond = Number((report.turns / (report.elapsedMs / 1000)).toFixed(1));
  report.initial = initial; report.final = final;
  report.longestQuietStretch = Math.max(longestQuietStretch, report.turns - lastMeaningfulTurn);
  report.quietStretchDefinition = 'Days without a discovery, change of work status or obstacle, town count, artifact, place, encounter, clue or process count. Population changes and ordinary news do not reset it.';
  report.waitingWork = final?.worlds.flatMap(p => p.work.filter(w => w.active).map(w => ({ world: p.id, ...w, age: p.day - (w.started ?? p.day), daysSinceStoryChange: p.day - (w.lastChange ?? p.day), daysWithoutProgress: p.day - (workProgress.get(`${p.id}:${w.kind}:${w.id}`)?.day ?? p.day) }))) || [];
  report.stalledWork = report.waitingWork.filter(w => w.daysWithoutProgress >= config.stallAfter);
  report.timelineEntries = timeline.length;
  report.choiceCounts = timeline.filter(e => e.kind === 'choice').reduce((counts, e) => { counts[e.answer] = (counts[e.answer] || 0) + 1; return counts; }, {});
  report.completedWork = final?.worlds.flatMap(p => p.work.filter(w => !w.active).map(w => ({ world: p.id, ...w, duration: w.finished !== undefined && w.started !== undefined ? w.finished - w.started : null }))) || [];
  report.discoveryRhythm = { first30Turns: 0, turns31To150: 0, after150Turns: 0 };
  for (const entry of timeline.filter(e => e.kind === 'discovery')) report.discoveryRhythm[entry.turn <= 30 ? 'first30Turns' : entry.turn <= 150 ? 'turns31To150' : 'after150Turns']++;
  report.unavailableChoices = timeline.filter(e => e.kind === 'unavailable-choice');
  if (report.status === 'passed' && report.unavailableChoices.length) report.status = 'issues';
  report.summary = formatReport(report);
  if (directory) {
    writeFileSync(join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    writeFileSync(join(directory, 'report.txt'), report.summary + '\n');
  }
  return { report, timeline };
}

export function formatReport(r) {
  const worlds = r.final?.worlds || [];
  return [
    `Seed ${r.seed}, ${r.policy}: ${r.status.toUpperCase()}`,
    `${r.turns}/${r.days} turns, day ${r.startDay ?? '?'} to ${worlds[0]?.day ?? '?'}, ${(r.elapsedMs / 1000).toFixed(2)}s (${r.daysPerSecond} days/s)`,
    ...worlds.map(w => `World ${w.id}: ${w.livingTowns} living towns, ${w.population} people, ${w.work.length} work records, ${w.artifacts} artifacts, ${w.speciesEncounters} species encounters`),
    `Discoveries: ${r.milestones.map(m => `${m.key} ${m.level} on day ${m.day}`).join(', ') || 'none'}`,
    `Choices: ${Object.entries(r.choiceCounts).map(([answer, n]) => `${answer} ${n}`).join(', ') || 'none'}`,
    `First extinction: ${Object.entries(r.firstExtinction).map(([w, d]) => `world ${w} on day ${d}`).join(', ') || 'none'}`,
    `Longest stretch without a tracked milestone: ${r.longestQuietStretch} days`,
    `Unfinished work: ${r.waitingWork.length}`,
    `Work unchanged for at least ${r.stallAfter} days: ${r.stalledWork.length}`,
    `Proposals without usable controls: ${r.unavailableChoices.length}${r.unavailableChoices.length ? ` (${[...new Set(r.unavailableChoices.map(e => e.event))].join(', ')})` : ''}`,
    ...r.waitingWork.map(w => `  ${w.kind} ${w.name || w.id}: ${w.status || 'underway'}${w.pause ? ` (${w.pause})` : ''}, age ${w.age} days, remaining ${w.remaining ?? '?'}`),
    `Runtime failures: ${r.failure ? 1 : 0}. Console errors: ${r.errors?.length || 0}. Warnings: ${r.warnings?.length || 0}.`,
    ...(r.failure ? [r.failure] : []),
    ...(r.exportFailure ? [`Export failed: ${r.exportFailure}`] : []),
    'This checks simulation behaviour. It does not judge whether a campaign is enjoyable.'
  ].join('\n');
}
