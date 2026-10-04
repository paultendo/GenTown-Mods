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
function click(w,text){const b=[...panel(w).querySelectorAll('[role="button"]')].find(e=>e.textContent===text);assert.ok(b,`${text}: ${panel(w).textContent}`);b.click();}
function pair(g){const w=g.window,a=settleGame(g);w.planet.day=30;const center=w.planet.chunks[a.center.join(',')],at=w.filterChunks(c=>!c.v.s&&c.v.g===center.v.g&&c.b!=='water'&&c.b!=='mountain').sort((x,y)=>Math.hypot(x.x-center.x,x.y-center.y)-Math.hypot(y.x-center.x,y.y-center.y))[0];const b=w.happen('Create',null,null,{x:at.x,y:at.y},'town');
 for(const [town,name] of [[a,'Claybank'],[b,'Farbank']]){town.name=name;town.pop=20;town.jobs={scholar:2,miner:4,farmer:14};town.resources={crop:1000};town.research={education:100};town.values={justice:6,openness:6};town._paultendoNextExchangeDay=99999;people(w,town);}b.research={military:100};a.relations[b.id]=5;b.relations[a.id]=5;Object.assign(w.planet.unlocks,{education:20,smith:20,fire:20,farm:10,trade:30});quiet(w);w.happen('Explore',null,null,{x:at.x,y:at.y});return {w,a,b};}
function start(w,town,event='unlockWriting'){const caller=w.readyEvent(event);assert.ok(caller,event);caller.args.value={town:town.id};assert.equal(w.gameEvents[event].check(caller.subject,caller.target,caller.args),true);w.doEvent(event,caller);const work=life(w).inquiries.at(-1);assert.equal(work.town,town.id);return work;}
function complete(w,work){for(let n=0;n<40&&['waiting','working'].includes(work.status);n++)next(w);assert.equal(work.status,'learned',JSON.stringify(work));}
function written(g){const state=pair(g),{w,a,b}=state;add(w,a,'clay',2);const work=start(w,a);complete(w,work);b.research={education:100};add(w,b,'clay',1);return {...state,work};}
function ask(w,b,a){b.resources.crop=0;w.gameEvents.townMarketPurchase.func(b,null,{seller:a,goodsType:'crop'});const request=life(w).exchanges.find(r=>r.buyer===b.id&&!r.resolved);assert.ok(request);for(let n=0;n<15&&request.status!=='carrying';n++)next(w);assert.equal(request.status,'carrying',JSON.stringify(request));return request;}
function arrive(w,request){for(let n=0;n<30&&!request.resolved;n++)next(w);assert.equal(request.status,'arrived',JSON.stringify(request));assert.ok(request.delivered>0);}
function errors(g){assert.deepEqual(g.errors,[]);}

test('two communities can work on the same question and a distant answer neither finishes nor benefits the other',async t=>{
 const g=await makeGame();t.after(g.close);const {w,a,b}=pair(g);b.research={education:100};add(w,a,'clay',1);add(w,b,'clay',1);const first=start(w,a);next(w);const second=start(w,b),before=b.influences.education || 0;complete(w,first);
 assert.equal(w.planet.unlocks.education,30);assert.equal(second.status,'working');assert.equal(second.remaining,1);assert.equal(b.influences.education || 0,before);assert.equal(b._paultendoLocalDiscoveries,undefined);assert.equal(b.valueHistory.some(x=>x.reason==='decision:unlockWriting:yes'),false);assert.equal(a._paultendoLocalDiscoveries['education:30'].inquiry,first.id);assert.equal(life(w).discoveries['education:30'].towns[b.id],undefined);
 complete(w,second);assert.equal(b._paultendoLocalDiscoveries['education:30'].inquiry,second.id);assert.equal(b.valueHistory.filter(x=>x.reason==='decision:unlockWriting:yes').length,2);assert.equal(w.planet.unlocks.education,30);assert.equal(life(w).discoveries['education:30'].origin,a.id);assert.equal(life(w).discoveries['education:30'].inquiry,first.id);assert.equal(a.resources.clay || 0,0);assert.equal(b.resources.clay || 0,0);assert.equal(w.readyEvent('unlockWriting'),undefined);errors(g);
});

test('a world milestone does not provide a town with the prerequisite for its next question',async t=>{
 const g=await makeGame();t.after(g.close);const {w,a,b,work}=written(g);assert.equal(w.gameEvents.unlockLibraries.check(w.regGet('player',1),null,{value:{town:b.id}}),false);assert.equal(w.gameEvents.unlockLibraries.check(w.regGet('player',1),null,{value:{town:a.id}}),true);
 w.openRegBrowser(b,'town');assert.equal([...w.document.querySelectorAll('.paultendoLifeDiscoveries button')].some(e=>e.textContent==='Writing'),false);const own=start(w,b);assert.notEqual(own.id,work.id);assert.equal(own.status,'waiting');assert.equal(b.resources.clay,1);errors(g);
});

test('a real shipment carries an account rather than free knowledge, and local trials spend their own supplies',async t=>{
 const g=await makeGame();t.after(g.close);const {w,a,b,work}=written(g),request=ask(w,b,a);assert.equal(request.knowledgeOffer.source,work.id);assert.equal(request.knowledgeOffer.withheld,false);assert.equal(b._paultendoLocalDiscoveries,undefined);assert.equal(life(w).inquiries.filter(x=>x.town===b.id).length,0);arrive(w,request);
 const response=request.knowledgeReception[b.id];assert.equal(response.status,'heard',JSON.stringify(request));const learner=life(w).inquiries.find(x=>x.id===response.inquiry);assert.equal(learner.guidance.source,work.id);assert.equal(learner.guidance.exchange,request.id);assert.equal(learner.status,'waiting');assert.equal(learner.days,4);assert.equal(b.resources.clay,1);assert.equal(b._paultendoLocalDiscoveries,undefined);
 next(w);assert.equal(learner.status,'working');assert.equal(b.resources.clay || 0,0);assert.equal(learner.remaining,4);complete(w,learner);assert.equal(b._paultendoLocalDiscoveries['education:30'].guidance.source,work.id);assert.equal(life(w).discoveries['education:30'].origin,a.id);assert.equal(w.planet.unlocks.education,30);errors(g);
});

test('a guarded maker can trade supplies while withholding the town’s new knowledge',async t=>{
 const g=await makeGame();t.after(g.close);const {w,a,b,work}=written(g);a._paultendoPeople.find(p=>p.id===work.person).outlook='guarded';const request=ask(w,b,a);assert.equal(request.knowledgeOffer.withheld,true);arrive(w,request);assert.ok(request.steps.some(s=>s.kind==='knowledgeWithheld'));assert.equal(request.knowledgeReception,undefined);assert.equal(b._paultendoLocalDiscoveries,undefined);assert.equal(life(w).inquiries.some(x=>x.town===b.id),false);assert.equal(b.resources.clay,1);errors(g);
});

test('an interrupted exchange teaches nothing before its actual arrival, including through reload',async t=>{
 const g=await makeGame();t.after(g.close);const {w,a,b}=written(g),request=ask(w,b,a),war=w.happen('Create',a,null,{type:'war',towns:[a.id,b.id]},'process');a.issues.war=war.id;b.issues.war=war.id;next(w,3);assert.equal(request.status,'waiting');assert.ok(request.steps.some(s=>s.kind==='blocked'));assert.equal(request.knowledgeReception,undefined);assert.equal(b._paultendoLocalDiscoveries,undefined);
 const restored=await makeGame({save:plain(w.generateSave())});t.after(restored.close);const rw=restored.window;quiet(rw);const rr=life(rw).exchanges.find(r=>r.id===request.id);next(rw,2);assert.equal(rr.knowledgeReception,undefined);rw.happen('Finish',null,rw.regGet('process',war.id));delete rw.regGet('town',a.id).issues.war;delete rw.regGet('town',b.id).issues.war;arrive(rw,rr);assert.equal(rr.knowledgeReception[b.id].status,'heard');assert.equal(rw.regGet('town',b.id)._paultendoLocalDiscoveries,undefined);errors(g);errors(restored);
});

test('learning retains its actual teacher, shipment and partial work across a saved game',async t=>{
 const g=await makeGame();t.after(g.close);const {w,a,b}=written(g),request=ask(w,b,a);arrive(w,request);const work=life(w).inquiries.find(x=>x.id===request.knowledgeReception[b.id].inquiry);next(w,2);const remaining=work.remaining;
 const restored=await makeGame({save:plain(w.generateSave())});t.after(restored.close);const rw=restored.window;quiet(rw);const copy=life(rw).inquiries.find(x=>x.id===work.id);assert.equal(copy.remaining,remaining);assert.deepEqual(plain(copy.guidance),plain(work.guidance));complete(rw,copy);const rb=rw.regGet('town',b.id);assert.equal(rb.resources.clay || 0,0);assert.equal(rb._paultendoLocalDiscoveries['education:30'].inquiry,copy.id);next(rw);assert.equal(life(rw).inquiries.filter(x=>x.town===b.id&&x.event==='unlockWriting').length,1);errors(g);errors(restored);
});

test('older shared knowledge stays available without inventing a local teacher or discovery date',async t=>{
 const g=await makeGame();t.after(g.close);const {w,a,b}=pair(g);w.planet.unlocks.education=30;const restored=await makeGame({save:plain(w.generateSave())});t.after(restored.close);const rw=restored.window;quiet(rw);rw.regGet('town',b.id).research={education:100};assert.equal(rw.gameEvents.unlockLibraries.check(rw.regGet('player',1),null,{value:{town:b.id}}),true);assert.equal(rw.readyEvent('unlockWriting'),undefined);assert.equal(rw.regGet('town',a.id)._paultendoLocalDiscoveries,undefined);assert.equal(rw.regGet('town',b.id)._paultendoLocalDiscoveries,undefined);errors(g);errors(restored);
});

test('a maker who leaves the occupation cannot send an account with the next shipment',async t=>{
 const g=await makeGame();t.after(g.close);const {w,a,b}=written(g);a.jobs.scholar=0;const request=ask(w,b,a);assert.equal(request.knowledgeOffer,null);arrive(w,request);assert.ok(request.delivered>0);assert.equal(b._paultendoLocalDiscoveries,undefined);assert.equal(life(w).inquiries.some(x=>x.town===b.id),false);errors(g);
});

test('visitors can help a waiting question without spending supplies or duplicating its worker',async t=>{
 const g=await makeGame();t.after(g.close);const {w,a,b,work}=written(g);b.resources.clay=0;const learner=start(w,b);const request=ask(w,b,a);arrive(w,request);assert.equal(request.knowledgeReception[b.id].inquiry,learner.id);assert.equal(learner.guidance.source,work.id);assert.equal(learner.days,4);assert.equal(learner.status,'waiting');assert.equal(life(w).inquiries.filter(x=>x.town===b.id).length,1);assert.equal(b._paultendoLocalDiscoveries,undefined);add(w,b,'clay',1);complete(w,learner);assert.equal(b.resources.clay || 0,0);errors(g);
});

test('reading a guided question and its linked journey cannot add days, lessons, supplies or random draws',async t=>{
 const g=await makeGame();t.after(g.close);const {w,a,b}=written(g),request=ask(w,b,a);arrive(w,request);const work=life(w).inquiries.find(x=>x.id===request.knowledgeReception[b.id].inquiry);const before=plain({work,request,resources:b.resources,knowledge:b._paultendoLocalDiscoveries,day:w.planet.day});const random=w.Math.random;let draws=0;w.Math.random=()=>{draws++;return random();};
 const open=()=>{const entry=w.document.querySelector(`[data-story-id="${work.id}"]`);assert.ok(entry);entry.querySelector('.paultendoChronicleStoryLink').click();};open();assert.match(panel(w).textContent,/They still need to try it here/);click(w,'The visitors who brought the idea');assert.match(panel(w).textContent,/Writing/);click(w,'Writing · The work begun here');click(w,'The work they learned from');assert.match(panel(w).textContent,/work leads to writing/);open();
 assert.equal(draws,0);assert.deepEqual(plain({work,request,resources:b.resources,knowledge:b._paultendoLocalDiscoveries,day:w.planet.day}),before);errors(g);
});

test('a distant precision milestone cannot enable a town’s flight preparation without local knowledge',async t=>{
 const g=await makeGame();t.after(g.close);const {w,a,b}=pair(g);Object.assign(w.planet.unlocks,{education:70,smith:80,fire:70,travel:100,astronomy:20});w.planet._paultendoLocalKnowledge={'smith:80':{key:'smith',level:80,before:70}};a._paultendoLocalDiscoveries={'smith:80':{day:w.planet.day,inquiry:'source-precision'}};for(const town of [a,b]){town.resources.crop=1000;town._paultendoPeople.find(p=>p.role==='scholar').outlook='steadfast';}
 w.document.getElementById('actionItem-solar').click();const actions=[...panel(w).querySelectorAll('[role="button"]')].filter(e=>e.textContent.includes('prepare a survey satellite'));assert.equal(actions.length,1);assert.ok(actions[0].textContent.includes(a._paultendoPeople.find(p=>p.role==='scholar').name));actions[0].click();assert.equal(w.planet._paultendoSky.flights[0].town,a.id);assert.equal(w.planet._paultendoSky.flights.some(f=>f.town===b.id),false);errors(g);
});

test('a guarded listener may accept the grain and decline the idea, with the answer retained through reload',async t=>{
 const g=await makeGame();t.after(g.close);const {w,a,b}=written(g);w.planet.config.seed='refuse-account';b._paultendoPeople.find(p=>p.role==='scholar').outlook='guarded';const request=ask(w,b,a);arrive(w,request);assert.equal(request.knowledgeReception[b.id].status,'refused',JSON.stringify(request.knowledgeReception));assert.ok(request.delivered>0);assert.ok(request.steps.some(s=>s.kind==='knowledgeDeclined'));assert.equal(life(w).inquiries.some(x=>x.town===b.id),false);assert.equal(b.resources.clay,1);
 const restored=await makeGame({save:plain(w.generateSave())});t.after(restored.close);assert.equal(life(restored.window).exchanges.find(x=>x.id===request.id).knowledgeReception[b.id].status,'refused');assert.equal(restored.window.regGet('town',b.id)._paultendoLocalDiscoveries,undefined);errors(g);errors(restored);
});
