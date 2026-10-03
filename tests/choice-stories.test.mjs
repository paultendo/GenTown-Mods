import test from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, settleGame } from './harness.mjs';

function propose(window, town, eventClass, values = {}) {
  const caller = window.readyEvent(eventClass, window.regGet('player', 1), town);
  assert.ok(caller, `${eventClass} must be eligible`);
  Object.assign(caller.args, values);
  const message = window.gameEvents[eventClass].message;
  caller.message = typeof message === 'function' ? message(caller.subject, caller.target, caller.args) : message;
  const choose = window.chooseEvent, ready = window.readyEvent;
  window.chooseEvent = () => eventClass;
  window.readyEvent = (key, ...args) => key === eventClass ? caller : ready(key, ...args);
  try { window.nextDay(); } finally { window.chooseEvent = choose; window.readyEvent = ready; }
  return window.document.getElementById('logMessage-' + caller.logID);
}

function openStory(window, town, title, day) {
  window.openRegBrowser(town, 'town');
  [...window.document.querySelectorAll('.paultendoTownLife button')].find(b => b.textContent === 'Your mark on this town').click();
  const list = window.document.getElementById('actionSubList');
  const chapter = [...list.querySelectorAll('[role="button"]')].find(b => b.textContent.includes(title) && (day === undefined || b.textContent.startsWith(`Day ${day} ·`)));
  assert.ok(chapter, `The ${title} story must be selectable`);
  chapter.click();
  return list;
}

test('a discovery choice becomes one playable story with its actual adoption and first harvest', async t => {
  const game = await makeGame(); t.after(game.close);
  const {window} = game; const town = settleGame(game);
  const levelData = window.unlockTree.farm.levels[0];
  propose(window, town, 'unlockLevel', {value:{type:'farm',levelData}}).querySelector('[type="yes"]').click();
  const decision = window.planet._paultendoLife.decisions[0];
  const discovery = window.planet._paultendoLife.discoveries['farm:10'];
  assert.equal(discovery.decision, decision.id);
  for (let n = 0; n < 60 && !window.planet._paultendoLife.moments.some(m => m.text.includes('takes root')); n++) window.nextDay();
  window.gameEvents.townFarm.func(town, null, {value:50});
  window.nextDay();
  const moments = window.planet._paultendoLife.moments.filter(m => m.source === decision.id);
  assert.ok(moments.some(m => m.text.includes('takes root')));
  assert.ok(moments.some(m => m.text.includes('first harvest')));
  let story = openStory(window, town, 'Agriculture');
  assert.match(story.textContent, /Your choice: Yes.*What followed.*takes root.*first harvest/s);
  [...story.querySelectorAll('[role="button"]')].find(b => b.textContent === 'Explore Agriculture').click();
  assert.match(story.textContent, /A seed kept through winter/);
  const restored = await makeGame({save:JSON.parse(JSON.stringify(window.generateSave()))}); t.after(restored.close);
  story = openStory(restored.window, restored.window.regGet('town', town.id), 'Agriculture');
  assert.match(story.textContent, /What followed.*first harvest/s);
  assert.equal(restored.window.planet._paultendoLife.discoveries['farm:10'].decision, decision.id);
  assert.deepEqual(game.errors, []); assert.deepEqual(restored.errors, []);
});

test('a law story distinguishes the original choice from the town’s current rules through reload', async t => {
  const game = await makeGame(); t.after(game.close);
  const {window} = game; const town = settleGame(game);
  window.planet.unlocks.government = 10;
  propose(window, town, 'townLaw', {value:'farm', name:'farming', influence:'farm', result:false}).querySelector('[type="yes"]').click();
  const originalDay = window.planet.day;
  let story = openStory(window, town, 'Farming law');
  assert.match(story.textContent, /Today.*Farming is still forbidden here/s);
  assert.equal(town.legal.farm, false);
  propose(window, town, 'townLaw', {value:'farm', name:'farming', influence:'farm', result:true}).querySelector('[type="yes"]').click();
  story = openStory(window, town, 'Farming law', originalDay);
  assert.match(story.textContent, /Today.*Farming is allowed here now/s);
  assert.match(story.textContent, /Your choice: Yes/);
  const restored = await makeGame({save:JSON.parse(JSON.stringify(window.generateSave()))}); t.after(restored.close);
  story = openStory(restored.window, restored.window.regGet('town', town.id), 'Farming law', originalDay);
  assert.match(story.textContent, /Farming is allowed here now/);
  assert.deepEqual(game.errors, []); assert.deepEqual(restored.errors, []);
});

test('healthcare guidance remembers a real refusal as well as later acceptance without inventing a policy', async t => {
  const game = await makeGame(); t.after(game.close);
  const {window} = game; const town = settleGame(game);
  window.planet.unlocks.education = 40; town.pop = 80;
  let entry = propose(window, town, 'establishHealthcare');
  const random = window.Math.random;
  window.Math.random = () => 0.99;
  try { entry.querySelector('[type="yes"]').click(); } finally { window.Math.random = random; }
  assert.equal(window.planet._paultendoLife.decisions[0].received, false);
  assert.notEqual(town.publicHealthcare, true);
  let story = openStory(window, town, 'Care for the sick');
  assert.match(story.textContent, /The nudge did not take hold/);
  assert.doesNotMatch(story.textContent, /Public healthcare still serves/);
  window.planet.day += 61;
  entry = propose(window, town, 'establishHealthcare');
  window.Math.random = () => 0;
  try { entry.querySelector('[type="yes"]').click(); } finally { window.Math.random = random; }
  assert.equal(town.publicHealthcare, true);
  assert.equal(window.planet._paultendoLife.decisions.at(-1).received, true);
  story = openStory(window, town, 'Care for the sick');
  assert.match(story.textContent, /Today.*Public healthcare still serves the town/s);
  const restored = await makeGame({save:JSON.parse(JSON.stringify(window.generateSave()))}); t.after(restored.close);
  story = openStory(restored.window, restored.window.regGet('town', town.id), 'Care for the sick');
  assert.match(story.textContent, /Public healthcare still serves/);
  assert.deepEqual(game.errors, []); assert.deepEqual(restored.errors, []);
});

test('research stories follow changing priorities and legacy choices keep their unknown consequences', async t => {
  const game = await makeGame(); t.after(game.close);
  const {window} = game; const town = settleGame(game);
  window.planet.unlocks.farm = 10; window.planet.unlocks.education = 10;
  town.research.farm = 10;
  propose(window, town, 'increaseResearch', {value:'education'}).querySelector('[type="yes"]').click();
  let story = openStory(window, town, 'Education research');
  assert.match(story.textContent, /Education still leads the town’s research/);
  town.research.farm = 100;
  story = openStory(window, town, 'Education research');
  assert.match(story.textContent, /Farming now leads the town’s research/);
  const decision = window.planet._paultendoLife.decisions[0];
  delete decision.traces; delete decision.received;
  decision.question = '<img src=x onerror=alert(1)> A former suggestion';
  const restored = await makeGame({save:JSON.parse(JSON.stringify(window.generateSave()))}); t.after(restored.close);
  story = openStory(restored.window, restored.window.regGet('town', town.id), 'Education research');
  assert.match(story.textContent, /A former suggestion/);
  assert.equal(story.querySelector('img'), null);
  assert.doesNotMatch(story.textContent, /Today|nudge did not take hold/);
  assert.deepEqual(game.errors, []); assert.deepEqual(restored.errors, []);
});
