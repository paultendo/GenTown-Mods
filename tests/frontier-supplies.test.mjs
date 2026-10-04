import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGame,settleGame} from './harness.mjs';
const plain=x=>JSON.parse(JSON.stringify(x));
const registry=w=>w._paultendoUniverse._paultendoColonization;
function quiet(w){for(const id of ['townFarm','townTame','townMine','townLumber','townEat','townBirth','townDeath','townExpand','townEmploy','townPay','townTax']){if(w.gameEvents[id].func)w.gameEvents[id].func=()=>{};if(w.gameEvents[id].perChunk)w.gameEvents[id].perChunk=()=>{};}w.gameEvents.processAll.func=()=>{};}
function setup(g){const w=g.window,town=settleGame(g);w.planet.day=80;town.name='Homebank';town.pop=100;town.jobs={scholar:15,miner:15,farmer:40};town.resources={crop:800,lumber:20,rock:20,metal:20};town.influences.trade=5;town.wealth=90;town.research={farm:10};town._paultendoNextExchangeDay=9999;Object.assign(w.planet.unlocks,{education:70,smith:80,fire:70,travel:110,astronomy:20,trade:10,farm:10});quiet(w);return {w,town};}
function next(w){const choose=w.chooseEvent;w.chooseEvent=()=>null;try{w.nextDay();}finally{w.chooseEvent=choose;}}
function panel(w){return w.document.getElementById('actionSubList');}
function click(w,text){const b=[...panel(w).querySelectorAll('[role="button"]')].find(b=>b.textContent.includes(text));assert.ok(b,`Missing ${text}: ${panel(w).textContent}`);b.click();}
function solar(w){w.document.getElementById('actionItem-solar').click();}
function reach(w,id=2){const world=w._paultendoUniverse.worlds[id];world.discovered=true;world.reached=true;solar(w);w.document.querySelector(`[data-world-id="${id}"]`).click();click(w,'Switch to world');quiet(w);solar(w);w.document.querySelector('[data-world-id="1"]').click();click(w,'Switch to world');return world;}
function start(w,town){const e=w.gameEvents.frontierCharterPrompt,args={};assert.equal(e.value(town,null,args),true);e.func(town,null,args);return registry(w).charters.at(-1);}
function outfit(w,town){for(const [type,count] of Object.entries({colony_vessel:1,metal_tools:2}))w.happen('AddResource',null,town,{type,count});}
function launch(w,town){const charter=start(w,town);outfit(w,town);for(let n=0;n<3;n++)next(w);assert.equal(charter.stage,'enroute');return charter;}
function totalFood(town){return (town.resources.crop || 0)+(town.resources.livestock || 0);}
function errors(g){assert.deepEqual(g.errors,[]);}

test('a chart or a date grants no colony, and a real reached destination removes the arbitrary day gate',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g),event=w.gameEvents.frontierCharterPrompt;
 w._paultendoUniverse.worlds[2].discovered=true;w.planet.day=2000;assert.equal(event.value(town,null,{}),false);w.planet.day=80;reach(w);w.planet.unlocks.smith=79;assert.equal(event.value(town,null,{}),false);w.planet.unlocks.smith=80;
 const charter=start(w,town);assert.equal(charter.createdDay,80);assert.equal(charter.stage,'preparing');const old=plain(town.resources);for(let n=0;n<8;n++)next(w);assert.equal(charter.stage,'preparing');assert.equal(town.pop,100);assert.equal(town.wealth,90);assert.equal(town.resources.colony_vessel || 0,0);assert.ok(totalFood(town)<=totalFood({resources:old}));assert.doesNotMatch(w.document.getElementById('logMessages').textContent,/Supplies are sealed|test hulls and charts/);errors(g);
});

test('real stocks, jobs and people move once, travel eats provisions, and founding creates no free cargo or casualties',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g),target=reach(w),charter=launch(w,town),jobs=plain(town.jobs),food=totalFood(town),departed=charter.emigrants;
 assert.equal(town.pop,100-departed);assert.equal(charter.emigrants,6);assert.equal(town.resources.colony_vessel || 0,0);assert.equal(town.resources.lumber,20-charter.packed.lumber-w.planet._paultendoLife.materialWork.filter(x=>x.started).reduce((n,x)=>n+(x.cost.lumber || 0),0));assert.equal(town.resources.rock,14);assert.equal(town.resources.metal_tools || 0,0);assert.equal(town.wealth+charter.wealth,90);assert.deepEqual(plain(Object.fromEntries(Object.keys(jobs).map(k=>[k,jobs[k]+(charter.jobs[k] || 0)]))),{scholar:15,miner:15,farmer:40});
 const packed=plain(charter.cargo),arrival=charter.arrivalDay;for(let n=0;n<charter.travelDays-1;n++)next(w);assert.equal(registry(w).history.length,0);assert.equal(charter.mealsEaten,charter.dailyMeals*(charter.travelDays-1));next(w);const done=registry(w).history.at(-1),colony=target.state.planet.reg.town[done.colony.townId];assert.equal(w.planet.day,arrival);assert.equal(done.stage,'completed');assert.equal(colony.pop,departed);assert.equal(town.pop+colony.pop,100);assert.deepEqual(plain(colony.jobs),plain(charter.jobs));assert.equal(totalFood(colony),packed.crop-(charter.dailyMeals*charter.travelDays));assert.equal(colony.resources.lumber,12);assert.equal(colony.resources.rock,6);assert.equal(colony.resources.metal_tools,2);assert.equal(town.wealth+colony.wealth,90);assert.equal(totalFood(town),food);assert.equal(registry(w).charters.length,0);assert.equal(w._paultendoUniverse.spaceRoutes.length,0);const before=plain(done);next(w);assert.deepEqual(plain(registry(w).history.at(-1)),before);errors(g);
});

test('hunger, war, missing workers and competing work pause loading without taking any stock',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g);reach(w);const charter=start(w,town);outfit(w,town);town.resources.crop=charter.dailyMeals*(charter.travelDays+14);next(w);assert.equal(charter.pause,'food');assert.equal(charter.loading,0);assert.equal(town.resources.colony_vessel,1);
 town.resources.crop=800;town.jobs={farmer:70};next(w);assert.equal(charter.pause,'hands');assert.equal(charter.loading,0);town.jobs={farmer:40,miner:30};const at=w.filterChunks(c=>!c.v.s&&c.b!=='water'&&c.b!=='mountain')[0],rival=w.happen('Create',null,null,{x:at.x,y:at.y},'town'),war=w.happen('Create',town,null,{type:'war',towns:[town.id,rival.id]},'process');town.issues.war=war.id;next(w);assert.equal(charter.pause,'war');war.end=true;delete town.issues.war;
 next(w);assert.equal(charter.loading,1);town.resources.colony_vessel=0;next(w);assert.equal(charter.pause,'supplies');assert.equal(charter.loading,1);assert.equal(town.pop,100);town.resources.colony_vessel=1;next(w);next(w);assert.equal(charter.stage,'enroute');assert.equal(town.pop,94);errors(g);
});

test('charter demand drives a real passenger conversion and retains its original sky vessel maker through reload',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g);reach(w);const charter=start(w,town);town._paultendoMaterials={sky_vessel:{technique:{person:'old',work:'probe-hull',day:70}}};
 const production={work:'probe-hull',world:1,passage:w.planet._paultendoLife.passage,town:town.id,townName:town.name,known:true,person:'old',name:'Oldmaker',day:70,cost:{steel:8,glass:2,charcoal:4},output:1};
 // Use the actual passage identity already present in other production records.
 production.passage=0;
 w.planet._paultendoLife.materialWork.push({id:'probe-hull',town:town.id,type:'sky_vessel',person:'old',name:'Oldmaker',day:58,status:'made',finished:70,cost:production.cost,inputs:[],steps:[],output:1});
 town.resources.sky_vessel=1;town._paultendoCommodityLots={sky_vessel:[{from:town.id,count:1,production}]};town.resources.steel=4;town.resources.glass=2;town.resources.metal_tools=2;
 let work;for(let n=0;n<20&&!work;n++){next(w);work=w.planet._paultendoLife.materialWork.findLast(x=>x.type==='colony_vessel');}assert.ok(work);work.roll=.99;for(let n=0;n<20&&work.status!=='made';n++)next(w);assert.equal(work.status,'made');assert.equal(town.resources.sky_vessel || 0,0);assert.equal(town.resources.steel || 0,0);assert.equal(town.resources.glass || 0,0);for(let n=0;n<3&&charter.stage!=='enroute';n++)next(w);assert.equal(charter.stage,'enroute');assert.equal(charter.inputs.find(i=>i.type==='colony_vessel').production.work,work.id);assert.equal(charter.workshops.some(x=>x.id==='probe-hull'),true);
 const restored=await makeGame({save:plain(w.generateSave())});t.after(restored.close);assert.deepEqual(plain(registry(restored.window).charters[0].workshops),plain(charter.workshops));errors(g);errors(restored);
});

test('save recovery preserves loading and cargo and a launched cohort survives loss of its home',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g),target=reach(w),charter=start(w,town);outfit(w,town);next(w);const restored=await makeGame({save:plain(w.generateSave())});t.after(restored.close);const rw=restored.window;quiet(rw);const copy=registry(rw).charters[0],rt=rw.regGet('town',town.id);assert.equal(copy.loading,1);next(rw);next(rw);assert.equal(copy.stage,'enroute');rt.end=true;rt.pop=0;for(let n=0;n<copy.travelDays;n++)next(rw);assert.equal(registry(rw).history.at(-1).stage,'completed');assert.equal(target.state.planet.reg.town._id,1,'Restored world state is separate from the source fixture');assert.equal(registry(rw).history.at(-1).emigrants,6);errors(g);errors(restored);
});

test('a hidden town can prepare a colony without revealing its name or a Chronicle link',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g);reach(w);town._hidden=true;town.name='Secret Haven';const charter=start(w,town);outfit(w,town);for(let n=0;n<3;n++)next(w);assert.equal(charter.stage,'enroute');assert.doesNotMatch([...w.document.querySelectorAll('.logEntry')].filter(e=>/settlers|passenger vessel|colony preparations/.test(e.textContent)).map(e=>e.textContent).join(' '),/Secret Haven/);assert.equal(w.document.querySelector('[data-story-kind="charter"]'),null);solar(w);assert.doesNotMatch(panel(w).textContent,/Secret Haven/);errors(g);
});


test('contested landing causes a real return journey with food spent and people restored once',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g),target=reach(w),charter=launch(w,town),homePop=town.pop;
 for(const chunk of Object.values(target.state.planet.chunks))if(chunk.b!=='water'&&chunk.b!=='mountain')chunk.v.s=999;
 for(let n=0;n<charter.travelDays;n++)next(w);assert.equal(charter.stage,'returning');assert.equal(town.pop,homePop);const cargo=plain(charter.cargo);for(let n=0;n<charter.travelDays;n++)next(w);const done=registry(w).history.at(-1);assert.equal(done.stage,'returned');assert.equal(done.mealsEaten,done.dailyMeals*done.travelDays*2);assert.equal(town.pop,100);assert.equal(town.wealth,90);assert.equal(done.cargo.crop,0);assert.equal(done.packed.crop-done.mealsEaten,cargo.crop-done.dailyMeals*done.travelDays);const before=town.pop;next(w);assert.equal(town.pop,before);errors(g);
});

test('an already launched legacy charter arrives without invented vessel or cargo receipts',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g),target=reach(w);registry(w).charters.push({id:91,originWorldId:1,originTownId:town.id,originName:town.name,targetWorldId:2,targetName:target.name,motive:'trade',motiveLabel:'trade',createdDay:60,launchDay:70,arrivalDay:81,emigrants:7,stage:'enroute'});town.pop=93;next(w);const done=registry(w).history.at(-1),colony=target.state.planet.reg.town[done.colony.townId];assert.equal(colony.pop,7);assert.equal(Object.values(colony.resources).reduce((n,x)=>n+x,0),0);assert.equal(done.supplyVersion,undefined);assert.equal(done.inputs,undefined);assert.equal(town.pop+colony.pop,100);errors(g);
});

test('a town without crowding, unrest, a creed, prestige or trading interest has no invented colonial motive',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g);reach(w);town.size=100;town.influences.trade=0;town.influences.faith=10;town.unrest=0;town.prestige=0;delete town.religion;assert.equal(w.gameEvents.frontierCharterPrompt.value(town,null,{}),false);town._paultendoWarRefugeeDay=w.planet.day-31;assert.equal(w.gameEvents.frontierCharterPrompt.value(town,null,{}),false);town._paultendoWarRefugeeDay=w.planet.day-2;assert.equal(w.gameEvents.frontierCharterPrompt.value(town,null,{}),true);errors(g);
});


test('the cohort carries actual worker knowledge, beliefs and priorities instead of restarting as strangers',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g),target=reach(w);town.jobs={farmer:94,miner:3,scholar:3};town.values={justice:4,openness:-3};town.research={farm:10,education:2};town.influences.faith=6;w.planet.religions.push({id:1,name:'Lantern Path',archetype:'animism',foundingTown:town.id,founded:60,influences:{faith:1},tenets:['insular','trade'],tenetNames:['Insular','Trade'],practices:'offerings',deityType:'spirits',followers:[town.id],parent:null,reformed:false,extinct:false,cohesion:60});town.religion=1;
 const charter=launch(w,town);assert.ok(charter.jobs.farmer>0);assert.equal(charter.knowledge.farm,10);assert.equal(charter.knowledge.travel,110);if(!charter.jobs.scholar)assert.equal(charter.knowledge.education,undefined);assert.equal(charter.creed.data.name,'Lantern Path');town.values.justice=-6;
 for(let n=0;n<charter.travelDays;n++)next(w);const done=registry(w).history.at(-1),colony=target.state.planet.reg.town[done.colony.townId];assert.equal(colony.values.justice,charter.values.justice);assert.deepEqual(plain(colony.research),plain(charter.research));assert.equal(target.state.planet.unlocks.farm,10);assert.equal(target.state.planet.religions.find(r=>r.id===colony.religion).name,'Lantern Path');assert.deepEqual(plain(target.state.planet.religions.find(r=>r.id===colony.religion).tenets),['insular','trade']);errors(g);
});

test('arriving colonists retain their advances without teaching every existing town on that world',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g),target=reach(w);
 solar(w);w.document.querySelector('[data-world-id="2"]').click();click(w,'Switch to world');
 w.planet.unlocks.travel=20;const c=w.filterChunks(c=>c.b!=='water'&&c.b!=='mountain')[0],neighbour=w.happen('Create',null,null,{x:c.x,y:c.y},'town');neighbour.pop=20;neighbour.jobs={scholar:5,farmer:15};neighbour.resources={crop:1000};
 solar(w);w.document.querySelector('[data-world-id="1"]').click();click(w,'Switch to world');const charter=launch(w,town);for(let n=0;n<charter.travelDays;n++)next(w);
 const done=registry(w).history.at(-1),colony=target.state.planet.reg.town[done.colony.townId];assert.equal(target.state.planet.unlocks.travel,110);assert.ok(colony._paultendoLocalDiscoveries['travel:110']);assert.equal(colony._paultendoLocalDiscoveries['travel:110'].charter,charter.id);assert.equal(neighbour._paultendoLocalDiscoveries?.['travel:110'],undefined);assert.equal(target.state.planet._paultendoLocalKnowledge['travel:110'].before,20);
 solar(w);w.document.querySelector('[data-world-id="2"]').click();click(w,'Switch to world');assert.equal(w.gameEvents.frontierCharterPrompt.value(neighbour,null,{}),false);errors(g);
});
