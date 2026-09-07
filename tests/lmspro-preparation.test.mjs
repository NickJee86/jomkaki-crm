import assert from 'node:assert/strict';
import { lmsproConfigurationStatus, prepareLmsSubmission } from '../api/_lmspro.js';

const application = {
  'Application ID': 'APP-SYNTHETIC-001',
  'Applicant Name': 'Synthetic Applicant',
  'Applicant IC Number': '900101-00-0000',
  'Phone Number': '60100000000',
  'Product Brand': 'TEST BRAND',
  'Product Model': 'TEST MODEL',
  'Loan Tenure Years': '5',
  'Credit Consent Status': 'VERIFIED'
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
for (const consent of ['', 'SENT', 'SIGNED_PENDING_VERIFICATION', 'REJECTED']) {
  const result = prepareLmsSubmission({ ...application, 'Credit Consent Status': consent }, [
    document('DOC-1', 'IC_FRONT'), document('DOC-2', 'IC_BACK'), document('DOC-3', 'PAYSLIP')
  ]);
  assert.equal(result.ready, false, `Consent ${consent || 'missing'} must block submission`);
  assert.ok(result.missingFields.includes('Verified Credit Consent'));
}
const combinedIdentity = prepareLmsSubmission(application, [document('DOC-1', 'IDENTITY_DOCUMENT'), document('DOC-2', 'EPF_STATEMENT')]);
assert.equal(combinedIdentity.ready, true, 'A verified combined identity file satisfies both IC sides');
const anotherCase = prepareLmsSubmission(application, [
  { ...document('DOC-1', 'IDENTITY_DOCUMENT'), 'Application ID': 'OTHER-APPLICATION' },
  document('DOC-2', 'EPF_STATEMENT')
]);
assert.deepEqual(anotherCase.missingDocuments, ['IC_FRONT', 'IC_BACK']);

const incomplete = prepareLmsSubmission({ ...application, 'Applicant IC Number': '' }, [document('DOC-1', 'IC_FRONT')]);
assert.equal(incomplete.ready, false);
assert.deepEqual(incomplete.missingFields, ['Applicant IC Number']);
assert.deepEqual(incomplete.missingDocuments, ['IC_BACK', 'INCOME_PROOF']);

assert.deepEqual(lmsproConfigurationStatus({}), {
  enabled: false,
  sandboxOnly: true,
  contractConfigured: false,
  configurationReady: false,
  productionRequested: false,
  adapterAvailable: false,
  readyForSandbox: false,
  productionEnabled: false
});

const configuredWithoutAdapter = lmsproConfigurationStatus({
  LMSPRO_ENABLED: 'true',
  LMSPRO_SANDBOX_BASE_URL: 'https://sandbox.example.invalid',
  LMSPRO_SUBMIT_PATH: '/applications',
  LMSPRO_AUTH_MODE: 'bearer',
  LMSPRO_API_TOKEN: 'synthetic-test-token'
});
assert.equal(configuredWithoutAdapter.configurationReady, true);
assert.equal(configuredWithoutAdapter.adapterAvailable, false);
assert.equal(configuredWithoutAdapter.readyForSandbox, false);

console.log('lmspro preparation tests passed');
