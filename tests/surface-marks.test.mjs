import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGame,settleGame} from './harness.mjs';
const plain=x=>JSON.parse(JSON.stringify(x));
const life=w=>w.planet._paultendoLife;
const panel=w=>w.document.getElementById('actionSubList');
function click(w,text){const b=[...panel(w).querySelectorAll('[role="button"]')].find(b=>b.textContent.includes(text));assert.ok(b,`${text}: ${panel(w).textContent}`);b.click();}
function quiet(w){for(const event of Object.values(w.dailyEvents)){if(event.func)event.func=()=>{};if(event.perChunk)event.perChunk=()=>{};}}
function next(w,n=1){const choose=w.chooseEvent;w.chooseEvent=()=>null;try{for(let i=0;i<n;i++)w.nextDay();}finally{w.chooseEvent=choose;}}
function meet(w,town){w.openRegBrowser(town,'town');[...w.document.querySelectorAll('.paultendoTownLife button')].find(b=>b.textContent==='Meet the people').click();for(const p of town._paultendoPeople)p.outlook='curious';}
function openMarks(w,town){w.openRegBrowser(town,'town');const b=[...w.document.querySelectorAll('.paultendoTownLife button')].find(b=>b.textContent==='Marks left here');assert.ok(b);b.click();}
async function setup(t,{writing=false,tools=2}={}){const g=await makeGame();t.after(g.close);const w=g.window,warnings=[];w.console.warn=(...a)=>warnings.push(a.map(String).join(' '));const town=settleGame(g);w.planet.day=80;Object.assign(w.planet.unlocks,{smith:20,education:writing?30:20});Object.assign(town,{name:'Farbank',pop:40,start:1,jobs:{miner:10,farmer:20,scholar:2},resources:{crop:1000,rock:5,stone_tools:tools},research:{}});town._paultendoNextExchangeDay=99999;const at=w.chunkAt(...town.center);at.b='badlands';const mine=w.gameEvents.townMine.perChunk;meet(w,town);quiet(w);return {g,w,town,at,mine,warnings};}
function request(w,town,action='Leave their sign',role='miner'){openMarks(w,town);click(w,'Ask someone');click(w,town._paultendoPeople.find(p=>p.role===role).name);click(w,'rock at');click(w,action);return life(w).surfaceMarks.at(-1);}
function finish(w,mark){for(let i=0;i<12&&['proposed','waiting','working'].includes(mark.status);i++)next(w);assert.equal(mark.status,'made',JSON.stringify(mark));}
function check(g,warnings){assert.deepEqual(g.errors,[]);assert.deepEqual(warnings,[]);}

test('signs predate writing, use a real edge and reuse the same worn tool rather than consuming the ground',async t=>{
 const {g,w,town,warnings}=await setup(t),first=request(w,town);assert.equal(first.status,'proposed');assert.equal(first.words,null);assert.equal(town.resources.stone_tools,2);assert.doesNotMatch(panel(w).textContent,/Write a few words/);finish(w,first);assert.equal(first.finished-first.started,2);assert.equal(town.resources.stone_tools,1);assert.equal(town.resources.rock,5);assert.equal(town._paultendoCarvingTools[0].uses,38);
 const second=request(w,town);finish(w,second);assert.equal(second.tool,first.tool);assert.equal(town.resources.stone_tools,1);assert.equal(town._paultendoCarvingTools[0].uses,36);check(g,warnings);
});

test('access, meals and fighting stop actual carving and saved work resumes with its original tool',async t=>{
 const {g,w,town,at,warnings}=await setup(t),mark=request(w,town);next(w,2);assert.equal(mark.status,'working');const remaining=mark.remaining,uses=town._paultendoCarvingTools[0].uses;const rivalAt=w.filterChunks(c=>!c.v.s&&c.b!=='water'&&c.b!=='mountain')[0],rival=w.happen('Create',null,null,{x:rivalAt.x,y:rivalAt.y},'town');at.v.s=rival.id;next(w,2);assert.equal(mark.phase,'access');assert.equal(mark.remaining,remaining);assert.equal(town._paultendoCarvingTools[0].uses,uses);at.v.s=town.id;town.resources.crop=0;next(w);assert.equal(mark.phase,'food');town.resources.crop=1000;const war=w.happen('Create',null,null,{type:'war',towns:[town.id]},'process');town.issues.war=war.id;next(w);assert.equal(mark.phase,'war');
 const restored=await makeGame({save:plain(w.generateSave())});t.after(restored.close);const rw=restored.window;quiet(rw);const rt=rw.regGet('town',town.id),copy=life(rw).surfaceMarks.find(m=>m.id===mark.id);assert.equal(copy.remaining,remaining);delete rt.issues.war;rw.happen('Finish',null,rw.regGet('process',war.id));finish(rw,copy);assert.equal(copy.tool,mark.tool);assert.equal(rt.resources.stone_tools,1);check(g,warnings);assert.deepEqual(restored.errors,[]);
});

test('reading the mark, its maker and tools is passive and abandoning unfinished work keeps the paid tool',async t=>{
 const {g,w,town,warnings}=await setup(t),mark=request(w,town);next(w,2);openMarks(w,town);click(w,'A sign');const before=plain({mark,resources:town.resources,tools:town._paultendoCarvingTools,day:w.planet.day});const random=w.Math.random;let draws=0;w.Math.random=()=>{draws++;return random();};click(w,'See the carving tools');openMarks(w,town);click(w,'A sign');assert.equal(draws,0);assert.deepEqual(plain({mark,resources:town.resources,tools:town._paultendoCarvingTools,day:w.planet.day}),before);click(w,'Leave it unfinished');assert.equal(mark.status,'abandoned');next(w,3);assert.equal(town._paultendoCarvingTools[0].uses,40);assert.equal(town.resources.stone_tools,1);check(g,warnings);
});

test('player words remain literal and do not become parser commands or invented discoveries',async t=>{
 const {g,w,town,warnings}=await setup(t,{writing:true});const words='Here {our names} remain & tomorrow begins';w.doPrompt=args=>args.func(words);const mark=request(w,town,'Write a few words');finish(w,mark);openMarks(w,town);click(w,'Words on');assert.ok(panel(w).textContent.includes(words));assert.equal(mark.source,null);assert.equal(life(w).clues.length,0);assert.equal(life(w).inquiries.length,0);check(g,warnings);
});

test('a missing edge is a real workshop need and the mark cannot steal tools already promised elsewhere',async t=>{
 const {g,w,town,warnings}=await setup(t,{tools:1});const mark=request(w,town);
 const reservation={id:'material:other',town:town.id,type:'metal_tools',status:'waiting',person:'absent',cost:{stone_tools:1},inputs:[],steps:[],lastDay:99999};
 life(w).materialWork.push(reservation);next(w,2);assert.equal(mark.phase,'tools');assert.equal(town.resources.stone_tools,1);assert.equal(town._paultendoCarvingTools,undefined);
 const output=()=>life(w).materialWork.filter(x=>x.type==='stone_tools'&&x.status==='made').reduce((sum,x)=>sum+x.output,0);
 const stock=town.resources.stone_tools,produced=output();reservation.status='failed';finish(w,mark);
 assert.equal(town.resources.stone_tools || 0,stock+output()-produced-1);
 assert.equal(town._paultendoCarvingTools.length,1);assert.equal(town._paultendoCarvingTools[0].uses,38);check(g,warnings);
});

test('an actual maker can sketch a learned technique but a world milestone does not invent a source',async t=>{
 const {g,w,town,warnings}=await setup(t);town.research={education:100};w.happen('AddResource',null,town,{type:'clay',count:1});const caller=w.readyEvent('unlockWriting');caller.args.value={town:town.id};w.doEvent('unlockWriting',caller);const work=life(w).inquiries.at(-1);for(let i=0;i<12&&work.status!=='learned';i++)next(w);assert.equal(work.status,'learned');town.research={};const mark=request(w,town,'Sketch writing','scholar');finish(w,mark);assert.equal(mark.source.source,work.id);assert.equal(mark.source.person,work.person);assert.equal(mark.source.world,1);assert.equal(mark.words,null);check(g,warnings);
});

test('marks remain at their physical sites and loss of the rock preserves the remembered history',async t=>{
 const {g,w,town,at,warnings}=await setup(t),mark=request(w,town);finish(w,mark);const before=plain(mark.surface);at.b='grassland';next(w);assert.equal(mark.status,'lost');assert.deepEqual(plain(mark.surface),before);openMarks(w,town);click(w,'A sign');assert.match(panel(w).textContent,/surface is gone/);check(g,warnings);
});

test('a completed building can inspire an autonomous maker’s sign using only its actual construction material',async t=>{
 const {g,w,town,warnings}=await setup(t);town._paultendoPeople.find(p=>p.role==='miner').outlook='steadfast';town.resources.rock=100;town.resources.cash=500;
 const p=w.happen('Create',town,null,{type:'project',subtype:'school',town:town.id,cost:8},'process'),site=w.filterChunks(c=>c.v.s===town.id&&!c.v.m)[0];assert.ok(site);p.x=site.x;p.y=site.y;
 for(let i=0;i<12&&!p.done;i++)w.metaEvents.processProject.func(p);assert.ok(p.done);assert.ok(p._paultendoBuilding.inputs.rock>0);assert.ok(p.marker);next(w);const mark=life(w).surfaceMarks.find(m=>m.source?.marker===p.marker);assert.ok(mark);assert.equal(mark.autonomous,true);assert.equal(mark.surface.material,'rock');assert.equal(mark.surface.marker,p.marker);finish(w,mark);next(w,4);assert.equal(life(w).surfaceMarks.filter(m=>m.source?.marker===p.marker).length,1);check(g,warnings);
});

test('a shared belief can become a physical inscription, and a real worker encounter carries its words onward once',async t=>{
 const {g,w,town,at,mine,warnings}=await setup(t,{writing:true});w.gameEvents.scholarEmerges.func(town);const root=life(w).teachings.find(t=>t.origin.cause?.type==='academy');assert.ok(root);next(w);const mark=life(w).surfaceMarks.find(m=>m.source?.id===root.id);assert.ok(mark);finish(w,mark);assert.equal(mark.source.snapshot.words,root.words);
 const free=w.filterChunks(c=>!c.v.s&&c.b!=='water'&&c.b!=='mountain')[0],reader=w.happen('Create',null,null,{x:free.x,y:free.y},'town');reader.pop=40;reader.resources={crop:1000};reader.jobs={miner:4};reader._paultendoNextExchangeDay=99999;meet(w,reader);at.v.s=reader.id;
 for(let i=0;i<30&&!mark.readings.some(r=>r.town===reader.id);i++)mine(reader,null,at);const reading=mark.readings.find(r=>r.town===reader.id);assert.ok(reading);const teaching=life(w).teachings.find(t=>t.id===reading.teaching);assert.ok(teaching);assert.equal(teaching.origin.id,root.origin.id);assert.equal(teaching.words,mark.words);mine(reader,null,at);assert.equal(life(w).teachings.filter(t=>t.town===reader.id&&t.origin.id===root.origin.id).length,1);check(g,warnings);
});
