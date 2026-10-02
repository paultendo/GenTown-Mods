import { JSDOM, VirtualConsole } from 'jsdom';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const root = new URL('../', import.meta.url);
export async function makeGame({ seed = 42, settings = {}, save, mod = true } = {}) {
  const errors = [];
  const console = new VirtualConsole();
  console.on('jsdomError', error => errors.push(error.cause || error));
  console.on('error', (...args) => errors.push(args));
  const html = readFileSync(new URL('index.html', root), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
  const dom = new JSDOM(html, { url: 'http://localhost:4173', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: console });
  const { window } = dom;
  window.structuredClone = structuredClone;
  let randomState = seed;
  window.Math.random = () => {
    randomState |= 0; randomState = randomState + 0x6D2B79F5 | 0;
    let t = Math.imul(randomState ^ randomState >>> 15, 1 | randomState);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
  const canvasDraws = new Map();
  window.HTMLCanvasElement.prototype.getContext = function() {
    const canvas = this;
    return new Proxy({ canvas, drawImage: () => canvasDraws.set(canvas.id, (canvasDraws.get(canvas.id) || 0) + 1), measureText: text => ({ width: String(text).length * 8 }), getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }) }, { get: (object, key) => key in object ? object[key] : () => {} });
  };
  window.scrollTo = () => {};
  window.localStorage.setItem('R74nMain-GenTownSettings', JSON.stringify(settings));
  if (save) window.localStorage.setItem('R74nMain-GenTownSave', JSON.stringify(save));
  const evaluate = path => new Script(readFileSync(new URL(path, root), 'utf8'), { filename: path }).runInContext(dom.getInternalVMContext());
  window.eval('gameVersion = "1.4"; saveVersion = "gt5";');
  for (const path of ['vendor/gentown/load.js', 'vendor/gentown/perlin.js', 'vendor/gentown/standalone.js', 'vendor/gentown/gentown-data.js', 'app/boot.js', 'vendor/gentown/gentown.js', 'vendor/gentown/gentown-mass.js']) evaluate(path);
  if (mod === true) evaluate('paultendo-mod.js');
  evaluate('app/ready.js');
  await new Promise(resolve => window.addEventListener('load', resolve, { once: true }));
  await new Promise(resolve => setTimeout(resolve, 50));
  const beforeLateDraws = canvasDraws.get('mapCanvas') || 0;
  if (mod === 'late') evaluate('paultendo-mod.js');
  return { window, errors, dom, evaluate, lateMapDraws: (canvasDraws.get('mapCanvas') || 0) - beforeLateDraws, close: () => window.close() };
}

export function settleGame(game) {
  const { window } = game;
  const chunk = window.filterChunks(chunk => chunk.b !== 'water' && chunk.b !== 'mountain')[0];
  if (!chunk) throw new Error('Seed contains no habitable land');
  window.mousePos = { chunkX: chunk.x, chunkY: chunk.y };
  window.onMapClick();
  return window.regToArray('town')[0];
}

export function fakeTimers(window) {
  let id = 0;
  const timers = new Map();
  window.setTimeout = (callback, delay) => { timers.set(++id, { callback, delay }); return id; };
  window.clearTimeout = id => timers.delete(id);
  return {
    timers,
    run(id) {
      const timer = timers.get(id);
      if (!timer) throw new Error(`Missing timer ${id}`);
      timers.delete(id);
      timer.callback();
    }
  };
}
