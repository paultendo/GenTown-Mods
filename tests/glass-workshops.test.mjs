import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGame,settleGame} from './harness.mjs';
const panel=w=>w.document.getElementById('actionSubList');
const life=w=>w.planet._paultendoLife;
const plain=x=>JSON.parse(JSON.stringify(x));
function click(w,text){const b=[...panel(w).querySelectorAll('[role="button"],.actionItem')].find(b=>b.textContent.includes(text));assert.ok(b,`Missing ${text}: ${panel(w).textContent}`);b.click();}
function controlled(w){for(const id of ['townFarm','townTame','townMine','townLumber']){if(w.gameEvents[id].func)w.gameEvents[id].func=()=>{};if(w.gameEvents[id].perChunk)w.gameEvents[id].perChunk=()=>{};}w.gameEvents.processAll.func=()=>{};}
function setup(g){const w=g.window,town=settleGame(g),mine=w.gameEvents.townMine.perChunk;w.planet.day=10;town.name='Glassbank';town.pop=48;town.jobs={doctor:24,miner:24};town.resources={crop:1000,metal:20};town.legal.farm=false;town.guidanceTrust=90;Object.assign(w.planet.unlocks,{education:20,fire:50,smith:40,travel:30,trade:10});controlled(w);people(w,town);return {w,town,mine,chunk:w.planet.chunks[town.center.join(',')]};}
function people(w,town){w.openRegBrowser(town,'town');[...w.document.querySelectorAll('.paultendoTownLife button')].find(b=>b.textContent==='Meet the people').click();for(const p of town._paultendoPeople){p.outlook='curious';p.trust=90;}}
function next(w){const choose=w.chooseEvent;w.chooseEvent=()=>null;try{w.nextDay();}finally{w.chooseEvent=choose;}}
function lens(w,town){people(w,town);click(w,'Doctor');click(w,'Make something of your own');click(w,'Make a clear lens');const r=life(w).whispers.at(-1);r.roll=0;w.planet.day=r.due-1;next(w);assert.equal(r.reception,'heard');const work=life(w).artifactWork.at(-1);assert.ok(work);return work;}
function finish(w,work){for(let n=0;n<35&&['waiting','working'].includes(work.status);n++)next(w);assert.equal(work.status,'made',JSON.stringify(work));}
function fire(w,town){Object.assign(town.resources,{sand:3,charcoal:2,rock:1});next(w);const work=life(w).materialWork.at(-1);assert.equal(work.type,'glass');work.roll=.99;return work;}
function second(w,first){const center=w.planet.chunks[first.center.join(',')],c=w.filterChunks(c=>!c.v.s&&c.v.g===center.v.g&&c.b!=='water'&&c.b!=='mountain').sort((a,b)=>Math.hypot(a.x-center.x,a.y-center.y)-Math.hypot(b.x-center.x,b.y-center.y))[0];const town=w.happen('Create',null,null,{x:c.x,y:c.y},'town');town.name='Wick';town.pop=48;town.jobs={doctor:24,miner:24};town.resources={crop:1000,metal:20};town.legal.farm=false;town.values={justice:6,openness:6};town.guidanceTrust=90;town._paultendoNextExchangeDay=w.planet.day+999;people(w,town);return town;}
function buy(w,buyer,seller,type='glass'){w.gameEvents.townMarketPurchase.func(buyer,null,{seller,goodsType:type});const r=life(w).exchanges.find(r=>r.buyer===buyer.id&&!r.resolved);assert.ok(r);assert.equal(r.seller,seller.id);return r;}
function due(w,r){w.planet.day=Math.max(w.planet.day,r.due-1);next(w);}
function arrive(w,r){for(let n=0;n<15&&!r.resolved;n++)due(w,r);assert.equal(r.status,'arrived');}
function errors(g){assert.deepEqual(g.errors,[]);}

test('sand is found through owned desert mining as better tools become available, without inventing yield',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town,mine,chunk}=setup(g);const dig=()=>{const random=w.Math.random;w.Math.random=()=>0;try{mine(town,null,chunk);}finally{w.Math.random=random;}};
 chunk.b='desert';w.planet.unlocks.smith=10;dig();assert.equal(town.resources.sand,undefined);const stone=town.resources.rock;
 w.planet.unlocks.smith=20;dig();assert.equal(town.resources.sand,1);assert.equal(town.resources.rock,stone,'One native stone yield became one sand');assert.equal(chunk._paultendoDeposits.sand.remaining,59);
 chunk.v.s=999;dig();assert.equal(town.resources.sand,1);chunk.v.s=town.id;town.jobs.miner=0;dig();assert.equal(town.resources.sand,1);town.jobs.miner=24;
 dig();dig();dig();assert.equal(town.resources.sand,3);assert.equal(chunk._paultendoDeposits.sand.remaining,57);town.resources.sand=0;chunk._paultendoDeposits.sand.remaining=0;dig();assert.equal(town.resources.sand,0);errors(g);
});

test('glass requires hotter work, spends real ingredients, and keeps a named maker after seven work days',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g);Object.assign(town.resources,{sand:3,charcoal:2,rock:1});w.planet.unlocks.fire=40;next(w);assert.equal(life(w).materialWork.length,0);
 w.planet.unlocks.fire=50;next(w);const work=life(w).materialWork.at(-1);work.roll=.99;assert.equal(work.type,'glass');next(w);assert.equal(work.status,'working');assert.deepEqual(plain(work.cost),{sand:3,charcoal:2,rock:1});for(const type of Object.keys(work.cost))assert.equal(town.resources[type] || 0,0);
 for(let n=0;n<6;n++)next(w);assert.equal(town.resources.glass,undefined);next(w);assert.equal(work.status,'made');assert.equal(town.resources.glass,2);assert.equal(town._paultendoMaterials.glass.technique.work,work.id);assert.equal(town._paultendoCommodityLots.glass[0].production.name,work.name);assert.equal(town._paultendoCommodityLots.glass[0].production.passage,0);
 const count=life(w).materialWork.length;for(let n=0;n<20;n++)next(w);assert.equal(life(w).materialWork.length,count,'Learning a method does not produce unlimited glass');errors(g);
});

test('a failed glass trial retains its roll through reload and pauses during shortages',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g);const work=fire(w,town);work.roll=0;next(w);town.resources.crop=0;const remaining=work.remaining;next(w);assert.equal(work.remaining,remaining);
 const restored=await makeGame({save:plain(w.generateSave())});t.after(restored.close);const rw=restored.window;controlled(rw);const copy=life(rw).materialWork.find(x=>x.id===work.id),rt=rw.regGet('town',town.id);assert.equal(copy.roll,0);rt.resources.crop=1000;for(let n=0;n<7;n++)next(rw);assert.equal(copy.status,'failed');assert.equal(rt.resources.glass,undefined);assert.equal(rt.resources.sand || 0,0);assert.equal(rt._paultendoMaterials?.glass?.technique,undefined);errors(g);errors(restored);
});

test('an actual lens idea creates fuel and glass demand, then uses the glass made for it',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g);w.planet.unlocks.fire=40;const craft=lens(w,town);assert.equal(craft.status,'gathering');assert.equal(craft.due,null);Object.assign(town.resources,{sand:3,rock:1,lumber:4});w.planet.unlocks.fire=50;
 for(let n=0;n<70&&craft.status!=='made';n++){next(w);for(const work of life(w).materialWork)work.roll=.99;}
 assert.equal(craft.status,'made');const batches=life(w).materialWork.filter(x=>x.status==='made');assert.equal(batches.filter(x=>x.type==='charcoal').length,2);assert.equal(batches.filter(x=>x.type==='glass').length,1);assert.equal(town.resources.lumber || 0,0);assert.equal(town.resources.glass,1);assert.deepEqual(plain(craft.materials),{glass:1,metal:2});
 const made=life(w).artifacts.find(x=>x.id===craft.artifact),production=made.origin.materialProductions[0],batch=batches.find(x=>x.type==='glass');assert.equal(production.work,batch.id);assert.equal(production.name,batch.name);assert.equal(production.count,1);assert.equal(production.day,batch.fired);assert.equal(made.origin.materialSources.length,0);
 const restored=await makeGame({save:plain(w.generateSave())});t.after(restored.close);assert.deepEqual(plain(life(restored.window).artifacts.find(x=>x.id===made.id).origin.materialProductions),plain(made.origin.materialProductions));errors(g);errors(restored);
});

test('legacy unfinished lenses keep their promised stone recipe after reload',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g);town.resources.glass=1;const craft=lens(w,town);delete craft.recipe;delete craft.days;town.resources.glass=0;town.resources.rock=3;
 const restored=await makeGame({save:plain(w.generateSave())});t.after(restored.close);const rw=restored.window;controlled(rw);const copy=life(rw).artifactWork.find(x=>x.id===craft.id);rw.planet.day=copy.due-1;next(rw);assert.equal(copy.status,'made');assert.deepEqual(plain(copy.materials),{rock:3,metal:2});assert.equal(rw.regGet('town',town.id).resources.glass || 0,0);errors(g);errors(restored);
});

test('a maker losing their role abandons a glass-seeking idea instead of creating an object',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g);w.planet.unlocks.fire=40;const craft=lens(w,town);town.jobs={miner:48};next(w);assert.equal(craft.status,'abandoned');assert.equal(life(w).artifacts.length,0);errors(g);
});

test('real glass shipment carries its maker into an imported lens, and guidance gives no instant technique',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town:seller}=setup(g);seller.values={justice:6,openness:6};const batch=fire(w,seller);finish(w,batch);const buyer=second(w,seller);w.planet.unlocks.fire=40;const craft=lens(w,buyer);assert.equal(craft.status,'gathering');const r=buy(w,buyer,seller);due(w,r);assert.equal(r.status,'carrying');assert.equal(r.cargo,1);assert.equal(r.cargoLots[0].production.work,batch.id);assert.ok(r.materialLesson);assert.equal(buyer._paultendoMaterials?.glass?.lesson,undefined);arrive(w,r);assert.equal(buyer._paultendoMaterials.glass.technique,undefined);assert.ok(buyer._paultendoMaterials.glass.lesson,'A curious recipient hears this seeded visit');assert.equal(buyer.resources.glass,1);
 next(w);assert.equal(craft.status,'working');w.planet.day=craft.due-1;next(w);assert.equal(craft.status,'made');const made=life(w).artifacts.find(x=>x.id===craft.artifact);assert.equal(made.origin.materialSources[0].exchange,r.id);assert.equal(made.origin.materialProductions[0].work,batch.id);assert.equal(made.origin.materialProductions[0].town,seller.id);assert.equal(made.origin.materialProductions[0].count,1);assert.equal((seller.resources.glass || 0)+(buyer.resources.glass || 0)+1,2);assert.equal(r.uses.find(x=>x.kind==='craft').count,1);errors(g);
});

test('a guarded glass maker can share goods while withholding their method',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town:seller}=setup(g);seller.values={justice:6,openness:6};const batch=fire(w,seller);finish(w,batch);seller._paultendoPeople.find(p=>p.id===batch.person).outlook='guarded';const buyer=second(w,seller);w.planet.unlocks.fire=40;lens(w,buyer);const r=buy(w,buyer,seller);arrive(w,r);assert.equal(r.materialLesson.withheld,true);assert.ok(r.steps.some(x=>x.kind==='withheld'));assert.equal(buyer._paultendoMaterials.glass.lesson,undefined);assert.equal(buyer._paultendoMaterials.glass.technique,undefined);errors(g);
});

test('a full store delays both the real cargo and lesson across reload until space is made',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town:seller}=setup(g);seller.values={justice:6,openness:6};const batch=fire(w,seller);finish(w,batch);const buyer=second(w,seller);w.planet.unlocks.fire=40;const craft=lens(w,buyer),r=buy(w,buyer,seller);due(w,r);const capacity=w.$c.maxResource(buyer);w.$c.maxResource=()=>capacity;buyer.resources.glass=capacity;buyer.jobs={miner:48};due(w,r);assert.equal(craft.status,'abandoned');assert.equal(r.resolved,false);assert.equal(r.cargo,1);assert.equal(buyer._paultendoMaterials?.glass?.lesson,undefined);
 const restored=await makeGame({save:plain(w.generateSave())});t.after(restored.close);const rw=restored.window;controlled(rw);const rt=rw.regGet('town',buyer.id),copy=life(rw).exchanges.find(x=>x.id===r.id);assert.equal(copy.cargoLots[0].production.work,batch.id);rw.happen('RemoveResource',null,rt,{type:'glass',count:capacity});arrive(rw,copy);assert.equal(rt.resources.glass,1);assert.equal(rt._paultendoCommodityLots.glass[0].production.work,batch.id);assert.equal(rt._paultendoMaterials.glass.technique,undefined);errors(g);errors(restored);
});

test('reexported glass retains its first maker rather than inventing a workshop at the intermediary',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town:seller}=setup(g);seller.values={justice:6,openness:6};const batch=fire(w,seller);finish(w,batch);const middle=second(w,seller);w.planet.unlocks.fire=40;const abandoned=lens(w,middle),first=buy(w,middle,seller);due(w,first);middle.jobs={miner:48};arrive(w,first);assert.equal(abandoned.status,'abandoned');assert.equal(middle._paultendoMaterials.glass.technique,undefined);
 const buyer=second(w,middle);buyer.name='Farbank';const craft=lens(w,buyer),secondTrip=buy(w,buyer,middle);arrive(w,secondTrip);next(w);w.planet.day=craft.due-1;next(w);assert.equal(craft.status,'made');const made=life(w).artifacts.find(x=>x.id===craft.artifact);assert.equal(made.origin.materialSources[0].town,middle.id);assert.equal(made.origin.materialProductions[0].town,seller.id);assert.equal(made.origin.materialProductions[0].work,batch.id);assert.equal((seller.resources.glass || 0)+(middle.resources.glass || 0)+(buyer.resources.glass || 0)+1,2);assert.equal(secondTrip.materialLesson,null);errors(g);
});

test('visitors guidance shortens actual later practice without creating resources or knowledge on arrival',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town:seller}=setup(g);seller.values={justice:6,openness:6};const batch=fire(w,seller);finish(w,batch);const buyer=second(w,seller);w.planet.unlocks.fire=40;const craft=lens(w,buyer),r=buy(w,buyer,seller);arrive(w,r);assert.ok(buyer._paultendoMaterials.glass.lesson);assert.equal(buyer._paultendoMaterials.glass.technique,undefined);next(w);w.planet.day=craft.due-1;next(w);Object.assign(buyer.resources,{sand:3,charcoal:2,rock:1});w.planet.unlocks.fire=50;next(w);const learned=life(w).materialWork.filter(x=>x.town===buyer.id).at(-1);assert.equal(learned.type,'glass');assert.equal(learned.remaining,5);assert.equal(learned.lesson.exchange,r.id);learned.roll=.99;next(w);assert.equal(buyer.resources.sand || 0,0);finish(w,learned);assert.equal(buyer._paultendoMaterials.glass.technique.work,learned.id);assert.equal(buyer.resources.glass,2);errors(g);
});

test('material history from a prior beginning never links to reused ids or unmasks an unknown old maker',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g);const batch=fire(w,town);finish(w,batch);const craft=lens(w,town);w.planet.day=craft.due-1;next(w);const made=life(w).artifacts.find(x=>x.id===craft.artifact);const source=made.origin.materialProductions[0];assert.equal(source.passage,0);source.known=false;source.townName='Old hidden workshop';w._paultendoUniverse.traveler.passage=1;
 w.openRegBrowser(town,'town');[...w.document.querySelectorAll('.paultendoTownLife button')].find(b=>b.textContent.endsWith(' · Its story')).click();assert.match(panel(w).textContent,/made beyond the land you know/);assert.doesNotMatch(panel(w).textContent,/Old hidden workshop|Remember how it was made/);errors(g);
});
