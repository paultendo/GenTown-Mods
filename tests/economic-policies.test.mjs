import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGame,settleGame} from './harness.mjs';
const plain=x=>JSON.parse(JSON.stringify(x));
async function setup(t){const g=await makeGame();t.after(g.close);const w=g.window,town=settleGame(g);w.planet.day=80;town.pop=40;town.jobs={farmer:20};town.resources={crop:200,cash:0};town.wealth=1000;town.econ='socialism';town.tax=0;town.values={justice:0,order:0,openness:0,wealth:0};town.influences.faith=0;Object.assign(w.planet.unlocks,{trade:30,government:20});return {g,w,town};}
function proposal(w,town,id){const args={};args.value=w.gameEvents[id].value(w.currentPlayer,town,args);return args;}
function accept(w,town,id,args){w.gameEvents[id].func(w.currentPlayer,town,args);}
function click(w,text){const b=[...w.document.querySelectorAll('#actionSubList [role="button"]')].find(b=>b.textContent.includes(text));assert.ok(b,`Missing ${text}`);b.click();}
function visit(w,id){w.document.getElementById('actionItem-solar').click();w.document.querySelector(`[data-world-id="${id}"]`).click();click(w,'Switch to world');}
function quiet(w){for(const id of ['townFarm','townTame','townMine','townLumber','townBirth','townDeath','townExpand','townEat','townEmploy','processAll']){if(w.gameEvents[id]?.func)w.gameEvents[id].func=()=>{};if(w.gameEvents[id]?.perChunk)w.gameEvents[id].perChunk=()=>{};}}

test('tax proposals answer actual public bills, move no money by adoption and collect only existing private wealth',async t=>{
 const {g,w,town}=await setup(t),before=town.wealth+town.resources.cash;
 const args=proposal(w,town,'townTaxChange');assert.ok(args.value>0);assert.ok(args.value<=.05);assert.equal(args._paultendoEconomic.cause.cash,0);assert.ok(args._paultendoEconomic.cause.target>0);assert.match(w.gameEvents.townTaxChange.message(null,town,args),/public purse/);
 accept(w,town,'townTaxChange',args);assert.equal(town.tax,args.result);assert.equal(town.wealth+town.resources.cash,before);assert.equal(proposal(w,town,'townTaxChange').value,false,'The new rate gets time to work');
 w.gameEvents.townTax.func(town);assert.ok(town.resources.cash>0);assert.equal(town.wealth+town.resources.cash,before);assert.ok(Math.abs(town.resources.cash-args._paultendoEconomic.cause.collection)<1e-9);assert.deepEqual(g.errors,[]);
});

test('a funded purse asks for less tax and can abolish it without inventing an expense',async t=>{
 const {g,w,town}=await setup(t);town.resources.cash=1000;town.tax=.04;const args=proposal(w,town,'townTaxChange');assert.equal(args.result,0);assert.equal(args.value,-.04);assert.match(args._paultendoEconomic.reason,/already covers/);accept(w,town,'townTaxChange',args);assert.equal(town.tax,0);assert.equal(town.resources.cash,1000);assert.deepEqual(g.errors,[]);
});

test('care can shield poor residents while a controlling town still demands contributions, and private claims compete with bills',async t=>{
 const {g,w,town}=await setup(t);town.wealth=10;town.values.justice=8;assert.equal(proposal(w,town,'townTaxChange').value,false);
 town.values.justice=0;town.values.order=8;const ordered=proposal(w,town,'townTaxChange');assert.ok(ordered.value>0);assert.equal(ordered._paultendoEconomic.cause.poor,true);
 town.wealth=1000;town.values.order=0;const neutral=proposal(w,town,'townTaxChange');town.values.wealth=8;const privateClaim=proposal(w,town,'townTaxChange');assert.ok(privateClaim.result<neutral.result);assert.match(privateClaim._paultendoEconomic.reason,/private hands/);assert.deepEqual(g.errors,[]);
});

test('unfinished real work and debt compete for public funding, while absent hands and local knowledge block a proposal',async t=>{
 const {g,w,town}=await setup(t);const basic=proposal(w,town,'townTaxChange');
 const project=w.happen('Create',town,null,{type:'project',subtype:'school',cost:60},'process');const work=proposal(w,town,'townTaxChange');assert.ok(work.result>=basic.result);assert.ok(work._paultendoEconomic.cause.projects.includes(project.id));assert.equal(work._paultendoEconomic.cause.building,project.cost);
 w.planet.loans=[{id:'test:loan',borrowerId:town.id,remainingAmount:20,paymentPerTurn:2}];const debt=proposal(w,town,'townTaxChange');assert.equal(debt._paultendoEconomic.cause.debt,2);
 town.jobs={};assert.equal(proposal(w,town,'townTaxChange').value,false);town.jobs={farmer:20};w.planet._paultendoLocalKnowledge={taxation:{key:'government',before:10,after:20}};assert.equal(proposal(w,town,'townTaxChange').value,false);town._paultendoLocalDiscoveries={taxation:true};assert.ok(proposal(w,town,'townTaxChange').value>0);assert.deepEqual(g.errors,[]);
});

test('economic systems follow competing beliefs, actual completed exchanges and practices instead of a random label',async t=>{
 const {g,w,town}=await setup(t);delete town.econ;assert.equal(proposal(w,town,'townEcon').value,false);town.values.justice=8;assert.equal(proposal(w,town,'townEcon').value,'socialism');town.values.justice=0;town.values.wealth=8;assert.equal(proposal(w,town,'townEcon').value,'capitalism');
 town.values.wealth=0;w.planet._paultendoLife.teachings.push({id:'care-fixture',town:town.id,active:true,meaning:'care'});assert.equal(proposal(w,town,'townEcon').value,'socialism');w.planet._paultendoLife.teachings=[];
 w.planet._paultendoLife.exchanges=[1,2].map(n=>({id:`exchange-fixture:${n}`,status:'arrived',delivered:10,buyer:town.id,seller:999,kind:'barter',arrived:w.planet.day}));const commerce=proposal(w,town,'townEcon');assert.equal(commerce.value,'capitalism');assert.equal(commerce._paultendoEconomic.cause.pressures.filter(p=>p.exchange).length,2);
 const old=plain(town.influences);accept(w,town,'townEcon',commerce);assert.equal(town.econ,'capitalism');assert.notDeepEqual(plain(town.influences),old);const once=plain(town.influences);accept(w,town,'townEcon',commerce);assert.deepEqual(plain(town.influences),once);assert.equal(proposal(w,town,'townEcon').value,false);assert.deepEqual(g.errors,[]);
});

test('a practiced faith can favour sharing or private exchange, with a record of opposing beliefs',async t=>{
 const {g,w,town}=await setup(t);delete town.econ;w.planet.religions=[{id:1,name:'Faith',tenets:['egalitarian']}];town.religion=1;town.influences.faith=10;assert.equal(proposal(w,town,'townEcon').value,'socialism');w.planet.religions[0].tenets=['trade'];assert.equal(proposal(w,town,'townEcon').value,'capitalism');town.values.justice=8;assert.equal(proposal(w,town,'townEcon').value,false,'Neither equally strong belief wins by coin flip');assert.deepEqual(g.errors,[]);
});

test('reading a proposal uses no simulation randomness and grants no policy, resources or knowledge',async t=>{
 const {g,w,town}=await setup(t);const before=plain({resources:town.resources,wealth:town.wealth,tax:town.tax,econ:town.econ,knowledge:w.planet.unlocks});let draws=0;const random=w.Math.random;w.Math.random=()=>{draws++;return random();};
 const a=proposal(w,town,'townTaxChange'),b=proposal(w,town,'townTaxChange');assert.deepEqual(plain(a),plain(b));w.gameEvents.townTaxChange.message(null,town,a);w.Math.random=random;assert.equal(draws,0);assert.deepEqual(plain({resources:town.resources,wealth:town.wealth,tax:town.tax,econ:town.econ,knowledge:w.planet.unlocks}),before);assert.deepEqual(g.errors,[]);
});

test('the visited world still asks the player and a legacy rate remains collectible without a new policy',async t=>{
 const {g,w,town}=await setup(t);quiet(w);town.start=1;const choose=w.chooseEvent;w.chooseEvent=()=> 'townTaxChange';try{w.nextDay();}finally{w.chooseEvent=choose;}
 assert.equal(town.tax,0);const pending=Object.values(w.currentEvents).find(e=>e.eventClass==='townTaxChange'&&!e.done);assert.ok(pending);assert.ok(w.document.querySelector('.logAct'));
 town.tax=.1;w.planet.unlocks.government=10;const before=town.wealth+town.resources.cash;assert.equal(proposal(w,town,'townTaxChange').value,false);w.gameEvents.townTax.func(town);assert.equal(town.wealth+town.resources.cash,before);assert.ok(town.resources.cash>0);assert.deepEqual(g.errors,[]);
});

test('a distant tax decision is linked to its actual budget and survives reload without a player decision',async t=>{
 const {g,w}=await setup(t);quiet(w);const target=w._paultendoUniverse.worlds[2];target.discovered=true;target.reached=true;visit(w,2);
 const site=w.filterChunks(c=>!c.v.s&&c.b!=='water'&&c.b!=='mountain')[0],away=w.happen('Create',null,null,{x:site.x,y:site.y},'town');w.happen('Explore',null,null,{x:site.x,y:site.y});away.name='Farbank';away.start=78;away.pop=40;away.jobs={farmer:20};away.resources={crop:200,cash:0};away.wealth=1000;away.values={justice:8,order:0,wealth:0,openness:0};Object.assign(w.planet.unlocks,{trade:30,government:20});w.openRegBrowser(away,'town');[...w.document.querySelectorAll('.paultendoTownLife button')].find(b=>b.textContent==='Meet the people').click();const residents=plain(away._paultendoPeople);visit(w,1);
 const choose=w.chooseEvent;w.chooseEvent=()=>w.planet===target.state.planet?'townEcon':null;try{w.nextDay();}finally{w.chooseEvent=choose;}
 const adoption=target.state.planet._paultendoLife.localChoices.find(r=>r.event==='townEcon');assert.ok(adoption);assert.equal(adoption.after.econ,'socialism');assert.equal(away.econ,'socialism');assert.equal(adoption.cause.kind,'economy');
 w.chooseEvent=()=>w.planet===target.state.planet?'townTaxChange':null;try{w.nextDay();}finally{w.chooseEvent=choose;}
 const record=target.state.planet._paultendoLife.localChoices.find(r=>r.event==='townTaxChange');assert.ok(record,JSON.stringify({away,day:target.state.planet.day,knowledge:target.state.planet.unlocks,life:target.state.planet._paultendoLife,trace:w.debugContext}));assert.equal(record.before.tax,0);assert.equal(record.after.tax,away.tax);assert.equal(record.cause.kind,'tax');assert.equal(w.planet._paultendoLife.decisions.length,0);assert.doesNotMatch(w.document.getElementById('logMessages').textContent,/Farbank.*income tax/);
 assert.equal(record.title,`Farbank introduces a ${Math.round(record.after.tax*100)}% income tax`);assert.ok(residents.some(p=>p.id===record.quote.person&&p.name===record.quote.name));
 visit(w,2);record.title='Who pays the town’s bills';away.tax=record.after.tax+.01;w.document.querySelector(`[data-story-kind="localChoice"][data-story-id="${record.id}"] .paultendoChronicleStoryLink`).click();assert.match(w.document.getElementById('actionSubList').textContent,/remains to be seen.*Now/s);assert.doesNotMatch(w.document.getElementById('actionSubList').textContent,/private wealth|employed residents|cash a day|tax returns|treasury reports/);assert.match(w.document.querySelector('#actionSubList .panelTitle').textContent,/Farbank introduces/);assert.doesNotMatch(w.document.querySelector('#actionSubList .panelTitle').textContent,/Who pays/);away.tax=record.after.tax;
 const restored=await makeGame({save:plain(w.generateSave())});t.after(restored.close);assert.equal(restored.window.planet._paultendoLife.localChoices.find(r=>r.id===record.id).after.tax,away.tax);assert.deepEqual(g.errors,[]);assert.deepEqual(restored.errors,[]);
});
