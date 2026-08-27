import crypto from 'node:crypto';
import {
  FOLLOW_UP_APPLICATION_HEADERS,
  buildFollowUpMessage,
  evaluateFollowUp,
  followUpNeedsMetaTemplate,
  nextFollowUpAfterSend,
  normalizeFollowUpSettings
} from './_follow-up.js';

const SHEET_ID = process.env.JOMKAKI_SPREADSHEET_ID;
const CLIENT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const PROJECT_NUMBER = process.env.GOOGLE_PROJECT_NUMBER;
const POOL_ID = process.env.GOOGLE_WIF_POOL_ID || 'vercel-production';
const PROVIDER_ID = process.env.GOOGLE_WIF_PROVIDER_ID || 'vercel-jomkaki-production';
const clean = value => String(value ?? '').trim();
const truth = value => clean(value).toUpperCase() === 'TRUE';
const digits = value => clean(value).replace(/\D/g, '').replace(/^0/, '60');
const objects = rows => {
  const [headers = [], ...values] = rows;
  return values.map((row, index) => ({ rowNumber: index + 2, ...Object.fromEntries(headers.map((header, column) => [header, row[column] ?? ''])) })).filter(row => Object.values(row).some(Boolean));
};
const columnName = index => {
  let name = '';
  for (let value = index + 1; value; value = Math.floor((value - 1) / 26)) name = String.fromCharCode(65 + ((value - 1) % 26)) + name;
  return name;
};
const credentialPrefix = value => clean(value).toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
const safeEqual = (left, right) => {
  const a = Buffer.from(clean(left)), b = Buffer.from(clean(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

async function getAccessToken(req) {
  const oidcToken = req.headers['x-vercel-oidc-token'] || process.env.VERCEL_OIDC_TOKEN;
  if (!oidcToken || !CLIENT_EMAIL || !PROJECT_NUMBER) throw new Error('Google workload identity is not configured');
  const providerResource = `projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}/providers/${PROVIDER_ID}`;
  const exchange = await fetch('https://sts.googleapis.com/v1/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ audience: `//iam.googleapis.com/${providerResource}`, grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange', requested_token_type: 'urn:ietf:params:oauth:token-type:access_token', scope: 'https://www.googleapis.com/auth/cloud-platform', subject_token_type: 'urn:ietf:params:oauth:token-type:jwt', subject_token: oidcToken })
  });
  if (!exchange.ok) throw new Error(`Google identity exchange failed (${exchange.status})`);
  const federatedToken = (await exchange.json()).access_token;
  const response = await fetch(`https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(CLIENT_EMAIL)}:generateAccessToken`, {
    method: 'POST', headers: { authorization: `Bearer ${federatedToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ scope: ['https://www.googleapis.com/auth/spreadsheets'], lifetime: '3600s' })
  });
  if (!response.ok) throw new Error(`Google service account authorization failed (${response.status})`);
  return (await response.json()).accessToken;
}

async function readSheet(token, range, optional = false) {
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}`, { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) {
    if (optional) return [];
    throw new Error(`Unable to read ${range} (${response.status})`);
  }
  return (await response.json()).values || [];
}

async function ensureHeaders(token, sheet, requiredHeaders) {
  const rows = await readSheet(token, `${sheet}!1:1`), headers = rows[0] || [];
  const missing = requiredHeaders.filter(header => !headers.includes(header));
  if (!missing.length) return headers;
  const metadataResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}?fields=sheets.properties(sheetId,title,gridProperties(columnCount))`, { headers: { authorization: `Bearer ${token}` } });
  if (!metadataResponse.ok) throw new Error(`Unable to inspect ${sheet}`);
  const metadata = await metadataResponse.json(), properties = (metadata.sheets || []).map(item => item.properties || {}).find(item => item.title === sheet);
  if (!properties) throw new Error(`${sheet} worksheet was not found`);
  const requiredColumns = headers.length + missing.length, currentColumns = Number(properties.gridProperties?.columnCount || 0);
  if (requiredColumns > currentColumns) {
    const expand = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}:batchUpdate`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ requests: [{ appendDimension: { sheetId: properties.sheetId, dimension: 'COLUMNS', length: requiredColumns - currentColumns } }] }) });
    if (!expand.ok) throw new Error(`Unable to expand ${sheet}`);
  }
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(`${sheet}!${columnName(headers.length)}1`)}?valueInputOption=RAW`, { method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ values: [missing] }) });
  if (!response.ok) throw new Error(`Unable to add ${sheet} follow-up fields`);
  return [...headers, ...missing];
}

async function updateRow(token, sheet, headers, rowNumber, changes) {
  const data = Object.entries(changes).filter(([header]) => headers.includes(header)).map(([header, value]) => ({ range: `${sheet}!${columnName(headers.indexOf(header))}${rowNumber}`, values: [[value ?? '']] }));
  if (!data.length) return;
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values:batchUpdate`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data }) });
  if (!response.ok) throw new Error(`Unable to update ${sheet} (${response.status})`);
}

async function appendRow(token, sheet, headers, row) {
  const values = headers.map(header => row[header] ?? '');
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(`${sheet}!A:A`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ values: [values] }) });
  if (!response.ok) throw new Error(`Unable to append ${sheet} (${response.status})`);
}

const routeFor = (application, lead, channels) => {
  const id = clean(application['Origin WhatsApp Channel ID'] || lead['Last Inbound WhatsApp Channel ID'] || lead['Primary WhatsApp Channel ID']);
  return channels.find(row => clean(row['Internal Channel ID']) === id) || {};
};
const routeReady = route => clean(route['Internal Channel ID']) && truth(route.Active) && truth(route['Outbound Enabled']) && clean(route['Phone Number ID']) && clean(route['Last Verified At']);
const channelCredential = route => clean(process.env[`${credentialPrefix(route['Credential Key'] || route['Internal Channel ID'])}_ACCESS_TOKEN`]);

async function sendCloudMessage(route, phone, message, templateName, language) {
  const accessToken = channelCredential(route);
  if (!accessToken) throw new Error('Protected WhatsApp credential is not configured');
  const useTemplate = Boolean(templateName), version = clean(process.env.WHATSAPP_GRAPH_VERSION || 'v25.0');
  const payload = useTemplate
    ? { messaging_product: 'whatsapp', to: phone, type: 'template', template: { name: templateName, language: { code: language || 'ms' } } }
    : { messaging_product: 'whatsapp', recipient_type: 'individual', to: phone, type: 'text', text: { preview_url: false, body: message } };
  const response = await fetch(`https://graph.facebook.com/${version}/${route['Phone Number ID']}/messages`, { method: 'POST', headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(clean(result.error?.message) || `Meta API error ${response.status}`);
  return clean(result.messages?.[0]?.id);
}

export async function runFollowUpDispatch(req, { applicationId = '', dryRun = false } = {}) {
  if (!SHEET_ID) throw new Error('Spreadsheet is not configured');
  const token = await getAccessToken(req);
  const [applicationRows, leadRows, documentRows, outboxRows, channelRows, settingsRows, activityRows] = await Promise.all([
    readSheet(token, 'Applications!A1:CZ2000'), readSheet(token, 'Leads!A1:BG2000'), readSheet(token, 'Document_Log!A1:AD2000'),
    readSheet(token, 'Message_Outbox!A1:BG2000'), readSheet(token, 'WhatsApp_Number_Master!A1:AC1000'), readSheet(token, 'Follow_Up_Settings!A1:Z100', true),
    readSheet(token, 'Activity_Log!A1:Z1')
  ]);
  const applications = objects(applicationRows), leads = objects(leadRows), documents = objects(documentRows), outbox = objects(outboxRows), channels = objects(channelRows);
  const settings = normalizeFollowUpSettings(objects(settingsRows));
  const applicationHeaders = dryRun ? (applicationRows[0] || []) : await ensureHeaders(token, 'Applications', FOLLOW_UP_APPLICATION_HEADERS);
  const leadHeaders = dryRun ? (leadRows[0] || []) : await ensureHeaders(token, 'Leads', FOLLOW_UP_APPLICATION_HEADERS);
  const outboxHeaders = dryRun ? (outboxRows[0] || []) : await ensureHeaders(token, 'Message_Outbox', ['Automation Key', 'Follow Up Rule', 'Follow Up Attempt']);
  const activityHeaders = dryRun ? (activityRows[0] || []) : await ensureHeaders(token, 'Activity_Log', ['Activity ID', 'Occurred At', 'Lead ID', 'Application ID', 'Activity Type', 'Description', 'Actor Username']);
  const now = new Date(), results = [];
  const recordActivity = async (application, type, description) => {
    if (dryRun) return;
    await appendRow(token, 'Activity_Log', activityHeaders, {
      'Activity ID': `ACT-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
      'Occurred At': new Date().toISOString(), 'Lead ID': application['Lead ID'], 'Application ID': application['Application ID'],
      'Activity Type': type, Description: description, 'Actor Username': 'FOLLOW_UP_AUTOMATION'
    });
  };
  for (const application of applications) {
    if (results.filter(result => result.sent || result.queued).length >= settings.global.maxPerRun) break;
    const id = clean(application['Application ID']);
    if (!id || (applicationId && id !== clean(applicationId))) continue;
    const lead = leads.find(row => clean(row['Lead ID']) === clean(application['Lead ID'])) || {};
    const caseDocuments = documents.filter(row => clean(row['Application ID']) === id);
    const evaluation = evaluateFollowUp({ application, lead, documents: caseDocuments, settings, at: now });
    if (!evaluation.eligible || !evaluation.due) { if (applicationId) results.push({ applicationId: id, ...evaluation }); continue; }
    const automationKey = `FOLLOWUP:${id}:${evaluation.ruleId}:${evaluation.nextAttempt}:${new Date(evaluation.dueAt).toISOString().slice(0, 13)}`;
    if (outbox.some(row => clean(row['Automation Key']) === automationKey && ['SENT', 'QUEUED', 'MANUAL_PENDING', 'DELIVERED', 'READ'].includes(clean(row['Send Status']).toUpperCase()))) {
      results.push({ applicationId: id, skipped: 'DUPLICATE', automationKey });
      continue;
    }
    const phone = digits(application['Phone Number'] || lead['Phone Number']), route = routeFor(application, lead, channels);
    if (!phone || !routeReady(route)) {
      const reason = phone ? 'Official WhatsApp channel is not ready' : 'Customer phone number is missing';
      if (!dryRun) {
        await updateRow(token, 'Applications', applicationHeaders, application.rowNumber, { 'Follow Up Status': 'BLOCKED_CHANNEL', 'Follow Up Rule': evaluation.ruleId, 'Follow Up Pause Reason': reason, 'Next Follow Up At': '', 'Follow Up Scheduled At': '', 'Updated At': now.toISOString(), 'Updated By': 'FOLLOW_UP_AUTOMATION' });
        await recordActivity(application, 'FOLLOW_UP_BLOCKED_CHANNEL', reason);
      }
      results.push({ applicationId: id, blocked: 'CHANNEL_OR_PHONE' });
      continue;
    }
    const message = buildFollowUpMessage({ application, ruleId: evaluation.ruleId, attempt: evaluation.nextAttempt });
    const templateRequired = followUpNeedsMetaTemplate(evaluation.lastReplyAt, now), templateName = templateRequired ? clean(evaluation.rule.templateName) : '';
    if (templateRequired && !templateName && clean(process.env.WHATSAPP_SEND_MODE).toUpperCase() === 'CLOUD') {
      const reason = 'Approved Meta template required outside the 24-hour customer service window';
      if (!dryRun) {
        await updateRow(token, 'Applications', applicationHeaders, application.rowNumber, { 'Follow Up Status': 'TEMPLATE_REQUIRED', 'Follow Up Rule': evaluation.ruleId, 'Follow Up Pause Reason': reason, 'Next Follow Up At': '', 'Follow Up Scheduled At': '', 'Updated At': now.toISOString(), 'Updated By': 'FOLLOW_UP_AUTOMATION' });
        await recordActivity(application, 'FOLLOW_UP_META_TEMPLATE_REQUIRED', reason);
      }
      results.push({ applicationId: id, blocked: 'META_TEMPLATE_REQUIRED' });
      continue;
    }
    if (dryRun) { results.push({ applicationId: id, dueAt: evaluation.dueAt, ruleId: evaluation.ruleId, attempt: evaluation.nextAttempt, message, templateRequired }); continue; }
    const cloudMode = clean(process.env.WHATSAPP_SEND_MODE).toUpperCase() === 'CLOUD';
    let providerMessageId = '', sendStatus = 'MANUAL_PENDING', sendError = '';
    try {
      if (cloudMode) { providerMessageId = await sendCloudMessage(route, phone, message, templateName, evaluation.rule.language); sendStatus = 'QUEUED'; }
    } catch (error) { sendStatus = 'FAILED'; sendError = clean(error?.message) || 'Follow-up delivery failed'; }
    const sentAt = now.toISOString(), outboxId = `FUP-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    await appendRow(token, 'Message_Outbox', outboxHeaders, {
      'Outbox ID': outboxId, 'Created At': sentAt, 'Lead ID': application['Lead ID'], 'Application ID': id, 'Phone Number': phone,
      'Message Type': templateName ? 'TEMPLATE' : 'TEXT', 'Message Text': message, 'Template Name': templateName, Language: evaluation.rule.language,
      'Send Status': sendStatus, 'Attempt Count': cloudMode ? '1' : '0', 'Sent At': sendStatus === 'QUEUED' ? sentAt : '', 'Provider Message ID': providerMessageId,
      'Error Message': sendError, 'WhatsApp Number ID': route['Phone Number ID'], 'WABA ID': route['WABA ID'], 'Internal Channel ID': route['Internal Channel ID'],
      'Make Connection Alias': route['Make Connection Alias'], 'Send Routing Status': `${cloudMode ? 'CLOUD_API' : 'WHATSAPP_BUSINESS_MANUAL'}:FOLLOW_UP_AUTOMATION`,
      'Business Unit': application['Business Unit'] || lead['Business Unit'], 'Customer ID': application['Customer ID'] || lead['Customer ID'], 'Team ID': application['Team ID'] || lead['Team ID'] || route['Team ID'],
      'Automation Key': automationKey, 'Follow Up Rule': evaluation.ruleId, 'Follow Up Attempt': String(evaluation.nextAttempt)
    });
    if (sendStatus === 'FAILED') {
      await updateRow(token, 'Applications', applicationHeaders, application.rowNumber, { 'Follow Up Status': 'DELIVERY_FAILED', 'Follow Up Rule': evaluation.ruleId, 'Follow Up Pause Reason': sendError, 'Next Follow Up At': new Date(now.valueOf() + 3600000).toISOString(), 'Follow Up Scheduled At': sentAt, 'Updated At': sentAt, 'Updated By': 'FOLLOW_UP_AUTOMATION' });
      await recordActivity(application, 'FOLLOW_UP_DELIVERY_FAILED', `${evaluation.ruleId} attempt ${evaluation.nextAttempt}: ${sendError}`);
      results.push({ applicationId: id, failed: sendError, outboxId });
      continue;
    }
    const handedOver = evaluation.nextAttempt >= evaluation.rule.maxAttempts;
    const nextAt = handedOver ? '' : nextFollowUpAfterSend({ sentAt: now, rule: evaluation.rule, attempts: evaluation.nextAttempt, global: settings.global });
    const changes = {
      'Follow Up Status': handedOver ? 'HANDED_OVER' : 'ACTIVE', 'Follow Up Rule': evaluation.ruleId, 'Follow Up Attempts': String(evaluation.nextAttempt),
      'Last Follow Up At': sentAt, 'Next Follow Up At': nextAt, 'Follow Up Scheduled At': nextAt ? sentAt : '', 'Follow Up Paused At': '', 'Follow Up Pause Reason': handedOver ? 'Maximum automatic follow-up attempts reached' : '',
      'Updated At': sentAt, 'Updated By': 'FOLLOW_UP_AUTOMATION',
      ...(handedOver ? { 'Processing Mode': 'AI_TO_SA_HANDOVER', 'Application Status': 'MANUAL_REVIEW', 'SA Review Required': 'TRUE', 'Handover Reason': 'Customer did not complete documents or information after three automatic follow-ups' } : {})
    };
    await updateRow(token, 'Applications', applicationHeaders, application.rowNumber, changes);
    if (lead.rowNumber) await updateRow(token, 'Leads', leadHeaders, lead.rowNumber, { 'Follow Up Status': changes['Follow Up Status'], 'Follow Up Rule': evaluation.ruleId, 'Follow Up Attempts': changes['Follow Up Attempts'], 'Last Follow Up At': sentAt, 'Next Follow Up At': nextAt, 'Follow Up Scheduled At': changes['Follow Up Scheduled At'], 'Updated At': sentAt, 'Updated By': 'FOLLOW_UP_AUTOMATION' });
    await recordActivity(application, handedOver ? 'FOLLOW_UP_HANDED_TO_STAFF' : 'FOLLOW_UP_SENT', `${evaluation.ruleId} attempt ${evaluation.nextAttempt} ${cloudMode ? 'sent through WhatsApp Cloud API' : 'queued for manual WhatsApp delivery'}`);
    results.push({ applicationId: id, outboxId, attempt: evaluation.nextAttempt, ruleId: evaluation.ruleId, status: sendStatus, sent: cloudMode, queued: !cloudMode, handedOver, nextFollowUpAt: nextAt });
  }
  const summary = {
    due: results.length,
    sent: results.filter(result => result.sent).length,
    queued: results.filter(result => result.queued).length,
    blocked: results.filter(result => result.blocked || result.failed).length,
    handedOver: results.filter(result => result.handedOver).length
  };
  if (!dryRun) await recordActivity({}, 'FOLLOW_UP_RUN_COMPLETED', `Checked ${applications.length} applications; ${summary.due} due, ${summary.sent} sent, ${summary.queued} queued, ${summary.blocked} blocked and ${summary.handedOver} handed over`);
  return { checked: applications.length, completedAt: now.toISOString(), summary, results };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const expected = clean(process.env.CRON_SECRET || process.env.FOLLOW_UP_DISPATCH_SECRET);
  const supplied = clean(req.headers.authorization).replace(/^Bearer\s+/i, '') || clean(req.headers['x-jomkaki-follow-up-secret']);
  if (!expected || !safeEqual(supplied, expected)) return res.status(401).json({ ok: false, error: 'Unauthorized follow-up dispatcher' });
  try {
    const result = await runFollowUpDispatch(req, { applicationId: clean(req.query?.applicationId || req.body?.applicationId), dryRun: truth(req.query?.dryRun || req.body?.dryRun) });
    return res.status(200).json({ ok: true, ...result });
  } catch (error) {
    console.error('Follow-up dispatcher error:', clean(error?.message));
    return res.status(500).json({ ok: false, error: clean(error?.message) || 'Unable to run follow-up dispatcher' });
  }
}
