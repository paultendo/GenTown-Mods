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

test('reload keeps one native greeting per day and current issue report without merging real events or story links',async t=>{
 const game=await makeGame();t.after(game.close);const w=game.window,town=settleGame(game);w.planet.day=12;
 const greeting=`The Sun rises on Planet ${w.planet.name}...`,first=w.logMessage(greeting),second=w.logMessage(greeting);
 const repeatedEvent='Two strangers reach the town.';const a=w.logMessage(repeatedEvent),b=w.logMessage(repeatedEvent);
 const issueA=w.logMessage(greeting+' Inhabitants are worried about a flood.'),issueB=w.logMessage(greeting+' Inhabitants are anxious about a flood.'),otherIssue=w.logMessage(greeting+' Inhabitants are worried about a war.');
 const root=scholar(w,town),linked=w.logMessage(greeting,null,{_paultendoStory:{kind:'teaching',id:root.id}});
 w.planet.day=11;const older=w.logMessage(greeting);w.planet.day=12;
 let saved=JSON.parse(JSON.stringify(w.generateSave()));
 for(let n=0;n<3;n++){
  const restored=await makeGame({save:saved});const rw=restored.window;const logs=[...rw.document.querySelectorAll('.logMessage')];
  const plainGreetings=logs.filter(e=>e.querySelector('.logDay')?.dataset.day==='12'&&!e.dataset.storyKind&&e.querySelector('.logText')?.textContent===greeting);assert.equal(plainGreetings.length,1);
  const issueLogs=logs.filter(e=>/Inhabitants are (worried|anxious) about a flood\./.test(e.querySelector('.logText')?.textContent || ''));assert.equal(issueLogs.length,1);assert.ok(entry(rw,otherIssue));assert.ok(entry(rw,older));assert.ok(entry(rw,a));assert.ok(entry(rw,b));assert.ok(entry(rw,linked).querySelector('.paultendoChronicleStoryLink'));
  const remaining=new Set(logs.map(e=>e.id.slice('logMessage-'.length))),store=rw.planet._paultendoChronicleStore;
  for(const id of [first,second,issueA,issueB])if(!remaining.has(id))assert.equal(store.byLogId[id],undefined);
  for(const day of store.days){const counts={};for(const e of day.entries)counts[e.system || 'misc']=(counts[e.system || 'misc'] || 0)+1;assert.deepEqual(JSON.parse(JSON.stringify(day.counts)),counts);}
  saved=JSON.parse(JSON.stringify(rw.generateSave()));assert.deepEqual(restored.errors,[]);restored.close();
 }
 assert.deepEqual(game.errors,[]);
});

test('today’s news keeps native coloured flags, opens towns and original events, and survives reload safely',async t=>{
 const game=await makeGame();t.after(game.close);const w=game.window,town=settleGame(game);
 town.flag='{{color:><|#f47759|#554aff}}';
 const id=w.logMessage('{{regname:town|'+town.id+'}} signs a peace treaty.','milestone');
 const native=entry(w,id).querySelector('.entityName .font2');assert.ok(native);
 await new Promise(r=>setTimeout(r,40));
 let highlights=w.document.getElementById('paultendoChronicleHighlights');
 assert.equal(highlights.parentNode.id,'paultendoChronicleHeader');assert.equal(highlights.hidden,false);
 let flag=highlights.querySelector('.font2');assert.equal(flag.style.color,native.style.color);assert.equal(flag.style.backgroundColor,native.style.backgroundColor);
 let visited;w.handleEntityClick=el=>{visited=el.dataset.id;};
 highlights.querySelector('.entityName').dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));assert.equal(visited,String(town.id));
 highlights.querySelector('.paultendoChronicleRead').click();assert.equal(w.document.activeElement,entry(w,id));
 // A native striped flag has a gradient; unrelated saved CSS or handlers never survive.
 const striped=w.logMessage('{{colorsdown:XXX|#fff|#f00|#00f}} A new town is founded.','milestone');
 const unsafe=entry(w,id).querySelector('.logText');unsafe.style.position='fixed';unsafe.setAttribute('onclick','window.injected=true');
 const restored=await makeGame({save:JSON.parse(JSON.stringify(w.generateSave()))});t.after(restored.close);const rw=restored.window;
 flag=entry(rw,id).querySelector('.font2');assert.equal(flag.style.backgroundColor,native.style.backgroundColor);
 assert.match(entry(rw,striped).querySelector('.font2').style.backgroundImage,/linear-gradient/);
 highlights=rw.document.getElementById('paultendoChronicleHighlights');
 assert.equal(highlights.querySelector('.entityName .font2').style.backgroundColor,native.style.backgroundColor);
 assert.equal(entry(rw,id).querySelector('.logText').style.position,'');assert.equal(entry(rw,id).querySelector('.logText').hasAttribute('onclick'),false);
 assert.equal(highlights.querySelector('[onclick]'),null);
 assert.deepEqual(restored.errors,[]);assert.deepEqual(game.errors,[]);
});

test('quiet days leave space for choices and compact news stays beside the Chronicle without duplicating actions',async t=>{
 const game=await makeGame();t.after(game.close);const w=game.window,town=settleGame(game);
 await new Promise(r=>setTimeout(r,40));w.planet.day=15;w.clearLog();w.logMessage('The Sun rises on Planet '+w.planet.name+'... Inhabitants are worried about a war.');
 w.logMessage('A reward reaches the town.');await new Promise(r=>setTimeout(r,40));
 const highlights=w.document.getElementById('paultendoChronicleHighlights');assert.equal(highlights.hidden,true);
 assert.doesNotMatch(w.document.getElementById('logPanel').textContent,/No major events|Chronicle Highlights/);
 const proposal=propose(w,town,'unlockLevel',{value:{type:'farm',levelData:w.unlockTree.farm.levels[0]}});
 proposal.querySelector('.logText').appendChild(w.document.createTextNode(' A discovery awaits.'));
 w.logChange(proposal.id.slice('logMessage-'.length),'A discovery awaits.');
 w.logMessage('An earthquake shakes the coast.','warning');await new Promise(r=>setTimeout(r,40));
 assert.equal(highlights.hidden,false);assert.equal(highlights.querySelector('.logAct'),null);
 Object.defineProperty(w,'innerWidth',{value:390,writable:true});w.dispatchEvent(new w.Event('resize'));
 assert.equal(highlights.parentNode.id,'paultendoChronicleHeader');assert.equal(highlights.open,false);
 highlights.open=true;w.innerWidth=1200;w.innerHeight=1000;w.dispatchEvent(new w.Event('resize'));
 assert.equal(highlights.parentNode.id,'paultendoChronicleHeader');assert.equal(highlights.open,true);
 w.innerHeight=768;w.dispatchEvent(new w.Event('resize'));assert.equal(highlights.open,true);
 highlights.open=true;w.dispatchEvent(new w.Event('resize'));assert.equal(highlights.open,true,'A player can keep the compact news open');
 assert.ok(proposal.querySelector('[type="yes"]'));assert.deepEqual(game.errors,[]);
});

test('uneventful days remain quiet unless an actual event has already made news that day',async t=>{
 const g=await makeGame();t.after(g.close);const w=g.window;settleGame(g);w.planet.day=15;w.clearLog();
 const first=w.logMessage('An uneventful day.');assert.ok(entry(w,first));
 w.logMessage('The Sun rises on Planet '+w.planet.name+'...');w.logMessage('A visitor waits by the road.');assert.ok(w.logMessage('An uneventful day.'));
 w.logMessage('A workshop finishes its trials.',null,{_paultendoHighlight:true});assert.equal(entry(w,first),null);assert.equal(w.logMessage('An uneventful day.'),undefined);
 assert.equal(w.planet._paultendoChronicleUI.entriesById[first],undefined);assert.equal(w.planet._paultendoChronicleStore.byLogId[first],undefined);
 for(const day of w.planet._paultendoChronicleStore.days){const counts={};for(const e of day.entries)counts[e.system || 'misc']=(counts[e.system || 'misc'] || 0)+1;assert.deepEqual(JSON.parse(JSON.stringify(day.counts)),counts);}
 w.planet.day++;assert.ok(w.logMessage('An uneventful day.'),'Yesterday’s news cannot contradict a quiet day');
 w.logMessage('An earthquake shakes the coast.','warning');assert.equal(w.logMessage('An uneventful day.'),undefined);
 const saved=JSON.parse(JSON.stringify(w.generateSave())),restored=await makeGame({save:saved});t.after(restored.close);const rw=restored.window;assert.equal(rw.logMessage('An uneventful day.'),undefined);rw.planet.day++;assert.ok(rw.logMessage('An uneventful day.'));assert.deepEqual(g.errors,[]);assert.deepEqual(restored.errors,[]);
});
