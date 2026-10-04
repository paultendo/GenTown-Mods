import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGame,settleGame} from './harness.mjs';
const plain=x=>JSON.parse(JSON.stringify(x));
const life=w=>w.planet._paultendoLife;
async function game(){const warnings=[];const g=await makeGame({beforeMod(w){w.console.warn=(...args)=>warnings.push(args.map(String).join(' '));}});g.warnings=warnings;return g;}
function check(g){assert.deepEqual(g.errors,[]);assert.deepEqual(g.warnings.filter(s=>/follow-up failed|Background world failed/.test(s)),[]);}
function quiet(w){for(const id of ['townFarm','townTame','townMine','townLumber','townBirth','townDeath','townExpand','townEmploy','townEat','townEconomyTick','townTax','doResearch','governmentHarmony','paultendoSynergyPulse','seasonalInfluences','warPressureDynamics'])if(w.gameEvents[id]){if(w.gameEvents[id].func)w.gameEvents[id].func=()=>{};if(w.gameEvents[id].perChunk)w.gameEvents[id].perChunk=()=>{};}w.gameEvents.processAll.func=()=>{};w.chooseEvent=()=>null;}
function setup(g,{owner='buyer',boat=true,payment=false}={}){
 const w=g.window,a=settleGame(g);w.planet.day=30;const [x,y]=a.center,home=w.planet.chunks[`${x},${y}`].v.g,other=w.regToArray('landmass').find(l=>l.id!==home&&l.id>10).id;
 for(const c of Object.values(w.planet.chunks)){c.b='water';delete c.v.g;delete c.v.s;delete c.v.road;}
 for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){const c=w.planet.chunks[`${x+dx},${y+dy}`];c.b='grass';c.v.g=home;c.v.s=a.id;}
 const tx=x+6;for(let dx=0;dx<3;dx++)for(let dy=-1;dy<=1;dy++){const c=w.planet.chunks[`${tx+dx},${y+dy}`];c.b='grass';c.v.g=other;}
 const b=w.happen('Create',null,null,{x:tx,y},'town');Object.assign(w.planet.unlocks,{farm:20,travel:30,smith:20,trade:payment?30:20});
 for(const [town,name] of [[a,'Ashbank'],[b,'Wick']]){town.name=name;town.flag=town===a?'{{color:><|#f47759|#554aff}}':'{{color:W|#66ff88|#334466}}';town.pop=30;town.jobs={farmer:28,merchant:1,lumberer:1};town.resources={crop:town===a?10:1000,lumber:20,cash:town===a?1000.25:.75};town.research={};town.values=payment?{justice:0,openness:0}:{justice:6,openness:6};town._paultendoNextExchangeDay=99999;town.influences.trade=10;town.relations[(town===a?b:a).id]=payment?0:6;w.happen('Explore',null,null,{x:town.center[0],y:town.center[1]});w.openRegBrowser(town,'town');[...w.document.querySelectorAll('.paultendoTownLife button')].find(b=>b.textContent==='Meet the people').click();for(const p of town._paultendoPeople)p.outlook='guarded';}
 const port=owner==='buyer'?a:b;if(boat)port.resources.coastal_boat=1;quiet(w);return {w,a,b,port};
}
function next(w,n=1){for(let i=0;i<n;i++)w.nextDay();}
function until(w,fn,n=100){for(let i=0;i<n&&!fn();i++)next(w);assert.ok(fn(),JSON.stringify(life(w).seaVoyages));}
function buy(w,a,b,type='crop'){w.gameEvents.townMarketPurchase.func(a,null,{seller:b,goodsType:type});const r=life(w).exchanges.find(r=>r.buyer===a.id&&!r.resolved);assert.ok(r,'A real request should be possible across this coast');return {r,v:life(w).seaVoyages.find(v=>v.id===r.sea)};}

test('coastal aid uses an actual buyer vessel and goods enter stores only after the crossing',async t=>{
 const g=await game();t.after(g.close);const {w,a,b,port}=setup(g),{r,v}=buy(w,a,b);assert.equal(v.status,'preparing');assert.equal(port.resources.coastal_boat,1);assert.equal(b.resources.crop,1000);next(w);assert.equal(v.held,1);assert.equal(port.resources.coastal_boat || 0,0);assert.equal(r.status,'asking');assert.equal(b.resources.crop,1000);
 until(w,()=>r.status==='carrying');const sent=r.cargo;assert.equal(sent,24);assert.equal(b.resources.crop+sent,1000);assert.equal(a.resources.crop,10);assert.equal(v.phase,'cargo');assert.equal(v.status,'outbound');const departed=w.planet.day;next(w);assert.equal(a.resources.crop,10);until(w,()=>r.status==='arrived');assert.ok(r.arrived>departed);assert.equal(a.resources.crop,10+sent);assert.equal(r.delivered,sent);assert.equal(v.held,1);until(w,()=>v.status==='returned');assert.equal(port.resources.coastal_boat,1);const stock=plain([a.resources,b.resources]);next(w);assert.deepEqual(plain([a.resources,b.resources]),stock);assert.equal(Object.values(w.planet.chunks).some(c=>c.b==='water'&&c.v.road),false);check(g);
});

test('a supplier can carry food to an island whose people do not know boatbuilding',async t=>{
 const g=await game();t.after(g.close);const {w,a,b,port}=setup(g,{owner:'seller'});w.planet._paultendoLocalKnowledge={'travel:30':{key:'travel',level:30,before:20}};b._paultendoLocalDiscoveries={'travel:30':{day:30,inquiry:'wick-boats'}};a.resources.crop=0;
 const {r,v}=buy(w,a,b);assert.equal(v.town,b.id);assert.equal(v.phase,'collect');next(w);assert.equal(v.held,1);until(w,()=>r.status==='carrying');assert.ok(w.planet.day-v.started>=4,'Supplier first reaches the island, then returns with its request');assert.equal(a.resources.crop,0);until(w,()=>r.status==='arrived');assert.equal(a.resources.crop,r.delivered);assert.equal(a.resources.coastal_boat,undefined);assert.equal(b.resources.coastal_boat || 0,0);until(w,()=>v.status==='returned');assert.equal(port.resources.coastal_boat,1);check(g);
});

test('payment stays in escrow until goods land and reaches the supplying town on its own real leg',async t=>{
 const g=await game();t.after(g.close);const {w,a,b,port}=setup(g,{payment:true}),{r,v}=buy(w,a,b);until(w,()=>r.status==='carrying');assert.equal(r.kind,'trade');assert.ok(r.paymentCargo>0);const escrow=r.paymentCargo,coin=a.resources.cash+b.resources.cash;assert.ok(Math.abs(coin+escrow-1001)<1e-9);assert.equal(b.resources.cash,.75);until(w,()=>v.phase==='payment');assert.equal(r.cargo,0);assert.equal(a.resources.crop,10+r.delivered);assert.equal(r.resolved,false);assert.equal(b.resources.cash,.75);w.document.querySelector(`[data-story-id="${r.id}"] .paultendoChronicleStoryLink`).click();assert.match(w.document.getElementById('actionSubList').textContent,/The supplies have arrived\. The crew is taking payment back\./);const departure=w.planet.day;next(w);assert.equal(b.resources.cash,.75);until(w,()=>r.resolved);assert.ok(r.arrived>departure);assert.equal(b.resources.cash,.75+escrow);assert.equal(r.paymentCargo,0);assert.ok(Math.abs(a.resources.cash+b.resources.cash-1001)<1e-9);until(w,()=>v.status==='returned');assert.equal(port.resources.coastal_boat,1);check(g);
});

test('a useful request creates actual local boat work before cargo can leave the supplying stores',async t=>{
 const g=await game();t.after(g.close);const {w,a,b,port}=setup(g,{boat:false}),{r,v}=buy(w,a,b);next(w);const work=life(w).materialWork.find(work=>work.type==='coastal_boat');assert.ok(work);work.roll=.99;assert.equal(r.cargo,0);assert.equal(b.resources.crop,1000);assert.equal(port.resources.coastal_boat,undefined);until(w,()=>v.held===1);assert.equal(work.status,'made');assert.ok(work.finished-work.started>=6);assert.equal(port.resources.lumber,16);assert.equal(v.inputs[0].production.work,work.id);until(w,()=>v.status==='returned');assert.equal(port.resources.coastal_boat,1);check(g);
});

test('an embargo holds the actual cargo offshore and lifting it cannot deliver goods instantly',async t=>{
 const g=await game();t.after(g.close);const {w,a,b}=setup(g),{r,v}=buy(w,a,b);until(w,()=>r.status==='carrying');w.planet.embargoes=[{fromId:b.id,toId:a.id}];next(w,4);assert.equal(a.resources.crop,10);assert.equal(v.pause,'border');const position=v.position;next(w);assert.equal(v.position,position);assert.equal(r.cargo,24);w.planet.embargoes=[];assert.equal(a.resources.crop,10);until(w,()=>r.resolved);assert.equal(a.resources.crop,34);until(w,()=>v.status==='returned');check(g);
});

test('full receiving stores keep cargo with the crew and free space unloads it exactly once',async t=>{
 const g=await game();t.after(g.close);const {w,a,b}=setup(g),{r,v}=buy(w,a,b);until(w,()=>r.status==='carrying');a.resources.crop=w.$c.maxResource(a);const full=a.resources.crop;until(w,()=>v.status==='docked');assert.equal(r.resolved,false);assert.equal(r.cargo,24);assert.equal(a.resources.crop,full);assert.equal(v.held,1);next(w,3);assert.equal(r.cargo,24);a.resources.crop=10;next(w);assert.equal(a.resources.crop,34);assert.equal(r.status,'arrived');until(w,()=>v.status==='returned');next(w,2);assert.equal(a.resources.crop,34);assert.equal(a._paultendoCommodityLots.crop.filter(l=>l.exchange===r.id).reduce((sum,l)=>sum+l.count,0),24);check(g);
});

test('a lost buyer cancels delivery and the surviving vessel returns actual supplies to their origin',async t=>{
 const g=await game();t.after(g.close);const {w,a,b}=setup(g,{owner:'seller'}),{r,v}=buy(w,a,b);until(w,()=>r.status==='carrying');assert.equal(b.resources.crop,976);a.end=w.planet.day;until(w,()=>v.status==='returned');assert.equal(r.status,'closed');assert.equal(r.cargo,0);assert.equal(r.returned,24);assert.equal(b.resources.crop,1000);assert.equal(b.resources.coastal_boat,1);assert.equal(r.delivered || 0,0);check(g);
});

test('loss of the home port loses the actual boat and onboard cargo, while unshipped payment stays with its surviving buyer',async t=>{
 const g=await game();t.after(g.close);const {w,a,b}=setup(g,{owner:'seller',payment:true}),{r,v}=buy(w,a,b);until(w,()=>r.status==='carrying');assert.ok(r.paymentCargo>0);assert.ok(a.resources.cash<1000.25);b.end=w.planet.day;next(w);assert.equal(v.status,'lost');assert.equal(v.lost,1);assert.equal(v.held,0);assert.equal(r.status,'lost');assert.equal(r.lost.count,24);assert.equal(r.cargo,0);assert.equal(r.paymentCargo,0);assert.equal(a.resources.cash,1000.25);assert.equal(a.resources.crop,10);next(w);assert.equal(a.resources.cash,1000.25);check(g);
});

test('a recovered need cancels preparation without creating a boat and a returning refused crew keeps its real hull',async t=>{
 for(const launched of [false,true]){const g=await game();t.after(g.close);const {w,a,b}=setup(g),{r,v}=buy(w,a,b);if(launched)next(w);a.resources.crop=1000;until(w,()=>r.resolved);assert.equal(r.status,'withdrawn');assert.equal(r.cargo,0);assert.equal(b.resources.crop,1000);until(w,()=>v.status==='returned'||v.status==='cancelled');assert.equal(a.resources.coastal_boat,1);check(g);}
});

test('actual deliveries establish a sea route with its measured crossing and no free cargo or money',async t=>{
 const g=await game();t.after(g.close);const {w,a,b}=setup(g);let first=buy(w,a,b);until(w,()=>first.v.status==='returned');assert.equal(w.planet.tradeRoutes.length,0);a.resources.crop=10;const second=buy(w,a,b);until(w,()=>second.r.resolved);const route=w.planet.tradeRoutes.at(-1);assert.ok(route);assert.equal(route.needsShips,true);assert.equal(route.distance,6);assert.equal(route.travelTime,2);assert.equal(route.totalGoods,48);assert.equal(route.caravans,2);assert.deepEqual(plain(route.origin.arrivals.map(r=>r.id)),[first.r.id,second.r.id]);assert.equal(a.resources.cash,1000.25);assert.equal(b.resources.cash,.75);until(w,()=>second.v.status==='returned');check(g);
});

test('unobserved towns can exchange supplies without exposing their flags, names or fog',async t=>{
 const g=await game();t.after(g.close);const {w,a,b}=setup(g);a._hidden=b._hidden=true;const control=await game();t.after(control.close);const baseline=setup(control);baseline.a._hidden=baseline.b._hidden=true;const day=w.planet.day,{r,v}=buy(w,a,b);until(w,()=>v.status==='returned');next(baseline.w,w.planet.day-day);assert.equal(r.status,'arrived');assert.equal(a.resources.crop,34);assert.equal(w.document.querySelectorAll(`[data-story-id="${r.id}"],[data-story-id="${v.id}"]`).length,0);assert.deepEqual(plain(w.planet._paultendoFog.explored),plain(baseline.w.planet._paultendoFog.explored));check(g);check(control);
});

// Native terrain is deliberately left unchanged here. The game regenerates
// terrain from its seed on reload, so a painted corridor cannot verify this.
function nativePorts(g){
 const w=g.window,a=settleGame(g);w.planet.day=30;const x=3,y=10;assert.equal(a.center.join(','),'3,14');assert.notEqual(w.planet.chunks[`${x},${y}`].b,'water');const b=w.happen('Create',null,null,{x,y},'town');
 Object.assign(w.planet.unlocks,{farm:20,travel:30,smith:20,trade:30});
 for(const [town,name] of [[a,'Ashbank'],[b,'Wick']]){town.name=name;town.flag=town===a?'{{color:><|#f47759|#554aff}}':'{{color:W|#66ff88|#334466}}';town.pop=30;town.jobs={farmer:28,merchant:1,lumberer:1};town.resources={crop:town===a?10:1000,lumber:20,cash:town===a?1000.25:.75};town.values={justice:0,openness:0};town.influences.trade=10;town._paultendoNextExchangeDay=99999;w.happen('Explore',null,null,{x:town.center[0],y:town.center[1]});}
 a.resources.coastal_boat=1;quiet(w);return {w,a,b};
}

test('a native-coast save restores cargo, crew, escrow and physical position without duplicating any supplies',async t=>{
 const g=await game();t.after(g.close);const {w,a,b}=nativePorts(g),{r,v}=buy(w,a,b);until(w,()=>r.status==='carrying');assert.ok(v.routePath.some(c=>w.planet.chunks[`${c.x},${c.y}`].b==='water'));
 const save=plain(w.generateSave()),held=plain(v),escrow=r.paymentCargo,restored=await makeGame({save});t.after(restored.close);const rw=restored.window;quiet(rw);const rv=life(rw).seaVoyages.find(v=>v.id===held.id),rr=life(rw).exchanges.find(x=>x.id===r.id),ra=rw.regGet('town',a.id),rb=rw.regGet('town',b.id);assert.equal(rv.held,1);assert.equal(rv.position,held.position);assert.equal(rr.cargo,r.cargo);assert.equal(rr.paymentCargo,escrow);assert.equal(ra.resources.coastal_boat || 0,0);until(rw,()=>rv.status==='returned');assert.equal(rr.status,'arrived');assert.equal(ra.resources.crop,10+rr.delivered);assert.equal(rb.resources.crop+rr.delivered,1000);assert.equal(ra.resources.coastal_boat,1);assert.ok(Math.abs(ra.resources.cash+rb.resources.cash-1001)<1e-9);next(rw);assert.equal(ra.resources.coastal_boat,1);assert.deepEqual(restored.errors,[]);check(g);
});

test('reading the coloured cargo story and crew links spends no days, goods or random draws',async t=>{
 const g=await game();t.after(g.close);const {w,a,b}=setup(g),{r,v}=buy(w,a,b);until(w,()=>r.status==='carrying');const snapshot=plain({day:w.planet.day,life:life(w),towns:[a.resources,b.resources],fog:w.planet._paultendoFog.explored});let draws=0;const random=w.Math.random;w.Math.random=()=>{draws++;return random();};const link=w.document.querySelector(`[data-story-id="${r.id}"] .paultendoChronicleStoryLink`);assert.ok(link);link.click();const panel=w.document.getElementById('actionSubList'),follow=[...panel.querySelectorAll('[role="button"]')].find(b=>b.textContent==='Follow the vessel and its crew');assert.ok(follow);follow.click();assert.match(panel.textContent,/24 supplies/);assert.ok(panel.querySelector('.font2'));assert.equal(panel.querySelector('.font2').style.backgroundColor,'rgb(85, 74, 255)');assert.equal(draws,0);assert.deepEqual(plain({day:w.planet.day,life:life(w),towns:[a.resources,b.resources],fog:w.planet._paultendoFog.explored}),snapshot);w.Math.random=random;check(g);
});

test('barter delivers needed food and the actual material payment on separate legs',async t=>{
 const g=await game();t.after(g.close);const {w,a,b}=setup(g);a.resources.rock=40;a.resources.lumber=0;b.resources.lumber=0;b.resources.rock=0;b.values={justice:0,openness:0};a.relations[b.id]=b.relations[a.id]=0;w.happen('Create',b,null,{type:'project',subtype:'school',cost:20},'process');const {r,v}=buy(w,a,b);until(w,()=>r.status==='carrying');assert.equal(r.kind,'barter');assert.equal(r.payment.type,'rock');const stones=r.paymentCargo;assert.ok(stones>0&&stones<=24);assert.equal(a.resources.rock+stones,40);until(w,()=>v.phase==='payment');assert.equal(a.resources.crop,10+r.delivered);assert.equal(b.resources.rock,0);until(w,()=>r.resolved);assert.equal(b.resources.rock,stones);assert.equal(r.paid,stones);until(w,()=>v.status==='returned');check(g);
});

test('a better known vessel gives no free capacity and an available coastal hull is still usable',async t=>{
 for(const sailing of [false,true]){const g=await game();t.after(g.close);const {w,a,b}=setup(g);w.planet.unlocks.travel=60;if(sailing){delete a.resources.coastal_boat;a.resources.sailing_vessel=1;}const {r,v}=buy(w,a,b);assert.equal(v.type,sailing?'sailing_vessel':'coastal_boat');until(w,()=>r.status==='carrying');assert.ok(sailing?r.cargo>24&&r.cargo<=96:r.cargo===24);assert.equal(a.resources.crop,10);until(w,()=>v.status==='returned');assert.equal(a.resources[v.type],1);assert.equal(a.resources.crop,10+r.delivered);check(g);}
});

test('a practiced neighbouring workshop makes actual ordered glass while its vessel waits at the quay',async t=>{
 const g=await game();t.after(g.close);const {w,a,b}=setup(g);a.resources.crop=1000;w.planet.unlocks.fire=50;w.planet.unlocks.smith=50;w.planet.unlocks.education=20;b.resources.lumber=0;b.jobs={miner:28,merchant:1,lumberer:1};b.research={education:100};w.happen('AddResource',null,b,{type:'sand',count:3});w.happen('AddResource',null,b,{type:'charcoal',count:2});b.resources.rock=1;next(w);const first=life(w).materialWork.find(x=>x.town===b.id&&x.type==='glass');assert.ok(first);first.roll=.99;until(w,()=>first.status==='made');w.happen('RemoveResource',null,b,{type:'glass',count:2});w.planet.day+=8;b.research={farm:100};b.resources.sand=3;b.resources.charcoal=2;b.resources.rock=1;
 a.jobs={doctor:28,merchant:1,lumberer:1};a.resources.metal=2;w.openRegBrowser(a,'town');[...w.document.querySelectorAll('.paultendoTownLife button')].find(b=>b.textContent==='Meet the people').click();const panel=w.document.getElementById('actionSubList');const click=text=>{const b=[...panel.querySelectorAll('[role="button"]')].find(b=>b.textContent.includes(text));assert.ok(b,text);b.click();};for(const p of a._paultendoPeople){p.outlook='curious';p.trust=90;}a.guidanceTrust=90;click('Doctor');click('Make something of your own');click('Make a clear lens');const whisper=life(w).whispers.at(-1);whisper.roll=0;until(w,()=>life(w).artifactWork.some(x=>x.town===a.id));const objectWork=life(w).artifactWork.at(-1),{r,v}=buy(w,a,b,'glass');until(w,()=>r.status==='making');const work=life(w).materialWork.find(x=>x.id===r.manufacture.work);assert.ok(work);work.roll=.99;assert.equal(v.status,'docked');assert.equal(v.held,1);assert.equal(a.resources.glass,undefined);until(w,()=>r.status==='carrying');assert.equal(r.cargoLots[0].production.work,work.id);until(w,()=>r.resolved);assert.equal(work.status,'made');assert.equal(r.delivered,1);assert.equal(b.resources.glass,1);until(w,()=>objectWork.status==='made');assert.equal(r.uses.find(u=>u.kind==='craft').count,1);assert.equal(life(w).artifacts.find(x=>x.id===objectWork.artifact).origin.materialProductions[0].work,work.id);until(w,()=>v.status==='returned');check(g);
});
