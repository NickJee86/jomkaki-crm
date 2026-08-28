const clean = value => String(value ?? '').trim();
const truth = value => ['TRUE', 'YES', '1', 'ON', 'ENABLED'].includes(clean(value).toUpperCase());
const numberBetween = (value, fallback, minimum, maximum) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
};

export const FOLLOW_UP_RULE_IDS = [
  'DOCUMENTS_NOT_STARTED',
  'DOCUMENTS_PARTIAL',
  'CONSENT_UNSIGNED',
  'INFORMATION_INCOMPLETE',
  'CAD_ADDITIONAL_DOCUMENTS',
  'DIRECT_DEBIT_INCOMPLETE',
  'AGREEMENT_UNSIGNED'
];

export const DEFAULT_FOLLOW_UP_SETTINGS = Object.freeze({
  global: Object.freeze({
    enabled: true,
    timezone: 'Asia/Kuala_Lumpur',
    utcOffsetMinutes: 480,
    businessStart: '09:00',
    businessEnd: '17:30',
    activeDays: Object.freeze([1, 2, 3, 4, 5, 6]),
    maxPerRun: 20,
    replyResetsAttempts: true,
    pauseOnHumanTakeover: true
  }),
  rules: Object.freeze([
    Object.freeze({ id: 'DOCUMENTS_NOT_STARTED', label: 'Documents not started', enabled: true, delays: Object.freeze([3, 24, 48]), maxAttempts: 3, templateName: 'jomkaki_documents_start_v1', language: 'ms' }),
    Object.freeze({ id: 'DOCUMENTS_PARTIAL', label: 'Documents partially received', enabled: true, delays: Object.freeze([3, 24, 48]), maxAttempts: 3, templateName: 'jomkaki_documents_partial_v1', language: 'ms' }),
    Object.freeze({ id: 'CONSENT_UNSIGNED', label: 'Consent sent but unsigned', enabled: true, delays: Object.freeze([6, 24, 48]), maxAttempts: 3, templateName: 'jomkaki_consent_unsigned_v1', language: 'ms' }),
    Object.freeze({ id: 'INFORMATION_INCOMPLETE', label: 'Application information incomplete', enabled: true, delays: Object.freeze([4, 24, 48]), maxAttempts: 3, templateName: 'jomkaki_application_info_v1', language: 'ms' }),
    Object.freeze({ id: 'CAD_ADDITIONAL_DOCUMENTS', label: 'CAD additional documents required', enabled: true, delays: Object.freeze([2, 24, 48]), maxAttempts: 3, templateName: 'jomkaki_cad_documents_v1', language: 'ms' }),
    Object.freeze({ id: 'DIRECT_DEBIT_INCOMPLETE', label: 'Direct Debit incomplete after approval', enabled: true, delays: Object.freeze([6, 24, 48]), maxAttempts: 3, templateName: 'jomkaki_direct_debit_v1', language: 'ms' }),
    Object.freeze({ id: 'AGREEMENT_UNSIGNED', label: 'Agreement sent but unsigned', enabled: true, delays: Object.freeze([6, 24, 48]), maxAttempts: 3, templateName: 'jomkaki_agreement_unsigned_v1', language: 'ms' })
  ])
});

export const FOLLOW_UP_SETTINGS_HEADERS = [
  'Rule ID', 'Label', 'Enabled', 'First Delay Hours', 'Second Delay Hours', 'Third Delay Hours', 'Max Attempts',
  'Meta Template Name', 'Template Language', 'Automation Enabled', 'Business Start', 'Business End', 'Active Days',
  'Timezone', 'UTC Offset Minutes', 'Max Per Run', 'Reply Resets Attempts', 'Pause On Human Takeover', 'Updated At', 'Updated By'
];

export const FOLLOW_UP_APPLICATION_HEADERS = [
  'Follow Up Status', 'Follow Up Rule', 'Follow Up Attempts', 'Last Follow Up At', 'Next Follow Up At',
  'Follow Up Scheduled At', 'Follow Up Paused At', 'Follow Up Pause Reason', 'Last Customer Reply At'
];

const cloneDefaults = () => ({
  global: { ...DEFAULT_FOLLOW_UP_SETTINGS.global, activeDays: [...DEFAULT_FOLLOW_UP_SETTINGS.global.activeDays] },
  rules: DEFAULT_FOLLOW_UP_SETTINGS.rules.map(rule => ({ ...rule, delays: [...rule.delays] }))
});

export function normalizeFollowUpSettings(input = {}) {
  const defaults = cloneDefaults();
  const sourceRows = Array.isArray(input) ? input : Array.isArray(input.rows) ? input.rows : Array.isArray(input.rules) ? input.rules : [];
  const sourceGlobal = Array.isArray(input) ? (sourceRows[0] || {}) : (input.global || sourceRows[0] || {});
  const suppliedActiveDays = sourceGlobal.activeDays ?? sourceGlobal['Active Days'];
  const global = {
    enabled: sourceGlobal.enabled === undefined && sourceGlobal['Automation Enabled'] === undefined ? defaults.global.enabled : truth(sourceGlobal.enabled ?? sourceGlobal['Automation Enabled']),
    timezone: clean(sourceGlobal.timezone ?? sourceGlobal.Timezone) || defaults.global.timezone,
    utcOffsetMinutes: numberBetween(sourceGlobal.utcOffsetMinutes ?? sourceGlobal['UTC Offset Minutes'], defaults.global.utcOffsetMinutes, -720, 840),
    businessStart: /^\d{2}:\d{2}$/.test(clean(sourceGlobal.businessStart ?? sourceGlobal['Business Start'])) ? clean(sourceGlobal.businessStart ?? sourceGlobal['Business Start']) : defaults.global.businessStart,
    businessEnd: /^\d{2}:\d{2}$/.test(clean(sourceGlobal.businessEnd ?? sourceGlobal['Business End'])) ? clean(sourceGlobal.businessEnd ?? sourceGlobal['Business End']) : defaults.global.businessEnd,
    activeDays: Array.isArray(suppliedActiveDays) ? suppliedActiveDays.map(Number).filter(day => day >= 0 && day <= 6) : clean(suppliedActiveDays).split(',').filter(Boolean).map(Number).filter(day => day >= 0 && day <= 6),
    maxPerRun: numberBetween(sourceGlobal.maxPerRun ?? sourceGlobal['Max Per Run'], defaults.global.maxPerRun, 1, 100),
    replyResetsAttempts: sourceGlobal.replyResetsAttempts === undefined && sourceGlobal['Reply Resets Attempts'] === undefined ? defaults.global.replyResetsAttempts : truth(sourceGlobal.replyResetsAttempts ?? sourceGlobal['Reply Resets Attempts']),
    pauseOnHumanTakeover: sourceGlobal.pauseOnHumanTakeover === undefined && sourceGlobal['Pause On Human Takeover'] === undefined ? defaults.global.pauseOnHumanTakeover : truth(sourceGlobal.pauseOnHumanTakeover ?? sourceGlobal['Pause On Human Takeover'])
  };
  if (!global.activeDays.length) global.activeDays = [...defaults.global.activeDays];
  const byId = new Map(sourceRows.map(row => [clean(row.id ?? row['Rule ID']).toUpperCase(), row]));
  const rules = defaults.rules.map(defaultRule => {
    const row = byId.get(defaultRule.id) || {};
    return {
      id: defaultRule.id,
      label: clean(row.label ?? row.Label) || defaultRule.label,
      enabled: row.enabled === undefined && row.Enabled === undefined ? defaultRule.enabled : truth(row.enabled ?? row.Enabled),
      delays: [
        numberBetween(row.delays?.[0] ?? row['First Delay Hours'], defaultRule.delays[0], 0.25, 720),
        numberBetween(row.delays?.[1] ?? row['Second Delay Hours'], defaultRule.delays[1], 0.25, 720),
        numberBetween(row.delays?.[2] ?? row['Third Delay Hours'], defaultRule.delays[2], 0.25, 720)
      ],
      maxAttempts: numberBetween(row.maxAttempts ?? row['Max Attempts'], defaultRule.maxAttempts, 1, 3),
      templateName: clean(row.templateName ?? row['Meta Template Name']) || defaultRule.templateName,
      language: clean(row.language ?? row['Template Language']) || defaultRule.language
    };
  });
  return { global, rules };
}

export function followUpSettingsRows(settings = {}, actor = 'CRM', updatedAt = new Date().toISOString()) {
  const normalized = normalizeFollowUpSettings(settings);
  return [FOLLOW_UP_SETTINGS_HEADERS, ...normalized.rules.map(rule => [
    rule.id, rule.label, rule.enabled ? 'TRUE' : 'FALSE', rule.delays[0], rule.delays[1], rule.delays[2], rule.maxAttempts,
    rule.templateName, rule.language, normalized.global.enabled ? 'TRUE' : 'FALSE', normalized.global.businessStart,
    normalized.global.businessEnd, normalized.global.activeDays.join(','), normalized.global.timezone, normalized.global.utcOffsetMinutes,
    normalized.global.maxPerRun, normalized.global.replyResetsAttempts ? 'TRUE' : 'FALSE', normalized.global.pauseOnHumanTakeover ? 'TRUE' : 'FALSE',
    updatedAt, actor
  ])];
}

const timestamp = value => {
  const time = new Date(value || 0).valueOf();
  return Number.isFinite(time) ? time : 0;
};
const upper = value => clean(value).toUpperCase();
const splitList = value => clean(value).split(/[,;|]/).map(item => item.trim()).filter(Boolean);
const closedApplication = application => ['COMPLETED', 'REJECTED', 'CANCELLED', 'CLOSED'].includes(upper(application['Application Status'] ?? application.status));
const humanControlled = application => ['PAUSED', 'STOPPED', 'HANDED_OVER', 'TEMPLATE_REQUIRED', 'BLOCKED_CHANNEL'].includes(upper(application['Follow Up Status'] ?? application.followUpStatus)) || ['AI_TO_SA_HANDOVER', 'AI_EXCEPTION_TO_STAFF', 'AI_EXCEPTION_STAFF_MANUAL', 'HUMAN_MANAGED'].includes(upper(application['Processing Mode'] ?? application.processingMode));

export function classifyFollowUpStage(application = {}, documents = []) {
  if (closedApplication(application)) return { eligible: false, reason: 'APPLICATION_CLOSED' };
  if (humanControlled(application)) return { eligible: false, reason: 'MANUAL_OR_PAUSED' };
  const cad = upper(application['CAD Status'] ?? application.cadStatus);
  if (/(ADDITIONAL|MISSING|REQUIRED|PENDING_DOCUMENT)/.test(cad)) return { eligible: true, ruleId: 'CAD_ADDITIONAL_DOCUMENTS' };
  const consent = upper(application['Credit Consent Status'] ?? application.creditConsentStatus);
  if (['QUEUED', 'SENT', 'SIGNED_PENDING_VERIFICATION', 'REJECTED_RESUBMISSION_REQUIRED'].includes(consent) && consent !== 'VERIFIED') return { eligible: true, ruleId: 'CONSENT_UNSIGNED' };
  const missingFields = splitList(application['Missing Application Fields'] ?? application.missingApplicationFields);
  if (missingFields.length) return { eligible: true, ruleId: 'INFORMATION_INCOMPLETE', missingFields };
  const missingDocuments = splitList(application['Missing Documents'] ?? application.missingDocuments);
  const received = Number(application.documentsReceived ?? 0) || documents.filter(document => clean(document['Application ID'] ?? document.applicationId) === clean(application['Application ID'] ?? application.id)).length;
  const documentsComplete = upper(application['Minimum Documents Complete'] ?? application.minimumDocumentsComplete) === 'TRUE' || upper(application.aiDocumentsComplete) === 'TRUE';
  if (!documentsComplete || missingDocuments.length) return { eligible: true, ruleId: received > 0 ? 'DOCUMENTS_PARTIAL' : 'DOCUMENTS_NOT_STARTED', missingDocuments };
  const applicationStatus = upper(application['Application Status'] ?? application.status);
  const lmsStatus = upper(application['LMS Submission Status'] ?? application.lmsSubmissionStatus);
  const approvedJourney = applicationStatus === 'APPROVED' || /(APPROVED|ACCEPTED|SUCCESS)/.test(cad) || ['APPROVED', 'ACCEPTED', 'SUCCESS', 'COMPLETED'].includes(lmsStatus);
  if (approvedJourney) {
    const directDebit = upper(application['Direct Debit Status'] ?? application.directDebitStatus);
    if (!['COMPLETED', 'ACTIVE'].includes(directDebit)) return { eligible: true, ruleId: 'DIRECT_DEBIT_INCOMPLETE' };
    const agreement = upper(application['Agreement Status'] ?? application.agreementStatus);
    if (!['SIGNED', 'COMPLETED', 'APPROVED'].includes(agreement)) return { eligible: true, ruleId: 'AGREEMENT_UNSIGNED' };
  }
  return { eligible: false, reason: 'REQUIREMENTS_COMPLETE' };
}

const localClock = (date, offsetMinutes) => new Date(date.valueOf() + offsetMinutes * 60000);
const parseClock = value => {
  const [hour, minute] = clean(value).split(':').map(Number);
  return { hour: Number.isFinite(hour) ? hour : 0, minute: Number.isFinite(minute) ? minute : 0 };
};
const localToUtc = (year, month, day, hour, minute, offsetMinutes) => new Date(Date.UTC(year, month, day, hour, minute) - offsetMinutes * 60000);

export function moveToFollowUpBusinessWindow(value, globalSettings = {}) {
  const global = normalizeFollowUpSettings({ global: globalSettings }).global;
  let candidate = new Date(value);
  if (!Number.isFinite(candidate.valueOf())) candidate = new Date();
  const start = parseClock(global.businessStart), end = parseClock(global.businessEnd);
  for (let guard = 0; guard < 14; guard += 1) {
    const local = localClock(candidate, global.utcOffsetMinutes);
    const day = local.getUTCDay(), minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
    const startMinutes = start.hour * 60 + start.minute, endMinutes = end.hour * 60 + end.minute;
    if (!global.activeDays.includes(day) || minutes >= endMinutes) {
      const next = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1, start.hour, start.minute));
      candidate = new Date(next.valueOf() - global.utcOffsetMinutes * 60000);
      continue;
    }
    if (minutes < startMinutes) return localToUtc(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), start.hour, start.minute, global.utcOffsetMinutes);
    return candidate;
  }
  return candidate;
}

export function evaluateFollowUp({ application = {}, lead = {}, documents = [], settings = {}, at = new Date() } = {}) {
  const normalized = normalizeFollowUpSettings(settings);
  if (!normalized.global.enabled) return { eligible: false, reason: 'AUTOMATION_DISABLED' };
  const stage = classifyFollowUpStage(application, documents);
  if (!stage.eligible) return stage;
  const rule = normalized.rules.find(item => item.id === stage.ruleId);
  if (!rule?.enabled) return { eligible: false, reason: 'RULE_DISABLED', ruleId: stage.ruleId };
  const lastReplyAt = clean(application['Last Customer Reply At'] ?? application.lastCustomerReplyAt ?? lead['Last Customer Reply At'] ?? lead.lastCustomerReplyAt ?? lead['Last Inbound At'] ?? lead.lastInboundAt);
  const lastFollowUpAt = clean(application['Last Follow Up At'] ?? application.lastFollowUpAt);
  let attempts = numberBetween(application['Follow Up Attempts'] ?? application.followUpAttempts, 0, 0, 999);
  if (normalized.global.replyResetsAttempts && timestamp(lastReplyAt) > timestamp(lastFollowUpAt)) attempts = 0;
  if (attempts >= rule.maxAttempts) return { eligible: false, reason: 'MAX_ATTEMPTS_REACHED', ruleId: rule.id, attempts, rule };
  const scheduledAt = clean(application['Follow Up Scheduled At'] ?? application.followUpScheduledAt);
  const explicitNextValue = clean(application['Next Follow Up At'] ?? application.nextFollowUp);
  const explicitNext = timestamp(lastReplyAt) > timestamp(scheduledAt) ? '' : explicitNextValue;
  const base = attempts > 0 && lastFollowUpAt ? lastFollowUpAt : (lastReplyAt || application['Updated At'] || application.updated || application['Created At'] || application.created || at);
  const delay = rule.delays[Math.min(attempts, rule.delays.length - 1)];
  const calculated = new Date(timestamp(base) + delay * 3600000);
  const dueAt = moveToFollowUpBusinessWindow(explicitNext || calculated, normalized.global);
  return {
    eligible: true,
    due: dueAt.valueOf() <= new Date(at).valueOf(),
    dueAt: dueAt.toISOString(),
    ruleId: rule.id,
    rule,
    attempts,
    nextAttempt: attempts + 1,
    lastReplyAt,
    ...stage
  };
}

export function followUpNeedsMetaTemplate(lastReplyAt, sendAt = new Date()) {
  const lastReply = timestamp(lastReplyAt);
  return !lastReply || new Date(sendAt).valueOf() - lastReply >= 24 * 3600000;
}

const customerName = application => {
  const name = clean(application['Applicant Name'] ?? application.customer);
  return name && !/^WhatsApp Customer\b/i.test(name) ? name.split(/\s+/)[0] : '';
};
const productName = application => clean(application.product || [application['Product Brand'], application['Product Model']].filter(Boolean).join(' '));
const missingDocumentLabels = value => splitList(value).map(item => ({ IC_FRONT: 'MyKad bahagian depan', IC_BACK: 'MyKad bahagian belakang', INCOME_PROOF: 'slip gaji terkini atau penyata EPF', BANK_STATEMENT: 'bank statement', CTOS_CCRIS_CONSENT: 'borang consent yang sudah ditandatangani' }[upper(item)] || item.replaceAll('_', ' ').toLowerCase()));

export function buildFollowUpMessage({ application = {}, ruleId = '', attempt = 1 } = {}) {
  const name = customerName(application), greeting = name ? `Hi ${name},` : 'Hi,';
  const product = productName(application), productText = product ? ` untuk ${product}` : '';
  const missingDocuments = missingDocumentLabels(application['Missing Documents'] ?? application.missingDocuments);
  const missingFields = splitList(application['Missing Application Fields'] ?? application.missingApplicationFields).map(item => item.replaceAll('_', ' ').toLowerCase());
  const suffix = attempt >= 3 ? ' Kalau ada apa-apa yang menghalang, beritahu saya—saya boleh bantu semak satu-satu.' : '';
  if (ruleId === 'CAD_ADDITIONAL_DOCUMENTS') return `${greeting} pihak semakan perlukan dokumen tambahan untuk teruskan permohonan${productText}. Boleh hantar dokumen yang diminta di sini; saya akan semak sebaik diterima.${suffix}`;
  if (ruleId === 'CONSENT_UNSIGNED') return `${greeting} borang consent${productText} masih belum lengkap. Boleh tandatangan dan hantar semula PDF atau gambar yang jelas di sini. Tak perlu tunggu dokumen lain lengkap.${suffix}`;
  if (ruleId === 'INFORMATION_INCOMPLETE') return `${greeting} maklumat permohonan${productText} masih belum lengkap${missingFields.length ? ` (${missingFields.slice(0, 4).join(', ')})` : ''}. Boleh lengkapkan borang yang saya hantar tadi dalam satu mesej supaya saya teruskan semakan.${suffix}`;
  if (ruleId === 'DOCUMENTS_PARTIAL') return `${greeting} saya sudah terima sebahagian dokumen${productText}. Yang masih diperlukan ialah ${missingDocuments.length ? missingDocuments.join(', ') : 'dokumen permohonan yang belum lengkap'}. Hantar yang ada dulu pun boleh; saya semak sekali terus.${suffix}`;
  if (ruleId === 'DIRECT_DEBIT_INCOMPLETE') return `${greeting} permohonan${productText} sudah sampai ke langkah Direct Debit. Boleh lengkapkan arahan Direct Debit yang dihantar supaya proses seterusnya boleh diteruskan. Kalau ada bahagian yang tak jelas, balas di sini dan saya bantu.${suffix}`;
  if (ruleId === 'AGREEMENT_UNSIGNED') return `${greeting} perjanjian untuk permohonan${productText} masih belum ditandatangani. Sila semak dan tandatangan perjanjian yang dihantar, kemudian balas di sini selepas selesai. Kalau perlukan bantuan, beritahu saya.${suffix}`;
  return `${greeting} saya boleh teruskan semakan Loan Kedai${productText}. Untuk mula, boleh hantar MyKad depan dan belakang bersama slip gaji terkini atau penyata EPF. Kalau belum ada semua, hantar yang ada dulu—saya semak sekali terus.${suffix}`;
}

export function nextFollowUpAfterSend({ sentAt = new Date(), rule = {}, attempts = 1, global = {} } = {}) {
  if (attempts >= Number(rule.maxAttempts || 3)) return '';
  const delays = Array.isArray(rule.delays) ? rule.delays : [3, 24, 48];
  const delay = numberBetween(delays[Math.min(attempts, delays.length - 1)], 24, 0.25, 720);
  return moveToFollowUpBusinessWindow(new Date(new Date(sentAt).valueOf() + delay * 3600000), global).toISOString();
}

