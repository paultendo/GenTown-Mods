import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGame,settleGame} from './harness.mjs';
const plain=x=>JSON.parse(JSON.stringify(x));
const life=w=>w.planet._paultendoLife;
const panel=w=>w.document.getElementById('actionSubList');
function quiet(w){for(const id of ['townFarm','townTame','townMine','townLumber','townBirth','townDeath','townExpand','townEmploy','townEconomyTick','townTax'])if(w.gameEvents[id]){if(w.gameEvents[id].func)w.gameEvents[id].func=()=>{};if(w.gameEvents[id].perChunk)w.gameEvents[id].perChunk=()=>{};}w.gameEvents.processAll.func=()=>{};}
function next(w){const choose=w.chooseEvent;w.chooseEvent=()=>null;try{w.nextDay();}finally{w.chooseEvent=choose;}}
function click(w,text){const b=[...panel(w).querySelectorAll('[role="button"]')].find(e=>e.textContent.includes(text));assert.ok(b,`${text}: ${panel(w).textContent}`);b.click();}
function setup(g){const w=g.window,expand=w.gameEvents.townExpand.func,harvest=w.gameEvents.townFarm.func,town=settleGame(g);w.planet.day=10;town.name='Wick';town.pop=48;town.resources={crop:10000,charcoal:2};town.jobs={miner:24,farmer:24};town.values={justice:6,openness:6};town.influences.travel=3;town._paultendoNextExchangeDay=99999;Object.assign(w.planet.unlocks,{smith:20,fire:20,travel:20});quiet(w);
 w.openRegBrowser(town,'town');[...w.document.querySelectorAll('.paultendoTownLife button')].find(e=>e.textContent==='Meet the people').click();for(const p of town._paultendoPeople)p.outlook='curious';
 for(const c of w.filterChunks(c=>c.v.s===town.id))c.b='grass';const center=w.planet.chunks[town.center.join(',')];w.happen('Explore',null,null,{x:center.x,y:center.y});
 const target=w.filterChunks(c=>!c.v.s&&c.v.g===center.v.g&&c.b!=='water'&&c.b!=='mountain').sort((a,b)=>Math.hypot(a.x-center.x,a.y-center.y)-Math.hypot(b.x-center.x,b.y-center.y))[0];target.b='wetland';
 next(w);const store=town._paultendoGrainStore={vessels:[],steps:[],pressure:{day:10,target:w.$c.maxResource(town)+8}};return {w,town,target,store,expand,harvest};}
function mission(w,town){const old=w.Math.random;w.Math.random=()=>0;try{const caller=w.readyEvent('explorationExpeditionPrompt',town);return caller;}finally{w.Math.random=old;}}
function start(w,town){const caller=mission(w,town);assert.ok(caller);assert.equal(caller.args.mission.materialSurvey.type,'clay');w.gameEvents.explorationExpeditionAuto.func(town,null,{choice:'yes',mission:caller.args.mission});const survey=life(w).sampling.at(-1);assert.ok(survey);return survey;}
function finish(w,survey){for(let n=0;n<60&&['outbound','collecting','returning'].includes(survey.status);n++)next(w);assert.equal(survey.status,'arrived',JSON.stringify(survey));}
function errors(g){assert.deepEqual(g.errors,[]);}


function grow(w,town,expand,rolls=[0,.5,.99]){const original=w.Math.random,randomChunk=w.randomChunk;let n=0;w.Math.random=()=>rolls[n++] ?? .99;w.randomChunk=()=>w.planet.chunks[town.center.join(',')];try{expand(town,null,{});}finally{w.Math.random=original;w.randomChunk=randomChunk;}return n;}
function prepareClaim(g){const state=setup(g),{w,town}=state,survey=start(w,town);finish(w,survey);next(w);assert.equal(town.resources.clay || 0,0);return {...state,survey};}

test('actual native growth claims sampled ground for an ongoing shortage without granting extra land or stock',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town,target,survey,expand}=prepareClaim(g),size=town.size,stock=plain(town.resources),know=plain(w.planet.unlocks);const rolls=grow(w,town,expand);assert.equal(target.v.s,town.id);assert.equal(town.size,size+1);assert.deepEqual(plain(town.resources),stock);assert.deepEqual(plain(w.planet.unlocks),know);assert.equal(rolls,3);assert.equal(survey.claimed,w.planet.day);assert.equal(survey.claims.length,1);assert.match(survey.steps.at(-1).text,/miners can work the clay/);assert.equal(w._paultendoMaterialExpansion,undefined);errors(g);
});

test('a source does not override native chance, population density, laws, fighting or hunger',async t=>{
 for(const obstacle of ['chance','density','law','travel','war','food']){const g=await makeGame();t.after(g.close);const {w,town,survey,expand}=prepareClaim(g),size=town.size;if(obstacle==='density')town.pop=1;if(obstacle==='law')town.legal['travel.expansion']=false;if(obstacle==='travel')town.legal.travel=false;if(obstacle==='war')town.issues.war=9000;if(obstacle==='food')town.resources.crop=0;grow(w,town,expand,obstacle==='chance'?[.999]:undefined);assert.equal(survey.claimed,undefined,obstacle);assert.equal(survey.claims,undefined,obstacle);if(!['food','travel'].includes(obstacle))assert.equal(town.size,size,obstacle);errors(g);}
});

test('unfinished, unremembered, depleted, occupied and no-longer-needed sources do not direct expansion',async t=>{
 for(const obstacle of ['unfinished','unremembered','depleted','occupied','need']){const g=await makeGame();t.after(g.close);const {w,town,target,survey,expand}=prepareClaim(g);if(obstacle==='unfinished'){delete survey.delivered;survey.status='outbound';}if(obstacle==='unremembered')life(w).sampling=[];if(obstacle==='depleted')target._paultendoDeposits.clay.remaining=0;if(obstacle==='occupied')target.v.s=9000;if(obstacle==='need'){town.resources.clay=100;town.resources.pottery=100;delete town._paultendoGrainStore;life(w).materialWork=[];}grow(w,town,expand);assert.equal(survey.claims,undefined,obstacle);assert.equal(survey.claimed,undefined,obstacle);errors(g);}
});

test('a saved source guides only contiguous steps toward it and a changed owner closes that route',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town,target,expand}=setup(g);const far=w.filterChunks(c=>!c.v.s&&c.v.g===target.v.g&&c.b!=='water'&&c.b!=='mountain'&&Math.hypot(c.x-target.x,c.y-target.y)>4&&Math.hypot(c.x-target.x,c.y-target.y)<7)[0];assert.ok(far);for(const c of w.filterChunks(c=>c.b==='wetland'))c.b='grass';far.b='wetland';const survey=start(w,town);assert.equal(`${survey.x},${survey.y}`,`${far.x},${far.y}`);finish(w,survey);next(w);assert.equal(town.resources.clay || 0,0);
 const restored=await makeGame({save:plain(w.generateSave())});t.after(restored.close);const rw=restored.window,rt=rw.regGet('town',town.id),copy=life(rw).sampling.find(s=>s.id===survey.id),before=new Set(rw.filterChunks(c=>c.v.s===rt.id).map(c=>`${c.x},${c.y}`));grow(rw,rt,rw.gameEvents.townExpand.func);assert.equal(copy.claims.length,1);assert.equal(copy.claimed,undefined);const step=copy.claims[0];assert.ok(rw.adjacentCoords.some(([dx,dy])=>before.has(`${step.x+dx},${step.y+dy}`)));const control=await makeGame({save:plain(w.generateSave())});t.after(control.close);const cw=control.window,ct=cw.regGet('town',town.id);life(cw).sampling=[];grow(cw,ct,cw.gameEvents.townExpand.func);assert.notEqual(cw.planet.chunks[`${step.x},${step.y}`].v.s,ct.id);errors(control);assert.equal(rw.planet.chunks[copy.place].v.s,undefined);rw.planet.chunks[copy.place].v.s=9000;grow(rw,rt,rw.gameEvents.townExpand.func);assert.equal(copy.claims.length,1);errors(g);errors(restored);
});

test('claiming the surveyed source lets actual native mining gather from the same finite deposit',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town,target,survey,expand}=prepareClaim(g);grow(w,town,expand);assert.equal(survey.claimed,w.planet.day);const before=target._paultendoDeposits.clay.remaining,stock=town.resources.clay || 0; // Restore the wrapped native miner through a reload rather than replacing a mod hook.
 const saved=await makeGame({save:plain(w.generateSave())});t.after(saved.close);const sw=saved.window,st=sw.regGet('town',town.id),sc=sw.planet.chunks[`${target.x},${target.y}`],rnd=sw.Math.random;sw.Math.random=()=>0;sw.gameEvents.townMine.perChunk(st,null,sc);sw.Math.random=rnd;assert.ok(sc._paultendoDeposits.clay.remaining<before);assert.ok((st.resources.clay || 0)>stock);errors(saved);
});


test('a return whisper through an actual miner begins a delayed sample journey to that same remembered source',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town,survey,harvest}=prepareClaim(g);w.planet.day+=30;town.resources.crop=w.$c.maxResource(town);harvest(town,null,{value:48});assert.equal(town._paultendoGrainStore.pressure.day,w.planet.day);town.jobs={miner:24,farmer:24};const miner=town._paultendoPeople.find(p=>p.role==='miner');miner.outlook='curious';miner.trust=90;town.guidanceTrust=90;w.openRegBrowser(town,'town');[...w.document.querySelectorAll('.paultendoTownLife button')].find(b=>b.textContent===`Visit ${life(w).places[survey.place].name}`).click();click(w,'Whisper about this place');click(w,miner.name);click(w,'There is still something to learn');const words=life(w).whispers.at(-1);words.roll=0;const before=town.resources.clay || 0;next(w);assert.equal(words.resolved,false);next(w);assert.equal(words.reception,'reshaped');const journey=life(w).sampling.find(s=>s.id===words.mission.sampling);assert.ok(journey);assert.equal(journey.person,miner.id);assert.equal(`${journey.x},${journey.y}`,survey.place);assert.equal(journey.status,'outbound');assert.equal(town.resources.clay || 0,before);assert.doesNotMatch(words.steps.at(-1).text,/charted the route|known now/);finish(w,journey);assert.equal(words.mission.place,survey.place);assert.equal(journey.delivered,2);w.openRegBrowser(town,'town');[...w.document.querySelectorAll('.paultendoTownLife button')].find(b=>b.textContent==='Meet the people').click();click(w,miner.name);click(w,words.title);click(w,'Follow the survey');assert.match(panel(w).textContent,/brings 2 clay home/);errors(g);
});

test('source descriptions use actual samples, respect visibility and consume no simulation rolls',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town,target,survey}=prepareClaim(g);const day=w.planet.day,rnd=w.Math.random;let rolls=0;w.Math.random=()=>{rolls++;return rnd();};w.openRegBrowser(town,'town');[...w.document.querySelectorAll('.paultendoTownLife button')].find(b=>b.textContent===`Visit ${life(w).places[survey.place].name}`).click();assert.match(panel(w).textContent,/clay deposit still has material/);assert.equal(rolls,0);assert.equal(w.planet.day,day);target._paultendoDeposits.clay.remaining=0;click(w,'Wohua’s clay survey');click(w,'Visit Wetland Rest');assert.match(panel(w).textContent,/exhausted the clay/);w.Math.random=rnd;errors(g);
});


test('an expired harvest need keeps a return journey from promising or awarding unwanted samples',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town,survey}=prepareClaim(g);w.planet.day+=30;const miner=town._paultendoPeople.find(p=>p.role==='miner');miner.trust=90;town.guidanceTrust=90;
 w.openRegBrowser(town,'town');[...w.document.querySelectorAll('.paultendoTownLife button')].find(b=>b.textContent===`Visit ${life(w).places[survey.place].name}`).click();click(w,'Whisper about this place');click(w,miner.name);click(w,'There is still something to learn');const words=life(w).whispers.at(-1);words.roll=0;const samples=life(w).sampling.length,deposit=w.planet.chunks[survey.place]._paultendoDeposits.clay.remaining;next(w);next(w);
 assert.equal(words.reception,'heard');assert.equal(words.mission.sampling,undefined);assert.equal(life(w).sampling.length,samples);assert.equal(w.planet.chunks[survey.place]._paultendoDeposits.clay.remaining,deposit);assert.equal(town.resources.clay || 0,0);assert.doesNotMatch(words.steps.at(-1).text,/gather clay/);errors(g);
});
