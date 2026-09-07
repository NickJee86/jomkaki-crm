import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

process.env.WHATSAPP_SEND_MODE = 'MANUAL';
let source = await fs.readFile(new URL('../api/crm.js', import.meta.url), 'utf8');
source = source.replace("import { authenticate, clearSession, getSession, hashPassword, migrateEnvironmentAccounts, setSession, validateSession } from './_auth.js';", `
const authenticate = async () => false;
const clearSession = () => {};
const getSession = () => globalThis.__crmTestSession;
const hashPassword = value => value;
const migrateEnvironmentAccounts = async () => 0;
const setSession = () => {};
const validateSession = async (_req, session) => session;
`);
source = source.replace("import { FUTURE_REPORTING_FIELDS, integrationReadiness, publicIntegrationRecords } from './_integrations.js';", `
const FUTURE_REPORTING_FIELDS = { meta: [], lms: [] };
const integrationReadiness = () => ({ meta: {}, lms: {}, safety: {} });
const publicIntegrationRecords = () => [];
`);
source = source.replace("import { prepareLmsSubmission } from './_lmspro.js';", `
const prepareLmsSubmission = () => ({ ready: false });
`);
source = source.replace("import { validatePublicImageLink } from './_media-validation.js';", `
const validatePublicImageLink = async () => ({ ok: true });
`);
const { default: handler, scopeData, deriveDocumentReadiness, rowsToObjects, scopedRecordPermitted, scopedCustomerTarget, customerPhoneForTarget, recordMatchesCustomerTarget, sheetSafeValue, validateUploadFile } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

function response() {
  return { code: 200, payload: null, headers: {}, setHeader(name, value) { this.headers[name] = value; }, status(code) { this.code = code; return this; }, json(payload) { this.payload = payload; return this; } };
}

globalThis.__crmTestSession = { username: 'staff.one', name: 'Staff One', role: 'STAFF', region: 'EAST_MALAYSIA', saId: 'SA-1', branchId: 'BR-1' };
const denied = response();
await handler({ method: 'POST', headers: {}, body: { action: 'reviewDocument', documentId: 'DOC-1', verification: 'VERIFIED', quality: 'GOOD' } }, denied);
assert.equal(denied.code, 403);
assert.match(denied.payload.error, /Manager access is required/);

const sessionResult = response();
await handler({ method: 'GET', headers: {}, query: { resource: 'session' } }, sessionResult);
assert.equal(sessionResult.code, 200);
assert.equal(sessionResult.payload.user.whatsappMode, 'MANUAL');
assert.equal(sessionResult.payload.user.saId, 'SA-1');

globalThis.__crmTestSession = { ...globalThis.__crmTestSession, mustChangePassword: true };
const passwordGate = response();
await handler({ method: 'GET', headers: {}, query: { resource: 'integrations' } }, passwordGate);
assert.equal(passwordGate.code, 403);
assert.equal(passwordGate.payload.code, 'PASSWORD_CHANGE_REQUIRED');
const passwordWriteGate = response();
await handler({ method: 'POST', headers: {}, body: { action: 'saveFollowUpSettings' } }, passwordWriteGate);
assert.equal(passwordWriteGate.code, 403);
assert.equal(passwordWriteGate.payload.code, 'PASSWORD_CHANGE_REQUIRED');
globalThis.__crmTestSession = { ...globalThis.__crmTestSession, mustChangePassword: false };

const branches = [
  { 'Branch ID': 'BR-E1', Region: 'EAST_MALAYSIA' },
  { 'Branch ID': 'BR-E2', Region: 'EAST_MALAYSIA' },
  { 'Branch ID': 'BR-W1', Region: 'WEST_MALAYSIA' }
];
const leads = [
  { 'Lead ID': 'LEAD-E1-S1', Region: 'EAST_MALAYSIA', 'Selected Branch ID': 'BR-E1', 'Assigned SA ID': 'SA-1' },
  { 'Lead ID': 'LEAD-E1-S2', Region: 'EAST_MALAYSIA', 'Selected Branch ID': 'BR-E1', 'Assigned SA ID': 'SA-2' },
  { 'Lead ID': 'LEAD-E2', Region: 'EAST_MALAYSIA', 'Selected Branch ID': 'BR-E2', 'Assigned SA ID': '' },
  { 'Lead ID': 'LEAD-W1', Region: 'WEST_MALAYSIA', 'Selected Branch ID': 'BR-W1', 'Assigned SA ID': 'SA-9' }
];
const applications = leads.map((lead, index) => ({
  'Application ID': `APP-${index + 1}`,
  'Lead ID': lead['Lead ID'],
  'Assigned Branch ID': lead['Selected Branch ID'],
  'Assigned SA ID': lead['Assigned SA ID']
}));

assert.equal(scopeData({ role: 'ADMIN' }, leads, applications, branches).leads.length, 4, 'Admin sees all company leads');
assert.deepEqual(scopeData({ role: 'REGION_MANAGER', region: 'EAST_MALAYSIA' }, leads, applications, branches).leads.map(row => row['Lead ID']), ['LEAD-E1-S1', 'LEAD-E1-S2', 'LEAD-E2'], 'Regional Manager sees all leads in own region');
assert.deepEqual(scopeData({ role: 'BRANCH_MANAGER', region: 'EAST_MALAYSIA', branchId: 'BR-E1' }, leads, applications, branches).leads.map(row => row['Lead ID']), ['LEAD-E1-S1', 'LEAD-E1-S2'], 'Branch Manager sees only leads assigned to own branch');
assert.deepEqual(scopeData({ role: 'STAFF', region: 'EAST_MALAYSIA', branchId: 'BR-E1', saId: 'SA-1' }, leads, applications, branches).leads.map(row => row['Lead ID']), ['LEAD-E1-S1'], 'Staff sees only leads assigned to own SA ID');

assert.deepEqual(rowsToObjects([
  ['\uFEFFApplication ID ', 'Applicant Name', 'Application ID'],
  ['APP-REAL', 'Customer One', '']
]), [{ 'Application ID': 'APP-REAL', 'Applicant Name': 'Customer One' }], 'Duplicate or padded headers cannot erase a populated application identifier');

const adminScope = scopeData({ role: 'ADMIN' }, [
  { 'Lead ID': 'LEAD-1', 'Phone Number': '0123456789' },
  { 'Lead ID': 'LEAD-2', 'Phone Number': '60111111111' }
], [
  { 'Application ID': 'APP-1', 'Lead ID': 'LEAD-1', 'Phone Number': '60123456789' },
  { 'Application ID': 'APP-2', 'Lead ID': 'LEAD-2', 'Phone Number': '60111111111' }
], []);
const target = scopedCustomerTarget(adminScope, adminScope.leads, adminScope.applications, { leadId: 'LEAD-1', applicationId: 'APP-1' });
assert.equal(target.applicationId, 'APP-1');
assert.equal(scopedCustomerTarget(adminScope, adminScope.leads, adminScope.applications, { leadId: 'LEAD-1', applicationId: 'APP-2' }), null, 'Mixed customer identifiers are rejected');
assert.equal(scopedRecordPermitted(adminScope, { 'Lead ID': 'LEAD-1', 'Application ID': 'APP-2' }), false, 'A row with mismatched customer links is not visible');
assert.equal(customerPhoneForTarget(target, '012-345 6789'), '60123456789');
assert.throws(() => customerPhoneForTarget(target, '60199999999'), /does not match/);
assert.equal(recordMatchesCustomerTarget({ 'Lead ID': 'LEAD-1', 'Application ID': 'APP-1', 'Phone Number': '60123456789' }, target), true);
assert.equal(recordMatchesCustomerTarget({ 'Lead ID': 'LEAD-2', 'Application ID': 'APP-2', 'Phone Number': '60111111111' }, target), false);

assert.equal(sheetSafeValue('  =IMPORTDATA("https://example.invalid")'), "'  =IMPORTDATA(\"https://example.invalid\")");
assert.equal(sheetSafeValue('Normal customer text'), 'Normal customer text');
const jpeg = { name: 'photo.jpg', type: 'image/jpeg', data: `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0]).toString('base64')}` };
assert.equal(validateUploadFile(jpeg, { imageOnly: true }).mimeType, 'image/jpeg');
assert.throws(() => validateUploadFile({ ...jpeg, data: `data:image/jpeg;base64,${Buffer.from('not a jpeg').toString('base64')}` }, { imageOnly: true }), /content is not a valid/);

const completeDocuments = [
  { 'Document Type': 'IC_FRONT', 'Verification Status': 'AI_VERIFIED', 'Quality Status': 'GOOD', 'Manual Review Required': 'FALSE' },
  { 'Document Type': 'IC_BACK', 'Verification Status': 'VERIFIED', 'Quality Status': 'PASS', 'Manual Review Required': 'FALSE' },
  { 'Document Type': 'PAYSLIP', 'Verification Status': 'APPROVED', 'Quality Status': 'ACCEPTED', 'Manual Review Required': 'FALSE' }
];
assert.deepEqual(deriveDocumentReadiness(completeDocuments), { complete: true, missing: [], exception: false }, 'AI-verified required documents are ready for LMS');
assert.deepEqual(deriveDocumentReadiness([
  { 'Document Type': 'IDENTITY_DOCUMENT', 'Verification Status': 'AI_VERIFIED', 'Quality Status': 'GOOD', 'Manual Review Required': 'FALSE' },
  { 'Document Type': 'EPF_STATEMENT', 'Verification Status': 'AI_VERIFIED', 'Quality Status': 'GOOD', 'Manual Review Required': 'FALSE' }
]), { complete: true, missing: [], exception: false }, 'One verified combined identity file satisfies both MyKad sides');
assert.deepEqual(deriveDocumentReadiness(completeDocuments.slice(0, 2)), { complete: false, missing: ['INCOME_PROOF'], exception: false }, 'Missing required document remains in AI collection');
assert.equal(deriveDocumentReadiness([...completeDocuments, { 'Document Type': 'OTHER', 'Verification Status': 'REJECTED', 'Quality Status': 'POOR', 'Manual Review Required': 'TRUE' }]).exception, true, 'Failed AI document check becomes an exception');

console.log('role-permission tests passed');
