// The build embeds this factory and its indexed art in paultendo-mod.js.
// No canvas, image downloads, timers, or simulation randomness are required.
function createPaultendoSpriteRenderer(data) {
    'use strict';
    const cache = new Map(), limit = 128;
    const ramps = {
        iron: ['#303337','#545b60','#838d90','#bac4c2'],
        steel: ['#293640','#506878','#91adba','#d9e6e6'],
        brass: ['#45331d','#87662e','#bc9a48','#ead58b'],
        timber: ['#39291e','#6c472b','#a77945','#d7b075'],
        clay: ['#4c2920','#8f4430','#c47551','#f1b184'],
        glass: ['#26484b','#46838a','#8dc4c7','#e2f4e9'],
        stone: ['#343337','#615e63','#939094','#c9c3b9']
    };
    const accents = {
        ochre: ['#513d1c','#947437','#cbb566','#f2df9d'],
        sea: ['#173b3d','#327477','#72b4ad','#c5e4d0'],
        berry: ['#422839','#80516b','#ba8b9f','#ecd3d6'],
        moss: ['#28382a','#526947','#8ca572','#cfdbad'],
        ember: ['#4d2822','#93513c','#d29466','#f4d0a0'],
        blue: ['#253044','#4a648d','#91aed2','#d8e1ed']
    };
    const safeColour = colour => /^#[a-f\d]{6}$/i.test(colour) ? colour : '#e2dfca';
    const normalise = options => ({
        material: Object.hasOwn(ramps, options?.material) ? options.material : null,
        accent: Object.hasOwn(accents, options?.accent) ? options.accent : null,
        overlays: ['worn','cracked','repaired'].filter(name => Array.isArray(options?.overlays) && options.overlays.includes(name))
    });
    function pixels(id, options = {}) {
        if (!Object.hasOwn(data.sprites,id)) return null;
        const sprite = data.sprites[id];
        if (!sprite) return null;
        const look = normalise(options);
        const mask = sprite.rows.join('');
        const regions = sprite.regions.join('');
        const result = [...mask].map((code,i) => {
            const index = parseInt(code,16);
            if (!index) return null;
            const entry = sprite.palette[index];
            const ramp = regions[i] === 'b' && look.material ? ramps[look.material] : regions[i] === 'a' && look.accent ? accents[look.accent] : null;
            return ramp ? ramp[Math.max(0,Math.min(3,entry.shade || 0))] : safeColour(entry.colour);
        });
        for (const name of look.overlays) {
            const overlay = data.overlays[name];
            if (!overlay) continue;
            const marks = overlay.rows.join('');
            const offset = sprite.overlayOffsets?.[name] || {x:0,y:0};
            for (let i = 0; i < result.length; i++) {
                const x = i % 32 - offset.x, y = Math.floor(i / 32) - offset.y;
                const original = parseInt(mask[i], 16);
                const mark = x >= 0 && x < 32 && y >= 0 && y < 32 ? parseInt(marks[y * 32 + x], 16) : 0;
                // Glass surfaces can crack without being recoloured. Bindings
                // stay on the frame. Dial markings, reflections and outlines
                // are fixed features and always remain untouched.
                const allowed=name==='repaired'?['b','a']:['b','a','s'];
                if (original && mark && allowed.includes(regions[i])) {
                    result[i] = safeColour(overlay.palette[mark]?.colour);
                }
            }
        }
        return result;
    }
    function svg(id, options = {}) {
        const image = pixels(id, options);
        if (!image) return null;
        const paths = new Map();
        for (let y = 0; y < 32; y++) for (let x = 0; x < 32;) {
            const colour = image[y * 32 + x];
            let end = x + 1;
            while (end < 32 && image[y * 32 + end] === colour) end++;
            if (colour) paths.set(colour, (paths.get(colour) || '') + `M${x} ${y}h${end-x}v1h-${end-x}z`);
            x = end;
        }
        return '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" shape-rendering="crispEdges">' + [...paths].map(([fill,d]) => `<path fill="${fill}" d="${d}"/>`).join('') + '</svg>';
    }
    function render(id, options = {}) {
        if (!Object.hasOwn(data.sprites,id)) return null;
        const key = id + ':' + JSON.stringify(normalise(options));
        if (cache.has(key)) {
            const value = cache.get(key); cache.delete(key); cache.set(key,value); return value;
        }
        const value = 'data:image/svg+xml,' + encodeURIComponent(svg(id,options));
        cache.set(key,value);
        if (cache.size > limit) cache.delete(cache.keys().next().value);
        return value;
    }
    return Object.freeze({ render, svg, pixels, normalise, ids: Object.freeze(Object.keys(data.sprites)),
        materials: Object.freeze(Object.keys(ramps)), accents: Object.freeze(Object.keys(accents)),
        get cacheSize() { return cache.size; }, cacheLimit: limit });
}
