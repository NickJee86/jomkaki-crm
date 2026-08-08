import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../brand-refresh.css',import.meta.url),'utf8');
const logo=fs.readFileSync(new URL('../jomkaki-motor-logo.jpg',import.meta.url));

test('Official JomKaki Motor logo is used in every brand surface',()=>{
  assert.match(html,/rel="icon"[^>]+jomkaki-motor-logo\.jpg/);
  assert.equal((html.match(/src="\.\/jomkaki-motor-logo\.jpg/g)||[]).length,2);
  assert.match(html,/brand-refresh\.css\?v=20260808-official-logo-1/);
  assert.ok(logo.length>100000,'official logo image should be present');
});

test('Official orange, navy and warm-neutral color system stays accessible',()=>{
  assert.match(css,/--brand-orange:#f45f20/);
  assert.match(css,/--brand-ink-deep:#071c2b/);
  assert.match(css,/--surface-bg:#f7f4f1/);
  assert.match(css,/\.primary\{[\s\S]*linear-gradient\(135deg,#ff7133,#e65017\)/);
  assert.match(css,/\.status-strip\{[\s\S]*#eaf7f1/);
  assert.match(css,/\.whatsapp-action\{background:#148a63!important/);
});
