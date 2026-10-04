import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGame,settleGame} from './harness.mjs';
const plain=x=>JSON.parse(JSON.stringify(x));
const life=w=>w.planet._paultendoLife;
const panel=w=>w.document.getElementById('actionSubList');
function people(w,town){w.openRegBrowser(town,'town');[...w.document.querySelectorAll('.paultendoTownLife button')].find(b=>b.textContent==='Meet the people').click();for(const p of town._paultendoPeople)p.outlook='guarded';}
function quiet(w){for(const id of ['townFarm','townTame','townMine','townLumber','townBirth','townDeath','townExpand','townEmploy','townEat','townEconomyTick','townTax','doResearch','governmentHarmony','paultendoSynergyPulse','seasonalInfluences','warPressureDynamics','townLoanRepayment','debtDiplomacyEscalation']){if(w.gameEvents[id]?.func)w.gameEvents[id].func=()=>{};if(w.gameEvents[id]?.perChunk)w.gameEvents[id].perChunk=()=>{};}w.gameEvents.processAll.func=()=>{};w.chooseEvent=()=>null;}
function setup(g,{bank=true}={}) {
 const w=g.window,a=settleGame(g);w.planet.day=30;Object.assign(w.planet.unlocks,{farm:20,trade:bank?40:30,travel:20,government:10,military:10,education:10,smith:20});
 const center=w.planet.chunks[a.center.join(',')],at=w.filterChunks(c=>!c.v.s&&c.v.g===center.v.g&&c.b!=='water'&&c.b!=='mountain').sort((x,y)=>Math.hypot(x.x-center.x,x.y-center.y)-Math.hypot(y.x-center.x,y.y-center.y))[0];assert.ok(at);const b=w.happen('Create',null,null,{x:at.x,y:at.y},'town');
 for(const [town,name] of [[a,'Ashbank'],[b,'Wick']]){town.name=name;town.flag=town===a?'{{color:><|#f47759|#554aff}}':'{{color:W|#66ff88|#334466}}';town.pop=20;town.jobs={farmer:18,merchant:2};town.resources={crop:1000,cash:town===a?0.25:1000.75};town.values={justice:0,openness:0,order:0,wealth:0};town.research={trade:100};town._paultendoNextExchangeDay=99999;town.relations[(town===a?b:a).id]=0;people(w,town);w.happen('Explore',null,null,{x:town.center[0],y:town.center[1]});}
 const pay=w.gameEvents.townLoanRepayment.func,politics=w.gameEvents.debtDiplomacyEscalation.func;quiet(w);return {w,a,b,pay,politics};
}
function quote(w,a){const args={};assert.equal(w.gameEvents.townRequestLoan.value(null,a,args),true);return args;}
function lend(w,a){const args=quote(w,a);w.gameEvents.townRequestLoan.func(null,a,args);assert.equal(args.approved,true);return {loan:w.planet.loans.find(l=>l.id===args.loanId),args};}
function next(w,n=1){for(let i=0;i<n;i++)w.nextDay();}
function due(w,r){w.planet.day=Math.max(w.planet.day,r.due-1);next(w);}
function payDay(w,a,pay,loan,amount=0){next(w);a.resources.cash=amount;pay(null,a,{loans:[loan]});}
function roll(w,n,fn){const random=w.Math.random;w.Math.random=()=>n;try{return fn();}finally{w.Math.random=random;}}
function history(w,loan){return life(w).credit.find(r=>r.loan===loan.id);}
function errors(g){assert.deepEqual(g.errors,[]);}
function offeredGoods(g,{amount=0.25}={}) {const state=setup(g),{w,a,b,pay,politics}=state;a.resources.cash=amount;const {loan}=lend(w,a);a.resources.lumber=100;b.resources.lumber=0;const project=w.happen('Create',b,null,{type:'project',subtype:'school',cost:20},'process');for(let n=0;n<4;n++)payDay(w,a,pay,loan);roll(w,.6,()=>politics());const r=life(w).exchanges.find(r=>r.kind==='debt');assert.ok(r,JSON.stringify(history(w,loan)));return {...state,loan,r,project};}

// Cash and resources in these fixtures are controlled. Days, actual native
// projects, quotes, loan events, cargo movement and saved state run the game.
test('formal credit needs local Banking, a free merchant and an actual public cash shortfall',async t=>{
 const g=await makeGame();t.after(g.close);const {w,a,b}=setup(g,{bank:false});assert.equal(w.gameEvents.townRequestLoan.value(null,a,{}),false);
 w.planet.unlocks.trade=40;w.planet._paultendoLocalKnowledge={'trade:40':{key:'trade',level:40,before:30}};a._paultendoLocalDiscoveries={'trade:40':{day:30,inquiry:'own-bank'}};assert.equal(w.gameEvents.townRequestLoan.value(null,a,{}),false,'Another town’s banking is not Wick’s knowledge');
 b._paultendoLocalDiscoveries={'trade:40':{day:30,inquiry:'wick-bank'}};const q=quote(w,a);assert.ok(q.amount>0);assert.equal(q.loanOffer.knowledge,'wick-bank');
 b.jobs.merchant=0;assert.equal(w.gameEvents.townRequestLoan.value(null,a,{}),false);b.jobs.merchant=2;
 const person=b._paultendoPeople.find(p=>p.role==='merchant');life(w).inquiries.push({id:'busy',town:b.id,person:person.id,status:'working'});assert.equal(w.gameEvents.townRequestLoan.value(null,a,{}),false);life(w).inquiries.pop();
 a.resources.cash=1000;assert.equal(w.gameEvents.townRequestLoan.value(null,a,{}),false);assert.equal(w.planet.loans.length,0);errors(g);
});

test('lender values and remembered help change the terms, with actual spare coin constraining an offer',async t=>{
 const quotes=[];
 for(const stance of ['help','exchange','leverage','closed']){const g=await makeGame();t.after(g.close);const {w,a,b}=setup(g);
  if(stance==='help')b._paultendoExchangeMemory={[a.id]:{given:{},received:{lumber:4},traded:{},refused:0}};
  if(stance==='leverage')b.values={justice:-6,wealth:8,order:8};if(stance==='closed')b.values.openness=-6;
  const args={};assert.equal(w.gameEvents.townRequestLoan.value(null,a,args),stance!=='closed');if(stance==='closed')continue;
  quotes.push(args.loanOffer);assert.equal(args.loanOffer.motive.kind,stance);assert.ok(args.amount<=args.loanOffer.spare);assert.ok(args.turns>=8&&args.turns<=30);
  b.resources.cash=args.loanOffer.reserve+args.amount-0.01;assert.equal(w.gameEvents.townRequestLoan.value(null,a,{}),false);errors(g);
 }
 assert.equal(quotes[0].repayment,quotes[0].amount);assert.ok(quotes[1].repayment>quotes[1].amount);assert.ok(quotes[2].fee>quotes[1].fee);assert.ok(quotes[0].turns>quotes[1].turns);
});

test('shared provision and insular faith affect lending through the same outlook as actual goods',async t=>{
 for(const insular of [false,true]){const g=await makeGame();t.after(g.close);const {w,a,b}=setup(g);w.planet.religions=[{id:1,name:'Shared Table',members:[b.id],tenets:['egalitarian',...(insular?['insular']:[])],influences:{},extinct:false}];b.religion=1;b.influences.faith=8;
  const args={};assert.equal(w.gameEvents.townRequestLoan.value(null,a,args),!insular);if(!insular)assert.equal(args.loanOffer.motive.kind,'help');errors(g);
 }
});

test('a quoted loan conserves fractional cash, runs once and rechecks need, route and lender means before approval',async t=>{
 for(const change of ['none','paid','spent','border','belief']){const g=await makeGame();t.after(g.close);const {w,a,b}=setup(g),args=quote(w,a);
  if(change==='paid')a.resources.cash=1000;if(change==='spent')b.resources.cash=0;if(change==='border')w.planet.embargoes=[{fromId:b.id,toId:a.id}];if(change==='belief')b.values.openness=-6;
  const sum=a.resources.cash+b.resources.cash,old=a.resources.cash;w.gameEvents.townRequestLoan.func(null,a,args);assert.equal(args.approved,change==='none');assert.ok(Math.abs(a.resources.cash+b.resources.cash-sum)<1e-9);
  if(change==='none'){assert.equal(a.resources.cash,old+args.amount);const before=plain({cash:[a.resources.cash,b.resources.cash],loans:w.planet.loans,credit:life(w).credit});w.gameEvents.townRequestLoan.func(null,a,args);assert.deepEqual(plain({cash:[a.resources.cash,b.resources.cash],loans:w.planet.loans,credit:life(w).credit}),before);}else assert.equal(w.planet.loans.length,0);errors(g);
 }
});

test('ordinary, suggested and emergency loans use the same real quote and emergency cash does not repair a disaster',async t=>{
 for(const event of ['townRequestLoan','swayRequestLoan','disasterEmergencyLoan']){const g=await makeGame();t.after(g.close);const {w,a,b}=setup(g);
  if(event==='disasterEmergencyLoan'){const disaster=w.happen('Create',null,null,{type:'disaster',towns:[a.id]},'process');disaster.done=w.planet.day;disaster.deaths=22;a.disasterRecovery=40;}
  const args={};const subject=event==='disasterEmergencyLoan'?a:w.regGet('player',1),target=event==='disasterEmergencyLoan'?null:a;
  assert.equal(w.gameEvents[event].value(subject,target,args),true,event);const sum=a.resources.cash+b.resources.cash;roll(w,0,()=>w.gameEvents[event].func(subject,target,args));assert.equal(args.approved,true,event);assert.ok(Math.abs(a.resources.cash+b.resources.cash-sum)<1e-9);assert.equal(w.planet.loans[0].originalAmount,args.loanOffer.amount);if(event==='disasterEmergencyLoan')assert.equal(a.disasterRecovery,40);errors(g);
 }
});

test('partial coin pays the claim but leaves arrears, and payment processing cannot charge twice in one day',async t=>{
 const g=await makeGame();t.after(g.close);const {w,a,b,pay,politics}=setup(g),{loan}=lend(w,a),initial=loan.remainingAmount,bank=b.resources.cash;
 payDay(w,a,pay,loan,.25);assert.equal(loan.remainingAmount,initial-.25);assert.equal(b.resources.cash,bank+.25);assert.equal(loan.daysInArrears,1);assert.equal(history(w,loan).steps.at(-1).kind,'partial');const state=plain({loan,cash:[a.resources.cash,b.resources.cash],history:history(w,loan)});
 pay(null,a,{loans:[loan]});assert.deepEqual(plain({loan,cash:[a.resources.cash,b.resources.cash],history:history(w,loan)}),state);politics();assert.equal(history(w,loan).steps.some(s=>s.kind==='restructure'),false);
 payDay(w,a,pay,loan,.1);assert.equal(loan.daysInArrears,2);payDay(w,a,pay,loan,loan.paymentPerTurn);assert.equal(loan.daysInArrears,0);errors(g);
});

test('settled credit survives reload with linked coloured flags and reading the record consumes no time, stock or randomness',async t=>{
 const g=await makeGame();t.after(g.close);const {w,a,b,pay}=setup(g),{loan}=lend(w,a);const principal=loan.originalAmount;for(let n=0;n<35&&w.planet.loans.includes(loan);n++)payDay(w,a,pay,loan,loan.remainingAmount);
 assert.equal(w.planet.loans.includes(loan),false);const record=history(w,loan);assert.equal(record.status,'repaid');assert.ok(Math.abs(record.repaid-loan.repaymentAmount)<1e-8);assert.equal(record.terms.amount,principal);
 const restored=await makeGame({save:plain(w.generateSave())});t.after(restored.close);const rw=restored.window,copy=history(rw,loan);assert.equal(copy.status,'repaid');const log=rw.document.querySelector(`[data-story-id="${copy.id}"]`);assert.ok(log);assert.ok(log.querySelector('.font2'));assert.equal(log.querySelector('.font2').style.backgroundColor,'rgb(85, 74, 255)');
 const before=plain({day:rw.planet.day,life:life(rw),towns:rw.regToArray('town').map(t=>t.resources)});let draws=0;const random=rw.Math.random;rw.Math.random=()=>{draws++;return random();};log.querySelector('.paultendoChronicleStoryLink').click();assert.match(panel(rw).textContent,/debt is settled/i);rw.Math.random=random;assert.equal(draws,0);assert.deepEqual(plain({day:rw.planet.day,life:life(rw),towns:rw.regToArray('town').map(t=>t.resources)}),before);errors(g);errors(restored);
});

test('useful repayment goods leave actual stores, travel and reduce debt only when they arrive',async t=>{
 const g=await makeGame();t.after(g.close);const {w,a,b,loan,r}=offeredGoods(g),owed=loan.remainingAmount,sumCash=a.resources.cash+b.resources.cash;
 assert.equal(r.cargo,0);assert.equal(loan.remainingAmount,owed);assert.equal(a.resources.lumber,100);due(w,r);assert.equal(r.status,'carrying');const cargo=r.cargo;assert.ok(cargo>0);assert.equal(a.resources.lumber,100-cargo);assert.equal(b.resources.lumber,0);assert.equal(loan.remainingAmount,owed);
 due(w,r);assert.ok(r.delivered>0);assert.equal(loan.remainingAmount,owed-r.delivered*r.debt.unit);assert.equal(b.resources.lumber,r.delivered);assert.equal(loan.daysInArrears,0);assert.equal(a.resources.cash+b.resources.cash,sumCash);assert.equal(w.planet.embargoes.length,0);assert.equal(w.planet.tradeRoutes.length,0);assert.equal(a._paultendoFoodMemory?.[b.id]?.received || 0,0);assert.ok(b._paultendoCommodityLots.lumber.some(l=>l.exchange===r.id));
 const link=w.document.querySelector(`[data-story-id="${history(w,loan).id}"] .paultendoChronicleStoryLink`);assert.ok(link);link.click();assert.match(panel(w).textContent,/4 payments went unpaid/);assert.ok(panel(w).textContent.includes(`${r.delivered} timber arrived`));assert.equal([...panel(w).querySelectorAll('[role="button"]')].filter(b=>b.textContent==='Follow the repayment goods').length,1);errors(g);
});

test('blocked repayment goods survive reload without debt relief and take a journey after the road reopens',async t=>{
 const g=await makeGame();t.after(g.close);const {w,a,b,loan,r}=offeredGoods(g);due(w,r);const cargo=r.cargo,owed=loan.remainingAmount;w.planet.embargoes=[{fromId:b.id,toId:a.id}];due(w,r);assert.equal(r.status,'waiting');assert.equal(r.cargo,cargo);assert.equal(loan.remainingAmount,owed);
 const restored=await makeGame({save:plain(w.generateSave())});t.after(restored.close);const rw=restored.window;quiet(rw);const rr=life(rw).exchanges.find(x=>x.id===r.id),rl=rw.planet.loans.find(x=>x.id===loan.id);assert.equal(rr.cargo,cargo);rw.planet.embargoes=[];due(rw,rr);assert.equal(rr.cargo,cargo);assert.equal(rl.remainingAmount,owed);due(rw,rr);assert.ok(rr.delivered>0);assert.equal(rl.remainingAmount,owed-rr.delivered*rr.debt.unit);const balance=rl.remainingAmount;next(rw);assert.equal(rl.remainingAmount,balance);errors(g);errors(restored);
});

test('coin paid while repayment goods travel sends unused cargo home without gifting it to the lender',async t=>{
 const g=await makeGame();t.after(g.close);const {w,a,b,pay,loan,r}=offeredGoods(g);due(w,r);const cargo=r.cargo;for(let n=0;n<40&&w.planet.loans.includes(loan);n++){w.planet.day++;a.resources.cash=loan.remainingAmount;pay(null,a,{loans:[loan]});}
 assert.equal(w.planet.loans.includes(loan),false);due(w,r);assert.equal(r.debt.returning,true);assert.equal(r.cargo,cargo);assert.equal(b.resources.lumber,0);due(w,r);assert.equal(r.status,'returned');assert.equal(a.resources.lumber,100);assert.equal(b.resources.lumber,0);assert.equal(r.debt.credited,0);assert.equal(r.debt.returned,cargo);errors(g);
});

test('cancelled work and promised goods lost with a town cannot become repayment',async t=>{
 for(const change of ['cancel','lost','spent']){const g=await makeGame();t.after(g.close);const {w,a,b,loan,r,project}=offeredGoods(g),owed=loan.remainingAmount;
  if(change==='spent'){a.resources.lumber=0;due(w,r);assert.equal(r.status,'withdrawn');}else{due(w,r);if(change==='cancel'){w.happen('Finish',null,project);due(w,r);assert.equal(r.debt.returning,true);due(w,r);assert.equal(a.resources.lumber,100);}else{b.end=w.planet.day;due(w,r);assert.equal(r.status,'lost');assert.ok(r.lost.count>0);}}
  assert.equal(loan.remainingAmount,owed);assert.equal(history(w,loan).steps.some(s=>s.kind==='goods'),false);errors(g);
 }
});

test('four consecutive arrears can lead to more time, actual goods or forgiveness, without an invented trade concession',async t=>{
 for(const mode of ['restructure','forgive']){const g=await makeGame();t.after(g.close);const {w,a,b,pay,politics}=setup(g),{loan}=lend(w,a),cash=b.resources.cash;const before=loan.paymentPerTurn;
  if(mode==='forgive'){b.values={justice:8,openness:8};life(w).teachings.push({town:b.id,active:true,meaning:'care'});a.resources.crop=0;}
  for(let n=0;n<3;n++){payDay(w,a,pay,loan);politics();}assert.equal(history(w,loan).steps.some(s=>['restructure','forgiven'].includes(s.kind)),false);
  payDay(w,a,pay,loan);roll(w,mode==='forgive'?.999:0,()=>politics());if(mode==='forgive'){assert.equal(history(w,loan).status,'forgiven');assert.equal(w.planet.loans.length,0);}else{assert.ok(loan.paymentPerTurn<before);assert.equal(loan.daysInArrears,0);assert.ok(history(w,loan).steps.some(s=>s.kind==='restructure'));}
  assert.equal(b.resources.cash,cash);assert.equal(w.planet.embargoes.length,0);errors(g);
 }
});

test('enforcement needs an armed lender and sustained debt, while pacifist belief prevents a debt war',async t=>{
 for(const mode of ['armed','unarmed','pacifist']){const g=await makeGame();t.after(g.close);const {w,a,b,pay,politics}=setup(g),{loan}=lend(w,a);b.values={order:8,wealth:8,justice:-8};if(mode!=='unarmed')b.jobs.soldier=10;
  if(mode==='pacifist'){b.influences.faith=8;b.religion=1;w.planet.religions=[{id:1,name:'Quiet',members:[b.id],tenets:['pacifism'],influences:{},extinct:false}];}
  for(let n=0;n<4;n++)payDay(w,a,pay,loan);roll(w,.999,()=>politics());const war=w.regToArray('process').find(p=>p.type==='war'&&!p.done);assert.equal(!!war,mode==='armed',mode);if(war){assert.equal(war.cause.id,'debt_enforcement');assert.equal(war.cause.source,loan.id);}errors(g);
 }
});

test('completed exchange prompts six actual work days for Banking, spends timber and opens credit only where it was learned',async t=>{
 const g=await makeGame();t.after(g.close);const {w,a,b}=setup(g,{bank:false});a.resources.crop=0;a.resources.cash=500;b.resources.lumber=1;
 w.gameEvents.townMarketPurchase.func(a,null,{seller:b,goodsType:'crop'});const r=life(w).exchanges.find(r=>!r.resolved);assert.ok(r);due(w,r);due(w,r);assert.equal(r.status,'arrived');assert.ok(r.delivered>0);
 const caller=w.readyEvent('unlockBanking');assert.ok(caller);caller.args.value={town:b.id};assert.equal(w.gameEvents.unlockBanking.check(caller.subject,caller.target,caller.args),true);w.doEvent('unlockBanking',caller);
 const work=life(w).inquiries.at(-1);assert.equal(work.town,b.id);assert.equal(work.cause.evidence.exchanges[0],r.id);assert.equal(work.status,'waiting');assert.equal(w.gameEvents.townRequestLoan.value(null,a,{}),false);
 next(w);assert.equal(work.status,'working');assert.equal(b.resources.lumber || 0,0);assert.equal(w.planet.unlocks.trade,30);next(w,4);assert.equal(work.status,'working');next(w,2);assert.equal(work.status,'learned');assert.equal(w.planet.unlocks.trade,40);assert.equal(b._paultendoLocalDiscoveries['trade:40'].inquiry,work.id);assert.equal(a._paultendoLocalDiscoveries?.['trade:40'],undefined);
 a.resources.cash=.25;const args=quote(w,a);assert.equal(args.lender.id,b.id);assert.equal(args.loanOffer.knowledge,work.id);w.gameEvents.townRequestLoan.func(null,a,args);const loan=w.planet.loans.at(-1);const log=w.document.querySelector(`[data-story-id="${history(w,loan).id}"] .paultendoChronicleStoryLink`);assert.ok(log);log.click();const link=[...panel(w).querySelectorAll('[role="button"]')].find(b=>b.textContent==='The banker’s earlier work');assert.ok(link);link.click();assert.match(panel(w).textContent,/Goods have changed hands/);assert.match(panel(w).textContent,/exchange that raised the question/);errors(g);
});

test('real credit finances a quoted timber shortage and construction consumes the delivered supplies, with no instant building or recovery reward',async t=>{
 const g=await makeGame();t.after(g.close);const {w,a,b}=setup(g),project=w.happen('Create',a,null,{type:'project',subtype:'school',cost:20},'process');b.resources.lumber=40;
 const seek=()=>{w.gameEvents.townMarketPurchase.func(a,null,{seller:b,goodsType:'lumber'});return life(w).exchanges.find(r=>r.buyer===a.id&&!r.resolved);};
 const refused=seek();due(w,refused);assert.equal(refused.status,'refused');assert.ok(refused.quote.total>0);const args=quote(w,a);assert.equal(args.loanOffer.need.market.id,refused.id);assert.ok(args.amount>=refused.quote.total);w.gameEvents.townRequestLoan.func(null,a,args);assert.equal(a.resources.lumber || 0,0);assert.equal(project.cost,20);assert.equal(project.done,undefined);
 const paid=seek();due(w,paid);assert.equal(paid.kind,'trade');assert.equal(paid.cargo,20);assert.equal(a.resources.lumber || 0,0);due(w,paid);assert.equal(paid.status,'arrived');assert.equal(a.resources.lumber,20);
 for(let n=0;n<30&&!project.done;n++){w.planet.day++;w.metaEvents.processProject.func(project);}assert.ok(project.done);assert.equal(a.resources.lumber || 0,0);assert.equal(paid.uses.find(u=>u.kind==='construction').count,20);assert.equal(history(w,w.planet.loans.at(-1)).terms.need.market.id,refused.id);errors(g);
});

test('a vanished quoted purchase invalidates the loan even if another new project is just as expensive',async t=>{
 const g=await makeGame();t.after(g.close);const {w,a,b}=setup(g);b.resources.lumber=80;const project=w.happen('Create',a,null,{type:'project',subtype:'school',cost:20},'process');w.gameEvents.townMarketPurchase.func(a,null,{seller:b,goodsType:'lumber'});const r=life(w).exchanges.at(-1);due(w,r);const args=quote(w,a);assert.equal(args.loanOffer.need.market.id,r.id);
 w.happen('Finish',null,project);w.happen('Create',a,null,{type:'project',subtype:'temple',cost:80},'process');const cash=a.resources.cash+b.resources.cash;w.gameEvents.townRequestLoan.func(null,a,args);assert.equal(args.approved,false);assert.equal(w.planet.loans.length,0);assert.equal(a.resources.cash+b.resources.cash,cash);errors(g);
});

test('goods repayment preserves the debtor’s own construction materials and surplus does not become a gift when the claim shrinks',async t=>{
 const g=await makeGame();t.after(g.close);const {w,a,b,pay,loan,r}=offeredGoods(g);w.happen('Create',a,null,{type:'project',subtype:'school',cost:100},'process');due(w,r);assert.equal(r.status,'withdrawn');assert.equal(a.resources.lumber,100);assert.equal(r.debt.credited,0);assert.equal(history(w,loan).steps.some(s=>s.kind==='goods'),false);errors(g);
 const other=await makeGame();t.after(other.close);const {w:rw,a:ra,b:rb,pay:rp,loan:rl,r:rr}=offeredGoods(other);due(rw,rr);const cargo=rr.cargo;rw.planet.day++;ra.resources.cash=rr.debt.unit;rp(null,ra,{loans:[rl]});const owed=rl.remainingAmount;due(rw,rr);assert.ok(rr.delivered<cargo);assert.equal(rl.remainingAmount,owed-rr.delivered*rr.debt.unit);assert.equal(rr.debt.returning,true);due(rw,rr);assert.equal(ra.resources.lumber+rb.resources.lumber,100);assert.equal(rr.debt.returned,cargo-rr.delivered);assert.ok(rl.remainingAmount>0&&rl.remainingAmount<rr.debt.unit);errors(other);
});

test('all actual loans owed by a town receive a daily payment once, and lost towns retire claims without invented repayment',async t=>{
 const g=await makeGame();t.after(g.close);const {w,a,b,pay}=setup(g),{loan:first}=lend(w,a);a.resources.cash=0;const {loan:second}=lend(w,a);assert.notEqual(first.id,second.id);assert.equal(w.planet.loans.length,2);assert.equal(w.gameEvents.townRequestLoan.value(null,a,{}),false);
 next(w);a.resources.cash=1000;const total=a.resources.cash+b.resources.cash;pay(null,a,{loans:[first,second]});assert.equal(history(w,first).steps.at(-1).kind,'payment');assert.equal(history(w,second).steps.at(-1).kind,'payment');assert.ok(Math.abs(a.resources.cash+b.resources.cash-total)<1e-9);
 next(w);b.end=w.planet.day;const cash=a.resources.cash;pay(null,a,{loans:[first,second]});assert.equal(w.planet.loans.length,0);assert.equal(history(w,first).status,'cancelled');assert.equal(a.resources.cash,cash);errors(g);
});
