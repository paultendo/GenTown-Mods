import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGame,settleGame} from './harness.mjs';
const plain=x=>JSON.parse(JSON.stringify(x));
function pair(g) {
  const w=g.window,a=settleGame(g),at=w.filterChunks(c=>!c.v.s&&c.b!=='water'&&c.b!=='mountain')[0];
  const b=w.happen('Create',null,null,{x:at.x,y:at.y},'town');
  for(const town of [a,b]){town.pop=20;town.jobs={};town.resources={crop:100};town.wealth=0;town.infrastructure={buildings:70,roads:70,institutions:60};}
  return {w,a,b};
}
test('room follows local building methods and condition without compounding distant smithing levels',async t=>{
  const g=await makeGame({virtualTime:true});t.after(g.close);const {w,a,b}=pair(g);
  const base=w.$c.maxPopulation(b);
  w.planet.unlocks.smith=60;
  w.planet._paultendoLocalKnowledge={'smith:60':{key:'smith',before:40,level:60}};
  a._paultendoLocalDiscoveries={'smith:60':{day:1}};
  assert.ok(w.$c.maxPopulation(a)>w.$c.maxPopulation(b));
  assert.ok(w.$c.maxPopulation(b)>base,'existing shared stonework still has a use');
  const room=w.$c.maxPopulation(a);
  w.planet.unlocks.smith=1000;
  assert.equal(w.$c.maxPopulation(a),room);
  a.infrastructure.buildings=10;
  assert.ok(w.$c.maxPopulation(a)<room);
  const damaged=w.$c.maxPopulation(a);a.size*=2;
  assert.equal(w.$c.maxPopulation(a),damaged*2);
});
test('growth needs meals actually eaten and slows near the available room',async t=>{
  const counts=[];
  for(const [fraction,pop] of [[1,100],[0,100],[0.5,100],[1,990]]) {
    const g=await makeGame({virtualTime:true,seed:42});t.after(g.close);const {w,a}=pair(g);
    a.size=50;a.pop=pop;a.influences.birth=0;w.planet.day=30;
    a._paultendoFoodFlow=[28,29,30].map(day=>({day,wanted:20,consumed:20*fraction}));
    a.resources.crop=10000; // Delivering stock alone must not erase missed meals.
    let total=0;
    for(let i=0;i<500;i++){a.pop=pop;const before=a.pop;w.gameEvents.townBirth.func(a);total+=a.pop-before;}
    counts.push(total);
  }
  assert.equal(counts[1],0);
  assert.ok(counts[0]>counts[2]*2);
  assert.ok(counts[0]>counts[3]*4);
});
test('an overcrowded imported town keeps its people and goods across reload',async t=>{
  const g=await makeGame({virtualTime:true});t.after(g.close);const {w,a}=pair(g);
  a.size=1;a.pop=500;a.resources={crop:10000,metal:800};a.infrastructure.buildings=0;
  w.gameEvents.townBirth.func(a);
  assert.equal(a.pop,500);assert.equal(a.resources.crop,10000);
  const restored=await makeGame({virtualTime:true,save:plain(w.generateSave())});t.after(restored.close);
  const town=restored.window.regGet('town',a.id);
  assert.equal(town.pop,500);assert.equal(town.resources.metal,800);
});
test('migration conserves people, jobs and wealth when the destination has little room',async t=>{
  const g=await makeGame({virtualTime:true});t.after(g.close);const {w,a,b}=pair(g);
  a.jobs={farmer:20};a.wealth=100;b.pop=w.$c.maxPopulation(b)-2;
  const people=a.pop+b.pop,jobs=a.jobs.farmer+(b.jobs.farmer || 0);
  assert.equal(w.happen('Migrate',a,b,{count:15}).count,2);
  assert.equal(a.pop+b.pop,people);
  assert.equal(a.jobs.farmer+(b.jobs.farmer || 0),jobs);
  assert.equal(a.wealth+b.wealth,100);
  const before=plain([a,b]);
  assert.equal(w.happen('Migrate',a,b,{count:5}).count,0);
  assert.deepEqual(plain([a,b]),before);
});
test('a skilled migrant carries one occupation and one inhabitant, including the last departure',async t=>{
  const g=await makeGame({virtualTime:true});t.after(g.close);const {w,a,b}=pair(g);
  a.pop=1;a.jobs={scholar:1};a.wealth=33;
  w.gameEvents.scholarMigration.func(a,b,{});
  assert.equal(a.pop,0);assert.equal(b.pop,21);
  assert.equal(b.jobs.scholar,1);assert.equal(b.wealth,33);
  assert.ok(Number.isFinite(b.wealth));assert.deepEqual(g.errors,[]);
});
test('a native wartime transfer retains conquered inhabitants even when the receiving town is crowded',async t=>{
  const g=await makeGame({virtualTime:true});t.after(g.close);const {w,a,b}=pair(g);
  a.pop=5;a.jobs={farmer:5};a.wealth=25;b.pop=w.$c.maxPopulation(b);
  const war=w.happen('Create',a,null,{type:'war',towns:[a.id,b.id]},'process');
  war.sides=[[a.id],[b.id]];a.issues.war=b.issues.war=war.id;
  const people=a.pop+b.pop,wealth=a.wealth+b.wealth;
  assert.equal(w.happen('Migrate',a,b,{count:a.pop}).count,5);
  assert.equal(a.pop+b.pop,people);assert.equal(b.jobs.farmer,5);
  assert.equal(a.pop,0);assert.equal(b.wealth,wealth);assert.deepEqual(g.errors,[]);
});
test('a packed receiving store cannot destroy a migrant’s carried goods',async t=>{
  const g=await makeGame({virtualTime:true});t.after(g.close);const {w,a,b}=pair(g);
  a.resources={metal:1000};b.resources={metal:w.$c.maxResource(b)};
  const before=a.resources.metal+b.resources.metal;
  w.happen('Migrate',a,b,{count:5});
  assert.equal(a.resources.metal+b.resources.metal,before);
  assert.deepEqual(g.errors,[]);
});
test('famine follows sustained missed meals and ends after regular meals, even during drought',async t=>{
  const g=await makeGame({virtualTime:true});t.after(g.close);const {w,a}=pair(g);w.planet.day=50;
  a.drought={day:1,severity:3};a.resources.crop=1000;
  a._paultendoFoodFlow=[48,49,50].map(day=>({day,wanted:4,consumed:4}));
  assert.equal(w.gameEvents.famine.value(a),false);
  const pop=a.pop;for(let i=0;i<100;i++)w.gameEvents.droughtWorsens.func(a);
  assert.equal(a.pop,pop,'stored food protects people from a second drought death roll');
  a._paultendoFoodFlow.forEach(meal=>meal.consumed=1);
  assert.equal(w.gameEvents.famine.value(a),true);
  w.gameEvents.famine.func(a);
  const deaths=w.planet.stats.death || 0;
  w.gameEvents.famineEffects.func(a);
  assert.equal(w.planet.stats.death || 0,deaths,'townEat owns starvation mortality');
  assert.equal(a.famine.ended,undefined,'stock delivered alone is not recovery');
  a._paultendoFoodFlow.forEach(meal=>meal.consumed=4);
  w.gameEvents.famineEffects.func(a);
  assert.equal(a.famine.ended,true);
  assert.equal(a.famine.recovered,50);
});
test('healthcare cannot give an existing inhabitant a second occupation',async t=>{
  const g=await makeGame({virtualTime:true});t.after(g.close);const {w,a}=pair(g);
  w.planet.unlocks.education=40;a.jobs={farmer:a.pop};a.publicHealthcare=true;
  w.Math.random=()=>0;
  w.gameEvents.publicHealthcareEffect.func(a);
  assert.equal(a.jobs.doctor,undefined);
  a.jobs.farmer--;w.gameEvents.publicHealthcareEffect.func(a);
  assert.equal(a.jobs.doctor,1);
  assert.equal(Object.values(a.jobs).reduce((n,v)=>n+v,0),a.pop);
});
