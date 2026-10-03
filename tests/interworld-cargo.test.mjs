import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGame,settleGame} from './harness.mjs';
const plain=x=>JSON.parse(JSON.stringify(x));
function quiet(w){for(const id of ['townFarm','townTame','townMine','townLumber','townEat','townBirth','townDeath','townExpand','townEmploy','townPay','townTax','townEconomyTick']){if(w.gameEvents[id].func)w.gameEvents[id].func=()=>{};if(w.gameEvents[id].perChunk)w.gameEvents[id].perChunk=()=>{};}w.gameEvents.processAll.func=()=>{};}
function next(w){const choose=w.chooseEvent;w.chooseEvent=()=>null;try{w.nextDay();}finally{w.chooseEvent=choose;}}
function click(w,text){const panel=w.document.getElementById('actionSubList'),b=[...panel.querySelectorAll('[role="button"]')].find(b=>b.textContent.includes(text));assert.ok(b,`Missing ${text}: ${panel.textContent}`);b.click();}
function solar(w){w.document.getElementById('actionItem-solar').click();}
function visit(w,id){solar(w);w.document.querySelector(`[data-world-id="${id}"]`).click();click(w,'Switch to world');quiet(w);}
function configure(w,town,food=0){town.name=food?'Homebank':'Farbank';town.pop=100;town.jobs={miner:30,farmer:40};town.resources={crop:food,metal_tools:50,cargo_vessel:food?1:0,charcoal:food?20:0};town.values={justice:6,openness:4};town.influences.trade=0;town.research={farm:10};town._paultendoNextExchangeDay=99999;town.wealth=60;Object.assign(w.planet.unlocks,{education:70,smith:80,fire:70,travel:90,astronomy:20,trade:30,farm:10});return town;}
async function setup(t){const g=await makeGame();t.after(g.close);const w=g.window;quiet(w);const home=configure(w,settleGame(g),1000);w.planet.day=80;const target=w._paultendoUniverse.worlds[2];target.discovered=true;target.reached=true;visit(w,2);const at=w.filterChunks(c=>!c.v.s&&c.b!=='water'&&c.b!=='mountain')[0],away=configure(w,w.happen('Create',null,null,{x:at.x,y:at.y},'town'));w.happen('Explore',null,null,{x:at.x,y:at.y});visit(w,1);w._paultendoUniverse._paultendoColonization.history.push({id:900,stage:'completed',originWorldId:1,originTownId:home.id,colony:{worldId:2,townId:away.id}});return {g,w,home,away,target};}
function launch(w){next(w);const r=w._paultendoUniverse.spaceRoutes[0];assert.ok(r);next(w);assert.equal(r.status,'outbound',JSON.stringify(r));return r;}
function arrive(w,r){const due=r.journey.arrival;while(w.planet.day<due)next(w);}
function errors(g){assert.deepEqual(g.errors,[]);}

test('actual contact and need start a shipment, no space score or date creates wealth',async t=>{
 const {g,w,home,away}=await setup(t);w._paultendoUniverse._paultendoColonization.history=[];w._paultendoUniverse.spaceTech=100;for(let i=0;i<3;i++)next(w);assert.equal(w._paultendoUniverse.spaceRoutes.length,0);assert.equal(home.wealth,60);assert.equal(away.wealth,60);errors(g);
});
test('goods leave once, arrive after travel and the same vessel returns without creating stock',async t=>{
 const {g,w,home,away}=await setup(t),r=launch(w),trip=r.journey;assert.equal(trip.terms.kind,'aid');assert.ok(w.document.querySelector('[data-story-kind="courier"]'));assert.equal(trip.count,48);assert.equal(home.resources.crop,1000-48);assert.equal(home.resources.cargo_vessel || 0,0);assert.equal(away.resources.crop,0);assert.equal(w._paultendoUniverse.relations['1:1|2:1'] || 0,0);arrive(w,r);assert.equal(away.resources.crop,48);assert.equal(home.resources.crop+away.resources.crop,1000);assert.equal(r.deliveries,1);assert.equal(r.status,'returning');arrive(w,r);assert.equal(r.journey,undefined);assert.equal(home.resources.cargo_vessel,1);assert.equal(home.wealth+away.wealth,120);assert.equal(r.journeys[0].vesselReturned,true);errors(g);
});
test('cash changes hands only at landing and reaches the supplier on the real return leg',async t=>{
 const {g,w,home,away}=await setup(t);home.values.justice=0;for(const p of home._paultendoPeople || [])p.outlook='guarded';away.resources.cash=1000;const r=launch(w),trip=r.journey;assert.equal(trip.terms.kind,'trade');const price=trip.terms.payment.count;assert.equal(away.resources.cash,1000);assert.equal(home.resources.cash || 0,0);arrive(w,r);assert.equal(away.resources.cash,1000-price);assert.equal(trip.paymentCargo,price);assert.equal(home.resources.cash || 0,0);arrive(w,r);assert.equal(home.resources.cash,price);assert.equal(home.resources.cash+away.resources.cash,1000);errors(g);
});
test('lost payment returns goods rather than awarding delivery or private income',async t=>{
 const {g,w,home,away}=await setup(t);home.values.justice=0;for(const p of home._paultendoPeople || [])p.outlook='guarded';away.resources.cash=1000;const r=launch(w);away.resources.cash=0;arrive(w,r);assert.equal(away.resources.crop,0);assert.equal(r.deliveries,0);assert.equal(r.status,'returning');arrive(w,r);assert.equal(home.resources.crop,1000);assert.equal(home.resources.cargo_vessel,1);assert.equal(home.wealth+away.wealth,120);errors(g);
});
test('missing means creates a workshop claim and reload cannot reroll or duplicate a launched cargo',async t=>{
 const {g,w,home}=await setup(t);home.resources.cargo_vessel=0;next(w);next(w);const r=w._paultendoUniverse.spaceRoutes[0];assert.equal(r.status,'preparing');assert.equal(r.pause,'vessel');assert.equal(home.resources.crop,1000);home.resources.cargo_vessel=1;next(w);next(w);assert.equal(r.status,'outbound');const restored=await makeGame({save:plain(w.generateSave())});t.after(restored.close);quiet(restored.window);const rr=restored.window._paultendoUniverse.spaceRoutes[0];assert.deepEqual(plain(rr.journey),plain(r.journey));arrive(restored.window,rr);arrive(restored.window,rr);assert.equal(rr.deliveries,1);assert.equal(restored.window.regGet('town',home.id).resources.cargo_vessel,1);errors(g);errors(restored);
});
test('full stores hold goods aboard and war holds landing until access returns',async t=>{
 const {g,w,home,away,target}=await setup(t),r=launch(w),trip=r.journey;away.resources.crop=1000000000;arrive(w,r);assert.equal(r.pause,'room',JSON.stringify({r,away:away.resources}));assert.equal(trip.delivered,undefined);away.resources.crop=0;const at=Object.values(target.state.planet.chunks).find(c=>c.v.s!==away.id&&c.b!=='water'&&c.b!=='mountain');visit(w,2);const rival=w.happen('Create',null,null,{x:at.x,y:at.y},'town'),war=w.happen('Create',away,null,{type:'war',towns:[away.id,rival.id]},'process');away.issues.war=war.id;visit(w,1);next(w);assert.equal(r.pause,'war');assert.equal(trip.cargo,48);war.end=true;delete away.issues.war;next(w);assert.equal(r.status,'returning');assert.equal(away.resources.crop,48);assert.equal(home.resources.crop+away.resources.crop,1000);errors(g);
});
test('legacy lanes become contacts and cannot continue their unearned arrival rewards',async t=>{
 const {g,w,home,away}=await setup(t);w._paultendoUniverse._paultendoColonization.history=[];away.resources.crop=1000;w._paultendoUniverse.spaceRoutes.push({id:42,from:{worldId:1,townId:home.id},to:{worldId:2,townId:away.id},active:true,deliveries:9,nextArrivalDay:80,travelTime:12});next(w);const r=w._paultendoUniverse.spaceRoutes[0];assert.equal(r.physical,1);assert.equal(r.legacyDeliveries,9);assert.equal(r.deliveries,0);assert.equal(r.journey,undefined);assert.equal(home.wealth+away.wealth,120);assert.equal(home.resources.crop+away.resources.crop,2000);errors(g);
});
test('crossworld ancestry and later use keep world identities even when town IDs match',async t=>{
 const {g,w,home,away}=await setup(t);assert.equal(home.id,away.id);home._paultendoCommodityLots={crop:[{count:1000,from:home.id,production:{world:1,passage:0,work:'harvest-a',town:home.id,name:'Firstfarmer'}}]};const r=launch(w);arrive(w,r);assert.equal(away._paultendoCommodityLots.crop[0].production.world,1);visit(w,2);// Restore native eating in a separate reloaded game below.
 const restored=await makeGame({save:plain(w.generateSave())});t.after(restored.close);const rw=restored.window,rt=rw.regGet('town',away.id),before=rt.resources.crop;rw.gameEvents.townEat.func(rt);assert.ok(rt.resources.crop<before);const trip=rw._paultendoUniverse.spaceRoutes[0].journey;assert.equal(trip.uses.at(-1).town.worldId,2);assert.equal(trip.uses.at(-1).town.townId,home.id);errors(g);errors(restored);
});


test('cargo demand pays for a real workshop conversion rather than awarding a vessel',async t=>{
 const {g,w,home}=await setup(t);home.resources.cargo_vessel=0;home._paultendoMaterials={charcoal:{technique:{day:70,person:"earlier-maker",work:"earlier-fire"},sources:[]}};home.resources.sky_vessel=1;home.resources.steel=4;home.resources.lumber=4;
 let work;for(let i=0;i<12&&!work;i++){next(w);work=w.planet._paultendoLife.materialWork.find(x=>x.type==='cargo_vessel');}assert.ok(work,JSON.stringify({work:w.planet._paultendoLife.materialWork,r:w._paultendoUniverse.spaceRoutes,stock:home.resources}));work.roll=.99;for(let i=0;i<15&&work.status!=='made';i++)next(w);assert.equal(work.status,'made');assert.equal(home.resources.sky_vessel || 0,0);assert.equal(home.resources.steel || 0,0);assert.equal(home.resources.lumber || 0,0);const route=w._paultendoUniverse.spaceRoutes[0];for(let i=0;i<3&&!route.journey;i++)next(w);assert.equal(route.status,'outbound');assert.equal(route.journey.inputs.find(i=>i.type==='cargo_vessel').production.work,work.id);errors(g);
});

test('hidden settlements do not leak their identities into cargo reports or accounts',async t=>{
 const {g,w,home,away}=await setup(t);home._hidden=true;away._hidden=true;home.name='Secret Home';away.name='Secret Colony';const r=launch(w);solar(w);assert.doesNotMatch(w.document.getElementById('actionSubList').textContent,/Secret Home|Secret Colony|Cargo between worlds/);assert.equal(w.document.querySelector('[data-story-kind="courier"]'),null);errors(g);
});


test('religion IDs on different worlds do not masquerade as shared faith',async t=>{
 const {g,w,home,away,target}=await setup(t);home.influences.faith=8;away.influences.faith=8;home.religion=1;away.religion=1;
 const creed={id:1,name:'Home Creed',tenets:['insular'],followers:[1],influences:{},cohesion:60,foundingTown:1};w.planet.religions.push(creed);target.state.planet.religions.push({...plain(creed),name:'Foreign Creed'});next(w);const r=w._paultendoUniverse.spaceRoutes[0];assert.equal(r.pause,'outsiders');assert.equal(r.journey,undefined);
 target.state.planet.religions[0]._paultendoOrigin='1:1';for(let i=0;i<10&&!r.journey;i++)next(w);assert.equal(r.journey.terms.kind,'aid');errors(g);
});

test('barter delivers real goods and brings the recipient’s useful materials home',async t=>{
 const {g,w,home,away}=await setup(t);home.values.justice=0;for(const p of home._paultendoPeople || [])p.outlook='guarded';away.resources.rock=100;
 w.happen('Create',home,null,{type:'project',town:home.id,cost:100,subtype:'temple'},'process');const r=launch(w),trip=r.journey;assert.equal(trip.terms.kind,'barter');assert.equal(trip.terms.payment.type,'rock');const payment=trip.terms.payment.count;arrive(w,r);assert.equal(away.resources.rock,100-payment);assert.equal(home.resources.rock || 0,0);arrive(w,r);assert.equal(home.resources.rock,payment);assert.equal(home.resources.rock+away.resources.rock,100);errors(g);
});
