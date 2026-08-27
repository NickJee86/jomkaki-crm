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
  assert.match(html,/customer-360\.css\?v=20260827-operating-layer1/);
  assert.match(css,/\.customer-360-drawer/);
  assert.match(css,/\.customer-360-conversation/);
  assert.match(css,/\.customer-360-message\.outgoing/);
  assert.match(css,/@media\(max-width:620px\)/);
});

test('Customer 360 cannot remain on an endless loading screen',()=>{
  assert.match(app,/timeoutMs:6000/);
  assert.match(app,/const controller=new AbortController\(\)/);
  assert.match(app,/Customer profile loaded/);
  assert.match(app,/data-360-retry/);
  assert.match(app,/The customer record could not be loaded/);
  assert.match(css,/\.customer-360-load-warning/);
  assert.match(html,/app-v2\.js\?v=20260827-action-queue1/);
  assert.match(app,/function customer360DocumentRequirement/);
  assert.match(app,/IDENTITY_DOCUMENT/);
  assert.match(app,/Received · Pending AI/);
});

test('Production CRM does not inject preview customers',()=>{
  assert.match(app,/const customer360Demos=\[\];/);
  assert.match(app,/function customer360DemoPanel\(\)\{return\'\'\}/);
  assert.match(app,/const demoFeatureViews=new Set\(\);/);
  assert.match(app,/function demoFeatureBanner\(\)\{return\'\'\}/);
});

test('Stale preview rows are removed from every customer workflow feature',()=>{
  assert.match(app,/const demoFeatureResources=\['leads','applications','documents','inbox','outbox','activity'\]/);
  assert.match(app,/function syncDemoFeatureData/);
  assert.match(app,/filter\(record=>!isDemoRecord\(record\)\)/);
  assert.match(app,/function channelReportSource/);
  assert.match(app,/Object\.assign\(state\.data,source\)/);
  assert.match(app,/Object\.assign\(state\.data,backup\)/);
});

test('Archived sample definitions cannot enter active CRM state',()=>{
  assert.match(app,/const archivedCustomer360Demos=\[/);
  assert.match(app,/const customer360Demos=\[\];/);
  assert.doesNotMatch(app,/customer360Demos=archivedCustomer360Demos/);
});
