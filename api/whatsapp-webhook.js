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
const requiresManager = text => /(human|agent|manager|supervisor|real person|çœŸäºº|äººå·¥|å®¢æœ|ç»ç†|ä¸»ç®¡|pegawai|pengurus|ejen|orang sebenar)/i.test(clean(text));
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
  const documentReply = /^(?:Received|Dokumen (?:anda )?sudah diterima|æ–‡ä»¶å·²ç»æ”¶åˆ°)/i.test(lastMessage);
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
    || /(?:éƒ½å‘å®Œ|å·²ç»å‘å®Œ|è¿˜ç¼º|è¿˜éœ€è¦|ä»€ä¹ˆæ–‡ä»¶)/u.test(clean(value));
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
    if (language === 'ZH') return 'æˆ‘ç›®å‰è¿˜æ²¡æœ‰åœ¨æ‚¨çš„ç”³è¯·é‡Œçœ‹åˆ°æ–‡ä»¶ã€‚è¯·æŠŠ MyKad æ­£åé¢ï¼Œä»¥åŠæœ€æ–°è–ªæ°´å•æˆ– EPF è®°å½•å‘åˆ°è¿™é‡Œã€‚';
    if (language === 'EN') return 'I cannot see any document in your application yet. Please send the front and back of your MyKad, plus your latest payslip or EPF statement here.';
    return 'Saya belum nampak dokumen dalam permohonan anda. Boleh hantar IC depan dan belakang, serta slip gaji terkini atau penyata EPF di sini.';
  }
  const received = status.labels.length ? status.labels.join(', ') : `${status.rows.length} fail`;
  if (status.failed) {
    if (language === 'ZH') return `æˆ‘å·²ç»æ”¶åˆ° ${status.rows.length} ä»½æ–‡ä»¶ï¼Œä½†å…¶ä¸­æœ‰æ–‡ä»¶ä¸æ¸…æ¥šæˆ–æœªé€šè¿‡æ£€æŸ¥ã€‚æˆ‘ä¼šæ˜ç¡®å‘Šè¯‰æ‚¨éœ€è¦é‡æ–°å‘é€å“ªä¸€ä»½ï¼Œä¸éœ€è¦å…¨éƒ¨é‡å‘ã€‚`;
    if (language === 'EN') return `I have received ${status.rows.length} file${status.rows.length === 1 ? '' : 's'}, but at least one is unclear or did not pass checking. I will tell you exactly which file needs to be resent; you do not need to resend everything.`;
    return `Baik, saya sudah terima ${status.rows.length} fail. Ada dokumen yang kurang jelas atau belum lulus semakan. Saya akan beritahu fail yang tepat untuk dihantar semula; tak perlu hantar semuanya sekali lagi.`;
  }
  if (status.pending) {
    if (language === 'ZH') return Ûm=ÖÚ$z{-®éÜj×FöârÂv–çFW&7F—fRuÒæ–æ6ÇVFW2†6ÆVâ†ÖW76vRçG—R’çFôÆ÷vW$66R‚’“°¢6öç7Böæ&ö&F–æu7FWÒ7W'&VçE7FWÇÂ²u5DUóõtTÄ4ôÔRrÂu5DUóôäÔRrÂu5DUó%ôÄô4D”ôâuÒæ–æ6ÇVFW2†7W'&VçE7FW“°¢6öç7BæVVG46FÆörÒ²u5DUó5õ$ôET5BrÂu5DUóEôDô5TÔTåE2uÒæ–æ6ÇVFW2†7W'&VçE7FW’ÇÂÆö6F–öä6öæf—&ÖVBÇÂ†6öçfW'6F–öæÅFW‡Bbböæ&ö&F–æu7FW“°¢6öç7B6FÆötFFÒæVVG46FÆöròv—BÆöD6FÆötFF‚’¢²Ö÷F÷$6FÆös¢µÒÂÖ÷F÷%&–6–æs¢µÒÂ†æG†öæT6FÆös¢µÒÂ†æG†öæU&–6–æs¢µÒÓ°¢6öç7BæVVG4Fö7VÖVçG2ÒÆVBbb†ÖVF––æ&÷VæBÇÂ7W'&VçE7FWÓÓÒu5DUóEôDô5TÔTåE2rÇÂ—4Fö7VÖVçE7FGW5VW7F–öâ‡FW‡B’“°¢6öç7BÆVDFö7VÖVçG2ÒæVVG4Fö7VÖVçG2ò†v—BÆöDFö7VÖVçG2‚’’æf–ÇFW"‡&÷rÓâ6ÆVâ‡&÷u²tÆVB”BuÒ’ÓÓÒ6ÆVâ†ÆVE²tÆVB”BuÒ’’¢µÓ°¢ÆWB–ç7FçDFV6—6–öâÒ'V–ÆD–ç7FçE6ÆW4FV6—6–öâ‡°¢7FFS¢6öçfW'6F–öå7FFRÇÂ·ÒÂÆVC¢ÆVBÇÂ·ÒÂFö7VÖVçG3¢ÆVDFö7VÖVçG2ÂFW‡BÂÖW76vUG—S¢ÖW76vRçG—RÇÂwFW‡BrÂ&÷WFT'W6–æW75Væ—BÂ&÷WFU&Vv–öâÂ'&æ6†W2À¢ââæ6FÆötFFÂ7W&W74Fö7VÖVçD6¶æ÷vÆVFvVÖVç@¢Ò“°¢–b‡&÷WFUW6&ÆRbb‡VÖâbb–ç7FçDFV6—6–öâæ”fÆÆ&6²’°¢6öç7BvVæW&FVE&WÇ’Òv—B&WVW7D”fÆÆ&6µ&WÇ’‡°¢FW‡BÀ¢7FFS¢6öçfW'6F–öå7FFRÇÂ·ÒÀ¢ÆVC¢ÆVBÇÂ·ÒÀ¢&÷WFT'W6–æW75Væ—BÀ¢&÷WFU&Vv–öâÀ¢†öæP¢Ò“°¢–b†vVæW&FVE&WÇ’’–ç7FçDFV6—6–öâÒ²ââæ–ç7FçDFV6—6–öâÂFW‡C¢vVæW&FVE&WÇ’Â”vVæW&FVC¢G'VRÓ°¢Ğ¢6öç7Bv–ÆÅ&WÇ’Ò&÷WFUW6&ÆRbb‡VÖâbb–ç7FçDFV6—6–öâæ†æFÆVC°¢–b†Fö7VÖVçD6µ&W6W'fVBbbv–ÆÅ&WÇ’’Fö7VÖVçD&F6„6¶æ÷vÆVFvVÖVçG2æFVÆWFR†Fö7VÖVçD6´¶W’“°¢ÆWB–ç7FçE&W7VÇBÒ²6VçC¢fÇ6RÓ°¢–b‚ÆVB’°¢6öç7BF–ÖW7F×ÒæWrFFR‚’çFô•4õ7G&–ær‚“°¢6öç7BW†—7F–æt7W7FöÖW"ÒÆVG2æf–æB‡&÷rÓâF–v—G2‡&÷u²u†öæRçVÖ&W"uÒ’ÓÓÒ†öæR’Â7W7FöÖW$–BÒ6ÆVâ†W†—7F–æt7W7FöÖW#òå²t7W7FöÖW"”BuÒ’ÇÂÖ¶T–B‚t5U2r“°¢ÆVBÒ²tÆVB”Bs¢Ö¶T–B‚tÄTBr’Ât7W7FöÖW"”Bs¢7W7FöÖW$–BÂt7W7FöÖW"æÖRs¢W†—7F–æt7W7FöÖW#òå²t7W7FöÖW"æÖRuÒÇÂ&öf–ÆTæÖRÇÂv†G47W7FöÖW"G·†öæRç6Æ–6R‚ÓB—ÖÂu†öæRçVÖ&W"s¢†öæRÂtæ÷&ÖÆ—¦VB†öæRs¢†öæRÂ&Vv–öã¢&÷WFU&Vv–öâÂt'W6–æW72Væ—Bs¢&÷WFT'W6–æW75Væ—BÂuFVÒ”Bs¢FVÔ–BÂu6VÆV7FVB'&æ6‚”Bs¢'&æ6„–BÂt76–væVB4”Bs¢rrÓ°¢v—BVç7W&T†VFW'2‡Fö¶VâÂtÆVG2rÂ²tÆVB6÷W&6RrÂt7&VFVB'’rÂuWFFVB'’uÒ“°¢v—BVæDö&¦V7B‡Fö¶VâÂtÆVG2rÂ²ââæÆVBÂt7&VFVBBs¢F–ÖW7F×ÂuWFFVBBs¢F–ÖW7F×ÂtÆVB7FGW2s¢täUrrÂu&ö6W76–ærÖöFRs¢t•ôÔätTBrÂtÆVB6÷W&6Rs¢ut„E4ô4ÄõTBrÂu6÷W&6R6†ææVÂs¢ut„E4ô4ÄõTBrÂu&–Ö'’v†G46†ææVÂ”Bs¢6†ææVÄ–BÂtÆ7B–æ&÷VæBv†G46†ææVÂ”Bs¢6†ææVÄ–BÂtÆ7B–æ&÷VæBv†G4çVÖ&W"”Bs¢çVÖ&W$–BÂtÆ7B–æ&÷VæBBs¢&V6V—fVDBÂæ÷FW3¢t’ÖÖævVBÆVC²7Ffb&VÖ–ç2Væ76–væVBVæÆW72Fö7VÖVçB6öÆÆV7F–öâ÷"föÆÆ÷r×Wf–Ç2rÂt7&VFVB'’s¢tÔUDõtT$„ôô²rÂuWFFVB'’s¢tÔUDõtT$„ôô²rÒ“°¢ÆVG2çW6‚†ÆVB“°¢ÒVÇ6R°¢v—BVç7W&T†VFW'2‡Fö¶VâÂtÆVG2rÂ²tÆVB6÷W&6RrÂt7&VFVB'’rÂuWFFVB'’uÒ“°¢v—BWFFTö&¦V7B‡Fö¶VâÂtÆVG2rÂtÆVB”BrÂÆVE²tÆVB”BuÒÂ²tÆ7B–æ&÷VæBv†G46†ææVÂ”Bs¢6†ææVÄ–BÂtÆ7B–æ&÷VæBv†G4çVÖ&W"”Bs¢çVÖ&W$–BÂtÆ7B–æ&÷VæBBs¢&V6V—fVDBÂtÆ7B7W7FöÖW"&WÇ’Bs¢&V6V—fVDBÂuWFFVBBs¢&V6V—fVDBÂuWFFVB'’s¢tÔUDõtT$„ôô²rÂt'W6–æW72Væ—Bs¢&÷WFT'W6–æW75Væ—BÂuFVÒ”Bs¢FVÔ–BÒÂtr“°¢ÆVE²tÆ7B–æ&÷VæBBuÒÒ&V6V—fVDC°¢ÆVE²tÆ7B7W7FöÖW"&WÇ’BuÒÒ&V6V—fVDC°¢Ğ¢6öç7B6†÷VÆDVç7W&TÆ–6F–öâÒÖVF––æ&÷VæBÇÂ7W'&VçE7FWÓÓÒu5DUóEôDô5TÔTåE2rÇÂ6ÆVâ†–ç7FçDFV6—6–öâææW‡E7FW’çFõWW$66R‚’ÓÓÒu5DUóEôDô5TÔTåE2rÇÂ—4Fö7VÖVçE7FGW5VW7F–öâ‡FW‡B“°¢6öç7B6†÷VÆDÆöDÆ–6F–öâÒ6†÷VÆDVç7W&TÆ–6F–öâÇÂ6ÆVâ†6öçfW'6F–öå7FFSòå²tÆ–6F–öâ”BuÒ“°¢6öç7BÆ–6F–öç2Ò6†÷VÆDÆöDÆ–6F–öâòv—BÆöDÆ–6F–öç2‚’¢µÓ°¢ÆWBÆ–6F–öâÒÆ–6F–öç2æf–ÇFW"‡&÷rÓâ&÷u²tÆVB”BuÒbb&÷u²tÆVB”BuÒÓÓÒÆVE²tÆVB”BuÒ’æB‚Ó’ÇÂ·Ó°¢–b‚6ÆVâ†Æ–6F–öå²tÆ–6F–öâ”BuÒ’bb6†÷VÆDVç7W&TÆ–6F–öâ’°¢Æ–6F–öâÒ'V–ÆDWFöÖF–4Æ–6F–öâ‡²ÆVBÂ7FFS¢6öçfW'6F–öå7FFRÇÂ·ÒÂ&÷WFRÂFV6—6–öã¢–ç7FçDFV6—6–öâÂ&V6V—fVDBÂ6†ææVÄ–BÂ'W6–æW75Væ—C¢&÷WFT'W6–æW75Væ—BÂFVÔ–BÒ“°¢v—BVç7W&T†VFW'2‡Fö¶VâÂtÆ–6F–öç2rÂ²u&Vv–öârÂt'W6–æW72Væ—BrÂt7W7FöÖW"”BrÂuFVÒ”BrÂt÷&–v–âv†G46†ææVÂ”BrÂu&öGV7B6FVv÷'’rÂu&öGV7B'&æBrÂu&öGV7BÖöFVÂrÂu&öGV7Bf&–çBrÂtÖ÷F÷"G—RrÂtÆ–6F–öâ7FGW2rÂt7W'&VçB7FvRrÂu&ö6W76–ærÖöFRrÂt76–væVB'&æ6‚”BrÂt76–væVB4”BrÂtFö7VÖVçB7FGW2rÂtÖ–æ–×VÒFö7VÖVçG26ö×ÆWFRrÂtÖ—76–ærFö7VÖVçG2rÂt7&VF—B6öç6VçB7FGW2rÂt7&VF—B6†V6²7FGW2rÂu4&Wf–Wr&WV—&VBrÂt7&VFVB'’rÂuWFFVB'’uÒ“°¢v—BVæDö&¦V7B‡Fö¶VâÂtÆ–6F–öç2rÂÆ–6F–öâ“°¢Æ–6F–öç2çW6‚†Æ–6F–öâ“°¢v—B&–æDFö7VÖVçG5FôÆ–6F–öâ‡Fö¶VâÂÆVDFö7VÖVçG2ÂÆ–6F–öå²tÆ–6F–öâ”BuÒ“°¢Ğ¢6öçfW'6F–öå7FFRÒ6öçfW'6F–öå7FFRÇÂ6öçfW'6F–öå7FFW2æf–ÇFW"‡&÷rÓâ6ÆVâ‡&÷u²tÆVB”BuÒ’ÓÓÒ6ÆVâ†ÆVE²tÆVB”BuÒ’’æB‚Ó“°¢–b‚6öçfW'6F–öå7FFR’°¢6öçfW'6F–öå7FFRÒ'V–ÆD–æ—F–Ä6öçfW'6F–öå7FFR‡²ÆVBÂÆ–6F–öâÂ&÷WFRÂ†öæRÂFW‡BÂÖW76vT–C¢ÖW76vRæ–BÂ&V6V—fVDBÂçVÖ&W$–BÂF—7Æ”çVÖ&W"ÂVçG'”–C¢VçG'’æ–BÂ6†ææVÄ–BÂ'W6–æW75Væ—C¢&÷WFT'W6–æW75Væ—BÂFVÔ–BÒ“°¢–b‡v–ÆÅ&WÇ’’°¢6öçfW'6F–öå7FFU²t7W'&VçB7FWuÒÒ–ç7FçDFV6—6–öâææW‡E7FWÇÂ6öçfW'6F–öå7FFU²t7W'&VçB7FWuÓ°¢6öçfW'6F–öå7FFU²u&öGV7B6FVv÷'’uÒÒ6ÆVâ†–ç7FçDFV6—6–öâç&öGV7EVæ—BÇÂ&÷WFT'W6–æW75Væ—B“°¢Ğ¢v—BVæDö&¦V7B‡Fö¶VâÂt6öçfW'6F–öåõ7FFRrÂ6öçfW'6F–öå7FFR“°¢6öçfW'6F–öå7FFW2çW6‚†6öçfW'6F–öå7FFR“°¢ÒVÇ6R°¢6öç7B–FVçF—G•7FFRÒ·Ó°¢6öç7BÆVD–FVçF—G’Ò·Ó°¢6öç7B7FWÒ6ÆVâ†6öçfW'6F–öå7FFU²t7W'&VçB7FWuÒ’çFõWW$66R‚“°¢–b‡7FWÓÓÒu5DUóôäÔRrbb–ç7FçDFV6—6–öâç&öGV7D–çFVçB’°¢6öç7B7W7FöÖW$æÖRÒW‡G&7D7W7FöÖW$æÖR‡FW‡B“°¢–b†7W7FöÖW$æÖR’°¢–FVçF—G•7FFU²t7W7FöÖW"æÖRuÒÒ7W7FöÖW$æÖS°¢ÆVD–FVçF—G•²t7W7FöÖW"æÖRuÒÒ7W7FöÖW$æÖS°¢Ğ¢Ğ¢–b‡7FWÓÓÒu5DUó%ôÄô4D”ôâr’°¢6öç7BÆö6F–öâÒ&W6öÇfT7W7FöÖW$Æö6F–öâ‡FW‡BÂ&÷WFT'W6–æW75Væ—BÂ'&æ6†W2“°¢–b†Æö6F–öâ’°¢ÆVD–FVçF—G’å&Vv–öâÒÆö6F–öâç&Vv–öã°¢ÆVD–FVçF—G’å7FFRÒÆö6F–öâç7FFS°¢ÆVD–FVçF—G•²t6—G’÷"&VuÒÒÆö6F–öâæ6—G“°¢–b†Æö6F–öâæ'&æ6„–B’°¢ÆVD–FVçF—G•²u6VÆV7FVB'&æ6‚”BuÒÒÆö6F–öâæ'&æ6„–C°¢–FVçF—G•7FFU²u6VÆV7FVB'&æ6‚”BuÒÒÆö6F–öâæ'&æ6„–C°¢Ğ¢–b†Æö6F–öâçFVÔ–B’°¢FVÔ–BÒÆö6F–öâçFVÔ–C°¢ÆVD–FVçF—G•²uFVÒ”BuÒÒÆö6F–öâçFVÔ–C°¢–FVçF—G•7FFU²uFVÒ”BuÒÒÆö6F–öâçFVÔ–C°¢Ğ¢Ğ¢Ğ¢–b„ö&¦V7Bæ¶W—2†ÆVD–FVçF—G’’æÆVæwF‚’°¢ÆVD–FVçF—G•²uWFFVBBuÒÒ&V6V—fVDC°¢ÆVD–FVçF—G•²uWFFVB'’uÒÒtÔUDõtT$„ôôµõ4ÄU5ôdÄõrs°¢v—BWFFTö&¦V7B‡Fö¶VâÂtÆVG2rÂtÆVB”BrÂÆVE²tÆVB”BuÒÂÆVD–FVçF—G’Âtr“°¢ö&¦V7Bæ76–vâ†ÆVBÂÆVD–FVçF—G’“°¢Ğ¢6öç7BÆFW7D–æ&÷VæBÒ°¢tÆ–6F–öâ”Bs¢6ÆVâ†Æ–6F–öå²tÆ–6F–öâ”BuÒÇÂ6öçfW'6F–öå7FFU²tÆ–6F–öâ”BuÒ’À¢tÆ7B7W7FöÖW"ÖW76vRs¢6ÆVâ‡FW‡B’À¢tÆ7BÖW76vR”Bs¢6ÆVâ†ÖW76vRæ–B’À¢tÆ7B7W7FöÖW"&WÇ’Bs¢6ÆVâ‡&V6V—fVDB’À¢uWFFVBBs¢6ÆVâ‡&V6V—fVDB’ÇÂæWrFFR‚’çFô•4õ7G&–ær‚’À¢t–çFW&æÂ6†ææVÂ”Bs¢6ÆVâ†6†ææVÄ–B’À¢uv†G4çVÖ&W"”Bs¢6ÆVâ†çVÖ&W$–B’À¢ut$”Bs¢6ÆVâ‡&÷WFU²ut$”BuÒÇÂVçG'’æ–B’À¢uv†G4F—7Æ’çVÖ&W"s¢6ÆVâ†F—7Æ”çVÖ&W"ÇÂ&÷WFU²tF—7Æ’çVÖ&W"uÒ’À¢t6†ææVÂ&–æF–ær7FGW2s¢6ÆVâ†6†ææVÄ–B’òt$õTäBr¢uTä$õTäBrÀ¢t'W6–æW72Væ—Bs¢6ÆVâ‡&÷WFT'W6–æW75Væ—B’À¢t7W7FöÖW"”Bs¢6ÆVâ†ÆVE²t7W7FöÖW"”BuÒ’À¢uFVÒ”Bs¢6ÆVâ‡FVÔ–B’À¢âââ‡v–ÆÅ&WÇ’ò°¢t7W'&VçB7FWs¢6ÆVâ†–ç7FçDFV6—6–öâææW‡E7FWÇÂ6öçfW'6F–öå7FFU²t7W'&VçB7FWuÒ’À¢u&öGV7B6FVv÷'’s¢6ÆVâ†–ç7FçDFV6—6–öâç&öGV7EVæ—BÇÂ6öçfW'6F–öå7FFU²u&öGV7B6FVv÷'’uÒÇÂ&÷WFT'W6–æW75Væ—B¢Ò¢·Ò’À¢ââæ–FVçF—G•7FFP¢Ó°¢v—BWFFTö&¦V7B‡Fö¶VâÂt6öçfW'6F–öåõ7FFRrÂu7FFR”BrÂ6öçfW'6F–öå7FFU²u7FFR”BuÒÂÆFW7D–æ&÷VæBÂt²r“°¢ö&¦V7Bæ76–vâ†6öçfW'6F–öå7FFRÂÆFW7D–æ&÷VæB“°¢Ğ¢–b‡v–ÆÅ&WÇ’’°¢–ç7FçE&W7VÇBÒv—B6VæD–ç7FçE6ÆW4ÖW76vR‡²&÷WFRÂ†öæRÂFV6—6–öã¢–ç7FçDFV6—6–öâÒ“°¢–b†–ç7FçE&W7VÇBç6VçB’°¢÷WF&÷VæE6VçBÒG'VS°¢6öç7BFVÆ—fW&VE7FFRÒ°¢tÆ7B’ÖW76vRs¢6ÆVâ†–ç7FçDFV6—6–öâçFW‡B’À¢tÆ7B’ÖW76vRBs¢æWrFFR‚’çFô•4õ7G&–ær‚’À¢u6VÆV7FVB&öGV7B'&æBs¢6ÆVâ†–ç7FçDFV6—6–öâç&öGV7Còä'&æB’À¢u6VÆV7FVB&öGV7BÖöFVÂs¢6ÆVâ†–ç7FçDFV6—6–öâç&öGV7CòäÖöFVÂ¢Ó°¢v—BWFFTö&¦V7B‡Fö¶VâÂt6öçfW'6F–öåõ7FFRrÂu7FFR”BrÂ6öçfW'6F–öå7FFU²u7FFR”BuÒÂFVÆ—fW&VE7FFRÂt²r“°¢ö&¦V7Bæ76–vâ†6öçfW'6F–öå7FFRÂFVÆ—fW&VE7FFR“°¢Ğ¢Ğ¢–b†Fö7VÖVçD6µ&W6W'fVBbb–ç7FçE&W7VÇBç6VçB’Fö7VÖVçD&F6„6¶æ÷vÆVFvVÖVçG2æFVÆWFR†Fö7VÖVçD6´¶W’“°¢6öç7B&÷WF–æu7FGW2Ò6†ææVÄ–BòuTå$Tt•5DU$TEô4„ääTÂr¢&÷WFUW6&ÆRòt4„ääTÅôD•4$ÄTEôDÔ”åõ$Ud”Urr¢&÷WFU&Vv–öâÓÓÒuTä54”täTBròtDÔ”åõ$Ud”Uuõ$UT•$TBr¢tÔD4„TBs°¢6öç7BÖVF–ÒÖW76vRæFö7VÖVçBÇÂÖW76vRæ–ÖvS°¢6öç7BGF6†ÖVçEW&ÂÒÖVF–òæ–Bò'V–ÆDÖVF–&÷‡•W&Â‡²ÖVF––C¢ÖVF–æ–BÂ6†ææVÄ–BÂ7&VFVçF–Ä¶W“¢&÷WFU²t7&VFVçF–Â¶W’uÒÇÂ6†ææVÄ–BÒ’¢rs°¢v—BVæDö&¦V7B‡Fö¶VâÂt7W7FöÖW%ô–æ&÷‚rÂ²u&V6V—fVBBs¢&V6V—fVDBÂu†öæRçVÖ&W"s¢†öæRÂt7W7FöÖW"ÖW76vRs¢FW‡BÂtGF6†ÖVçBU$Âs¢GF6†ÖVçEW&ÂÂtGF6†ÖVçBG—Rs¢ÖVF––æ&÷VæBòÖW76vRçG—R¢rrÂtÖW76vR”Bs¢ÖW76vRæ–BÇÂÖ¶T–B‚tÕ4rr’Â6†ææVÃ¢ut„E4rÂ6÷W&6S¢tÔUDô4ÄõTBrÂtÆVB”Bs¢ÆVE²tÆVB”BuÒÇÂrrÂtÆ–6F–öâ”Bs¢Æ–6F–öå²tÆ–6F–öâ”BuÒÇÂrrÂtÖW76vRG—Rs¢ÖW76vRçG—RÇÂwFW‡BrÂu&ö6W727FGW2s¢&÷WFUW6&ÆRÇÂ&÷WFU&Vv–öâÓÓÒuTä54”täTBròt…TÔåô„äDõdU%õ$UT•$TBr¢‡VÖâòt…TÔåô„äDõdU%õ$UT•$TBr¢ÖVF––æ&÷VæBòt•ôDô5TÔTåEõTUTTBr¢–ç7FçE&W7VÇBç6VçBò†–ç7FçDFV6—6–öâæ”vVæW&FVBòt•õ$UÄ”TEô´äõtÄTDtUôdÄÄ$4²r¢t•õ$UÄ”TEô”å5DåDÅ’r’¢täUrrÂt’&ö6W76VBs¢ÖVF––æ&÷VæBòtdÅ4Rr¢–ç7FçE&W7VÇBç6VçBòuE%TRr¢tdÅ4RrÂuvV&†öö²”Bs¢Ö¶T–B‚utT$„ôô²r’Âuv†G4çVÖ&W"”Bs¢çVÖ&W$–BÂuv†G4F—7Æ’çVÖ&W"s¢F—7Æ”çVÖ&W"ÇÂ&÷WFU²tF—7Æ’çVÖ&W"uÒÂut$”Bs¢&÷WFU²ut$”BuÒÇÂVçG'’æ–BÇÂrrÂt6öçfW'6F–öâ¶W’s¢G¶6†ææVÄ–BÇÂçVÖ&W$–BÇÂuTå$õUDTBwÓ¢G·†öæWÖÂuvV&†öö²6÷W&6Rs¢tÔUDô4ÄõTBrÂtçVÖ&W"&÷WF–ær7FGW2s¢&÷WF–æu7FGW2Ât–çFW&æÂ6†ææVÂ”Bs¢6†ææVÄ–BÂt'W6–æW72Væ—Bs¢6ÆVâ†–ç7FçDFV6—6–öâç&öGV7EVæ—BÇÂ&÷WFT'W6–æW75Væ—B’Ât7W7FöÖW"”Bs¢ÆVE²t7W7FöÖW"”BuÒÇÂrrÂuFVÒ”Bs¢FVÔ–BÒ“°¢–b†–ç7FçE&W7VÇBç6VçBÇÂ–ç7FçE&W7VÇBæW'&÷"’°¢6öç7BF–ÖW7F×ÒæWrFFR‚’çFô•4õ7G&–ær‚“°¢6öç7B–ÖvT÷WF&÷…&Vf—‚Ò–ç7FçDFV6—6–öâç&öGV7EVæ—BÓÓÒt„äE„ôäRròt¤´ÒÔ…Ô”Ôrr¢t¤´ÒÕ342Ô”Ôrs°¢6öç7B÷WF&÷„–BÒ–ç7FçDFV6—6–öâæ–ÖvUW&ÂbbÖW76vRæ–BòG¶–ÖvT÷WF&÷…&Vf—‡ÒÒG¶ÖW76vRæ–GÖ¢Ö¶T–B‚tõUBr“°¢v—BVæDö&¦V7B‡Fö¶VâÂtÖW76vUô÷WF&÷‚rÂ°¢t÷WF&÷‚”Bs¢÷WF&÷„–BÂt7&VFVBBs¢F–ÖW7F×ÂtÆVB”Bs¢ÆVE²tÆVB”BuÒÇÂrrÂtÆ–6F–öâ”Bs¢Æ–6F–öå²tÆ–6F–öâ”BuÒÇÂrrÀ¢u†öæRçVÖ&W"s¢†öæRÂtÖW76vRG—Rs¢–ç7FçE&W7VÇBæÖW76vUG—RÇÂuDU…BrÂtÖW76vRFW‡Bs¢6ÆVâ†–ç7FçDFV6—6–öâçFW‡B’Ât–ÖvRU$Âs¢6ÆVâ†–ç7FçDFV6—6–öâæ–ÖvUW&Â’À¢t–ÖvR6F–öâs¢6ÆVâ†–ç7FçDFV6—6–öâçFW‡B’Âu6VæB7FGW2s¢–ç7FçE&W7VÇBç6VçBòu4TåBr¢td”ÄTBrÂtGFV×B6÷VçBs¢srÂu6VçBBs¢–ç7FçE&W7VÇBç6VçBòF–ÖW7F×¢rrÀ¢u&÷f–FW"ÖW76vR”Bs¢–ç7FçE&W7VÇBç&÷f–FW$ÖW76vT–BÇÂrrÂtW'&÷"ÖW76vRs¢–ç7FçE&W7VÇBæW'&÷"ÇÂrrÂuv†G4çVÖ&W"”Bs¢çVÖ&W$–BÀ¢ut$”Bs¢&÷WFU²ut$”BuÒÇÂVçG'’æ–BÇÂrrÂt–çFW&æÂ6†ææVÂ”Bs¢6†ææVÄ–BÂtÖ¶R6öææV7F–öâÆ–2s¢&÷WFU²tÖ¶R6öææV7F–öâÆ–2uÒÇÂrrÀ¢u&WÇ’FòÖW76vR”Bs¢ÖW76vRæ–BÇÂrrÂu6VæB&÷WF–ær7FGW2s¢G¶–ç7FçE&W7VÇBç6VçBò†–ç7FçDFV6—6–öâæ”vVæW&FVBòutT$„ôôµô´äõtÄTDtUô•ôdÄÄ$4²r¢utT$„ôôµô”å5DåEõ4ÄU2r’¢utT$„ôôµô”å5DåEõ4ÄU5ôd”ÄTBwÓ¢G¶6†ææVÄ–GÖÀ¢t'W6–æW72Væ—Bs¢6ÆVâ†–ç7FçDFV6—6–öâç&öGV7EVæ—BÇÂ&÷WFT'W6–æW75Væ—B’Ât7W7FöÖW"”Bs¢ÆVE²t7W7FöÖW"”BuÒÇÂrrÂuFVÒ”Bs¢FVÔ–@¢Ò“°¢Ğ¢–b†6†ææVÄ–B’v—BWFFTö&¦V7B‡Fö¶VâÂuv†G4ôçVÖ&W%ôÖ7FW"rÂt–çFW&æÂ6†ææVÂ”BrÂ6†ææVÄ–BÂ²tÆ7B–æ&÷VæBBs¢&V6V—fVDBÂtÆ7BfW&–f–VBBs¢&V6V—fVDBÂuWFFVBBs¢&V6V—fVDBÒÂt2r“°¢–b†ÖVF–òæ–B’°¢v—BVç7W&T†VFW'2‡Fö¶VâÂtFö7VÖVçEôÆörrÂ²uWÆöFVB'’rÂu&Wf–WvVB'’rÂu&Wf–WvVBBuÒ“°¢6öç7B–æfW'&VDFö7VÖVçEG—RÒ–æfW$Fö7VÖVçEG—Tg&öÔf–ÆTæÖR†ÖW76vRæFö7VÖVçCòæf–ÆVæÖRÇÂrr“°¢v—BVæDö&¦V7B‡Fö¶VâÂtFö7VÖVçEôÆörrÂ°¢tFö7VÖVçB”Bs¢Ö¶T–B‚tDô2r’ÂtÆ–6F–öâ”Bs¢Æ–6F–öå²tÆ–6F–öâ”BuÒÇÂrrÂtÆVB”Bs¢ÆVE²tÆVB”BuÒÇÂrrÀ¢u&V6V—fVBBs¢æWrFFR„çVÖ&W"†ÖW76vRçF–ÖW7F×ÇÂFFRææ÷r‚’ò’¢’çFô•4õ7G&–ær‚’ÂtÖW76vR”Bs¢ÖW76vRæ–BÇÂrrÀ¢tFö7VÖVçBG—Rs¢–æfW'&VDFö7VÖVçEG—RÂtÖVF–”Bs¢ÖVF–æ–BÂtÖ–ÖRG—Rs¢ÖVF–æÖ–ÖU÷G—RÇÂrrÂtf–ÆRæÖRs¢ÖW76vRæFö7VÖVçCòæf–ÆVæÖRÇÂrrÂtf–ÆRU$Âs¢GF6†ÖVçEW&ÂÀ¢t6Æ76–f–6F–öâ7FGW2s¢–æfW'&VDFö7VÖVçEG—RÓÓÒuTä4Ä54”d”TBròt•õTUTTBr¢td”ÄTäÔUô4Ä54”d”TEõTäD”äuô’rÂuVÆ—G’7FGW2s¢uTäD”äuô’rÂufW&–f–6F–öâ7FGW2s¢uTäD”äuô’rÂtGWÆ–6FR7FGW2s¢täõEô4„T4´TBrÀ¢tÖçVÂ&Wf–Wr&WV—&VBs¢tdÅ4RrÂ&VÖ&·3¢u&V6V—fVBg&öÒv†G4æBVWVVBf÷"WFöÖF–2’fÆ–FF–öârÂuWFFVBBs¢æWrFFR‚’çFô•4õ7G&–ær‚’ÂuWÆöFVB'’s¢tÔUDõtT$„ôô²rÂt'W6–æW72Væ—Bs¢&÷WFT'W6–æW75Væ—BÂt7W7FöÖW"”Bs¢ÆVE²t7W7FöÖW"”BuÒÇÂrp¢Ò“°¢Ğ¢–b†ÖW76vRæ–B’W†—7F–ætÖW76vT–G2æFB†6ÆVâ†ÖW76vRæ–B’“°¢Ğ¢f÷"†6öç7B7FGW2öbfÇVRç7FGW6W2ÇÂµÒ’v—BWFFT÷WF&÷…7FGW2‡Fö¶VâÂ7FGW2æ–BÂ7FGW2ç7FGW2Â7FGW2æW'&÷'3òå³ÓòçF—FÆRÇÂrr“°¢Ğ¢&WGW&â&W2ç7FGW2ƒ#’æ§6öâ‡²ö³¢G'VRÒ“°¢Ò6F6‚†W'&÷"’°¢6öç6öÆRæW'&÷"†W'&÷"“°¢–b†÷WF&÷VæE6VçB’&WGW&â&W2ç7FGW2ƒ#’æ§6öâ‡²ö³¢G'VRÂv&æ–æs¢uõ5Eõ4TäEôÄôtt”äuôd”ÄTBrÒ“°¢f÷"†6öç7BÖW76vT–Böb&W6W'fVDÖW76vT–G2’&VÆV6T–æ&÷VæDÖW76vR†ÖW76vT–B“°¢&WGW&â&W2ç7FGW2ƒS’æ§6öâ‡²ö³¢fÇ6RÒ“°¢Ğ§Ğ