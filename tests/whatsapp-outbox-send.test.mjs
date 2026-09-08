import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildMetaPayload, validateRoute } from '../api/whatsapp-outbox-send.js';

const source = fs.readFileSync(new URL('../api/whatsapp-outbox-send.js', import.meta.url), 'utf8');
// Fixtures below are synthetic, with no provider credentials or live sends.

test('automatic consent delivery synchronizes application consent state',()=>{
  assert.match(source,/JKM_CREDIT_CONSENT_REQUEST/);
  assert.match(source,/Credit Consent Status': 'SENT'/);
  assert.match(source,/CONSENT_AND_DOCUMENTS_IN_PROGRESS/);
  assert.match(source,/Applications!A:CZ/);
});

test('consent requests send the actual PDF as a WhatsApp document', () => {
  const payload = buildMetaPayload({
    'Phone Number': '0123456789',
    'Template Name': 'JKM_CREDIT_CONSENT_REQUEST',
    'Message Text': 'Sila tandatangan borang: https://example.invalid/ctos-ccris-consent-bph-v4.pdf'
  });
  assert.equal(payload.type, 'document');
  assert.match(payload.document.link, /ctos-ccris-consent-bph-v4\.pdf/);
  assert.match(payload.document.filename, /JomKaki Rider/);
});
const activeRoute = { 'Internal Channel ID': 'TEST_CHANNEL_EAST', 'Phone Number ID': 'TEST_PROVIDER_100', 'Credential Key': 'TEST_CHANNEL_EAST', Active: 'TRUE', 'Outbound Enabled': 'TRUE' };

test('dispatcher builds a normal text message for Meta Cloud', () => {
  assert.deepEqual(buildMetaPayload({ 'Phone Number': '+60 12-345 6789', 'Message Text': 'Hello' }), {
    messaging_product: 'whatsapp', recipient_type: 'individual', to: '60123456789', type: 'text', text: { preview_url: false, body: 'Hello' }
  });
});

test('dispatcher supports approved Meta templates', () => {
  const payload = buildMetaPayload({ 'Phone Number': '0123456789', 'Message Type': 'TEMPLATE', 'Template Name': 'document_reminder', Language: 'en_US' });
  assert.equal(payload.to, '60123456789');
  assert.equal(payload.template.name, 'document_reminder');
});

test('dispatcher sends approved product photos as WhatsApp image messages', () => {
  const payload = buildMetaPayload({
    'Phone Number': '0123456789',
    'Message Type': 'MOTOR_IMAGE',
    'Image URL': 'https://cdn.example.test/yamaha-y16zr.jpg',
    'Image Caption': 'Yamaha Y16ZR ABS. Ansuran bermula RM273 sebulan untuk 5 tahun.'
  });
  assert.equal(payload.type, 'image');
  assert.equal(payload.image.link, 'https://cdn.example.test/yamaha-y16zr.jpg');
  assert.match(payload.image.caption, /RM273/);
  assert.throws(() => buildMetaPayload({ 'Phone Number': '0123456789', 'Message Type': 'MOTOR_IMAGE', 'Image URL': 'http://unsafe.example.test/y16.jpg' }), /HTTPS/);
});

test('dispatcher enforces the original official number', () => {
  assert.throws(() => validateRoute({ 'Internal Channel ID': 'TEST_CHANNEL_EAST', 'WhatsApp Number ID': 'TEST_PROVIDER_OTHER' }, activeRoute), /does not match/);
  assert.equal(validateRoute({ 'Internal Channel ID': 'TEST_CHANNEL_EAST', 'WhatsApp Number ID': 'TEST_PROVIDER_100' }, activeRoute).credentialKey, 'TEST_CHANNEL_EAST');
});

test('dispatcher blocks inactive or unconfigured routes and has no legacy fallback', () => {
  assert.throws(() => validateRoute({}, activeRoute), /no Internal Channel ID/);
  assert.throws(() => validateRoute({ 'Internal Channel ID': 'TEST_CHANNEL_EAST' }, { ...activeRoute, Active: 'FALSE' }), /disabled/);
  assert.doesNotMatch(source, /env\.WHATSAPP_ACCESS_TOKEN/);
  assert.match(source, /WHATSAPP_DISPATCH_SECRET/);
});
