import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGame,settleGame} from './harness.mjs';
const plain=x=>JSON.parse(JSON.stringify(x));
const life=w=>w.planet._paultendoLife;
const panel=w=>w.document.getElementById('actionSubList');
function controlled(w){for(const id of ['townFarm','townTame','townMine','townLumber','townBirth','townDeath','townExpand']){if(w.gameEvents[id]?.func)w.gameEvents[id].func=()=>{};if(w.gameEvents[id]?.perChunk)w.gameEvents[id].perChunk=()=>{};}w.gameEvents.processAll.func=()=>{};}
function next(w){const choose=w.chooseEvent;w.chooseEvent=()=>null;try{w.nextDay();}finally{w.chooseEvent=choose;}}
function setup(g,roles={doctor:20}){const w=g.window,town=settleGame(g);w.planet.day=10;town.name='Wick';town.pop=48;town.jobs=roles;town.resources={crop:1000,metal:20,glass:2,rock:5};town.legal.farm=false;Object.assign(w.planet.unlocks,{smith:40,fire:40,education:20,travel:30,military:10});controlled(w);w.openRegBrowser(town,'town');[...w.document.querySelectorAll('.paultendoTownLife button')].find(b=>b.textContent==='Meet the people').click();for(const p of town._paultendoPeople)p.outlook='curious';return {w,town};}
function notice(w,town){town.influences.disease=12;for(let n=0;n<3;n++){town.influences.disease=12;next(w);}const work=life(w).artifactWork.find(x=>x.autonomous);assert.ok(work);return work;}
function finish(w,work){for(let n=0;n<20&&['gathering','working'].includes(work.status);n++)next(w);assert.equal(work.status,'made',JSON.stringify(work));return life(w).artifacts.find(a=>a.id===work.artifact);}
function click(w,text){const b=[...panel(w).querySelectorAll('[role="button"],.actionItem')].find(b=>b.textContent.includes(text));assert.ok(b,`Missing ${text}: ${panel(w).textContent}`);b.click();}
function errors(g){assert.deepEqual(g.errors,[]);}

test('sustained illness leads a healer to actual work without any player whisper, then to a useful lens',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g);next(w);assert.equal(life(w).artifactWork.length,0);town.influences.disease=12;next(w);assert.equal(life(w).artifactWork.length,0);const work=notice(w,town);assert.equal(work.kind,'lens');assert.equal(work.cause.key,'illness');assert.ok(work.cause.observations>=3);assert.equal(work.whisper,undefined);assert.equal(life(w).whispers.length,0);
 const made=finish(w,work);assert.deepEqual(plain(work.materials),{glass:1,metal:2});assert.equal(town.resources.glass,1);assert.equal(town.resources.metal,18);assert.equal(made.origin.whisper,undefined);assert.equal(made.origin.cause.key,'illness');assert.equal(made.origin.maker.name,work.name);for(let n=0;n<3;n++)next(w);assert.equal(made.status,'healing');assert.ok(made.events.some(e=>e.text.includes('small wounds')));const count=life(w).artifactWork.length;for(let n=0;n<35;n++){town.influences.disease=12;next(w);}assert.equal(life(w).artifactWork.length,count,'One available instrument satisfies this production need');errors(g);
});

test('a brief illness leaves no invention, and missing knowledge, metal or available hands prevents a start',async t=>{
 for(const obstacle of ['brief','knowledge','metal','worker','war']){const g=await makeGame();t.after(g.close);const {w,town}=setup(g);if(obstacle==='knowledge')w.planet.unlocks.smith=10;if(obstacle==='metal')town.resources.metal=0;if(obstacle==='worker')town.jobs={farmer:20};if(obstacle==='war'){const center=w.planet.chunks[town.center.join(',')],chunk=w.filterChunks(c=>!c.v.s&&c.v.g===center.v.g&&c.b!=='water'&&c.b!=='mountain')[0];const rival=w.happen('Create',null,null,{x:chunk.x,y:chunk.y},'town');rival.pop=48;const war=w.happen('Create',town,null,{type:'war',towns:[town.id,rival.id]},'process');town.issues.war=war.id;}
 for(let n=0;n<5;n++){town.influences.disease=obstacle==='brief'&&n>0?0:12;next(w);}assert.equal(life(w).artifactWork.length,0,obstacle);errors(g);}
});

test('autonomous work respects metal promised to an existing player craft',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g,{doctor:20,musician:20});town.resources.metal=3;click(w,'Musician');click(w,'Make something of your own');click(w,'Make a tuning fork');const voice=life(w).whispers.at(-1);voice.roll=0;w.planet.day=voice.due-1;next(w);assert.equal(life(w).artifactWork[0].status,'working');for(let n=0;n<3;n++){town.influences.disease=12;next(w);}assert.equal(life(w).artifactWork.filter(x=>x.autonomous).length,0);assert.equal(town.resources.metal,3);errors(g);
});

test('a healer seeking glass creates real demand but abandons the unstarted idea when illness passes',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g);town.resources.glass=0;const work=notice(w,town);assert.equal(work.status,'gathering');assert.equal(work.due,null);town.influences.disease=0;next(w);assert.equal(work.status,'abandoned');assert.equal(work.materials,undefined);assert.equal(town.resources.metal,20);assert.equal(life(w).artifacts.length,0);assert.match(work.steps.at(-1).text,/need that began it has passed/);errors(g);
});

test('people beyond the explored map can make, use and remember an object without disclosing its maker',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g);town._hidden=true;const place=w.planet.chunks[town.center.join(',')];delete w.planet._paultendoFog.explored[`${place.x},${place.y}`];const work=notice(w,town),made=finish(w,work);for(let n=0;n<3;n++)next(w);assert.equal(made.status,'healing');assert.equal(made.events.at(-1).knownTown,false);assert.equal([...w.document.querySelectorAll('.logMessage')].some(e=>e.dataset.storyId===work.id||e.dataset.storyId===made.id),false);assert.equal([...w.document.querySelectorAll('.paultendoChronicleStoryLink')].some(e=>e.textContent.includes(work.name)),false);
 const restored=await makeGame({save:plain(w.generateSave())});t.after(restored.close);const copy=life(restored.window).artifacts.find(a=>a.id===made.id);assert.equal(copy.origin.cause.key,'illness');assert.equal(copy.origin.whisper,undefined);errors(g);errors(restored);
});

test('saved notices and unfinished work resume without repeating starts or changing the maker',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g);const work=notice(w,town);const saved=plain(w.generateSave()),restored=await makeGame({save:saved});t.after(restored.close);const rw=restored.window;controlled(rw);const copy=life(rw).artifactWork.find(x=>x.id===work.id),rt=rw.regGet('town',town.id);assert.equal(copy.due,work.due);assert.equal(copy.name,work.name);assert.equal(rt._paultendoInvention.notices.illness.days,town._paultendoInvention.notices.illness.days);const made=finish(rw,copy);assert.equal(made.origin.maker.name,work.name);assert.equal(life(rw).artifactWork.filter(x=>x.autonomous).length,1);errors(g);errors(restored);
});

test('military priorities can start an instrument for drills and hand it to an actual soldier',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g,{miner:20,soldier:20});town.research.military=10;for(let n=0;n<3;n++)next(w);const work=life(w).artifactWork.find(x=>x.autonomous);assert.equal(work.kind,'fork');assert.equal(work.cause.key,'drills');const made=finish(w,work),holder=town._paultendoPeople.find(p=>p.id===made.person);assert.equal(holder.role,'soldier');for(let n=0;n<3;n++)next(w);assert.equal(made.status,'drills');assert.ok(made.events.some(e=>e.changes?.crime>0));assert.equal(made.origin.whisper,undefined);errors(g);
});

test('a guarded maker in an orderly military town can keep the result away from its intended user',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g,{miner:20,soldier:20});town._paultendoPeople.find(p=>p.role==='miner').outlook='guarded';town.values.order=5;town.research.military=10;for(let n=0;n<3;n++)next(w);const work=life(w).artifactWork.find(x=>x.autonomous);assert.ok(work);const made=finish(w,work);for(let n=0;n<3;n++)next(w);assert.equal(made.status,'hoarded');assert.equal(made.person,work.person);assert.equal(made.events.some(e=>e.text.includes('whose work began the idea')),false);errors(g);
});

test('Chronicle and town work histories show an autonomous cause without inventing player instructions',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g);const work=notice(w,town),entry=[...w.document.querySelectorAll('.logMessage')].find(e=>e.dataset.storyKind==='craft'&&e.dataset.storyId===work.id);assert.ok(entry?.querySelector('.paultendoChronicleStoryLink'));entry.querySelector('.paultendoChronicleStoryLink').click();assert.match(panel(w).textContent,/Illness troubled Wick/);assert.doesNotMatch(panel(w).textContent,/You whispered|Your words|Remember your whisper/);assert.equal(panel(w).textContent.split(work.cause.text).length-1,1);const made=finish(w,work);w.openRegBrowser(town,'town');[...w.document.querySelectorAll('.paultendoTownLife button')].find(b=>b.textContent==='Work and inventions').click();click(w,work.name);click(w,'Follow');assert.match(panel(w).textContent,new RegExp(`Made by ${work.name}`));assert.match(panel(w).textContent,/Illness troubled Wick/);assert.ok(made);errors(g);
});

test('research priorities and musical unhappiness create distinct kinds of work from actual circumstances',async t=>{
 for(const kind of ['study','song']){const g=await makeGame();t.after(g.close);const {w,town}=setup(g,kind==='study'?{scholar:20}:{musician:20});if(kind==='study'){w.planet.unlocks.astronomy=10;town.research={education:10,farm:20};for(let n=0;n<4;n++)next(w);assert.equal(life(w).artifactWork.length,0,'Education is available but does not lead their priorities');town.research.education=30;}
 for(let n=0;n<3;n++){if(kind==='song')town.influences.happy=-8;next(w);}const work=life(w).artifactWork.find(x=>x.autonomous);assert.ok(work,kind);assert.equal(work.cause.key,kind);const made=finish(w,work);for(let n=0;n<3;n++)next(w);assert.equal(made.status,kind);assert.equal(made.origin.whisper,undefined);errors(g);}
});

test('two completed real long expeditions can motivate a compass, while inspecting a possible route cannot',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g,{miner:20});town.influences.travel=3;const target=w.filterChunks(c=>!c.v.s&&c.v.g===w.planet.chunks[town.center.join(',')].v.g&&c.b!=='water'&&c.b!=='mountain'&&Math.hypot(c.x-town.center[0],c.y-town.center[1])<=10).sort((a,b)=>Math.hypot(b.x-town.center[0],b.y-town.center[1])-Math.hypot(a.x-town.center[0],a.y-town.center[1]))[0];
 const mission={type:'frontier',target,label:'a long scouting expedition'};
 // Execute through the native mod event, which checks the actual path, records
 // the completed visit.
 const caller=w.readyEvent('explorationExpeditionPrompt',town);assert.ok(caller);for(let n=0;n<4;n++)next(w);assert.equal(life(w).artifactWork.length,0);
 for(let n=0;n<2;n++){w.planet.day++;w.gameEvents.explorationExpeditionAuto.func(town,null,{choice:'yes',mission});}
 const visits=Object.values(life(w).places).flatMap(p=>p.visits);assert.ok(visits.filter(v=>v.pathLength>=6).length>=2);for(let n=0;n<3;n++)next(w);const work=life(w).artifactWork.find(x=>x.autonomous);assert.equal(work.kind,'compass');assert.equal(work.cause.key,'journeys');assert.equal(work.cause.journeys.length,2);const made=finish(w,work);assert.deepEqual(plain(work.materials),{rock:1,metal:3});assert.equal(made.origin.cause.journeys[0].pathLength,visits[0].pathLength);errors(g);
});

test('town values decide whether care or military work wins when both compete for the workshop',async t=>{
 for(const priority of ['army','care']){const g=await makeGame();t.after(g.close);const {w,town}=setup(g,{doctor:20,miner:10,soldier:10});town.resources.metal=3;town.research={military:10};town.values={order:priority==='army'?8:0,justice:priority==='care'?20:0};for(let n=0;n<3;n++){town.influences.disease=12;next(w);}const work=life(w).artifactWork.find(x=>x.autonomous);assert.ok(work);assert.equal(work.cause.key,priority==='army'?'drills':'illness');assert.equal(life(w).artifactWork.length,1);errors(g);}
});

test('a hoarded instrument leaves the public need unmet and can lead another maker to build a replacement',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g,{miner:20,soldier:20});town._paultendoPeople.find(p=>p.role==='miner').outlook='guarded';town.values.order=5;town.research={military:10};for(let n=0;n<3;n++)next(w);const first=life(w).artifactWork.find(x=>x.autonomous),kept=finish(w,first);for(let n=0;n<3;n++)next(w);assert.equal(kept.status,'hoarded');town.jobs.scholar=8;w.openRegBrowser(town,'town');[...w.document.querySelectorAll('.paultendoTownLife button')].find(b=>b.textContent==='Meet the people').click();town._paultendoPeople.find(p=>p.role==='scholar').outlook='curious';w.planet.day=first.finished+30;next(w);const second=life(w).artifactWork.find(x=>x.id!==first.id);assert.ok(second);assert.notEqual(second.person,first.person);const made=finish(w,second);for(let n=0;n<3;n++)next(w);assert.equal(made.status,'drills');assert.equal(kept.status,'hoarded');const count=life(w).artifactWork.length;w.planet.day+=35;next(w);assert.equal(life(w).artifactWork.length,count,'Accessible work meets the public need');errors(g);
});

test('an autonomously made object can enter the actual Traveler loop with its cause and maker intact',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g);const work=notice(w,town),made=finish(w,work);for(let n=0;n<3;n++)next(w);town.influences.disease=0;w.openRegBrowser(town,'town');[...w.document.querySelectorAll('.paultendoTownLife button')].find(b=>b.textContent.endsWith(' · Its story')).click();click(w,`Speak to ${made.name}`);click(w,'Will you entrust');const promise=life(w).whispers.at(-1);promise.roll=0;w.planet.day=promise.due-1;next(w);assert.ok(made.returnOffer);w.planet.day=made.returnOffer.earliest-1;next(w);assert.equal(made.status,'returned');const object=w._paultendoUniverse.traveler.pack.find(a=>a.lineage===made.lineage);assert.equal(object.origin.cause.key,'illness');assert.equal(object.origin.whisper,undefined);
 w.document.getElementById('actionItem-annals').click();click(w,'The Traveler');click(w,'The way back');click(w,'Return to the beginning');w.handlePrompt(true);assert.equal(w.planet.day,1);assert.equal(w._paultendoUniverse.traveler.passage,1);const carried=w._paultendoUniverse.traveler.pack.find(a=>a.lineage===made.lineage);assert.equal(carried.origin.maker.name,work.name);assert.equal(carried.origin.cause.text,work.cause.text);const restored=await makeGame({save:plain(w.generateSave())});t.after(restored.close);assert.equal(restored.window._paultendoUniverse.traveler.pack.find(a=>a.lineage===made.lineage).origin.cause.key,'illness');errors(g);errors(restored);
});


function wartimeFixture(w,town){
 // Hold population and jobs fixed so these tests isolate actual work and its crises.
 for(const id of ['townEat','townEmploy','warPressureDynamics'])w.gameEvents[id].func=()=>{};
 const war=w.happen('Create',town,null,{type:'war',towns:[town.id]},'process');town.issues.war=war.id;return war;
}
function ordinaryLens(w,town){
 town.influences.disease=0;town.research={farm:100};town.guidanceTrust=90;
 for(const p of town._paultendoPeople){p.outlook='curious';p.trust=90;}
 click(w,'Doctor');click(w,'Make something of your own');click(w,'Make a clear lens');
 const voice=life(w).whispers.at(-1);voice.roll=0;w.planet.day=voice.due-1;next(w);return life(w).artifactWork.at(-1);
}
test('a crisis pauses an ordinary unfinished object through its deadline and reload, then real work resumes',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g),work=ordinaryLens(w,town),due=work.due;
 const war=wartimeFixture(w,town);for(let n=0;n<work.days+2;n++)next(w);
 assert.equal(work.status,'working');assert.equal(work.pause,'war');assert.equal(work.progress,undefined);assert.equal(work.wartime,undefined);assert.ok(work.due>due);assert.equal(work.materials,undefined);assert.equal(work.steps.filter(s=>s.text.includes('fighting continues')).length,1);
 const restored=await makeGame({save:plain(w.generateSave())});t.after(restored.close);const rw=restored.window;controlled(rw);for(const id of ['townEat','townEmploy','warPressureDynamics'])rw.gameEvents[id].func=()=>{};
 const rt=rw.regGet('town',town.id),copy=life(rw).artifactWork.find(x=>x.id===work.id);assert.equal(copy.pause,'war');rw.happen('Finish',null,rw.regGet('process',war.id));delete rt.issues.war;
 rt.resources.crop=0;next(rw);assert.equal(copy.pause,'food');const remaining=copy.due-rw.planet.day;next(rw);assert.equal(copy.due-rw.planet.day,remaining);
 rt.resources.crop=1000;const metal=rt.resources.metal,glass=rt.resources.glass;const made=finish(rw,copy);assert.equal(rt.resources.metal,metal-2);assert.equal(rt.resources.glass,glass-1);assert.equal(made.origin.wartime,undefined);assert.equal(copy.steps.filter(s=>s.text.includes('returns to the unfinished')).length,1);errors(g);errors(restored);
});

test('a real military need keeps suitable work going through war, while hunger still stops it',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g,{miner:20,soldier:20});town.research={military:100};for(let n=0;n<3;n++)next(w);const work=life(w).artifactWork.find(x=>x.autonomous);assert.equal(work.kind,'fork');const war=wartimeFixture(w,town);
 town.resources.crop=0;next(w);assert.equal(work.pause,'food');assert.equal(work.wartime,undefined);town.resources.crop=1000;
 const before=town.resources.metal,made=finish(w,work);assert.equal(town.resources.metal,before-3);assert.equal(made.origin.wartime[0].war,war.id);assert.equal(made.origin.wartime[0].meaning,'drills');assert.ok(made.origin.wartime[0].days>0);assert.ok(made.events.some(e=>e.text.includes('finished while Wick was at war')));errors(g);
});

test('ordinary work can rarely persist during war without daily rerolls or free inputs, and carries that unexpected history',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g),work=ordinaryLens(w,town);
 while(!work.progress)next(w);next(w);const war=wartimeFixture(w,town),sample=200;
 // A cohort isolates the rarity check on the same genuine unfinished work.
 life(w).artifactWork=Array.from({length:sample},(_,n)=>({...plain(work),id:`wartime-sample:${n}`,steps:[],due:w.planet.day+100,warPersistence:undefined}));
 next(w);const cohort=life(w).artifactWork,continued=cohort.filter(x=>x.wartime?.some(c=>c.meaning==='persistence'));
 assert.ok(continued.length>0&&continued.length<sample/10,`${continued.length}/${sample} continued`);const rolls=plain(cohort.map(x=>x.warPersistence));
 for(let n=0;n<3;n++)next(w);assert.deepEqual(plain(cohort.map(x=>x.warPersistence)),rolls);assert.equal(cohort.filter(x=>x.wartime?.length).length,continued.length);
 const chosen=continued[0];life(w).artifactWork=[chosen];const saved=plain(w.generateSave());const restored=await makeGame({save:saved});t.after(restored.close);const rw=restored.window;controlled(rw);for(const id of ['townEat','townEmploy','warPressureDynamics'])rw.gameEvents[id].func=()=>{};
 const copy=life(rw).artifactWork[0],rt=rw.regGet('town',town.id),metal=rt.resources.metal;rw.planet.day=copy.due-1;next(rw);assert.equal(copy.status,'made');assert.equal(rt.resources.metal,metal-2);
 const made=life(rw).artifacts.find(a=>a.id===copy.artifact);assert.equal(made.origin.wartime[0].meaning,'persistence');assert.equal(made.origin.wartime[0].war,war.id);assert.equal(made.origin.wartimeCompletion.war,war.id);assert.equal(made.origin.wartimeCompletion.day,rw.planet.day);assert.equal(made.origin.wartimeCompletion.town,rt.id);assert.equal(made.origin.cause,undefined);assert.ok(made.events.some(e=>e.text.includes('ordinary idea')));assert.equal(made.events.find(e=>e.text.includes('ordinary idea')).day,made.origin.wartime[0].day);assert.ok(made.events.every((e,n)=>!n||e.day>=made.events[n-1].day));assert.equal(made.quality,.6);errors(g);errors(restored);
});
