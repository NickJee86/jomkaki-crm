import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { inboxConversationKey, uniqueInboxConversationCount } from '../api/crm.js';

const app = fs.readFileSync(new URL('../app-v2.js', import.meta.url), 'utf8');
const api = fs.readFileSync(new URL('../api/crm.js', import.meta.url), 'utf8');
const webhook = fs.readFileSync(new URL('../api/whatsapp-webhook.js', import.meta.url), 'utf8');

test('handover queue contains one task per customer conversation', () => {
  assert.match(app, /handovers=groupCustomerConversations\(state\.data\.inbox\.filter\(item=>!isDemoRecord\(item\)&&item\.humanRequired\)\)/);
  assert.match(app, /One row per customer\. The latest message is shown; all open handover messages are handled together\./);
  assert.match(app, /handoverMessageIds=group\.messages\.filter/);
  assert.match(app, /messageIds:item\.handoverMessageIds\|\|\[item\.id\]/);
});

test('conversation identity normalizes Malaysian phone formats', () => {
  assert.equal(inboxConversationKey({ 'Phone Number': '016-896 8888' }), 'PHONE:60168968888');
  assert.equal(inboxConversationKey({ 'Phone Number': '+60 16 896 8888' }), 'PHONE:60168968888');
  assert.equal(uniqueInboxConversationCount([
    { 'Phone Number': '016-896 8888' },
    { 'Phone Number': '+60 16 896 8888' },
    { 'Phone Number': '017-111 2222' }
  ]), 2);
});

test('handover actions update every open message for the same permitted customer', () => {
  assert.match(api, /const suppliedMessageIds = Array\.isArray\(body\.messageIds\)/);
  assert.match(api, /inboxConversationKey\(row\) !== conversationKey/);
  assert.match(api, /for \(const targetMessageId of handoverMessageIds\) await updateObject/);
  assert.match(api, /uniqueInboxConversationCount\(inbox\.filter\(row => humanStatuses\.has/);
  assert.match(api, /const unreadInbox = uniqueInboxConversationCount/);
  assert.match(api, /'MANUAL_RECORDED'.*'HUMAN_HANDOVER_REQUIRED'/);
});

test('new handovers always record a usable received time', () => {
  assert.match(webhook, /ensureHeaders\(token, 'Customer_Inbox', \['Received At', 'Human Handover At', 'AI Processed At'\]\)/);
  assert.match(webhook, /'Human Handover At': inboxProcessStatus === 'HUMAN_HANDOVER_REQUIRED' \? receivedAt : ''/);
  assert.match(api, /time: row\['Received At'\] \|\| row\['Human Handover At'\] \|\| row\['AI Processed At'\]/);
});
