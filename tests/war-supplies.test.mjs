import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGame,settleGame} from './harness.mjs';
const plain=x=>JSON.parse(JSON.stringify(x));
function quiet(w) {
 for(const id of ['townFarm','townTame','townMine','townLumber','townBirth','townDeath','townExpand','townEmploy']) {
  if(w.gameEvents[id].func)w.gameEvents[id].func=()=>{};
  if(w.gameEvents[id].perChunk)w.gameEvents[id].perChunk=()=>{};
 }
 w.gameEvents.processAll.func=()=>{};w.chooseEvent=()=>null;
}
function start(w,a,b) {
 const war=w.happen('Create',a,null,{type:'war',towns:[a.id,b.id]},'process');
 war.sides=[[a.id],[b.id]];war.start=w.planet.day;war._paultendoEarlyDuration=14;
 a.issues.war=b.issues.war=war.id;a.relations[b.id]=b.relations[a.id]=-10;
 return war;
}
function setup(g,{early=false,war=true,gap=0}={}) {
 const w=g.window,a=settleGame(g);w.planet.day=30;
 Object.assign(w.planet.unlocks,{farm:20,smith:10,trade:10,travel:20,military:early?0:50});
 const center=w.planet.chunks[a.center.join(',')];
 const at=w.filterChunks(c=>!c.v.s&&c.v.g===center.v.g&&c.b!=='water'&&c.b!=='mountain'&&Math.hypot(c.x-center.x,c.y-center.y)>=gap).sort((x,y)=>Math.hypot(x.x-center.x,x.y-center.y)-Math.hypot(y.x-center.x,y.y-center.y))[0];
 const b=w.happen('Create',null,null,{x:at.x,y:at.y},'town');
 for(const [town,name] of [[a,'Ashbank'],[b,'Wick']]) {
  w.happen('Explore',null,null,{x:town.center[0],y:town.center[1]});
  town.name=name;town.start=1;town.pop=80;town.jobs={soldier:40,farmer:40};town.resources={crop:800};town.influences.hunger=0;town._paultendoNextExchangeDay=99999;
  const c=w.planet.chunks[town.center.join(',')];
  for(const chunk of w.filterChunks(x=>!x.v.s&&x.v.g===c.v.g&&x.b!=='water'&&x.b!=='mountain').sort((x,y)=>Math.hypot(x.x-c.x,x.y-c.y)-Math.hypot(y.x-c.x,y.y-c.y)).slice(0,20)){chunk.v.s=town.id;town.size++;}
  w.happen('UpdateCenter',null,town);
 }
 b.jobs={farmer:80};quiet(w);return {w,a,b,war:war?start(w,a,b):null};
}
function roll(w,value,fn){const old=w.Math.random;w.Math.random=()=>value;try{return fn();}finally{w.Math.random=old;}}
function fight(w,war){let calls=0;const old=w.Math.random;w.Math.random=()=>++calls<25?.01:.999;try{w.metaEvents.processWar.func(war);}finally{w.Math.random=old;}}
function meal(w,town,stock){town.resources.crop=stock;town.resources.livestock=0;w.gameEvents.townEat.func(town);}
function due(w,r){w.planet.day=Math.max(w.planet.day,r.due-1);w.nextDay();}
function shipment(w,a){return w.planet._paultendoLife.exchanges.find(r=>r.kind==='seizure'&&r.buyer===a.id);}
function finish(w,r){for(let n=0;n<12&&!r.resolved;n++)due(w,r);assert.equal(r.status,'arrived',JSON.stringify(r));}
function check(g){assert.deepEqual(g.errors,[]);}

test('a real territorial attack takes only existing needed supplies, with a journey, a grudge and no immediate meal recovery',async t=>{
 const g=await makeGame();t.after(g.close);const {w,a,b,war}=setup(g);meal(w,a,1);meal(w,b,800);
 const stock=b.resources.crop,size=b.size,knowledge=w.planet.unlocks.military;fight(w,war);
 const r=shipment(w,a);assert.ok(r);assert.ok(b.size<size);assert.ok(r.cargo>0&&r.cargo<=a.jobs.soldier*2);
 assert.equal(b.resources.crop+r.cargo,stock);assert.equal(a.resources.crop || 0,0);assert.ok(r.due>w.planet.day);assert.equal(r.war,war.id);
 assert.ok(b.memory.grudges[a.id].reasons?.includes('stores taken')||b.memory.grudges[a.id].reason==='stores taken');
 assert.equal(b._paultendoExchangeMemory[a.id].lost.crop,r.cargo);assert.equal(a._paultendoExchangeMemory?.[b.id]?.received?.crop || 0,0);
 assert.equal(w.planet.unlocks.military,knowledge);assert.equal(w.planet._paultendoLife.warRations.find(r=>r.town===a.id).short,true);
 const captured=r.cargo;finish(w,r);assert.equal(r.delivered,captured);assert.equal(a._paultendoExchangeMemory[b.id].seized.crop,captured);
 assert.equal(a._paultendoExchangeMemory[b.id].received.crop || 0,0);assert.equal(a._paultendoExchangeMemory[b.id].traded.crop || 0,0);
 assert.equal(a._paultendoExchangeMemory[b.id].lastHelpReceived,null);assert.equal(w.planet._paultendoLife.warRations.find(r=>r.town===a.id).short,true);
 w.gameEvents.townEat.func(a);assert.ok(r.uses.some(u=>u.kind==='meals'));assert.ok(r.steps.some(s=>s.kind==='used'));
 const log=w.document.querySelector(`[data-story-id="${r.id}"]`);log.querySelector('.paultendoChronicleStoryLink').click();
 const panel=w.document.getElementById('actionSubList').textContent;assert.match(panel,/Taken in the fighting|Captured grain feeds/);assert.doesNotMatch(panel,/remember the exchange|offer their work|lessons/);check(g);
});

test('successful early raids also carry real supplies without granting military knowledge',async t=>{
 const g=await makeGame();t.after(g.close);const {w,a,b,war}=setup(g,{early:true});meal(w,a,1);meal(w,b,800);
 const stock=b.resources.crop;fight(w,war);const r=shipment(w,a);assert.ok(r);assert.equal(b.resources.crop+r.cargo,stock);assert.equal(w.planet.unlocks.military,0);assert.ok(r.cargo>0);check(g);
});

test('well supplied towns, idle fighting, empty stores and unreachable ground give no loot',async t=>{
 for(const mode of ['full','idle','empty','unreachable']) {
  const g=await makeGame();t.after(g.close);const {w,a,b,war}=setup(g,{gap:mode==='unreachable'?10:0});
  meal(w,a,mode==='full'?800:1);meal(w,b,mode==='empty'?0:800);const stock=b.resources.crop || 0;
  if(mode==='unreachable')for(const chunk of Object.values(w.planet.chunks))if(chunk.v.s!==b.id&&chunk.v.s!==a.id)chunk.b='water';
  if(mode==='idle')roll(w,.999,()=>w.metaEvents.processWar.func(war));else fight(w,war);
  assert.equal(shipment(w,a),undefined,mode);assert.equal(b.resources.crop || 0,stock,mode);check(g);
 }
});

test('captured cargo waits behind a reclaimed border through reload and must travel again after peace',async t=>{
 const g=await makeGame();t.after(g.close);const {w,a,b,war}=setup(g);meal(w,a,1);fight(w,war);const r=shipment(w,a);assert.ok(r);const cargo=r.cargo;
 w.planet.chunks[`${r.origin.x},${r.origin.y}`].v.s=b.id;due(w,r);assert.equal(r.status,'waiting');assert.equal(r.cargo,cargo);assert.equal(r.delivered,undefined);
 const restored=await makeGame({save:plain(w.generateSave())});t.after(restored.close);const rw=restored.window,copy=rw.planet._paultendoLife.exchanges.find(x=>x.id===r.id);quiet(rw);
 assert.equal(copy.cargo,cargo);rw.regGet('process',war.id).done=true;due(rw,copy);assert.equal(copy.status,'carrying');assert.equal(copy.delivered,undefined);assert.ok(copy.due>rw.planet.day);
 finish(rw,copy);assert.equal(copy.delivered,cargo);const received=rw.regGet('town',a.id)._paultendoExchangeMemory[b.id].seized.crop;rw.nextDay();assert.equal(rw.regGet('town',a.id)._paultendoExchangeMemory[b.id].seized.crop,received);check(g);check(restored);
});

test('an actual construction need can select timber rather than food, preserving imported maker provenance',async t=>{
 const g=await makeGame();t.after(g.close);const {w,a,b,war}=setup(g);
 const project=w.happen('Create',a,null,{type:'project',subtype:'school',cost:20},'process');
 b.resources.lumber=30;b._paultendoCommodityLots={lumber:[{exchange:'earlier-shipment',from:900,count:30,production:{work:'maker:7',world:'past-world',passage:'cargo:2'}}]};
 fight(w,war);const r=shipment(w,a);assert.ok(r);assert.equal(r.type,'lumber');assert.equal(b.resources.lumber+r.cargo,30);assert.equal(r.cargo,20);
 assert.equal(r.cargoLots[0].production.work,'maker:7');finish(w,r);
 assert.equal(a._paultendoCommodityLots.lumber[0].production.world,'past-world');w.happen('Finish',null,war);delete a.issues.war;delete b.issues.war;
 for(let n=0;n<30&&!project.done;n++){w.planet.day++;w.metaEvents.processProject.func(project);}
 assert.ok(project.done);assert.equal(r.uses.find(u=>u.kind==='construction').count,20);assert.equal(a.resources.lumber || 0,0);check(g);
});

test('cargo already on the road is counted against the next raid, and delivery never improves relations',async t=>{
 const g=await makeGame();t.after(g.close);const {w,a,b,war}=setup(g);meal(w,a,1);fight(w,war);const r=shipment(w,a);assert.ok(r);const stock=b.resources.crop;
 fight(w,war);assert.equal(b.resources.crop,stock);assert.equal(w.planet._paultendoLife.exchanges.filter(x=>x.kind==='seizure'&&x.buyer===a.id).length,1);
 const relations=plain([a.relations[b.id],b.relations[a.id]]);finish(w,r);assert.deepEqual(plain([a.relations[b.id],b.relations[a.id]]),relations);check(g);
});

function refused(g) {
 const pair=setup(g,{war:false}),{w,a,b}=pair;a.gov='monarchy';a.values={order:6};b.values={justice:0,openness:-6};a.relations[b.id]=b.relations[a.id]=-5;
 for(let n=0;n<4;n++){w.planet.day++;meal(w,a,0);}
 w.gameEvents.townMarketPurchase.func(a,null,{seller:b,goodsType:'crop'});
 const r=w.planet._paultendoLife.exchanges.find(r=>r.buyer===a.id&&!r.resolved);assert.ok(r);due(w,r);assert.equal(r.status,'refused');assert.equal(r.threat,true);return {...pair,r};
}
test('a refused real food request can explain a native war while keeping its source and granting no free food',async t=>{
 const g=await makeGame();t.after(g.close);const {w,a,b,r}=refused(g);assert.equal(w.regToArray('process').filter(p=>p.type==='war'&&!p.done).length,0,'A threat is not an automatic war');
 const stock=b.resources.crop;const war=roll(w,0,()=>start(w,a,b));assert.equal(war.cause.id,'supplies');assert.equal(war.cause.source,r.id);assert.equal(war.objective.id,'seize_supplies');assert.equal(b.resources.crop,stock);assert.ok(r.steps.some(s=>s.kind==='war'&&s.war===war.id));
 fight(w,war);const taken=shipment(w,a);assert.ok(taken);assert.equal(taken.cause,r.id);w.document.querySelector(`[data-story-id="${taken.id}"] .paultendoChronicleStoryLink`).click();const button=[...w.document.querySelectorAll('#actionSubList [role="button"]')].find(b=>b.textContent==='Before the fighting');assert.ok(button);button.click();assert.match(w.document.getElementById('actionSubList').textContent,/refused food request/);check(g);
});

test('recovered hunger and stale threats cannot be assigned as a new supply war cause',async t=>{
 for(const mode of ['recovered','old']){const g=await makeGame();t.after(g.close);const {w,a,b}=refused(g);if(mode==='recovered')a.resources.crop=800;else w.planet.day+=9;const war=roll(w,0,()=>start(w,a,b));assert.notEqual(war.cause.id,'supplies',mode);check(g);}
});
