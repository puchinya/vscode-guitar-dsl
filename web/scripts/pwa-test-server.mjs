import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const port = Number(process.env.PORT ?? 4179);
const worker = await readFile(join(root, 'sw.js'), 'utf8');
const revision = worker.match(/revision:"([0-9a-f]+)"/u)?.[1];
if (!revision) throw new Error('Built service worker does not contain a Workbox revision.');
const updatedWorker = worker.replace(`revision:"${revision}"`, `revision:"${revision}1"`);
let updateEnabled = false;

const mimeTypes = new Map([
  ['.css', 'text/css; charset=utf-8'], ['.html', 'text/html; charset=utf-8'], ['.ico', 'image/x-icon'],
  ['.js', 'text/javascript; charset=utf-8'], ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'], ['.svg', 'image/svg+xml'], ['.ttf', 'font/ttf'], ['.webmanifest', 'application/manifest+json']
]);

createServer(async (request, response) => {
  const pathname = new URL(request.url ?? '/', `http://${request.headers.host}`).pathname;
  if (pathname === '/__test/enable-update' && request.method === 'POST') {
    updateEnabled = true;
    response.writeHead(204).end();
    return;
  }
  if (pathname === '/sw.js' && updateEnabled) {
    response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' }).end(updatedWorker);
    return;
  }

  let relativePath = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
  relativePath = normalize(relativePath).replace(/^([/\\]|\.\.(?:[/\\]|$))+/u, '');
  let filePath = join(root, relativePath);
  try {
    if (!(await stat(filePath)).isFile()) throw new Error('Not a file');
  } catch {
    if (!extname(relativePath)) filePath = join(root, 'index.html');
    else {
      response.writeHead(404).end('Not found');
      return;
    }
  }
  try {
    const body = await readFile(filePath);
    const headers = { 'content-type': mimeTypes.get(extname(filePath)) ?? 'application/octet-stream' };
    if (extname(filePath) === '.js' && filePath.endsWith('/sw.js')) headers['cache-control'] = 'no-store';
    response.writeHead(200, headers).end(body);
  } catch {
    response.writeHead(404).end('Not found');
  }
}).listen(port, '127.0.0.1', () => process.stdout.write(`PWA production test server listening on 127.0.0.1:${port}\n`));
