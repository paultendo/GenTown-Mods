import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGame,settleGame} from './harness.mjs';
const plain=x=>JSON.parse(JSON.stringify(x));
const panel=w=>w.document.getElementById('actionSubList');
const click=(w,text)=>{const b=[...panel(w).querySelectorAll('[role="button"]')].find(b=>b.textContent.includes(text));assert.ok(b,`Missing ${text}: ${panel(w).textContent}`);b.click();};

test('the primary control reviews all live choices without advancing or inventing an answer',async t=>{
  const g=await makeGame({virtualTime:true});t.after(g.close);const w=g.window;settleGame(g);
  const answered=[];
  for(const name of ['first','second']) {
    const event={needsInput:true,done:false};w.currentEvents[name]=event;
    const id=w.logMessage(`Approve ${name}?`,null,{buttons:['No','Yes'].map(choice=>({name:choice,type:choice.toLowerCase(),func(){answered.push([name,choice]);event.done=true;w.document.getElementById('logMessage-'+id).setAttribute('done','true');}}))});
    w.document.getElementById('logMessage-'+id).dataset.eventid=name;
  }
  const day=w.planet.day;w.updateStats();
  assert.equal(w.document.querySelectorAll('[id^="paultendoAutoplayReview"]').length,0);
  assert.match(w.document.getElementById('nextDay').textContent,/Decisions \(2\)/);
  w.document.getElementById('nextDayMobile').click();
  assert.equal(w.planet.day,day);assert.equal(w.currentExecutive,'decisions');
  assert.equal(panel(w).querySelectorAll('.paultendoDecisionChoices button').length,4);
  panel(w).querySelector('.paultendoDecisionChoices button[data-choice="yes"]').click();
  assert.deepEqual(answered,[['second','Yes']]);assert.equal(panel(w).querySelectorAll('.paultendoDecisionChoices button').length,2);
  panel(w).querySelector('.paultendoDecisionChoices button[data-choice="no"]').click();
  assert.deepEqual(answered,[['second','Yes'],['first','No']]);assert.equal(w.planet.day,day);
  assert.match(w.document.getElementById('nextDay').textContent,/Next Day/);
  assert.deepEqual(g.errors,[]);assert.deepEqual(g.warnings,[]);
});

test('letting a day pass uses the native skip rule, and urgent letters cannot be bypassed',async t=>{
  const g=await makeGame({virtualTime:true});t.after(g.close);const w=g.window,town=settleGame(g);let skipped=0,answers=0;
  w.gameEvents.polishSkip={skip(){skipped++;},func(){answers++;}};
  const event={eventClass:'polishSkip',needsInput:true,done:false,subject:town,args:{}};w.currentEvents.polishSkip=event;
  const id=w.logMessage('Should they start?',null,{buttons:[{name:'Yes',type:'yes',func(){answers++;event.done=true;}}]});
  event.logID=id;w.document.getElementById('logMessage-'+id).dataset.eventid='polishSkip';
  w.planet.letter={};w.document.getElementById('nextDay').click();
  assert.ok(![...panel(w).querySelectorAll('[role="button"]')].some(b=>b.textContent==='Let the day pass'));
  delete w.planet.letter;const day=w.planet.day;w.document.getElementById('nextDay').click();click(w,'Let the day pass');
  assert.equal(w.planet.day,day+1);assert.equal(skipped,1);assert.equal(answers,0);assert.deepEqual(g.errors,[]);
});

test('native saves keep identical map encoding and omit imported runtime territory copies',async t=>{
  let native;
  const g=await makeGame({virtualTime:true,beforeMod(w){native=w.generateSave;}});t.after(g.close);const w=g.window,town=settleGame(g);
  town._paultendoClaimedCache={chunks:[{stale:true,padding:'x'.repeat(500000)}]};
  const optimized=plain(w.generateSave()), original=plain(native());
  delete optimized.paultendoUniverse;
  assert.deepEqual(optimized,original);assert.equal(town._paultendoClaimedCache,undefined);
  assert.equal(Object.hasOwn(w.planet,'toJSON'),false);assert.ok(Object.keys(w.planet.chunks).length);
  const copy=await makeGame({virtualTime:true,save:plain(w.generateSave())});t.after(copy.close);
  const rt=copy.window.regGet('town',town.id);assert.equal(rt._paultendoClaimedCache,undefined);
  assert.ok(JSON.stringify(copy.window.generateSave()).length<1000000);assert.deepEqual(copy.errors,[]);
});

test('fog rebuilding and daily advancement retain the territories of multiple towns',async t=>{
  const g=await makeGame({virtualTime:true});t.after(g.close);const w=g.window,a=settleGame(g),center=w.chunkAt(...a.center);
  const chunk=w.filterChunks(c=>!c.v.s&&c.v.g===center.v.g&&c.b!=='water'&&c.b!=='mountain').sort((x,y)=>Math.hypot(y.x-center.x,y.y-center.y)-Math.hypot(x.x-center.x,x.y-center.y))[0];
  const b=w.happen('Create',null,null,{x:chunk.x,y:chunk.y},'town');b.pop=20;b.resources={crop:1000};
  const saved=plain(w.generateSave()),copy=await makeGame({virtualTime:true,save:saved});t.after(copy.close);const rw=copy.window;
  for(const town of [a,b])assert.equal(rw.planet._paultendoFog.visible[town.center.join(',')],1);
  rw.chooseEvent=()=>null;rw.nextDay();copy.clock.advance(1000);
  for(const town of [a,b])assert.equal(rw.planet._paultendoFog.visible[town.center.join(',')],1);
  assert.deepEqual(copy.errors,[]);assert.deepEqual(copy.warnings,[]);
});

test('work dependencies explain local methods and real inputs without changing the simulation',async t=>{
  const g=await makeGame({virtualTime:true});t.after(g.close);const w=g.window,town=settleGame(g);w.planet.day=80;
  Object.assign(w.planet.unlocks,{fire:40,smith:30,astronomy:20});town.jobs={miner:1,scholar:1};town.resources={crop:1000,sand:3,lumber:4,metal:4};
  w.openRegBrowser(town,'town');[...w.document.querySelectorAll('.paultendoTownLife button')].find(b=>b.textContent==='Meet the people').click();
  const person=town._paultendoPeople.find(p=>p.role==='scholar');
  w.planet._paultendoLife.materialWork.push({id:'waiting-scope',type:'telescope',town:town.id,person:person.id,name:person.name,day:10,status:'waiting',cost:{glass:2,metal:2,lumber:1},remaining:8,steps:[],inputs:[]});
  w.updateStats();w.document.getElementById('actionItem-projects').click();click(w,'telescopes');
  const before=plain({life:w.planet._paultendoLife,resources:town.resources,unlocks:w.planet.unlocks,fog:w.planet._paultendoFog});let draws=0;const random=w.Math.random;w.Math.random=()=>{draws++;return random();};
  click(w,'Finding glass');
  assert.match(panel(w).textContent,/Still to discover here: Forges/);
  assert.match(panel(w).textContent,/3 sand/);assert.match(panel(w).textContent,/charcoal/);assert.match(panel(w).textContent,/timber/);
  assert.equal(draws,0);assert.deepEqual(plain({life:w.planet._paultendoLife,resources:town.resources,unlocks:w.planet.unlocks,fog:w.planet._paultendoFog}),before);
  assert.deepEqual(g.errors,[]);assert.deepEqual(g.warnings,[]);
});

test('routine updates fold by day, leave choices and warnings visible, and remain readable after reload',async t=>{
  const g=await makeGame({virtualTime:true});t.after(g.close);const w=g.window;settleGame(g);w.planet.day=8;
  const routine=w.logMessage('Farmers replace their stone tools.',null,{_paultendoRoutine:true});
  const warning=w.logMessage('The harvest failed.','warning');
  const question=w.logMessage('Approve a new workshop?',null,{_paultendoRoutine:true,buttons:[{name:'Yes',type:'yes',func(){}}]});
  g.clock.advance(40);
  const toggle=w.document.querySelector('.paultendoRoutineToggle[data-routine-day="8"]');assert.ok(toggle);assert.equal(toggle.getAttribute('aria-expanded'),'false');
  assert.ok(w.document.getElementById('logMessage-'+routine).classList.contains('paultendoRoutineHidden'));
  for(const id of [warning,question])assert.ok(!w.document.getElementById('logMessage-'+id).classList.contains('paultendoRoutineHidden'));
  toggle.click();assert.equal(toggle.getAttribute('aria-expanded'),'true');assert.ok(!w.document.getElementById('logMessage-'+routine).classList.contains('paultendoRoutineHidden'));
  const copy=await makeGame({virtualTime:true,save:plain(w.generateSave())});t.after(copy.close);copy.clock.advance(40);
  const restored=copy.window.document.querySelector('.paultendoRoutineToggle[data-routine-day="8"]');assert.ok(restored);restored.click();
  assert.match(copy.window.document.getElementById('logMessage-'+routine).textContent,/replace their stone tools/);assert.deepEqual(copy.errors,[]);
});

test('a failed component records its name and repeat count without hiding the error',async t=>{
  const g=await makeGame({virtualTime:true});t.after(g.close);const w=g.window;settleGame(g);
  // Break a genuinely independent follow-up, rather than inserting a fake
  // exception into the diagnostic collector itself.
  const inquiries=w.planet._paultendoLife.inquiries;
  inquiries.filter=()=>{throw new Error('damaged inquiry records');};
  w.chooseEvent=()=>null;w.nextDay();w.nextDay();
  assert.ok(w._paultendoState.failures?.some(f=>f.task==='Research work'));
  const failures=w._paultendoState.failures;assert.ok(failures.length<=32);
  const research=failures.find(f=>f.task==='Research work');assert.equal(research.count,2);
  assert.equal(g.warnings.filter(f=>String(f).includes('Research work')).length,1);
  delete inquiries.filter;
  w.document.getElementById('actionInfo').click();await Promise.resolve();
  assert.equal(w.document.getElementById('actionItem-game-health'),null,'native listeners finish before the mod appends its report');
  g.clock.advance(1);
  assert.ok(w.document.getElementById('actionItem-about'),'the native Info entries are retained');
  assert.match(panel(w).querySelector('.panelTitle').textContent,/GenTown v/);
  const health=w.document.getElementById('actionItem-game-health');assert.ok(health);health.click();assert.match(panel(w).textContent,/damaged inquiry records/);
});

test('a real instrument shortage can motivate furnace research before clay arrives, without awarding knowledge',async t=>{
  const g=await makeGame({virtualTime:true});t.after(g.close);const w=g.window,town=settleGame(g);w.planet.day=80;
  Object.assign(w.planet.unlocks,{fire:20,smith:30,astronomy:20,education:20});town.jobs={miner:1};town.resources={crop:1000,sand:3,metal:4,lumber:4};town.research={farm:100};
  w.openRegBrowser(town,'town');[...w.document.querySelectorAll('.paultendoTownLife button')].find(b=>b.textContent==='Meet the people').click();
  const person=town._paultendoPeople.find(p=>p.role==='miner');person.outlook='steadfast';
  assert.equal(w.readyEvent('unlockKilns'),undefined,'a sample with no purpose supplies no urgent need');
  w.planet._paultendoLife.materialWork.push({id:'wanted-scope',town:town.id,type:'telescope',person:person.id,name:person.name,status:'waiting',day:10,cost:{glass:2,metal:2,lumber:1},remaining:8,output:1,steps:[],inputs:[]});
  const caller=w.readyEvent('unlockKilns');assert.ok(caller,'the maker is free while glass is missing');
  assert.equal(caller.args.value.town,town.id);w.gameEvents.unlockKilns.func(caller.subject,caller.target,caller.args);
  const inquiry=w.planet._paultendoLife.inquiries.at(-1);assert.equal(inquiry.status,'waiting');assert.equal(inquiry.cost.clay,2);
  assert.equal(town.resources.clay,undefined);assert.equal(w.planet.unlocks.fire,20);assert.equal(town.resources.glass,undefined);
  assert.deepEqual(g.errors,[]);assert.deepEqual(g.warnings,[]);
});
