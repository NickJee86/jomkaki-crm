import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app=fs.readFileSync(new URL('../app-v2.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const api=fs.readFileSync(new URL('../api/crm.js',import.meta.url),'utf8');

test('Administrator report loads every company control resource',()=>{
  assert.match(app,/const resources=\['inbox','outbox','catalog','pricing','users','activity','integrations','channels'\]/);
  assert.match(app,/state\.user\?\.role!=='ADMIN'/);
  assert.match(app,/reportsScoped\(\)/);
});

test('Administrator report covers the complete operating view',()=>{
  [
    'Company Reports & Analytics',
    'Administrator company-wide visibility',
    'Lead and application trend',
    'Open-case ageing',
    'Missing document types',
    'Lead sources',
    'Customer-to-completion funnel',
    'Loan application status',
    'Eligibility status',
    'CAD status',
    'Rejection and exception reasons',
    'Regional performance',
    'Branch performance',
    'Staff workload and performance',
    'LMS submission status',
    'Document verification status',
    'Customer inbox status',
    'Message outbox status',
    'WhatsApp Meta Cloud performance',
    'LMS submission and decision performance',
    'Prepared - waiting for connection',
    'Integration readiness',
    'Catalog, pricing and access health',
    'Recent audit activity'
  ].forEach(label=>assert.ok(app.includes(label),label+' should be present'));
});

test('Administrator report supports filters and aggregate export',()=>{
  assert.match(app,/id="reportPeriod"/);
  assert.match(app,/id="reportRegion"/);
  assert.match(app,/id="reportBranch"/);
  assert.match(app,/id="reportStaff"/);
  assert.match(app,/id="reportStage"/);
  assert.match(app,/Download complete CSV/);
  assert.match(app,/downloadAdminReport\(report\)/);
  assert.match(app,/reportPeriodComparison/);
  assert.match(app,/reportMissingDocumentGroups/);
  assert.match(app,/reportIsOverdue/);
  assert.match(app,/\['created','updated'\]/);
  assert.match(app,/const source=channelReportSource\(\)/);
  assert.match(app,/Object\.assign\(state\.data,source\)/);
  assert.match(app,/Object\.assign\(state\.data,backup\)/);
  assert.doesNotMatch(app,/CSV export disabled in Demo preview/);
});

test('Report API exposes stable created dates and attribution fields',()=>{
  assert.match(api,/source: row\['Lead Source'\]/);
  assert.match(api,/created: row\['Created At'\]/);
  assert.match(api,/rejectionReason:/);
  assert.match(api,/submittedAt:/);
  assert.match(api,/lmsDecisionAt:/);
  assert.match(api,/deliveredAt:/);
  assert.match(api,/readAt:/);
  assert.match(api,/resource === 'integrations'/);
});

test('Report deployment uses a fresh cache version',()=>{
  assert.match(html,/v2\.css\?v=20260808-admin-reports-layout/);
  assert.match(html,/design-refresh\.css\?v=20260808-readiness-1/);
  assert.match(html,/app-v2\.js\?v=20260810-iphone17-catalog1/);
});
