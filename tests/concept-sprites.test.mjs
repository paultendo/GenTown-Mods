import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGame,settleGame} from './harness.mjs';
const plain=x=>JSON.parse(JSON.stringify(x));
const panel=w=>w.document.getElementById('actionSubList');
function click(w,text){const b=[...panel(w).querySelectorAll('[role="button"]')].find(b=>b.textContent===text);assert.ok(b,`${text}: ${panel(w).textContent}`);b.click();}
function council(w,town){w.openRegBrowser(town,'town');[...w.document.querySelectorAll('.paultendoTownLife button')].find(b=>b.textContent==='Council').click();}
async function inquiry(t){
 const g=await makeGame();t.after(g.close);const w=g.window,town=settleGame(g);w.planet.day=30;
 Object.assign(town,{name:'Claybank',pop:20,jobs:{scholar:2,miner:4,farmer:14},resources:{crop:1000,cash:0},research:{education:100}});
 Object.assign(w.planet.unlocks,{education:20,farm:10,smith:20,fire:20});
 w.happen('AddResource',null,town,{type:'clay',count:2});w.doEvent('unlockWriting',w.readyEvent('unlockWriting'));
 const work=w.planet._paultendoLife.inquiries.at(-1);assert.ok(work);
 const open=()=>w.document.querySelector(`[data-story-kind="inquiry"][data-story-id="${work.id}"] .paultendoChronicleStoryLink`).click();
 return {g,w,town,work,open};
}
test('work symbols distinguish missing supplies, paused work, research and real completion without changing the work',async t=>{
 const {g,w,town,work,open}=await inquiry(t);
 town.resources.clay=0;open();assert.ok(panel(w).querySelector('[data-sprite="shortage"]'));assert.match(panel(w).textContent,/Still needed/);assert.ok([...panel(w).querySelectorAll('[role="button"]')].some(b=>b.textContent==='Finding clay'));
 town.resources.clay=2;work.status='working';work.remaining=3;open();assert.ok(panel(w).querySelector('[data-sprite="research"]'));assert.match(panel(w).textContent,/3 days of work left/);
 work.delay='war';open();assert.ok(panel(w).querySelector('[data-sprite="waiting"]'));assert.match(panel(w).textContent,/fighting to end/);
 work.delay='food';open();assert.ok(panel(w).querySelector('[data-sprite="shortage"]'));
 work.status='learned';open();assert.ok(panel(w).querySelector('[data-sprite="finished"]'));assert.equal(panel(w).querySelector('[data-sprite="shortage"]'),null);assert.doesNotMatch(panel(w).textContent,/waits for food/);
 work.status='failed';open();assert.equal(panel(w).querySelector('[data-sprite="waiting"],[data-sprite="finished"],[data-sprite="shortage"]'),null);
 const before=plain({work,day:w.planet.day,resources:town.resources,people:town._paultendoPeople});let calls=0;const random=w.Math.random;w.Math.random=()=>{calls++;return random();};open();w.refreshExecutive();w.Math.random=random;
 assert.equal(calls,0);assert.deepEqual(plain({work,day:w.planet.day,resources:town.resources,people:town._paultendoPeople}),before);assert.deepEqual(g.errors,[]);
});
test('council symbols retain real consent controls and distinguish faith and independence from conflict',async t=>{
 const g=await makeGame();t.after(g.close);const w=g.window,a=settleGame(g);w.planet.day=12;Object.assign(w.planet.unlocks,{government:50,trade:30,travel:30,education:30});
 const origin=w.chunkAt(...a.center),site=w.filterChunks(c=>!c.v.s&&c.v.g===origin.v.g&&c.b!=='water'&&c.b!=='mountain')[0];const b=w.happen('Create',null,null,{x:site.x,y:site.y},'town');
 for(const [town,name] of [[a,'Ashbank'],[b,'Wick']]){Object.assign(town,{name,pop:30,jobs:{merchant:12,farmer:12,scholar:6},resources:{crop:1000,cash:100},values:{justice:8,openness:8}});w.planet._paultendoFog.explored[town.center.join(',')]=true;w.planet._paultendoFog.visible[town.center.join(',')]=1;}
 w.happen('AddRelation',a,b,{amount:8});w.happen('AddRelation',b,a,{amount:8});council(w,a);click(w,'Talk with Wick');click(w,'Federation');
 const proposal=w.planet._paultendoPolitics.proposals.at(-1);assert.ok(panel(w).querySelector('[data-sprite="alliance"]'));click(w,'Speak against the agreement');assert.equal(proposal.advocacy[a.id],-.12);
 const state=w.planet._paultendoPolitics;state.movements.push({id:'symbol-faith',town:a.id,kind:'faith',resolved:null},{id:'symbol-exit',town:a.id,kind:'exit',resolved:null});council(w,a);
 assert.equal(panel(w).querySelector('[data-sprite="shrine"]').parentElement.textContent,'Debate over the old teachings');assert.equal(panel(w).querySelector('[data-sprite="rebellion"]').parentElement.textContent,'A petition to leave');assert.equal(panel(w).querySelector('[data-sprite="native-sword"]'),null);
 const before=plain({state,resources:a.resources,day:w.planet.day});let draws=0;const random=w.Math.random;w.Math.random=()=>{draws++;return random();};council(w,a);w.Math.random=random;
 assert.equal(draws,0);assert.deepEqual(plain({state,resources:a.resources,day:w.planet.day}),before);assert.deepEqual(g.errors,[]);
});
test('an eruption symbol comes from an observed landscape event and does not invent a flood from its name',async t=>{
 const g=await makeGame();t.after(g.close);const w=g.window,town=settleGame(g),chunk=w.chunkAt(...town.center);w.planet.day=20;chunk.b='grass';chunk.m=.8;chunk.e=.5;
 const event=w.happen('Create',null,null,{type:'disaster',subtype:'volcano',name:'Flood warning',x:chunk.x,y:chunk.y,chunks:[[chunk.x,chunk.y]],duration:10},'process');const random=w.Math.random;w.Math.random=()=>.99;w.metaEvents.processDisaster.func(event);w.Math.random=random;
 const link=[...w.document.querySelectorAll('[data-story-kind="land"] .paultendoChronicleStoryLink')].at(-1);assert.ok(link);const before=plain(w.planet._paultendoLand);link.click();
 assert.ok(panel(w).querySelector('[data-sprite="volcano"]'));assert.equal(panel(w).querySelector('[data-sprite="flood"]'),null);assert.deepEqual(plain(w.planet._paultendoLand),before);
 const saved=plain(w.generateSave()),restored=await makeGame({save:saved});t.after(restored.close);const rw=restored.window;
 const restoredLink=[...rw.document.querySelectorAll('[data-story-kind="land"] .paultendoChronicleStoryLink')].at(-1);assert.ok(restoredLink);restoredLink.click();assert.ok(panel(rw).querySelector('[data-sprite="volcano"]'));assert.deepEqual(g.errors,[]);assert.deepEqual(restored.errors,[]);
});
test('Chronicle decorations are reconstructed from known records rather than words or saved images',async t=>{
 const {g,w,town,work}=await inquiry(t);
 assert.ok(w.document.querySelector('#paultendoChronicleHeadlines [data-sprite="research"]'),'The new story should decorate its existing highlight immediately');
 w.planet.day++;w.logMessage('A volcano rises beside a rebel shrine.','milestone');await new Promise(resolve=>setTimeout(resolve,30));const news=[...w.document.querySelectorAll('.paultendoChronicleHeadline')].find(n=>n.textContent.includes('rebel shrine'));assert.ok(news);assert.equal(news.querySelector('[data-sprite]'),null);
 const save=plain(w.generateSave()),restored=await makeGame({save});t.after(restored.close);const rw=restored.window;
 rw.logMessage('Claybank tries the work.','milestone',{_paultendoStory:{kind:'inquiry',id:work.id}});assert.ok(rw.document.querySelector('#paultendoChronicleHeadlines [data-sprite="research"]'));const hidden=rw.regGet('town',town.id);hidden._hidden=true;
 delete rw.planet._paultendoFog.explored[hidden.center.join(',')];delete rw.planet._paultendoFog.visible[hidden.center.join(',')];
 rw.logMessage('Another day begins.','milestone');await new Promise(resolve=>setTimeout(resolve,30));assert.equal(rw.document.querySelector('#paultendoChronicleHeadlines [data-sprite="research"]'),null);
 assert.ok(work);assert.deepEqual(g.errors,[]);assert.deepEqual(restored.errors,[]);
});
