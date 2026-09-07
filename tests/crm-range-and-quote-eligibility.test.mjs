import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applicationQuoteEligible, completeCrmOperationalRange, rowsToObjects } from '../api/crm.js';

const source = fs.readFileSync(new URL('../api/crm.js', import.meta.url), 'utf8');

const approvedQuote = overrides => ({
  Active: 'TRUE',
  'Quote Approval Status': 'APPROVED',
  'Approval Status': 'APPROVED',
  'Effective From': '2026-01-01',
  'Effective To': '2026-12-31',
  ...overrides
});

test('identity and pricing reads are not truncated by old row or column limits', () => {
  assert.equal(completeCrmOperationalRange('Leads!A1:AP1000'), "'Leads'");
  assert.equal(completeCrmOperationalRange('Applications!A1:CZ1000'), "'Applications'");
  assert.equal(completeCrmOperationalRange('Applications!A1:BX2000'), "'Applications'");
  assert.equal(completeCrmOperationalRange('Motor_Loan_Pricing!A1:Z1000'), "'Motor_Loan_Pricing'");
  assert.equal(completeCrmOperationalRange('Handphone_Loan_Pricing!A1:AO1000'), "'Handphone_Loan_Pricing'");
  assert.equal(completeCrmOperationalRange('Customer_Inbox!A1:AC1000'), "'Customer_Inbox'");
  assert.equal(completeCrmOperationalRange('Message_Outbox!A1:AJ1200'), "'Message_Outbox'");
  assert.equal(completeCrmOperationalRange('Document_Log!A1:AD1500'), "'Document_Log'");
  assert.equal(completeCrmOperationalRange('Conversation_State!A1:AP2000'), "'Conversation_State'");
  assert.equal(completeCrmOperationalRange('Activity_Log!A:Z'), "'Activity_Log'");
  assert.equal(completeCrmOperationalRange('CRM_User_Access!A1:S1000'), 'CRM_User_Access!A1:S1000');
  assert.equal(completeCrmOperationalRange('System_Config!A1:Z100'), 'System_Config!A1:Z100');
  assert.match(source, /params\.append\('ranges', completeCrmOperationalRange\(range\)\)/);
});

test('complete operational rows preserve canonical inbox time and lead follow-up fields beyond old column caps', () => {
  const inboxHeaders = Array.from({ length: 30 }, (_, index) => `Inbox ${index + 1}`);
  inboxHeaders[0] = 'eceived At';
  inboxHeaders[29] = 'Received At';
  const inboxRow = Array(30).fill('');
  inboxRow[29] = '2026-09-07T09:30:00.000Z';
  assert.equal(rowsToObjects([inboxHeaders, inboxRow])[0]['Received At'], '2026-09-07T09:30:00.000Z');

  const leadHeaders = Array.from({ length: 43 }, (_, index) => `Lead ${index + 1}`);
  leadHeaders[0] = 'Lead ID';
  leadHeaders[42] = 'Next Follow Up At';
  const leadRow = Array(43).fill('');
  leadRow[0] = 'LEAD-SYNTHETIC';
  leadRow[42] = '2026-09-08T10:00:00.000Z';
  assert.equal(rowsToObjects([leadHeaders, leadRow])[0]['Next Follow Up At'], '2026-09-08T10:00:00.000Z');
});

test('application quotes require active, fully approved pricing within its effective dates', () => {
  const today = '2026-09-07';
  assert.equal(applicationQuoteEligible(approvedQuote({}), today), true);
  assert.equal(applicationQuoteEligible(approvedQuote({ 'Approval Status': 'REJECTED' }), today), false);
  assert.equal(applicationQuoteEligible(approvedQuote({ 'Quote Approval Status': 'PENDING' }), today), false);
  assert.equal(applicationQuoteEligible(approvedQuote({ Active: 'FALSE' }), today), false);
  assert.equal(applicationQuoteEligible(approvedQuote({ 'Effective From': '2026-09-08' }), today), false);
  assert.equal(applicationQuoteEligible(approvedQuote({ 'Effective To': '2026-09-06' }), today), false);
  assert.equal(applicationQuoteEligible(approvedQuote({ 'Effective From': 'invalid' }), today), false);
});

test('application quote date boundaries are inclusive and legacy published approvals remain compatible', () => {
  const today = '2026-09-07';
  assert.equal(applicationQuoteEligible(approvedQuote({ 'Effective From': today, 'Effective To': today }), today), true);
  assert.equal(applicationQuoteEligible(approvedQuote({ 'Approval Status': '', 'Submitted By': '' }), today), true);
  assert.equal(applicationQuoteEligible(approvedQuote({ 'Approval Status': '', 'Submitted By': 'regional.manager' }), today), false);
});

test('both motor and handphone application quote sources use the eligibility gate', () => {
  const start = source.indexOf("if (resource === 'applications')");
  const end = source.indexOf("if (resource === 'documents')", start);
  const block = source.slice(start, end);
  assert.equal((block.match(/filter\(row => applicationQuoteEligible\(row\)\)/g) || []).length, 2);
});
