import test from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, settleGame } from './harness.mjs';

const panel = w => w.document.getElementById('actionSubList');
const ideas = w => w.planet._paultendoLife.teachings;
const next = w => {
  const choose = w.chooseEvent; w.chooseEvent = () => null;
  try { w.nextDay(); } finally { w.chooseEvent = choose; }
};
function prepare(w, town) {
  town.pop = 40; town.resources.crop = 200; town.jobs = {farmer:4};
  Object.assign(w.planet.unlocks,{farm:20,education:20,military:10,trade:30,government:10});
  town.gov = 'dictatorship'; town.influences.trade = 6;
}
function neighbour(w, source, name = 'Neighbour') {
  const center = w.planet.chunks[source.center.join(',')];
  const free = w.filterChunks(c => !c.v.s && c.v.g === center.v.g && c.b !== 'water' && c.b !== 'mountain')
    .sort((a,b) => Math.hypot(a.x-center.x,a.y-center.y)-Math.hypot(b.x-center.x,b.y-center.y))[0];
  assert.ok(free);
  const town = w.happen('Create',null,null,{x:free.x,y:free.y},'town');
  town.name = name; prepare(w,town); return town;
}
function route(w,a,b) {
  w.gameEvents.establishTradeRoute.func(a,b,{choice:'yes'});
  const route = w.planet.tradeRoutes.find(r => [r.town1,r.town2].includes(a.id) && [r.town1,r.town2].includes(b.id));
  assert.ok(route?.active); return route;
}
function caravan(w,town,route,success = true) {
  const random = w.Math.random; w.Math.random = () => success ? 0 : 0.999;
  try { w.gameEvents.caravanDeparts.func(town,null,{value:route}); } finally { w.Math.random = random; }
}
function scholar(w,town) {
  w.gameEvents.scholarEmerges.func(town);
  const root = ideas(w).find(t => t.town === town.id && t.origin.cause?.type === 'academy');
  assert.ok(root); return root;
}
function click(w,text) {
  const button = [...panel(w).querySelectorAll('[role="button"]')].find(b => b.textContent.includes(text));
  assert.ok(button,`Missing: ${text}`); button.click();
}
function openWords(w,town) {
  w.openRegBrowser(town,'town');
  const button = [...w.document.querySelectorAll('.paultendoTownLife button')].find(b => b.textContent === 'Words passed on');
  assert.ok(button); button.click();
}

test('actual harvests can begin a community practice without the Traveler and cannot farm repeated daily bonuses',async t => {
  const game = await makeGame(); t.after(game.close);
  const w = game.window, town = settleGame(game); prepare(w,town);
  town.legal.farm = false;
  w.gameEvents.townFarm.func(town,null,{value:40});
  assert.equal(town._paultendoCommunityWork,undefined,'Forbidden farming did not produce anything');
  town.legal.farm = true; town.resources.crop = 0;
  const random = w.Math.random; w.Math.random = () => 0.99;
  try {
    for(let day=3;day<=5;day++) {
      w.planet.day = day; w.gameEvents.townFarm.func(town,null,{value:12});
      w.gameEvents.townFarm.func(town,null,{value:12});
    }
  } finally { w.Math.random = random; }
  assert.equal(ideas(w).length,1);
  const root = ideas(w)[0];
  assert.equal(root.origin.kind,'community'); assert.equal(root.origin.whisper,undefined);
  assert.equal(root.origin.cause.days,3); assert.ok(root.origin.cause.count>=town.pop);
  assert.equal(root.meaning,'food'); assert.ok(root.changes.farm>0);
  assert.equal(w.planet._paultendoLife.whispers.length,0);
  assert.equal(town._paultendoPeople[0].met,null,'Autonomous people have not met the Traveler');
  const count = ideas(w).length;
  for(let day=6;day<=20;day++){w.planet.day=day;w.gameEvents.townFarm.func(town,null,{value:40});}
  assert.equal(ideas(w).length,count,'The same harvest practice does not renew its influence');
  openWords(w,town); click(w,root.title);
  assert.match(panel(w).textContent,/harvests.*food to spare/s);
  assert.doesNotMatch(panel(w).textContent,/You whispered|Remember your whisper/);
  assert.deepEqual(game.errors,[]);
});

test('short rations build dissent through actual meals, while well fed towns and early camps do not invent hardship',async t => {
  const game = await makeGame(); t.after(game.close);
  const w=game.window,town=settleGame(game);prepare(w,town);town.influences.happy=0;
  for(let day=4;day<=7;day++) {
    w.planet.day=day;town.resources={crop:200};w.gameEvents.townEat.func(town);
  }
  assert.equal(ideas(w).length,0);
  for(let day=8;day<=11;day++) {
    w.planet.day=day;town.resources={crop:10};w.gameEvents.townEat.func(town);
  }
  const root=ideas(w)[0];assert.ok(root);
  assert.equal(root.origin.cause.type,'hunger');assert.equal(root.origin.cause.days,4);
  assert.equal(root.topic,'defy');assert.ok(root.changes.law<0 && root.changes.happy<0);
  assert.equal(w.planet._paultendoLife.whispers.length,0);
  w.planet.day++;town.resources={crop:10};w.gameEvents.townEat.func(town);
  assert.equal(ideas(w).length,1,'A single shortage does not spawn daily protests');
  assert.deepEqual(game.errors,[]);
});

test('a scholar’s real work can travel by successful caravan, change meaning and survive reload without granting player trust',async t => {
  const game=await makeGame();t.after(game.close);const w=game.window,source=settleGame(game);prepare(w,source);
  const target=neighbour(w,source);target.jobs={soldier:39};
  const root=scholar(w,source),road=route(w,source,target);
  assert.ok(Number.isFinite(road.difficulty) && road.difficulty>0);
  assert.ok(road.distance>0 && Number.isFinite(road.travelTime));
  caravan(w,source,road);assert.equal(ideas(w).length,1,'Words need time before they can leave');
  w.planet.day=root.readyDay;
  caravan(w,source,road,false);assert.equal(ideas(w).length,1,'A lost caravan carries no words');
  caravan(w,source,road);
  const heard=ideas(w).find(r=>r.town===target.id);assert.ok(heard);assert.equal(heard.resolved,false);
  assert.equal(heard.contact.route,road.id);assert.ok(heard.contact.pathLength>0);
  const arrival=[...w.document.querySelectorAll('.logText')].find(e=>e.textContent.includes('Merchants bring words'));
  assert.ok(arrival);assert.doesNotMatch(arrival.textContent,/because of|thanks to|buoyed by/,'Observed journeys must not gain unrelated causal claims');
  assert.equal(heard.role,'soldier');heard.roll=0;
  const trust=target.guidanceTrust;
  const save=JSON.parse(JSON.stringify(w.generateSave()));
  const restored=await makeGame({save});t.after(restored.close);const rw=restored.window;
  const record=ideas(rw).find(r=>r.id===heard.id),rt=rw.regGet('town',target.id);
  rw.planet.day=record.due-1;next(rw);
  assert.equal(record.status,'adopted');assert.equal(record.meaning,'drills');
  assert.ok(record.changes.military>0 && record.changes.education>0);
  assert.ok(rt.guidanceTrust<=trust,'Ordinary drift can reduce trust, but foreign ideas earn no whisper reward');
  assert.notEqual(rt._paultendoGuidanceReason,'whisper:heard');
  assert.equal(record.origin.id,root.id);assert.equal(record.origin.kind,'community');
  assert.equal(record.chain[0].words,root.words);assert.equal(record.strength,root.strength*0.65);
  assert.ok(record.readyDay>record.responseDay);
  openWords(rw,rt);click(rw,record.title);
  assert.match(panel(rw).textContent,/academy.*merchants.*soldiers/is);
  assert.doesNotMatch(panel(rw).textContent,/You whispered|your words/);
  click(rw,'Visit '+record.name);assert.match(panel(rw).textContent,/Soldier of/);
  assert.match(panel(rw).textContent,/Words that reached them/);
  const len=ideas(rw).length;rw.planet.day=record.readyDay;caravan(rw,rt,rw.planet.tradeRoutes[0]);
  assert.equal(ideas(rw).filter(r=>r.origin.id===root.id).length,2,'The same idea does not bounce home or repeat on the same road');
  assert.equal(ideas(rw).length,len);
  assert.deepEqual(game.errors,[]);assert.deepEqual(restored.errors,[]);
});

test('listeners recheck their own work and wars before adopting a saved message',async t => {
  for(const cause of ['occupation','war','education']) {
    const game=await makeGame();t.after(game.close);const w=game.window,a=settleGame(game);prepare(w,a);
    const b=neighbour(w,a);b.jobs={soldier:39};const root=scholar(w,a),r=route(w,a,b);
    w.planet.day=root.readyDay;caravan(w,a,r);const heard=ideas(w).find(r=>r.town===b.id);heard.roll=0;
    if(cause==='occupation') b.jobs={};
    if(cause==='education') w.planet.unlocks.education=0;
    if(cause==='war') { const war=w.happen('Create',a,null,{type:'war',towns:[a.id,b.id]},'process');a.issues.war=b.issues.war=war.id; }
    w.planet.day=heard.due-1;next(w);
    assert.equal(heard.resolved,true);assert.notEqual(heard.status,'adopted');assert.equal(heard.changes,undefined);
    assert.deepEqual(game.errors,[]);
  }
});

test('unseen communities still act and exchange ideas while their names stay out of known stories',async t => {
  const game=await makeGame();t.after(game.close);const w=game.window,a=settleGame(game);prepare(w,a);
  const b=neighbour(w,a,'UnseenCitadel');b._hidden=true;
  const root=scholar(w,b),r=route(w,b,a);w.planet.day=root.readyDay;
  caravan(w,b,r);const heard=ideas(w).find(t=>t.town===a.id);assert.ok(heard);heard.roll=0;
  w.planet.day=heard.due-1;next(w);assert.equal(heard.status,'adopted');
  openWords(w,a);click(w,heard.title);
  assert.doesNotMatch(panel(w).textContent,/UnseenCitadel/);assert.match(panel(w).textContent,/beyond the land you know/);
  a._hidden=true;b._hidden=false;
  const other=neighbour(w,b,'ThirdTown');other._hidden=true;const road=route(w,a,other);
  w.planet.day=heard.readyDay;caravan(w,a,road);
  const pending=ideas(w).find(r=>r.town===other.id);assert.ok(pending);pending.roll=0;
  w.planet.day=pending.due-1;next(w);assert.equal(pending.status,'adopted','Fog must not pause the listener’s life');
  assert.deepEqual(game.errors,[]);
});

test('reading community stories consumes no simulation randomness and changes no practices',async t => {
  const game=await makeGame();t.after(game.close);const w=game.window,a=settleGame(game);prepare(w,a);const root=scholar(w,a);
  const before=JSON.stringify(ideas(w));const random=w.Math.random;let calls=0;
  w.Math.random=()=>{calls++;return random();};
  for(let i=0;i<3;i++){openWords(w,a);click(w,root.title);}
  w.Math.random=random;
  assert.equal(calls,0);assert.equal(JSON.stringify(ideas(w)),before);
  assert.deepEqual(game.errors,[]);
});
