// Serves dist/ the way GitHub Pages serves a project site: under the build's
// base path, gzip for text types only, `Cache-Control: max-age=600`, no
// custom headers (so no COOP/COEP), ETag revalidation, and 404.html with
// status 404 on a miss.
//
//   node tools/pages/serve.mjs [--port 4321] [--dir dist]
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { pipeline } from 'node:stream';
import { createGzip } from 'node:zlib';

const args = new Map(process.argv.slice(2).flatMap((arg, i, all) => arg.startsWith('--') ? [[arg.slice(2), all[i + 1]]] : []));
const DIR = resolve(args.get('dir') ?? 'dist');
const PORT = Number(args.get('port') ?? 4321);
const html = readFileSync(join(DIR, 'index.html'), 'utf8');
const BASE = html.match(/<script type="module"[^>]*src="(\/[^"]*?)assets\//)?.[1] ?? '/';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm', '.glb': 'model/gltf-binary', '.hdr': 'application/octet-stream',
  '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg', '.txt': 'text/plain; charset=utf-8',
};
const GZIP = new Set(['.html', '.js', '.css', '.json', '.svg', '.wasm', '.txt']);

function send(req, res, file, status = 200) {
  const ext = extname(file);
  const headers = {
    'Content-Type': TYPES[ext] ?? 'application/octet-stream',
    'Cache-Control': 'max-age=600',
    'Accept-Ranges': 'bytes',
  };
  const { size, mtimeMs } = statSync(file);
  const etag = `"${size.toString(16)}-${Math.round(mtimeMs).toString(16)}"`;
  headers.ETag = etag;
  if (status === 200 && req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers);
    return res.end();
  }
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  if (range && status === 200 && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : size - Number(range[2]);
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
    return req.method === 'HEAD' ? res.end() : pipeline(createReadStream(file, { start, end }), res, () => {});
  }
  if (GZIP.has(ext) && /\bgzip\b/.test(req.headers['accept-encoding'] ?? '')) {
    res.writeHead(status, { ...headers, 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' });
    return req.method === 'HEAD' ? res.end() : pipeline(createReadStream(file), createGzip(), res, () => {});
  }
  res.writeHead(status, { ...headers, 'Content-Length': size });
  return req.method === 'HEAD' ? res.end() : pipeline(createReadStream(file), res, () => {});
}

createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (path === BASE.slice(0, -1)) {
    res.writeHead(301, { Location: BASE });
    return res.end();
  }
  if (path.startsWith(BASE)) {
    let file = normalize(join(DIR, path.slice(BASE.length)));
    if (file.startsWith(DIR) && existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (file.startsWith(DIR) && existsSync(file)) return send(req, res, file);
  }
  return send(req, res, join(DIR, '404.html'), 404);
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Serving ${DIR} at http://127.0.0.1:${PORT}${BASE}`);
});
