import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGame,settleGame} from './harness.mjs';
const life=w=>w.planet._paultendoLife;
const plain=x=>JSON.parse(JSON.stringify(x));
const panel=w=>w.document.getElementById('actionSubList');
function click(w,text){const b=[...panel(w).querySelectorAll('[role="button"],.actionItem')].find(b=>b.textContent.includes(text));assert.ok(b,`Missing ${text}: ${panel(w).textContent}`);b.click();}
function people(w,town){w.openRegBrowser(town,'town');[...w.document.querySelectorAll('.paultendoTownLife button')].find(b=>b.textContent==='Meet the people').click();for(const p of town._paultendoPeople){p.outlook='curious';p.trust=90;}}
function controlled(w){for(const id of ['townFarm','townTame','townMine','townLumber','townBirth','townDeath','townExpand']){if(w.gameEvents[id].func)w.gameEvents[id].func=()=>{};if(w.gameEvents[id].perChunk)w.gameEvents[id].perChunk=()=>{};}w.gameEvents.processAll.func=()=>{};}
function setup(g){const w=g.window,town=settleGame(g),mine=w.gameEvents.townMine.perChunk;w.planet.day=10;town.name='Coalbank';town.pop=48;town.jobs={miner:24,musician:24};town.resources={crop:1000,metal:20};town.legal.farm=false;town.guidanceTrust=90;town.research={education:100};Object.assign(w.planet.unlocks,{smith:40,fire:50,education:20,trade:10});controlled(w);people(w,town);return {w,town,mine,chunk:w.planet.chunks[town.center.join(',')]};}
function next(w){const choose=w.chooseEvent;w.chooseEvent=()=>null;try{w.nextDay();}finally{w.chooseEvent=choose;}}
function add(w,town,type,count){w.happen('AddResource',null,town,{type,count});}
function finish(w,work){for(let n=0;n<35&&['waiting','working'].includes(work.status);n++)next(w);assert.equal(work.status,'made',JSON.stringify(work));}
function trial(w,town){add(w,town,'coal',1);next(w);const batch=life(w).materialWork.at(-1);assert.equal(batch.type,'steel');batch.roll=.99;return batch;}
function fork(w,town,steel=true){people(w,town);click(w,'Musician');click(w,'Make something of your own');click(w,steel?'Make a tuning fork from steel':'Make a tuning fork');const r=life(w).whispers.at(-1);r.roll=0;w.planet.day=r.due-1;next(w);assert.equal(r.reception,'heard');return life(w).artifactWork.at(-1);}
function errors(g){assert.deepEqual(g.errors,[]);}

test('coal is encountered through successful owned seam mining after tool knowledge and remains finite across reload',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town,mine,chunk}=setup(g);const dig=()=>{const r=w.Math.random;w.Math.random=()=>0;try{mine(town,null,chunk);}finally{w.Math.random=r;}};
 chunk.b='badlands';w.planet.unlocks.smith=30;dig();assert.equal(town.resources.coal,undefined);const stone=town.resources.rock;
 w.planet.unlocks.smith=40;dig();assert.equal(town.resources.coal,1);assert.equal(town.resources.rock,stone);assert.equal(chunk._paultendoDeposits.coal.remaining,59);
 chunk.b='grassland';dig();assert.equal(town.resources.coal,1);chunk.b='badlands';chunk.v.s=999;dig();assert.equal(town.resources.coal,1);chunk.v.s=town.id;town.jobs.miner=0;dig();assert.equal(town.resources.coal,1);town.jobs.miner=24;
 dig();dig();assert.equal(town.resources.coal,2);assert.equal(chunk._paultendoDeposits.coal.remaining,58);
 const restored=await makeGame({save:plain(w.generateSave())});t.after(restored.close);const rw=restored.window,rc=rw.planet.chunks[`${chunk.x},${chunk.y}`];assert.equal(rc._paultendoDeposits.coal.remaining,58);rc._paultendoDeposits.coal.remaining=0;const rt=rw.regGet('town',town.id);rt.resources.coal=0;const random=rw.Math.random;rw.Math.random=()=>0;rw.gameEvents.townMine.perChunk(rt,null,rc);rw.Math.random=random;assert.equal(rt.resources.coal,0);errors(g);errors(restored);
});

test('steel has a real fuel and metal cost, an eight-day trial, and local knowledge rather than a milestone giveaway',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g);w.planet.unlocks.fire=40;add(w,town,'coal',1);next(w);assert.equal(life(w).materialWork.length,0);w.planet.unlocks.fire=50;next(w);const batch=life(w).materialWork.at(-1);assert.equal(batch.type,'steel');batch.roll=.99;const metal=town.resources.metal;
 next(w);assert.equal(batch.status,'working');assert.deepEqual(plain(batch.cost),{metal:2,coal:1});assert.equal(town.resources.metal,metal-2);assert.equal(town.resources.coal || 0,0);assert.equal(town.resources.steel,undefined);for(let n=0;n<7;n++)next(w);assert.equal(town.resources.steel,undefined);next(w);assert.equal(batch.status,'made');assert.equal(town.resources.steel,2);assert.equal(town._paultendoMaterials.steel.technique.work,batch.id);assert.equal(town._paultendoCommodityLots.steel[0].production.name,batch.name);assert.equal(w.planet.unlocks.smith,40);
 const question=w.readyEvent('unlockSteel');assert.ok(question);assert.match(question.args.value.cause.text,new RegExp(batch.name));w.doEvent('unlockSteel',question);assert.equal(life(w).inquiries.at(-1).status,'waiting');assert.equal(w.planet.unlocks.smith,40,'A finished batch suggests further study rather than granting global knowledge');assert.equal(town.resources.steel,2);assert.equal(town.resources.coal || 0,0);errors(g);
});

test('metal alone does not make every town refine steel when its people are pursuing other work',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g);town.research={farm:100};add(w,town,'coal',2);for(let n=0;n<5;n++)next(w);assert.equal(life(w).materialWork.length,0);w.gameEvents.unlockSteel.func();next(w);assert.equal(life(w).materialWork.length,0);assert.equal(town.resources.steel,undefined);town.research={education:100};next(w);assert.equal(life(w).materialWork.at(-1).type,'steel');errors(g);
});

test('known coal substitutes for charcoal in actual glass work and preserves timber',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g);town.research={education:100};town.jobs={doctor:24,miner:24};people(w,town);click(w,'Doctor');click(w,'Make something of your own');click(w,'Make a clear lens');const request=life(w).whispers.at(-1);request.roll=0;Object.assign(town.resources,{sand:3,rock:1,lumber:4});add(w,town,'coal',2);w.planet.day=request.due-1;next(w);const glass=life(w).materialWork.at(-1);assert.equal(glass.type,'glass');glass.roll=.99;next(w);assert.deepEqual(plain(glass.cost),{sand:3,rock:1,coal:2});assert.equal(town.resources.lumber,4);assert.equal(town.resources.coal || 0,0);finish(w,glass);assert.equal(town.resources.glass,2);assert.equal(life(w).materialWork.some(x=>x.type==='charcoal'),false);errors(g);
});

test('charcoal remains useful when it meets the need and coal cannot be used before controlled fire',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g);town.research={farm:100};Object.assign(town.resources,{clay:2,charcoal:1});add(w,town,'coal',1);w.planet.unlocks.fire=20;w.happen('Create',town,null,{type:'project',subtype:'school',cost:20},'process');next(w);const brick=life(w).materialWork.at(-1);assert.equal(brick.type,'brick');assert.deepEqual(plain(brick.cost),{clay:2,charcoal:1});brick.roll=.99;w.planet.unlocks.fire=40;next(w);finish(w,brick);assert.equal(town.resources.coal,1);assert.equal(town.resources.charcoal || 0,0);errors(g);
});

test('a waiting workshop can choose newly arrived fuel but an underway trial keeps its paid recipe through reload',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g);const batch=trial(w,town);town.resources.coal=0;town.resources.lumber=0;next(w);assert.equal(batch.status,'waiting');add(w,town,'charcoal',1);next(w);assert.equal(batch.status,'working');assert.deepEqual(plain(batch.cost),{metal:2,charcoal:1});assert.ok(batch.steps.some(x=>x.text.includes('chooses charcoal')));add(w,town,'coal',1);
 const restored=await makeGame({save:plain(w.generateSave())});t.after(restored.close);const rw=restored.window;controlled(rw);const copy=life(rw).materialWork.find(x=>x.id===batch.id);finish(rw,copy);assert.deepEqual(plain(copy.cost),{metal:2,charcoal:1});assert.equal(rw.regGet('town',town.id).resources.coal,1);errors(g);errors(restored);
});

test('steel work cannot spend metal already promised to an actual instrument maker',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g);town.resources.metal=3;add(w,town,'coal',1);const craft=fork(w,town,false);assert.equal(craft.status,'working');const batch=life(w).materialWork.at(-1);assert.equal(batch.type,'steel');batch.roll=.99;next(w);assert.equal(batch.status,'waiting');assert.equal(town.resources.metal,3);w.planet.day=craft.due-1;next(w);assert.equal(craft.status,'made');assert.equal(town.resources.metal || 0,0);assert.equal(batch.status,'waiting');add(w,town,'metal',2);finish(w,batch);assert.equal(town.resources.steel,2);errors(g);
});

test('a failed steel trial consumes its inputs and keeps its outcome through reload',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g);const batch=trial(w,town);batch.roll=0;next(w);const restored=await makeGame({save:plain(w.generateSave())});t.after(restored.close);const rw=restored.window;controlled(rw);const copy=life(rw).materialWork.find(x=>x.id===batch.id);for(let n=0;n<8;n++)next(rw);assert.equal(copy.status,'failed');assert.equal(copy.roll,0);const rt=rw.regGet('town',town.id);assert.equal(rt.resources.coal || 0,0);assert.equal(rt.resources.metal,18);assert.equal(rt.resources.steel,undefined);assert.equal(rt._paultendoMaterials?.steel?.technique,undefined);errors(g);errors(restored);
});

test('steel encountered before shaping knowledge stays an unfamiliar material rather than an available craft option',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g);add(w,town,'steel',3);people(w,town);click(w,'Musician');click(w,'Make something of your own');assert.doesNotMatch(panel(w).textContent,/Make a tuning fork from steel/);w.planet.unlocks.smith=50;people(w,town);click(w,'Musician');click(w,'Make something of your own');assert.match(panel(w).textContent,/Make a tuning fork from steel/);assert.ok([...panel(w).querySelectorAll('[role="button"],.actionItem')].some(b=>b.textContent==='Make a tuning fork'));assert.equal(town._paultendoMaterials.steel.technique,undefined);errors(g);
});

test('a requested steel fork creates an actual refining chain and keeps its material maker and quality',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g);const batch=trial(w,town);finish(w,batch);w.planet.unlocks.smith=50;add(w,town,'coal',1);const craft=fork(w,town);assert.equal(craft.status,'gathering');assert.deepEqual(plain(craft.recipe.cost),{steel:3});assert.equal(craft.due,null);for(let n=0;n<50&&craft.status!=='made';n++){next(w);for(const b of life(w).materialWork)b.roll=.99;}assert.equal(craft.status,'made');assert.deepEqual(plain(craft.materials),{steel:3});const object=life(w).artifacts.find(x=>x.id===craft.artifact);assert.equal(object.quality,.8);assert.match(object.description,/steel/);assert.equal(object.origin.materialProductions[0].work,batch.id);assert.equal(town.resources.steel,1);assert.equal(town.resources.metal,16);assert.equal(town.resources.coal || 0,0);
 const restored=await makeGame({save:plain(w.generateSave())});t.after(restored.close);const copy=life(restored.window).artifacts.find(x=>x.id===object.id);assert.equal(copy.quality,.8);assert.deepEqual(plain(copy.origin.materialProductions),plain(object.origin.materialProductions));errors(g);errors(restored);
});

test('an autonomous musician can choose spare known steel while an older metal recipe remains unchanged',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g);town.research={education:100};const older=fork(w,town,false);add(w,town,'steel',3);w.planet.unlocks.smith=50;w.planet.day=older.due-1;next(w);assert.equal(older.status,'made');assert.deepEqual(plain(older.materials),{metal:3});
 // Another named maker can answer a renewed public need after the existing
 // instrument is unavailable. No Traveler instruction begins the second work.
 const object=life(w).artifacts.find(x=>x.id===older.artifact);object.status='broken';town.influences.happy=-5;for(let n=0;n<35;n++){next(w);town.influences.happy=-5;}assert.equal(life(w).whispers.length,1,'Refreshing the person must not replay a craft instruction');const automatic=life(w).artifactWork.find(x=>x.autonomous);assert.ok(automatic,JSON.stringify({jobs:town.jobs,notices:town._paultendoInvention,works:life(w).artifactWork,materials:life(w).materialWork,issues:town.issues,people:town._paultendoPeople}));assert.deepEqual(plain(automatic.recipe.cost),{steel:3});assert.equal(automatic.whisper,undefined);errors(g);
});

test('an actual steel shipment supports craft without teaching the buyer to refine it and preserves the original maker',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town:seller}=setup(g);seller.values={justice:6,openness:6};const batch=trial(w,seller);finish(w,batch);seller.research={farm:100};w.planet.unlocks.smith=50;
 const center=w.planet.chunks[seller.center.join(',')],c=w.filterChunks(c=>!c.v.s&&c.v.g===center.v.g&&c.b!=='water'&&c.b!=='mountain').sort((a,b)=>Math.hypot(a.x-center.x,a.y-center.y)-Math.hypot(b.x-center.x,b.y-center.y))[0];const buyer=w.happen('Create',null,null,{x:c.x,y:c.y},'town');buyer.name='Songbank';buyer.pop=48;buyer.jobs={musician:48};buyer.resources={crop:1000};buyer.values={justice:6,openness:6};buyer.guidanceTrust=90;buyer._paultendoNextExchangeDay=w.planet.day+999;add(w,buyer,'steel',1);
 const craft=fork(w,buyer);assert.equal(craft.status,'gathering');w.gameEvents.townMarketPurchase.func(buyer,null,{seller,goodsType:'steel'});const record=life(w).exchanges.find(x=>x.buyer===buyer.id&&!x.resolved);assert.ok(record);for(let n=0;n<15&&!record.resolved;n++){w.planet.day=Math.max(w.planet.day,record.due-1);next(w);}assert.equal(record.status,'arrived');assert.equal(buyer.resources.steel,3);assert.equal(seller.resources.steel || 0,0);assert.equal(buyer._paultendoMaterials.steel.technique,undefined);
 next(w);w.planet.day=craft.due-1;next(w);assert.equal(craft.status,'made');const object=life(w).artifacts.find(x=>x.id===craft.artifact);assert.equal(object.origin.materialProductions[0].work,batch.id);assert.equal(object.origin.materialProductions[0].count,2);assert.equal(object.origin.materialSources[0].exchange,record.id);assert.equal(record.uses.find(x=>x.kind==='craft').count,2);assert.equal((buyer.resources.steel || 0)+(seller.resources.steel || 0)+3,3);errors(g);
});

test('clay and sand depletion also survives native save compression',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town,mine,chunk}=setup(g);town.research={farm:100};const r=w.Math.random;w.Math.random=()=>0;chunk.b='wetland';mine(town,null,chunk);chunk.b='desert';mine(town,null,chunk);w.Math.random=r;assert.equal(chunk._paultendoDeposits.clay.remaining,39);assert.equal(chunk._paultendoDeposits.sand.remaining,59);
 const restored=await makeGame({save:plain(w.generateSave())});t.after(restored.close);const rc=restored.window.planet.chunks[`${chunk.x},${chunk.y}`];assert.equal(rc._paultendoDeposits.clay.remaining,39);assert.equal(rc._paultendoDeposits.sand.remaining,59);assert.equal(rc._paultendoDeposits,restored.window.planet._paultendoDeposits[`${chunk.x},${chunk.y}`]);errors(g);errors(restored);
});
