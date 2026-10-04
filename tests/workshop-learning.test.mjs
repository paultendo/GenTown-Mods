import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGame,settleGame} from './harness.mjs';
const life=w=>w.planet._paultendoLife;
const plain=x=>JSON.parse(JSON.stringify(x));
const panel=w=>w.document.getElementById('actionSubList');
function click(w,text){const button=[...panel(w).querySelectorAll('[role="button"]')].find(e=>e.textContent.includes(text));assert.ok(button,`${text}: ${panel(w).textContent}`);button.click();}
// Keep the workforce alive while testing shortages and apprenticeship progress.
function controlled(w){for(const id of ['townEat','townFarm','townTame','townMine','townLumber','townBirth','townDeath','townExpand','townEmploy','townEconomyTick','townTax'])if(w.gameEvents[id]){if(w.gameEvents[id].func)w.gameEvents[id].func=()=>{};if(w.gameEvents[id].perChunk)w.gameEvents[id].perChunk=()=>{};}w.gameEvents.processAll.func=()=>{};}
function next(w){const choose=w.chooseEvent;w.chooseEvent=()=>null;try{w.nextDay();}finally{w.chooseEvent=choose;}}
function add(w,town,type,count){w.happen('AddResource',null,town,{type,count});}
function people(w,town){w.openRegBrowser(town,'town');[...w.document.querySelectorAll('.paultendoTownLife button')].find(e=>e.textContent==='Meet the people').click();for(const p of town._paultendoPeople){p.outlook='curious';p.trust=90;}}
function pair(g){const w=g.window,seller=settleGame(g);w.planet.day=10;const center=w.planet.chunks[seller.center.join(',')],chunk=w.filterChunks(c=>!c.v.s&&c.v.g===center.v.g&&c.b!=='water'&&c.b!=='mountain').sort((a,b)=>Math.hypot(a.x-center.x,a.y-center.y)-Math.hypot(b.x-center.x,b.y-center.y))[0];const buyer=w.happen('Create',null,null,{x:chunk.x,y:chunk.y},'town');for(const [town,name] of [[seller,'Ashbank'],[buyer,'Wick']]){town.name=name;town.pop=20;town.resources={crop:2000,cash:0};town.jobs={};town.values={justice:6,openness:6};town.research={farm:100};town.legal.farm=false;town.guidanceTrust=90;town._paultendoNextExchangeDay=9999;}seller.jobs={miner:20};buyer.jobs={doctor:20};Object.assign(w.planet.unlocks,{fire:50,smith:50,education:20,trade:30});controlled(w);people(w,seller);people(w,buyer);return {w,seller,buyer};}
function lens(w,buyer){buyer.resources.metal=2;people(w,buyer);click(w,'Doctor');click(w,'Make something of your own');click(w,'Make a clear lens');const voice=life(w).whispers.at(-1);voice.roll=0;w.planet.day=voice.due-1;next(w);return life(w).artifactWork.at(-1);}
function masterGlass(w,seller){add(w,seller,'sand',3);add(w,seller,'charcoal',2);seller.resources.rock=1;next(w);const first=life(w).materialWork.find(x=>x.town===seller.id&&x.type==='glass');assert.ok(first);first.roll=.99;for(let n=0;n<20&&first.status!=='made';n++)next(w);assert.equal(first.status,'made');w.happen('RemoveResource',null,seller,{type:'glass',count:2});w.planet.day+=8;add(w,seller,'sand',3);add(w,seller,'charcoal',2);seller.resources.rock=1;return first;}
function ask(w,buyer,seller){w.gameEvents.townMarketPurchase.func(buyer,null,{seller,goodsType:'glass'});const request=life(w).exchanges.find(r=>r.buyer===buyer.id&&!r.resolved);assert.ok(request);w.planet.day=request.due-1;next(w);return request;}
function finish(w,request){for(let n=0;n<35&&!request.resolved;n++)next(w);assert.equal(request.status,'arrived',JSON.stringify(request));}
function errors(g){assert.deepEqual(g.errors,[]);}

function prepare(g,{sharing=true,secondHand=true}={}) {
 const pairState=pair(g),{w,seller,buyer}=pairState,first=masterGlass(w,seller);
 seller.jobs=secondHand?{miner:19,scholar:1}:{miner:1};people(w,seller);
 const teacher=seller._paultendoPeople.find(p=>p.id===first.person);
 if(!sharing)teacher.outlook='guarded';
 lens(w,buyer);const request=ask(w,buyer,seller),batch=life(w).materialWork.find(x=>x.id===request.manufacture.work);
 assert.equal(request.status,'making');assert.equal(batch.trial,false);
 return {...pairState,first,teacher,request,batch,learner:seller._paultendoPeople.find(p=>p.id===batch.apprentice?.person)};
}
function batchLog(w,batch){const entry=w.document.querySelector(`[data-story-id="${batch.id}"]`);assert.ok(entry);entry.querySelector('.paultendoChronicleStoryLink').click();}
function extraBuyer(w,seller) {
 const c=w.planet.chunks[seller.center.join(',')],at=w.filterChunks(x=>!x.v.s&&x.v.g===c.v.g&&x.b!=='water'&&x.b!=='mountain').sort((a,b)=>Math.hypot(a.x-c.x,a.y-c.y)-Math.hypot(b.x-c.x,b.y-c.y))[0];
 const buyer=w.happen('Create',null,null,{x:at.x,y:at.y},'town');buyer.name='Farbank';buyer.pop=20;buyer.jobs={doctor:20};buyer.resources={crop:1000,metal:2};buyer.values={justice:6,openness:6};buyer.legal.farm=false;buyer.guidanceTrust=90;buyer._paultendoNextExchangeDay=99999;
 w.happen('Explore',null,null,{x:at.x,y:at.y});lens(w,buyer);return buyer;
}

test('an actual maker teaches a second employed hand on paid-for work, with no free goods, discoveries or immediate mastery',async t=>{
 const g=await makeGame();t.after(g.close);const {w,seller,first,request,batch,teacher,learner}=prepare(g);assert.ok(learner);
 assert.equal(batch.apprentice.teacher,teacher.id);assert.equal(batch.apprentice.source,first.id);assert.equal(batch.apprentice.days,0);
 assert.equal(seller._paultendoMaterials.glass.hands[learner.id],undefined);assert.equal(seller.resources.glass || 0,0);
 const knowledge=plain(w.planet.unlocks),remaining=batch.remaining;next(w);assert.equal(batch.apprentice.days,1);assert.equal(batch.remaining,remaining-1);
 finish(w,request);assert.equal(batch.status,'made');assert.equal(batch.apprentice.days,batch.apprentice.needed);assert.ok(batch.apprentice.learned);
 const learned=seller._paultendoMaterials.glass.hands[learner.id];assert.equal(learned.work,batch.id);assert.equal(learned.teacher,teacher.id);assert.equal(learned.source,first.id);
 assert.equal(seller.resources.glass+request.delivered,2);assert.equal(seller.resources.sand || 0,0);assert.equal(seller.resources.charcoal || 0,0);assert.equal(seller.resources.rock || 0,0);
 assert.deepEqual(plain(w.planet.unlocks),knowledge);batchLog(w,batch);assert.match(panel(w).textContent,/passed the method on/);errors(g);
});

test('hunger and fighting pause both production and lessons, with saved progress and no second input charge',async t=>{
 const g=await makeGame();t.after(g.close);const {w,seller,buyer,request,batch,learner}=prepare(g);next(w);const days=batch.apprentice.days,remaining=batch.remaining,stocks=plain(seller.resources);
 seller.resources.crop=0;buyer.resources.crop=0;for(let n=0;n<3;n++)next(w);assert.equal(batch.apprentice.days,days);assert.equal(batch.remaining,remaining);
 seller.resources.crop=1000;buyer.resources.crop=1000;const war=w.happen('Create',seller,null,{type:'war',towns:[seller.id,buyer.id]},'process');seller.issues.war=war.id;next(w);assert.equal(batch.apprentice.days,days);assert.equal(batch.remaining,remaining);
 const restored=await makeGame({save:plain(w.generateSave())});t.after(restored.close);const rw=restored.window;controlled(rw);rw.chooseEvent=()=>null;
 const copy=life(rw).materialWork.find(x=>x.id===batch.id),rs=rw.regGet('town',seller.id),rr=life(rw).exchanges.find(x=>x.id===request.id);assert.equal(copy.apprentice.days,days);
 rw.happen('Finish',null,rw.regGet('process',war.id));delete rs.issues.war;delete rw.regGet('town',buyer.id).issues.war;
 finish(rw,rr);assert.equal(copy.apprentice.days,copy.apprentice.needed);assert.ok(rs._paultendoMaterials.glass.hands[learner.id]);
 assert.equal(rs.resources.sand || 0,stocks.sand || 0);assert.equal(rs.resources.charcoal || 0,stocks.charcoal || 0);assert.equal(rs.resources.rock || 0,stocks.rock || 0);
 const learned=plain(rs._paultendoMaterials.glass.hands[learner.id]);next(rw);assert.deepEqual(plain(rs._paultendoMaterials.glass.hands[learner.id]),learned);errors(g);errors(restored);
});

test('a learner who leaves the work before it finishes gains no mastery while the maker still finishes the goods',async t=>{
 const g=await makeGame();t.after(g.close);const {w,seller,request,batch,learner}=prepare(g);next(w);assert.equal(batch.apprentice.days,1);seller.jobs.scholar=0;
 finish(w,request);assert.equal(batch.status,'made');assert.equal(batch.apprentice.days,1);assert.equal(batch.apprentice.learned,undefined);assert.equal(seller._paultendoMaterials.glass.hands[learner.id],undefined);
 assert.equal(batch.steps.filter(s=>s.text.includes('lesson must wait')).length,1);assert.equal(request.delivered,1);errors(g);
});

test('guarded makers and a single available hand cannot create an apprenticeship',async t=>{
 for(const options of [{sharing:false},{secondHand:false}]){const g=await makeGame();t.after(g.close);const {w,seller,request,batch}=prepare(g,options);assert.equal(batch.apprentice,undefined);const names=seller._paultendoPeople.length;finish(w,request);assert.equal(Object.keys(seller._paultendoMaterials.glass.hands).length,1);assert.equal(seller._paultendoPeople.length,names);errors(g);}
});

test('a trained successor can fulfil a real order and share the method after the first maker leaves that work',async t=>{
 const g=await makeGame();t.after(g.close);const {w,seller,first,request,batch,learner}=prepare(g);finish(w,request);
 seller.jobs.miner=0;assert.ok(seller._paultendoMaterials.glass.hands[learner.id]);w.happen('RemoveResource',null,seller,{type:'glass',count:seller.resources.glass || 0});w.planet.day+=8;
 add(w,seller,'sand',3);add(w,seller,'charcoal',2);seller.resources.rock=1;const buyer=extraBuyer(w,seller),order=ask(w,buyer,seller);
 assert.equal(order.status,'making');const successor=life(w).materialWork.find(x=>x.id===order.manufacture.work);assert.equal(successor.person,learner.id);assert.equal(successor.trial,false);assert.equal(seller._paultendoMaterials.glass.technique.work,first.id,'The first maker’s history stays intact');
 finish(w,order);assert.equal(order.materialLesson.person,learner.id);assert.equal(order.materialLesson.origin,batch.id);assert.equal(order.delivered,1);errors(g);
});

test('an untrained replacement must try the method and can fail with actual spent inputs despite the town’s old practice',async t=>{
 const g=await makeGame();t.after(g.close);const {w,seller}=pair(g),first=masterGlass(w,seller);seller.jobs={scholar:1,doctor:19};people(w,seller);lens(w,seller);
 const batch=life(w).materialWork.findLast(x=>x.town===seller.id&&x.type==='glass');assert.notEqual(batch.id,first.id);assert.equal(batch.trial,true);batch.roll=0;
 for(let n=0;n<20&&['waiting','working'].includes(batch.status);n++)next(w);
 assert.equal(batch.status,'failed');assert.equal(seller.resources.glass || 0,0);assert.equal(seller._paultendoMaterials.glass.hands[batch.person],undefined);assert.equal(seller._paultendoMaterials.glass.technique.work,first.id);assert.equal(seller.resources.sand || 0,0);errors(g);
});

test('reading the work and its named method holders adds no lesson time, knowledge or simulation randomness',async t=>{
 const g=await makeGame();t.after(g.close);const {w,seller,request,batch,learner}=prepare(g);next(w);const days=batch.apprentice.days,day=w.planet.day,old=w.Math.random;let rolls=0;w.Math.random=()=>{rolls++;return old();};
 batchLog(w,batch);batchLog(w,batch);assert.match(panel(w).textContent,/learning at the bench/);assert.equal(batch.apprentice.days,days);assert.equal(w.planet.day,day);assert.equal(rolls,0);w.Math.random=old;
 finish(w,request);w.openRegBrowser(seller,'town');[...w.document.querySelectorAll('.paultendoTownLife button')].find(b=>b.textContent==='Materials and workshops').click();click(w,'Who can make it?');assert.match(panel(w).textContent,new RegExp(learner.name));assert.match(panel(w).textContent,/Learned beside/);click(w,'See the work they learned from');assert.match(panel(w).textContent,/finishes glass|wants to try/);errors(g);
});

test('hidden apprentices can learn without revealing their maker, name or method in the visible Chronicle',async t=>{
 const g=await makeGame();t.after(g.close);const {w,seller,request,batch,learner}=prepare(g);seller._hidden=true;
 const before=[...w.document.querySelectorAll(`[data-story-id="${batch.id}"]`)].length;finish(w,request);assert.ok(seller._paultendoMaterials.glass.hands[learner.id]);
 assert.equal([...w.document.querySelectorAll(`[data-story-id="${batch.id}"]`)].length,before);assert.equal(request.known[seller.id],true,'Already known names remain remembered');
 const newLogs=[...w.document.querySelectorAll(`[data-story-id="${request.id}"]`)].filter(e=>e.textContent.includes('lesson'));assert.equal(newLogs.some(e=>e.textContent.includes(learner.name)),false);errors(g);
});

test('a working apprentice cannot also begin native research, and becomes available after the actual lesson ends',async t=>{
 const g=await makeGame();t.after(g.close);const {w,seller,request,batch,learner}=prepare(g);seller.research={education:100};w.planet.unlocks.farm=10;add(w,seller,'clay',1);
 assert.equal(w.readyEvent('unlockWriting'),undefined);assert.equal(life(w).inquiries.length,0);
 finish(w,request);assert.ok(batch.apprentice.learned);const caller=w.readyEvent('unlockWriting');assert.ok(caller);w.doEvent('unlockWriting',caller);
 const research=life(w).inquiries.at(-1);assert.equal(research.person,learner.id);next(w);assert.equal(research.status,'working');assert.equal(research.remaining,6);errors(g);
});

test('apprenticeships continue on an inactive world and visiting adds no extra day of learning',async t=>{
 const g=await makeGame();t.after(g.close);const {w,seller,batch,learner}=prepare(g);
 function visit(id){w.document.getElementById('actionItem-solar').click();w.document.querySelector(`[data-world-id="${id}"]`).click();click(w,'Switch to world');}
 const world=w._paultendoUniverse.worlds[1],away=w._paultendoUniverse.worlds[2];away.discovered=true;away.reached=true;visit(2);
 const start=batch.apprentice.days;for(let n=0;n<10&&batch.status==='working';n++)next(w);
 const copy=world.state.planet._paultendoLife.materialWork.find(x=>x.id===batch.id);assert.equal(copy.status,'made');assert.ok(copy.apprentice.learned);assert.ok(copy.apprentice.days>start);
 const days=copy.apprentice.days;visit(1);const restored=w.regGet('town',seller.id);assert.ok(restored._paultendoMaterials.glass.hands[learner.id]);assert.equal(copy.apprentice.days,days);next(w);assert.equal(copy.apprentice.days,days);errors(g);
});
