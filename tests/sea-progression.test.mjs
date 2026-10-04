import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGame,settleGame} from './harness.mjs';
const plain=x=>JSON.parse(JSON.stringify(x));
const life=w=>w.planet._paultendoLife;
const panel=w=>w.document.getElementById('actionSubList');
async function game(){const warnings=[];const g=await makeGame({beforeMod(w){w.console.warn=(...args)=>warnings.push(args.map(String).join(' '));}});g.warnings=warnings;return g;}
function check(g){assert.deepEqual(g.errors,[]);assert.deepEqual(g.warnings.filter(s=>/follow-up failed|Background world failed/.test(s)),[]);}
function quiet(w){for(const id of ['townFarm','townTame','townMine','townLumber','townBirth','townDeath','townExpand','townEmploy','townEat','townEconomyTick','townTax','doResearch','governmentHarmony','paultendoSynergyPulse','seasonalInfluences','warPressureDynamics'])if(w.gameEvents[id]){if(w.gameEvents[id].func)w.gameEvents[id].func=()=>{};if(w.gameEvents[id].perChunk)w.gameEvents[id].perChunk=()=>{};}w.gameEvents.processAll.func=()=>{};w.chooseEvent=()=>null;}
function setup(g,{gap=6,travel=30}={}) {
 const w=g.window,town=settleGame(g);w.planet.day=30;town.name='Wick';town.flag='{{color:W|#66ff88|#334466}}';town.pop=30;town.jobs={farmer:28,merchant:1,lumberer:1};town.resources={crop:1000,lumber:20,metal:4};town.influences.travel=3;town.research={};town._paultendoNextExchangeDay=99999;Object.assign(w.planet.unlocks,{travel,smith:20,trade:20});
 const [x,y]=town.center,home=w.planet.chunks[`${x},${y}`].v.g,other=w.regToArray('landmass').find(l=>l.id!==home&&l.id>10).id;
 // Two islands separated by actual native water tiles. The rest of the
 // fixture is water so an ordinary ground path cannot bypass the crossing.
 for(const c of Object.values(w.planet.chunks)){c.b='water';delete c.v.g;delete c.v.s;delete c.v.road;}
 for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){const c=w.planet.chunks[`${x+dx},${y+dy}`];c.b='grass';c.v.g=home;c.v.s=town.id;}
 const tx=x+gap+2;
 for(let dx=0;dx<3;dx++)for(let dy=-1;dy<=1;dy++){const c=w.planet.chunks[`${tx+dx},${y+dy}`];c.b='grass';c.v.g=other;}
 w.planet._paultendoFog.explored={[`${x},${y}`]:true};w.planet._paultendoFog.visible={};w.planet._paultendoDiscovery.discovered=[home];w.planet._paultendoDiscovery.tier=0;w.planet._paultendoDiscovery.tiers={[home]:0,[other]:1};
 w.happen('Explore',null,null,{x,y});quiet(w);
 w.openRegBrowser(town,'town');[...w.document.querySelectorAll('.paultendoTownLife button')].find(b=>b.textContent==='Meet the people').click();for(const p of town._paultendoPeople)p.outlook='curious';
 return {w,town,home,other,target:w.planet.chunks[`${tx},${y}`]};
}
function proposal(w,town){const args={};assert.equal(w.gameEvents.swayDiscoveryExpedition.value(w.regGet('player',1),town,args),true);return args;}
function start(w,town){const args=proposal(w,town);w.gameEvents.swayDiscoveryExpedition.func(w.regGet('player',1),town,args);assert.equal(args.success,true);return life(w).seaVoyages.find(v=>v.id===args.mission.voyage);}
function next(w,n=1){for(let i=0;i<n;i++)w.nextDay();}
function until(w,v,status,n=60){for(let i=0;i<n&&v.status!==status;i++)next(w);assert.equal(v.status,status,JSON.stringify(v));}
function launch(w,v){next(w);const work=life(w).materialWork.find(w=>w.type===v.type);assert.ok(work);work.roll=.99;until(w,v,'outbound');return work;}
function click(w,text){const b=[...panel(w).querySelectorAll('[role="button"]')].find(b=>b.textContent.includes(text));assert.ok(b,`${text}: ${panel(w).textContent}`);b.click();}
function open(w,v){const b=w.document.querySelector(`[data-story-id="${v.id}"] .paultendoChronicleStoryLink`);assert.ok(b);b.click();}

test('a supported crossing takes actual boat work, timber and a crew, then returns the same vessel with its maker',async t=>{
 const g=await game();t.after(g.close);const {w,town,other}=setup(g),before=plain({resources:town.resources,fog:w.planet._paultendoFog.explored,unlocks:w.planet.unlocks});
 const args=proposal(w,town);assert.deepEqual(plain(town.resources),before.resources);assert.equal(life(w).seaVoyages.length,0);w.gameEvents.swayDiscoveryExpedition.func(w.regGet('player',1),town,args);const v=life(w).seaVoyages.at(-1);assert.equal(v.status,'preparing');assert.equal(town.resources.coastal_boat,undefined);assert.deepEqual(plain(w.planet._paultendoFog.explored),before.fog);assert.equal(w.planet._paultendoDiscovery.discovered.includes(other),false);
 const work=launch(w,v);assert.equal(work.type,'coastal_boat');assert.equal(work.status,'made');assert.equal(work.cost.lumber,4);assert.equal(town.resources.lumber,16);assert.ok(work.finished-work.started>=6);assert.equal(town.resources.coastal_boat || 0,0);assert.equal(v.held,1);assert.equal(v.inputs[0].production.work,work.id);assert.equal(v.reached,undefined);assert.deepEqual(plain(w.planet.unlocks),before.unlocks);
 next(w);assert.equal(v.status,'outbound');assert.ok(v.position>0);assert.equal(w.planet._paultendoDiscovery.discovered.includes(other),false);until(w,v,'returning');assert.ok(v.reached>v.started);assert.equal(w.planet._paultendoDiscovery.discovered.includes(other),true);assert.equal(life(w).places[v.place].visits.at(-1).voyage,v.id);assert.equal(town.resources.coastal_boat || 0,0);
 until(w,v,'returned');assert.ok(v.finished>v.reached);assert.equal(v.held,0);assert.equal(town.resources.coastal_boat,1);assert.equal(town._paultendoCommodityLots.coastal_boat[0].production.work,work.id);const copy=plain(v);next(w);assert.deepEqual(plain(v),copy);assert.equal(town.resources.coastal_boat,1);check(g);
});

test('local knowledge bounds the crossing, and wider water requires an actual local sailing vessel',async t=>{
 const g=await game();t.after(g.close);const {w,town}=setup(g,{gap:10});assert.equal(w.gameEvents.swayDiscoveryExpedition.value(null,town,{}),false);
 w.planet.unlocks.travel=60;w.planet._paultendoLocalKnowledge={'travel:60':{key:'travel',level:60,before:50}};assert.equal(w.gameEvents.swayDiscoveryExpedition.value(null,town,{}),false,'Global sailing learned elsewhere cannot launch Wick’s crossing');
 town._paultendoLocalDiscoveries={'travel:60':{day:30,inquiry:'wick-sailing'}};const v=start(w,town);assert.equal(v.type,'sailing_vessel');const work=launch(w,v);assert.deepEqual(plain(work.cost),{lumber:8,metal:2});assert.ok(work.finished-work.started>=10);assert.equal(town.resources.lumber,12);assert.equal(town.resources.metal,2);assert.equal(v.held,1);until(w,v,'returned');assert.equal(town.resources.sailing_vessel,1);check(g);
});

test('preparation waits for food, hands and timber and a failed hull cannot become a voyage',async t=>{
 const g=await game();t.after(g.close);const {w,town}=setup(g);const v=start(w,town);town.resources.crop=0;next(w);assert.equal(v.pause,'food');assert.equal(v.started,undefined);assert.equal(town.resources.lumber,20);
 town.resources.crop=1000;town.resources.lumber=0;next(w);const work=life(w).materialWork.find(w=>w.type==='coastal_boat');assert.ok(work);work.roll=0;next(w,3);assert.equal(work.status,'waiting');assert.equal(v.status,'preparing');town.resources.lumber=4;until(w,work,'failed');assert.equal(town.resources.lumber || 0,0);assert.equal(town.resources.coastal_boat || 0,0);assert.equal(v.status,'preparing');assert.equal(v.held,0);assert.equal(v.reached,undefined);check(g);
});

test('a saved crew stays occupied and a closed landing holds the actual vessel until the border opens',async t=>{
 const g=await game();t.after(g.close);const {w,town,target}=setup(g),v=start(w,town);launch(w,v);
 const rival=w.happen('Create',null,null,{x:target.x,y:target.y},'town');rival.pop=20;rival.jobs={farmer:20};rival.resources={crop:1000};target.v.s=rival.id;const landing=w.planet.chunks[`${v.target.x},${v.target.y}`];landing.v.s=rival.id;w.planet.embargoes=[{fromId:rival.id,toId:town.id}];
 next(w,3);assert.equal(v.status,'outbound');assert.equal(v.pause,'border');assert.equal(v.reached,undefined);assert.equal(v.held,1);assert.equal(town.resources.coastal_boat || 0,0);
 // A native loan offer also needs a free merchant. The actual merchant at
 // sea must not be offered as a banker while the vessel is away.
 assert.equal(v.role,'merchant');town.resources.cash=1000;town._paultendoLocalDiscoveries={'trade:40':{day:30,inquiry:'wick-bank'}};w.planet.unlocks.trade=40;life(w).inquiries.push({id:'crew-work',town:town.id,person:v.person,name:v.name,event:'unlockNavigation',title:'Navigation',key:'travel',level:70,cause:{role:v.role,text:'A test of the charts.',evidence:{}},day:w.planet.day,remaining:8,status:'working',cost:{lumber:1},steps:[]});next(w);const pending=life(w).inquiries.at(-1);assert.equal(pending.delay,'hands');assert.equal(pending.remaining,8);
 const restored=await makeGame({save:plain(w.generateSave())});t.after(restored.close);const rw=restored.window;quiet(rw);const copy=life(rw).seaVoyages.find(x=>x.id===v.id),rt=rw.regGet('town',town.id);assert.equal(copy.held,1);assert.equal(copy.position,v.position);rw.planet.embargoes=[];until(rw,copy,'returned');assert.equal(rt.resources.coastal_boat,1);assert.equal(copy.inputs[0].production.work,v.inputs[0].production.work);assert.deepEqual(restored.errors,[]);check(g);
});

test('the account supports local travel inquiry only after the crew returns, with no instant research award',async t=>{
 const g=await game();t.after(g.close);const {w,town}=setup(g),v=start(w,town);launch(w,v);until(w,v,'returning');w.planet.unlocks.travel=50;assert.equal(!!w.readyEvent('unlockSailingShips'),false);until(w,v,'returned');
 const caller=w.readyEvent('unlockSailingShips');assert.ok(caller);caller.args.value={town:town.id};w.doEvent('unlockSailingShips',caller);const inquiry=life(w).inquiries.at(-1);assert.equal(inquiry.status,'waiting');assert.equal(inquiry.cause.evidence.voyages[0],v.id);assert.equal(w.planet.unlocks.travel,50);assert.match(inquiry.cause.text,/crew is home/);next(w);assert.equal(inquiry.status,'working');until(w,inquiry,'learned');assert.equal(w.planet.unlocks.travel,60);assert.equal(town._paultendoLocalDiscoveries['travel:60'].inquiry,inquiry.id);check(g);
});

test('reading a crossing shows coloured flags and its builders without spending time, stock or randomness',async t=>{
 const g=await game();t.after(g.close);const {w,town}=setup(g),v=start(w,town),work=launch(w,v);const before=plain({day:w.planet.day,life:life(w),resources:town.resources,fog:w.planet._paultendoFog.explored});let draws=0;const rand=w.Math.random;w.Math.random=()=>{draws++;return rand();};open(w,v);assert.match(panel(w).textContent,/Crossing the water/);const flag=panel(w).querySelector('.font2');assert.ok(flag);assert.equal(flag.style.backgroundColor,'rgb(51, 68, 102)');click(w,'How the vessel was made');assert.match(panel(w).textContent,/Used 4 timber/);click(w,'Follow the vessel’s crossing');assert.match(panel(w).textContent,/until the crew comes home/);assert.equal(draws,0);assert.deepEqual(plain({day:w.planet.day,life:life(w),resources:town.resources,fog:w.planet._paultendoFog.explored}),before);w.Math.random=rand;assert.equal(work.status,'made');check(g);
});

test('full stores hold the returning vessel through reload and unloading happens exactly once',async t=>{
 const g=await game();t.after(g.close);const {w,town}=setup(g),v=start(w,town);launch(w,v);until(w,v,'unloading');town.resources.coastal_boat=w.$c.maxResource(town);next(w);assert.equal(v.status,'unloading');assert.equal(v.held,1);assert.equal(v.pause,'room');
 const restored=await makeGame({save:plain(w.generateSave())});t.after(restored.close);const rw=restored.window;quiet(rw);const rt=rw.regGet('town',town.id),copy=life(rw).seaVoyages.find(x=>x.id===v.id);rt.resources.coastal_boat=0;next(rw);assert.equal(copy.status,'returned');assert.equal(rt.resources.coastal_boat,1);next(rw);assert.equal(rt.resources.coastal_boat,1);assert.equal(rt._paultendoCommodityLots.coastal_boat.filter(l=>l.exchange===copy.id).reduce((sum,l)=>sum+l.count,0),1);assert.deepEqual(restored.errors,[]);check(g);
});

test('the loss of a home port loses the held vessel and creates no replacement or invented discovery',async t=>{
 const g=await game();t.after(g.close);const {w,town,other}=setup(g),v=start(w,town);launch(w,v);town.end=w.planet.day;next(w);assert.equal(v.status,'lost');assert.equal(v.lost,1);assert.equal(v.held,0);assert.equal(town.resources.coastal_boat || 0,0);assert.equal(w.planet._paultendoDiscovery.discovered.includes(other),false);check(g);
});

test('towns can prepare the same real crossing themselves and declining encouragement starts no work',async t=>{
 for(const accept of [false,true]){const g=await game();t.after(g.close);const {w,town}=setup(g),before=plain(town.resources),args={};assert.equal(w.gameEvents.discoveryExpedition.value(town,null,args),true);assert.equal(life(w).seaVoyages.length,0);
  if(accept){w.gameEvents.discoveryExpedition.func(town,null,args);assert.equal(args.success,true);assert.equal(life(w).seaVoyages.length,1);assert.equal(life(w).seaVoyages[0].status,'preparing');}else w.gameEvents.swayDiscoveryExpedition.funcNo(null,town,{});
  assert.deepEqual(plain(town.resources),before);assert.equal(w.planet._paultendoDiscovery.boost || 0,0);assert.equal(life(w).materialWork.length,0);check(g);
 }
});

test('the old sea-route proposal cannot invent a route, fixed travel time, goods or a relationship bonus',async t=>{
 const g=await game();t.after(g.close);const {w,town,target}=setup(g);const partner=w.happen('Create',null,null,{x:target.x,y:target.y},'town');partner.pop=30;partner.jobs={farmer:30};partner.resources={crop:1000};partner.influences.trade=20;
 const args={};assert.equal(w.gameEvents.establishSeaRoute.value(town,partner,args),true);const before=plain({routes:w.planet.tradeRoutes,resources:town.resources,relations:town.relations,influences:town.influences});args.choice='yes';w.gameEvents.establishSeaRoute.func(town,partner,args);assert.equal(args.success,true);assert.equal(life(w).seaVoyages.at(-1).status,'preparing');assert.deepEqual(plain({routes:w.planet.tradeRoutes,resources:town.resources,relations:town.relations,influences:town.influences}),before);check(g);
});

test('an unseen crew can return and learn without exposing its shore or name to the player',async t=>{
 const g=await game();t.after(g.close);const {w,town,other}=setup(g),v=start(w,town);launch(w,v);town._hidden=true;const fog=plain(w.planet._paultendoFog.explored),logs=w.document.querySelectorAll(`[data-story-id="${v.id}"]`).length;until(w,v,'returned');assert.deepEqual(plain(w.planet._paultendoFog.explored),fog);assert.equal(w.planet._paultendoDiscovery.discovered.includes(other),false);assert.equal(w.document.querySelectorAll(`[data-story-id="${v.id}"]`).length,logs);
 w.planet.unlocks.travel=50;const caller=w.readyEvent('unlockSailingShips');assert.ok(caller);assert.equal(caller.args.value.town,town.id);check(g);
});
