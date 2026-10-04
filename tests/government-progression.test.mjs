import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGame,settleGame} from './harness.mjs';
const plain=x=>JSON.parse(JSON.stringify(x));
async function setup(t){const g=await makeGame();t.after(g.close);const w=g.window,town=settleGame(g);town.pop=40;town.jobs={};town.values={justice:0,order:0,openness:0,change:0,wealth:0};for(const key of Object.keys(town.influences))town.influences[key]=0;Object.assign(w.planet.unlocks,{government:20,education:0,faith:0,trade:0});return {g,w,town};}
function tick(w,town){const before=town.gov;w.gameEvents.governmentEvolution.func(town,null,{});return town.gov!==before;}
function grow(w,town,days){let changed=0;for(let n=0;n<days;n++){changed+=Number(tick(w,town));w.planet.day++;}return changed;}
function open(w,record){const e=w.document.querySelector(`[data-story-kind="localChoice"][data-story-id="${record.id}"]`);assert.ok(e);e.querySelector('.paultendoChronicleStoryLink').click();return w.document.getElementById('actionSubList');}

test('neutral towns keep their rule and repeated observations invent neither bonuses nor political change',async t=>{
 const {g,w,town}=await setup(t);const before=plain(town.influences);assert.equal(grow(w,town,60),0);assert.equal(town.governmentType,'tribal');assert.equal(town.gov,undefined);assert.equal(town._governmentBonusId,undefined);assert.deepEqual(plain(town.influences),before);assert.equal(w.planet._paultendoLife.localChoices.length,0);assert.deepEqual(g.errors,[]);
});

test('native adoption obeys education and local knowledge, and adds each actual effect once',async t=>{
 const {g,w,town}=await setup(t);w.planet.unlocks.government=50;const e=w.gameEvents.townGov;
 e.func(w.currentPlayer,town,{value:'democracy'});assert.equal(town.gov,undefined);assert.deepEqual(plain(town.influences),plain(Object.fromEntries(Object.keys(town.influences).map(k=>[k,0]))));
 for(let n=0;n<30;n++)assert.notEqual(e.value(null,town),'democracy');
 w.planet.unlocks.education=30;w.planet._paultendoLocalKnowledge={civic:{key:'government',before:20,after:50}};e.func(w.currentPlayer,town,{value:'democracy'});assert.equal(town.gov,undefined);
 town._paultendoLocalDiscoveries={civic:true};e.func(w.currentPlayer,town,{value:'democracy'});assert.equal(town.gov,'democracy');assert.equal(town.governmentType,'democracy');assert.equal(town.influences.law,2);assert.ok(Math.abs(town.influences.happy-2.3)<1e-9);assert.equal(town.influences.education,1);const effects=plain(town.influences);e.func(w.currentPlayer,town,{value:'democracy'});assert.deepEqual(plain(town.influences),effects);assert.deepEqual(g.errors,[]);
});

test('an older default government without a tracked bonus is not charged for a phantom effect',async t=>{
 const {g,w,town}=await setup(t);town.governmentType='tribal';w.gameEvents.townGov.func(w.currentPlayer,town,{value:'monarchy'});assert.equal(town.influences.military,1);assert.ok(Math.abs(town.influences.happy+.1)<1e-9);assert.equal(town._governmentBonusId,'monarchy');assert.deepEqual(g.errors,[]);
});

test('a native government replacement is kept instead of overwritten by the mod’s older field',async t=>{
 const {g,w,town}=await setup(t);const e=w.gameEvents.townGov;e.func(w.currentPlayer,town,{value:'monarchy'});assert.equal(town.influences.military,1);assert.ok(Math.abs(town.influences.happy+.1)<1e-9);town.gov='dictatorship';tick(w,town);assert.equal(town.gov,'dictatorship');assert.equal(town.governmentType,'dictatorship');assert.equal(town._governmentBonusId,'dictatorship');assert.equal(town.influences.military,2);assert.ok(Math.abs(town.influences.happy+.6)<1e-9);const effects=plain(town.influences);tick(w,town);assert.deepEqual(plain(town.influences),effects);assert.deepEqual(g.errors,[]);
});

test('sustained representation preferences produce a linked local change and a recovery period prevents churn',async t=>{
 const {g,w,town}=await setup(t);town.values.justice=8;town.values.openness=8;assert.equal(grow(w,town,7),0);const first=town._paultendoGovernmentDiscussion.since;assert.equal(town.gov,undefined);assert.equal(grow(w,town,25),1);assert.equal(town.gov,'council');assert.equal(town.governmentType,'council');const record=w.planet._paultendoLife.localChoices.at(-1);assert.ok(record.cause.debate.days>=8);assert.equal(record.cause.debate.since,first);assert.equal(record.before.government,'tribal');assert.equal(record.after.government,'council');assert.match(record.reason,/people.*say/);assert.match(open(w,record).textContent,/Support.*held.*What changed.*Today.*council of elders/s);town.values.justice=-10;town.values.openness=0;town.values.order=10;w.planet.unlocks.government=30;assert.equal(grow(w,town,40),0);assert.equal(town.gov,'council');assert.equal(w.planet._paultendoLife.decisions.length,0);assert.deepEqual(g.errors,[]);
});

test('a fleeting pressure does not become a new regime, and calmer conditions reset the discussion',async t=>{
 const {g,w,town}=await setup(t);town.values.order=10;assert.equal(grow(w,town,5),0);town.values.order=0;grow(w,town,1);assert.equal(town._paultendoGovernmentDiscussion,undefined);town.values.order=10;assert.equal(grow(w,town,5),0);assert.equal(town.gov,undefined);assert.equal(grow(w,town,25),1);assert.equal(town.gov,'chiefdom');assert.deepEqual(g.errors,[]);
});

test('actual soldiers and fighting strengthen autocratic pressure without granting an army, discovery or supplies',async t=>{
 const {g,w,town}=await setup(t);w.planet.unlocks.government=30;town.values.order=8;town.values.justice=-8;town.jobs={soldier:8};town.issues.war=77;town.resources={crop:30,rock:5,cash:10};const stock=plain(town.resources),jobs=plain(town.jobs),knowledge=plain(w.planet.unlocks);assert.equal(grow(w,town,8),1);assert.equal(town.gov,'dictatorship');assert.deepEqual(plain(town.resources),stock);assert.deepEqual(plain(town.jobs),jobs);assert.deepEqual(plain(w.planet.unlocks),knowledge);assert.deepEqual(g.errors,[]);
});

test('a discussion survives reload and reading its completed story consumes no time or randomness',async t=>{
 const {g,w,town}=await setup(t);town.values.justice=8;town.values.openness=8;grow(w,town,6);const discussion=plain(town._paultendoGovernmentDiscussion);const restored=await makeGame({save:plain(w.generateSave())});t.after(restored.close);const rw=restored.window,rt=rw.regGet('town',town.id);assert.deepEqual(plain(rt._paultendoGovernmentDiscussion),discussion);assert.equal(grow(rw,rt,25),1);const record=rw.planet._paultendoLife.localChoices.at(-1);const before=plain({day:rw.planet.day,life:rw.planet._paultendoLife,resources:rt.resources,influences:rt.influences,discussion:rt._paultendoGovernmentDiscussion});let draws=0;const random=rw.Math.random;rw.Math.random=()=>{draws++;return random();};open(rw,record);rw.Math.random=random;assert.equal(draws,0);assert.deepEqual(plain({day:rw.planet.day,life:rw.planet._paultendoLife,resources:rt.resources,influences:rt.influences,discussion:rt._paultendoGovernmentDiscussion}),before);assert.deepEqual(g.errors,[]);assert.deepEqual(restored.errors,[]);
});

test('an unobserved community changes rule without revealing its identity',async t=>{
 const {g,w,town}=await setup(t);town._hidden=true;town.name='Unseen name';town.values.order=10;grow(w,town,30);assert.equal(town.gov,'chiefdom');assert.equal(w.planet._paultendoLife.localChoices.length,1);assert.doesNotMatch(w.document.getElementById('logMessages').textContent,/Unseen name|chiefdom/);assert.deepEqual(g.errors,[]);
});

test('a native adoption also gets time to settle before ordinary local preferences replace it',async t=>{
 const {g,w,town}=await setup(t);w.gameEvents.townGov.func(w.currentPlayer,town,{value:'monarchy'});town.values.justice=10;town.values.openness=10;assert.equal(grow(w,town,90),0);assert.equal(town.gov,'monarchy');assert.equal(grow(w,town,30),1);assert.equal(town.gov,'council');assert.deepEqual(g.errors,[]);
});
