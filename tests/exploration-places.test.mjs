import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGame, settleGame} from './harness.mjs';

const panel = w => w.document.getElementById('actionSubList');
function click(w,text) {
  const button = [...panel(w).querySelectorAll('[role="button"]')].find(b=>b.textContent.includes(text));
  assert.ok(button,`Missing control: ${text}`); button.click();
}
function next(w) {
  const choose = w.chooseEvent; w.chooseEvent = () => null;
  try {w.nextDay();} finally {w.chooseEvent = choose;}
}
function prepare(game) {
  const w = game.window, town = settleGame(game);
  town.name = 'Wick'; town.pop = 48; town.resources.crop = 100;
  town.influences.travel = 3; town.guidanceTrust = 90;
  w.planet.unlocks.travel = 20; w.planet.day = 10;
  return town;
}
function expedition(w,town) {
  const caller = w.readyEvent('explorationExpeditionPrompt',town);
  assert.ok(caller,'An actual expedition must be possible'); return caller;
}
function offer(w,caller) {
  const choose = w.chooseEvent, ready = w.readyEvent;
  w.chooseEvent = () => caller.eventClass;
  w.readyEvent = (key,...args) => key === caller.eventClass ? caller : ready(key,...args);
  try {w.nextDay();} finally {w.chooseEvent = choose; w.readyEvent = ready;}
  return w.document.getElementById('logMessage-'+caller.logID);
}
function visit(w,town,place) {
  w.openRegBrowser(town,'town');
  const button = [...w.document.querySelectorAll('.paultendoTownLife button')].find(b=>b.textContent===`Visit ${place.name}`);
  assert.ok(button,'A remembered destination must be visitable'); button.click();
}
function scout(w,town) {
  const caller = expedition(w,town);
  offer(w,caller).querySelector('[type="yes"]').click();
  const place = w.planet._paultendoLife.places[caller.args.mission.placeId];
  assert.ok(place); return place;
}
function sendReturn(w,town,place,topic='explore') {
  visit(w,town,place); click(w,'Whisper about this place');
  const person = town._paultendoPeople.find(p=>p.role==='resident');
  person.outlook='curious'; person.trust=90;
  click(w,person.name);
  click(w,topic==='explore' ? 'There is still something to learn' : 'They have no right to hold');
  const record = w.planet._paultendoLife.whispers.at(-1); record.roll=0;
  return {record,person};
}

test('the Traveler opening accompanies a fresh camp and leaves ongoing saves alone',async t=>{
  const game = await makeGame(); t.after(game.close); const w=game.window;
  assert.match(w.document.getElementById('paultendoTravelerOpening').textContent,/Choose a place for the first camp/);
  prepare(game);
  assert.equal(w.document.getElementById('paultendoTravelerOpening'),null);
  w.document.getElementById('actionItem-annals').click(); click(w,'The Traveler');
  assert.match(panel(w).textContent,/No memory tells you how this history should end/);
  const save=JSON.parse(JSON.stringify(w.generateSave())); delete save.planet._paultendoLife;
  const restored=await makeGame({save}); t.after(restored.close);
  assert.equal(restored.window.document.getElementById('paultendoTravelerOpening'),null);
  assert.equal(Object.keys(restored.window.planet._paultendoLife.places).length,0);
  assert.deepEqual(game.errors,[]); assert.deepEqual(restored.errors,[]);
});

test('only a completed native expedition records its actual destination, not eligibility, refusal or a failed path',async t=>{
  for (const result of ['yes','no','blocked']) {
    const game=await makeGame(); t.after(game.close); const w=game.window,town=prepare(game),caller=expedition(w,town);
    assert.equal(Object.keys(w.planet._paultendoLife.places).length,0);
    if(result==='blocked') caller.args.mission.path=[];
    const entry=offer(w,caller),known=new Set(Object.keys(w.planet._paultendoFog.explored));
    entry.querySelector(`[type="${result==='no'?'no':'yes'}"]`).click();
    const places=Object.values(w.planet._paultendoLife.places);
    if(result==='yes') {
      assert.equal(places.length,1); const place=places[0],target=caller.args.mission.target;
      if(target) assert.equal(place.id,`${target.x},${target.y}`);
      assert.equal(place.firstDay,w.planet.day);
      assert.equal(place.visits[0].revealed,Object.keys(w.planet._paultendoFog.explored).filter(key=>!known.has(key)).length);
      assert.ok(w.planet._paultendoFog.explored[place.id]);
      assert.ok(w.planet.chunks[place.id].v.road.traffic>0);
      assert.equal(w.planet._paultendoLife.decisions.at(-1).place,place.id);
    } else {
      assert.equal(places.length,0);
      assert.match(entry.textContent,result==='no'?/stay close to home/:/find no route/);
    }
    assert.deepEqual(game.errors,[]);
  }
});

test('destination memories survive the temporary map marker and reload, and looking never reveals fog',async t=>{
  const game=await makeGame(); t.after(game.close); const w=game.window,town=prepare(game),place=scout(w,town);
  const marker=w.regToArray('marker').find(m=>m._paultendoPlace===place.id); assert.ok(marker);
  for(let n=0;n<13;n++) next(w);
  assert.ok(!w.regGet('marker',marker.id) || w.regGet('marker',marker.id).end);
  const restored=await makeGame({save:JSON.parse(JSON.stringify(w.generateSave()))});t.after(restored.close);
  const rw=restored.window, rt=rw.regGet('town',town.id),rp=rw.planet._paultendoLife.places[place.id];
  visit(rw,rt,rp); assert.match(panel(rw).textContent,/Journeys remembered.*Scouts from Wick/s);
  const fog=JSON.stringify(rw.planet._paultendoFog.explored); click(rw,'Look at this place');
  assert.equal(rw.selectedChunk,rw.planet.chunks[rp.id]); assert.equal(JSON.stringify(rw.planet._paultendoFog.explored),fog);
  assert.deepEqual(game.errors,[]); assert.deepEqual(restored.errors,[]);
});

test('a saved return whisper leads a real person back to the same ground and leaves another journey and traffic',async t=>{
  const game=await makeGame();t.after(game.close);const w=game.window,town=prepare(game),place=scout(w,town);
  w.planet.day+=30;
  const {record,person}=sendReturn(w,town,place);
  assert.equal(record.destination,place.id); assert.equal(record.resolved,false);
  const restored=await makeGame({save:JSON.parse(JSON.stringify(w.generateSave()))});t.after(restored.close);
  const rw=restored.window, rp=rw.planet._paultendoLife.places[place.id],pending=rw.planet._paultendoLife.whispers.at(-1);
  const traffic=rw.planet.chunks[place.id].v.road.traffic;
  next(rw);next(rw);
  assert.equal(pending.reception,'heard');assert.equal(pending.mission.place,place.id);
  assert.equal(rp.visits.length,2);assert.equal(rp.visits[1].person,person.id);assert.equal(rp.visits[1].whisper,pending.id);
  assert.ok(rw.planet.chunks[place.id].v.road.traffic>traffic);
  visit(rw,rw.regGet('town',town.id),rp);click(rw,'The words they carried');
  assert.match(panel(rw).textContent,/You whispered.*There is still something to learn.*led scouts on a return journey/s);
  assert.deepEqual(game.errors,[]);assert.deepEqual(restored.errors,[]);
});

test('actual settlement of a visited place adds one ownership memory and supports a hostile claim against its owner',async t=>{
  for(const changesHands of [false,true]) {
    const game=await makeGame();t.after(game.close);const w=game.window,town=prepare(game),place=scout(w,town);
    const rival=w.happen('Create',null,null,{x:place.x,y:place.y},'town');rival.name='Briar';rival.pop=40;rival.resources.crop=100;
    w.planet.unlocks.military=10;w.planet.day+=30;next(w);next(w);
    assert.equal(place.owner,rival.id);assert.equal(place.changes.length,1);assert.equal(place.changes[0].ownerName,'Briar');
    visit(w,town,place);assert.match(panel(w).textContent,/Briar claimed this ground/);
    const {record}=sendReturn(w,town,place,'conquer');assert.equal(record.claimedOwner,rival.id);
    if(changesHands) w.planet.chunks[place.id].v.s=town.id;
    w.planet.day=record.due-1;next(w);
    if(changesHands) {assert.equal(record.reception,'stalled');assert.equal(record.hostility,undefined);assert.match(record.steps[0].text,/ground has changed hands/);}
    else {assert.equal(record.partner,rival.id);assert.ok(record.hostility.relation<0 && record.hostility.pressure>0);}
    assert.deepEqual(game.errors,[]);
  }
});

test('places preserve known lost origins without revealing hidden places or unknown owners',async t=>{
  const game=await makeGame();t.after(game.close);const w=game.window,town=prepare(game),place=scout(w,town);
  const other=w.happen('Create',null,null,{x:place.x,y:place.y},'town');other.name='Hidden name';other._hidden=true;
  next(w);visit(w,town,place);assert.doesNotMatch(panel(w).textContent,/Hidden name/);
  const fog=w.planet._paultendoFog.explored[place.id];delete w.planet._paultendoFog.explored[place.id];
  w.openRegBrowser(town,'town');
  assert.equal([...w.document.querySelectorAll('.paultendoTownLife button')].some(b=>b.textContent===`Visit ${place.name}`),false);
  w.planet._paultendoFog.explored[place.id]=fog; town.end=w.planet.day;
  // The first origin was known when its scouts arrived. Its saved name remains factual after its end.
  other._hidden=false;w.openRegBrowser(w.regToArray('marker').find(m=>m._paultendoPlace===place.id),'marker');
  assert.match(panel(w).textContent,/Scouts from Wick/);
  assert.equal([...panel(w).querySelectorAll('[role="button"]')].some(b=>b.textContent==='Visit Wick'),false);
  assert.deepEqual(game.errors,[]);
});
