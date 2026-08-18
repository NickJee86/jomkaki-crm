import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);

test('every classic browser script is complete JavaScript before deployment', () => {
  const html = fs.readFileSync(new URL('index.html', root), 'utf8');
  const sources = [...html.matchAll(/<script\s+src="([^"?]+)(?:\?[^"']*)?"/g)]
    .map(match => match[1].replace(/^\.\//, ''))
    .filter(source => source.endsWith('.js'));

  assert.ok(sources.includes('app-v2.js'), 'main CRM script must be covered');
  for (const source of sources) {
    const code = fs.readFileSync(new URL(source, root), 'utf8');
    assert.ok(code.length > 0, `${source} must not be empty`);
    assert.doesNotThrow(() => new vm.Script(code, { filename: source }), `${source} must parse as a classic browser script`);
  }
});

