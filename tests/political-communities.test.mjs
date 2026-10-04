import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGame,settleGame} from './harness.mjs';
const plain=x=>JSON.parse(JSON.stringify(x));
const state=w=>w.planet._paultendoPolitics;
function tick(w,n=1){for(let i=0;i<n;i++){w.planet.day++;w.gameEvents.townCouncilDeliberation.func();}}
function panel(w){return w.document.getElementById('actionSubList');}
function click(w,text){const b=[...panel(w).querySelectorAll('[role="button"]')].find(b=>b.textContent===text);assert.ok(b,`Missing ${text}: ${panel(w).textContent}`);b.click();}
function council(w,town){w.openRegBrowser(town,'town');const b=[...w.document.querySelectorAll('.paultendoTownLife button')].find(b=>b.textContent==='Council');assert.ok(b);b.click();}
async function setup(t,{third=false}={}){
 const g=await makeGame();t.after(g.close);const w=g.window,a=settleGame(g);w.planet.day=12;
 Object.assign(w.planet.unlocks,{government:50,trade:30,travel:30,education:30});
 const anchor=w.chunkAt(...a.center),cells=w.filterChunks(c=>!c.v.s&&c.v.g===anchor.v.g&&c.b!=='water'&&c.b!=='mountain').sort((x,y)=>Math.hypot(x.x-anchor.x,x.y-anchor.y)-Math.hypot(y.x-anchor.x,y.y-anchor.y));
 const b=w.happen('Create',null,null,{x:cells[0].x,y:cells[0].y},'town');
 const c=third?w.happen('Create',null,null,{x:cells.find(p=>!p.v.s).x,y:cells.find(p=>!p.v.s).y},'town'):null;
 for(const [town,name] of [[a,'Ashbank'],[b,'Wick'],...(c?[[c,'Stonebridge']]:[])]){
  Object.assign(town,{name,pop:30,jobs:{merchant:12,farmer:12,scholar:6},resources:{crop:1000,cash:100},wealth:300,tax:.1,unrest:0,values:{justice:8,openness:8,order:0,wealth:0}});
  w.planet._paultendoFog.explored[town.center.join(',')]=true;w.planet._paultendoFog.visible[town.center.join(',')]=1;
 }
 for(const x of [a,b,c].filter(Boolean))for(const y of [a,b,c].filter(Boolean))if(x!==y)w.happen('AddRelation',x,y,{amount:8});
 return {g,w,a,b,c};
}
function propose(w,a,b,form='Federation'){council(w,a);click(w,'Talk with '+b.name);click(w,form);return state(w).proposals.at(-1);}
function ratify(w,p){w.planet.day=p.due-1;tick(w);return state(w).groups.find(g=>g.id===p.created);}
function trade(w,a,b,n=6){for(let i=0;i<n;i++)(w.planet._paultendoLife.exchanges ||= []).push({id:'prior-'+i,kind:'trade',buyer:a.id,seller:b.id,type:'crop',delivered:60,arrived:w.planet.day-i,resolved:true,status:'arrived'});}
function clean(g){assert.deepEqual(g.errors,[]);}

test('council reading neither advances the simulation nor generates people or consumes randomness',async t=>{
 const {g,w,a}=await setup(t);const before=plain({day:w.planet.day,people:a._paultendoPeople,resources:a.resources,politics:w.planet._paultendoPolitics});let draws=0;const random=w.Math.random;w.Math.random=()=>{draws++;return random();};council(w,a);w.Math.random=random;assert.equal(draws,0);assert.deepEqual(plain({day:w.planet.day,people:a._paultendoPeople,resources:a.resources,politics:w.planet._paultendoPolitics}),before);clean(g);
});

test('shared government requires each town’s consent and preserves its population, knowledge and treasury',async t=>{
 const {g,w,a,b}=await setup(t);const stocks=plain([a.resources,b.resources]),pop=a.pop+b.pop,knowledge=plain(w.planet.unlocks);
 const p=propose(w,a,b),group=ratify(w,p);assert.equal(p.status,'agreed');assert.ok(group);assert.equal(group.form,'federation');assert.equal(group.members.length,2);assert.equal(a.pop+b.pop,pop);assert.deepEqual(plain(w.planet.unlocks),knowledge);assert.ok(a.resources.cash+b.resources.cash+group.treasury<=stocks[0].cash+stocks[1].cash+1e-9);assert.equal(a.resources.crop+b.resources.crop,2000);assert.ok(Object.keys(p.votes).length===2);clean(g);
});

test('opposition can reject even a player-backed agreement and occupations disagree about it',async t=>{
 const {g,w,a,b}=await setup(t);b.values={justice:-8,openness:-8,order:8};b.jobs={priest:30};a.relations[b.id]=b.relations[a.id]=-12;
 const p=propose(w,a,b);click(w,'Speak for the agreement');ratify(w,p);assert.equal(p.status,'refused');assert.equal(state(w).groups.length,0);assert.ok(p.votes[b.id].support<p.votes[a.id].support);assert.equal(p.advocacy[a.id],.12);clean(g);
});

test('a market and defence treaty can coexist while a second sovereign government is refused',async t=>{
 const {g,w,a,b}=await setup(t);trade(w,a,b);let p=propose(w,a,b,'Common market');const market=ratify(w,p);assert.ok(market);a.values.order=b.values.order=6;p=propose(w,a,b,'Defence pact');const pact=ratify(w,p);assert.ok(pact);assert.notEqual(market.id,pact.id);assert.equal(state(w).groups.filter(g=>!g.ended).length,2);clean(g);
});

test('completed food exchanges cause sustained talks, while merely possessing goods does not',async t=>{
 const {g,w,a,b}=await setup(t);tick(w,12);assert.equal(state(w).proposals.length,0);trade(w,a,b);tick(w,12);const p=state(w).proposals.find(p=>p.form==='market');assert.ok(p);assert.ok(p.day>12);clean(g);
});

test('shared treasury contributions are real, conserve cash, and cannot be collected twice in one day',async t=>{
 const {g,w,a,b}=await setup(t);const group=ratify(w,propose(w,a,b));const total=a.resources.cash+b.resources.cash+group.treasury;const before=group.treasury;
 tick(w,10);assert.ok(group.treasury>before);assert.ok(Math.abs(a.resources.cash+b.resources.cash+group.treasury-total)<1e-8);const held=plain([a.resources,b.resources,group]);w.gameEvents.townCouncilDeliberation.func();assert.deepEqual(plain([a.resources,b.resources,group]),held);clean(g);
});

test('common funds help actual hungry members without generating food or money',async t=>{
 const {g,w,a,b}=await setup(t);const group=ratify(w,propose(w,a,b));a.resources.crop=0;const total=a.resources.cash+b.resources.cash+group.treasury;tick(w,10);assert.ok(group.accounts[a.id].received>0);assert.equal(a.resources.crop,0);assert.ok(Math.abs(a.resources.cash+b.resources.cash+group.treasury-total)<1e-8);clean(g);
});

test('a council can pass binding rights, with a recorded vote and no global law change',async t=>{
 const {g,w,a,b,c}=await setup(t,{third:true});const group=ratify(w,propose(w,a,b));a.legal['happy.speech']=b.legal['happy.speech']=false;c.legal['happy.speech']=false;
 council(w,a);click(w,group.name);click(w,'Protect the right to speak');const p=state(w).proposals.at(-1);w.planet.day=p.due-1;tick(w);assert.equal(p.status,'agreed');assert.equal(a.legal['happy.speech'],true);assert.equal(b.legal['happy.speech'],true);assert.equal(c.legal['happy.speech'],false);clean(g);
});

test('a member leaving retains its town and receives only its share of the remaining common purse',async t=>{
 const {g,w,a,b}=await setup(t);const group=ratify(w,propose(w,a,b));const total=a.resources.cash+b.resources.cash+group.treasury;
 a.values={justice:-10,openness:-10,order:10};a.tax=.6;a.unrest=95;a.legal['happy.speech']=false;a.relations[b.id]=b.relations[a.id]=-25;tick(w,65);assert.ok(group.ended);assert.equal(group.treasury,0);assert.equal(a.pop,30);assert.equal(b.pop,30);assert.ok(Math.abs(a.resources.cash+b.resources.cash-total)<1e-7);assert.ok(state(w).movements.some(m=>m.kind==='exit'&&m.status==='independent'));clean(g);
});

test('tax and rights pressure produces worker associations and real strikes, and wages transfer existing cash',async t=>{
 const {g,w,a}=await setup(t);a.values={justice:-8,order:8};a.jobs={miner:20,farmer:10};a.resources.crop=0;a.wealth=0;a.tax=.8;a.unrest=90;a.legal['happy.speech']=false;tick(w,25);
 const u=state(w).unions.find(u=>u.town===a.id&&u.role==='miner');assert.ok(u.strike);const total=a.resources.cash+a.wealth;
 council(w,a);click(w,u.name+' · On strike');click(w,'Pay the workers from the town purse');assert.ok(u.history.some(e=>e.kind==='paid'));assert.ok(Math.abs(a.resources.cash+a.wealth-total)<1e-8);assert.ok(a.wealth>0);clean(g);
});

test('rights and improved supplies calm a movement rather than firing a scheduled split regardless',async t=>{
 const {g,w,a}=await setup(t);a._paultendoColony={originWorldId:w.planet._paultendoWorldId,originTownId:2,day:1};a.values.justice=8;a.unrest=90;a.tax=.8;a.legal['happy.speech']=false;tick(w,5);
 // Worker concerns have begun, but relief before sustained support prevents a strike.
 a.resources.crop=1000;a.tax=0;a.unrest=0;a.legal['happy.speech']=true;tick(w,30);assert.ok(state(w).unions.every(u=>!u.strike));clean(g);
});

test('debate, votes, common money and strikes survive save and reload',async t=>{
 const {g,w,a,b}=await setup(t);const p=propose(w,a,b);tick(w,3);const snapshot=plain(state(w));const copy=await makeGame({save:plain(w.generateSave())});t.after(copy.close);assert.deepEqual(plain(state(copy.window)),snapshot);const rw=copy.window;rw.planet.day=p.due-1;tick(rw);assert.equal(state(rw).proposals[0].status,'agreed');assert.ok(state(rw).groups.length);clean(g);clean(copy);
});

test('feudal obligations attach to real land, allow nested oaths, and never take double tribute',async t=>{
 const {g,w,a,b}=await setup(t);a.values=b.values={justice:-8,order:8,openness:0};const group=ratify(w,propose(w,a,b,'Feudal compact'));assert.ok(group);
 const rel=w.planet._paultendoVassals.find(r=>r.subjectId===b.id);assert.ok(rel);assert.equal(rel.overlordId,a.id);assert.equal(rel.terms.compact,group.id);assert.ok(rel.terms.land.length);assert.ok(rel.terms.land.every(k=>w.planet.chunks[k].v.s===b.id));
 const before=plain([a.resources,b.resources]);w.planet.day+=30;w.gameEvents.vassalTributeCycle.func();assert.deepEqual(plain([a.resources,b.resources]),before);clean(g);
});

test('sustained colonial discontent wins independence without requiring a fixed world age',async t=>{
 const {g,w,a,b}=await setup(t);b._paultendoColony={originWorldId:w._paultendoUniverse.currentWorldId,originTownId:a.id,day:1,autonomy:.8};b.unrest=95;b.tax=.8;b.legal['happy.speech']=false;b.values.justice=-8;
 tick(w,55);assert.ok(b._paultendoColony.sovereign);assert.equal(b.pop,30);const m=state(w).movements.find(m=>m.town===b.id&&m.kind==='independence');assert.equal(m.status,'independent');assert.equal(m.peaceful,true);assert.ok(w.planet.day<160);clean(g);
});

test('a resentful vassal can leave its compact, and independence stops all later compact taxation',async t=>{
 const {g,w,a,b}=await setup(t);a.values=b.values={justice:-8,order:8};const group=ratify(w,propose(w,a,b,'Feudal compact'));a.values={justice:8,order:0};
 const rel=w.planet._paultendoVassals.find(r=>r.subjectId===b.id);rel.resentment=9;rel.autonomy=.9;b.tax=.8;b.unrest=95;b.legal['happy.speech']=false;
 tick(w,60);assert.ok(!w.planet._paultendoVassals.some(r=>r.subjectId===b.id));assert.ok(!group.members.includes(b.id));assert.ok(state(w).movements.some(m=>m.town===b.id&&m.kind==='independence'&&m.status==='independent'));const paid=group.accounts[b.id].paid;tick(w,15);assert.equal(group.accounts[b.id].paid,paid);clean(g);
});

test('regional self-determination transfers contiguous land, existing people, resources and local knowledge',async t=>{
 const {g,w,a}=await setup(t);const center=w.chunkAt(...a.center);const territory=w.floodFill(center.x,center.y,c=>c.b!=='water'&&c.b!=='mountain'&&(!c.v.s||c.v.s===a.id),35);assert.ok(territory.length>=20);
 for(const c of territory)c.v.s=a.id;a.size=territory.length;a.pop=100;a.jobs={farmer:70,miner:30};a.wealth=1000;a.resources={crop:1000,cash:100,rock:100};a.values={justice:8,openness:0};a.tax=.8;a.unrest=95;a.legal['happy.rights']=false;
 a._paultendoLocalDiscoveries={'smith:70':{day:3,inquiry:'known-here'}};const total=()=>w.regToArray('town').reduce((s,t)=>({pop:s.pop+t.pop,cash:s.cash+(t.resources.cash||0)+(t.wealth||0),crop:s.crop+(t.resources.crop||0),rock:s.rock+(t.resources.rock||0),land:s.land+t.size}),{pop:0,cash:0,crop:0,rock:0,land:0});const before=total();
 tick(w,60);const m=state(w).movements.find(m=>m.town===a.id&&m.kind==='regional');assert.ok(m?.child,JSON.stringify(m));const child=w.regGet('town',m.child);assert.equal(child.former,a.id);assert.deepEqual(plain(child._paultendoLocalDiscoveries),plain(a._paultendoLocalDiscoveries));const after=total();for(const k of ['pop','cash','crop','rock','land'])assert.ok(Math.abs(before[k]-after[k])<1e-6,k+' '+JSON.stringify({before,after}));assert.ok(child.pop>0);assert.ok(m.chunks.every(k=>w.planet.chunks[k].v.s===child.id));clean(g);
});

test('actual doctrinal disagreement produces a schism, while a contented follower stays in the old faith',async t=>{
 const {g,w,a,b,c}=await setup(t,{third:true});const faith={id:1,name:'Old Rite',foundingTown:a.id,founded:1,tenets:['hierarchical'],tenetNames:['Hierarchical'],influences:{crime:-.3},followers:[a.id,b.id,c.id],cohesion:60,extinct:false};w.planet.religions=[faith];for(const town of [a,b,c])town.religion=1;
 a.values.justice=c.values.justice=-8;b.values.justice=10;b.legal['happy.speech']=false;b.legal['happy.rights']=false;b.legal['education.religion']=false;b.relations[a.id]=a.relations[b.id]=-20;
 tick(w,70);const branch=w.planet.religions.find(r=>r.id!==1);assert.ok(branch);assert.equal(branch.parent,1);assert.equal(b.religion,branch.id);assert.equal(c.religion,1);assert.ok(branch.tenets.includes('egalitarian'));assert.ok(!branch.tenets.includes('hierarchical'));assert.ok(!b.issues.war);assert.equal(state(w).groups.length,0);clean(g);
});

test('repression has a remembered cost, and repeatedly clicking it cannot farm unrest or momentum',async t=>{
 const {g,w,a,b}=await setup(t);b._paultendoColony={originWorldId:w._paultendoUniverse.currentWorldId,originTownId:a.id,day:1,autonomy:.6};b.unrest=80;b.tax=.8;b.legal['happy.speech']=false;tick(w,12);const m=state(w).movements.find(m=>m.town===b.id&&m.kind==='independence');assert.ok(m);
 council(w,b);click(w,'Calls for independence');click(w,'Send guards to silence them');assert.equal(m.repression,.2);const held=b.unrest;click(w,'Send guards to silence them');assert.equal(m.repression,.2);assert.equal(b.unrest,held);clean(g);
});

test('a strike stops actual mining, and improved conditions let the same workers resume',async t=>{
 const {g,w,a}=await setup(t);a.jobs={miner:30};a.values={justice:-8};a.resources.crop=0;a.wealth=0;a.tax=.8;a.unrest=90;a.legal['happy.speech']=false;tick(w,25);const union=state(w).unions.find(u=>u.town===a.id&&u.role==='miner');assert.ok(union.strike);
 const chunk=w.chunkAt(...a.center);chunk.b='mountain';const held=a.resources.rock || 0;const random=w.Math.random;w.Math.random=()=>0;w.gameEvents.townMine.perChunk(a,null,chunk);w.Math.random=random;assert.equal(a.resources.rock || 0,held);
 a.tax=0;a.unrest=0;a.resources.crop=1000;a.wealth=300;a.legal['happy.speech']=true;tick(w,25);assert.equal(!!union.strike,false);w.Math.random=()=>0;w.gameEvents.townMine.perChunk(a,null,chunk);w.Math.random=random;assert.ok(a.resources.rock>held);clean(g);
});

test('legacy alliances become tax-free pacts without rewriting their membership or history',async t=>{
 const {g,w,a,b}=await setup(t);w.planet.alliances=[{id:77,name:'Old Alliance',members:[a.id,b.id],formed:3,cohesion:60}];const before=plain([a.resources,b.resources]);tick(w);const group=state(w).groups.find(g=>g.sourceAlliance===77);assert.ok(group);assert.equal(group.founded,3);assert.equal(group.terms.rate,0);assert.deepEqual(plain(group.members),[a.id,b.id]);assert.deepEqual(plain([a.resources,b.resources]),before);clean(g);
});

test('collective embargoes require a council mandate and block actual commodity requests',async t=>{
 const {g,w,a,b,c}=await setup(t,{third:true});trade(w,a,b);const group=ratify(w,propose(w,a,b,'Common market'));assert.ok(group);
 council(w,a);click(w,group.name);click(w,'Call for an embargo on '+c.name);assert.match(panel(w).textContent,/will not back/);assert.equal(group.sanctions.length,0);
 a.relations[c.id]=b.relations[c.id]=c.relations[a.id]=c.relations[b.id]=-20;c.resources.lumber=50;
 council(w,a);click(w,group.name);click(w,'Call for an embargo on '+c.name);assert.match(panel(w).textContent,/backs the embargo/);assert.equal(group.sanctions.length,1);
 const before=(w.planet._paultendoLife.exchanges || []).length;w.gameEvents.townMarketPurchase.func(a,null,{seller:c,goodsType:'lumber'});assert.equal(w.planet._paultendoLife.exchanges.length,before);clean(g);
});

test('amending a market into a government cannot overwrite membership in a different federation',async t=>{
 const {g,w,a,b,c}=await setup(t,{third:true});trade(w,a,b);const market=ratify(w,propose(w,a,b,'Common market'));assert.ok(market);const federation=ratify(w,propose(w,a,c));assert.ok(federation);
 council(w,a);click(w,market.name);click(w,'Discuss a federation');const p=state(w).proposals.at(-1);ratify(w,p);assert.equal(p.status,'withdrawn');assert.equal(market.form,'market');assert.equal(federation.form,'federation');clean(g);
});

test('a defence obligation brings existing, fed soldiers into an actual defensive war',async t=>{
 const {g,w,a,b,c}=await setup(t,{third:true});a.values.order=b.values.order=8;const group=ratify(w,propose(w,a,b,'Defence pact'));assert.ok(group);b.jobs={soldier:20,farmer:10};
 const war=w.happen('Create',c,null,{type:'war',towns:[c.id,a.id]},'process');war.sides=[[c.id],[a.id]];war.initiator=c.id;war.defender=a.id;war.cause={subjectId:c.id,targetId:a.id};a.issues.war=c.issues.war=war.id;
 const population=b.pop,soldiers=b.jobs.soldier;tick(w);assert.ok(war.towns.includes(b.id));assert.equal(b.issues.war,war.id);assert.equal(b.pop,population);assert.equal(b.jobs.soldier,soldiers);assert.ok(group.history.some(h=>h.kind==='defense'&&h.war===war.id));clean(g);
});

test('a hungry member cannot conjure soldiers to fulfil a defence promise',async t=>{
 const {g,w,a,b,c}=await setup(t,{third:true});a.values.order=b.values.order=8;const group=ratify(w,propose(w,a,b,'Defence pact'));b.jobs={soldier:20,farmer:10};b.resources.crop=0;
 const war=w.happen('Create',c,null,{type:'war',towns:[c.id,a.id]},'process');war.sides=[[c.id],[a.id]];war.initiator=c.id;war.defender=a.id;a.issues.war=c.issues.war=war.id;tick(w);assert.ok(!war.towns.includes(b.id));assert.equal(b.resources.crop,0);assert.ok(a._paultendoPoliticalMemory[b.id].grievance>0);assert.ok(group);clean(g);
});

test('a voluntary shared crown has real common authority without changing every town’s government',async t=>{
 const {g,w,a,b}=await setup(t);a.values=b.values={justice:-8,order:8};a.gov='monarchy';b.gov='republic';const group=ratify(w,propose(w,a,b,'Shared crown'));assert.ok(group);assert.equal(group.form,'crown');assert.equal(group.terms.law,true);assert.equal(a.gov,'monarchy');assert.equal(b.gov,'republic');clean(g);
});

test('nested feudal oaths cannot close a cycle back onto their original lord',async t=>{
 const {g,w,a,b,c}=await setup(t,{third:true});for(const x of [a,b,c])x.values={justice:-8,order:8};const outer=ratify(w,propose(w,a,b,'Feudal compact'));assert.ok(outer);const inner=ratify(w,propose(w,b,c,'Feudal compact'));assert.ok(inner);assert.ok(w.planet._paultendoVassals.some(r=>r.overlordId===b.id&&r.subjectId===c.id));
 const p=propose(w,c,a,'Feudal compact'),loop=ratify(w,p);assert.equal(loop,undefined);assert.equal(p.status,'withdrawn');assert.ok(!w.planet._paultendoVassals.some(r=>r.overlordId===c.id&&r.subjectId===a.id));clean(g);
});

test('successful customs collection transfers existing cash, exempts internal trade and records the shipment',async t=>{
 const {g,w,a,b,c}=await setup(t,{third:true});trade(w,a,b);const group=ratify(w,propose(w,a,b,'Common market'));group.terms.customs=.1;a.resources.crop=1000;c.resources.crop=0;c.jobs={merchant:30};c.values={justice:0,openness:0};c.resources.cash=1000;a.values={justice:-10,openness:4,wealth:10};a.influences.faith=0;a.relations[c.id]=c.relations[a.id]=2;w.openRegBrowser(a,'town');[...w.document.querySelectorAll('.paultendoTownLife button')].find(b=>b.textContent==='Meet the people').click();for(const p of a._paultendoPeople)p.outlook='guarded';
 for(const id of ['townFarm','townMine','townLumber','townEat','townBirth','townDeath','townPay','townTax','townEconomyTick','townExpand','townEmploy'])w.gameEvents[id].func=()=>{};
 w.gameEvents.processAll.func=()=>{};w.gameEvents.townMarketPurchase.func(c,null,{seller:a,goodsType:'crop'});const record=w.planet._paultendoLife.exchanges.at(-1);assert.ok(record);const choose=w.chooseEvent;w.chooseEvent=()=>null;
 try{for(let i=0;i<35&&!record.resolved;i++)w.nextDay();}finally{w.chooseEvent=choose;}
 assert.equal(record.status,'arrived');assert.equal(record.kind,'trade');assert.ok(record.customs?.paid>0);assert.equal(record.customs.group,group.id);assert.ok(group.history.some(e=>e.kind==='customs'&&e.exchange===record.id));assert.ok(group.members.includes(a.id));clean(g);
});

test('outcomes and historical talks remain readable without repeated action buttons',async t=>{
 const {g,w,a,b}=await setup(t);const p=propose(w,a,b),group=ratify(w,p);assert.ok(group);const before=plain(state(w));council(w,a);click(w,'Past gatherings');click(w,'Day '+p.resolved+' · Federation');assert.match(panel(w).textContent,/reached an agreement/);assert.ok(![...panel(w).querySelectorAll('[role="button"]')].some(b=>b.textContent==='Speak for the agreement'));assert.deepEqual(plain(state(w)),before);clean(g);
});

test('day refresh shows the council outcome without replaying advocacy or other political actions',async t=>{
 const {g,w,a,b}=await setup(t);const p=propose(w,a,b);click(w,'Speak for the agreement');const count=p.history.length;w.refreshExecutive();assert.equal(p.history.length,count);assert.equal(p.advocacy[a.id],.12);
 ratify(w,p);w.refreshExecutive();assert.match(panel(w).textContent,/reached an agreement/);assert.ok(![...panel(w).querySelectorAll('[role="button"]')].some(b=>b.textContent==='Speak against the agreement'));clean(g);
});

test('political Chronicle links remain actionable after a reload and lead to the actual stored talks',async t=>{
 const {g,w,a,b}=await setup(t);const p=propose(w,a,b);const restored=await makeGame({save:plain(w.generateSave())});t.after(restored.close);const rw=restored.window,entry=[...rw.document.querySelectorAll('.logMessage')].find(e=>e.dataset.storyKind==='politics'&&e.dataset.storyId===p.id);assert.ok(entry);const link=entry.querySelector('.paultendoChronicleStoryLink');assert.ok(link);link.click();assert.match(panel(rw).textContent,/Federation/);assert.match(panel(rw).textContent,/towns will decide/);clean(g);clean(restored);
});


test('trade in other towns cannot inspire an isolated town’s religious debate',async t=>{
 const {g,w,a,b,c}=await setup(t,{third:true});
 const faith={id:1,name:'Closed Rite',foundingTown:c.id,founded:1,tenets:['insular'],tenetNames:['Insular'],influences:{},followers:[c.id],cohesion:60,extinct:false};
 w.planet.religions=[faith];c.religion=1;c.values.justice=0;c.legal['happy.speech']=c.legal['happy.rights']=c.legal['education.religion']=false;
 trade(w,a,b);tick(w,12);assert.ok(!state(w).movements.some(m=>m.town===c.id&&m.kind==='faith'));
 trade(w,a,c);tick(w,12);const movement=state(w).movements.find(m=>m.town===c.id&&m.kind==='faith');assert.ok(movement);assert.ok(movement.reasons.includes('traders learning from outsiders'));assert.equal(movement.doctrine,'trade');clean(g);
});

test('council proposals state the actual obligations, closing day and law instead of an indistinguishable agreement',async t=>{
 const {g,w,a,b}=await setup(t);const p=propose(w,a,b);assert.match(panel(w).textContent,/5% of town cash is due every 10 days/);assert.match(panel(w).textContent,/3% customs levy/);assert.match(panel(w).textContent,new RegExp('Talks end on Day '+p.due));assert.ok(panel(w).textContent.indexOf('Speak for the agreement')<panel(w).textContent.indexOf('Voices in town'));assert.ok(panel(w).querySelector('details summary'));
 const group=ratify(w,p);a.legal['happy.speech']=b.legal['happy.speech']=false;council(w,a);click(w,group.name);click(w,'Protect the right to speak');assert.match(panel(w).textContent,/Protect the right to speak/);clean(g);
});

test('a charter amendment shows what will change and preserves the old terms through reload',async t=>{
 const {g,w,a,b}=await setup(t);const group=ratify(w,propose(w,a,b));council(w,a);click(w,group.name);click(w,'Discuss the charter');click(w,'Ask for a lighter contribution');const p=state(w).proposals.at(-1);
 assert.equal(p.previousTerms.rate,.05);assert.equal(p.terms.rate,.025);assert.match(panel(w).textContent,/pay less into the common purse/);assert.match(panel(w).textContent,/2\.5% of town cash/);
 const saved=plain(w.generateSave()),restored=await makeGame({save:saved});t.after(restored.close);const rw=restored.window,rp=state(rw).proposals.find(x=>x.id===p.id);assert.equal(rp.previousTerms.rate,.05);assert.equal(rp.terms.rate,.025);council(rw,rw.regGet('town',a.id));click(rw,'Federation · Talks underway');assert.match(panel(rw).textContent,/pay less into the common purse/);assert.deepEqual(restored.errors,[]);clean(g);
});

test('charter controls omit changes the community has already made',async t=>{
 const {g,w,a,b}=await setup(t);const group=ratify(w,propose(w,a,b));Object.assign(group.terms,{rate:0,autonomy:1,customs:0,closedBorders:false});council(w,a);click(w,group.name);click(w,'Discuss the charter');
 assert.ok(!controlText(w,'Ask for a lighter contribution'));assert.ok(!controlText(w,'Keep more decisions in each town'));assert.ok(!controlText(w,'Open the outer borders'));assert.ok(!controlText(w,'End the common customs levy'));assert.ok(controlText(w,'Close the outer borders'));assert.ok(controlText(w,'Raise contributions to the common purse'));clean(g);
});
function controlText(w,text){return [...panel(w).querySelectorAll('[role="button"]')].some(b=>b.textContent===text);}

test('completed talks show the recorded refusal and votes without replacing them with today’s opinions',async t=>{
 const {g,w,a,b}=await setup(t);b.values={justice:-8,openness:-8,order:8};b.jobs={priest:30};a.relations[b.id]=b.relations[a.id]=-12;const p=propose(w,a,b);ratify(w,p);assert.equal(p.status,'refused');assert.ok(p.reason);w.refreshExecutive();assert.match(panel(w).textContent,/would not agree/);assert.ok(panel(w).textContent.includes(p.reason));const before=panel(w).textContent;b.values={justice:10,openness:10,order:0};b.relations[a.id]=20;w.refreshExecutive();assert.equal(panel(w).textContent,before);clean(g);
});

test('completed successful talks lead back to the actual community without proposing it twice',async t=>{
 const {g,w,a,b}=await setup(t);const p=propose(w,a,b),group=ratify(w,p);w.refreshExecutive();assert.ok(controlText(w,'Visit '+group.name));click(w,'Visit '+group.name);assert.match(panel(w).textContent,/Council seat/);const count=state(w).proposals.length;w.refreshExecutive();assert.equal(state(w).proposals.length,count);clean(g);
});

test('encouragement changes a religious gathering’s pressure and fades with later experience through reload',async t=>{
 const {g,w,a,b,c}=await setup(t,{third:true});w.planet.religions=[{id:1,name:'Old Rite',foundingTown:a.id,founded:1,tenets:['hierarchical'],tenetNames:['Hierarchical'],influences:{crime:-.3},followers:[a.id,b.id,c.id],cohesion:60,extinct:false}];for(const town of[a,b,c])town.religion=1;
 a.values.justice=c.values.justice=-8;b.values.justice=10;b.legal['happy.speech']=b.legal['happy.rights']=b.legal['education.religion']=false;b.relations[a.id]=a.relations[b.id]=-20;tick(w,5);
 const m=state(w).movements.find(x=>x.town===b.id&&x.kind==='faith');assert.ok(m);const restored=await makeGame({save:plain(w.generateSave())});t.after(restored.close);const rw=restored.window,rm=state(rw).movements.find(x=>x.id===m.id);
 council(w,b);click(w,'Debate over the old teachings');click(w,'Encourage their cause');assert.equal(m.advocacy,.12);tick(w);tick(rw);assert.ok(m.pressure>rm.pressure,'The actual daily calculation responds to encouragement');assert.ok(m.support>rm.support);assert.ok(m.advocacy<.12&&m.advocacy>0);
 const held=plain(m);w.refreshExecutive();w.refreshExecutive();assert.deepEqual(plain(m),held);
 const resumed=await makeGame({save:plain(w.generateSave())});t.after(resumed.close);assert.equal(state(resumed.window).movements.find(x=>x.id===m.id).advocacy,m.advocacy);tick(resumed.window);assert.ok(state(resumed.window).movements.find(x=>x.id===m.id).advocacy<m.advocacy);assert.deepEqual(restored.errors,[]);assert.deepEqual(resumed.errors,[]);clean(g);
});

test('recognising workers cannot repeatedly reduce their grievance and a renewed ban gives a new reason to act',async t=>{
 const {g,w,a}=await setup(t);a.values={justice:-8,order:8};a.jobs={miner:20,farmer:10};a.resources.crop=0;a.wealth=0;a.tax=.8;a.unrest=90;a.legal['happy.speech']=false;tick(w,25);const u=state(w).unions.find(x=>x.town===a.id&&x.role==='miner');
 council(w,a);click(w,u.name+' · On strike');click(w,'Recognise their right to meet');const held=plain(u);click(w,'Recognise their right to meet');assert.match(panel(w).textContent,/already have the right to meet/);assert.deepEqual(plain(u),held);click(w,'← Back');click(w,'Ban the association');assert.equal(a.legal['happy.speech'],false);const grievance=u.grievance;click(w,'Recognise their right to meet');assert.equal(a.legal['happy.speech'],true);assert.ok(u.grievance<grievance);clean(g);
});
