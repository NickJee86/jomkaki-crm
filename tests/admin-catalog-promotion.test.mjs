import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const api = readFileSync(new URL('../api/crm.js', import.meta.url), 'utf8');
const app = readFileSync(new URL('../app-v2.js', import.meta.url), 'utf8');

assert.match(api, /setCatalogItemEnabled/, 'Catalog must support direct disable and restore');
assert.match(api, /setPricingEnabled/, 'Pricing must support direct disable and enable');
assert.match(api, /setPromotionEnabled/, 'Promotions must support direct disable and enable');
assert.match(api, /session\.role !== 'ADMIN'/, 'Catalog and promotion changes must require Administrator access');
assert.match(api, /CRM_CATALOG_(CREATED|UPDATED)/, 'Catalog changes must be audited');
assert.match(api, /CRM_PRICING_PROMOTION_(CREATED|UPDATED)/, 'Pricing and promotion changes must be audited');
assert.match(api, /Promotion Approval Status/, 'Promotion approval must be persisted');
assert.match(api, /setPricingDerivedFormulas/, 'New price rows must receive the spreadsheet formulas');

assert.match(app, /\+ Add motor model/, 'Admin catalog page must offer model creation');
assert.match(app, /Edit catalog/, 'Admin catalog page must offer model editing');
assert.match(app, /data-toggle-catalog/, 'Admin catalog table must show a direct disable or restore action');
assert.match(app, /\+ Add price \/ promotion/, 'Admin pricing page must offer price creation');
assert.match(app, /Edit price \/ promotion/, 'Admin pricing page must offer promotion editing');
assert.match(app, /Disable promotion/, 'Admin pricing table must show a direct promotion disable action');
assert.match(app, /state\.user\?\.role==='ADMIN'/, 'Write controls must be role-aware');

console.log('admin catalog and promotion tests passed');
