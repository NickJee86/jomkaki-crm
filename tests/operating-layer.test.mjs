import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const app = read('../app-v2.js');
const css = read('../v2.css');
const customer360 = read('../customer-360.css');
const html = read('../index.html');
const architecture = read('../business-architecture.js');

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

test('activity audit prioritises meaningful events over routine scheduler noise', () => {
  assert.match(app, /function routineFollowUpHeartbeat\(item\)/);
  assert.match(app, /Show.*routine scheduler checks/);
  assert.match(app, /id="activitySearch"/);
  assert.match(app, /Routine successful scheduler checks are collapsed by default/);
  assert.match(app, /0 due,\\s\*0 sent,\\s\*0 queued,\\s\*0 blocked/);
});

test('reports are grouped into clear operating categories', () => {
  assert.match(app, /function organizeReports\(/);
  for (const category of ['Executive', 'Sales', 'Operations', 'Products', 'Team', 'System', 'All reports']) {
    assert.match(app, new RegExp(category));
  }
  assert.match(css, /\.report-category-hidden/);
});

test('product hub totals match the records employees can open', () => {
  assert.match(app, /const visibleCatalogRecord=item=>!\/TEMPLATE\/i\.test/);
  assert.match(app, /approvalStatus\|\|'APPROVED'\)\.toUpperCase\(\)!=='MERGED'/);
  assert.match(app, /visiblePricingRecord=item=>!\/TEMPLATE\/i\.test/);
  assert.match(app, /const productCatalog=state\.data\.catalog\.filter\(visibleCatalogRecord\),productPricing=state\.data\.pricing\.filter\(visiblePricingRecord\)/);
});

test('tasks and approvals use one clear name throughout the workspace', () => {
  assert.match(app, /head\('Tasks & Approvals'/);
  assert.match(app, /Cases requiring action/);
  assert.match(app, /function workbench\(\)\{\s*const ranked=operationalApplications\(\)/);
  assert.match(app, /!isDemoRecord\(item\)&&item\.humanRequired/);
  assert.match(app, /ranked\.filter\(\(\{action\}\)=>action\.priority>=55\)/);
  assert.doesNotMatch(app, /const needsDocs=state\.data\.applications/);
  assert.doesNotMatch(app, /My Workbench/);
  assert.doesNotMatch(app, /Assigned exception cases/);
});

test('zero workload badges stay quiet and WhatsApp capacity is unambiguous', () => {
  assert.match(app, /function setNavBadge\(id,value\)/);
  assert.match(html, /id="workBadge" hidden>0/);
  assert.match(html, /aria-label="Notifications">N<em hidden>0<\/em>/);
  assert.match(app, /\$\{connected\.length\} LIVE · \$\{channels\.length\} SLOTS/);
  assert.doesNotMatch(app, /LIVE \/ 10 RESERVED/);
});

test('customer workspace reflects production messaging and excludes synthetic records', () => {
  assert.match(app, /const customerDocuments=businessDocuments\(\),pendingDocuments=customerDocuments\.filter/);
  assert.match(app, /applicationTable\(businessApplications\(\)\.slice\(0,8\)\)/);
  assert.match(app, /WhatsApp Meta Cloud connected/);
  assert.match(app, /if\(!cloud\)document\.querySelector\('\[data-record-reply\]'\)/);
  assert.doesNotMatch(app, /WhatsApp Business manual test mode/);
  assert.doesNotMatch(app, /Secure SharePoint records/);
});

test('effective customer workspaces keep operational filters and production-only records', () => {
  assert.match(architecture, /visible=businessLeads\(\)\.filter/);
  assert.match(architecture, /businessVisible=businessApplications\(\)\.filter/);
  assert.match(architecture, /application-filter-tabs/);
  assert.match(architecture, /applicationFilterMatch\(item,filter\)/);
  assert.match(architecture, /<th>Next action<\/th>/);
  assert.match(architecture, /nextActionCell\(item\)/);
});

test('internal navigation resets scroll and production assets are cache-busted', () => {
  assert.match(app, /window\.scrollTo\(\{top:0,behavior:'auto'\}\)/);
  assert.match(app, /page-breadcrumb/);
  assert.match(html, /app-v2\.js\?v=20260901-conversation2/);
  assert.match(html, /business-architecture\.js\?v=20260829-workflow1/);
  assert.match(html, /v2\.css\?v=20260827-operating-layer1/);
  assert.match(html, /customer-360\.css\?v=20260901-conversation2/);
});
