import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGame,settleGame} from './harness.mjs';
const panel=w=>w.document.getElementById('actionSubList');
function click(w,text){const b=[...panel(w).querySelectorAll('[role="button"],.actionItem')].find(b=>b.textContent.includes(text));assert.ok(b,`Missing ${text}`);b.click();}
function next(w){const choose=w.chooseEvent;w.chooseEvent=()=>null;try{w.nextDay();}finally{w.chooseEvent=choose;}}
function prepare(g,role='farmer') {const w=g.window,t=settleGame(g);t.name='Wick';t.pop=48;t.jobs={};t.jobs[role]=47;t.resources.crop=200;t.guidanceTrust=90;w.planet.day=10;w.planet.unlocks.travel=20;w.planet.unlocks.trade=10;t.influences.travel=3;w.openRegBrowser(t,'town');[...w.document.querySelectorAll('.paultendoTownLife button')].find(b=>b.textContent==='Meet the people').click();for(const p of t._paultendoPeople){p.outlook='curious';p.trust=90;}return t;}
function leave(w,town,kind='lens') {
 w.document.getElementById('actionItem-annals').click();click(w,'The Traveler');click(w,'What you carried');
 click(w,{lens:'Clear lens',compass:'Compass',fork:'Tuning fork'}[kind]);click(w,'Leave it at Near Wick');
 const a=w.planet._paultendoLife.artifacts.at(-1);assert.equal(a.kind,kind);return a;
}
function encounter(w,town,a) {
 const p=w.planet._paultendoLife.places[a.place],target=w.planet.chunks[a.place];
 for(let i=0;i<8&&a.status==='waiting';i++){w.planet.day++;w.gameEvents.explorationExpeditionAuto.func(town,null,{choice:'yes',mission:{type:'frontier',target,label:'frontier scouting expedition'}});}
 assert.notEqual(a.status,'waiting');assert.ok(p.visits.length>0);const person=town._paultendoPeople.find(p=>p.id===a.person);
 assert.ok(person);person.outlook='curious';person.trust=90;return person;
}
function resolve(w,a){w.planet.day=a.due-1;next(w);}
function artifactPage(w,town,a){w.openRegBrowser(town,'town');const b=[...w.document.querySelectorAll('.paultendoTownLife button')].find(b=>b.textContent===`${{lens:'Clear lens',compass:'Compass',fork:'Tuning fork'}[a.kind]} · Its story`);assert.ok(b);b.click();}
function whisper(w,town,a,topic){artifactPage(w,town,a);click(w,`Speak to ${a.name}`);click(w,topic==='share'?'Let others learn':'Keep it from everyone');const record=w.planet._paultendoLife.whispers.at(-1);record.roll=0;return record;}

test('placing a finite inherited object records the actual action, creates no earlier expedition and survives reload',async t=>{
 const g=await makeGame();t.after(g.close);const w=g.window,town=prepare(g);
 const random=w.Math.random;let calls=0;w.Math.random=()=>{calls++;return random();};
 const a=leave(w,town);assert.equal(calls,0);w.Math.random=random;
 assert.equal(a.status,'waiting');assert.equal(a.origin.passage,0);assert.deepEqual(Array.from(a.origin.history),[]);
 assert.equal(w.planet._paultendoLife.places[a.place].visits.length,0);
 assert.match(panel(w).textContent,/still waiting where you left/);click(w,'Back to what you carried');
 assert.equal([...panel(w).querySelectorAll('[role="button"]')].some(b=>b.textContent==='Clear lens'),false);
 const rw=(await makeGame({save:JSON.parse(JSON.stringify(w.generateSave()))}));t.after(rw.close);
 assert.deepEqual(JSON.parse(JSON.stringify(rw.window.planet._paultendoLife.artifacts)),JSON.parse(JSON.stringify(w.planet._paultendoLife.artifacts)));
 assert.deepEqual(g.errors,[]);assert.deepEqual(rw.errors,[]);
});

test('an object is found on an actual path by a worker and remains a curiosity without the necessary knowledge',async t=>{
 const g=await makeGame();t.after(g.close);const w=g.window,town=prepare(g),a=leave(w,town,'compass');
 const args={};w.gameEvents.explorationExpeditionAuto.value(town,null,args);assert.equal(a.status,'waiting','Eligibility must not become a discovery');
 const person=encounter(w,town,a);assert.ok(a.events.some(e=>e.text.includes(`${person.name}, a`)));
 resolve(w,a);assert.equal(a.status,'kept');assert.equal(Object.keys(a.uses).length,0);
 assert.match(a.events.at(-1).text,/not found a use/);
 Object.assign(w.planet.unlocks,{smith:30,education:10});next(w);
 assert.equal(a.status,'study');assert.ok(a.events.at(-1).changes.travel>0 && a.events.at(-1).changes.trade<0);
 const length=a.events.length;next(w);assert.equal(a.events.length,length,'The same study cannot grant repeated bonuses');
 assert.deepEqual(g.errors,[]);
});

test('a lens can become healing, a relic or military craft according to its actual finder',async t=>{
 for(const role of ['doctor','priest','soldier']) {
  const g=await makeGame();t.after(g.close);const w=g.window,town=prepare(g,role);Object.assign(w.planet.unlocks,{education:10,military:10,smith:30});
  if(role==='priest') town.religion=1;
  const a=leave(w,town),person=encounter(w,town,a);assert.equal(person.role,role);
  resolve(w,a);assert.equal(a.status,{doctor:'healing',priest:'revered',soldier:'drills'}[role]);
  const changes=a.events.at(-1).changes;
  if(role==='doctor') assert.ok(changes.disease<0 && changes.education>0);
  if(role==='priest') assert.ok(changes.faith>0 && changes.education<0);
  if(role==='soldier') assert.ok(changes.military>0 && changes.happy<0);
  assert.deepEqual(g.errors,[]);
 }
});

test('a tuning fork can produce a shared song with actual joy and time taken from trade',async t=>{
 const g=await makeGame();t.after(g.close);const w=g.window,town=prepare(g,'musician'),a=leave(w,town,'fork');
 const person=encounter(w,town,a);assert.equal(person.role,'musician');resolve(w,a);
 assert.equal(a.status,'song');assert.ok(a.events.at(-1).changes.happy>0 && a.events.at(-1).changes.trade<0);
 assert.match(a.events.at(-1).text,/people who never sang together/);assert.deepEqual(g.errors,[]);
});

test('sharing can find a real healer who was never opened in the UI, while hoarding blocks that handoff',async t=>{
 for(const topic of ['share','hoard']) {
  const g=await makeGame();t.after(g.close);const w=g.window,town=prepare(g,'farmer'),a=leave(w,town),person=encounter(w,town,a);
  assert.equal(person.role,'farmer');town.jobs.doctor=1;town.jobs.farmer=46;w.planet.unlocks.education=10;
  resolve(w,a);assert.equal(a.status,'kept');assert.equal(town._paultendoPeople.some(p=>p.role==='doctor'),false);
  const record=whisper(w,town,a,topic);
  const restored=await makeGame({save:JSON.parse(JSON.stringify(w.generateSave()))});t.after(restored.close);
  const rw=restored.window,rt=rw.regGet('town',town.id),ra=rw.planet._paultendoLife.artifacts[0],rr=rw.planet._paultendoLife.whispers.at(-1);
  rw.planet.day=record.due-1;next(rw);assert.equal(rr.reception,'heard');
  for(let n=0;n<5;n++) next(rw);
  if(topic==='share'){assert.equal(ra.status,'healing');assert.notEqual(ra.person,person.id);assert.ok(rt._paultendoPeople.some(p=>p.id===ra.person&&p.role==='doctor'));assert.match(ra.events.map(e=>e.text).join(' '),/brings the object to/);}
  else {assert.equal(ra.status,'hoarded');assert.equal(ra.person,person.id);assert.equal(ra.shared,false);assert.equal(rt._paultendoPeople.some(p=>p.role==='doctor'),false);}
  assert.deepEqual(g.errors,[]);assert.deepEqual(restored.errors,[]);
 }
});

test('an object can change hands after actual occupation and can be lost and rediscovered after its town ends',async t=>{
 const g=await makeGame();t.after(g.close);const w=g.window,town=prepare(g),a=leave(w,town);encounter(w,town,a);resolve(w,a);
 const center=w.planet.chunks[town.center.join(',')];
 const free=w.filterChunks(c=>!c.v.s&&c.v.g===center.v.g&&c.b!=='water'&&c.b!=='mountain')[0];
 const rival=w.happen('Create',null,null,{x:free.x,y:free.y},'town');rival.name='Briar';rival.pop=40;rival.resources.crop=200;
 w.planet.chunks[a.anchor.join(',')].v.s=rival.id;next(w);
 assert.equal(a.town,rival.id);assert.match(a.events.at(-1).text,/Briar gains the ground/);
 w.happen('End',null,rival);next(w);assert.equal(a.status,'waiting');assert.match(a.events.at(-1).text,/remains of Briar/);
 const history=a.events.length;encounter(w,town,a);assert.ok(a.events.length>history);assert.equal(a.town,town.id);
 assert.deepEqual(g.errors,[]);
});

test('an object hidden by its bearer can resist a claim and its history remains private behind fog',async t=>{
 const g=await makeGame();t.after(g.close);const w=g.window,town=prepare(g),a=leave(w,town),person=encounter(w,town,a);
 person.outlook='guarded';resolve(w,a);assert.equal(a.status,'hoarded');person.trust=20;
 const record=whisper(w,town,a,'share');w.planet.day=record.due-1;next(w);assert.equal(record.reception,'refused');assert.equal(a.status,'hoarded');
 const center=w.planet.chunks[town.center.join(',')];
 const free=w.filterChunks(c=>!c.v.s&&c.v.g===center.v.g&&c.b!=='water'&&c.b!=='mountain')[0];
 const rival=w.happen('Create',null,null,{x:free.x,y:free.y},'town');rival.pop=40;rival.resources.crop=200;
 w.planet.chunks[a.anchor.join(',')].v.s=rival.id;next(w);
 assert.equal(a.town,town.id,'A hidden object does not pass to an occupier');assert.equal(a.person,person.id);
 const random=w.Math.random;let calls=0;w.Math.random=()=>{calls++;return random();};artifactPage(w,town,a);assert.equal(calls,0);w.Math.random=random;
 delete w.planet._paultendoFog.explored[a.place];w.document.getElementById('actionItem-annals').click();click(w,'The Traveler');click(w,'What you carried');
 assert.doesNotMatch(panel(w).textContent,/Clear lens · Its story/);assert.deepEqual(g.errors,[]);
});

test('travel to another world cannot replenish an object left behind, including after reload',async t=>{
 const g=await makeGame();t.after(g.close);const w=g.window,town=prepare(g),a=leave(w,town);
 const universe=w._paultendoUniverse;w.planet.unlocks.astronomy=10;
 const other=Object.values(universe.worlds).find(world=>world.id!==universe.currentWorldId);
 other.discovered=true;other.reached=true;
 w.document.getElementById('actionItem-solar').click();w.document.querySelector(`[data-world-id="${other.id}"]`).click();
 click(w,'Switch to world');
 w.document.getElementById('actionItem-annals').click();click(w,'The Traveler');click(w,'What you carried');
 assert.match(panel(w).textContent,/Clear lens · Left in another world/);
 assert.equal([...panel(w).querySelectorAll('[role="button"]')].some(b=>b.textContent==='Clear lens'),false);
 const restored=await makeGame({save:JSON.parse(JSON.stringify(w.generateSave()))});t.after(restored.close);
 const rw=restored.window;rw.document.getElementById('actionItem-annals').click();click(rw,'The Traveler');click(rw,'What you carried');
 assert.match(panel(rw).textContent,/Clear lens · Left in another world/);
 assert.equal(rw._paultendoUniverse.worlds[universe.homeWorldId].state.planet._paultendoLife.artifacts[0].id,a.id);
 assert.deepEqual(g.errors,[]);assert.deepEqual(restored.errors,[]);
});
