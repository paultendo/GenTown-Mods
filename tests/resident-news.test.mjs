import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGame,settleGame} from './harness.mjs';

const plain=x=>JSON.parse(JSON.stringify(x));
async function setup(t,{role='farmer',outlook='generous',hungry=false}={}) {
 const g=await makeGame();t.after(g.close);const w=g.window,town=settleGame(g);
 w.planet.day=80;Object.assign(town,{name:'Farbank',start:1,pop:40,size:12,jobs:{[role]:20},resources:{crop:hungry?0:1000,cash:100},research:{},values:{justice:0,order:0,openness:0}});
 Object.assign(w.planet.unlocks,{government:10,education:20,farm:10,smith:20,military:10,trade:30});
 for(const e of Object.values(w.dailyEvents)){if(e.func)e.func=()=>{};if(e.perChunk)e.perChunk=()=>{};}
 w.openRegBrowser(town,'town');[...w.document.querySelectorAll('.paultendoTownLife button')].find(b=>b.textContent==='Meet the people').click();
 const person=town._paultendoPeople.find(p=>p.role===role);assert.ok(person);person.outlook=outlook;town._paultendoPeople=[person];
 return {g,w,town,person};
}
function decide(w,town,event,values,choice='yes') {
 const caller=w.readyEvent(event,w.regGet('player',1),town);assert.ok(caller);Object.assign(caller.args,values);
 const message=w.gameEvents[event].message;caller.message=typeof message==='function'?message(caller.subject,caller.target,caller.args):message;
 const choose=w.chooseEvent,ready=w.readyEvent;w.chooseEvent=()=>event;w.readyEvent=(id,...args)=>id===event?caller:ready(id,...args);
 try{w.nextDay();}finally{w.chooseEvent=choose;w.readyEvent=ready;}
 w.document.getElementById(`logMessage-${caller.logID}`).querySelector(`[type="${choice}"]`).click();
 return w.planet._paultendoLife.decisions.at(-1);
}
function open(w,town,d) {
 w.openRegBrowser(town,'town');[...w.document.querySelectorAll('.paultendoTownLife button')].find(b=>b.textContent==='Your mark on this town').click();
 [...w.document.querySelectorAll('#actionSubList [role="button"]')].find(b=>b.textContent.startsWith(`Day ${d.day} ·`)&&b.textContent.includes(d.title)).click();
 return w.document.getElementById('actionSubList');
}

test('a hungry farmer can dissent from education research without pretending to speak for the town',async t=>{
 const {g,w,town,person}=await setup(t,{hungry:true});
 const d=decide(w,town,'increaseResearch',{value:'education'});
 assert.equal(town.research.education,10);assert.equal(d.quote.person,person.id);assert.equal(d.quote.stance,'opposed');assert.equal(d.quote.context.hungry,true);
 assert.match(d.quote.words,/something to eat/);const panel=open(w,town,d);assert.equal(panel.querySelectorAll('blockquote').length,1);assert.equal(panel.querySelector('cite').textContent,`${person.name}, farmer`);
 assert.deepEqual(g.errors,[]);
});

test('two scholars can respond differently to the same actual research because of their outlook',async t=>{
 const quotes=[];
 for(const outlook of ['curious','guarded']) {
  const {g,w,town}=await setup(t,{role:'scholar',outlook});const d=decide(w,town,'increaseResearch',{value:'education'});
  quotes.push(d.quote);assert.equal(d.quote.outlook,outlook);assert.deepEqual(g.errors,[]);
 }
 assert.equal(quotes[0].stance,'supportive');assert.equal(quotes[1].stance,'uncertain');assert.notEqual(quotes[0].words,quotes[1].words);
});

test('a speech ban can draw opposition or support from different existing residents',async t=>{
 for(const [role,outlook,stance] of [['farmer','generous','opposed'],['soldier','steadfast','supportive']]) {
  const {g,w,town,person}=await setup(t,{role,outlook});const d=decide(w,town,'townLaw',{value:'happy.speech',name:'speech',influence:'happy',result:false});
  assert.equal(town.legal['happy.speech'],false);assert.equal(d.quote.person,person.id);assert.equal(d.quote.context.allowed,false);assert.equal(d.quote.stance,stance);
  assert.match(d.quote.words,stance==='supportive'?/Orders don’t hold/:/silence us/);assert.deepEqual(g.errors,[]);
 }
});

test('a scholar reacts to an approved school as unfinished work, while a rejected proposal promises no building',async t=>{
 for(const choice of ['yes','no']) {
  const {g,w,town}=await setup(t,{role:'scholar',outlook:'curious'});const d=decide(w,town,'townProjectStart',{value:'school'},choice);
  assert.equal(d.projects.length,choice==='yes'?1:0);assert.ok(d.quote);assert.equal(d.quote.context.project?.id,d.projects[0]?.id);
  assert.match(d.quote.words,choice==='yes'?/people to finish it/:/could have done/);assert.deepEqual(g.errors,[]);
 }
});

test('law quotes stay with their original speaker and outcome across later changes and reload, and reading changes no simulation state',async t=>{
 const {g,w,town,person}=await setup(t);const d=decide(w,town,'townLaw',{value:'farm',name:'farming',influence:'farm',result:false}),quote=plain(d.quote);
 town.legal.farm=true;person.outlook='curious';town.jobs={miner:20};
 const before=plain({day:w.planet.day,life:w.planet._paultendoLife,resources:town.resources,fog:w.planet._paultendoFog});let draws=0;const random=w.Math.random;w.Math.random=()=>{draws++;return random();};
 const panel=open(w,town,d);open(w,town,d);w.Math.random=random;
 assert.equal(draws,0);assert.deepEqual(plain(d.quote),quote);assert.deepEqual(plain({day:w.planet.day,life:w.planet._paultendoLife,resources:town.resources,fog:w.planet._paultendoFog}),before);
 assert.doesNotMatch(panel.textContent,new RegExp(`Meet ${person.name}`));assert.match(panel.textContent,/can’t grow anything/);
 const restored=await makeGame({save:plain(w.generateSave())});t.after(restored.close);const rw=restored.window,rd=rw.planet._paultendoLife.decisions.find(r=>r.id===d.id);
 assert.deepEqual(plain(rd.quote),quote);assert.match(open(rw,rw.regGet('town',town.id),rd).querySelector('blockquote').textContent,/can’t grow anything/);assert.deepEqual(g.errors,[]);assert.deepEqual(restored.errors,[]);
});

test('an unchanged rule and a town without existing residents supply no invented interview',async t=>{
 for(const missing of [false,true]) {
  const {g,w,town}=await setup(t);if(missing)town._paultendoPeople=[];
  const d=decide(w,town,'townLaw',{value:'farm',name:'farming',influence:'farm',result:false},missing?'yes':'no');
  assert.equal(d.quote,null);assert.equal(town._paultendoPeople.length,missing?0:1);assert.equal(open(w,town,d).querySelector('blockquote'),null);assert.deepEqual(g.errors,[]);
 }
});
