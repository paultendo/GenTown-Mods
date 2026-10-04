import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGame,settleGame} from './harness.mjs';
const plain=x=>JSON.parse(JSON.stringify(x)),native=new WeakMap(),life=w=>w.planet._paultendoLife;
function quiet(w){native.set(w,w.gameEvents.townFarm.func);for(const event of Object.values(w.dailyEvents)){if(event.func)event.func=()=>{};if(event.perChunk)event.perChunk=()=>{};}w.gameEvents.processAll.func=()=>{};}
function next(w,n=1){const choose=w.chooseEvent;w.chooseEvent=()=>null;try{for(let i=0;i<n;i++)w.nextDay();}finally{w.chooseEvent=choose;}}
function harvest(w,town,n){const random=w.Math.random;w.Math.random=()=>.99;try{native.get(w)(town,null,{value:n});}finally{w.Math.random=random;}}
function add(w,town,type,count){w.happen('AddResource',null,town,{type,count});}
function room(town){return (town._paultendoGrainStore?.vessels || []).reduce((n,v)=>n+v.count*(v.capacity ?? 8),0);}
async function setup(t,{types={pottery:2,timber_bins:1},outlook='guarded',faith=0}={}) {
 const g=await makeGame();t.after(g.close);const w=g.window,town=settleGame(g);w.planet.day=20;
 Object.assign(w.planet.unlocks,{fire:10,smith:10,education:10,farm:10,trade:30});Object.assign(town,{name:'Woodbank',start:1,pop:20,jobs:{farmer:20},resources:{crop:w.$c.maxResource(town),cash:0},research:{},_paultendoNextExchangeDay:99999});town.legal.farm=true;town.influences.faith=faith;quiet(w);
 const needed=Object.entries(types).reduce((n,[type,count])=>n+count*({pottery:8,timber_bins:12,glass_vessels:6}[type]),0);harvest(w,town,needed);for(const [type,count] of Object.entries(types))add(w,town,type,count);next(w);
 for(let i=0;i<5&&room(town)<needed;i++){let missing=room(town)-(town.resources.crop-w.$c.maxResource(town));while(missing>0){harvest(w,town,Math.min(20,missing));missing=room(town)-(town.resources.crop-w.$c.maxResource(town));}harvest(w,town,needed-room(town));next(w);}
 const person=town._paultendoPeople.find(p=>p.role==='farmer');person.outlook=outlook;return {g,w,town,person,cap:w.$c.maxResource(town)};
}
function strike(w,town,subtype,{coords=[...town.center],duration=10,process=null}={}) {
 const event=process || w.happen('Create',null,null,{type:'disaster',subtype,x:coords[0],y:coords[1],chunks:[coords],duration},'process');
 const random=w.Math.random;w.Math.random=()=>.99;try{w.metaEvents.processDisaster.func(event);}finally{w.Math.random=random;}return event;
}
function stores(w,town){w.openRegBrowser(town,'town');[...w.document.querySelectorAll('.paultendoTownLife button')].find(b=>b.textContent==='Materials and workshops').click();click(w,'Grain stores');}
function click(w,text){const b=[...w.document.querySelectorAll('#actionSubList [role="button"]')].find(b=>b.textContent.includes(text));assert.ok(b,`${text}: ${w.document.getElementById('actionSubList').textContent}`);b.click();}

test('an actual fire at the stores burns timber containers and only the grain held there',async t=>{
 const {g,w,town,cap,person}=await setup(t);assert.equal(room(town),28);harvest(w,town,20);assert.equal(town.resources.crop,cap+20);
 const event=strike(w,town,'wildfire');assert.equal(room(town),16);assert.equal(town.resources.crop,cap+16);const loss=town._paultendoGrainStore.hazards[0];assert.equal(loss.grain,4);assert.equal(loss.disaster,event.id);assert.equal(loss.site,town.center.join(','));assert.equal(loss.person,person.id);assert.equal(loss.fixtures.find(v=>v.type==='timber_bins').lost,1);assert.equal(loss.fixtures.find(v=>v.type==='pottery').lost,0);
 const clue=life(w).clues.find(c=>c.observation?.kind==='storageDamage');assert.ok(clue);assert.equal(clue.observation.effect.harm,true);assert.equal(clue.observation.effect.grain,4);assert.equal(clue.observation.event,undefined);assert.equal(w.planet.unlocks.fire,10);assert.equal(town._paultendoMaterials.pottery.technique,undefined);assert.deepEqual(g.errors,[]);
});

test('a disaster elsewhere and an empty container cannot destroy grain in the native stores',async t=>{
 const {g,w,town,cap}=await setup(t);const far=w.filterChunks(c=>!c.v.s&&Math.hypot(c.x-town.center[0],c.y-town.center[1])>10)[0];harvest(w,town,20);const before=plain(town._paultendoGrainStore);strike(w,town,'wildfire',{coords:[far.x,far.y]});assert.deepEqual(plain(town._paultendoGrainStore),before);assert.equal(town.resources.crop,cap+20);
 town.resources.crop=cap-5;strike(w,town,'wildfire');assert.equal(town.resources.crop,cap-5);assert.equal(town._paultendoGrainStore.hazards[0].grain,0);assert.equal(room(town),16);assert.deepEqual(g.errors,[]);
});

test('glass, fired clay and timber respond differently to the same native earthquake',async t=>{
 const {g,w,town,cap}=await setup(t,{types:{pottery:2,timber_bins:1,glass_vessels:1}});assert.equal(room(town),34);while(town.resources.crop<cap+34)harvest(w,town,Math.min(20,cap+34-town.resources.crop));
 strike(w,town,'earthquake');const fixtures=town._paultendoGrainStore.vessels;assert.equal(fixtures.find(v=>v.type==='glass_vessels').count,0);assert.equal(fixtures.find(v=>v.type==='pottery').count,1);assert.equal(fixtures.find(v=>v.type==='timber_bins').count,1);assert.equal(room(town),20);assert.equal(town.resources.crop,cap+20);assert.equal(town._paultendoGrainStore.hazards[0].grain,14);assert.deepEqual(g.errors,[]);
});

test('a witnessed loss changes the next material choice while preserving actual available stock',async t=>{
 const {g,w,town}=await setup(t);harvest(w,town,20);harvest(w,town,8);harvest(w,town,12);strike(w,town,'wildfire');add(w,town,'pottery',3);add(w,town,'timber_bins',2);next(w);
 assert.equal(town.resources.pottery || 0,0);assert.equal(town.resources.timber_bins,2);assert.equal(room(town),40);assert.equal(town._paultendoGrainStore.vessels.at(-1).type,'pottery');assert.deepEqual(g.errors,[]);
});

test('without a surviving witness the loss stays physical and cannot invent local material knowledge or preference',async t=>{
 const {g,w,town}=await setup(t);harvest(w,town,20);harvest(w,town,8);harvest(w,town,12);town.jobs={lumberer:20};strike(w,town,'wildfire');assert.equal(town._paultendoGrainStore.hazards[0].person,undefined);assert.equal(life(w).clues.some(c=>c.observation?.kind==='storageDamage'),false);
 add(w,town,'pottery',3);add(w,town,'timber_bins',2);next(w);assert.equal(town.resources.timber_bins || 0,0);assert.equal(town.resources.pottery,3);assert.equal(room(town),40);assert.deepEqual(g.errors,[]);
});

test('damage and unused fractional strain survive reload and the same disaster day cannot charge a second loss',async t=>{
 const {g,w,town,cap}=await setup(t,{types:{pottery:1,glass_vessels:1}});harvest(w,town,14);const event=strike(w,town,'earthquake');assert.equal(room(town),8);assert.equal(town._paultendoGrainStore.vessels.find(v=>v.type==='pottery').damage.shockLoss,.5);const saved=plain(w.generateSave());
 const copy=await makeGame({save:saved});t.after(copy.close);const rw=copy.window,rt=rw.regGet('town',town.id);quiet(rw);const before=plain(rt._paultendoGrainStore);strike(rw,rt,'earthquake',{process:rw.regGet('process',event.id)});assert.deepEqual(plain(rt._paultendoGrainStore),before);assert.equal(rt.resources.crop,cap+8);
 rw.planet.day++;strike(rw,rt,'earthquake');assert.equal(room(rt),0);assert.equal(rt.resources.crop,cap);assert.equal(rt._paultendoGrainStore.hazards.length,2);assert.deepEqual(g.errors,[]);assert.deepEqual(copy.errors,[]);
});

test('harm can prompt a guarded witness to study, and a faithful witness can spread a warning instead of thanks',async t=>{
 for(const faith of [0,6]){const {g,w,town,person}=await setup(t,{faith,outlook:faith?'curious':'guarded'});harvest(w,town,20);strike(w,town,'wildfire');const clue=life(w).clues.find(c=>c.observation?.kind==='storageDamage');next(w,6);assert.equal(clue.study.status,'finished');assert.equal(clue.person,person.id);assert.equal(clue.study.interpretation.meaning,faith?'belief':'pattern');
 if(faith){assert.match(clue.study.interpretation.text,/warning/);const teaching=life(w).teachings.find(t=>t.id===clue.study.teaching);assert.match(teaching.words,/warning/);assert.doesNotMatch(teaching.words,/thanks|favour/);}assert.equal(w.planet.unlocks.fire,10);assert.equal(clue.inquiry,undefined);assert.deepEqual(g.errors,[]);}
});

test('opening the loss, its disaster and its maker history cannot repeat damage or advance a study',async t=>{
 const {g,w,town}=await setup(t);harvest(w,town,20);strike(w,town,'wildfire');const before=plain({store:town._paultendoGrainStore,clues:life(w).clues,resources:town.resources,day:w.planet.day});stores(w,town);assert.match(w.document.getElementById('actionSubList').textContent,/burns 1 wooden grain bin.*4 grain is lost/s);click(w,'The wildfire');stores(w,town);assert.deepEqual(plain({store:town._paultendoGrainStore,clues:life(w).clues,resources:town.resources,day:w.planet.day}),before);assert.deepEqual(g.errors,[]);
});

test('a moving storm damages the stores it actually reaches rather than its previous footprint',async t=>{
 const {g,w,town,cap}=await setup(t,{types:{glass_vessels:4}});harvest(w,town,20);harvest(w,town,4);const [x,y]=town.center;
 const event=w.happen('Create',null,null,{type:'disaster',subtype:'hurricane',chunks:[[x-1,y]],x:x-1,y,duration:10},'process');event.dir=[1,0];strike(w,town,'hurricane',{process:event});
 assert.deepEqual(plain(event.chunks),[[x,y]]);assert.equal(town._paultendoGrainStore.hazards[0].site,`${x},${y}`);assert.equal(town._paultendoGrainStore.hazards[0].grain,6);assert.equal(town.resources.crop,cap+18);assert.equal(room(town),18);assert.deepEqual(g.errors,[]);
});

test('a final disaster tick can destroy containers at the old centre without charging native grain for a territory change',async t=>{
 const {g,w,town,cap}=await setup(t,{types:{pottery:1,glass_vessels:1}});harvest(w,town,14);const site=town.center.join(',');
 const event=strike(w,town,'earthquake',{duration:1});assert.ok(event.done);assert.notEqual(w.planet.chunks[site].v.s,town.id);assert.equal(town._paultendoGrainStore.hazards[0].site,site);assert.equal(town._paultendoGrainStore.hazards[0].grain,6);assert.equal(town.resources.crop,cap+8);assert.equal(room(town),8);assert.deepEqual(g.errors,[]);
});
