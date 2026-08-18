import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const blueprint = name => JSON.parse(fs.readFileSync(new URL(`../make-blueprints/consent-automation/${name}`, import.meta.url), 'utf8'));
const modules = flow => flow.flatMap(module => [module, ...(module.routes || []).flatMap(route => modules(route.flow || []))]);

test('S04 starts application information collection immediately after signed consent is verified', () => {
  const scenario = blueprint('S04 - Document and Signed Consent AI Validation.blueprint.json');
  const all = modules(scenario.flow);
  const vision = all.find(module => module.id === 6);
  const applicationStatus = all.find(module => module.id === 24);
  const applicationStage = all.find(module => module.id === 30);
  const conversationStep = all.find(module => module.id === 31);
  const reply = all.find(module => module.id === 32);
  assert.match(vision.mapper.prompt, /CTOS_CCRIS_CONSENT_SIGNED/);
  assert.match(vision.mapper.prompt, /signature or mark is visible/);
  assert.match(applicationStatus.mapper.value, /VERIFIED/);
  assert.equal(applicationStage.mapper.cell, 'F{{13.`__ROW_NUMBER__`}}');
  assert.match(applicationStage.mapper.value, /APPLICATION_DETAILS_PENDING/);
  assert.equal(conversationStep.mapper.sheetId, 'Conversation_State');
  assert.equal(conversationStep.mapper.cell, 'E{{12.`__ROW_NUMBER__`}}');
  assert.match(conversationStep.mapper.value, /APPLICATION_DETAILS_PENDING/);
  assert.match(reply.mapper.values['Message Text'], /nombor IC penuh anda/);
  assert.match(reply.mapper.values['Message Text'], /Dokumen yang masih kurang boleh dihantar kemudian/);
  assert.doesNotMatch(reply.mapper.values['Message Text'], /persediaan LMS/);
});

test('S05 keeps routine documents parallel with consent and never gates consent on document completeness', () => {
  const scenario = blueprint('S05 - Routine Documents (Consent Excluded).blueprint.json');
  const all = modules(scenario.flow);
  const validDocs = all.find(module => module.id === 5);
  const incompleteStage = all.find(module => module.id === 111);
  const completeStage = all.find(module => module.id === 123);
  const completeState = all.find(module => module.id === 125);
  assert.match(JSON.stringify(validDocs.filter), /CTOS_CCRIS_CONSENT/);
  assert.match(JSON.stringify(validDocs.filter), /text:notequal/);
  assert.match(incompleteStage.mapper.value, /VERIFIED/);
  assert.match(incompleteStage.mapper.value, /CONSENT_AND_DOCUMENTS_IN_PROGRESS/);
  assert.match(completeStage.mapper.value, /VERIFIED/);
  assert.match(completeState.mapper.value, /CONSENT_PENDING_SIGNATURE/);
  assert.equal(all.some(module => module.id === 114), false);
  assert.equal(all.some(module => module.id === 126), false);
});

test('S06 collects information only after signed consent and cannot queue a second consent form', () => {
  const scenario = blueprint('S06 - Application Details and Automated Consent.blueprint.json');
  const all = modules(scenario.flow);
  const applicationStage = all.find(module => module.id === 8);
  const conversationStep = all.find(module => module.id === 9);
  const detailGate = all.find(module => module.id === 5);
  const outbox = all.find(module => module.id === 16);
  assert.equal(scenario.name, 'S06 - Application Details Collection After Signed Consent');
  assert.match(applicationStage.mapper.value, /APPLICATION_DETAILS_COMPLETE/);
  assert.match(conversationStep.mapper.value, /APPLICATION_DETAILS_COMPLETE/);
  assert.equal(detailGate.filter.name, 'Only Signed-Consent Application Detail Steps');
  assert.match(JSON.stringify(detailGate.filter), /APPLICATION_DETAILS_PENDING/);
  assert.doesNotMatch(JSON.stringify(detailGate.filter), /STEP_04_DOCUMENTS/);
  assert.doesNotMatch(outbox.mapper.values['Message Text'], /ctos-ccris-consent-bph-v4\.pdf/);
  assert.match(outbox.mapper.values['Message Text'], /Maklumat permohonan anda sudah lengkap/);
  assert.match(outbox.mapper.values['Message Text'], /dokumen lengkap dan borang kebenaran CTOS\/CCRIS disahkan/);
  assert.match(outbox.mapper.values['Template Name'], /JKM_S06_INFORMATION_COMPLETE/);
  assert.equal(outbox.mapper.values['Internal Channel ID'], '{{2.`25`}}');
  for (const removedId of [20, 21, 22, 23]) assert.equal(all.some(module => module.id === removedId), false);
});

test('S07 blocks LMS until both documents and verified consent are present', () => {
  const scenario = blueprint('S07 - LMS Readiness with Consent Gate.blueprint.json');
  const all = modules(scenario.flow);
  const search = all.find(module => module.id === 1);
  const ready = all.find(module => module.id === 7);
  assert.match(JSON.stringify(search.mapper.filter), /CONSENT_VERIFIED/);
  const conditions = ready.filter.conditions;
  assert.equal(conditions.length, 2);
  for (const group of conditions) assert.ok(group.some(condition => condition.a === '{{1.`71`}}' && condition.b === 'VERIFIED'));
  assert.equal(ready.mapper.value, 'READY_FOR_LMS');
});
