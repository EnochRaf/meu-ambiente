// Tiny static file server for local use: no dependencies, sensible MIME types,
// a large connection backlog (the app loads ~60 modules at once), and no
// directory escapes. /api/make3d runs the same function Vercel runs (api/make3d.js),
// with a mock provider unless FAL_KEY is set. Usage: node scripts/serve.mjs [port] [folder]  (folder: dist to try the production build)
import http from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname, process.argv[3] || '.');
const port = Number(process.argv[2] || process.env.PORT || 8765);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.webp': 'image/webp', '.onnx': 'application/octet-stream', '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json', '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon' };

const api = import(new URL('../api/make3d.js', import.meta.url)).then((m) => m.default);
const server = http.createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path === '/api/make3d') { try { return await (await api)(req, res); } catch (e) { res.writeHead(500).end(String(e)); return; } }
  let file = normalize(join(root, path));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  try {
    if (statSync(file).isDirectory()) file = join(file, 'index.html');
    const st = statSync(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'no-cache' });
    createReadStream(file).pipe(res);
  } catch { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found'); }
});
server.listen({ port, host: '127.0.0.1', backlog: 1024 }, () => console.log(`Meu Ambiente at http://127.0.0.1:${port}/`));
