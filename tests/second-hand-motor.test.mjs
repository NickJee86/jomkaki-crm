import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { rankSecondHandMotors } from '../api/crm.js';

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const api = read('../api/crm.js');
const ui = read('../second-hand-motor.js');
const index = read('../index.html');

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

test('CRM exposes secure inventory management, phone photo upload, location and AI preview', () => {
  assert.match(api, /Second_Hand_Motor_Inventory/);
  assert.match(api, /saveSecondHandMotor/);
  assert.match(api, /uploadSecondHandMotorPhoto/);
  assert.match(api, /Customer Location Label/);
  assert.match(api, /session\.role !== 'ADMIN'/);
  assert.match(ui, /capture="environment"/);
  assert.match(ui, /AI RECOMMENDATION PREVIEW/);
  assert.match(ui, /Same region first/);
  assert.match(index, /data-view="usedMotorInventory"/);
});

