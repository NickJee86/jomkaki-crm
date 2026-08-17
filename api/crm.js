import crypto from 'node:crypto';
import { authenticate, clearSession, getSession, hashPassword, migrateEnvironmentAccounts, setSession, validateSession } from './_auth.js';
import { FUTURE_REPORTING_FIELDS, integrationReadiness, publicIntegrationRecords } from './_integrations.js';

const SHEET_ID = process.env.JOMKAKI_SPREADSHEET_ID;
const CLIENT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const PROJECT_NUMBER = process.env.GOOGLE_PROJECT_NUMBER;
const POOL_ID = process.env.GOOGLE_WIF_POOL_ID || 'vercel-production';
const PROVIDER_ID = process.env.GOOGLE_WIF_PROVIDER_ID || 'vercel-jomkaki-production';
const clean = value => String(value ?? '').trim();
export const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
const uploadMimeExtensions = {
  'application/pdf': ['pdf'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
  'image/heic': ['heic'],
  'image/heif': ['heif']
};
export function validateUploadFile(file = {}, options = {}) {
  const label = options.label || 'File';
  const data = clean(file.data);
  const match = data.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=\r\n]+)$/);
  if (!match) throw new Error(`${label} encoding is invalid`);
  const embeddedMime = clean(match[1]).toLowerCase(), declaredMime = clean(file.type).toLowerCase();
  if (declaredMime && declaredMime !== embeddedMime) throw new Error(`${label} type does not match its content`);
  const mimeType = declaredMime || embeddedMime;
  if (!uploadMimeExtensions[mimeType] || (options.imageOnly && !mimeType.startsWith('image/'))) throw new Error(options.imageOnly ? 'Use a JPG, PNG, WebP or HEIC motor photo' : 'Use a PDF, JPG, PNG, WebP or HEIC document');
  const base64 = match[2].replace(/\s/g, '');
  if (!base64 || base64.length % 4 !== 0) throw new Error(`${label} encoding is invalid`);
  const bytes = Buffer.from(base64, 'base64');
  if (!bytes.length || bytes.length > MAX_UPLOAD_BYTES) throw new Error(`${label} must be between 1 byte and 3 MB`);
  const originalName = clean(file.name) || `${options.imageOnly ? 'photo' : 'document'}-${Date.now()}.${uploadMimeExtensions[mimeType][0]}`;
  const extension = originalName.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || '';
  if (!uploadMimeExtensions[mimeType].includes(extension)) throw new Error(`${label} filename extension does not match its type`);
  const safeName = originalName.replace(/["*:<>?/\\|#%]/g, '-').slice(0, 180);
  return { bytes, mimeType, safeName };
}
const sheetIdentifier = value => {
  const text = clean(value);
  return text ? `'${text}` : '';
};
const customerAmount = value => clean(value).replace(/^RM\s*/i, '').replace(/,/g, '');
const canonicalRegion = value => ['SARAWAK', 'SABAH', 'LABUAN', 'EAST MALAYSIA', 'EAST_MALAYSIA'].includes(clean(value).toUpperCase()) ? 'EAST_MALAYSIA' : clean(value).toUpperCase();
const canonicalRole = value => clean(value).toUpperCase() === 'BRANCH_MANAGER' ? 'BRANCH_SUPERVISOR' : clean(value).toUpperCase();
const canonicalBusinessAccess = (value, role = '') => {
  const normalizedRole = canonicalRole(role);
  if (normalizedRole === 'ADMIN' || normalizedRole === 'REGION_MANAGER') return 'BOTH';
  const access = clean(value).toUpperCase();
  if (['MOTOR', 'HANDPHONE', 'BOTH'].includes(access)) return access;
  if (normalizedRole === 'STAFF') return 'BOTH';
  if (normalizedRole === 'BUSINESS_MANAGER') return 'HANDPHONE';
  return 'MOTOR';
};
const canonicalBusinessUnit = value => ['MOTOR', 'HANDPHONE'].includes(clean(value).toUpperCase()) ? clean(value).toUpperCase() : '';
const rowBusinessUnit = row => {
  const explicit = clean(row?.['Business Unit'] || row?.businessUnit).toUpperCase();
  if (explicit === 'UNASSIGNED') return explicit;
  if (['MOTOR', 'HANDPHONE'].includes(explicit)) return explicit;
  const category = clean(row?.['Product Category'] || row?.productCategory || row?.['Enquiry Type'] || row?.model).toUpperCase();
  return /(HANDPHONE|PHONE|IPHONE|SMARTPHONE)/.test(category) ? 'HANDPHONE' : 'MOTOR';
};
const businessAllows = (access, unit) => canonicalBusinessAccess(access) === 'BOTH' || canonicalBusinessAccess(access) === canonicalBusinessUnit(unit);
const businessSheets = unit => canonicalBusinessUnit(unit) === 'HANDPHONE'
  ? { unit: 'HANDPHONE', catalog: 'Handphone_Model_Catalog', pricing: 'Handphone_Loan_Pricing', catalogMax: 'AB', pricingMax: 'AO', idPrefix: 'HP' }
  : { unit: 'MOTOR', catalog: 'Motor_Model_Catalog', pricing: 'Motor_Loan_Pricing', catalogMax: 'AB', pricingMax: 'AM', idPrefix: 'MTR' };
const handphoneCatalogApprovalHeaders = ['Approval Status', 'Submitted By', 'Submitted At', 'Approved By', 'Approved At', 'Approval Notes', 'Publish Requested', 'Submitted Region', 'Submitted Branch ID', 'Branch Availability', 'Supersedes Catalog ID'];
const handphonePricingApprovalHeaders = ['Approval Status', 'Submitted By', 'Submitted At', 'Approved By', 'Approved At', 'Approval Notes', 'Publish Requested', 'Promotion Publish Requested', 'Submitted Region', 'Submitted Branch ID', 'Minimum Product Price (RM)', 'Admin Review Required', 'Supersedes Pricing ID'];
const handphoneCatalogPublishFields = ['Brand', 'Model', 'Variant', 'Category', 'Operating System', 'Popularity Tier', 'Product Page URL', 'Image URL', 'Image Caption (MS)', 'Stock Check Mode', 'Region Availability', 'Warehouse Availability', 'Search Keywords'];
const handphonePricingPublishFields = ['Catalog ID', 'Brand', 'Model', 'Variant', 'Price Zone', 'Monthly 12 Months (RM)', 'Monthly 24 Months (RM)', 'Monthly 36 Months (RM)', 'Monthly 48 Months (RM)', 'Monthly 60 Months (RM)', 'Effective From', 'Effective To', 'Internal Notes'];
const motorCatalogPublishFields = ['Brand', 'Model', 'Variant', 'Category', 'Fuel Type', 'Popularity Tier', 'Product Page URL', 'Image URL', 'Image Caption (MS)', 'Stock Check Mode', 'Branch Availability', 'Warehouse Availability', 'Search Keywords'];
const motorPricingPublishFields = ['Catalog ID', 'Brand', 'Model', 'Variant', 'Price Zone', 'Deposit (RM)', 'Monthly 3 Years (RM)', 'Monthly 4 Years (RM)', 'Monthly 5 Years (RM)', 'Effective From', 'Effective To', 'Internal Notes', 'Promotion Name', 'Promotion Deposit (RM)', 'Promotion Start', 'Promotion End', 'Promotion Notes'];
const selectedFields = (row, fields) => Object.fromEntries(fields.map(field => [field, row[field]]));
export const productApprovalStatus = row => clean(row?.['Approval Status']).toUpperCase() || (clean(row?.['Submitted By']) ? 'PENDING_APPROVAL' : 'APPROVED');
export const handphoneApprovalStatus = productApprovalStatus;
const productRowRegion = row => canonicalRegion(row?.['Submitted Region'] || row?.['Region Availability'] || row?.['Price Zone']);
const handphoneSubmitRoles = new Set(['ADMIN', 'REGION_MANAGER', 'BRANCH_SUPERVISOR', 'BUSINESS_MANAGER']);
export const canSubmitProduct = (session, businessUnit = '') => {
  const access = canonicalBusinessAccess(session?.businessAccess, session?.role);
  const role = canonicalRole(session?.role), unit = canonicalBusinessUnit(businessUnit);
  if (!unit || !businessAllows(access, unit)) return false;
  if (role === 'ADMIN' || role === 'REGION_MANAGER') return true;
  return unit === 'HANDPHONE' && handphoneSubmitRoles.has(role);
};
export const canSubmitHandphone = session => canSubmitProduct(session, 'HANDPHONE');
export const canReviewProduct = session => canonicalRole(session?.role) === 'ADMIN';
export const canReviewHandphone = session => canReviewProduct(session);
const productVisibleToSession = (session, row, kind, businessUnit) => {
  if (!businessPermitted(session, { 'Business Unit': businessUnit })) return false;
  const role = canonicalRole(session?.role), approved = productApprovalStatus(row) === 'APPROVED';
  if (role === 'ADMIN') return true;
  if (approved && truth(row.Active) && (kind !== 'pricing' || clean(row['Quote Approval Status']).toUpperCase() === 'APPROVED')) {
    if (kind !== 'pricing' || clean(row['Price Zone']).toUpperCase() === 'ALL_BRANCHES' || canonicalRegion(row['Price Zone']) === canonicalRegion(session.region)) return true;
  }
  if (role === 'REGION_MANAGER') return canonicalRegion(session.region) === productRowRegion(row);
  if (businessUnit === 'HANDPHONE' && role === 'BRANCH_SUPERVISOR') return clean(row['Submitted Branch ID']) === clean(session.branchId);
  if (businessUnit === 'HANDPHONE' && role === 'BUSINESS_MANAGER') return clean(row['Submitted By']) === clean(session.username);
  return false;
};
const handphoneVisibleToSession = (session, row, kind) => productVisibleToSession(session, row, kind, 'HANDPHONE');
const handphoneBranchStockEntries = value => clean(value).split(';').map(entry => entry.trim()).filter(Boolean).map(entry => {
  const [branchId, status, quantity, updatedAt] = entry.split(':');
  return { branchId: clean(branchId), status: clean(status).toUpperCase(), quantity: Number(quantity) || 0, updatedAt: clean(updatedAt) };
}).filter(entry => entry.branchId);
const handphoneBranchStockText = entries => entries.map(entry => `${entry.branchId}:${entry.status}:${Math.max(0, Number(entry.quantity) || 0)}:${entry.updatedAt || now().slice(0, 10)}`).join(';');
const secondHandSheet = 'Second_Hand_Motor_Inventory';
const secondHandRange = `${secondHandSheet}!A1:AM2000`;
const secondHandApprovalHeaders = ['Approval Status', 'Submitted By', 'Submitted At', 'Approved By', 'Approved At', 'Approval Notes', 'Publish Requested'];
const secondHandSearchText = row => clean([row.Brand, row.Model, row.Variant, row['Engine CC'], row['AI Search Keywords']].filter(Boolean).join(' ')).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const secondHandNumber = value => Number(customerAmount(value)) || 0;
export const secondHandApprovalStatus = row => clean(row?.['Approval Status']).toUpperCase() || (clean(row?.['Submitted By']) ? 'PENDING_APPROVAL' : 'APPROVED');
const secondHandApproved = row => secondHandApprovalStatus(row) === 'APPROVED';
export function rankSecondHandMotors(records = [], criteria = {}) {
  const query = clean(criteria.query || criteria.model).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(), brand = clean(criteria.brand).toLowerCase();
  const region = clean(criteria.region).toUpperCase(), budget = secondHandNumber(criteria.budget), requestedCc = secondHandNumber(criteria.engineCc), tokens = query.split(' ').filter(token => token.length > 1);
  return records.filter(row => clean(row['Stock Status']).toUpperCase() === 'AVAILABLE' && truth(row['Customer Visible']) && truth(row['Image Approved']) && secondHandApproved(row)).map(record => {
    const text = secondHandSearchText(record), price = secondHandNumber(record['Selling Price (RM)']), recordRegion = clean(record.Region).toUpperCase(), recordBrand = clean(record.Brand).toLowerCase(), recordModel = clean(record.Model).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(), recordCc = secondHandNumber(record['Engine CC']);
    const exactModel = Boolean(query && (recordModel === query || text.includes(query))), matchedTokens = tokens.filter(token => text.includes(token)).length;
    const sameBrand = Boolean(brand && recordBrand === brand) || Boolean(tokens.length && tokens.includes(recordBrand)), sameRegion = Boolean(region && recordRegion === region);
    const tolerance = Math.max(secondHandNumber(record['Similar Price Tolerance (RM)']) || 1500, budget * 0.2), priceDifference = budget && price ? Math.abs(price - budget) : 0, withinBudgetRange = Boolean(budget && price && priceDifference <= tolerance), ccDifference = requestedCc && recordCc ? Math.abs(recordCc - requestedCc) : 0;
    let score = exactModel ? 1200 : 0;
    score += matchedTokens * 90 + (sameBrand ? 180 : 0) + (sameRegion ? 160 : (region ? -80 : 0));
    score += withinBudgetRange ? 320 - Math.min(260, priceDifference / 10) : (budget && price ? Math.max(-220, 120 - priceDifference / 20) : 0);
    score += requestedCc && recordCc ? Math.max(-80, 100 - ccDifference) : 0;
    score += truth(record['Image Approved']) ? 35 : 0;
    score -= secondHandNumber(record['Mileage KM']) / 10000;
    return { record, score, exactModel, sameRegion, priceDifference, matchType: exactModel ? 'EXACT_MODEL' : withinBudgetRange ? 'SIMILAR_PRICE' : sameBrand ? 'SAME_BRAND_ALTERNATIVE' : 'ALTERNATIVE' };
  }).filter(match => match.exactModel || match.score > 0 || (!query && !budget)).sort((a, b) => b.score - a.score || a.priceDifference - b.priceDifference).slice(0, Math.max(1, Math.min(Number(criteria.limit) || 3, 10)));
}
const businessPermitted = (session, row) => {
  const access = canonicalBusinessAccess(session?.businessAccess, session?.role);
  const unit = rowBusinessUnit(row);
  return ['MOTOR', 'HANDPHONE'].includes(unit) && (access === 'BOTH' || access === unit);
};
const isSyntheticLeadRow = row => /^(CODEX|QA|UAT)\s+TEST\b/i.test(clean(row['Customer Name'])) || /^(SYNTHETIC|TEST|QA|UAT)$/i.test(clean(row['Lead Source'] || row.Source)) || /\bSYNTHETIC\b/i.test(clean(row.Notes));
const isSyntheticApplicationRow = row => /^(CODEX|QA|UAT)\s+TEST\b/i.test(clean(row['Applicant Name'])) || /^TEST\s+BRAND$/i.test(clean(row['Product Brand'])) || /\bSYNTHETIC\b/i.test(clean(row['Internal Notes']));

async function getAccessToken(req) {
  const oidcToken = req.headers['x-vercel-oidc-token'] || process.env.VERCEL_OIDC_TOKEN;
  if (!oidcToken || !CLIENT_EMAIL || !PROJECT_NUMBER) throw new Error('Google workload identity is not configured');
  const providerResource = `projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}/providers/${PROVIDER_ID}`;
  const stsResponse = await fetch('https://sts.googleapis.com/v1/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ audience: `//iam.googleapis.com/${providerResource}`, grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange', requested_token_type: 'urn:ietf:params:oauth:token-type:access_token', scope: 'https://www.googleapis.com/auth/cloud-platform', subject_token_type: 'urn:ietf:params:oauth:token-type:jwt', subject_token: oidcToken })
  });
  if (!stsResponse.ok) throw new Error(`Google identity exchange failed (${stsResponse.status})`);
  const federatedToken = (await stsResponse.json()).access_token;
  const tokenResponse = await fetch(`https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(CLIENT_EMAIL)}:generateAccessToken`, {
    method: 'POST', headers: { authorization: `Bearer ${federatedToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ scope: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive.file'], lifetime: '3600s' })
  });
  if (!tokenResponse.ok) throw new Error(`Google service account authorization failed (${tokenResponse.status})`);
  return (await tokenResponse.json()).accessToken;
}

async function readRanges(req, ranges) {
  if (!SHEET_ID) throw new Error('Spreadsheet is not configured');
  const token = await getAccessToken(req);
  const params = new URLSearchParams({ majorDimension: 'ROWS' });
  ranges.forEach(range => params.append('ranges', range));
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values:batchGet?${params}`, { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Google Sheets request failed (${response.status})`);
  return (await response.json()).valueRanges.map(item => item.values || []);
}

async function appendObject(req, sheet, object) {
  const token = await getAccessToken(req);
  const [headerRows] = await readRanges(req, [`${sheet}!1:1`]);
  const headers = headerRows?.[0] || [];
  if (!headers.length) throw new Error(`${sheet} headers are missing`);
  const values = headers.map(header => object[header] ?? '');
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(sheet + '!A:A')}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ values: [values] })
  });
  if (!response.ok) throw new Error(`Unable to write ${sheet} (${response.status})`);
}

const columnName = index => {
  let name = '';
  for (let value = index + 1; value; value = Math.floor((value - 1) / 26)) name = String.fromCharCode(65 + ((value - 1) % 26)) + name;
  return name;
};

async function updateObject(req, sheet, idHeader, id, changes, maxColumn = 'BG') {
  const token = await getAccessToken(req);
  const [rows] = await readRanges(req, [`${sheet}!A1:${maxColumn}2000`]);
  const headers = rows?.[0] || [];
  const idIndex = headers.indexOf(idHeader);
  if (idIndex < 0) throw new Error(`${sheet} identifier column is missing`);
  const rowIndex = rows.findIndex((row, index) => index > 0 && clean(row[idIndex]) === clean(id));
  if (rowIndex < 1) throw new Error(`${sheet} record was not found`);
  const data = Object.entries(changes).filter(([header]) => headers.includes(header)).map(([header, value]) => ({
    range: `${sheet}!${columnName(headers.indexOf(header))}${rowIndex + 1}`,
    values: [[value ?? '']]
  }));
  if (!data.length) throw new Error('No supported fields were supplied');
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values:batchUpdate`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data })
  });
  if (!response.ok) throw new Error(`Unable to update ${sheet} (${response.status})`);
}

async function ensureSheetHeaders(req, sheet, requiredHeaders) {
  const [headerRows] = await readRanges(req, [`${sheet}!1:1`]);
  const headers = headerRows?.[0] || [];
  const missing = requiredHeaders.filter(header => !headers.includes(header));
  if (!missing.length) return headers;
  const token = await getAccessToken(req);
  const metadataResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}?fields=sheets.properties(sheetId,title,gridProperties(columnCount))`, {
    headers: { authorization: `Bearer ${token}` }
  });
  if (!metadataResponse.ok) throw new Error(`Unable to inspect ${sheet} grid (${metadataResponse.status})`);
  const metadata = await metadataResponse.json();
  const properties = (metadata.sheets || []).map(item => item.properties || {}).find(item => item.title === sheet);
  if (!properties) throw new Error(`${sheet} worksheet was not found`);
  const requiredColumnCount = headers.length + missing.length;
  const currentColumnCount = Number(properties.gridProperties?.columnCount || 0);
  if (requiredColumnCount > currentColumnCount) {
    const expandResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}:batchUpdate`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ requests: [{ appendDimension: { sheetId: properties.sheetId, dimension: 'COLUMNS', length: requiredColumnCount - currentColumnCount } }] })
    });
    if (!expandResponse.ok) throw new Error(`Unable to expand ${sheet} grid (${expandResponse.status})`);
  }
  const start = columnName(headers.length), end = columnName(headers.length + missing.length - 1);
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(`${sheet}!${start}1:${end}1`)}?valueInputOption=USER_ENTERED`, {
    method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ values: [missing] })
  });
  if (!response.ok) throw new Error(`Unable to extend ${sheet} headers (${response.status})`);
  return [...headers, ...missing];
}

async function getSharePointToken() {
  const tenant = clean(process.env.SHAREPOINT_TENANT_ID), client = clean(process.env.SHAREPOINT_CLIENT_ID), secret = clean(process.env.SHAREPOINT_CLIENT_SECRET);
  if (!tenant || !client || !secret) …38902 tokens truncated…ed', phone: row['Phone Number'],
          product: [row['Product Brand'], row['Product Model'], row['Product Variant'] || row.Variant].filter(Boolean).join(' '), brand: row['Product Brand'], model: row['Product Model'], variant: row['Product Variant'] || row.Variant,
          tenure, tenureUnit: businessUnit === 'HANDPHONE' ? 'MONTHS' : 'YEARS', deposit: businessUnit === 'HANDPHONE' ? customerAmount(row['Requested Deposit (RM)'] || effectiveDeposit(quote)) : effectiveDeposit(quote), requestedPrice: customerAmount(row['Requested Product Price (RM)'] || quote['Product Price (RM)']), monthly: customerAmount(monthly), priceZone: quote['Price Zone'] || zone, promotion: promotionApplies(quote) ? quote['Promotion Name'] : '', customerId: row['Customer ID'], teamId: row['Team ID'], originChannelId: row['Origin WhatsApp Channel ID'],
          branch: row['Assigned Branch ID'], reviewRequired: row['SA Review Required'], nextFollowUp: row['Next Follow Up At'], documentStatus: docs.aiComplete ? 'AI_VERIFIED_COMPLETE' : docs.needsReview ? 'AI_EXCEPTION' : (row['Document Status'] || 'AI_COLLECTION_IN_PROGRESS'), minimumDocumentsComplete: docs.aiComplete || clean(row['Minimum Documents Complete']).toUpperCase() === 'TRUE' ? 'TRUE' : 'FALSE',
          missingDocuments: docs.aiComplete ? '' : (row['Missing Documents'] || docs.missing.join(', ')), documentsReceived: docs.count, documentTypes: docs.types, documentNeedsReview: docs.needsReview, aiDocumentsComplete: docs.aiComplete, documentUpdated: docs.latest,
          icMasked: ic ? `******${ic.slice(-4)}` : '', homeAddress: row['Home Address'], email: row.Email,
          employerName: row['Employer Name'], employerAddress: row['Employer Address'], employerPhone: row['Employer Phone'],
          employmentDurationMonths: row['Employment Duration Months'], jobPosition: row['Job Position'], basicSalary: row['Basic Salary'],
          salaryPaymentMethod: row['Salary Payment Method'], occupationCategory: row['Occupation Category'], eligibilityStatus: row['Eligibility Status'], eligibilityReason: row['Eligibility Reason'],
          reference1Name: row['Reference 1 Name'], reference1Phone: row['Reference 1 Phone'], reference1Relationship: row['Reference 1 Relationship'],
          reference2Name: row['Reference 2 Name'], reference2Phone: row['Reference 2 Phone'], reference2Relationship: row['Reference 2 Relationship'],
          bankAccountAvailable: row['Bank Account Available'], directDebitStatus: row['Direct Debit Status'], agreementStatus: row['Agreement Status'],
          creditConsentStatus: row['Credit Consent Status'] || 'NOT_SENT', creditConsentTemplateVersion: row['Credit Consent Template Version'] || CREDIT_CONSENT_TEMPLATE_VERSION,
          creditConsentSentAt: row['Credit Consent Sent At'], creditConsentSignedAt: row['Credit Consent Signed At'], creditConsentVerifiedAt: row['Credit Consent Verified At'], creditConsentVerifiedBy: row['Credit Consent Verified By'], creditConsentDocumentId: row['Credit Consent Document ID'],
          creditCheckStatus: row['Credit Check Status'] || 'BLOCKED_CONSENT_REQUIRED', creditCheckRequestedAt: row['Credit Check Requested At'], creditCheckRequestedBy: row['Credit Check Requested By'], creditCheckAllowed: clean(row['Credit Consent Status']).toUpperCase() === 'VERIFIED',
          lmsCaseId: row['LMS Case ID'], lmsSubmissionStatus: row['LMS Submission Status'] || (docs.aiComplete ? 'READY_FOR_LMS' : 'WAITING_FOR_AI_DOCUMENTS'), cadStatus: row['CAD Status'], cadRemarks: row['CAD Remarks'],
          financier: row.Financier || row['Bank Name'] || row.Lender, lmsDecisionAt: row['LMS Decision At'] || row['Decision At'], rejectedAt: row['Rejected At'],
          lmsErrorCode: row['LMS Error Code'], lmsErrorMessage: row['LMS Error Message'],
          missingApplicationFields: row['Missing Application Fields'], handoverReason: row['Handover Reason'], assignedSupervisorId: row['Assigned Supervisor ID'], supervisorAssignmentStatus: row['Supervisor Assignment Status'],
          processingMode: row['Processing Mode'], rejectionReason: row['Rejection Reason'] || row['Eligibility Reason'] || row['CAD Remarks'],
          created: row['Created At'], submittedAt: row['Submitted At'] || row['LMS Submitted At'], approvedAt: row['Approved At'], completedAt: row['Completed At'],
          updated: row['Updated At'] || row['Created At'] };
      });
      return res.status(200).json({ live: true, records });
    }

    if (resource === 'documents') {
      const [rows] = await readRanges(req, ['Document_Log!A1:AD1500']);
      const records = rowsToObjects(rows).filter(row => businessApplicationIds.has(row['Application ID']) || businessLeadIds.has(row['Lead ID'])).reverse().map(row => ({
        id: row['Document ID'], applicationId: row['Application ID'], leadId: row['Lead ID'], type: row['Document Type'], received: row['Received At'], fileName: row['File Name'], mimeType: row['Mime Type'],
        classification: row['Classification Status'], quality: row['Quality Status'], verification: row['Verification Status'], duplicate: row['Duplicate Status'], reviewRequired: row['Manual Review Required'], remarks: row.Remarks, uploadedBy: row['Uploaded By'], reviewedBy: row['Reviewed By'], reviewedAt: row['Reviewed At'], updated: row['Updated At']
      }));
      return res.status(200).json({ live: true, records });
    }

    if (resource === 'secondHandMotors' || resource === 'secondHandMotorRecommendations') {
      const [rows] = await readRanges(req, [secondHandRange]);
      const inventory = rowsToObjects(rows).filter(row => secondHandMotorVisibleToSession(session, row));
      const branchNames = Object.fromEntries(branches.map(row => [row['Branch ID'], row['Branch Name']]));
      if (resource === 'secondHandMotorRecommendations') {
        const matches = rankSecondHandMotors(inventory, {
          query: clean(req.query?.q || req.query?.model), brand: clean(req.query?.brand), budget: clean(req.query?.budget), engineCc: clean(req.query?.engineCc),
          region: clean(req.query?.region || (session.region === 'ALL' ? '' : session.region)), limit: clean(req.query?.limit || 3)
        });
        return res.status(200).json({ live: true, records: matches.map(match => ({ ...publicSecondHandMotor(match.record, branchNames, session), matchType: match.matchType, exactModel: match.exactModel, sameRegion: match.sameRegion, priceDifference: match.priceDifference })) });
      }
      return res.status(200).json({ live: true, records: inventory.reverse().map(row => publicSecondHandMotor(row, branchNames, session)) });
    }

    if (resource === 'pricing') {
      const [motorRows, handphoneRows] = await readRanges(req, ['Motor_Loan_Pricing!A1:AM1000', 'Handphone_Loan_Pricing!A1:AO1000']);
      const visible = (row, businessUnit) => productVisibleToSession(session, row, 'pricing', businessUnit);
      const mapPricing = (row, businessUnit) => ({
        id: row['Pricing ID'], catalogId: row['Catalog ID'], businessUnit, brand: row.Brand, model: row.Model, variant: row.Variant, zone: row['Price Zone'], productPrice: businessUnit === 'HANDPHONE' ? '' : customerAmount(row['Product Price (RM)']),
        deposit: businessUnit === 'HANDPHONE' ? '' : effectiveDeposit(row), baseDeposit: businessUnit === 'HANDPHONE' ? '' : customerAmount(row['Deposit (RM)']), year3: customerAmount(row['Monthly 3 Years (RM)']), year4: customerAmount(row['Monthly 4 Years (RM)']), year5: customerAmount(row['Monthly 5 Years (RM)']), month12: customerAmount(row['Monthly 12 Months (RM)']), month24: customerAmount(row['Monthly 24 Months (RM)']), month36: customerAmount(row['Monthly 36 Months (RM)']), month48: customerAmount(row['Monthly 48 Months (RM)']), month60: customerAmount(row['Monthly 60 Months (RM)']),
        effective: row['Effective From'], effectiveTo: row['Effective To'], active: truth(row.Active), status: row['Quote Approval Status'], internalNotes: session.role === 'ADMIN' ? row['Internal Notes'] : '',
        promotion: businessUnit === 'HANDPHONE' ? '' : (promotionApplies(row) || session.role === 'ADMIN' ? row['Promotion Name'] : ''), promotionDeposit: businessUnit === 'HANDPHONE' ? '' : customerAmount(row['Promotion Deposit (RM)']), promotionStart: businessUnit === 'HANDPHONE' ? '' : row['Promotion Start'], promotionEnd: businessUnit === 'HANDPHONE' ? '' : row['Promotion End'],
        promotionActive: truth(row['Promotion Active']), promotionStatus: row['Promotion Approval Status'], promotionNotes: canonicalRole(session.role) === 'ADMIN' ? row['Promotion Notes'] : '', updated: row['Last Updated At'], updatedBy: row['Updated By'],
        approvalStatus: productApprovalStatus(row), submittedBy: row['Submitted By'], submittedAt: row['Submitted At'], approvedBy: row['Approved By'], approvedAt: row['Approved At'], approvalNotes: row['Approval Notes'], publishRequested: truth(row['Publish Requested']), promotionPublishRequested: truth(row['Promotion Publish Requested']), submittedRegion: row['Submitted Region'], submittedBranchId: row['Submitted Branch ID'], minimumProductPrice: businessUnit === 'HANDPHONE' ? '' : customerAmount(row['Minimum Product Price (RM)']), adminReviewRequired: truth(row['Admin Review Required']), supersedesPricingId: row['Supersedes Pricing ID'], canEdit: canSubmitProduct(session, businessUnit) && !(canonicalRole(session.role) === 'ADMIN' && productApprovalStatus(row) !== 'APPROVED'), canReview: canReviewProduct(session) && productApprovalStatus(row) === 'PENDING_APPROVAL'
      });
      const records = [...rowsToObjects(motorRows).filter(row => visible(row, 'MOTOR')).map(row => mapPricing(row, 'MOTOR')), ...rowsToObjects(handphoneRows).filter(row => visible(row, 'HANDPHONE')).map(row => mapPricing(row, 'HANDPHONE'))];
      return res.status(200).json({ live: true, records });
    }

    if (resource === 'catalog') {
      const [motorRows, handphoneRows] = await readRanges(req, ['Motor_Model_Catalog!A1:AB1000', 'Handphone_Model_Catalog!A1:AB1000']);
      const mapCatalog = (row, businessUnit) => ({
        id: row['Catalog ID'], businessUnit, brand: row.Brand, model: row.Model, variant: row.Variant, category: row.Category, fuel: row['Fuel Type'], operatingSystem: row['Operating System'], tier: row['Popularity Tier'],
        productPageUrl: row['Product Page URL'], imageUrl: row['Image URL'], image: truth(row['Image Approved']) ? row['Image URL'] : '', imageCaption: row['Image Caption (MS)'], imageApproved: truth(row['Image Approved']),
        active: truth(row.Active), stock: row['Stock Check Mode'], branchAvailability: row['Branch Availability'], branchStock: businessUnit === 'HANDPHONE' ? handphoneBranchStockEntries(row['Branch Availability']) : [], regionAvailability: row['Region Availability'], warehouseAvailability: row['Warehouse Availability'], searchKeywords: row['Search Keywords'], lastVerified: row['Last Verified At'],
        approvalStatus: productApprovalStatus(row), submittedBy: row['Submitted By'], submittedAt: row['Submitted At'], approvedBy: row['Approved By'], approvedAt: row['Approved At'], approvalNotes: row['Approval Notes'], publishRequested: truth(row['Publish Requested']), submittedRegion: row['Submitted Region'], submittedBranchId: row['Submitted Branch ID'], supersedesCatalogId: row['Supersedes Catalog ID'], canEdit: canSubmitProduct(session, businessUnit) && !(canonicalRole(session.role) === 'ADMIN' && productApprovalStatus(row) !== 'APPROVED'), canReview: canReviewProduct(session) && productApprovalStatus(row) === 'PENDING_APPROVAL'
      });
      const allowed = businessUnit => businessPermitted(session, { 'Business Unit': businessUnit });
      const records = [...(allowed('MOTOR') ? rowsToObjects(motorRows).filter(row => productVisibleToSession(session, row, 'catalog', 'MOTOR')).map(row => mapCatalog(row, 'MOTOR')) : []), ...(allowed('HANDPHONE') ? rowsToObjects(handphoneRows).filter(row => handphoneVisibleToSession(session, row, 'catalog')).map(row => mapCatalog(row, 'HANDPHONE')) : [])];
      return res.status(200).json({ live: true, records });
    }

    if (resource === 'team') {
      const [saRows, userRows] = await readRanges(req, ['SA_Master!A1:O1000', userSheetRange]);
      const branchNames = Object.fromEntries(branches.map(row => [row['Branch ID'], row['Branch Name']]));
      const staffAccess = Object.fromEntries(rowsToObjects(userRows).filter(row => canonicalRole(row.Role) === 'STAFF' && row['SA ID']).map(row => [clean(row['SA ID']), canonicalBusinessAccess(row['Business Access'], row.Role)]));
      const records = rowsToObjects(saRows).filter(row => clean(row.Active).toUpperCase() === 'TRUE' && (session.role === 'ADMIN' || (session.role === 'STAFF' ? clean(row['SA ID']) === clean(session.saId) : ['BRANCH_SUPERVISOR', 'BRANCH_MANAGER'].includes(session.role) ? clean(row['Branch ID']) === clean(session.branchId) : session.region === 'ALL' || canonicalRegion(row.Region) === session.region))).map(row => {
        const branch = branchNames[row['Branch ID']] || row['Branch ID'];
        const branchBusinessUnit = canonicalBusinessUnit(row['Business Unit']) || (/(HANDPHONE|IPHONE|SMARTPHONE)/i.test(`${row['Branch ID']} ${branch}`) ? 'HANDPHONE' : 'MOTOR');
        return { id: row['SA ID'], name: row['SA Name'], branch, branchId: row['Branch ID'], region: row.Region, businessUnit: branchBusinessUnit, businessAccess: canonicalBusinessAccess(row['Business Access'] || staffAccess[clean(row['SA ID'])] || 'BOTH', 'STAFF'), teamId: row['Team ID'], accepting: row['Accepting Leads'], lastAssigned: row['Last Assigned At'] };
      });
      return res.status(200).json({ live: true, records, branches: branches.filter(row => clean(row.Active).toUpperCase() === 'TRUE' && (session.role === 'ADMIN' || canonicalRegion(row.Region) === session.region)).length });
    }

    if (['inbox', 'outbox', 'activity'].includes(resource)) {
      const cfg = resource === 'inbox' ? ['Customer_Inbox!A1:AC1000', 'Message ID'] : resource === 'outbox' ? ['Message_Outbox!A1:AC1200', 'Outbox ID'] : ['Activity_Log!A1:Z1200', 'Activity ID'];
      const [rows, channelRows] = await readRanges(req, [cfg[0], channelRange]);
      const channels = rowsToObjects(channelRows);
      const visible = rowsToObjects(rows).filter(row => businessLeadIds.has(row['Lead ID']) || businessApplicationIds.has(row['Application ID'])).reverse();
      const leadNames = Object.fromEntries(scope.leads.map(row => [row['Lead ID'], row['Customer Name']]));
      const leadOwners = Object.fromEntries(scope.leads.map(row => [row['Lead ID'], row['Assigned SA ID']]));
      const applicationOwners = Object.fromEntries(scope.applications.map(row => [row['Application ID'], row['Assigned SA ID']]));
      const records = visible.map(row => resource === 'inbox' ? ({
        id: row['Message ID'], customer: leadNames[row['Lead ID']] || row['Phone Number'], leadId: row['Lead ID'], applicationId: row['Application ID'],
        assignedSa: applicationOwners[row['Application ID']] || leadOwners[row['Lead ID']] || '', phone: row['Phone Number'], message: row['Customer Message'],
        status: row['Process Status'], time: row['Received At'], attachmentType: row['Attachment Type'], messageType: row['Message Type'], channel: row.Channel,
        channelId: row['Internal Channel ID'], phoneNumberId: row['WhatsApp Number ID'], displayNumber: row['WhatsApp Display Number'], wabaId: row['WABA ID'], conversationKey: row['Conversation Key'], routingStatus: row['Number Routing Status'], channelName: channelForMessage(row, channels)?.['Channel Name'] || row['Internal Channel ID'] || row['WhatsApp Display Number'],
        source: row.Source || row['Webhook Source'], aiProcessed: truth(row['AI Processed']), aiProcessedAt: row['AI Processed At'],
        humanHandoverAt: row['Human Handover At'], humanRequired: humanStatuses.has(clean(row['Process Status']).toUpperCase())
      }) : resource === 'outbox' ? ({
        id: row['Outbox ID'], recipient: row['Phone Number'], leadId: row['Lead ID'], applicationId: row['Application ID'], message: row['Message Text'] || row['Template Name'],
        status: row['Send Status'], time: row['Sent At'] || row['Created At'], providerMessageId: row['Provider Message ID'], routingStatus: row['Send Routing Status'], channelId: row['Internal Channel ID'], phoneNumberId: row['WhatsApp Number ID'], wabaId: row['WABA ID'], replyToMessageId: row['Reply To Message ID'], channelName: channelForMessage(row, channels)?.['Channel Name'] || row['Internal Channel ID'], displayNumber: channelForMessage(row, channels)?.['Display Number'] || '',
        attemptCount: Number(row['Attempt Count'] || 0), errorMessage: row['Error Message'], deliveredAt: row['Delivered At'], readAt: row['Read At'], customerRepliedAt: row['Customer Replied At'],
        manual: clean(row['Send Routing Status']).toUpperCase() === 'WHATSAPP_BUSINESS_MANUAL' || clean(row['Send Status']).toUpperCase() === 'MANUAL_PENDING'
      }) : ({ id: row['Activity ID'], leadId: row['Lead ID'], applicationId: row['Application ID'], type: row['Activity Type'], description: row.Description, actor: row['Actor ID'] || 'System', status: row['Activity Status'] || 'COMPLETED', time: row['Activity At'] }));
      return res.status(200).json({ live: true, records });
    }

    const [inboxRows, outboxRows, dashboardDocumentRows] = await readRanges(req, ['Customer_Inbox!A1:AC1000', 'Message_Outbox!A1:AC1200', 'Document_Log!A1:AD1500']);
    const inbox = rowsToObjects(inboxRows).filter(row => businessLeadIds.has(row['Lead ID']) || businessApplicationIds.has(row['Application ID']));
    const outbox = rowsToObjects(outboxRows).filter(row => businessLeadIds.has(row['Lead ID']) || businessApplicationIds.has(row['Application ID']));
    const dashboardDocuments = rowsToObjects(dashboardDocumentRows).filter(row => businessApplicationIds.has(row['Application ID']) || businessLeadIds.has(row['Lead ID']));
    const documentsByApplication = new Map();
    dashboardDocuments.forEach(row => { const key = row['Application ID']; if (key) documentsByApplication.set(key, [...(documentsByApplication.get(key) || []), row]); });
    const completed = count(businessApplications, 'Application Status', 'COMPLETED');
    const aiExceptions = businessApplications.filter(row => {
      const mode = clean(row['Processing Mode']).toUpperCase();
      return clean(row['Application Status']).toUpperCase() === 'MANUAL_REVIEW' || clean(row['SA Review Required']).toUpperCase() === 'TRUE' || ['AI_TO_SA_HANDOVER', 'AI_EXCEPTION_TO_STAFF', 'AI_EXCEPTION_STAFF_MANUAL'].includes(mode);
    }).length;
    const lmsReady = businessApplications.filter(row => ['READY_FOR_LMS', 'READY', 'QUEUED'].includes(clean(row['LMS Submission Status']).toUpperCase()) || clean(row['Minimum Documents Complete']).toUpperCase() === 'TRUE' || documentSummary(documentsByApplication.get(row['Application ID']) || []).aiComplete).length;
    const humanHandovers = inbox.filter(row => humanStatuses.has(clean(row['Process Status']).toUpperCase())).length;
    const needsAttention = aiExceptions + count(businessApplications, 'Current Stage', 'RECOVERY_PENDING') + count(outbox, 'Send Status', 'FAILED') + humanHandovers;
    return res.status(200).json({ live: true, updatedAt: new Date().toISOString(), summary: { leads: businessLeads.length, applications: businessApplications.length, conversion: businessLeads.length ? businessApplications.length / businessLeads.length : 0, syntheticRecords: scope.leads.length - businessLeads.length + scope.applications.length - businessApplications.length, needsAttention, completed, humanHandovers, aiExceptions, lmsReady, unreadInbox: inbox.filter(row => ['NEW', 'ERROR', 'HUMAN_HANDOVER_REQUIRED', 'ASSIGNED_TO_STAFF'].includes(clean(row['Process Status']).toUpperCase())).length } });
  } catch (error) {
    console.error(error);
    return res.status(503).json({ live: false, error: 'CRM data connection is not configured yet.' });
  }
}
