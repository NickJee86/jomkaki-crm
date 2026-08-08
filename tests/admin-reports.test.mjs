import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app=fs.readFileSync(new URL('../app-v2.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');

test('Administrator report loads every company control resource',()=>{
  assert.match(app,/const resources=\['inbox','outbox','catalog','pricing','users','activity'\]/);
  assert.match(app,/state\.user\?\.role!=='ADMIN'/);
  assert.match(app,/reportsScoped\(\)/);
});

test('Administrator report covers the complete operating view',()=>{
  [
    'Company Reports & Analytics',
    'Administrator company-wide visibility',
    'Customer-to-completion funnel',
    'Regional performance',
    'Branch performance',
    'Staff workload and performance',
    'LMS submission status',
    'Document verification status',
    'Customer inbox status',
    'Message outbox status',
    'Catalog, pricing and access health',
    'Recent audit activity'
  ].forEach(label=>assert.ok(app.includes(label),label+' should be present'));
});

test('Administrator report supports filters and aggregate export',()=>{
  assert.match(app,/id="reportPeriod"/);
  assert.match(app,/id="reportRegion"/);
  assert.match(app,/Download report CSV/);
  assert.match(app,/downloadAdminReport\(report\)/);
});

test('Report deployment uses a fresh cache version',()=>{
  assert.match(html,/v2\.css\?v=20260808-admin-reports-layout/);
  assert.match(html,/app-v2\.js\?v=20260808-admin-reports/);
});
