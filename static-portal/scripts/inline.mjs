// Turns the Vite build into ONE file: dist/index.html with the script, styles, fonts and icon inside.
// Browsers do not load <script type="module" src="..."> from file://, but inline scripts work, so the
// result opens by double-click with no web server.
import { readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const htmlPath = join(dist, 'index.html');
let html = readFileSync(htmlPath, 'utf8');

const read = (rel) => readFileSync(join(dist, rel.replace(/^\.\//, '')), 'utf8');

let scripts = 0;
html = html.replace(/<script type="module" crossorigin src="([^"]+)"><\/script>/g, (_, src) => {
  scripts++;
  // "</script" inside the code would end the tag early.
  return `<script type="module">${read(src).replace(/<\/script/gi, '<\\/script')}</script>`;
});

let styles = 0;
html = html.replace(/<link rel="stylesheet" crossorigin href="([^"]+)">/g, (_, href) => {
  styles++;
  return `<style>${read(href)}</style>`;
});

html = html.replace(/<link rel="icon" type="image\/svg\+xml" href="([^"]+)"\s*\/?>/, (_, href) => {
  const svg = readFileSync(join(dist, href.replace(/^\.\//, '')));
  return `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,${svg.toString('base64')}" />`;
});

if (scripts !== 1 || styles !== 1) {
  console.error(`inline.mjs: expected 1 script and 1 stylesheet, found ${scripts} and ${styles}`);
  process.exit(1);
}
if (/src="\.\/assets|href="\.\/assets/.test(html)) {
  console.error('inline.mjs: some assets were not inlined');
  process.exit(1);
}

writeFileSync(htmlPath, html);
for (const leftover of ['assets', 'favicon.svg']) {
  const p = join(dist, leftover);
  if (existsSync(p)) rmSync(p, { recursive: true, force: true });
}
console.log(`dist/index.html is self-contained (${(html.length / 1024).toFixed(0)} KB). Open it in a browser; no server needed.`);
