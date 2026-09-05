import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app=fs.readFileSync(new URL('../app-v2.js',import.meta.url),'utf8');
const api=fs.readFileSync(new URL('../api/crm.js',import.meta.url),'utf8');
const productUi=fs.readFileSync(new URL('../product-business.js',import.meta.url),'utf8');
const businessUi=fs.readFileSync(new URL('../business-architecture.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const vercel=JSON.parse(fs.readFileSync(new URL('../vercel.json',import.meta.url),'utf8'));

test('Administrator settings organize only actionable go-live gaps',()=>{
  assert.match(html,/app-v2\.js\?v=20260905-customer-actions1/);
  assert.match(html,/v2\.css\?v=20260827-operating-layer1/);
  [
    'Go-live readiness',
    'Branch Manager coverage',
    'Active catalog images',
    'Approved pricing completeness',
    'Active catalog pricing coverage',
    'Active models without approved pricing',
    'Account password readiness',
    'Accounts requiring login action',
    'Active application uniqueness',
    'Duplicate active applications',
    'Synthetic QA isolation',
    'Branches missing a Manager',
    'Active catalog image issues',
    'Approved pricing gaps',
    'Isolated synthetic QA records',
    'Download checklist'
  ].forEach(label=>assert.ok(app.includes(label),label+' should be present'));
  assert.match(app,/item\.active&&\(!item\.imageApproved\|\|!item\.imageUrl\)/);
  assert.match(app,/price\.active&&String\(price\.status\)\.toUpperCase\(\)==='APPROVED'/);
  assert.match(app,/const pricingAmountReady=/);
  assert.match(app,/approvedPricingMissingFields\(price\)\.length/);
  assert.match(app,/const pricingGaps=reportPricing\.filter\(price=>price\.active&&String\(price\.status\)\.toUpperCase\(\)==='APPROVED'&&approvedPricingMissingFields\(price\)\.length\)/);
  assert.match(app,/catalogPricingCoverageGaps/);
  assert.match(app,/price\.baseDeposit\?\?price\.deposit/);
  assert.ok(app.includes('At least one 3–5-year monthly payment'));
  assert.match(api,/const motorMonthly = businessUnit === 'MOTOR'/);
  assert.match(api,/Fill at least one monthly instalment from 3 to 5 years/);
  assert.match(productUi,/const motorMonthlySummary = item/);
  assert.match(productUi,/Leave unavailable tenures blank/);
  assert.match(app,/passwordSetupGaps=state\.data\.users\.filter/);
  assert.match(app,/passwordActivationGaps=state\.data\.users\.filter\(user=>user\.loginEnabled&&user\.passwordConfigured&&user\.mustChangePassword\)/);
  assert.match(app,/must complete first login and change the temporary password/);
  assert.match(app,/duplicateActiveApplicationCount/);
  assert.match(app,/Password setup required/);
  assert.match(app,/u\.passwordConfigured=true;u\.mustChangePassword=true/);
  assert.match(api,/passwordConfigured: Boolean\(clean\(row\['Password Hash'\]\)\)/);
  assert.match(app,/const resources=\['integrations','catalog','pricing','users','qa','channels','outbox','activity','followUpSettings'\]/);
  assert.match(app,/const pendingIntegrationNames=pendingIntegrations\.map/);
  assert.ok(app.includes('remain safely gated until the required activation checks pass'));
  assert.ok(!app.includes('Meta/LMS remain safely disabled until approved credentials exist'));
});

test('Synthetic QA records stay traceable but do not distort production metrics',()=>{
  assert.match(api,/const isSyntheticLeadRow/);
  assert.match(api,/const isSyntheticApplicationRow/);
  assert.match(api,/synthetic: isSyntheticLeadRow\(row\)/);
  assert.match(api,/synthetic: isSyntheticApplicationRow\(row\)/);
  assert.match(api,/const businessLeads = scope\.leads\.filter/);
  assert.match(api,/const businessApplications = scope\.applications\.filter/);
  assert.match(api,/resource === 'qa'/);
  assert.match(api,/const records = \[\.\.\.businessLeads\]\.reverse/);
  assert.match(api,/const records = \[\.\.\.businessApplications\]\.reverse/);
  assert.match(api,/businessApplicationIds\.has\(row\['Application ID'\]\) \|\| businessLeadIds\.has\(row\['Lead ID'\]\)/);
  assert.match(app,/const syntheticRows=\(state\.data\.qa\|\|\[\]\)/);
  assert.ok(app.includes('Excluded from daily workspaces, dashboard and business reports'));
  assert.match(app,/!isSyntheticLead\(lead\)&&reportWithin/);
  assert.match(app,/!isSyntheticApplication\(application\)&&reportWithin/);
});

test('Deployment prevents stale HTML while versioning frontend assets',()=>{
  const root=vercel.headers.find(entry=>entry.source==='/');
  const index=vercel.headers.find(entry=>entry.source==='/index.html');
  assert.equal(root.headers.find(header=>header.key==='Cache-Control').value,'no-store, max-age=0');
  assert.equal(index.headers.find(header=>header.key==='Cache-Control').value,'no-store, max-age=0');
  assert.match(html,/product-business\.js\?v=20260905-active-catalog1/);
  assert.match(html,/business-architecture\.js\?v=20260829-workflow1/);
  assert.ok(productUi.length>60000,'Product business bundle must not be truncated during deployment');
  assert.ok(businessUi.length>50000,'Business architecture bundle must not be truncated during deployment');
  assert.ok(productUi.indexOf('function editProductPricing')<productUi.indexOf('const originalProductPricingEditor'),'Base pricing editor must exist before the safe override');
  assert.match(productUi,/const selected = isHandphoneCatalogView\(\) \? 'HANDPHONE' : 'MOTOR'/);
  assert.match(productUi,/filter\(item => unitOf\(item\) === selected/);
});

test('Deployment applies browser security boundaries without blocking approved assets',()=>{
  const global=vercel.headers.find(entry=>entry.source==='/(.*)');
  const headers=Object.fromEntries(global.headers.map(header=>[header.key,header.value]));
  assert.match(headers['Content-Security-Policy'],/default-src 'self'/);
  assert.match(headers['Content-Security-Policy'],/frame-ancestors 'none'/);
  assert.match(headers['Content-Security-Policy'],/https:\/\/fonts\.googleapis\.com/);
  assert.match(headers['Content-Security-Policy'],/img-src 'self' data: blob: https:/);
  assert.match(headers['Permissions-Policy'],/camera=\(self\)/);
  assert.match(headers['Permissions-Policy'],/geolocation=\(\)/);
});
