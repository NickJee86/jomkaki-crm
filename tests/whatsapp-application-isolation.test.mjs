import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  bindDocumentsToApplication, buildDocumentProgressReply, conversationRequiresHuman,
  resolveApplicationLead, selectApplicationDocuments, selectReusableApplication
} from '../api/whatsapp-webhook.js';

const source = fs.readFileSync(new URL('../api/whatsapp-webhook.js', import.meta.url), 'utf8');
const clean = value => String(value ?? '').trim();
const digits = value => clean(value).replace(/\D/g, '').replace(/^0/, '60');
const routedLead = { 'Lead ID': 'LEAD-DUPLICATE', 'Customer ID': 'CUSTOMER-SYNTHETIC', 'Phone Number': '0123456789', 'Business Unit': 'MOTOR' };
const canonicalLead = { ...routedLead, 'Lead ID': 'LEAD-CANONICAL', 'Last Inbound At': '2026-09-07T01:00:00.000Z' };
const application = { 'Application ID': 'APP-SYNTHETIC', 'Lead ID': canonicalLead['Lead ID'], 'Customer ID': canonicalLead['Customer ID'], 'Phone Number': canonicalLead['Phone Number'], 'Business Unit': 'MOTOR', 'Application Status': 'DRAFT' };
const document = (id, type, applicationId, leadId = canonicalLead['Lead ID']) => ({ 'Document ID': id, 'Document Type': type, 'Application ID': applicationId, 'Lead ID': leadId, 'Verification Status': 'VERIFIED', rowNumber: 2 });

test('same-customer reuse preserves the application and resolves its canonical lead', () => {
  const selected = selectReusableApplication([application], routedLead, 'MOTOR');
  assert.equal(selected, application);
  assert.equal(resolveApplicationLead(selected, routedLead, [routedLead, canonicalLead]), canonicalLead);
  assert.equal(resolveApplicationLead(application, canonicalLead, [canonicalLead]), canonicalLead);
  const legacyLead = { 'Lead ID': canonicalLead['Lead ID'] };
  assert.equal(resolveApplicationLead({ 'Application ID': application['Application ID'], 'Lead ID': legacyLead['Lead ID'] }, legacyLead), legacyLead);
});

test('phone-only historical identity can reuse an application without inventing customer IDs', () => {
  const phoneLead = { ...routedLead, 'Customer ID': '' };
  const phoneApplication = { ...application, 'Customer ID': '', 'Phone Number': '60123456789' };
  const canonical = { ...canonicalLead, 'Customer ID': '' };
  assert.equal(resolveApplicationLead(selectReusableApplication([phoneApplication], phoneLead, 'MOTOR'), phoneLead, [canonical]), canonical);
  assert.equal(phoneLead['Customer ID'], '');
});

test('cross-lead reuse fails closed on conflicting, absent or ambiguous canonical customer identity', () => {
  assert.equal(resolveApplicationLead({}, undefined), undefined);
  assert.equal(resolveApplicationLead({}, null), null);
  assert.throws(() => resolveApplicationLead(application, undefined, [canonicalLead]), /Inbound lead identity is missing/);
  assert.throws(() => resolveApplicationLead(application, {}, [canonicalLead]), /Inbound lead identity is missing/);
  assert.throws(() => resolveApplicationLead(application, { ...canonicalLead, 'Customer ID': 'DIFFERENT-CUSTOMER' }, [canonicalLead]), /conflicts with its lead/);
  assert.throws(() => resolveApplicationLead({ ...application, 'Customer ID': 'DIFFERENT-CUSTOMER' }, routedLead, [canonicalLead]), /cannot be confirmed/);
  assert.throws(() => resolveApplicationLead(application, routedLead, [{ ...canonicalLead, 'Customer ID': 'DIFFERENT-CUSTOMER' }]), /cannot be confirmed/);
  assert.throws(() => resolveApplicationLead(application, { ...routedLead, 'Customer ID': '' }, [{ ...canonicalLead, 'Customer ID': 'DIFFERENT-CUSTOMER' }]), /cannot be confirmed/);
  assert.throws(() => resolveApplicationLead(application, routedLead, []), /cannot be confirmed/);
  assert.throws(() => resolveApplicationLead(application, routedLead, [canonicalLead, { ...canonicalLead }]), /cannot be confirmed/);
  assert.throws(() => resolveApplicationLead({ ...application, 'Lead ID': '' }, routedLead, [canonicalLead]), /lead identity is missing/);
});

test('the actual inbound lookup resolves canonical ownership before reading conversation state', async () => {
  const start = source.indexOf('let lead = leads.find(row => digits(row[\'Phone Number\']) === phone');
  const end = source.indexOf('// The sent-message log', start);
  assert.ok(start >= 0 && end > start);
  const lookup = new Function('selectReusableApplication', 'resolveApplicationLead', 'clean', 'digits', `return async ({ leads, phone, routeBusinessUnit, loadApplications, conversationStates }) => { ${source.slice(start, end)} return { lead, conversationState, previousInboundAt }; };`)(selectReusableApplication, resolveApplicationLead, clean, digits);
  const state = { 'State ID': 'STATE-CANONICAL', 'Lead ID': canonicalLead['Lead ID'], 'Current Step': 'STEP_04_DOCUMENTS' };
  let reads = 0;
  const result = await lookup({ leads: [routedLead, canonicalLead], phone: '60123456789', routeBusinessUnit: 'MOTOR', loadApplications: async () => { reads += 1; return [application]; }, conversationStates: [state] });
  assert.equal(result.lead, canonicalLead);
  assert.equal(result.conversationState, state);
  assert.equal(result.previousInboundAt, canonicalLead['Last Inbound At']);
  assert.equal(reads, 1);
  const routedState = { ...state, 'State ID': 'STATE-DUPLICATE', 'Lead ID': routedLead['Lead ID'] };
  const preserved = await lookup({ leads: [routedLead, canonicalLead], phone: '60123456789', routeBusinessUnit: 'MOTOR', loadApplications: async () => [application], conversationStates: [routedState] });
  assert.equal(preserved.conversationState, routedState);
  assert.match(source, /const latestInbound = \{\s*'Lead ID': clean\(lead\['Lead ID'\]\)/);
  const newcomer = await lookup({ leads: [routedLead, canonicalLead], phone: '60199990000', routeBusinessUnit: 'MOTOR', loadApplications: async () => { throw new Error('New customers must not need an application lookup'); }, conversationStates: [] });
  assert.equal(newcomer.lead, undefined);
  assert.equal(newcomer.conversationState, null);
  const createStart = source.indexOf('if (!lead) {', source.indexOf('const leadTurnChanges ='));
  const createEnd = source.indexOf('const shouldEnsureApplication', createStart);
  assert.ok(createStart >= 0 && createEnd > createStart);
  const createBranch = new Function('bindings', `return async () => { let lead = bindings.lead; const { leads, digits, phone, clean, makeId, instantDecision, progressiveProfile, usableCustomerName, profileName, routeRegion, routeBusinessUnit, teamId, branchId, ensureHeaders, appendObject, updateObject, token, channelId, numberId, receivedAt, leadTurnChanges } = bindings; ${source.slice(createStart, createEnd)} return lead; };`);
  const appends = [];
  const created = await createBranch({ lead: newcomer.lead, leads: [], digits, phone: '60199990000', clean, makeId: prefix => `${prefix}-SYNTHETIC-NEW`, instantDecision: {}, progressiveProfile: {}, usableCustomerName: clean, profileName: '', routeRegion: 'WEST_MALAYSIA', routeBusinessUnit: 'MOTOR', teamId: '', branchId: '', ensureHeaders: async () => {}, appendObject: async (_token, sheet, row) => appends.push({ sheet, row }), updateObject: async () => { throw new Error('Must not update a missing lead'); }, token: 'mock-token', channelId: 'SYNTHETIC', numberId: 'SYNTHETIC-NUMBER', receivedAt: '2026-09-07T01:00:00.000Z', leadTurnChanges: {} })();
  assert.equal(created['Lead ID'], 'LEAD-SYNTHETIC-NEW');
  assert.equal(appends.length, 1);
  assert.equal(appends[0].sheet, 'Leads');
});

test('the actual attachment record uses the canonical application and lead together', () => {
  const start = source.indexOf('const currentDocumentLog = {');
  const end = source.indexOf("await appendObject(token, 'Document_Log', currentDocumentLog)", start);
  assert.ok(start >= 0 && end > start);
  const buildRecord = new Function('lead', 'application', `const makeId = () => 'DOC-SYNTHETIC', inferredDocumentType = 'IC_FRONT', message = { id: 'MSG-SYNTHETIC', timestamp: '1788742800', document: { filename: 'synthetic.png' } }, media = { id: 'MEDIA-SYNTHETIC', mime_type: 'image/png' }, attachmentUrl = 'https://example.invalid/synthetic', routeBusinessUnit = 'MOTOR'; ${source.slice(start, end)} return currentDocumentLog;`);
  const resolved = resolveApplicationLead(application, routedLead, [canonicalLead]);
  const record = buildRecord(resolved, application);
  assert.equal(record['Lead ID'], application['Lead ID']);
  assert.equal(record['Application ID'], application['Application ID']);
  assert.notEqual(record['Lead ID'], routedLead['Lead ID']);
});

test('another application cannot supply missing documents or old consent for the current application', () => {
  const documents = [
    document('CURRENT-FRONT', 'IC_FRONT', application['Application ID']),
    document('OLD-BACK', 'IC_BACK', 'APP-OLD'),
    document('OLD-INCOME', 'PAYSLIP', 'APP-OLD'),
    document('OLD-CONSENT', 'CTOS_CCRIS_CONSENT_SIGNED', 'APP-OLD')
  ];
  assert.match(buildDocumentProgressReply('EN', documents), /minimum documents are complete/);
  const scoped = selectApplicationDocuments(documents, canonicalLead, application);
  assert.deepEqual(scoped.map(row => row['Document ID']), ['CURRENT-FRONT']);
  const reply = buildDocumentProgressReply('EN', scoped);
  assert.match(reply, /MyKad back|IC belakang/i);
  assert.match(reply, /payslip|EPF/i);
  assert.doesNotMatch(reply, /minimum documents are complete|all.*verified/i);
});

test('a fresh application considers only unbound documents from its own canonical lead', () => {
  const documents = [document('UNBOUND', 'IC_FRONT', ''), document('OLD', 'IC_BACK', 'APP-OLD'), document('OTHER-LEAD', 'PAYSLIP', '', routedLead['Lead ID']), document('BLANK-LEAD', 'PAYSLIP', '', '')];
  assert.deepEqual(selectApplicationDocuments(documents, canonicalLead, {}).map(row => row['Document ID']), ['UNBOUND']);
  assert.deepEqual(selectApplicationDocuments(documents, {}, application), []);
});

test('the active same-business context is not replaced by a later handed-over application in another business', () => {
  const other = { ...application, 'Application ID': 'APP-PHONE', 'Business Unit': 'HANDPHONE', 'Processing Mode': 'AI_TO_SA_HANDOVER' };
  const completed = { ...application, 'Application ID': 'APP-CLOSED', 'Application Status': 'COMPLETED', 'Processing Mode': 'HUMAN_MANAGED' };
  const selected = selectReusableApplication([application, other, completed], canonicalLead, 'MOTOR');
  assert.equal(selected, application);
  assert.equal(conversationRequiresHuman({ application: selected }), false);
});

test('only the canonical unbound attachment is bound while another application remains untouched', async t => {
  globalThis.__JOMKAKI_SHEET_READ_CACHE__?.clear();
  const writes = [];
  const rows = [['Document ID', 'Lead ID', 'Application ID'], ['UNBOUND', canonicalLead['Lead ID'], ''], ['OLD', canonicalLead['Lead ID'], 'APP-OLD']];
  t.mock.method(globalThis, 'fetch', async (_url, options = {}) => {
    if (options.method === 'POST') { writes.push(JSON.parse(options.body)); return { ok: true, status: 200, json: async () => ({}) }; }
    return { ok: true, status: 200, json: async () => ({ values: rows }) };
  });
  const documents = [document('UNBOUND', 'IC_FRONT', ''), { ...document('OLD', 'IC_BACK', 'APP-OLD'), rowNumber: 3 }];
  const scoped = selectApplicationDocuments(documents, canonicalLead, application);
  await bindDocumentsToApplication('mock-token', scoped, application['Application ID']);
  assert.deepEqual(writes[0].data, [{ range: 'Document_Log!C2', values: [[application['Application ID']]] }]);
  assert.equal(documents[1]['Application ID'], 'APP-OLD');
});
