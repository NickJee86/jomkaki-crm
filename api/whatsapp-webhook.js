import crypto from 'node:crypto';
import { getAccessToken } from './_auth.js';

export const config = { api: { bodyParser: false } };

const SHEET_ID = process.env.JOMKAKI_SPREADSHEET_ID;
const clean = value => String(value ?? '').trim();
const digits = value => clean(value).replace(/\D/g, '').replace(/^0/, '60');
const makeId = prefix => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
const requiresManager = text => /(human|agent|manager|supervisor|real person|真人|人工|客服|经理|主管|pegawai|pengurus|ejen|orang sebenar)/i.test(clean(text));
const columnName = index => {
  let name = '';
  for (let value = index + 1; value; value = Math.floor((value - 1) / 26)) name = String.fromCharCode(65 + ((value - 1) % 26)) + name;
  return name;
};

async function rawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
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

async function appendObject(token, sheet, object) {
  const [headers = []] = await readSheet(token, `${sheet}!1:1`);
  const values = headers.map(header => object[header] ?? '');
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(sheet + '!A:A')}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ values: [values] }) });
  if (!response.ok) throw new Error(`Unable to write ${sheet}`);
}

async function ensureHeaders(token, sheet, requiredHeaders) {
  const [headers = []] = await readSheet(token, `${sheet}!1:1`);
  const missing = requiredHeaders.filter(header => !headers.includes(header));
  if (!missing.length) return;
  const start = columnName(headers.length), end = columnName(headers.length + missing.length - 1);
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(`${sheet}!${start}1:${end}1`)}?valueInputOption=USER_ENTERED`, { method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ values: [missing] }) });
  if (!response.ok) throw new Error(`Unable to extend ${sheet} headers`);
}

async function updateObject(token, sheet, idHeader, id, changes, maxColumn = 'Z') {
  const rows = await readSheet(token, `${sheet}!A1:${maxColumn}2000`), headers = rows[0] || [], idIndex = headers.indexOf(idHeader);
  const rowIndex = rows.findIndex((row, index) => index > 0 && clean(row[idIndex]) === clean(id));
  if (rowIndex < 1) return;
  const data = Object.entries(changes).filter(([header]) => headers.includes(header)).map(([header, value]) => ({ range: `${sheet}!${columnName(headers.indexOf(header))}${rowIndex + 1}`, values: [[value ?? '']] }));
  if (!data.length) return;
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values:batchUpdate`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data }) });
  if (!response.ok) throw new Error(`Unable to update ${sheet}`);
}

const truth = value => clean(value).toUpperCase() === 'TRUE';
const canonicalRegion = value => ['SARAWAK', 'SABAH', 'LABUAN', 'EAST MALAYSIA', 'EAST_MALAYSIA'].includes(clean(value).toUpperCase()) ? 'EAST_MALAYSIA' : clean(value).toUpperCase();
const canonicalBusinessUnit = value => ['MOTOR', 'HANDPHONE'].includes(clean(value).toUpperCase()) ? clean(value).toUpperCase() : '';

async function updateOutboxStatus(token, providerId, status, errorMessage = '') {
  const rows = await readSheet(token, 'Message_Outbox!A1:Z1500');
  const headers = rows[0] || [], providerIndex = headers.indexOf('Provider Message ID');
  const rowIndex = rows.findIndex((row, index) => index > 0 && clean(row[providerIndex]) === clean(providerId));
  if (rowIndex < 1) return;
  const normalizedStatus = clean(status).toUpperCase(), timestamp = new Date().toISOString();
  const changes = { 'Send Status': normalizedStatus, 'Error Message': errorMessage };
  if (normalizedStatus === 'SENT') changes['Sent At'] = timestamp;
  if (normalizedStatus === 'DELIVERED') changes['Delivered At'] = timestamp;
  if (normalizedStatus === 'READ') changes['Read At'] = timestamp;
  const data = Object.entries(changes).filter(([header]) => headers.includes(header)).map(([header, value]) => ({ range: `Message_Outbox!${columnName(headers.indexOf(header))}${rowIndex + 1}`, values: [[value]] }));
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values:batchUpdate`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data }) });
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET') {
    if (clean(req.query['hub.mode']) === 'subscribe' && clean(req.query['hub.verify_token']) === clean(process.env.WHATSAPP_VERIFY_TOKEN)) return res.status(200).send(clean(req.query['hub.challenge']));
    return res.status(403).send('Verification failed');
  }
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  const raw = await rawBody(req), signature = clean(req.headers['x-hub-signature-256']), secret = clean(process.env.META_APP_SECRET);
  if (!secret || !signature) return res.status(401).json({ ok: false });
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`;
  const supplied = Buffer.from(signature), calculated = Buffer.from(expected);
  if (supplied.length !== calculated.length || !crypto.timingSafeEqual(supplied, calculated)) return res.status(401).json({ ok: false });
  try {
    const payload = JSON.parse(raw.toString('utf8') || '{}'), token = await getAccessToken(req);
    if (!token) throw new Error('Google authorization unavailable');
    const leads = objects(await readSheet(token, 'Leads!A1:AP1000'));
    const applications = objects(await readSheet(token, 'Applications!A1:CC1000'));
    const routes = objects(await readSheet(token, 'WhatsApp_Number_Master!A1:AC1000'));
    const branches = objects(await readSheet(token, 'Branch_Master!A1:S1000'));
    const existingMessageIds = new Set(objects(await readSheet(token, 'Customer_Inbox!A1:AC1200')).map(row => clean(row['Message ID'])).filter(Boolean));
    for (const entry of payload.entry || []) for (const change of entry.changes || []) {
      const value = change.value || {}, numberId = value.metadata?.phone_number_id || '', displayNumber = value.metadata?.display_phone_number || '';
      for (const message of value.messages || []) {
        if (message.id && existingMessageIds.has(clean(message.id))) continue;
        const phone = digits(message.from), text = message.text?.body || message.button?.text || message.interactive?.button_reply?.title || message.interactive?.list_reply?.title || `[${message.type || 'message'}]`;
        const route = routes.find(row => clean(row['Phone Number ID']) === clean(numberId)) || {};
        const channelId = clean(route['Internal Channel ID']), branchId = clean(route['Branch ID']);
        const branch = branches.find(row => clean(row['Branch ID']) === branchId) || {};
        const routeRegion = canonicalRegion(route.Region || branch.Region) || 'UNASSIGNED';
        const routeBusinessUnit = canonicalBusinessUnit(route['Business Unit']) || 'UNASSIGNED', teamId = clean(route['Team ID'] || branch['Team ID']);
        const receivedAt = new Date(Number(message.timestamp || Date.now() / 1000) * 1000).toISOString();
        const routeUsable = !!channelId && routeBusinessUnit !== 'UNASSIGNED' && truth(route.Active) && truth(route['Inbound Enabled']);
        let lead = leads.find(row => digits(row['Phone Number']) === phone && clean(row['Business Unit']).toUpperCase() === routeBusinessUnit);
        if (!lead) {
          const timestamp = new Date().toISOString();
          const existingCustomer = leads.find(row => digits(row['Phone Number']) === phone), customerId = clean(existingCustomer?.['Customer ID']) || makeId('CUS');
          lead = { 'Lead ID': makeId('LEAD'), 'Customer ID': customerId, 'Customer Name': existingCustomer?.['Customer Name'] || `WhatsApp Customer ${phone.slice(-4)}`, 'Phone Number': phone, 'Normalized Phone': phone, Region: routeRegion, 'Business Unit': routeBusinessUnit, 'Team ID': teamId, 'Selected Branch ID': branchId, 'Assigned SA ID': '' };
          await ensureHeaders(token, 'Leads', ['Lead Source', 'Created By', 'Updated By']);
          await appendObject(token, 'Leads', { ...lead, 'Created At': timestamp, 'Updated At': timestamp, 'Lead Status': 'NEW', 'Processing Mode': 'AI_MANAGED', 'Lead Source': 'WHATSAPP_CLOUD', 'Source Channel': 'WHATSAPP_CLOUD', 'Primary WhatsApp Channel ID': channelId, 'Last Inbound WhatsApp Channel ID': channelId, 'Last Inbound WhatsApp Number ID': numberId, 'Last Inbound At': receivedAt, Notes: 'AI-managed Lead; Staff remains unassigned unless document collection or follow-up fails', 'Created By': 'META_WEBHOOK', 'Updated By': 'META_WEBHOOK' });
          leads.push(lead);
        } else {
          await ensureHeaders(token, 'Leads', ['Lead Source', 'Created By', 'Updated By']);
          await updateObject(token, 'Leads', 'Lead ID', lead['Lead ID'], { 'Last Inbound WhatsApp Channel ID': channelId, 'Last Inbound WhatsApp Number ID': numberId, 'Last Inbound At': receivedAt, 'Last Customer Reply At': receivedAt, 'Updated At': receivedAt, 'Updated By': 'META_WEBHOOK', 'Business Unit': routeBusinessUnit, 'Team ID': teamId }, 'AP');
        }
        const application = applications.filter(row => row['Lead ID'] && row['Lead ID'] === lead['Lead ID']).at(-1) || {};
        const human = requiresManager(text);
        const routingStatus = !channelId ? 'UNREGISTERED_CHANNEL' : !routeUsable ? 'CHANNEL_DISABLED_ADMIN_REVIEW' : routeRegion === 'UNASSIGNED' ? 'ADMIN_REVIEW_REQUIRED' : 'MATCHED';
        await appendObject(token, 'Customer_Inbox', { 'Received At': receivedAt, 'Phone Number': phone, 'Customer Message': text, 'Attachment Type': ['image', 'document'].includes(message.type) ? message.type : '', 'Message ID': message.id || makeId('MSG'), Channel: 'WHATSAPP', Source: 'META_CLOUD', 'Lead ID': lead['Lead ID'] || '', 'Application ID': application['Application ID'] || '', 'Message Type': message.type || 'text', 'Process Status': !routeUsable || routeRegion === 'UNASSIGNED' ? 'HUMAN_HANDOVER_REQUIRED' : human ? 'HUMAN_HANDOVER_REQUIRED' : 'NEW', 'AI Processed': 'FALSE', 'Webhook ID': makeId('WEBHOOK'), 'WhatsApp Number ID': numberId, 'WhatsApp Display Number': displayNumber || route['Display Number'], 'WABA ID': route['WABA ID'] || entry.id || '', 'Conversation Key': `${channelId || numberId || 'UNROUTED'}:${phone}`, 'Webhook Source': 'META_CLOUD', 'Number Routing Status': routingStatus, 'Internal Channel ID': channelId, 'Business Unit': routeBusinessUnit, 'Customer ID': lead['Customer ID'] || '', 'Team ID': teamId });
        if (channelId) await updateObject(token, 'WhatsApp_Number_Master', 'Internal Channel ID', channelId, { 'Last Inbound At': receivedAt, 'Last Verified At': receivedAt, 'Updated At': receivedAt }, 'AC');
        const media = message.document || message.image;
        if (media?.id) {
          await ensureHeaders(token, 'Document_Log', ['Uploaded By', 'Reviewed By', 'Reviewed At']);
          await appendObject(token, 'Document_Log', {
          'Document ID': makeId('DOC'), 'Application ID': application['Application ID'] || '', 'Lead ID': lead['Lead ID'] || '',
          'Received At': new Date(Number(message.timestamp || Date.now() / 1000) * 1000).toISOString(), 'Message ID': message.id || '',
          'Document Type': 'UNCLASSIFIED', 'Media ID': media.id, 'Mime Type': media.mime_type || '', 'File Name': message.document?.filename || '',
          'Classification Status': 'AI_QUEUED', 'Quality Status': 'PENDING_AI', 'Verification Status': 'PENDING_AI', 'Duplicate Status': 'NOT_CHECKED',
          'Manual Review Required': 'FALSE', Remarks: 'Received from WhatsApp and queued for automatic AI validation', 'Updated At': new Date().toISOString(), 'Uploaded By': 'META_WEBHOOK', 'Business Unit': routeBusinessUnit, 'Customer ID': lead['Customer ID'] || ''
          });
        }
        if (message.id) existingMessageIds.add(clean(message.id));
      }
      for (const status of value.statuses || []) await updateOutboxStatus(token, status.id, status.status, status.errors?.[0]?.title || '');
    }
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ ok: false });
  }
}
