import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { canReviewHandphone, canSubmitHandphone, handphoneApprovalStatus } from '../api/crm.js';

const api = fs.readFileSync(new URL('../api/crm.js', import.meta.url), 'utf8');
const ui = fs.readFileSync(new URL('../product-business.js', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../app-v2.js', import.meta.url), 'utf8');

test('legacy Handphone rows remain approved while new submissions are pending', () => {
  assert.equal(handphoneApprovalStatus({ Active: 'TRUE' }), 'APPROVED');
  assert.equal(handphoneApprovalStatus({ 'Submitted By': 'branch.one' }), 'PENDING_APPROVAL');
  assert.equal(handphoneApprovalStatus({ 'Approval Status': 'REJECTED' }), 'REJECTED');
});

test('Handphone submission and review scopes are separated', () => {
  const branch = { role: 'BRANCH_SUPERVISOR', businessAccess: 'HANDPHONE', region: 'EAST_MALAYSIA', branchId: 'BR-EAST-01', username: 'branch.one' };
  const eastRegional = { role: 'REGION_MANAGER', businessAccess: 'BOTH', region: 'EAST_MALAYSIA', username: 'regional.east' };
  const westRegional = { role: 'REGION_MANAGER', businessAccess: 'BOTH', region: 'WEST_MALAYSIA', username: 'regional.west' };
  const admin = { role: 'ADMIN', businessAccess: 'BOTH', region: 'ALL', username: 'admin' };
  const pending = { 'Approval Status': 'PENDING_APPROVAL', 'Submitted By': 'branch.one', 'Submitted Region': 'EAST_MALAYSIA', 'Submitted Branch ID': 'BR-EAST-01' };
  assert.equal(canSubmitHandphone(branch), true);
  assert.equal(canSubmitHandphone({ role: 'BUSINESS_MANAGER', region: 'ALL' }), true);
  assert.equal(canReviewHandphone(branch, pending), false);
  assert.equal(canReviewHandphone(eastRegional, pending), true);
  assert.equal(canReviewHandphone(westRegional, pending), false);
  assert.equal(canReviewHandphone(admin, pending), true);
  assert.equal(canReviewHandphone({ ...eastRegional, username: 'branch.one' }, pending), false);
});

test('Handphone catalog, pricing and stock actions are approval controlled', () => {
  assert.match(api, /reviewHandphoneCatalog/);
  assert.match(api, /reviewHandphonePricing/);
  assert.match(api, /setHandphoneStockAvailability/);
  assert.match(api, /Admin Review Required/);
  assert.match(api, /Minimum Product Price \(RM\)/);
  assert.match(api, /Supersedes Catalog ID/);
  assert.match(api, /Supersedes Pricing ID/);
  assert.match(api, /remains live/);
  assert.match(api, /Approval Status': 'MERGED'/);
  assert.match(api, /CRM_HANDPHONE_BRANCH_STOCK_UPDATED/);
  assert.match(api, /CRM_HANDPHONE_(CATALOG|PRICING)_SUBMITTED_FOR_APPROVAL/);
});

test('Handphone UI exposes submit, stock and regional approval workflows', () => {
  assert.match(ui, /Submit for approval/);
  assert.match(ui, /Update stock now/);
  assert.match(ui, /reviewHandphoneCatalog/);
  assert.match(ui, /reviewHandphonePricing/);
  assert.match(ui, /price-floor exceptions require Admin/);
  assert.match(ui, /Unapproved changes remain internal/);
});

test('Admin reports expose the Handphone approval workload', () => {
  assert.match(app, /Handphone approval queue/);
  assert.match(app, /Phone catalog approval/);
  assert.match(app, /Phone pricing approval/);
  assert.match(app, /Handphone Admin price exceptions/);
});
