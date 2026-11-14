// Project checks used in CI: every catalog track has media, layers are valid,
// the page references files that exist, and the media budget stays small.
// Run: node tools/check.mjs

import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const fail = (msg) => errors.push(msg);

// catalog.js imports analysis.js, which only touches the DOM inside the class, so it loads in Node.
const { TRACKS, THEMES, CUSTOM_TRACK } = await import(pathToFileURL(path.join(root, 'js', 'catalog.js')).href);
const manifest = JSON.parse(readFileSync(path.join(root, 'media', 'manifest.json'), 'utf8'));

const ROLES = new Set(['melody', 'pad', 'bass', 'perc', 'texture']);
const themeIds = new Set(THEMES.map((t) => t.id));
const seen = new Set();

for (const t of [...TRACKS, CUSTOM_TRACK]) {
  if (seen.has(t.id)) fail(`duplicate track id: ${t.id}`);
  seen.add(t.id);
  for (const key of ['title', 'short', 'see', 'hear', 'credit', 'key', 'mode']) {
    if (!t[key]) fail(`${t.id}: missing "${key}"`);
  }
  if (t.see && t.see.length < 120 && t.id !== 'custom') fail(`${t.id}: "see" description is too short for screen-reader users`);
  if (!t.layers?.length) fail(`${t.id}: no layers`);
  const layerIds = new Set();
  for (const l of t.layers ?? []) {
    if (layerIds.has(l.id)) fail(`${t.id}: duplicate layer ${l.id}`);
    layerIds.add(l.id);
    if (!ROLES.has(l.role)) fail(`${t.id}/${l.id}: unknown role ${l.role}`);
    if (typeof l.match !== 'function' || typeof l.value !== 'function') fail(`${t.id}/${l.id}: match/value must be functions`);
    if (!/^#[0-9a-f]{6}$/i.test(l.color)) fail(`${t.id}/${l.id}: color must be #rrggbb`);
    for (const [h, s, v] of [[0, 1, 1], [120, 0.5, 0.5], [240, 1, 0.2], [60, 0, 1]]) {
      const w = l.match(h, s, v);
      const val = l.value(h, s, v);
      if (!(w >= 0 && w <= 1) || !(val >= 0 && val <= 1)) fail(`${t.id}/${l.id}: match/value out of 0..1 for hsv(${h},${s},${v})`);
    }
  }
  if (t.id === 'custom') continue;
  if (!themeIds.has(t.theme)) fail(`${t.id}: unknown theme ${t.theme}`);
  const m = manifest[t.id];
  if (!m) { fail(`${t.id}: not in media/manifest.json (run tools/build_media.py)`); continue; }
  for (const f of [m.video, m.poster]) if (!existsSync(path.join(root, f))) fail(`${t.id}: missing ${f}`);
  if (m.svs !== t.svs) fail(`${t.id}: SVS id mismatch catalog ${t.svs} vs manifest ${m.svs}`);
}

for (const id of Object.keys(manifest)) if (!seen.has(id)) fail(`manifest has unknown track ${id}`);

// Media budget: GitHub Pages sites should stay light for visitors on slow connections.
const totalMB = Object.values(manifest).reduce((s, m) => s + statSync(path.join(root, m.video)).size, 0) / 1e6;
if (totalMB > 60) fail(`media total ${totalMB.toFixed(1)} MB exceeds 60 MB budget`);

// Every local src/href in index.html must exist.
const html = readFileSync(path.join(root, 'index.html'), 'utf8');
for (const [, ref] of html.matchAll(/(?:src|href)="([^"#:]+)"/g)) {
  if (!existsSync(path.join(root, ref))) fail(`index.html references missing file ${ref}`);
}
for (const id of ['player', 'video', 'overlay', 'voice', 'live', 'mixer', 'genre']) {
  if (!html.includes(`id="${id}"`)) fail(`index.html is missing #${id}`);
}
if (!/<html lang="/.test(html)) fail('index.html needs a lang attribute');

if (errors.length) {
  console.error(`✗ ${errors.length} problem(s):\n  - ${errors.join('\n  - ')}`);
  process.exit(1);
}
console.log(`✓ ${TRACKS.length} tracks, ${Object.keys(manifest).length} clips, ${totalMB.toFixed(1)} MB media, page references OK`);
