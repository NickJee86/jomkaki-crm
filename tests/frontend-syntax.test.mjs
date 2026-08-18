import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
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

test('every CRM API module is complete JavaScript before deployment', () => {
  const apiDirectory = new URL('api/', root);
  const apiFiles = fs.readdirSync(apiDirectory).filter(file => file.endsWith('.js'));

  assert.ok(apiFiles.includes('crm.js'), 'main CRM API must be covered');
  for (const file of apiFiles) {
    const fullPath = fileURLToPath(new URL(file, apiDirectory));
    const result = spawnSync(process.execPath, ['--check', fullPath], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${file} must parse as an API module\n${result.stderr || result.stdout}`);
  }
});

