import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGame,settleGame} from './harness.mjs';
const plain=x=>JSON.parse(JSON.stringify(x));
function quiet(w) {
 for(const id of ['townFarm','townTame','townMine','townLumber','townBirth','townDeath','townExpand','townEmploy','townEat','townEconomyTick','townTax','doResearch','governmentHarmony','paultendoSynergyPulse','seasonalInfluences','warPressureDynamics']) {
  if(w.gameEvents[id].func)w.gameEvents[id].func=()=>{};
  if(w.gameEvents[id].perChunk)w.gameEvents[id].perChunk=()=>{};
 }
 w.gameEvents.processAll.func=()=>{};w.chooseEvent=()=>null;
}
function start(w,a,b) {
 const war=w.happen('Create',a,null,{type:'war',towns:[a.id,b.id]},'process');
 war.sides=[[a.id],[b.id]];war.start=w.planet.day;war._paultendoEarlyDuration=14;
 a.issues.war=b.issues.war=war.id;a.relations[b.id]=b.relations[a.id]=-10;
 return war;
}
function setup(g,{early=false,war=true,gap=0}={}) {
 const w=g.window,a=settleGame(g);w.planet.day=30;
 Object.assign(w.planet.unlocks,{farm:20,smith:10,trade:10,travel:20,military:early?0:50});
 const center=w.planet.chunks[a.center.join(',')];
 const at=w.filterChunks(c=>!c.v.s&&c.v.g===center.v.g&&c.b!=='water'&&c.b!=='mountain'&&Math.hypot(c.x-center.x,c.y-center.y)>=gap).sort((x,y)=>Math.hypot(x.x-center.x,x.y-center.y)-Math.hypot(y.x-center.x,y.y-center.y))[0];
 const b=w.happen('Create',null,null,{x:at.x,y:at.y},'town');
 for(const [town,name] of [[a,'Ashbank'],[b,'Wick']]) {
  w.happen('Explore',null,null,{x:town.center[0],y:town.center[1]});
  town.name=name;town.start=1;town.pop=80;town.jobs={soldier:40,farmer:40};town.resources={crop:800};town.influences.hunger=0;town._paultendoNextExchangeDay=99999;
  const c=w.planet.chunks[town.center.join(',')];
  for(const chunk of w.filterChunks(x=>!x.v.s&&x.v.g===c.v.g&&x.b!=='water'&&x.b!=='mountain').sort((x,y)=>Math.hypot(x.x-c.x,x.y-c.y)-Math.hypot(y.x-c.x,y.y-c.y)).slice(0,20)){chunk.v.s=town.id;town.size++;}
  w.happen('UpdateCenter',null,town);
 }
 b.jobs={farmer:80};const warTick=w.gameEvents.warPressureDynamics.func;quiet(w);return {w,a,b,warTick,war:war?start(w,a,b):null};
}
function roll(w,value,fn){const old=w.Math.random;w.Math.random=()=>value;try{return fn();}finally{w.Math.random=old;}}
function fight(w,war){let calls=0;const old=w.Math.random;w.Math.random=()=>++calls<25?.01:.999;try{w.metaEvents.processWar.func(war);}finally{w.Math.random=old;}}
function due(w,r){w.planet.day=Math.max(w.planet.day,r.due-1);w.nextDay();}
function shipment(w,a){return w.planet._paultendoLife.exchanges.find(r=>r.kind==='seizure'&&r.buyer===a.id);}
function check(g){assert.deepEqual(g.errors,[]);}


function next(w,n=1){for(let i=0;i<n;i++)w.nextDay();}
function seek(w,a,b,type){w.gameEvents.townMarketPurchase.func(a,null,{seller:b,goodsType:type});const request=w.planet._paultendoLife.exchanges.find(r=>r.buyer===a.id&&!r.resolved);assert.ok(request);due(w,request);return request;}
function building(g,{relations=-5}={}){
 const pair=setup(g,{war:false}),{w,a,b}=pair;a.gov='monarchy';b.gov='commune';a.values={order:6,justice:-4};b.values={justice:0,openness:-6};a.relations[b.id]=b.relations[a.id]=relations;b.resources.lumber=30;
 Object.assign(w.planet.unlocks,{education:10,smith:20});const project=w.happen('Create',a,null,{type:'project',subtype:'school',cost:20},'process');return {...pair,project};
}
function refused(g,options){const pair=building(g,options),{w,a,b}=pair,r=seek(w,a,b,'lumber');assert.equal(r.status,'refused');assert.equal(r.threat,undefined);assert.equal(r.shortage.days,1);return {...pair,r};}
function threat(w,r){next(w,3);assert.equal(r.threat,true,JSON.stringify(r));assert.equal(r.steps.filter(s=>s.kind==='threat').length,1);}
function cause(w,a,b){return roll(w,0,()=>start(w,a,b));}
function finishCargo(w,r){for(let n=0;n<15&&!r.resolved;n++)due(w,r);assert.equal(r.status,'arrived',JSON.stringify(r));}
function hasSupplyCause(w,a,b){return cause(w,a,b).cause.id==='supplies';}

test('four actual days of refused timber for the same school can prompt a coercive ruler, with one warning and no free materials',async t=>{
 const g=await makeGame();t.after(g.close);const {w,a,b,project,r}=refused(g),stocks=plain([a.resources,b.resources]);next(w,2);assert.equal(r.threat,undefined);assert.equal(r.shortage.days,3);threat(w,r);
 assert.equal(r.dispute.need.kind,'work');assert.ok(r.dispute.need.purposes.some(p=>p.kind==='construction'&&p.id===project.id));assert.equal(r.dispute.need.count,20);assert.equal(r.dispute.motive.kind,'taking');assert.ok(r.dispute.values.justice<=-2);assert.deepEqual(plain([a.resources,b.resources]),stocks);
 assert.equal(w.regToArray('process').some(p=>p.type==='war'&&!p.done),false);const relation=a.relations[b.id];next(w);assert.equal(a.relations[b.id],relation);assert.equal(r.steps.filter(s=>s.kind==='threat').length,1);
 const war=cause(w,a,b);assert.equal(war.cause.id,'supplies');assert.equal(war.cause.type,'lumber');assert.equal(war.cause.source,r.id);assert.equal(war.objective.label,'timber for unfinished work');check(g);
});

test('a brief or interrupted shortage, substituted supplies and cancelled work cannot produce a supply threat',async t=>{
 for(const mode of ['brief','substitute','cancel','other']){
  const g=await makeGame();t.after(g.close);const {w,a,b,project,r}=refused(g);
  if(mode==='brief'){next(w,2);a.resources.lumber=20;}
  if(mode==='substitute')a.resources.rock=10;
  if(mode==='cancel')w.happen('Finish',null,project);
  if(mode==='other'){w.happen('Finish',null,project);w.happen('Create',a,null,{type:'project',subtype:'temple',cost:20},'process');}
  next(w,4);assert.equal(r.threat,undefined,mode);assert.equal(r.shortage,undefined,mode);assert.equal(hasSupplyCause(w,a,b),false,mode);check(g);
 }
 const g=await makeGame();t.after(g.close);const {w,a,r}=refused(g);next(w,2);a.resources.lumber=20;next(w);a.resources.lumber=0;next(w,2);assert.equal(r.threat,undefined);assert.equal(r.shortage.days,2);check(g);
});

test('the same persistent refusal has different consequences under restraint, ambition, faith or force',async t=>{
 for(const mode of ['restraint','no-soldiers','anarchy','no-order','pacifism','ambition','militant']){
  const g=await makeGame();t.after(g.close);const {w,a,b,r}=refused(g);a.values={order:6,justice:0,wealth:0};
  if(mode==='no-soldiers')a.jobs.soldier=0;
  if(mode==='anarchy')a.gov='anarchy';
  if(mode==='no-order')a.values.order=0;
  if(mode==='ambition')a.values.wealth=6;
  if(mode==='pacifism'||mode==='militant'){a.values.justice=-4;a.influences.faith=6;w.planet.religions=[{id:1,name:'The Quiet Faith',influences:{},members:[a.id],tenets:[mode==='pacifism'?'pacifism':'militarism'],extinct:false}];a.religion=1;}
  next(w,4);assert.equal(!!r.threat,['ambition','militant'].includes(mode),mode);
  if(r.threat)assert.equal(r.dispute.motive.kind,mode==='ambition'?'ambition':'faith');
  assert.equal(a.resources.lumber || 0,0);assert.equal(b.resources.lumber,30);check(g);
 }
});

test('one refusal between friendly neighbours and old denials of a different material cannot earn coercion',async t=>{
 const g=await makeGame();t.after(g.close);const {w,a,b,r}=refused(g,{relations:0});next(w,4);assert.equal(r.threat,undefined);assert.equal(a.relations[b.id],0);assert.equal(hasSupplyCause(w,a,b),false);check(g);
 const other=await makeGame();t.after(other.close);const state=building(other,{relations:0}),{w:rw,a:ra,b:rb}=state;rb.resources.rock=20;const old=seek(rw,ra,rb,'rock');assert.equal(old.status,'refused');next(rw,4);const second=seek(rw,ra,rb,'lumber');next(rw,4);assert.equal(second.threat,undefined);assert.equal(ra._paultendoExchangeMemory[rb.id].refused,2);check(other);
});

test('two refusals of supplies for the same unfinished work can sour a previously neutral relationship',async t=>{
 const g=await makeGame();t.after(g.close);const {w,a,b,r}=refused(g,{relations:0});next(w,4);assert.equal(r.threat,undefined);const second=seek(w,a,b,'lumber');next(w,3);assert.equal(second.threat,true,JSON.stringify(second));assert.ok(a.relations[b.id]<0);assert.equal(r.threat,undefined);assert.equal(second.dispute.need.purposes[0].id,r.purposes[0].id);check(g);
});

test('an unmet request carries its observed days through reload, and reading its history adds no time or coercion',async t=>{
 const g=await makeGame();t.after(g.close);const {w,a,b,r}=refused(g);next(w);const saved=plain(w.generateSave()),days=r.shortage.days,day=w.planet.day;
 const restored=await makeGame({save:saved});t.after(restored.close);const rw=restored.window;quiet(rw);const copy=rw.planet._paultendoLife.exchanges.find(x=>x.id===r.id);assert.equal(copy.shortage.days,days);assert.equal(rw.planet.day,day);assert.equal(copy.threat,undefined);
 const before=plain({record:copy,day:rw.planet.day,relations:rw.regGet('town',a.id).relations});let draws=0;const random=rw.Math.random;rw.Math.random=()=>{draws++;return random();};
 rw.document.querySelector(`[data-story-id="${copy.id}"] .paultendoChronicleStoryLink`).click();assert.match(rw.document.getElementById('actionSubList').textContent,/Wick refuses|keeps its stores/);rw.Math.random=random;assert.equal(draws,0);assert.deepEqual(plain({record:copy,day:rw.planet.day,relations:rw.regGet('town',a.id).relations}),before);
 next(rw,2);assert.equal(copy.threat,true);assert.equal(copy.steps.filter(s=>s.kind==='threat').length,1);next(rw);assert.equal(copy.steps.filter(s=>s.kind==='threat').length,1);check(g);check(restored);
});

test('missing days do not invent sustained frustration, and filled needs or empty target stores invalidate an earlier threat',async t=>{
 const g=await makeGame();t.after(g.close);const {w,a,b,r}=refused(g);w.planet.day+=2;next(w);assert.equal(r.shortage.days,1);assert.equal(r.threat,undefined);check(g);
 for(const mode of ['supplied','empty','stale','future','cancelled']){const run=await makeGame();t.after(run.close);const state=refused(run),{w:rw,a:ra,b:rb,project,r:record}=state;threat(rw,record);if(mode==='supplied')ra.resources.lumber=20;if(mode==='empty')rb.resources.lumber=0;if(mode==='stale')rw.planet.day+=9;if(mode==='future')rw.planet.day-=1;if(mode==='cancelled')rw.happen('Finish',null,project);assert.equal(hasSupplyCause(rw,ra,rb),false,mode);check(run);}
});

test('changed beliefs or lost military capacity remove the current supply motive without rewriting the old warning',async t=>{
 for(const mode of ['restraint','pacifism','soldiers']){
  const g=await makeGame();t.after(g.close);const {w,a,b,r}=refused(g);threat(w,r);const past=plain(r.dispute);
  if(mode==='restraint')a.values={order:6,justice:6,wealth:0};
  if(mode==='soldiers')a.jobs.soldier=0;
  if(mode==='pacifism'){a.influences.faith=6;a.religion=1;w.planet.religions=[{id:1,name:'The Quiet Faith',influences:{},members:[a.id],tenets:['pacifism'],extinct:false}];}
  assert.equal(hasSupplyCause(w,a,b),false,mode);assert.deepEqual(plain(r.dispute),past);assert.equal(r.steps.filter(s=>s.kind==='threat').length,1);check(g);
 }
});

test('a known fuel alternative can release the shortage behind a refused request while the actual trials continue',async t=>{
 const g=await makeGame();t.after(g.close);const {w,a,b}=setup(g,{war:false});a.gov='monarchy';b.gov='commune';a.values={order:6,justice:-4};b.values={justice:0,openness:-6};a.relations[b.id]=b.relations[a.id]=-5;
 Object.assign(w.planet.unlocks,{military:80,smith:50,fire:60});a.resources.steel=4;b.resources.charcoal=20;a.research={military:100};
 const caller=w.readyEvent('unlockArtillery');assert.ok(caller);caller.args.value={town:a.id};w.doEvent('unlockArtillery',caller);const work=w.planet._paultendoLife.inquiries.at(-1),r=seek(w,a,b,'charcoal');
 assert.equal(r.status,'refused');next(w,2);assert.equal(r.shortage.days,3);assert.equal(r.threat,undefined);
 w.happen('AddResource',null,a,{type:'coal',count:2});assert.ok(a._paultendoMaterials.coal);next(w);
 assert.equal(work.status,'working',JSON.stringify(work));assert.deepEqual(plain(work.cost),{steel:4,coal:2});assert.equal(a.resources.coal || 0,0);assert.equal(a.resources.steel || 0,0);assert.equal(work.status==='learned',false);assert.equal(w.planet.unlocks.military,80);assert.equal(r.shortage,undefined);assert.equal(r.threat,undefined);assert.equal(hasSupplyCause(w,a,b),false);check(g);
});

test('a supply warning shows native coloured flags in Today and leads to the actual motive and unfinished work without advancing time',async t=>{
 const g=await makeGame();t.after(g.close);const {w,a,b,r}=refused(g);a.flag='{{color:><|#f47759|#554aff}}';b.flag='{{color:XX|#f2d763|#244878}}';threat(w,r);await new Promise(resolve=>setTimeout(resolve,40));
 const news=w.document.getElementById('paultendoChronicleHighlights'),item=[...news.querySelectorAll('.paultendoChronicleHeadline')].find(e=>/threatens/.test(e.textContent)) || news;
 assert.match(item.textContent,/Timber:.*Ashbank.*threatens.*Wick/);const flags=item.querySelectorAll('.entityName .font2');assert.equal(flags.length,2);assert.equal(flags[0].style.backgroundColor,'rgb(85, 74, 255)');assert.equal(flags[1].style.backgroundColor,'rgb(36, 72, 120)');
 assert.equal([...w.document.querySelectorAll('.logMessage')].some(entry=>Number(entry.querySelector('.logDay')?.dataset.day)===w.planet.day&&entry.querySelector('.logText')?.textContent==='An uneventful day.'),false);
 const before=plain({day:w.planet.day,record:r,stocks:[a.resources,b.resources],relations:a.relations});let draws=0;const random=w.Math.random;w.Math.random=()=>{draws++;return random();};item.querySelector('.paultendoChronicleRead').click();
 const panel=w.document.getElementById('actionSubList');assert.match(panel.textContent,/rulers are willing to take/);assert.ok([...panel.querySelectorAll('[role="button"]')].find(e=>e.textContent==='See the school'));
 w.Math.random=random;assert.equal(draws,0);assert.deepEqual(plain({day:w.planet.day,record:r,stocks:[a.resources,b.resources],relations:a.relations}),before);check(g);
});

function military(g){
 const pair=setup(g,{war:false}),{w,a,b}=pair;a.gov='monarchy';b.gov='commune';a.values={order:6,justice:0,wealth:0};b.values={justice:0,openness:-6};a.relations[b.id]=b.relations[a.id]=-5;
 Object.assign(w.planet.unlocks,{military:80,smith:50,fire:60});a.resources.charcoal=2;b.resources.steel=8;a.research={military:100};
 const caller=w.readyEvent('unlockArtillery');assert.ok(caller);caller.args.value={town:a.id};w.doEvent('unlockArtillery',caller);const work=w.planet._paultendoLife.inquiries.at(-1);assert.equal(work.status,'waiting');
 const r=seek(w,a,b,'steel');assert.equal(r.status,'refused');assert.equal(r.threat,undefined);return {...pair,r,work};
}

test('material needed for military trials can motivate a supply war and is carried, used and learned locally with the theft remembered',async t=>{
 const g=await makeGame();t.after(g.close);const {w,a,b,r,work}=military(g);threat(w,r);assert.equal(r.dispute.motive.kind,'military');assert.equal(w.planet.unlocks.military,80);
 const war=cause(w,a,b);assert.equal(war.cause.id,'supplies');assert.equal(war.cause.type,'steel');const stock=b.resources.steel;fight(w,war);const taken=shipment(w,a);assert.ok(taken);assert.equal(taken.type,'steel');assert.equal(taken.cause,r.id);assert.equal(taken.cargo,4);assert.equal(b.resources.steel+taken.cargo,stock);assert.equal(a.resources.steel || 0,0);finishCargo(w,taken);assert.equal(taken.delivered,4);assert.equal(work.status,'waiting','Fighting still takes the worker away');
 w.happen('Finish',null,war);delete a.issues.war;delete b.issues.war;
 for(let n=0;n<30&&work.status!=='learned';n++)next(w);assert.equal(work.status,'learned',JSON.stringify(work));assert.ok(work.inputs.some(i=>i.exchange===taken.id&&i.type==='steel'));assert.ok(taken.uses.some(u=>u.kind==='inquiry'&&u.id===work.id));assert.equal(a._paultendoLocalDiscoveries['military:90'].inquiry,work.id);assert.equal(b._paultendoLocalDiscoveries,undefined);assert.equal(a.resources.steel || 0,0);assert.equal(a._paultendoExchangeMemory[b.id].received.steel || 0,0);assert.equal(a._paultendoExchangeMemory[b.id].seized.steel,4);assert.ok(b.memory.grudges[a.id]);assert.equal(b._paultendoExchangeMemory[a.id].lost.steel,4);check(g);
});

test('ordinary war pressure can act on an actual material refusal without a player declaring war',async t=>{
 const g=await makeGame();t.after(g.close);const {w,a,b,r,warTick}=refused(g);threat(w,r);let war;
 for(let n=0;n<8&&!war;n++){roll(w,0,()=>warTick(a,null,{other:b}));war=w.regToArray('process').find(p=>p.type==='war'&&!p.done);if(!war)next(w);}
 assert.ok(war);assert.equal(war.initiator,a.id);assert.equal(war.cause.id,'supplies');assert.equal(war.cause.source,r.id);assert.equal(war.objective.type,'lumber');assert.ok(r.steps.some(s=>s.kind==='war'));assert.equal(a.resources.lumber || 0,0);check(g);
});
