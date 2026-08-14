import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildImmediateAcknowledgement, instantChannelCredentials, shouldSendImmediateAcknowledgement } from '../api/whatsapp-webhook.js';

const source = fs.readFileSync(new URL('../api/whatsapp-webhook.js', import.meta.url), 'utf8');
const route = {
  'Internal Channel ID': 'JKM-WA-WEST-01',
  'Phone Number ID': 'W-100',
  'Credential Key': 'WHATSAPP_WEST_01',
  'Outbound Enabled': 'TRUE'
};

test('instant acknowledgement follows the customer language without quoting prices', () => {
  const chinese = buildImmediateAcknowledgement('请问 Y16ZR 月供多少？', 'text');
  const malay = buildImmediateAcknowledgement('Hai, nak tanya ansuran motor', 'text');
  const english = buildImmediateAcknowledgement('How much is the monthly payment?', 'text');
  assert.match(chinese, /已收到/);
  assert.match(malay, /telah menerima/);
  assert.match(english, /has received/);
  [chinese, malay, english].forEach(message => assert.doesNotMatch(message, /RM|selling price|cash price|售价|价钱/i));
  assert.equal(buildImmediateAcknowledgement('[document]', 'document'), '');
});

test('instant acknowledgement requires a safe route and suppresses burst duplicates', () => {
  assert.equal(shouldSendImmediateAcknowledgement({ route, routeUsable: true, messageType: 'text', receivedAt: '2026-08-14T07:00:00Z' }), true);
  assert.equal(shouldSendImmediateAcknowledgement({ route, routeUsable: true, messageType: 'text', previousInboundAt: '2026-08-14T07:00:00Z', receivedAt: '2026-08-14T07:00:30Z' }), false);
  assert.equal(shouldSendImmediateAcknowledgement({ route, routeUsable: true, messageType: 'text', previousInboundAt: '2026-08-14T07:00:00Z', receivedAt: '2026-08-14T07:02:00Z' }), true);
  assert.equal(shouldSendImmediateAcknowledgement({ route, routeUsable: false, messageType: 'text' }), false);
  assert.equal(shouldSendImmediateAcknowledgement({ route, routeUsable: true, human: true, messageType: 'text' }), false);
  assert.equal(shouldSendImmediateAcknowledgement({ route: { ...route, 'Outbound Enabled': 'FALSE' }, routeUsable: true, messageType: 'text' }), false);
});

test('instant reply uses only the bound channel credential and remains outside the polling sender', () => {
  const credentials = instantChannelCredentials(route, { WHATSAPP_WEST_01_ACCESS_TOKEN: 'protected-token', WHATSAPP_GRAPH_VERSION: 'v26.0' });
  assert.deepEqual(credentials, { channelId: 'JKM-WA-WEST-01', phoneNumberId: 'W-100', accessToken: 'protected-token', version: 'v26.0' });
  assert.throws(() => instantChannelCredentials(route, { WHATSAPP_ACCESS_TOKEN: 'legacy-token' }), /incomplete/);
  assert.match(source, /WHATSAPP_SEND_MODE/);
  assert.match(source, /WEBHOOK_IMMEDIATE_ACK/);
  assert.match(source, /'Send Status': response\.ok \? 'SENT' : 'FAILED'/);
  assert.match(source, /Immediate WhatsApp acknowledgement failed/);
});

