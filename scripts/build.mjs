import {build} from 'esbuild';
import {mkdir, rm, copyFile} from 'node:fs/promises';

// Browser-safe values only. Secrets (service role, Pinterest app secret, token keys)
// must never be read here — they live exclusively in server-side environments.
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL || '';
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '';

const define = {
  __SUPABASE_URL__: JSON.stringify(SUPABASE_URL),
  __SUPABASE_PUBLISHABLE_KEY__: JSON.stringify(SUPABASE_PUBLISHABLE_KEY),
};

await rm('dist', {recursive: true, force: true});
await mkdir('dist/src', {recursive: true});
await copyFile('index.html', 'dist/index.html');
await copyFile('src/styles.css', 'dist/src/styles.css');
await copyFile('src/pinterest.css', 'dist/src/pinterest.css');

for (const entry of ['src/route-bootstrap.js', 'src/app.js', 'src/zip-ui.js']) {
  await build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2020',
    outfile: `dist/${entry}`,
    define,
    logLevel: 'info',
  });
}

if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
  console.warn('[build] SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY not set — the app will show its configuration screen.');
}
