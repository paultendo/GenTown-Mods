import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeGame, settleGame } from './harness.mjs';
import { runCampaign, campaignSnapshot, answerChoices, checkInvariants, validateOptions } from '../scripts/lib/campaign.mjs';
import { parseArguments } from '../scripts/simulate.mjs';
const plain = value => JSON.parse(JSON.stringify(value));

test('unchanged saved obstacle objects do not invent work activity or conceal a quiet stretch',async()=>{
  const {report,timeline}=await runCampaign({days:35,seed:42,save:{},gameFactory:async options=>{
    const g=await makeGame({...options,save:undefined}),w=g.window,town=settleGame(g);
    w.planet._paultendoLife.inquiries.push({id:'quiet-work',town:town.id,title:'An unanswered question',day:w.planet.day,status:'waiting',remaining:5,delay:{reason:'knowledge',day:w.planet.day},steps:[]});
    // Isolate the report counter from physical events. The same object is
    // cloned by each snapshot, but its actual obstacle has not changed.
    w.nextDay=()=>{w.planet.day++;};return g;
  }});
  assert.equal(report.status,'passed',report.failure);
  assert.equal(report.longestQuietStretch,35);
  assert.equal(report.stalledWork[0].daysWithoutProgress,35);
  assert.equal(timeline.filter(entry=>entry.kind==='work').length,0);
});

function propose(w, town, event, extra = {}) {
  const caller = w.readyEvent(event, w.regGet('player', 1), town);
  assert.ok(caller, `Missing eligible ${event}`);
  Object.assign(caller.args, extra);
  const message = w.gameEvents[event].message;
  caller.message = typeof message === 'function' ? message(caller.subject, caller.target, caller.args) : message;
  const choose = w.chooseEvent, ready = w.readyEvent;
  w.chooseEvent = () => event;
  w.readyEvent = (key, ...args) => key === event ? caller : ready(key, ...args);
  try { w.nextDay(); } finally { w.chooseEvent = choose; w.readyEvent = ready; }
  return caller;
}

test('campaign arguments reject invalid or ambiguous batches before making output', () => {
  assert.deepEqual(parseArguments(['--days', '300', '--seeds', '0,42', '--policies', 'yes,skip']).policies, ['yes', 'skip']);
  for (const args of [['--days', 'NaN'], ['--days', '0'], ['--days', '1.5'], ['--days', '-1'], ['--seed', '4294967296'], ['--seeds', '42,'], ['--seeds', '1,1'], ['--policy', 'clever'], ['--seed', '1', '--seeds', '2'], ['--bogus'], ['--checkpoint']]) assert.throws(() => parseArguments(args));
  assert.throws(() => validateOptions({ seed: Infinity }));
  assert.throws(() => validateOptions({ days: 100001 }));
});

test('seeded campaigns repeat physical state, choices and timeline exactly', async () => {
  const a = await runCampaign({ days: 35, seed: 7, policy: 'mixed', checkpointEvery: 20 });
  const b = await runCampaign({ days: 35, seed: 7, policy: 'mixed', checkpointEvery: 20 });
  assert.notEqual(a.report.status, 'failed', a.report.failure);
  assert.notEqual(b.report.status, 'failed', b.report.failure);
  assert.equal(a.report.turns, 35);
  assert.equal(a.report.final.worlds[0].day, a.report.startDay + 35);
  assert.deepEqual(a.report.final, b.report.final);
  assert.deepEqual(a.timeline, b.timeline);
  assert.deepEqual(a.report.counters, b.report.counters);
  assert.equal(a.report.randomState, b.report.randomState);
});

test('Yes and No exercise actual native discovery callbacks with different consequences', async t => {
  for (const policy of ['yes', 'no']) {
    const g = await makeGame({ virtualTime: true }); t.after(g.close);
    const w = g.window, town = settleGame(g);
    const levelData = w.unlockTree.farm.levels[0];
    const caller = propose(w, town, 'unlockLevel', { value: { type: 'farm', levelData } });
    const events = [];
    answerChoices(w, policy, () => 0.7, entry => events.push(entry));
    assert.equal(caller.done, true);
    assert.equal(w.planet.unlocks.farm === 10, policy === 'yes');
    assert.equal(events.at(-1).answer, policy);
    assert.deepEqual(g.errors, []);
  }
});

test('skipping leaves a native proposal untouched for its own next-day lapse', async t => {
  const g = await makeGame({ virtualTime: true }); t.after(g.close);
  const w = g.window, town = settleGame(g);
  const caller = propose(w, town, 'unlockLevel', { value: { type: 'farm', levelData: w.unlockTree.farm.levels[0] } });
  const before = w.planet.stats.prompt, events = [];
  answerChoices(w, 'skip', () => 0, entry => events.push(entry));
  assert.equal(!!caller.done, false);
  assert.equal(w.planet.stats.prompt, before);
  assert.equal(events.at(-1).answer, 'skip');
  const choose = w.chooseEvent; w.chooseEvent = () => null;
  try { w.nextDay(); } finally { w.chooseEvent = choose; }
  assert.equal(Object.values(w.currentEvents).includes(caller), false);
  assert.equal(w.planet.unlocks.farm, undefined);
  assert.deepEqual(g.errors, []);
});

test('naming renders the native editable preview before submitting demonyms', async t => {
  const g = await makeGame({ virtualTime: true }); t.after(g.close);
  const w = g.window, town = settleGame(g);
  const caller = propose(w, town, 'planetDemonym');
  answerChoices(w, 'yes', () => 0, () => {});
  assert.equal(caller.done, true);
  assert.ok(w.planet.dem && w.planet.dems && w.planet.adj);
  assert.deepEqual(g.errors, []);
});

test('snapshot reads do not spend randomness, change work or advance time', async t => {
  const g = await makeGame({ virtualTime: true }); t.after(g.close); settleGame(g);
  const before = JSON.stringify(g.window.generateSave()), random = g.randomState();
  const a = campaignSnapshot(g.window), b = campaignSnapshot(g.window);
  assert.deepEqual(a, b); assert.equal(g.randomState(), random);
  assert.equal(JSON.stringify(g.window.generateSave()), before);
  g.window.planet._paultendoLife.inquiries.push({id:'snapshot-probe',status:'waiting',delay:'food',cost:{clay:2},steps:[{day:1,text:'The maker needs a meal.'}]});
  const inquiry = campaignSnapshot(g.window).worlds[0].work.find(w => w.id === 'snapshot-probe');
  assert.equal(inquiry.pause, 'food'); assert.deepEqual(inquiry.cost, {clay:2}); assert.equal(inquiry.latestStep, 'The maker needs a meal.');
});

test('a warning inside a daily follow-up fails and exports the actual failing world', async () => {
  const directory = join(mkdtempSync(join(tmpdir(), 'gentown-harness-test-')), 'run');
  const { report } = await runCampaign({ days: 10, directory, gameFactory: async options => {
    const g = await makeGame(options), base = g.window.nextDay;
    g.window.nextDay = (...args) => { const result = base(...args); g.window.console.warn('[paultendo-mod] Research follow-up failed:', new Error('probe')); return result; };
    return g;
  } });
  assert.equal(report.status, 'failed'); assert.match(report.failure, /Research follow-up failed.*probe/s);
  assert.equal(report.turns, 1); assert.equal(report.warnings.length, 1);
  assert.ok(existsSync(join(directory, 'final.planet')));
  assert.match(readFileSync(join(directory, 'timeline.jsonl'), 'utf8'), /failure/);
  assert.equal(JSON.parse(readFileSync(join(directory, 'report.json'))).status, 'failed');
});

test('continuing an export keeps its day and town instead of founding a replacement', async t => {
  const g = await makeGame({ virtualTime: true }); t.after(g.close);
  const town = settleGame(g); town.name = 'Saved bank'; g.window.planet.day = 77;
  const save = plain(g.window.generateSave()), before = JSON.stringify(save);
  const directory = join(mkdtempSync(join(tmpdir(), 'gentown-harness-save-')), 'run');
  const { report } = await runCampaign({ days: 5, seed: 7, policy: 'skip', directory, save });
  assert.notEqual(report.status, 'failed', report.failure);
  assert.equal(report.startDay, 77); assert.equal(report.final.worlds[0].day, 82);
  assert.equal(report.foundingSite, undefined);
  assert.equal(report.initial.worlds[0].towns.find(t => t.id === town.id).name, 'Saved bank');
  assert.equal(JSON.stringify(save), before);
  const restored = await makeGame({ save: JSON.parse(readFileSync(join(directory, 'final.planet'))) }); t.after(restored.close);
  assert.equal(restored.window.planet.day, 82);
  assert.equal(restored.window.regGet('town', town.id).pop, report.final.worlds[0].towns.find(t => t.id === town.id).pop);
  assert.deepEqual(restored.errors, []);
});

test('invariants allow cash debt but catch impossible people, goods and nonfinite values', async t => {
  const g = await makeGame({ virtualTime: true }); t.after(g.close); const town = settleGame(g);
  town.resources.cash = -5; town.wealth = -20; checkInvariants(g.window);
  town.resources.clay = -1; assert.throws(() => checkInvariants(g.window), /resource.clay is negative/);
  town.resources.clay = NaN; assert.throws(() => checkInvariants(g.window), /resource.clay is not finite/);
  town.resources.clay = 0; town.pop = Infinity; assert.throws(() => checkInvariants(g.window), /population is not finite/);
  town.pop=2;town.jobs={farmer:3};assert.throws(()=>checkInvariants(g.window),/workers exceed/);
  town.jobs={};g.window.GenTownLocal.errors.push('Could not save to this browser (QuotaExceededError)');
  assert.throws(()=>checkInvariants(g.window),/QuotaExceededError/);
});

test('missing live controls are reported without granting their consequence', async t => {
  const g = await makeGame({ virtualTime: true }); t.after(g.close); settleGame(g);
  g.window.currentEvents.probe = { eventClass: 'invisibleProbe', needsInput: true, message: null, args: {} };
  const records = []; answerChoices(g.window, 'yes', () => 0, e => records.push(e));
  assert.equal(records[0].kind, 'unavailable-choice'); assert.equal(records[0].event, 'invisibleProbe');
  assert.equal(g.window.currentEvents.probe.done, undefined);
});

test('virtual timers keep ordinary campaign consequences equal to the real-timer bootstrap', async t => {
  const summaries = [];
  for (const virtualTime of [false, true]) {
    const g = await makeGame({ seed: 7, virtualTime }); t.after(g.close); settleGame(g);
    for (let i = 0; i < 8; i++) {
      g.window.nextDay(); answerChoices(g.window, 'yes', () => 0.8, () => {});
      if (virtualTime) g.clock.advance(1000);
      else await new Promise(resolve => setTimeout(resolve, 50));
    }
    const state = campaignSnapshot(g.window);
    summaries.push(state.worlds.map(w => ({ day: w.day, population: w.population, unlocks: w.sharedUnlocks,
      towns: w.towns.map(t => ({ name: t.name, pop: t.pop, resources: t.resources, jobs: t.jobs, hunger: t.hunger })) })));
    assert.deepEqual(g.errors, []); assert.deepEqual(g.warnings, []);
  }
  assert.deepEqual(summaries[0], summaries[1]);
});

test('a day that advances twice fails with its actual exported state', async () => {
  const { report } = await runCampaign({ days: 5, gameFactory: async options => {
    const g = await makeGame(options), base = g.window.nextDay;
    g.window.nextDay = (...args) => { base(...args); return base(...args); };
    return g;
  } });
  assert.equal(report.status, 'failed'); assert.match(report.failure, /expected exactly one day/);
  assert.equal(report.final.worlds[0].day, report.startDay + 2);
});

test('reached inactive worlds advance through their own native daily simulation', async t => {
  const g = await makeGame({ virtualTime: true }), w = g.window; t.after(g.close); settleGame(g);
  const visit = id => {
    w.document.getElementById('actionItem-solar').click();
    w.document.querySelector(`[data-world-id="${id}"]`).click();
    [...w.document.querySelectorAll('#actionSubList [role=button]')].find(b => b.textContent.includes('Switch to world')).click();
  };
  const away = w._paultendoUniverse.worlds[2]; away.discovered = true; away.reached = true;
  visit(2);
  const chunk = w.filterChunks(c => !c.v.s && c.b !== 'water' && c.b !== 'mountain')[0];
  const town = w.happen('Create', null, null, { x: chunk.x, y: chunk.y }, 'town');
  w.happen('Explore', null, null, { x: chunk.x, y: chunk.y });
  town.name = 'Harness moon';
  visit(1);
  const { report } = await runCampaign({ days: 8, policy: 'skip', save: plain(w.generateSave()) });
  assert.notEqual(report.status, 'failed', report.failure);
  assert.equal(report.final.worlds.length, 2);
  for (const world of report.final.worlds) assert.equal(world.day, report.initial.worlds.find(w => w.id === world.id).day + 8);
});

test('an extra day hidden in a deferred callback also fails the one-turn check', async () => {
  const { report } = await runCampaign({ days: 5, gameFactory: async options => {
    const g = await makeGame(options), base = g.window.nextDay;
    g.window.nextDay = (...args) => { const result = base(...args); g.window.setTimeout(() => base(), 10); return result; };
    return g;
  } });
  assert.equal(report.status, 'failed'); assert.match(report.failure, /exactly one day including timers/);
  assert.equal(report.final.worlds[0].day, report.startDay + 2);
});
