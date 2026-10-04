import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGame,settleGame} from './harness.mjs';
const plain=x=>JSON.parse(JSON.stringify(x));
async function setup(t){
 const g=await makeGame();t.after(g.close);const w=g.window,town=settleGame(g);w.planet.day=80;
 Object.assign(w.planet.unlocks,{education:30,smith:20,government:30,trade:30,fire:0});
 Object.assign(town,{name:'Farbank',start:1,pop:40,jobs:{lumberer:20,merchant:20},resources:{crop:1000,lumber:5,cash:100},research:{},values:{openness:0,order:0,justice:0}});
 quiet(w);return {g,w,town};
}
function quiet(w){for(const [id,event] of Object.entries(w.dailyEvents))if(id!=='townKeepAccounts'){if(event.func)event.func=()=>{};if(event.perChunk)event.perChunk=()=>{};}}
function next(w,n=1){const choose=w.chooseEvent;w.chooseEvent=()=>null;try{for(let i=0;i<n;i++)w.nextDay();}finally{w.chooseEvent=choose;}}
function batch(w){return w.planet._paultendoLife.materialWork.find(x=>x.type==='paper');}
function finish(w,work){for(let i=0;i<30&&['waiting','working','storing'].includes(work.status);i++)next(w);assert.equal(work.status,'made',JSON.stringify(work));}

test('wooden records motivate a lighter surface without replacing a paid board before its accounts are finished',async t=>{
 const {g,w,town}=await setup(t);next(w);const work=batch(w);assert.ok(work);assert.equal(work.status,'waiting');assert.equal(town._paultendoAccounts.phase,'preparing');assert.equal(town._paultendoAccounts.medium,'lumber');assert.equal(town.resources.lumber,4);assert.equal(town.resources.paper,undefined);work.roll=.99;
 next(w);assert.equal(work.status,'working');assert.equal(town.resources.lumber,3);assert.equal(work.remaining,5);assert.ok(town._paultendoPeople.some(p=>p.id===work.person));assert.ok(work.steps.some(s=>s.text.includes('wood fibres')));
 next(w,4);assert.equal(town.resources.paper,undefined);next(w);assert.equal(work.status,'made');assert.equal(town.resources.paper,4);assert.equal(town._paultendoMaterials.paper.technique.work,work.id);assert.equal(town._paultendoCommodityLots.paper[0].production.person,work.person);
 next(w);assert.equal(town._paultendoAccounts.medium,'lumber');assert.equal(town.resources.paper,4);
 for(let i=0;i<12&&town._paultendoAccounts.medium!=='paper';i++)next(w);
 assert.equal(town._paultendoAccounts.reports[0].medium,'lumber');assert.equal(town._paultendoAccounts.reports[0].form,'wooden tally boards');assert.equal(town._paultendoAccounts.medium,'paper');assert.equal(town.resources.paper,3);assert.equal(town._paultendoAccounts.inputs[0].production.work,work.id);assert.doesNotMatch(work.steps.map(s=>s.text).join(' '),/firing|opens the fire/);assert.deepEqual(g.errors,[]);
});

test('a papermaking trial cannot borrow Writing from a distant town',async t=>{
 const {g,w,town}=await setup(t);w.planet._paultendoLocalKnowledge={'education:30':{key:'education',level:30,before:20}};
 next(w,3);assert.equal(batch(w),undefined);assert.equal(town._paultendoAccounts,undefined);assert.equal(town.resources.lumber,5);
 town._paultendoLocalDiscoveries={'education:30':{day:w.planet.day}};next(w);assert.ok(batch(w));assert.deepEqual(g.errors,[]);
});

test('a failed papermaking trial spends timber, produces no sheets and retains its outcome on reload',async t=>{
 const {g,w,town}=await setup(t);next(w);const work=batch(w);work.roll=0;next(w,2);
 const restored=await makeGame({save:plain(w.generateSave())});t.after(restored.close);const rw=restored.window;quiet(rw);const copy=batch(rw),rt=rw.regGet('town',town.id);assert.equal(copy.roll,0);assert.equal(copy.remaining,4);next(rw,4);
 assert.equal(copy.status,'failed');assert.equal(rt.resources.lumber,3);assert.equal(rt.resources.paper,undefined);assert.equal(rt._paultendoMaterials?.paper?.technique,undefined);assert.equal(rt._paultendoAccounts.medium,'lumber');assert.match(copy.steps.at(-1).text,/sheets tear apart/);assert.doesNotMatch(copy.steps.at(-1).text,/fire/);assert.deepEqual(g.errors,[]);assert.deepEqual(restored.errors,[]);
});

test('new library inquiries need actual sheets and can create demand for paper before it is known',async t=>{
 const {g,w,town}=await setup(t);delete town.resources.cash;town.tax=0;town.jobs={scholar:20,lumberer:20};town.research={education:100};
 const caller=w.readyEvent('unlockLibraries');assert.ok(caller);caller.args.value={town:town.id};w.doEvent('unlockLibraries',caller);const inquiry=w.planet._paultendoLife.inquiries.at(-1);assert.equal(inquiry.cost.paper,2);assert.equal(inquiry.status,'waiting');
 next(w);const work=batch(w);assert.ok(work);work.roll=.99;finish(w,work);next(w);assert.equal(inquiry.status,'working');assert.equal(town.resources.paper,2);assert.equal(town.resources.lumber,2);
 for(let i=0;i<12&&inquiry.status==='working';i++)next(w);assert.equal(inquiry.status,'learned');assert.ok(town._paultendoLocalDiscoveries['education:40']);assert.equal(inquiry.inputs.find(i=>i.type==='paper').production.work,work.id);assert.deepEqual(g.errors,[]);
});
