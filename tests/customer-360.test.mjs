import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app=fs.readFileSync(new URL('../app-v2.js',import.meta.url),'utf8');
const api=fs.readFileSync(new URL('../api/crm.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../customer-360.css',import.meta.url),'utf8');

test('Every customer entry opens the same Customer 360',()=>{
  assert.match(app,/async function openCustomer360/);
  assert.match(app,/openLead=async function openLeadCustomer360\(id\)\{return openCustomer360/);
  assert.match(app,/openApp=async function openApplicationCustomer360\(id\)\{return openCustomer360/);
  assert.match(app,/data-customer-profile/);
  assert.match(app,/function bindCustomerProfileButtons/);
  assert.match(app,/function customerSearchCandidates/);
});

test('Customer 360 joins every operational record without changing the Sheet model',()=>{
  assert.match(app,/const resources=\['inbox','outbox','activity'\]/);
  assert.match(app,/applicationIds\.has\(row\.applicationId\)\|\|leadIds\.has\(row\.leadId\)/);
  assert.match(app,/normalizePhone\(row\.phone\|\|row\.recipient\)===phone/);
  assert.match(app,/WhatsApp, AI and human replies/);
  assert.match(app,/Documents and AI checks/);
  assert.match(app,/Readiness, LMS and follow-up/);
  assert.match(app,/Complete customer activity/);
  assert.match(app,/Staff \/ Manager':'AI \/ CRM/);
});

test('API returns the full permitted history and the UI protects sensitive data',()=>{
  assert.doesNotMatch(api,/visible = [^;]+\.slice\(-300\)/);
  assert.doesNotMatch(api,/businessLeads\.slice\(-300\)/);
  assert.doesNotMatch(api,/businessApplications\.slice\(-300\)/);
  assert.match(app,/Sensitive IC data stays masked/);
  assert.match(app,/Secure document links are not exposed/);
});

test('Customer 360 has a dedicated responsive brand design',()=>{
  assert.match(html,/customer-360\.css\?v=20260810-multichannel-2/);
  assert.match(css,/\.customer-360-drawer/);
  assert.match(css,/\.customer-360-conversation/);
  assert.match(css,/\.customer-360-message\.outgoing/);
  assert.match(css,/@media\(max-width:620px\)/);
});

test('Two safe samples demonstrate complete AI and human exception flows',()=>{
  assert.match(app,/const customer360Demos=\[/);
  assert.match(app,/AI complete - Ready for LMS/);
  assert.match(app,/AI exception - Human follow-up/);
  assert.match(app,/function openCustomer360Demo/);
  assert.match(app,/Not saved to Google Sheets/);
  assert.match(app,/Buttons that write data or send WhatsApp are disabled/);
  assert.match(app,/state\.user\?\.role!==\'ADMIN\'/);
  assert.match(css,/\.customer-360-demo-grid/);
});

test('The same safe samples appear throughout every customer workflow feature',()=>{
  assert.match(app,/const demoFeatureResources=\['leads','applications','documents','inbox','outbox','activity'\]/);
  assert.match(app,/const demoFeatureViews=new Set\(\['dashboard','workbench','reports','leads','applications','documents','inbox','outbox','activity'\]\)/);
  assert.match(app,/function syncDemoFeatureData/);
  assert.match(app,/Feature preview with 2 connected sample customers/);
  assert.doesNotMatch(app,/CSV export disabled in Demo preview/);
  assert.match(app,/function channelReportSource/);
  assert.match(app,/Object\.assign\(state\.data,source\)/);
  assert.match(app,/Object\.assign\(state\.data,backup\)/);
  assert.match(css,/\.demo-feature-banner/);
  assert.match(css,/\.data-table tr\.demo-row/);
});

test('Complete Customer 360 sample includes automated signed consent before LMS readiness',()=>{
  assert.match(app,/creditConsentStatus:'VERIFIED'/);
  assert.match(app,/type:'CREDIT_CONSENT'/);
  assert.match(app,/CONSENT_SENT_AUTOMATICALLY/);
  assert.match(app,/CONSENT_AI_VERIFIED/);
  assert.match(app,/Documents and signed consent are complete/);
});

