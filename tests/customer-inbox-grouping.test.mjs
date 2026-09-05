import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { customerDisplayName } from '../api/crm.js';

const app = fs.readFileSync(new URL('../app-v2.js', import.meta.url), 'utf8');

test('customer inbox groups message rows into one customer conversation', () => {
  assert.match(app, /function groupCustomerConversations\(rows=\[\]\)/);
  assert.match(app, /const phone=normalizePhone\(item\.phone\|\|item\.customerPhone\|\|item\.recipient\)/);
  assert.match(app, /const conversations=groupCustomerConversations\(state\.data\.inbox\)/);
  assert.match(app, /One row per phone number/);
  assert.match(app, /messageCount:group\.messageCount/);
  assert.match(app, /openMessageCount:group\.openMessageCount/);
  assert.match(app, /Customer 360/);
});

test('customer inbox displays the latest message and conversation totals', () => {
  assert.match(app, /<th>Latest message<\/th><th>Conversation<\/th>/);
  assert.match(app, /item\.messageCount===1\?'':'s'/);
  assert.match(app, /open \/ unread/);
  assert.match(app, /All customers/);
});

test('handled AI replies are not counted as unread customer work', () => {
  assert.match(app, /const actionableInboxStatuses=new Set\(\['NEW','UNREAD','RECEIVED','ERROR','MANUAL_RECORDED','HUMAN_HANDOVER_REQUIRED','MANAGER_IN_PROGRESS','ASSIGNED_TO_STAFF'\]\)/);
  assert.match(app, /openMessageCount:needsAction\?1:0/);
  assert.match(app, /status==='OPEN'&&item\.needsAction/);
  assert.match(app, /inboxTable\(conversations\.filter\(item=>item\.needsAction\)\)/);
  assert.match(app, /item\.humanRequired\?'Manager queue':'AI managed'/);
  assert.match(app, /item\.needsAction&&\(manager\|\|status==='ASSIGNED_TO_STAFF'\)/);
});

test('home customer actions are grouped by customer conversation', () => {
  assert.match(app, /groupCustomerConversations\(state\.data\.inbox\.filter\(item=>!isDemoRecord\(item\)\)\)\.filter\(item=>item\.needsAction\)/);
  assert.match(app, /`conversation-\$\{customerConversationKey\(item\)\}`/);
  assert.match(app, /item\.openMessageCount} open WhatsApp message/);
});

test('message-like and location-only legacy customer names never appear as real people', () => {
  assert.equal(customerDisplayName('semak la', '60168968888'), 'WhatsApp Customer 8888');
  assert.equal(customerDisplayName('Miri', '60123456789'), 'WhatsApp Customer 6789');
  assert.equal(customerDisplayName('Nick JEE', '60123456789'), 'Nick JEE');
});
