import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

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
