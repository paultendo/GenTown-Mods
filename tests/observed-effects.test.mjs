import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGame,settleGame} from './harness.mjs';
const plain=x=>JSON.parse(JSON.stringify(x)),native=new WeakMap(),life=w=>w.planet._paultendoLife;
function quiet(w,{accounts=false}={}) {
 native.set(w,w.gameEvents.townFarm.func);
 for(const [id,event] of Object.entries(w.dailyEvents))if(!accounts||id!=='townKeepAccounts'){if(event.func)event.func=()=>{};if(event.perChunk)event.perChunk=()=>{};}
}
function next(w,n=1){const choose=w.chooseEvent;w.chooseEvent=()=>null;try{for(let i=0;i<n;i++)w.nextDay();}finally{w.chooseEvent=choose;}}
function harvest(w,town,count){const random=w.Math.random;w.Math.random=()=>.99;try{native.get(w)(town,null,{value:count});}finally{w.Math.random=random;}}
function add(w,town,type,count){w.happen('AddResource',null,town,{type,count});}
function meet(w,town){w.openRegBrowser(town,'town');[...w.document.querySelectorAll('.paultendoTownLife button')].find(b=>b.textContent==='Meet the people').click();for(const p of town._paultendoPeople)p.outlook='curious';}
function panel(w){return w.document.getElementById('actionSubList');}
function click(w,text){const b=[...panel(w).querySelectorAll('[role="button"]')].find(e=>e.textContent.includes(text));assert.ok(b,`${text}: ${panel(w).textContent}`);b.click();}
function observed(w,town){w.openRegBrowser(town,'town');[...w.document.querySelectorAll('.paultendoTownLife button')].find(b=>b.textContent==='Things people noticed').click();}
async function storage(t){const g=await makeGame();t.after(g.close);const w=g.window,town=settleGame(g);w.planet.day=20;
 Object.assign(w.planet.unlocks,{fire:10,smith:10,education:10,farm:10,trade:30});Object.assign(town,{name:'Claybank',start:1,pop:20,jobs:{farmer:20},resources:{crop:w.$c.maxResource(town)},research:{},_paultendoNextExchangeDay:99999});town.legal.farm=true;quiet(w);meet(w,town);
 harvest(w,town,8);add(w,town,'pottery',1);next(w);assert.equal(town._paultendoGrainStore.vessels.length,1);return {g,w,town};}
async function accounts(t,{prior=true}={}){const g=await makeGame();t.after(g.close);const w=g.window,town=settleGame(g);w.planet.day=80;
 Object.assign(w.planet.unlocks,{education:30,government:30,trade:30,smith:10,fire:0});Object.assign(town,{name:'Farbank',start:1,pop:40,jobs:{merchant:20,lumberer:20},resources:{crop:1000,cash:100,lumber:5},research:{},values:{openness:0,order:0,justice:0},_paultendoNextExchangeDay:99999});quiet(w,{accounts:true});meet(w,town);
 if(prior){for(let i=0;i<15&&!town._paultendoAccounts?.reports.length;i++)next(w);assert.equal(town._paultendoAccounts.reports[0].medium,'lumber');assert.equal(town._paultendoAccounts.paid,false);town._paultendoPeople.find(p=>p.role==='merchant').outlook='curious';}return {g,w,town};}

test('imported vessels raise a question only after keeping real harvest grain beyond the old stores',async t=>{
 const {g,w,town}=await storage(t),cap=w.$c.maxResource(town);assert.equal(life(w).clues.length,0);assert.equal(town.resources.crop,cap);
 harvest(w,town,8);const clue=life(w).clues[0];assert.equal(clue.observation.kind,'storage');assert.equal(clue.observation.extra,8);assert.equal(clue.observation.vessels[0].id,town._paultendoGrainStore.vessels[0].id);assert.equal(clue.person,town._paultendoPeople.find(p=>p.role==='farmer').id);
 assert.equal(town.resources.crop,cap+8);assert.equal(town._paultendoMaterials.pottery.technique,undefined);next(w,6);assert.equal(clue.study.status,'finished');assert.equal(clue.study.interpretation.prepared,false);assert.match(clue.study.steps[0].text,/clay vessels/);assert.doesNotMatch(clue.study.steps.map(s=>s.text).join(' '),/handtools|carved/);assert.ok(clue.study.teaching);assert.equal(w.planet.unlocks.fire,10);
 observed(w,town);click(w,'Clay Vessels');const snapshot=plain({clue,resources:town.resources,day:w.planet.day});assert.match(panel(w).textContent,/does not know how to make these vessels/);click(w,'What came');click(w,'What caught');click(w,'Visit the grain stores');assert.deepEqual(plain({clue,resources:town.resources,day:w.planet.day}),snapshot);
 const reload=await makeGame({save:plain(w.generateSave())});t.after(reload.close);assert.deepEqual(plain(life(reload.window).clues[0]),plain(clue));assert.deepEqual(g.errors,[]);assert.deepEqual(reload.errors,[]);
});

test('a cargo delivery and a full store are not proof of a harvest effect, and repeated harvests cannot duplicate it',async t=>{
 const {g,w,town}=await storage(t),cap=w.$c.maxResource(town);add(w,town,'crop',8);assert.equal(town.resources.crop,cap+8);assert.equal(life(w).clues.length,0);harvest(w,town,8);assert.equal(life(w).clues.length,0);
 town.resources.crop=cap-4;harvest(w,town,8);assert.equal(life(w).clues[0].observation.extra,4);const saved=plain(life(w).clues[0]);town.resources.crop=cap;harvest(w,town,8);assert.equal(life(w).clues.length,1);assert.deepEqual(plain(life(w).clues[0]),saved);assert.deepEqual(g.errors,[]);
});

test('local production knowledge and a lost observer prevent an invented unfamiliar vessel clue',async t=>{
 for(const known of [false,true]){const {g,w,town}=await storage(t);if(known){const farmer=town._paultendoPeople.find(p=>p.role==='farmer');town._paultendoMaterials.pottery.technique={person:farmer.id,day:19,work:'fixture-local-pottery'};}else town.jobs={lumberer:20};
 harvest(w,town,8);assert.equal(life(w).clues.length,0);assert.deepEqual(g.errors,[]);}
});

test('the first actual account entry on unfamiliar sheets raises a question without teaching papermaking',async t=>{
 const {g,w,town}=await accounts(t);add(w,town,'paper',1);assert.equal(life(w).clues.length,0);next(w);town._paultendoPeople.find(p=>p.role==='merchant').outlook='curious';assert.equal(town._paultendoAccounts.medium,'paper');assert.equal(town.resources.paper || 0,0);assert.equal(life(w).clues.length,1,'This evening recorded an actual entry after the previous completed book');
 const clue=life(w).clues[0];assert.equal(clue.observation.kind,'records');assert.equal(clue.observation.work,town._paultendoAccounts.work);assert.equal(clue.person,town._paultendoAccounts.keeper.person);assert.ok(clue.observation.alternatives.every(c=>c.score<clue.observation.score));assert.equal(town._paultendoMaterials.paper.technique,undefined);next(w,6);assert.equal(clue.study.status,'finished');assert.match(clue.study.steps[0].text,/paper/);assert.doesNotMatch(clue.study.steps.map(s=>s.text).join(' '),/handtools|carved/);assert.equal(w.planet.unlocks.smith,10);
 observed(w,town);click(w,'Paper');const snapshot=plain({clue,book:town._paultendoAccounts,resources:town.resources});click(w,'Visit the town’s accounts');assert.deepEqual(plain({clue,book:town._paultendoAccounts,resources:town.resources}),snapshot);assert.deepEqual(g.errors,[]);
});

test('accounts interrupted before a real entry and words on familiar timber supply no unfamiliar sheet effect',async t=>{
 const {g,w,town}=await accounts(t);add(w,town,'paper',1);town.resources.crop=0;next(w,2);assert.equal(life(w).clues.length,0);town.resources.crop=1000;next(w);assert.equal(life(w).clues.length,0);next(w);assert.equal(life(w).clues.length,1);
 const second=await accounts(t);next(second.w,6);assert.equal(second.town._paultendoAccounts.medium,'lumber');assert.equal(life(second.w).clues.length,0);assert.deepEqual(g.errors,[]);assert.deepEqual(second.g.errors,[]);
});

test('a first paper book cannot invent a comparison with wooden records that were never made',async t=>{
 const {g,w,town}=await accounts(t,{prior:false});add(w,town,'paper',1);next(w,3);assert.equal(town._paultendoAccounts.medium,'paper');assert.ok(town._paultendoAccounts.entries.length>0);assert.equal(life(w).clues.length,0);assert.deepEqual(g.errors,[]);
});

test('a remembered sheet effect can feed a later paid trial without replacing its need, costs, time or uncertainty',async t=>{
 const {g,w,town}=await accounts(t);add(w,town,'paper',1);next(w);town._paultendoPeople.find(p=>p.role==='merchant').outlook='curious';next(w,7);const clue=life(w).clues[0];assert.equal(clue.study.status,'finished');assert.equal(life(w).materialWork.some(x=>x.type==='paper'),false);
 w.planet.unlocks.smith=20;next(w);const work=life(w).materialWork.find(x=>x.type==='paper');assert.ok(work);assert.equal(work.clue,clue.id);assert.equal(clue.workshops[0],work.id);assert.equal(work.remaining,5);assert.equal(work.trial,true);work.roll=.99;const lumber=town.resources.lumber;next(w);assert.equal(work.status,'working');assert.equal(town.resources.lumber,lumber-1);assert.equal(work.remaining,5);next(w,5);assert.equal(work.status,'made');assert.equal(work.finished-work.started,5);assert.equal(town._paultendoMaterials.paper.technique.work,work.id);
 observed(w,town);click(w,'Paper');click(w,'Their attempt');assert.match(panel(w).textContent,/Used 1 timber/);click(w,'What caught');assert.match(panel(w).textContent,/thin sheets/);const state=plain({clue,work,resources:town.resources,day:w.planet.day});observed(w,town);click(w,'Paper');assert.deepEqual(plain({clue,work,resources:town.resources,day:w.planet.day}),state);assert.deepEqual(g.errors,[]);
});

test('unknown local teaching knowledge cannot be borrowed from the planet’s shared milestone by an observer',async t=>{
 const {g,w,town}=await storage(t);w.planet._paultendoLocalKnowledge={'education:10':{key:'education',level:10,before:0}};harvest(w,town,8);next(w,6);const clue=life(w).clues[0];assert.equal(clue.study.status,'finished');assert.equal(clue.study.teaching,undefined);assert.equal(life(w).teachings.length,0);assert.equal(w.planet.unlocks.education,10);assert.deepEqual(g.errors,[]);
});

test('unseen observations stay in the town’s own history without disclosing its identity in the Chronicle',async t=>{
 const {g,w,town}=await storage(t);town._hidden=true;harvest(w,town,8);next(w,6);assert.equal(life(w).clues.length,1);assert.equal(clueEntries(w).length,0);assert.deepEqual(g.errors,[]);
});
function clueEntries(w){return [...w.document.querySelectorAll('[data-story-kind="clue"]')];}

test('cautious interest grows from repeated real evidence rather than waiting or reopening a page',async t=>{
 const {g,w,town}=await storage(t),cap=w.$c.maxResource(town),farmer=town._paultendoPeople.find(p=>p.role==='farmer');farmer.outlook='steadfast';harvest(w,town,8);const clue=life(w).clues[0];next(w,10);assert.equal(clue.study,undefined);assert.equal(clue.observedDays,1);
 town.resources.crop=cap;harvest(w,town,8);assert.equal(clue.observedDays,2);harvest(w,town,8);assert.equal(clue.observedDays,2);next(w);assert.equal(clue.study,undefined);town.resources.crop=cap;harvest(w,town,8);assert.equal(clue.observedDays,3);next(w);assert.equal(clue.study.status,'working');assert.equal(life(w).clues.length,1);assert.deepEqual(g.errors,[]);
});

test('having prerequisite technology is distinct from knowing the method used in an imported object',async t=>{
 const {g,w,town}=await storage(t);w.planet.unlocks.fire=20;harvest(w,town,8);const clue=life(w).clues[0];assert.ok(clue);assert.equal(town._paultendoMaterials.pottery.technique,undefined);next(w,6);assert.equal(clue.study.interpretation.prepared,true);assert.equal(clue.study.interpretation.meaning,'mechanism');assert.equal(town._paultendoMaterials.pottery.technique,undefined);assert.deepEqual(g.errors,[]);
});

async function lensEffect(t,{outlook='curious',faith=0}={}) {
 const g=await makeGame();t.after(g.close);const w=g.window,town=settleGame(g);w.planet.day=10;Object.assign(w.planet.unlocks,{education:10,smith:10,travel:20,trade:10});Object.assign(town,{name:'Wick',pop:48,jobs:{doctor:47},resources:{crop:200},guidanceTrust:90});town.influences.travel=3;town.influences.disease=3;town.influences.faith=faith;meet(w,town);
 w.document.getElementById('actionItem-annals').click();click(w,'The Traveler');click(w,'What you carried');click(w,'Clear lens');click(w,'Leave it at Near Wick');const artifact=life(w).artifacts.at(-1),target=w.planet.chunks[artifact.place];assert.equal(life(w).clues.length,0);
 for(let i=0;i<8&&artifact.status==='waiting';i++){w.planet.day++;w.gameEvents.explorationExpeditionAuto.func(town,null,{choice:'yes',mission:{type:'frontier',target,label:'frontier scouting expedition'}});}assert.equal(artifact.status,'carried');const person=town._paultendoPeople.find(p=>p.id===artifact.person);assert.equal(person.role,'doctor');person.outlook=outlook;quiet(w);w.planet.day=artifact.due-1;next(w);assert.equal(artifact.status,'healing');return {g,w,town,artifact,person,clue:life(w).clues[0]};
}

test('the same observation rules accept a real lens effect without a commodity recipe or a mark',async t=>{
 const {g,w,town,artifact,person,clue}=await lensEffect(t);assert.ok(clue);assert.equal(clue.observation.kind,'objectUse');assert.equal(clue.observation.type,undefined);assert.equal(clue.observation.subject.key,'artifact:lens');assert.equal(clue.observation.artifact,artifact.id);assert.equal(clue.person,person.id);assert.ok(clue.observation.effect.changes.disease<0);assert.equal(clue.observation.effect.need,true);assert.equal([...w.document.querySelectorAll('.logMessage')].filter(e=>e.textContent.includes('studies small wounds through the glass')).length,1);
 next(w,7);assert.equal(clue.study.status,'finished');assert.equal(clue.study.days,4);assert.equal(clue.study.interpretation.prepared,false);assert.equal(life(w).artifactWork.length,0);assert.equal(w.planet.unlocks.education,10);assert.equal(w.planet.unlocks.smith,10);observed(w,town);click(w,'Clear Lens');const state=plain({clue,artifact,resources:town.resources,knowledge:town._paultendoLocalDiscoveries});click(w,'Visit the object');assert.deepEqual(plain({clue,artifact,resources:town.resources,knowledge:town._paultendoLocalDiscoveries}),state);
 const reload=await makeGame({save:plain(w.generateSave())});t.after(reload.close);assert.deepEqual(plain(life(reload.window).clues[0]),plain(clue));assert.deepEqual(g.errors,[]);assert.deepEqual(reload.errors,[]);
});

test('a generous witness investigates actual relief of illness without needing a curious personality',async t=>{
 const {g,w,clue}=await lensEffect(t,{outlook:'generous'});next(w,7);assert.equal(clue.study.status,'finished');assert.equal(clue.study.interpretation.outlook,'generous');assert.deepEqual(g.errors,[]);
});

test('a town’s strong faith can turn an unexplained useful effect into belief without generating a priest',async t=>{
 const {g,w,town,clue}=await lensEffect(t,{faith:6});next(w,7);assert.equal(clue.study.interpretation.meaning,'belief');const teaching=life(w).teachings.find(x=>x.id===clue.study.teaching);assert.equal(teaching.meaning,'belief');assert.match(teaching.words,/cannot explain/);assert.equal(town._paultendoPeople.some(p=>p.role==='priest'),false);assert.equal(life(w).artifactWork.length,0);assert.deepEqual(g.errors,[]);
});

test('an observed lens can lead into an actual costly successor object once its maker has the knowledge',async t=>{
 const {g,w,town,clue}=await lensEffect(t);next(w,7);Object.assign(w.planet.unlocks,{education:20,smith:30,fire:40});add(w,town,'glass',1);add(w,town,'metal',2);
 observed(w,town);click(w,'Clear Lens');click(w,'Visit the object');click(w,'Speak to');click(w,'Try making something of your own');const words=life(w).whispers.at(-1);words.roll=0;next(w,2);const work=life(w).artifactWork.at(-1);assert.ok(work);assert.equal(work.clue,clue.id);assert.equal(work.parent,clue.observation.artifact);assert.equal(clue.crafts[0],work.id);assert.equal(work.days,8);
 next(w,8);assert.equal(work.status,'made');assert.equal(town.resources.glass || 0,0);assert.equal(town.resources.metal || 0,0);observed(w,town);click(w,'Clear Lens');click(w,'The object');assert.match(panel(w).textContent,/object is finished/);click(w,'What caught');assert.match(panel(w).textContent,/studies small wounds/);assert.deepEqual(g.errors,[]);
});
