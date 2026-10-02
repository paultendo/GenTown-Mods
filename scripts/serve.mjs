import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.ttf': 'font/ttf', '.txt': 'text/plain' };
export function createDevServer() {
  return createServer(async (req, res) => {
    try {
      if (!['GET', 'HEAD'].includes(req.method)) {
        res.writeHead(405, { Allow: 'GET, HEAD' }).end();
        return;
      }
      const url = new URL(req.url, 'http://localhost');
      const name = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
      const allowed = ['index.html', 'paultendo-mod.js', 'hot-swap-mod.js', 'world-configurator.js', 'whirl-load.js', 'example_mod.js', 'better_mod_loader.mjs', 'mods.json'].includes(name)
        || /^(app|icons|vendor\/gentown)\/[a-zA-Z0-9_./-]+$/.test(name);
      const path = resolve(root, name);
      if (!allowed || !path.startsWith(root + sep) || name.split('/').includes('..')) {
        res.writeHead(404).end('Not found');
        return;
      }
      let data = await readFile(path);
      // Exercise the real Add Mod flow against the same current engine.
      if (name === 'index.html' && url.searchParams.has('vanilla')) {
        data = Buffer.from(data.toString().replace(/<script[^>]*src="(?:paultendo-mod\.js|app\/ready\.js)"[^>]*><\/script>/g, ''));
      }
      res.writeHead(200, { 'Content-Type': `${types[extname(path)] || 'application/octet-stream'}${['.html', '.js', '.mjs', '.json', '.css', '.txt'].includes(extname(path)) ? '; charset=utf-8' : ''}`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch (error) {
      res.writeHead(error instanceof URIError ? 400 : 404).end('Not found');
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4173);
  const server = createDevServer();
  server.on('error', error => {
    console.error(error.code === 'EADDRINUSE' ? `Port ${port} is in use. Try PORT=${port + 1} npm start.` : error.message);
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => console.log(`GenTown is ready at http://127.0.0.1:${port}\nPress Ctrl+C to stop.`));
}
