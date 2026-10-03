import test from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, settleGame, fakeTimers } from './harness.mjs';

test('bundled game and overhaul boot without uncaught errors', async t => {
  const game = await makeGame();
  t.after(game.close);
  assert.equal(game.window.gameLoaded, true);
  assert.deepEqual(game.errors, []);
  assert.equal(game.window.document.getElementById('gameDiv').style.display, 'flex');
  assert.equal(game.window.document.querySelectorAll('#paultendoAutoplayToggle').length, 1);
  const messages = [...game.window.document.querySelectorAll('.logMessage')];
  assert.equal(new Set(messages.map(node => node.id)).size, messages.length);
});

test('a resize before world creation waits safely and normal resize resumes after loading', async t => {
  let resized = 0;
  const game = await makeGame({beforeMod(window) {
    assert.equal(window.planet, null);
    window.addEventListener('resize', () => resized++);
    window.dispatchEvent(new window.Event('resize'));
    assert.equal(resized, 0);
  }});
  t.after(game.close);
  assert.equal(game.window.gameLoaded, true);
  assert.ok(game.window.planet.config);
  game.window.dispatchEvent(new game.window.Event('resize'));
  assert.equal(resized, 1);
  assert.deepEqual(game.errors, []);
  assert.equal(game.window.GenTownLocal.errors.length, 0);
  assert.equal(game.window.document.getElementById('startupError').hidden, true);
});

test('installing after GenTown has loaded initializes the mod and advances a settled world', async t => {
  const game = await makeGame({ mod: 'late' });
  t.after(game.close);
  assert.equal(game.window._paultendoState.loadedVersion, '1.6.60');
  assert.ok(game.window._paultendoUniverse);
  assert.ok(game.lateMapDraws > 0, 'Late installation must redraw the cleared map');
  assert.ok(game.window.document.getElementById('paultendoMapControls'));
  settleGame(game);
  game.window.document.getElementById('nextDay').click();
  assert.equal(game.window.planet.day, 2);
  assert.deepEqual(game.errors, []);
});

test('adding discovery overlays does not erase the terrain or composite canvas', async t => {
  const game = await makeGame();
  t.after(game.close);
  const { window } = game;
  const terrain = window.canvasLayers.terrain;
  const width = Object.getOwnPropertyDescriptor(window.HTMLCanvasElement.prototype, 'width');
  let terrainClears = 0;
  Object.defineProperty(terrain, 'width', { get() { return width.get.call(this); }, set(value) { terrainClears++; width.set.call(this, value); } });
  delete window.canvasLayers.fog;
  delete window.canvasLayers.epidemic;
  window.canvasLayersOrder = window.canvasLayersOrder.filter(name => !['fog', 'epidemic'].includes(name));
  window.renderMap();
  delete window.canvasLayers.roads;
  window.canvasLayersOrder = window.canvasLayersOrder.filter(name => name !== 'roads');
  window.planet.day = 3;
  window.gameEvents.roadNetworkUpdate.func();
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(terrainClears, 0, 'Creating overlays must preserve painted terrain');
  for (const name of ['fog', 'epidemic', 'roads']) {
    assert.equal(window.canvasLayers[name].width, window.planet.config.width);
    assert.equal(window.canvasLayers[name].height, window.planet.config.height);
  }
  assert.deepEqual(game.errors, []);
});

test('repeated initialization keeps one reporting hook and excludes questions and routine days', async t => {
  const game = await makeGame();
  t.after(game.close);
  settleGame(game);
  const { window } = game;
  const message = window.logMessage;
  const executive = window.initExecutive;
  for (let n = 0; n < 3; n++) {
    window.dispatchEvent(new window.Event('tools-initialized'));
    window.initExecutive();
  }
  assert.equal(window.logMessage, message);
  assert.equal(window.initExecutive, executive);
  const state = window._paultendoState.attention;
  state.queue = [];
  const proposal = window.logMessage('Should the people plant seeds?', undefined, { buttons: [{ name: 'Yes', func() {} }] });
  window.logMessage('How should research proceed?');
  window.logMessage('The Sun sets...', 'sunset');
  window.logMessage('An uneventful day.');
  assert.equal(state.queue.length, 0);
  assert.equal(window.document.querySelectorAll('.paultendoBackgroundReport').length, 0);
  assert.equal(window.document.getElementById('logMessage-' + proposal).querySelectorAll('.logAct [role="button"]').length, 1);
  assert.deepEqual(game.errors, []);
});

test('background reports are dated, collapsed, bounded, and retained through reload', async t => {
  const game = await makeGame();
  t.after(game.close);
  settleGame(game);
  const { window } = game;
  window.planet.day = 6;
  window._paultendoState.attention.queue = Array.from({ length: 6 }, (_, index) => ({ day: 5, text: `A distant caravan arrives ${index}.`, towns: [] }));
  window.logMessage('A new day begins.');
  const report = window.document.querySelector('.paultendoBackgroundReport');
  assert.ok(report);
  assert.equal(report.querySelector('.logDay').dataset.day, '6');
  assert.match(report.querySelector('summary').textContent, /No action needed/);
  assert.equal(report.querySelector('details').open, false);
  assert.equal(report.querySelectorAll('li').length, 3);
  const saved = JSON.parse(JSON.stringify(window.generateSave()));
  const restored = await makeGame({ save: saved });
  t.after(restored.close);
  assert.equal(restored.window.document.querySelector('.paultendoBackgroundReport details').open, false);
  assert.deepEqual(game.errors, []);
  assert.deepEqual(restored.errors, []);
});

test('opening Unlocks clears its alert and discoveries open stories and effects', async t => {
  const game = await makeGame();
  t.after(game.close);
  const { window } = game;
  settleGame(game);
  window.planet.unlocks.farm = 10;
  window.unlockExecutive('unlocks');
  const button = window.document.getElementById('actionItem-unlocks');
  assert.ok(button.classList.contains('notify'));
  button.querySelector('span')?.click();
  if (button.classList.contains('notify')) button.click();
  assert.equal(button.classList.contains('notify'), false);
  const agriculture = [...window.document.querySelectorAll('#actionSubList .actionItem')].find(node => node.textContent === 'Agriculture');
  assert.equal(agriculture.getAttribute('role'), 'button');
  agriculture.click();
  const text = window.document.getElementById('actionSubList').textContent;
  assert.match(text, /Crops quickly become a popular product/);
  assert.match(text, /Farming gains support/);
  const numbers = window.document.querySelector('.paultendoDiscoveryNumbers');
  assert.equal(numbers.open, false);
  assert.match(numbers.textContent, /Farming: \+1 influence/);
  assert.match(text, /Enables farmer jobs/);
  window.document.querySelector('#actionSubList [role="button"]').click();
  assert.match(window.document.getElementById('actionSubList').textContent, /Select a discovery/);
  assert.deepEqual(game.errors, []);
});

test('advanced menus follow discoveries and persist their read notification state', async t => {
  const game = await makeGame();
  t.after(game.close);
  const { window } = game;
  settleGame(game);
  for (const id of ['economy', 'stance', 'solar', 'festivals']) assert.equal(window.document.getElementById('actionItem-' + id).style.display, 'none');
  window.planet.unlocks.trade = 10;
  window.planet.unlocks.astronomy = 10;
  window.planet.religions = [{ id: 1, name: 'The River Faith' }];
  window.updateStats();
  for (const id of ['economy', 'stance', 'solar']) {
    const button = window.document.getElementById('actionItem-' + id);
    assert.equal(button.hidden, false);
    assert.ok(button.classList.contains('notify'));
    button.click();
    window.closeExecutive();
    window.updateStats();
    assert.equal(button.classList.contains('notify'), false);
  }
  const saved = JSON.parse(JSON.stringify(window.generateSave()));
  const restored = await makeGame({ save: saved });
  t.after(restored.close);
  assert.equal(restored.window.document.getElementById('actionItem-economy').classList.contains('notify'), false);
  assert.deepEqual(game.errors, []);
});

test('unnamed species display plant or animal in discovery messages and naming dialogs', async t => {
  const game = await makeGame();
  t.after(game.close);
  const { window } = game;
  for (const type of ['plant', 'animal']) {
    const species = window.regToArray('species').find(species => species.type === type);
    assert.ok(species);
    const text = window.parseText(`What should the {{regname:species|${species.id}|?}} be called?`);
    assert.match(text, new RegExp(type + ' species'));
    assert.doesNotMatch(text, />\?</);
  }
  assert.deepEqual(game.errors, []);
});

test('native customization preserves planet configuration through save and reload', async t => {
  const game = await makeGame();
  t.after(game.close);
  const { window } = game;
  const config = { ...window.defaultPlanet().config, width: 160, height: 96, chunkSize: 4, pixelSize: 3, waterLevel: 0.42, seed: 123 };
  window.generatePlanet(config);
  window.updateBiomes();
  window.calculateLandmasses();
  window.initGame();
  settleGame(game);
  const save = JSON.parse(JSON.stringify(window.generateSave()));
  assert.equal(save.planet.config.width, 160);
  assert.equal(save.planet.config.waterLevel, 0.42);
  const reloaded = await makeGame({ save });
  t.after(reloaded.close);
  for (const key of ['width', 'height', 'chunkSize', 'pixelSize', 'waterLevel']) assert.equal(reloaded.window.planet.config[key], config[key]);
  assert.equal(reloaded.window.planet.chunks['39,23'].x, 39);
  reloaded.window.nextDay();
  assert.deepEqual(reloaded.errors, []);
});

test('legacy gt3 dimensions migrate without losing the town or terrain', async t => {
  const first = await makeGame();
  t.after(first.close);
  const town = settleGame(first);
  const save = JSON.parse(JSON.stringify(first.window.generateSave()));
  const config = save.planet.config;
  delete save.planet.config;
  save.meta.saveVersion = 'gt3';
  save.meta.gameVersion = '1.1';
  Object.assign(save, { planetWidth: config.width, planetHeight: config.height, chunkSize: config.chunkSize, waterLevel: config.waterLevel });
  const reloaded = await makeGame({ save });
  t.after(reloaded.close);
  assert.equal(reloaded.window.planet.config.width, config.width);
  assert.equal(reloaded.window.regToArray('town')[0].id, town.id);
  assert.equal(Object.keys(reloaded.window.planet.chunks).length, Object.keys(first.window.planet.chunks).length);
  reloaded.window.nextDay();
  assert.equal(reloaded.window.planet.day, 2);
  assert.deepEqual(reloaded.errors, []);
});

test('switching and reloading already reached worlds preserves each planet and its dimensions', async t => {
  const game = await makeGame();
  t.after(game.close);
  settleGame(game);
  const { window } = game;
  const universe = window._paultendoUniverse;
  window.planet.unlocks.astronomy = 10;
  const home = window.planet;
  const homeConfig = JSON.stringify(home.config);
  const other = Object.values(universe.worlds).find(world => world.id !== universe.currentWorldId);
  const clickText = text => {
    const button = [...window.document.querySelectorAll('.actionItem')].find(node => node.textContent === text);
    assert.ok(button, `Missing ${text}`);
    button.click();
  };
  other.discovered=true;other.reached=true;
  window.document.getElementById('actionItem-solar').click();
  window.document.querySelector(`[data-world-id="${other.id}"]`).click();
  assert.equal(window.planet, home);
  assert.equal(JSON.stringify(home.config), homeConfig);
  clickText('Switch to world');
  window.nextDay();
  const expected = { world: other.id, day: window.planet.day, width: window.planet.config.width, homeDay: home.day };
  const expectedLogIds = [...window.document.querySelectorAll('.logMessage')].map(node => node.id);
  const save = JSON.parse(JSON.stringify(window.generateSave()));
  const reloaded = await makeGame({ save });
  t.after(reloaded.close);
  const restored = reloaded.window._paultendoUniverse;
  assert.equal(restored.currentWorldId, expected.world);
  assert.equal(reloaded.window.planet.day, expected.day);
  assert.equal(reloaded.window.planet.config.width, expected.width);
  assert.equal(restored.worlds[universe.homeWorldId].state.planet.day, expected.homeDay);
  assert.equal(JSON.stringify(restored.worlds[universe.homeWorldId].state.planet.config), homeConfig);
  const late = await makeGame({ save, mod: 'late' });
  t.after(late.close);
  assert.equal(late.window._paultendoUniverse.currentWorldId, expected.world);
  assert.equal(late.window.planet.config.width, expected.width);
  assert.equal(late.window._paultendoUniverse.worlds[universe.homeWorldId].state.planet.day, expected.homeDay);
  for (const id of expectedLogIds) assert.ok(late.window.document.getElementById(id), `Lost world history ${id}`);
  late.window.parseSave(save);
  assert.equal(JSON.parse(late.window.R74n.get('GenTownSave')).paultendoUniverse.currentWorldId, expected.world, 'Late-loaded imports persist after all worlds are restored');
  assert.deepEqual(late.errors, []);
  reloaded.window.nextDay();
  assert.deepEqual(game.errors, []);
  assert.deepEqual(reloaded.errors, []);
});

test('GenTown native autoplay shares the mod timer and pauses cleanly', async t => {
  const game = await makeGame();
  t.after(game.close);
  settleGame(game);
  const { window } = game;
  const clock = fakeTimers(window);
  window.document.getElementById('autoPlay').click();
  assert.equal(window.autoPlaying, false);
  assert.equal(window._paultendoAutoplay.active, true);
  assert.equal(clock.timers.size, 1);
  window.autoPlay();
  assert.equal(clock.timers.size, 0);
  assert.equal(window._paultendoAutoplay.active, false);
});

test('seeded simulation can advance and serialize a world', async t => {
  const game = await makeGame();
  t.after(game.close);
  settleGame(game);
  for (let day = 0; day < 50; day++) game.window.nextDay();
  assert.equal(game.window.planet.day, 51);
  assert.ok(JSON.stringify(game.window.generateSave()).length > 0);
  assert.deepEqual(game.errors, []);
});

test('Next Day controls run the universe tick exactly once', async t => {
  const game = await makeGame();
  t.after(game.close);
  settleGame(game);
  const { window } = game;
  const universe = window._paultendoUniverse;
  const inactive = Object.values(universe.worlds).find(world => world.id !== universe.currentWorldId);
  assert.ok(inactive);
  // A visited second world has a live state; undiscovered worlds are generated lazily.
  inactive.state = {
    planet: JSON.parse(JSON.stringify(window.planet)),
    planetWidth: window.planet.config.width,
    planetHeight: window.planet.config.height,
    chunkSize: window.planet.config.chunkSize,
    waterLevel: window.planet.config.waterLevel
  };
  const day = inactive.state.planet.day;
  window.document.getElementById('nextDay').click();
  assert.equal(window.planet.day, 2);
  assert.equal(inactive.state.planet.day, day + 1);
  const saved = JSON.parse(window.localStorage.getItem('R74nMain-GenTownSave'));
  assert.equal(saved.paultendoUniverse.worldSaves[inactive.id].planet.day, day + 1);
  assert.deepEqual(game.errors, []);
});

test('duplicate mod loads do not add events, UI, or wrappers', async t => {
  const game = await makeGame();
  t.after(game.close);
  const { window } = game;
  const nextDay = window.nextDay;
  const eventCount = Object.keys(window.gameEvents).length;
  game.evaluate('paultendo-mod.js');
  window.dispatchEvent(new window.CustomEvent('tools-initialized'));
  assert.equal(window.nextDay, nextDay);
  assert.equal(Object.keys(window.gameEvents).length, eventCount);
  assert.equal(window.document.querySelectorAll('#paultendoAutoplayToggle').length, 1);
  assert.deepEqual(game.errors, []);
});

test('mod management receives complete URLs and can remove an installation', async t => {
  const game = await makeGame();
  t.after(game.close);
  const { window } = game;
  const url = 'https://cdn.jsdelivr.net/gh/paultendo/gentown-mods@v1.6.60/paultendo-mod.js';
  window.userSettings.mods = [url];
  window.showMods();
  window.handlePrompt(url);
  assert.equal(window.promptState.title, 'paultendo-mod.js');
  window.handlePrompt('remove');
  assert.equal(window.userSettings.mods.length, 0);
  assert.deepEqual(game.errors, []);
});

test('adding an updated URL replaces older URLs before the duplicate guard returns', async t => {
  const game = await makeGame();
  t.after(game.close);
  const { window } = game;
  const current = 'https://cdn.jsdelivr.net/gh/paultendo/gentown-mods@v1.6.60/paultendo-mod.js';
  window.userSettings.mods = ['https://cdn.jsdelivr.net/gh/paultendo/gentown-mods@v1.6.27/paultendo-mod.js', current, 'example_mod.js'];
  window._paultendoState.loadedVersion = '1.6.27';
  Object.defineProperty(window.document, 'currentScript', { configurable: true, get: () => ({ src: current }) });
  game.evaluate('paultendo-mod.js');
  assert.deepEqual(Array.from(window.userSettings.mods), [current, 'example_mod.js']);
  assert.deepEqual(JSON.parse(window.localStorage.getItem('R74nMain-GenTownSettings')).mods, [current, 'example_mod.js']);
});

test('an update survives an older startup script pruning the new URL before it runs', async t => {
  const game = await makeGame(); t.after(game.close);
  const {window} = game;
  const old = 'https://cdn.jsdelivr.net/gh/paultendo/gentown-mods@v1.6.35/paultendo-mod.js';
  const current = 'https://cdn.jsdelivr.net/gh/paultendo/gentown-mods@v1.6.60/paultendo-mod.js';
  // This is the observed live race: the old script has already saved only itself.
  window.userSettings.mods = [old, 'example_mod.js'];
  window.saveSettings();
  window._paultendoState.loadedVersion = '1.6.35';
  Object.defineProperty(window.document, 'currentScript', {configurable:true, get:() => ({src:current})});
  game.evaluate('paultendo-mod.js');
  assert.deepEqual(Array.from(window.userSettings.mods), ['example_mod.js', current]);
  assert.deepEqual(JSON.parse(window.localStorage.getItem('R74nMain-GenTownSettings')).mods, ['example_mod.js', current]);
  // The duplicate guard keeps the old runtime until reload, but preserves the update.
  assert.equal(window._paultendoState.loadedVersion, '1.6.35');
  assert.equal(window.document.querySelectorAll('#paultendoAutoplayToggle').length, 1);
  assert.deepEqual(game.errors, []);
});

test('Play advances days and Pause cancels the next tick', async t => {
  const game = await makeGame({ settings: { paultendoAutoplayPauseMajor: false } });
  t.after(game.close);
  settleGame(game);
  const { window } = game;
  const clock = fakeTimers(window);
  const toggle = window.document.getElementById('paultendoAutoplayToggle');
  toggle.click();
  assert.equal(toggle.textContent, 'Pause');
  clock.run(window._paultendoAutoplay.timer);
  assert.equal(window.planet.day, 2);
  const pending = window._paultendoAutoplay.timer;
  toggle.click();
  assert.equal(window._paultendoAutoplay.active, false);
  assert.equal(toggle.textContent, 'Play');
  assert.equal(clock.timers.has(pending), false);
});

test('auto-decisions never confirm a destructive settings dialog', async t => {
  const game = await makeGame({ settings: { paultendoAutoplayAutoDecide: 8 } });
  t.after(game.close);
  settleGame(game);
  const { window } = game;
  const clock = fakeTimers(window);
  window.document.getElementById('paultendoAutoplayToggle').click();
  let calls = 0;
  window.doPrompt({ type: 'confirm', danger: true, func: () => calls++ });
  assert.equal(window._paultendoAutoplay.active, false);
  assert.equal(window._paultendoAutoplay.promptTimer, null);
  assert.equal(calls, 0);
  assert.equal(clock.timers.size, 0);
});

test('resuming an open gameplay prompt schedules its decision; replacement cancels it', async t => {
  const game = await makeGame({ settings: { paultendoAutoplayAutoDecide: 8 } });
  t.after(game.close);
  settleGame(game);
  const { window } = game;
  const clock = fakeTimers(window);
  let calls = 0;
  window.doPrompt({ type: 'confirm', subject: window.regToArray('town')[0], func: () => calls++ });
  window.document.getElementById('paultendoAutoplayToggle').click();
  const pending = window._paultendoAutoplay.promptTimer;
  assert.ok(pending);
  const staleCallback = clock.timers.get(pending).callback;
  window.doPrompt({ type: 'confirm', danger: true, func: () => calls += 100 });
  staleCallback();
  assert.equal(calls, 0);
  assert.equal(window._paultendoAutoplay.active, false);
});

test('waiting decisions can be located and the waiting state clears after answering', async t => {
  const game = await makeGame();
  t.after(game.close);
  settleGame(game);
  const { window } = game;
  const clock = fakeTimers(window);
  let answered = false;
  const event = { needsInput: true, done: false };
  window.currentEvents.reviewTest = event;
  const uuid = window.logMessage('Approve a new school?', undefined, { buttons: [{ name: 'Yes', type: 'yes', func() { answered = true; event.done = true; window.document.getElementById('logMessage-' + uuid).setAttribute('done', 'true'); } }] });
  const message = window.document.getElementById('logMessage-' + uuid);
  message.dataset.eventid = 'reviewTest';
  let located = false;
  message.scrollIntoView = () => { located = true; };
  window.document.getElementById('paultendoAutoplayToggle').click();
  clock.run(window._paultendoAutoplay.timer);
  assert.match(window.document.getElementById('paultendoAutoplayStatus').textContent, /Waiting for your decision/);
  const review = window.document.getElementById('paultendoAutoplayReview');
  assert.equal(review.hidden, false);
  review.click();
  assert.equal(located, true);
  assert.equal(window.document.activeElement, message.querySelector('[type="yes"]'));
  window.document.activeElement.click();
  await Promise.resolve();
  assert.equal(answered, true);
  assert.equal(review.hidden, true);
  assert.equal(window.document.getElementById('paultendoAutoplayStatus').textContent, 'Paused');
  assert.deepEqual(game.errors, []);
});

test('settings values are normalized and changing speed updates the running timer', async t => {
  const game = await makeGame({ settings: { paultendoAutoplaySpeed: 'garbage', paultendoAutoplayAutoDecide: -8, paultendoAutoplayBias: 'unknown' } });
  t.after(game.close);
  settleGame(game);
  const { window } = game;
  const clock = fakeTimers(window);
  assert.equal(window.userSettings.paultendoAutoplaySpeed, 0);
  assert.equal(window.userSettings.paultendoAutoplayAutoDecide, 0);
  window.document.getElementById('paultendoAutoplayToggle').click();
  window.document.getElementById('paultendoAutoplaySpeed').click();
  assert.equal(clock.timers.get(window._paultendoAutoplay.timer).delay, 600);
  assert.equal(window.document.getElementById('paultendoAutoplaySpeedMobile').textContent, '2x');
});

test('save/reload keeps town state, has no runtime entity cache, and no duplicate log IDs', async t => {
  const first = await makeGame();
  t.after(first.close);
  settleGame(first);
  for (let day = 0; day < 15; day++) first.window.nextDay();
  const originalTown = first.window.regToArray('town')[0];
  const originalLogIds = [...first.window.document.querySelectorAll('.logMessage')].map(node => node.id);
  const expected = { id: originalTown.id, pop: originalTown.pop, name: originalTown.name };
  const save = JSON.parse(JSON.stringify(first.window.generateSave()));
  assert.equal('_paultendoDailyCache' in save.planet, false);
  const reloaded = await makeGame({ save });
  t.after(reloaded.close);
  assert.equal(reloaded.window.planet.day, 16);
  const town = reloaded.window.regToArray('town')[0];
  assert.deepEqual({ id: town.id, pop: town.pop, name: town.name }, expected);
  const ids = [...reloaded.window.document.querySelectorAll('.logMessage')].map(node => node.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of originalLogIds) assert.ok(ids.includes(id), `Lost Chronicle entry ${id}`);
  reloaded.window.nextDay();
  assert.equal(reloaded.window.planet.day, 17);
  assert.deepEqual(reloaded.errors, []);
});

test('legacy Chronicle markup restores as sanitized history', async t => {
  const first = await makeGame();
  t.after(first.close);
  settleGame(first);
  const entries = [...first.window.document.querySelectorAll('.logMessage')].map(node => node.id);
  const save = JSON.parse(JSON.stringify(first.window.generateSave()));
  save.planet._paultendoLogHTML = first.window.document.getElementById('logMessages').innerHTML;
  const reloaded = await makeGame({ save });
  t.after(reloaded.close);
  for (const id of entries) {
    const entry = reloaded.window.document.getElementById(id);
    assert.ok(entry);
    assert.equal(entry.querySelectorAll('[onclick], [onmouseenter], .logAct').length, 0);
  }
  assert.ok(reloaded.window.planet._paultendoLogHTML.startsWith('uri:'));
  assert.deepEqual(reloaded.errors, []);
});

test('unanswered historical decisions become subdued history without added prose', async t => {
  const first = await makeGame();
  t.after(first.close);
  settleGame(first);
  const id = first.window.logMessage('Should the people build a bridge?', undefined, { buttons: [{ name: 'Yes', func() {} }] });
  const saved = JSON.parse(JSON.stringify(first.window.generateSave()));
  const restored = await makeGame({ save: saved });
  t.after(restored.close);
  const entry = restored.window.document.getElementById('logMessage-' + id);
  assert.equal(entry.querySelector('.logAct'), null);
  assert.equal(entry.querySelector('.paultendoArchivedDecision'), null);
  assert.equal(entry.classList.contains('paultendoPastDecision'), true);
  assert.equal(entry.querySelector('.logText').textContent, 'Should the people build a bridge?');
  assert.equal(entry.getAttribute('done'), 'true');
  assert.deepEqual(restored.errors, []);
});

test('older explanatory notes are removed and the visual history state survives reload', async t => {
  const first = await makeGame();
  t.after(first.close);
  settleGame(first);
  const id = first.window.logMessage('Should the people build a bridge?');
  const entry = first.window.document.getElementById('logMessage-' + id);
  const note = first.window.document.createElement('small');
  note.className = 'paultendoArchivedDecision';
  note.textContent = ' Past proposal. No action needed.';
  entry.appendChild(note);
  entry.setAttribute('done', 'true');
  const restored = await makeGame({ save: JSON.parse(JSON.stringify(first.window.generateSave())) });
  t.after(restored.close);
  const migrated = restored.window.document.getElementById('logMessage-' + id);
  assert.equal(migrated.querySelector('.paultendoArchivedDecision'), null);
  assert.equal(migrated.classList.contains('paultendoPastDecision'), true);
  assert.equal(migrated.textContent.includes('No action needed'), false);
  const again = await makeGame({ save: JSON.parse(JSON.stringify(restored.window.generateSave())) });
  t.after(again.close);
  assert.equal(again.window.document.getElementById('logMessage-' + id).classList.contains('paultendoPastDecision'), true);
  assert.deepEqual(again.errors, []);
});

test('advancing without answering preserves native lapse and fallback behavior', async t => {
  const game = await makeGame();
  t.after(game.close);
  const town = settleGame(game);
  const { window } = game;
  let yes = 0, no = 0, skipped = 0, defaultName;
  window.gameEvents.unansweredProposal = { func() { yes++; }, funcNo() { no++; } };
  window.gameEvents.skippedProposal = { func() { yes++; }, skip() { skipped++; } };
  window.gameEvents.defaultNaming = { value: { ask: true, skip: true, default: () => 'Reedling' }, func(subject, target, args) { defaultName = args.value; } };
  const ids = [];
  for (const eventClass of ['unansweredProposal', 'skippedProposal', 'defaultNaming']) {
    const id = window.logMessage('What should the people do?', undefined, { buttons: [{ name: 'Yes', type: 'yes', func() { yes++; } }, { name: 'No', type: 'no', func() { no++; } }] });
    ids.push(id);
    window.currentEvents[eventClass] = { eventClass, needsInput: true, done: false, subject: null, target: town, args: {}, logID: id };
    window.document.getElementById('logMessage-' + id).dataset.eventid = eventClass;
  }
  window.nextDay();
  assert.equal(yes, 0);
  assert.equal(no, 0);
  assert.equal(skipped, 1);
  assert.equal(defaultName, 'Reedling');
  for (const id of ids) {
    const entry = window.document.getElementById('logMessage-' + id);
    assert.equal(entry.getAttribute('done'), 'true');
    assert.equal(entry.classList.contains('faded'), true);
    assert.equal(entry.querySelector('[selected="true"]'), null);
  }
  assert.deepEqual(game.errors, []);
});

test('saving after a decision retains its updated Chronicle message', async t => {
  const first = await makeGame();
  t.after(first.close);
  settleGame(first);
  const id = first.window.logMessage('A civic proposal awaits a decision.');
  first.window.logChange(id, 'The civic proposal was accepted.');
  const save = JSON.parse(JSON.stringify(first.window.generateSave()));
  const reloaded = await makeGame({ save, mod: 'late' });
  t.after(reloaded.close);
  const entry = reloaded.window.document.getElementById('logMessage-' + id);
  assert.ok(entry.textContent.includes('The civic proposal was accepted.'));
  assert.equal(entry.textContent.includes('awaits a decision'), false);
  assert.deepEqual(reloaded.errors, []);
});

test('asynchronous saved-mod installation restores history after native autoload', async t => {
  const first = await makeGame();
  t.after(first.close);
  const town = settleGame(first);
  first.window.nextDay();
  const ids = [...first.window.document.querySelectorAll('.logMessage')].map(node => node.id);
  const save = JSON.parse(JSON.stringify(first.window.generateSave()));
  const late = await makeGame({ save, mod: 'late' });
  t.after(late.close);
  assert.equal(late.window.regToArray('town')[0].id, town.id);
  assert.equal(late.window.planet.day, 2);
  for (const id of ids) assert.ok(late.window.document.getElementById(id), `Lost late-load Chronicle entry ${id}`);
  late.window.nextDay();
  assert.equal(late.window.planet.day, 3);
  assert.deepEqual(late.errors, []);
});

for (const seed of [7, 42, 123]) {
  test(`settled simulation survives 300 days with decisions (seed ${seed})`, async t => {
    const game = await makeGame({ seed });
    t.after(game.close);
    settleGame(game);
    for (let day = 0; day < 300; day++) {
      game.window.nextDay();
      for (const act of game.window.document.querySelectorAll('.logMessage:not([done]) .logAct')) {
        const button = act.querySelector('[type="yes"]');
        button?.click();
        if (game.window.promptState) game.window.handlePrompt(null);
      }
    }
    assert.equal(game.window.planet.day, 301);
    assert.equal(game.window.planet._paultendoSeason.dayOfYear, 61);
    const speciesNotes = Object.values(game.window.planet._paultendoLife.species);
    // A settlement can die before a chance encounter. Surviving diagnostic
    // worlds still exercise field notes, and each recorded date must be real.
    assert.ok(game.window.planet.dead || speciesNotes.some(note => note.encounter), 'Surviving diagnostic worlds must record actual encounters');
    for (const note of speciesNotes) {
      if (note.encounter) assert.ok(note.encounter.day >= 1 && note.encounter.day <= 301);
      if (note.describedDay !== undefined) assert.ok(note.describedDay >= note.encounter.day);
    }
    assert.ok(JSON.stringify(game.window.generateSave()).length > 0);
    for (const town of game.window.regToArray('town', true)) {
      assert.ok(Number.isFinite(town.pop) && town.pop >= 0, `Invalid population in town ${town.id}`);
    }
    assert.deepEqual(game.errors, []);
  });
}


test('a successfully imported world persists locally without advancing a day', async t => {
  const source = await makeGame(); t.after(source.close);
  const town = settleGame(source); source.window.planet.day = 52; town.pop = 47;
  const imported = JSON.parse(JSON.stringify(source.window.generateSave()));
  const local = await makeGame(); t.after(local.close);
  local.window.parseSave(imported);
  assert.equal(local.window.planet.day, 52);
  const stored = JSON.parse(local.window.R74n.get('GenTownSave'));
  const reloaded = await makeGame({save: stored}); t.after(reloaded.close);
  assert.equal(reloaded.window.planet.day, 52);
  assert.equal(reloaded.window.regGet('town', town.id).pop, 47);
  assert.deepEqual(local.errors, []); assert.deepEqual(reloaded.errors, []);
});
