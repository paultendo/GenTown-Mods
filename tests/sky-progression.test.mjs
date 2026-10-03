import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGame,settleGame} from './harness.mjs';
const plain=x=>JSON.parse(JSON.stringify(x));
const sky=w=>w.planet._paultendoSky,life=w=>w.planet._paultendoLife;
function quiet(w){for(const id of ['townFarm','townTame','townMine','townLumber','townEat','townBirth','townDeath','townExpand','townEmploy']){if(w.gameEvents[id].func)w.gameEvents[id].func=()=>{};if(w.gameEvents[id].perChunk)w.gameEvents[id].perChunk=()=>{};}w.gameEvents.processAll.func=()=>{};}
function setup(g){const w=g.window,town=settleGame(g);w.planet.day=30;town.name='Watchbank';town.pop=40;town.jobs={scholar:10,miner:10,farmer:20};town.resources={crop:400,glass:2,metal:20,lumber:20};town.research={education:1,farm:10};town._paultendoNextExchangeDay=9999;Object.assign(w.planet.unlocks,{education:20,smith:30,fire:50,travel:20,astronomy:20,trade:10,farm:10});quiet(w);return {w,town};}
function next(w){const choose=w.chooseEvent;w.chooseEvent=()=>null;try{w.nextDay();}finally{w.chooseEvent=choose;}}
function panel(w){return w.document.getElementById('actionSubList');}
function click(w,text){const b=[...panel(w).querySelectorAll('[role="button"]')].find(b=>b.textContent.includes(text));assert.ok(b,`Missing ${text}: ${panel(w).textContent}`);b.click();}
function solar(w){w.document.getElementById('actionItem-solar').click();}
function batch(w,type){return life(w).materialWork.findLast(b=>b.type===type);}
function scholar(town){return town._paultendoPeople.find(p=>p.role==='scholar');}
function war(w,town){const center=w.planet.chunks[town.center.join(',')],chunk=w.filterChunks(c=>!c.v.s&&c.v.g===center.v.g&&c.b!=='water'&&c.b!=='mountain')[0],rival=w.happen('Create',null,null,{x:chunk.x,y:chunk.y},'town');rival.pop=48;const conflict=w.happen('Create',town,null,{type:'war',towns:[town.id,rival.id]},'process');town.issues.war=conflict.id;return conflict;}
function advanced(w){Object.assign(w.planet.unlocks,{education:70,smith:80,fire:70,travel:90});}
function telescope(w){next(w);const b=batch(w,'telescope');assert.ok(b);b.roll=.99;for(let n=0;n<12&&!sky(w).surveys[1]?.instrument;n++)next(w);return b;}
function errors(g){assert.deepEqual(g.errors,[]);}

test('technology alone neither launches satellites nor clears fog or charts other worlds',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g);town.jobs={farmer:40};advanced(w);w.planet.unlocks.space=100;w._paultendoUniverse.spaceTech=100;for(let n=0;n<4;n++)next(w);
 assert.equal(w._paultendoUniverse.spaceTech,0);assert.equal(w.planet.unlocks.space,0);assert.equal(w.planet._paultendoFog.cleared,false);assert.equal(Object.values(w._paultendoUniverse.worlds).filter(x=>x.discovered).length,1);assert.equal(sky(w).flights.length,0);assert.doesNotMatch(w.document.getElementById('logMessages').textContent,/satellites rise|lunar mission becomes possible/i);errors(g);
});

test('a paid telescope enables actual observations and charting, but the new world remains beyond reach',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g);const b=telescope(w),survey=sky(w).surveys[town.id];assert.equal(b.status,'made');assert.equal(town.resources.glass || 0,0);assert.equal(town.resources.metal,18);assert.equal(town.resources.lumber,19);assert.equal(town.resources.telescope || 0,0);assert.equal(survey.instrument.inputs[0].production.work,b.id);assert.equal(survey.count,1);
 const before=plain(survey);solar(w);click(w,'The night charts');solar(w);assert.deepEqual(plain(survey),before,'Reading a chart cannot add an observation');assert.equal(w._paultendoUniverse.worlds[2].discovered,false);next(w);next(w);const moon=w._paultendoUniverse.worlds[2];assert.equal(moon.discovered,true);assert.equal(moon.reached,undefined);assert.equal(moon.state,null);assert.equal(moon.chart.person,scholar(town).id);assert.equal(moon.chart.observations,3);assert.equal(w.planet._paultendoFog.cleared,false);
 w.document.querySelector('[data-world-id="2"]')?.click();solar(w);w.document.querySelector('[data-world-id="2"]').click();assert.match(panel(w).textContent,/Only its light has reached us/);assert.doesNotMatch(panel(w).textContent,/Switch to world|Launch mission|Habitable/);assert.equal(w._paultendoUniverse.currentWorldId,1);errors(g);
});

test('war, hunger and unavailable scholars pause observations and reload preserves the actual chart history',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g);telescope(w);const survey=sky(w).surveys[town.id],count=survey.count;town.resources.crop=0;next(w);assert.equal(survey.count,count);town.resources.crop=400;town.jobs.scholar=0;next(w);assert.equal(survey.count,count);town.jobs.scholar=10;const conflict=war(w,town);next(w);assert.equal(survey.count,count);conflict.end=true;delete town.issues.war;
 const restored=await makeGame({save:plain(w.generateSave())});t.after(restored.close);const rw=restored.window;quiet(rw);assert.deepEqual(plain(sky(rw).surveys),plain(sky(w).surveys));next(rw);assert.equal(sky(rw).surveys[town.id].count,count+1);assert.equal(sky(rw).surveys[town.id].instrument.id,survey.instrument.id);errors(g);errors(restored);
});

test('a requested survey waits for an actual assembled vessel and reports only after its journey',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g);telescope(w);advanced(w);scholar(town).outlook='steadfast';town.research={farm:20};w.happen('AddResource',null,town,{type:'steel',count:8});w.happen('AddResource',null,town,{type:'glass',count:2});w.happen('AddResource',null,town,{type:'charcoal',count:4});solar(w);click(w,'prepare a survey satellite');const flight=sky(w).flights[0];assert.equal(flight.requested,true);assert.equal(flight.status,'preparing');assert.equal(sky(w).orbitalSurvey,undefined);
 for(let n=0;n<10&&!batch(w,'sky_vessel');n++)next(w);const vessel=batch(w,'sky_vessel');assert.ok(vessel);vessel.roll=.99;next(w);assert.equal(town.resources.steel || 0,0);assert.equal(town.resources.glass || 0,0);assert.equal(town.resources.charcoal || 0,0);assert.equal(vessel.status,'working');assert.equal(flight.status,'preparing');assert.equal(w.planet._paultendoFog.cleared,false);
 for(let n=0;n<12;n++)next(w);assert.equal(vessel.status,'made');assert.equal(flight.status,'enroute');assert.equal(town.resources.sky_vessel || 0,0);assert.equal(flight.inputs[0].production.work,vessel.id);assert.equal(sky(w).orbitalSurvey,undefined);
 const saved=plain(w.generateSave()),restored=await makeGame({save:saved});t.after(restored.close);const rw=restored.window;quiet(rw);const copy=sky(rw).flights.find(f=>f.id===flight.id),rt=rw.regGet('town',town.id);assert.equal(copy.arrival,flight.arrival);for(let n=0;n<4;n++)next(rw);assert.equal(copy.status,'arrived');assert.equal(sky(rw).orbitalSurvey.flight,flight.id);assert.equal(rw._paultendoUniverse.spaceTech,20);assert.equal(rw.planet._paultendoFog.cleared,true);assert.equal(rt.resources.sky_vessel || 0,0);solar(rw);click(rw,'Survey satellite');click(rw,'Visit the vessel’s workshop');assert.match(panel(rw).textContent,/Used 8 steel, 2 glass, and 4 charcoal/);errors(g);errors(restored);
});

test('flight preparations give meals and war priority, while an autonomous scholar can act after genuine sky work',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g);telescope(w);next(w);next(w);advanced(w);scholar(town).outlook='curious';w.happen('AddResource',null,town,{type:'sky_vessel',count:1});next(w);const flight=sky(w).flights[0];assert.equal(flight.requested,false);assert.equal(flight.status,'enroute');assert.equal(town.resources.sky_vessel || 0,0);assert.equal(sky(w).surveys[town.id].count>=3,true);
 // After the first arrival, a fresh probe can be planned but must wait through
 // hunger and fighting without taking its vessel. Knowledge grants no stock.
 for(let n=0;n<4;n++)next(w);scholar(town).outlook='steadfast';w.happen('AddResource',null,town,{type:'sky_vessel',count:1});solar(w);w.document.querySelector('[data-world-id="2"]').click();click(w,'prepare a probe');const probe=sky(w).flights.at(-1);town.resources.crop=0;next(w);assert.equal(probe.status,'preparing');assert.equal(town.resources.sky_vessel,1);town.resources.crop=400;const conflict=war(w,town);next(w);assert.equal(probe.status,'preparing');assert.equal(town.resources.sky_vessel,1);conflict.end=true;delete town.issues.war;next(w);assert.equal(probe.status,'enroute');assert.equal(w._paultendoUniverse.worlds[2].reached,undefined);w.planet.day=probe.arrival-1;next(w);assert.equal(w._paultendoUniverse.worlds[2].reached,true);assert.ok(w._paultendoUniverse.worlds[2].state);assert.equal(w._paultendoUniverse.worlds[2].arrival.flight,probe.id);assert.equal(w._paultendoUniverse.spaceTech,35);solar(w);w.document.querySelector('[data-world-id="2"]').click();assert.match(panel(w).textContent,/Switch to world/);errors(g);
});

test('higher charts require observations made with the relevant knowledge',async t=>{
 const g=await makeGame();t.after(g.close);const {w}=setup(g);telescope(w);w.planet.unlocks.astronomy=10;for(let n=0;n<6;n++)next(w);assert.equal(w._paultendoUniverse.worlds[2].discovered,true);assert.equal(w._paultendoUniverse.worlds[3].discovered,false);w.planet.unlocks.astronomy=20;next(w);next(w);assert.equal(w._paultendoUniverse.worlds[3].discovered,false);for(let n=0;n<3;n++)next(w);assert.equal(w._paultendoUniverse.worlds[3].discovered,true);assert.equal(w._paultendoUniverse.worlds[3].chart.observations,6);errors(g);
});

test('unavailable flight preparations show their reason rather than a dead action',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g);telescope(w);next(w);next(w);advanced(w);town.resources.crop=0;solar(w);assert.match(panel(w).textContent,/needs enough food/);assert.doesNotMatch(panel(w).textContent,/Ask .*prepare/);town.resources.crop=400;const conflict=war(w,town);solar(w);assert.match(panel(w).textContent,/is fighting/);assert.doesNotMatch(panel(w).textContent,/Ask .*prepare/);conflict.end=true;delete town.issues.war;solar(w);click(w,'prepare a survey satellite');solar(w);w.document.querySelector('[data-world-id="2"]').click();assert.doesNotMatch(panel(w).textContent,/Ask .*prepare/);assert.equal(sky(w).flights.length,1);errors(g);
});

test('upgrade drops an unearned same-day map-clear cache without erasing explored ground',async t=>{
 const g=await makeGame();t.after(g.close);const {w}=setup(g);next(w);const fog=w.planet._paultendoFog;fog.cleared=true;fog.clearedDay=w.planet.day;delete fog.skyProgressVersion;const explored=plain(fog.explored),restored=await makeGame({save:plain(w.generateSave())});t.after(restored.close);assert.equal(restored.window.planet._paultendoFog.cleared,false);assert.deepEqual(plain(restored.window.planet._paultendoFog.explored),explored);errors(g);errors(restored);
});

test('a launched flight returns reports while another already reached world is active',async t=>{
 const g=await makeGame();t.after(g.close);const {w,town}=setup(g);telescope(w);advanced(w);scholar(town).outlook='steadfast';town.research={farm:20};solar(w);click(w,'prepare a survey satellite');w.happen('AddResource',null,town,{type:'sky_vessel',count:1});next(w);const flight=sky(w).flights[0],home=w.planet;assert.equal(flight.status,'enroute');const other=w._paultendoUniverse.worlds[3];other.discovered=true;other.reached=true;solar(w);w.document.querySelector('[data-world-id="3"]').click();click(w,'Switch to world');assert.equal(w._paultendoUniverse.currentWorldId,3);const at=w.filterChunks(c=>c.b!=='water'&&c.b!=='mountain')[0],colony=w.happen('Create',null,null,{x:at.x,y:at.y},'town');colony.pop=40;colony.resources={crop:400};colony.jobs={farmer:40};quiet(w);for(let n=0;n<4;n++)next(w);assert.equal(flight.status,'arrived');assert.equal(home._paultendoSky.orbitalSurvey.flight,flight.id);assert.equal(sky(w).orbitalSurvey,undefined);assert.equal(w.planet._paultendoFog.cleared,false);const restored=await makeGame({save:plain(w.generateSave())});t.after(restored.close);assert.equal(restored.window._paultendoUniverse.worlds[1].state.planet._paultendoSky.orbitalSurvey.flight,flight.id);errors(g);errors(restored);
});
