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
const documentBatchAcknowledgements = new Map();
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

function sheetCacheTtl(range) {
  if (/!1:1$/.test(range)) return 5 * 60 * 1000;
  if (/^(?:WhatsApp_Number_Master|Branch_Master|Motor_Model_Catalog|Motor_Loan_Pricing|Handphone_Model_Catalog|Handphone_Loan_Pricing)!/.test(range)) return 30 * 1000;
  if (/^Conversation_State!A1:AK2000$/.test(range)) return 1500;
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

async function ensureHeaders(token, sheet, requiredHeaders) {
  const [headers = []] = await readSheet(token, `${sheet}!1:1`);
  const missing = requiredHeaders.filter(header => !headers.includes(header));
  if (!missing.length) return;
  const start = columnName(headers.length), end = columnName(headers.length + missing.length - 1);
  await googleRequest(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(`${sheet}!${start}1:${end}1`)}?valueInputOption=USER_ENTERED`, { method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ values: [missing] }) }, `Unable to extend ${sheet} headers`);
  invalidateSheetDataCache(sheet, true);
}

async function updateObject(token, sheet, idHeader, id, changes, maxColumn = 'Z') {
  const rows = await readSheet(token, `${sheet}!A1:${maxColumn}2000`), headers = rows[0] || [], idIndex = headers.indexOf(idHeader);
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
  const types = new Set(rows.map(documentTypeFromRow));
  const accepted = new Set(['VERIFIED', 'AI_VERIFIED', 'APPROVED', 'ACCEPTED']);
  const pending = rows.some(row => !accepted.has(clean(row['Verification Status'] || row.verification).toUpperCase()));
  const failed = rows.some(row => ['REJECTED', 'FAILED', 'BLURRY', 'POOR'].includes(clean(row['Verification Status'] || row['Quality Status'] || row.verification || row.quality).toUpperCase()));
  const hasCombinedIdentity = types.has('IDENTITY_DOCUMENT');
  const missing = [];
  if (!types.has('IC_FRONT') && !hasCombinedIdentity) missing.push('IC depan');
  if (!types.has('IC_BACK') && !hasCombinedIdentity) missing.push('IC belakang');
  if (![...types].some(type => ['INCOME_PROOF', 'PAYSLIP', 'SALARY_SLIP', 'EPF', 'EPF_STATEMENT'].includes(type))) missing.push('slip gaji atau penyata EPF');
  const labels = [
    [hasCombinedIdentity || types.has('IC_FRONT') || types.has('IC_BACK'), 'kad pengenalan'],
    [types.has('PAYSLIP') || types.has('SALARY_SLIP'), 'slip gaji'],
    [types.has('EPF') || types.has('EPF_STATEMENT'), 'penyata EPF'],
    [types.has('BANK_STATEMENT'), 'penyata bank'],
    [types.has('PROOF_OF_ADDRESS'), 'bukti alamat'],
    [types.has('CTOS_CCRIS_CONSENT_SIGNED'), 'borang kebenaran CTOS/CCRIS']
  ].filter(([present]) => present).map(([, label]) => label);
  return { rows, types, pending, failed, missing, labels };
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
    if (language === 'ZH') return `我已经收到 ${status.rows.length} 份文件，包括${received}。系统正在核对完整性，目前不需要重新发送。检查完成后，我会清楚告诉您是否还缺任何文件。`;
    if (language === 'EN') return `I have received ${status.rows.length} file${status.rows.length === 1 ? '' : 's'}, including ${received}. They are still being checked, so there is no need to resend anything now. I will tell you clearly if anything is missing after the check.`;
    return `Baik, saya sudah terima ${status.rows.length} fail termasuk ${received}. Semakan masih berjalan, jadi tak perlu hantar semula sekarang. Selepas semakan siap, saya akan beritahu dengan jelas jika ada dokumen yang masih kurang.`;
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
  ['EAST_MALAYSIA', 'Sarawak', ['sarawak', 'kuching', 'batu kawa', 'satok', 'samarahan', 'kota samarahan', 'bintulu', 'miri', 'sibu', 'serian', 'sri aman']],
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
    const typo = !exact && compactAlias.length >= 5 && [...candidates].some(candidate => candidate.length >= 4 && editDistanceWithin(candidate, compactAlias, compactAlias.length >= 9 ? 2 : 1));
    return { region, state, alias, exact, typo, score: exact ? 1000 + compactAlias.length : typo ? 500 + compactAlias.length : 0 };
  })).filter(match => match.score > 0).sort((a, b) => b.score - a.score);

  const locationMatch = locationMatches[0];
  if (!locationMatch) return null;
  const { region, state, alias: area } = locationMatch;
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

export function buildMediaProxyUrl({ mediaId = '', channelId = '', credentialKey = '', expires = 0, secret = process.env.META_APP_SECRET, baseUrl = process.env.JOMKAKI_CRM_PUBLIC_URL || 'https://jomkaki-crm.vercel.app' } = {}) {
  const id = clean(mediaId), channel = clean(channelId), credential = credentialPrefix(credentialKey || channelId);
  const expiry = Number(expires) || Math.floor(Date.now() / 1000) + 21600;
  if (!id || !channel || !credential || !clean(secret)) return '';
  const signature = crypto.createHmac('sha256', clean(secret)).update(`${id}|${channel}|${credential}|${expiry}`).digest('hex');
  const query = new URLSearchParams({ id, channel, credential, expires: String(expiry), signature });
  return `${clean(baseUrl).replace(/\/$/, '')}/api/whatsapp-media?${query.toString()}`;
}

const instantLanguage = text => {
  const value = clean(text);
  if (/[\u3400-\u9fff]/u.test(value)) return 'ZH';
  if (/\b(hai|saya|nak|mahu|boleh|cari|motor|telefon|harga|ansuran|pinjaman|dokumen|dari)\b/i.test(value)) return 'MS';
  if (/\b(i|i'm|my|we|our|looking|want|need|interested|how|what|where|which|monthly|payment|price|apply)\b/i.test(value)) return 'EN';
  return JOMKAKI_KNOWLEDGE.conversation.defaultLanguage;
};

const instantCopy = (language, key, values = {}) => {
  const name = clean(values.name), location = clean(values.location), brand = clean(values.brand), model = clean(values.model);
  const amount = customerAmount(values.amount), tenure = clean(values.tenure), options = clean(values.options), models = clean(values.models);
  const copies = {
    EN: {
      NAME: 'Hi, thank you for contacting JomKaki Motor. I can help you check suitable motorcycle or phone options and their monthly instalments. May I know your name?',
      NAME_RETRY: 'Sorry, may I know your name so I can continue checking the right options for you?',
      LOCATION: `Nice to meet you${name ? `, ${name}` : ''}. Which city or state are you from?`,
      LOCATION_RETRY: 'Which city or state are you currently staying in?',
      PRODUCT: `Thank you${location ? `, noted ${location}` : ''}. Are you looking for a motorcycle or phone? You can tell me the model directly.`,
      MODEL: 'Which motorcycle or phone model are you interested in? You can send me the model name directly.',
      MODEL_CLARIFY: `Do you mean ${options}? Choose one so I can send the correct photo and monthly instalment.`,
      MODEL_UNAVAILABLE: `I understand you mean ${brand} ${model}. The approved monthly instalment is not available in the system yet, but I can check it with the branch for you.`,
      OTHER_MODELS: `Other available options include ${models}. Which one would you like me to check?`,
      BUDGET: 'No problem. I can check another model with a lower monthly instalment. What monthly budget would be comfortable for you?',
      APPLY: 'To start the shop-loan check, please send the front and back of your MyKad plus your latest payslip or EPF statement here. You may send them one by one.',
      THANKS: 'You are welcome. If you need another model or monthly-instalment check, just message me here.',
      HELP: 'Certainly. I can help with models, monthly instalments, required documents, or application status. What would you like me to check?',
      DOCUMENT: 'Your document has been received. I am checking all files submitted for this application. There is no need to resend anything now; I will tell you clearly if something is still missing.',
      QUOTE: `For ${brand} ${model}, the ${tenure} instalment is RM${amount} per month, subject to branch confirmation. For a shop-loan check, we need the front and back of your MyKad plus your latest payslip or EPF statement. If this suits you, you can send them here one by one.`
    },
    MS: {

      NAME: 'Hi, terima kasih kerana menghubungi JomKaki Motor. Saya boleh bantu semak pilihan motor atau telefon serta ansuran bulanan yang sesuai. Boleh saya tahu nama anda?',
      NAME_RETRY: 'Maaf, boleh saya tahu nama anda supaya saya boleh teruskan semakan?',
      LOCATION: `Salam kenal${name ? `, ${name}` : ''}. Anda tinggal di bandar atau negeri mana?`,
      LOCATION_RETRY: 'Boleh beritahu anda sekarang tinggal di bandar atau negeri mana?',
      PRODUCT: `Terima kasih${location ? `, lokasi ${location} sudah dicatat` : ''}. Anda sedang cari motor atau telefon? Boleh terus beritahu model yang anda mahu.`,
      MODEL: 'Model motor atau telefon yang mana anda minat? Boleh terus hantar nama model kepada saya.',
      MODEL_CLARIFY: `Maksud anda ${options}? Pilih satu ya supaya saya boleh hantar gambar dan ansuran bulanan yang betul.`,
      MODEL_UNAVAILABLE: `Baik, anda maksudkan ${brand} ${model}. Kadar ansuran yang diluluskan belum ada dalam sistem sekarang, tetapi saya boleh semak dengan cawangan untuk anda.`,
      OTHER_MODELS: `Antara pilihan lain yang ada ialah ${models}. Yang mana satu anda mahu saya semak?`,
      BUDGET: 'Boleh. Saya boleh semak model lain dengan ansuran bulanan yang lebih rendah. Bajet bulanan yang selesa untuk anda berapa?',
      APPLY: 'Untuk mula semakan loan kedai, boleh hantar IC depan dan belakang serta slip gaji terkini atau penyata EPF di sini. Boleh hantar satu per satu.',
      THANKS: 'Sama-sama. Kalau mahu semak model lain atau ansuran bulanan, terus mesej saya di sini.',
      HELP: 'Boleh. Saya boleh bantu semak model, ansuran bulanan, dokumen yang diperlukan atau status permohonan. Anda mahu saya semak yang mana?',
      DOCUMENT: 'Dokumen anda sudah diterima. Saya sedang semak semua fail untuk permohonan ini. Tak perlu hantar semula sekarang; saya akan beritahu dengan jelas jika ada dokumen yang masih kurang.',
      QUOTE: `Untuk ${brand} ${model}, ansuran ${tenure} ialah RM${amount} sebulan, tertakluk kepada pengesahan cawangan. Untuk semakan loan kedai, kami perlukan IC depan dan belakang serta slip gaji terkini atau penyata EPF. Kalau sesuai, boleh hantar satu per satu di sini.`
    },
    ZH: {
      NAME: '您好，感谢您联系 JomKaki Motor。我可以协助您查询合适的摩托车或手机型号及月供。请问该怎么称呼您？',
      NAME_RETRY: '不好意思，请问该怎么称呼您？我好继续为您查询。',
      LOCATION: `很高兴认识你${name ? `，${name}` : ''}。请问你目前住在哪个城市或州属？`,
      LOCATION_RETRY: '请问你目前住在哪个城市或州属？',
      PRODUCT: `谢谢${location ? `，已记录你在 ${location}` : ''}。你想找摩托还是手机？可以直接告诉我型号。`,
      MODEL: '你对哪一款摩托或手机有兴趣？可以直接把型号发给我。',
      MODEL_CLARIFY: `请问你是指 ${options}？请选择一个，我才能发送正确的照片和月供。`,
      OTHER_MODELS: `目前其他可选型号包括 ${models}。你想让我查询哪一款？`,
      BUDGET: '可以，我能帮你查询月供较低的其他型号。你觉得每月多少预算比较合适？',
      APPLY: '要开始店内贷款审核，请在这里发送 MyKad 正反面，以及最新薪水单或 EPF 记录。可以逐份发送。',
      THANKS: '不客气。如果你要查询其他型号或月供，随时在这里留言。',
      HELP: '可以。我能协助查询型号、月供、所需文件或申请进度。你想先查询哪一项？',
      DOCUMENT: '文件已经收到。我正在核对这份申请的所有文件，目前不需要重新发送；如果还有缺少，我会清楚告诉您。',
      QUOTE: `${brand} ${model} 的 ${tenure} 月供是每月 RM${amount}，最终以分行确认为准。申请店内贷款需要 MyKad 正反面，以及最新薪水单或 EPF 记录。如果这个方案适合你，可以在这里逐份发送文件。`
    }
  };
  return copies[language]?.[key] || copies.EN[key] || '';
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
  const language = instantLanguage(text);
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
    'You are the JomKaki Motor customer-service sales representative replying on WhatsApp.',
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
  return {
    model: clean(process.env.OPENAI_MODEL || JOMKAKI_KNOWLEDGE.conversation.aiFallback?.model || 'gpt-5.6-luna'),
    reasoning: { effort: clean(JOMKAKI_KNOWLEDGE.conversation.aiFallback?.reasoningEffort || 'none') },
    instructions,
    input: `Approved conversation context:\n${JSON.stringify(context)}`,
    max_output_tokens: 180,
    store: false,
    safety_identifier: safetyIdentifier,
    metadata: { workflow: 'jomkaki_whatsapp_fallback', knowledge_version: clean(JOMKAKI_KNOWLEDGE.version) }
  };
}

const responseOutputText = result => {
  const direct = clean(result?.output_text);
  if (direct) return direct;
  return (result?.output || []).flatMap(item => item?.content || []).map(item => clean(item?.text)).filter(Boolean).join(' ');
};

export async function requestAiFallbackReply({ text = '', state = {}, lead = {}, routeBusinessUnit = '', routeRegion = '', phone = '', env = process.env, fetchImpl = fetch, timeoutMs = AI_FALLBACK_DEFAULT_TIMEOUT_MS } = {}) {
  const apiKey = clean(env.OPENAI_API_KEY);
  if (!apiKey || !clean(text)) return '';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(500, Number(timeoutMs) || AI_FALLBACK_DEFAULT_TIMEOUT_MS));
  try {
    const body = buildAiFallbackRequest({ text, state, lead, routeBusinessUnit, routeRegion, phone });
    body.model = clean(env.OPENAI_MODEL || body.model);
    const response = await fetchImpl('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    if (!response.ok) return '';
    const result = await response.json().catch(() => ({}));
    return sanitizeAiFallbackReply(responseOutputText(result), instantLanguage(text));
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

const productUnitFromText = (text, fallback = '') => /\b(iphone|phone|handphone|telefon|smartphone)\b/i.test(clean(text)) ? 'HANDPHONE' : /\b(motor|moto|motorcycle|yamaha|honda|sym|moda)\b/i.test(clean(text)) ? 'MOTOR' : canonicalBusinessUnit(fallback);
const asksForDocuments = text => /(dokumen apa|document apa|apa.*perlu.*(?:loan|apply)|what documents|documents? (?:do )?i need|需要什么文件|要什么文件)/i.test(clean(text));
const wantsToApply = text => /(nak|mahu|want|ready|boleh).*(apply|proceed|teruskan|mohon|loan)|怎么申请|要申请/i.test(clean(text));
const raisesBudgetConcern = text => /(mahal|too expensive|expensive|lebih murah|cheaper|bajet|budget|贵|便宜)/i.test(clean(text));
const asksForOtherModels = text => /(model lain|motor lain|phone lain|telefon lain|apa model.*(?:ada|lain)|other models?|what else.*(?:available|have)|其他型号|别的型号)/i.test(clean(text));
const saysThanks = text => /^(?:terima kasih|thanks?(?: you)?|tq|thank you|谢谢|多谢)[.! ]*$/i.test(clean(text));

const modelAliasStopWords = new Set(['apple', 'iphone', 'phone', 'handphone', 'telefon', 'motor', 'model', 'official', 'standard', 'baru', 'new', 'pro', 'max', 'silver', 'black', 'white', 'blue', 'orange', 'gold', 'green', 'red', 'grey', 'gray']);
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
      const genericAlias = numericOnlyAlias || sharedAlias;
      if (query === alias || compactQuery === compactAlias) score = Math.max(score, 1900 + compactAlias.length);
      else if (alias.length >= 3 && includesTerm(query, alias)) score = Math.max(score, (genericAlias ? 1100 : 1800) + compactAlias.length);
      else if (compactAlias.length >= 3 && queryCandidates.some(candidate => candidate.compact === compactAlias)) score = Math.max(score, (genericAlias ? 1100 : 1700) + compactAlias.length);
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

const instantRate = (product, pricingRows = [], unit = '', region = '') => {
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
  const rates = approvedMonthlyRateFields(unit).map(([tenure, field]) => [tenure, row[field]]);
  const selected = rates.find(([, amount]) => customerAmount(amount));
  return selected ? { tenure: selected[0], amount: customerAmount(selected[1]) } : null;
};

export function buildInstantSalesDecision({ state = {}, lead = {}, documents = [], text = '', messageType = 'text', routeBusinessUnit = '', routeRegion = '', branches = [], motorCatalog = [], motorPricing = [], handphoneCatalog = [], handphonePricing = [], suppressDocumentAcknowledgement = false } = {}) {
  const language = instantLanguage(text), step = clean(state['Current Step']).toUpperCase();
  if (['image', 'document'].includes(clean(messageType).toLowerCase())) return suppressDocumentAcknowledgement
    ? { handled: false, documentQueued: true, nextStep: step || 'STEP_04_DOCUMENTS', text: '' }
    : { handled: true, documentQueued: true, nextStep: step || 'STEP_04_DOCUMENTS', text: instantCopy(language, 'DOCUMENT') };
  if (!['text', 'button', 'interactive'].includes(clean(messageType).toLowerCase())) return { handled: false };
  if (/^(hi|hello|hey|hai|你好|嗨)[!. ]*$/i.test(clean(text)) || !step || step === 'STEP_01_WELCOME') return { handled: true, nextStep: 'STEP_01_NAME', text: instantCopy(language, 'NAME') };
  const explicitUnit = productUnitFromText(text, ''), fallbackUnit = canonicalBusinessUnit(state['Product Category'] || routeBusinessUnit);
  const allCatalogs = [
    ...motorCatalog.map(row => ({ ...row, __businessUnit: 'MOTOR' })),
    ...handphoneCatalog.map(row => ({ ...row, __businessUnit: 'HANDPHONE' }))
  ];
  const catalogPool = explicitUnit ? allCatalogs.filter(row => row.__businessUnit === explicitUnit) : allCatalogs;
  const productMatch = matchInstantProduct(text, catalogPool);
  let product = productMatch.product;
  let unit = clean(product?.__businessUnit).toUpperCase() || explicitUnit || fallbackUnit || 'MOTOR';
  let pricing = unit === 'HANDPHONE' ? handphonePricing : motorPricing;
  const knownName = clean(state['Customer Name'] || lead['Customer Name']);
  const locationConfirmed = !!clean(lead['City or Area'] || lead.State || state['Selected Branch ID']);
  const identityReady = !!knownName && !/^WhatsApp Customer\b/i.test(knownName) && !!clean(lead.Region || routeRegion) && locationConfirmed;
  if (productMatch.ambiguous && (step === 'STEP_03_PRODUCT' || step === 'STEP_04_DOCUMENTS' || identityReady)) {
    const formattedOptions = productMatch.options.join(language === 'ZH' ? '、' : ' atau ');

    return { handled: true, nextStep: 'STEP_03_PRODUCT', productUnit: unit, text: instantCopy(language, 'MODEL_CLARIFY', { options: formattedOptions }) };
  }
  if (product && (step === 'STEP_03_PRODUCT' || step === 'STEP_04_DOCUMENTS' || identityReady)) {
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
    if (!rate) return { handled: true, nextStep: 'STEP_03_PRODUCT', productUnit: unit, product, text: instantCopy(language, 'MODEL_UNAVAILABLE', { brand: product.Brand, model: product.Model }) };
    const approvedImage = truth(product['Image Approved']) && /^https:\/\//i.test(clean(product['Image URL'])) ? clean(product['Image URL']) : '';
    return {
      handled: true,
      nextStep: 'STEP_04_DOCUMENTS',
      productUnit: unit,
      product,
      imageUrl: approvedImage,
      text: instantCopy(language, 'QUOTE', { brand: product.Brand, model: product.Model, tenure: rate.tenure, amount: rate.amount })
    };
  }
  if (step === 'STEP_04_DOCUMENTS' && isDocumentStatusQuestion(text)) {
    return { handled: true, nextStep: 'STEP_04_DOCUMENTS', productUnit: unit, text: buildDocumentProgressReply(language, documents) };
  }
  if (asksForDocuments(text) || wantsToApply(text)) return { handled: true, nextStep: 'STEP_04_DOCUMENTS', productUnit: unit, text: instantCopy(language, 'APPLY') };
  if (raisesBudgetConcern(text)) return { handled: true, nextStep: 'STEP_03_PRODUCT', productUnit: unit, text: instantCopy(language, 'BUDGET') };
  if (asksForOtherModels(text) && identityReady) {
    const pricingRegion = lead.Region || routeRegion;
    const suggestions = catalogPool.filter(row => {
      const rowUnit = clean(row.__businessUnit).toUpperCase() || unit;
      const rowPricing = rowUnit === 'HANDPHONE' ? handphonePricing : motorPricing;
      return rowUnit === unit && instantRate(row, rowPricing, rowUnit, pricingRegion);
    }).filter((row, index, rows) => rows.findIndex(item => normalizedWords(item.Model) === normalizedWords(row.Model)) === index)
      .slice(0, 3).map(row => `${clean(row.Brand)} ${clean(row.Model)}`.trim());
    if (suggestions.length) return { handled: true, nextStep: 'STEP_03_PRODUCT', productUnit: unit, text: instantCopy(language, 'OTHER_MODELS', { models: suggestions.join(language === 'ZH' ? '、' : ', ') }) };
  }
  if (saysThanks(text)) return { handled: true, nextStep: step || 'STEP_03_PRODUCT', productUnit: unit, text: instantCopy(language, 'THANKS') };
  if (step === 'STEP_01_NAME') {
    const name = extractCustomerName(text);
    return name
      ? { handled: true, nextStep: 'STEP_02_LOCATION', customerName: name, text: instantCopy(language, 'LOCATION', { name }) }
      : { handled: true, nextStep: 'STEP_01_NAME', text: instantCopy(language, 'NAME_RETRY') };
  }
  if (step === 'STEP_02_LOCATION') {
    const location = resolveCustomerLocation(text, productUnitFromText(text, routeBusinessUnit), branches);
    return location
      ? { handled: true, nextStep: 'STEP_03_PRODUCT', location, text: instantCopy(language, 'PRODUCT', { location: location.city || location.state }) }
      : { handled: true, nextStep: 'STEP_02_LOCATION', text: instantCopy(language, 'LOCATION_RETRY') };
  }
  if (step === 'STEP_03_PRODUCT' || /\b(motor|moto|motorcycle|phone|handphone|telefon|iphone)\b/i.test(clean(text))) return { handled: true, nextStep: 'STEP_03_PRODUCT', productUnit: unit, text: instantCopy(language, 'MODEL') };
  return { handled: true, aiFallback: true, nextStep: step || 'STEP_03_PRODUCT', productUnit: unit, text: instantCopy(language, 'HELP') };
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
  const payload = imageUrl
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
    messageType: imageUrl
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
      readSheet(token, 'Leads!A1:AP1000'),
      readSheet(token, 'WhatsApp_Number_Master!A1:AC1000'),
      readSheet(token, 'Branch_Master!A1:S1000'),
      readSheet(token, 'Conversation_State!A1:AK2000'),
      readSheet(token, 'Customer_Inbox!F1:F1200')
    ]);
    const leads = objects(leadRows);
    const routes = objects(routeRows);
    const branches = objects(branchRows);
    const conversationStates = objects(stateRows);
    let applicationsPromise;
    let catalogDataPromise;
    let documentsPromise;
    const loadApplications = () => applicationsPromise ||= readSheet(token, 'Applications!A1:CC1000').then(objects);
    const loadDocuments = () => documentsPromise ||= readSheet(token, 'Document_Log!A1:AD2000').then(objects);
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
        const staleInbound = isStaleInboundMessage(receivedAt, latestKnownInboundAt);
        if (staleInbound) {
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
            'Error Message': `No reply sent: an inbound message from ${receivedAt} arrived after the newer message from ${latestKnownInboundAt}.`,
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
        const human = requiresManager(text);
        const currentStep = clean(conversationState?.['Current Step']).toUpperCase();
        const mediaInbound = ['image', 'document'].includes(clean(message.type).toLowerCase());
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
        const needsCatalog = ['STEP_03_PRODUCT', 'STEP_04_DOCUMENTS'].includes(currentStep) || locationConfirmed;
        const catalogData = needsCatalog ? await loadCatalogData() : { motorCatalog: [], motorPricing: [], handphoneCatalog: [], handphonePricing: [] };
        const needsDocuments = !!lead && (mediaInbound || currentStep === 'STEP_04_DOCUMENTS' || isDocumentStatusQuestion(text));
        const leadDocuments = needsDocuments ? (await loadDocuments()).filter(row => clean(row['Lead ID']) === clean(lead['Lead ID'])) : [];
        let instantDecision = buildInstantSalesDecision({
          state: conversationState || {}, lead: lead || {}, documents: leadDocuments, text, messageType: message.type || 'text', routeBusinessUnit, routeRegion, branches,
          ...catalogData, suppressDocumentAcknowledgement
        });
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
        const willReply = routeUsable && !human && instantDecision.handled;
        if (documentAckReserved && !willReply) documentBatchAcknowledgements.delete(documentAckKey);
        let instantResult = { sent: false };
        if (!lead) {
          const timestamp = new Date().toISOString();
          const existingCustomer = leads.find(row => digits(row['Phone Number']) === phone), customerId = clean(existingCustomer?.['Customer ID']) || makeId('CUS');
          lead = { 'Lead ID': makeId('LEAD'), 'Customer ID': customerId, 'Customer Name': existingCustomer?.['Customer Name'] || profileName || `WhatsApp Customer ${phone.slice(-4)}`, 'Phone Number': phone, 'Normalized Phone': phone, Region: routeRegion, 'Business Unit': routeBusinessUnit, 'Team ID': teamId, 'Selected Branch ID': branchId, 'Assigned SA ID': '' };
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
          await ensureHeaders(token, 'Applications', ['Region', 'Business Unit', 'Customer ID', 'Team ID', 'Origin WhatsApp Channel ID', 'Product Category', 'Product Brand', 'Product Model', 'Product Variant', 'Motor Type', 'Application Status', 'Current Stage', 'Processing Mode', 'Assigned Branch ID', 'Assigned SA ID', 'Document Status', 'Minimum Documents Complete', 'Missing Documents', 'Credit Consent Status', 'Credit Check Status', 'SA Review Required', 'Created By', 'Updated By']);
          await appendObject(token, 'Applications', application);
          applications.push(application);

          await bindDocumentsToApplication(token, leadDocuments, application['Application ID']);
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
          if (step === 'STEP_01_NAME') {
            const customerName = extractCustomerName(text);
            if (customerName) {
              identityState['Customer Name'] = customerName;
              leadIdentity['Customer Name'] = customerName;
            }
          }
          if (step === 'STEP_02_LOCATION') {
            const location = resolveCustomerLocation(text, routeBusinessUnit, branches);
            if (location) {
              leadIdentity.Region = location.region;
              leadIdentity.State = location.state;
              leadIdentity['City or Area'] = location.city;
              if (location.branchId) {
                leadIdentity['Selected Branch ID'] = location.branchId;
                identityState['Selected Branch ID'] = location.branchId;
              }
              if (location.teamId) {
                teamId = location.teamId;
                leadIdentity['Team ID'] = location.teamId;
                identityState['Team ID'] = location.teamId;
              }
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
        if (documentAckReserved && !instantResult.sent) documentBatchAcknowledgements.delete(documentAckKey);
        const routingStatus = !channelId ? 'UNREGISTERED_CHANNEL' : !routeUsable ? 'CHANNEL_DISABLED_ADMIN_REVIEW' : routeRegion === 'UNASSIGNED' ? 'ADMIN_REVIEW_REQUIRED' : 'MATCHED';
        const media = message.document || message.image;
        const attachmentUrl = media?.id ? buildMediaProxyUrl({ mediaId: media.id, channelId, credentialKey: route['Credential Key'] || channelId }) : '';
        await appendObject(token, 'Customer_Inbox', { 'Received At': receivedAt, 'Phone Number': phone, 'Customer Message': text, 'Attachment URL': attachmentUrl, 'Attachment Type': mediaInbound ? message.type : '', 'Message ID': message.id || makeId('MSG'), Channel: 'WHATSAPP', Source: 'META_CLOUD', 'Lead ID': lead['Lead ID'] || '', 'Application ID': application['Application ID'] || '', 'Message Type': message.type || 'text', 'Process Status': !routeUsable || routeRegion === 'UNASSIGNED' ? 'HUMAN_HANDOVER_REQUIRED' : human ? 'HUMAN_HANDOVER_REQUIRED' : mediaInbound ? 'AI_DOCUMENT_QUEUED' : instantResult.sent ? (instantDecision.aiGenerated ? 'AI_REPLIED_KNOWLEDGE_FALLBACK' : 'AI_REPLIED_INSTANTLY') : 'NEW', 'AI Processed': mediaInbound ? 'FALSE' : instantResult.sent ? 'TRUE' : 'FALSE', 'Webhook ID': makeId('WEBHOOK'), 'WhatsApp Number ID': numberId, 'WhatsApp Display Number': displayNumber || route['Display Number'], 'WABA ID': route['WABA ID'] || entry.id || '', 'Conversation Key': `${channelId || numberId || 'UNROUTED'}:${phone}`, 'Webhook Source': 'META_CLOUD', 'Number Routing Status': routingStatus, 'Internal Channel ID': channelId, 'Business Unit': clean(instantDecision.productUnit || routeBusinessUnit), 'Customer ID': lead['Customer ID'] || '', 'Team ID': teamId });
        if (instantResult.sent || instantResult.error) {
          const timestamp = new Date().toISOString();
          const imageOutboxPrefix = instantDecision.productUnit === 'HANDPHONE' ? 'JKM-HP-IMG' : 'JKM-S03C-IMG';
          const outboxId = instantDecision.imageUrl && message.id ? `${imageOutboxPrefix}-${message.id}` : makeId('OUT');
          await appendObject(token, 'Message_Outbox', {
            'Outbox ID': outboxId, 'Created At': timestamp, 'Lead ID': lead['Lead ID'] || '', 'Application ID': application['Application ID'] || '',
            'Phone Number': phone, 'Message Type': instantResult.messageType || 'TEXT', 'Message Text': clean(instantDecision.text), 'Image URL': clean(instantDecision.imageUrl),
            'Image Caption': clean(instantDecision.text), 'Send Status': instantResult.sent ? 'SENT' : 'FAILED', 'Attempt Count': '1', 'Sent At': instantResult.sent ? timestamp : '',
            'Provider Message ID': instantResult.providerMessageId || '', 'Error Message': instantResult.error || '', 'WhatsApp Number ID': numberId,
            'WABA ID': route['WABA ID'] || entry.id || '', 'Internal Channel ID': channelId, 'Make Connection Alias': route['Make Connection Alias'] || '',
            'Reply To Message ID': message.id || '', 'Send Routing Status': `${instantResult.sent ? (instantDecision.aiGenerated ? 'WEBHOOK_KNOWLEDGE_AI_FALLBACK' : 'WEBHOOK_INSTANT_SALES') : 'WEBHOOK_INSTANT_SALES_FAILED'}:${channelId}`,
            'Business Unit': clean(instantDecision.productUnit || routeBusinessUnit), 'Customer ID': lead['Customer ID'] || '', 'Team ID': teamId
          });
        }
        if (channelId) await updateObject(token, 'WhatsApp_Number_Master', 'Internal Channel ID', channelId, { 'Last Inbound At': receivedAt, 'Last Verified At': receivedAt, 'Updated At': receivedAt }, 'AC');
        if (media?.id) {
          await ensureHeaders(token, 'Document_Log', ['Uploaded By', 'Reviewed By', 'Reviewed At']);
          const inferredDocumentType = inferDocumentTypeFromFileName(message.document?.filename || '');
          await appendObject(token, 'Document_Log', {
          'Document ID': makeId('DOC'), 'Application ID': application['Application ID'] || '', 'Lead ID': lead['Lead ID'] || '',
          'Received At': new Date(Number(message.timestamp || Date.now() / 1000) * 1000).toISOString(), 'Message ID': message.id || '',
          'Document Type': inferredDocumentType, 'Media ID': media.id, 'Mime Type': media.mime_type || '', 'File Name': message.document?.filename || '', 'File URL': attachmentUrl,
          'Classification Status': inferredDocumentType === 'UNCLASSIFIED' ? 'AI_QUEUED' : 'FILENAME_CLASSIFIED_PENDING_AI', 'Quality Status': 'PENDING_AI', 'Verification Status': 'PENDING_AI', 'Duplicate Status': 'NOT_CHECKED',
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
    if (outboundSent) return res.status(200).json({ ok: true, warning: 'POST_SEND_LOGGING_FAILED' });
    for (const messageId of reservedMessageIds) releaseInboundMessage(messageId);
    return res.status(500).json({ ok: false });
  }
}

