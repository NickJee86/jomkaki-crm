import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { buildMetaPayload } from '../api/whatsapp-outbox-send.js';

const app = fs.readFileSync(new URL('../app-v2.js', import.meta.url), 'utf8');
const api = fs.readFileSync(new URL('../api/crm.js', import.meta.url), 'utf8');
const dispatcher = fs.readFileSync(new URL('../api/whatsapp-outbox-send.js', import.meta.url), 'utf8');
const vercel = JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));

test('manual WhatsApp reply exposes safe image and PDF attachments with an honest Meta-window state', () => {
  assert.match(app, /Attach image or PDF/);
  assert.match(app, /application\/pdf,image\/jpeg,image\/png,image\/webp/);
  assert.match(app, /FOLLOW_UP_TEMPLATE_REGISTRY/);
  assert.match(app, /24-hour reply window is open/);
  assert.match(app, /attachmentField\.hidden=false/);
  assert.match(app, /form\.attachment\.disabled=!cloud/);
  assert.match(app, /matchTemplateToAttachment/);
  assert.match(app, /File selected\. Choose a customer and CRM will load the matching approved media template/);
  assert.match(app, /Choose an approved \$\{requiredHeader\.toLowerCase\(\)\} template for this file/);
  assert.match(app, /getWhatsAppTemplates/);
  assert.match(app, /approved Image-header or Document-header template/);
  assert.match(app, /Exact approved WhatsApp message/);
  assert.match(app, /CRM will select the matching approved media template automatically/);
  assert.match(app, /data-body=/);
  assert.match(api, /uploadWhatsAppMedia/);
  assert.match(api, /approvedWhatsAppTemplates/);
  assert.match(api, /message_templates\?fields=/);
  assert.match(api, /selectedApprovedTemplate\.body/);
  assert.match(api, /requires a matching attachment/);
  assert.match(api, /WhatsApp 24-hour service window is closed/);
});

test('Messages new-message composer keeps files staged while customer templates load', () => {
  assert.doesNotMatch(app, /if\(!canAttach&&form\.attachment\.value\)form\.attachment\.value=''/);
  assert.match(app, /if\(!matchTemplateToAttachment\(\)&&form\.attachment\.files\?\.\[0\]\)/);
  assert.match(app, /File ready\. CRM will send it using the matching approved media template/);
  assert.match(app, /openMessageQueue'\)\.addEventListener\('click',\(\)=>navigateToView\('outbox'\)/);
});

test('outbound messages are recorded and locked before Meta delivery', () => {
  const start = api.indexOf("if (action === 'sendCustomerMessage')");
  const append = api.indexOf("await appendObject(req, 'Message_Outbox'", start);
  const sending = api.indexOf("'Send Status': 'SENDING'", start);
  const meta = api.indexOf('https://graph.facebook.com/', start);
  assert.ok(start >= 0 && append > start && sending > append && meta > sending);
  assert.match(api, /retryOutboxMessage/);
  assert.match(app, /data-retry-outbox/);
  assert.match(app, /Sending · do not resend/);
});

test('outbox dispatcher supports uploaded document and image media IDs', () => {
  assert.deepEqual(buildMetaPayload({
    'Phone Number': '60123456789', 'Message Type': 'DOCUMENT', 'Message Text': 'Dokumen anda',
    'Media ID': 'media-123', 'Media File Name': 'form.pdf'
  }), {
    messaging_product: 'whatsapp', recipient_type: 'individual', to: '60123456789', type: 'document',
    document: { id: 'media-123', filename: 'form.pdf', caption: 'Dokumen anda' }
  });
  const image = buildMetaPayload({ 'Phone Number': '60123456789', 'Message Type': 'IMAGE', 'Media ID': 'media-456', 'Message Text': 'Gambar' });
  assert.equal(image.image.id, 'media-456');
  assert.deepEqual(buildMetaPayload({
    'Phone Number': '60123456789', 'Message Type': 'TEMPLATE_DOCUMENT', 'Template Name': 'jomkaki_document_send_v1',
    Language: 'ms', 'Media ID': 'media-789', 'Media File Name': 'consent.pdf'
  }), {
    messaging_product: 'whatsapp', to: '60123456789', type: 'template',
    template: {
      name: 'jomkaki_document_send_v1', language: { code: 'ms' },
      components: [{ type: 'header', parameters: [{ type: 'document', document: { id: 'media-789', filename: 'consent.pdf' } }] }]
    }
  });
});

test('pending WhatsApp messages have an automatic five-minute dispatcher', () => {
  assert.ok(vercel.crons.some(item => item.path === '/api/whatsapp-outbox-send' && item.schedule === '*/5 * * * *'));
  assert.match(dispatcher, /Send Status'\]\)\.toUpperCase\(\) === 'PENDING'/);
  assert.match(dispatcher, /existingStatus === 'SENDING'/);
});

test('reply completion resolves the source inbox and refreshes live CRM state', () => {
  assert.match(api, /resolveRepliedInbox/);
  assert.match(api, /'Process Status': 'RESOLVED'/);
  assert.match(app, /setInterval\(refreshLiveWorkspace,60000\)/);
  assert.match(app, /visibilitychange/);
});

test('customer documents can be previewed securely and stalled AI checks can be retried', () => {
  assert.match(api, /action === 'getDocumentAccess'/);
  assert.match(api, /CRM_SECURE_DOCUMENT_OPENED/);
  assert.match(app, /View secure file/);
  assert.match(api, /action === 'retryDocumentValidation'/);
  assert.match(app, /Queue overdue/);
  assert.match(app, /Retry AI check/);
});

test('duplicate applications and false completion transitions are blocked', () => {
  assert.match(api, /An open application already exists for this customer and model/);
  assert.match(api, /verified CTOS\/CCRIS consent/);
  assert.match(api, /successful LMS submission/);
  assert.match(api, /approved CAD decision/);
});

test('settings reveal the exact deployed knowledge snapshot and warnings', () => {
  assert.match(api, /approvedPageCount/);
  assert.match(api, /syncWarnings/);
  assert.match(app, /Runtime knowledge health/);
  assert.match(app, /exact approved knowledge snapshot loaded by the deployed CRM build/);
});

