import test from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, settleGame, fakeTimers } from './harness.mjs';

// Queue a specified proposal through native Next Day, then use its real UI callbacks.
function propose(window, town, eventClass, value) {
  const caller = window.readyEvent(eventClass, window.regGet('player', 1), town);
  assert.ok(caller, `Native ${eventClass} must be eligible`);
  caller.args.value = value;
  const message = window.gameEvents[eventClass].message;
  caller.message = typeof message === 'function' ? message(caller.subject, caller.target, caller.args) : message;
  const choose = window.chooseEvent;
  const ready = window.readyEvent;
  window.chooseEvent = () => eventClass;
  window.readyEvent = (key, ...args) => key === eventClass ? caller : ready(key, ...args);
  try { window.nextDay(); } finally { window.chooseEvent = choose; window.readyEvent = ready; }
  assert.ok(window.currentEvents[caller.eventID], 'Native proposal must remain available to answer');
  return window.document.getElementById('logMessage-' + caller.logID);
}

function nativeUnlock(window, town, key, index = 0) {
  return propose(window, town, 'unlockLevel', { type: key, levelData: window.unlockTree[key].levels[index] });
}

function townLife(window, town) {
  window.openRegBrowser(town, 'town');
  return window.document.querySelector('#regContent .paultendoTownLife');
}

test('towns open with real activity and unlocked discovery links without formatter crashes', async t => {
  const game = await makeGame(); t.after(game.close);
  const { window } = game; const town = settleGame(game);
  window.planet.unlocks.farm = 10;
  town.jobs.farmer = 5; town.resources.crop = 27;
  window.updateStats();
  const panel = townLife(window, town);
  assert.match(panel.textContent, /5 farmers tend the fields/);
  assert.match(panel.textContent, /27 crops/);
  assert.doesNotMatch(panel.textContent, /livestock|Husbandry|Your mark/);
  panel.querySelector('button').click();
  const detail = window.document.getElementById('actionSubList');
  assert.match(detail.textContent, /A seed kept through winter/);
  assert.match(detail.textContent, new RegExp('In ' + town.name));
  assert.match(detail.textContent, /5 farmers/);
  assert.deepEqual(game.errors, []);
});

test('Agriculture records the answered choice and first real adoption, once, through reload', async t => {
  const game = await makeGame(); t.after(game.close);
  const { window } = game; const town = settleGame(game);
  const entry = nativeUnlock(window, town, 'farm');
  assert.match(entry.querySelector('.paultendoDecisionPreview').textContent, /Yes: Farming gains support/);
  assert.match(entry.querySelector('.paultendoDecisionPreview').textContent, /No: Farming loses support/);
  town.influences.farm = 0;
  entry.querySelector('[type="yes"]').click();
  const state = window.planet._paultendoLife;
  assert.equal(state.decisions.length, 1);
  assert.equal(state.decisions[0].outcome, 'Yes');
  assert.equal(state.discoveries['farm:10'].origin, town.id);
  assert.equal(state.discoveries['farm:10'].day, window.planet.day);
  assert.match(entry.querySelector('.paultendoDecisionEcho').textContent, /Farming gains support/);
  assert.equal(entry.querySelector('.paultendoDecisionPreview'), null);
  for (let n = 0; n < 60 && !state.moments.some(m => m.discovery === 'farm:10'); n++) window.nextDay();
  const moment = state.moments.find(m => m.discovery === 'farm:10');
  assert.ok(moment, 'The simulation must hire farmers before announcing adoption');
  assert.ok(town.jobs.farmer > 0);
  assert.match(moment.text, /Agriculture.*takes root/);
  assert.equal(state.moments.filter(m => m.discovery === 'farm:10').length, 1);
  const save = JSON.parse(JSON.stringify(window.generateSave()));
  const restored = await makeGame({ save }); t.after(restored.close);
  const restoredTown = restored.window.regGet('town', town.id);
  const panel = townLife(restored.window, restoredTown);
  const history = [...panel.querySelectorAll('button')].find(button => button.textContent === 'Your mark on this town');
  assert.ok(history); history.click();
  assert.match(restored.window.document.getElementById('actionSubList').textContent, /Your choice: Yes/);
  for (let n = 0; n < 3; n++) restored.window.nextDay();
  assert.equal(restored.window.planet._paultendoLife.moments.filter(m => m.discovery === 'farm:10').length, 1);
  assert.deepEqual(game.errors, []); assert.deepEqual(restored.errors, []);
});

test('rejected and ignored discoveries do not invent unlocks, jobs, or player choices', async t => {
  const game = await makeGame(); t.after(game.close);
  const { window } = game; const town = settleGame(game);
  const entry = nativeUnlock(window, town, 'farm');
  entry.querySelector('[type="no"]').click();
  assert.equal(window.planet.unlocks.farm, undefined);
  assert.equal(window.planet._paultendoLife.decisions[0].outcome, 'No');
  assert.equal(window.planet._paultendoLife.discoveries['farm:10'], undefined);
  assert.match(window.planet._paultendoLife.decisions[0].text, /Hunting and gathering prevail/);
  const ignored = nativeUnlock(window, town, 'smith');
  window.nextDay();
  assert.equal(ignored.getAttribute('done'), 'true');
  assert.equal(window.planet._paultendoLife.decisions.length, 1);
  assert.equal(window.planet.unlocks.smith, undefined);
  assert.deepEqual(game.errors, []);
});

test('existing saves show current life without inventing discovery dates or past choices', async t => {
  const game = await makeGame(); t.after(game.close);
  const { window } = game; const town = settleGame(game);
  window.planet.unlocks.farm = 10; town.jobs.farmer = 8;
  delete window.planet._paultendoLife;
  const restored = await makeGame({ save: JSON.parse(JSON.stringify(window.generateSave())) }); t.after(restored.close);
  const state = restored.window.planet._paultendoLife;
  assert.equal(state.discoveries['farm:10'].day, null);
  assert.equal(state.discoveries['farm:10'].origin, null);
  assert.equal(state.decisions.length, 0);
  assert.equal(state.moments.length, 0);
  assert.match(townLife(restored.window, restored.window.regGet('town', town.id)).textContent, /8 farmers/);
  for (let n = 0; n < 4; n++) restored.window.nextDay();
  assert.equal(state.moments.filter(m => m.discovery === 'farm:10').length, 0, 'Existing farmers are not a new adoption');
  assert.deepEqual(restored.errors, []);
});

test('fields follow real jobs, farming law, visibility and map views without erasing terrain', async t => {
  const game = await makeGame(); t.after(game.close);
  const { window } = game; const town = settleGame(game);
  window.planet.unlocks.farm = 10; town.jobs.farmer = 8;
  const townChunk = window.filterChunks(c => c.v.s === town.id && !c.v.m && !window.biomes[c.b]?.infertile && c.b !== 'water' && c.b !== 'mountain')[0];
  assert.ok(townChunk);
  const canvas = window.canvasLayers.townLife;
  const draws = [];
  window.canvasLayersCtx.townLife.fillRect = (...args) => draws.push(args);
  const width = Object.getOwnPropertyDescriptor(window.HTMLCanvasElement.prototype, 'width');
  let clears = 0;
  Object.defineProperty(window.canvasLayers.terrain, 'width', {get() {return width.get.call(this)}, set(value) { clears++; width.set.call(this, value); }});
  window.currentView = 'territory'; window.renderMap();
  assert.ok(draws.length > 0);
  assert.equal(window.document.getElementById('paultendoFieldsKey').hidden, false);
  assert.equal(canvas.width, window.planet.config.width);
  assert.equal(canvas.height, window.planet.config.height);
  assert.equal(clears, 0);
  const positions = JSON.stringify(draws); draws.length = 0;
  window.renderMap(); assert.equal(JSON.stringify(draws), positions, 'Fields keep their places when redrawn');
  draws.length = 0; window.currentView = 'temperature'; window.renderMap();
  assert.equal(draws.length, 0); assert.equal(window.document.getElementById('paultendoFieldsKey').hidden, true);
  window.currentView = 'territory'; town.legal.farm = false; window.renderMap();
  assert.equal(draws.length, 0); assert.match(townLife(window, town).textContent, /farming is forbidden/);
  town.legal.farm = true;
  window.planet.day = 20;
  window.planet._paultendoFog.visible = {};
  window.planet._paultendoFog.dirty = false;
  window.renderMap(); assert.equal(draws.length, 0);
  town._hidden = true; window.renderMap(); assert.equal(draws.length, 0);
  town.jobs.farmer = 0; window.renderMap(); assert.equal(draws.length, 0);
  assert.deepEqual(game.errors, []);
});

test('construction follows the approved process to its own finished landmark', async t => {
  const game = await makeGame(); t.after(game.close);
  const { window } = game; const town = settleGame(game);
  window.planet.unlocks.smith = 10;
  for (let n = 0; n < 30 && town.size <= 5; n++) window.nextDay();
  const entry = propose(window, town, 'townProjectStart', 'park');
  assert.match(entry.querySelector('.paultendoDecisionPreview').textContent, /Construction of a park begins/);
  entry.querySelector('[type="yes"]').click();
  const record = window.planet._paultendoLife.decisions[0];
  assert.equal(record.title, 'A new park');
  assert.equal(record.projects.length, 1);
  const process = window.regGet('process', record.projects[0].id);
  assert.match(townLife(window, town).textContent, /Under construction: park/);
  // Give this test project a known owned site so native Finish can place the building.
  const site = window.filterChunks(c => c.v.s === town.id && !c.v.m)[0];
  process.x = site.x; process.y = site.y;
  window.happen('Finish', null, process, {});
  const marker = window.regGet('marker', process.marker);
  assert.equal(marker.process, process.id);
  window.nextDay();
  const moment = window.planet._paultendoLife.moments.find(m => m.source === record.id);
  assert.ok(moment); assert.match(moment.text, /park approved on Day .* now stands/);
  assert.match(townLife(window, town).textContent, /Built here: park/);
  window.nextDay();
  assert.equal(window.planet._paultendoLife.moments.filter(m => m.source === record.id).length, 1);
  assert.deepEqual(game.errors, []);
});

test('a project with no building cannot borrow another project’s completion', async t => {
  const game = await makeGame(); t.after(game.close);
  const { window } = game; const town = settleGame(game);
  window.planet.unlocks.smith = 10;
  for (let n = 0; n < 30 && town.size <= 5; n++) window.nextDay();
  const entry = propose(window, town, 'townProjectStart', 'park'); entry.querySelector('[type="yes"]').click();
  const decision = window.planet._paultendoLife.decisions[0];
  const process = window.regGet('process', decision.projects[0].id);
  process.done = window.planet.day;
  const site = window.filterChunks(c => c.v.s === town.id)[0];
  window.happen('Create', null, null, {type:'landmark',subtype:'park',x:site.x,y:site.y}, 'marker');
  window.nextDay();
  assert.equal(window.planet._paultendoLife.moments.some(m => m.source === decision.id), false);
  assert.deepEqual(game.errors, []);
});

test('research choices update the town’s story with the actual priority', async t => {
  const game = await makeGame(); t.after(game.close);
  const { window } = game; const town = settleGame(game);
  window.planet.unlocks.farm = 10; window.planet.unlocks.education = 10;
  town.research.farm = 10;
  const entry = propose(window, town, 'increaseResearch', 'education');
  assert.match(entry.querySelector('.paultendoDecisionPreview').textContent, /High: Education becomes/);
  entry.querySelector('[type="yes"]').click();
  const choice = window.planet._paultendoLife.decisions[0];
  assert.equal(choice.outcome, 'High'); assert.equal(choice.title, 'Education research');
  assert.match(townLife(window, town).textContent, /Research favours education/);
  town.jobs.scholar = 1;
  assert.match(townLife(window, town).textContent, /1 scholar works here/);
  assert.ok(choice.towns.includes(town.id));
  assert.deepEqual(game.errors, []);
});

test('automatic choices are remembered as autoplay rather than attributed to the player', async t => {
  const game = await makeGame({ settings: { paultendoAutoplayAutoDecide: 8 } }); t.after(game.close);
  const { window } = game; const town = settleGame(game);
  nativeUnlock(window, town, 'farm');
  const clock = fakeTimers(window);
  window.document.getElementById('paultendoAutoplayToggle').click();
  clock.run(window._paultendoAutoplay.timer);
  assert.ok(window._paultendoAutoplay.logTimer);
  clock.run(window._paultendoAutoplay.logTimer);
  const choice = window.planet._paultendoLife.decisions[0];
  assert.ok(choice); assert.equal(choice.automated, true);
  const panel = townLife(window, town);
  [...panel.querySelectorAll('button')].find(b => b.textContent === 'Your mark on this town').click();
  assert.match(window.document.getElementById('actionSubList').textContent, /Autoplay chose/);
  assert.deepEqual(game.errors, []);
});

test('first harvests follow actual production and keep their day through reload', async t => {
  const game = await makeGame(); t.after(game.close);
  const { window } = game; const town = settleGame(game);
  nativeUnlock(window, town, 'farm').querySelector('[type="yes"]').click();
  const discovery = window.planet._paultendoLife.discoveries['farm:10'];
  // A gift or trade can fill the stores, but cannot create a harvest story.
  window.happen('AddResource', null, town, {type:'crop', count:50});
  assert.equal(discovery.towns[town.id].firstProduce, undefined);
  town.legal.farm = false;
  window.gameEvents.townFarm.func(town, null, {value:100});
  assert.equal(discovery.towns[town.id].firstProduce, undefined);
  town.legal.farm = true;
  const day = window.planet.day;
  const before = town.resources.crop;
  window.gameEvents.townFarm.func(town, null, {value:100});
  const harvest = discovery.towns[town.id].firstProduce;
  assert.equal(harvest.day, day);
  assert.equal(harvest.count, town.resources.crop - before);
  assert.ok(harvest.count > 0);
  const save = JSON.parse(JSON.stringify(window.generateSave()));
  const restored = await makeGame({save}); t.after(restored.close);
  restored.window.nextDay();
  const moments = restored.window.planet._paultendoLife.moments.filter(m => m.discovery === 'farm:10' && /first harvest/.test(m.text));
  assert.equal(moments.length, 1); assert.equal(moments[0].day, day);
  const panel = townLife(restored.window, restored.window.regGet('town', town.id));
  panel.querySelector('button').click();
  assert.match(restored.window.document.getElementById('actionSubList').textContent, /From the Chronicle.*first harvest/s);
  for (let i = 0; i < 3; i++) restored.window.nextDay();
  assert.equal(restored.window.planet._paultendoLife.moments.filter(m => /first harvest/.test(m.text)).length, 1);
  assert.deepEqual(game.errors, []); assert.deepEqual(restored.errors, []);
});

test('Husbandry waits for actual taming and reports at most one follow-up per day', async t => {
  const game = await makeGame(); t.after(game.close);
  const { window } = game; const town = settleGame(game);
  nativeUnlock(window, town, 'farm').querySelector('[type="yes"]').click();
  window.gameEvents.townFarm.func(town, null, {value:100});
  nativeUnlock(window, town, 'farm', 1).querySelector('[type="yes"]').click();
  const observation = window.planet._paultendoLife.discoveries['farm:20'].towns[town.id];
  assert.equal(observation.firstProduce, undefined);
  town.legal.farm = false;
  window.gameEvents.townTame.func(town, null, {value:100});
  assert.equal(observation.firstProduce, undefined);
  town.legal.farm = true;
  const before = town.resources.livestock || 0;
  window.gameEvents.townTame.func(town, null, {value:100});
  assert.ok(observation.firstProduce.count > 0);
  assert.equal(observation.firstProduce.count, town.resources.livestock - before);
  for (let i = 0; i < 5 && !window.planet._paultendoLife.moments.some(m => m.discovery === 'farm:20'); i++) window.nextDay();
  const moment = window.planet._paultendoLife.moments.find(m => m.discovery === 'farm:20');
  assert.match(moment.text, /began keeping animals/);
  const dailyCounts = {};
  for (const node of window.document.querySelectorAll('.logMessage')) {
    if (!node.textContent.includes('first harvest') && !node.textContent.includes('began keeping animals')) continue;
    const day = node.querySelector('.logDay')?.dataset.day; dailyCounts[day] = (dailyCounts[day] || 0) + 1;
  }
  assert.ok(Object.values(dailyCounts).every(count => count === 1));
  assert.deepEqual(game.errors, []);
});

test('upgrading a dated discovery from v32 does not invent its first harvest', async t => {
  const game = await makeGame(); t.after(game.close);
  const { window } = game; const town = settleGame(game);
  nativeUnlock(window, town, 'farm').querySelector('[type="yes"]').click();
  const observation = window.planet._paultendoLife.discoveries['farm:10'].towns[town.id];
  delete observation.produceReported; delete observation.firstProduce;
  town.jobs.farmer = 10; observation.reported = true;
  const restored = await makeGame({save:JSON.parse(JSON.stringify(window.generateSave()))}); t.after(restored.close);
  const restoredTown = restored.window.regGet('town', town.id);
  restored.window.gameEvents.townFarm.func(restoredTown, null, {value:100});
  restored.window.nextDay();
  assert.equal(restored.window.planet._paultendoLife.moments.some(m => /first harvest/.test(m.text)), false);
  assert.deepEqual(restored.errors, []);
});

test('town landmarks and trade neighbours can be visited without exposing hidden towns', async t => {
  const game = await makeGame(); t.after(game.close);
  const { window } = game; const town = settleGame(game);
  const site = window.filterChunks(c => c.v.s === town.id)[0];
  const marker = window.happen('Create', null, null, {type:'landmark',subtype:'park',x:site.x,y:site.y}, 'marker');
  const free = window.filterChunks(c => !c.v.s && c.b !== 'water' && c.b !== 'mountain')[0];
  const partner = window.happen('Create', null, null, {x:free.x,y:free.y}, 'town');
  partner.name = 'Neighbour';
  window.planet.tradeRoutes = [{id:1,town1:town.id,town2:partner.id,active:true}];
  let panel = townLife(window, town);
  assert.match(panel.textContent, /Trade routes link here with Neighbour/);
  const visit = [...panel.querySelectorAll('button')].find(b => b.textContent === 'Visit Neighbour');
  assert.ok(visit); visit.click();
  assert.equal(window.document.querySelector('#regContent .regTitle').textContent, partner.name);
  panel = townLife(window, town);
  const park = [...panel.querySelectorAll('button')].find(b => b.textContent === 'Visit the park');
  assert.ok(park); park.click();
  assert.match(window.document.querySelector('#regContent').textContent, /Park/);
  partner._hidden = true;
  panel = townLife(window, town);
  assert.doesNotMatch(panel.textContent, /Neighbour/);
  marker.end = window.planet.day;
  assert.doesNotMatch(townLife(window, town).textContent, /Visit the park/);
  assert.deepEqual(game.errors, []);
});
