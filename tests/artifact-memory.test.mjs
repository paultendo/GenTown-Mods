import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGame,settleGame} from './harness.mjs';

const plain=x=>JSON.parse(JSON.stringify(x));
const life=w=>w.planet._paultendoLife;
function controlled(w) {
  for(const id of ['townFarm','townTame','townMine','townLumber','townBirth','townDeath','townExpand','townEat','townEmploy','doctorEffect','roadGovernanceBonus','warPressureDynamics','processAll']) {
    if(w.gameEvents[id]?.func)w.gameEvents[id].func=()=>{};
    if(w.gameEvents[id]?.perChunk)w.gameEvents[id].perChunk=()=>{};
  }
}
function next(w,n=1){const choose=w.chooseEvent;w.chooseEvent=()=>null;try{for(let i=0;i<n;i++)w.nextDay();}finally{w.chooseEvent=choose;}}
function fixture(g,role='doctor') {
  const w=g.window,town=settleGame(g);controlled(w);
  w.planet.day=10;town.name='Wick';town.pop=40;town.jobs={[role]:20};town.resources.crop=1000;
  town.gov='dictatorship';town.governmentType='dictatorship';town.values={order:8,justice:0,openness:0};
  Object.assign(w.planet.unlocks,{education:20,astronomy:20,smith:40,military:20,government:20});
  w.openRegBrowser(town,'town');[...w.document.querySelectorAll('.paultendoTownLife button')].find(b=>b.textContent==='Meet the people').click();
  const person=town._paultendoPeople.find(p=>p.role===role);person.outlook='curious';
  const chunk=w.planet.chunks[town.center.join(',')],key=town.center.join(',');
  const place=life(w).places[key] ||= {id:key,x:chunk.x,y:chunk.y,name:'The camp',biome:chunk.b,visits:[],changes:[]};
  // A saved ordinary lens finished during war. Production and its rarity are
  // covered by autonomous-inventions; this fixture isolates subsequent use.
  const artifact={id:'artifact:memory-fixture',kind:'lens',title:'The stubborn glass',quality:.6,lineage:'made:memory-fixture',place:place.id,status:'carried',person:person.id,name:person.name,town:town.id,townName:town.name,anchor:[...town.center],due:10,uses:{},events:[],origin:{passage:0,maker:{name:person.name,town:town.name,world:w.planet.name,day:9},wartime:[{war:1,meaning:'persistence',day:8,days:2}],wartimeCompletion:{war:1,day:9,town:town.id,townName:'Wick'}}};
  life(w).artifacts.push(artifact);return {w,town,person,artifact};
}

test('ordinary wartime work needs repeated use before inspiring care, and reloads cannot repeat its influence',async t=>{
  const g=await makeGame();t.after(g.close);const {w,town,artifact}=fixture(g);
  next(w,6);assert.equal(life(w).teachings.length,0);assert.equal(artifact.memories[town.id].days,6);
  // Reading the story is not another day of use.
  w.openRegBrowser(town,'town');const story=[...w.document.querySelectorAll('.paultendoTownLife button')].find(b=>b.textContent.endsWith(' · Its story'));assert.ok(story);story.click();
  assert.equal(artifact.memories[town.id].days,6);
  const restored=await makeGame({save:plain(w.generateSave())});t.after(restored.close);const rw=restored.window;controlled(rw);
  next(rw,5);assert.equal(life(rw).teachings.length,0);next(rw);
  const teaching=life(rw).teachings.find(x=>x.origin.cause?.type==='artifactMemory');assert.ok(teaching,JSON.stringify({artifacts:life(rw).artifacts,town:rw.regGet('town',town.id),teachings:life(rw).teachings}));assert.equal(teaching.meaning,'care');assert.equal(teaching.origin.kind,'community');assert.equal(teaching.origin.whisper,undefined);assert.equal(teaching.origin.cause.days,12);assert.ok(teaching.changes.disease<0);assert.ok(teaching.readyDay>rw.planet.day);
  const copy=life(rw).artifacts.find(a=>a.id===artifact.id);assert.equal(copy.memories[town.id].teaching,teaching.id);
  const news=[...rw.document.querySelectorAll('.logMessage')].find(e=>e.dataset.storyKind==='teaching'&&e.dataset.storyId===teaching.id);
  assert.ok(news);assert.match(news.textContent,/stubborn glass.*Wick/);assert.ok(news.querySelector('.paultendoChronicleStoryLink'));
  next(rw,25);assert.equal(life(rw).teachings.filter(x=>x.origin.cause?.type==='artifactMemory').length,1);assert.equal(copy.events.filter(e=>e.text.includes('After living with it')).length,1);
  const rt=rw.regGet('town',town.id);rw.openRegBrowser(rt,'town');[...rw.document.querySelectorAll('.paultendoTownLife button')].find(b=>b.textContent.endsWith(' · Its story')).click();
  const follow=[...rw.document.getElementById('actionSubList').querySelectorAll('[role="button"]')].find(b=>b.textContent.includes('Follow no one left behind'));assert.ok(follow);follow.click();
  assert.match(rw.document.getElementById('actionSubList').textContent,/stubborn glass.*fighting at Wick/s);assert.doesNotMatch(rw.document.getElementById('actionSubList').textContent,/You whispered/);
  assert.deepEqual(g.errors,[]);assert.deepEqual(restored.errors,[]);
});

test('the bearer can draw a coercive lesson from the same ordinary object, rather than a compulsory happy ending',async t=>{
  const g=await makeGame();t.after(g.close);const {w,artifact}=fixture(g,'soldier');next(w,12);
  const teaching=life(w).teachings.find(x=>x.origin.cause?.type==='artifactMemory');assert.ok(teaching);assert.equal(teaching.meaning,'control');assert.ok(teaching.changes.law>0);assert.ok(teaching.changes.happy<0);assert.match(teaching.origin.cause.text,/discipline/);assert.equal(artifact.memories[teaching.town].meaning,'control');assert.deepEqual(g.errors,[]);
});

test('war service, peace-time completion, hoarding, hunger and unfamiliar past lives do not manufacture wartime symbols',async t=>{
  for(const obstacle of ['warService','peace','hoard','hunger','pastLife','foreignTown']) {
    const g=await makeGame();t.after(g.close);const {w,town,person,artifact}=fixture(g);
    if(obstacle==='warService')artifact.origin.wartime[0].meaning='healing';
    if(obstacle==='peace')delete artifact.origin.wartimeCompletion;
    if(obstacle==='hoard')person.outlook='guarded';
    if(obstacle==='hunger')town.resources.crop=0;
    if(obstacle==='pastLife')artifact.origin.passage=-1;
    if(obstacle==='foreignTown')artifact.origin.wartimeCompletion.town='another town';
    next(w,15);assert.equal(life(w).teachings.filter(x=>x.origin.cause?.type==='artifactMemory').length,0,obstacle);assert.deepEqual(g.errors,[]);
  }
});

test('an unseen community can be inspired without exposing names, including an older carried wartime history',async t=>{
  const g=await makeGame();t.after(g.close);const {w,town,artifact}=fixture(g);
  delete artifact.origin.wartimeCompletion;artifact.origin.history=[{passage:0,world:'An older sky',events:[{day:9,text:'It was finished while Wick was at war.',knownTown:true}]}];
  town._hidden=true;delete w.planet._paultendoFog.explored[town.center.join(',')];next(w,12);
  const teaching=life(w).teachings.find(x=>x.origin.cause?.type==='artifactMemory');assert.ok(teaching,JSON.stringify({artifact,teachings:life(w).teachings,town}));assert.equal(teaching.origin.knownTown,false);
  assert.equal([...w.document.querySelectorAll('.logMessage')].some(e=>e.dataset.storyKind==='teaching'&&e.dataset.storyId===teaching.id),false);assert.deepEqual(g.errors,[]);
});
