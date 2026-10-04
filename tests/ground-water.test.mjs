import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGame,settleGame} from './harness.mjs';
const plain=x=>JSON.parse(JSON.stringify(x)),key=c=>`${c.x},${c.y}`;
function flat(c,e){c.e=e;c.p=c.p.map(row=>row.map(()=>e));}
const nativeMine=new WeakMap();
function quiet(w){if(!nativeMine.has(w))nativeMine.set(w,w.gameEvents.townMine.perChunk);w.chooseEvent=()=>null;for(const e of Object.values(w.dailyEvents)){if(e.func)e.func=()=>{};if(e.perChunk)e.perChunk=()=>{};}w.gameEvents.processAll.func=()=>{};}
function next(w,n=1){for(let i=0;i<n;i++)w.nextDay();}
async function basin(t,{trees=false}={}) {
 const g=await makeGame();t.after(g.close);const w=g.window,town=settleGame(g);quiet(w);w.planet.day=20;
 for(const c of Object.values(w.planet.chunks)){c.b='water';c.m=0;c.t=.65;flat(c,.2);delete c.v.s;delete c.v.m;}
 for(let x=22;x<=42;x++)for(let y=18;y<=28;y++){const c=w.chunkAt(x,y);c.b=trees?'grass':'badlands';c.m=1;flat(c,.94-(x-22)*.02);}
 const chunk=w.chunkAt(32,23);chunk.v.s=town.id;town.center=[32,23];town.size=1;town.pop=100;town.jobs={};town.resources={crop:100,rock:0,cash:0};
 return {g,w,town,chunk};
}
function storm(w){for(const c of Object.values(w.planet.chunks).filter(c=>c.b!=='water')){const p=(w.planet._paultendoLand ||= {})[key(c)] ||= {cover:w.biomes[c.b].hasLumber?1:0,soil:1,scorch:0,rubble:0,lastDay:w.planet.day,history:[]};p.stormDay=w.planet.day+1;}}
function height(w){return Object.values(w.planet.chunks).reduce((n,c)=>n+c.p.flat().reduce((a,b)=>a+b,0)/c.p.flat().length,0);}
function closeTo(a,b,message){assert.ok(Math.abs(a-b)<1e-8,`${message}: ${a} != ${b}`);}
function plates(w,{kind='convergent'}={}){w.planet._paultendoGeology={lastDay:w.planet.day,plates:[{x:10,y:22,vx:kind==='divergent'?-1:kind==='transform'?0:1,vy:kind==='transform'?1:0,oceanic:true,stress:1},{x:60,y:22,vx:kind==='divergent'?1:kind==='transform'?0:-1,vy:kind==='transform'?-1:0,oceanic:false,stress:1}]};}

test('earthquake locations favour a persistent active boundary while ordinary selection is restored',async t=>{
 const g=await makeGame();t.after(g.close);const w=g.window;plates(w);const select=w.randomChunk;let near=0;
 for(let i=0;i<100;i++){const d=w.gameEvents.naturalDisaster.func(null,null,{value:'earthquake'});assert.ok(d);if(Math.abs(d.x-35)<=5)near++;assert.equal(d._paultendoGeology.boundary,'convergent');assert.equal(w.randomChunk,select);}
 assert.ok(near>45,`${near}/100 at boundary`);assert.deepEqual(g.errors,[]);
});

test('transform boundaries do not produce eruptions, and divergent boundaries can',async t=>{
 const {g,w}=await basin(t);plates(w,{kind:'transform'});const select=w.randomChunk;
 assert.equal(w.gameEvents.naturalDisaster.func(null,null,{value:'volcano'}),false);assert.equal(w.randomChunk,select);
 plates(w,{kind:'divergent'});const d=w.gameEvents.naturalDisaster.func(null,null,{value:'volcano'});assert.ok(d);assert.equal(w.chunkAt(d.x,d.y).b,'badlands');assert.equal(d._paultendoGeology.boundary,'divergent');assert.ok(d._paultendoGeology.volcanic>.08);assert.deepEqual(g.errors,[]);
});

test('routed rain is retained, evaporated or reaches the sea without creating or losing water',async t=>{
 const {g,w}=await basin(t);storm(w);next(w);assert.ok(Object.values(w.planet._paultendoWater.cells).some(c=>c.flow>.35));next(w,3);const s=w.planet._paultendoWater,held=Object.values(s.cells).reduce((n,c)=>n+c.stored+c.snow,0);
 closeTo(s.rain,s.evaporated+s.outflow+held,'water balance');assert.ok(s.outflow>0);assert.deepEqual(g.errors,[]);
});

test('sediment moves downhill and accumulates elsewhere with ground mass conserved',async t=>{
 const {g,w}=await basin(t);const before=height(w);storm(w);next(w,3);const s=w.planet._paultendoWater,p=Object.values(w.planet._paultendoLand);
 assert.ok(p.some(c=>c.eroded>0));assert.ok(p.some(c=>c.deposited>0));closeTo(before,height(w)+s.seaSediment+Object.values(s.cells).reduce((n,c)=>n+c.sediment,0),'ground balance');assert.deepEqual(g.errors,[]);
});

test('surviving tree cover holds more ground under the same storm and drainage',async t=>{
 const bare=await basin(t),wood=await basin(t,{trees:true});storm(bare.w);storm(wood.w);next(bare.w);next(wood.w);
 const sum=w=>Object.values(w.planet._paultendoLand).reduce((n,c)=>n+(c.eroded || 0),0);assert.ok(sum(bare.w)>sum(wood.w)*5);closeTo(bare.w.planet._paultendoWater.rain,wood.w.planet._paultendoWater.rain,'same weather');assert.deepEqual(bare.g.errors,[]);assert.deepEqual(wood.g.errors,[]);
});

test('a basin holds rain before overflowing and releases stored snow when it warms',async t=>{
 const {g,w}=await basin(t);const c=w.chunkAt(32,23);flat(c,.43);for(const [x,y] of [[31,23],[33,23],[32,22],[32,24]])flat(w.chunkAt(x,y),.85);c.t=0;storm(w);next(w);
 let cell=w.planet._paultendoWater.cells[key(c)];assert.ok(cell.snow>0);assert.equal(cell.flow,0);const snow=cell.snow;c.t=.9;next(w);assert.ok(cell.snow<snow);assert.ok(cell.stored>0);assert.equal(cell.flow,0);assert.deepEqual(g.errors,[]);
});

test('a real flood ruins grain at its inundated centre and makes that ground less farmable',async t=>{
 const {g,w,town,chunk}=await basin(t);flat(chunk,.55);chunk.b='grass';storm(w);const before=w.happen('Fertility',town,chunk,null,'chunk');next(w);
 const p=w.planet._paultendoLand[key(chunk)];assert.ok(p?.flood>.1);assert.ok(town.resources.crop<100);assert.ok(w.happen('Fertility',town,chunk,null,'chunk')<before*.6);const held=town.resources.crop;next(w);assert.equal(town.resources.crop,held,'the same lingering flood does not charge another entry loss');assert.deepEqual(g.errors,[]);
});

test('water, plate conditions and precise drainage ground survive reload and have the same next day',async t=>{
 const {g,w}=await basin(t);plates(w);storm(w);next(w,3);const saved=plain(w.generateSave()),copy=await makeGame({save:saved});t.after(copy.close);const rw=copy.window;quiet(rw);
 assert.deepEqual(plain(rw.planet._paultendoGeology),plain(w.planet._paultendoGeology));assert.deepEqual(plain(rw.planet._paultendoWater),plain(w.planet._paultendoWater));next(w);next(rw);
 closeTo(rw.planet._paultendoWater.rain,w.planet._paultendoWater.rain,'next rain');closeTo(rw.planet._paultendoWater.outflow,w.planet._paultendoWater.outflow,'next outflow');
 assert.deepEqual(plain(rw.planet._paultendoWater.cells),plain(w.planet._paultendoWater.cells));assert.deepEqual(g.errors,[]);assert.deepEqual(copy.errors,[]);
});

test('an eruption leaves actual rock and scorched land after its native process finishes',async t=>{
 const {g,w}=await basin(t);const c=w.chunkAt(37,23),before=c.e;const d=w.happen('Create',null,null,{type:'disaster',subtype:'volcano',x:c.x,y:c.y,chunks:[[c.x,c.y]],duration:1},'process');w.metaEvents.processDisaster.func(d);
 assert.ok(d.done);assert.ok(c.e>before);assert.ok(w.planet._paultendoLand[key(c)].scorch>0);assert.equal(w.planet._paultendoLand[key(c)].history.at(-1).kind,'lava');assert.deepEqual(g.errors,[]);
});

function strike(w,c,type,{duration=10,dir}={}){const d=w.happen('Create',null,null,{type:'disaster',subtype:type,x:c.x,y:c.y,chunks:[[c.x,c.y]],duration},'process');if(dir)d.dir=dir;w.actionables.process._disasterSubtypes[type].deathRate=0;w.metaEvents.processDisaster.func(d);return d;}
function mine(w,town,c){const random=w.Math.random;w.Math.random=()=>0;try{nativeMine.get(w)(town,null,c);}finally{w.Math.random=random;}}

test('a landslide exposes a finite seam outside its ordinary biome without awarding technology or refilling exhaustion',async t=>{
 const {g,w,town,chunk}=await basin(t);chunk.b='grass';flat(chunk,.94);flat(w.chunkAt(chunk.x+1,chunk.y),.5);for(const [x,y] of [[-1,0],[0,1],[0,-1]])flat(w.chunkAt(chunk.x+x,chunk.y+y),.95);
 town.jobs={miner:10};w.planet.unlocks.smith=40;const before=plain(w.planet.unlocks);strike(w,chunk,'earthquake');
 const deposits=w.planet._paultendoDeposits[key(chunk)],type=Object.keys(deposits).find(type=>deposits[type].exposed);assert.ok(type);const quantity=deposits[type].remaining;assert.equal(town.resources[type],undefined);assert.deepEqual(plain(w.planet.unlocks),before);
 mine(w,town,chunk);assert.equal(town.resources[type],1);assert.equal(deposits[type].remaining,quantity-1);
 deposits[type].remaining=0;town.resources[type]=0;strike(w,chunk,'earthquake');mine(w,town,chunk);assert.equal(deposits[type].remaining,0);assert.equal(town.resources[type],0);
 const copy=await makeGame({save:plain(w.generateSave())});t.after(copy.close);assert.equal(copy.window.planet._paultendoDeposits[key(chunk)][type].remaining,0);assert.deepEqual(g.errors,[]);assert.deepEqual(copy.errors,[]);
});

test('later accumulated rock can cover an exposed seam without deleting its remaining material',async t=>{
 const {g,w,town,chunk}=await basin(t);chunk.b='grass';flat(chunk,.94);flat(w.chunkAt(chunk.x+1,chunk.y),.5);strike(w,chunk,'earthquake');
 const deposits=w.planet._paultendoDeposits[key(chunk)],type=Object.keys(deposits).find(type=>deposits[type].exposed),p=w.planet._paultendoLand[key(chunk)];deposits[type].depth=p.cut-.001;
 const quantity=deposits[type].remaining;strike(w,chunk,'volcano');town.jobs={miner:10};w.planet.unlocks.smith=40;mine(w,town,chunk);
 assert.equal(town.resources[type],undefined);assert.equal(deposits[type].remaining,quantity);assert.deepEqual(g.errors,[]);
});

test('existing workers and priests can interpret one witnessed disaster differently, including harm and opportunity',async t=>{
 const {g,w,town,chunk}=await basin(t);town.jobs={farmer:1,priest:1};town.influences.faith=6;town.resources.crop=1000;w.planet.unlocks.faith=40;
 w.planet._paultendoFog.explored[key(chunk)]=true;w.planet._paultendoFog.visible[key(chunk)]=1;
 w.openRegBrowser(town,'town');[...w.document.querySelectorAll('.paultendoTownLife button')].find(b=>b.textContent==='Meet the people').click();
 for(const person of town._paultendoPeople)person.outlook='curious';chunk.b='grass';flat(chunk,.94);flat(w.chunkAt(chunk.x+1,chunk.y),.5);
 const event=strike(w,chunk,'earthquake'),clues=w.planet._paultendoLife.clues.filter(c=>c.observation?.kind==='landDisaster');assert.equal(clues.length,2);assert.ok(clues.every(c=>c.observation.disaster===event.id&&c.observation.effect.harm&&c.observation.effect.benefit));
 next(w,6);const priest=clues.find(c=>town._paultendoPeople.find(p=>p.id===c.person).role==='priest'),worker=clues.find(c=>c!==priest);
 assert.equal(priest.study.interpretation.meaning,'belief');assert.match(priest.study.interpretation.text,/gives thanks.*fears another earthquake/);assert.equal(worker.study.interpretation.meaning,'mechanism');assert.equal(worker.observation.event,undefined);assert.deepEqual(g.errors,[]);
});

test('a disaster cannot invent a witness and unseen water changes do not publish identities',async t=>{
 const {g,w,town,chunk}=await basin(t);town._paultendoPeople=[];delete w.planet._paultendoFog.visible[key(chunk)];delete w.planet._paultendoFog.explored[key(chunk)];const logs=w.document.getElementById('logMessages').textContent;
 storm(w);next(w);assert.equal(w.planet._paultendoLife.clues.filter(c=>c.observation?.kind==='landDisaster').length,0);assert.equal(town._paultendoPeople.length,0);assert.ok(Object.values(w.planet._paultendoLand).some(p=>p.flood>.1));assert.doesNotMatch(w.document.getElementById('logMessages').textContent.slice(logs.length),/Water spills/);assert.deepEqual(g.errors,[]);
});

test('a moving storm reaches existing witnesses and brings rain even to bare ground',async t=>{
 const {g,w,town,chunk}=await basin(t);town.jobs={farmer:1};chunk.b='grass';
 w.planet._paultendoFog.explored[key(chunk)]=true;w.planet._paultendoFog.visible[key(chunk)]=1;
 w.openRegBrowser(town,'town');[...w.document.querySelectorAll('.paultendoTownLife button')].find(b=>b.textContent==='Meet the people').click();
 const event=w.happen('Create',null,null,{type:'disaster',subtype:'hurricane',chunks:[[chunk.x-1,chunk.y]],x:chunk.x-1,y:chunk.y,duration:10},'process');event.dir=[1,0];w.actionables.process._disasterSubtypes.hurricane.deathRate=0;
 w.metaEvents.processDisaster.func(event);
 assert.deepEqual(plain(event.chunks),[[chunk.x,chunk.y]]);
 assert.ok(w.planet._paultendoLife.clues.some(c=>c.observation?.kind==='landDisaster'&&c.observation.disaster===event.id));
 const bare=w.chunkAt(40,23);assert.equal(bare.b,'badlands');strike(w,bare,'hurricane',{dir:[0,0]});assert.equal(w.planet._paultendoLand[key(bare)].stormDay,w.planet.day);assert.deepEqual(g.errors,[]);
});
