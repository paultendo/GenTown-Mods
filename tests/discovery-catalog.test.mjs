import test from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, settleGame } from './harness.mjs';

function openUnlocks(window) { window.document.getElementById('actionItem-unlocks').click(); return window.document.getElementById('actionSubList'); }
function selectDiscovery(window, name) {
  const list = openUnlocks(window);
  const button = [...list.querySelectorAll('[role="button"]')].find(n => n.textContent === name);
  assert.ok(button, `${name} must be a readable discovery`); button.click(); return list;
}

test('all 43 extended discoveries preserve their knowledge gates and offer readable lore without instant awards', async t => {
  const game = await makeGame(); t.after(game.close);
  const { window } = game; settleGame(game);
  const events = Object.entries(window.gameEvents).filter(([, info]) => info._paultendoDiscovery);
  assert.equal(events.length, 43);
  const player = window.regGet('player', 1);
  for (const [id, info] of events) {
    const discovery = info._paultendoDiscovery;
    window.planet.unlocks = Object.fromEntries(['farm','travel','fire','smith','trade','government','education','military','astronomy','faith'].map(key => [key, 0]));
    Object.assign(window.planet.unlocks, discovery.needsUnlock);
    assert.ok(info._paultendoRequirementsCheck(player, null, {}), `${id} must be eligible at the displayed requirements`);
    for (const [key, value] of Object.entries(discovery.needsUnlock)) {
      window.planet.unlocks[key] = value - 1;
      assert.equal(!!info._paultendoRequirementsCheck(player, null, {}), false, `${id} must require the advertised ${key} discovery`);
      window.planet.unlocks[key] = value;
    }
    assert.equal(info.check(player,null,{}),false,`${id} needs work and a purpose as well as knowledge`);
    assert.equal(window.readyEvent(id),undefined);
    window.planet.unlocks[discovery.key]=discovery.level;
    const detail = selectDiscovery(window, discovery.name);
    assert.match(detail.textContent, new RegExp(discovery.name));
    assert.ok(detail.textContent.includes(discovery.tale), `${id} must reward curiosity with its own story`);
    assert.equal(window.document.querySelector('.paultendoDiscoveryNumbers').open, false);
  }
  assert.deepEqual(game.errors, []);
});

test('discovery display does not alter native unlock selection or introduce unavailable branches', async t => {
  const vanilla = await makeGame({mod:false}); t.after(vanilla.close);
  const game = await makeGame(); t.after(game.close);
  const { window } = game; settleGame(game);
  assert.equal(JSON.stringify(window.unlockTree), JSON.stringify(vanilla.window.unlockTree));
  let list = openUnlocks(window);
  assert.match(list.textContent, /No discoveries yet/);
  assert.doesNotMatch(list.textContent, /Faith|Banking|Libraries|\?/);
  window.planet.unlocks.education = 40; window.planet.unlocks.faith = 20; window.updateStats();
  list = openUnlocks(window);
  assert.match(list.textContent, /Learning.*Writing.*Libraries/s);
  assert.match(list.textContent, /Faith.*Rituals.*Temples/s);
  assert.doesNotMatch(list.textContent, /Banking|\?/);
  const names = [...list.querySelectorAll('[role="button"]')].map(n => n.textContent);
  assert.equal(new Set(names).size, names.length);
  assert.deepEqual(game.errors, []);
});

test('next discoveries name their real missing prerequisites and update as those are met', async t => {
  const game = await makeGame(); t.after(game.close);
  const { window } = game; settleGame(game);
  window.planet.unlocks.education = 40;
  let detail = selectDiscovery(window, 'Libraries');
  assert.match(detail.textContent, /Next in this branch: Printing\. Needs Metal Tools\./);
  window.planet.unlocks.smith = 40;
  detail = selectDiscovery(window, 'Libraries');
  assert.match(detail.textContent, /Next in this branch: Printing\./);
  assert.doesNotMatch(detail.textContent, /Needs Metal Tools/);
  assert.deepEqual(game.errors, []);
});

test('advanced breakthroughs notify once and keep their true date and origin through reload', async t => {
  const game = await makeGame(); t.after(game.close);
  const { window } = game; const town = settleGame(game);
  window.planet.unlocks.education = 30;
  window.planet.day = 40;town.pop=20;town.jobs={scholar:2};town.research={education:100};town.resources={crop:1000,lumber:2,paper:2};
  for(const id of ['townBirth','townDeath','townExpand','townEat'])window.gameEvents[id].func=()=>{};
  window.gameEvents.processAll.func=()=>{};const choose=window.chooseEvent;window.chooseEvent=()=>null;
  window.doEvent('unlockLibraries', window.readyEvent('unlockLibraries'));
  for(let n=0;n<11;n++)window.nextDay();window.chooseEvent=choose;
  const discovery = window.planet._paultendoLife.discoveries['education:40'];
  assert.equal(discovery.day, 51); assert.equal(discovery.origin, town.id);
  const button = window.document.getElementById('actionItem-unlocks');
  assert.equal(button.classList.contains('notify'), true);
  selectDiscovery(window, 'Libraries');
  assert.equal(button.classList.contains('notify'), false);
  town.jobs.doctor = 1;
  window.nextDay();
  const moment = window.planet._paultendoLife.moments.find(m => m.discovery === 'education:40');
  assert.ok(moment); assert.match(moment.text, /Libraries.*1 doctor now works/);
  const saved = JSON.parse(JSON.stringify(window.generateSave()));
  const restored = await makeGame({save:saved}); t.after(restored.close);
  assert.equal(restored.window.planet._paultendoLife.discoveries['education:40'].day, 51);
  assert.equal(restored.window.document.getElementById('actionItem-unlocks').classList.contains('notify'), false);
  const detail = selectDiscovery(restored.window, 'Libraries');
  assert.match(detail.textContent, /Origins.*Day 51.*From the Chronicle/s);
  assert.match(detail.textContent, /1 doctor/);
  assert.equal(restored.window.document.querySelector('.paultendoDiscoveryNotes').open, false);
  assert.match(detail.textContent, /First recorded.*Day 51/s);
  restored.window.openRegBrowser(restored.window.regGet('town', town.id), 'town');
  const townButtons = [...restored.window.document.querySelectorAll('.paultendoTownLife button')].map(n=>n.textContent);
  assert.ok(townButtons.includes('Libraries')); assert.equal(townButtons.includes('Higher Education'), false);
  assert.deepEqual(game.errors, []); assert.deepEqual(restored.errors, []);
});

test('legacy advanced discoveries gain readable lore without invented dates or origins', async t => {
  const game = await makeGame(); t.after(game.close);
  const { window } = game; const town = settleGame(game);
  window.planet.unlocks.trade = 40; window.planet.unlocks.faith = 20;
  town.jobs.merchant = 5; town.jobs.priest = 2;
  delete window.planet._paultendoLife;
  const restored = await makeGame({save:JSON.parse(JSON.stringify(window.generateSave()))}); t.after(restored.close);
  const state = restored.window.planet._paultendoLife;
  assert.equal(state.discoveries['trade:40'].day, null);
  assert.equal(state.discoveries['faith:20'].origin, null);
  const detail = selectDiscovery(restored.window, 'Banking');
  assert.match(detail.textContent, /Wealth can wait in a vault/);
  assert.doesNotMatch(detail.textContent, /Origins|From the Chronicle/);
  assert.deepEqual(restored.errors, []);
});
