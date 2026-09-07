import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { appendObject, bindDocumentsToApplication, ensureHeaders, objects, updateObject, updateOutboxStatus } from '../api/whatsapp-webhook.js';

const response = (body = {}) => ({ ok: true, status: 200, json: async () => body });
function mockSheet(t, rows, { sheet = 'Applications' } = {}) {
  globalThis.__JOMKAKI_SHEET_READ_CACHE__?.clear();
  const calls = [], writes = [];
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    calls.push({ url, options });
    if (options.method && options.method !== 'GET') {
      const body = JSON.parse(options.body);
      writes.push({ url, options, body });
      if (options.method === 'PUT') rows[0].push(...body.values[0]);
      return response({ updates: { updatedRange: `${sheet}!A2:Z2` } });
    }
    if (url.includes('?fields=sheets.properties')) return response({ sheets: [{ properties: { sheetId: 7, title: sheet, gridProperties: { columnCount: 100 } } }] });
    const range = decodeURIComponent(new URL(url).pathname.split('/values/')[1] || '');
    assert.ok(range.startsWith(`${sheet}!`), `Unexpected mocked range: ${range}`);
    return response({ values: range.endsWith('!1:1') ? [rows[0]] : rows });
  });
  return { calls, writes };
}

test('normalized duplicate headers retain the first nonblank customer identity', () => {
  const rows = objects([
    ['\uFEFFApplication ID ', ' Application ID', ' Lead ID ', 'Customer Name', ' Customer Name '],
    ['APP-1', '', 'LEAD-1', '', 'Ali'],
    ['', 'APP-2', 'LEAD-2', 'Amin', 'Different value'],
    ['APP-3', 'CONFLICTING-ID', 'LEAD-3', 'Nur', ''],
    ['', '', '', '', '']
  ]);
  assert.deepEqual(rows, [
    { 'Application ID': 'APP-1', 'Lead ID': 'LEAD-1', 'Customer Name': 'Ali', rowNumber: 2 },
    { 'Application ID': 'APP-2', 'Lead ID': 'LEAD-2', 'Customer Name': 'Amin', rowNumber: 3 },
    { 'Application ID': 'APP-3', 'Lead ID': 'LEAD-3', 'Customer Name': 'Nur', rowNumber: 4 }
  ]);
});

test('row parsing keeps physical row numbers and preserves meaningful zero/false values', () => {
  const rows = objects([['Lead ID', 'Amount', 'Active', 'rowNumber'], ['', '', '', 'fake'], ['LEAD-2', 0, false, '999']]);
  assert.deepEqual(rows, [{ 'Lead ID': 'LEAD-2', Amount: 0, Active: false, rowNumber: 3 }]);
});

test('header ensure recognizes whitespace/BOM aliases without creating duplicate columns', async t => {
  const { calls, writes } = mockSheet(t, [['\uFEFFApplication ID ', ' Lead ID ', ' Created At']]);
  await ensureHeaders('mock-token', 'Applications', ['Application ID', ' Lead ID', '\uFEFFCreated At ', 'Application ID']);
  assert.equal(calls.length, 1);
  assert.equal(writes.length, 0);
});

test('header ensure adds a missing normalized critical field only once', async t => {
  const { writes } = mockSheet(t, [['Application ID']]);
  await ensureHeaders('mock-token', 'Applications', ['Application ID', ' Lead ID ', 'Lead ID', '\uFEFFCreated At']);
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].body.values, [['Lead ID', 'Created At']]);
  assert.ok(decodeURIComponent(writes[0].url).includes('Applications!B1:C1'));
});

test('identified-sheet append refuses missing identifiers instead of dropping them', async t => {
  const { writes } = mockSheet(t, [['Lead ID', 'Created At']]);
  await assert.rejects(appendObject('mock-token', 'Applications', { 'Application ID': 'APP-1', 'Lead ID': 'LEAD-1' }), /Missing Application ID header/);
  assert.equal(writes.length, 0);
});

test('identified-sheet append refuses blank IDs and duplicate identity columns', async t => {
  const rows = [['Application ID', 'Applicant Name']];
  const { writes } = mockSheet(t, rows);
  await assert.rejects(appendObject('mock-token', 'Applications', { 'Application ID': '  ', 'Applicant Name': 'Ali' }), /Missing Application ID value/);
  globalThis.__JOMKAKI_SHEET_READ_CACHE__?.clear();
  rows[0].push(' Application ID ');
  await assert.rejects(appendObject('mock-token', 'Applications', { 'Application ID': 'APP-1' }), /Ambiguous Application ID header/);
  assert.equal(writes.length, 0);
});

test('valid append maps normalized headers and keeps identifiers and formulas as raw text', async t => {
  const { writes } = mockSheet(t, [['\uFEFFApplication ID ', ' Lead ID ', ' Applicant Name ']]);
  await appendObject('mock-token', 'Applications', { 'Application ID': 'APP-1', 'Lead ID': 'LEAD-1', 'Applicant Name': '=not-a-formula' });
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].body.values, [['APP-1', 'LEAD-1', '=not-a-formula']]);
  assert.equal(new URL(writes[0].url).searchParams.get('valueInputOption'), 'RAW');
});

test('blank update IDs are rejected before reading or writing a sheet', async t => {
  const { calls } = mockSheet(t, [['Application ID'], ['']]);
  await assert.rejects(updateObject('mock-token', 'Applications', 'Application ID', '', { 'Applicant Name': 'Ali' }), /Missing row identifier/);
  assert.equal(calls.length, 0);
});

test('updates reject absent IDs and nonunique customer rows without writing', async t => {
  const rows = [['Application ID', 'Applicant Name'], ['APP-1', 'Ali'], [' APP-1 ', 'Amin']];
  const { writes } = mockSheet(t, rows);
  await assert.rejects(updateObject('mock-token', 'Applications', 'Application ID', 'APP-1', { 'Applicant Name': 'Changed' }), /Ambiguous Application ID/);
  await assert.rejects(updateObject('mock-token', 'Applications', 'Application ID', 'NOT-PRESENT', { 'Applicant Name': 'Changed' }), /Missing Application ID NOT-PRESENT/);
  assert.equal(writes.length, 0);
});

test('updates reject missing and duplicate identity headers rather than selecting a blank column', async t => {
  const rows = [['Lead ID', 'Applicant Name'], ['LEAD-1', 'Ali']];
  const { writes } = mockSheet(t, rows);
  await assert.rejects(updateObject('mock-token', 'Applications', 'Application ID', 'APP-1', { 'Applicant Name': 'Changed' }), /Missing Application ID header/);
  rows[0] = ['Application ID', ' Application ID ', 'Applicant Name'];
  rows[1] = ['APP-1', '', 'Ali'];
  await assert.rejects(updateObject('mock-token', 'Applications', 'Application ID', 'APP-1', { 'Applicant Name': 'Changed' }), /Ambiguous Application ID header/);
  assert.equal(writes.length, 0);
});

test('updates reject ambiguous destination columns and identity changes', async t => {
  const { writes } = mockSheet(t, [['Application ID', 'Applicant Name', ' Applicant Name '], ['APP-1', 'Ali', '']]);
  await assert.rejects(updateObject('mock-token', 'Applications', 'Application ID', 'APP-1', { 'Applicant Name': 'Changed' }), /Ambiguous Applicant Name header/);
  await assert.rejects(updateObject('mock-token', 'Applications', 'Application ID', 'APP-1', { 'Application ID': 'APP-2' }), /Cannot change Application ID/);
  assert.equal(writes.length, 0);
});

test('valid updates target the unique physical row through normalized headers', async t => {
  const { writes } = mockSheet(t, [['\uFEFFApplication ID ', ' Applicant Name ', 'Lead ID'], ['APP-1', 'Ali', 'LEAD-1'], ['APP-2', 'Amin', 'LEAD-2']]);
  await updateObject('mock-token', 'Applications', ' Application ID ', 'APP-2', { 'Applicant Name': 'Updated Amin' });
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].body, { valueInputOption: 'RAW', data: [{ range: 'Applications!B3', values: [['Updated Amin']] }] });
});

test('automatic application creation explicitly ensures its identity and linkage headers', () => {
  const source = fs.readFileSync(new URL('../api/whatsapp-webhook.js', import.meta.url), 'utf8');
  assert.match(source, /ensureHeaders\(token, 'Applications', \['Application ID', 'Lead ID', 'Created At'/);
});

test('document binding locates a unique document ID instead of trusting a stale physical row number', async t => {
  const { writes } = mockSheet(t, [['\uFEFFDocument ID ', ' Lead ID ', ' Application ID '], ['OTHER-DOC', 'OTHER-LEAD', ''], ['DOC-1', 'LEAD-1', '']], { sheet: 'Document_Log' });
  await bindDocumentsToApplication('mock-token', [{ 'Document ID': 'DOC-1', 'Lead ID': 'LEAD-1', rowNumber: 2 }], 'APP-1');
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].body.data, [{ range: 'Document_Log!C3', values: [['APP-1']] }]);
});

test('document binding rejects duplicate IDs and changed customer ownership before writing', async t => {
  const rows = [['Document ID', 'Lead ID', 'Application ID'], ['DOC-1', 'LEAD-1', ''], ['DOC-1', 'LEAD-1', '']];
  const { writes } = mockSheet(t, rows, { sheet: 'Document_Log' });
  const documents = [{ 'Document ID': 'DOC-1', 'Lead ID': 'LEAD-1', rowNumber: 2 }];
  await assert.rejects(bindDocumentsToApplication('mock-token', documents, 'APP-1'), /Ambiguous Document ID/);
  rows.pop(); rows[1][1] = 'OTHER-LEAD';
  await assert.rejects(bindDocumentsToApplication('mock-token', documents, 'APP-1'), /Document lead identity changed/);
  rows[1][1] = 'LEAD-1'; rows[1][2] = 'OTHER-APP';
  await assert.rejects(bindDocumentsToApplication('mock-token', documents, 'APP-1'), /already linked to another application/);
  assert.equal(writes.length, 0);
});

test('delivery callbacks normalize headers but refuse ambiguous provider IDs', async t => {
  const rows = [['\uFEFFProvider Message ID ', ' Send Status ', 'Delivered At'], ['provider-1', 'SENT', ''], ['provider-1', 'SENT', '']];
  const { writes } = mockSheet(t, rows, { sheet: 'Message_Outbox' });
  await assert.rejects(updateOutboxStatus('mock-token', 'provider-1', 'DELIVERED'), /Ambiguous provider message ID/);
  assert.equal(writes.length, 0);
  rows.pop();
  await updateOutboxStatus('mock-token', 'provider-1', 'DELIVERED', '', '1788753600');
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].body.data, [
    { range: 'Message_Outbox!B2', values: [['DELIVERED']] },
    { range: 'Message_Outbox!C2', values: [[new Date(1788753600000).toISOString()]] }
  ]);
});
