import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGame,settleGame} from './harness.mjs';
const plain=x=>JSON.parse(JSON.stringify(x));
function click(w,text){const b=[...w.document.querySelectorAll('#actionSubList [role="button"]')].find(b=>b.textContent.includes(text));assert.ok(b,`Missing ${text}`);b.click();}
function visit(w,id){w.document.getElementById('actionItem-solar').click();w.document.querySelector(`[data-world-id="${id}"]`).click();click(w,'Switch to world');}
function next(w){const choose=w.chooseEvent;w.chooseEvent=()=>null;try{w.nextDay();}finally{w.chooseEvent=choose;}}
async function setup(t){const g=await makeGame();t.after(g.close);const w=g.window,warnings=[];w.console.warn=(...args)=>warnings.push(args.map(String).join(' '));const home=settleGame(g);w.planet.day=80;home.pop=100;home.resources={crop:1000};const target=w._paultendoUniverse.worlds[2];target.discovered=true;target.reached=true;visit(w,2);const at=w.filterChunks(c=>!c.v.s&&c.b!=='water'&&c.b!=='mountain')[0],away=w.happen('Create',null,null,{x:at.x,y:at.y},'town');w.happen('Explore',null,null,{x:at.x,y:at.y});away.name='Farbank';away.start=78;away.pop=100;away.jobs={farmer:30,miner:15};away.resources={crop:1000,rock:10,metal:10,lumber:10};away._paultendoNextExchangeDay=99999;Object.assign(w.planet.unlocks,{farm:10,smith:10,trade:10});visit(w,1);return {g,w,home,away,target,warnings};}
function check(g,warnings){assert.deepEqual(g.errors,[]);assert.deepEqual(warnings,[]);}

test('native resize before planet creation is safe without the local launcher guard',async t=>{
 let startupPlanet;
 const g=await makeGame({localBoot:false,afterMod:w=>{startupPlanet=w.planet;assert.equal(startupPlanet,null);w.dispatchEvent(new w.Event('resize'));}});t.after(g.close);
 assert.ok(g.window.planet.config);g.window.dispatchEvent(new g.window.Event('resize'));assert.deepEqual(g.errors,[]);
});
test('inactive settlements eat actual food, harvest and mine through native daily events',async t=>{
 const {g,w,away,target,warnings}=await setup(t);const day=target.state.planet.day;
 let farm=0,mine=0;for(const [id,key] of [['townFarm','farm'],['townMine','mine']]){const e=w.gameEvents[id],base=e.perChunk;e.perChunk=function(subject,...args){if(w.planet===target.state.planet){if(key==='farm')farm++;else mine++;}return base.call(this,subject,...args);};e.chunkRate=1;}
 next(w);assert.equal(target.state.planet.day,day+1);assert.ok(away._paultendoFoodFlow.some(flow=>flow.consumed>0));assert.ok(farm>0);assert.ok(mine>0);assert.ok(away._paultendoFoodFlow.some(flow=>flow.harvest>0));check(g,warnings);
});
test('shortages cause native starvation instead of guaranteed background growth',async t=>{
 const {g,w,away,target,warnings}=await setup(t);away.resources={};away.jobs={};w.gameEvents.townBirth.func=()=>{};w.gameEvents.townDeath.func=()=>{};w.gameEvents.townExpand.func=()=>{};const before=away.pop;
 next(w);assert.ok(away.pop<before);assert.ok(away._paultendoFoodFlow.some(flow=>flow.wanted>flow.consumed));assert.equal(target.state.planet.warnings['noFood'+away.id],target.state.planet.day-1);check(g,warnings);
});
test('background local processes run once, and player callbacks and map stay on the visited world',async t=>{
 const {g,w,target,warnings}=await setup(t);let calls=0;w.metaEvents.processBackgroundProbe={func:()=>{calls++;w.logMessage('Farbank completed its work.','milestone');w.lockPlanet();w.updateStats();w.renderMap();w.updateCanvas();w.currentEvents.foreign={done:false};}};
 target.state.planet.reg.process[91]={id:91,_reg:'process',type:'backgroundProbe'};
 const active=w.planet,reg=w.reg,player=w.currentPlayer;
 const choose=w.chooseEvent;w.chooseEvent=()=>{w.currentEvents.keep={done:true,func:()=>{}};return null;};
 try{w.nextDay();}finally{w.chooseEvent=choose;}
 assert.equal(calls,1);assert.equal(w.planet,active);assert.equal(w.reg,reg);assert.equal(w.currentPlayer,player);assert.equal(w._paultendoUniverse.currentWorldId,1);assert.equal(w.planet.locked,false);assert.ok(w.currentEvents.keep);assert.equal(w.currentEvents.foreign,undefined);assert.doesNotMatch(w.document.getElementById('logMessages').textContent,/Farbank completed/);assert.match(decodeURIComponent(target.state.planet._paultendoLogHTML.slice(4)),/Farbank completed/);assert.ok(w.document.getElementById('statsPanel').textContent.length);assert.equal(w._paultendoState.backgroundWorld,undefined);check(g,warnings);
 visit(w,2);assert.match(w.document.getElementById('logMessages').textContent,/Farbank completed/);assert.equal(calls,1);
});
test('reload and world visits do not tick inactive needs or duplicate their history',async t=>{
 const {g,w,away,target,warnings}=await setup(t);next(w);const food=away.resources.crop,day=target.state.planet.day,history=target.state.planet._paultendoLogHTML;
 const restored=await makeGame({save:plain(w.generateSave())});t.after(restored.close);const rw=restored.window,world=rw._paultendoUniverse.worlds[2];assert.equal(world.state.planet.day,day);assert.equal(world.state.planet.reg.town[away.id].resources.crop,food);assert.equal(world.state.planet._paultendoLogHTML,history);visit(rw,2);assert.equal(rw.planet.day,day);assert.equal(rw.regGet('town',away.id).resources.crop,food);check(g,warnings);assert.deepEqual(restored.errors,[]);
});

test('actual workshop work can finish elsewhere with its own world and maker identity',async t=>{
 const {g,w,away,target,warnings}=await setup(t);
 visit(w,2);away.pop=20;away.jobs={farmer:20};away.resources={crop:100,rock:2};away.legal.farm=true;
 for(let n=0;n<3;n++){w.planet.day++;w.gameEvents.townFarm.func(away,null,{value:5});}
 // The recorded harvests are actual production, not a granted discovery.
 visit(w,1);w.gameEvents.townBirth.func=()=>{};w.gameEvents.townDeath.func=()=>{};w.gameEvents.townExpand.func=()=>{};
 let work;for(let n=0;n<8&&!work;n++){next(w);work=target.state.planet._paultendoLife.materialWork.find(x=>x.type==='stone_tools');}
 assert.ok(work);work.roll=.99;for(let n=0;n<10&&work.status!=='made';n++)next(w);
 assert.equal(work.status,'made',JSON.stringify(work));assert.equal(work.cost.rock,2);assert.equal(away._paultendoFarmTools.sets[0].inputs[0].production.world,2);assert.equal(away._paultendoFarmTools.sets[0].inputs[0].production.work,work.id);
 assert.doesNotMatch(w.document.getElementById('logMessages').textContent,/Farbank/);
 visit(w,2);assert.ok(w.document.querySelector('[data-story-kind="material"]'));check(g,warnings);
});
