import test from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, settleGame } from './harness.mjs';
import { answerChoices } from '../scripts/lib/campaign.mjs';

test('self-reporting random events cannot leave an invisible player decision', async t => {
  const g = await makeGame({ virtualTime: true }); t.after(g.close);
  const invisible = Object.entries(g.window.randomEvents).filter(([, info]) =>
    info.random === true && !info.auto && !info.message && !info.value?.ask && !info.value?.choose);
  assert.deepEqual(invisible.map(([id]) => id), []);
  for (const id of ['famine', 'economicMigration', 'disasterRefugees', 'coastalFishing'])
    assert.equal(g.window.gameEvents[id].auto, true, id);
});

test('retired events stay out of native random selection after rebuilding the event catalog',async t=>{
  const g=await makeGame({virtualTime:true});t.after(g.close);const w=g.window;
  assert.equal(w.randomEvents.townSecession,undefined,'initial mod registration excludes retired events');
  assert.equal(w.randomEvents.religiousSchism,undefined,'initial mod registration excludes retired events');
  for(let i=0;i<2;i++){
    w.finalizeEvents();
    assert.equal(w.gameEvents.townSecession.random,false);
    assert.equal(w.randomEvents.townSecession,undefined);
    assert.equal(w.randomEvents.religiousSchism,undefined);
    assert.ok(w.randomEvents.unlockLevel,'real native discoveries remain eligible');
    assert.deepEqual(Object.entries(w.randomEvents).filter(([,event])=>event.random===false),[]);
  }
  assert.deepEqual(g.errors,[]);
});

test('an autonomous event runs once under independent rule, including deferred native timers', async t => {
  const g = await makeGame({ virtualTime: true }); t.after(g.close);
  const w = g.window, town = settleGame(g);
  town.usurp = true;
  // Isolate selection from geography. Keep the registered consequence and
  // native readyEvent/nextDay dispatch, including the former failing timer.
  const info = w.gameEvents.coastalFishing, base = info.func;
  let calls = 0;
  info.check = () => true;
  info.func = (...args) => { calls++; return base(...args); };
  const caller = w.readyEvent('coastalFishing', town);
  const ready = w.readyEvent, choose = w.chooseEvent;
  w.chooseEvent = () => 'coastalFishing';
  w.readyEvent = (id, ...args) => id === 'coastalFishing' ? caller : ready(id, ...args);
  try { w.nextDay(); g.clock.advance(1000); }
  finally { w.readyEvent = ready; w.chooseEvent = choose; }
  assert.equal(calls, 1);
  assert.equal(caller.done, true);
  assert.equal(!!caller.needsInput, false);
  assert.deepEqual(g.errors, []);
  assert.deepEqual(g.warnings, []);
});

test('real proposals keep their live choice and skipping does not grant a discovery', async t => {
  const g = await makeGame({ virtualTime: true }); t.after(g.close);
  const w = g.window, town = settleGame(g);
  assert.notEqual(w.gameEvents.swayFestival.auto, true);
  const caller = w.readyEvent('unlockLevel', w.regGet('player', 1), town);
  caller.args.value = {type: 'farm', levelData: w.unlockTree.farm.levels[0]};
  caller.message = w.gameEvents.unlockLevel.message(caller.subject, caller.target, caller.args);
  const ready = w.readyEvent, choose = w.chooseEvent;
  w.chooseEvent = () => 'unlockLevel';
  w.readyEvent = (id, ...args) => id === 'unlockLevel' ? caller : ready(id, ...args);
  try { w.nextDay(); } finally { w.readyEvent = ready; w.chooseEvent = choose; }
  const row = w.document.getElementById('logMessage-' + caller.logID);
  assert.equal(row.querySelectorAll('.logAct [type]').length, 2);
  answerChoices(w, 'skip', () => 0, () => {});
  g.clock.advance(1000);
  assert.equal(!!caller.done, false);
  assert.equal(w.planet.unlocks.farm, undefined);
  answerChoices(w, 'yes', () => 0, () => {});
  assert.equal(caller.done, true);
  assert.equal(w.planet.unlocks.farm, 10);
  assert.deepEqual(g.errors, []);
});
