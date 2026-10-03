import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGame,settleGame} from './harness.mjs';
const mineCalls=new WeakMap();
function setup(g){
 const w=g.window,town=settleGame(g);w.planet.day=10;town.name='Claybank';town.pop=20;town.resources={crop:1000};town.jobs={miner:10,lumberer:10};town.legal.farm=false;
 Object.assign(w.planet.unlocks,{smith:20,fire:20});
 mineCalls.set(w,w.gameEvents.townMine.perChunk);
 for(const id of ['townFarm','townTame','townMine','townLumber']){if(w.gameEvents[id].func)w.gameEvents[id].func=()=>{};if(w.gameEvents[id].perChunk)w.gameEvents[id].perChunk=()=>{};}
 w.gameEvents.processAll.func=()=>{};
 const chunk=Object.values(w.planet.chunks).find(c=>c.v.s===town.id);chunk.b='wetland';
 return {w,town,chunk};
}
function next(w){const choose=w.chooseEvent;w.chooseEvent=()=>null;try{w.nextDay();}finally{w.chooseEvent=choose;}}
function work(w){return w.planet._paultendoLife.materialWork;}
function project(w,town,cost=20){return w.happen('Create',town,null,{type:'project',subtype:'school',cost},'process');}
function mine(w,town,chunk){const random=w.Math.random;w.Math.random=()=>0;try{mineCalls.get(w)(town,null,chunk);}finally{w.Math.random=random;}}
function plan(w,town){project(w,town);next(w);const batch=work(w).at(-1);assert.ok(batch);batch.roll=.99;return batch;}
function finish(w,batch){for(let n=0;n<30&&['waiting','working'].includes(batch.status);n++)next(w);assert.equal(batch.status,'made',JSON.stringify(batch));}
function noErrors(g){assert.deepEqual(g.errors,[]);}

test('clay requires successful work on owned wet ground and depletes the same physical source',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town,chunk}=setup(g);
 chunk.b='desert';mine(w,town,chunk);assert.equal(town.resources.clay,undefined);
 chunk.b='wetland';chunk.v.s=999;mine(w,town,chunk);assert.equal(town.resources.clay,undefined);
 chunk.v.s=town.id;town.jobs.miner=0;mine(w,town,chunk);assert.equal(town.resources.clay,undefined);
 town.jobs.miner=10;mine(w,town,chunk);assert.equal(town.resources.clay,1);assert.equal(chunk._paultendoDeposits.clay.remaining,39);assert.equal(town._paultendoMaterials.clay.sources[0].x,chunk.x);
 mine(w,town,chunk);mine(w,town,chunk);assert.equal(town.resources.clay,2,'Without a use, only small samples are collected');assert.equal(chunk._paultendoDeposits.clay.remaining,38);
 town.resources.clay=0;chunk._paultendoDeposits.clay.remaining=0;mine(w,town,chunk);assert.equal(town.resources.clay,0);noErrors(g);
});

test('milestones and received samples award neither stock nor local manufacturing knowledge',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g);w.gameEvents.unlockKilns.func();
 assert.equal(town.resources.brick,undefined);assert.equal(town.resources.charcoal,undefined);
 w.happen('AddResource',null,town,{type:'brick',count:2});assert.ok(town._paultendoMaterials.brick);assert.equal(town._paultendoMaterials.brick.technique,undefined);
 w.openRegBrowser(town,'town');[...w.document.querySelectorAll('.paultendoTownLife button')].find(b=>b.textContent==='Materials and workshops').click();
 assert.match(w.document.getElementById('actionSubList').textContent,/have not yet learned to make/);noErrors(g);
});

test('a charcoal trial consumes actual timber, takes work days, and records local practical knowledge',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g);town.resources.clay=2;town.resources.lumber=2;
 const batch=plan(w,town);assert.equal(batch.type,'charcoal');assert.equal(batch.status,'waiting');assert.equal(town.resources.charcoal,undefined);
 next(w);assert.equal(batch.status,'working');assert.equal(town.resources.lumber || 0,0);assert.equal(town.resources.charcoal,undefined);next(w);assert.equal(town.resources.charcoal,undefined);
 finish(w,batch);assert.equal(town.resources.charcoal,1);assert.equal(town._paultendoMaterials.charcoal.technique.work,batch.id);assert.equal(town._paultendoMaterials.charcoal.technique.person,batch.person);noErrors(g);
});

test('first firings can fail, spend the real inputs, and keep that outcome through reload',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g);town.resources.clay=2;town.resources.lumber=2;const batch=plan(w,town);batch.roll=0;next(w);
 const restored=await makeGame({save:JSON.parse(JSON.stringify(w.generateSave()))});t.after(restored.close);const rw=restored.window,copy=work(rw).find(x=>x.id===batch.id);assert.equal(copy.roll,0);
 for(let n=0;n<3;n++)next(rw);const rt=rw.regGet('town',town.id);assert.equal(copy.status,'failed');assert.equal(rt.resources.charcoal,undefined);assert.equal(rt.resources.lumber || 0,0);assert.equal(rt._paultendoMaterials?.charcoal?.technique,undefined);noErrors(g);noErrors(restored);
});

test('food shortages, war and absent workers pause an underway firing without producing goods',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g);town.resources.clay=2;town.resources.lumber=2;const batch=plan(w,town);next(w);const remaining=batch.remaining;
 town.resources.crop=0;next(w);assert.equal(batch.remaining,remaining);assert.equal(town.resources.charcoal,undefined);
 town.resources.crop=1000;town.jobs={farmer:20};next(w);assert.equal(batch.remaining,remaining);assert.match(batch.pause,/hands, food and peace/);
 town.jobs={miner:10,lumberer:10};finish(w,batch);assert.equal(town.resources.charcoal,1);noErrors(g);
});

test('bricks need firing techniques, clay and fuel, then replace stone in an actual project',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g);town.resources.clay=2;town.resources.charcoal=1;w.planet.unlocks.fire=10;project(w,town);next(w);assert.equal(work(w).length,0);
 w.planet.unlocks.fire=20;next(w);const batch=work(w).at(-1);assert.equal(batch.type,'brick');batch.roll=.99;next(w);assert.equal(town.resources.clay || 0,0);assert.equal(town.resources.charcoal || 0,0);assert.equal(town.resources.brick,undefined);
 finish(w,batch);assert.equal(town.resources.brick,2);const school=w.regToArray('process').find(p=>p.type==='project'&&p.town===town.id);const cost=school.cost;w.metaEvents.processProject.func(school);assert.ok(school.cost<cost);assert.equal(cost-school.cost,(2-(town.resources.brick || 0))*2);noErrors(g);
});

test('an imported ingredient feeds workshop history without granting the recipient a technique',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g);town.resources.clay=2;town.resources.charcoal=1;
 const state=w.planet._paultendoLife;state.exchanges=[{id:'exchange:sample',type:'charcoal',buyer:town.id,seller:999,status:'arrived',resolved:true,steps:[],names:{[town.id]:town.name,999:'Wick'},known:{[town.id]:true}}];town._paultendoCommodityLots={charcoal:[{exchange:'exchange:sample',from:999,count:1}]};
 const batch=plan(w,town);batch.roll=.99;next(w);assert.equal(batch.inputs[0].exchange,'exchange:sample');assert.equal(state.exchanges[0].uses[0].kind,'material');assert.equal(town._paultendoMaterials?.charcoal?.technique,undefined);finish(w,batch);assert.ok(town._paultendoMaterials.brick.technique);noErrors(g);
});

test('towns beyond explored land can learn and work without disclosing their identities',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town,chunk}=setup(g);town._hidden=true;mine(w,town,chunk);mine(w,town,chunk);town.resources.lumber=2;
 const batch=plan(w,town);finish(w,batch);assert.ok(town._paultendoMaterials.charcoal.technique);
 assert.equal([...w.document.querySelectorAll('.logMessage')].some(e=>e.dataset.storyId===batch.id),false);noErrors(g);
});


test('kiln knowledge opens a new material chain for a cautious town with real samples and timber',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g);
 w.openRegBrowser(town,'town');[...w.document.querySelectorAll('.paultendoTownLife button')].find(b=>b.textContent==='Meet the people').click();for(const p of town._paultendoPeople)p.outlook='steadfast';
 town.resources.clay=2;town.resources.lumber=2;w.planet.unlocks.fire=40;next(w);const charcoal=work(w).at(-1);assert.equal(charcoal.type,'charcoal');charcoal.roll=.99;finish(w,charcoal);
 for(let n=0;n<10&&!work(w).some(x=>x.type==='brick');n++)next(w);const brick=work(w).find(x=>x.type==='brick');assert.ok(brick);brick.roll=.99;finish(w,brick);
 assert.equal(town.resources.brick,2);assert.equal(town.resources.clay || 0,0);assert.equal(town.resources.lumber || 0,0);assert.equal(town.resources.charcoal || 0,0);const count=work(w).length;for(let n=0;n<20;n++)next(w);assert.equal(work(w).length,count,'Knowing a technique does not create endless production without a use');
 const log=[...w.document.querySelectorAll('.logMessage')].find(e=>e.dataset.storyId===brick.id);assert.ok(log?.querySelector('.paultendoChronicleStoryLink'));noErrors(g);
});
