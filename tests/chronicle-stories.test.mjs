import test from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, settleGame } from './harness.mjs';

const entry = (w,id) => w.document.getElementById('logMessage-'+id);
const panel = w => w.document.getElementById('actionSubList');
function click(w,text) {
  const button=[...panel(w).querySelectorAll('[role="button"]')].find(b=>b.textContent.includes(text));
  assert.ok(button,`Missing ${text}`);button.click();
}
function scholar(w,town) {
  town.pop=40;town.jobs={scholar:4,farmer:12};town.resources.crop=200;
  Object.assign(w.planet.unlocks,{farm:20,education:20,government:10});
  w.gameEvents.scholarEmerges.func(town);
  const teaching=w.planet._paultendoLife.teachings.find(r=>r.origin.cause?.type==='academy');
  assert.ok(teaching);return teaching;
}
function propose(w,town,eventClass,values) {
  const caller=w.readyEvent(eventClass,w.regGet('player',1),town);assert.ok(caller);
  Object.assign(caller.args,values);
  const message=w.gameEvents[eventClass].message;
  caller.message=typeof message==='function'?message(caller.subject,caller.target,caller.args):message;
  const choose=w.chooseEvent,ready=w.readyEvent;
  w.chooseEvent=()=>eventClass;w.readyEvent=(key,...args)=>key===eventClass?caller:ready(key,...args);
  try {w.nextDay();} finally {w.chooseEvent=choose;w.readyEvent=ready;}
  return entry(w,caller.logID);
}

test('town conditions do not invent an event motive or consume game randomness for prose',async t=>{
  const game=await makeGame();t.after(game.close);const w=game.window,town=settleGame(game);
  Object.assign(town.influences,{trade:20,faith:30,education:40,happy:-8});
  const original=w.Math.random;let calls=0;w.Math.random=()=>{calls++;return original();};
  w.logMessage('The merchants refuse the proposal.','milestone');
  const baseline=calls;calls=0;
  w.gameEvents.swayTrade.messageNo(w.regGet('player',1),town,{success:false});
  const id=w.logMessage('The merchants refuse the proposal.','milestone');
  w.Math.random=original;
  assert.equal(calls,baseline,'Narration must not change the simulation’s random sequence');
  assert.equal(entry(w,id).querySelector('.logText').textContent,'The merchants refuse the proposal.');
  assert.equal(entry(w,id).hasAttribute('data-cause'),false);
  assert.equal(entry(w,id).hasAttribute('data-chain'),false);
  assert.deepEqual(game.errors,[]);
});

test('a real community event opens its actual history from the Chronicle and keeps keyboard navigation after reload',async t=>{
  const game=await makeGame();t.after(game.close);const w=game.window,town=settleGame(game);
  const root=scholar(w,town);
  const log=[...w.document.querySelectorAll('.logMessage')].find(e=>e.dataset.storyKind==='teaching'&&e.dataset.storyId===String(root.id));
  assert.ok(log);const id=log.id.slice('logMessage-'.length);
  log.querySelector('.paultendoChronicleStoryLink').click();
  assert.match(panel(w).textContent,/Where it began.*academy/is);
  assert.doesNotMatch(panel(w).textContent,/You whispered|your words/);
  const stored=w.planet._paultendoChronicleStore;
  assert.equal(stored.days.flatMap(d=>d.entries).filter(e=>e.logId===id).length,1);
  const save=JSON.parse(JSON.stringify(w.generateSave()));
  const restored=await makeGame({save});t.after(restored.close);const rw=restored.window;
  const link=entry(rw,id).querySelector('.paultendoChronicleStoryLink');assert.ok(link);
  assert.equal(entry(rw,id).querySelectorAll('.paultendoChronicleStoryLink').length,1);
  link.dispatchEvent(new rw.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
  assert.match(panel(rw).textContent,/Where it began.*academy/is);
  rw.document.getElementById('actionItem-chronicle').click();click(rw,'Day '+root.day);
  const chapter=[...panel(rw).querySelectorAll('[role="button"]')].find(b=>b.textContent.includes(root.steps.at(-1).text));
  assert.ok(chapter,'The archived Chronicle chapter must open the same story');chapter.click();
  assert.match(panel(rw).textContent,/Where it began.*academy/is);
  assert.deepEqual(game.errors,[]);assert.deepEqual(restored.errors,[]);
});

test('discovery decisions and their first harvest share an actual choice link without claiming unrelated events',async t=>{
  const game=await makeGame();t.after(game.close);const w=game.window,town=settleGame(game);
  const levelData=w.unlockTree.farm.levels[0];
  const proposal=propose(w,town,'unlockLevel',{value:{type:'farm',levelData}});
  proposal.querySelector('[type="yes"]').click();
  const choice=w.planet._paultendoLife.decisions[0];assert.equal(proposal.dataset.storyId,String(choice.id));
  proposal.querySelector('.paultendoChronicleStoryLink').click();
  assert.match(panel(w).textContent,/Your choice: Yes/);
  w.gameEvents.townFarm.func(town,null,{value:50});
  const choose=w.chooseEvent;w.chooseEvent=()=>null;try{w.nextDay();}finally{w.chooseEvent=choose;}
  const harvest=[...w.document.querySelectorAll('.logMessage')].find(e=>e.querySelector('.logText')?.textContent.includes('first harvest'));
  assert.ok(harvest);assert.equal(harvest.dataset.storyKind,'decision');assert.equal(harvest.dataset.storyId,String(choice.id));
  harvest.querySelector('.paultendoChronicleStoryLink').click();assert.match(panel(w).textContent,/What followed.*first harvest/s);
  const unrelated=w.logMessage('A ship reaches the coast.');assert.equal(entry(w,unrelated).querySelector('.paultendoChronicleStoryLink'),null);
  // A v42 choice had the actual log ID, but no link in its saved HTML.
  for(const log of [proposal,harvest]) {log.querySelector('.paultendoChronicleStoryLink')?.remove();log.removeAttribute('data-story-kind');log.removeAttribute('data-story-id');}
  const restored=await makeGame({save:JSON.parse(JSON.stringify(w.generateSave()))});t.after(restored.close);
  const old=entry(restored.window,choice.logId);assert.ok(old.querySelector('.paultendoChronicleStoryLink'));
  old.querySelector('.paultendoChronicleStoryLink').click();assert.match(panel(restored.window).textContent,/Your choice: Yes.*What followed.*first harvest/s);
  assert.equal(entry(restored.window,unrelated).querySelector('.paultendoChronicleStoryLink'),null);
  assert.deepEqual(game.errors,[]);assert.deepEqual(restored.errors,[]);
});

test('old decorator metadata is retired on reload while native facts, formatting and genuine causes survive',async t=>{
  const game=await makeGame();t.after(game.close);const w=game.window;settleGame(game);
  const cause='trade squeeze and mounting debt';
  const id=w.logMessage('A caravan arrives. (thanks to '+cause+')');
  entry(w,id).setAttribute('data-cause',cause);entry(w,id).setAttribute('data-chain','invented ancestry');entry(w,id).title='Roots: '+cause;
  const genuine=w.logMessage('The bridge falls because the river flooded.');
  const parenthetical=w.logMessage('The town grows (after the settlers arrive).');
  const message='A caravan arrives. (thanks to '+cause+')';
  const day={day:w.planet.day,entries:[{system:'trade',message,logId:id,cause,chain:'invented ancestry'}],counts:{trade:1}};
  w.planet._paultendoChronicleStore={days:[day],index:{[day.day]:day},byLogId:{[id]:day.entries[0]}};
  const restored=await makeGame({save:JSON.parse(JSON.stringify(w.generateSave()))});t.after(restored.close);const rw=restored.window;
  assert.equal(entry(rw,id).querySelector('.logText').textContent,'A caravan arrives.');
  assert.equal(entry(rw,id).hasAttribute('data-cause'),false);assert.equal(entry(rw,id).hasAttribute('data-chain'),false);assert.equal(entry(rw,id).title,'');
  assert.equal(entry(rw,genuine).querySelector('.logText').textContent,'The bridge falls because the river flooded.');
  assert.equal(entry(rw,parenthetical).querySelector('.logText').textContent,'The town grows (after the settlers arrive).');
  rw.document.getElementById('actionItem-chronicle').click();click(rw,'Day '+day.day);
  assert.match(panel(rw).textContent,/A caravan arrives/);assert.doesNotMatch(panel(rw).textContent,/trade squeeze|invented ancestry|Word is|thread runs/);
  assert.equal(rw.planet._paultendoChronicleStore.byLogId[id].cause,undefined);
  assert.deepEqual(restored.errors,[]);
});

test('pruned or unseen stories leave their recorded event intact without broken links or revealing hidden towns',async t=>{
  for(const hidden of [false,true]) {
    const game=await makeGame();t.after(game.close);const w=game.window,town=settleGame(game),root=scholar(w,town);
    const log=[...w.document.querySelectorAll('.logMessage')].find(e=>e.dataset.storyKind==='teaching'&&e.dataset.storyId===String(root.id));
    const id=log.id.slice('logMessage-'.length),text=log.querySelector('.logText').textContent;
    if(hidden)town._hidden=true;else w.planet._paultendoLife.teachings=[];
    const restored=await makeGame({save:JSON.parse(JSON.stringify(w.generateSave()))});t.after(restored.close);
    const next=entry(restored.window,id);assert.equal(next.querySelector('.logText').textContent,text);
    assert.equal(next.querySelector('.paultendoChronicleStoryLink'),null);
    assert.deepEqual(restored.errors,[]);
  }
});
