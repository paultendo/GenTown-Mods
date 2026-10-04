import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGame,settleGame} from './harness.mjs';
const plain=x=>JSON.parse(JSON.stringify(x));
const life=w=>w.planet._paultendoLife;
const panel=w=>w.document.getElementById('actionSubList');
function quiet(w){for(const id of ['townFarm','townTame','townMine','townLumber','townBirth','townDeath','townExpand','townEmploy','townEat','townEconomyTick','townTax','doResearch'])if(w.gameEvents[id]){if(w.gameEvents[id].func)w.gameEvents[id].func=()=>{};if(w.gameEvents[id].perChunk)w.gameEvents[id].perChunk=()=>{};}w.gameEvents.processAll.func=()=>{};}
function next(w,n=1){const choose=w.chooseEvent;w.chooseEvent=()=>null;try{for(let i=0;i<n;i++)w.nextDay();}finally{w.chooseEvent=choose;}}
function add(w,town,type,count){w.happen('AddResource',null,town,{type,count});}
function people(w,town){w.openRegBrowser(town,'town');[...w.document.querySelectorAll('.paultendoTownLife button')].find(b=>b.textContent==='Meet the people').click();for(const p of town._paultendoPeople)p.outlook='curious';}
function pair(g){const w=g.window,a=settleGame(g);w.planet.day=30;const center=w.planet.chunks[a.center.join(',')],at=w.filterChunks(c=>!c.v.s&&c.v.g===center.v.g&&c.b!=='water'&&c.b!=='mountain').sort((x,y)=>Math.hypot(x.x-center.x,x.y-center.y)-Math.hypot(y.x-center.x,y.y-center.y))[0];const b=w.happen('Create',null,null,{x:at.x,y:at.y},'town');
 for(const [town,name] of [[a,'Claybank'],[b,'Farbank']]){town.name=name;town.pop=20;town.jobs={scholar:2,miner:4,farmer:14};town.resources={crop:1000};town.research={education:100};town.values={justice:6,openness:6};town._paultendoNextExchangeDay=99999;people(w,town);}b.research={military:100};a.relations[b.id]=5;b.relations[a.id]=5;Object.assign(w.planet.unlocks,{education:20,smith:20,fire:20,farm:10,trade:30});quiet(w);w.happen('Explore',null,null,{x:at.x,y:at.y});return {w,a,b};}
function start(w,town,event='unlockWriting'){const caller=w.readyEvent(event);assert.ok(caller,event);caller.args.value={town:town.id};assert.equal(w.gameEvents[event].check(caller.subject,caller.target,caller.args),true);w.doEvent(event,caller);const work=life(w).inquiries.at(-1);assert.equal(work.town,town.id);return work;}
function complete(w,work){for(let n=0;n<40&&['waiting','working'].includes(work.status);n++)next(w);assert.equal(work.status,'learned',JSON.stringify({work,resources:w.regGet('town',work.town).resources,material:life(w).materialWork,projects:w.regToArray('process')}));}
function ask(w,b,a){b.resources.crop=0;w.gameEvents.townMarketPurchase.func(b,null,{seller:a,goodsType:'crop'});const request=life(w).exchanges.find(r=>r.buyer===b.id&&!r.resolved);assert.ok(request);for(let n=0;n<15&&request.status!=='carrying';n++)next(w);assert.equal(request.status,'carrying',JSON.stringify(request));return request;}
function arrive(w,request){for(let n=0;n<30&&!request.resolved;n++)next(w);assert.equal(request.status,'arrived',JSON.stringify(request));assert.ok(request.delivered>0);}
function errors(g){assert.deepEqual(g.errors,[]);}


function shipment(w,b,a){const r=ask(w,b,a);arrive(w,r);return r;}
function trading(g){const state=pair(g),{w,a,b}=state;a.research=b.research={military:100};next(w,2);const first=shipment(w,b,a),second=shipment(w,b,a);return {...state,first,second};}

test('actual repeated trade raises a writing question without an education priority, while a single or undelivered exchange does not',async t=>{
 const g=await makeGame();t.after(g.close);const {w,a,b}=pair(g);a.research=b.research={military:100};next(w,2);assert.equal(w.readyEvent('unlockWriting'),undefined);const first=shipment(w,b,a);assert.equal(w.readyEvent('unlockWriting'),undefined);const second=ask(w,b,a);assert.equal(w.readyEvent('unlockWriting'),undefined);arrive(w,second);add(w,a,'clay',1);const work=start(w,a);assert.match(work.cause.text,/Goods keep changing hands/);assert.deepEqual(plain(work.cause.evidence.exchanges),[first.id,second.id]);assert.equal(work.status,'waiting');assert.equal(w.planet.unlocks.education,20);complete(w,work);assert.equal(a.resources.clay || 0,0);assert.equal(a._paultendoLocalDiscoveries['education:30'].inquiry,work.id);errors(g);
});

test('libraries need continued exchanges after local writing and their story links to the actual cargo',async t=>{
 const g=await makeGame();t.after(g.close);const {w,a,b}=trading(g);add(w,a,'clay',1);const writing=start(w,a);complete(w,writing);assert.equal(w.readyEvent('unlockLibraries'),undefined);shipment(w,b,a);assert.equal(w.readyEvent('unlockLibraries'),undefined);const second=shipment(w,b,a);/* The fuel maker also has a timber claim. */add(w,a,'lumber',4);const library=start(w,a,'unlockLibraries');assert.equal(library.cause.evidence.exchanges.length,2);assert.ok(library.cause.evidence.exchanges.includes(second.id));assert.match(library.cause.text,/The exchanges continue/);
 const entry=w.document.querySelector(`[data-story-id="${library.id}"]`);entry.querySelector('.paultendoChronicleStoryLink').click();const link=[...panel(w).querySelectorAll('[role="button"]')].find(e=>e.textContent.includes('exchange that raised the question'));assert.ok(link);const before=plain(library);link.click();assert.match(panel(w).textContent,/grain reach Farbank/);assert.deepEqual(plain(library),before);complete(w,library);assert.equal(w.planet.unlocks.education,40);assert.equal(a.resources.lumber || 0,0);errors(g);
});

test('an expired trade need or lost scholar cannot start record keeping, and unfinished supplies remain unspent',async t=>{
 for(const reason of ['old','hands']){const g=await makeGame();t.after(g.close);const {w,a,b}=trading(g);add(w,a,'clay',1);if(reason==='old')w.planet.day+=91;else {a.jobs.scholar=0;b.jobs.scholar=0;}assert.equal(w.readyEvent('unlockWriting'),undefined);assert.equal(a.resources.clay,1);assert.equal(life(w).inquiries.length,0);errors(g);}
});

test('real observations can raise a scientific question while a different branch is the research priority',async t=>{
 const g=await makeGame();t.after(g.close);const {w,a,b}=pair(g);a.research=b.research={military:100};w.planet.unlocks.education=60;assert.equal(w.readyEvent('unlockScientificMethod'),undefined);
 // Saved outcomes represent two different workshop attempts.
 life(w).materialWork.push({id:'failed-glass',town:a.id,type:'glass',status:'failed',finished:w.planet.day-1},{id:'made-steel',town:a.id,type:'steel',status:'made',finished:w.planet.day});const work=start(w,a,'unlockScientificMethod');assert.deepEqual(plain(work.cause.evidence.practice).map(e=>e.id),['failed-glass','made-steel']);assert.match(work.cause.text,/experiments and observations to compare/);assert.equal(work.status,'waiting');assert.equal(w.planet.unlocks.education,60);errors(g);
});

function medicine(g){const state=pair(g),{w,a,b}=state;w.planet.unlocks.education=70;for(const town of [a,b]){town.jobs={doctor:1,farmer:19};town.influences.disease=3;town.research={farm:100};}add(w,a,'glass',1);add(w,a,'charcoal',2);const work=start(w,a,'unlockMedicine');complete(w,work);return {...state,work};}

test('local medical trials improve actual healing and outbreak survival without curing a distant town',async t=>{
 const g=await makeGame();t.after(g.close);const {w,a,b,work}=medicine(g);assert.equal(w.planet.unlocks.education,80);assert.equal(a._paultendoLocalDiscoveries['education:80'].inquiry,work.id);assert.equal(b._paultendoLocalDiscoveries,undefined);const recoveries=[];
 for(const town of [a,b]){town.pop=2000;town.injuries=1000;const random=w.Math.random;w.Math.random=()=>.99;try{w.gameEvents.hospitalHealing.func(town,null,{});}finally{w.Math.random=random;}recoveries.push(1000-town.injuries);}
 assert.deepEqual(recoveries,[170,70]);for(const town of [a,b]){town.pop=2000;town.influences.education=0;town.influences.faith=0;}w.planet.epidemics=[{id:1,name:'Fixture fever',severity:5,affectedTowns:[a.id,b.id]}];const deaths=[];
 for(const town of [a,b]){w.gameEvents.epidemicDeaths.func(town,null,{});deaths.push(2000-town.pop);}assert.deepEqual(deaths,[42,46]);assert.equal(b._paultendoLocalDiscoveries,undefined);errors(g);
});

test('a distant library cannot enable the town’s medical and cultural proposals, while older shared libraries still do',async t=>{
 const g=await makeGame();t.after(g.close);const {w,a,b}=pair(g);Object.assign(w.planet.unlocks,{education:40,smith:20});w.planet._paultendoLocalKnowledge={'education:40':{key:'education',level:40,before:30}};a._paultendoLocalDiscoveries={'education:40':{day:30,inquiry:'local-library'}};for(const town of [a,b]){town.pop=120;town.influences.faith=1;}
 for(const id of ['establishHealthcare','swayBuildHospital','swayBuildMuseum']){const event=w.gameEvents[id];assert.equal(event.value(w.regGet('player',1),a,{}),true,id);assert.equal(event.value(w.regGet('player',1),b,{}),false,id);}
 const restored=await makeGame({save:plain(w.generateSave())});t.after(restored.close);const rw=restored.window;assert.equal(rw.gameEvents.establishHealthcare.value(rw.regGet('player',1),rw.regGet('town',b.id),{}),false);delete rw.planet._paultendoLocalKnowledge;assert.equal(rw.gameEvents.establishHealthcare.value(rw.regGet('player',1),rw.regGet('town',b.id),{}),true);errors(g);errors(restored);
});

test('local writing constrains inherited memory distortion without erasing the old grievance or granting remote protection',async t=>{
 const g=await makeGame();t.after(g.close);const {w,a,b}=pair(g);add(w,a,'clay',1);const writing=start(w,a);complete(w,writing);for(const town of [a,b]){town.influences.education=0;town.influences.faith=0;town.memory.grudges={'99':{severity:3,lastDay:w.planet.day}};town.memory.bonds={};}
 const random=w.Math.random;w.Math.random=()=>.01;try{w.gameEvents.memoryDistortion.func(a);w.gameEvents.memoryDistortion.func(b);}finally{w.Math.random=random;}assert.equal(a.memory.grudges[99].distortion,undefined);assert.equal(a.memory.grudges[99].severity,3);assert.notEqual(b.memory.grudges[99].distortion,undefined);assert.equal(b._paultendoLocalDiscoveries,undefined);errors(g);
});
