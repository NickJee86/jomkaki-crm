import crypto from 'node:crypto';
import { getAccessToken } from './_auth.js';
import { approvedMonthlyRateFields, JOMKAKI_KNOWLEDGE } from './_jomkaki-knowledge.js';

export const config = { api: { bodyParser: false } };

const SHEET_ID = process.env.JOMKAKI_SPREADSHEET_ID;
const clean = value => String(value ?? '').trim();
const digits = value => clean(value).replace(/\D/g, '').replace(/^0/, '60');
const makeId = prefix => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
const retryableGoogleStatus = new Set([408, 425, 429, 500, 502, 503, 504]);
const retryDelay = attempt => new Promise(resolve => setTimeout(resolve, [0, 80, 200, 450][attempt] ?? 450));
const DOCUMENT_ACK_WINDOW_MS = 120000;
const DEFAULT_MAX_INBOUND_AGE_MS = 10 * 60 * 1000;
const documentBatchAcknowledgements = new Map();
const CONSENT_DISPATCH_RESERVATION_TTL_MS = 5 * 60 * 1000;
const consentDispatchReservations = globalThis.__JOMKAKI_CONSENT_DISPATCH_RESERVATIONS__ ||= new Map();
export const CREDIT_CONSENT_TEMPLATE_URL = 'https://jomkaki-rider.vercel.app/assets/ctos-ccris-consent-bph-v4.pdf';
export const CREDIT_CONSENT_TEMPLATE_VERSION = 'BPH_V4.0_01112020';
const INBOUND_RESERVATION_TTL_MS = 5 * 60 * 1000;
const inboundMessageReservations = globalThis.__JOMKAKI_INBOUND_RESERVATIONS__ ||= new Map();
const sheetReadCache = globalThis.__JOMKAKI_SHEET_READ_CACHE__ ||= new Map();

export function reserveInboundMessage(messageId, now = Date.now()) {
  const id = clean(messageId);
  if (!id) return true;
  for (const [key, reservedAt] of inboundMessageReservations) {
    if (now - reservedAt > INBOUND_RESERVATION_TTL_MS) inboundMessageReservations.delete(key);
  }
  if (inboundMessageReservations.has(id)) return false;
  inboundMessageReservations.set(id, now);
  return true;
}

export function releaseInboundMessage(messageId) {
  const id = clean(messageId);
  if (id) inboundMessageReservations.delete(id);
}

export function shouldDispatchEarlyConsent({ messageType = '', application = {}, routeUsable = true, human = false } = {}) {
  if (!JOMKAKI_KNOWLEDGE.documents.consentDispatchOnFirstApplicationDocument) return false;
  if (!routeUsable || human || !['image', 'document'].includes(clean(messageType).toLowerCase())) return false;
  const status = clean(application['Credit Consent Status']).toUpperCase();
  return !['QUEUED', 'SENT', 'SIGNED_PENDING_VERIFICATION', 'VERIFIED', 'DECLINED', 'WITHDRAWN'].includes(status);
}

export function reserveEarlyConsentDispatch(applicationId, now = Date.now()) {
  const id = clean(applicationId);
  if (!id) return false;
  for (const [key, reservedAt] of consentDispatchReservations) {
    if (now - reservedAt > CONSENT_DISPATCH_RESERVATION_TTL_MS) consentDispatchReservations.delete(key);
  }
  if (consentDispatchReservations.has(id)) return false;
  consentDispatchReservations.set(id, now);
  return true;
}

export function releaseEarlyConsentDispatch(applicationId) {
  const id = clean(applicationId);
  if (id) consentDispatchReservations.delete(id);
}

export function buildEarlyConsentReply(language = 'MS') {
  if (language === 'ZH') return `文件已经收到。在我检查文件的同时，请先填写并签署 CTOS/CCRIS 同意书，然后把清楚的 PDF 或照片发回这个 WhatsApp：${CREDIT_CONSENT_TEMPLATE_URL}。不需要等其他文件齐全；缺少的资料之后可以继续补交。`;
  if (language === 'EN') return `Your document has been received. While I check it, please complete and sign the CTOS/CCRIS consent form, then return a clear PDF or photo in this WhatsApp chat: ${CREDIT_CONSENT_TEMPLATE_URL}. You do not need to wait for every other document; any missing items can be submitted afterwards.`;
  return `Dokumen ini sudah diterima. Sementara saya semak, sila lengkapkan dan tandatangani Borang Kebenaran CTOS/CCRIS ini, kemudian hantar semula PDF atau gambar yang jelas dalam WhatsApp ini: ${CREDIT_CONSENT_TEMPLATE_URL}. Tak perlu tunggu semua dokumen lengkap; dokumen yang masih kurang boleh dihantar kemudian.`;
}

const normalizePhoneField = value => clean(value).replace(/\D/g, '');
const normalizeEmploymentDuration = value => {
  const number = Number((clean(value).match(/\d+/) || [])[0] || 0);
  if (!number) return '';
  return /(?:tahun|year)/i.test(clean(value)) ? String(number * 12) : String(number);
};
const normalizeLoanTenure = (value, unit) => {
  const years = Number((clean(value).match(/[1-5]/) || [])[0] || 0);
  return unit === 'HANDPHONE' ? String(years * 12) : String(years);
};
const APPLICATION_DETAIL_FIELDS = [
  { header: 'Applicant Name', label: 'Nama pemohon', valid: value => clean(value).length >= 2 && !/^WhatsApp Customer\b/i.test(clean(value)), normalize: clean },
  { header: 'Applicant IC Number', label: 'IC pemohon', valid: value => /^\d{12}$/.test(normalizePhoneField(value)), normalize: normalizePhoneField },
  { header: 'Home Address', label: 'Alamat rumah', valid: value => clean(value).length >= 8, normalize: clean },
  { header: 'Phone Number', label: 'Nombor tel pemohon', valid: value => /^\d{9,12}$/.test(normalizePhoneField(value)), normalize: value => digits(value) },
  { header: 'Employer Name', label: 'Nama syarikat / tempat kerja', valid: value => clean(value).length >= 2, normalize: clean },
  { header: 'Employer Address', label: 'Alamat tempat kerja', valid: value => clean(value).length >= 5, normalize: clean },
  { header: 'Employer Phone', label: 'Nombor tel tempat kerja', valid: value => /^\d{9,12}$/.test(normalizePhoneField(value)), normalize: normalizePhoneField },
  { header: 'Employment Duration Months', label: 'Tempoh berkhidmat', valid: value => !!normalizeEmploymentDuration(value), normalize: normalizeEmploymentDuration },
  { header: 'Job Position', label: 'Jawatan', valid: value => clean(value).length >= 2, normalize: clean },
  { header: 'Email', label: 'Email', valid: value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(value)), normalize: value => clean(value).toLowerCase() },
  { header: 'Reference 1 Name', label: 'Nama rujukan 1', valid: value => clean(value).length >= 2, normalize: clean },
  { header: 'Reference 1 Phone', label: 'Nombor tel rujukan 1', valid: value => /^\d{9,12}$/.test(normalizePhoneField(value)), normalize: normalizePhoneField },
  { header: 'Reference 1 Relationship', label: 'Hubungan rujukan 1', valid: value => clean(value).length >= 2, normalize: clean },
  { header: 'Reference 2 Name', label: 'Nama rujukan 2', valid: value => clean(value).length >= 2, normalize: clean },
  { header: 'Reference 2 Phone', label: 'Nombor tel rujukan 2', valid: value => /^\d{9,12}$/.test(normalizePhoneField(value)), normalize: normalizePhoneField },
  { header: 'Reference 2 Relationship', label: 'Hubungan rujukan 2', valid: value => clean(value).length >= 2, normalize: clean },
  { header: 'Product Brand', label: 'Jenama', valid: value => clean(value).length >= 2, normalize: clean },
  { header: 'Product Model', label: 'Model', valid: value => clean(value).length >= 2, normalize: clean },
  { header: 'LOAN_TENURE', label: 'Tempoh loan', valid: (value, unit) => { const years = Number((clean(value).match(/[1-5]/) || [])[0] || 0); return unit === 'HANDPHONE' ? years >= 1 && years <= 5 : years >= 3 && years <= 5; }, normalize: normalizeLoanTenure }
];

const applicationDetailHeader = (field, unit) => field.header === 'LOAN_TENURE' ? (unit === 'HANDPHONE' ? 'Loan Tenure Months' : 'Loan Tenure Years') : field.header;
const APPLICATION_DETAIL_APPLICATION_HEADERS = [...new Set([
  ...APPLICATION_DETAIL_FIELDS.filter(field => field.header !== 'LOAN_TENURE').map(field => field.header),
  'Loan Tenure Years',
  'Loan Tenure Months',
  'Document Status',
  'Minimum Documents Complete',
  'Missing Documents',
  'Missing Application Fields',
  'Verification Pending Documents',
  'Credit Consent Signed At',
  'Bank Account Available'
])];
const applicationDetailValuePresent = (application, field, unit) => field.valid(application[applicationDetailHeader(field, unit)], unit);
const applicationDetailMissing = (application, unit) => APPLICATION_DETAIL_FIELDS.filter(field => !applicationDetailValuePresent(application, field, unit));

export function isApplicationDetailStep(step = '') {
  const value = clean(step).toUpperCase();
  return value === 'APPLICATION_DETAILS_PENDING' || value === 'APPLICATION_FORM_PENDING' || value.startsWith('APP_DETAILS_');
}

export function shouldStartApplicationDetails({ messageType = '', application = {}, currentStep = '', routeUsable = true, human = false } = {}) {
  if (!routeUsable || human || isApplicationDetailStep(currentStep) || clean(currentStep).toUpperCase() === 'APPLICATION_DETAILS_COMPLETE') return false;
  const consentStatus = clean(application['Credit Consent Status']).toUpperCase();
  return ['image', 'document'].includes(clean(messageType).toLowerCase()) && ['QUEUED', 'SENT', 'SIGNED_PENDING_VERIFICATION', 'VERIFIED'].includes(consentStatus);
}

export function applicationDetailSideQuestion(value = '') {
  const text = normalizedWords(value);
  return /\b(apa|berapa|bila|mana|kenapa|macam mana|how|what|when|where|why|cash|deposit|dokumen|document|promo|promosi|harga|ansuran|model)\b/.test(text) || /[?？]/.test(clean(value));
}

const applicationFormValue = (application, header) => clean(application[header]);
const formAnswer = value => applicationFormValue(value.application, value.header) ? `➡️ ${applicationFormValue(value.application, value.header)}` : '➡️';

export function buildApplicationDetailsForm(application = {}, businessUnit = 'MOTOR') {
  const unit = clean(businessUnit).toUpperCase() === 'HANDPHONE' ? 'HANDPHONE' : 'MOTOR';
  const tenureHeader = applicationDetailHeader(APPLICATION_DETAIL_FIELDS.at(-1), unit);
  const productTitle = unit === 'HANDPHONE' ? 'Telefon' : 'Motosikal';
  const current = header => formAnswer({ application, header });
  const duration = applicationFormValue(application, 'Employment Duration Months');
  const durationAnswer = duration ? `➡️ ${duration} bulan` : '➡️';
  const tenure = applicationFormValue(application, tenureHeader);
  const tenureAnswer = tenure ? `➡️ ${unit === 'HANDPHONE' ? Number(tenure) / 12 : tenure} tahun` : '➡️';
  return `━━━━━━━━━━━━━━━━━━━━
*BORANG MAKLUMAT PERMOHONAN*
*JomKaki Rider*
━━━━━━━━━━━━━━━━━━━━

_Sila salin borang ini, isi selepas tanda ➡️ dan hantar semula dalam satu mesej._

*A. MAKLUMAT PEMOHON*

1. Nama pemohon:
${current('Applicant Name')}
2. IC pemohon:
${current('Applicant IC Number')}
3. Alamat Rumah:
${current('Home Address')}
4. Nombor tel pemohon:
${current('Phone Number')}
5. Email:
${current('Email')}

*B. MAKLUMAT PEKERJAAN*

6. Nama Syarikat / Tempat Kerja:
${current('Employer Name')}
7. Alamat tempat kerja:
${current('Employer Address')}
8. Nombor tel tempat kerja:
${current('Employer Phone')}
9. Berapa lama sudah berkhidmat:
${durationAnswer}
10. Jawatan:
${current('Job Position')}

*C. RUJUKAN KELUARGA TERDEKAT*

_Rujukan mestilah ibu bapa, adik-beradik, suami/isteri atau anak._

11. Rujukan 1
➡️ Nama : ${applicationFormValue(application, 'Reference 1 Name')}
➡️ Hp : ${applicationFormValue(application, 'Reference 1 Phone')}
➡️ Hubungan : ${applicationFormValue(application, 'Reference 1 Relationship')}

12. Rujukan 2
➡️ Nama : ${applicationFormValue(application, 'Reference 2 Name')}
➡️ Hp : ${applicationFormValue(application, 'Reference 2 Phone')}
➡️ Hubungan : ${applicationFormValue(application, 'Reference 2 Relationship')}

*D. PILIHAN ${unit === 'HANDPHONE' ? 'TELEFON' : 'MOTOSIKAL'}*

13. ${productTitle}
➡️ Jenama: ${applicationFormValue(application, 'Product Brand')}
➡️ Model: ${applicationFormValue(application, 'Product Model')}
➡️ Loan berapa tahun: ${tenureAnswer.replace(/^➡️\s*/, '')}

━━━━━━━━━━━━━━━━━━━━
_Semak semua maklumat sebelum hantar._`;
}

const applicationFormLabel = line => {
  const value = clean(line).replace(/^[*_]+|[*_]+$/g, '').replace(/^\d+\.\s*/, '').replace(/^[➡➜→]\ufe0f?\s*/, '').trim();
  if (/^nama pemohon\b/i.test(value)) return { header: 'Applicant Name', inline: value.replace(/^nama pemohon\s*:?\s*/i, '') };
  if (/^ic pemohon\b/i.test(value)) return { header: 'Applicant IC Number', inline: value.replace(/^ic pemohon\s*:?\s*/i, '') };
  if (/^alamat rumah\b/i.test(value)) return { header: 'Home Address', inline: value.replace(/^alamat rumah\s*:?\s*/i, '') };
  if (/^nombor tel pemohon\b/i.test(value)) return { header: 'Phone Number', inline: value.replace(/^nombor tel pemohon\s*:?\s*/i, '') };
  if (/^nama syarikat\s*\/?.*tempat kerja\b/i.test(value)) return { header: 'Employer Name', inline: value.replace(/^nama syarikat\s*\/?\s*tempat kerja\s*:?\s*/i, '') };
  if (/^alamat tempat kerja\b/i.test(value)) return { header: 'Employer Address', inline: value.replace(/^alamat tempat kerja\s*:?\s*/i, '') };
  if (/^nombor tel tempat kerja\b/i.test(value)) return { header: 'Employer Phone', inline: value.replace(/^nombor tel tempat kerja\s*:?\s*/i, '') };
  if (/^berapa lama sudah berkhidmat\b/i.test(value)) return { header: 'Employment Duration Months', inline: value.replace(/^berapa lama sudah berkhidmat\s*:?\s*/i, '') };
  if (/^jawatan\b/i.test(value)) return { header: 'Job Position', inline: value.replace(/^jawatan\s*:?\s*/i, '') };
  if (/^(?:e-?mail)\b/i.test(value)) return { header: 'Email', inline: value.replace(/^e-?mail\s*:?\s*/i, '') };
  if (/^jenama\b/i.test(value)) return { header: 'Product Brand', inline: value.replace(/^jenama\s*:?\s*/i, '') };
  if (/^model\b/i.test(value)) return { header: 'Product Model', inline: value.replace(/^model\s*:?\s*/i, '') };
  if (/^loan berapa tahun\b/i.test(value)) return { header: 'LOAN_TENURE', inline: value.replace(/^loan berapa tahun\s*:?\s*/i, '') };
  return null;
};

export function parseApplicationDetailsForm(text = '', businessUnit = 'MOTOR') {
  const unit = clean(businessUnit).toUpperCase() === 'HANDPHONE' ? 'HANDPHONE' : 'MOTOR';
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const raw = {};
  let pendingHeader = '', reference = 0, recognized = 0;
  const save = (header, value) => {
    const answer = clean(value).replace(/^[➡➜→]\ufe0f?\s*/, '').trim();
    if (!answer) return false;
    raw[header] = answer;
    pendingHeader = '';
    return true;
  };
  for (const original of lines) {
    const line = clean(original);
    if (!line || /^TOLONG ISI MAKLUMAT/i.test(line) || /^[•.━─-]{8,}$/.test(line) || /^\*?[A-D]\.\s+.*\*?$/i.test(line) || /^_.*_$/i.test(line) || /^\*?BORANG MAKLUMAT PERMOHONAN\*?$/i.test(line) || /^\*?JomKaki Rider\*?$/i.test(line)) continue;
    const structuralLine = line.replace(/^[*_]+|[*_]+$/g, '').trim();
    if (/^\d+\.\s*(?:Nama\s*&\s*Tel\s+)?rujukan 1\b/i.test(structuralLine)) { reference = 1; pendingHeader = ''; recognized += 1; continue; }
    if (/^\d+\.\s*(?:Nama\s*&\s*Tel\s+)?rujukan 2\b/i.test(structuralLine)) { reference = 2; pendingHeader = ''; recognized += 1; continue; }
    if (/^\d+\.\s*(?:Motosikal|Telefon)\b/i.test(structuralLine)) { reference = 0; pendingHeader = ''; recognized += 1; continue; }
    const stripped = line.replace(/^[➡➜→]\ufe0f?\s*/, '').trim();
    if (reference && /^(?:nama|hp|hubungan)\s*:/i.test(stripped)) {
      const part = stripped.match(/^(nama|hp|hubungan)\s*:\s*(.*)$/i);
      const suffix = part[1].toLowerCase() === 'nama' ? 'Name' : part[1].toLowerCase() === 'hp' ? 'Phone' : 'Relationship';
      const header = `Reference ${reference} ${suffix}`;
      recognized += 1;
      pendingHeader = header;
      save(header, part[2]);
      continue;
    }
    const label = applicationFormLabel(line);
    if (label) {
      reference = 0;
      recognized += 1;
      pendingHeader = label.header;
      save(label.header, label.inline);
      continue;
    }
    if (pendingHeader && !/^[➡➜→]\ufe0f?$/.test(line)) save(pendingHeader, line);
  }
  const changes = {}, invalidFields = [];
  for (const field of APPLICATION_DETAIL_FIELDS) {
    if (!(field.header in raw)) continue;
    if (!field.valid(raw[field.header], unit)) invalidFields.push(field.label);
    else changes[applicationDetailHeader(field, unit)] = field.normalize(raw[field.header], unit);
  }
  return { changes, invalidFields, recognizedFields: recognized, isFormResponse: recognized >= 4 || (/(?:TOLONG ISI MAKLUMAT|BORANG MAKLUMAT PERMOHONAN)/i.test(clean(text)) && recognized >= 1) };
}

export function isApplicationDetailsFormResponse(text = '', businessUnit = 'MOTOR') {
  return parseApplicationDetailsForm(text, businessUnit).isFormResponse;
}

export function buildApplicationDetailsTurn({ currentStep = '', text = '', application = {}, businessUnit = 'MOTOR', start = false } = {}) {
  const unit = clean(businessUnit).toUpperCase() === 'HANDPHONE' ? 'HANDPHONE' : 'MOTOR';
  const missing = applicationDetailMissing(application, unit);
  if (!missing.length) return { handled: true, nextStep: 'APPLICATION_DETAILS_COMPLETE', text: 'Terima kasih. Maklumat permohonan anda sudah lengkap. Dokumen yang masih kurang boleh dihantar kemudian di sini.', changes: {}, missingFields: [] };
  const parsed = start ? null : parseApplicationDetailsForm(text, unit);
  if (start || !parsed?.isFormResponse) {
    return {
      handled: true,
      nextStep: 'APPLICATION_FORM_PENDING',
      text: `${start ? 'Dokumen sudah diterima. Sementara semakan dibuat, sila salin borang di bawah, isi semua maklumat dan hantar semula dalam satu mesej.' : 'Untuk elak banyak soalan berasingan, sila salin borang di bawah, lengkapkan semua ruang dan hantar semula dalam satu mesej.'}\n\n${buildApplicationDetailsForm(application, unit)}`,
      changes: {},
      missingFields: missing.map(field => applicationDetailHeader(field, unit))
    };
  }
  const projected = { ...application, ...parsed.changes };
  const nextMissing = applicationDetailMissing(projected, unit);
  if (nextMissing.length || parsed.invalidFields.length) {
    const invalid = parsed.invalidFields.length ? ` Maklumat yang perlu disemak: ${parsed.invalidFields.join(', ')}.` : '';
    return {
      handled: true,
      nextStep: 'APPLICATION_FORM_PENDING',
      text: `Terima kasih, maklumat yang telah diisi sudah disimpan.${invalid} Sila lengkapkan ruang yang masih kosong dalam borang yang sama dan hantar semula sekali sahaja.\n\n${buildApplicationDetailsForm(projected, unit)}`,
      changes: parsed.changes,
      missingFields: nextMissing.map(field => applicationDetailHeader(field, unit))
    };
  }
  return { handled: true, nextStep: 'APPLICATION_DETAILS_COMPLETE', text: 'Terima kasih. Semua maklumat permohonan sudah diterima dan disimpan. Dokumen yang masih kurang boleh dihantar kemudian di sini. Selepas dokumen dan borang kebenaran disahkan, permohonan akan disediakan untuk LMS.', changes: parsed.changes, missingFields: [] };
}

function sheetCacheTtl(range) {
  if (/!1:1$/.test(range)) return 5 * 60 * 1000;
  if (/^(?:WhatsApp_Number_Master|Branch_Master|Motor_Model_Catalog|Motor_Loan_Pricing|Handphone_Model_Catalog|Handphone_Loan_Pricing)!/.test(range)) return 30 * 1000;
  if (/^Conversation_State!A(?::AK|1:AK\d+)$/.test(range)) return 1500;
  return 0;
}

function invalidateSheetDataCache(sheet, includeHeaders = false) {
  const prefix = `${sheet}!`;
  for (const key of sheetReadCache.keys()) {
    if (key.startsWith(prefix) && (includeHeaders || !key.endsWith('!1:1'))) sheetReadCache.delete(key);
  }
}
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

async function googleRequest(url, options = {}, label = 'Google Sheets request', maxAttempts = 4) {
  let lastError;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (attempt) await retryDelay(attempt);
    try {
      const response = await fetch(url, options);
      if (response.ok) return response;
      const detail = clean(await response.text()).slice(0, 240);
      lastError = new Error(`${label} failed (${response.status})${detail ? `: ${detail}` : ''}`);
      if (!retryableGoogleStatus.has(response.status)) throw lastError;
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts - 1 || /failed \((?:400|401|403|404)\)/.test(clean(error?.message))) throw error;
    }
  }
  throw lastError || new Error(`${label} failed`);
}

async function readSheet(token, range) {
  const ttl = sheetCacheTtl(range);
  const cached = ttl ? sheetReadCache.get(range) : null;
  if (cached && Date.now() - cached.at < ttl) return cached.rows.map(row => [...row]);
  const response = await googleRequest(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}`, { headers: { authorization: `Bearer ${token}` } }, `Unable to read ${range}`);
  const rows = (await response.json()).values || [];
  if (ttl) sheetReadCache.set(range, { at: Date.now(), rows });
  return rows.map(row => [...row]);
}

const objects = rows => {
  const [headers = [], ...values] = rows;
  return values.map((row, index) => ({ rowNumber: index + 2, ...Object.fromEntries(headers.map((header, column) => [header, row[column] ?? ''])) })).filter(row => Object.values(row).some(Boolean));
};

async function appendObject(token, sheet, object) {
  const [headers = []] = await readSheet(token, `${sheet}!1:1`);
  const values = headers.map(header => object[header] ?? '');
  await googleRequest(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(sheet + '!A:A')}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ values: [values] }) }, `Unable to write ${sheet}`, 1);
  invalidateSheetDataCache(sheet);
}

async function ensureSheetColumnCapacity(token, sheet, requiredColumnCount) {
  const metadataResponse = await googleRequest(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}?fields=sheets.properties(sheetId,title,gridProperties(columnCount))`,
    { headers: { authorization: `Bearer ${token}` } },
    `Unable to inspect ${sheet} grid`
  );
  const metadata = await metadataResponse.json();
  const properties = (metadata.sheets || []).map(item => item.properties || {}).find(item => item.title === sheet);
  if (!properties) throw new Error(`${sheet} worksheet was not found`);
  const currentColumnCount = Number(properties.gridProperties?.columnCount || 0);
  if (requiredColumnCount <= currentColumnCount) return;
  await googleRequest(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}:batchUpdate`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ requests: [{ appendDimension: { sheetId: properties.sheetId, dimension: 'COLUMNS', length: requiredColumnCount - currentColumnCount } }] })
    },
    `Unable to expand ${sheet} grid`
  );
}

async function ensureHeaders(token, sheet, requiredHeaders) {
  const [headers = []] = await readSheet(token, `${sheet}!1:1`);
  const missing = requiredHeaders.filter(header => !headers.includes(header));
  if (!missing.length) return;
  await ensureSheetColumnCapacity(token, sheet, headers.length + missing.length);
  const start = columnName(headers.length), end = columnName(headers.length + missing.length - 1);
  await googleRequest(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(`${sheet}!${start}1:${end}1`)}?valueInputOption=USER_ENTERED`, { method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ values: [missing] }) }, `Unable to extend ${sheet} headers`);
  invalidateSheetDataCache(sheet, true);
}

async function updateObject(token, sheet, idHeader, id, changes, maxColumn = 'Z') {
  const rows = await readSheet(token, `${sheet}!A:${maxColumn}`), headers = rows[0] || [], idIndex = headers.indexOf(idHeader);
  const rowIndex = rows.findIndex((row, index) => index > 0 && clean(row[idIndex]) === clean(id));
  if (rowIndex < 1) return;
  const data = Object.entries(changes).filter(([header]) => headers.includes(header)).map(([header, value]) => ({ range: `${sheet}!${columnName(headers.indexOf(header))}${rowIndex + 1}`, values: [[value ?? '']] }));
  if (!data.length) return;
  await googleRequest(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values:batchUpdate`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data }) }, `Unable to update ${sheet}`);
  invalidateSheetDataCache(sheet);
}

async function bindDocumentsToApplication(token, documents = [], applicationId = '') {
  const pending = documents.filter(row => clean(row['Lead ID']) && !clean(row['Application ID']) && row.rowNumber);
  if (!pending.length || !clean(applicationId)) return;
  const [headers = []] = await readSheet(token, 'Document_Log!1:1');
  const applicationColumn = headers.indexOf('Application ID');
  if (applicationColumn < 0) return;
  const data = pending.map(row => ({ range: `Document_Log!${columnName(applicationColumn)}${row.rowNumber}`, values: [[applicationId]] }));
  await googleRequest(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values:batchUpdate`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data }) }, 'Unable to bind customer documents to application');
  invalidateSheetDataCache('Document_Log');
  pending.forEach(row => { row['Application ID'] = applicationId; });
}

const truth = value => clean(value).toUpperCase() === 'TRUE';
const canonicalRegion = value => ['SARAWAK', 'SABAH', 'LABUAN', 'EAST MALAYSIA', 'EAST_MALAYSIA'].includes(clean(value).toUpperCase()) ? 'EAST_MALAYSIA' : clean(value).toUpperCase();
const canonicalBusinessUnit = value => ['MOTOR', 'HANDPHONE'].includes(clean(value).toUpperCase()) ? clean(value).toUpperCase() : '';
const asksForPromotion = text => /(?:\bpromosi\b|\bpromo\b|\bpromotion\b|\boffer\b|\bdeal\b)/i.test(clean(text));
const credentialPrefix = value => clean(value).toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
const normalizedWords = value => clean(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const customerAmount = value => clean(value).replace(/^RM\s*/i, '').replace(/,/g, '');

export function hasRecentDocumentAcknowledgement(state = {}, now = Date.now(), windowMs = DOCUMENT_ACK_WINDOW_MS) {
  const lastMessage = clean(state['Last AI Message']);
  const lastAt = Date.parse(clean(state['Last AI Message At']));
  const documentReply = /^(?:Received|Dokumen (?:anda )?sudah diterima|文件已经收到)/i.test(lastMessage);
  return documentReply && Number.isFinite(lastAt) && Math.max(0, Number(now) - lastAt) < windowMs;
}

export function inferDocumentTypeFromFileName(fileName = '') {
  const value = normalizedWords(fileName);
  if (!value) return 'UNCLASSIFIED';
  if (/\b(consent|ccris|ctos|kebenaran|authorisation|authorization)\b/.test(value)) return 'CTOS_CCRIS_CONSENT_SIGNED';
  if (/\b(proof of identity|identity|mykad|kad pengenalan|passport|ic front|ic back)\b/.test(value)) return 'IDENTITY_DOCUMENT';
  if (/\b(payslips?|pay slips?|salary slips?|slip gaji)\b/.test(value)) return 'PAYSLIP';
  if (/\b(epf|kwsp|provident)\b/.test(value)) return 'EPF_STATEMENT';
  if (/\b(bank statement|penyata bank)\b/.test(value)) return 'BANK_STATEMENT';
  if (/\b(proof of address|address proof|utility|bil air|bil elektrik)\b/.test(value)) return 'PROOF_OF_ADDRESS';
  return 'UNCLASSIFIED';
}

export function isDocumentStatusQuestion(value = '') {
  const text = normalizedWords(value);
  return /\b(dah|sudah|semua|dokumen|document|fail|file)\b.*\b(hantar|send|sent|cukup|lengkap|complete|check|semak|kurang|missing)\b/.test(text)
    || /\b(apa|what)\b.*\b(lagi|else|dokumen|document|perlu|need|missing)\b/.test(text)
    || /\b(semua dah hantar|dah hantar semua|sudah hantar semua|all sent|sent everything|what else is needed)\b/.test(text)
    || /(?:都发完|已经发完|还缺|还需要|什么文件)/u.test(clean(value));
}

const documentTypeFromRow = row => {
  const stored = clean(row['Document Type'] || row.type).toUpperCase();
  return stored && stored !== 'UNCLASSIFIED' ? stored : inferDocumentTypeFromFileName(row['File Name'] || row.fileName);
};

const uniqueDocumentRows = documents => {
  const seen = new Set();
  return documents.filter(row => {
    const fileName = clean(row['File Name'] || row.fileName).toLowerCase();
    const key = fileName || clean(row['Media ID'] || row.mediaId || row['Message ID'] || row.messageId || row['Document ID'] || row.id).toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const documentProgress = documents => {
  const rows = uniqueDocumentRows(documents);
  const accepted = new Set(['VERIFIED', 'AI_VERIFIED', 'APPROVED', 'ACCEPTED']);
  const failed = rows.some(row => ['REJECTED', 'FAILED', 'BLURRY', 'POOR'].includes(clean(row['Verification Status'] || row['Quality Status'] || row.verification || row.quality).toUpperCase()));
  const usableRows = rows.filter(row => !['REJECTED', 'FAILED', 'BLURRY', 'POOR'].includes(clean(row['Verification Status'] || row['Quality Status'] || row.verification || row.quality).toUpperCase()));
  const types = new Set(usableRows.map(documentTypeFromRow));
  const pendingRows = usableRows.filter(row => !accepted.has(clean(row['Verification Status'] || row.verification).toUpperCase()));
  const pending = pendingRows.length > 0;
  const pendingTypes = [...new Set(pendingRows.map(documentTypeFromRow).filter(type => type && type !== 'CTOS_CCRIS_CONSENT_SIGNED'))];
  const hasCombinedIdentity = types.has('IDENTITY_DOCUMENT');
  const missing = [], missingCodes = [];
  if (!types.has('IC_FRONT') && !hasCombinedIdentity) { missing.push('IC depan'); missingCodes.push('IC_FRONT'); }
  if (!types.has('IC_BACK') && !hasCombinedIdentity) { missing.push('IC belakang'); missingCodes.push('IC_BACK'); }
  if (![...types].some(type => ['INCOME_PROOF', 'PAYSLIP', 'SALARY_SLIP', 'EPF', 'EPF_STATEMENT'].includes(type))) { missing.push('slip gaji atau penyata EPF'); missingCodes.push('INCOME_PROOF'); }
  const acceptedTypes = new Set(usableRows.filter(row => accepted.has(clean(row['Verification Status'] || row.verification).toUpperCase())).map(documentTypeFromRow));
  const hasVerifiedCombinedIdentity = acceptedTypes.has('IDENTITY_DOCUMENT'), verifiedMissingCodes = [];
  if (!acceptedTypes.has('IC_FRONT') && !hasVerifiedCombinedIdentity) verifiedMissingCodes.push('IC_FRONT');
  if (!acceptedTypes.has('IC_BACK') && !hasVerifiedCombinedIdentity) verifiedMissingCodes.push('IC_BACK');
  if (![...acceptedTypes].some(type => ['INCOME_PROOF', 'PAYSLIP', 'SALARY_SLIP', 'EPF', 'EPF_STATEMENT'].includes(type))) verifiedMissingCodes.push('INCOME_PROOF');
  const labels = [
    [hasCombinedIdentity || types.has('IC_FRONT') || types.has('IC_BACK'), 'kad pengenalan'],
    [types.has('PAYSLIP') || types.has('SALARY_SLIP'), 'slip gaji'],
    [types.has('EPF') || types.has('EPF_STATEMENT'), 'penyata EPF'],
    [types.has('BANK_STATEMENT'), 'penyata bank'],
    [types.has('PROOF_OF_ADDRESS'), 'bukti alamat'],
    [types.has('CTOS_CCRIS_CONSENT_SIGNED'), 'borang kebenaran CTOS/CCRIS']
  ].filter(([present]) => present).map(([, label]) => label);
  return { rows, types, pending, pendingTypes, failed, missing, missingCodes, verifiedMissingCodes, verifiedComplete: verifiedMissingCodes.length === 0 && !failed, labels };
};

export function buildDocumentProgressReply(language = 'MS', documents = []) {
  const status = documentProgress(documents);
  if (!status.rows.length) {
    if (language === 'ZH') return '我目前还没有在您的申请里看到文件。请把 MyKad 正反面，以及最新薪水单或 EPF 记录发到这里。';
    if (language === 'EN') return 'I cannot see any document in your application yet. Please send the front and back of your MyKad, plus your latest payslip or EPF statement here.';
    return 'Saya belum nampak dokumen dalam permohonan anda. Boleh hantar IC depan dan belakang, serta slip gaji terkini atau penyata EPF di sini.';
  }
  const received = status.labels.length ? status.labels.join(', ') : `${status.rows.length} fail`;
  if (status.failed) {
    if (language === 'ZH') return `我已经收到 ${status.rows.length} 份文件，但其中有文件不清楚或未通过检查。我会明确告诉您需要重新发送哪一份，不需要全部重发。`;
    if (language === 'EN') return `I have received ${status.rows.length} file${status.rows.length === 1 ? '' : 's'}, but at least one is unclear or did not pass checking. I will tell you exactly which file needs to be resent; you do not need to resend everything.`;
    return `Baik, saya sudah terima ${status.rows.length} fail. Ada dokumen yang kurang jelas atau belum lulus semakan. Saya akan beritahu fail yang tepat untuk dihantar semula; tak perlu hantar semuanya sekali lagi.`;
  }
  if (status.pending) {
    if (language === 'ZH') return `店内贷款的最低文件要求是 MyKad 正反面，以及最新薪水单或 EPF 记录。我已经收到 ${status.rows.length} 份文件，包括${received}，目前正在核对，不需要重新发送。如果文件齐全，我会自动发送 CTOS/CCRIS 同意书给您签署。`;
    if (language === 'EN') return `For a shop-loan application, the minimum documents are the front and back of your MyKad plus your latest payslip or EPF statement. I have received ${status.rows.length} file${status.rows.length === 1 ? '' : 's'}, including ${received}, and they are being checked, so there is no need to resend them. If everything is complete, I will send the CTOS/CCRIS consent form for your signature.`;
    return `Untuk permohonan loan kedai, dokumen minimum ialah IC depan dan belakang serta slip gaji terkini atau penyata EPF. Saya sudah terima ${status.rows.length} fail anda termasuk ${received} dan sedang membuat semakan, jadi tak perlu hantar semula. Borang kebenaran CTOS/CCRIS boleh ditandatangani sekarang tanpa menunggu semua dokumen lengkap.`;
  }
  if (status.missing.length) {
    if (language === 'ZH') return `已收到的文件包括${received}。目前还需要：${status.missing.join('、')}。其他文件不需要重新发送。`;
    if (language === 'EN') return `I have received ${received}. The remaining items are: ${status.missing.join(', ')}. You do not need to resend the other documents.`;
    return `Dokumen yang sudah diterima termasuk ${received}. Yang masih diperlukan ialah ${status.missing.join(' dan ')}. Dokumen lain tak perlu dihantar semula.`;
  }
  if (language === 'ZH') return '最低所需文件已经齐全并通过检查。下一步我会发送 CTOS/CCRIS 同意书给您签署。';
  if (language === 'EN') return 'The minimum documents are complete and have passed checking. Next, I will send the CTOS/CCRIS consent form for your signature.';
  return 'Dokumen minimum sudah lengkap dan lulus semakan. Langkah seterusnya, saya akan hantar borang kebenaran CTOS/CCRIS untuk ditandatangani.';
}

export function isStaleInboundMessage(receivedAt = '', latestInboundAt = '') {
  const receivedTime = Date.parse(clean(receivedAt));
  const latestTime = Date.parse(clean(latestInboundAt));
  return Number.isFinite(receivedTime) && Number.isFinite(latestTime) && receivedTime < latestTime;
}

export function isExpiredInboundMessage(receivedAt = '', now = Date.now(), maxAgeMs = DEFAULT_MAX_INBOUND_AGE_MS) {
  const receivedTime = Date.parse(clean(receivedAt));
  const currentTime = Number(now);
  const allowedAge = Math.max(60 * 1000, Number(maxAgeMs) || DEFAULT_MAX_INBOUND_AGE_MS);
  return Number.isFinite(receivedTime) && Number.isFinite(currentTime) && currentTime - receivedTime > allowedAge;
}

const editDistanceWithin = (leftValue, rightValue, limit = 1) => {
  const left = clean(leftValue), right = clean(rightValue);
  if (Math.abs(left.length - right.length) > limit) return false;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    let rowBest = current[0];
    for (let column = 1; column <= right.length; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1;
      current[column] = Math.min(current[column - 1] + 1, previous[column] + 1, previous[column - 1] + cost);
      rowBest = Math.min(rowBest, current[column]);
    }
    if (rowBest > limit) return false;
    previous = current;
  }
  return previous[right.length] <= limit;
};

export function extractCustomerName(value = '') {
  let candidate = clean(value)
    .replace(/^(?:nama\s+saya|saya\s+bernama|my\s+name\s+is|i\s+am|i'm|call\s+me|saya|我叫|我是)\s*/i, '')
    .replace(/[?.!,;:]+$/g, '').trim();
  const normalized = normalizedWords(candidate);
  if (!candidate || candidate.length < 2 || candidate.length > 60) return '';
  if (/\d/.test(candidate) || candidate.split(/\s+/).length > 5) return '';
  if (/^(hi|hello|hey|hai|morning|afternoon|evening|yes|no|ok|okay|motor|moto|phone|iphone|handphone|yamaha|honda)$/i.test(normalized)) return '';
  if (!/^[\p{L}][\p{L}'’ -]*$/u.test(candidate)) return '';
  return candidate.replace(/\s+/g, ' ');
}

const stateAliases = [
  ['EAST_MALAYSIA', 'Sarawak', ['sarawak', 'kuching', 'kch', 'batu kawa', 'satok', 'samarahan', 'kota samarahan', 'bintulu', 'miri', 'sibu', 'serian', 'sri aman']],
  ['EAST_MALAYSIA', 'Sabah', ['sabah', 'kota kinabalu', 'kk', 'sandakan', 'tawau', 'lahad datu']],
  ['EAST_MALAYSIA', 'Labuan', ['labuan']],
  ['WEST_MALAYSIA', 'Selangor', ['selangor', 'petaling jaya', 'pj', 'shah alam', 'klang', 'klang valley']],
  ['WEST_MALAYSIA', 'Kuala Lumpur', ['kuala lumpur', 'kl']],
  ['WEST_MALAYSIA', 'Negeri Sembilan', ['negeri sembilan', 'seremban', 'nilai']],
  ['WEST_MALAYSIA', 'Penang', ['penang', 'pulau pinang']],
  ['WEST_MALAYSIA', 'Johor', ['johor', 'johor bahru', 'jb']],
  ['WEST_MALAYSIA', 'Perak', ['perak', 'ipoh']],
  ['WEST_MALAYSIA', 'Melaka', ['melaka', 'malacca']],
  ['WEST_MALAYSIA', 'Kedah', ['kedah', 'alor setar']],
  ['WEST_MALAYSIA', 'Pahang', ['pahang', 'kuantan']],
  ['WEST_MALAYSIA', 'Kelantan', ['kelantan', 'kota bharu']],
  ['WEST_MALAYSIA', 'Terengganu', ['terengganu', 'kuala terengganu']],
  ['WEST_MALAYSIA', 'Perlis', ['perlis']],
  ['WEST_MALAYSIA', 'Putrajaya', ['putrajaya']]
];
const includesTerm = (text, term) => (` ${text} `).includes(` ${normalizedWords(term)} `);

export function resolveCustomerLocation(value = '', businessUnit = '', branches = []) {
  const text = normalizedWords(value), unit = canonicalBusinessUnit(businessUnit);
  if (!text || text.length > 100) return null;
  const words = text.split(' ').filter(Boolean), candidates = new Set([text.replace(/\s+/g, '')]);
  for (let start = 0; start < words.length; start += 1) {
    for (let end = start + 1; end <= Math.min(words.length, start + 3); end += 1) candidates.add(words.slice(start, end).join(''));
  }
  const locationMatches = stateAliases.flatMap(([region, state, aliases]) => aliases.map(alias => {
    const normalizedAlias = normalizedWords(alias), compactAlias = normalizedAlias.replace(/\s+/g, '');
    const exact = includesTerm(text, alias);
    const typo = !exact && compactAlias.length >= 5 && [...candidates].some(candidate => candidate.length >= 4 && editDistanceWithin(candidate, compactAlias, compactAlias.length >= 6 ? 2 : 1));
    return { region, state, alias, exact, typo, score: exact ? 1000 + compactAlias.length : typo ? 500 + compactAlias.length : 0 };
  })).filter(match => match.score > 0).sort((a, b) => b.score - a.score);
  const locationMatch = locationMatches[0];
  if (!locationMatch) return null;
  const { region, state, alias } = locationMatch;
  const area = ({ kch: 'kuching', kk: 'kota kinabalu', kl: 'kuala lumpur', pj: 'petaling jaya', jb: 'johor bahru' })[normalizedWords(alias)] || alias;
  const resolvedAreaText = normalizedWords(area);
  const active = branches.filter(branch => truth(branch.Active) && canonicalBusinessUnit(branch['Business Unit']) === unit);
  const directMatches = active.map(branch => {
    const terms = [branch['Branch Name'], branch.City, ...clean(branch['Direct Coverage Areas']).split('|')].filter(Boolean);
    const score = Math.max(0, ...terms.filter(term => includesTerm(text, term) || includesTerm(resolvedAreaText, term) || includesTerm(normalizedWords(term), area)).map(term => normalizedWords(term).length));
    return { branch, score };
  }).filter(match => match.score > 0).sort((a, b) => b.score - a.score);
  let selected = directMatches[0]?.branch || null;
  if (!selected) {
    const sameRegion = active.filter(branch => canonicalRegion(branch.Region) === region);
    if (sameRegion.length === 1) selected = sameRegion[0];
  }
  return {
    region,
    state,
    city: area.replace(/\b\w/g, letter => letter.toUpperCase()),
    branchId: clean(selected?.['Branch ID']),
    teamId: clean(selected?.['Team ID']),
    resolved: Boolean(selected)
  };
}

export function buildImmediateAcknowledgement(text = '', messageType = 'text') {
  if (!['text', 'button', 'interactive'].includes(clean(messageType).toLowerCase())) return '';
  const message = clean(text);
  if (/[一-鿿]/u.test(message)) return '您好，我们已收到您的信息，正在马上为您查询。请稍等一下，很快回复您。';
  if (/\b(hai|nak|mahu|boleh|harga|ansuran|motor|telefon|dokumen|pinjaman)\b/i.test(message)) return 'Hai, kami telah menerima mesej anda dan sedang menyemaknya sekarang. Sila tunggu sebentar, kami akan balas secepat mungkin.';
  return "Hi, we've received your message and are checking it now. Please give us a moment and we'll reply shortly.";
}

export function shouldSendImmediateAcknowledgement({ route = {}, routeUsable = false, human = false, messageType = 'text', previousInboundAt = '', receivedAt = '' } = {}) {
  // Customer-facing replies are created only by the qualification scenario.
  // A separate webhook acknowledgement caused two replies for one message and
  // made the conversation feel automated, so it remains disabled by design.
  void route;
  void routeUsable;
  void human;
  void messageType;
  void previousInboundAt;
  void receivedAt;
  return false;
}

export function buildInitialConversationState({ lead = {}, application = {}, route = {}, phone = '', text = '', messageId = '', receivedAt = '', numberId = '', displayNumber = '', entryId = '', channelId = '', businessUnit = '', teamId = '' } = {}) {
  return {
    'State ID': makeId('STATE'),
    'Lead ID': clean(lead['Lead ID']),
    'Application ID': clean(application['Application ID']),
    'Phone Number': digits(phone),
    'Current Step': 'STEP_01_WELCOME',
    'Qualification Status': 'IN_PROGRESS',
    'Customer Name': clean(lead['Customer Name']),
    'Product Category': clean(businessUnit),
    'Selected Branch ID': clean(lead['Selected Branch ID']),
    'Last Customer Message': clean(text),
    'Last Message ID': clean(messageId),
    'Last Customer Reply At': clean(receivedAt),
    'Follow Up Attempts': '0',
    'Escalation Required': 'FALSE',
    'Updated At': clean(receivedAt) || new Date().toISOString(),
    'Internal Channel ID': clean(channelId),
    'WhatsApp Number ID': clean(numberId),
    'WABA ID': clean(route['WABA ID'] || entryId),
    'WhatsApp Display Number': clean(displayNumber || route['Display Number']),
    'Channel Binding Status': clean(channelId) ? 'BOUND' : 'UNBOUND',
    'Business Unit': clean(businessUnit),
    'Customer ID': clean(lead['Customer ID']),
    'Team ID': clean(teamId)
  };
}

export function buildAutomaticApplication({ lead = {}, state = {}, route = {}, decision = {}, applicationId = '', receivedAt = '', channelId = '', businessUnit = '', teamId = '' } = {}) {
  const timestamp = clean(receivedAt) || new Date().toISOString();
  const unit = canonicalBusinessUnit(decision.productUnit || state['Product Category'] || businessUnit || lead['Business Unit']) || 'MOTOR';
  const product = decision.product || {};
  return {
    'Application ID': clean(applicationId) || makeId('APP'),
    'Lead ID': clean(lead['Lead ID']),
    'Created At': timestamp,
    'Updated At': timestamp,
    'Applicant Name': clean(state['Customer Name'] || lead['Customer Name']),
    'Phone Number': clean(lead['Phone Number']),
    Region: clean(lead.Region),
    'Business Unit': unit,
    'Customer ID': clean(lead['Customer ID']),
    'Team ID': clean(teamId || lead['Team ID']),
    'Origin WhatsApp Channel ID': clean(channelId || route['Internal Channel ID']),
    'Product Category': unit === 'HANDPHONE' ? 'HANDPHONE' : 'MOTORCYCLE',
    'Product Brand': clean(product.Brand || state['Selected Product Brand']),
    'Product Model': clean(product.Model || state['Selected Product Model']),
    'Product Variant': clean(product.Variant) || 'Standard',
    'Motor Type': unit === 'MOTOR' ? 'NEW' : '',
    'Application Status': 'DRAFT',
    'Current Stage': 'DOCUMENT_COLLECTION',
    'Processing Mode': 'AI_MANAGED',
    'Assigned Branch ID': clean(lead['Selected Branch ID'] || state['Selected Branch ID']),
    'Assigned SA ID': '',
    'Document Status': 'PENDING',
    'Minimum Documents Complete': 'FALSE',
    'Missing Documents': JOMKAKI_KNOWLEDGE.documents.minimum.join(', '),
    'Credit Consent Status': 'NOT_SENT',
    'Credit Check Status': 'BLOCKED_CONSENT_REQUIRED',
    'SA Review Required': 'FALSE',
    'Created By': 'META_WEBHOOK',
    'Updated By': 'META_WEBHOOK'
  };
}

export function buildMediaProxyUrl({ mediaId = '', channelId = '', credentialKey = '', expires = 0, secret = process.env.META_APP_SECRET, baseUrl = process.env.JOMKAKI_CRM_PUBLIC_URL || 'https://jomkaki-rider.vercel.app' } = {}) {
  const id = clean(mediaId), channel = clean(channelId), credential = credentialPrefix(credentialKey || channelId);
  const expiry = Number(expires) || Math.floor(Date.now() / 1000) + 21600;
  if (!id || !channel || !credential || !clean(secret)) return '';
  const signature = crypto.createHmac('sha256', clean(secret)).update(`${id}|${channel}|${credential}|${expiry}`).digest('hex');
  const query = new URLSearchParams({ id, channel, credential, expires: String(expiry), signature });
  return `${clean(baseUrl).replace(/\/$/, '')}/api/whatsapp-media?${query.toString()}`;
}

const customerLanguageSignal = value => {
  const text = clean(value);
  if (/[\u3400-\u9fff]/u.test(text)) return 'ZH';
  if (/\b(hai|saya|sy|nak|mahu|boleh|cari|motor|telefon|harga|ansuran|pinjaman|dokumen|dari|ada|apa|tak|tidak|faham|cakap|kat|dekat|sekarang|skg|berapa|tolong|sudah|dah|kalau|kenapa|bodoh|bajet|murah|mahal)\b/i.test(text)) return 'MS';
  if (/\b(i'm|my|we|our|looking|want|need|interested|how|what|where|which|monthly|payment|price|apply|please|can you|do you|years?|months?|promotion)\b/i.test(text)) return 'EN';
  return '';
};

const instantLanguage = (text, state = {}) => customerLanguageSignal(text)
  || customerLanguageSignal(state['Last Customer Message'])
  || JOMKAKI_KNOWLEDGE.conversation.defaultLanguage;

const instantCopy = (language, key, values = {}) => {
  const name = clean(values.name), location = clean(values.location), brand = clean(values.brand), model = clean(values.model);
  const amount = customerAmount(values.amount), deposit = customerAmount(values.deposit), cashPrice = customerAmount(values.cashPrice), tenure = clean(values.tenure), options = clean(values.options), models = clean(values.models);
  const localizedTenure = language === 'MS'
    ? tenure.replace(/\byears?\b/i, 'tahun').replace(/\bmonths?\b/i, 'bulan')
    : tenure;
  const copies = {
    EN: {
      NAME: 'Hi, thank you for contacting JomKaki Rider. I can help with motorcycles, phones and monthly instalment plans. May I know your name?',
      NAME_RETRY: 'Sorry, may I know your name so I can continue checking the right options for you?',
      LOCATION: `Nice to meet you${name ? `, ${name}` : ''}. Which city or state are you from?`,
      LOCATION_RETRY: 'Which city or state are you currently staying in?',
      PRODUCT: `Thank you${location ? `, noted ${location}` : ''}. Are you looking for a motorcycle or phone? You can tell me the model directly.`,
      MODEL: 'Which motorcycle or phone model are you interested in? You can send me the model name directly.',
      MOTOR_MODEL: 'All right, a motorcycle. Is there a particular model you are looking for? If not, tell me your comfortable monthly budget and I can suggest a few options.',
      HANDPHONE_MODEL: 'All right, a phone. Which model are you looking for? If you are not sure, tell me your comfortable monthly budget and I can suggest a few options.',
      RETURNING_GREETING: `Hi${name ? `, ${name}` : ''}. Welcome back to JomKaki Rider. What would you like me to check for you today?`,
      MODEL_CLARIFY: `Do you mean ${options}? Choose one so I can send the correct photo and monthly instalment.`,
      MODEL_UNAVAILABLE: `I understand you mean ${brand} ${model}. The approved monthly instalment is not available in the system yet, but I can check it with the branch for you.`,
      OTHER_MODELS: `Other available options include ${models}. Which one would you like me to check?`,
      AVAILABLE_MODELS: `Available options I can check include ${models}. Would you prefer a cub, scooter, or a model based on your monthly budget?`,
      SERVICE_RECOVERY: `Sorry, my earlier reply was not helpful. I understand you want a clear answer. ${models ? `Available options I can check include ${models}. ` : ''}What monthly budget would be comfortable for you?`,
      DOCUMENT_REQUIREMENTS_RECOVERY: 'Sorry, my earlier reply did not answer your question. For a shop-loan application, the minimum documents are the front and back of your MyKad plus your latest payslip or EPF statement. You may send all files together; there is no need to send them one by one.',
      BUDGET: 'No problem. I can check another model with a lower monthly instalment. What monthly budget would be comfortable for you?',
      APPLY: 'To start the shop-loan check, please send the front and back of your MyKad plus your latest payslip or EPF statement here. You may send all the files together or in several uploads.',
      SHOP_LOAN: 'Yes, we offer shop-loan applications. Processing normally takes 1–3 working days after the complete documents are received, subject to eligibility checks and verification. If you are ready, I can help start the check now.',
      SHOP_LOAN_MODEL: 'Which motorcycle model would you like to check?',
      THANKS: 'You are welcome. If you need another model or monthly-instalment check, just message me here.',
      HELP: 'Certainly. I can help with models, monthly instalments, required documents, or application status. What would you like me to check?',
      DOCUMENT: 'Your document has been received. I am checking all files submitted for this application. There is no need to resend anything now; I will tell you clearly if something is still missing.',
      TENURE_QUOTE: `For ${brand} ${model}, the ${localizedTenure.replace(/\s+(year|month)s?$/i, '-$1')} instalment is RM${amount} per month, subject to branch confirmation.`,
      TENURE_UNAVAILABLE: `The ${localizedTenure} instalment for ${brand} ${model} is not available in the approved system rates. Would you like me to check the available tenure instead?`,
      DEPOSIT_QUOTE: `For ${brand} ${model}, the approved deposit is RM${deposit}, subject to branch confirmation.`,
      DEPOSIT_UNAVAILABLE: `The approved deposit for ${brand} ${model} is not available in the system yet. I can check it with the branch for you.`,
      CASH_PRICE_QUOTE: `For ${brand} ${model}, the approved cash price is RM${cashPrice}, subject to branch confirmation.`,
      CASH_PRICE_UNAVAILABLE: `The cash price for ${brand} ${model} requires branch confirmation. Meanwhile, I can help you check the approved shop-loan deposit and monthly instalment. Would you like to proceed with the shop-loan check?`,
      FOLLOW_UP_TIME: 'The branch price check is still in progress. While waiting, I can help you check the approved shop-loan deposit and monthly instalment. Would you like to proceed with the shop-loan check?',
      LOAN_PROCESSING_TIME: 'Shop-loan processing normally takes 1–3 working days after the complete documents are received, subject to eligibility checks and verification. Would you like me to help start the check now?',
      HANDPHONE_CASH_POLICY: 'For phones, I can only share the approved monthly instalment. The cash or selling price is not quoted to customers.',
      PROMOTION_LOCATION: 'Current motorcycle promotions differ by area, so I will check the approved offers for your location first.',
      PROMOTION_LIST: `Current approved motorcycle promotions for your area include ${options}.`,
      PROMOTION_NONE: 'There is no approved active motorcycle promotion recorded for your area at the moment.',
      PROMOTION_MODEL: 'Which model would you like me to check in detail?',
      HANDPHONE_DEPOSIT_POLICY: `For phones, I can only share the approved monthly instalment. The deposit and selling price are not quoted to customers.`,
      QUOTE_ONLY: `For ${brand} ${model}, ${deposit ? `the approved deposit is RM${deposit} and ` : ''}the ${tenure} instalment is RM${amount} per month, subject to branch confirmation.`,
      NAME_AFTER_ANSWER: 'May I know your name?',
      LOCATION_AFTER_ANSWER: 'Which city or state are you currently staying in?',
      QUOTE: `For ${brand} ${model}, ${deposit ? `the approved deposit is RM${deposit} and ` : ''}the ${tenure} instalment is RM${amount} per month, subject to branch confirmation. If this suits your budget, I can help you continue with the loan check.`
    },
    MS: {
      NAME: 'Hai, terima kasih kerana menghubungi JomKaki Rider. Saya boleh bantu semak motor, telefon dan pelan ansuran bulanan. Boleh saya tahu nama anda?',
      NAME_RETRY: 'Maaf, boleh saya tahu nama anda supaya saya boleh teruskan semakan?',
      LOCATION: `Salam kenal${name ? `, ${name}` : ''}. Anda tinggal di bandar atau negeri mana?`,
      LOCATION_RETRY: 'Boleh beritahu anda sekarang tinggal di bandar atau negeri mana?',
      PRODUCT: `Terima kasih${location ? `, lokasi ${location} sudah dicatat` : ''}. Anda sedang cari motor atau telefon? Boleh terus beritahu model yang anda mahu.`,
      MODEL: 'Model motor atau telefon yang mana anda minat? Boleh terus hantar nama model kepada saya.',
      MOTOR_MODEL: 'Baik, motor. Ada model tertentu yang anda sedang cari? Kalau belum pasti, beritahu bajet bulanan yang selesa dan saya boleh cadangkan beberapa pilihan.',
      HANDPHONE_MODEL: 'Baik, telefon. Model mana yang anda sedang cari? Kalau belum pasti, beritahu bajet bulanan yang selesa dan saya boleh cadangkan beberapa pilihan.',
      RETURNING_GREETING: `Hai${name ? `, ${name}` : ''}. Selamat kembali ke JomKaki Rider. Apa yang anda mahu saya semak hari ini?`,
      MODEL_CLARIFY: `Maksud anda ${options}? Pilih satu ya supaya saya boleh hantar gambar dan ansuran bulanan yang betul.`,
      MODEL_UNAVAILABLE: `Baik, anda maksudkan ${brand} ${model}. Kadar ansuran yang diluluskan belum ada dalam sistem sekarang, tetapi saya boleh semak dengan cawangan untuk anda.`,
      OTHER_MODELS: `Antara pilihan lain yang ada ialah ${models}. Yang mana satu anda mahu saya semak?`,
      AVAILABLE_MODELS: `Antara pilihan yang saya boleh semak sekarang ialah ${models}. Anda lebih suka kapcai, skuter atau ikut bajet bulanan?`,
      SERVICE_RECOVERY: `Maaf, jawapan tadi memang tak membantu. Saya faham anda mahu jawapan yang jelas. ${models ? `Antara pilihan yang saya boleh semak ialah ${models}. ` : ''}Bajet bulanan yang anda selesa sekitar berapa?`,
      DOCUMENT_REQUIREMENTS_RECOVERY: 'Maaf, jawapan tadi memang tidak menjawab soalan anda. Untuk loan kedai, dokumen minimum ialah IC depan dan belakang serta slip gaji terkini atau penyata EPF. Boleh hantar semua fail sekali gus; tak perlu hantar satu per satu.',
      BUDGET: 'Boleh. Saya boleh semak model lain dengan ansuran bulanan yang lebih rendah. Bajet bulanan yang selesa untuk anda berapa?',
      APPLY: 'Untuk mula semakan loan kedai, boleh hantar IC depan dan belakang serta slip gaji terkini atau penyata EPF di sini. Boleh hantar semua sekali atau dalam beberapa fail.',
      SHOP_LOAN: 'Boleh, kami ada menyediakan loan kedai. Biasanya proses mengambil masa 1–3 hari bekerja selepas dokumen lengkap diterima, bergantung pada semakan kelayakan dan pengesahan. Kalau anda mahu, saya boleh bantu mulakan semakan sekarang.',
      SHOP_LOAN_MODEL: 'Model motor yang mana anda mahu semak?',
      THANKS: 'Sama-sama. Kalau mahu semak model lain atau ansuran bulanan, terus mesej saya di sini.',
      HELP: 'Boleh. Saya boleh bantu semak model, ansuran bulanan, dokumen yang diperlukan atau status permohonan. Anda mahu saya semak yang mana?',
      DOCUMENT: 'Dokumen anda sudah diterima. Saya sedang semak semua fail untuk permohonan ini. Tak perlu hantar semula sekarang; dokumen yang masih kurang boleh dihantar kemudian.',
      TENURE_QUOTE: `Untuk ${brand} ${model}, ansuran ${localizedTenure} ialah RM${amount} sebulan, tertakluk kepada pengesahan cawangan.`,
      TENURE_UNAVAILABLE: `Ansuran ${localizedTenure} untuk ${brand} ${model} belum ada dalam kadar yang diluluskan. Mahu saya semak tempoh yang tersedia?`,
      DEPOSIT_QUOTE: `Untuk ${brand} ${model}, deposit yang diluluskan ialah RM${deposit}, tertakluk kepada pengesahan cawangan.`,
      DEPOSIT_UNAVAILABLE: `Deposit yang diluluskan untuk ${brand} ${model} belum ada dalam sistem. Saya boleh semak dengan cawangan untuk anda.`,
      CASH_PRICE_QUOTE: `Untuk ${brand} ${model}, harga tunai yang diluluskan ialah RM${cashPrice}, tertakluk kepada pengesahan cawangan.`,
      CASH_PRICE_UNAVAILABLE: `Harga tunai untuk ${brand} ${model} memerlukan pengesahan cawangan. Sementara itu, saya boleh terus bantu semak deposit dan ansuran bulanan loan kedai yang diluluskan. Mahu teruskan semakan loan kedai?`,
      FOLLOW_UP_TIME: 'Semakan harga oleh cawangan masih berjalan. Sementara menunggu, saya boleh terus bantu semak deposit dan ansuran bulanan loan kedai yang diluluskan. Mahu teruskan semakan loan kedai?',
      LOAN_PROCESSING_TIME: 'Biasanya proses loan kedai mengambil masa 1–3 hari bekerja selepas dokumen lengkap diterima, bergantung pada semakan kelayakan dan pengesahan. Mahu saya bantu mulakan semakan sekarang?',
      HANDPHONE_CASH_POLICY: 'Untuk telefon, saya hanya boleh berikan ansuran bulanan yang diluluskan. Harga tunai atau harga jualan tidak diberikan kepada pelanggan.',
      PROMOTION_LOCATION: 'Promosi motor semasa berbeza mengikut kawasan, jadi saya akan semak tawaran yang diluluskan untuk lokasi anda dahulu.',
      PROMOTION_LIST: `Antara promosi motor yang sedang aktif untuk kawasan anda ialah ${options}.`,
      PROMOTION_NONE: 'Buat masa ini, belum ada promosi motor aktif yang diluluskan untuk kawasan anda dalam sistem.',
      PROMOTION_MODEL: 'Model mana satu anda mahu saya semak dengan lebih lanjut?',
      HANDPHONE_DEPOSIT_POLICY: `Untuk telefon, saya hanya boleh berikan ansuran bulanan yang diluluskan. Deposit dan harga jualan tidak diberikan kepada pelanggan.`,
      QUOTE_ONLY: `Untuk ${brand} ${model}, ${deposit ? `deposit yang diluluskan ialah RM${deposit} dan ` : ''}ansuran ${tenure} ialah RM${amount} sebulan, tertakluk kepada pengesahan cawangan.`,
      NAME_AFTER_ANSWER: 'Boleh saya tahu nama anda?',
      LOCATION_AFTER_ANSWER: 'Anda tinggal di bandar atau negeri mana?',
      QUOTE: `Untuk ${brand} ${model}, ${deposit ? `deposit yang diluluskan ialah RM${deposit} dan ` : ''}ansuran ${tenure} ialah RM${amount} sebulan, tertakluk kepada pengesahan cawangan. Kalau sesuai dengan bajet anda, saya boleh bantu teruskan semakan loan.`
    },
    ZH: {
      NAME: '您好，感谢您联系 JomKaki Rider。我可以协助您查询合适的摩托车或手机型号及月供。请问该怎么称呼您？',
      NAME_RETRY: '不好意思，请问该怎么称呼您？我好继续为您查询。',
      LOCATION: `很高兴认识你${name ? `，${name}` : ''}。请问你目前住在哪个城市或州属？`,
      LOCATION_RETRY: '请问你目前住在哪个城市或州属？',
      PRODUCT: `谢谢${location ? `，已记录你在 ${location}` : ''}。你想找摩托还是手机？可以直接告诉我型号。`,
      MODEL: '你对哪一款摩托或手机有兴趣？可以直接把型号发给我。',
      MODEL_CLARIFY: `请问你是指 ${options}？请选择一个，我才能发送正确的照片和月供。`,
      OTHER_MODELS: `目前其他可选型号包括 ${models}。你想让我查询哪一款？`,
      AVAILABLE_MODELS: `目前可以查询的选择包括 ${models}。你想找 kapcai、scooter，还是按月供预算选择？`,
      SERVICE_RECOVERY: `抱歉，刚才的回复没有解决你的问题。${models ? `目前可以查询的选择包括 ${models}。` : ''}请问你希望每月供款大约多少？`,
      DOCUMENT_REQUIREMENTS_RECOVERY: '不好意思，刚才没有正确回答你的问题。店内贷款所需的基本文件是身份证正反面，以及最新薪水单或 EPF 报表。可以一次发送所有文件，不需要逐份发送。',
      BUDGET: '可以，我能帮你查询月供较低的其他型号。你觉得每月多少预算比较合适？',
      APPLY: '要开始店内贷款审核，请在这里发送 MyKad 正反面，以及最新薪水单或 EPF 记录。可以逐份发送。',
      SHOP_LOAN: '可以，我们有提供店内贷款申请。资格需要根据申请人的资料和证明文件审核，我可以逐步协助你完成检查。',
      SHOP_LOAN_MODEL: '你想查询哪一款摩托？',
      THANKS: '不客气。如果你要查询其他型号或月供，随时在这里留言。',
      HELP: '可以。我能协助查询型号、月供、所需文件或申请进度。你想先查询哪一项？',
      DOCUMENT: '文件已经收到。我正在核对这份申请的所有文件，目前不需要重新发送；如果还有缺少，我会清楚告诉您。',
      QUOTE_ONLY: `${brand} ${model} 的 ${tenure} 月供是每月 RM${amount}，最终以分行确认为准。`,
      NAME_AFTER_ANSWER: '请问该怎么称呼您？',
      LOCATION_AFTER_ANSWER: '请问您目前住在哪个城市或州属？',
      QUOTE: `${brand} ${model} 的 ${tenure} 月供是每月 RM${amount}，最终以分行确认为准。申请店内贷款需要 MyKad 正反面，以及最新薪水单或 EPF 记录。如果这个方案适合你，可以在这里逐份发送文件。`
    }
  };
  return copies[language]?.[key] || copies.EN[key] || '';
};

const usableCustomerName = value => {
  const name = clean(value);
  return name && !/^WhatsApp Customer\b/i.test(name) ? name : '';
};

const profileContinuation = ({ language = 'MS', state = {}, lead = {}, baseText = '', completeStep = 'STEP_03_PRODUCT' } = {}) => {
  const name = usableCustomerName(state['Customer Name'] || lead['Customer Name']);
  const hasLocation = !!clean(lead['City or Area'] || lead.State);
  const lastReply = clean(state['Last AI Message']);
  if (!name) {
    const alreadyAsked = /(?:nama anda|your name|称呼)/i.test(lastReply);
    return {
      nextStep: 'STEP_01_NAME',
      text: [clean(baseText), alreadyAsked ? '' : instantCopy(language, 'NAME_AFTER_ANSWER')].filter(Boolean).join(' ')
    };
  }
  if (!hasLocation) {
    const alreadyAsked = /(?:bandar atau negeri|city or state|城市|州属)/i.test(lastReply);
    return {
      nextStep: 'STEP_02_LOCATION',
      text: [clean(baseText), alreadyAsked ? '' : instantCopy(language, 'LOCATION_AFTER_ANSWER')].filter(Boolean).join(' ')
    };
  }
  return { nextStep: completeStep, text: clean(baseText) };
};

const AI_FALLBACK_DEFAULT_TIMEOUT_MS = Number(JOMKAKI_KNOWLEDGE.conversation.aiFallback?.timeoutMs) || 2600;
const AI_FALLBACK_MAX_CHARACTERS = Number(JOMKAKI_KNOWLEDGE.conversation.aiFallback?.maximumCharacters) || 420;
const AI_FALLBACK_BLOCKED_CLAIMS = /\b(?:guaranteed approval|guaranteed to pass|confirm(?:ed)?\s+(?:approve|approval|lulus)|pasti\s+lulus|dijamin\s+lulus|100%\s+lulus)\b/i;
const AI_FALLBACK_DISCLOSURE = /\b(?:artificial intelligence|automated (?:assistant|system)|chatbot|bot reply|as an ai|saya (?:ialah|adalah) ai|saya bot)\b/i;
const AI_FALLBACK_UNSUPPORTED_AMOUNT = /\bRM\s*\d[\d,.]*/i;

const stripEmoji = value => clean(value).replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, '').replace(/\s{2,}/g, ' ').trim();

export function sanitizeAiFallbackReply(value = '', language = 'MS') {
  let reply = stripEmoji(clean(value)
    .replace(/^```(?:text|json)?\s*/i, '')
    .replace(/```$/i, '')
    .replace(/^['"“”]+|['"“”]+$/g, '')
    .replace(/\s*\n+\s*/g, ' ')
    .replace(/\s{2,}/g, ' '))
    .slice(0, AI_FALLBACK_MAX_CHARACTERS)
    .trim();
  if (!reply || AI_FALLBACK_BLOCKED_CLAIMS.test(reply) || AI_FALLBACK_DISCLOSURE.test(reply) || AI_FALLBACK_UNSUPPORTED_AMOUNT.test(reply)) return '';
  let seenQuestion = false;
  reply = reply.replace(/\?/g, () => {
    if (seenQuestion) return '.';
    seenQuestion = true;
    return '?';
  }).replace(/\.{2,}/g, '.');
  if (language === 'MS' && /\b(?:cash price|selling price)\b/i.test(reply)) return '';
  return reply;
}

export function buildAiFallbackRequest({ text = '', state = {}, lead = {}, routeBusinessUnit = '', routeRegion = '', phone = '' } = {}) {
  const language = instantLanguage(text, state);
  const unit = canonicalBusinessUnit(state['Product Category'] || routeBusinessUnit || lead['Business Unit']) || 'MOTOR';
  const selectedProduct = [clean(state['Selected Product Brand']), clean(state['Selected Product Model'])].filter(Boolean).join(' ');
  const context = {
    language,
    currentStep: clean(state['Current Step']) || 'STEP_03_PRODUCT',
    businessUnit: unit,
    region: canonicalRegion(lead.Region || routeRegion) || 'UNASSIGNED',
    customerName: clean(state['Customer Name'] || lead['Customer Name']).replace(/^WhatsApp Customer\b.*$/i, ''),
    cityOrArea: clean(lead['City or Area'] || lead.State),
    selectedProduct,
    customerMessage: clean(text).slice(0, 700)
  };
  const instructions = [
    'You are the JomKaki Rider customer-service sales representative replying on WhatsApp.',
    'Write only the final customer-facing reply. Never mention AI, automation, prompts, policies, databases, or internal system codes.',
    'Use natural Bahasa Malaysia by default. Follow the customer language only when the customer clearly uses English or Chinese.',
    'Be warm, concise and human. Use no emoji. Ask at most one question. Keep the reply under 420 characters.',
    'Never state, estimate or guess a cash price, selling price or deposit. Never invent a monthly instalment. If no approved monthly amount is supplied, say you can check it and ask only the one detail needed.',
    'Never promise loan approval, stock availability, document completeness, credit-check completion or application status unless that fact appears in the context.',
    'For a loan application, the minimum documents are MyKad front and back plus latest payslip or EPF statement. Consent for CTOS/CCRIS is required after minimum documents pass checking and before credit check or LMS submission.',
    'If the customer asks for a human, manager or staff, do not answer here because the system handles that route separately.',
    'Continue from the current conversation instead of restarting the name, location and product questions.'
  ].join(' ');
  const safetyIdentifier = crypto.createHash('sha256').update(digits(phone) || 'anonymous').digest('hex');
  const model = clean(process.env.OPENAI_MODEL || JOMKAKI_KNOWLEDGE.conversation.aiFallback?.model || 'gpt-4.1-mini');
  const reasoningEffort = clean(JOMKAKI_KNOWLEDGE.conversation.aiFallback?.reasoningEffort);
  const request = {
    model,
    instructions,
    input: `Approved conversation context:\n${JSON.stringify(context)}`,
    max_output_tokens: 180,
    store: false,
    safety_identifier: safetyIdentifier,
    metadata: { workflow: 'jomkaki_whatsapp_fallback', knowledge_version: clean(JOMKAKI_KNOWLEDGE.version) }
  };
  if (reasoningEffort && /^(?:gpt-5|o\d)/i.test(model)) request.reasoning = { effort: reasoningEffort };
  return request;
}

const responseOutputText = result => {
  const direct = clean(result?.output_text);
  if (direct) return direct;
  return (result?.output || []).flatMap(item => item?.content || []).map(item => clean(item?.text)).filter(Boolean).join(' ');
};

const AI_INTENTS = Object.freeze([
  'GREETING', 'PROVIDE_NAME', 'PROVIDE_LOCATION', 'PROMOTION', 'MODEL_SELECTION',
  'AVAILABLE_MODELS', 'MONTHLY_INSTALMENT', 'DEPOSIT', 'CASH_PRICE', 'TENURE',
  'DOCUMENT_REQUIREMENTS', 'DOCUMENT_STATUS', 'APPLY', 'SHOP_LOAN', 'PROCESSING_TIME', 'FOLLOW_UP_TIME',
  'OTHER_MODELS', 'BUDGET', 'THANKS', 'HUMAN_HANDOVER', 'FRUSTRATED', 'GENERAL'
]);

const validAiIntent = value => {
  if (!value || typeof value !== 'object' || !AI_INTENTS.includes(clean(value.intent).toUpperCase())) return null;
  const confidence = Math.max(0, Math.min(1, Number(value.confidence) || 0));
  if (confidence < 0.45) return null;
  const language = ['MS', 'EN', 'ZH'].includes(clean(value.language).toUpperCase()) ? clean(value.language).toUpperCase() : 'MS';
  const businessUnit = canonicalBusinessUnit(value.businessUnit);
  const tenureYears = Math.max(0, Math.min(5, Number.parseInt(value.tenureYears, 10) || 0));
  return {
    intent: clean(value.intent).toUpperCase(),
    language,
    businessUnit,
    catalogId: clean(value.catalogId),
    normalizedModel: clean(value.normalizedModel),
    tenureYears,
    locationQuery: clean(value.locationQuery),
    customerName: clean(value.customerName),
    followUpSubject: clean(value.followUpSubject).toUpperCase(),
    needsHuman: value.needsHuman === true,
    answerCustomerQuestionFirst: value.answerCustomerQuestionFirst !== false,
    suggestedReply: sanitizeAiFallbackReply(value.suggestedReply, language),
    confidence
  };
};

export function buildAiIntentRequest({ text = '', state = {}, lead = {}, routeBusinessUnit = '', routeRegion = '', phone = '', motorCatalog = [], handphoneCatalog = [] } = {}) {
  const selectedProduct = [clean(state['Selected Product Brand']), clean(state['Selected Product Model'])].filter(Boolean).join(' ');
  const catalogChoices = [
    ...motorCatalog.map(row => ({ ...row, __businessUnit: 'MOTOR' })),
    ...handphoneCatalog.map(row => ({ ...row, __businessUnit: 'HANDPHONE' }))
  ].filter(row => truth(row.Active)).slice(0, 180).map(row => ({
    catalogId: clean(row['Catalog ID']),
    unit: clean(row.__businessUnit),
    brand: clean(row.Brand),
    model: clean(row.Model),
    variant: clean(row.Variant),
    keywords: clean(row['Search Keywords']).slice(0, 120)
  }));
  const context = {
    currentStep: clean(state['Current Step']) || 'STEP_01_WELCOME',
    defaultBusinessUnit: canonicalBusinessUnit(state['Product Category'] || routeBusinessUnit) || 'MOTOR',
    region: canonicalRegion(lead.Region || routeRegion) || 'UNASSIGNED',
    customerNameKnown: !!usableCustomerName(state['Customer Name'] || lead['Customer Name']),
    locationKnown: !!clean(lead['City or Area'] || lead.State),
    selectedProduct,
    lastAssistantMessage: clean(state['Last AI Message']).slice(0, 500),
    previousCustomerMessage: clean(state['Last Customer Message']).slice(0, 400),
    currentCustomerMessage: clean(text).slice(0, 700),
    approvedOperationalFacts: {
      primarySalesPath: 'LOAN_KEDAI',
      loanKedaiProcessing: '1-3 working days after complete documents are received, subject to eligibility checks and verification',
      cashPurchasePolicy: 'Do not proactively promote cash purchase. Answer an explicit motor cash-price question only from an approved value, then guide toward Loan Kedai.'
    },
    catalogChoices
  };
  const instructions = [
    'Classify the latest WhatsApp customer message for JomKaki Rider. Return JSON only through the supplied schema.',
    'Understand informal Bahasa Malaysia, Sarawak/Sabah slang, abbreviations, misspellings, mixed English, and conversational follow-ups.',
    'Use the conversation context. Do not restart onboarding when the customer is asking a question. The customer question always takes priority over collecting name or location.',
    'Choose MODEL_SELECTION only when the customer actually names or clearly refers to a product. Never infer a product from ordinary words such as cash, lama, boleh, tahu, dokumen, harga, sekarang, or a previous unrelated message.',
    'For short follow-ups such as cash berapa, berapa lama, 3 tahun, apa lagi perlu, or ada model lain, resolve the intent against the selected product and last assistant message.',
    'PROCESSING_TIME means the normal Loan Kedai/application processing duration or when a loan result is normally known. FOLLOW_UP_TIME is only for a specific branch price or deposit check that was already queued. Never turn process loan berapa lama into a cash-price confirmation reply.',
    'Loan Kedai is the primary sales path. Do not proactively promote cash purchase. Answer an explicit cash-price question only when requested and then guide the customer back toward Loan Kedai.',
    'If a typo or shorthand clearly matches one catalog choice, return its exact catalogId and exact brand/model spelling. If it is genuinely ambiguous, leave catalogId empty and put the customer wording in normalizedModel.',
    'Default to MS unless the customer clearly prefers English or Chinese. Profanity or obvious anger is FRUSTRATED, not a model name.',
    'suggestedReply is only for a natural clarification or general non-price reply. It must be concise, have no emoji, ask at most one question, never mention AI/automation/internal systems, and never invent prices, deposits, stock, promotions, approval, document status, or timelines.',
    'Set needsHuman when the customer explicitly asks for a person or when the request requires branch confirmation. Set answerCustomerQuestionFirst true whenever the customer asked a business question.'
  ].join(' ');
  const schema = {
    type: 'object', additionalProperties: false,
    properties: {
      intent: { type: 'string', enum: AI_INTENTS },
      language: { type: 'string', enum: ['MS', 'EN', 'ZH'] },
      businessUnit: { type: 'string', enum: ['', 'MOTOR', 'HANDPHONE'] },
      catalogId: { type: 'string' },
      normalizedModel: { type: 'string' },
      tenureYears: { type: 'integer' },
      locationQuery: { type: 'string' },
      customerName: { type: 'string' },
      followUpSubject: { type: 'string', enum: ['NONE', 'CASH_PRICE', 'MONTHLY', 'DEPOSIT', 'DOCUMENTS', 'APPLICATION', 'PROMOTION', 'OTHER'] },
      needsHuman: { type: 'boolean' },
      answerCustomerQuestionFirst: { type: 'boolean' },
      suggestedReply: { type: 'string' },
      confidence: { type: 'number' }
    },
    required: ['intent', 'language', 'businessUnit', 'catalogId', 'normalizedModel', 'tenureYears', 'locationQuery', 'customerName', 'followUpSubject', 'needsHuman', 'answerCustomerQuestionFirst', 'suggestedReply', 'confidence']
  };
  const safetyIdentifier = crypto.createHash('sha256').update(digits(phone) || 'anonymous').digest('hex');
  const model = clean(process.env.OPENAI_INTENT_MODEL || JOMKAKI_KNOWLEDGE.conversation.aiFallback?.model || 'gpt-5.6-terra');
  const reasoningEffort = clean(JOMKAKI_KNOWLEDGE.conversation.aiFallback?.reasoningEffort || 'none');
  const request = {
    model,
    instructions,
    input: JSON.stringify(context),
    text: { format: { type: 'json_schema', name: 'jomkaki_customer_intent', strict: true, schema } },
    max_output_tokens: 500,
    store: false,
    safety_identifier: safetyIdentifier,
    metadata: { workflow: 'jomkaki_whatsapp_intent', knowledge_version: clean(JOMKAKI_KNOWLEDGE.version) }
  };
  if (/^gpt-5\.6/i.test(model)) request.reasoning = { effort: reasoningEffort, context: 'current_turn' };
  return request;
}

export async function requestAiIntent({ text = '', state = {}, lead = {}, routeBusinessUnit = '', routeRegion = '', phone = '', motorCatalog = [], handphoneCatalog = [], env = process.env, fetchImpl = fetch, timeoutMs = AI_FALLBACK_DEFAULT_TIMEOUT_MS } = {}) {
  const apiKey = clean(env.OPENAI_API_KEY);
  const configuredModel = clean(env.OPENAI_INTENT_MODEL || JOMKAKI_KNOWLEDGE.conversation.aiFallback?.model || 'gpt-5.6-terra');
  if (!apiKey || !clean(text)) {
    if (!apiKey) console.warn('openai_intent_unavailable', { reason: 'MISSING_API_KEY', model: configuredModel });
    return null;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(700, Number(timeoutMs) || AI_FALLBACK_DEFAULT_TIMEOUT_MS));
  try {
    const body = buildAiIntentRequest({ text, state, lead, routeBusinessUnit, routeRegion, phone, motorCatalog, handphoneCatalog });
    body.model = configuredModel || body.model;
    if (!/^gpt-5\.6/i.test(body.model)) delete body.reasoning;
    const response = await fetchImpl('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    if (!response.ok) {
      const problem = await response.json().catch(() => ({}));
      console.warn('openai_intent_failed', {
        status: Number(response.status) || 0,
        model: body.model,
        code: clean(problem?.error?.code || problem?.error?.type).slice(0, 80) || 'UNKNOWN'
      });
      return null;
    }
    const result = await response.json().catch(() => ({}));
    const raw = responseOutputText(result);
    const parsed = validAiIntent(JSON.parse(raw));
    if (!parsed) console.warn('openai_intent_failed', { reason: 'INVALID_STRUCTURED_OUTPUT', model: body.model });
    return parsed;
  } catch (error) {
    console.warn('openai_intent_failed', { reason: error?.name === 'AbortError' ? 'TIMEOUT' : 'EXCEPTION', model: configuredModel });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function requestAiFallbackReply({ text = '', state = {}, lead = {}, routeBusinessUnit = '', routeRegion = '', phone = '', env = process.env, fetchImpl = fetch, timeoutMs = AI_FALLBACK_DEFAULT_TIMEOUT_MS } = {}) {
  const apiKey = clean(env.OPENAI_API_KEY);
  const configuredModel = clean(env.OPENAI_MODEL || JOMKAKI_KNOWLEDGE.conversation.aiFallback?.model || 'gpt-5.6-terra');
  if (!apiKey || !clean(text)) {
    if (!apiKey) console.warn('openai_reply_unavailable', { reason: 'MISSING_API_KEY', model: configuredModel });
    return '';
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(500, Number(timeoutMs) || AI_FALLBACK_DEFAULT_TIMEOUT_MS));
  try {
    const body = buildAiFallbackRequest({ text, state, lead, routeBusinessUnit, routeRegion, phone });
    body.model = configuredModel || body.model;
    if (!/^(?:gpt-5|o\d)/i.test(body.model)) delete body.reasoning;
    const response = await fetchImpl('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    if (!response.ok) {
      const problem = await response.json().catch(() => ({}));
      console.warn('openai_reply_failed', {
        status: Number(response.status) || 0,
        model: body.model,
        code: clean(problem?.error?.code || problem?.error?.type).slice(0, 80) || 'UNKNOWN'
      });
      return '';
    }
    const result = await response.json().catch(() => ({}));
    return sanitizeAiFallbackReply(responseOutputText(result), instantLanguage(text, state));
  } catch (error) {
    console.warn('openai_reply_failed', { reason: error?.name === 'AbortError' ? 'TIMEOUT' : 'EXCEPTION', model: configuredModel });
    return '';
  } finally {
    clearTimeout(timer);
  }
}

const productUnitFromText = (text, fallback = '') => /\b(iphone|phone|handphone|telefon|smartphone)\b/i.test(clean(text)) ? 'HANDPHONE' : /\b(motor|moto|motorcycle|yamaha|honda|sym|moda)\b/i.test(clean(text)) ? 'MOTOR' : canonicalBusinessUnit(fallback);
const asksForCashPrice = text => /(?:\b(?:harga\s*)?(?:cash|tunai)\b|\bcash\s*price\b|\bprice\s*(?:cash|outright)\b|\bbayar\s*(?:cash|tunai)\b|\bfull\s*payment\b)/i.test(clean(text));
const asksForLoanProcessingTime = text => /(?:\b(?:proses|process|processing|permohonan|application|loan\s*(?:kedai|shop)?)\b.{0,40}\b(?:berapa\s*lama|berapa\s*hari|how\s*long|how\s*many\s*days|bila\s*(?:boleh\s*)?(?:tau|tahu|dapat))\b|\b(?:berapa\s*lama|berapa\s*hari|how\s*long|bila\s*(?:boleh\s*)?(?:tau|tahu|dapat))\b.{0,40}\b(?:proses|process|processing|permohonan|application|loan)\b)/i.test(clean(text));
const asksHowLongForAnswer = text => /(?:\bberapa\s*lama\b|\bbila\s*(?:boleh\s*)?(?:tau|tahu|dapat)\b|\b(?:nak|mahu)\s*tunggu\s*lama\b|\bhow\s*long\b|\bwhen\s*(?:will|can)\b)/i.test(clean(text));
const followsPendingBranchCheck = state => /(?:semak|pengesahan|confirmation|check).*(?:cawangan|branch)|(?:cawangan|branch).*(?:semak|pengesahan|confirmation|check)|belum ada dalam sistem/i.test(clean(state['Last AI Message']));
const asksForDeposit = text => /(?:\bdeposit\b|\bdepo\b|down\s*payment|downpayment|duit\s*muka|bayaran\s*muka|首付|头期)/i.test(clean(text));
const asksForDocuments = text => /(?:dokumen apa|document apa|apa.*perlu.*(?:loan|apply)|what documents|documents? (?:do )?i need|(?:loan\s*(?:kedai|shop)|shop\s*loan).{0,35}(?:perlukan?|perlu|need|required|kena\s*(?:sedia|hantar)|sediakan).{0,20}(?:apa|ape|what)|(?:apa|ape|what).{0,20}(?:yang\s*)?(?:perlu|need|required|kena\s*sediakan).{0,35}(?:loan\s*(?:kedai|shop)|shop\s*loan)|需要什么文件|要什么文件)/i.test(clean(text));
const wantsToApply = text => /(nak|mahu|want|ready|boleh).*(apply|proceed|teruskan|mohon|loan)|怎么申请|要申请/i.test(clean(text));
const asksAboutShopLoan = text => /(?:\bloan\s*(?:kedai|shop)\b|\b(?:under|bawah)\s*(?:kedai|shop)\b|\bin[ -]?house\s*(?:loan|financing)\b|\bkedai\s*(?:boleh|dapat|dpt|ada)\b)/i.test(clean(text));
const raisesBudgetConcern = text => /(mahal|too expensive|expensive|lebih murah|cheaper|bajet|budget|贵|便宜)/i.test(clean(text));
const asksForOtherModels = text => /(model lain|motor lain|phone lain|telefon lain|apa model.*(?:ada|lain)|other models?|what else.*(?:available|have)|其他型号|别的型号)/i.test(clean(text));
const asksForAvailableModels = text => /(?:\b(?:motor|motosikal|motorcycle|phone|telefon|handphone)\b.*\b(?:apa|what|which)\b.*\b(?:ada|available|have)\b|\b(?:apa|what|which)\b.*\b(?:motor|motosikal|motorcycle|phone|telefon|handphone)\b.*\b(?:ada|available|have)\b|\b(?:ada|available|have)\b.*\b(?:motor|motosikal|motorcycle|phone|telefon|handphone)\b.*\b(?:apa|what|which)\b)/i.test(clean(text));
const customerIsFrustrated = text => /(?:\b(?:tak|tidak|x)\s*faham\b|\b(?:bodoh|stupid|useless|pukimak|puki\s*mak|bangang|bengap)\b|\bwhat\s+are\s+you\s+talking\s+about\b|不明白|很笨|没用)/i.test(clean(text));
const saysThanks = text => /^(?:terima kasih|thanks?(?: you)?|tq|thank you|谢谢|多谢)[.! ]*$/i.test(clean(text));

const conversationalDocumentRequirement = text => asksForDocuments(text)
  || /(?:\b(?:dokumen|document|documents|fail|file)\b.{0,35}\b(?:apa|ape|mana|perlu|need|required|sediakan|hantar)\b|\b(?:apa|ape|what)\b.{0,25}\b(?:yang|yg)?\s*(?:perlu|need|required|kena\s+sediakan)\b|\b(?:perlu|need|required)\b.{0,25}\b(?:apa|ape|what|dokumen|document)\b)/i.test(clean(text));

const modelAliasStopWords = new Set([
  'apple', 'iphone', 'phone', 'handphone', 'telefon', 'motor', 'motorcycle', 'motosikal', 'model',
  'official', 'standard', 'baru', 'new', 'pro', 'max', 'silver', 'black', 'white', 'blue', 'orange',
  'gold', 'green', 'red', 'grey', 'gray', 'scooter', 'skuter', 'cub', 'moped',
  'east', 'west', 'malaysia', 'malaysian', 'sabah', 'sarawak', 'labuan', 'kuching', 'bintulu',
  'miri', 'sibu', 'limbang', 'selangor', 'kuala', 'lumpur', 'penang', 'johor', 'perak', 'kedah',
  'kelantan', 'terengganu', 'pahang', 'melaka', 'negeri', 'sembilan', 'putrajaya'
  , 'berapa', 'lama', 'boleh', 'tau', 'tahu', 'cash', 'tunai', 'harga', 'ansuran', 'deposit', 'bulanan'
  , 'pastu', 'lepas', 'kemudian', 'semak', 'cawangan', 'dokumen', 'untuk', 'dengan', 'yang', 'saya', 'anda'
  , 'nak', 'mahu', 'dapat', 'ada', 'tidak', 'tak', 'sekarang', 'sini', 'balas', 'tunggu'
]);
const compactModelText = value => normalizedWords(value).replace(/\s+/g, '');
const oneEditAway = (left, right) => {
  if (Math.abs(left.length - right.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) { i += 1; j += 1; continue; }
    if (++edits > 1) return false;
    if (left.length > right.length) i += 1;
    else if (right.length > left.length) j += 1;
    else { i += 1; j += 1; }
  }
  return edits + Number(i < left.length || j < right.length) <= 1;
};

const oneModelTypoAway = (left, right) => {
  if (oneEditAway(left, right)) return true;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length - 1; index += 1) {
    if (left[index] !== right[index + 1] || left[index + 1] !== right[index]) continue;
    if (`${left.slice(0, index)}${left[index + 1]}${left[index]}${left.slice(index + 2)}` === right) return true;
  }
  return false;
};

const addModelAlias = (aliases, value) => {
  const alias = normalizedWords(value);
  if (compactModelText(alias).length >= 2) aliases.add(alias);
};

const modelQueryCandidates = value => {
  const words = normalizedWords(value).split(' ').filter(Boolean), candidates = new Set();
  addModelAlias(candidates, words.join(' '));
  for (let start = 0; start < words.length; start += 1) {
    for (let end = start + 1; end <= Math.min(words.length, start + 6); end += 1) addModelAlias(candidates, words.slice(start, end).join(' '));
  }
  return [...candidates].map(candidate => ({ words: candidate, compact: compactModelText(candidate) }));
};

const productAliases = row => {
  const model = normalizedWords(row.Model), brand = normalizedWords(row.Brand), words = model.split(' ').filter(Boolean);
  const aliases = new Set();
  addModelAlias(aliases, model);
  addModelAlias(aliases, `${brand} ${model}`);
  for (let start = 0; start < words.length; start += 1) {
    for (let end = start + 1; end <= words.length; end += 1) {
      const phrase = words.slice(start, end).join(' ');
      if (compactModelText(phrase).length >= 3) addModelAlias(aliases, phrase);
    }
    const shorthand = words.slice(start).map(word => /^\d/.test(word) ? word : word[0]).join('');
    if (shorthand.length >= 3) addModelAlias(aliases, shorthand);
  }
  for (const word of normalizedWords(row['Search Keywords']).split(' ')) {
    if ((word.length >= 3 || /^\d{2,}$/.test(word)) && !modelAliasStopWords.has(word)) addModelAlias(aliases, word);
  }
  for (const word of words) {
    const match = word.match(/^([a-z]+)(\d+)([a-z]+)?$/i);
    if (match) {
      if (match[1].length >= 2) addModelAlias(aliases, match[1]);
      if (match[2].length >= 2) addModelAlias(aliases, match[2]);
      addModelAlias(aliases, `${match[1]}${match[2]}`);
      if (match[3]) addModelAlias(aliases, `${match[2]}${match[3]}`);
    }
  }
  for (let index = 0; index < words.length - 1; index += 1) {
    const base = words[index].match(/^([a-z]{2,})\d+[a-z]*$/i);
    const version = words[index + 1].match(/^([a-z]+)(\d+)[a-z]*$/i);
    if (!base || !version) continue;
    addModelAlias(aliases, `${base[1]} ${words[index + 1]}`);
    addModelAlias(aliases, `${base[1]}${words[index + 1]}`);
    addModelAlias(aliases, `${base[1]}${version[2]}`);
  }
  if (words[0] === 'iphone') {
    const phoneWords = words.slice(1), phoneCompact = compactModelText(phoneWords.join(' '));
    const phoneShort = phoneWords.map(word => /^\d/.test(word) ? word : word[0]).join('');
    addModelAlias(aliases, `ip${phoneCompact}`);
    addModelAlias(aliases, `ip${phoneShort}`);
    addModelAlias(aliases, `iphone${phoneCompact}`);
    addModelAlias(aliases, phoneWords.join(' ').replace(/pro max/g, 'promax'));
  }
  return [...aliases].filter(alias => compactModelText(alias).length >= 2);
};

export function matchInstantProduct(text, catalogs = []) {
  const query = normalizedWords(text), compactQuery = compactModelText(text), queryCandidates = modelQueryCandidates(text);
  if (!query || !compactQuery) return { product: null, options: [], ambiguous: false };
  const activeCatalog = catalogs.filter(row => truth(row.Active));
  const aliasModels = new Map();
  for (const row of activeCatalog) {
    const modelKey = `${clean(row.__businessUnit).toUpperCase()}|${normalizedWords(row.Model)}`;
    for (const alias of productAliases(row)) {
      const aliasKey = compactModelText(alias);
      if (!aliasModels.has(aliasKey)) aliasModels.set(aliasKey, new Set());
      aliasModels.get(aliasKey).add(modelKey);
    }
  }
  const matches = activeCatalog.map(row => {
    const model = normalizedWords(row.Model), compactModel = compactModelText(row.Model);
    let score = 0;
    if (query === model) score = 2400;
    else if (compactQuery === compactModel) score = 2300;
    else if (model && includesTerm(query, model)) score = 2200;
    else if (compactModel.length >= 4 && queryCandidates.some(candidate => candidate.compact === compactModel)) score = 2100;
    for (const alias of productAliases(row)) {
      const compactAlias = compactModelText(alias);
      const numericOnlyAlias = /^\d+$/.test(compactAlias);
      const sharedAlias = (aliasModels.get(compactAlias)?.size || 0) > 1;
      const brandOnlyAlias = compactAlias === compactModelText(row.Brand);
      const lowConfidenceAlias = numericOnlyAlias || brandOnlyAlias;
      if (query === alias || compactQuery === compactAlias) score = Math.max(score, (lowConfidenceAlias ? 900 : sharedAlias ? 1200 : 1900) + compactAlias.length);
      else if (alias.length >= 3 && includesTerm(query, alias)) score = Math.max(score, (lowConfidenceAlias ? 900 : sharedAlias ? 1100 : 1800) + compactAlias.length);
      else if (compactAlias.length >= 3 && queryCandidates.some(candidate => candidate.compact === compactAlias)) score = Math.max(score, (lowConfidenceAlias ? 900 : sharedAlias ? 1100 : 1700) + compactAlias.length);
      else if (compactAlias.length >= 4 && queryCandidates.some(candidate => candidate.compact.length >= 4 && oneModelTypoAway(candidate.compact, compactAlias))) score = Math.max(score, 1500 + compactAlias.length);
    }
    return { row, score, modelKey: `${clean(row.__businessUnit).toUpperCase()}|${normalizedWords(row.Model)}` };
  }).filter(match => match.score >= 1000);
  const bestByModel = new Map();
  for (const match of matches) if (!bestByModel.has(match.modelKey) || bestByModel.get(match.modelKey).score < match.score) bestByModel.set(match.modelKey, match);
  const ranked = [...bestByModel.values()].sort((a, b) => b.score - a.score || clean(a.row.Model).localeCompare(clean(b.row.Model)));
  if (!ranked.length) return { product: null, options: [], ambiguous: false };
  const close = ranked.filter(match => match.score >= ranked[0].score - 80);
  if (close.length > 1) {
    const options = close.slice(0, 4).map(match => `${clean(match.row.Brand)} ${clean(match.row.Model)}`.trim());
    return { product: null, options, ambiguous: true };
  }
  return { product: ranked[0].row, options: [], ambiguous: false };
}

const requestedMonthlyTenure = (value = '', unit = '') => {
  const text = normalizedWords(value);
  const monthMatch = text.match(/\b(12|24|36|48|60)\s*(?:bulan|month|months)\b/);
  if (monthMatch) return `${monthMatch[1]} months`;
  const yearMatch = text.match(/\b([1-5])\s*(?:tahun|year|years|yr|yrs|thn)\b/);
  if (!yearMatch) return '';
  return canonicalBusinessUnit(unit) === 'HANDPHONE' ? `${Number(yearMatch[1]) * 12} months` : `${yearMatch[1]} years`;
};

const instantRate = (product, pricingRows = [], unit = '', region = '', requestedTenure = '') => {
  if (!product) return null;
  const normalizedRegion = canonicalRegion(region);
  const candidates = pricingRows.filter(row => {
    const zone = clean(row['Price Zone']).toUpperCase();
    const applicableRegion = !normalizedRegion || canonicalRegion(zone) === normalizedRegion || ['ALL_BRANCHES', 'ALL'].includes(zone);
    return clean(row['Catalog ID']) === clean(product['Catalog ID']) && truth(row.Active) && ['APPROVED', ''].includes(clean(row['Quote Approval Status']).toUpperCase()) && applicableRegion;
  });
  const ranked = candidates.sort((a, b) => {
    const zone = row => clean(row['Price Zone']).toUpperCase();
    const score = row => canonicalRegion(zone(row)) === normalizedRegion ? 3 : zone(row) === 'ALL_BRANCHES' || zone(row) === 'ALL' ? 2 : 1;
    return score(b) - score(a);
  });
  const row = ranked[0];
  if (!row) return null;
  const rates = approvedMonthlyRateFields(unit)
    .filter(([tenure]) => !requestedTenure || normalizedWords(tenure) === normalizedWords(requestedTenure))
    .map(([tenure, field]) => [tenure, row[field]]);
  const selected = rates.find(([, amount]) => customerAmount(amount));
  const motorUnit = canonicalBusinessUnit(unit) === 'MOTOR';
  const deposit = motorUnit
    ? customerAmount(row['Deposit (RM)'] || row.Deposit || row['Down Payment (RM)'])
    : '';
  const cashPrice = motorUnit
    ? customerAmount(row['Cash Price (RM)'] || row['Product Price (RM)'] || row['Selling Price (RM)'] || row['OTR Cash Price (RM)'])
    : '';
  return selected ? { tenure: selected[0], amount: customerAmount(selected[1]), deposit, cashPrice } : null;
};

const activeMotorPromotions = (catalogRows = [], pricingRows = [], region = '', today = new Date().toISOString().slice(0, 10)) => {
  const normalizedRegion = canonicalRegion(region);
  const products = new Map(catalogRows.filter(row => truth(row.Active)).map(row => [clean(row['Catalog ID']), row]));
  const promotions = pricingRows.filter(row => {
    const zone = clean(row['Price Zone']).toUpperCase();
    const appliesToRegion = !normalizedRegion || canonicalRegion(zone) === normalizedRegion || ['ALL_BRANCHES', 'ALL'].includes(zone);
    const start = clean(row['Promotion Start']), end = clean(row['Promotion End']);
    return products.has(clean(row['Catalog ID']))
      && truth(row.Active)
      && ['APPROVED', ''].includes(clean(row['Quote Approval Status']).toUpperCase())
      && truth(row['Promotion Active'])
      && clean(row['Promotion Approval Status']).toUpperCase() === 'APPROVED'
      && appliesToRegion
      && (!start || start <= today)
      && (!end || end >= today);
  }).map(row => ({ row, product: products.get(clean(row['Catalog ID'])) }));
  const seen = new Set();
  return promotions.filter(({ product }) => {
    const key = `${normalizedWords(product.Brand)}|${normalizedWords(product.Model)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const promotionOptionText = ({ row = {}, product = {} } = {}) => {
  const model = [clean(product.Brand), clean(product.Model)].filter(Boolean).join(' ');
  const name = clean(row['Promotion Name']);
  const deposit = customerAmount(row['Promotion Deposit (RM)']);
  return [model, name ? `(${name})` : '', deposit ? `deposit RM${deposit}` : ''].filter(Boolean).join(' ');
};

const availableModelSuggestions = (catalogRows = [], pricingRows = [], unit = '', region = '', limit = 3) => catalogRows
  .filter(row => {
    const rowUnit = clean(row.__businessUnit).toUpperCase() || canonicalBusinessUnit(unit);
    return rowUnit === canonicalBusinessUnit(unit) && instantRate(row, pricingRows, rowUnit, region);
  })
  .filter((row, index, rows) => rows.findIndex(item => normalizedWords(item.Model) === normalizedWords(row.Model)) === index)
  .slice(0, limit)
  .map(row => `${clean(row.Brand)} ${clean(row.Model)}`.trim());

export function buildInstantSalesDecision({ state = {}, lead = {}, documents = [], text = '', messageType = 'text', routeBusinessUnit = '', routeRegion = '', branches = [], motorCatalog = [], motorPricing = [], handphoneCatalog = [], handphonePricing = [], aiIntent = null, suppressDocumentAcknowledgement = false } = {}) {
  const interpretedIntent = clean(aiIntent?.intent).toUpperCase();
  const language = ['MS', 'EN', 'ZH'].includes(clean(aiIntent?.language).toUpperCase()) ? clean(aiIntent.language).toUpperCase() : instantLanguage(text, state);
  const step = clean(state['Current Step']).toUpperCase();
  if (['image', 'document'].includes(clean(messageType).toLowerCase())) return suppressDocumentAcknowledgement
    ? { handled: false, documentQueued: true, nextStep: step || 'STEP_04_DOCUMENTS', text: '' }
    : { handled: true, documentQueued: true, nextStep: step || 'STEP_04_DOCUMENTS', text: instantCopy(language, 'DOCUMENT') };
  if (!['text', 'button', 'interactive'].includes(clean(messageType).toLowerCase())) return { handled: false };
  const simpleTextGreeting = /^(?:hi|hello|hey|hai)[!. ]*$/i.test(clean(text)) || (!step && !clean(text));
  if (simpleTextGreeting) {
    const returningName = usableCustomerName(state['Customer Name'] || lead['Customer Name']);
    const returningLocation = clean(lead['City or Area'] || lead.State);
    if (!returningName) return { handled: true, nextStep: 'STEP_01_NAME', text: instantCopy(language, 'NAME') };
    if (!returningLocation) return { handled: true, nextStep: 'STEP_02_LOCATION', customerName: returningName, text: instantCopy(language, 'LOCATION', { name: returningName }) };
    return { handled: true, nextStep: step || 'STEP_03_PRODUCT', text: instantCopy(language, 'RETURNING_GREETING', { name: returningName }) };
  }
  if (/^(hi|hello|hey|hai|你好|嗨)[!. ]*$/i.test(clean(text)) || (!step && !clean(text))) return { handled: true, nextStep: 'STEP_01_NAME', text: instantCopy(language, 'NAME') };
  const explicitUnit = canonicalBusinessUnit(aiIntent?.businessUnit) || productUnitFromText(text, ''), fallbackUnit = canonicalBusinessUnit(state['Product Category'] || routeBusinessUnit);
  const allCatalogs = [
    ...motorCatalog.map(row => ({ ...row, __businessUnit: 'MOTOR' })),
    ...handphoneCatalog.map(row => ({ ...row, __businessUnit: 'HANDPHONE' }))
  ];
  const selectedModel = normalizedWords(state['Selected Product Model']);
  const selectedBrand = normalizedWords(state['Selected Product Brand']);
  const previousCustomerText = clean(state['Last Customer Message']);
  const frustrationDetected = interpretedIntent === 'FRUSTRATED' || customerIsFrustrated(text);
  const recoveringDocumentQuestion = frustrationDetected && conversationalDocumentRequirement(previousCustomerText);
  const documentStatusQuestion = interpretedIntent === 'DOCUMENT_STATUS'
    || (isDocumentStatusQuestion(text) && (documents.length > 0 || /\b(?:dah|sudah|semua|lagi|kurang|missing|lengkap|complete|status|semak|check)\b/i.test(clean(text))));
  const documentRequirementQuestion = interpretedIntent === 'DOCUMENT_REQUIREMENTS'
    || interpretedIntent === 'APPLY'
    || conversationalDocumentRequirement(text)
    || wantsToApply(text)
    || (isDocumentStatusQuestion(text) && !!selectedModel);
  if (documentStatusQuestion) {
    return { handled: true, nextStep: 'STEP_04_DOCUMENTS', productUnit: explicitUnit || fallbackUnit || 'MOTOR', text: buildDocumentProgressReply(language, documents) };
  }
  if (documentRequirementQuestion) {
    const continuation = profileContinuation({ language, state, lead, baseText: instantCopy(language, 'APPLY'), completeStep: 'STEP_04_DOCUMENTS' });
    return { handled: true, documentRequirementsIntent: true, nextStep: continuation.nextStep, productUnit: explicitUnit || fallbackUnit || 'MOTOR', text: continuation.text };
  }
  if (recoveringDocumentQuestion) {
    return {
      handled: true,
      serviceRecovery: true,
      documentRequirementsIntent: true,
      nextStep: 'STEP_04_DOCUMENTS',
      productUnit: explicitUnit || fallbackUnit || 'MOTOR',
      text: instantCopy(language, 'DOCUMENT_REQUIREMENTS_RECOVERY')
    };
  }
  const unitOnly = /^(?:motor|moto|motorcycle|motosikal|phone|handphone|telefon|iphone)[!. ]*$/i.test(clean(text));
  if (unitOnly) {
    const unit = explicitUnit || fallbackUnit || productUnitFromText(text, '') || 'MOTOR';
    const repeatedUnit = normalizedWords(previousCustomerText) === normalizedWords(text);
    const unitPricing = unit === 'HANDPHONE' ? handphonePricing : motorPricing;
    const suggestions = repeatedUnit ? availableModelSuggestions(allCatalogs, unitPricing, unit, lead.Region || routeRegion) : [];
    const baseText = suggestions.length
      ? instantCopy(language, 'AVAILABLE_MODELS', { models: suggestions.join(language === 'ZH' ? '、' : ', ') })
      : instantCopy(language, unit === 'HANDPHONE' ? 'HANDPHONE_MODEL' : 'MOTOR_MODEL');
    return { handled: true, productIntent: true, nextStep: 'STEP_03_PRODUCT', productUnit: unit, text: baseText };
  }
  if (interpretedIntent === 'PROCESSING_TIME' || asksForLoanProcessingTime(text)) {
    return { handled: true, aiUnderstood: !!interpretedIntent, loanKedaiIntent: true, nextStep: step || 'STEP_03_PRODUCT', productUnit: explicitUnit || fallbackUnit || 'MOTOR', text: instantCopy(language, 'LOAN_PROCESSING_TIME') };
  }
  if ((interpretedIntent === 'FOLLOW_UP_TIME' || asksHowLongForAnswer(text)) && followsPendingBranchCheck(state)) {
    return { handled: true, aiUnderstood: !!interpretedIntent, nextStep: step || 'STEP_03_PRODUCT', productUnit: explicitUnit || fallbackUnit || 'MOTOR', text: instantCopy(language, 'FOLLOW_UP_TIME') };
  }
  if (interpretedIntent === 'PROMOTION' || asksForPromotion(text)) {
    const inlineLocation = resolveCustomerLocation(aiIntent?.locationQuery || text, 'MOTOR', branches);
    const hasStoredLocation = !!clean(lead['City or Area'] || lead.State);
    const hasLocation = hasStoredLocation || !!inlineLocation;
    const promotionRegion = inlineLocation?.region || lead.Region || routeRegion;
    const promotions = hasLocation ? activeMotorPromotions(motorCatalog, motorPricing, promotionRegion) : [];
    const promotionAnswer = hasLocation
      ? instantCopy(language, promotions.length ? 'PROMOTION_LIST' : 'PROMOTION_NONE', { options: promotions.slice(0, 3).map(promotionOptionText).join('; ') })
      : instantCopy(language, 'PROMOTION_LOCATION');
    const baseText = [
      promotionAnswer,
      !hasLocation && usableCustomerName(state['Customer Name'] || lead['Customer Name']) ? instantCopy(language, 'LOCATION_AFTER_ANSWER') : ''
    ].filter(Boolean).join(' ');
    const continuationLead = inlineLocation ? { ...lead, Region: inlineLocation.region, State: inlineLocation.state, 'City or Area': inlineLocation.city } : lead;
    const continuation = profileContinuation({ language, state, lead: continuationLead, baseText, completeStep: step || 'STEP_03_PRODUCT' });
    const needsModelQuestion = hasLocation && continuation.nextStep === (step || 'STEP_03_PRODUCT');
    return {
      handled: true,
      promotionIntent: true,
      nextStep: continuation.nextStep,
      productUnit: 'MOTOR',
      location: inlineLocation || undefined,
      text: [continuation.text, needsModelQuestion ? instantCopy(language, 'PROMOTION_MODEL') : ''].filter(Boolean).join(' ')
    };
  }
  if (step === 'STEP_02_LOCATION' && (!interpretedIntent || interpretedIntent === 'PROVIDE_LOCATION')) {
    const location = resolveCustomerLocation(aiIntent?.locationQuery || text, productUnitFromText(text, routeBusinessUnit), branches);
    if (location) return {
      handled: true,
      nextStep: 'STEP_03_PRODUCT',
      productUnit: canonicalBusinessUnit(state['Product Category'] || routeBusinessUnit),
      location,
      text: instantCopy(language, 'PRODUCT', { location: location.city || location.state })
    };
  }
  const catalogPool = explicitUnit ? allCatalogs.filter(row => row.__businessUnit === explicitUnit) : allCatalogs;
  const requestedTenure = aiIntent?.tenureYears
    ? (canonicalBusinessUnit(explicitUnit || fallbackUnit || routeBusinessUnit) === 'HANDPHONE' ? `${Number(aiIntent.tenureYears) * 12} months` : `${aiIntent.tenureYears} years`)
    : requestedMonthlyTenure(text, fallbackUnit || routeBusinessUnit);
  const cashPriceQuestion = interpretedIntent === 'CASH_PRICE' || asksForCashPrice(text);
  const depositQuestion = interpretedIntent === 'DEPOSIT' || asksForDeposit(text);
  if ((requestedTenure || depositQuestion || cashPriceQuestion) && selectedModel) {
    const selectedProduct = catalogPool.find(row => normalizedWords(row.Model) === selectedModel && (!selectedBrand || normalizedWords(row.Brand) === selectedBrand));
    if (selectedProduct) {
      const selectedUnit = clean(selectedProduct.__businessUnit).toUpperCase() || fallbackUnit || routeBusinessUnit || 'MOTOR';
      const selectedPricing = selectedUnit === 'HANDPHONE' ? handphonePricing : motorPricing;
      const requestedRate = instantRate(selectedProduct, selectedPricing, selectedUnit, lead.Region || routeRegion, requestedTenure);
      const baseText = cashPriceQuestion
        ? instantCopy(language, selectedUnit === 'HANDPHONE'
          ? 'HANDPHONE_CASH_POLICY'
          : requestedRate?.cashPrice ? 'CASH_PRICE_QUOTE' : 'CASH_PRICE_UNAVAILABLE', {
          brand: selectedProduct.Brand, model: selectedProduct.Model, cashPrice: requestedRate?.cashPrice
        })
        : depositQuestion
          ? instantCopy(language, selectedUnit === 'HANDPHONE'
          ? 'HANDPHONE_DEPOSIT_POLICY'
          : requestedRate?.deposit ? 'DEPOSIT_QUOTE' : 'DEPOSIT_UNAVAILABLE', {
          brand: selectedProduct.Brand, model: selectedProduct.Model, deposit: requestedRate?.deposit
        })
        : instantCopy(language, requestedRate ? 'TENURE_QUOTE' : 'TENURE_UNAVAILABLE', {
          brand: selectedProduct.Brand, model: selectedProduct.Model, tenure: requestedTenure, amount: requestedRate?.amount
        });
      const continuation = cashPriceQuestion
        ? { nextStep: step || 'STEP_04_DOCUMENTS', text: baseText }
        : requestedRate
        ? profileContinuation({ language, state, lead, baseText, completeStep: step || 'STEP_03_PRODUCT' })
        : { nextStep: 'STEP_03_PRODUCT', text: baseText };
      return {
        handled: true,
        productIntent: true,
        cashPriceIntent: cashPriceQuestion || undefined,
        nextStep: continuation.nextStep,
        productUnit: selectedUnit,
        product: selectedProduct,
        text: continuation.text,
        humanFollowUpRequired: (cashPriceQuestion && selectedUnit === 'MOTOR' && !requestedRate?.cashPrice) || (depositQuestion && selectedUnit === 'MOTOR' && !requestedRate?.deposit) || undefined
      };
    }
  }
  const aiSelectedProduct = clean(aiIntent?.catalogId)
    ? allCatalogs.find(row => clean(row['Catalog ID']) === clean(aiIntent.catalogId))
    : null;
  let productMatch = aiSelectedProduct
    ? { product: aiSelectedProduct, options: [], ambiguous: false }
    : matchInstantProduct(aiIntent?.normalizedModel || text, catalogPool);
  const mayContinueClarification = ['STEP_03_PRODUCT', 'STEP_04_DOCUMENTS'].includes(step)
    && previousCustomerText && previousCustomerText !== clean(text)
    && previousCustomerText.length <= 80 && clean(text).length <= 40
    && !requestedTenure && !interpretedIntent && (!productMatch.product || productMatch.ambiguous);
  if (mayContinueClarification) {
    const contextualMatch = matchInstantProduct(`${previousCustomerText} ${text}`, catalogPool);
    if (contextualMatch.product && !contextualMatch.ambiguous) productMatch = contextualMatch;
    else if (contextualMatch.ambiguous && (!productMatch.ambiguous || contextualMatch.options.length < productMatch.options.length)) productMatch = contextualMatch;
  }
  let product = productMatch.product;
  let unit = clean(product?.__businessUnit).toUpperCase() || explicitUnit || fallbackUnit || 'MOTOR';
  let pricing = unit === 'HANDPHONE' ? handphonePricing : motorPricing;
  const knownName = clean(state['Customer Name'] || lead['Customer Name']);
  const locationConfirmed = !!clean(lead['City or Area'] || lead.State);
  const identityReady = !!knownName && !/^WhatsApp Customer\b/i.test(knownName) && !!clean(lead.Region || routeRegion) && locationConfirmed;
  if (productMatch.ambiguous) {
    const formattedOptions = productMatch.options.join(language === 'ZH' ? '、' : ' atau ');
    return { handled: true, productIntent: true, nextStep: 'STEP_03_PRODUCT', productUnit: unit, text: instantCopy(language, 'MODEL_CLARIFY', { options: formattedOptions }) };
  }
  if (product) {
    const pricingRegion = lead.Region || routeRegion;
    let rate = instantRate(product, pricing, unit, pricingRegion);
    if (!rate) {
      const pricedCatalog = catalogPool.filter(row => {
        const rowUnit = clean(row.__businessUnit).toUpperCase() || unit;
        const rowPricing = rowUnit === 'HANDPHONE' ? handphonePricing : motorPricing;
        return instantRate(row, rowPricing, rowUnit, pricingRegion);
      });
      const pricedMatch = matchInstantProduct(text, pricedCatalog);
      if (pricedMatch.product && !pricedMatch.ambiguous) {
        product = pricedMatch.product;
        unit = clean(product.__businessUnit).toUpperCase() || unit;
        pricing = unit === 'HANDPHONE' ? handphonePricing : motorPricing;
        rate = instantRate(product, pricing, unit, pricingRegion);
      }
    }
    if (cashPriceQuestion) {
      return {
        handled: true,
        productIntent: true,
        cashPriceIntent: true,
        nextStep: step || 'STEP_03_PRODUCT',
        productUnit: unit,
        product,
        text: instantCopy(language, unit === 'HANDPHONE'
          ? 'HANDPHONE_CASH_POLICY'
          : rate?.cashPrice ? 'CASH_PRICE_QUOTE' : 'CASH_PRICE_UNAVAILABLE', {
          brand: product.Brand, model: product.Model, cashPrice: rate?.cashPrice
        }),
        humanFollowUpRequired: unit === 'MOTOR' && !rate?.cashPrice ? true : undefined
      };
    }
    if (!rate) {
      const continuation = profileContinuation({
        language, state, lead,
        baseText: instantCopy(language, 'MODEL_UNAVAILABLE', { brand: product.Brand, model: product.Model }),
        completeStep: 'STEP_03_PRODUCT'
      });
      return { handled: true, productIntent: true, nextStep: continuation.nextStep, productUnit: unit, product, text: continuation.text, humanFollowUpRequired: true };
    }
    const sameSelectedProduct = normalizedWords(product.Model) === selectedModel && (!selectedBrand || normalizedWords(product.Brand) === selectedBrand);
    const approvedImage = !sameSelectedProduct && truth(product['Image Approved']) && /^https:\/\//i.test(clean(product['Image URL'])) ? clean(product['Image URL']) : '';
    const continuation = identityReady
      ? { nextStep: 'STEP_04_DOCUMENTS', text: instantCopy(language, 'QUOTE', { brand: product.Brand, model: product.Model, tenure: rate.tenure, amount: rate.amount, deposit: rate.deposit }) }
      : profileContinuation({
        language, state, lead,
        baseText: instantCopy(language, 'QUOTE_ONLY', { brand: product.Brand, model: product.Model, tenure: rate.tenure, amount: rate.amount, deposit: rate.deposit }),
        completeStep: 'STEP_04_DOCUMENTS'
      });
    return {
      handled: true,
      productIntent: true,
      nextStep: continuation.nextStep,
      productUnit: unit,
      product,
      imageUrl: approvedImage,
      text: continuation.text
    };
  }
  if (interpretedIntent === 'SHOP_LOAN' || asksAboutShopLoan(text)) {
    const continuation = profileContinuation({
      language,
      state,
      lead,
      baseText: instantCopy(language, 'SHOP_LOAN'),
      completeStep: step || 'STEP_03_PRODUCT'
    });
    const needsModelQuestion = continuation.nextStep === 'STEP_03_PRODUCT' && !selectedModel;
    return {
      handled: true,
      shopLoanIntent: true,
      nextStep: continuation.nextStep,
      productUnit: unit,
      text: [continuation.text, needsModelQuestion ? instantCopy(language, 'SHOP_LOAN_MODEL') : ''].filter(Boolean).join(' ')
    };
  }
  if (interpretedIntent === 'DOCUMENT_STATUS' || (step === 'STEP_04_DOCUMENTS' && isDocumentStatusQuestion(text))) {
    return { handled: true, nextStep: 'STEP_04_DOCUMENTS', productUnit: unit, text: buildDocumentProgressReply(language, documents) };
  }
  if (interpretedIntent === 'DOCUMENT_REQUIREMENTS' || interpretedIntent === 'APPLY' || conversationalDocumentRequirement(text) || wantsToApply(text)) {
    const continuation = profileContinuation({ language, state, lead, baseText: instantCopy(language, 'APPLY'), completeStep: 'STEP_04_DOCUMENTS' });
    return { handled: true, nextStep: continuation.nextStep, productUnit: unit, text: continuation.text };
  }
  if (interpretedIntent === 'BUDGET' || raisesBudgetConcern(text)) return { handled: true, nextStep: 'STEP_03_PRODUCT', productUnit: unit, text: instantCopy(language, 'BUDGET') };
  const suggestionPricing = unit === 'HANDPHONE' ? handphonePricing : motorPricing;
  const suggestions = availableModelSuggestions(catalogPool, suggestionPricing, unit, lead.Region || routeRegion);
  const suggestionText = suggestions.join(language === 'ZH' ? '、' : ', ');
  if (frustrationDetected) {
    return { handled: true, serviceRecovery: true, nextStep: 'STEP_03_PRODUCT', productUnit: unit, text: instantCopy(language, 'SERVICE_RECOVERY', { models: suggestionText }) };
  }
  if (['OTHER_MODELS', 'AVAILABLE_MODELS'].includes(interpretedIntent) || asksForOtherModels(text) || asksForAvailableModels(text)) {
    if (suggestions.length) return {
      handled: true,
      availableModelsIntent: true,
      nextStep: 'STEP_03_PRODUCT',
      productUnit: unit,
      text: instantCopy(language, interpretedIntent === 'AVAILABLE_MODELS' || asksForAvailableModels(text) ? 'AVAILABLE_MODELS' : 'OTHER_MODELS', { models: suggestionText })
    };
  }
  if (interpretedIntent === 'THANKS' || saysThanks(text)) return { handled: true, nextStep: step || 'STEP_03_PRODUCT', productUnit: unit, text: instantCopy(language, 'THANKS') };
  if ((step === 'STEP_01_NAME' || !step || step === 'STEP_01_WELCOME') && (!interpretedIntent || interpretedIntent === 'PROVIDE_NAME')) {
    const name = clean(aiIntent?.customerName) || extractCustomerName(text);
    return name
      ? { handled: true, nextStep: 'STEP_02_LOCATION', customerName: name, text: instantCopy(language, 'LOCATION', { name }) }
      : { handled: true, nextStep: 'STEP_01_NAME', text: instantCopy(language, 'NAME_RETRY') };
  }
  if (step === 'STEP_02_LOCATION' && (!interpretedIntent || interpretedIntent === 'PROVIDE_LOCATION')) {
    const location = resolveCustomerLocation(aiIntent?.locationQuery || text, productUnitFromText(text, routeBusinessUnit), branches);
    return location
      ? { handled: true, nextStep: 'STEP_03_PRODUCT', location, text: instantCopy(language, 'PRODUCT', { location: location.city || location.state }) }
      : { handled: true, nextStep: 'STEP_02_LOCATION', text: instantCopy(language, 'LOCATION_RETRY') };
  }
  if (interpretedIntent === 'MODEL_SELECTION' || (!interpretedIntent && (step === 'STEP_03_PRODUCT' || /\b(motor|moto|motorcycle|phone|handphone|telefon|iphone)\b/i.test(clean(text))))) return { handled: true, nextStep: 'STEP_03_PRODUCT', productUnit: unit, text: instantCopy(language, 'MODEL') };
  if (aiIntent?.suggestedReply) return { handled: true, aiGenerated: true, aiUnderstood: true, nextStep: step || 'STEP_03_PRODUCT', productUnit: unit, text: aiIntent.suggestedReply };
  return { handled: true, aiFallback: true, nextStep: step || 'STEP_03_PRODUCT', productUnit: unit, text: instantCopy(language, 'HELP') };
}

export function guardConversationProgress({ state = {}, documents = [], text = '', decision = {} } = {}) {
  const currentStep = clean(state['Current Step']).toUpperCase();
  const nextStep = clean(decision.nextStep).toUpperCase();
  if (!decision.handled || currentStep !== 'STEP_04_DOCUMENTS' || !['STEP_01_WELCOME', 'STEP_01_NAME', 'STEP_02_LOCATION'].includes(nextStep)) return decision;
  const language = instantLanguage(text, state);
  const documentQuestion = isDocumentStatusQuestion(text) || conversationalDocumentRequirement(text) || wantsToApply(text);
  const withoutRestartQuestion = clean(decision.text).replace(
    /\s*(?:Boleh saya tahu nama anda(?: supaya[^?]*)?|Boleh saya tahu anda (?:tinggal|berada) di bandar atau negeri mana|May I know your name|What is your name|Which city or state are you in)\??\s*$/i,
    ''
  ).trim();
  return {
    ...decision,
    nextStep: 'STEP_04_DOCUMENTS',
    text: documentQuestion ? buildDocumentProgressReply(language, documents) : (withoutRestartQuestion || instantCopy(language, 'HELP')),
    conversationProgressGuarded: true
  };
}

export function instantChannelCredentials(route = {}, env = process.env) {
  const channelId = clean(route['Internal Channel ID']);
  const phoneNumberId = clean(route['Phone Number ID']);
  const credentialKey = credentialPrefix(route['Credential Key'] || channelId);
  const accessToken = clean(env[`${credentialKey}_ACCESS_TOKEN`]);
  if (!channelId || !phoneNumberId || !credentialKey || !accessToken) throw new Error('Instant WhatsApp route credentials are incomplete');
  return { channelId, phoneNumberId, accessToken, version: clean(env.WHATSAPP_GRAPH_VERSION || 'v25.0') };
}

async function sendInstantSalesMessage({ route, phone, decision }) {
  if (!decision?.handled || !clean(decision.text) || clean(process.env.WHATSAPP_SEND_MODE).toUpperCase() !== 'CLOUD') return { sent: false, skipped: 'INSTANT_SALES_DISABLED' };
  const binding = instantChannelCredentials(route);
  const imageUrl = clean(decision.imageUrl);
  const documentUrl = clean(decision.documentUrl);
  const payload = documentUrl
    ? { messaging_product: 'whatsapp', recipient_type: 'individual', to: digits(phone), type: 'document', document: { link: documentUrl, filename: clean(decision.documentFilename) || 'JomKaki Rider CTOS CCRIS Consent Form.pdf', caption: clean(decision.text).slice(0, 1024) } }
    : imageUrl
    ? { messaging_product: 'whatsapp', recipient_type: 'individual', to: digits(phone), type: 'image', image: { link: imageUrl, caption: clean(decision.text).slice(0, 1024) } }
    : { messaging_product: 'whatsapp', recipient_type: 'individual', to: digits(phone), type: 'text', text: { preview_url: false, body: clean(decision.text) } };
  const response = await fetch(`https://graph.facebook.com/${binding.version}/${binding.phoneNumberId}/messages`, {
    method: 'POST',
    headers: { authorization: `Bearer ${binding.accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const result = await response.json().catch(() => ({}));
  return {
    sent: response.ok,
    binding,
    providerMessageId: clean(result.messages?.[0]?.id),
    error: response.ok ? '' : clean(result.error?.message) || `Meta API error ${response.status}`,
    messageType: documentUrl
      ? 'DOCUMENT'
      : imageUrl
      ? (decision.productUnit === 'HANDPHONE' ? 'HANDPHONE_IMAGE' : 'MOTOR_IMAGE')
      : 'TEXT'
  };
}

async function sendImmediateAcknowledgement(token, { route, phone, text, messageType, messageId, lead, application, receivedAt, businessUnit, teamId }) {
  if (clean(process.env.WHATSAPP_SEND_MODE).toUpperCase() !== 'CLOUD') return { sent: false, skipped: 'CLOUD_MODE_DISABLED' };
  const acknowledgement = buildImmediateAcknowledgement(text, messageType);
  if (!acknowledgement) return { sent: false, skipped: 'UNSUPPORTED_MESSAGE_TYPE' };
  const binding = instantChannelCredentials(route);
  const outboxId = makeId('OUT'), timestamp = new Date().toISOString();
  const response = await fetch(`https://graph.facebook.com/${binding.version}/${binding.phoneNumberId}/messages`, {
    method: 'POST',
    headers: { authorization: `Bearer ${binding.accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: digits(phone), type: 'text', text: { preview_url: false, body: acknowledgement } })
  });
  const result = await response.json().catch(() => ({}));
  const providerMessageId = clean(result.messages?.[0]?.id);
  const errorMessage = response.ok ? '' : clean(result.error?.message) || `Meta API error ${response.status}`;
  await appendObject(token, 'Message_Outbox', {
    'Outbox ID': outboxId, 'Created At': timestamp, 'Lead ID': lead['Lead ID'] || '', 'Application ID': application['Application ID'] || '',
    'Phone Number': digits(phone), 'Message Type': 'TEXT', 'Message Text': acknowledgement, 'Send Status': response.ok ? 'SENT' : 'FAILED',
    'Attempt Count': '1', 'Sent At': response.ok ? timestamp : '', 'Provider Message ID': providerMessageId, 'Error Message': errorMessage,
    'WhatsApp Number ID': binding.phoneNumberId, 'WABA ID': route['WABA ID'] || '', 'Internal Channel ID': binding.channelId,
    'Make Connection Alias': route['Make Connection Alias'] || '', 'Reply To Message ID': messageId || '',
    'Send Routing Status': `${response.ok ? 'WEBHOOK_IMMEDIATE_ACK' : 'WEBHOOK_IMMEDIATE_ACK_FAILED'}:${binding.channelId}`,
    'Business Unit': businessUnit, 'Customer ID': lead['Customer ID'] || '', 'Team ID': teamId
  });
  if (response.ok) await updateObject(token, 'WhatsApp_Number_Master', 'Internal Channel ID', binding.channelId, { 'Last Outbound At': timestamp, 'Updated At': timestamp }, 'AC');
  return { sent: response.ok, outboxId, providerMessageId, error: errorMessage, receivedAt };
}

async function updateOutboxStatus(token, providerId, status, errorMessage = '') {
  const rows = await readSheet(token, 'Message_Outbox!A:AC');
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
  res.setHeader('X-JomKaki-Knowledge-Version', JOMKAKI_KNOWLEDGE.version);
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
  let outboundSent = false;
  const reservedMessageIds = [];
  try {
    const payload = JSON.parse(raw.toString('utf8') || '{}');
    const inboundMessages = (payload.entry || []).flatMap(entry => (entry.changes || []).flatMap(change => change.value?.messages || []));
    if (!inboundMessages.length) return res.status(200).json({ ok: true, statusOnly: true });
    for (const message of inboundMessages) {
      if (!message.id) continue;
      if (reserveInboundMessage(message.id)) reservedMessageIds.push(clean(message.id));
      else message.__skipDuplicate = true;
    }
    if (!inboundMessages.some(message => !message.__skipDuplicate)) return res.status(200).json({ ok: true, duplicate: true });
    const token = await getAccessToken(req);
    if (!token) throw new Error('Google authorization unavailable');
    const [leadRows, routeRows, branchRows, stateRows, inboxRows] = await Promise.all([
      readSheet(token, 'Leads!A:AP'),
      readSheet(token, 'WhatsApp_Number_Master!A1:AC1000'),
      readSheet(token, 'Branch_Master!A1:S1000'),
      readSheet(token, 'Conversation_State!A:AK'),
      readSheet(token, 'Customer_Inbox!F:F')
    ]);
    const leads = objects(leadRows);
    const routes = objects(routeRows);
    const branches = objects(branchRows);
    const conversationStates = objects(stateRows);
    let applicationsPromise;
    let catalogDataPromise;
    let documentsPromise;
    const loadApplications = () => applicationsPromise ||= readSheet(token, 'Applications!A:CZ').then(objects);
    const loadDocuments = () => documentsPromise ||= readSheet(token, 'Document_Log!A:AD').then(objects);
    const loadCatalogData = () => catalogDataPromise ||= Promise.all([
      readSheet(token, 'Motor_Model_Catalog!A1:Q1000'),
      readSheet(token, 'Motor_Loan_Pricing!A1:Z1000'),
      readSheet(token, 'Handphone_Model_Catalog!A1:AB1000'),
      readSheet(token, 'Handphone_Loan_Pricing!A1:AO1000')
    ]).then(([motorCatalogRows, motorPricingRows, handphoneCatalogRows, handphonePricingRows]) => ({
      motorCatalog: objects(motorCatalogRows), motorPricing: objects(motorPricingRows),
      handphoneCatalog: objects(handphoneCatalogRows), handphonePricing: objects(handphonePricingRows)
    }));
    const existingMessageIds = new Set(objects(inboxRows).map(row => clean(row['Message ID'])).filter(Boolean));
    for (const entry of payload.entry || []) for (const change of entry.changes || []) {
      const value = change.value || {}, numberId = value.metadata?.phone_number_id || '', displayNumber = value.metadata?.display_phone_number || '';
      for (const message of value.messages || []) {
        if (message.__skipDuplicate || (message.id && existingMessageIds.has(clean(message.id)))) continue;
        const phone = digits(message.from), text = message.text?.body || message.button?.text || message.interactive?.button_reply?.title || message.interactive?.list_reply?.title || `[${message.type || 'message'}]`;
        const contact = (value.contacts || []).find(item => digits(item.wa_id) === phone) || (value.contacts || [])[0] || {};
        const profileName = extractCustomerName(contact.profile?.name);
        const route = routes.find(row => clean(row['Phone Number ID']) === clean(numberId)) || {};
        const channelId = clean(route['Internal Channel ID']), branchId = clean(route['Branch ID']);
        const branch = branches.find(row => clean(row['Branch ID']) === branchId) || {};
        const routeRegion = canonicalRegion(route.Region || branch.Region) || 'UNASSIGNED';
        const routeBusinessUnit = canonicalBusinessUnit(route['Business Unit']) || 'UNASSIGNED';
        let teamId = clean(route['Team ID'] || branch['Team ID']);
        const receivedAt = new Date(Number(message.timestamp || Date.now() / 1000) * 1000).toISOString();
        const routeUsable = !!channelId && routeBusinessUnit !== 'UNASSIGNED' && truth(route.Active) && truth(route['Inbound Enabled']);
        let lead = leads.find(row => digits(row['Phone Number']) === phone && clean(row['Business Unit']).toUpperCase() === routeBusinessUnit);
        const previousInboundAt = clean(lead?.['Last Inbound At']);
        let conversationState = lead ? conversationStates.filter(row => clean(row['Lead ID']) === clean(lead['Lead ID'])).at(-1) : null;
        const latestKnownInboundAt = [previousInboundAt, clean(conversationState?.['Last Customer Reply At'])]
          .filter(value => Number.isFinite(Date.parse(value)))
          .sort((left, right) => Date.parse(right) - Date.parse(left))[0] || '';
        const maxInboundAgeMs = Number(process.env.WHATSAPP_MAX_INBOUND_AGE_MS) || DEFAULT_MAX_INBOUND_AGE_MS;
        const supersededInbound = isStaleInboundMessage(receivedAt, latestKnownInboundAt);
        const expiredInbound = isExpiredInboundMessage(receivedAt, Date.now(), maxInboundAgeMs);
        const staleInbound = supersededInbound || expiredInbound;
        if (staleInbound) {
          const staleReason = supersededInbound
            ? `No reply sent: inbound message from ${receivedAt} was older than the latest processed message from ${latestKnownInboundAt}.`
            : `No reply sent: inbound message from ${receivedAt} exceeded the ${Math.round(maxInboundAgeMs / 60000)}-minute freshness window.`;
          await appendObject(token, 'Customer_Inbox', {
            'Received At': receivedAt,
            'Phone Number': phone,
            'Customer Message': text,
            'Attachment Type': ['image', 'document'].includes(clean(message.type).toLowerCase()) ? message.type : '',
            'Message ID': message.id || makeId('MSG'),
            Channel: 'WHATSAPP',
            Source: 'META_CLOUD',
            'Lead ID': clean(lead?.['Lead ID']),
            'Message Type': message.type || 'text',
            'Process Status': 'IGNORED_STALE_OR_REDELIVERED',
            'AI Processed': 'TRUE',
            'AI Processed At': new Date().toISOString(),
            'Webhook ID': makeId('WEBHOOK'),
            'Error Message': staleReason,
            'WhatsApp Number ID': numberId,
            'WhatsApp Display Number': displayNumber || route['Display Number'],
            'WABA ID': route['WABA ID'] || entry.id || '',
            'Conversation Key': `${channelId || numberId || 'UNROUTED'}:${phone}`,
            'Webhook Source': 'META_CLOUD',
            'Number Routing Status': 'IGNORED_STALE_OR_REDELIVERED',
            'Internal Channel ID': channelId,
            'Business Unit': routeBusinessUnit,
            'Customer ID': clean(lead?.['Customer ID']),
            'Team ID': teamId
          });
          if (message.id) existingMessageIds.add(clean(message.id));
          continue;
        }
        let human = requiresManager(text);
        const currentStep = clean(conversationState?.['Current Step']).toUpperCase();
        const mediaInbound = ['image', 'document'].includes(clean(message.type).toLowerCase());
        const inferredInboundDocumentType = inferDocumentTypeFromFileName(message.document?.filename || '');
        const documentAckKey = `${channelId || numberId || 'UNROUTED'}:${phone}`;
        const nowMs = Date.now();
        if (documentBatchAcknowledgements.size > 500) {
          for (const [key, timestamp] of documentBatchAcknowledgements) if (nowMs - timestamp >= DOCUMENT_ACK_WINDOW_MS) documentBatchAcknowledgements.delete(key);
        }
        const memoryDocumentAckAt = documentBatchAcknowledgements.get(documentAckKey) || 0;
        const suppressDocumentAcknowledgement = mediaInbound && (
          nowMs - memoryDocumentAckAt < DOCUMENT_ACK_WINDOW_MS || hasRecentDocumentAcknowledgement(conversationState || {}, nowMs)
        );
        const documentAckReserved = mediaInbound && !suppressDocumentAcknowledgement;
        if (documentAckReserved) documentBatchAcknowledgements.set(documentAckKey, nowMs);
        const locationConfirmed = !!clean(lead?.['City or Area'] || lead?.State || conversationState?.['Selected Branch ID']);
        const conversationalText = ['text', 'button', 'interactive'].includes(clean(message.type).toLowerCase());
        const onboardingStep = !currentStep || ['STEP_01_WELCOME', 'STEP_01_NAME', 'STEP_02_LOCATION'].includes(currentStep);
        const needsCatalog = ['STEP_03_PRODUCT', 'STEP_04_DOCUMENTS'].includes(currentStep) || locationConfirmed || (conversationalText && onboardingStep);
        const catalogData = needsCatalog ? await loadCatalogData() : { motorCatalog: [], motorPricing: [], handphoneCatalog: [], handphonePricing: [] };
        const needsDocuments = !!lead && (mediaInbound || currentStep === 'STEP_04_DOCUMENTS' || isDocumentStatusQuestion(text) || conversationalDocumentRequirement(text));
        const leadDocuments = needsDocuments ? (await loadDocuments()).filter(row => clean(row['Lead ID']) === clean(lead['Lead ID'])) : [];
        const simpleGreeting = /^(?:hi|hello|hey|hai)[!. ]*$/i.test(clean(text));
        const aiIntent = routeUsable && !human && conversationalText && !simpleGreeting
          ? await requestAiIntent({
            text,
            state: conversationState || {},
            lead: lead || {},
            routeBusinessUnit,
            routeRegion,
            phone,
            motorCatalog: catalogData.motorCatalog,
            handphoneCatalog: catalogData.handphoneCatalog
          })
          : null;
        human = human || aiIntent?.intent === 'HUMAN_HANDOVER';
        let instantDecision = buildInstantSalesDecision({
          state: conversationState || {}, lead: lead || {}, documents: leadDocuments, text, messageType: message.type || 'text', routeBusinessUnit, routeRegion, branches,
          ...catalogData, aiIntent, suppressDocumentAcknowledgement
        });
        instantDecision = guardConversationProgress({ state: conversationState || {}, documents: leadDocuments, text, decision: instantDecision });
        if (routeUsable && !human && instantDecision.aiFallback) {
          const generatedReply = await requestAiFallbackReply({
            text,
            state: conversationState || {},
            lead: lead || {},
            routeBusinessUnit,
            routeRegion,
            phone
          });
          if (generatedReply) instantDecision = { ...instantDecision, text: generatedReply, aiGenerated: true };
        }
        let willReply = routeUsable && !human && instantDecision.handled;
        if (documentAckReserved && !willReply) documentBatchAcknowledgements.delete(documentAckKey);
        let instantResult = { sent: false };
        if (!lead) {
          const timestamp = new Date().toISOString();
          const existingCustomer = leads.find(row => digits(row['Phone Number']) === phone), customerId = clean(existingCustomer?.['Customer ID']) || makeId('CUS');
          const initialLocation = instantDecision.location || {};
          lead = { 'Lead ID': makeId('LEAD'), 'Customer ID': customerId, 'Customer Name': existingCustomer?.['Customer Name'] || profileName || `WhatsApp Customer ${phone.slice(-4)}`, 'Phone Number': phone, 'Normalized Phone': phone, Region: clean(initialLocation.region || routeRegion), State: clean(initialLocation.state), 'City or Area': clean(initialLocation.city), 'Business Unit': routeBusinessUnit, 'Team ID': clean(initialLocation.teamId || teamId), 'Selected Branch ID': clean(initialLocation.branchId || branchId), 'Assigned SA ID': '' };
          await ensureHeaders(token, 'Leads', ['Lead Source', 'Created By', 'Updated By']);
          await appendObject(token, 'Leads', { ...lead, 'Created At': timestamp, 'Updated At': timestamp, 'Lead Status': 'NEW', 'Processing Mode': 'AI_MANAGED', 'Lead Source': 'WHATSAPP_CLOUD', 'Source Channel': 'WHATSAPP_CLOUD', 'Primary WhatsApp Channel ID': channelId, 'Last Inbound WhatsApp Channel ID': channelId, 'Last Inbound WhatsApp Number ID': numberId, 'Last Inbound At': receivedAt, Notes: 'AI-managed Lead; Staff remains unassigned unless document collection or follow-up fails', 'Created By': 'META_WEBHOOK', 'Updated By': 'META_WEBHOOK' });
          leads.push(lead);
        } else {
          await ensureHeaders(token, 'Leads', ['Lead Source', 'Created By', 'Updated By']);
          await updateObject(token, 'Leads', 'Lead ID', lead['Lead ID'], { 'Last Inbound WhatsApp Channel ID': channelId, 'Last Inbound WhatsApp Number ID': numberId, 'Last Inbound At': receivedAt, 'Last Customer Reply At': receivedAt, 'Updated At': receivedAt, 'Updated By': 'META_WEBHOOK', 'Business Unit': routeBusinessUnit, 'Team ID': teamId }, 'AP');
          lead['Last Inbound At'] = receivedAt;
          lead['Last Customer Reply At'] = receivedAt;
        }
        const shouldEnsureApplication = mediaInbound || currentStep === 'STEP_04_DOCUMENTS' || clean(instantDecision.nextStep).toUpperCase() === 'STEP_04_DOCUMENTS' || isDocumentStatusQuestion(text);
        const shouldLoadApplication = shouldEnsureApplication || !!clean(conversationState?.['Application ID']);
        const applications = shouldLoadApplication ? await loadApplications() : [];
        let application = applications.filter(row => row['Lead ID'] && row['Lead ID'] === lead['Lead ID']).at(-1) || {};
        if (!clean(application['Application ID']) && shouldEnsureApplication) {
          application = buildAutomaticApplication({ lead, state: conversationState || {}, route, decision: instantDecision, receivedAt, channelId, businessUnit: routeBusinessUnit, teamId });
          await ensureHeaders(token, 'Applications', ['Region', 'Business Unit', 'Customer ID', 'Team ID', 'Origin WhatsApp Channel ID', 'Product Category', 'Product Brand', 'Product Model', 'Product Variant', 'Motor Type', 'Application Status', 'Current Stage', 'Processing Mode', 'Assigned Branch ID', 'Assigned SA ID', 'Document Status', 'Minimum Documents Complete', 'Missing Documents', 'Credit Consent Status', 'Credit Consent Template Version', 'Credit Consent Sent At', 'Credit Check Status', 'SA Review Required', 'Created By', 'Updated By']);
          await appendObject(token, 'Applications', application);
          applications.push(application);
          await bindDocumentsToApplication(token, leadDocuments, application['Application ID']);
        }
        if (clean(application['Application ID']) && inferredInboundDocumentType === 'CTOS_CCRIS_CONSENT_SIGNED' && !['VERIFIED', 'DECLINED', 'WITHDRAWN'].includes(clean(application['Credit Consent Status']).toUpperCase())) {
          const signedAt = new Date().toISOString();
          await ensureHeaders(token, 'Applications', APPLICATION_DETAIL_APPLICATION_HEADERS);
          await updateObject(token, 'Applications', 'Application ID', application['Application ID'], {
            'Credit Consent Status': 'SIGNED_PENDING_VERIFICATION',
            'Credit Consent Signed At': signedAt,
            'Updated At': signedAt,
            'Updated By': 'META_WEBHOOK_CONSENT_RECEIVED'
          }, 'CZ');
          Object.assign(application, {
            'Credit Consent Status': 'SIGNED_PENDING_VERIFICATION',
            'Credit Consent Signed At': signedAt,
            'Updated At': signedAt,
            'Updated By': 'META_WEBHOOK_CONSENT_RECEIVED'
          });
        }
        const activeApplicationDetailStep = isApplicationDetailStep(currentStep);
        const detailSideQuestion = activeApplicationDetailStep && conversationalText && !isApplicationDetailsFormResponse(text, routeBusinessUnit) && applicationDetailSideQuestion(text);
        let applicationDetailTurn = null;
        if (routeUsable && !human && activeApplicationDetailStep && conversationalText && !detailSideQuestion) {
          applicationDetailTurn = buildApplicationDetailsTurn({ currentStep, text, application, businessUnit: routeBusinessUnit });
        } else if (shouldStartApplicationDetails({ messageType: message.type, application, currentStep, routeUsable, human })) {
          applicationDetailTurn = buildApplicationDetailsTurn({ application, businessUnit: routeBusinessUnit, start: true });
        }
        if (applicationDetailTurn?.handled) {
          const detailTimestamp = new Date().toISOString(), detailComplete = applicationDetailTurn.nextStep === 'APPLICATION_DETAILS_COMPLETE';
          const detailChanges = {
            ...applicationDetailTurn.changes,
            'Updated At': detailTimestamp,
            'Current Stage': detailComplete ? 'APPLICATION_DETAILS_COMPLETE' : 'APPLICATION_DETAILS_PENDING',
            'Application Status': detailComplete ? 'APPLICATION_DETAILS_COMPLETE' : 'INFORMATION_COLLECTION_IN_PROGRESS',
            'Missing Application Fields': applicationDetailTurn.missingFields.join(','),
            'Updated By': 'META_WEBHOOK_APPLICATION_DETAILS'
          };
          await ensureHeaders(token, 'Applications', APPLICATION_DETAIL_APPLICATION_HEADERS);
          await updateObject(token, 'Applications', 'Application ID', application['Application ID'], detailChanges, 'CZ');
          Object.assign(application, detailChanges);
          instantDecision = {
            handled: true,
            applicationDetails: true,
            nextStep: applicationDetailTurn.nextStep,
            productUnit: routeBusinessUnit,
            text: applicationDetailTurn.text
          };
          willReply = true;
        } else if (activeApplicationDetailStep && conversationalText && detailSideQuestion) {
          instantDecision = { ...instantDecision, nextStep: currentStep };
          willReply = routeUsable && !human && instantDecision.handled;
        }
        const earlyConsentReserved = shouldDispatchEarlyConsent({ messageType: message.type, application, routeUsable, human })
          && reserveEarlyConsentDispatch(application['Application ID']);
        if (earlyConsentReserved) {
          instantDecision = {
            handled: true,
            documentQueued: true,
            consentDispatch: true,
            nextStep: clean(conversationState?.['Current Step']) || 'STEP_04_DOCUMENTS',
            productUnit: clean(instantDecision.productUnit || routeBusinessUnit),
            text: buildEarlyConsentReply('MS'),
            documentUrl: CREDIT_CONSENT_TEMPLATE_URL,
            documentFilename: 'JomKaki Rider CTOS CCRIS Consent Form.pdf'
          };
          willReply = true;
        }
        conversationState = conversationState || conversationStates.filter(row => clean(row['Lead ID']) === clean(lead['Lead ID'])).at(-1);
        if (!conversationState) {
          conversationState = buildInitialConversationState({ lead, application, route, phone, text, messageId: message.id, receivedAt, numberId, displayNumber, entryId: entry.id, channelId, businessUnit: routeBusinessUnit, teamId });
          if (willReply) {
            conversationState['Current Step'] = instantDecision.nextStep || conversationState['Current Step'];
            conversationState['Product Category'] = clean(instantDecision.productUnit || routeBusinessUnit);
          }
          await appendObject(token, 'Conversation_State', conversationState);
          conversationStates.push(conversationState);
        } else {
          const identityState = {};
          const leadIdentity = {};
          const step = clean(conversationState['Current Step']).toUpperCase();
          if (step === 'STEP_01_NAME' && !instantDecision.productIntent) {
            const customerName = clean(aiIntent?.customerName) || extractCustomerName(text);
            if (customerName) {
              identityState['Customer Name'] = customerName;
              leadIdentity['Customer Name'] = customerName;
            }
          }
          const resolvedLocation = instantDecision.location || (step === 'STEP_02_LOCATION' ? resolveCustomerLocation(aiIntent?.locationQuery || text, routeBusinessUnit, branches) : null);
          if (resolvedLocation) {
              leadIdentity.Region = resolvedLocation.region;
              leadIdentity.State = resolvedLocation.state;
              leadIdentity['City or Area'] = resolvedLocation.city;
              if (resolvedLocation.branchId) {
                leadIdentity['Selected Branch ID'] = resolvedLocation.branchId;
                identityState['Selected Branch ID'] = resolvedLocation.branchId;
              }
              if (resolvedLocation.teamId) {
                teamId = resolvedLocation.teamId;
                leadIdentity['Team ID'] = resolvedLocation.teamId;
                identityState['Team ID'] = resolvedLocation.teamId;
              }
          }
          if (Object.keys(leadIdentity).length) {
            leadIdentity['Updated At'] = receivedAt;
            leadIdentity['Updated By'] = 'META_WEBHOOK_SALES_FLOW';
            await updateObject(token, 'Leads', 'Lead ID', lead['Lead ID'], leadIdentity, 'AP');
            Object.assign(lead, leadIdentity);
          }
          const latestInbound = {
            'Application ID': clean(application['Application ID'] || conversationState['Application ID']),
            'Last Customer Message': clean(text),
            'Last Message ID': clean(message.id),
            'Last Customer Reply At': clean(receivedAt),
            'Updated At': clean(receivedAt) || new Date().toISOString(),
            'Internal Channel ID': clean(channelId),
            'WhatsApp Number ID': clean(numberId),
            'WABA ID': clean(route['WABA ID'] || entry.id),
            'WhatsApp Display Number': clean(displayNumber || route['Display Number']),
            'Channel Binding Status': clean(channelId) ? 'BOUND' : 'UNBOUND',
            'Business Unit': clean(routeBusinessUnit),
            'Customer ID': clean(lead['Customer ID']),
            'Team ID': clean(teamId),
            ...(willReply ? {
              'Current Step': clean(instantDecision.nextStep || conversationState['Current Step']),
              'Product Category': clean(instantDecision.productUnit || conversationState['Product Category'] || routeBusinessUnit)
            } : {}),
            ...identityState
          };
          await updateObject(token, 'Conversation_State', 'State ID', conversationState['State ID'], latestInbound, 'AK');
          Object.assign(conversationState, latestInbound);
        }
        if (willReply) {
          instantResult = await sendInstantSalesMessage({ route, phone, decision: instantDecision });
          if (instantResult.sent) {
            outboundSent = true;
            if (instantDecision.consentDispatch) {
              const consentSentAt = new Date().toISOString();
              const consentChanges = {
                'Updated At': consentSentAt,
                'Current Stage': 'CONSENT_AND_DOCUMENTS_IN_PROGRESS',
                'Credit Consent Status': 'SENT',
                'Credit Consent Template Version': CREDIT_CONSENT_TEMPLATE_VERSION,
                'Credit Consent Sent At': consentSentAt,
                'Credit Check Status': 'BLOCKED_CONSENT_REQUIRED',
                'Updated By': 'META_WEBHOOK_CONSENT_FIRST'
              };
              await updateObject(token, 'Applications', 'Application ID', application['Application ID'], consentChanges, 'CC');
              Object.assign(application, consentChanges);
            }
            const deliveredState = {
              'Last AI Message': clean(instantDecision.text),
              'Last AI Message At': new Date().toISOString(),
              'Selected Product Brand': clean(instantDecision.product?.Brand),
              'Selected Product Model': clean(instantDecision.product?.Model)
            };
            await updateObject(token, 'Conversation_State', 'State ID', conversationState['State ID'], deliveredState, 'AK');
            Object.assign(conversationState, deliveredState);
          }
        }
        if (instantDecision.consentDispatch && !instantResult.sent) releaseEarlyConsentDispatch(application['Application ID']);
        if (documentAckReserved && !instantResult.sent) documentBatchAcknowledgements.delete(documentAckKey);
        const routingStatus = !channelId ? 'UNREGISTERED_CHANNEL' : !routeUsable ? 'CHANNEL_DISABLED_ADMIN_REVIEW' : routeRegion === 'UNASSIGNED' ? 'ADMIN_REVIEW_REQUIRED' : 'MATCHED';
        const media = message.document || message.image;
        const attachmentUrl = media?.id ? buildMediaProxyUrl({ mediaId: media.id, channelId, credentialKey: route['Credential Key'] || channelId }) : '';
        await appendObject(token, 'Customer_Inbox', { 'Received At': receivedAt, 'Phone Number': phone, 'Customer Message': text, 'Attachment URL': attachmentUrl, 'Attachment Type': mediaInbound ? message.type : '', 'Message ID': message.id || makeId('MSG'), Channel: 'WHATSAPP', Source: 'META_CLOUD', 'Lead ID': lead['Lead ID'] || '', 'Application ID': application['Application ID'] || '', 'Message Type': message.type || 'text', 'Process Status': !routeUsable || routeRegion === 'UNASSIGNED' ? 'HUMAN_HANDOVER_REQUIRED' : human || instantDecision.humanFollowUpRequired ? 'HUMAN_HANDOVER_REQUIRED' : mediaInbound ? 'AI_DOCUMENT_QUEUED' : instantResult.sent ? (aiIntent ? 'AI_REPLIED_INTENT_GROUNDED' : instantDecision.aiGenerated ? 'AI_REPLIED_KNOWLEDGE_FALLBACK' : 'AI_REPLIED_INSTANTLY') : 'NEW', 'AI Processed': mediaInbound ? 'FALSE' : instantResult.sent ? 'TRUE' : 'FALSE', 'Webhook ID': makeId('WEBHOOK'), 'WhatsApp Number ID': numberId, 'WhatsApp Display Number': displayNumber || route['Display Number'], 'WABA ID': route['WABA ID'] || entry.id || '', 'Conversation Key': `${channelId || numberId || 'UNROUTED'}:${phone}`, 'Webhook Source': 'META_CLOUD', 'Number Routing Status': routingStatus, 'Internal Channel ID': channelId, 'Business Unit': clean(instantDecision.productUnit || routeBusinessUnit), 'Customer ID': lead['Customer ID'] || '', 'Team ID': teamId });
        if (instantResult.sent || instantResult.error) {
          const timestamp = new Date().toISOString();
          const imageOutboxPrefix = instantDecision.productUnit === 'HANDPHONE' ? 'JKM-HP-IMG' : 'JKM-S03C-IMG';
          const outboxId = instantDecision.imageUrl && message.id ? `${imageOutboxPrefix}-${message.id}` : makeId('OUT');
          await appendObject(token, 'Message_Outbox', {
            'Outbox ID': outboxId, 'Created At': timestamp, 'Lead ID': lead['Lead ID'] || '', 'Application ID': application['Application ID'] || '',
            'Phone Number': phone, 'Message Type': instantResult.messageType || 'TEXT', 'Message Text': clean(instantDecision.text), 'Image URL': clean(instantDecision.imageUrl || instantDecision.documentUrl),
            'Image Caption': clean(instantDecision.text), 'Send Status': instantResult.sent ? 'SENT' : 'FAILED', 'Attempt Count': '1', 'Sent At': instantResult.sent ? timestamp : '',
            'Provider Message ID': instantResult.providerMessageId || '', 'Error Message': instantResult.error || '', 'WhatsApp Number ID': numberId,
            'WABA ID': route['WABA ID'] || entry.id || '', 'Internal Channel ID': channelId, 'Make Connection Alias': route['Make Connection Alias'] || '',
            'Reply To Message ID': message.id || '', 'Template Name': instantDecision.consentDispatch ? 'JKM_CREDIT_CONSENT_REQUEST' : '', 'Send Routing Status': `${instantResult.sent ? (instantDecision.consentDispatch ? 'WEBHOOK_CONSENT_FIRST' : instantDecision.aiGenerated ? 'WEBHOOK_KNOWLEDGE_AI_FALLBACK' : 'WEBHOOK_INSTANT_SALES') : 'WEBHOOK_INSTANT_SALES_FAILED'}:${channelId}`,
            'Business Unit': clean(instantDecision.productUnit || routeBusinessUnit), 'Customer ID': lead['Customer ID'] || '', 'Team ID': teamId
          });
        }
        if (channelId) await updateObject(token, 'WhatsApp_Number_Master', 'Internal Channel ID', channelId, { 'Last Inbound At': receivedAt, 'Last Verified At': receivedAt, 'Updated At': receivedAt }, 'AC');
        if (media?.id) {
          await ensureHeaders(token, 'Document_Log', ['Uploaded By', 'Reviewed By', 'Reviewed At']);
          const inferredDocumentType = inferredInboundDocumentType;
          const currentDocumentLog = {
          'Document ID': makeId('DOC'), 'Application ID': application['Application ID'] || '', 'Lead ID': lead['Lead ID'] || '',
          'Received At': new Date(Number(message.timestamp || Date.now() / 1000) * 1000).toISOString(), 'Message ID': message.id || '',
          'Document Type': inferredDocumentType, 'Media ID': media.id, 'Mime Type': media.mime_type || '', 'File Name': message.document?.filename || '', 'File URL': attachmentUrl,
          'Classification Status': inferredDocumentType === 'UNCLASSIFIED' ? 'AI_QUEUED' : 'FILENAME_CLASSIFIED_PENDING_AI', 'Quality Status': 'PENDING_AI', 'Verification Status': 'PENDING_AI', 'Duplicate Status': 'NOT_CHECKED',
          'Manual Review Required': 'FALSE', Remarks: 'Received from WhatsApp and queued for automatic AI validation', 'Updated At': new Date().toISOString(), 'Uploaded By': 'META_WEBHOOK', 'Business Unit': routeBusinessUnit, 'Customer ID': lead['Customer ID'] || ''
          };
          await appendObject(token, 'Document_Log', currentDocumentLog);
          if (clean(application['Application ID'])) {
            const liveDocumentStatus = documentProgress([...leadDocuments, currentDocumentLog]);
            const classificationPending = liveDocumentStatus.pendingTypes.includes('UNCLASSIFIED');
            const documentStatus = liveDocumentStatus.failed ? 'AI_EXCEPTION' : classificationPending ? 'AI_CHECK_PENDING' : liveDocumentStatus.missingCodes.length ? 'COLLECTING' : liveDocumentStatus.verifiedComplete ? 'AI_VERIFIED_COMPLETE' : 'AI_CHECK_PENDING';
            const applicationDocumentChanges = {
              'Updated At': new Date().toISOString(),
              'Document Status': documentStatus,
              'Minimum Documents Complete': liveDocumentStatus.verifiedComplete ? 'TRUE' : 'FALSE',
              'Missing Documents': classificationPending ? '' : liveDocumentStatus.missingCodes.join(', '),
              'Verification Pending Documents': liveDocumentStatus.pendingTypes.join(', '),
              ...(inferredDocumentType === 'BANK_STATEMENT' ? { 'Bank Account Available': 'YES' } : {}),
              'Updated By': 'META_WEBHOOK_DOCUMENT_RECEIVED'
            };
            await ensureHeaders(token, 'Applications', APPLICATION_DETAIL_APPLICATION_HEADERS);
            await updateObject(token, 'Applications', 'Application ID', application['Application ID'], applicationDocumentChanges, 'CZ');
            Object.assign(application, applicationDocumentChanges);
          }
        }
        if (message.id) existingMessageIds.add(clean(message.id));
      }
      for (const status of value.statuses || []) await updateOutboxStatus(token, status.id, status.status, status.errors?.[0]?.title || '');
    }
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error(error);
    if (outboundSent) return res.status(200).json({ ok: true, warning: 'POST_SEND_LOGGING_FAILED' });
    for (const messageId of reservedMessageIds) releaseInboundMessage(messageId);
    return res.status(500).json({ ok: false });
  }
}
