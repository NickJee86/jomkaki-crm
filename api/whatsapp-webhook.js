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
    if (language === 'ZH') return `店内贷款的最低文件要求是 MyKad 正反面，以及最新薪水单或 EPF 记录。我已经收到 ${status.rows.length} 份文件，包括${received}，目前正在核对，不需要重新发送。如果文件齐全，我会自动发送 CTOS/CCRIS 同意书给您签署。`;
    if (language === 'EN') return `For a shop-loan application, the minimum documents are the front and back of your MyKad plus your latest payslip or EPF statement. I have received ${status.rows.length} file${status.rows.length === 1 ? '' : 's'}, including ${received}, and they are being checked, so there is no need to resend them. If everything is complete, I will send the CTOS/CCRIS consent form for your signature.`;
    return `Untuk permohonan loan kedai, dokumen minimum ialah IC depan dan belakang serta slip gaji terkini atau penyata EPF. Saya sudah terima ${status.rows.length} fail anda termasuk ${received} dan sedang membuat semakan, jadi tak perlu hantar semula. Jika semuanya lengkap, saya akan hantar borang kebenaran CTOS/CCRIS untuk anda tandatangan.`;
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
  return Number.isFinite(receivedTime) && Number.isFinite(currentTime) && c…25457 tokens truncated…ed = !!clean(lead?.['City or Area'] || lead?.State || conversationState?.['Selected Branch ID']);
        const conversationalText = ['text', 'button', 'interactive'].includes(clean(message.type).toLowerCase());
        const onboardingStep = !currentStep || ['STEP_01_WELCOME', 'STEP_01_NAME', 'STEP_02_LOCATION'].includes(currentStep);
        const needsCatalog = ['STEP_03_PRODUCT', 'STEP_04_DOCUMENTS'].includes(currentStep) || locationConfirmed || (conversationalText && onboardingStep);
        const catalogData = needsCatalog ? await loadCatalogData() : { motorCatalog: [], motorPricing: [], handphoneCatalog: [], handphonePricing: [] };
        const needsDocuments = !!lead && (mediaInbound || currentStep === 'STEP_04_DOCUMENTS' || isDocumentStatusQuestion(text));
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
        const willReply = routeUsable && !human && instantDecision.handled;
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
        await appendObject(token, 'Customer_Inbox', { 'Received At': receivedAt, 'Phone Number': phone, 'Customer Message': text, 'Attachment URL': attachmentUrl, 'Attachment Type': mediaInbound ? message.type : '', 'Message ID': message.id || makeId('MSG'), Channel: 'WHATSAPP', Source: 'META_CLOUD', 'Lead ID': lead['Lead ID'] || '', 'Application ID': application['Application ID'] || '', 'Message Type': message.type || 'text', 'Process Status': !routeUsable || routeRegion === 'UNASSIGNED' ? 'HUMAN_HANDOVER_REQUIRED' : human || instantDecision.humanFollowUpRequired ? 'HUMAN_HANDOVER_REQUIRED' : mediaInbound ? 'AI_DOCUMENT_QUEUED' : instantResult.sent ? (aiIntent ? 'AI_REPLIED_INTENT_GROUNDED' : instantDecision.aiGenerated ? 'AI_REPLIED_KNOWLEDGE_FALLBACK' : 'AI_REPLIED_INSTANTLY') : 'NEW', 'AI Processed': mediaInbound ? 'FALSE' : instantResult.sent ? 'TRUE' : 'FALSE', 'Webhook ID': makeId('WEBHOOK'), 'WhatsApp Number ID': numberId, 'WhatsApp Display Number': displayNumber || route['Display Number'], 'WABA ID': route['WABA ID'] || entry.id || '', 'Conversation Key': `${channelId || numberId || 'UNROUTED'}:${phone}`, 'Webhook Source': 'META_CLOUD', 'Number Routing Status': routingStatus, 'Internal Channel ID': channelId, 'Business Unit': clean(instantDecision.productUnit || routeBusinessUnit), 'Customer ID': lead['Customer ID'] || '', 'Team ID': teamId });
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
