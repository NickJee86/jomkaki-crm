import test from 'node:test';
import assert from 'node:assert/strict';
import { isolateTestEnvironment } from '../tools/test-network-isolation.mjs';

test('deployment settings and credentials cannot affect unit-test defaults', () => {
  const env = { OPENAI_MODEL: 'fixture-model', WHATSAPP_SEND_MODE: 'CLOUD', NOTION_API_KEY: 'fixture-not-a-key', VERCEL_ENV: 'preview', PATH: 'test-runtime', NODE_ENV: 'test' };
  assert.deepEqual(isolateTestEnvironment(env), { PATH: 'test-runtime', NODE_ENV: 'test' });
});

test('test bootstrap blocks accidental calls with deployment credentials', async () => {
  await assert.rejects(fetch('https://example.invalid/test-only'), /Live network access is disabled/);
});

test('API behavior can be exercised through an explicit mock', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ mocked: true })));
  assert.deepEqual(await (await fetch('https://example.invalid/test-only')).json(), { mocked: true });
});
