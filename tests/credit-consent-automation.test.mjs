import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ui=fs.readFileSync(new URL('../business-architecture.js',import.meta.url),'utf8');
const uploadUi=fs.readFileSync(new URL('../app-v2.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../business-architecture.css',import.meta.url),'utf8');
const api=fs.readFileSync(new URL('../api/crm.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const consentPdf=new URL('../assets/ctos-ccris-consent-bph-v4.pdf',import.meta.url);

test('The supplied consent form is published as a fixed CRM template',()=>{
  const file=fs.readFileSync(consentPdf);
  assert.ok(file.length>10_000);
  assert.equal(file.subarray(0,4).toString(),'%PDF');
  assert.match(ui,/ctos-ccris-consent-bph-v4\.pdf/);
  assert.match(html,/20260811-credit-consent2/);
});

test('New Application and secure upload accept signed consent separately',()=>{
  assert.match(ui,/name="creditConsentDocument" type="file"/);
  assert.match(ui,/CTOS_CCRIS_CONSENT/);
  assert.match(uploadUi,/function uploadDocument\(a,initialType=''/);
  assert.match(uploadUi,/Signed CTOS \/ CCRIS consent/);
  assert.match(css,/\.credit-consent-section/);
  assert.match(css,/\.consent-step-grid/);
});

test('Consent has a full send, upload, manager verification and readiness workflow',()=>{
  assert.match(ui,/post\('sendCreditConsent'/);
  assert.match(ui,/post\('verifyCreditConsent'/);
  assert.match(ui,/post\('prepareCreditCheck'/);
  assert.match(ui,/Manager verified/);
  assert.match(ui,/Sample only · actions disabled/);
  assert.match(api,/if \(action === 'sendCreditConsent'\)/);
  assert.match(api,/if \(action === 'setCreditConsentOutcome'\)/);
  assert.match(api,/if \(action === 'verifyCreditConsent'\)/);
  assert.match(api,/if \(action === 'prepareCreditCheck'\)/);
  assert.match(api,/SIGNED_PENDING_VERIFICATION/);
});

test('Credit checking is blocked until consent and documents are ready',()=>{
  const gate=api.slice(api.indexOf("if (action === 'prepareCreditCheck')"),api.indexOf("if (action === 'uploadDocument')"));
  assert.match(gate,/managerRoles\.has\(session\.role\)/);
  assert.match(gate,/Credit Consent Status'\]\)\.toUpperCase\(\) !== 'VERIFIED'/);
  assert.match(gate,/Minimum Documents Complete/);
  assert.match(gate,/externalQueryExecuted: false/);
  assert.match(gate,/READY_FOR_API_CONNECTION/);
});

test('Consent does not incorrectly count as a routine application document',()=>{
  const readiness=api.slice(api.indexOf('function deriveDocumentReadiness'),api.indexOf('export default async function handler'));
  assert.match(readiness,/routineDocuments/);
  assert.match(readiness,/CREDIT_CONSENT_DOCUMENT_TYPE/);
  assert.match(api,/Applications!A1:BX1000/);
  assert.doesNotMatch(api,/Applications!A1:BN1000/);
});
