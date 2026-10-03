import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGame,settleGame} from './harness.mjs';
const records=w=>w.planet._paultendoLife.exchanges || [];
const panel=w=>w.document.getElementById('actionSubList');
function click(w,text){const b=[...panel(w).querySelectorAll('[role="button"]')].find(b=>b.textContent.includes(text));assert.ok(b,`Missing ${text}: ${panel(w).textContent}`);b.click();}
function pair(g){
 const w=g.window,a=settleGame(g);w.planet.day=10;
 Object.assign(w.planet.unlocks,{farm:20,trade:10,smith:40,fire:40,education:20,travel:30});
 const center=w.planet.chunks[a.center.join(',')],c=w.filterChunks(c=>!c.v.s&&c.v.g===center.v.g&&c.b!=='water'&&c.b!=='mountain').sort((x,y)=>Math.hypot(x.x-center.x,x.y-center.y)-Math.hypot(y.x-center.x,y.y-center.y))[0];
 const b=w.happen('Create',null,null,{x:c.x,y:c.y},'town');
 for(const [town,name] of [[a,'Ashbank'],[b,'Wick']]){town.name=name;town.pop=20;town.jobs={farmer:20};town.resources={crop:200,cash:0};town.legal.farm=false;town.values={justice:6,openness:6};}
 // Keep inventories controlled while still running the native day, project,
 // meal and mod exchange pipelines. Production has its own engine tests.
 for(const event of ['townFarm','townTame','townMine','townLumber'])w.gameEvents[event].func=()=>{};
 return {w,a,b};
}
function next(w){const choose=w.chooseEvent;w.chooseEvent=()=>null;try{w.nextDay();}finally{w.chooseEvent=choose;}}
function due(w,r){w.planet.day=Math.max(w.planet.day,r.due-1);next(w);}
function finish(w,r){for(let n=0;n<12&&!r.resolved;n++)due(w,r);assert.equal(r.status,'arrived');}
function project(w,town,cost=20){return w.happen('Create',town,null,{type:'project',subtype:'school',cost},'process');}
function buy(w,a,b,type){w.gameEvents.townMarketPurchase.func(a,null,{seller:b,goodsType:type});const r=records(w).find(r=>r.buyer===a.id&&!r.resolved);assert.ok(r);return r;}
function craft(w,town){
 town.jobs={musician:20};town.resources.metal=3;town.guidanceTrust=90;
 w.openRegBrowser(town,'town');[...w.document.querySelectorAll('.paultendoTownLife button')].find(b=>b.textContent==='Meet the people').click();
 for(const p of town._paultendoPeople){p.outlook='curious';p.trust=90;}
 click(w,'Musician');click(w,'Make something of your own');click(w,'Make a tuning fork');
 const voice=w.planet._paultendoLife.whispers.at(-1);voice.roll=0;w.planet.day=voice.due-1;next(w);
 const work=w.planet._paultendoLife.artifactWork.at(-1);assert.equal(work.status,'working');return work;
}
function errors(g){assert.deepEqual(g.errors,[]);}

test('a route without a useful cargo creates no caravan stock, profit or exchange',async t=>{
 const g=await makeGame();t.after(g.close);const {w,a,b}=pair(g);a.resources.lumber=80;
 w.gameEvents.establishTradeRoute.func(a,b,{choice:'yes'});const route=w.planet.tradeRoutes.at(-1),cash=a.resources.cash+b.resources.cash;
 assert.equal(!!w.gameEvents.caravanDeparts.value(a,null,{}),false);
 w.gameEvents.caravanDeparts.func(a,null,{value:route});
 assert.equal(records(w).length,0);assert.equal(a.resources.lumber,80);assert.equal(a.resources.cash+b.resources.cash,cash);assert.equal(route.totalGoods || 0,0);errors(g);
});

test('imported timber is conserved, used by native construction and linked to the school it helped build',async t=>{
 const g=await makeGame();t.after(g.close);const {w,a,b}=pair(g);b.resources.lumber=40;const school=project(w,a);
 const r=buy(w,a,b,'lumber');due(w,r);assert.equal(r.kind,'aid');const sent=r.cargo;assert.equal(sent,school.cost);assert.equal(b.resources.lumber+sent,40);
 finish(w,r);assert.equal(r.delivered,sent);assert.ok(a._paultendoCommodityLots.lumber.some(l=>l.exchange===r.id));
 for(let n=0;n<30&&!school.done;n++){w.planet.day++;w.metaEvents.processProject.func(school);}
 assert.ok(school.done);assert.equal(a.resources.lumber || 0,0);assert.equal(r.uses.find(u=>u.kind==='construction').count,sent);
 const log=[...w.document.querySelectorAll('.logMessage')].find(e=>e.dataset.storyId===r.id);log.querySelector('.paultendoChronicleStoryLink').click();assert.match(panel(w).textContent,/timber.*build a school/s);assert.match(panel(w).textContent,/Visit/);errors(g);
});

test('construction substitutes reduce demand and completed work withdraws an unpaid request',async t=>{
 const g=await makeGame();t.after(g.close);const {w,a,b}=pair(g);b.resources.lumber=80;const school=project(w,a,20);
 a.resources.rock=10;w.gameEvents.townMarketPurchase.func(a,null,{seller:b,goodsType:'lumber'});assert.equal(records(w).length,0,'Enough stone makes the timber unnecessary');
 a.resources.rock=0;const r=buy(w,a,b,'lumber');school.cost=0;w.happen('Finish',null,school);due(w,r);assert.equal(r.status,'withdrawn');assert.equal(r.cargo,0);assert.equal(b.resources.lumber,80);errors(g);
});

test('timber reserved by several projects is counted once as a shared supply',async t=>{
 const g=await makeGame();t.after(g.close);const {w,a,b}=pair(g);project(w,a,20);project(w,a,20);a.resources.lumber=20;b.resources.rock=100;
 const r=buy(w,a,b,'rock');due(w,r);assert.equal(r.cargo,10,'Twenty timber covers only half the combined forty units of work');errors(g);
});

test('a single available food substitutes for the absent diet and imported livestock feeds actual meals',async t=>{
 const g=await makeGame();t.after(g.close);const {w,a,b}=pair(g);a.resources.crop=0;b.resources.crop=0;b.resources.livestock=160;
 const r=buy(w,a,b,'livestock');finish(w,r);const stock=a.resources.livestock,need=Math.max(1,Math.floor(w.addInfluence(a.pop*w.$c.baseEatRate,a,'hunger')));
 w.gameEvents.townEat.func(a);assert.equal(stock-a.resources.livestock,need);assert.equal(r.uses.find(u=>u.kind==='meals').count,need);errors(g);
});

test('actual metal imports become a made object’s material provenance and survive reload',async t=>{
 const g=await makeGame();t.after(g.close);const {w,a,b}=pair(g);const work=craft(w,a);w.happen('RemoveResource',null,a,{type:'metal',count:3});b.resources.metal=30;
 const r=buy(w,a,b,'metal');finish(w,r);assert.equal(r.delivered,3);w.planet.day=work.due-1;next(w);
 const made=w.planet._paultendoLife.artifacts.find(o=>o.id===work.artifact);assert.ok(made);assert.equal(work.status,'made');
 assert.equal(made.origin.materialSources.length,1);assert.equal(made.origin.materialSources[0].exchange,r.id);assert.equal(made.origin.materialSources[0].town,b.id);assert.equal(made.origin.materialSources[0].count,3);assert.equal(r.uses.find(u=>u.kind==='craft').count,3);
 const restored=await makeGame({save:JSON.parse(JSON.stringify(w.generateSave()))});t.after(restored.close);const copy=restored.window.planet._paultendoLife.artifacts.find(o=>o.id===made.id);assert.deepEqual(JSON.parse(JSON.stringify(copy.origin.materialSources)),JSON.parse(JSON.stringify(made.origin.materialSources)));errors(g);errors(restored);
});

test('zero removals and older local stock cannot fabricate a use of imported goods',async t=>{
 const g=await makeGame();t.after(g.close);const {w,a,b}=pair(g);const school=project(w,a);b.resources.lumber=40;const r=buy(w,a,b,'lumber');finish(w,r);
 a.resources.lumber+=10;const stock=a.resources.lumber;w.happen('RemoveResource',null,a,{type:'lumber',count:0});assert.equal(a.resources.lumber,stock);assert.equal(r.uses,undefined);
 const random=w.Math.random;w.Math.random=()=>0;try{w.metaEvents.processProject.func(school);}finally{w.Math.random=random;}
 assert.ok(a.resources.lumber<stock);assert.equal(r.uses,undefined,'The first consumed unit came from pre-existing local stock');errors(g);
});

test('public spending and taxes transfer real divisible cash, while idle trade routes earn no fabricated income',async t=>{
 const g=await makeGame();t.after(g.close);const {w,a,b}=pair(g);w.planet.unlocks.trade=30;a.resources.cash=20.75;a.wealth=15.25;
 w.gameEvents.establishTradeRoute.func(a,b,{choice:'yes'});const total=a.resources.cash+a.wealth;
 w.gameEvents.townEconomyTick.func(a);const after=a.resources.cash;assert.ok(after<20.75);assert.equal(a.resources.cash+a.wealth,total);assert.equal(a._paultendoEconomy.income,0);assert.ok(a._paultendoEconomy.expenses>0);
 w.gameEvents.townEconomyTick.func(a);assert.equal(a.resources.cash,after);
 a.tax=.13;w.gameEvents.townTax.func(a);assert.equal(a.resources.cash+a.wealth,total);assert.ok(a._paultendoCashFlow.kinds.tax.received>0);
 w.happen('RemoveResource',null,a,{type:'cash',count:.25});assert.equal(a.resources.cash+a.wealth,total);errors(g);
});

test('legacy food shipments and their story links migrate into the common exchange history',async t=>{
 const g=await makeGame();t.after(g.close);const {w,a,b}=pair(g);a.resources.crop=1;const r=buy(w,a,b,'crop');due(w,r);
 const save=JSON.parse(JSON.stringify(w.generateSave()));save.planet._paultendoLife.foodJourneys=save.planet._paultendoLife.exchanges;delete save.planet._paultendoLife.exchanges;delete save.planet._paultendoLife.foodJourneys[0].type;
 const restored=await makeGame({save});t.after(restored.close);const rw=restored.window;next(rw);const copy=records(rw).find(x=>x.id===r.id);assert.ok(copy);assert.equal(copy.type,'crop');assert.equal(rw.planet._paultendoLife.foodJourneys,undefined);finish(rw,copy);assert.equal(copy.delivered,r.steps.find(s=>s.kind==='aid').count);errors(g);errors(restored);
});


test('using an imported material beyond known land does not reveal the hidden project',async t=>{
 const g=await makeGame();t.after(g.close);const {w,a,b}=pair(g);a._hidden=true;b.resources.lumber=40;const school=project(w,a);
 const r=buy(w,a,b,'lumber');finish(w,r);w.planet.day++;w.metaEvents.processProject.func(school);
 const log=[...w.document.querySelectorAll('.logMessage')].find(e=>e.dataset.storyId===r.id&&e.textContent.includes('puts timber'));
 assert.ok(log);assert.doesNotMatch(log.textContent,/Ashbank|school/);assert.equal(r.uses[0].known,false);errors(g);
});
