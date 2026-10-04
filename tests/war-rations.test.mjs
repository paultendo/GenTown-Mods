import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGame,settleGame} from './harness.mjs';
const plain=x=>JSON.parse(JSON.stringify(x));
function nearby(w,town,min=1){const center=w.planet.chunks[town.center.join(',')];return w.filterChunks(c=>!c.v.s&&c.v.g===center.v.g&&c.b!=='water'&&c.b!=='mountain'&&Math.hypot(c.x-center.x,c.y-center.y)>=min).sort((a,b)=>Math.hypot(a.x-center.x,a.y-center.y)-Math.hypot(b.x-center.x,b.y-center.y))[0];}
function create(w,at,name,pop=80){const town=w.happen('Create',null,null,{x:at.x,y:at.y},'town');w.happen('Explore',null,null,{x:at.x,y:at.y});town.name=name;town.start=1;town.pop=pop;town.jobs={};town.resources={crop:1000};town._paultendoNextExchangeDay=99999;town.influences.hunger=0;return town;}
function quiet(w){for(const id of ['townFarm','townTame','townMine','townLumber','townBirth','townDeath','townExpand','townEmploy']){if(w.gameEvents[id].func)w.gameEvents[id].func=()=>{};if(w.gameEvents[id].perChunk)w.gameEvents[id].perChunk=()=>{};}w.gameEvents.processAll.func=()=>{};w.chooseEvent=()=>null;}
function setup(g,{early=false}={}){const w=g.window,a=settleGame(g);w.planet.day=30;a.name='Ashbank';a.start=1;a.pop=80;a.jobs={soldier:40,farmer:40};a.resources={crop:1000};a.influences.hunger=0;a._paultendoNextExchangeDay=99999;Object.assign(w.planet.unlocks,{farm:20,smith:10,trade:10,travel:20,military:early?0:50});const b=create(w,nearby(w,a),'Wick');for(const town of [a,b]){const center=w.planet.chunks[town.center.join(',')];for(const c of w.filterChunks(c=>!c.v.s&&c.v.g===center.v.g&&c.b!=='water'&&c.b!=='mountain').sort((x,y)=>Math.hypot(x.x-center.x,x.y-center.y)-Math.hypot(y.x-center.x,y.y-center.y)).slice(0,20)){c.v.s=town.id;town.size++;}w.happen('UpdateCenter',null,town);}const war=startWar(w,a,b);quiet(w);return {w,a,b,war};}
function startWar(w,a,b){const war=w.happen('Create',a,null,{type:'war',towns:[a.id,b.id]},'process');war.sides=[[a.id],[b.id]];war.start=w.planet.day;war._paultendoEarlyDuration=14;a.relations[b.id]=b.relations[a.id]=-10;a.issues.war=b.issues.war=war.id;return war;}
function eat(w,town,food){town.resources.crop=food;town.resources.livestock=0;w.gameEvents.townEat.func(town);return town._paultendoFoodFlow.find(flow=>flow.day===w.planet.day);}
function fight(w,war,roll=.999){const random=w.Math.random;w.Math.random=()=>roll;try{w.metaEvents.processWar.func(war);}finally{w.Math.random=random;}}
function click(w,text){const button=[...w.document.querySelectorAll('#actionSubList [role="button"]')].find(button=>button.textContent.includes(text));assert.ok(button,text);button.click();}
function check(g){assert.deepEqual(g.errors,[]);}

test('actual short meals reduce an army’s territorial attack without adding another food bill or awarding gear',async t=>{
 const losses=[];
 for(const hungry of [false,true]){const g=await makeGame();t.after(g.close);const {w,a,b,war}=setup(g);const meal=eat(w,a,hungry?1:1000);eat(w,b,1000);assert.equal(meal.consumed<meal.wanted,hungry);const food=plain([a.resources,b.resources]),military=w.planet.unlocks.military,size=b.size;fight(w,war,0);losses.push(size-b.size);const captured=w.planet._paultendoLife.exchanges.filter(r=>r.kind==='seizure').reduce((sum,r)=>sum+r.cargo,0);assert.equal((a.resources.crop || 0)+(b.resources.crop || 0)+captured,(food[0].crop || 0)+(food[1].crop || 0));assert.deepEqual(plain(a.resources),food[0]);assert.equal(w.planet.unlocks.military,military);assert.equal(a.jobs.soldier,40);check(g);}
 assert.ok(losses[0]>losses[1],JSON.stringify(losses));assert.ok(losses[1]>0,'Hungry soldiers can still fight');
});

test('short meals also restrain early skirmishes with no military technology',async t=>{
 const losses=[];
 for(const hungry of [false,true]){const g=await makeGame();t.after(g.close);const {w,a,b,war}=setup(g,{early:true});eat(w,a,hungry?1:1000);eat(w,b,1000);const before=plain([a.resources,b.resources]),pop=b.pop;fight(w,war,.1);losses.push(pop-b.pop);assert.deepEqual(plain([a.resources,b.resources]),before);assert.equal(w.planet.unlocks.military,0);check(g);}
 assert.ok(losses[0]>0,JSON.stringify(losses));assert.equal(losses[1],0);
});

test('ration history follows actual meals, recovers over full meals and survives reload without duplicate reports',async t=>{
 const g=await makeGame();t.after(g.close);const {w,a,war}=setup(g);eat(w,a,1);fight(w,war);const record=w.planet._paultendoLife.warRations.find(r=>r.town===a.id);assert.ok(record);assert.equal(record.short,true);assert.equal(record.steps.length,1);const stocks=plain(a.resources);fight(w,war);assert.equal(record.steps.length,1);assert.deepEqual(plain(a.resources),stocks);
 const restored=await makeGame({save:plain(w.generateSave())});t.after(restored.close);const rw=restored.window,ra=rw.regGet('town',a.id),rwar=rw.regGet('process',war.id),copy=rw.planet._paultendoLife.warRations.find(r=>r.id===record.id);assert.deepEqual(plain(copy),plain(record));quiet(rw);
 for(let n=1;n<=3;n++){rw.planet.day++;eat(rw,ra,1000);fight(rw,rwar);assert.equal(copy.short,n<3);}
 assert.equal(copy.steps.length,2);assert.match(copy.steps.at(-1).text,/recover strength/);assert.equal(copy.steps.at(-1).day,record.day+3);const log=rw.document.querySelector(`[data-story-kind="rations"][data-story-id="${copy.id}"]`);assert.ok(log);log.querySelector('.paultendoChronicleStoryLink').click();assert.match(rw.document.getElementById('actionSubList').textContent,/Meals through the fighting/);assert.doesNotMatch(rw.document.getElementById('actionSubList').textContent,/Your choice|Autoplay/);check(g);check(restored);
});

test('old or missing meal evidence cannot invent a supply penalty, and peace is shown as history',async t=>{
 const g=await makeGame();t.after(g.close);const {w,a,war}=setup(g);fight(w,war);assert.equal(w.planet._paultendoLife.warRations.length,0);eat(w,a,1);fight(w,war);const record=w.planet._paultendoLife.warRations[0];w.planet.day+=3;fight(w,war);assert.equal(record.short,true,'Unobserved meals cannot invent recovery');
 const first=w.document.querySelector(`[data-story-id="${record.id}"]`);first.querySelector('.paultendoChronicleStoryLink').click();assert.match(w.document.getElementById('actionSubList').textContent,/no fresh word about their meals/);
 eat(w,a,1000);fight(w,war);assert.equal(record.short,true,'One fresh full meal cannot fill in missing days');assert.equal(record.steps.length,1);first.querySelector('.paultendoChronicleStoryLink').click();assert.match(w.document.getElementById('actionSubList').textContent,/latest meals were full/);war.done=true;
 const entry=w.document.querySelector(`[data-story-id="${record.id}"]`);entry.querySelector('.paultendoChronicleStoryLink').click();assert.match(w.document.getElementById('actionSubList').textContent,/fighting has ended/);check(g);
});

function provisionPair(g,{gap=false}={}){const w=g.window,a=settleGame(g);w.planet.day=30;a.name='Ashbank';a.start=1;a.pop=20;a.jobs={soldier:10};a.resources={crop:1};a.influences.hunger=0;a._paultendoNextExchangeDay=99999;Object.assign(w.planet.unlocks,{farm:20,smith:10,trade:10,travel:20,military:50});const b=create(w,nearby(w,a,gap?6:1),'Wick',20);b.resources.crop=200;b.values={justice:6,openness:6};b.jobs={farmer:10};w.gameEvents.establishTradeRoute.func(a,b,{choice:'yes'});const enemy=create(w,nearby(w,a,12),'Ridge',20);enemy.jobs={soldier:5};const war=startWar(w,a,enemy);quiet(w);return {w,a,b,enemy,war};}
function next(w){w.nextDay();}
function due(w,r){w.planet.day=Math.max(w.planet.day,r.due-1);next(w);}

test('a friendly wartime neighbour can send actual food whose meals help recovery and remain linked to the shipment',async t=>{
 const g=await makeGame();t.after(g.close);const {w,a,b,war}=provisionPair(g);eat(w,a,1);fight(w,war);w.planet.day++;eat(w,a,1);const exchange=w.planet._paultendoLife.exchanges.find(r=>r.buyer===a.id);assert.ok(exchange);assert.equal(exchange.source,'need','Towns can ask without player intervention');const before=b.resources.crop;due(w,exchange);assert.equal(exchange.status,'carrying');assert.ok(b.resources.crop<before);const cargo=exchange.cargo;assert.ok(cargo>0);
 for(let n=0;n<12&&!exchange.resolved;n++){a.resources.crop=1;due(w,exchange);}assert.equal(exchange.status,'arrived');assert.equal(exchange.delivered,cargo);const record=w.planet._paultendoLife.warRations.find(r=>r.town===a.id);assert.equal(record.short,true,'Arrival alone grants no fighting recovery');
 for(let n=0;n<3;n++){if(n)w.planet.day++;w.gameEvents.townEat.func(a);fight(w,war);}assert.equal(record.short,false,JSON.stringify({day:w.planet.day,war,record,flow:a._paultendoFoodFlow,stock:a.resources,pop:a.pop,exchange}));assert.ok(exchange.uses.some(use=>use.kind==='meals'&&use.town===a.id));const log=w.document.querySelector(`[data-story-kind="rations"][data-story-id="${record.id}"]`);log.querySelector('.paultendoChronicleStoryLink').click();assert.match(w.document.getElementById('actionSubList').textContent,/Food that reached them/);click(w,'Follow the supplies');assert.match(w.document.getElementById('actionSubList').textContent,/Wick sends|grain reach Ashbank/);assert.equal(a._paultendoExchangeMemory[b.id].received.crop,cargo);check(g);
});

test('a shipment can detour around hostile ground, and coalition allies can still supply each other',async t=>{
 for(const kind of ['detour','ally']){
  const g=await makeGame();t.after(g.close);const {w,a,b,enemy,war}=provisionPair(g,{gap:true});
  if(kind==='ally'){war.towns.push(b.id);war.sides[0].push(b.id);war._paultendoSideMap=undefined;b.issues.war=war.id;}
  w.gameEvents.townMarketPurchase.func(a,null,{seller:b,goodsType:'crop'});const exchange=w.planet._paultendoLife.exchanges.find(r=>r.buyer===a.id);assert.ok(exchange);due(w,exchange);assert.equal(exchange.status,'carrying');const cargo=exchange.cargo;
  if(kind==='detour'){const path=w.planet._paultendoPathCache[`town:${a.id}->town:${b.id}`].path,interior=path.find(chunk=>!chunk.v.s&&chunk.b!=='water');assert.ok(interior);interior.v.s=enemy.id;assert.ok(path.some(chunk=>chunk.v.s===enemy.id),'The normal cached path is now hostile');}
  for(let n=0;n<12&&!exchange.resolved;n++){a.resources.crop=1;due(w,exchange);}assert.equal(exchange.status,'arrived');assert.equal(exchange.delivered,cargo);assert.ok(!exchange.steps.some(step=>step.kind==='blocked'));check(g);
 }
});

test('enemy territory blocks a real wartime shipment and preserves its cargo through reload until peace reopens passage',async t=>{
 const g=await makeGame();t.after(g.close);const {w,a,b,enemy,war}=provisionPair(g,{gap:true});w.gameEvents.townMarketPurchase.func(a,null,{seller:b,goodsType:'crop'});const exchange=w.planet._paultendoLife.exchanges.find(r=>r.buyer===a.id);assert.ok(exchange);due(w,exchange);assert.equal(exchange.status,'carrying');const cargo=exchange.cargo;
 for(const chunk of Object.values(w.planet.chunks))if(![a.id,b.id].includes(chunk.v.s))chunk.v.s=enemy.id;due(w,exchange);assert.equal(exchange.status,'waiting');assert.equal(exchange.cargo,cargo);assert.equal(exchange.delivered,undefined);
 const restored=await makeGame({save:plain(w.generateSave())});t.after(restored.close);const rw=restored.window,copy=rw.planet._paultendoLife.exchanges.find(r=>r.id===exchange.id);assert.equal(copy.cargo,cargo);quiet(rw);rw.regGet('process',war.id).done=true;
 for(let n=0;n<12&&!copy.resolved;n++)due(rw,copy);assert.equal(copy.status,'arrived');assert.equal(copy.delivered,cargo);next(rw);assert.equal(copy.delivered,cargo);check(g);check(restored);
});

test('wartime supplies still respect enemies, embargoes and a donor’s own meals',async t=>{
 for(const block of ['enemy','embargo','stores']){const g=await makeGame();t.after(g.close);const {w,a,b,war}=provisionPair(g);if(block==='enemy'){war.towns.push(b.id);war.sides[1].push(b.id);war._paultendoSideMap=undefined;b.issues.war=war.id;}if(block==='embargo')w.planet.embargoes=[{fromId:b.id,toId:a.id,start:w.planet.day}];w.gameEvents.townMarketPurchase.func(a,null,{seller:b,goodsType:'crop'});if(block==='stores')b.resources.crop=1;const before=b.resources.crop,exchange=(w.planet._paultendoLife.exchanges || []).find(r=>r.buyer===a.id);if(exchange){due(w,exchange);assert.equal(exchange.status,'refused');assert.equal(exchange.cargo || 0,0);}else {assert.notEqual(block,'stores');assert.equal(b.resources.crop,before);}assert.equal((a._paultendoExchangeMemory?.[b.id]?.received?.crop || 0),0);check(g);}
});
