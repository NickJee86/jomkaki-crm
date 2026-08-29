import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app=fs.readFileSync(new URL('../app-v2.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../design-refresh.css',import.meta.url),'utf8');
const architecture=fs.readFileSync(new URL('../business-architecture.js',import.meta.url),'utf8');
const products=fs.readFileSync(new URL('../product-business.js',import.meta.url),'utf8');

test('expired sessions return to sign in without leaving stale CRM content visible',()=>{
  assert.match(app,/function showWorkspaceError[\s\S]*message==='AUTH'[\s\S]*shell\.hidden=true[\s\S]*gate\.classList\.remove\('hidden'\)/);
  assert.match(app,/Sign in again to continue from the same page/);
  assert.match(app,/catch\(error\).*message==='AUTH'.*showWorkspaceError\('AUTH'\)/);
});

test('mobile users receive direct navigation to daily work',()=>{
  assert.match(html,/class="mobile-bottom-nav"/);
  assert.match(html,/class="mobile-nav-item" data-view="followup"/);
  assert.match(html,/class="mobile-nav-item" data-view="inbox"/);
  assert.match(css,/@media\(max-width:720px\)[\s\S]*\.mobile-bottom-nav\{position:fixed;display:grid/);
});

test('follow-up separates daily customer work from administrator controls',()=>{
  assert.match(app,/Today &amp; customer queue/);
  assert.match(app,/Rules, templates &amp; exceptions/);
  assert.match(app,/data-followup-filter/);
  assert.match(app,/queueGroups=\{DUE:due,SALES:sales,DOCUMENTS:documents/);
});

test('customer work lists expose practical common filters',()=>{
  for(const id of ['leadStatus','leadRegion','leadOwner','applicationRegion','applicationBranch','applicationOwner','documentType','documentStatus','catalogBrand','catalogCategory','catalogStatus'])assert.match(app,new RegExp(`id="${id}"`));
  for(const id of ['leadStatus','leadRegion','leadOwner','applicationRegion','applicationBranch','applicationOwner'])assert.match(architecture,new RegExp(`id="${id}"`));
  for(const id of ['catalogBrand','catalogCategory'])assert.match(products,new RegExp(`id="${id}"`));
  assert.match(app,/data-document-quick="OVERDUE"/);
});

test('WhatsApp reply composer includes grounded sales shortcuts and recent context',()=>{
  assert.match(app,/function whatsappSalesPresets/);
  assert.match(app,/Quote & close/);
  assert.match(app,/Ask documents/);
  assert.match(app,/Application form/);
  assert.match(app,/Consent next/);
  assert.match(app,/Branch & map/);
  assert.match(app,/data-recent-conversation/);
  assert.match(app,/data-sales-context/);
});
