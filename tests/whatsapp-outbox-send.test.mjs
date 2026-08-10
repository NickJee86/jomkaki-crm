import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildMetaPayload, validateRoute } from '../api/whatsapp-outbox-send.js';

const source = fs.readFileSync(new URL('../api/whatsapp-outbox-send.js', import.meta.url), 'utf8');
const activeRoute = { 'Internal Channel ID': 'JKM-WA-EAST-01', 'Phone Number ID': 'E-100', 'Credential Key': 'JKM_WA_EAST_01', Active: 'TRUE', 'Outbound Enabled': 'TRUE' };

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

test('dispatcher enforces the original official number', () => {
  assert.throws(() => validateRoute({ 'Internal Channel ID': 'JKM-WA-EAST-01', 'WhatsApp Number ID': 'W-100' }, activeRoute), /does not match/);
  assert.equal(validateRoute({ 'Internal Channel ID': 'JKM-WA-EAST-01', 'WhatsApp Number ID': 'E-100' }, activeRoute).credentialKey, 'JKM_WA_EAST_01');
});

test('dispatcher blocks inactive or unconfigured routes and has no legacy fallback', () => {
  assert.throws(() => validateRoute({}, activeRoute), /no Internal Channel ID/);
  assert.throws(() => validateRoute({ 'Internal Channel ID': 'JKM-WA-EAST-01' }, { ...activeRoute, Active: 'FALSE' }), /disabled/);
  assert.doesNotMatch(source, /env\.WHATSAPP_ACCESS_TOKEN/);
  assert.match(source, /WHATSAPP_DISPATCH_SECRET/);
});
