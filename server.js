import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {dirname, extname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const types = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.otf': 'font/otf', '.json': 'application/json'};
const root = join(dirname(fileURLToPath(import.meta.url)), 'dist');

createServer(async (req, res) => {
  const clean = req.url.split('?')[0];
  const candidates = [clean === '/' ? 'index.html' : clean.slice(1)];
  // SPA fallback: /project/{id} routes are served by index.html.
  if (!extname(clean)) candidates.push('index.html');
  for (const path of candidates) {
    try {
      const data = await readFile(join(root, path));
      res.writeHead(200, {'content-type': types[extname(path)] || 'text/plain'});
      return res.end(data);
    } catch {}
  }
  res.writeHead(404);
  res.end('Not found');
}).listen(4173, () => console.log('http://localhost:4173'));
