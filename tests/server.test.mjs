import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createDevServer } from '../scripts/serve.mjs';

test('local server serves the game and its assets, and excludes repository internals', async t => {
  const server = createDevServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const path of ['/', '/paultendo-mod.js', '/vendor/gentown/gentown.js', '/app/boot.js', '/icons/neutral.png', '/vendor/gentown/fonts/VT323-Regular.ttf']) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.ok((await response.arrayBuffer()).byteLength > 0);
  }
  for (const path of ['/.git/config', '/package.json', '/app/%2e%2e/%2e%2e/.git/config']) {
    assert.equal((await fetch(base + path)).status, 404, path);
  }
  assert.equal((await fetch(base, { method: 'POST' })).status, 405);
});
