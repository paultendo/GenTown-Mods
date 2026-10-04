import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGame,settleGame} from './harness.mjs';
const plain=x=>JSON.parse(JSON.stringify(x));
function nearby(w,town,min=1){const center=w.planet.chunks[town.center.join(',')];return w.filterChunks(c=>!c.v.s&&c.v.g===center.v.g&&c.b!=='water'&&c.b!=='mountain'&&Math.hypot(c.x-center.x,c.y-center.y)>=min).sort((a,b)=>Math.hypot(a.x-center.x,a.y-center.y)-Math.hypot(b.x-center.x,b.y-center.y))[0];}
function create(w,at,name,pop=80){const town=w.happen('Create',null,null,{x:at.x,y:at.y},'town');w.happen('Explore',null,null,{x:at.x,y:at.y});town.name=name;town.start=1;town.pop=pop;town.jobs={};town.resources={crop:1000};town._paultendoNextExchangeDay=99999;town.influences.hunger=0;return town;}
function quiet(w){for(const id of ['townFarm','townTame','townMine','townLumber','townBirth','townDeath','townExpand','townEmploy','warPressureDynamics']){if(w.gameEvents[id].func)w.gameEvents[id].func=()=>{};if(w.gameEvents[id].perChunk)w.gameEvents[id].perChunk=()=>{};}w.gameEvents.processAll.func=()=>{};w.chooseEvent=()=>null;}
function startWar(w,a,b){const war=w.happen('Create',a,null,{type:'war',towns:[a.id,b.id]},'process');war.sides=[[a.id],[b.id]];war.start=w.planet.day;war._paultendoEarlyDuration=14;a.relations[b.id]=b.relations[a.id]=-10;a.issues.war=b.issues.war=war.id;return war;}
function fight(w,war,roll=.999){const random=w.Math.random;w.Math.random=()=>roll;try{w.metaEvents.processWar.func(war);}finally{w.Math.random=random;}}
function check(g){assert.deepEqual(g.errors,[]);}


function next(w){w.nextDay();}
function pair(g){
 const w=g.window,a=settleGame(g);w.planet.day=30;const b=create(w,nearby(w,a),'Wick');
 for(const town of [a,b]){town.pop=80;town.jobs={soldier:40,farmer:40};town.resources={crop:10000};town.research={farm:100};town._paultendoNextExchangeDay=99999;}
 Object.assign(w.planet.unlocks,{farm:20,smith:50,trade:10,travel:20,military:80,fire:60});quiet(w);return {w,a,b};
}
function start(w,town){
 town.research={military:100};w.happen('AddResource',null,town,{type:'steel',count:4});w.happen('AddResource',null,town,{type:'charcoal',count:2});
 const caller=w.readyEvent('unlockArtillery');assert.ok(caller);caller.args.value={town:town.id};w.doEvent('unlockArtillery',caller);
 const work=w.planet._paultendoLife.inquiries.at(-1);assert.equal(work.town,town.id);return work;
}
function finish(w,work){for(let n=0;n<35&&work.status!=='learned';n++)next(w);assert.equal(work.status,'learned',JSON.stringify(work));}
async function attack(t,save,id){
 const g=await makeGame({save});t.after(g.close);const w=g.window;quiet(w);const a=w.regGet('town',id),b=create(w,nearby(w,a),'Ridge',1000);
 const center=w.planet.chunks[b.center.join(',')];
 // A large actual land fixture avoids a settlement collapse masking the
 // number of plots taken by one otherwise identical attack.
 for(const c of w.filterChunks(c=>!c.v.s&&c.v.g===center.v.g&&c.b!=='water'&&c.b!=='mountain').sort((x,y)=>Math.hypot(x.x-center.x,x.y-center.y)-Math.hypot(y.x-center.x,y.y-center.y)).slice(0,100)){c.v.s=b.id;b.size++;}
 w.happen('UpdateCenter',null,b);
 a.pop=80;a.jobs={soldier:40,farmer:40};a.influences={military:10};a.influencesTemp={};a.gov='monarchy';a.values={};a.traditions=[];a.issues={};a.unrest=0;delete a.famine;
 b.jobs={};const war=startWar(w,a,b),before=b.size;fight(w,war,0);assert.ok(!b.end);check(g);return before-b.size;
}

test('distant military work grants no extra territory, while a town’s own completed work improves its next attack',async t=>{
 const g=await makeGame();t.after(g.close);const {w,a,b}=pair(g),before=plain(w.generateSave()),work=start(w,a);
 next(w);assert.equal(work.status,'working');assert.equal(a.resources.steel || 0,0);assert.equal(a.resources.charcoal || 0,0);assert.equal(w.planet.unlocks.military,80);
 finish(w,work);assert.equal(w.planet.unlocks.military,90);assert.equal(a._paultendoLocalDiscoveries['military:90'].inquiry,work.id);assert.equal(b._paultendoLocalDiscoveries,undefined);const distant=plain(w.generateSave());
 const own=start(w,b);next(w);const pending=plain(w.generateSave()),remaining=own.remaining;
 const resumed=await makeGame({save:pending});t.after(resumed.close);quiet(resumed.window);const rw=resumed.window,copy=rw.planet._paultendoLife.inquiries.find(x=>x.id===own.id),rb=rw.regGet('town',b.id);assert.equal(copy.remaining,remaining);assert.equal(rb._paultendoLocalDiscoveries,undefined);
 finish(rw,copy);assert.equal(rb._paultendoLocalDiscoveries['military:90'].inquiry,copy.id);assert.equal(rb.resources.steel || 0,0);assert.equal(rb.resources.charcoal || 0,0);
 const baseline=await attack(t,before,b.id),remote=await attack(t,distant,b.id),unfinished=await attack(t,pending,b.id),learned=await attack(t,plain(rw.generateSave()),b.id);
 assert.equal(remote,baseline,'Another town’s completion cannot improve this army');assert.equal(unfinished,baseline,'An unfinished trial cannot improve this army');assert.ok(learned>baseline,JSON.stringify({baseline,remote,unfinished,learned}));check(g);check(resumed);
});

test('earlier shared military knowledge remains usable after reload without inventing a local inventor',async t=>{
 const g=await makeGame();t.after(g.close);const {w,b}=pair(g),before=plain(w.generateSave());w.planet.unlocks.military=90;const earlier=plain(w.generateSave());
 assert.equal(b._paultendoLocalDiscoveries,undefined);assert.ok(await attack(t,earlier,b.id)>await attack(t,before,b.id));check(g);
});
