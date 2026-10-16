import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import en from '../src/i18n/en.json' with { type: 'json' };
import pt from '../src/i18n/pt-BR.json' with { type: 'json' };
import { LANGUAGES, DEFAULT_LANG } from '../src/i18n/index.js';

const ROOT = new URL('..', import.meta.url).pathname;
const files = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? files(p) : p.endsWith('.js') ? [p] : []; });
const holes = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

test('Portuguese is the default and every language has a file', () => {
  assert.equal(DEFAULT_LANG, 'pt-BR');
  assert.deepEqual(LANGUAGES.map((l) => l.id).sort(), ['en', 'pt-BR']);
});

test('both languages have the same keys and the same {placeholders}', () => {
  assert.deepEqual(Object.keys(pt).sort(), Object.keys(en).sort());
  for (const k of Object.keys(en)) assert.equal(holes(pt[k]), holes(en[k]), `placeholders of ${k}`);
});

test('every key the interface uses exists', () => {
  const used = new Set();
  for (const f of [...files(join(ROOT, 'src')).filter((f) => !f.endsWith('i18n/index.js')), join(ROOT, 'index.html')]) {
    const s = readFileSync(f, 'utf8');
    for (const m of s.matchAll(/\b(?:t|tr|tn)\(\s*'([a-zA-Z0-9_.-]+)'/g)) used.add(m[1]);
    for (const m of s.matchAll(/data-i18n(?:-html)?="([^"]+)"/g)) used.add(m[1]);
    for (const m of s.matchAll(/data-i18n-attr="([^"]+)"/g)) for (const pair of m[1].split(';')) used.add(pair.split(':')[1]);
  }
  for (const k of used) {
    if (k.endsWith('.dropped')) { assert.ok(en[k + '.one'] && en[k + '.other'], k); continue; }
    assert.ok(k in en, `missing key ${k}`);
  }
});

test('names exist for every piece, finish, template, room type, style and atmosphere', async () => {
  const ctx2d = () => new Proxy({}, { get: () => () => ctx2d() });
  globalThis.document ??= { createElement: () => ({ width: 0, height: 0, getContext: ctx2d }) };
  const { CATALOG } = await import('../src/catalog.js');
  const { FINISHES } = await import('../src/finishes.js');
  const { TEMPLATES } = await import('../src/templates.js');
  const { ROOM_TYPE_IDS } = await import('../src/roomTypes.js');
  const { STYLES } = await import('../src/styles.js');
  const { ATMOSPHERES } = await import('../src/atmospheres.js');
  for (const d of CATALOG) assert.ok(pt[`piece.${d.id}`], d.id);
  for (const f of FINISHES) assert.ok(pt[`finish.${f.mat}.${f.id}`], f.id);
  for (const t of TEMPLATES) assert.ok(pt[`template.${t.id}`] && pt[`template.${t.id}.tip`], t.id);
  for (const id of ROOM_TYPE_IDS) assert.ok(pt[`roomType.${id}`], id);
  for (const s of STYLES) assert.ok(pt[`style.${s.id}`], s.id);
  for (const a of ATMOSPHERES) assert.ok(pt[`atmo.${a.id}`], a.id);
});

test('default room names show in the current language; chosen names stay', async () => {
  const { roomName } = await import('../src/i18n/names.js');
  const { setLang } = await import('../src/i18n/index.js');
  setLang('pt-BR');
  assert.equal(roomName('Living room'), 'Sala de estar');
  assert.equal(roomName('Bedroom 2'), 'Quarto 2');
  assert.equal(roomName('Japandi studio'), 'Studio japandi');
  assert.equal(roomName("Ana's room"), "Ana's room");
  setLang('en');
  assert.equal(roomName('Sala de estar'), 'Living room');
  setLang('pt-BR');
});
