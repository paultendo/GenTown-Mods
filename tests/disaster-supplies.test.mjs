import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGame,settleGame} from './harness.mjs';
const plain=x=>JSON.parse(JSON.stringify(x));
const exchanges=w=>w.planet._paultendoLife.exchanges || [];
function pair(g,{food='crop',generous=true}={}) {
 const w=g.window,a=settleGame(g);w.planet.day=20;
 Object.assign(w.planet.unlocks,{farm:20,trade:10,smith:20,travel:30});
 const center=w.planet.chunks[a.center.join(',')],chunk=w.filterChunks(c=>!c.v.s&&c.v.g===center.v.g&&c.b!=='water'&&c.b!=='mountain').sort((x,y)=>Math.hypot(x.x-center.x,x.y-center.y)-Math.hypot(y.x-center.x,y.y-center.y))[0];
 const b=w.happen('Create',null,null,{x:chunk.x,y:chunk.y},'town');
 for(const [town,name] of [[a,'Ashbank'],[b,'Wick']])Object.assign(town,{name,start:1,pop:20,jobs:{farmer:20},resources:{crop:200,cash:0},values:generous?{justice:6,openness:6}:{justice:0,openness:-6}});
 a.resources.crop=0;b.resources={cash:0,[food]:200};
 // Exercise autonomous need selection and actual shipments without unrelated
 // daily production, consumption or scripted recovery influencing quantities.
 for(const event of Object.values(w.dailyEvents)){if(event.func)event.func=()=>{};if(event.perChunk)event.perChunk=()=>{};}
 return {w,a,b};
}
function disaster(w,town,{day=w.planet.day-1,subtype='wildfire'}={}) {
 const event=w.happen('Create',null,null,{type:'disaster',subtype,towns:[town.id],chunks:[]},'process');event.start=Math.min(w.planet.day,day-1);event.done=day;return event;
}
function next(w){const choose=w.chooseEvent;w.chooseEvent=()=>null;try{w.nextDay();}finally{w.chooseEvent=choose;}}
function due(w,r){w.planet.day=Math.max(w.planet.day,r.due-1);next(w);}
function finish(w,r){for(let i=0;i<12&&!r.resolved;i++)due(w,r);assert.equal(r.status,'arrived');}
function panel(w){return w.document.getElementById('actionSubList');}
function click(w,text){const b=[...panel(w).querySelectorAll('[role="button"]')].find(e=>e.textContent.includes(text));assert.ok(b,`${text}: ${panel(w).textContent}`);b.click();}
function openJourney(w,r){const log=[...w.document.querySelectorAll('.logMessage')].find(e=>e.dataset.storyId===r.id);assert.ok(log);log.querySelector('.paultendoChronicleStoryLink').click();}

test('a disaster with actual food need creates an autonomous request without alliance, deaths or phantom aid',async t=>{
 const g=await makeGame();t.after(g.close);const {w,a,b}=pair(g);const event=disaster(w,a);a.disasterRecovery=30;
 const happy=a.influences.happy,relation=a.relations[b.id] || 0;next(w);const r=exchanges(w).find(r=>r.buyer===a.id);assert.ok(r);
 assert.equal(r.disaster.id,event.id);assert.equal(r.disaster.phase,'after');assert.equal(r.cargo,0);assert.equal(a.resources.crop,0);assert.equal(b.resources.crop,200);assert.equal(a.disasterRecovery,30);assert.equal(a.influences.happy,happy);assert.equal(a.relations[b.id] || 0,relation);
 due(w,r);const sent=r.cargo;assert.ok(sent>0);assert.equal(r.kind,'aid');assert.equal(a.resources.crop,0);assert.equal(b.resources.crop+sent,200);assert.equal(a.relations[b.id] || 0,relation);
 finish(w,r);assert.equal(a.resources.crop,r.delivered);assert.equal(a.resources.crop+b.resources.crop,200);assert.equal(a.disasterRecovery,30);assert.equal(a._paultendoFoodMemory[b.id].received,r.delivered);assert.equal(a.relations[b.id],relation+1);
 assert.equal(w.gameEvents.disasterAidRequest,undefined);assert.equal(w.gameEvents.swayDisasterRelief,undefined);assert.deepEqual(g.errors,[]);
});

test('the same disaster produces no request or reward when stores and work already suffice',async t=>{
 const g=await makeGame();t.after(g.close);const {w,a,b}=pair(g);a.resources.crop=200;const event=disaster(w,a);event.deaths=50;a.disasterRecovery=60;
 const before=plain({a:a.resources,b:b.resources,happy:a.influences.happy,relations:a.relations});next(w);
 assert.equal(exchanges(w).length,0);assert.deepEqual(plain({a:a.resources,b:b.resources,happy:a.influences.happy,relations:a.relations}),before);assert.equal(a.disasterRecovery,60);assert.deepEqual(g.errors,[]);
});

test('relief selects real alternative food and an insular neighbour can still refuse',async t=>{
 for(const generous of [true,false]){const g=await makeGame();t.after(g.close);const {w,a,b}=pair(g,{food:'livestock',generous});disaster(w,a);next(w);const r=exchanges(w).find(r=>r.buyer===a.id);assert.ok(r);assert.equal(r.type,'livestock');due(w,r);
 assert.equal(r.status,generous?'carrying':'refused');assert.equal(r.kind,generous?'aid':undefined);assert.equal(b.resources.livestock+r.cargo,200);assert.equal(a.resources.crop,0);assert.equal(a.resources.livestock || 0,0);assert.deepEqual(g.errors,[]);}
});

test('a town seeking building materials uses actual substitutes and records the building they help finish',async t=>{
 const g=await makeGame();t.after(g.close);const {w,a,b}=pair(g);a.resources.crop=200;b.resources.rock=20;
 const school=w.happen('Create',a,null,{type:'project',subtype:'school',cost:20},'process'),event=disaster(w,a);next(w);const r=exchanges(w).find(r=>r.buyer===a.id);assert.ok(r);assert.equal(r.type,'rock');assert.equal(r.disaster.id,event.id);assert.ok(r.purposes.some(p=>p.kind==='construction'&&p.id===school.id));
 finish(w,r);assert.equal(a.resources.rock+b.resources.rock,20);assert.equal(school.cost,20,'Delivery does not finish construction');
 for(let i=0;i<30&&!school.done;i++){w.planet.day++;w.metaEvents.processProject.func(school);}assert.ok(school.done);assert.ok(r.uses.some(u=>u.kind==='construction'&&u.id===school.id));assert.deepEqual(g.errors,[]);
});

test('blocked relief keeps its cargo and disaster story through reload, and revisiting the story has no effect',async t=>{
 const g=await makeGame();t.after(g.close);const {w,a,b}=pair(g);const event=disaster(w,a);next(w);const r=exchanges(w).find(r=>r.buyer===a.id);due(w,r);const cargo=r.cargo;
 w.planet.embargoes=[{fromId:b.id,toId:a.id,start:w.planet.day}];due(w,r);assert.equal(r.status,'waiting');assert.equal(r.cargo,cargo);assert.equal(a.resources.crop,0);
 const saved=plain(w.generateSave()),copy=await makeGame({save:saved});t.after(copy.close);const rw=copy.window,rr=exchanges(rw).find(x=>x.id===r.id);assert.deepEqual(plain(rr.disaster),plain(r.disaster));
 openJourney(w,r);const before=plain({record:r,resources:a.resources,day:w.planet.day});assert.match(panel(w).textContent,/After the wildfire, Ashbank asks Wick/);click(w,'The wildfire');assert.equal(w.regGet('process',event.id).id,event.id);openJourney(w,r);assert.deepEqual(plain({record:r,resources:a.resources,day:w.planet.day}),before);
 rw.planet.embargoes=[];for(const daily of Object.values(rw.dailyEvents)){if(daily.func)daily.func=()=>{};if(daily.perChunk)daily.perChunk=()=>{};}finish(rw,rr);assert.equal(rr.delivered,cargo);assert.deepEqual(g.errors,[]);assert.deepEqual(copy.errors,[]);
});

test('recent context uses the most recent real local disaster and excludes old or future completions',async t=>{
 for(const phase of ['recent','old','future']){const g=await makeGame();t.after(g.close);const {w,a,b}=pair(g);disaster(w,b,{day:19,subtype:'hurricane'});disaster(w,a,{day:phase==='recent'?18:phase==='old'?2:40,subtype:'earthquake'});if(phase==='recent')disaster(w,a,{day:19});next(w);const r=exchanges(w).find(r=>r.buyer===a.id);assert.ok(r);assert.equal(r.disaster?.subtype,phase==='recent'?'wildfire':undefined);assert.deepEqual(g.errors,[]);}
});
