import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGame,settleGame} from './harness.mjs';
const records=w=>(w.planet._paultendoLife.exchanges || []).filter(r=>['crop','livestock'].includes(r.type));
const panel=w=>w.document.getElementById('actionSubList');
function click(w,text){const b=[...panel(w).querySelectorAll('[role="button"]')].find(b=>b.textContent.includes(text));assert.ok(b,`Missing ${text}`);b.click();}
function people(w,town,outlook='guarded') {
 w.openRegBrowser(town,'town');const b=[...w.document.querySelectorAll('.paultendoTownLife button')].find(b=>b.textContent==='Meet the people');assert.ok(b);b.click();for(const p of town._paultendoPeople)p.outlook=outlook;
}
function pair(g,{currency=false,outlook='guarded'}={}) {
 const w=g.window,a=settleGame(g);Object.assign(w.planet.unlocks,{farm:20,trade:currency?30:10,travel:20,government:10,military:10});
 a.name='Ashbank';a.pop=20;a.jobs={};a.resources={crop:3,cash:0};a.legal.farm=false;a.gov='dictatorship';(a.values ||= {}).order=6;
 const center=w.planet.chunks[a.center.join(',')];const c=w.filterChunks(c=>!c.v.s&&c.v.g===center.v.g&&c.b!=='water'&&c.b!=='mountain').sort((x,y)=>Math.hypot(x.x-center.x,x.y-center.y)-Math.hypot(y.x-center.x,y.y-center.y))[0];assert.ok(c);
 const b=w.happen('Create',null,null,{x:c.x,y:c.y},'town');b.name='Wick';b.pop=20;b.jobs={farmer:4};b.resources={crop:160,cash:0};b.legal.farm=false;b.gov='dictatorship';people(w,b,outlook);return {w,a,b};
}
function short(w,town,days=2){const start=Math.max(4,w.planet.day+1);for(let n=0;n<days;n++){w.planet.day=start+n;town.resources.crop=1;town.resources.livestock=0;w.gameEvents.townEat.func(town);}}
function next(w){const choose=w.chooseEvent;w.chooseEvent=()=>null;try{w.nextDay();}finally{w.chooseEvent=choose;}}
function due(w,r){w.planet.day=Math.max(w.planet.day,r.due-1);next(w);}
function finish(w,r){for(let n=0;n<12&&!r.resolved;n++)due(w,r);assert.equal(r.resolved,true);}
function errors(g){assert.deepEqual(g.errors,[]);}
function religion(w,town,tenets){const args={choice:'yes'};w.gameEvents.religionEmerges.func(town,null,args);args.religion.tenets=tenets;town.influences.faith=9;return args.religion;}

test('short meals create an autonomous request, and aid moves actual food through a saved journey without rewarding the player',async t=>{
 const g=await makeGame();t.after(g.close);const {w,a,b}=pair(g,{outlook:'generous'});
 short(w,a);const r=records(w)[0];assert.ok(r);assert.equal(r.status,'asking');assert.equal(r.shortDays,2);assert.equal(r.cargo,0);
 const amounts=[];const happen=w.happen;w.happen=function(action,subject,target,args,...rest){const before=target?.resources?.crop || 0;const result=happen(action,subject,target,args,...rest);if(args?.type==='crop'&&['RemoveResource','AddResource'].includes(action))amounts.push({action,town:target?.id,delta:(target.resources.crop || 0)-before});return result;};
 due(w,r);assert.equal(r.status,'carrying');assert.ok(r.cargo>0);assert.equal(r.kind,'aid');assert.equal(r.delivered,undefined);
 const cargo=r.cargo;assert.ok(amounts.some(e=>e.action==='RemoveResource'&&e.town===b.id&&e.delta===-cargo));
 const save=JSON.parse(JSON.stringify(w.generateSave()));const restored=await makeGame({save});t.after(restored.close);const rw=restored.window,rr=records(rw).find(x=>x.id===r.id);
 assert.equal(rr.cargo,cargo);finish(rw,rr);assert.equal(rr.status,'arrived');assert.equal(rr.cargo,0);assert.equal(rr.delivered,cargo);
 assert.equal(rw.regGet('town',a.id)._paultendoFoodMemory[b.id].received,cargo);assert.equal(rw.planet._paultendoLife.whispers.length,0);
 const log=[...rw.document.querySelectorAll('.logMessage')].find(e=>e.dataset.storyKind==='exchange'&&e.querySelector('.logText')?.textContent.includes('reach Ashbank'));
 assert.ok(log);log.querySelector('.paultendoChronicleStoryLink').click();assert.match(panel(rw).textContent,/short rations.*sends.*reach Ashbank/s);
 errors(g);errors(restored);
});

test('currency purchase waits for real supplies and transfers real payment rather than buying hunger relief',async t=>{
 const g=await makeGame();t.after(g.close);const {w,a,b}=pair(g,{currency:true});a.resources.cash=120;w.planet.day=4;
 const hunger=a.influences.hunger;
 w.gameEvents.townMarketPurchase.func(a,null,{seller:b,goodsType:'food',price:20});const r=records(w)[0];assert.ok(r);assert.equal(r.source,'market');assert.equal(a.influences.hunger,hunger);assert.equal(a.resources.cash,120);
 const payments=[];let beforePayment;const happen=w.happen;w.happen=function(action,subject,target,args,...rest){if(action==='RemoveResource'&&target===b&&args?.type==='crop')beforePayment=a.resources.cash;const before=target?.resources?.cash || 0;const result=happen(action,subject,target,args,...rest);if(args?.type==='cash'&&action==='AddResource')payments.push({town:target.id,delta:(target.resources.cash || 0)-before,buyer:a.resources.cash});return result;};
 a.resources.cash=120.75;due(w,r);assert.equal(r.kind,'trade');assert.ok(r.payment.count>0);assert.equal(payments.length,0);assert.equal(r.paymentCargo,r.payment.count);assert.equal(beforePayment-a.resources.cash,r.payment.count);assert.equal(a.resources.cash%1,beforePayment%1);
 finish(w,r);assert.equal(r.paymentCargo,0);assert.ok(payments.some(x=>x.town===b.id&&x.delta===r.payment.count));assert.equal(r.delivered,r.steps.find(s=>s.kind==='trade').count);assert.equal(a._paultendoFoodMemory[b.id].received,0);assert.ok(a._paultendoFoodMemory[b.id].traded>0);errors(g);
});

test('pre-currency barter needs actual work and conserves the materials exchanged for food',async t=>{
 const g=await makeGame();t.after(g.close);const {w,a,b}=pair(g);a.resources.lumber=20;
 const project=w.happen('Create',b,null,{type:'project',subtype:'school',cost:20},'process');assert.equal(project.town,b.id);
 short(w,a);const r=records(w)[0];assert.ok(r);due(w,r);assert.equal(r.kind,'barter');assert.equal(r.payment.type,'lumber');assert.ok(r.payment.count<=project.cost);
 assert.equal(a.resources.lumber,20-r.payment.count);assert.equal(b.resources.lumber || 0,0);assert.equal(r.paymentCargo,r.payment.count);assert.ok(r.cargo<=r.payment.count*r.quote.cropsPerMaterial);const sent=r.cargo;
 finish(w,r);assert.equal(r.delivered,sent);errors(g);
});

test('remembered help changes a guarded neighbour’s response and links the earlier actual exchange',async t=>{
 const g=await makeGame();t.after(g.close);const {w,a,b}=pair(g,{outlook:'generous'});short(w,a);const first=records(w)[0];finish(w,first);
 w.happen('AddResource',null,a,{type:'crop',count:180});people(w,a,'guarded');people(w,b,'guarded');short(w,b);
 const second=records(w).find(r=>r.buyer===b.id);assert.ok(second);due(w,second);assert.equal(second.kind,'aid');assert.equal(second.previousHelp.source,first.id);
 assert.match(second.steps.map(s=>s.kind).join(','),/aid/);finish(w,second);
 const log=[...w.document.querySelectorAll('.logMessage')].find(e=>e.dataset.storyId===second.id);assert.ok(log);log.querySelector('.paultendoChronicleStoryLink').click();click(w,'Remember the earlier help');assert.match(panel(w).textContent,/short rations.*Wick sends/s);
 errors(g);
});

test('refusal does not conjure supplies and can become a threat only for a hungry armed town with coercive rule',async t=>{
 for(const armed of [false,true]) {
  const g=await makeGame();t.after(g.close);const {w,a,b}=pair(g);a.jobs=armed?{soldier:20}:{farmer:20};a.relations[b.id]=-3;b.relations[a.id]=-3;
  short(w,a,4);const r=records(w)[0];assert.ok(r);due(w,r);assert.equal(r.status,'refused');assert.equal(r.cargo,0);assert.equal(r.payment,undefined);assert.equal(!!r.threat,armed);
  assert.equal(a._paultendoFoodMemory[b.id].refused,1);
  if(armed){assert.ok(a.relations[b.id]<-3);assert.ok(Object.values(w.planet._paultendoWarPressure || {}).some(x=>x.value>0));assert.equal(r.steps.filter(s=>s.kind==='threat').length,1);}
  errors(g);
 }
});

test('a changed supply or recovered recipient is rechecked before anyone pays or parts with food',async t=>{
 for(const change of ['supplier','recipient']) {
  const g=await makeGame();t.after(g.close);const {w,a,b}=pair(g,{outlook:'generous'});short(w,a);const r=records(w)[0];assert.ok(r);
  if(change==='supplier')b.resources.crop=3;else a.resources.crop=120;
  due(w,r);assert.equal(r.resolved,true);assert.equal(r.cargo,0);assert.equal(r.payment,undefined);assert.equal(r.status,change==='supplier'?'refused':'withdrawn');errors(g);
 }
});

test('a blocked shipment keeps its actual cargo through reload and arrives once when contact resumes',async t=>{
 const g=await makeGame();t.after(g.close);const {w,a,b}=pair(g,{outlook:'generous'});short(w,a);const r=records(w)[0];due(w,r);const cargo=r.cargo;
 w.planet.embargoes=[{fromId:b.id,toId:a.id,start:w.planet.day}];due(w,r);assert.equal(r.status,'waiting');assert.equal(r.cargo,cargo);assert.equal(r.delivered,undefined);
 const restored=await makeGame({save:JSON.parse(JSON.stringify(w.generateSave()))});t.after(restored.close);const rw=restored.window,rr=records(rw).find(x=>x.id===r.id);assert.equal(rr.cargo,cargo);rw.planet.embargoes=[];finish(rw,rr);assert.equal(rr.delivered,cargo);
 const count=rw.regGet('town',a.id)._paultendoFoodMemory[b.id].received;next(rw);assert.equal(rr.delivered,cargo);assert.equal(rw.regGet('town',a.id)._paultendoFoodMemory[b.id].received,count);errors(g);errors(restored);
});

test('famine aid requires a real surplus and route, and cannot end a famine before food arrives',async t=>{
 const g=await makeGame();t.after(g.close);const {w,a,b}=pair(g,{outlook:'generous'});a.famine={started:2,ended:false};a.relations[b.id]=8;
 assert.equal(!!w.gameEvents.famineAid.value(a,b,{}),true);const before=b.resources.crop;w.gameEvents.famineAid.func(a,b);assert.equal(a.famine.ended,false);assert.equal(b.resources.crop,before);
 const r=records(w)[0];finish(w,r);assert.equal(r.status,'arrived');assert.equal(a.famine.ended,true);
 b.resources.crop=3;assert.equal(!!w.gameEvents.famineAid.value(a,b,{}),false);errors(g);
});

test('shared provision and insular faith produce different responses to the same need, while prior help can cross that boundary',async t=>{
 for(const stance of ['shared','insular','remembered']) {
  const g=await makeGame();t.after(g.close);const {w,a,b}=pair(g);religion(w,b,stance==='shared'?['egalitarian']:['egalitarian','insular']);
  if(stance==='remembered')b._paultendoFoodMemory={[a.id]:{given:0,received:10,traded:0,refused:0,lastHelpReceived:{day:2,kind:'aid',count:10,source:null}}};
  short(w,a);const r=records(w)[0];due(w,r);
  assert.equal(r.status,stance==='insular'?'refused':'carrying');assert.equal(r.reply.reason,stance==='shared'?'belief':stance==='remembered'?'remembered':'outsiders');
  assert.equal(r.reply.religion,b.religion);errors(g);
 }
});

test('mercantile belief favours a feasible exchange, without turning generosity into automatic payment demands',async t=>{
 for(const means of [0,120]) {
  const g=await makeGame();t.after(g.close);const {w,a,b}=pair(g,{currency:true,outlook:'generous'});religion(w,b,['trade']);a.resources.cash=means;
  short(w,a);const r=records(w)[0];due(w,r);assert.equal(r.kind,means?'trade':'aid');assert.equal(!!r.payment,!!means);errors(g);
 }
});

test('community values and actual survival reserves limit a generous speaker',async t=>{
 for(const circumstance of ['open','closed','short']) {
  const g=await makeGame();t.after(g.close);const {w,a,b}=pair(g,{outlook:circumstance==='open'?'guarded':'generous'});
  b.values={justice:6,openness:circumstance==='closed'?-6:6};short(w,a);const r=records(w)[0];if(circumstance==='short')b.resources.crop=1;
  due(w,r);assert.equal(r.status,circumstance==='open'?'carrying':'refused');assert.equal(r.reply.reason,circumstance==='open'?'shared':circumstance==='closed'?'outsiders':'stores');errors(g);
 }
});

test('pacifist belief restrains the coercive response to refused food',async t=>{
 const g=await makeGame();t.after(g.close);const {w,a,b}=pair(g);a.jobs={soldier:4};a.relations[b.id]=-3;b.relations[a.id]=-3;religion(w,a,['pacifism']);
 short(w,a,4);const r=records(w)[0];due(w,r);assert.equal(r.status,'refused');assert.equal(!!r.threat,false);assert.equal(r.cargo,0);errors(g);
});

test('food needs continue beyond the explored map without publishing undiscovered names',async t=>{
 const g=await makeGame();t.after(g.close);const {w,a,b}=pair(g,{outlook:'generous'});
 for(const c of w.filterChunks(c=>c.v.s===b.id))c._paultendoExplored=false;
 // The explored set, rather than the map's current opacity, defines known ground.
 const fog=w.planet._paultendoFog;assert.ok(fog);for(const c of w.filterChunks(c=>c.v.s===b.id))delete fog.explored[c.x+','+c.y];
 short(w,a);const r=records(w)[0];finish(w,r);assert.equal(r.status,'arrived');assert.ok(b._paultendoFoodMemory[a.id].given>0);
 const log=[...w.document.querySelectorAll('.logMessage')].find(e=>e.dataset.storyId===r.id);assert.ok(log);assert.doesNotMatch(log.querySelector('.logText').textContent,/Wick/);errors(g);
});

test('shipment quantities follow consumption and available stocks rather than a fixed allotment',async t=>{
 const sent=[];
 for(const population of [20,60]) {
  const g=await makeGame();t.after(g.close);const {w,a,b}=pair(g,{outlook:'generous'});a.pop=population;short(w,a);const r=records(w)[0];due(w,r);assert.equal(r.status,'carrying');sent.push(r.cargo);
  assert.ok(b.resources.crop>=2*Math.floor(b.pop*w.$c.baseEatRate));errors(g);
 }
 assert.ok(sent[1]>sent[0]);assert.ok(sent[1]>40,'The old forty-crop limit does not bound a larger actual need');
});

test('scarcer food costs more in otherwise comparable exchanges',async t=>{
 const quotes=[];
 for(const stock of [80,160]) {
  const g=await makeGame();t.after(g.close);const {w,a,b}=pair(g,{currency:true});a.resources.cash=1000;b.resources.crop=stock;short(w,a);const r=records(w)[0];due(w,r);assert.equal(r.kind,'trade');quotes.push(r.quote);errors(g);
 }
 assert.ok(quotes[0].spare<quotes[1].spare);assert.ok(quotes[0].unit>quotes[1].unit);
});

test('barter preserves an input committed to the buyer’s own construction',async t=>{
 const g=await makeGame();t.after(g.close);const {w,a,b}=pair(g);a.resources.lumber=20;
 w.happen('Create',a,null,{type:'project',subtype:'school',cost:80},'process');w.happen('Create',b,null,{type:'project',subtype:'school',cost:80},'process');
 short(w,a);const r=records(w)[0];due(w,r);assert.equal(r.status,'refused');assert.equal(r.cargo,0);assert.equal(r.payment,undefined);assert.equal(r.paid,undefined);errors(g);
});

test('existing economic aid and loans move real divisible cash on the current engine',async t=>{
 const g=await makeGame();t.after(g.close);const {w,a,b}=pair(g,{currency:true});a.resources.cash=1.25;b.resources.cash=100.75;
 w.gameEvents.townEconomicAid.func(null,b,{recipient:a,amount:20});assert.equal(a.resources.cash,21.25);assert.equal(b.resources.cash,80.75);
 w.planet.unlocks.trade=40;b.jobs.merchant=1;b.values={openness:6,justice:6};b.resources.cash=1000;
 const args={};assert.equal(w.gameEvents.townRequestLoan.value(null,a,args),false,'Aid has already filled the public reserve');
 a.resources.cash=0.25;assert.equal(w.gameEvents.townRequestLoan.value(null,a,args),true);const total=a.resources.cash+b.resources.cash,amount=args.amount;
 w.gameEvents.townRequestLoan.func(null,a,args);assert.equal(args.approved,true);assert.equal(a.resources.cash,0.25+amount);assert.equal(a.resources.cash+b.resources.cash,total);assert.equal(w.planet.loans.at(-1).originalAmount,amount);
 assert.ok(w.planet.loans.some(l=>l.lenderId===b.id&&l.borrowerId===a.id));errors(g);
});

test('a delayed aid or loan offer cannot create money after its donor loses the means',async t=>{
 const g=await makeGame();t.after(g.close);const {w,a,b}=pair(g,{currency:true});a.resources.cash=0;b.resources.cash=2.5;
 const aid={recipient:a,amount:20};w.gameEvents.townEconomicAid.func(null,b,aid);assert.equal(aid.amount,2.5);assert.equal(a.resources.cash,2.5);assert.equal(b.resources.cash,0);
 const args={lender:b,amount:30,repayment:36,turns:10};w.gameEvents.townRequestLoan.func(null,a,args);assert.equal(args.approved,false);assert.equal(a.resources.cash,2.5);assert.equal(w.planet.loans.length,0);errors(g);
});
