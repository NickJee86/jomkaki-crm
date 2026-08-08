import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const api = readFileSync(new URL('../api/crm.js', import.meta.url), 'utf8');
const app = readFileSync(new URL('../app-v2.js', import.meta.url), 'utf8');

assert.match(api, /\['saveCatalogItem', 'savePricingPromotion'\]/, 'Catalog and pricing save actions must share an admin gate');
assert.match(api, /session\.role !== 'ADMIN'/, 'Catalog and promotion changes must require Administrator access');
assert.match(api, /CRM_CATALOG_(CREATED|UPDATED)/, 'Catalog changes must be audited');
assert.match(api, /CRM_PRICING_PROMOTION_(CREATED|UPDATED)/, 'Pricing and promotion changes must be audited');
assert.match(api, /Promotion Approval Status/, 'Promotion approval must be persisted');
assert.match(api, /setPricingDerivedFormulas/, 'New price rows must receive the spreadsheet formulas');

assert.match(app, /\+ Add motor model/, 'Admin catalog page must offer model creation');
assert.match(app, /Edit catalog/, 'Admin catalog page must offer model editing');
assert.match(app, /\+ Add price \/ promotion/, 'Admin pricing page must offer price creation');
assert.match(app, /Edit price \/ promotion/, 'Admin pricing page must offer promotion editing');
assert.match(app, /state\.user\?\.role==='ADMIN'/, 'Write controls must be role-aware');

console.log('admin catalog and promotion tests passed');
