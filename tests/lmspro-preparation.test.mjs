import assert from 'node:assert/strict';
import { lmsproConfigurationStatus, prepareLmsSubmission } from '../api/_lmspro.js';

const application = {
  'Application ID': 'APP-SYNTHETIC-001',
  'Applicant Name': 'Synthetic Applicant',
  'Applicant IC Number': '900101-00-0000',
  'Phone Number': '60100000000',
  'Product Brand': 'TEST BRAND',
  'Product Model': 'TEST MODEL',
  'Loan Tenure Years': '5'
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

const complete = prepareLmsSubmission(application, [
  document('DOC-1', 'IC_FRONT'),
  document('DOC-2', 'IC_BACK'),
  document('DOC-3', 'PAYSLIP')
]);
assert.equal(complete.ready, true);
assert.deepEqual(complete.missingFields, []);
assert.deepEqual(complete.missingDocuments, []);
assert.equal(complete.idempotencyKey, 'JOMKAKI:APP-SYNTHETIC-001');
assert.equal(complete.payload.documents.INCOME_PROOF.document_type, 'PAYSLIP');

const incomplete = prepareLmsSubmission({ ...application, 'Applicant IC Number': '' }, [document('DOC-1', 'IC_FRONT')]);
assert.equal(incomplete.ready, false);
assert.deepEqual(incomplete.missingFields, ['Applicant IC Number']);
assert.deepEqual(incomplete.missingDocuments, ['IC_BACK', 'INCOME_PROOF']);

assert.deepEqual(lmsproConfigurationStatus({}), {
  enabled: false,
  sandboxOnly: true,
  contractConfigured: false,
  readyForSandbox: false,
  productionEnabled: false
});

assert.equal(lmsproConfigurationStatus({
  LMSPRO_ENABLED: 'true',
  LMSPRO_SANDBOX_BASE_URL: 'https://sandbox.example.invalid',
  LMSPRO_SUBMIT_PATH: '/applications',
  LMSPRO_AUTH_MODE: 'bearer',
  LMSPRO_API_TOKEN: 'synthetic-test-token'
}).readyForSandbox, true);

console.log('lmspro preparation tests passed');
