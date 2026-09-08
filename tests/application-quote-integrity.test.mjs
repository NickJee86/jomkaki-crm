import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { selectApplicationQuote } from '../api/crm.js';

const source = fs.readFileSync(new URL('../api/crm.js', import.meta.url), 'utf8');
const columnNameStart = source.indexOf('const columnName = index => {');
const columnNameEnd = source.indexOf('\n};', columnNameStart) + 3;
const columnName = new Function(`${source.slice(columnNameStart, columnNameEnd)}; return columnName;`)();
const approvedPricing = overrides => ({
  Active: 'TRUE',
  'Quote Approval Status': 'APPROVED',
  'Catalog ID': 'HP-17-256-BLACK',
  Brand: 'Apple',
  Model: 'iPhone 17',
  Variant: '256GB · Black',
  'Price Zone': 'ALL_BRANCHES',
  'Monthly 24 Months (RM)': '199',
  ...overrides
});

test('application quote uses the exact Catalog ID and prefers its one regional rate', () => {
  const application = {
    'Catalog ID': 'HP-17-256-BLACK',
    'Product Brand': 'Apple',
    'Product Model': 'iPhone 17',
    'Product Variant': '256GB · Black'
  };
  const global = approvedPricing({ 'Monthly 24 Months (RM)': '199' });
  const regional = approvedPricing({ 'Price Zone': 'EAST_MALAYSIA', 'Monthly 24 Months (RM)': '189' });
  assert.equal(selectApplicationQuote(application, [global, regional], 'EAST_MALAYSIA'), regional);
});

test('legacy applications require an exact full variant and never borrow a sibling SKU price', () => {
  const application = {
    'Product Brand': 'Apple',
    'Product Model': 'iPhone 17',
    'Product Variant': '256GB · Black'
  };
  const wrongStorage = approvedPricing({ 'Catalog ID': 'HP-17-512-BLACK', Variant: '512GB · Black', 'Monthly 24 Months (RM)': '299' });
  const wrongColour = approvedPricing({ 'Catalog ID': 'HP-17-256-WHITE', Variant: '256GB · White', 'Monthly 24 Months (RM)': '209' });
  const exact = approvedPricing({ 'Monthly 24 Months (RM)': '199' });
  assert.equal(selectApplicationQuote(application, [wrongStorage, wrongColour, exact], 'WEST_MALAYSIA'), exact);
  assert.equal(selectApplicationQuote({ ...application, 'Product Variant': '' }, [wrongStorage, wrongColour, exact], 'WEST_MALAYSIA'), null);
});

test('quote lookup fails closed for conflicting identity or duplicate exact rates', () => {
  const application = {
    'Catalog ID': 'HP-17-256-BLACK',
    'Product Brand': 'Apple',
    'Product Model': 'iPhone 17',
    'Product Variant': '256GB · Black'
  };
  const inconsistent = approvedPricing({ Model: 'iPhone Air' });
  assert.equal(selectApplicationQuote(application, [inconsistent], 'WEST_MALAYSIA'), null);
  const first = approvedPricing({ 'Price Zone': 'WEST_MALAYSIA', 'Monthly 24 Months (RM)': '199' });
  const duplicate = approvedPricing({ 'Price Zone': 'WEST_MALAYSIA', 'Monthly 24 Months (RM)': '188' });
  assert.equal(selectApplicationQuote(application, [first, duplicate], 'WEST_MALAYSIA'), null);
});

test('second-hand applications never inherit new-motor pricing', () => {
  assert.equal(selectApplicationQuote({
    'Motor Type': 'SECOND_HAND',
    'Product Brand': 'Yamaha',
    'Product Model': 'NMAX',
    'Product Variant': 'Standard'
  }, [approvedPricing({ 'Catalog ID': 'MTR-NMAX', Brand: 'Yamaha', Model: 'NMAX', Variant: 'Standard' })], 'WEST_MALAYSIA'), null);
});

test('new and edited applications persist Catalog ID and the API uses the guarded selector', () => {
  assert.match(source, /const applicationRecordHeaders = \['Catalog ID',/);
  assert.match(source, /'Catalog ID': motorType === 'SECOND_HAND' \? '' : catalogId/);
  assert.match(source, /'Catalog ID': secondHandApplication \? '' : catalogId/);
  assert.match(source, /const quote = selectApplicationQuote\(row, pricing, zone\) \|\| \{\}/);
  assert.match(source, /catalogId: row\['Catalog ID'\]/);
});

test('applicant profile updates include ensured headers beyond the old BX boundary', async () => {
  const profileStart = source.indexOf("if (action === 'updateApplicantProfile')");
  const writeStart = source.indexOf("const applicationHeaders = await ensureSheetHeaders(req, 'Applications'", profileStart);
  const writeEnd = source.indexOf('if (linkedLead)', writeStart);
  assert.ok(profileStart >= 0 && writeStart > profileStart && writeEnd > writeStart, 'Cannot locate applicant profile persistence');
  const writeSnippet = source.slice(writeStart, writeEnd).trim();
  const invokeWrite = new Function(
    'ensureSheetHeaders', 'updateObject', 'req', 'applicationId', 'changes', 'applicationRecordHeaders', 'creditConsentHeaders', 'columnName',
    `return (async () => { ${writeSnippet} })();`
  );
  const headers = Array.from({ length: 77 }, (_, index) => `Column ${index + 1}`);
  headers[76] = 'Catalog ID';
  let updateCall;
  await invokeWrite(
    async () => headers,
    async (...args) => { updateCall = args; },
    {}, 'APP-SYNTHETIC', { 'Catalog ID': 'CAT-SYNTHETIC' }, [], [], columnName
  );
  assert.equal(columnName(75), 'BX');
  assert.equal(updateCall[5], 'BY');
});
