import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const app = read('../app-v2.js');
const css = read('../v2.css');
const customer360 = read('../customer-360.css');
const html = read('../index.html');

test('home is an actionable daily command centre', () => {
  assert.match(app, /Today Command Centre/);
  assert.match(app, /DO THIS NEXT/);
  assert.match(app, /function customerNextAction\(/);
  assert.match(app, /Ranked customer actions/);
  assert.match(app, /queue=crmNotifications\(\)\.slice\(0,8\)/);
  assert.match(app, /optional\('inbox',\{timeoutMs:6000\}\),optional\('outbox',\{timeoutMs:6000\}\)/);
  assert.match(app, /title:item\.humanRequired\?'Human reply requested':'Reply customer now'/);
  assert.match(css, /\.today-task-list/);
});

test('customer operations include a full pipeline and one next action', () => {
  assert.match(app, /function pipeline\(/);
  assert.match(app, /Customer Pipeline/);
  assert.match(app, /pipeline:'customers'/);
  assert.match(app, /<th>Next action<\/th>/);
  assert.match(app, /customer-360-next-action/);
  assert.match(customer360, /\.customer-360-next-action/);
});

test('notifications combine customer, document, follow-up and delivery work', () => {
  assert.match(app, /function crmNotifications\(/);
  assert.match(app, /function openNotificationCentre\(/);
  assert.match(app, /Notification Centre/);
  assert.match(app, /Customer replies/);
  assert.match(app, /Delivery issues/);
  assert.match(app, /function customerMessagePreview\(/);
  assert.match(app, /function customerMessageTypeLabel\(/);
  assert.match(app, /WhatsApp attachment or action received/);
  assert.match(app, /type==='UNSUPPORTED'\)return''/);
  assert.match(app, /urgent===1\?'needs':'need'/);
});

test('reports are grouped into clear operating categories', () => {
  assert.match(app, /function organizeReports\(/);
  for (const category of ['Executive', 'Sales', 'Operations', 'Products', 'Team', 'System', 'All reports']) {
    assert.match(app, new RegExp(category));
  }
  assert.match(css, /\.report-category-hidden/);
});

test('internal navigation resets scroll and production assets are cache-busted', () => {
  assert.match(app, /window\.scrollTo\(\{top:0,behavior:'auto'\}\)/);
  assert.match(app, /page-breadcrumb/);
  assert.match(html, /app-v2\.js\?v=20260827-customer360-readable1/);
  assert.match(html, /v2\.css\?v=20260827-operating-layer1/);
  assert.match(html, /customer-360\.css\?v=20260827-operating-layer1/);
});
