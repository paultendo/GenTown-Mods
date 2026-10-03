import test from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, settleGame } from './harness.mjs';

function propose(window, town, eventClass, values = {}) {
  const info = window.gameEvents[eventClass];
  let caller;
  for (let attempt = 0; attempt < 100 && !caller; attempt++) caller = window.readyEvent(eventClass, info.subject.reg === 'town' ? town : window.regGet('player', 1), info.target?.reg === 'town' ? town : undefined);
  assert.ok(caller);
  Object.assign(caller.args, values);
  const choose = window.chooseEvent, ready = window.readyEvent;
  window.chooseEvent = () => eventClass;
  window.readyEvent = (key, ...args) => key === eventClass ? caller : ready(key, ...args);
  try { window.nextDay(); } finally { window.chooseEvent = choose; window.readyEvent = ready; }
  return { caller, entry: window.document.getElementById('logMessage-' + caller.logID) };
}

function nameEncounter(window, entry, name) {
  entry.querySelector('.logAct [type="act"]').click();
  const input = window.document.getElementById('popupText');
  input.value = name;
  input.dispatchEvent(new window.Event('input', {bubbles:true}));
  // jsdom does not execute the engine's inline OK handler. Invoke that native handler.
  window.handlePrompt(input.value);
}

function notesPanel(window, species) {
  window.openRegBrowser(species, 'species');
  return window.document.querySelector('.paultendoFieldNotes');
}

test('an actual encounter gains field notes, native naming and cultivation history, with links through reload', async t => {
  const game = await makeGame(); t.after(game.close);
  const {window} = game, town = settleGame(game);
  // A discarded native eligibility check must not become a remembered encounter.
  const candidate = window.readyEvent('speciesDiscover', window.regGet('player', 1), town);
  assert.ok(window.gameEvents.speciesDiscover.check(candidate.subject, town, candidate.args));
  window.updateStats();
  assert.equal(Object.keys(window.planet._paultendoLife.species).length, 0);
  const {caller, entry} = propose(window, town, 'speciesDiscover');
  assert.ok(entry);
  const species = window.regGet('species', caller.args.speciesID);
  const encounterDay = window.planet.day;
  assert.equal(window.planet._paultendoLife.species[species.id].encounter.town, town.id);
  assert.equal(window.planet._paultendoLife.species[species.id].encounter.day, encounterDay);
  assert.equal(notesPanel(window, species), null);
  window.closePopups();
  entry.querySelector('.logAct [type="act"]').click();
  assert.match(window.document.getElementById('popupContent').textContent, new RegExp(species.type === 'plant' ? 'plant|tree|fungus|algae' : 'animal'));
  window.handlePrompt(null);
  nameEncounter(window, entry, 'Silverfern');
  assert.notEqual(species.named, false);
  assert.equal(window.planet._paultendoLife.species[species.id].describedDay, encounterDay);
  const rate = species.rate;
  window.planet.unlocks.farm = 20;
  propose(window, town, 'domesticate', {speciesID:species.id, type:species.type, value:0.75});
  assert.equal(species.rate, rate + 0.75);
  const kind = species.type === 'plant' ? 'cultivation' : 'breeding';
  assert.equal(window.planet._paultendoLife.species[species.id].uses[town.id][kind].improvements, 1);
  let panel = notesPanel(window, species);
  assert.match(panel.textContent, /Field notes.*encountered this species.*given a name.*better way to/s);
  panel.querySelector('button').click();
  const link = [...window.document.querySelectorAll('.paultendoTownLife button')].find(b => b.textContent === species.name);
  assert.ok(link); link.click();
  assert.match(window.document.querySelector('.paultendoFieldNotes').textContent, /Silverfern|Field notes/);
  const save = JSON.parse(JSON.stringify(window.generateSave()));
  const restored = await makeGame({save}); t.after(restored.close);
  panel = notesPanel(restored.window, restored.window.regGet('species', species.id));
  assert.match(panel.textContent, new RegExp(`Day ${encounterDay}.*encountered this species`));
  assert.match(panel.textContent, /better way to/);
  assert.deepEqual(game.errors, []); assert.deepEqual(restored.errors, []);
});

test('an animal becomes a town symbol only after approval and unseen towns stay out of field notes', async t => {
  const game = await makeGame(); t.after(game.close);
  const {window} = game, town = settleGame(game);
  const animal = window.regToArray('species').find(s => s.type === 'animal');
  for (const s of window.regToArray('species').filter(s => s.type === 'animal')) { s.name = s.id === animal.id ? 'Moonpaw' : `Animal${s.id}`; window.unhideEntity(s); }
  propose(window, town, 'townAnimal', {value:animal.id}).entry.querySelector('[type="no"]').click();
  assert.equal(window.planet._paultendoLife.species[animal.id], undefined);
  propose(window, town, 'townAnimal', {value:animal.id}).entry.querySelector('[type="yes"]').click();
  let panel = notesPanel(window, animal);
  assert.match(panel.textContent, /chose it as their town animal/);
  assert.equal(panel.querySelectorAll('button').length, 1);
  town._hidden = true;
  panel = notesPanel(window, animal);
  assert.doesNotMatch(panel.textContent, /town animal|Visit/);
  assert.equal(panel.querySelectorAll('button').length, 0);
  town._hidden = false;
  const oldFog = JSON.parse(JSON.stringify(window.planet._paultendoFog));
  window.planet._paultendoFog.explored = {};
  panel = notesPanel(window, animal);
  assert.doesNotMatch(panel.textContent, /town animal|Visit/);
  window.planet._paultendoFog = oldFog;
  animal._hidden = true;
  assert.equal(notesPanel(window, animal), null);
  assert.deepEqual(game.errors, []);
});

test('legacy species show real traits and current town roles without invented encounters or yields', async t => {
  const game = await makeGame(); t.after(game.close);
  const {window} = game, town = settleGame(game);
  const species = window.regToArray('species').find(s => s.type === 'plant');
  Object.assign(species, {name:'Riverbloom', biome:'water', produce:'berry', offspring:'spore'});
  window.unhideEntity(species);
  let panel = notesPanel(window, species);
  assert.match(panel.textContent, /An aquatic plant.*bears berries.*spreads by spores/s);
  assert.doesNotMatch(panel.textContent, /Day \d|encountered|given a name|better way|Visit/);
  window.gameEvents.townFarm.func(town, null, {value:100});
  panel = notesPanel(window, species);
  assert.doesNotMatch(panel.textContent, /harvest|yield|crops|better way/);
  const animal = window.regToArray('species').find(s => s.type === 'animal');
  Object.assign(animal, {name:'Nightmoth', time:'night', sized:'small', texture:'fur', ability:'mimic', diet:'plant'});
  window.unhideEntity(animal); town.animal = animal.id;
  panel = notesPanel(window, animal);
  assert.match(panel.textContent, /small, furry.*active at night.*feeds on plants.*mimic sounds.*honours it/s);
  assert.doesNotMatch(panel.textContent, /Day \d|encountered|given a name/);
  const restored = await makeGame({save:JSON.parse(JSON.stringify(window.generateSave()))}); t.after(restored.close);
  panel = notesPanel(restored.window, restored.window.regGet('species', animal.id));
  assert.match(panel.textContent, /honours it/);
  assert.doesNotMatch(panel.textContent, /Day \d/);
  assert.deepEqual(game.errors, []); assert.deepEqual(restored.errors, []);
});
