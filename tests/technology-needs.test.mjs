import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGame,settleGame} from './harness.mjs';
const plain=x=>JSON.parse(JSON.stringify(x));
function setup(g){const w=g.window,town=settleGame(g);w.planet.day=30;town.name='Claybank';town.pop=20;town.resources={crop:1000};town.jobs={miner:10,farmer:10};town.research={};Object.assign(w.planet.unlocks,{farm:10,smith:10,fire:10});return {w,town};}
function samples(w,town){const counts={},values=[],random=w.Math.random;try{for(let n=0;n<300;n++){w.Math.random=()=> (n+.5)/300;const value=w.gameEvents.unlockLevel.value(w.regGet('player',1),town);if(value){counts[value.type]=(counts[value.type] || 0)+1;values.push(value);}}}finally{w.Math.random=random;}return {counts,values};}
function add(w,town,type,count){w.happen('AddResource',null,town,{type,count});}
function curious(w,town){w.openRegBrowser(town,'town');[...w.document.querySelectorAll('.paultendoTownLife button')].find(b=>b.textContent==='Meet the people').click();for(const person of town._paultendoPeople)person.outlook='curious';}
function weights(w){let result;const choose=w.chooseEvent;w.chooseEvent=()=>{result=Object.fromEntries(['unlockKilns','unlockForges','unlockSteel'].map(id=>[id,w.randomEvents[id].weight]));return null;};try{w.nextDay();}finally{w.chooseEvent=choose;}return result;}
function quiet(w){for(const id of ['townFarm','townTame','townMine','townLumber','townBirth','townDeath','townExpand']){if(w.gameEvents[id].func)w.gameEvents[id].func=()=>{};if(w.gameEvents[id].perChunk)w.gameEvents[id].perChunk=()=>{};}w.gameEvents.processAll.func=()=>{};}
function errors(g){assert.deepEqual(g.errors,[]);}

test('actual food shortage favours farming proposals and relief removes that pressure',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g);town.research={education:100};const fed=samples(w,town);town.resources.crop=0;const hungry=samples(w,town);assert.ok(hungry.counts.farm>fed.counts.farm*2);
 const value=hungry.values.find(v=>v.type==='farm');assert.equal(value.need.food,0);assert.ok(value.need.wanted>0);assert.match(w.gameEvents.unlockLevel.message(null,town,{value}),/Food is running short/);town.resources.crop=1000;assert.equal(samples(w,town).counts.farm,fed.counts.farm);assert.equal(w.planet.unlocks.farm,10,'Sampling a proposal grants no technology');errors(g);
});

test('a locally encountered clay sample with an actual storage problem motivates relevant shaping and fire knowledge',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g);w.planet.unlocks.smith=0;w.planet.unlocks.fire=0;town.research={education:100};const before=samples(w,town);town._paultendoGrainStore={vessels:[],steps:[],pressure:{day:w.planet.day,target:w.$c.maxResource(town)+8}};add(w,town,'clay',2);
 const after=samples(w,town);assert.ok(after.counts.fire>before.counts.fire);assert.ok(after.counts.smith>before.counts.smith);const value=after.values.find(v=>v.type==='fire');assert.equal(value.need.material,'clay');assert.equal(value.need.purpose,'pottery');assert.equal(value.need.through,20);assert.equal(town.resources.pottery,undefined);assert.equal(town._paultendoMaterials.clay.technique,undefined);assert.equal(w.planet.unlocks.fire,0);errors(g);
});

test('material experiments never supply a reason for the native Firebombing choice',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g);Object.assign(w.planet.unlocks,{fire:20,military:10,smith:20});town.research={education:100};curious(w,town);add(w,town,'sand',3);const value=samples(w,town).values.find(v=>v.type==='fire');assert.ok(value);assert.equal(value.levelData.name,'Firebombing');assert.equal(value.need,undefined);assert.doesNotMatch(w.gameEvents.unlockLevel.message(null,town,{value}),/sand|workshop|hotter/);errors(g);
});

test('research priorities influence branch choice while native prerequisites and refusals still apply',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g);town.research={education:100};const education=samples(w,town);town.research={farm:100};const farming=samples(w,town);assert.ok(farming.counts.farm>education.counts.farm);assert.ok(education.counts.education>farming.counts.education);
 w.planet.unlocksRejected.farm=w.planet.day;assert.equal(samples(w,town).counts.farm,undefined);w.planet.day+=11;assert.ok(samples(w,town).counts.farm>0);w.planet.unlocks.farm=0;assert.equal(samples(w,town).counts.education,undefined);assert.equal(samples(w,town).counts.military,undefined,'Military still needs a second settlement');errors(g);
});

test('samples and technical milestones alone create neither demand nor a furnace proposal attributed to a disinterested town',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g);Object.assign(w.planet.unlocks,{smith:30,fire:40});town.research={farm:100};curious(w,town);for(const p of town._paultendoPeople)p.outlook='steadfast';add(w,town,'sand',3);
 assert.doesNotMatch(w.gameEvents.unlockForges.message(w.regGet('player',1),null,{_paultendoTechVariant:{baseName:'Forges',originTownId:town.id}}) || '',/Claybank|has sand/);assert.equal(town.resources.glass,undefined);assert.equal(w.planet._paultendoLife.materialWork.length,0);errors(g);
});

test('an actual sand sample and curious available worker favour furnace research without awarding glass',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g);quiet(w);Object.assign(w.planet.unlocks,{smith:30,fire:40});curious(w,town);assert.equal(w.readyEvent('unlockForges'),undefined);add(w,town,'sand',3);const caller=w.readyEvent('unlockForges');
 assert.ok(caller);assert.equal(caller.args.value.town,town.id);assert.match(caller.args.value.cause.text,/sand/);assert.equal(w.gameEvents.unlockForges.check(caller.subject,caller.target,caller.args),true);assert.equal(town.resources.glass,undefined);assert.equal(w.planet._paultendoLife.materialWork.length,0,'The furnace is still missing');assert.equal(w.planet.unlocks.fire,40);town.jobs.miner=0;assert.doesNotMatch(w.gameEvents.unlockForges.message(w.regGet('player',1),null,{_paultendoTechVariant:{baseName:'Forges',originTownId:town.id}}) || '',/has sand/);errors(g);
});

test('hidden workshops can influence research without revealing their identity or raw samples',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g);Object.assign(w.planet.unlocks,{smith:30,fire:40});curious(w,town);add(w,town,'sand',3);town._hidden=true;assert.doesNotMatch(w.gameEvents.unlockForges.message(w.regGet('player',1),null,{_paultendoTechVariant:{baseName:'Forges',originTownId:town.id}}) || '',/Claybank|has sand/);
 town.resources.crop=0;const value=samples(w,town).values.find(v=>v.type==='farm');assert.equal(value.need.known,false);assert.doesNotMatch(w.gameEvents.unlockLevel.message(null,town,{value}),/running short|Claybank/);errors(g);
});

test('a sample-backed proposal keeps its original question through native choice and save recovery',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g);quiet(w);town._paultendoGrainStore={vessels:[],steps:[],pressure:{day:30,target:w.$c.maxResource(town)+8}};add(w,town,'clay',2);w.planet.unlocks.fire=0;
 const value=samples(w,town).values.find(v=>v.type==='fire'),caller=w.readyEvent('unlockLevel',w.regGet('player',1),town);assert.ok(caller);caller.args.value=value;caller.message=w.gameEvents.unlockLevel.message(caller.subject,town,caller.args);const choose=w.chooseEvent,ready=w.readyEvent;w.chooseEvent=()=> 'unlockLevel';w.readyEvent=(key,...args)=>key==='unlockLevel'?caller:ready(key,...args);try{w.nextDay();}finally{w.chooseEvent=choose;w.readyEvent=ready;}
 const entry=w.document.getElementById('logMessage-'+caller.logID);assert.match(entry.textContent,/clay in the stores/);entry.querySelector('[type="yes"]').click();assert.equal(w.planet.unlocks.fire,10);assert.equal(town.resources.clay,2);assert.equal(town.resources.pottery,undefined);const decision=w.planet._paultendoLife.decisions.at(-1),question=decision.question;assert.deepEqual(plain(decision.need),plain(value.need));assert.match(question,/clay in the stores/);
 const restored=await makeGame({save:plain(w.generateSave())});t.after(restored.close);assert.equal(restored.window.planet._paultendoLife.decisions.at(-1).question,question);assert.equal(restored.window.planet.unlocks.fire,10);assert.deepEqual(plain(restored.window.planet._paultendoLife.decisions.at(-1).need),plain(value.need));errors(g);errors(restored);
});

test('actually worn stone tools motivate better eligible methods while unused tools and missing means do not',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g);town.resources.crop=100;town.research={education:100};town.legal.farm=true;add(w,town,'rock',4);town._paultendoFoodFlow=[{day:28,harvest:4},{day:29,harvest:4},{day:30,harvest:4}];
 town._paultendoFarmTools={sets:[{id:'tools:old',type:'stone_tools',count:2,uses:80}],steps:[],credit:0,extra:0};const fresh=samples(w,town);town._paultendoFarmTools.sets[0].uses=20;const worn=samples(w,town);assert.ok(worn.counts.smith>fresh.counts.smith);const value=worn.values.find(v=>v.type==='smith');assert.equal(value.levelData.level,20);assert.equal(value.need.tools[0].uses,20);assert.match(w.gameEvents.unlockLevel.message(null,town,{value}),/working stone edges wear away/);assert.equal(w.planet.unlocks.smith,10);assert.equal(town.resources.metal,undefined);
 w.planet.unlocks.smith=20;w.planet.unlocks.fire=0;assert.equal(samples(w,town).counts.smith,undefined,'Metalwork still requires controlled fire');assert.equal(samples(w,town).values.find(v=>v.type==='fire').need.through,10);w.planet.unlocks.fire=10;assert.equal(samples(w,town).values.find(v=>v.type==='smith').levelData.level,30);
 town.resources.rock=0;assert.equal(samples(w,town).values.find(v=>v.type==='smith').need,undefined);town.resources.rock=4;town.resources.crop=0;assert.equal(samples(w,town).values.find(v=>v.type==='smith').need,undefined);town.resources.crop=100;town.jobs={};assert.equal(samples(w,town).values.find(v=>v.type==='smith').need,undefined);errors(g);
});

test('an actual metal sample and unmet fieldwork favour metal shaping without granting gear or local mastery',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g);town.resources.crop=100;town.research={farm:100};town.legal.farm=true;Object.assign(w.planet.unlocks,{smith:30,fire:10});town._paultendoFoodFlow=[{day:28,harvest:4},{day:29,harvest:4},{day:30,harvest:4}];const before=samples(w,town);add(w,town,'metal',2);const after=samples(w,town);assert.ok(after.counts.smith>before.counts.smith);const value=after.values.find(v=>v.type==='smith');assert.equal(value.need.purpose,'metal_tools');assert.equal(value.levelData.name,'Metal Tools');assert.match(w.gameEvents.unlockLevel.message(null,town,{value}),/farmers need more working tools/);assert.equal(town.resources.metal,2);assert.equal(town.resources.metal_tools,undefined);assert.equal(town._paultendoMaterials?.metal_tools,undefined);
 town.resources.crop=w.$c.maxResource(town);assert.equal(samples(w,town).values.find(v=>v.type==='smith').need,undefined,'Full stores leave no current reason for more field equipment');errors(g);
});

function nativeWeight(w){let weight;const choose=w.chooseEvent;w.chooseEvent=()=>{weight=w.randomEvents.unlockLevel.weight;return null;};try{w.nextDay();}finally{w.chooseEvent=choose;}return weight;}

test('sustained eligible needs gain bounded attention in the existing event slot and relief removes it immediately',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g);quiet(w);town.resources.crop=0;
 const base=w.randomEvents.unlockLevel.weight,first=nativeWeight(w),second=nativeWeight(w),third=nativeWeight(w);
 assert.ok(first>base);assert.ok(second>first);assert.ok(third>second);assert.ok(third<=base*4);
 assert.equal(w.randomEvents.unlockLevel.weight,base,'Temporary weights restore after the day');
 const question=town._paultendoResearchQuestions.farm;assert.equal(question.days,3);const before=plain(question);samples(w,town);samples(w,town);assert.deepEqual(plain(question),before,'Reading or sampling questions is not progress');
 assert.equal(w.planet.unlocks.farm,10,'Noticing a need does not award a discovery');assert.equal(w.planet._paultendoLife.decisions.length,0,'No extra proposal was inserted into the day');
 town.resources.crop=1000;assert.equal(nativeWeight(w),base);w.planet.unlocksRejected.farm=w.planet.day;town.resources.crop=0;assert.equal(nativeWeight(w),base,'A refused eligible branch is not used to boost a different proposal');errors(g);
});

test('saved research attention keeps genuine observations, pauses without means, and retires after discovery or a long gap',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g);quiet(w);town.resources.crop=100;town.legal.farm=true;add(w,town,'rock',20);town._paultendoFoodFlow=[{day:28,harvest:4},{day:29,harvest:4},{day:30,harvest:4}];town._paultendoFarmTools={sets:[{id:'used',type:'stone_tools',count:2,uses:20}],steps:[],credit:0,extra:0};nativeWeight(w);nativeWeight(w);
 const saved=plain(w.generateSave()),restored=await makeGame({save:saved});t.after(restored.close);const rw=restored.window,rt=rw.regGet('town',town.id);quiet(rw);assert.deepEqual(plain(rt._paultendoResearchQuestions),plain(town._paultendoResearchQuestions));rt.resources.rock=0;const base=rw.randomEvents.unlockLevel.weight;assert.equal(nativeWeight(rw),base,'Knowledge without a usable sample does not sustain this question');
 rw.planet.day+=9;nativeWeight(rw);assert.equal(rt._paultendoResearchQuestions.smith,undefined);rt.resources.rock=20;rt._paultendoFoodFlow=[{day:rw.planet.day-2,harvest:4},{day:rw.planet.day-1,harvest:4},{day:rw.planet.day,harvest:4}];nativeWeight(rw);assert.equal(rt._paultendoResearchQuestions.smith.days,1,'The new need has a new observation history');
 rw.planet.unlocks.smith=20;nativeWeight(rw);assert.equal(rt._paultendoResearchQuestions.smith.level,30);assert.equal(rt._paultendoResearchQuestions.smith.days,1,'A harder question does not inherit the completed question’s attention');errors(g);errors(restored);
});

test('the native proposal targets a settlement facing a sustained need without awarding an extra choice or revealing hidden identities',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g);quiet(w);town.resources.crop=0;town._hidden=true;
 const chunk=w.filterChunks(c=>!c.v.s&&c.b!=='water'&&c.b!=='mountain')[0],other=w.happen('Create',null,null,{x:chunk.x,y:chunk.y},'town');other.pop=20;other.resources={crop:1000};other.jobs={farmer:20};other.research={};other.start=1;
 for(let n=0;n<3;n++)nativeWeight(w);
 const counts={},random=w.Math.random;
 try{for(let n=0;n<200;n++){let index=0;w.Math.random=()=>index++===0?(n+.5)/200:.01;const caller=w.readyEvent('unlockLevel');assert.ok(caller);counts[caller.target.id]=(counts[caller.target.id] || 0)+1;if(caller.target===town){assert.equal(caller.args.value.need.known,false);assert.doesNotMatch(caller.message,/Claybank|running short/);}}}finally{w.Math.random=random;}
 assert.ok(counts[town.id]>counts[other.id]*3,JSON.stringify(counts));
 const caller=w.readyEvent('unlockLevel',w.regGet('player',1),other);assert.equal(caller.target,other,'Explicit native callers keep their actual settlement');errors(g);
});
