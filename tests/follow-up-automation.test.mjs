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
  assert.deepEqual(vercel.crons, [
    { path: '/api/follow-up-dispatch', schedule: '*/15 * * * *' },
    { path: '/api/whatsapp-outbox-send', schedule: '*/5 * * * *' }
  ]);
});

test('follow-up settings show operational status, approved previews and controlled tests without a wide table', () => {
  const app = fs.readFileSync(new URL('../app-v2.js', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../v2.css', import.meta.url), 'utf8');
  for (const template of [
    'jomkaki_documents_start_v1',
    'jomkaki_documents_partial_v1',
    'jomkaki_consent_unsigned_v1',
    'jomkaki_application_info_v1',
    'jomkaki_cad_documents_v1'
  ]) assert.match(app, new RegExp(template));
  assert.match(app, /Waiting customers/);
  assert.match(app, /Due now/);
  assert.match(app, /Delivery issues/);
  assert.match(app, /Last automated send/);
  assert.match(app, /Customer reply → reset attempts/);
  assert.match(app, /Controlled template test/);
  assert.match(app, /messageType:'TEMPLATE'/);
  assert.match(css, /\.follow-up-rule-list\{display:grid/);
  assert.match(css, /@media\(max-width:760px\).*\.follow-up-template-row\{grid-template-columns:1fr\}/s);
});

test('follow-up settings preserve last-saved attribution for administrators', () => {
  const api = fs.readFileSync(new URL('../api/crm.js', import.meta.url), 'utf8');
  assert.match(api, /updatedAt: clean\(settings\.updatedAt\)/);
  assert.match(api, /settings\.updatedBy = session\.username/);
  assert.match(api, /followUpSettingsRows\(settings, session\.username, settings\.updatedAt\)/);
});

test('follow-up control centre exposes scheduler health, exceptions, history and safe actions', () => {
  const app = fs.readFileSync(new URL('../app-v2.js', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../v2.css', import.meta.url), 'utf8');
  assert.match(app, /Scheduler health/);
  assert.match(app, /Run safe scan/);
  assert.match(app, /Exception queue/);
  assert.match(app, /Follow-up history/);
  assert.match(app, /Template health/);
  assert.match(app, /Policy &amp; access/);
  assert.match(app, /followUpControlCentreManager/);
  assert.match(app, /resources=\['outbox','activity','followUpSettings'\]/);
  assert.match(css, /\.follow-up-console-grid\{display:grid/);
  assert.match(css, /\.settings-policy-disclosure/);
  assert.match(css, /@media\(max-width:760px\).*\.follow-up-console-grid.*grid-template-columns:1fr/s);
});

test('follow-up operations are separated from Management and available by role scope', () => {
  const app = fs.readFileSync(new URL('../app-v2.js', import.meta.url), 'utf8');
  const api = fs.readFileSync(new URL('../api/crm.js', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../v2.css', import.meta.url), 'utf8');
  assert.match(app, /function followup\(\)/);
  assert.match(app, /function followUpTeamWorkspace\(\)/);
  assert.match(app, /Customer follow-up queue/);
  assert.match(app, /Information incomplete/);
  assert.match(app, /Consent unsigned/);
  assert.match(app, /if\(admin&&loadedResources\.has\('followUpSettings'\)\)followUpControlCentreManager\(\);else followUpTeamWorkspace\(\)/);
  assert.doesNotMatch(app, /function settings\(\)\{\s*settingsLegacy\(\);\s*if\(state\.user\?\.role==='ADMIN'&&loadedResources\.has\('followUpSettings'\)\)/);
  assert.doesNotMatch(api, /resource === 'followUpSettings'[\s\S]{0,120}session\.role !== 'ADMIN'/);
  assert.match(css, /\.follow-up-work-row\{display:grid/);
});

test('safe scheduler scan is admin-only, read-only and audit logged', () => {
  const api = fs.readFileSync(new URL('../api/crm.js', import.meta.url), 'utf8');
  assert.match(api, /action === 'previewFollowUpRun'/);
  assert.match(api, /runFollowUpDispatch\(req, \{ dryRun: true \}\)/);
  assert.match(api, /CRM_FOLLOW_UP_SAFE_SCAN/);
  assert.match(api, /Administrator access is required/);
});

test('scheduler heartbeat and automatic-message fields support live health and history', () => {
  const api = fs.readFileSync(new URL('../api/crm.js', import.meta.url), 'utf8');
  const dispatcher = fs.readFileSync(new URL('../api/follow-up-dispatch.js', import.meta.url), 'utf8');
  assert.match(dispatcher, /FOLLOW_UP_RUN_COMPLETED/);
  assert.match(dispatcher, /completedAt: now\.toISOString\(\)/);
  assert.match(api, /automationKey: row\['Automation Key'\]/);
  assert.match(api, /followUpRule: row\['Follow Up Rule'\]/);
  assert.match(api, /row\['Actor Username'\]/);
  assert.match(api, /row\['Occurred At'\]/);
});

test('go-live readiness treats the follow-up scheduler as a production dependency', () => {
  const app = fs.readFileSync(new URL('../app-v2.js', import.meta.url), 'utf8');
  assert.match(app, /\['Follow-up scheduler'/);
  assert.match(app, /followUpOperations\.schedulerHealthy/);
  assert.match(app, /'activity','followUpSettings'/);
  assert.match(app, /No successful scheduler run was observed in the last 45 minutes/);
});

test('scheduler heartbeat remains visible regardless of activity-log length', () => {
  const api = fs.readFileSync(new URL('../api/crm.js', import.meta.url), 'utf8');
  const dispatcher = fs.readFileSync(new URL('../api/follow-up-dispatch.js', import.meta.url), 'utf8');
  assert.match(api, /Activity_Log!A:Z/);
  assert.match(dispatcher, /Activity_Log!A1:Z1/);
});

test('Administrator can see approved system-level follow-up audit events', () => {
  const api = fs.readFileSync(new URL('../api/crm.js', import.meta.url), 'utf8');
  assert.match(api, /globalActivityTypes = new Set\(\['FOLLOW_UP_RUN_COMPLETED', 'CRM_FOLLOW_UP_SAFE_SCAN', 'CRM_FOLLOW_UP_SETTINGS_UPDATED'\]\)/);
  assert.match(api, /resource === 'activity' && session\.role === 'ADMIN'/);
  assert.match(api, /globalActivityTypes\.has\(clean\(row\['Activity Type'\]\)\.toUpperCase\(\)\)/);
});
