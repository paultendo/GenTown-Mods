import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGame,settleGame} from './harness.mjs';
const plain=x=>JSON.parse(JSON.stringify(x));
function click(w,text){const b=[...w.document.querySelectorAll('#actionSubList [role="button"]')].find(b=>b.textContent.includes(text));assert.ok(b,`Missing ${text}`);b.click();}
function visit(w,id){w.document.getElementById('actionItem-solar').click();w.document.querySelector(`[data-world-id="${id}"]`).click();click(w,'Switch to world');}
function advance(w,target,event=null){const original=w.chooseEvent;w.chooseEvent=()=>w.planet===target?.state.planet?event:null;try{w.nextDay();}finally{w.chooseEvent=original;}}
function quiet(w){for(const [id,info] of Object.entries(w.dailyEvents))if(!['townEat','processAll'].includes(id)){if(info.func)info.func=()=>{};if(info.perChunk)info.perChunk=()=>{};}}
function grow(w,town){town.lastColony=w.planet.day;for(let n=0;n<100&&!w.filterChunks(c=>c.v.s===town.id&&!c.v.m&&w.adjacentCoords.every(([x,y])=>w.chunkAt(c.x+x,c.y+y)?.v.s===town.id)).length;n++)w.gameEvents.townExpand.func(town,null,{});assert.ok(town.size>5);}
function project(w,town){return w.regToArray('process').find(p=>p.type==='project'&&p.town===town.id&&!p.end);}
function site(w,town,p){const at=w.filterChunks(c=>c.v.s===town.id&&!c.v.m)[0];assert.ok(at);p.x=at.x;p.y=at.y;}
function clear(w,town){for(const key of Object.keys(town.influences))town.influences[key]=0;town.jobs={};town.research={};town.values={justice:0,order:0,openness:0,wealth:0,change:0};}
async function setup(t){const g=await makeGame();t.after(g.close);const w=g.window,warnings=[];w.console.warn=(...args)=>warnings.push(args.map(String).join(' '));const home=settleGame(g);w.planet.day=80;home.pop=100;home.resources={crop:1000};const target=w._paultendoUniverse.worlds[2];target.discovered=true;target.reached=true;visit(w,2);const at=w.filterChunks(c=>!c.v.s&&c.b!=='water'&&c.b!=='mountain')[0],town=w.happen('Create',null,null,{x:at.x,y:at.y},'town');w.happen('Explore',null,null,{x:at.x,y:at.y});town.name='Farbank';town.start=1;town.pop=200;town.resources={crop:1000,rock:100,cash:500};town._paultendoNextExchangeDay=99999;clear(w,town);grow(w,town);town.pop=40;Object.assign(w.planet.unlocks,{smith:20,farm:10});quiet(w);visit(w,1);return {g,w,target,town,warnings};}
function check(g,warnings){assert.deepEqual(g.errors,[]);assert.deepEqual(warnings,[]);}
function open(w,record){const entry=w.document.querySelector(`[data-story-kind="localChoice"][data-story-id="${record.id}"]`);assert.ok(entry);entry.querySelector('.paultendoChronicleStoryLink').click();return w.document.getElementById('actionSubList');}

test('illness starts a real distant hospital, paid construction finishes into its own landmark and lasting effects',async t=>{
 const {g,w,target,town,warnings}=await setup(t);town.influences.disease=4;const prompts=w.planet.stats.prompt;
 advance(w,target,'townProjectStart');const record=target.state.planet._paultendoLife.localChoices.at(-1),p=target.state.planet.reg.process[record.project];
 assert.equal(record.value,'hospital');assert.equal(record.cause.field,'disease');assert.match(record.reason,/Sick people/);assert.equal(record.cause.disease,4);assert.equal(p.subtype,'hospital');assert.equal(target.state.planet._paultendoLife.decisions.length,0);assert.equal(w.planet.stats.prompt,prompts);assert.doesNotMatch(w.document.getElementById('logMessages').textContent,/Farbank.*hospital/);
 assert.equal(target.state.planet.chunks[`${p.x},${p.y}`].v.s,town.id);const rock=town.resources.rock,cash=town.resources.cash;
 for(let n=0;n<30&&!p.done;n++)advance(w,target);assert.ok(p.done);assert.equal(p._paultendoBuilding.phase,'built');assert.equal(p._paultendoBuilding.inputs.rock,rock-town.resources.rock);assert.equal(p._paultendoBuilding.paid,cash-town.resources.cash);assert.equal(p._paultendoBuilding.effects.disease,-5);assert.equal(town.influences.disease,-1);assert.equal(target.state.planet.reg.marker[p.marker].process,p.id);assert.equal(target.state.planet.reg.marker[p.marker].town,town.id);
 const restored=await makeGame({save:plain(w.generateSave())});t.after(restored.close);const rw=restored.window;visit(rw,2);const story=open(rw,record);assert.match(story.textContent,/Sick people.*The work.*opens its doors.*Built with.*eased sickness/s);click(rw,'Visit the hospital');assert.match(rw.document.getElementById('regContent').textContent,/Hospital/);assert.equal(rw.document.getElementById('regBrowser').dataset.id,String(p.marker));const before=plain(p._paultendoBuilding);visit(w,2);assert.deepEqual(plain(p._paultendoBuilding),before,'Visits never repeat work');check(g,warnings);assert.deepEqual(restored.errors,[]);
});

test('local building needs a purpose and obeys native knowledge, laws, size, cooldown and competing processes',async t=>{
 for(const gate of ['purpose','knowledge','law','construction','size','cooldown','process','supplies']){
  const {g,w,target,town,warnings}=await setup(t);town.influences.disease=4;
  if(gate==='purpose')town.influences.disease=0;
  if(gate==='knowledge')target.state.planet.unlocks.smith=10;
  if(gate==='law')town.legal.smith=false;
  if(gate==='construction')town.legal['travel.construction']=false;
  if(gate==='size')town.size=5;
  if(gate==='cooldown')town.lastProject=target.state.planet.day;
  if(gate==='process'){visit(w,2);w.happen('Create',town,null,{type:'project',subtype:'park',cost:1000},'process');visit(w,1);}
  if(gate==='supplies')town.resources={crop:1000,cash:500};
  advance(w,target,'townProjectStart');assert.equal(target.state.planet._paultendoLife.localChoices.length,0,gate);check(g,warnings);
 }
});

test('faith and military study can prefer a stronghold while a faith without that tenet honours itself',async t=>{
 for(const military of [false,true]){
  const {g,w,target,town,warnings}=await setup(t);visit(w,2);const args={choice:'yes'};w.gameEvents.religionEmerges.func(town,null,args);clear(w,town);town.influences.faith=military?4:0;args.religion.tenets=military?['militarism']:[];town.research={military:10};w.planet.unlocks.military=10;visit(w,1);
  advance(w,target,'townProjectStart');const record=target.state.planet._paultendoLife.localChoices.at(-1);assert.ok(record);assert.equal(record.cause.religion,args.religion.id);assert.equal(record.cause.field,military?'military':'faith');assert.equal(military?record.value==='fortress':['temple','statue','flagpole'].includes(record.value),true);check(g,warnings);
 }
});

test('hunger, war and absent supplies stop work and cash charges, then actual work resumes through reload',async t=>{
 const {g,w,target,town,warnings}=await setup(t);town.influences.disease=4;advance(w,target,'townProjectStart');visit(w,2);const p=project(w,town);site(w,town,p);
 const cost=p.cost,cash=town.resources.cash,rock=town.resources.rock;
 town.resources.crop=0;w.gameEvents.townEat.func(town,null,{});w.metaEvents.processProject.func(p);assert.equal(p._paultendoBuilding.phase,'hungry');assert.equal(p.cost,cost);assert.equal(town.resources.rock,rock);assert.equal(town.resources.cash,cash);
 w.planet.day++;town.resources.crop=1000;w.gameEvents.townEat.func(town,null,{});const war=w.happen('Create',null,null,{type:'war',towns:[town.id]},'process');town.issues.war=war.id;w.metaEvents.processProject.func(p);assert.equal(p._paultendoBuilding.phase,'war');assert.equal(p.cost,cost);assert.equal(town.resources.cash,cash);w.happen('Finish',null,war);delete town.issues.war;
 town.resources.rock=0;w.metaEvents.processProject.func(p);assert.equal(p._paultendoBuilding.phase,'supplies');assert.equal(p.cost,cost);assert.equal(town.resources.cash,cash);
 const restored=await makeGame({save:plain(w.generateSave())});t.after(restored.close);const rw=restored.window,rp=rw.regGet('process',p.id),rt=rw.regGet('town',town.id);assert.equal(rp.cost,cost);assert.equal(rp._paultendoBuilding.phase,'supplies');assert.equal(rt.resources.cash,cash);
 rw.happen('AddResource',null,rt,{type:'rock',count:rock});rw.metaEvents.processProject.func(rp);assert.ok(rp.cost<cost||rp.done);assert.ok(rt.resources.cash<cash);assert.ok(rp._paultendoBuilding.steps.some(s=>s.phase==='working'));const paid=rp._paultendoBuilding.paid;rw.metaEvents.processProject.func(rp);assert.ok(rp._paultendoBuilding.paid>=paid);check(g,warnings);assert.deepEqual(restored.errors,[]);
});

test('a project without a recorded building cannot claim a visit to somebody else’s landmark',async t=>{
 const {g,w,target,town,warnings}=await setup(t);town.influences.disease=4;advance(w,target,'townProjectStart');visit(w,2);const record=w.planet._paultendoLife.localChoices.at(-1),p=project(w,town);p.done=w.planet.day;const at=w.filterChunks(c=>c.v.s===town.id)[0];w.happen('Create',null,null,{type:'landmark',subtype:'hospital',x:at.x,y:at.y},'marker');const story=open(w,record);assert.doesNotMatch(story.textContent,/Visit the hospital|opens its doors/);check(g,warnings);
});

test('a neighbour’s actual stone shipment becomes building work, with the exchange linked from the project story',async t=>{
 const {g,w,target,town,warnings}=await setup(t);town.influences.disease=4;advance(w,target,'townProjectStart');visit(w,2);const p=project(w,town),record=w.planet._paultendoLife.localChoices.at(-1);site(w,town,p);town.resources.rock=0;w.planet.unlocks.trade=10;
 const center=w.planet.chunks[town.center.join(',')],at=w.filterChunks(c=>!c.v.s&&c.v.g===center.v.g&&c.b!=='water'&&c.b!=='mountain').sort((a,b)=>Math.hypot(a.x-center.x,a.y-center.y)-Math.hypot(b.x-center.x,b.y-center.y))[0];assert.ok(at);const donor=w.happen('Create',null,null,{x:at.x,y:at.y},'town');w.happen('Explore',null,null,{x:at.x,y:at.y});donor.name='Stonebank';donor.pop=40;donor.resources={crop:1000,rock:100};donor.values={justice:6,openness:6};donor.jobs={};donor._paultendoNextExchangeDay=99999;w.gameEvents.townMarketPurchase.func(town,null,{seller:donor,goodsType:'rock'});const exchange=w.planet._paultendoLife.exchanges.at(-1);assert.ok(exchange);
 for(let n=0;n<30&&!exchange.delivered;n++)advance(w,target);assert.ok(exchange.delivered>0,JSON.stringify(exchange));const shipped=exchange.delivered;
 for(let n=0;n<30&&!exchange.uses?.some(u=>u.kind==='construction'&&u.id===p.id);n++)advance(w,target);const use=exchange.uses.find(u=>u.kind==='construction'&&u.id===p.id);assert.ok(use.count>0&&use.count<=shipped);assert.equal(use.town,town.id);assert.equal(p._paultendoBuilding.inputs.rock,use.count);const story=open(w,record);assert.match(story.textContent,/Follow the stone/);click(w,'Follow the stone');assert.match(story.textContent,/Stonebank|Farbank/);assert.match(story.textContent,/build a hospital/);check(g,warnings);
});

test('losing the actual building site preserves work and supplies until the site is held again',async t=>{
 const {g,w,target,town,warnings}=await setup(t);town.influences.disease=4;advance(w,target,'townProjectStart');visit(w,2);const p=project(w,town),at=w.chunkAt(p.x,p.y);assert.equal(at.v.s,town.id);const before=plain(town.resources),cost=p.cost;delete at.v.s;w.metaEvents.processProject.func(p);assert.equal(p._paultendoBuilding.phase,'site');assert.equal(p.cost,cost);assert.deepEqual(plain(town.resources),before);assert.equal(p.marker,undefined);
 const restored=await makeGame({save:plain(w.generateSave())});t.after(restored.close);const rw=restored.window,rp=rw.regGet('process',p.id);assert.equal(rp._paultendoBuilding.phase,'site');assert.equal(rw.chunkAt(rp.x,rp.y).v.s,undefined);rw.chunkAt(rp.x,rp.y).v.s=town.id;rw.metaEvents.processProject.func(rp);assert.ok(rp.cost<cost||rp.done);check(g,warnings);assert.deepEqual(restored.errors,[]);
});

test('building work cannot consume stone already held for another waiting workshop task',async t=>{
 const {g,w,target,town,warnings}=await setup(t);town.influences.disease=4;advance(w,target,'townProjectStart');visit(w,2);const p=project(w,town),rock=town.resources.rock,cash=town.resources.cash,cost=p.cost;
 const waiting={id:'material:held',town:town.id,type:'stone_tools',status:'waiting',cost:{rock}};w.planet._paultendoLife.materialWork.push(waiting);w.metaEvents.processProject.func(p);assert.equal(p._paultendoBuilding.phase,'supplies');assert.equal(town.resources.rock,rock);assert.equal(town.resources.cash,cash);assert.equal(p.cost,cost);waiting.status='failed';w.metaEvents.processProject.func(p);assert.ok(p.cost<cost||p.done);assert.ok(town.resources.rock<rock);check(g,warnings);
});
