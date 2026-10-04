import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGame,settleGame} from './harness.mjs';
const plain=x=>JSON.parse(JSON.stringify(x));
function quiet(w) {
  for(const id of ['townEat','townFarm','townTame','townMine','townLumber','townBirth','townDeath','townExpand','townEmploy']){
    if(w.gameEvents[id]?.func)w.gameEvents[id].func=()=>{};
    if(w.gameEvents[id]?.perChunk)w.gameEvents[id].perChunk=()=>{};
  }
  w.gameEvents.processAll.func=()=>{};w.chooseEvent=()=>null;
}
function next(w){w.nextDay();for(const work of w.planet._paultendoLife.materialWork)work.roll=.99;}
function setup(g) {
  const w=g.window,town=settleGame(g);w.planet.day=80;
  Object.assign(w.planet.unlocks,{fire:50,smith:30,education:20,astronomy:20});
  Object.assign(town,{pop:30,jobs:{miner:1,scholar:1},resources:{crop:1000,sand:3,charcoal:2,rock:3,lumber:5,metal:5,glass:1},research:{farm:100}});
  town._paultendoNextExchangeDay=99999;
  w.openRegBrowser(town,'town');[...w.document.querySelectorAll('.paultendoTownLife button')].find(b=>b.textContent==='Meet the people').click();
  for(const person of town._paultendoPeople)person.outlook='curious';
  const person=town._paultendoPeople.find(p=>p.role==='miner');
  const work={id:'queued-instrument',town:town.id,type:'telescope',person:person.id,name:person.name,day:10,status:'waiting',cost:{glass:2,metal:2,lumber:1},remaining:8,output:1,trial:true,purpose:{type:'telescope',actual:true,allowed:true},steps:[],inputs:[],roll:.99};
  w.planet._paultendoLife.materialWork.push(work);quiet(w);return {w,town,work};
}
test('an old queued instrument can make its missing glass and finish instead of blocking the workshop forever',async t=>{
  const g=await makeGame({virtualTime:true});t.after(g.close);const {w,town,work}=setup(g);
  next(w);const glass=w.planet._paultendoLife.materialWork.find(x=>x.type==='glass');
  assert.ok(glass);assert.equal(glass.parent,work.id);assert.equal(work.status,'waiting');
  for(let i=0;i<30&&work.status!=='made';i++){
    next(w);
    assert.ok(w.planet._paultendoLife.materialWork.filter(x=>x.town===town.id&&x.status==='working').length<=1);
  }
  assert.equal(glass.status,'made');assert.equal(work.status,'made');
  assert.equal(town.resources.sand || 0,0);assert.equal(town.resources.charcoal || 0,0);
  assert.equal(glass.cost.sand,3);
  assert.deepEqual(g.errors,[]);assert.deepEqual(g.warnings,[]);
});
test('queued ingredient work keeps its paid inputs across reload and never awards an unlearned method',async t=>{
  const g=await makeGame({virtualTime:true});t.after(g.close);const {w,town,work}=setup(g);
  w.planet.unlocks.fire=40;
  next(w);assert.equal(w.planet._paultendoLife.materialWork.some(x=>x.type==='glass'),false);
  assert.equal(town.resources.glass,1);
  w.planet.unlocks.fire=50;
  let glass;
  for(let i=0;i<30&&glass?.status!=='working';i++){
    next(w);glass=w.planet._paultendoLife.materialWork.find(x=>x.type==='glass');
  }
  assert.equal(glass?.status,'working','the workshop finishes other useful work before starting glass');
  const used=plain(glass.inputs),save=plain(w.generateSave());
  const restored=await makeGame({virtualTime:true,save});t.after(restored.close);const rw=restored.window;quiet(rw);
  const copy=rw.planet._paultendoLife.materialWork.find(x=>x.id===glass.id);
  for(let i=0;i<30&&rw.planet._paultendoLife.materialWork.find(x=>x.id===work.id).status!=='made';i++)next(rw);
  assert.equal(copy.status,'made');assert.deepEqual(plain(copy.inputs),used);
  assert.equal(rw.regGet('town',town.id).resources.sand || 0,0);
  assert.deepEqual(restored.errors,[]);
});
test('an unknown ingredient method cannot prevent fuel-making for another real inquiry',async t=>{
  const g=await makeGame({virtualTime:true});t.after(g.close);const {w,town,work}=setup(g);
  w.planet.unlocks.fire=30;town.resources.charcoal=0;
  const miner=town._paultendoPeople.find(p=>p.role==='miner');
  w.planet._paultendoLife.inquiries.push({id:'fuel-inquiry',town:town.id,event:'unlockKilns',key:'fire',level:40,title:'Kilns',person:miner.id,name:miner.name,day:80,status:'waiting',cost:{clay:2,charcoal:1},remaining:6,steps:[],inputs:[]});
  next(w);
  const fuel=w.planet._paultendoLife.materialWork.find(x=>x.type==='charcoal');
  assert.ok(fuel,'a separate real need can still start useful work');
  for(let i=0;i<12&&fuel.status!=='made';i++)next(w);
  assert.equal(fuel.status,'made');assert.equal(work.status,'waiting');
  assert.equal(w.planet._paultendoLife.materialWork.some(x=>x.type==='glass'),false);
  assert.deepEqual(g.errors,[]);
});
test('repeated tool orders cannot starve an older boat request through recipe-list order',async t=>{
  const g=await makeGame({virtualTime:true});t.after(g.close);const {w,town}=setup(g);
  w.planet.unlocks.travel=30;w.planet.unlocks.fire=30;town.jobs.farmer=10;town.jobs.lumberer=1;
  town.resources.crop=100;
  town._paultendoFoodFlow=[78,79,80].map(day=>({day,harvest:5,wanted:3,consumed:3}));
  w.planet._paultendoLife.materialWork.push({id:'previous-tools',town:town.id,type:'stone_tools',day:75,finished:79,status:'made',output:2,steps:[],inputs:[]});
  w.planet._paultendoLife.seaVoyages.push({id:'waiting-boat',town:town.id,type:'coastal_boat',day:20,lastDay:80,status:'preparing',steps:[],target:{x:0,y:0},path:[],held:0,inputs:[]});
  next(w);
  const boat=w.planet._paultendoLife.materialWork.find(x=>x.type==='coastal_boat');
  assert.ok(boat,JSON.stringify(w.planet._paultendoLife.materialWork.map(x=>[x.type,x.status])));
  assert.equal(w.planet._paultendoLife.materialWork.filter(x=>x.type==='stone_tools').length,1);
  assert.equal(boat.cost.lumber,4);assert.deepEqual(g.errors,[]);
});
test('route caches are discarded from legacy imports and never saved as detached map tiles',async t=>{
  const g=await makeGame({virtualTime:true});t.after(g.close);settleGame(g);
  const save=plain(g.window.generateSave());
  save.planet._paultendoPathCache={huge:{path:[{x:0,y:0,stale:true,padding:'x'.repeat(5100000)}]}};
  const copy=await makeGame({virtualTime:true,save});t.after(copy.close);
  assert.equal(copy.window.planet._paultendoPathCache,undefined);
  const exported=copy.window.generateSave();assert.equal(exported.planet._paultendoPathCache,undefined);
  assert.ok(JSON.stringify(exported).length<1000000);
  copy.window.autosave();assert.deepEqual(plain(copy.window.GenTownLocal.errors),[]);
  assert.deepEqual(copy.errors,[]);
});
