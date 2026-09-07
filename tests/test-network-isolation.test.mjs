import test from 'node:test';
import assert from 'node:assert/strict';
import '../tools/test-network-isolation.mjs';

test('test bootstrap blocks accidental calls with deployment credentials', async () => {
  await assert.rejects(fetch('https://example.invalid/test-only'), /Live network access is disabled/);
});

test('API behavior can be exercised through an explicit mock', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ mocked: true })));
  assert.deepEqual(await (await fetch('https://example.invalid/test-only')).json(), { mocked: true });
});
