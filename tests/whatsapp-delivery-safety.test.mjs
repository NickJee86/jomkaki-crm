import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatchRecord } from '../api/whatsapp-outbox-send.js';
import { buildOutboxStatusChanges, conversationRequiresHuman, retryableInboundMessageIds, sendInstantSalesMessage, validateInstantImageLink } from '../api/whatsapp-webhook.js';

const route = { 'Internal Channel ID': 'SAFETY_TEST', 'Phone Number ID': 'test-number', Active: 'TRUE', 'Outbound Enabled': 'TRUE' };
const row = { rowNumber: 2, 'Outbox ID': 'OUT-SAFETY', 'Internal Channel ID': 'SAFETY_TEST', 'Phone Number': '0123456789', 'Message Text': 'Test only', 'Send Status': 'PENDING' };
const headers = ['Outbox ID', 'Send Status', 'Attempt Count', 'Sent At', 'Provider Message ID', 'Error Message', 'WhatsApp Number ID', 'Send Routing Status'];
const response = (body = {}, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

function configure(t, fetchImpl) {
  const previousToken = process.env.SAFETY_TEST_ACCESS_TOKEN, previousMode = process.env.WHATSAPP_SEND_MODE;
  process.env.SAFETY_TEST_ACCESS_TOKEN = 'mock-token';
  process.env.WHATSAPP_SEND_MODE = 'CLOUD';
  t.mock.method(globalThis, 'fetch', fetchImpl);
  t.after(() => {
    if (previousToken === undefined) delete process.env.SAFETY_TEST_ACCESS_TOKEN; else process.env.SAFETY_TEST_ACCESS_TOKEN = previousToken;
    if (previousMode === undefined) delete process.env.WHATSAPP_SEND_MODE; else process.env.WHATSAPP_SEND_MODE = previousMode;
  });
}

test('accepted outbox sends are never marked failed after a logging error', async t => {
  const writes = []; let sends = 0, failedSentWrite = false;
  configure(t, async (url, options = {}) => {
    if (url.includes('graph.facebook.com')) { sends += 1; return response({ messages: [{ id: 'wamid.safety' }] }); }
    if (options.method === 'POST') {
      const data = JSON.parse(options.body).data; writes.push(data);
      if (data.some(cell => cell.values[0][0] === 'SENT') && !failedSentWrite) { failedSentWrite = true; return response({}, 503); }
      return response();
    }
    return response({ values: [headers] });
  });
  const result = await dispatchRecord('sheets-token', row, [route]);
  assert.equal(sends, 1);
  assert.equal(result.ok, true);
  assert.equal(result.providerMessageId, 'wamid.safety');
  assert.equal(result.warning, 'POST_SEND_LOGGING_FAILED');
  assert.ok(!writes.flat().some(cell => cell.values[0][0] === 'FAILED'));
});

test('uncertain provider outcomes are held for verification rather than automatic retry', async t => {
  const statuses = [];
  configure(t, async (url, options = {}) => {
    if (url.includes('graph.facebook.com')) throw new Error('Connection closed after upload');
    if (options.method === 'POST') { statuses.push(...JSON.parse(options.body).data.filter(cell => cell.range === 'Message_Outbox!B2').map(cell => cell.values[0][0])); return response(); }
    return response({ values: [headers] });
  });
  const result = await dispatchRecord('sheets-token', row, [route]);
  assert.equal(result.status, 'DELIVERY_UNKNOWN');
  assert.equal(result.locked, true);
  assert.deepEqual(statuses, ['SENDING', 'DELIVERY_UNKNOWN']);
  const retry = await dispatchRecord('sheets-token', { ...row, 'Send Status': 'DELIVERY_UNKNOWN' }, [route]);
  assert.equal(retry.locked, true);
});

test('concurrent dispatch calls cannot send the same outbox row twice in one worker', async t => {
  let releaseSend; const pending = new Promise(resolve => { releaseSend = resolve; }); let sends = 0;
  configure(t, async (url, options = {}) => {
    if (url.includes('graph.facebook.com')) { sends += 1; await pending; return response({ messages: [{ id: 'wamid.once' }] }); }
    return response(options.method === 'POST' ? {} : { values: [headers] });
  });
  const first = dispatchRecord('sheets-token', row, [route]);
  const second = await dispatchRecord('sheets-token', row, [route]);
  releaseSend(); await first;
  assert.equal(second.locked, true);
  assert.equal(sends, 1);
});

test('an explicitly disabled outbound channel never sends an instant reply', async t => {
  configure(t, async () => { assert.fail('A disabled route must not call any network endpoint'); });
  const result = await sendInstantSalesMessage({ route: { ...route, 'Outbound Enabled': 'FALSE' }, phone: '0123456789', decision: { handled: true, text: 'Hello' } });
  assert.equal(result.sent, false);
  assert.equal(result.skipped, 'CHANNEL_OUTBOUND_DISABLED');
});

test('instant send reserves before Meta and a response without a provider ID remains uncertain', async t => {
  const events = [];
  configure(t, async () => { events.push('provider'); return response({ success: true }); });
  const result = await sendInstantSalesMessage({ route, phone: row['Phone Number'], decision: { handled: true, text: 'Hello' }, beforeSend: async payload => { assert.equal(payload.type, 'text'); events.push('reserved'); } });
  assert.deepEqual(events, ['reserved', 'provider']);
  assert.equal(result.sent, false);
  assert.equal(result.deliveryUnknown, true);
});

test('instant transport errors hold the reserved reply without treating it as failed or sent', async t => {
  let reservations = 0, sends = 0;
  configure(t, async () => { sends += 1; throw new Error('Connection closed after upload'); });
  const result = await sendInstantSalesMessage({ route, phone: row['Phone Number'], decision: { handled: true, text: 'Hello' }, beforeSend: async () => { reservations += 1; } });
  assert.equal(reservations, 1);
  assert.equal(sends, 1);
  assert.equal(result.sent, false);
  assert.equal(result.deliveryUnknown, true);
});

test('failed pre-send reservations remain retryable and never contact Meta', async t => {
  configure(t, async () => { assert.fail('No provider request is allowed before the reservation succeeds'); });
  await assert.rejects(sendInstantSalesMessage({ route, phone: row['Phone Number'], decision: { handled: true, text: 'Hello' }, beforeSend: async () => { throw new Error('Sheets temporarily unavailable'); } }), /Sheets temporarily unavailable/);
});

test('human-owned conversations remain human-owned across subsequent inbound messages', () => {
  for (const mode of ['AI_TO_SA_HANDOVER', 'AI_EXCEPTION_TO_STAFF', 'AI_EXCEPTION_STAFF_MANUAL', 'HUMAN_MANAGED', 'MANUAL_ASSIGNED']) {
    assert.equal(conversationRequiresHuman({ lead: { 'Processing Mode': mode } }), true);
    assert.equal(conversationRequiresHuman({ application: { 'Processing Mode': mode } }), true);
  }
  assert.equal(conversationRequiresHuman({ lead: { 'Processing Mode': 'AI_MANAGED' } }), false);
});

test('a failed multi-message webhook releases only unprocessed messages for retry', () => {
  assert.deepEqual(retryableInboundMessageIds(['already-recorded', 'already-sent', 'not-processed'], new Set(['already-recorded']), new Set(['already-sent'])), ['not-processed']);
});

test('late delivery callbacks never downgrade delivered or read messages to failed or sent', () => {
  for (const current of ['DELIVERED', 'READ']) {
    assert.equal(buildOutboxStatusChanges(current, 'FAILED', 'Late error'), null);
    assert.equal(buildOutboxStatusChanges(current, 'SENT'), null);
  }
  assert.equal(buildOutboxStatusChanges('FAILED', 'SENT'), null);
  assert.equal(buildOutboxStatusChanges('SENDING', 'unrecognized'), null);
  assert.equal(buildOutboxStatusChanges('FAILED', 'READ')['Send Status'], 'READ');
  const delivered = buildOutboxStatusChanges('SENT', 'DELIVERED', '', '1788753600');
  assert.equal(delivered['Send Status'], 'DELIVERED');
  assert.equal(delivered['Delivered At'], new Date(1788753600000).toISOString());
});

test('media size validation uses the complete file size for range responses', async () => {
  const result = await validateInstantImageLink('https://example.test/oversized.jpg', { fetchImpl: async () => ({
    ...response({}, 206), headers: { get: name => ({ 'content-type': 'image/jpeg', 'content-length': '1024', 'content-range': 'bytes 0-1023/6291456' })[name] || '' }, body: { cancel: async () => {} }
  }) });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'IMAGE_TOO_LARGE');
  assert.equal(result.contentLength, 6291456);
});

test('WebP is not accepted as a normal WhatsApp image-message format', async () => {
  const result = await validateInstantImageLink('https://example.test/photo.webp', { fetchImpl: async () => ({
    ...response(), headers: { get: name => name === 'content-type' ? 'image/webp' : '' }, body: { cancel: async () => {} }
  }) });
  assert.equal(result.reason, 'UNSUPPORTED_IMAGE_TYPE');
});
