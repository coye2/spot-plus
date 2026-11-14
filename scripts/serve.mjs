import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const root = resolve(process.argv[2] || '.');
const port = Number(process.env.PORT || 8080);
const types = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css', '.png':'image/png', '.json':'application/json', '.webmanifest':'application/manifest+json', '.svg':'image/svg+xml', '.wav':'audio/wav', '.mp3':'audio/mpeg' };
createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    let file = resolve(root, '.' + pathname);
    if (file !== root && !file.startsWith(root + sep)) throw new Error('Invalid path');
    if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
    const bytes = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control':'no-cache', 'X-Content-Type-Options':'nosniff' });
    res.end(bytes);
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(port, '127.0.0.1', () => console.log(`Spot+ http://127.0.0.1:${port}`));
