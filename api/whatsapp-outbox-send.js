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
  const [headers = []] = await readSheet(token, 'Message_Outbox!A1:Z1');
  const data = Object.entries(changes).filter(([header]) => headers.includes(header)).map(([header, value]) => ({ range: `Message_Outbox!${columnName(headers.indexOf(header))}${rowNumber}`, values: [[value ?? '']] }));
  if (!data.length) return;
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values:batchUpdate`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data }) });
  if (!response.ok) throw new Error('Unable to update Message_Outbox');
}

function readSecret(req) {
  const bearer = clean(req.headers.authorization).replace(/^Bearer\s+/i, '');
  return bearer || clean(req.headers['x-jomkaki-dispatch-secret']);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const expectedSecret = clean(process.env.WHATSAPP_DISPATCH_SECRET);
  if (!expectedSecret || !safeEqual(readSecret(req), expectedSecret)) return res.status(401).json({ ok: false, error: 'Unauthorized dispatcher' });
  try {
    const token = await getAccessToken(req);
    if (!token) throw new Error('Google authorization unavailable');
    const outboxId = clean(req.body?.outboxId || req.body?.['Outbox ID']);
    if (!outboxId) return res.status(400).json({ ok: false, error: 'Outbox ID is required' });
    const outbox = objects(await readSheet(token, 'Message_Outbox!A1:Z1500')).find(row => clean(row['Outbox ID']) === outboxId);
    if (!outbox) return res.status(404).json({ ok: false, error: 'Outbox message was not found' });
    const existingProviderId = clean(outbox['Provider Message ID']);
    const existingStatus = clean(outbox['Send Status']).toUpperCase();
    if (existingProviderId || ['SENT', 'DELIVERED', 'READ'].includes(existingStatus)) return res.status(200).json({ ok: true, idempotent: true, outboxId, status: existingStatus, providerMessageId: existingProviderId });
    const channels = objects(await readSheet(token, 'WhatsApp_Number_Master!A1:Z1000'));
    const route = channels.find(row => clean(row['Internal Channel ID']) === clean(outbox['Internal Channel ID'])) || {};
    const binding = validateRoute(outbox, route);
    const accessToken = clean(process.env[`${binding.credentialKey}_ACCESS_TOKEN`]);
    if (!accessToken) throw new Error(`BLOCKED: Protected credential ${binding.credentialKey}_ACCESS_TOKEN is not configured`);
    const attemptCount = Number(outbox['Attempt Count'] || 0) + 1;
    const version = clean(process.env.WHATSAPP_GRAPH_VERSION || 'v23.0');
    const response = await fetch(`https://graph.facebook.com/${version}/${binding.phoneNumberId}/messages`, { method: 'POST', headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' }, body: JSON.stringify(buildMetaPayload(outbox)) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = clean(result.error?.message) || `Meta API error ${response.status}`;
      await updateOutbox(token, outbox.rowNumber, { 'Send Status': 'FAILED', 'Attempt Count': String(attemptCount), 'Error Message': message, 'Send Routing Status': `BLOCKED_OR_FAILED:${binding.channelId}` });
      return res.status(502).json({ ok: false, outboxId, channelId: binding.channelId, error: message });
    }
    const providerMessageId = clean(result.messages?.[0]?.id);
    const timestamp = new Date().toISOString();
    await updateOutbox(token, outbox.rowNumber, { 'Send Status': 'SENT', 'Attempt Count': String(attemptCount), 'Sent At': timestamp, 'Provider Message ID': providerMessageId, 'Error Message': '', 'WhatsApp Number ID': binding.phoneNumberId, 'Send Routing Status': `VERCEL_CHANNEL_DISPATCH:${binding.channelId}` });
    return res.status(200).json({ ok: true, outboxId, channelId: binding.channelId, status: 'SENT', providerMessageId });
  } catch (error) {
    const message = clean(error?.message) || 'Unable to dispatch WhatsApp message';
    console.error('WhatsApp dispatcher error:', message);
    return res.status(message.startsWith('BLOCKED:') ? 409 : 500).json({ ok: false, error: message });
  }
}
