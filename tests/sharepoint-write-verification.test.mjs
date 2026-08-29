import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const api = fs.readFileSync(new URL('../api/crm.js', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../app-v2.js', import.meta.url), 'utf8');
const integrations = fs.readFileSync(new URL('../api/_integrations.js', import.meta.url), 'utf8');

test('SharePoint controlled write verification is Admin-only and does not use customer data', () => {
  assert.match(api, /action === 'verifySharePointWrite'/);
  assert.match(api, /session\.role !== 'ADMIN'/);
  assert.match(api, /CRM Integration Tests/);
  assert.match(api, /This file contains no customer data/);
  assert.match(api, /CRM_SHAREPOINT_WRITE_TEST_SUCCEEDED/);
  assert.match(api, /text\/plain; charset=utf-8/);
  assert.doesNotMatch(api.slice(api.indexOf('export async function runControlledSharePointWriteTest'), api.indexOf('async function uploadDocument')), /IC number|salary slip|bank statement/i);
});

test('customer documents remain isolated in one folder per immutable Case ID', () => {
  const uploadSection = api.slice(api.indexOf('async function uploadDocument'), api.indexOf('async function uploadSecondHandMotorPhoto'));
  assert.match(uploadSection, /CRM Customer Documents/);
  assert.match(uploadSection, /ensureFolder\(token, target\.drive\.id, crmFolder\.id, caseId \|\| 'Unassigned'\)/);
  assert.match(uploadSection, /items\/\$\{caseFolder\.id\}/);
});

test('System Settings exposes a confirmed controlled test and clear verification result', () => {
  assert.match(app, /data-test-sharepoint/);
  assert.match(app, /Run controlled write test/);
  assert.match(app, /No IC, salary slip, bank statement or customer record will be used/);
  assert.match(app, /SharePoint write test passed/);
  assert.match(app, /Open verification file/);
  assert.match(app, /Copy verification time/);
});

test('a successful test does not silently enable production storage', () => {
  assert.match(integrations, /SHAREPOINT_SITE_WRITE_VERIFIED_AT/);
  assert.match(integrations, /productionEnabled: writeVerified/);
  assert.match(app, /Production customer-document storage stays safely disabled until SHAREPOINT_SITE_WRITE_VERIFIED_AT is recorded/);
});

