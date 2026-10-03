import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGame,settleGame} from './harness.mjs';
const native=new WeakMap(),plain=x=>JSON.parse(JSON.stringify(x));
const life=w=>w.planet._paultendoLife;
function controlled(w){
 native.set(w,{farm:w.gameEvents.townFarm.func,eat:w.gameEvents.townEat.func});
 for(const id of ['townFarm','townTame','townMine','townLumber','townEat','townBirth','townDeath','townExpand','townEconomyTick','townTax'])if(w.gameEvents[id]){if(w.gameEvents[id].func)w.gameEvents[id].func=()=>{};if(w.gameEvents[id].perChunk)w.gameEvents[id].perChunk=()=>{};}
 w.gameEvents.processAll.func=()=>{};
}
function setup(g){const w=g.window,town=settleGame(g);w.planet.day=10;Object.assign(w.planet.unlocks,{fire:20,smith:10,farm:10,trade:30});town.name='Claybank';town.pop=20;town.jobs={miner:10,farmer:10};town.resources={crop:w.$c.maxResource(town)};town.legal.farm=true;town._paultendoNextExchangeDay=9999;controlled(w);return {w,town};}
function next(w){const choose=w.chooseEvent;w.chooseEvent=()=>null;try{w.nextDay();}finally{w.chooseEvent=choose;}}
function add(w,town,type,count){w.happen('AddResource',null,town,{type,count});}
function harvest(w,town,count){const random=w.Math.random;w.Math.random=()=>.99;try{native.get(w).farm(town,null,{value:count});}finally{w.Math.random=random;}}
function supplies(w,town){add(w,town,'clay',2);add(w,town,'charcoal',1);}
function batch(w,town){return life(w).materialWork.findLast(x=>x.town===town.id&&x.type==='pottery');}
function finish(w,work){work.roll=.99;for(let n=0;n<25&&['waiting','working'].includes(work.status);n++)next(w);assert.equal(work.status,'made',JSON.stringify(work));}
function installed(town){return (town._paultendoGrainStore?.vessels || []).reduce((n,v)=>n+v.count,0);}
function panel(w){return w.document.getElementById('actionSubList');}
function click(w,text){const el=[...panel(w).querySelectorAll('[role="button"]')].find(e=>e.textContent.includes(text));assert.ok(el,`${text}: ${panel(w).textContent}`);el.click();}
function materials(w,town){w.openRegBrowser(town,'town');[...w.document.querySelectorAll('.paultendoTownLife button')].find(e=>e.textContent==='Materials and workshops').click();}
function errors(g){assert.deepEqual(g.errors,[]);}

test('firing knowledge and clay samples create no pottery appetite without an actual harvest problem',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g);supplies(w,town);town.resources.crop=10;harvest(w,town,5);for(let n=0;n<12;n++)next(w);
 assert.equal(batch(w,town),undefined);assert.equal(town._paultendoGrainStore,undefined);assert.equal(installed(town),0);assert.equal(town.resources.crop,15);errors(g);
});

test('a lost native harvest motivates actual pottery work, and vessels hold later grain without creating food',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g),cap=w.$c.maxResource(town);supplies(w,town);harvest(w,town,16);assert.equal(town.resources.crop,cap);assert.equal(town._paultendoGrainStore.pressure.target,cap+16);
 next(w);const work=batch(w,town);assert.ok(work);assert.equal(work.status,'waiting');assert.equal(installed(town),0);assert.equal(town._paultendoMaterials.pottery,undefined);work.roll=.99;next(w);assert.equal(work.status,'working');assert.equal(town.resources.clay || 0,0);assert.equal(town.resources.charcoal || 0,0);assert.equal(installed(town),0);
 finish(w,work);assert.equal(installed(town),2);assert.equal(town.resources.pottery || 0,0);assert.equal(town.resources.crop,cap);assert.equal(town._paultendoMaterials.pottery.technique.work,work.id);assert.equal(town._paultendoGrainStore.vessels[0].inputs[0].production.work,work.id);
 assert.doesNotMatch(w.parseText(`{{resourcetotal:${town.id}|crop}}`),/#ffff8c/,'The native display does not mark unfilled vessels as full');harvest(w,town,16);assert.equal(town.resources.crop,cap+16);assert.match(w.parseText(`{{resourcetotal:${town.id}|crop}}`),/#ffff8c/);add(w,town,'rock',cap+99);assert.equal(town.resources.rock,cap,'Vessels do not expand other stocks');native.get(w).eat(town);assert.ok(town.resources.crop<cap+16);const count=life(w).materialWork.length;for(let n=0;n<15;n++)next(w);assert.equal(life(w).materialWork.length,count,'A fulfilled purpose does not fire vessels forever');errors(g);
});

test('a pottery firing still needs knowledge, real fuel and clay, and a failed trial leaves no storage',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g);supplies(w,town);harvest(w,town,16);w.planet.unlocks.fire=10;next(w);assert.equal(batch(w,town),undefined);w.planet.unlocks.fire=20;next(w);const work=batch(w,town);work.roll=0;next(w);
 const restored=await makeGame({save:plain(w.generateSave())});t.after(restored.close);const rw=restored.window;controlled(rw);const rt=rw.regGet('town',town.id),copy=batch(rw,rt);assert.equal(copy.roll,0);for(let n=0;n<5;n++)next(rw);assert.equal(copy.status,'failed');assert.equal(installed(rt),0);assert.equal(rt.resources.pottery,undefined);assert.equal(rt.resources.clay || 0,0);assert.equal(rt._paultendoMaterials.pottery?.technique,undefined);errors(g);errors(restored);
});

test('installed vessels and original workshop provenance survive native save compression',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g),cap=w.$c.maxResource(town);supplies(w,town);harvest(w,town,16);next(w);finish(w,batch(w,town));harvest(w,town,16);
 const restored=await makeGame({save:plain(w.generateSave())});t.after(restored.close);const rw=restored.window;controlled(rw);const rt=rw.regGet('town',town.id);assert.equal(rt.resources.crop,cap+16);assert.equal(installed(rt),2);assert.deepEqual(plain(rt._paultendoGrainStore.vessels),plain(town._paultendoGrainStore.vessels));add(rw,rt,'crop',1);assert.equal(rt.resources.crop,cap+16);
 materials(rw,rt);click(rw,'Grain stores');assert.match(panel(rw).textContent,/Room for/);click(rw,'Visit the maker’s workshop');assert.match(panel(rw).textContent,/Used 2 clay/);errors(g);errors(restored);
});

test('an unstarted storage idea can fade or become unnecessary when native stores expand',async t=>{
 for(const reason of ['memory','capacity']){const g=await makeGame();try{const {w,town}=setup(g);add(w,town,'charcoal',1);harvest(w,town,16);next(w);const work=batch(w,town);assert.equal(work.status,'waiting');if(reason==='memory')w.planet.day+=31;else w.planet.unlocks.smith=20;next(w);assert.equal(work.status,'withdrawn',reason);assert.equal(installed(town),0);assert.equal(town.resources.pottery,undefined);errors(g);}finally{g.close();}}
});

test('cargo waiting for room is not mistaken for a harvest which was lost',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g);add(w,town,'crop',16);assert.equal(town._paultendoGrainStore,undefined);add(w,town,'pottery',2);next(w);assert.equal(installed(town),0);assert.equal(town._paultendoMaterials.pottery.technique,undefined);errors(g);
});

test('a received vessel can hold grain without teaching its recipient to manufacture it',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g),cap=w.$c.maxResource(town);harvest(w,town,8);w.planet.unlocks.fire=10;add(w,town,'pottery',1);next(w);assert.equal(installed(town),1);assert.equal(town._paultendoMaterials.pottery.technique,undefined);assert.equal(batch(w,town),undefined);harvest(w,town,8);assert.equal(town.resources.crop,cap+8);errors(g);
});

test('a hungry neighbour receives real grain into vessels beyond the native store limit',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town:seller}=setup(g),center=w.planet.chunks[seller.center.join(',')],chunk=w.filterChunks(c=>!c.v.s&&c.v.g===center.v.g&&c.b!=='water'&&c.b!=='mountain').sort((a,b)=>Math.hypot(a.x-center.x,a.y-center.y)-Math.hypot(b.x-center.x,b.y-center.y))[0],buyer=w.happen('Create',null,null,{x:chunk.x,y:chunk.y},'town');
 buyer.name='Hungrybank';buyer.start=1;buyer.pop=500;buyer.jobs={farmer:20};buyer.legal.farm=true;buyer.resources={crop:w.$c.maxResource(buyer)};buyer._paultendoNextExchangeDay=9999;seller.resources.crop=500;seller.values={justice:6,openness:6};harvest(w,buyer,16);add(w,buyer,'pottery',2);next(w);assert.equal(installed(buyer),2);const cap=w.$c.maxResource(buyer);
 w.gameEvents.townMarketPurchase.func(buyer,null,{seller,goodsType:'crop'});const request=life(w).exchanges.find(r=>r.buyer===buyer.id);assert.ok(request);for(let n=0;n<10&&!request.resolved;n++)next(w);assert.equal(request.status,'arrived');assert.equal(request.delivered,16);assert.equal(buyer.resources.crop,cap+16);assert.equal(seller.resources.crop,484);assert.equal(buyer._paultendoGrainStore.pressure.target,cap+16,'A delivery does not invent a new lost harvest');errors(g);
});

test('a neighbour’s practiced workshop can make vessels for a real surplus and retains their use history',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town:seller}=setup(g);seller.name='Claybank';seller.values={justice:6,openness:6};supplies(w,seller);harvest(w,seller,16);next(w);finish(w,batch(w,seller));w.planet.day+=8;supplies(w,seller);
 const center=w.planet.chunks[seller.center.join(',')],chunk=w.filterChunks(c=>!c.v.s&&c.v.g===center.v.g&&c.b!=='water'&&c.b!=='mountain').sort((a,b)=>Math.hypot(a.x-center.x,a.y-center.y)-Math.hypot(b.x-center.x,b.y-center.y))[0],buyer=w.happen('Create',null,null,{x:chunk.x,y:chunk.y},'town');buyer.name='Wick';buyer.start=1;buyer.pop=20;buyer.jobs={farmer:20};buyer.resources={crop:w.$c.maxResource(buyer)};buyer.legal.farm=true;buyer._paultendoNextExchangeDay=9999;harvest(w,buyer,16);
 w.gameEvents.townMarketPurchase.func(buyer,null,{seller,goodsType:'pottery'});const request=life(w).exchanges.find(r=>r.buyer===buyer.id);assert.ok(request);w.planet.day=request.due-1;next(w);assert.equal(request.status,'making');const work=life(w).materialWork.find(x=>x.id===request.manufacture.work);assert.equal(work.trial,false);
 for(let n=0;n<20&&!request.resolved;n++)next(w);assert.equal(request.status,'arrived');assert.equal(request.delivered,2);assert.equal(installed(buyer),2);assert.equal(buyer.resources.pottery || 0,0);assert.equal(buyer._paultendoMaterials.pottery.technique,undefined);assert.equal(request.uses.find(u=>u.kind==='storage').count,2);assert.equal(buyer._paultendoGrainStore.vessels[0].inputs[0].production.work,work.id);
 materials(w,buyer);click(w,'Grain stores');click(w,'Follow the vessels’ journey');assert.match(panel(w).textContent,/sets clay vessels from this exchange/);click(w,'Visit the grain stores');assert.match(panel(w).textContent,/Wick/);errors(g);
});

test('surplus reports are quiet, navigable, and never disclose a hidden settlement',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g);add(w,town,'charcoal',1);harvest(w,town,8);harvest(w,town,8);const entries=[...w.document.querySelectorAll('.logMessage')].filter(e=>e.dataset.storyKind==='storage');assert.equal(entries.length,1);entries[0].querySelector('.paultendoChronicleStoryLink').click();assert.match(panel(w).textContent,/harvest could not be kept/);
 town._hidden=true;w.planet.day+=9;harvest(w,town,16);assert.equal([...w.document.querySelectorAll('.logMessage')].filter(e=>e.dataset.storyKind==='storage').length,1);next(w);const work=batch(w,town);assert.ok(work);errors(g);
});
