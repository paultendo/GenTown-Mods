import test from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, settleGame } from './harness.mjs';

const panel = window => window.document.getElementById('actionSubList');
function click(window, text) {
  const button = [...panel(window).querySelectorAll('[role="button"]')].find(b => b.textContent.includes(text));
  assert.ok(button, `Missing control: ${text}`); button.click();
}
function meet(window, town) {
  window.openRegBrowser(town, 'town');
  const button = [...window.document.querySelectorAll('.paultendoTownLife button')].find(b => b.textContent === 'Meet the people');
  assert.ok(button); button.click();
  return town._paultendoPeople;
}
function whisper(window, town, person, topic) {
  meet(window, town); click(window, person.name);
  click(window, {learn:'Pass on what you know.',care:'Do not leave people',explore:'There is more beyond',defy:'Those who rule you',conquer:'Your neighbours have'}[topic]);
  const record = window.planet._paultendoLife.whispers.at(-1);
  assert.equal(record.person, person.id); assert.equal(record.topic, topic);
  return record;
}
function next(window) {
  // Suppress unrelated random proposals, keeping the native day and automatic systems.
  const choose = window.chooseEvent; window.chooseEvent = () => null;
  try { window.nextDay(); } finally { window.chooseEvent = choose; }
}
function respond(window, record) { window.planet.day = record.due - 1; next(window); assert.equal(record.resolved, true); }
function prepare(window, town, role) {
  town.pop = 48; town.jobs[role] = 4;
  Object.assign(window.planet.unlocks, {education:10,military:10,trade:10,farm:10});
  town.resources.crop = 100; town.guidanceTrust = 90;
  const person = meet(window,town).find(p => p.role === role);
  assert.ok(person); person.trust = 90; person.outlook = 'curious';
  return person;
}
function neighbour(window,town) {
  const center = window.planet.chunks[town.center.join(',')];
  const free = window.filterChunks(c => !c.v.s && c.v.g === center.v.g && c.b !== 'water' && c.b !== 'mountain').sort((a,b) => Math.hypot(a.x-center.x,a.y-center.y)-Math.hypot(b.x-center.x,b.y-center.y))[0];
  assert.ok(free);
  const partner = window.happen('Create',null,null,{x:free.x,y:free.y},'town');
  partner.name = 'Neighbour'; partner.pop = 40; partner.resources.crop = 100;
  return partner;
}

test('meeting people retains identities through reload without consuming the simulation RNG or exposing unknown towns', async t => {
  const game = await makeGame(); t.after(game.close);
  const {window} = game, town = settleGame(game);
  town.jobs.farmer = 3;
  window.openRegBrowser(town,'town');
  assert.equal(town._paultendoPeople, undefined, 'Opening a town must not invent earlier acquaintances');
  const random = window.Math.random; let calls = 0;
  window.Math.random = () => {calls++; return random();};
  const people = meet(window,town);
  assert.equal(calls, 0); window.Math.random = random;
  assert.ok(people.every(p => p.name && p.met === window.planet.day));
  const identities = JSON.parse(JSON.stringify(people));
  meet(window,town); assert.deepEqual(JSON.parse(JSON.stringify(town._paultendoPeople)), identities);
  const restored = await makeGame({save:JSON.parse(JSON.stringify(window.generateSave()))}); t.after(restored.close);
  const restoredTown = restored.window.regGet('town',town.id);
  assert.deepEqual(JSON.parse(JSON.stringify(meet(restored.window,restoredTown))),identities);
  restoredTown._hidden = true; restored.window.openRegBrowser(restoredTown,'town');
  assert.equal(restored.window.document.querySelector('.paultendoTownLife'),null);
  assert.deepEqual(game.errors,[]); assert.deepEqual(restored.errors,[]);
});

test('the same words become different actual work for a settler and a soldier, with a saved response history', async t => {
  const results = [];
  for (const role of ['resident','soldier']) {
    const game = await makeGame(); t.after(game.close);
    const {window} = game, town = settleGame(game), person = prepare(window,town,role);
    const record = whisper(window,town,person,'learn'); record.roll = 0.2;
    assert.equal(record.resolved,false);
    assert.match(panel(window).textContent,/Your last words are still with them/);
    assert.equal(panel(window).textContent.includes('“Pass on what you know.”'),false, 'Cannot send again while words are pending');
    respond(window,record);
    assert.ok(record.changes.education > 0);
    assert.doesNotMatch(panel(window).textContent,/Your last words are still with them/,'An open profile updates when its response arrives');
    results.push(JSON.parse(JSON.stringify(record)));
    meet(window,town); click(window,person.name); click(window,'Knowledge passed on');
    assert.match(panel(window).textContent,/You whispered.*Pass on what you know/s);
    assert.match(panel(window).textContent,new RegExp(record.steps[0].text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
    const restored = await makeGame({save:JSON.parse(JSON.stringify(window.generateSave()))}); t.after(restored.close);
    assert.deepEqual(JSON.parse(JSON.stringify(restored.window.planet._paultendoLife.whispers)),JSON.parse(JSON.stringify(window.planet._paultendoLife.whispers)));
    assert.deepEqual(game.errors,[]); assert.deepEqual(restored.errors,[]);
  }
  assert.ok(results[0].changes.trade < 0);
  assert.equal(results[0].reshaped,undefined);
  assert.ok(results[1].changes.military > 0 && results[1].changes.crime > 0);
  assert.equal(results[1].reshaped,true); assert.match(results[1].steps[0].text,/soldiers/);
});

test('trust and changing conditions determine reception, rather than a guaranteed success', async t => {
  for (const trust of [10,90]) {
    const game = await makeGame(); t.after(game.close);
    const {window} = game, town = settleGame(game), person = prepare(window,town,'resident');
    person.trust = town.guidanceTrust = trust; person.outlook = trust === 10 ? 'guarded' : 'curious';
    const record = whisper(window,town,person,'learn'); record.roll = 0.5;
    respond(window,record);
    assert.equal(record.reception,trust === 10 ? 'refused' : 'heard');
    assert.equal(Boolean(record.changes),trust === 90);
    assert.deepEqual(game.errors,[]);
  }
  const game = await makeGame(); t.after(game.close);
  const {window} = game, town = settleGame(game), person = prepare(window,town,'resident');
  const record = whisper(window,town,person,'explore'); record.roll = 0;
  const enemy = neighbour(window,town);
  const war = window.happen('Create',town,null,{type:'war',towns:[town.id,enemy.id]},'process');
  town.issues.war = enemy.issues.war = war.id;
  respond(window,record);
  assert.equal(record.reception,'refused'); assert.match(record.steps[0].text,/fighting/);
  assert.equal(record.mission,undefined); assert.deepEqual(game.errors,[]);
});

test('pending whispers survive a real reload and native days without blocking decisions', async t => {
  const game = await makeGame(); t.after(game.close);
  const {window} = game, town = settleGame(game), person = prepare(window,town,'resident');
  const record = whisper(window,town,person,'care'); record.roll = 0;
  const day = window.planet.day; next(window);
  assert.equal(window.planet.day,day+1); assert.equal(record.resolved,false);
  const restored = await makeGame({save:JSON.parse(JSON.stringify(window.generateSave()))}); t.after(restored.close);
  const pending = restored.window.planet._paultendoLife.whispers[0];
  next(restored.window);
  assert.equal(restored.window.planet.day,day+2); assert.equal(pending.reception,'heard');
  assert.ok(pending.changes.disease < 0 && pending.changes.happy > 0);
  next(restored.window); assert.equal(pending.steps.length,1);
  assert.deepEqual(game.errors,[]); assert.deepEqual(restored.errors,[]);
});

test('care can send real food along an active known route, and removing that route changes the outcome', async t => {
  for (const active of [true,false]) {
    const game = await makeGame(); t.after(game.close);
    const {window} = game, town = settleGame(game), person = prepare(window,town,'resident');
    const partner = neighbour(window,town); partner.resources = {};
    // Remove the route itself: merchants can naturally reopen an inactive route.
    window.planet.tradeRoutes = active ? [{id:1,town1:town.id,town2:partner.id,active:true}] : [];
    const record = whisper(window,town,person,'care'); record.roll = 0;
    // Observe the real resource transfer amid native daily production and consumption.
    const happen = window.happen; let received = 0, removed = 0;
    window.happen = function(action,subject,target,args,...rest) {
      const before = target?.resources?.crop || 0;
      const result = happen(action,subject,target,args,...rest);
      if (action === 'AddResource' && subject === town && target === partner && args.type === 'crop') received += (partner.resources.crop || 0)-before;
      if (action === 'RemoveResource' && subject === partner && target === town && args.type === 'crop') removed += before-(town.resources.crop || 0);
      return result;
    };
    respond(window,record); window.happen = happen;
    if (active) {
      assert.equal(record.partner,partner.id); assert.ok(record.food > 0);
      assert.equal(received,record.food); assert.equal(removed,received);
      assert.ok(town.relations[partner.id] > 0);
      assert.ok(window.filterChunks(c => c.v.road?.traffic > 0).length > 0);
      window.openRegBrowser(partner,'town');
      [...window.document.querySelectorAll('.paultendoTownLife button')].find(b => b.textContent === 'Your mark on this town').click();
      assert.match(panel(window).textContent,/hungry neighbours/);
    } else { assert.equal(record.partner,undefined); assert.equal(received,0); assert.ok(record.changes.disease < 0); }
    assert.deepEqual(game.errors,[]);
  }
});

test('a real figure retains their deeds and cannot act after death', async t => {
  const game = await makeGame(); t.after(game.close);
  const {window} = game, town = settleGame(game); prepare(window,town,'resident');
  window.gameEvents.scholarEmerges.func(town);
  const figure = window.planet.figures.find(f => f.type === 'SCHOLAR' && f.hometown === town.id);
  assert.ok(figure); meet(window,town); click(window,figure.name);
  assert.match(panel(window).textContent,/Studied at the academy/);
  click(window,'Pass on what you know.');
  const record = window.planet._paultendoLife.whispers.at(-1); figure.died = window.planet.day;
  respond(window,record); assert.equal(record.reception,'lost'); assert.equal(record.changes,undefined);
  meet(window,town); click(window,figure.name);
  assert.match(panel(window).textContent,/story has ended/);
  assert.equal([...panel(window).querySelectorAll('[role="button"]')].some(b => /Pass on what you know/.test(b.textContent)),false);
  assert.deepEqual(game.errors,[]);
});

test('exploration words reveal actual terrain and travel leaves traffic behind', async t => {
  const game = await makeGame(); t.after(game.close);
  const {window} = game, town = settleGame(game), person = prepare(window,town,'resident');
  window.planet.day = 10; window.planet.unlocks.travel = 20; town.influences.travel = 3;
  const record = whisper(window,town,person,'explore'); record.roll = 0;
  const explored = new Set(Object.keys(window.planet._paultendoFog.explored));
  respond(window,record);
  assert.equal(record.reception,'heard'); assert.ok(record.mission.revealed > 0);
  assert.ok(Object.keys(window.planet._paultendoFog.explored).some(key => !explored.has(key)));
  assert.equal(town._paultendoExplorationDay,window.planet.day);
  assert.ok(window.filterChunks(c => c.v.road?.traffic > 0).length > 0);
  assert.deepEqual(game.errors,[]);
});

test('defiance weakens obedience, while an orderly soldier reshapes it into tighter control', async t => {
  for (const role of ['resident','soldier']) {
    const game = await makeGame(); t.after(game.close);
    const {window} = game, town = settleGame(game), person = prepare(window,town,role);
    window.planet.unlocks.government = 10; town.gov = 'dictatorship'; town.values.order = role === 'soldier' ? 6 : -6;
    const record = whisper(window,town,person,'defy'); record.roll = 0;
    respond(window,record);
    assert.ok(record.changes.happy < 0);
    assert.equal(Math.sign(record.changes.crime),role === 'soldier' ? -1 : 1, 'The engine couples tighter law with reduced crime');
    assert.equal(Math.sign(record.changes.law),role === 'soldier' ? 1 : -1);
    assert.equal(record.reception,role === 'soldier' ? 'reshaped' : 'heard');
    assert.match(record.steps[0].text,role === 'soldier' ? /tighter control/ : /questioning the rulers/);
    assert.deepEqual(game.errors,[]);
  }
});

test('a conquest whisper can enter the real war process when tension boils over', async t => {
  const game = await makeGame(); t.after(game.close);
  const {window} = game, town = settleGame(game), person = prepare(window,town,'resident');
  const other = neighbour(window,town);
  const record = whisper(window,town,person,'conquer'); record.roll = 0;
  const happen = window.happen, random = window.Math.random;
  window.happen = function(action,subject,target,args,...rest) {
    if (action === 'AddRelation' && subject === town && target === other && args.amount === -0.75) {
      // Place the pair at a brink and choose the engine's war branch only at reception.
      window.planet._paultendoWarPressure[`${town.id}|${other.id}`] = {value:75,lastDay:window.planet.day};
      window.Math.random = () => 0;
    }
    return happen(action,subject,target,args,...rest);
  };
  try { respond(window,record); } finally {window.happen = happen; window.Math.random = random;}
  assert.ok(record.war); const war = window.regGet('process',record.war);
  assert.equal(war.type,'war'); assert.equal(war.done,undefined);
  assert.equal(town.issues.war,war.id); assert.equal(other.issues.war,war.id);
  assert.equal(war.sides.length,2); assert.match(record.steps[0].text,/broke into war/);
  const restored = await makeGame({save:JSON.parse(JSON.stringify(window.generateSave()))}); t.after(restored.close);
  assert.equal(restored.window.regGet('process',war.id).type,'war');
  assert.equal(restored.window.planet._paultendoLife.whispers[0].war,war.id);
  assert.deepEqual(game.errors,[]); assert.deepEqual(restored.errors,[]);
});

test('conquest words strain real relations and war pressure, with refusal and visibility limits', async t => {
  for (const outlook of ['curious','generous']) {
    const game = await makeGame(); t.after(game.close);
    const {window} = game, town = settleGame(game), person = prepare(window,town,'resident');
    const other = neighbour(window,town);
    person.trust = town.guidanceTrust = 50; person.outlook = outlook;
    const record = whisper(window,town,person,'conquer'); record.roll = 0.5;
    respond(window,record);
    if (outlook === 'curious') {
      assert.equal(record.partner,other.id); assert.ok(record.hostility.relation < 0 && record.hostility.pressure > 0);
      assert.ok(town.relations[other.id] < 0 && other.relations[town.id] < 0);
      assert.ok(Object.values(window.planet._paultendoWarPressure).some(p => p.value >= record.hostility.pressure));
      assert.ok(record.changes.military > 0 && record.changes.happy < 0);
    } else {
      assert.equal(record.reception,'refused'); assert.match(record.steps[0].text,/neighbours into prey/);
      assert.equal(record.hostility,undefined);
    }
    // Hidden neighbours cannot supply a target or appear as a tempting choice.
    window.planet.day += 12; other._hidden = true;
    meet(window,town); click(window,person.name);
    assert.doesNotMatch(panel(window).textContent,/“Your neighbours have what should be yours.”/);
    assert.deepEqual(game.errors,[]);
  }
});
