import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGame,settleGame} from './harness.mjs';

const plain=x=>JSON.parse(JSON.stringify(x));
function quiet(w){for(const id of ['townFarm','townTame','townMine','townLumber','townBirth','townDeath','townExpand','townEat','townEmploy','processAll']){if(w.gameEvents[id]?.func)w.gameEvents[id].func=()=>{};if(w.gameEvents[id]?.perChunk)w.gameEvents[id].perChunk=()=>{};}}
async function setup(t,outlook='generous'){
 const g=await makeGame();t.after(g.close);const w=g.window,town=settleGame(g);quiet(w);
 Object.assign(town,{name:'Farbank',start:1,pop:40,jobs:{farmer:20},resources:{crop:200,cash:0},wealth:1000,econ:'socialism',tax:0,values:{justice:4,wealth:0,order:0,openness:0}});
 w.planet.day=80;Object.assign(w.planet.unlocks,{trade:30,government:20});
 w.openRegBrowser(town,'town');[...w.document.querySelectorAll('.paultendoTownLife button')].find(b=>b.textContent==='Meet the people').click();
 const person=town._paultendoPeople.find(p=>p.role==='farmer');person.outlook=outlook;town._paultendoPeople=[person];
 const project=w.happen('Create',town,null,{type:'project',subtype:'school',cost:60},'process');
 return {g,w,town,person,project};
}
function decide(w,id='townTaxChange',choice='yes'){
 const choose=w.chooseEvent;w.chooseEvent=()=>id;try{w.nextDay();}finally{w.chooseEvent=choose;}
 const caller=Object.values(w.currentEvents).find(e=>e.eventClass===id&&!e.done);assert.ok(caller);
 w.document.getElementById(`logMessage-${caller.logID}`).querySelector(`[type="${choice}"]`).click();
 const decision=w.planet._paultendoLife.decisions.at(-1);assert.ok(decision?.economic);return decision;
}
function open(w,town,decision){w.openRegBrowser(town,'town');[...w.document.querySelectorAll('.paultendoTownLife button')].find(b=>b.textContent==='Your mark on this town').click();[...w.document.querySelectorAll('#actionSubList [role="button"]')].find(b=>b.textContent.includes(decision.title)).click();return w.document.getElementById('actionSubList');}

test('an actual tax choice quotes an existing resident and their relevant work without exposing private balances',async t=>{
 const {g,w,town,person,project}=await setup(t);const d=decide(w),q=d.economic.quote;
 assert.equal(q.person,person.id);assert.equal(q.name,person.name);assert.equal(q.role,'farmer');assert.equal(q.outlook,'generous');assert.equal(q.context.project.id,project.id);assert.equal(q.stance,'supportive');assert.match(q.words,/school.*pay my share/);
 const list=open(w,town,d);assert.match(list.querySelector('.panelTitle').textContent,/Farbank introduces/);assert.equal(list.querySelector('.paultendoNewsQuote cite').textContent,`${person.name}, farmer`);assert.doesNotMatch(list.textContent,/private wealth|1,020|employed residents|cash a day|tax returns/);
 [...list.querySelectorAll('[role="button"]')].find(b=>b.textContent===`Meet ${person.name}`).click();assert.match(list.textContent,/Farmer of Farbank.*Generous/s);assert.deepEqual(g.errors,[]);
});

test('guarded, steadfast and hungry residents can disagree with a tax their town adopts',async t=>{
 for(const [outlook,hungry] of [['guarded',false],['steadfast',false],['curious',true]]){
  const {g,w,town}=await setup(t,outlook);if(hungry)town.resources.crop=0;
  const d=decide(w);assert.ok(town.tax>0);assert.equal(d.economic.quote.stance,'opposed');assert.match(d.economic.quote.words,hungry?/food before/:outlook==='guarded'?/take their share/:/without it before/);assert.deepEqual(g.errors,[]);
 }
});

test('a saved quote is not rewritten by later personality, occupation or finances, and reading uses no simulation draws',async t=>{
 const {g,w,town,person}=await setup(t);const d=decide(w),quote=plain(d.economic.quote);person.outlook='guarded';town.jobs={miner:20};town.wealth=7;
 let draws=0;const random=w.Math.random;w.Math.random=()=>{draws++;return random();};open(w,town,d);open(w,town,d);w.Math.random=random;assert.equal(draws,0);assert.deepEqual(plain(d.economic.quote),quote);assert.equal(w.document.querySelectorAll('#actionSubList [role="button"]').length>0,true);assert.doesNotMatch(w.document.getElementById('actionSubList').textContent,new RegExp(`Meet ${person.name}`));
 const restored=await makeGame({save:plain(w.generateSave())});t.after(restored.close);const rw=restored.window,rd=rw.planet._paultendoLife.decisions.find(x=>x.id===d.id);open(rw,rw.regGet('town',town.id),rd);assert.deepEqual(plain(rd.economic.quote),quote);assert.match(rw.document.querySelector('.paultendoNewsQuote').textContent,/school.*pay my share/s);assert.deepEqual(g.errors,[]);assert.deepEqual(restored.errors,[]);
});

test('missing workers and wary residents under harsh rule are not replaced by invented interviewees',async t=>{
 for(const obstacle of ['missing','harsh','deadFigure','hiddenFigure']){
  const {g,w,town,person}=await setup(t,'guarded');
  if(obstacle==='missing'){town._paultendoPeople=[];town.jobs={farmer:20};}
  else if(obstacle==='harsh'){town.gov=town.governmentType='dictatorship';town.values.order=10;town.values.justice=0;}
  else w.planet.figures=[{id:9,name:person.name,type:'HEALER',title:'Healer',hometown:town.id,born:1,died:obstacle==='deadFigure'?79:null,_hidden:obstacle==='hiddenFigure',deeds:[],_paultendoPerson:person}];
  const d=decide(w);assert.equal(d.economic.quote,null,obstacle);if(obstacle==='missing')assert.equal(town._paultendoPeople.length,0);else assert.equal(town._paultendoPeople[0].id,person.id);assert.deepEqual(g.errors,[]);
 }
});

test('a first economic system can have a dissenting voice without claiming that the town unanimously agrees',async t=>{
 const {g,w,town,person}=await setup(t,'guarded');delete town.econ;town.values.justice=8;
 const d=decide(w,'townEcon');assert.equal(town.econ,'socialism');assert.equal(d.economic.quote.person,person.id);assert.equal(d.economic.quote.stance,'opposed');assert.match(d.economic.quote.words,/believe in sharing/);assert.match(d.title,/Farbank adopts socialism/);assert.deepEqual(g.errors,[]);
});
