// The production build: copies just what the site needs (the page, its styles,
// the app's modules and the assets) into dist/, and checks that every file the
// app's modules import is there. No bundler: the browser loads the ES modules
// as they are, and three.js and the AI libraries come from jsDelivr.
// Usage: node scripts/build.mjs   (npm run build)
import { cpSync, rmSync, mkdirSync, readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname), OUT = join(ROOT, 'dist');
const SITE = ['index.html', 'style.css', 'src', 'assets'];

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT);
for (const p of SITE) cpSync(join(ROOT, p), join(OUT, p), { recursive: true, filter: (f) => !/\.DS_Store$/.test(f) });

// every relative import in the modules must resolve inside dist/
const missing = [];
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
for (const file of walk(join(OUT, 'src')).filter((f) => f.endsWith('.js'))) {
  const code = readFileSync(file, 'utf8');
  for (const m of code.matchAll(/(?:import|export)[^'"]*?from\s*['"](\.{1,2}\/[^'"]+)['"]|new URL\(['"](\.{1,2}\/[^'"]+)['"],\s*import\.meta\.url\)/g)) {
    const target = resolve(dirname(file), m[1] || m[2]);
    if (!existsSync(target)) missing.push(`${relative(OUT, file)} → ${m[1] || m[2]}`);
  }
}
if (missing.length) { console.error('Missing files:\n' + missing.join('\n')); process.exit(1); }

const size = (d) => walk(d).reduce((s, f) => s + statSync(f).size, 0);
console.log(`dist/ ready: ${(size(OUT) / 1e6).toFixed(1)} MB (${walk(OUT).length} files)`);
