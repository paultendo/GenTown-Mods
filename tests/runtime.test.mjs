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

test('installing after GenTown has loaded initializes the mod and advances a settled world', async t => {
  const game = await makeGame({ mod: 'late' });
  t.after(game.close);
  assert.equal(game.window._paultendoState.loadedVersion, '1.6.29');
  assert.ok(game.window._paultendoUniverse);
  assert.ok(game.lateMapDraws > 0, 'Late installation must redraw the cleared map');
  assert.ok(game.window.document.getElementById('paultendoMapControls'));
  settleGame(game);
  game.window.document.getElementById('nextDay').click();
  assert.equal(game.window.planet.day, 2);
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

test('discovering, switching, and reloading worlds preserves each planet and its dimensions', async t => {
  const game = await makeGame();
  t.after(game.close);
  settleGame(game);
  const { window } = game;
  const universe = window._paultendoUniverse;
  universe.spaceTech = 100;
  const home = window.planet;
  const homeConfig = JSON.stringify(home.config);
  const other = Object.values(universe.worlds).find(world => world.id !== universe.currentWorldId);
  const clickText = text => {
    const button = [...window.document.querySelectorAll('.actionItem')].find(node => node.textContent === text);
    assert.ok(button, `Missing ${text}`);
    button.click();
  };
  window.document.getElementById('actionItem-solar').click();
  window.document.querySelector(`[data-world-id="${other.id}"]`).click();
  clickText('Launch mission');
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
  const url = 'https://cdn.jsdelivr.net/gh/paultendo/gentown-mods@v1.6.29/paultendo-mod.js';
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
  const current = 'https://cdn.jsdelivr.net/gh/paultendo/gentown-mods@v1.6.29/paultendo-mod.js';
  window.userSettings.mods = ['https://cdn.jsdelivr.net/gh/paultendo/gentown-mods@v1.6.27/paultendo-mod.js', current, 'example_mod.js'];
  window._paultendoState.loadedVersion = '1.6.27';
  Object.defineProperty(window.document, 'currentScript', { configurable: true, get: () => ({ src: current }) });
  game.evaluate('paultendo-mod.js');
  assert.deepEqual(Array.from(window.userSettings.mods), [current, 'example_mod.js']);
  assert.deepEqual(JSON.parse(window.localStorage.getItem('R74nMain-GenTownSettings')).mods, [current, 'example_mod.js']);
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
    assert.ok(JSON.stringify(game.window.generateSave()).length > 0);
    for (const town of game.window.regToArray('town', true)) {
      assert.ok(Number.isFinite(town.pop) && town.pop >= 0, `Invalid population in town ${town.id}`);
    }
    assert.deepEqual(game.errors, []);
  });
}
