import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGame,settleGame} from './harness.mjs';
const plain=x=>JSON.parse(JSON.stringify(x));
const records=w=>w.planet._paultendoLife.exchanges;
const panel=w=>w.document.getElementById('actionSubList');
function quiet(w){
 // Keep cargo and route progression running, without independent seasonal,
 // political or synergy changes obscuring their resource and trust costs.
 for(const id of ['townFarm','townTame','townMine','townLumber','townBirth','townDeath','townExpand','townEmploy','townEat','townEconomyTick','townTax','doResearch','seasonalInfluences','governmentHarmony','paultendoSynergyPulse']){
  if(w.gameEvents[id]?.func)w.gameEvents[id].func=()=>{};
  if(w.gameEvents[id]?.perChunk)w.gameEvents[id].perChunk=()=>{};
 }
 w.gameEvents.processAll.func=()=>{};
}
function next(w,n=1){const choose=w.chooseEvent;w.chooseEvent=()=>null;try{for(let i=0;i<n;i++)w.nextDay();}finally{w.chooseEvent=choose;}}
function nearby(w,a){const c=w.planet.chunks[a.center.join(',')];return w.filterChunks(x=>!x.v.s&&x.v.g===c.v.g&&x.b!=='water'&&x.b!=='mountain').sort((x,y)=>Math.hypot(x.x-c.x,x.y-c.y)-Math.hypot(y.x-c.x,y.y-c.y))[0];}
function pair(g){
 const w=g.window,a=settleGame(g);w.planet.day=30;const at=nearby(w,a),b=w.happen('Create',null,null,{x:at.x,y:at.y},'town');
 for(const [town,name] of [[a,'Ashbank'],[b,'Wick']]){
  town.name=name;town.pop=20;town.jobs={farmer:20};town.resources={crop:1000};town.values={justice:6,openness:6};town.gov='democracy';town.influences.trade=5;town.influences.hunger=0;town._paultendoNextExchangeDay=99999;
  w.happen('Explore',null,null,{x:town.center[0],y:town.center[1]});
 }
 a.relations[b.id]=b.relations[a.id]=0;
 Object.assign(w.planet.unlocks,{trade:20,farm:20,travel:20,military:50});quiet(w);next(w,2);return {w,a,b};
}
function ask(w,b,a){
 b.resources.crop=0;w.gameEvents.townMarketPurchase.func(b,null,{seller:a,goodsType:'crop'});
 const r=records(w).find(r=>r.buyer===b.id&&!r.resolved);assert.ok(r);
 for(let n=0;n<12&&r.status==='asking';n++)next(w);return r;
}
function finish(w,r){for(let n=0;n<20&&!r.resolved;n++)next(w);assert.equal(r.status,'arrived',JSON.stringify(r));assert.ok(r.delivered>0);return r;}
function shipment(w,b,a){return finish(w,ask(w,b,a));}
function route(w){return w.planet.tradeRoutes?.find(r=>r.origin?.kind==='exchanges');}
function click(w,text){const b=[...panel(w).querySelectorAll('[role="button"]')].find(e=>e.textContent===text);assert.ok(b,`${text}: ${panel(w).textContent}`);b.click();}
function open(w,r){w.document.querySelector(`[data-story-id="${r.id}"] .paultendoChronicleStoryLink`).click();}
function errors(g){assert.deepEqual(g.errors,[]);}

test('useful completed deliveries establish a regular route with actual cargo counts and no extra wealth or influence',async t=>{
 const g=await makeGame();t.after(g.close);const {w,a,b}=pair(g);
 const influences=plain([a.influences.trade,b.influences.trade]),first=shipment(w,b,a);assert.equal(route(w),undefined);
 const second=ask(w,b,a);assert.equal(second.status,'carrying');assert.equal(route(w),undefined);finish(w,second);
 const grown=route(w);assert.ok(grown);assert.equal(grown.established,second.arrived);assert.deepEqual(plain(grown.origin.arrivals.map(r=>r.id)),[first.id,second.id]);
 assert.equal(grown.totalGoods,first.delivered+second.delivered);assert.equal(grown.caravans,2);assert.equal(second.route,grown.id);
 assert.deepEqual(plain([a.influences.trade,b.influences.trade]),influences);assert.equal((a.resources.cash || 0)+(b.resources.cash || 0),0);
 assert.equal(a.relations[b.id],3);assert.equal(b.relations[a.id],3);assert.ok(second.steps.some(s=>s.kind==='route'));errors(g);
 await new Promise(resolve=>setTimeout(resolve,40));
 const news=w.document.getElementById('paultendoChronicleHighlights');assert.equal(news.hidden,false);assert.match(news.textContent,/New route:/);assert.equal(news.querySelectorAll('.entityName').length,2);
});

test('route stories retain the real founding exchanges and read-only navigation consumes no random draws or game time',async t=>{
 const g=await makeGame();t.after(g.close);const {w,a,b}=pair(g),first=shipment(w,b,a),second=shipment(w,b,a);
 const before=plain({day:w.planet.day,records:records(w),routes:w.planet.tradeRoutes,resources:[a.resources,b.resources]});
 const random=w.Math.random;let draws=0;w.Math.random=()=>{draws++;return random();};
 try{open(w,second);click(w,'The route these journeys made');assert.match(panel(w).textContent,/Carriers kept returning/);assert.match(panel(w).textContent,/Carriers can still use the route/);click(w,`Day ${first.arrived} · ${first.delivered} grain arrived`);assert.match(panel(w).textContent,/grain reach Wick/);}finally{w.Math.random=random;}
 assert.equal(draws,0);assert.deepEqual(plain({day:w.planet.day,records:records(w),routes:w.planet.tradeRoutes,resources:[a.resources,b.resources]}),before);errors(g);
});

test('requests, refusals and blocked cargo cannot establish a route or award friendship',async t=>{
 for(const mode of ['refused','blocked']){
  const g=await makeGame();t.after(g.close);const {w,a,b}=pair(g);shipment(w,b,a);const before=plain([a.relations[b.id],b.relations[a.id]]);
  if(mode==='refused'){a.values={justice:0,openness:-6};a.relations[b.id]=b.relations[a.id]=-5;const r=ask(w,b,a);assert.equal(r.status,'refused');assert.equal(r.delivered,undefined);assert.equal(route(w),undefined);}
  else {const r=ask(w,b,a);assert.equal(r.status,'carrying');const war=w.happen('Create',a,null,{type:'war',towns:[a.id,b.id]},'process');a.issues.war=b.issues.war=war.id;next(w,3);assert.equal(r.status,'waiting');assert.equal(r.delivered,undefined);assert.equal(route(w),undefined);assert.deepEqual(plain([a.relations[b.id],b.relations[a.id]]),before);}
  errors(g);
 }
});

test('informal supplies do not bypass trading capability or a strained relationship',async t=>{
 for(const mode of ['knowledge','work','relations']){
  const g=await makeGame();t.after(g.close);const {w,a,b}=pair(g);
  if(mode==='knowledge')w.planet.unlocks.trade=10;
  if(mode==='work')a.influences.trade=4;
  if(mode==='relations')a.relations[b.id]=b.relations[a.id]=-1;
  shipment(w,b,a);shipment(w,b,a);assert.equal(route(w),undefined,mode);errors(g);
 }
});

test('long separated visits and captured supplies do not form regular trading ties',async t=>{
 for(const mode of ['old','seizure']){
  const g=await makeGame();t.after(g.close);const {w,a,b}=pair(g);const first=shipment(w,b,a);
  if(mode==='old')w.planet.day+=91;
  else first.kind='seizure'; // A saved captured cargo remains different from trade.
  shipment(w,b,a);assert.equal(route(w),undefined,mode);errors(g);
 }
});

test('a partly delivered relationship resumes after reload without another day, a duplicated route or inflated totals',async t=>{
 const g=await makeGame();t.after(g.close);const {w,a,b}=pair(g),first=shipment(w,b,a),second=ask(w,b,a),day=w.planet.day;
 const restored=await makeGame({save:plain(w.generateSave())});t.after(restored.close);const rw=restored.window;quiet(rw);assert.equal(rw.planet.day,day);assert.equal(route(rw),undefined);
 const copy=records(rw).find(r=>r.id===second.id);finish(rw,copy);const grown=route(rw);assert.ok(grown);assert.equal(grown.caravans,2);assert.equal(grown.totalGoods,first.delivered+copy.delivered);const before=plain(grown.origin);
 next(rw);assert.deepEqual(plain(grown.origin),before);assert.equal(rw.planet.tradeRoutes.filter(r=>r.origin?.kind==='exchanges').length,1);assert.equal(grown.caravans,2);errors(g);errors(restored);
});

test('an actual route’s history remains while war closes its passage, and reading it does not repair the road',async t=>{
 const g=await makeGame();t.after(g.close);const {w,a,b}=pair(g);shipment(w,b,a);const second=shipment(w,b,a),grown=route(w),origin=plain(grown.origin);
 const war=w.happen('Create',a,null,{type:'war',towns:[a.id,b.id]},'process');a.issues.war=b.issues.war=war.id;
 open(w,second);click(w,'The route these journeys made');assert.match(panel(w).textContent,/way between them is closed/);assert.deepEqual(plain(grown.origin),origin);assert.equal(w.planet.day,second.arrived);errors(g);
});

test('retired terrain and climate shortcuts cannot invent trade, friendships or commodity competition',async t=>{
 const g=await makeGame();t.after(g.close);const {w,a,b}=pair(g);
 for(const id of ['climateTradeGoods','resourceDrivenTensions','specializationTradeAttract'])assert.equal(w.gameEvents[id],undefined);
 const before=plain({relations:[a.relations[b.id],b.relations[a.id]],resources:[a.resources,b.resources]});next(w,2);
 assert.equal(records(w).length,0);assert.equal(route(w),undefined);assert.deepEqual(plain({relations:[a.relations[b.id],b.relations[a.id]],resources:[a.resources,b.resources]}),before);errors(g);
});
