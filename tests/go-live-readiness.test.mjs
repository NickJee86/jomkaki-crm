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
    'Synthetic QA isolation',
    'Branches missing a Manager',
    'Active catalog image issues',
    'Approved pricing gaps',
    'Isolated synthetic QA records',
    'Download checklist'
  ].forEach(label=>assert.ok(app.includes(label),label+' should be present'));
  assert.match(app,/item\.active&&\(!item\.imageApproved\|\|!item\.imageUrl\)/);
  assert.match(app,/price\.active&&String\(price\.status\)\.toUpperCase\(\)==='APPROVED'/);
  assert.match(app,/const resources=\['integrations','catalog','pricing','users','qa'\]/);
});

test('Synthetic QA records stay traceable but do not distort production metrics',()=>{
  assert.match(api,/const isSyntheticLeadRow/);
  assert.match(api,/const isSyntheticApplicationRow/);
  assert.match(api,/synthetic: isSyntheticLeadRow\(row\)/);
  assert.match(api,/synthetic: isSyntheticApplicationRow\(row\)/);
  assert.match(api,/const businessLeads = scope\.leads\.filter/);
  assert.match(api,/const businessApplications = scope\.applications\.filter/);
  assert.match(api,/resource === 'qa'/);
  assert.match(api,/const records = businessLeads\.slice/);
  assert.match(api,/const records = businessApplications\.slice/);
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
