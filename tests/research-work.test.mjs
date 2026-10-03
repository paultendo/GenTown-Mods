import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGame,settleGame} from './harness.mjs';
const plain=x=>JSON.parse(JSON.stringify(x));
function quiet(w){for(const id of ['townFarm','townTame','townMine','townLumber','townBirth','townDeath','townExpand','townEat']){if(w.gameEvents[id].func)w.gameEvents[id].func=()=>{};if(w.gameEvents[id].perChunk)w.gameEvents[id].perChunk=()=>{};}w.gameEvents.processAll.func=()=>{};}
function setup(g){const w=g.window,town=settleGame(g),warnings=[];w.console.warn=(...args)=>warnings.push(args.map(String).join(' '));w.planet.day=30;town.name='Claybank';town.pop=20;town.jobs={scholar:2,miner:4,farmer:14};town.resources={crop:1000};town.research={education:100};town._paultendoNextExchangeDay=99999;Object.assign(w.planet.unlocks,{education:20,farm:10,smith:20,fire:20});quiet(w);return {w,town,warnings};}
function next(w,n=1){const choose=w.chooseEvent;w.chooseEvent=()=>null;try{for(let i=0;i<n;i++)w.nextDay();}finally{w.chooseEvent=choose;}}
function add(w,town,type,count){w.happen('AddResource',null,town,{type,count});}
function start(w,event){const caller=w.readyEvent(event);assert.ok(caller,`${event} should have a worker and purpose`);assert.ok(w.gameEvents[event].check(caller.subject,caller.target,caller.args));w.doEvent(event,caller);return w.planet._paultendoLife.inquiries.at(-1);}
function open(w,work){const entry=w.document.querySelector(`[data-story-kind="inquiry"][data-story-id="${work.id}"]`);assert.ok(entry);entry.querySelector('.paultendoChronicleStoryLink').click();return w.document.getElementById('actionSubList');}
function check(g,warnings){assert.deepEqual(g.errors,[]);assert.deepEqual(warnings,[]);}

test('a research priority without an actual scholar cannot produce advanced learning',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town,warnings}=setup(g);town.jobs={farmer:20};add(w,town,'clay',2);
 assert.equal(w.readyEvent('unlockWriting'),undefined);next(w,12);assert.equal(w.planet.unlocks.education,20);assert.equal(w.planet._paultendoLife.inquiries.length,0);check(g,warnings);
});

test('a discovery costs actual materials and working time and records the real maker instead of an invented figure',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town,warnings}=setup(g);add(w,town,'clay',2);const figures=w.planet.figures?.length || 0,work=start(w,'unlockWriting');
 assert.equal(work.status,'waiting');assert.equal(town.resources.clay,2);assert.equal(w.planet.unlocks.education,20);assert.equal(w.planet.stats.prompt || 0,0);
 assert.match(open(w,work).textContent,/Gathering 1 clay/);next(w);assert.equal(work.status,'working');assert.equal(town.resources.clay,1);assert.equal(work.remaining,6);
 assert.equal(w.readyEvent('unlockWriting'),undefined,'The same discovery cannot be started twice');next(w,5);assert.equal(w.planet.unlocks.education,20);assert.equal(work.remaining,1);next(w);
 assert.equal(work.status,'learned');assert.equal(w.planet.unlocks.education,30);assert.equal(town.resources.clay,1);assert.equal(w.planet.figures?.length || 0,figures);
 const discovery=w.planet._paultendoLife.discoveries['education:30'];assert.equal(discovery.origin,town.id);assert.equal(discovery.person,work.person);assert.equal(discovery.day,w.planet.day);assert.equal(discovery.inquiry,work.id);assert.equal(w.planet._paultendoTechUnlocks.education[30].inquiry,work.id);assert.equal(w.planet._paultendoTechUnlocks.education[30].makerName,work.name);
 const panel=open(w,work);assert.match(panel.textContent,/Read the discovery/);[...panel.querySelectorAll('[role="button"]')].find(b=>b.textContent==='Read the discovery').click();assert.match(panel.textContent,/Follow the work that led here/);
 check(g,warnings);
});

test('food, fighting and losing a worker interrupt trials, while reload and inspecting the story do not advance them',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town,warnings}=setup(g);add(w,town,'clay',1);const work=start(w,'unlockWriting');next(w,2);const remaining=work.remaining;
 town.resources.crop=0;next(w,2);assert.equal(work.remaining,remaining);assert.equal(work.delay,'food');assert.match(open(w,work).textContent,/waits for food/);
 town.resources.crop=1000;const site=w.filterChunks(c=>!c.v.s&&c.b!=='water'&&c.b!=='mountain')[0],rival=w.happen('Create',null,null,{x:site.x,y:site.y},'town'),war=w.happen('Create',town,null,{type:'war',towns:[town.id,rival.id]},'process');town.issues.war=war.id;next(w);assert.equal(work.remaining,remaining);assert.equal(work.delay,'war');war.end=true;delete town.issues.war;town.jobs.scholar=0;next(w);assert.equal(work.remaining,remaining);assert.equal(work.delay,'hands');town.jobs.scholar=2;
 const restored=await makeGame({save:plain(w.generateSave())});t.after(restored.close);const rw=restored.window;quiet(rw);const resumed=rw.planet._paultendoLife.inquiries.find(r=>r.id===work.id);assert.equal(resumed.remaining,remaining);open(rw,resumed);open(rw,resumed);assert.equal(resumed.remaining,remaining);next(rw,remaining);assert.equal(resumed.status,'learned');assert.equal(rw.regGet('town',town.id).resources.clay || 0,0);check(g,warnings);assert.deepEqual(restored.errors,[]);
});

test('waiting trials can obtain supplies through existing workshops without occupying their maker twice',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town,warnings}=setup(g);town.jobs={miner:4,farmer:16};town.research={fire:100};Object.assign(w.planet.unlocks,{smith:30,fire:40});for(const [type,count] of Object.entries({brick:2,lumber:4,sand:2}))add(w,town,type,count);
 const work=start(w,'unlockForges');assert.equal(work.status,'waiting');for(let i=0;i<40&&work.status!=='learned';i++){next(w);for(const batch of w.planet._paultendoLife.materialWork)batch.roll=.99;const active=w.planet._paultendoLife.materialWork.filter(b=>b.person===work.person&&b.status==='working');assert.equal(work.status==='working'&&active.length>0,false,'One worker cannot perform both jobs');}
 assert.equal(work.status,'learned',JSON.stringify(work));assert.equal(w.planet.unlocks.fire,50);assert.ok(work.inputs.some(i=>i.production?.work));assert.equal(town.resources.brick || 0,0);check(g,warnings);
});

test('waiting work is abandoned when its purpose changes and never spends the promised input',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town,warnings}=setup(g);const work=start(w,'unlockWriting');town.research={military:100};next(w);assert.equal(work.status,'abandoned');add(w,town,'clay',1);next(w,8);assert.equal(town.resources.clay,1);assert.equal(w.planet.unlocks.education,20);check(g,warnings);
});

test('experiments and illness ground the later learning advances rather than repeated rolls or a priority alone',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town,warnings}=setup(g);w.planet.unlocks.education=60;assert.equal(w.readyEvent('unlockScientificMethod'),undefined);
 w.planet._paultendoLife.materialWork.push({id:'real:1',town:town.id,type:'glass',status:'failed',finished:29},{id:'real:2',town:town.id,type:'steel',status:'made',finished:30});assert.ok(w.readyEvent('unlockScientificMethod'));assert.equal(w.planet.unlocks.education,60);
 w.planet.unlocks.education=70;assert.equal(w.readyEvent('unlockMedicine'),undefined);town.jobs.doctor=1;town.influences.disease=0;assert.equal(w.readyEvent('unlockMedicine'),undefined);town.influences.disease=3;assert.ok(w.readyEvent('unlockMedicine'));assert.equal(w.planet.unlocks.education,70);check(g,warnings);
});

test('hidden town research changes no visible reports and does not reveal its maker',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town,warnings}=setup(g);town._hidden=true;add(w,town,'clay',1);const before=w.document.getElementById('logMessages').textContent,work=start(w,'unlockWriting');next(w,7);assert.equal(work.status,'learned');assert.equal(w.planet._paultendoLife.discoveries['education:30'].origin,town.id);assert.equal(w.document.querySelectorAll(`[data-story-kind="inquiry"][data-story-id="${work.id}"]`).length,0);assert.doesNotMatch(w.document.getElementById('logMessages').textContent,/trials for writing/);check(g,warnings);
});

test('knowledge work respects real building supplies and can use timber once an alternative meets construction needs',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town,warnings}=setup(g);w.planet.unlocks.education=30;add(w,town,'lumber',2);w.happen('Create',town,null,{type:'project',subtype:'school',cost:8},'process');const work=start(w,'unlockLibraries');next(w);
 assert.equal(work.status,'waiting');assert.equal(town.resources.lumber,2);assert.match(open(w,work).textContent,/Other work already needs/);add(w,town,'rock',4);next(w);assert.equal(work.status,'waiting','The obsolete workshop releases its timber later in this tick');next(w);assert.equal(work.status,'working',JSON.stringify({work,resources:town.resources,processes:w.regToArray('process'),material:w.planet._paultendoLife.materialWork}));assert.equal(town.resources.lumber || 0,0);assert.equal(town.resources.rock,4);assert.equal(w.planet.unlocks.education,30);check(g,warnings);
});

test('known alternative fuel supports real prototype work and a paid recipe remains fixed through reload',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town,warnings}=setup(g);town.jobs={miner:4,farmer:16};town.research={fire:100};Object.assign(w.planet.unlocks,{smith:30,fire:40});add(w,town,'brick',2);add(w,town,'coal',2);const work=start(w,'unlockForges');assert.deepEqual(plain(work.cost),{brick:2,coal:2});next(w);assert.equal(work.status,'working');assert.equal(town.resources.coal || 0,0);add(w,town,'charcoal',2);
 const restored=await makeGame({save:plain(w.generateSave())});t.after(restored.close);const rw=restored.window;quiet(rw);const resumed=rw.planet._paultendoLife.inquiries.find(r=>r.id===work.id);next(rw,10);assert.equal(resumed.status,'learned');assert.deepEqual(plain(resumed.cost),{brick:2,coal:2});assert.equal(rw.regGet('town',town.id).resources.charcoal,2);check(g,warnings);assert.deepEqual(restored.errors,[]);
});
