import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  DEFAULT_FOLLOW_UP_SETTINGS,
  buildFollowUpMessage,
  classifyFollowUpStage,
  evaluateFollowUp,
  followUpNeedsMetaTemplate,
  followUpSettingsRows,
  moveToFollowUpBusinessWindow,
  normalizeFollowUpSettings
} from '../api/_follow-up.js';

test('follow-up defaults cover every required incomplete-customer stage', () => {
  const settings = normalizeFollowUpSettings();
  assert.equal(settings.global.enabled, true);
  assert.deepEqual(settings.global.activeDays, [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(settings.rules.map(rule => rule.id), [
    'DOCUMENTS_NOT_STARTED', 'DOCUMENTS_PARTIAL', 'CONSENT_UNSIGNED', 'INFORMATION_INCOMPLETE', 'CAD_ADDITIONAL_DOCUMENTS'
  ]);
  assert.ok(settings.rules.every(rule => rule.maxAttempts === 3));
});

test('CRM values safely normalize timing and serialize into the settings worksheet', () => {
  const settings = normalizeFollowUpSettings({
    global: { enabled: true, businessStart: '08:30', businessEnd: '18:00', activeDays: [1, 2, 3, 4, 5], maxPerRun: 30 },
    rules: [{ id: 'DOCUMENTS_PARTIAL', enabled: true, delays: [2, 20, 44], maxAttempts: 3, templateName: 'jkm_documents_follow_up', language: 'ms' }]
  });
  const partial = settings.rules.find(rule => rule.id === 'DOCUMENTS_PARTIAL');
  assert.deepEqual(partial.delays, [2, 20, 44]);
  assert.equal(partial.templateName, 'jkm_documents_follow_up');
  const rows = followUpSettingsRows(settings, 'admin', '2026-08-26T10:00:00.000Z');
  assert.equal(rows.length, DEFAULT_FOLLOW_UP_SETTINGS.rules.length + 1);
  assert.ok(rows[0].includes('Meta Template Name'));
});

test('follow-up stage prioritizes CAD, consent, incomplete information and document progress', () => {
  assert.equal(classifyFollowUpStage({ 'Application Status': 'IN_PROGRESS', 'CAD Status': 'ADDITIONAL_DOCUMENTS_REQUIRED' }).ruleId, 'CAD_ADDITIONAL_DOCUMENTS');
  assert.equal(classifyFollowUpStage({ 'Application Status': 'IN_PROGRESS', 'Credit Consent Status': 'SENT' }).ruleId, 'CONSENT_UNSIGNED');
  assert.equal(classifyFollowUpStage({ 'Application Status': 'IN_PROGRESS', 'Missing Application Fields': 'Email,Employer Name' }).ruleId, 'INFORMATION_INCOMPLETE');
  assert.equal(classifyFollowUpStage({ 'Application Status': 'IN_PROGRESS', 'Missing Documents': 'IC_BACK', documentsReceived: 2 }).ruleId, 'DOCUMENTS_PARTIAL');
  assert.equal(classifyFollowUpStage({ 'Application Status': 'IN_PROGRESS', 'Missing Documents': 'IC_FRONT,IC_BACK' }).ruleId, 'DOCUMENTS_NOT_STARTED');
});

test('closed, completed, paused and handed-over cases never receive automatic follow-up', () => {
  assert.equal(classifyFollowUpStage({ 'Application Status': 'COMPLETED' }).eligible, false);
  assert.equal(classifyFollowUpStage({ 'Application Status': 'IN_PROGRESS', 'Follow Up Status': 'PAUSED' }).eligible, false);
  assert.equal(classifyFollowUpStage({ 'Application Status': 'IN_PROGRESS', 'Processing Mode': 'AI_TO_SA_HANDOVER' }).eligible, false);
  assert.equal(classifyFollowUpStage({ 'Application Status': 'IN_PROGRESS', 'Minimum Documents Complete': 'TRUE' }).eligible, false);
});

test('a customer reply resets attempts and calculates a fresh due time', () => {
  const result = evaluateFollowUp({
    application: { 'Application Status': 'IN_PROGRESS', 'Missing Documents': 'IC_BACK', documentsReceived: 1, 'Follow Up Attempts': '2', 'Last Follow Up At': '2026-08-25T01:00:00.000Z' },
    lead: { 'Last Customer Reply At': '2026-08-26T01:00:00.000Z' },
    settings: normalizeFollowUpSettings(),
    at: new Date('2026-08-26T02:00:00.000Z')
  });
  assert.equal(result.attempts, 0);
  assert.equal(result.nextAttempt, 1);
  assert.equal(result.due, false);
  assert.equal(result.dueAt, '2026-08-26T04:00:00.000Z');
});

test('a customer reply invalidates an older explicit reminder schedule', () => {
  const result = evaluateFollowUp({
    application: {
      'Application Status': 'IN_PROGRESS', 'Missing Documents': 'IC_BACK', documentsReceived: 1,
      'Next Follow Up At': '2026-08-26T02:00:00.000Z', 'Follow Up Scheduled At': '2026-08-25T01:00:00.000Z',
      'Last Follow Up At': '2026-08-25T01:00:00.000Z'
    },
    lead: { 'Last Customer Reply At': '2026-08-26T01:00:00.000Z' },
    settings: normalizeFollowUpSettings(),
    at: new Date('2026-08-26T02:30:00.000Z')
  });
  assert.equal(result.due, false);
  assert.equal(result.dueAt, '2026-08-26T04:00:00.000Z');
});

test('business-hour guard moves an evening reminder to the next active morning', () => {
  const due = moveToFollowUpBusinessWindow('2026-08-26T12:00:00.000Z', normalizeFollowUpSettings().global);
  assert.equal(due.toISOString(), '2026-08-27T01:00:00.000Z');
});

test('messages explain exactly what remains without asking for completed items again', () => {
  const message = buildFollowUpMessage({
    application: { 'Applicant Name': 'Nick Jee', 'Product Brand': 'Yamaha', 'Product Model': 'Y16ZR', 'Missing Documents': 'IC_BACK,INCOME_PROOF' },
    ruleId: 'DOCUMENTS_PARTIAL',
    attempt: 2
  });
  assert.match(message, /MyKad bahagian belakang/);
  assert.match(message, /slip gaji terkini atau penyata EPF/);
  assert.doesNotMatch(message, /MyKad bahagian depan/);
});

test('Meta template is required after the 24-hour customer service window', () => {
  assert.equal(followUpNeedsMetaTemplate('2026-08-25T01:00:00.000Z', new Date('2026-08-26T01:00:00.000Z')), true);
  assert.equal(followUpNeedsMetaTemplate('2026-08-25T02:00:00.000Z', new Date('2026-08-26T01:00:00.000Z')), false);
});

test('CRM and Vercel expose the complete follow-up control layer', () => {
  const app = fs.readFileSync(new URL('../app-v2.js', import.meta.url), 'utf8');
  const api = fs.readFileSync(new URL('../api/crm.js', import.meta.url), 'utf8');
  const dispatcher = fs.readFileSync(new URL('../api/follow-up-dispatch.js', import.meta.url), 'utf8');
  const vercel = JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.match(app, /Customer follow-up control/);
  assert.match(app, /controlApplicationFollowUp/);
  assert.match(api, /saveFollowUpSettings/);
  assert.match(api, /Follow_Up_Settings/);
  assert.match(dispatcher, /FOLLOW_UP_AUTOMATION/);
  assert.deepEqual(vercel.crons, [{ path: '/api/follow-up-dispatch', schedule: '*/15 * * * *' }]);
});

