import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGame,settleGame} from './harness.mjs';
const plain=x=>JSON.parse(JSON.stringify(x));
const panel=w=>w.document.getElementById('actionSubList');
const control=(w,text)=>[...panel(w).querySelectorAll('[role="button"]')].find(b=>b.textContent===text);
function next(w){const choose=w.chooseEvent;w.chooseEvent=()=>null;try{w.nextDay();}finally{w.chooseEvent=choose;}}
async function setup(t){
 const g=await makeGame();t.after(g.close);const w=g.window,town=settleGame(g);w.planet.day=30;
 Object.assign(town,{name:'Claybank',pop:20,jobs:{scholar:2,miner:4,farmer:14},resources:{crop:1000,cash:0},research:{education:100},_paultendoNextExchangeDay:99999});
 Object.assign(w.planet.unlocks,{education:20,farm:10,smith:20,fire:20});
 for(const id of ['townFarm','townTame','townMine','townLumber','townBirth','townDeath','townExpand','townEat']){if(w.gameEvents[id].func)w.gameEvents[id].func=()=>{};if(w.gameEvents[id].perChunk)w.gameEvents[id].perChunk=()=>{};}w.gameEvents.processAll.func=()=>{};
 w.happen('AddResource',null,town,{type:'clay',count:2});const caller=w.readyEvent('unlockWriting');assert.ok(caller);w.doEvent('unlockWriting',caller);const work=w.planet._paultendoLife.inquiries.at(-1);
 return {g,w,town,work};
}
function open(w,work){w.document.querySelector(`[data-story-kind="inquiry"][data-story-id="${work.id}"] .paultendoChronicleStoryLink`).click();return panel(w);}
function overview(w,town){w.openRegBrowser(town,'town');const button=[...w.document.querySelectorAll('.paultendoTownLife button')].find(b=>b.textContent==='Work and inventions');assert.ok(button);button.click();return panel(w);}
function clean(g){assert.deepEqual(g.errors,[]);}

test('a town with research alone exposes its work without advancing time, inventing people or consuming randomness',async t=>{
 const {g,w,town,work}=await setup(t);const held=plain({day:w.planet.day,people:town._paultendoPeople,resources:town.resources,work});let draws=0;const rand=w.Math.random;w.Math.random=()=>{draws++;return rand();};
 const p=overview(w,town);assert.match(p.textContent,/Underway/);assert.match(p.textContent,new RegExp(work.title));w.refreshExecutive();w.Math.random=rand;
 assert.equal(draws,0);assert.deepEqual(plain({day:w.planet.day,people:town._paultendoPeople,resources:town.resources,work}),held);clean(g);
});

test('all active work stays ahead of the latest six old results across the four work systems',async t=>{
 const {g,w,town,work}=await setup(t),life=w.planet._paultendoLife;
 for(let i=0;i<9;i++)life.inquiries.push({...plain(work),id:'history-'+i,title:'Old trial '+i,status:'failed',finished:20+i});
 life.materialWork.push({id:'batch:proof',town:town.id,name:'Jory',type:'glass',status:'working',remaining:4,day:12});
 life.artifactWork.push({id:'object:proof',town:town.id,name:'Merrin',kind:'lens',status:'gathering',day:11});
 life.sampling.push({id:'sample:proof',town:town.id,name:'Ari',type:'clay',status:'returning',day:10});
 const p=overview(w,town),text=p.textContent;assert.ok(text.indexOf('Looking for clay')<text.indexOf('Earlier work'));assert.ok(text.indexOf('glass')<text.indexOf('Earlier work'));assert.ok(text.indexOf('Clear lens')<text.indexOf('Earlier work'));assert.ok(text.indexOf(work.title)<text.indexOf('Earlier work'));
 assert.doesNotMatch(text,/Old trial [012]/);assert.match(text,/Old trial 8/);assert.match(text,/4 days of work left/);clean(g);
});

test('native day refresh updates a work story and spends its prototype inputs only once',async t=>{
 const {g,w,town,work}=await setup(t);open(w,work);next(w);w.refreshExecutive();assert.equal(work.status,'working');assert.match(panel(w).textContent,/6 days of work left/);assert.equal(panel(w).textContent.split('days of work left').length,2);assert.equal(town.resources.clay,1);
 const held=plain(work);w.refreshExecutive();w.refreshExecutive();assert.deepEqual(plain(work),held);assert.equal(town.resources.clay,1);next(w);w.refreshExecutive();assert.match(panel(w).textContent,/5 days of work left/);clean(g);
});

test('live reading preserves scroll, focus and expanded earlier days instead of returning to the top',async t=>{
 const {g,w,work}=await setup(t);for(let i=0;i<16;i++)work.steps.push({day:10+i,text:'A remembered evening '+i});const p=open(w,work);assert.equal(p.querySelectorAll('details').length,1);
 const details=p.querySelector('details');details.open=true;details.querySelector('summary').focus();p.scrollTop=240;w.refreshExecutive();assert.equal(p.scrollTop,240);assert.equal(p.querySelector('details').open,true);assert.equal(w.document.activeElement.tagName,'SUMMARY');assert.match(p.textContent,/A remembered evening 0/);assert.match(p.textContent,/A remembered evening 15/);clean(g);
});

test('a newly opened native page with the same title cannot inherit a previous work renderer',async t=>{
 const {g,w,work}=await setup(t);open(w,work);w.populateExecutive([{text:'A different page'}],work.title);w.openExecutive();w.refreshExecutive();assert.match(panel(w).textContent,/A different page/);assert.doesNotMatch(panel(w).textContent,/How it began/);clean(g);
});

test('story links respond to Enter and Space exactly once without advancing the world',async t=>{
 const {g,w,work}=await setup(t);open(w,work);const link=control(w,'Materials and workshops');assert.equal(link.tabIndex,0);let calls=0;link.addEventListener('click',()=>calls++);const before=w.planet.day;
 const event=new w.KeyboardEvent('keydown',{key:' ',bubbles:true,cancelable:true});link.dispatchEvent(event);assert.equal(calls,1);assert.equal(event.defaultPrevented,true);assert.equal(w.planet.day,before);assert.match(panel(w).textContent,/Materials/);
 open(w,work);const enter=control(w,'Materials and workshops');enter.addEventListener('click',()=>calls++);enter.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));assert.equal(calls,2);assert.equal(w.planet.day,before);clean(g);
});

test('a finished or lost job does not keep displaying a stale food delay or broken quantities',async t=>{
 const {g,w,town,work}=await setup(t);work.status='failed';work.delay='food';let p=overview(w,town);assert.match(p.textContent,/The trial failed/);assert.doesNotMatch(p.textContent,/waits for food|undefined|NaN/);open(w,work);assert.doesNotMatch(panel(w).textContent,/Trade and neighbours|waits for food/);work.status='lost';w.refreshExecutive();assert.match(panel(w).textContent,/Contact lost/);assert.doesNotMatch(panel(w).textContent,/waits for food/);clean(g);
});


test('keyboard focus stays on the same work when its status and position change',async t=>{
 const {g,w,town,work}=await setup(t);const p=overview(w,town),button=[...p.querySelectorAll('[role="button"]')].find(b=>b.textContent.startsWith(work.title));assert.ok(button.id);button.focus();const id=button.id;next(w);w.refreshExecutive();assert.equal(w.document.activeElement.id,id);assert.match(w.document.activeElement.textContent,/6 days of work left/);assert.equal(town.resources.clay,1);clean(g);
});
