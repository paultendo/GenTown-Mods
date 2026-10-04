import { JSDOM, VirtualConsole } from 'jsdom';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const root = new URL('../../', import.meta.url);
export async function makeGame({ seed = 42, settings = {}, save, mod = true, beforeMod, afterMod, localBoot = true, virtualTime = false } = {}) {
  const errors = [];
  const warnings = [];
  const console = new VirtualConsole();
  console.on('jsdomError', error => errors.push(error.cause || error));
  console.on('error', (...args) => errors.push(args));
  console.on('warn', (...args) => warnings.push(args));
  const html = readFileSync(new URL('index.html', root), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
  const dom = new JSDOM(html, { url: 'http://localhost:4173', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: console });
  const { window } = dom;
  // GenTown capitalises an affix through innerText. jsdom does not implement
  // this browser property, so provide its plain-text subset for logic tests.
  if (!('innerText' in window.HTMLElement.prototype)) Object.defineProperty(window.HTMLElement.prototype, 'innerText', {
    get() { return this.textContent; }, set(value) { this.textContent = value; }
  });
  window.structuredClone = structuredClone;
  const clock = virtualTime ? installClock(window, seed) : null;
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
  for (const path of ['vendor/gentown/load.js', 'vendor/gentown/perlin.js', 'vendor/gentown/standalone.js', 'vendor/gentown/gentown-data.js', 'app/boot.js', 'vendor/gentown/gentown.js', 'vendor/gentown/gentown-mass.js']) { if (localBoot || path !== 'app/boot.js') evaluate(path); }
  beforeMod?.(window);
  if (mod === true) evaluate('paultendo-mod.js');
  afterMod?.(window);
  evaluate('app/ready.js');
  await new Promise(resolve => window.addEventListener('load', resolve, { once: true }));
  if (clock) clock.advance(50);
  else await new Promise(resolve => setTimeout(resolve, 50));
  const beforeLateDraws = canvasDraws.get('mapCanvas') || 0;
  if (mod === 'late') evaluate('paultendo-mod.js');
  return { window, errors, warnings, clock, randomState: () => randomState >>> 0, dom, evaluate, lateMapDraws: (canvasDraws.get('mapCanvas') || 0) - beforeLateDraws, close: () => window.close() };
}

// Campaigns use a separate seeded stream for IDs, leaving the engine's random
// event stream alone. Timers still run, but no simulated day waits a real second.
function installClock(window, seed) {
  let now = 0, nextId = 0, idState = (seed ^ 0x9E3779B9) >>> 0;
  const epoch = Date.UTC(2026, 0, 1), timers = new Map(), NativeDate = window.Date;
  window.Date = class extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [epoch + now])); }
    static now() { return epoch + now; }
  };
  window.crypto.getRandomValues = array => {
    if (!ArrayBuffer.isView(array) || array instanceof window.DataView || /Float/.test(array.constructor.name)) throw new TypeError('Expected an integer typed array');
    const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
    for (let i = 0; i < bytes.length; i++) {
      idState = Math.imul(idState, 1664525) + 1013904223 >>> 0;
      bytes[i] = idState >>> 24;
    }
    return array;
  };
  const schedule = (callback, delay, repeat, args) => {
    if (typeof callback !== 'function') throw new TypeError('Campaign timers require a callback');
    const interval = Math.max(1, Number(delay) || 0), id = ++nextId;
    timers.set(id, { callback, args, at: now + interval, interval: repeat ? interval : 0 });
    return id;
  };
  window.setTimeout = (callback, delay, ...args) => schedule(callback, delay, false, args);
  window.setInterval = (callback, delay, ...args) => schedule(callback, delay, true, args);
  window.clearTimeout = window.clearInterval = id => timers.delete(id);
  window.requestAnimationFrame = callback => schedule(() => callback(now), 16, false, []);
  window.cancelAnimationFrame = window.clearTimeout;
  return {
    get now() { return now; },
    advance(milliseconds) {
      const until = now + milliseconds;
      for (let count = 0; ; count++) {
        let next;
        for (const [id, timer] of timers) if (timer.at <= until && (!next || timer.at < next[1].at)) next = [id, timer];
        if (!next) break;
        if (count >= 10000) throw new Error('More than 10000 timer callbacks in one campaign step');
        const [id, timer] = next;
        now = timer.at;
        if (timer.interval) timer.at += timer.interval;
        else timers.delete(id);
        timer.callback(...timer.args);
      }
      now = until;
    }
  };
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
