import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const webhook = fs.readFileSync(new URL('../api/whatsapp-webhook.js', import.meta.url), 'utf8');
const crm = fs.readFileSync(new URL('../api/crm.js', import.meta.url), 'utf8');

test('webhook expands a worksheet before appending headers beyond its grid', () => {
  assert.match(webhook, /ensureSheetColumnCapacity\(token, sheet, headers\.length \+ missing\.length\)/);
  assert.match(webhook, /appendDimension/);
  assert.match(webhook, /requiredColumnCount - currentColumnCount/);
});

test('CRM admin writes use the same automatic column expansion protection', () => {
  assert.match(crm, /appendDimension/);
  assert.match(crm, /Unable to expand \$\{sheet\} grid/);
});
