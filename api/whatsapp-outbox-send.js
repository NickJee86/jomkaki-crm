import crypto from 'node:crypto';
import { getAccessToken } from './_auth.js';

const SHEET_ID = process.env.JOMKAKI_SPREADSHEET_ID;
const clean = value => String(value ?? '').trim();
const truth = value => clean(value).toUpperCase() === 'TRUE';
const digits = value => clean(value).replace(/\D/g, '').replace(/^0/, '60');
const columnName = index => {
  let name = '';
  for (let value = index + 1; value; value = Math.floor((value - 1) / 26)) name = String.fromCharCode(65 + ((value - 1) % 26)) + name;
  return name;
};
const credentialPrefix = value => clean(value).toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
const safeEqual = (left, right) => {
  const a = Buffer.from(clean(left));
  const b = Buffer.from(clean(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

export function buildMetaPayload(row = {}) {
  const to = digits(row['Phone Number']);
  const messageType = clean(row['Message Type'] || 'TEXT').toUpperCase();
  if (!to) throw new Error('Outbox phone number is missing');
  if (messageType === 'TEMPLATE') {
    const name = clean(row['Template Name']);
    if (!name) throw new Error('Approved Meta template name is missing');
    return { messaging_product: 'whatsapp', to, type: 'template', template: { name, language: { code: clean(row.Language || 'en_US') } } };
  }
  const body = clean(row['Message Text']);
  const mediaId = clean(row['Media ID']);
  if (clean(row['Template Name']).toUpperCase() === 'JKM_CREDIT_CONSENT_REQUEST') {
    const documentUrl = clean(row['Document URL']) || clean(body.match(/https:\/\/\S+?\.pdf(?:\?\S*)?/i)?.[0]);
    if (!/^https:\/\//i.test(documentUrl)) throw new Error('Consent document URL must use HTTPS');
    return {
      messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'document',
      document: { link: documentUrl, filename: 'JomKaki Rider CTOS CCRIS Consent Form.pdf', caption: body.slice(0, 1024) }
    };
  }
  const imageUrl = clean(row['Image URL']);
  const imageMessage = Boolean(imageUrl) || ['IMAGE', 'MOTOR_IMAGE', 'HANDPHONE_IMAGE', 'PRODUCT_IMAGE', 'SESSION_IMAGE'].includes(messageType);
  if (imageMessage) {
    if (!mediaId && !/^https:\/\//i.test(imageUrl)) throw new Error('Outbox image needs a Meta media ID or HTTPS URL');
    const caption = clean(row['Image Caption'] || row['Image Caption (MS)'] || row['Message Text']).slice(0, 1024);
    return {
      messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'image',
      image: { ...(mediaId ? { id: mediaId } : { link: imageUrl }), ...(caption ? { caption } : {}) }
    };
  }
  if (messageType === 'DOCUMENT') {
    if (!mediaId) throw new Error('Outbox document needs a Meta media ID');
    return {
      messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'document',
      document: { id: mediaId, filename: clean(row['Media File Name']) || 'document.pdf', ...(body ? { caption: body.slice(0, 1024) } : {}) }
    };
  }
  if (!body) throw new Error('Outbox message text is missing');
  return { messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { preview_url: false, body } };
}

export function validateRoute(row = {}, route = {}) {
  const channelId = clean(row['Internal Channel ID']);
  if (!channelId) throw new Error('BLOCKED: Outbox has no Internal Channel ID');
  if (channelId !== clean(route['Internal Channel ID'])) throw new Error('BLOCKED: Official WhatsApp channel is not registered');
  if (!truth(route.Active) || !truth(route['Outbound Enabled'])) throw new Error(`BLOCKED: ${channelId} is disabled for outbound messages`);
  const rowNumberId = clean(row['WhatsApp Number ID']);
  const routeNumberId = clean(route['Phone Number ID']);
  if (!routeNumberId) throw new Error(`BLOCKED: ${channelId} has no Meta Phone Number ID`);
  if (rowNumberId && rowNumberId !== routeNumberId) throw new Error(`BLOCKED: ${channelId} does not match the customer's original WhatsApp number`);
  return { channelId, phoneNumberId: routeNumberId, credentialKey: credentialPrefix(route['Credential Key'] || channelId) };
}

async function readSheet(token, range) {
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}`, { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Unable to read ${range}`);
  return (await response.json()).values || [];
}

const objects = rows => {
  const [headers = [], ...values] = rows;
  return values.map((row, index) => ({ rowNumber: index + 2, ...Object.fromEntries(headers.map((header, column) => [header, row[column] ?? ''])) })).filter(row => Object.values(row).some(Boolean));
};

async function updateOutbox(token, rowNumber, changes) {
  const [headers = []] = await readSheet(token, 'Message_Outbox!A1:AJ1');
  const data = Object.entries(changes).filter(([header]) => headers.includes(header)).map(([header, value]) => ({ range: `Message_Outbox!${columnName(headers.indexOf(header))}${rowNumber}`, values: [[value ?? '']] }));
  if (!data.length) return;
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values:batchUpdate`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data }) });
  if (!response.ok) throw new Error('Unable to update Message_Outbox');
}

async function updateApplication(token, applicationId, changes) {
  if (!clean(applicationId)) return;
  const rows = await readSheet(token, 'Applications!A1:CZ2000');
  const headers = rows[0] || [], idIndex = headers.indexOf('Application ID');
  const rowIndex = rows.findIndex((row, index) => index > 0 && clean(row[idIndex]) === clean(applicationId));
  if (rowIndex < 1) return;
  const data = Object.entries(changes).filter(([header]) => headers.includes(header)).map(([header, value]) => ({ range: `Applications!${columnName(headers.indexOf(header))}${rowIndex + 1}`, values: [[value ?? '']] }));
  if (!data.length) return;
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values:batchUpdate`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data }) });
  if (!response.ok) throw new Error('Unable to update consent delivery status');
}

function readSecret(req) {
  const bearer = clean(req.headers.authorization).replace(/^Bearer\s+/i, '');
  return bearer || clean(req.headers['x-jomkaki-dispatch-secret']);
}

async function dispatchRecord(token, outbox, channels) {
  const outboxId = clean(outbox['Outbox ID']), existingProviderId = clean(outbox['Provider Message ID']), existingStatus = clean(outbox['Send Status']).toUpperCase();
  if (existingProviderId || ['SENT', 'DELIVERED', 'READ'].includes(existingStatus)) return { ok: true, idempotent: true, outboxId, status: existingStatus, providerMessageId: existingProviderId };
  if (existingStatus === 'SENDING') return { ok: false, outboxId, locked: true, error: 'Message is already being sent. Do not resend it.' };
  let attemptCount = Number(outbox['Attempt Count'] || 0) + 1, channelId = clean(outbox['Internal Channel ID']);
  try {
    const route = channels.find(row => clean(row['Internal Channel ID']) === channelId) || {};
    const binding = validateRoute(outbox, route);channelId = binding.channelId;
    const accessToken = clean(process.env[`${binding.credentialKey}_ACCESS_TOKEN`]);
    if (!accessToken) throw new Error(`BLOCKED: Protected credential ${binding.credentialKey}_ACCESS_TOKEN is not configured`);
    const version = clean(process.env.WHATSAPP_GRAPH_VERSION || 'v25.0');
    await updateOutbox(token, outbox.rowNumber, { 'Send Status': 'SENDING', 'Attempt Count': String(attemptCount), 'Error Message': '', 'Send Routing Status': `VERCEL_CHANNEL_SENDING:${binding.channelId}` });
    const response = await fetch(`https://graph.facebook.com/${version}/${binding.phoneNumberId}/messages`, { method: 'POST', headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' }, body: JSON.stringify(buildMetaPayload(outbox)) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(clean(result.error?.message) || `Meta API error ${response.status}`);
    const providerMessageId = clean(result.messages?.[0]?.id), timestamp = new Date().toISOString();
    await updateOutbox(token, outbox.rowNumber, { 'Send Status': 'SENT', 'Attempt Count': String(attemptCount), 'Sent At': timestamp, 'Provider Message ID': providerMessageId, 'Error Message': '', 'WhatsApp Number ID': binding.phoneNumberId, 'Send Routing Status': `VERCEL_CHANNEL_DISPATCH:${binding.channelId}` });
    if (clean(outbox['Template Name']).toUpperCase() === 'JKM_CREDIT_CONSENT_REQUEST') await updateApplication(token, outbox['Application ID'], { 'Updated At': timestamp, 'Current Stage': 'CONSENT_AND_DOCUMENTS_IN_PROGRESS', 'Credit Consent Status': 'SENT', 'Credit Consent Sent At': timestamp, 'Credit Check Status': 'BLOCKED_CONSENT_REQUIRED', 'Updated By': 'WHATSAPP_OUTBOX_DISPATCHER' });
    return { ok: true, outboxId, channelId: binding.channelId, status: 'SENT', providerMessageId };
  } catch (error) {
    const message = clean(error?.message) || 'Unable to dispatch WhatsApp message';
    await updateOutbox(token, outbox.rowNumber, { 'Send Status': 'FAILED', 'Attempt Count': String(attemptCount), 'Error Message': message, 'Send Routing Status': `BLOCKED_OR_FAILED:${channelId || 'UNASSIGNED'}` }).catch(() => {});
    return { ok: false, outboxId, channelId, error: message };
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const supplied = readSecret(req), dispatchSecret = clean(process.env.WHATSAPP_DISPATCH_SECRET), cronSecret = clean(process.env.CRON_SECRET);
  const authorized = (dispatchSecret && safeEqual(supplied, dispatchSecret)) || (cronSecret && safeEqual(supplied, cronSecret));
  if (!authorized) return res.status(401).json({ ok: false, error: 'Unauthorized dispatcher' });
  try {
    const token = await getAccessToken(req);
    if (!token) throw new Error('Google authorization unavailable');
    const outboxId = clean(req.body?.outboxId || req.body?.['Outbox ID'] || req.query?.outboxId);
    const rows = objects(await readSheet(token, 'Message_Outbox!A1:AJ1500'));
    const targets = outboxId ? rows.filter(row => clean(row['Outbox ID']) === outboxId) : rows.filter(row => clean(row['Send Status']).toUpperCase() === 'PENDING').slice(0, 20);
    if (outboxId && !targets.length) return res.status(404).json({ ok: false, error: 'Outbox message was not found' });
    const channels = objects(await readSheet(token, 'WhatsApp_Number_Master!A1:AC1000'));
    const results = [];
    for (const target of targets) results.push(await dispatchRecord(token, target, channels));
    const failed = results.filter(result => !result.ok);
    return res.status(failed.length ? 207 : 200).json({ ok: failed.length === 0, scanned: targets.length, sent: results.filter(result => result.ok && !result.idempotent).length, failed: failed.length, results });
  } catch (error) {
    const message = clean(error?.message) || 'Unable to dispatch WhatsApp message';
    console.error('WhatsApp dispatcher error:', message);
    return res.status(message.startsWith('BLOCKED:') ? 409 : 500).json({ ok: false, error: message });
  }
}
