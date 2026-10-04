import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGame,settleGame} from './harness.mjs';
const plain=x=>JSON.parse(JSON.stringify(x));
async function setup(t){
 const g=await makeGame();t.after(g.close);const w=g.window,town=settleGame(g);
 w.planet.day=80;Object.assign(w.planet.unlocks,{education:30,government:30,trade:30,smith:20});
 Object.assign(town,{name:'Farbank',start:1,pop:40,jobs:{merchant:20},resources:{crop:1000,cash:100},tax:.1,wealth:1000,values:{openness:4,justice:4,order:0}});
 return {g,w,town};
}
function keep(w,town){w.gameEvents.townKeepAccounts.func([town]);}
function evening(w,town){w.planet.day++;w.gameEvents.townTax.func(town);keep(w,town);}

for(const [type,days,form] of [['lumber',2,'wooden tally boards'],['rock',4,'carved stone']])test(`${form} take real preparation before recording receipts and survive reload without a second payment`,async t=>{
 const {g,w,town}=await setup(t);town.resources[type]=1;keep(w,town);const book=town._paultendoAccounts;
 assert.equal(book.phase,'preparing');assert.equal(book.preparing,days);assert.equal(book.medium,type);assert.equal(town.resources[type] || 0,0);assert.equal(book.opening,null);assert.equal(book.entries.length,0);
 keep(w,town);assert.equal(book.preparing,days);
 evening(w,town);assert.equal(book.preparing,days-1);
 town.resources.crop=0;evening(w,town);assert.equal(book.phase,'food');assert.equal(book.preparing,days-1);
 town.resources.crop=1000;
 const resumed=await makeGame({save:plain(w.generateSave())});t.after(resumed.close);const rw=resumed.window,rt=rw.regGet('town',town.id),copy=rt._paultendoAccounts;
 keep(rw,rt);assert.equal(copy.preparing,days-1);assert.equal(rt.resources[type] || 0,0);
 for(let i=0;i<days-1;i++)evening(rw,rt);
 assert.equal(copy.phase,'writing');assert.equal(copy.entries.length,0);const opening=copy.opening.day;
 for(let i=0;i<8;i++)evening(rw,rt);
 const report=copy.reports[0];assert.equal(report.from,opening+1);assert.equal(report.until,opening+8);assert.equal(report.received,16);assert.equal(report.form,form);assert.equal(report.preparation,days);assert.equal(report.medium,type);assert.equal(rt.resources[type] || 0,0);
 rw.openRegBrowser(rt,'town');[...rw.document.querySelectorAll('.paultendoTownLife button')].find(b=>b.textContent==='Accounts').click();
 [...rw.document.querySelectorAll('#actionSubList [role="button"]')].find(b=>b.textContent.includes(`Days ${opening+1}`)).click();assert.match(rw.document.getElementById('actionSubList').textContent,new RegExp(`Written on ${form}`));
 assert.deepEqual(g.errors,[]);assert.deepEqual(resumed.errors,[]);
});

test('records cannot take the stone reserved for a building or timber promised to another inquiry',async t=>{
 const {g,w,town}=await setup(t);town.resources.rock=4;town.resources.lumber=1;
 w.happen('Create',town,null,{type:'project',subtype:'school',cost:8},'process');
 w.planet._paultendoLife.inquiries.push({id:'timber-record',town:town.id,event:'unlockLibraries',status:'waiting',cost:{lumber:1},days:10});
 keep(w,town);assert.equal(town._paultendoAccounts.phase,'materials');assert.equal(town.resources.rock,4);assert.equal(town.resources.lumber,1);
 town.resources.rock=5;evening(w,town);assert.equal(town._paultendoAccounts.medium,'rock');assert.equal(town.resources.rock,4);assert.equal(town.resources.lumber,1);assert.deepEqual(g.errors,[]);
});

test('a record surface requires local shaping knowledge and paper takes precedence when it is available',async t=>{
 const {g,w,town}=await setup(t);town.resources.rock=2;
 w.planet._paultendoLocalKnowledge={'smith:20':{key:'smith',level:20,before:10}};
 keep(w,town);assert.equal(town._paultendoAccounts.phase,'materials');assert.equal(town.resources.rock,2);
 town._paultendoLocalDiscoveries={'smith:20':{day:w.planet.day}};w.happen('AddResource',null,town,{type:'paper',count:1});evening(w,town);
 assert.equal(town._paultendoAccounts.medium,'paper');assert.equal(town._paultendoAccounts.phase,'writing');assert.equal(town.resources.paper || 0,0);assert.equal(town.resources.rock,2);assert.deepEqual(g.errors,[]);
});

test('burnable records do not fuel a hot workshop and coal cannot replace an ingredient solely because it burns',async t=>{
 const {g,w,town}=await setup(t);Object.assign(w.planet.unlocks,{fire:50,military:30,smith:30});town.jobs={miner:20,farmer:20};town.research={military:100};town.tax=0;delete town.resources.cash;
 w.happen('AddResource',null,town,{type:'coal',count:3});w.happen('AddResource',null,town,{type:'paper',count:4});
 const caller=w.readyEvent('unlockGunpowder');assert.ok(caller);w.doEvent('unlockGunpowder',caller);const work=w.planet._paultendoLife.inquiries.at(-1);
 assert.deepEqual(plain(work.cost),{charcoal:2});
 for(const event of Object.values(w.dailyEvents)){if(event.func)event.func=()=>{};if(event.perChunk)event.perChunk=()=>{};}
 const choose=w.chooseEvent;w.chooseEvent=()=>null;try{w.nextDay();}finally{w.chooseEvent=choose;}
 assert.equal(work.status,'waiting');assert.deepEqual(plain(work.cost),{charcoal:2});assert.equal(town.resources.coal,3);assert.equal(town.resources.paper,4);assert.equal(w.planet.unlocks.fire,50);assert.deepEqual(g.errors,[]);
});
