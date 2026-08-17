import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { prepareLmsSubmission } from '../api/_lmspro.js';
import { resolveCustomerChannel } from '../api/crm.js';

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const crm = read('../api/crm.js');
const webhook = read('../api/whatsapp-webhook.js');
const index = read('../index.html');
const appUi = read('../app-v2.js');
const productUi = read('../product-business.js');
const tenureUi = read('../handphone-tenure-v2.js');
const businessUi = read('../business-architecture.js');
const businessCss = read('../business-architecture.css');
const s02 = JSON.parse(read('../../S02 — AI Exception Staff Round Robin.blueprint.json'));
const s03Motor = JSON.parse(read('../../S03C-production.blueprint.json'));
const s03HandphoneRaw = read('../../S03H — Handphone Product & Financing.blueprint.json');
const s03Handphone = JSON.parse(s03HandphoneRaw);

const nodeMap = blueprint => {
  const map = new Map();
  const walk = flow => (flow || []).forEach(module => {
    map.set(module.id, module);
    (module.routes || []).forEach(route => walk(route.flow));
  });
  walk(blueprint.flow);
  return map;
};

const document = (id, type) => ({
  'Document ID': id,
  'Document Type': type,
  'File Name': `${type}.pdf`,
  'File URL': `https://example.invalid/${type}.pdf`,
  'Verification Status': 'AI_VERIFIED',
  'Quality Status': 'GOOD',
  'Manual Review Required': 'FALSE'
});

test('Handphone LMS contract uses monthly tenure and preserves business routing', () => {
  const result = prepareLmsSubmission({
    'Application ID': 'APP-HP-001',
    'Customer ID': 'CUS-001',
    'Applicant Name': 'Synthetic Handphone Applicant',
    'Applicant IC Number': '900101-00-0000',
    'Phone Number': '60100000000',
    'Business Unit': 'HANDPHONE',
    Region: 'WEST_MALAYSIA',
    'Team ID': 'TEAM-HP-WEST',
    'Product Brand': 'TEST BRAND',
    'Product Model': 'TEST MODEL',
    'Requested Product Price (RM)': '3200',
    'Requested Deposit (RM)': '300',
    'Loan Tenure Months': '36',
    'Origin WhatsApp Channel ID': 'JKM-WA-WEST-02'
  }, [document('DOC-1', 'IC_FRONT'), document('DOC-2', 'IC_BACK'), document('DOC-3', 'PAYSLIP')]);

  assert.equal(result.ready, true);
  assert.equal(result.payload.business_unit, 'HANDPHONE');
  assert.equal(result.payload.team_id, 'TEAM-HP-WEST');
  assert.equal(result.payload.financing.tenure_months, '36');
  assert.equal(result.payload.financing.tenure_years, '');
});

test('reply fallback cannot cross Motor and Handphone official numbers', () => {
  const resolved = resolveCustomerChannel({
    leadId: 'LEAD-HP-001',
    leads: [{ 'Lead ID': 'LEAD-HP-001', Region: 'WEST_MALAYSIA', 'Business Unit': 'HANDPHONE' }],
    channels: [
      { 'Internal Channel ID': 'JKM-WA-WEST-01', Region: 'WEST_MALAYSIA', 'Business Unit': 'MOTOR', Active: 'TRUE', 'Outbound Enabled': 'TRUE' },
      { 'Internal Channel ID': 'JKM-WA-WEST-02', Region: 'WEST_MALAYSIA', 'Business Unit': 'HANDPHONE', Active: 'TRUE', 'Outbound Enabled': 'TRUE' }
    ]
  });
  assert.equal(resolved.channel['Internal Channel ID'], 'JKM-WA-WEST-02');
});

test('CRM supports separate Handphone catalog, pricing, access and shared customer identity', () => {
  assert.match(crm, /Handphone_Model_Catalog!A1:AD1000/);
  assert.match(crm, /Handphone_Loan_Pricing!A1:AO1000/);
  assert.match(crm, /replace\(\/,\/g, ''\)/);
  assert.match(crm, /Loan Tenure Months/);
  assert.match(crm, /Business Access/);
  assert.match(webhook, /digits\(row\['Phone Number'\]\) === phone && clean\(row\['Business Unit'\]\)\.toUpperCase\(\) === routeBusinessUnit/);
  assert.match(webhook, /existingCustomer.*Customer ID/);
  assert.match(productUi, /Monthly 12 months/);
  assert.match(productUi, /Monthly 24 months/);
  assert.match(productUi, /Monthly 36 months/);
  assert.match(productUi, /Monthly 48 months/);
  assert.match(crm, /Monthly 60 Months \(RM\)/);
  assert.match(crm, /month60/);
  assert.match(tenureUi, /Monthly 5 years \(RM\)/);
  assert.match(tenureUi, /Blank years are not quoted by AI/);
  assert.match(index, /handphone-tenure-v2\.js/);
  assert.match(index, /data-view="handphoneCatalog"/);
  assert.match(index, /data-view="handphonePricing"/);
  assert.match(appUi, /handphoneCatalog:catalog/);
  assert.match(appUi, /handphonePricing:pricing/);
  assert.match(appUi, /view==='handphoneCatalog'\?'catalog'/);
  assert.match(productUi, /Apple · iPhone 17 family/i);
  assert.match(productUi, /One catalog card per phone model/);
  assert.match(productUi, /data-manage-phone-model/);
  assert.match(productUi, /five iPhone models are shown as five cards/i);
  assert.match(productUi, /Draft pricing safeguard/);
  assert.match(productUi, /pricing-pending/);
  assert.match(productUi, /ONE PRICE PER STORAGE/);
  assert.match(productUi, /Model and storage determine the price/);
  assert.match(productUi, /Colour never changes the phone price/);
  assert.match(productUi, /data-handphone-price-edit/);
  assert.match(productUi, /pricingScope: handphone \? 'MODEL_STORAGE_ZONE'/);
  assert.match(crm, /CRM_HANDPHONE_SHARED_PRICING_UPDATED/);
  assert.match(crm, /CRM_HANDPHONE_SHARED_PRICING_CREATED/);
  assert.match(crm, /storageFromVariant/);
  assert.match(productUi, /!\/TEMPLATE\/i/);
  assert.match(businessUi, /motorTenureField\.hidden=unit!=='MOTOR'/);
  assert.match(businessUi, /motorBranchField\.hidden=unit!=='MOTOR'/);
  assert.match(businessCss, /\.crm-form \[hidden\]\{display:none!important\}/);
  assert.match(businessUi, /\['productBrand','productModel','productVariant'\]/);
});

test('Handphone customer pricing is monthly-payment only', () => {
  assert.match(productUi, /MONTHLY PAYMENT ONLY/);
  assert.match(productUi, /Selling price and deposit are not stored, displayed or provided to AI/);
  assert.match(productUi, /Selling price and deposit are neither collected nor stored/);
  assert.match(crm, /'Product Price \(RM\)': '', 'Deposit \(RM\)': ''/);
  assert.match(crm, /productPrice: businessUnit === 'HANDPHONE' \? ''/);
  assert.match(crm, /deposit: businessUnit === 'HANDPHONE' \? ''/);
  assert.match(crm, /'Requested Product Price \(RM\)': businessUnit === 'HANDPHONE' \? ''/);
  assert.match(crm, /'Requested Deposit \(RM\)': businessUnit === 'HANDPHONE' \? ''/);
  assert.match(tenureUi, /removePhoneSaleFields/);
  assert.doesNotMatch(businessUi, /name="productPrice"/);
  assert.doesNotMatch(businessUi, /name="requestedDeposit"/);
  assert.match(businessUi, /available 1–5 year monthly-payment plan/);
  assert.match(businessUi, /5 years \(60 months\)/);
  assert.match(appUi, /At least one 1–5-year monthly payment/);
  assert.match(appUi, /price\.month60/);
});

test('Make exception assignment matches business and team before assigning staff', () => {
  const nodes = nodeMap(s02);
  assert.equal(s02.name, 'S02 — Business-Aware AI Exception Staff Round Robin');
  assert.equal(nodes.get(2).mapper.tableFirstRow, 'A1:BN1');
  assert.equal(nodes.get(2).mapper.filter[0][2].a, 'BH');
  assert.deepEqual(nodes.get(6).mapper.filter[0].map(item => item.a), ['C', 'L', 'N', 'J']);
  assert.deepEqual(nodes.get(7).mapper.filter[0].map(item => item.a), ['G', 'H', 'I', 'M', 'O']);
  assert.equal(nodes.get(9).mapper.rowNumber, '{{6.`__ROW_NUMBER__`}}');
});

test('Motor and Handphone Make scenarios are isolated with no Motor response leakage', () => {
  const motorNodes = nodeMap(s03Motor);
  const handphoneNodes = nodeMap(s03Handphone);
  assert.equal(motorNodes.get(4).filter.conditions[0][0].b, 'MOTOR');
  assert.equal(handphoneNodes.get(4).filter.conditions[0][0].b, 'HANDPHONE');
  assert.equal(handphoneNodes.get(6).mapper.sheetId, 'Handphone_Model_Catalog');
  assert.equal(handphoneNodes.get(18).mapper.sheetId, 'Handphone_Loan_Pricing');
  assert.equal(handphoneNodes.get(26).mapper.sheetId, 'Handphone_Loan_Pricing');
  for (const year of [1, 2, 3, 4, 5]) assert.match(s03HandphoneRaw, new RegExp(`${year} tahun RM`));
  for (const replyId of [19, 27]) {
    const reply = handphoneNodes.get(replyId).mapper.values['6'];
    assert.doesNotMatch(reply, /harga produk|deposit|cash price|selling price/i);
    assert.match(reply, /Pilihan ansuran bulanan/);
  }
  assert.match(s03HandphoneRaw, /Monthly 60 Months|`28`/);
  assert.match(s03HandphoneRaw, /Never disclose product selling price/);
  for (const forbidden of ['MOTOR_CATALOG_LOOKUP', 'MOTOR_MODEL_ON_REQUEST', 'MOTOR_EV_UNSUPPORTED', 'JKM_MOTOR_', 'Motor_Model_Catalog', 'Motor_Loan_Pricing', 'motosikal petrol']) {
    assert.equal(s03HandphoneRaw.includes(forbidden), false, `Handphone blueprint still contains ${forbidden}`);
  }
  assert.match(s03HandphoneRaw, /TEAM-HP|Handphone|HANDPHONE/);
});
