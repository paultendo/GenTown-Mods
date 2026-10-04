import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGame,settleGame} from './harness.mjs';
const plain=x=>JSON.parse(JSON.stringify(x));
async function setup(t){
 const g=await makeGame();t.after(g.close);const w=g.window,town=settleGame(g);
 w.planet.day=80;Object.assign(w.planet.unlocks,{education:30,government:30,trade:30});
 Object.assign(town,{name:'Farbank',start:1,pop:40,jobs:{merchant:20},resources:{crop:1000,clay:3,cash:100},wealth:1000,econ:'socialism',tax:.1,values:{openness:4,justice:4,order:0}});
 return {g,w,town};
}
function keep(w,town){w.gameEvents.townKeepAccounts.func([town]);}
function period(w,town,n=8){for(let i=0;i<n;i++){w.planet.day++;w.gameEvents.townTax.func(town);keep(w,town);}}
function click(w,text){const b=[...w.document.querySelectorAll('#actionSubList [role="button"]')].find(b=>b.textContent.includes(text));assert.ok(b,`Missing ${text}`);b.click();}
function open(w,town){w.openRegBrowser(town,'town');const b=[...w.document.querySelectorAll('.paultendoTownLife button')].find(b=>b.textContent==='Accounts');assert.ok(b);b.click();}

test('accounts require local writing, administration, currency and real free hands before using a tablet',async t=>{
 const {g,w,town}=await setup(t);
 w.planet._paultendoLocalKnowledge={'education:30':{key:'education',level:30,before:20}};
 keep(w,town);assert.equal(town._paultendoAccounts,undefined);assert.equal(town.resources.clay,3);
 town._paultendoLocalDiscoveries={'education:30':{day:79}};town.jobs={farmer:20};keep(w,town);assert.equal(town._paultendoAccounts.phase,'hands');assert.equal(town.resources.clay,3);assert.equal(town._paultendoPeople?.length || 0,0);
 w.planet.day++;town.jobs={merchant:20};town.resources.crop=0;keep(w,town);assert.equal(town._paultendoAccounts.phase,'food');assert.equal(town.resources.clay,3);
 w.planet.day++;town.resources.crop=1000;keep(w,town);assert.equal(town.resources.clay,2);assert.equal(town._paultendoAccounts.medium,'clay');assert.ok(town._paultendoAccounts.keeper.person);assert.equal(town._paultendoAccounts.reports.length,0);assert.deepEqual(g.errors,[]);
});

test('eight observed evenings record actual public receipts and payments without knowing private balances',async t=>{
 const {g,w,town}=await setup(t);keep(w,town);const total=town.wealth+town.resources.cash;
 for(let i=0;i<8;i++){w.planet.day++;w.gameEvents.townTax.func(town);w.happen('RemoveResource',null,town,{type:'cash',count:1});keep(w,town);}
 const report=town._paultendoAccounts.reports[0];assert.equal(report.from,81);assert.equal(report.until,88);assert.equal(report.published,88);assert.equal(report.opening,100);assert.equal(report.spent,8);assert.equal(report.kinds.tax.received,16);assert.equal(report.closing,108);assert.equal(town.wealth+town.resources.cash,total);assert.equal(report.medium,'clay');assert.equal(town.resources.clay,2);assert.equal('wealth' in report,false);
 const before=plain({day:w.planet.day,book:town._paultendoAccounts,resources:town.resources,people:town._paultendoPeople,life:w.planet._paultendoLife});let draws=0;const random=w.Math.random;w.Math.random=()=>{draws++;return random();};
 open(w,town);click(w,'Days 81');const panel=w.document.getElementById('actionSubList');assert.match(panel.textContent,/about 110 cash/);assert.match(panel.textContent,/Opening purse: 100 cash/);assert.doesNotMatch(panel.textContent,/private wealth|tax returns/);w.Math.random=random;assert.equal(draws,0);assert.deepEqual(plain({day:w.planet.day,book:town._paultendoAccounts,resources:town.resources,people:town._paultendoPeople,life:w.planet._paultendoLife}),before);assert.deepEqual(g.errors,[]);
});

test('missing workers and unrecorded money interrupt the period without invented receipts or a second tablet',async t=>{
 const {g,w,town}=await setup(t);keep(w,town);period(w,town,3);town.jobs={farmer:20};w.planet.day++;keep(w,town);assert.equal(town._paultendoAccounts.entries.length,0);assert.equal(town._paultendoAccounts.phase,'hands');
 town.jobs={merchant:20};w.planet.day++;keep(w,town);period(w,town,2);town.resources.cash+=100;w.planet.day++;keep(w,town);assert.equal(town._paultendoAccounts.phase,'gap');assert.equal(town._paultendoAccounts.entries.length,0);
 period(w,town);const report=town._paultendoAccounts.reports[0];assert.equal(report.received,16);assert.equal(report.closing-report.opening,16);assert.equal(report.kinds.other,undefined);assert.equal(town.resources.clay,2);assert.deepEqual(g.errors,[]);
});

test('reload and a repeated nightly call neither pay again nor manufacture an entry',async t=>{
 const {g,w,town}=await setup(t);keep(w,town);period(w,town,4);const before=plain(town._paultendoAccounts);keep(w,town);assert.deepEqual(plain(town._paultendoAccounts),before);
 const restored=await makeGame({save:plain(w.generateSave())});t.after(restored.close);const rw=restored.window,rt=rw.regGet('town',town.id);keep(rw,rt);assert.deepEqual(plain(rt._paultendoAccounts),before);period(rw,rt,4);assert.equal(rt._paultendoAccounts.reports.length,1);assert.equal(rt.resources.clay,2);period(rw,rt);assert.equal(rt._paultendoAccounts.reports.length,2);assert.equal(rt._paultendoAccounts.reports[1].from,89);assert.equal(rt.resources.clay,1);assert.deepEqual(g.errors,[]);assert.deepEqual(restored.errors,[]);
});

test('rulers can withhold completed books and later release the same dated record without new materials',async t=>{
 const {g,w,town}=await setup(t);town.gov='dictatorship';town.values={order:10,justice:0,openness:0};keep(w,town);period(w,town);const report=town._paultendoAccounts.reports[0];assert.equal(report.published,null);const original=plain(report);open(w,town);assert.doesNotMatch(w.document.getElementById('actionSubList').textContent,/100 cash|116 cash/);assert.equal([...w.document.querySelectorAll('[data-story-id]')].some(e=>e.dataset.storyId===report.id),false);
 town.resources.clay=0;town.values.openness=20;w.planet.day++;keep(w,town);assert.equal(report.published,89);assert.equal(report.from,original.from);assert.equal(report.until,original.until);assert.equal(report.closing,original.closing);assert.equal(town.resources.clay,0);assert.ok([...w.document.querySelectorAll('[data-story-id]')].some(e=>e.dataset.storyId===report.id));assert.deepEqual(g.errors,[]);
});

test('paper imported from another workshop can be consumed for books without granting papermaking',async t=>{
 const {g,w,town}=await setup(t);w.happen('AddResource',null,town,{type:'paper',count:2});
 town._paultendoCommodityLots={paper:[{exchange:'paper-shipment',from:999,count:2}]};(w.planet._paultendoLife.exchanges ||= []).push({id:'paper-shipment',buyer:town.id,seller:999,type:'paper',status:'arrived',resolved:true,steps:[],names:{[town.id]:'Farbank',999:'Wick'},known:{[town.id]:true}});
 keep(w,town);assert.equal(town.resources.paper,1);assert.equal(town.resources.clay,3);assert.equal(town._paultendoAccounts.medium,'paper');assert.equal(town._paultendoAccounts.inputs[0].exchange,'paper-shipment');assert.equal(w.planet._paultendoLife.exchanges.at(-1).uses[0].kind,'accounts');assert.equal(town._paultendoMaterials.paper.technique,undefined);
 period(w,town);assert.equal(town._paultendoAccounts.reports[0].medium,'paper');open(w,town);click(w,'Days 81');assert.match(w.document.getElementById('actionSubList').textContent,/Written on paper/);assert.deepEqual(g.errors,[]);
});

test('another inquiry can reserve the last sheet while the clerk keeps using clay',async t=>{
 const {g,w,town}=await setup(t);w.happen('AddResource',null,town,{type:'paper',count:1});
 w.planet._paultendoLife.inquiries.push({id:'reserved-paper',town:town.id,event:'unlockLibraries',status:'waiting',cost:{paper:1},days:10});keep(w,town);assert.equal(town.resources.paper,1);assert.equal(town.resources.clay,2);assert.equal(town._paultendoAccounts.medium,'clay');assert.deepEqual(g.errors,[]);
});

test('a tax proposal retains only the public source available then, and stale or private books give no estimate',async t=>{
 const {g,w,town}=await setup(t);keep(w,town);period(w,town);const report=plain(town._paultendoAccounts.reports[0]);town.resources.cash=0;
 const args={};w.gameEvents.townTaxChange.value(w.currentPlayer,town,args);assert.deepEqual(plain(args._paultendoEconomic.cause.report),report);town._paultendoAccounts.reports[0].closing=999;assert.equal(args._paultendoEconomic.cause.report.closing,report.closing);
 w.planet.day=119;const stale={};w.gameEvents.townTaxChange.value(w.currentPlayer,town,stale);assert.equal(stale._paultendoEconomic.cause.report,null);w.planet.day=90;town._paultendoAccounts.reports[0].published=null;const privateArgs={};w.gameEvents.townTaxChange.value(w.currentPlayer,town,privateArgs);assert.equal(privateArgs._paultendoEconomic.cause.report,null);assert.deepEqual(g.errors,[]);
});

test('nightly bookkeeping observes the financial daily events and undiscovered towns keep their names hidden',async t=>{
 const {g,w,town}=await setup(t);town._hidden=true;
 const order=Object.keys(w.dailyEvents);assert.ok(order.indexOf('townKeepAccounts')>order.indexOf('townTax'));assert.ok(order.indexOf('townKeepAccounts')>order.indexOf('townEconomyTick'));
 for(const [id,event] of Object.entries(w.dailyEvents))if(!['townKeepAccounts','townTax'].includes(id)){if(event.func)event.func=()=>{};if(event.perChunk)event.perChunk=()=>{};}
 const choose=w.chooseEvent;w.chooseEvent=()=>null;try{for(let i=0;i<9;i++)w.nextDay();}finally{w.chooseEvent=choose;}
 const report=town._paultendoAccounts.reports[0];assert.equal(report.from,81);assert.equal(report.until,88);assert.equal(report.received,16);assert.equal(report.published,89);assert.equal(report.closing,118);assert.equal([...w.document.querySelectorAll('[data-story-id]')].some(e=>e.dataset.storyId===report.id),false);assert.deepEqual(g.errors,[]);
});
