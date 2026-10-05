import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {makeGame,settleGame} from './harness.mjs';

const factory=readFileSync(new URL('../app/sprites/renderer.js',import.meta.url),'utf8');
const source=readFileSync(new URL('../app/sprites/data.js',import.meta.url),'utf8');
const data=runInNewContext(source+';PAULTENDO_SPRITE_DATA');
const create=()=>runInNewContext(factory+';createPaultendoSpriteRenderer')(data);
const objects=['compass','clear-lens','tuning-fork'];

test('indexed art has complete 32x32 grids, valid semantic regions and transparent padding',()=>{
    const distributable=readFileSync(new URL('../paultendo-mod.js',import.meta.url),'utf8');
    assert.ok(distributable.includes(factory),'The tested renderer must be embedded in the distributable');
    assert.ok(distributable.includes('const SPRITE_DATA = '+JSON.stringify(data)+';'),'The tested art must be embedded in the distributable');
    assert.equal(Object.keys(data.sprites).length,20);
    assert.deepEqual(Object.keys(data.overlays).sort(),['cracked','repaired','worn']);
    for(const [id,sprite] of Object.entries({...data.sprites,...data.overlays})){
        assert.equal(sprite.rows.length,32,id);assert.equal(sprite.regions.length,32,id);
        const mask=sprite.rows.join(''),regions=sprite.regions.join('');
        assert.equal(mask.length,1024,id);assert.equal(regions.length,1024,id);
        assert.match(mask,/^[0-9a-f]+$/);assert.match(regions,/^[.obafs]+$/);
        for(let i=0;i<1024;i++){
            const pixel=parseInt(mask[i],16);assert.ok(pixel<sprite.palette.length,id);
            assert.equal(regions[i]==='.',pixel===0,id);
        }
        if(data.sprites[id]){
            assert.ok(mask.startsWith('0'.repeat(32)),id);assert.ok(mask.endsWith('0'.repeat(32)),id);
        }
    }
});

test('material and decoration ramps affect their own regions and preserve fixed features',()=>{
    const renderer=create();
    for(const id of objects){
        const original=renderer.pixels(id),regions=data.sprites[id].regions.join('');
        assert.ok(regions.includes('a'),id+' needs a decoration region');
        for(const material of renderer.materials)for(const accent of renderer.accents){
            const materialOnly=renderer.pixels(id,{material}),decorationOnly=renderer.pixels(id,{accent});
            let materialChanges=0,accentChanges=0;
            for(let i=0;i<1024;i++){
                if(regions[i]!=='b')assert.equal(materialOnly[i],original[i],id+' material');
                else materialChanges+=materialOnly[i]!==original[i];
                if(regions[i]!=='a')assert.equal(decorationOnly[i],original[i],id+' accent');
                else accentChanges+=decorationOnly[i]!==original[i];
            }
            assert.ok(materialChanges>0,id+' material changed');assert.ok(accentChanges>0,id+' decoration changed');
        }
    }
});

test('all overlays visibly affect each object while preserving padding, outlines and fixed details',()=>{
    const renderer=create();
    for(const id of [...objects,'stone-tools','metal-tools','steel-tools'])for(const overlays of [['worn'],['cracked'],['repaired'],['worn','cracked','repaired']]){
        const base=renderer.pixels(id,{material:'steel',accent:'sea'});
        const decorated=renderer.pixels(id,{material:'steel',accent:'sea',overlays});
        const regions=data.sprites[id].regions.join('');let changed=0;
        for(let i=0;i<1024;i++){
            if(!['b','a','s'].includes(regions[i]))assert.equal(decorated[i],base[i],id+' clipping');
            changed+=decorated[i]!==base[i];
        }
        assert.ok(changed>0,id+' '+overlays.join(','));
    }
});

test('renderer is deterministic, rejects unsafe options and bounds its variant cache',()=>{
    const renderer=create();
    for(const id of ['unknown','__proto__','constructor'])for(const method of ['render','svg','pixels'])assert.equal(renderer[method](id),null);
    assert.equal(renderer.render('compass',{material:'<script>',accent:'red" onload="evil',overlays:['bad']}),renderer.render('compass'));
    const same=renderer.render('compass',{material:'steel',accent:'sea',overlays:['cracked','worn']});
    assert.equal(same,renderer.render('compass',{material:'steel',accent:'sea',overlays:['worn','cracked','cracked']}));
    for(const id of objects)for(const material of renderer.materials)for(const accent of renderer.accents)for(const overlays of [[],['worn'],['cracked'],['repaired']])renderer.render(id,{material,accent,overlays});
    assert.equal(renderer.cacheSize,renderer.cacheLimit);assert.equal(renderer.cacheLimit,128);
    assert.equal(same,renderer.render('compass',{material:'steel',accent:'sea',overlays:['worn','cracked']}));
    assert.match(decodeURIComponent(same),/shape-rendering="crispEdges"/);
    assert.doesNotMatch(decodeURIComponent(same),/<script|<image|https?:\/\/(?!www.w3.org)/);
});

test('single-file mod renders new icons with labels and leaves native resource icons intact',async t=>{
    const g=await makeGame();t.after(g.close);const w=g.window;
    assert.equal(w.PaultendoSprites.ids.length,20);
    for(const type of ['clay','brick','paper','steel','stone_tools','coastal_boat']){
        const line=w.document.createElement('div');line.innerHTML=w.parseText(`{{icon:${type}|Material}}`);
        const img=line.querySelector('img');assert.ok(img,type);assert.equal(img.alt,'Material');
        assert.ok(img.src.startsWith('data:image/svg+xml,'));assert.equal(img.getAttribute('width'),'32');
    }
    assert.match(w.parseText('{{icon:crop|Grain}}'),/icons\/crop\.png/);
    assert.deepEqual(g.errors,[]);
});

test('discovered materials keep their counts and workshop controls beside decorative sprites',async t=>{
    const g=await makeGame();t.after(g.close);const w=g.window,town=settleGame(g);
    const types=['clay','paper','charcoal','brick','sand','glass','coal','steel','pottery','timber_bins','glass_vessels','stone_tools','metal_tools','steel_tools','coastal_boat','sailing_vessel','telescope'];
    town._paultendoMaterials={};
    for(const type of types){town._paultendoMaterials[type]={sources:[],day:1};town.resources[type]=7;}
    w.openRegBrowser(town,'town');
    assert.equal(w.document.querySelectorAll('.regSectionValue .paultendoSprite').length,17,'Native town inventory includes the same sprites');
    const button=[...w.document.querySelectorAll('.paultendoTownLife button')].find(b=>b.textContent==='Materials and workshops');assert.ok(button);button.click();
    const panel=w.document.getElementById('actionSubList');
    assert.equal(panel.querySelectorAll('[data-sprite]').length,17);
    assert.equal((panel.textContent.match(/7 in store/g)||[]).length,17);
    for(const image of panel.querySelectorAll('[data-sprite]')){assert.equal(image.alt,'');assert.equal(image.getAttribute('aria-hidden'),'true');}
    const back=panel.querySelector('[role="button"]');assert.ok(back);back.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
    assert.ok(w.document.querySelector('.paultendoTownLife'));assert.deepEqual(g.errors,[]);
});

test('Traveler images survive placement, renaming, reload and changes of owner without consuming randomness',async t=>{
    const g=await makeGame();t.after(g.close);const w=g.window,town=settleGame(g);town.name='Wick';
    const panel=()=>w.document.getElementById('actionSubList');
    const click=text=>{const node=[...panel().querySelectorAll('[role="button"]')].find(n=>n.textContent.includes(text));assert.ok(node,text);node.click();};
    w.document.getElementById('actionItem-annals').click();click('The Traveler');click('What you carried');
    assert.equal(panel().querySelectorAll('[data-sprite]').length,3);
    click('Compass');click('Leave it at Near Wick');
    const artifact=w.planet._paultendoLife.artifacts.at(-1);
    const random=w.Math.random;let calls=0;w.Math.random=()=>{calls++;return random();};
    artifact.origin.maker={name:'Ada',town:'Wick',materials:{steel:3}};
    artifact.appearance={material:'steel',accent:'berry',overlays:['repaired']};
    const look=JSON.parse(JSON.stringify(w.PaultendoSprites.artifactAppearance(artifact)));
    const before=w.PaultendoSprites.render('compass',look);
    artifact.town=999;artifact.title='Ada’s Needle';
    assert.deepEqual(JSON.parse(JSON.stringify(w.PaultendoSprites.artifactAppearance(artifact))),look);
    assert.equal(calls,0);w.Math.random=random;
    const save=JSON.parse(JSON.stringify(w.generateSave()));
    const restored=await makeGame({save});t.after(restored.close);
    const copy=restored.window.planet._paultendoLife.artifacts.find(a=>a.id===artifact.id);
    assert.equal(restored.window.PaultendoSprites.render('compass',restored.window.PaultendoSprites.artifactAppearance(copy)),before);
    copy.status='broken';assert.ok(restored.window.PaultendoSprites.artifactAppearance(copy).overlays.includes('cracked'));
    assert.deepEqual(g.errors,[]);assert.deepEqual(restored.errors,[]);
});
