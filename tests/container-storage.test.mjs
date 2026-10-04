import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGame,settleGame} from './harness.mjs';
const plain=x=>JSON.parse(JSON.stringify(x)),native=new WeakMap(),life=w=>w.planet._paultendoLife;
function quiet(w){native.set(w,w.gameEvents.townFarm.func);for(const event of Object.values(w.dailyEvents)){if(event.func)event.func=()=>{};if(event.perChunk)event.perChunk=()=>{};}w.gameEvents.processAll.func=()=>{};}
function next(w,n=1){const choose=w.chooseEvent;w.chooseEvent=()=>null;try{for(let i=0;i<n;i++)w.nextDay();}finally{w.chooseEvent=choose;}}
function harvest(w,town,n){const random=w.Math.random;w.Math.random=()=>.99;try{native.get(w)(town,null,{value:n});}finally{w.Math.random=random;}}
function add(w,town,type,count){w.happen('AddResource',null,town,{type,count});}
async function setup(t,{smith=20,fire=0,jobs={lumberer:10,farmer:10}}={}){const g=await makeGame();t.after(g.close);const w=g.window,town=settleGame(g);w.planet.day=10;Object.assign(w.planet.unlocks,{smith,fire,education:10,farm:10,trade:30});Object.assign(town,{name:'Woodbank',start:1,pop:20,jobs,resources:{crop:w.$c.maxResource(town),cash:0},research:{},_paultendoNextExchangeDay:9999});town.legal.farm=true;quiet(w);return {g,w,town,cap:w.$c.maxResource(town)};}
function materials(w,town){w.openRegBrowser(town,'town');[...w.document.querySelectorAll('.paultendoTownLife button')].find(b=>b.textContent==='Materials and workshops').click();}
function click(w,text){const b=[...w.document.querySelectorAll('#actionSubList [role="button"]')].find(b=>b.textContent.includes(text));assert.ok(b,text);b.click();}
function room(town){return (town._paultendoGrainStore?.vessels || []).reduce((n,v)=>n+v.count*v.capacity,0);}
function errors(g){assert.deepEqual(g.errors,[]);}

test('knowledge, raw timber and raw glass do not become containers or create a storage appetite without overflow',async t=>{
 const {g,w,town,cap}=await setup(t,{smith:30,fire:0,jobs:{lumberer:10,miner:10,farmer:10}});add(w,town,'lumber',2);add(w,town,'glass',2);town.resources.crop=cap-20;harvest(w,town,10);next(w,10);
 assert.equal(town._paultendoGrainStore,undefined);assert.equal(life(w).materialWork.some(x=>['timber_bins','glass_vessels','pottery'].includes(x.type)),false);assert.equal(town.resources.lumber,2);assert.equal(town.resources.glass,2);errors(g);
});

test('a real timber supply and storage shortfall lead to a paid four-day bin without kiln knowledge or free food',async t=>{
 const {g,w,town,cap}=await setup(t);add(w,town,'lumber',2);harvest(w,town,12);next(w);const work=life(w).materialWork.find(x=>x.type==='timber_bins');assert.ok(work);assert.equal(work.status,'waiting');assert.deepEqual(plain(work.cost),{lumber:2});assert.equal(work.remaining,4);work.roll=.99;next(w);assert.equal(work.status,'working');assert.equal(town.resources.lumber || 0,0);assert.equal(room(town),0);next(w,4);
 assert.equal(work.status,'made');assert.equal(work.finished-work.started,4);assert.equal(room(town),12);assert.equal(town.resources.crop,cap);assert.equal(town.resources.timber_bins || 0,0);assert.equal(town._paultendoGrainStore.vessels[0].inputs[0].production.work,work.id);assert.equal(w.planet.unlocks.fire,0);
 harvest(w,town,12);assert.equal(town.resources.crop,cap+12);const before=plain({store:town._paultendoGrainStore,resources:town.resources,work,day:w.planet.day});materials(w,town);click(w,'Grain stores');assert.match(w.document.getElementById('actionSubList').textContent,/wooden grain bin · Room for 12/);click(w,'Visit the maker');assert.match(w.document.getElementById('actionSubList').textContent,/Used 2 timber/);assert.deepEqual(plain({store:town._paultendoGrainStore,resources:town.resources,work,day:w.planet.day}),before);errors(g);
});

test('an unsuccessful wooden container still spends the actual timber and creates no capacity or local technique',async t=>{
 const {g,w,town,cap}=await setup(t);add(w,town,'lumber',2);harvest(w,town,12);next(w);const work=life(w).materialWork.find(x=>x.type==='timber_bins');work.roll=0;next(w,5);assert.equal(work.status,'failed');assert.equal(town.resources.lumber || 0,0);assert.equal(room(town),0);assert.equal(town._paultendoMaterials?.timber_bins?.technique,undefined);harvest(w,town,12);assert.equal(town.resources.crop,cap);errors(g);
});

test('mixed imported containers add their own capacities and only the parts of a harvest each held become observations',async t=>{
 const {g,w,town,cap}=await setup(t,{smith:10,jobs:{farmer:20}});harvest(w,town,14);add(w,town,'pottery',1);add(w,town,'glass_vessels',1);next(w);assert.equal(room(town),14);assert.deepEqual(plain(town._paultendoGrainStore.vessels.map(v=>[v.type,v.capacity])),[['pottery',8],['glass_vessels',6]]);assert.equal(town.resources.crop,cap);assert.equal(life(w).clues.length,0);
 harvest(w,town,10);assert.equal(town.resources.crop,cap+10);const clues=life(w).clues.filter(c=>c.observation?.kind==='storage');assert.deepEqual(plain(clues.map(c=>[c.observation.type,c.observation.extra])),[['pottery',8],['glass_vessels',2]]);assert.ok(clues.every(c=>c.observation.vessels.length===1));assert.equal(town._paultendoMaterials.glass_vessels.technique,undefined);assert.equal(w.planet.unlocks.fire,0);add(w,town,'rock',cap+100);assert.equal(town.resources.rock,cap,'A grain container cannot expand mineral stores');errors(g);
});

test('shapeable glass is a distinct paid vessel recipe and a known supply can answer the same storage need',async t=>{
 const {g,w,town,cap}=await setup(t,{smith:30,fire:50,jobs:{miner:10,farmer:10}});add(w,town,'glass',2);add(w,town,'charcoal',1);harvest(w,town,12);next(w);const work=life(w).materialWork.find(x=>x.type==='glass_vessels');assert.ok(work);assert.equal(work.remaining,6);assert.deepEqual(plain(work.cost),{glass:2,charcoal:1});work.roll=.99;next(w,7);assert.equal(work.status,'made');assert.equal(room(town),12);assert.equal(town.resources.glass || 0,0);assert.equal(town.resources.charcoal || 0,0);assert.equal(town.resources.crop,cap);harvest(w,town,12);assert.equal(town.resources.crop,cap+12);errors(g);
});

test('timber claimed by a real building cannot be counted as available input for a storage alternative',async t=>{
 const {g,w,town}=await setup(t);add(w,town,'lumber',2);w.happen('Create',town,null,{type:'project',subtype:'school',cost:2},'process');harvest(w,town,12);next(w,5);assert.equal(life(w).materialWork.some(x=>x.type==='timber_bins'),false);assert.equal(town.resources.lumber,2);assert.equal(room(town),0);errors(g);
});

test('a neighbour can order an actually needed timber container and its journey retains the original paid workshop',async t=>{
 const {g,w,town:seller}=await setup(t);seller.values={justice:6,openness:6};add(w,seller,'lumber',2);harvest(w,seller,12);next(w);const first=life(w).materialWork.find(x=>x.type==='timber_bins');first.roll=.99;next(w,5);assert.equal(first.status,'made');w.planet.day+=8;add(w,seller,'lumber',2);
 const center=w.planet.chunks[seller.center.join(',')],chunk=w.filterChunks(c=>!c.v.s&&c.v.g===center.v.g&&c.b!=='water'&&c.b!=='mountain').sort((a,b)=>Math.hypot(a.x-center.x,a.y-center.y)-Math.hypot(b.x-center.x,b.y-center.y))[0],buyer=w.happen('Create',null,null,{x:chunk.x,y:chunk.y},'town');Object.assign(buyer,{name:'Farbank',start:1,pop:20,jobs:{farmer:20},resources:{crop:w.$c.maxResource(buyer)},_paultendoNextExchangeDay:9999});buyer.legal.farm=true;
 add(w,buyer,'timber_bins',1);w.happen('RemoveResource',null,buyer,{type:'timber_bins',count:1});harvest(w,buyer,12);w.gameEvents.townMarketPurchase.func(buyer,null,{seller,goodsType:'timber_bins'});const request=life(w).exchanges.find(r=>r.buyer===buyer.id&&r.type==='timber_bins');assert.ok(request);w.planet.day=request.due-1;next(w);assert.equal(request.status,'making');const work=life(w).materialWork.find(x=>x.id===request.manufacture.work);assert.equal(work.trial,false);
 for(let i=0;i<20&&!request.resolved;i++)next(w);assert.equal(request.status,'arrived');assert.equal(request.delivered,1);assert.equal(room(buyer),12);assert.equal(buyer.resources.timber_bins || 0,0);assert.equal(buyer._paultendoMaterials.timber_bins.technique,undefined);assert.equal(request.uses.find(u=>u.kind==='storage').count,1);assert.equal(buyer._paultendoGrainStore.vessels[0].inputs[0].production.work,work.id);materials(w,buyer);click(w,'Grain stores');click(w,'Follow the vessels');assert.match(w.document.getElementById('actionSubList').textContent,/wooden grain bins from this exchange/);errors(g);
});

test('legacy clay fixtures retain their capacity and mixed containers survive reload without a second payment or invented meals',async t=>{
 const {g,w,town,cap}=await setup(t,{smith:10,jobs:{farmer:20}});harvest(w,town,20);add(w,town,'pottery',1);add(w,town,'timber_bins',1);next(w);assert.equal(room(town),20);const clay=town._paultendoGrainStore.vessels.find(v=>v.type==='pottery');delete clay.type;delete clay.capacity;harvest(w,town,20);assert.equal(town.resources.crop,cap+20);
 const save=plain(w.generateSave()),reloaded=await makeGame({save});t.after(reloaded.close);const rw=reloaded.window,rt=rw.regGet('town',town.id);quiet(rw);assert.deepEqual(plain(rt._paultendoGrainStore),plain(town._paultendoGrainStore));const before=plain(rt._paultendoGrainStore);materials(rw,rt);click(rw,'Grain stores');assert.match(rw.document.getElementById('actionSubList').textContent,/clay vessel · Room for 8/);assert.match(rw.document.getElementById('actionSubList').textContent,/wooden grain bin · Room for 12/);assert.deepEqual(plain(rt._paultendoGrainStore),before);add(rw,rt,'crop',10);assert.equal(rt.resources.crop,cap+20);assert.equal(rt.resources.pottery || 0,0);assert.equal(rt.resources.timber_bins || 0,0);errors(g);errors(reloaded);
});


test('a ready container that fits the shortfall can preserve other containers for later work',async t=>{
 const {g,w,town}=await setup(t,{smith:10,jobs:{farmer:20}});harvest(w,town,12);add(w,town,'pottery',2);add(w,town,'timber_bins',1);next(w);assert.equal(room(town),12);assert.equal(town._paultendoGrainStore.vessels.length,1);assert.equal(town._paultendoGrainStore.vessels[0].type,'timber_bins');assert.equal(town.resources.pottery,2);assert.equal(town.resources.timber_bins || 0,0);errors(g);
});
