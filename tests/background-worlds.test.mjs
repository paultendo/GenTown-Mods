import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGame,settleGame} from './harness.mjs';
const plain=x=>JSON.parse(JSON.stringify(x));
function click(w,text){const b=[...w.document.querySelectorAll('#actionSubList [role="button"]')].find(b=>b.textContent.includes(text));assert.ok(b,`Missing ${text}`);b.click();}
function visit(w,id){w.document.getElementById('actionItem-solar').click();w.document.querySelector(`[data-world-id="${id}"]`).click();click(w,'Switch to world');}
function next(w){const choose=w.chooseEvent;w.chooseEvent=()=>null;try{w.nextDay();}finally{w.chooseEvent=choose;}}
async function setup(t){const g=await makeGame();t.after(g.close);const w=g.window,warnings=[];w.console.warn=(...args)=>warnings.push(args.map(String).join(' '));const home=settleGame(g);w.planet.day=80;home.pop=100;home.resources={crop:1000};const target=w._paultendoUniverse.worlds[2];target.discovered=true;target.reached=true;visit(w,2);const at=w.filterChunks(c=>!c.v.s&&c.b!=='water'&&c.b!=='mountain')[0],away=w.happen('Create',null,null,{x:at.x,y:at.y},'town');w.happen('Explore',null,null,{x:at.x,y:at.y});away.name='Farbank';away.start=78;away.pop=100;away.jobs={farmer:30,miner:15};away.resources={crop:1000,rock:10,metal:10,lumber:10};away._paultendoNextExchangeDay=99999;Object.assign(w.planet.unlocks,{farm:10,smith:10,trade:10});visit(w,1);return {g,w,home,away,target,warnings};}
function check(g,warnings){assert.deepEqual(g.errors,[]);assert.deepEqual(warnings,[]);}
function backgroundEvent(w,target,id){const choose=w.chooseEvent;w.chooseEvent=()=>w.planet===target.state.planet?id:null;try{w.nextDay();}finally{w.chooseEvent=choose;}}

test('native resize before planet creation is safe without the local launcher guard',async t=>{
 let startupPlanet;
 const g=await makeGame({localBoot:false,afterMod:w=>{startupPlanet=w.planet;assert.equal(startupPlanet,null);w.dispatchEvent(new w.Event('resize'));assert.doesNotThrow(()=>w.fitToScreen());}});t.after(g.close);
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

test('an inactive town can discover eligible farming knowledge for its food shortage without player prompts or menu notifications',async t=>{
 const {g,w,away,target,warnings}=await setup(t);
 away.resources={crop:1};away.jobs={};away.research={};w.gameEvents.townBirth.func=()=>{};w.gameEvents.townDeath.func=()=>{};
 const settings=w.userSettings,events=w.currentEvents,table=w.randomEvents,recent=w.recentEvents;
 w.document.getElementById('actionItem-unlocks').classList.remove('notify');
 const before=w.planet.stats.prompt;
 backgroundEvent(w,target,'unlockLevel');
 const discovery=target.state.planet._paultendoLife.discoveries['farm:20'];assert.ok(discovery);assert.equal(discovery.origin,away.id);assert.equal(discovery.autonomous,true);assert.match(discovery.reason,/Food is running short/);assert.ok(discovery.need.food<discovery.need.wanted);
 assert.equal(target.state.planet.unlocks.farm,20);assert.equal(w.planet.unlocks.farm,undefined);assert.equal(w.planet.stats.prompt,before);assert.equal(w.userSettings,settings);assert.equal(w.currentEvents,events);assert.equal(w.randomEvents,table);assert.equal(w.recentEvents,recent);assert.equal(w.document.getElementById('actionItem-unlocks').classList.contains('notify'),false);
 const html=decodeURIComponent(target.state.planet._paultendoLogHTML.slice(4));assert.match(html,/data-story-kind="discovery"/);assert.equal((html.match(/discovers/g)||[]).length,1);assert.doesNotMatch(html,/Should they|logAct/);
 const restored=await makeGame({save:plain(w.generateSave())});t.after(restored.close);const rw=restored.window;visit(rw,2);
 const log=rw.document.querySelector('[data-story-kind="discovery"]');assert.ok(log.querySelector('.paultendoChronicleStoryLink'));log.querySelector('.paultendoChronicleStoryLink').click();assert.match(rw.document.getElementById('actionSubList').textContent,/Food is running short/);assert.deepEqual(plain(rw.recentEvents),['unlockLevel']);assert.equal(rw.planet._paultendoLife.decisions.length,0,'Autonomous work must not invent a player choice');check(g,warnings);assert.deepEqual(restored.errors,[]);
});

test('background research needs an actual purpose, keeps native prerequisites, and honours recent refusals',async t=>{
 const {g,w,away,target,warnings}=await setup(t);away.resources={crop:1000};away.jobs={};away.research={};
 target.state.planet.unlocks.faith=0;const before=plain(target.state.planet.unlocks);backgroundEvent(w,target,'unlockLevel');assert.deepEqual(plain(target.state.planet.unlocks),before);
 away.research={education:100};target.state.planet.unlocksRejected.education=target.state.planet.day;backgroundEvent(w,target,'unlockLevel');assert.equal(target.state.planet.unlocks.education,undefined);
 delete target.state.planet.unlocksRejected.education;target.state.planet.unlocks.farm=0;backgroundEvent(w,target,'unlockLevel');assert.equal(target.state.planet.unlocks.education,undefined,'Education requires Agriculture');
 target.state.planet.unlocks.farm=10;backgroundEvent(w,target,'unlockLevel');assert.equal(target.state.planet.unlocks.education,10);assert.match(target.state.planet._paultendoLife.discoveries['education:10'].reason,/studying Education/);check(g,warnings);
});

test('native automatic diplomacy can start a real background war without involving the visited world',async t=>{
 const {g,w,away,target,warnings}=await setup(t);visit(w,2);
 const site=w.filterChunks(c=>!c.v.s&&c.b!=='water'&&Math.abs(c.x-away.center[0])+Math.abs(c.y-away.center[1])<=4)[0];assert.ok(site);
 const rival=w.happen('Create',null,null,{x:site.x,y:site.y},'town');rival.name='Nextbank';rival.start=1;rival.pop=100;rival.resources={crop:1000};rival.jobs={farmer:20,soldier:10};away.start=1;away.jobs={farmer:20,soldier:10};away.influences.military=9;away.relations[rival.id]=-10;rival.relations[away.id]=-10;w.planet.unlocks.military=10;visit(w,1);
 const random=w.Math.random;w.Math.random=()=>.9;try{backgroundEvent(w,target,'townDiplomacy');}finally{w.Math.random=random;}
 const wars=Object.values(target.state.planet.reg.process).filter(p=>p?.type==='war');assert.equal(wars.length,1);assert.equal(away.issues.war,wars[0].id);assert.equal(rival.issues.war,wars[0].id);assert.equal(w.regFilter('process',p=>p.type==='war').length,0);assert.match(decodeURIComponent(target.state.planet._paultendoLogHTML.slice(4)),/War!|declares war/);check(g,warnings);
});

test('player interventions and naming prompts are never chosen for inactive worlds',async t=>{
 const {g,w,target,warnings}=await setup(t);target.state.planet.unlocks.faith=0;const name=w.userSettings.playerName,unlocks=plain(target.state.planet.unlocks);
 for(const id of ['playerAskName','speciesDiscover','swayDiscoveryExpedition','townLaw'])backgroundEvent(w,target,id);
 assert.equal(w.userSettings.playerName,name);assert.deepEqual(plain(target.state.planet.unlocks),unlocks);assert.deepEqual(plain(target.state.planet._paultendoRecentEvents),[]);check(g,warnings);
});

test('missing native event weights cannot bypass background discovery gates',async t=>{
 const {g,w,target,warnings}=await setup(t);let count=0;w.Mod.event('backgroundGateProbe',{auto:true,subject:{reg:'nature',id:1},needsUnlock:{education:100},func:()=>count++});
 backgroundEvent(w,target,'backgroundGateProbe');assert.equal(count,0);target.state.planet.unlocks.education=100;backgroundEvent(w,target,'backgroundGateProbe');assert.equal(count,1);check(g,warnings);
});

test('each world keeps its own native event memory and cooldowns and cannot write player preferences',async t=>{
 const {g,w,target,warnings}=await setup(t);let calls=0;
 w.Mod.event('backgroundMemoryProbe',{auto:true,weight:1e20,cooldown:10,subject:{reg:'nature',id:1},func:()=>{calls++;w.userSettings.playerName='Foreign ruler';w.userSettings.highscore=9999;}});
 w.recentEvents=['homeMark'];target.state.planet._paultendoRecentEvents=['awayMark'];
 const choose=w.chooseEvent;let observed=[];w.chooseEvent=(...args)=>{if(w.planet!==target.state.planet)return null;observed.push(...w.recentEvents);return choose(...args);};
 try{w.nextDay();w.nextDay();}finally{w.chooseEvent=choose;}
 assert.equal(calls,1);assert.ok(observed.includes('awayMark'));assert.ok(observed.includes('backgroundMemoryProbe'));assert.equal(observed.includes('homeMark'),false);assert.deepEqual(plain(w.recentEvents),['homeMark']);assert.equal(target.state.planet.cooldownEvents.backgroundMemoryProbe,target.state.planet.day-1);assert.notEqual(w.userSettings.playerName,'Foreign ruler');assert.notEqual(w.userSettings.highscore,9999);
 const saved=plain(w.generateSave()),restored=await makeGame({save:saved});t.after(restored.close);assert.equal(restored.window._paultendoUniverse.worlds[2].state.planet.cooldownEvents.backgroundMemoryProbe,target.state.planet.cooldownEvents.backgroundMemoryProbe);assert.deepEqual(plain(restored.window.recentEvents),['homeMark']);check(g,warnings);assert.deepEqual(restored.errors,[]);
});

test('advanced knowledge takes actual offscreen work and supplies and retains its maker through reload',async t=>{
 const {g,w,away,target,warnings}=await setup(t);visit(w,2);away.pop=20;away.jobs={scholar:2};away.research={education:100};away.resources={crop:1000};w.happen('AddResource',null,away,{type:'clay',count:1});target.state.planet.unlocks.education=20;visit(w,1);
 for(const id of ['townBirth','townDeath','townExpand','townEat'])w.gameEvents[id].func=()=>{};w.gameEvents.processAll.func=()=>{};
 const settings=w.userSettings,events=w.currentEvents;w.document.getElementById('actionItem-unlocks').classList.remove('notify');backgroundEvent(w,target,'unlockWriting');
 const work=target.state.planet._paultendoLife.inquiries.at(-1);assert.ok(work);assert.equal(work.town,away.id);assert.equal(work.status,'waiting');assert.equal(target.state.planet.unlocks.education,20);assert.equal(away.resources.clay,1);
 next(w,1);assert.equal(work.status,'working');assert.equal(away.resources.clay || 0,0);const remaining=work.remaining;
 const restored=await makeGame({save:plain(w.generateSave())});t.after(restored.close);const rw=restored.window,other=rw._paultendoUniverse.worlds[2],resumed=other.state.planet._paultendoLife.inquiries.find(x=>x.id===work.id);assert.equal(resumed.remaining,remaining);
 for(const id of ['townBirth','townDeath','townExpand','townEat'])rw.gameEvents[id].func=()=>{};rw.gameEvents.processAll.func=()=>{};for(let n=0;n<remaining;n++)next(rw);
 assert.equal(resumed.status,'learned');assert.equal(other.state.planet.unlocks.education,30);assert.equal(rw.planet.unlocks.education,undefined);assert.equal(other.state.planet._paultendoLife.discoveries['education:30'].person,resumed.person);assert.equal(rw.document.getElementById('actionItem-unlocks').classList.contains('notify'),false);assert.doesNotMatch(rw.document.getElementById('logMessages').textContent,/Farbank/);
 visit(rw,2);const story=rw.document.querySelector(`[data-story-kind="inquiry"][data-story-id="${resumed.id}"]`);assert.ok(story);story.querySelector('.paultendoChronicleStoryLink').click();assert.match(rw.document.getElementById('actionSubList').textContent,new RegExp(resumed.name));assert.equal(rw.planet._paultendoLife.decisions.length,0);assert.equal(w.userSettings,settings);assert.equal(w.currentEvents,events);check(g,warnings);assert.deepEqual(restored.errors,[]);
});
