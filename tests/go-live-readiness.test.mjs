import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app=fs.readFileSync(new URL('../app-v2.js',import.meta.url),'utf8');
const api=fs.readFileSync(new URL('../api/crm.js',import.meta.url),'utf8');
const vercel=JSON.parse(fs.readFileSync(new URL('../vercel.json',import.meta.url),'utf8'));

test('Administrator settings organize only actionable go-live gaps',()=>{
  [
    'Go-live readiness',
    'Branch Manager coverage',
    'Active catalog images',
    'Approved pricing completeness',
    'Account password readiness',
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
  assert.match(app,/price\.baseDeposit\?\?price\.deposit/);
  assert.ok(app.includes('At least one 3–5-year monthly payment'));
  assert.match(api,/const motorMonthly = businessUnit === 'MOTOR'/);
  assert.match(api,/Fill at least one monthly instalment from 3 to 5 years/);
  assert.match(app,/passwordSetupGaps=state\.data\.users\.filter/);
  assert.match(app,/Password setup required/);
  assert.match(app,/u\.passwordConfigured=true;u\.mustChangePassword=true/);
  assert.match(api,/passwordConfigured: Boolean\(clean\(row\['Password Hash'\]\)\)/);
  assert.match(app,/const resources=\['integrations','catalog','pricing','users','qa','channels'\]/);
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
});
