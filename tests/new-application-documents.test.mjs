import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ui=fs.readFileSync(new URL('../business-architecture.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../business-architecture.css',import.meta.url),'utf8');
const api=fs.readFileSync(new URL('../api/crm.js',import.meta.url),'utf8');

test('New Application accepts the standard customer documents directly',()=>{
  assert.match(ui,/name="icFrontDocument" type="file"/);
  assert.match(ui,/name="icBackDocument" type="file"/);
  assert.match(ui,/name="incomeProofDocument" type="file"/);
  assert.match(ui,/name="additionalDocuments" type="file" multiple/);
  assert.match(ui,/Maximum 3 MB per file/);
  assert.match(css,/\.new-application-documents/);
});

test('Application is created before files are attached and upload retry cannot duplicate it',()=>{
  const workflow=ui.slice(ui.indexOf('const architectureNewApplicationWithProductRules'));
  assert.ok(workflow.indexOf("post('createApplication'")<workflow.indexOf("post('uploadDocument'"));
  assert.match(workflow,/if\(!createdApplication\)/);
  assert.match(workflow,/uploadedIndexes\.has\(index\)/);
  assert.match(workflow,/without creating a duplicate application/);
});

test('Every upload refreshes the application document checklist',()=>{
  const uploadAction=api.slice(api.indexOf("if (action === 'uploadDocument')"),api.indexOf("if (action === 'updateApplication')"));
  assert.match(uploadAction,/Document_Log!A1:AD1500/);
  assert.match(uploadAction,/documentSummary\(applicationDocuments\)/);
  assert.match(uploadAction,/'Minimum Documents Complete'/);
  assert.match(uploadAction,/'Missing Documents': liveDocumentStatus\.classificationPending \? '' : liveDocumentStatus\.receivedMissing\.join/);
  assert.match(uploadAction,/'Verification Pending Documents'/);
  assert.match(uploadAction,/DOCUMENT_VERIFICATION/);
});
