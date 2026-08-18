import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const blueprint = name => JSON.parse(fs.readFileSync(new URL(`../make-blueprints/consent-automation/${name}`, import.meta.url), 'utf8'));
const modules = flow => flow.flatMap(module => [module, ...(module.routes || []).flatMap(route => modules(route.flow || []))]);

test('S04 sends the complete WhatsApp information form after signed consent is verified', () => {
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
  assert.match(conversationStep.mapper.value, /APPLICATION_FORM_PENDING/);
  assert.match(reply.mapper.values['Message Text'], /TOLONG ISI MAKLUMAT DI BAWAH/);
  assert.match(reply.mapper.values['Message Text'], /Berapa lama sudah berkhidmat/);
  assert.match(reply.mapper.values['Message Text'], /Nama & Tel rujukan 2/);
  assert.match(reply.mapper.values['Message Text'], /Loan Berapa tahun/);
  assert.match(reply.mapper.values['Message Text'], /hantar semula dalam satu mesej/);
  assert.doesNotMatch(reply.mapper.values['Message Text'], /sila berikan nombor IC penuh anda/i);
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

test('S06 legacy one-question collection is retired so only the webhook form can reply', () => {
  const scenario = blueprint('S06 - Application Details and Automated Consent.blueprint.json');
  const all = modules(scenario.flow);
  const inboxGate = all.find(module => module.id === 3);
  assert.match(scenario.name, /Retired One-by-One Details/);
  assert.match(inboxGate.filter.name, /Vercel webhook owns the single WhatsApp form/);
  assert.match(JSON.stringify(inboxGate.filter), /DISABLED_SINGLE_WHATSAPP_FORM/);
  assert.doesNotMatch(JSON.stringify(inboxGate.filter), /\"b\":\"NEW\"/);
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
