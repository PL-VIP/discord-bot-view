import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { handleDiscord } from './api/discord.js';

const root = resolve(import.meta.dirname);
const mime = {
  '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8',
  '.js':'text/javascript; charset=utf-8', '.svg':'image/svg+xml', '.ico':'image/x-icon'
};
const port = Number(process.env.PORT || 3000);

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost:3000'}`);
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Cache-Control','no-store');
    if (url.pathname === '/api/discord') {
      const request = new Request(url, {
        method: req.method, headers: req.headers,
        ...(req.method !== 'GET' && req.method !== 'HEAD' ? {body:Readable.toWeb(req),duplex:'half'} : {})
      });
      const response = await handleDiscord(request);
      res.statusCode = response.status;
      for (const [key,val] of response.headers) res.setHeader(key,val);
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
    const file = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const path = resolve(join(root,file));
    if (path !== root && !path.startsWith(root+sep)) { res.writeHead(403);res.end();return; }
    // Allow only explicitly public assets; no exposure of .env, tests, or server code.
    if (!['index.html','app.js','styles.css','favicon.svg'].includes(file)) { res.writeHead(404); res.end('Not found'); return; }
    const bytes = await readFile(path);
    res.writeHead(200,{'Content-Type':mime[extname(path)] || 'application/octet-stream'});
    res.end(req.method === 'HEAD' ? undefined : bytes);
  } catch { res.writeHead(500); res.end('Server error'); }
});
server.listen(port, () => console.log(`BotView lokalnie: http://localhost:${port}`));
