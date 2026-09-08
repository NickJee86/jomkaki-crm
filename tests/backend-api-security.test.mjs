import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import loginHandler from '../api/login.js';
import logoutHandler from '../api/logout.js';
import mediaHandler, { MAX_WHATSAPP_MEDIA_BYTES } from '../api/whatsapp-media.js';
import { validProductImageBytes } from '../api/product-image.js';

function response() {
  return {
    code: 200,
    payload: null,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.code = code; return this; },
    json(payload) { this.payload = payload; return this; },
    send(payload) { this.payload = payload; return this; }
  };
}

test('logout is POST-only so another site cannot clear a CRM session with an image request', () => {
  const denied = response();
  logoutHandler({ method: 'GET' }, denied);
  assert.equal(denied.code, 405);
  assert.equal(denied.headers['Set-Cookie'], undefined);

  const accepted = response();
  logoutHandler({ method: 'POST' }, accepted);
  assert.equal(accepted.code, 200);
  assert.match(accepted.headers['Set-Cookie'], /Max-Age=0/);
});

test('login fails closed when session signing is not configured', async () => {
  const before = { access: process.env.CRM_ACCESS_PASSWORD, secret: process.env.CRM_SESSION_SECRET, vercel: process.env.VERCEL_ENV };
  process.env.CRM_ACCESS_PASSWORD = 'preview-test-password';
  delete process.env.CRM_SESSION_SECRET;
  process.env.VERCEL_ENV = 'preview';
  const result = response();
  await loginHandler({ method: 'POST', headers: {}, body: { username: 'admin', password: 'preview-test-password' } }, result);
  assert.equal(result.code, 503);
  assert.equal(result.headers['Set-Cookie'], undefined);
  if (before.access === undefined) delete process.env.CRM_ACCESS_PASSWORD; else process.env.CRM_ACCESS_PASSWORD = before.access;
  if (before.secret === undefined) delete process.env.CRM_SESSION_SECRET; else process.env.CRM_SESSION_SECRET = before.secret;
  if (before.vercel === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = before.vercel;
});

test('product image content must match the declared format', () => {
  assert.equal(validProductImageBytes(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), 'image/jpeg'), true);
  assert.equal(validProductImageBytes(Buffer.from('not an image'), 'image/jpeg'), false);
  assert.equal(validProductImageBytes(Buffer.from('RIFFxxxxWEBP'), 'image/webp'), true);
});

test('WhatsApp media proxy rejects oversized files before downloading them', async () => {
  const before = { secret: process.env.META_APP_SECRET, token: process.env.WHATSAPP_WEST_01_ACCESS_TOKEN };
  process.env.META_APP_SECRET = 'media-test-secret';
  process.env.WHATSAPP_WEST_01_ACCESS_TOKEN = 'protected-token';
  const expires = Math.floor(Date.now() / 1000) + 60;
  const query = { id: 'MEDIA-1', channel: 'JKM-WA-WEST-01', credential: 'WHATSAPP_WEST_01', expires };
  query.signature = crypto.createHmac('sha256', process.env.META_APP_SECRET).update(`${query.id}|${query.channel}|${query.credential}|${query.expires}`).digest('hex');
  let fetches = 0;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetches += 1;
    return new Response(JSON.stringify({ url: 'https://example.invalid/media', mime_type: 'application/pdf', file_size: MAX_WHATSAPP_MEDIA_BYTES + 1 }), { status: 200 });
  };
  const result = response();
  await mediaHandler({ method: 'GET', query }, result);
  assert.equal(result.code, 413);
  assert.equal(fetches, 1);
  globalThis.fetch = previousFetch;
  if (before.secret === undefined) delete process.env.META_APP_SECRET; else process.env.META_APP_SECRET = before.secret;
  if (before.token === undefined) delete process.env.WHATSAPP_WEST_01_ACCESS_TOKEN; else process.env.WHATSAPP_WEST_01_ACCESS_TOKEN = before.token;
});
