import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { canReviewSecondHandMotor, rankSecondHandMotors, secondHandApprovalStatus } from '../api/crm.js';

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const readOptional = path => { try { return read(path); } catch { return ''; } };
const api = read('../api/crm.js');
const ui = read('../second-hand-motor.js');
const index = read('../index.html');
const app = read('../app-v2.js');
const makeBlueprintRaw = readOptional('../../../S03C-production.blueprint.json');
const makeBlueprint = makeBlueprintRaw ? JSON.parse(makeBlueprintRaw) : { flow: [] };
const externalBlueprintTest = makeBlueprintRaw ? test : test.skip;

const motor = (id, model, price, region = 'EAST_MALAYSIA', status = 'AVAILABLE') => ({
  'Inventory ID': id, Brand: 'Yamaha', Model: model, Region: region, 'Selling Price (RM)': price,
  'Stock Status': status, 'Customer Visible': 'TRUE', 'Image Approved': 'TRUE', 'Mileage KM': '12000', 'Similar Price Tolerance (RM)': '1500'
});

test('second-hand recommendation prioritises the exact available model in the customer region', () => {
  const results = rankSecondHandMotors([motor('2H-1', 'Y15ZR', 7800), motor('2H-2', 'Y16ZR', 8600)], { query: 'Y15ZR', budget: 8000, region: 'EAST_MALAYSIA' });
  assert.equal(results[0].record['Inventory ID'], '2H-1');
  assert.equal(results[0].matchType, 'EXACT_MODEL');
  assert.equal(results[0].sameRegion, true);
});

test('sold or hidden motors are never recommended and similar price is used as fallback', () => {
  const sold = motor('2H-SOLD', 'Y15ZR', 7600, 'EAST_MALAYSIA', 'SOLD');
  const similar = motor('2H-SIMILAR', 'Y16ZR', 8200);
  const results = rankSecondHandMotors([sold, similar], { query: 'Y15ZR', budget: 8000, region: 'EAST_MALAYSIA' });
  assert.deepEqual(results.map(item => item.record['Inventory ID']), ['2H-SIMILAR']);
  assert.equal(results[0].matchType, 'SIMILAR_PRICE');
});

test('pending branch submissions stay out of AI until Regional Manager or Admin approval', () => {
  const pending = { ...motor('2H-PENDING', 'Y15ZR', 7800), 'Approval Status': 'PENDING_APPROVAL', 'Submitted By': 'branch-east-1' };
  assert.equal(secondHandApprovalStatus(pending), 'PENDING_APPROVAL');
  assert.deepEqual(rankSecondHandMotors([pending], { query: 'Y15ZR', region: 'EAST_MALAYSIA' }), []);
  assert.equal(canReviewSecondHandMotor({ role: 'REGION_MANAGER', region: 'EAST_MALAYSIA', businessAccess: 'MOTOR' }, pending), true);
  assert.equal(canReviewSecondHandMotor({ role: 'REGION_MANAGER', region: 'WEST_MALAYSIA', businessAccess: 'MOTOR' }, pending), false);
  assert.equal(canReviewSecondHandMotor({ role: 'BRANCH_MANAGER', branchId: 'BR-E1', region: 'EAST_MALAYSIA', businessAccess: 'MOTOR' }, pending), false);
  assert.equal(canReviewSecondHandMotor({ role: 'ADMIN', region: 'ALL', businessAccess: 'BOTH' }, pending), true);
});

test('CRM exposes secure inventory management, phone photo upload, location and AI preview', () => {
  assert.match(api, /Second_Hand_Motor_Inventory/);
  assert.match(api, /saveSecondHandMotor/);
  assert.match(api, /uploadSecondHandMotorPhoto/);
  assert.match(api, /reviewSecondHandMotor/);
  assert.match(api, /PENDING_APPROVAL/);
  assert.match(api, /Admin or the Regional Manager for this region must approve this listing/);
  assert.match(api, /Customer Location Label/);
  assert.match(api, /canEditSecondHandMotor/);
  assert.match(ui, /capture="environment"/);
  assert.match(ui, /AI RECOMMENDATION PREVIEW/);
  assert.match(ui, /same region/i);
  assert.match(ui, /Branch submission.*Regional\/Admin approval.*Customer & AI publication/s);
  assert.match(ui, /Submit for approval/);
  assert.match(ui, /Approve & publish/);
  assert.match(index, /data-view="products"/);
  assert.match(app, /hubCard\('usedMotorInventory'/);
});

externalBlueprintTest('Make routes second-hand questions through live stock, price, region and same-number reply rules', () => {
  const router = makeBlueprint.flow.find(module => module.id === 9);
  const route = router.routes.find(item => item.filter?.name === 'Second-hand motor live inventory');
  assert.ok(route, 'second-hand Make route must exist');
  const modules = new Map(route.flow.map(module => [module.id, module]));
  assert.equal(modules.get(31).mapper.sheetId, 'Second_Hand_Motor_Inventory');
  assert.match(modules.get(33).mapper.input, /exact requested model in the same region/i);
  assert.match(modules.get(33).mapper.input, /closest-price alternatives/i);
  assert.equal(modules.get(34).mapper.values['25'], 'AI_SAME_INBOUND_CHANNEL');
});

test('Administrator reports split second-hand inventory with flexible combined filters and CSV export', () => {
  assert.match(app, /secondHandMotors/);
  assert.match(app, /reportSecondHandStatus/);
  assert.match(app, /reportSecondHandQuery/);
  assert.match(app, /regionAllowed\(motor\.region\).*branchAllowed\(motor\.branchId\)/s);
  assert.match(app, /2nd hand inventory by region, branch and status/i);
  assert.match(app, /2nd hand available stock value/i);
  assert.match(app, /report\.secondHandRows/);
});


