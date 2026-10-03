import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGame,settleGame} from './harness.mjs';
const panel=w=>w.document.getElementById('actionSubList');
function click(w,text){const b=[...panel(w).querySelectorAll('[role="button"],.actionItem')].find(b=>b.textContent.includes(text));assert.ok(b,`Missing ${text}: ${panel(w).textContent}`);b.click();}
function next(w){const choose=w.chooseEvent;w.chooseEvent=()=>null;try{w.nextDay();}finally{w.chooseEvent=choose;}}
function prepare(g,role='doctor'){
 const w=g.window,t=settleGame(g);t.name='Wick';t.pop=48;t.jobs={[role]:47};t.resources.crop=200;t.resources.metal=20;t.resources.rock=20;t.resources.glass=20;t.guidanceTrust=90;w.planet.day=10;
 Object.assign(w.planet.unlocks,{education:20,fire:40,smith:40,travel:30,trade:10});t.influences.travel=3;
 w.openRegBrowser(t,'town');[...w.document.querySelectorAll('.paultendoTownLife button')].find(b=>b.textContent==='Meet the people').click();
 for(const p of t._paultendoPeople){p.outlook='curious';p.trust=90;}
 return t;
}
function memory(w){w.document.getElementById('actionItem-annals').click();click(w,'The Traveler');}
function leave(w,t,kind='lens'){
 memory(w);click(w,'What you carried');click(w,{lens:'Clear lens',compass:'Compass',fork:'Tuning fork'}[kind]);click(w,'Leave it at Near Wick');
 const a=w.planet._paultendoLife.artifacts.at(-1),target=w.planet.chunks[a.place];
 for(let n=0;n<8&&a.status==='waiting';n++){w.planet.day++;w.gameEvents.explorationExpeditionAuto.func(t,null,{choice:'yes',mission:{type:'frontier',target,label:'frontier scouting expedition'}});}
 const person=t._paultendoPeople.find(p=>p.id===a.person);assert.ok(person);person.outlook='curious';person.trust=90;
 w.planet.day=a.due-1;next(w);return a;
}
function story(w,t,a){w.openRegBrowser(t,'town');[...w.document.querySelectorAll('.paultendoTownLife button')].find(b=>b.textContent===`${a.title || {lens:'Clear lens',compass:'Compass',fork:'Tuning fork'}[a.kind]} · Its story`).click();}
function whisper(w,t,a,words){story(w,t,a);click(w,`Speak to ${a.name}`);click(w,words);const r=w.planet._paultendoLife.whispers.at(-1);r.roll=0;return r;}
function respond(w,r){w.planet.day=r.due-1;next(w);}
function loop(w){memory(w);click(w,'The way back');click(w,'Return to the beginning');w.handlePrompt(true);}
function rename(w,t,a,name){story(w,t,a);click(w,'Give it a name');w.document.getElementById('popupText').value=name;w.handlePrompt(name);}
function craft(w,t,a){const r=whisper(w,t,a,'Try making something');respond(w,r);assert.equal(r.reception,'heard');return {r,work:w.planet._paultendoLife.artifactWork.at(-1)};}

test('player-inspired successors use real materials, name a maker and retain their predecessor through reload',async t=>{
 const g=await makeGame();t.after(g.close);const w=g.window,town=prepare(g),parent=leave(w,town);
 const {r,work}=craft(w,town,parent);assert.equal(work.status,'working');assert.equal(w.planet._paultendoLife.artifacts.length,1);
 // Native production remains running. Compare the actual paid material record at completion.
 w.planet.day=work.due-1;next(w);const made=w.planet._paultendoLife.artifacts.find(a=>a.id===work.artifact);
 assert.ok(made);assert.equal(work.status,'made');assert.deepEqual(JSON.parse(JSON.stringify(work.materials)),{glass:1,metal:2});
 assert.equal(made.origin.maker.name,parent.name);assert.equal(made.origin.maker.town,'Wick');assert.equal(made.origin.maker.day,w.planet.day);
 assert.equal(made.parent.lineage,parent.lineage);assert.equal(made.origin.whisper,'Try making something of your own.');assert.equal(r.created,made.id);
 rename(w,town,made,'The Clouded Eye');assert.equal(made.title,'The Clouded Eye');assert.equal(made.named,true);
 const restored=await makeGame({save:JSON.parse(JSON.stringify(w.generateSave()))});t.after(restored.close);
 const copy=restored.window.planet._paultendoLife.artifacts.find(a=>a.id===made.id);
 assert.equal(copy.title,'The Clouded Eye');assert.equal(copy.origin.maker.name,made.origin.maker.name);assert.equal(copy.parent.lineage,parent.lineage);
 assert.deepEqual(g.errors,[]);assert.deepEqual(restored.errors,[]);
});

test('lost work or materials prevents production, and a missing prerequisite offers no craft command',async t=>{
 for(const obstacle of ['materials','worker','knowledge','reference']){
  const g=await makeGame();t.after(g.close);const w=g.window,town=prepare(g),parent=leave(w,town);
  if(obstacle==='knowledge'){
   w.planet.unlocks.fire=10;story(w,town,parent);click(w,`Speak to ${parent.name}`);assert.doesNotMatch(panel(w).textContent,/Try making something/);assert.equal(w.planet._paultendoLife.artifactWork.length,0);continue;
  }
  const {work}=craft(w,town,parent);
  if(obstacle==='materials') town.resources.metal=0;
  if(obstacle==='worker') town.jobs.doctor=0;
  if(obstacle==='reference') parent.status='returned';
  w.planet.day=work.due-1;next(w);assert.equal(work.status,'abandoned');assert.equal(w.planet._paultendoLife.artifacts.length,1);assert.equal(work.materials,undefined);
  assert.deepEqual(g.errors,[]);
 }
});

test('people can create an independent object from a player idea without any inherited reference',async t=>{
 const g=await makeGame();t.after(g.close);const w=g.window,town=prepare(g,'musician');
 click(w,'Musician');click(w,'Make something of your own');click(w,'Make a tuning fork');
 const record=w.planet._paultendoLife.whispers.at(-1);record.roll=0;respond(w,record);
 const work=w.planet._paultendoLife.artifactWork[0];w.planet.day=work.due-1;next(w);
 const made=w.planet._paultendoLife.artifacts[0];assert.equal(made.kind,'fork');assert.equal(made.parent,undefined);assert.equal(made.origin.maker.role,'musician');assert.equal(made.origin.whisper,'Try making a tuning fork of your own.');
 assert.equal(made.quality,0.6);assert.deepEqual(g.errors,[]);
});

test('returned player-named work crosses the actual beginning with its history, without restoring lost objects',async t=>{
 const g=await makeGame();t.after(g.close);const w=g.window,town=prepare(g),parent=leave(w,town);
 const {work}=craft(w,town,parent);w.planet.day=work.due-1;next(w);const made=w.planet._paultendoLife.artifacts.find(a=>a.id===work.artifact);rename(w,town,made,'The Clouded Eye');
 const person=town._paultendoPeople.find(p=>p.id===made.person);w.planet.day=person.lastWhisper+12;
 const r=whisper(w,town,made,'Will you entrust');respond(w,r);assert.equal(r.reception,'heard');assert.notEqual(made.status,'returned');assert.ok(made.returnOffer);
 town.influences.disease=0;w.planet.day=made.returnOffer.earliest-1;next(w);assert.equal(made.status,'returned');
 const pack=w._paultendoUniverse.traveler.pack;assert.ok(pack.some(a=>a.title==='The Clouded Eye'));assert.equal(pack.some(a=>a.lineage===parent.lineage),false);
 const oldDay=w.planet.day,oldConfig=JSON.stringify(w.planet.config),oldTerrain=w.planet.chunks['3,14'].e;
 loop(w);assert.equal(w.planet.day,1);assert.equal(w.regCount('town'),0);assert.equal(JSON.stringify(w.planet.config),oldConfig);assert.equal(w.planet.chunks['3,14'].e,oldTerrain);
 assert.equal(w._paultendoUniverse.traveler.passage,1);assert.match(panel(w).textContent,/The Clouded Eye/);assert.equal([...panel(w).querySelectorAll('[role="button"]')].some(b=>b.textContent==='Clear lens'),false);
 const carried=w._paultendoUniverse.traveler.pack.find(a=>a.title==='The Clouded Eye');assert.equal(carried.lineage,made.lineage);assert.equal(carried.named,true);assert.equal(carried.origin.maker.day,made.origin.maker.day);assert.ok(carried.origin.history.some(h=>h.events.some(e=>e.text.includes('finishes'))));
 const saved=JSON.parse(w.localStorage.getItem('R74nMain-GenTownSave'));assert.equal(saved.paultendoUniverse.traveler.passage,1);assert.equal(saved.paultendoUniverse.traveler.previous.planet.day,oldDay);
 const restored=await makeGame({save:saved});t.after(restored.close);const rw=restored.window;assert.equal(rw._paultendoUniverse.traveler.passage,1);
 const newTown=settleGame(restored);memory(rw);click(rw,'What you carried');click(rw,'The Clouded Eye');click(rw,'Leave it at Near');const reborn=rw.planet._paultendoLife.artifacts.at(-1);
 assert.equal(reborn.lineage,made.lineage);assert.equal(reborn.title,'The Clouded Eye');assert.equal(reborn.named,true);assert.equal(reborn.events[0].day,1);assert.match(panel(rw).textContent,/Before this beginning/);assert.ok(newTown);
 assert.deepEqual(g.errors,[]);assert.deepEqual(restored.errors,[]);
});

test('a guarded bearer can refuse return, and an empty pack stays empty across the loop',async t=>{
 const g=await makeGame();t.after(g.close);const w=g.window,town=prepare(g),a=leave(w,town),p=town._paultendoPeople.find(p=>p.id===a.person);
 p.outlook='guarded';p.trust=20;const r=whisper(w,town,a,'Will you entrust');respond(w,r);assert.equal(r.reception,'refused');assert.notEqual(a.status,'returned');
 w._paultendoUniverse.traveler.pack=[];loop(w);assert.equal(w.planet.day,1);assert.equal(w._paultendoUniverse.traveler.pack.length,0);assert.match(panel(w).textContent,/Your hands are empty/);assert.deepEqual(g.errors,[]);
});

test('the last history can be revisited after reload, restoring its towns, custody and same passage',async t=>{
 const g=await makeGame();t.after(g.close);const w=g.window,town=prepare(g),a=leave(w,town);
 const originalDay=w.planet.day,originalTown=town.id;loop(w);
 const restored=await makeGame({save:JSON.parse(JSON.stringify(w.generateSave()))});t.after(restored.close);const rw=restored.window;
 memory(rw);click(rw,'Other histories');click(rw,'Revisit the last history');rw.handlePrompt(true);
 assert.equal(rw.planet.day,originalDay);assert.equal(rw.regGet('town',originalTown).name,'Wick');assert.equal(rw.planet._paultendoLife.artifacts[0].id,a.id);assert.equal(rw._paultendoUniverse.traveler.passage,0);assert.equal(rw._paultendoUniverse.traveler.pack.some(a=>a.kind==='lens'),false);
 assert.deepEqual(g.errors,[]);assert.deepEqual(restored.errors,[]);
});


test('work survives reload while unfinished and later histories retain the stories of objects left behind',async t=>{
 const g=await makeGame();t.after(g.close);const w=g.window,town=prepare(g),parent=leave(w,town);
 const {work}=craft(w,town,parent);
 const restored=await makeGame({save:JSON.parse(JSON.stringify(w.generateSave()))});t.after(restored.close);
 const rw=restored.window,rt=rw.regGet('town',town.id),resumed=rw.planet._paultendoLife.artifactWork[0];
 assert.equal(resumed.id,work.id);assert.equal(resumed.status,'working');rw.planet.day=resumed.due-1;next(rw);
 assert.equal(resumed.status,'made');assert.equal(rw.planet._paultendoLife.artifacts.length,2);
 loop(rw);const firstEcho=rw._paultendoUniverse.traveler.echoes[0];assert.equal(firstEcho.objects.length,2);assert.ok(firstEcho.objects.some(a=>a.events.some(e=>e.text.includes('finishes'))));
 settleGame(restored);next(rw);loop(rw);assert.equal(rw._paultendoUniverse.traveler.passage,2);
 assert.equal(rw._paultendoUniverse.traveler.echoes[0].objects.length,2);assert.equal(rw._paultendoUniverse.traveler.previous.paultendoUniverse.traveler.previous,undefined,'Complete snapshots must not nest recursively');
 memory(rw);click(rw,'Other histories');click(rw,`Remember ${firstEcho.objects[1].title}`);assert.match(panel(rw).textContent,/Made by Vuwan in Wick/);assert.match(panel(rw).textContent,/finishes/);
 assert.equal(rw._paultendoUniverse.traveler.pack.some(a=>a.kind==='lens'),false);assert.deepEqual(g.errors,[]);assert.deepEqual(restored.errors,[]);
});

test('a quick promise survives reload and waits for the sick before a single actual handover',async t=>{
 const g=await makeGame();t.after(g.close);const w=g.window,town=prepare(g),a=leave(w,town);
 const r=whisper(w,town,a,'Will you entrust');respond(w,r);
 assert.equal(r.reception,'heard');assert.equal(r.responseDay,r.day+2);assert.notEqual(a.status,'returned');assert.ok(a.returnOffer.earliest>r.responseDay);
 const restored=await makeGame({save:JSON.parse(JSON.stringify(w.generateSave()))});t.after(restored.close);
 const rw=restored.window,rt=rw.regGet('town',town.id),ra=rw.planet._paultendoLife.artifacts[0];
 rt.influences.disease=10;rw.planet.day=ra.returnOffer.earliest-1;next(rw);assert.notEqual(ra.status,'returned');assert.equal(ra.returnOffer.need,'The sick still need it.');
 story(rw,rt,ra);assert.match(panel(rw).textContent,/promised it to you.*The sick still need it/);
 rt.influences.disease=0;next(rw);assert.equal(ra.status,'returned');assert.match(panel(rw).textContent,/You carry it now/);assert.equal(ra.returnOffer,undefined);
 const count=rw._paultendoUniverse.traveler.pack.filter(p=>p.lineage===a.lineage).length;assert.equal(count,1);next(rw);assert.equal(rw._paultendoUniverse.traveler.pack.filter(p=>p.lineage===a.lineage).length,1);
 assert.deepEqual(g.errors,[]);assert.deepEqual(restored.errors,[]);
});

test('object purpose, novelty, attachment and usable substitutes change the handover rhythm',async t=>{
 const spans={};
 for(const context of ['healing','curiosity','attached','substitute','madeHere']) {
  const g=await makeGame();t.after(g.close);const w=g.window,town=prepare(g);let a=leave(w,town,context==='curiosity'?'fork':'lens');const person=town._paultendoPeople.find(p=>p.id===a.person);
  if(context==='attached'){person.outlook='steadfast';person.trust=95;}
  if(['madeHere','substitute'].includes(context)) {
   const {work}=craft(w,town,a);w.planet.day=work.due-1;next(w);w.planet.day=w.planet._paultendoLife.artifacts.at(-1).due-1;next(w);
   assert.equal(w.planet._paultendoLife.artifacts.at(-1).status,'healing');if(context==='madeHere') a=w.planet._paultendoLife.artifacts.at(-1);w.planet.day=person.lastWhisper+12;
  }
  const r=whisper(w,town,a,'Will you entrust');respond(w,r);assert.equal(r.reception,'heard');spans[context]=a.returnOffer.earliest-r.responseDay;
  if(context==='substitute'){town.influences.disease=10;w.planet.day=a.returnOffer.earliest-1;next(w);assert.equal(a.status,'returned','The working successor keeps care going');}
  assert.deepEqual(g.errors,[]);
 }
 assert.ok(spans.healing>spans.curiosity);assert.ok(spans.attached>spans.healing);assert.ok(spans.substitute<spans.healing);assert.ok(spans.madeHere<spans.healing);
});

test('rushing a promised handover costs actual trust and interrupts the object’s use',async t=>{
 const g=await makeGame();t.after(g.close);const w=g.window,town=prepare(g),a=leave(w,town);
 const promise=whisper(w,town,a,'Will you entrust');respond(w,promise);assert.ok(a.returnOffer);
 story(w,town,a);click(w,`Speak to ${a.name}`);assert.doesNotMatch(panel(w).textContent,/I need it now/);
 w.planet.day=promise.day+4;const rushed=whisper(w,town,a,'I need it now');respond(w,rushed);
 assert.equal(rushed.reception,'heard');assert.equal(a.status,'returned');assert.equal(rushed.trustChange,-12);assert.equal(rushed.communityTrustChange,-2);
 assert.ok(rushed.changes.disease>0);assert.ok(rushed.changes.happy<0);assert.match(a.events.at(-1).text,/turn away/);assert.ok(a.events.some(e=>e.text.includes('Your voice means less')));
 assert.ok(promise.steps.some(s=>s.text.includes('before they were ready')));assert.deepEqual(g.errors,[]);
});

test('a changed bearer cancels the old promise and a full pack delays delivery',async t=>{
 for(const obstacle of ['custody','pack']) {
  const g=await makeGame();t.after(g.close);const w=g.window,town=prepare(g),a=leave(w,town);
  const r=whisper(w,town,a,'Will you entrust');respond(w,r);
  if(obstacle==='custody') town.jobs.doctor=0;
  else while(w._paultendoUniverse.traveler.pack.length<5) w._paultendoUniverse.traveler.pack.push({kind:'fork',lineage:`test:${w._paultendoUniverse.traveler.pack.length}`});
  town.influences.disease=0;w.planet.day=a.returnOffer.earliest-1;next(w);assert.notEqual(a.status,'returned');
  if(obstacle==='custody') {assert.equal(a.returnOffer,undefined);assert.ok(r.steps.some(s=>s.text.includes('new bearer')));}
  else {assert.match(a.returnOffer.need,/pack is full/);w._paultendoUniverse.traveler.pack.pop();next(w);assert.equal(a.status,'returned');}
  assert.deepEqual(g.errors,[]);
 }
});

test('craft has progress before completion and repeated practice shortens later work',async t=>{
 const g=await makeGame();t.after(g.close);const w=g.window,town=prepare(g),a=leave(w,town);
 const {r,work}=craft(w,town,a);assert.equal(work.due-work.started,8);
 w.planet.day=work.started+3;next(w);assert.equal(work.status,'working');assert.equal(work.progress,w.planet.day);assert.ok(r.steps.some(s=>s.text.includes('glass is taking shape')));
 assert.equal(w.planet._paultendoLife.artifacts.length,1);w.planet.day=work.due-1;next(w);assert.equal(work.status,'made');
 const person=town._paultendoPeople.find(p=>p.id===a.person);w.planet.day=person.lastWhisper+12;
 w.openRegBrowser(town,'town');[...w.document.querySelectorAll('.paultendoTownLife button')].find(b=>b.textContent==='Meet the people').click();click(w,'Doctor');click(w,'Make something of your own');click(w,'Make a clear lens');
 const second=w.planet._paultendoLife.whispers.at(-1);second.roll=0;respond(w,second);const practiced=w.planet._paultendoLife.artifactWork.at(-1);assert.equal(practiced.due-practiced.started,6);assert.equal(practiced.status,'working');assert.deepEqual(g.errors,[]);
});


test('a replacement completed after the promise can bring the actual handover forward',async t=>{
 const g=await makeGame();t.after(g.close);const w=g.window,town=prepare(g,'scholar');w.planet.unlocks.astronomy=10;
 const a=leave(w,town),person=town._paultendoPeople.find(p=>p.id===a.person);person.outlook='steadfast';person.trust=95;
 const r=whisper(w,town,a,'Will you entrust');respond(w,r);const originalDue=a.returnOffer.earliest;
 w.planet.day=person.lastWhisper+12;const {work}=craft(w,town,a);
 w.planet.day=work.due-1;next(w);assert.equal(work.status,'made');assert.notEqual(a.status,'returned');
 const replacement=w.planet._paultendoLife.artifacts.find(o=>o.id===work.artifact);w.planet.day=replacement.due-1;next(w);
 assert.equal(replacement.status,'study');next(w);assert.equal(a.status,'returned');assert.ok(w.planet.day<originalDue);
 assert.deepEqual(g.errors,[]);
});
