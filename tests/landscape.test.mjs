import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGame,settleGame} from './harness.mjs';
const plain=x=>JSON.parse(JSON.stringify(x)),key=c=>`${c.x},${c.y}`,patch=(w,c)=>w.planet._paultendoLand?.[key(c)];
async function setup(t){const g=await makeGame();t.after(g.close);const w=g.window,town=settleGame(g),chunk=w.chunkAt(...town.center);w.planet.day=20;Object.assign(w.planet.unlocks,{fire:10,smith:40,farm:10});Object.assign(town,{name:'Greenbank',pop:100,jobs:{lumberer:1,farmer:1},resources:{crop:0,lumber:0,cash:0}});town.influences.farm=0;chunk.b='grass';chunk.m=.8;chunk.t=.55;return {g,w,town,chunk};}
function strike(w,c,subtype,{duration=10,coords=[[c.x,c.y]],event=null}={}){event ||= w.happen('Create',null,null,{type:'disaster',subtype,x:c.x,y:c.y,chunks:coords,duration},'process');const random=w.Math.random;w.Math.random=()=>.99;try{w.metaEvents.processDisaster.func(event);}finally{w.Math.random=random;}return event;}
function quiet(w){for(const e of Object.values(w.dailyEvents)){if(e.func)e.func=()=>{};if(e.perChunk)e.perChunk=()=>{};}w.gameEvents.processAll.func=()=>{};}
function next(w,n=1){const choose=w.chooseEvent;w.chooseEvent=()=>null;try{for(let i=0;i<n;i++)w.nextDay();}finally{w.chooseEvent=choose;}}
function fixed(w,n,fn){const random=w.Math.random;w.Math.random=()=>n;try{return fn();}finally{w.Math.random=random;}}
function flat(c,height){c.p=c.p.map(row=>row.map(()=>height));c.e=height;}

test('a real fire consumes vegetation and harms local fertility without awarding commodities',async t=>{
 const {g,w,town,chunk}=await setup(t),fertility=w.happen('Fertility',town,chunk,null,'chunk'),stock=plain(town.resources);strike(w,chunk,'wildfire');const p=patch(w,chunk);assert.ok(p.cover<1&&p.cover>0);assert.ok(p.soil<1);assert.ok(p.scorch>0);assert.ok(w.happen('Fertility',town,chunk,null,'chunk')<fertility);assert.deepEqual(plain(town.resources),stock);assert.equal(p.history[0].kind,'burn');assert.deepEqual(g.errors,[]);
});

test('lumberers cannot gather more timber than remains in a burned stand and do not consume full-store overflow',async t=>{
 const {g,w,town,chunk}=await setup(t);strike(w,chunk,'wildfire');town.jobs.lumberer=1200;const p=patch(w,chunk),available=Math.floor(p.cover*120);fixed(w,.1,()=>w.gameEvents.townLumber.perChunk(town,null,chunk,{}));assert.equal(town.resources.lumber,available);assert.ok(p.cover<1/120);fixed(w,.1,()=>w.gameEvents.townLumber.perChunk(town,null,chunk,{}));assert.equal(town.resources.lumber,available);
 const other=w.filterChunks(c=>c.b==='grass'&&key(c)!==key(chunk))[0];town.resources.lumber=w.$c.maxResource(town);fixed(w,.1,()=>w.gameEvents.townLumber.perChunk(town,null,other,{}));assert.equal(patch(w,other)?.cover ?? 1,1);assert.deepEqual(g.errors,[]);
});

test('native farming responds to the damaged soil rather than retaining its old success rate',async t=>{
 const {g,w,town,chunk}=await setup(t);chunk.e=.5;chunk.m=.5;chunk.t=.5;const before=w.happen('Fertility',town,chunk,null,'chunk')/2;strike(w,chunk,'wildfire');const after=w.happen('Fertility',town,chunk,null,'chunk')/2,n=(before+after)/2,args={value:0};fixed(w,n,()=>w.gameEvents.townFarm.perChunk(town,null,chunk,args));assert.equal(args.value,0);assert.ok(after<before);assert.deepEqual(g.errors,[]);
});

test('fire spread requires actual neighbouring fuel and wetter growth reduces its chance',async t=>{
 const {g,w,chunk}=await setup(t);const around=w.adjacentCoords.map(([x,y])=>w.chunkAt(chunk.x+x,chunk.y+y)).filter(Boolean);for(const c of around){c.b='desert';c.v.m=null;c.v.s=null;}const event=w.happen('Create',null,null,{type:'disaster',subtype:'wildfire',x:chunk.x,y:chunk.y,chunks:[[chunk.x,chunk.y]],duration:10},'process');fixed(w,0,()=>w.metaEvents.processDisaster.func(event));assert.deepEqual(plain(event.chunks),[[chunk.x,chunk.y]]);
 assert.equal(w.actionables.process._disasterSubtypes.wildfire.spread,4);assert.deepEqual(g.errors,[]);
});

test('spent vegetation cannot keep an unbuilt wildfire burning indefinitely',async t=>{
 const {g,w,chunk}=await setup(t);chunk.v.m=null;const event=strike(w,chunk,'wildfire');for(let i=0;i<20&&!event.done;i++){w.planet.day++;strike(w,chunk,'wildfire',{event});}assert.ok(event.done);assert.ok(patch(w,chunk).cover<.03);assert.deepEqual(g.errors,[]);
});

test('wet, warm ground regrows faster than dry ground, without regrowing on the damage day',async t=>{
 const {g,w,chunk}=await setup(t);const dry=w.filterChunks(c=>c.b==='grass'&&key(c)!==key(chunk))[0];Object.assign(dry,{m:0,t:.55});strike(w,chunk,'wildfire');strike(w,dry,'wildfire');const wetBefore=patch(w,chunk).cover,dryBefore=patch(w,dry).cover;quiet(w);next(w,10);assert.ok(patch(w,chunk).cover>wetBefore);assert.equal(patch(w,dry).cover,dryBefore);assert.ok(patch(w,chunk).soil<1);assert.deepEqual(g.errors,[]);
});

test('a finished earthquake moves ground downhill, conserves total height and keeps both tiles on land',async t=>{
 const {g,w,chunk}=await setup(t);const around=[[1,0],[-1,0],[0,1],[0,-1]].map(([x,y])=>w.chunkAt(chunk.x+x,chunk.y+y)).filter(Boolean);for(const c of around){c.b='grass';flat(c,.85);}const low=around[0];flat(chunk,.9);flat(low,.6);const total=chunk.p.flat().reduce((a,b)=>a+b,0)+low.p.flat().reduce((a,b)=>a+b,0);const event=strike(w,chunk,'earthquake',{duration:1});assert.ok(event.done);assert.ok(chunk.e<.9);assert.ok(low.e>.6);assert.ok(patch(w,chunk).rubble>0&&patch(w,low).rubble>0);assert.ok(Math.abs(total-(chunk.p.flat().reduce((a,b)=>a+b,0)+low.p.flat().reduce((a,b)=>a+b,0)))<1e-10);assert.ok(Math.min(...chunk.p.flat(),...low.p.flat())>w.planet.config.waterLevel);assert.deepEqual(g.errors,[]);
});

test('an earthquake on level ground or beside water cannot invent a landslide or redraw a coastline',async t=>{
 const {g,w,chunk}=await setup(t);flat(chunk,.7);for(const c of [[1,0],[-1,0],[0,1],[0,-1]].map(([x,y])=>w.chunkAt(chunk.x+x,chunk.y+y)).filter(Boolean)){c.b='water';flat(c,.2);}const before=plain(chunk.p);strike(w,chunk,'earthquake',{duration:1});assert.deepEqual(plain(chunk.p),before);assert.equal(patch(w,chunk),undefined);assert.deepEqual(g.errors,[]);
});

test('a moving storm changes the vegetation it actually reaches, including unclaimed land',async t=>{
 const {g,w,chunk}=await setup(t);const other=w.chunkAt(chunk.x+1,chunk.y);other.b='grass';other.v.s=null;const event=w.happen('Create',null,null,{type:'disaster',subtype:'hurricane',x:chunk.x,y:chunk.y,chunks:[[chunk.x,chunk.y]],duration:1},'process');event.dir=[1,0];strike(w,chunk,'hurricane',{event});assert.ok(event.done);assert.equal(patch(w,chunk),undefined);assert.ok(patch(w,other).cover<1);assert.equal(patch(w,other).history[0].kind,'wind');assert.deepEqual(g.errors,[]);
});

test('vegetation, soil and precise landslide heights survive compression, with no repeat loss on reload',async t=>{
 const {g,w,chunk}=await setup(t);const around=[[1,0],[-1,0],[0,1],[0,-1]].map(([x,y])=>w.chunkAt(chunk.x+x,chunk.y+y)).filter(Boolean);for(const c of around){c.b='grass';flat(c,.85);}flat(chunk,.9);flat(around[0],.6);const event=strike(w,chunk,'earthquake');strike(w,chunk,'wildfire');const ledger=plain(w.planet._paultendoLand),pixels=plain(chunk.p),height=chunk.e;const copy=await makeGame({save:plain(w.generateSave())});t.after(copy.close);const rw=copy.window,rc=rw.chunkAt(chunk.x,chunk.y);assert.deepEqual(plain(rw.planet._paultendoLand),ledger);assert.deepEqual(plain(rc.p),pixels);assert.equal(rc.e,height);strike(rw,rc,'earthquake',{event:rw.regGet('process',event.id)});assert.deepEqual(plain(rw.planet._paultendoLand),ledger);assert.deepEqual(g.errors,[]);assert.deepEqual(copy.errors,[]);
});

test('unseen damage changes the world without revealing its history and opening known land cannot advance it',async t=>{
 const {g,w,chunk}=await setup(t);const far=w.filterChunks(c=>c.b==='grass'&&!w.document.getElementById('logMessages').textContent.includes(`${c.x},${c.y}`)&&Math.hypot(c.x-chunk.x,c.y-chunk.y)>15)[0];const logs=w.document.getElementById('logMessages').textContent;strike(w,far,'wildfire');assert.ok(patch(w,far));assert.equal(w.document.querySelectorAll('[data-story-kind="land"]').length,0);
 strike(w,chunk,'wildfire');const before=plain(w.planet._paultendoLand),link=[...w.document.querySelectorAll('[data-story-kind="land"] [role="button"]')].at(-1);assert.ok(link);link.click();assert.match(w.document.getElementById('actionSubList').textContent,/Blackened ground|scorched/);assert.deepEqual(plain(w.planet._paultendoLand),before);assert.deepEqual(g.errors,[]);
});

test('the same ignition reaches dry neighbouring growth but fails against a wet stand',async t=>{
 for(const moisture of [0,1]){const {g,w,chunk}=await setup(t);const offset=w.adjacentCoords.find(([x,y])=>w.chunkAt(chunk.x+x,chunk.y+y)),target=w.chunkAt(chunk.x+offset[0],chunk.y+offset[1]);Object.assign(target,{b:'grass',m:moisture});target.v.s=null;target.v.m=null;
 const choose=w.choose;w.choose=values=>values===w.adjacentCoords?offset:choose(values);const event=w.happen('Create',null,null,{type:'disaster',subtype:'wildfire',x:chunk.x,y:chunk.y,chunks:[[chunk.x,chunk.y]],duration:10},'process');fixed(w,.25,()=>w.metaEvents.processDisaster.func(event));w.choose=choose;
 assert.equal(event.chunks.some(c=>c.join(',')===key(target)),moisture===0);assert.deepEqual(g.errors,[]);}
});

test('clearing every nearby stand leaves no seed source for automatic regrowth',async t=>{
 const {g,w,town,chunk}=await setup(t);town.jobs.lumberer=1200;const group=[chunk,...[[1,0],[-1,0],[0,1],[0,-1]].map(([x,y])=>w.chunkAt(chunk.x+x,chunk.y+y)).filter(Boolean)];for(const c of group){c.b='grass';c.m=.9;c.t=.55;fixed(w,.1,()=>w.gameEvents.townLumber.perChunk(town,null,c,{}));assert.equal(patch(w,c).cover,0);}const groupKeys=new Set(group.map(key));for(const c of group)for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const outside=w.chunkAt(c.x+dx,c.y+dy);if(outside&&!groupKeys.has(key(outside)))outside.b='desert';}quiet(w);next(w,10);assert.equal(patch(w,chunk).cover,0);assert.deepEqual(g.errors,[]);
});

test('damage beyond current sight stays out of the Chronicle even when the tile was explored before',async t=>{
 const {g,w,chunk}=await setup(t);const far=w.filterChunks(c=>c.b==='grass'&&Math.hypot(c.x-chunk.x,c.y-chunk.y)>15)[0];w.planet._paultendoFog.explored[key(far)]=true;delete w.planet._paultendoFog.visible[key(far)];strike(w,far,'wildfire');assert.equal(patch(w,far).history[0].known,false);assert.equal(w.document.querySelectorAll('[data-story-kind="land"]').length,0);assert.deepEqual(g.errors,[]);
});

test('deforestation pressure follows lost vegetation rather than population alone or free replanting',async t=>{
 const {g,w,town,chunk}=await setup(t);w.gameEvents.environmentalPressure.func(town);assert.equal(town.environmentalPressure.deforestation,0);strike(w,chunk,'wildfire');w.gameEvents.environmentalPressure.func(town);assert.ok(town.environmentalPressure.deforestation>0);assert.equal(w.gameEvents.localDeforestation,undefined);assert.deepEqual(g.errors,[]);
});
