import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGame,settleGame} from './harness.mjs';
const plain=x=>JSON.parse(JSON.stringify(x));
const life=w=>w.planet._paultendoLife;
const panel=w=>w.document.getElementById('actionSubList');
function quiet(w){for(const id of ['townFarm','townTame','townMine','townLumber','townBirth','townDeath','townExpand','townEmploy','townEconomyTick','townTax'])if(w.gameEvents[id]){if(w.gameEvents[id].func)w.gameEvents[id].func=()=>{};if(w.gameEvents[id].perChunk)w.gameEvents[id].perChunk=()=>{};}w.gameEvents.processAll.func=()=>{};}
function next(w){const choose=w.chooseEvent;w.chooseEvent=()=>null;try{w.nextDay();}finally{w.chooseEvent=choose;}}
function click(w,text){const b=[...panel(w).querySelectorAll('[role="button"]')].find(e=>e.textContent.includes(text));assert.ok(b,`${text}: ${panel(w).textContent}`);b.click();}
function setup(g){const w=g.window,town=settleGame(g);w.planet.day=10;town.name='Wick';town.pop=48;town.resources={crop:10000,charcoal:2};town.jobs={miner:24,farmer:24};town.values={justice:6,openness:6};town.influences.travel=3;town._paultendoNextExchangeDay=99999;Object.assign(w.planet.unlocks,{smith:20,fire:20,travel:20});quiet(w);
 w.openRegBrowser(town,'town');[...w.document.querySelectorAll('.paultendoTownLife button')].find(e=>e.textContent==='Meet the people').click();for(const p of town._paultendoPeople)p.outlook='curious';
 for(const c of w.filterChunks(c=>c.v.s===town.id))c.b='grass';const center=w.planet.chunks[town.center.join(',')];w.happen('Explore',null,null,{x:center.x,y:center.y});
 const target=w.filterChunks(c=>!c.v.s&&c.v.g===center.v.g&&c.b!=='water'&&c.b!=='mountain').sort((a,b)=>Math.hypot(a.x-center.x,a.y-center.y)-Math.hypot(b.x-center.x,b.y-center.y))[0];target.b='wetland';
 next(w);const store=town._paultendoGrainStore={vessels:[],steps:[],pressure:{day:10,target:w.$c.maxResource(town)+8}};return {w,town,target,store};}
function mission(w,town){const old=w.Math.random;w.Math.random=()=>0;try{const caller=w.readyEvent('explorationExpeditionPrompt',town);return caller;}finally{w.Math.random=old;}}
function start(w,town){const caller=mission(w,town);assert.ok(caller);assert.equal(caller.args.mission.materialSurvey.type,'clay');w.gameEvents.explorationExpeditionAuto.func(town,null,{choice:'yes',mission:caller.args.mission});const survey=life(w).sampling.at(-1);assert.ok(survey);return survey;}
function finish(w,survey){for(let n=0;n<60&&['outbound','collecting','returning'].includes(survey.status);n++)next(w);assert.equal(survey.status,'arrived',JSON.stringify(survey));}
function errors(g){assert.deepEqual(g.errors,[]);}

test('a real storage need sends a miner to finite wet ground and only the completed return delivers samples',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town,target}=setup(g),knowledge=plain(w.planet.unlocks),survey=start(w,town);assert.equal(survey.status,'outbound');assert.equal(survey.purpose.output,'pottery');assert.equal(town.resources.clay,undefined);assert.equal(life(w).places[survey.place],undefined);
 next(w);assert.equal(survey.status,'collecting');assert.ok(life(w).places[survey.place]);assert.equal(town.resources.clay,undefined);next(w);assert.equal(survey.cargo,1);next(w);assert.equal(survey.status,'returning');assert.equal(survey.cargo,2);assert.equal(target._paultendoDeposits.clay.remaining,38);assert.equal(town.resources.clay,undefined);
 finish(w,survey);assert.equal(survey.delivered,2);assert.equal(survey.cargo,0);assert.equal(town._paultendoMaterials.clay.sources[0].x,target.x);assert.deepEqual(plain(w.planet.unlocks),knowledge);assert.equal(town._paultendoMaterials?.pottery?.technique,undefined);errors(g);
});

test('without a need, native prerequisites, miners, free hands or reachable ground there is no material survey',async t=>{
 for(const obstacle of ['need','knowledge','miner','hands','owned']){const g=await makeGame();t.after(g.close);const {w,town}=setup(g);if(obstacle==='need')delete town._paultendoGrainStore;if(obstacle==='knowledge')w.planet.unlocks.smith=0;if(obstacle==='miner')town.jobs.miner=0;if(obstacle==='hands')life(w).inquiries.push({id:'busy',town:town.id,person:`resident:${town.id}:miner`,status:'working'});if(obstacle==='owned')for(const c of w.filterChunks(c=>c.b==='wetland'))c.v.s=town.id;
 const caller=mission(w,town);assert.equal(caller?.args.mission.materialSurvey,undefined,obstacle);assert.equal(life(w).sampling.length,0);errors(g);}
});

test('food, missing hands and fighting hold a saved survey without collecting another sample',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g),survey=start(w,town);next(w);next(w);assert.equal(survey.cargo,1);town.resources.crop=0;next(w);assert.equal(survey.pause,'food');assert.equal(survey.cargo,1);
 const restored=await makeGame({save:plain(w.generateSave())});t.after(restored.close);const rw=restored.window;quiet(rw);const copy=life(rw).sampling.find(x=>x.id===survey.id),rt=rw.regGet('town',town.id);rt.resources.crop=1000;rt.jobs.miner=0;next(rw);assert.equal(copy.pause,'hands');assert.equal(copy.cargo,1);rt.jobs.miner=24;const at=rw.filterChunks(c=>!c.v.s&&c.b!=='water'&&c.b!=='mountain'&&Math.hypot(c.x-copy.x,c.y-copy.y)>8)[0],enemy=rw.happen('Create',null,null,{x:at.x,y:at.y},'town'),war=rw.happen('Create',rt,null,{type:'war',towns:[rt.id,enemy.id]},'process');rt.issues.war=war.id;next(rw);assert.equal(copy.pause,'war');war.end=true;delete rt.issues.war;finish(rw,copy);assert.equal(copy.delivered,2);assert.equal(rw.planet.chunks[`${copy.x},${copy.y}`]._paultendoDeposits.clay.remaining,38);errors(g);errors(restored);
});

test('changed ownership sends the miner home empty, and exhausted sources cannot be mined again',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town,target}=setup(g),survey=start(w,town);next(w);const rival=w.happen('Create',null,null,{x:target.x,y:target.y},'town');target.v.s=rival.id;for(let n=0;n<10&&survey.status!=='empty';n++)next(w);assert.equal(survey.status,'empty');assert.equal(survey.delivered,undefined);assert.equal(target._paultendoDeposits.clay.remaining,40);assert.match(survey.steps.at(-2).text,/Others now hold/);
 for(const c of w.filterChunks(c=>c.b==='wetland')){c.v.s=0;c._paultendoDeposits={clay:{remaining:0}};(w.planet._paultendoDeposits ||= {})[`${c.x},${c.y}`]=c._paultendoDeposits;}w.planet.day+=20;const caller=mission(w,town);assert.equal(caller?.args.mission.materialSurvey,undefined);errors(g);
});

test('survey stock pays for actual pottery and the two stories retain each other through reload',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g),survey=start(w,town);finish(w,survey);
 const batch=life(w).materialWork.find(x=>x.type==='pottery');assert.ok(batch);batch.roll=.99;for(let n=0;n<15&&batch.status!=='made';n++)next(w);assert.equal(batch.status,'made');assert.equal(batch.inputs.find(i=>i.type==='clay').production.work,survey.id);assert.equal(survey.uses[0].id,batch.id);assert.equal(survey.uses[0].count,2);assert.equal(town.resources.clay || 0,0);assert.ok(town._paultendoGrainStore.vessels.length);
 const restored=await makeGame({save:plain(w.generateSave())});t.after(restored.close);const rw=restored.window;const log=rw.document.querySelector(`[data-story-id="${batch.id}"]`);log.querySelector('.paultendoChronicleStoryLink').click();click(rw,'Where the clay came from');assert.match(panel(rw).textContent,/brings 2 clay home/);const surveyLog=rw.document.querySelector(`[data-story-id="${survey.id}"]`);assert.ok(surveyLog);surveyLog.querySelector('.paultendoChronicleStoryLink').click();assert.match(panel(rw).textContent,/short of clay/);click(rw,'See what the sample became');assert.match(panel(rw).textContent,/Used 2 clay/);errors(g);errors(restored);
});

test('a workshop waiting for its own ingredient can send its maker without allowing production while away',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g);town.jobs={miner:48};next(w);const batch=life(w).materialWork.find(x=>x.type==='pottery');assert.ok(batch);assert.equal(batch.status,'waiting');const survey=start(w,town);assert.equal(survey.person,batch.person);next(w);assert.equal(batch.status,'waiting');assert.equal(batch.delay.reason,'hands');finish(w,survey);next(w);assert.equal(batch.status,'working');assert.equal(batch.inputs.find(i=>i.type==='clay').production.work,survey.id);errors(g);
});

test('reading surveys spends no simulation time or randomness, and hidden surveys reveal no names',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g),survey=start(w,town);const day=w.planet.day,remaining=survey.remaining,random=w.Math.random;let rolls=0;w.Math.random=()=>{rolls++;return random();};w.openRegBrowser(town,'town');[...w.document.querySelectorAll('.paultendoTownLife button')].find(b=>b.textContent==='Materials and workshops').click();click(w,'Looking for clay');assert.match(panel(w).textContent,/short of clay/);assert.equal(rolls,0);assert.equal(w.planet.day,day);assert.equal(survey.remaining,remaining);w.Math.random=random;
 town._hidden=true;const count=w.document.querySelectorAll(`[data-story-id="${survey.id}"]`).length;finish(w,survey);assert.equal(w.document.querySelectorAll(`[data-story-id="${survey.id}"]`).length,count);errors(g);
});

test('full stores keep the finite sample with the survey through reload and unload it only once',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town,target}=setup(g),survey=start(w,town);next(w);next(w);next(w);assert.equal(survey.cargo,2);town.resources.clay=w.$c.maxResource(town);delete town._paultendoGrainStore;
 next(w);assert.equal(survey.status,'returning');assert.equal(survey.cargo,2);assert.ok(survey.room);assert.equal(target._paultendoDeposits.clay.remaining,38);
 const restored=await makeGame({save:plain(w.generateSave())});t.after(restored.close);const rw=restored.window;quiet(rw);const rt=rw.regGet('town',town.id),copy=life(rw).sampling.find(x=>x.id===survey.id);rt.resources.clay=0;finish(rw,copy);assert.equal(rt.resources.clay,2);next(rw);assert.equal(copy.delivered,2);const held=(rt._paultendoCommodityLots.clay || []).filter(l=>l.production?.work===copy.id).reduce((n,l)=>n+l.count,0),used=copy.uses.reduce((n,u)=>n+u.count,0);assert.equal(held+used,2);assert.equal(rw.planet.chunks[`${target.x},${target.y}`]._paultendoDeposits.clay.remaining,38);errors(g);errors(restored);
});

test('a declined actual expedition begins no survey and its accepted choice links to the eventual work',async t=>{
 for(const approve of [false,true]){const g=await makeGame();t.after(g.close);const {w,town}=setup(g),caller=mission(w,town),choose=w.chooseEvent,ready=w.readyEvent;
 w.chooseEvent=()=>caller.eventClass;w.readyEvent=(key,...args)=>key===caller.eventClass?caller:ready(key,...args);try{w.nextDay();}finally{w.chooseEvent=choose;w.readyEvent=ready;}
 const entry=w.document.getElementById('logMessage-'+caller.logID);entry.querySelector(`[type="${approve?'yes':'no'}"]`).click();assert.equal(life(w).sampling.length,approve?1:0);if(approve){const decision=life(w).decisions.at(-1),survey=life(w).sampling.at(-1);assert.equal(decision.sampling,survey.id);entry.querySelector('.paultendoChronicleStoryLink').click();click(w,'Follow the survey');assert.match(panel(w).textContent,/clay vessels/);}errors(g);}
});

test('an inactive world completes the same survey and visiting cannot add another sample',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town,target}=setup(g),survey=start(w,town),home=w._paultendoUniverse.worlds[1];
 w._paultendoUniverse.worlds[2].discovered=true;w._paultendoUniverse.worlds[2].reached=true;w.document.getElementById('actionItem-solar').click();w.document.querySelector('[data-world-id="2"]').click();click(w,'Switch to world');quiet(w);
 for(let n=0;n<20&&survey.status!=='arrived';n++)next(w);assert.equal(survey.status,'arrived',JSON.stringify(survey));assert.equal(survey.delivered,2);assert.equal(home.state.planet.chunks[`${target.x},${target.y}`]._paultendoDeposits.clay.remaining,38);
 w.document.getElementById('actionItem-solar').click();w.document.querySelector('[data-world-id="1"]').click();click(w,'Switch to world');assert.equal(life(w).sampling.find(x=>x.id===survey.id).delivered,2);errors(g);
});
