import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildImmediateAcknowledgement, buildInitialConversationState, extractCustomerName, instantChannelCredentials, resolveCustomerLocation, shouldSendImmediateAcknowledgement } from '../api/whatsapp-webhook.js';

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
  assert.match(english, /received/);
  [chinese, malay, english].forEach(message => {
    assert.doesNotMatch(message, /RM|selling price|cash price|售价|价钱/i);
    assert.doesNotMatch(message, /\b(?:AI|bot|chatbot|automated)\b/i);
  });
  assert.equal(buildImmediateAcknowledgement('[document]', 'document'), '');
});

test('webhook acknowledgement stays disabled so one inbound produces one final reply', () => {
  assert.equal(shouldSendImmediateAcknowledgement({ route, routeUsable: true, messageType: 'text', receivedAt: '2026-08-14T07:00:00Z' }), false);
  assert.equal(shouldSendImmediateAcknowledgement({ route, routeUsable: true, messageType: 'text', previousInboundAt: '2026-08-14T07:00:00Z', receivedAt: '2026-08-14T07:00:30Z' }), false);
  assert.equal(shouldSendImmediateAcknowledgement({ route, routeUsable: true, messageType: 'text', previousInboundAt: '2026-08-14T07:00:00Z', receivedAt: '2026-08-14T07:02:00Z' }), false);
  assert.equal(shouldSendImmediateAcknowledgement({ route, routeUsable: false, messageType: 'text' }), false);
  assert.equal(shouldSendImmediateAcknowledgement({ route, routeUsable: true, human: true, messageType: 'text' }), false);
  assert.equal(shouldSendImmediateAcknowledgement({ route: { ...route, 'Outbound Enabled': 'FALSE' }, routeUsable: true, messageType: 'text' }), false);
});

test('instant channel credentials remain strict even though webhook acknowledgement is disabled', () => {
  const credentials = instantChannelCredentials(route, { WHATSAPP_WEST_01_ACCESS_TOKEN: 'protected-token', WHATSAPP_GRAPH_VERSION: 'v26.0' });
  assert.deepEqual(credentials, { channelId: 'JKM-WA-WEST-01', phoneNumberId: 'W-100', accessToken: 'protected-token', version: 'v26.0' });
  assert.throws(() => instantChannelCredentials(route, { WHATSAPP_ACCESS_TOKEN: 'legacy-token' }), /incomplete/);
  assert.match(source, /WHATSAPP_SEND_MODE/);
  assert.match(source, /WEBHOOK_IMMEDIATE_ACK/);
  assert.match(source, /'Send Status': response\.ok \? 'SENT' : 'FAILED'/);
  assert.doesNotMatch(source, /await sendImmediateAcknowledgement\(token/);
});

test('first inbound message creates the conversation state required by Make', () => {
  const state = buildInitialConversationState({
    lead: { 'Lead ID': 'LEAD-1', 'Customer ID': 'CUS-1', 'Customer Name': 'Test Customer', 'Selected Branch ID': 'BR-1' },
    application: {},
    route: { 'WABA ID': 'WABA-1', 'Display Number': '+60 14-795 2387' },
    phone: '016-896 8888',
    text: 'I am looking for Yamaha Y16ZR.',
    messageId: 'wamid-1',
    receivedAt: '2026-08-14T08:05:36.000Z',
    numberId: 'PHONE-1',
    channelId: 'JKM-WA-WEST-01',
    businessUnit: 'MOTOR',
    teamId: 'TEAM-WEST'
  });
  assert.match(state['State ID'], /^STATE-/);
  assert.equal(state['Lead ID'], 'LEAD-1');
  assert.equal(state['Phone Number'], '60168968888');
  assert.equal(state['Current Step'], 'STEP_01_WELCOME');
  assert.equal(state['Last Customer Message'], 'I am looking for Yamaha Y16ZR.');
  assert.equal(state['Channel Binding Status'], 'BOUND');
  assert.equal(state['Escalation Required'], 'FALSE');
});

test('sales onboarding safely captures the customer name', () => {
  assert.equal(extractCustomerName('Nama saya Ahmad Hakim'), 'Ahmad Hakim');
  assert.equal(extractCustomerName('Call me Mei Ling'), 'Mei Ling');
  assert.equal(extractCustomerName('Yamaha Y16ZR'), '');
  assert.equal(extractCustomerName('hi'), '');
});

test('customer area resolves to the correct active business branch', () => {
  const branches = [
    { 'Branch ID': 'BR-WM-PJ', 'Branch Name': 'Petaling Jaya', Region: 'WEST_MALAYSIA', City: 'Petaling Jaya', 'Direct Coverage Areas': 'Petaling Jaya|Kuala Lumpur|Selangor|Klang Valley|Seremban|Nilai|Penang', Active: 'TRUE', 'Business Unit': 'MOTOR', 'Team ID': 'TEAM-MOTOR-WEST-PJ' },
    { 'Branch ID': 'BR-SWK-BKW', 'Branch Name': 'Batu Kawa', Region: 'SARAWAK', City: 'Kuching', 'Direct Coverage Areas': 'Batu Kawa', Active: 'TRUE', 'Business Unit': 'MOTOR', 'Team ID': 'TEAM-MOTOR-EAST-BKW' },
    { 'Branch ID': 'BR-SWK-STK', 'Branch Name': 'Satok', Region: 'SARAWAK', City: 'Kuching', 'Direct Coverage Areas': 'Satok', Active: 'TRUE', 'Business Unit': 'MOTOR', 'Team ID': 'TEAM-MOTOR-EAST-STK' }
  ];
  assert.deepEqual(resolveCustomerLocation('Saya dari Batu Kawa, Sarawak', 'MOTOR', branches), {
    region: 'EAST_MALAYSIA', state: 'Sarawak', city: 'Batu Kawa', branchId: 'BR-SWK-BKW', teamId: 'TEAM-MOTOR-EAST-BKW', resolved: true
  });
  assert.equal(resolveCustomerLocation('KL', 'MOTOR', branches).branchId, 'BR-WM-PJ');
  assert.equal(resolveCustomerLocation('hello', 'MOTOR', branches), null);
});
