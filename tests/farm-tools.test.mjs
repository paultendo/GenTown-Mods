import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGame,settleGame} from './harness.mjs';
const native=new WeakMap(),plain=x=>JSON.parse(JSON.stringify(x));
const life=w=>w.planet._paultendoLife;
function quiet(w){for(const id of ['townFarm','townTame','townMine','townLumber','townEat','townBirth','townDeath','townExpand','townEmploy']){if(w.gameEvents[id].func)w.gameEvents[id].func=()=>{};if(w.gameEvents[id].perChunk)w.gameEvents[id].perChunk=()=>{};}w.gameEvents.processAll.func=()=>{};}
function setup(g){const w=g.window,town=settleGame(g);w.planet.day=10;town.name='Stonebank';town.pop=20;town.jobs={farmer:20};town.resources={crop:100};town.legal.farm=true;town._paultendoNextExchangeDay=9999;Object.assign(w.planet.unlocks,{smith:10,farm:10,trade:10});native.set(w,w.gameEvents.townFarm.func);quiet(w);return {w,town};}
function next(w){const choose=w.chooseEvent;w.chooseEvent=()=>null;try{w.nextDay();}finally{w.chooseEvent=choose;}}
function harvest(w,town,count=5){const random=w.Math.random;w.Math.random=()=>.999;try{native.get(w)(town,null,{value:count});}finally{w.Math.random=random;}}
function prime(w,town){for(let n=0;n<3;n++){w.planet.day++;harvest(w,town);}}
function add(w,town,type,count){w.happen('AddResource',null,town,{type,count});}
function work(w,town,type='stone_tools'){return life(w).materialWork.findLast(b=>b.town===town.id&&b.type===type);}
function finish(w,batch,farm){batch.roll=.99;for(let n=0;n<15&&['waiting','working'].includes(batch.status);n++){if(farm)harvest(w,farm);next(w);}assert.equal(batch.status,'made',JSON.stringify(batch));}
function tools(town){return (town._paultendoFarmTools?.sets || []).filter(s=>s.uses>0).reduce((n,s)=>n+Math.min(s.count,s.uses),0);}
function panel(w){return w.document.getElementById('actionSubList');}
function click(w,text){const b=[...panel(w).querySelectorAll('[role="button"]')].find(b=>b.textContent.includes(text));assert.ok(b,`${text}: ${panel(w).textContent}`);b.click();}
function fields(w,town){w.openRegBrowser(town,'town');[...w.document.querySelectorAll('.paultendoTownLife button')].find(b=>b.textContent==='Materials and workshops').click();click(w,'In the fields');}
function errors(g){assert.deepEqual(g.errors,[]);}

test('the effect of unfamiliar tools can intrigue a farmer without a mark, a teacher or knowledge of making them',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g);w.planet.unlocks.education=10;w.openRegBrowser(town,'town');[...w.document.querySelectorAll('.paultendoTownLife button')].find(b=>b.textContent==='Meet the people').click();town._paultendoPeople.find(p=>p.role==='farmer').outlook='curious';add(w,town,'metal_tools',20);prime(w,town);next(w);assert.equal(life(w).clues.length,0);assert.equal(tools(town),20);const before=town.resources.crop;harvest(w,town,5);assert.ok(town.resources.crop-before>5);const clue=life(w).clues[0];assert.ok(clue);assert.equal(clue.mark,undefined);assert.equal(clue.observation.kind,'fieldwork');assert.equal(clue.observation.type,'metal_tools');assert.ok(clue.observation.extra>0);assert.equal(clue.person,town._paultendoPeople.find(p=>p.role==='farmer').id);assert.equal(town._paultendoMaterials.metal_tools.technique,undefined);for(let i=0;i<6;i++)next(w);assert.equal(clue.study.status,'finished');assert.equal(clue.study.interpretation.prepared,false);assert.equal(w.planet.unlocks.smith,10);assert.ok(clue.study.teaching);harvest(w,town,20);assert.equal(life(w).clues.filter(c=>c.observation?.type==='metal_tools').length,1);
 const snapshot=plain({clue,resources:town.resources,knowledge:town._paultendoLocalDiscoveries,day:w.planet.day}),entry=w.document.querySelector(`[data-story-kind="clue"][data-story-id="${clue.id}"]`);assert.ok(entry);entry.querySelector('.paultendoChronicleStoryLink').click();assert.match(panel(w).textContent,/town does not know how to make them/);click(w,'Visit the fields');assert.deepEqual(plain({clue,resources:town.resources,knowledge:town._paultendoLocalDiscoveries,day:w.planet.day}),snapshot);const restored=await makeGame({save:plain(w.generateSave())});t.after(restored.close);assert.deepEqual(plain(life(restored.window).clues[0].study),plain(clue.study));errors(g);errors(restored);
});

test('tools need repeated actual field work, farmers and room for a harvest rather than a milestone or gift of stone',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g);add(w,town,'rock',4);next(w);assert.equal(work(w,town),undefined);prime(w,town);town.resources.crop=w.$c.maxResource(town);next(w);assert.equal(work(w,town),undefined);town.resources.crop=100;town.legal.farm=false;next(w);assert.equal(work(w,town),undefined);town.legal.farm=true;town.jobs={miner:20};next(w);assert.equal(work(w,town),undefined);assert.equal(town.resources.stone_tools,undefined);errors(g);
});

test('a farmer can shape real stone into handtools over work days and use them in real subsequent harvests',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g);prime(w,town);add(w,town,'rock',2);next(w);const batch=work(w,town);assert.ok(batch);assert.equal(batch.status,'waiting');next(w);assert.equal(town.resources.rock || 0,0);assert.equal(tools(town),0);finish(w,batch);assert.equal(tools(town),2);assert.equal(town.resources.stone_tools || 0,0);assert.equal(town._paultendoFarmTools.sets[0].inputs[0].production.work,batch.id);assert.equal(town._paultendoMaterials.stone_tools.technique.work,batch.id);
 const before=town.resources.crop,uses=town._paultendoFarmTools.sets[0].uses;for(let n=0;n<10;n++){w.planet.day++;harvest(w,town);}assert.equal(town.resources.crop-before,51);assert.equal(town._paultendoFarmTools.extra,1);assert.equal(town._paultendoFarmTools.sets[0].uses,uses-20);assert.equal(w.planet.unlocks.smith,10,'Local handtool practice does not grant the global Stone Tools milestone');errors(g);
});

test('failed tool shaping consumes inputs and its outcome survives native save recovery without producing gear',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g);prime(w,town);add(w,town,'rock',2);next(w);const batch=work(w,town);batch.roll=0;next(w);assert.equal(batch.status,'working');
 const restored=await makeGame({save:plain(w.generateSave())});t.after(restored.close);const rw=restored.window;quiet(rw);const rt=rw.regGet('town',town.id),copy=work(rw,rt);assert.equal(copy.roll,0);for(let n=0;n<4;n++)next(rw);assert.equal(copy.status,'failed');assert.equal(rt.resources.rock || 0,0);assert.equal(tools(rt),0);assert.equal(rt._paultendoMaterials?.stone_tools?.technique,undefined);assert.match(copy.steps.at(-1).text,/stone splits/);assert.doesNotMatch(copy.steps.at(-1).text,/fire/);errors(g);errors(restored);
});

test('toolmaking respects knowledge, meals and inputs, and unstarted work can lapse when farming stops',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g);prime(w,town);add(w,town,'rock',2);w.planet.unlocks.smith=0;next(w);assert.equal(work(w,town),undefined);w.planet.unlocks.smith=10;town.resources.crop=0;next(w);assert.equal(work(w,town),undefined);town.resources.crop=100;next(w);const batch=work(w,town);assert.ok(batch);town.resources.rock=0;next(w);assert.equal(batch.status,'waiting');town.legal.farm=false;next(w);assert.equal(batch.status,'withdrawn');assert.equal(tools(town),0);errors(g);
});

test('received handtools can be used without manufacturing mastery and only actual harvests wear them',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g);prime(w,town);add(w,town,'stone_tools',2);next(w);assert.equal(tools(town),2);assert.equal(town._paultendoMaterials.stone_tools.technique,undefined);const uses=town._paultendoFarmTools.sets[0].uses;
 for(let n=0;n<4;n++)next(w);assert.equal(town._paultendoFarmTools.sets[0].uses,uses);harvest(w,town,0);assert.equal(town._paultendoFarmTools.sets[0].uses,uses);town.legal.farm=false;harvest(w,town,10);assert.equal(town._paultendoFarmTools.sets[0].uses,uses);town.legal.farm=true;town.resources.crop=w.$c.maxResource(town);harvest(w,town,10);assert.equal(town._paultendoFarmTools.sets[0].uses,uses);town.resources.crop=100;harvest(w,town,10);assert.equal(town._paultendoFarmTools.sets[0].uses,uses-2);errors(g);
});

test('wear creates a replacement need, while fractional gains and remaining uses survive reload',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g);prime(w,town);add(w,town,'stone_tools',2);next(w);harvest(w,town,5);const store=town._paultendoFarmTools;assert.ok(store.credit>0);store.sets[0].uses=2;
 const restored=await makeGame({save:plain(w.generateSave())});t.after(restored.close);const rw=restored.window,rt=rw.regGet('town',town.id);native.set(rw,rw.gameEvents.townFarm.func);quiet(rw);assert.deepEqual(plain(rt._paultendoFarmTools),plain(store));harvest(rw,rt,5);assert.equal(tools(rt),0);assert.ok(rt._paultendoFarmTools.steps.some(s=>s.text.includes('worn out')));add(rw,rt,'rock',2);next(rw);assert.equal(work(rw,rt).type,'stone_tools');errors(g);errors(restored);
});

test('known steel can support better handtools without discarding usable stone or awarding stock at a discovery',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g);prime(w,town);add(w,town,'stone_tools',2);next(w);Object.assign(w.planet.unlocks,{smith:50,fire:50});add(w,town,'steel',2);next(w);const batch=work(w,town,'steel_tools');assert.ok(batch);assert.equal(batch.status,'waiting');finish(w,batch,town);assert.equal(town.resources.steel || 0,0);assert.equal(tools(town),4);const set=town._paultendoFarmTools.sets.find(s=>s.type==='steel_tools');assert.equal(set.uses,240);assert.ok(town._paultendoFarmTools.sets.find(s=>s.type==='stone_tools').uses>0);const stock=town.resources.steel_tools || 0;w.gameEvents.unlockSteel.func();assert.equal(town.resources.steel_tools || 0,stock);errors(g);
});

test('a real neighbour workshop delivers tools with their maker, paid inputs and navigable field use through reload',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town:seller}=setup(g);prime(w,seller);add(w,seller,'rock',2);next(w);finish(w,work(w,seller));w.planet.day+=8;seller.values={justice:6,openness:6};add(w,seller,'rock',2);
 const center=w.planet.chunks[seller.center.join(',')],chunk=w.filterChunks(c=>!c.v.s&&c.v.g===center.v.g&&c.b!=='water'&&c.b!=='mountain').sort((a,b)=>Math.hypot(a.x-center.x,a.y-center.y)-Math.hypot(b.x-center.x,b.y-center.y))[0],buyer=w.happen('Create',null,null,{x:chunk.x,y:chunk.y},'town');buyer.name='Wick';buyer.pop=20;buyer.jobs={farmer:20};buyer.resources={crop:100};buyer.legal.farm=true;buyer._paultendoNextExchangeDay=9999;prime(w,buyer);
 w.gameEvents.townMarketPurchase.func(buyer,null,{seller,goodsType:'stone_tools'});const exchange=life(w).exchanges.find(r=>r.buyer===buyer.id);assert.ok(exchange);
 for(let n=0;n<20&&!exchange.resolved;n++){harvest(w,buyer);next(w);}assert.equal(exchange.status,'arrived');assert.equal(exchange.delivered,2);assert.equal(tools(buyer),2);assert.equal(buyer._paultendoMaterials.stone_tools.technique,undefined);assert.equal(seller.resources.rock || 0,0);assert.equal(exchange.uses.find(u=>u.kind==='tools').count,2);const batch=life(w).materialWork.find(b=>b.id===exchange.manufacture.work);assert.equal(buyer._paultendoFarmTools.sets[0].inputs[0].production.work,batch.id);
 fields(w,buyer);click(w,'Visit the toolmaker');assert.match(panel(w).textContent,/Used 2 stone/);fields(w,buyer);click(w,'Follow the tools’ journey');assert.match(panel(w).textContent,/takes stone handtools from this exchange into its fields/);click(w,'Visit the fields');assert.match(panel(w).textContent,/handtools.*farmers/s);
 const restored=await makeGame({save:plain(w.generateSave())});t.after(restored.close);assert.equal(restored.window.regGet('town',buyer.id)._paultendoFarmTools.sets[0].inputs[0].production.work,batch.id);errors(g);errors(restored);
});

test('unseen farming settlements can manufacture and use tools without disclosing their identity',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g);town._hidden=true;prime(w,town);add(w,town,'rock',2);next(w);finish(w,work(w,town));harvest(w,town,20);assert.equal(tools(town),2);assert.equal([...w.document.querySelectorAll('.logMessage')].some(e=>e.dataset.storyKind==='tools'||e.dataset.storyId===work(w,town).id),false);errors(g);
});

function enemy(w,town){
 const c=w.planet.chunks[town.center.join(',')],at=w.filterChunks(x=>!x.v.s&&x.v.g===c.v.g&&x.b!=='water'&&x.b!=='mountain').sort((a,b)=>Math.hypot(a.x-c.x,a.y-c.y)-Math.hypot(b.x-c.x,b.y-c.y))[0];
 const rival=w.happen('Create',null,null,{x:at.x,y:at.y},'town');rival.name='Ridge';rival.pop=20;rival.jobs={soldier:10,farmer:10};rival.resources={crop:100};
 for(const owner of [town,rival]){const center=w.planet.chunks[owner.center.join(',')];for(const chunk of w.filterChunks(x=>!x.v.s&&x.v.g===center.v.g&&x.b!=='water'&&x.b!=='mountain').sort((a,b)=>Math.hypot(a.x-center.x,a.y-center.y)-Math.hypot(b.x-center.x,b.y-center.y)).slice(0,12)){chunk.v.s=owner.id;owner.size++;}w.happen('UpdateCenter',null,owner);}
 const war=w.happen('Create',rival,null,{type:'war',towns:[rival.id,town.id]},'process');war.sides=[[rival.id],[town.id]];war.start=w.planet.day;war._paultendoEarlyDuration=14;town.issues.war=rival.issues.war=war.id;return {rival,war};
}
function fight(w,war,roll=0){const random=w.Math.random;w.Math.random=()=>roll;try{w.metaEvents.processWar.func(war);}finally{w.Math.random=random;}}

test('working handtools defend an actual attack but do not equip an offensive army',async t=>{
 const outcomes=[];
 for(const type of [null,'stone_tools','metal_tools','steel_tools']){
  const g=await makeGame();t.after(g.close);const {w,town}=setup(g);prime(w,town);if(type){add(w,town,type,20);next(w);}w.planet.unlocks.military=10;
  const {rival,war}=enemy(w,town);rival._paultendoFarmTools=plain(town._paultendoFarmTools || {sets:[],steps:[]});const attackerTools=plain(rival._paultendoFarmTools);
  const size=town.size;fight(w,war);outcomes.push(size-town.size);
  assert.deepEqual(plain(rival._paultendoFarmTools),attackerTools,'Attackers get no offensive boost or tool wear');assert.equal(rival.jobs.soldier,10);assert.equal(town.jobs.soldier || 0,0);assert.equal(w.planet.unlocks.military,10);
  if(type){assert.equal(town._paultendoFarmTools.defences,1);assert.equal(town._paultendoFarmTools.sets[0].uses,20*({stone_tools:36,metal_tools:75,steel_tools:114}[type]));assert.equal(town.resources[type] || 0,0);}
  errors(g);
 }
 assert.ok(outcomes[0]>outcomes[1],JSON.stringify(outcomes));assert.ok(outcomes[1]>=outcomes[2],JSON.stringify(outcomes));assert.ok(outcomes[2]>=outcomes[3],JSON.stringify(outcomes));
});

test('war alone does not damage tools, while a real early skirmish spends working edges and preserves that damage through reload',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g);prime(w,town);add(w,town,'stone_tools',2);next(w);const {war}=enemy(w,town);const uses=town._paultendoFarmTools.sets[0].uses;fight(w,war,.999);assert.equal(town._paultendoFarmTools.sets[0].uses,uses);fight(w,war);assert.equal(town._paultendoFarmTools.sets[0].uses,uses-8);assert.equal(town._paultendoFarmTools.defences,1);
 const saved=plain(w.generateSave()),restored=await makeGame({save:saved});t.after(restored.close);assert.deepEqual(plain(restored.window.regGet('town',town.id)._paultendoFarmTools),plain(town._paultendoFarmTools));errors(g);errors(restored);
});

test('tools broken in defending a town cannot boost its next harvest',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g);prime(w,town);add(w,town,'stone_tools',2);next(w);town._paultendoFarmTools.sets[0].uses=2;const {war}=enemy(w,town);fight(w,war);assert.equal(tools(town),0);assert.match(town._paultendoFarmTools.steps.map(s=>s.text).join(' '),/breaks in the fighting/);const extra=town._paultendoFarmTools.extra;town.resources.crop=100;harvest(w,town,20);assert.equal(town._paultendoFarmTools.extra,extra);assert.equal(town.jobs.soldier || 0,0);errors(g);
});

test('metal handtools need actual metal and shaping knowledge, then complement usable stone with their own maker and wear',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g);prime(w,town);add(w,town,'stone_tools',2);next(w);Object.assign(w.planet.unlocks,{smith:30,fire:10});add(w,town,'metal',2);next(w);assert.equal(work(w,town,'metal_tools'),undefined);assert.equal(town.resources.metal,2);w.planet.unlocks.smith=40;harvest(w,town);next(w);const batch=work(w,town,'metal_tools');assert.ok(batch);finish(w,batch,town);assert.equal(batch.finished-batch.started,5);assert.equal(town.resources.metal || 0,0);assert.equal(tools(town),4);const set=town._paultendoFarmTools.sets.find(s=>s.type==='metal_tools');assert.equal(set.uses,160);assert.equal(set.inputs[0].production.work,batch.id);assert.ok(town._paultendoFarmTools.sets.find(s=>s.type==='stone_tools').uses>0);const before=set.uses;harvest(w,town,20);assert.equal(set.uses,before-2);assert.equal(w.planet.unlocks.smith,40);errors(g);
});

test('native Metal Tools knowledge awards no gear and available stone remains a real alternative while metal cannot yet be shaped',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g);prime(w,town);Object.assign(w.planet.unlocks,{smith:30,fire:10});add(w,town,'metal',2);add(w,town,'rock',2);next(w);const batch=work(w,town);assert.equal(batch.type,'stone_tools');finish(w,batch,town);assert.equal(tools(town),2);assert.equal(town.resources.metal,2);w.planet.unlocks.smith=40;next(w);assert.equal(town.resources.metal_tools,undefined,'The discovery has no manufactured output');assert.equal(work(w,town,'metal_tools'),undefined,'Actual finished work still has its recovery interval');w.planet.day+=8;prime(w,town);next(w);assert.equal(work(w,town,'metal_tools').status,'waiting');errors(g);
});

test('repeated successful toolmaking supplies an actual reason to teach, while a gift or unavailable maker supplies none',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g);town.jobs={farmer:10,miner:10};prime(w,town);add(w,town,'rock',4);next(w);finish(w,work(w,town));w.planet.day+=8;prime(w,town);next(w);finish(w,work(w,town));
 const random=w.Math.random;let proposals=[];try{for(let n=0;n<200;n++){w.Math.random=()=> (n+.5)/200;proposals.push(w.gameEvents.unlockLevel.value(w.regGet('player',1),town));}}finally{w.Math.random=random;}
 const education=proposals.find(p=>p.type==='education');assert.ok(education?.need);assert.match(education.need.text,/learned to make stone handtools.*teach others/);assert.equal(education.need.practice.length,2);
 for(const proof of education.need.practice){const made=life(w).materialWork.find(b=>b.id===proof.id);assert.equal(made.status,'made');assert.equal(made.person,proof.person);assert.equal(made.finished,proof.day);}
 assert.equal(w.planet.unlocks.education,undefined);const stocks=plain(town.resources),workCount=life(w).materialWork.length;assert.equal(proposals.some(p=>p.need?.practice?.some(x=>!life(w).materialWork.find(b=>b.id===x.id))),false);assert.deepEqual(plain(town.resources),stocks);assert.equal(life(w).materialWork.length,workCount);
 town.jobs={lumberer:20};proposals=[];try{for(let n=0;n<200;n++){w.Math.random=()=> (n+.5)/200;proposals.push(w.gameEvents.unlockLevel.value(w.regGet('player',1),town));}}finally{w.Math.random=random;}assert.equal(proposals.find(p=>p.type==='education')?.need,undefined,'The makers must still be available to teach');errors(g);
});
