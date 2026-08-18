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
  ? { unit: 'HANDPHONE', catalog: 'Handphone_Model_Catalog', pricing: 'Handphone_Loan_Pricing', catalogMax: 'AD', pricingMax: 'AO', idPrefix: 'HP' }
  : { unit: 'MOTOR', catalog: 'Motor_Model_Catalog', pricing: 'Motor_Loan_Pricing', catalogMax: 'AD', pricingMax: 'AM', idPrefix: 'MTR' };
const handphoneCatalogApprovalHeaders = ['Approval Status', 'Submitted By', 'Submitted At', 'Approved By', 'Approved At', 'Approval Notes', 'Publish Requested', 'Submitted Region', 'Submitted Branch ID', 'Branch Availability', 'Supersedes Catalog ID', 'Image File ID', 'Image MIME Type'];
const handphonePricingApprovalHeaders = ['Approval Status', 'Submitted By', 'Submitted At', 'Approved By', 'Approved At', 'Approval Notes', 'Publish Requested', 'Promotion Publish Requested', 'Submitted Region', 'Submitted Branch ID', 'Minimum Product Price (RM)', 'Admin Review Required', 'Supersedes Pricing ID'];
const handphoneCatalogPublishFields = ['Brand', 'Model', 'Variant', 'Category', 'Operating System', 'Popularity Tier', 'Product Page URL', 'Image URL', 'Image File ID', 'Image MIME Type', 'Image Caption (MS)', 'Stock Check Mode', 'Region Availability', 'Warehouse Availability', 'Search Keywords'];
const handphonePricingPublishFields = ['Catalog ID', 'Brand', 'Model', 'Variant', 'Price Zone', 'Monthly 12 Months (RM)', 'Monthly 24 Months (RM)', 'Monthly 36 Months (RM)', 'Monthly 48 Months (RM)', 'Monthly 60 Months (RM)', 'Effective From', 'Effective To', 'Internal Notes'];
const motorCatalogPublishFields = ['Brand', 'Model', 'Variant', 'Category', 'Fuel Type', 'Popularity Tier', 'Product Page URL', 'Image URL', 'Image File ID', 'Image MIME Type', 'Image Caption (MS)', 'Stock Check Mode', 'Branch Availability', 'Warehouse Availability', 'Search Keywords'];
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
  if (!SHEET_ID) throw new Error('Spreadsheet is not configureç®÷òÚ$z{-®éÜj×uÒÂ&Wf–Wu&WV—&VC¢&÷u²tÖçVÂ&Wf–Wr&WV—&VBuÒÂ&VÖ&·3¢&÷rå&VÖ&·2ÂWÆöFVD'“¢&÷u²uWÆöFVB'’uÒÂ&Wf–WvVD'“¢&÷u²u&Wf–WvVB'’uÒÂ&Wf–WvVDC¢&÷u²u&Wf–WvVBBuÒÂWFFVC¢&÷u²uWFFVBBuÐ¢Ò’“°¢&WGW&â&W2ç7FGW2ƒ#’æ§6öâ‡²Æ—fS¢G'VRÂ&V6÷&G2Ò“°¢Ð ¢–b‡&W6÷W&6RÓÓÒw6V6öæD†æDÖ÷F÷'2rÇÂ&W6÷W&6RÓÓÒw6V6öæD†æDÖ÷F÷%&V6öÖÖVæFF–öç2r’°¢6öç7B·&÷w5ÒÒv—B&VE&ævW2‡&WÂ·6V6öæD†æE&ævUÒ“°¢6öç7B–çfVçF÷'’Ò&÷w5Fôö&¦V7G2‡&÷w2’æf–ÇFW"‡&÷rÓâ6V6öæD†æDÖ÷F÷%f—6–&ÆUFõ6W76–öâ‡6W76–öâÂ&÷r’“°¢6öç7B'&æ6„æÖW2Òö&¦V7Bæg&öÔVçG&–W2†'&æ6†W2æÖ‡&÷rÓâ·&÷u²t'&æ6‚”BuÒÂ&÷u²t'&æ6‚æÖRuÕÒ’“°¢–b‡&W6÷W&6RÓÓÒw6V6öæD†æDÖ÷F÷%&V6öÖÖVæFF–öç2r’°¢6öç7BÖF6†W2Ò&æµ6V6öæD†æDÖ÷F÷'2†–çfVçF÷'’Â°¢VW'“¢6ÆVâ‡&WçVW'“òçÇÂ&WçVW'“òæÖöFVÂ’Â'&æC¢6ÆVâ‡&WçVW'“òæ'&æB’Â'VFvWC¢6ÆVâ‡&WçVW'“òæ'VFvWB’ÂVæv–æT63¢6ÆVâ‡&WçVW'“òæVæv–æT62’À¢&Vv–öã¢6ÆVâ‡&WçVW'“òç&Vv–öâÇÂ‡6W76–öâç&Vv–öâÓÓÒtÄÂròrr¢6W76–öâç&Vv–öâ’’ÂÆ–Ö—C¢6ÆVâ‡&WçVW'“òæÆ–Ö—BÇÂ2¢Ò“°¢&WGW&â&W2ç7FGW2ƒ#’æ§6öâ‡²Æ—fS¢G'VRÂ&V6÷&G3¢ÖF6†W2æÖ†ÖF6‚Óâ‡²ââçV&Æ–56V6öæD†æDÖ÷F÷"†ÖF6‚ç&V6÷&BÂ'&æ6„æÖW2Â6W76–öâ’ÂÖF6…G—S¢ÖF6‚æÖF6…G—RÂW†7DÖöFVÃ¢ÖF6‚æW†7DÖöFVÂÂ6ÖU&Vv–öã¢ÖF6‚ç6ÖU&Vv–öâÂ&–6TF–ffW&Væ6S¢ÖF6‚ç&–6TF–ffW&Væ6RÒ’’Ò“°¢Ð¢&WGW&â&W2ç7FGW2ƒ#’æ§6öâ‡²Æ—fS¢G'VRÂ&V6÷&G3¢–çfVçF÷'’ç&WfW'6R‚’æÖ‡&÷rÓâV&Æ–56V6öæD†æDÖ÷F÷"‡&÷rÂ'&æ6„æÖW2Â6W76–öâ’’Ò“°¢Ð ¢–b‡&W6÷W&6RÓÓÒw&–6–ærr’°¢6öç7B¶Ö÷F÷%&÷w2Â†æG†öæU&÷w5ÒÒv—B&VE&ævW2‡&WÂ²tÖ÷F÷%ôÆöåõ&–6–ær¤ÓrÂt†æG†öæUôÆöåõ&–6–ær¤óuÒ“°¢6öç7Bf—6–&ÆRÒ‡&÷rÂ'W6–æW75Væ—B’Óâ&öGV7Ef—6–&ÆUFõ6W76–öâ‡6W76–öâÂ&÷rÂw&–6–ærrÂ'W6–æW75Væ—B“°¢6öç7BÖ&–6–ærÒ‡&÷rÂ'W6–æW75Væ—B’Óâ‡°¢–C¢&÷u²u&–6–ær”BuÒÂ6FÆöt–C¢&÷u²t6FÆör”BuÒÂ'W6–æW75Væ—BÂ'&æC¢&÷rä'&æBÂÖöFVÃ¢&÷räÖöFVÂÂf&–çC¢&÷råf&–çBÂ¦öæS¢&÷u²u&–6R¦öæRuÒÂ&öGV7E&–6S¢'W6–æW75Væ—BÓÓÒt„äE„ôäRròrr¢7W7FöÖW$Ö÷VçB‡&÷u²u&öGV7B&–6R…$Ò’uÒ’À¢FW÷6—C¢'W6–æW75Væ—BÓÓÒt„äE„ôäRròrr¢VffV7F—fTFW÷6—B‡&÷r’Â&6TFW÷6—C¢'W6–æW75Væ—BÓÓÒt„äE„ôäRròrr¢7W7FöÖW$Ö÷VçB‡&÷u²tFW÷6—B…$Ò’uÒ’Â–V#3¢7W7FöÖW$Ö÷VçB‡&÷u²tÖöçF†Ç’2–V'2…$Ò’uÒ’Â–V#C¢7W7FöÖW$Ö÷VçB‡&÷u²tÖöçF†Ç’B–V'2…$Ò’uÒ’Â–V#S¢7W7FöÖW$Ö÷VçB‡&÷u²tÖöçF†Ç’R–V'2…$Ò’uÒ’ÂÖöçFƒ#¢7W7FöÖW$Ö÷VçB‡&÷u²tÖöçF†Ç’"ÖöçF‡2…$Ò’uÒ’ÂÖöçFƒ#C¢7W7FöÖW$Ö÷VçB‡&÷u²tÖöçF†Ç’#BÖöçF‡2…$Ò’uÒ’ÂÖöçFƒ3c¢7W7FöÖW$Ö÷VçB‡&÷u²tÖöçF†Ç’3bÖöçF‡2…$Ò’uÒ’ÂÖöçFƒCƒ¢7W7FöÖW$Ö÷VçB‡&÷u²tÖöçF†Ç’C‚ÖöçF‡2…$Ò’uÒ’ÂÖöçFƒc¢7W7FöÖW$Ö÷VçB‡&÷u²tÖöçF†Ç’cÖöçF‡2…$Ò’uÒ’À¢VffV7F—fS¢&÷u²tVffV7F—fRg&öÒuÒÂVffV7F—fUFó¢&÷u²tVffV7F—fRFòuÒÂ7F—fS¢G'WF‚‡&÷rä7F—fR’Â7FGW3¢&÷u²uV÷FR&÷fÂ7FGW2uÒÂ–çFW&æÄæ÷FW3¢6W76–öâç&öÆRÓÓÒtDÔ”ârò&÷u²t–çFW&æÂæ÷FW2uÒ¢rrÀ¢&öÖ÷F–öã¢'W6–æW75Væ—BÓÓÒt„äE„ôäRròrr¢‡&öÖ÷F–öäÆ–W2‡&÷r’ÇÂ6W76–öâç&öÆRÓÓÒtDÔ”ârò&÷u²u&öÖ÷F–öâæÖRuÒ¢rr’Â&öÖ÷F–öäFW÷6—C¢'W6–æW75Væ—BÓÓÒt„äE„ôäRròrr¢7W7FöÖW$Ö÷VçB‡&÷u²u&öÖ÷F–öâFW÷6—B…$Ò’uÒ’Â&öÖ÷F–öå7F'C¢'W6–æW75Væ—BÓÓÒt„äE„ôäRròrr¢&÷u²u&öÖ÷F–öâ7F'BuÒÂ&öÖ÷F–öäVæC¢'W6–æW75Væ—BÓÓÒt„äE„ôäRròrr¢&÷u²u&öÖ÷F–öâVæBuÒÀ¢&öÖ÷F–öä7F—fS¢G'WF‚‡&÷u²u&öÖ÷F–öâ7F—fRuÒ’Â&öÖ÷F–öå7FGW3¢&÷u²u&öÖ÷F–öâ&÷fÂ7FGW2uÒÂ&öÖ÷F–öäæ÷FW3¢6æöæ–6Å&öÆR‡6W76–öâç&öÆR’ÓÓÒtDÔ”ârò&÷u²u&öÖ÷F–öâæ÷FW2uÒ¢rrÂWFFVC¢&÷u²tÆ7BWFFVBBuÒÂWFFVD'“¢&÷u²uWFFVB'’uÒÀ¢&÷fÅ7FGW3¢&öGV7D&÷fÅ7FGW2‡&÷r’Â7V&Ö—GFVD'“¢&÷u²u7V&Ö—GFVB'’uÒÂ7V&Ö—GFVDC¢&÷u²u7V&Ö—GFVBBuÒÂ&÷fVD'“¢&÷u²t&÷fVB'’uÒÂ&÷fVDC¢&÷u²t&÷fVBBuÒÂ&÷fÄæ÷FW3¢&÷u²t&÷fÂæ÷FW2uÒÂV&Æ—6…&WVW7FVC¢G'WF‚‡&÷u²uV&Æ—6‚&WVW7FVBuÒ’Â&öÖ÷F–öåV&Æ—6…&WVW7FVC¢G'WF‚‡&÷u²u&öÖ÷F–öâV&Æ—6‚&WVW7FVBuÒ’Â7V&Ö—GFVE&Vv–öã¢&÷u²u7V&Ö—GFVB&Vv–öâuÒÂ7V&Ö—GFVD'&æ6„–C¢&÷u²u7V&Ö—GFVB'&æ6‚”BuÒÂÖ–æ–×VÕ&öGV7E&–6S¢'W6–æW75Væ—BÓÓÒt„äE„ôäRròrr¢7W7FöÖW$Ö÷VçB‡&÷u²tÖ–æ–×VÒ&öGV7B&–6R…$Ò’uÒ’ÂFÖ–å&Wf–Wu&WV—&VC¢G'WF‚‡&÷u²tFÖ–â&Wf–Wr&WV—&VBuÒ’Â7WW'6VFW5&–6–æt–C¢&÷u²u7WW'6VFW2&–6–ær”BuÒÂ6äVF—C¢6å7V&Ö—E&öGV7B‡6W76–öâÂ'W6–æW75Væ—B’bb†6æöæ–6Å&öÆR‡6W76–öâç&öÆR’ÓÓÒtDÔ”ârbb&öGV7D&÷fÅ7FGW2‡&÷r’ÓÒt$õdTBr’Â6å&Wf–Ws¢6å&Wf–Wu&öGV7B‡6W76–öâ’bb&öGV7D&÷fÅ7FGW2‡&÷r’ÓÓÒuTäD”äuô$õdÂp¢Ò“°¢6öç7B&V6÷&G2Ò²ââç&÷w5Fôö&¦V7G2†Ö÷F÷%&÷w2’æf–ÇFW"‡&÷rÓâf—6–&ÆR‡&÷rÂtÔõDõ"r’’æÖ‡&÷rÓâÖ&–6–ær‡&÷rÂtÔõDõ"r’’Âââç&÷w5Fôö&¦V7G2††æG†öæU&÷w2’æf–ÇFW"‡&÷rÓâf—6–&ÆR‡&÷rÂt„äE„ôäRr’’æÖ‡&÷rÓâÖ&–6–ær‡&÷rÂt„äE„ôäRr’•Ó°¢&WGW&â&W2ç7FGW2ƒ#’æ§6öâ‡²Æ—fS¢G'VRÂ&V6÷&G2Ò“°¢Ð ¢–b‡&W6÷W&6RÓÓÒv6FÆörr’°¢6öç7B¶Ö÷F÷%&÷w2Â†æG†öæU&÷w5ÒÒv—B&VE&ævW2‡&WÂ²tÖ÷F÷%ôÖöFVÅô6FÆör¤CrÂt†æG†öæUôÖöFVÅô6FÆör¤CuÒ“°¢6öç7BÖ6FÆörÒ‡&÷rÂ'W6–æW75Væ—B’Óâ‡°¢–C¢&÷u²t6FÆör”BuÒÂ'W6–æW75Væ—BÂ'&æC¢&÷rä'&æBÂÖöFVÃ¢&÷räÖöFVÂÂf&–çC¢&÷råf&–çBÂ6FVv÷'“¢&÷rä6FVv÷'’ÂgVVÃ¢&÷u²tgVVÂG—RuÒÂ÷W&F–æu7—7FVÓ¢&÷u²t÷W&F–ær7—7FVÒuÒÂF–W#¢&÷u²u÷VÆ&—G’F–W"uÒÀ¢&öGV7EvUW&Ã¢&÷u²u&öGV7BvRU$ÂuÒÂ–ÖvUW&Ã¢&÷u²t–ÖvRU$ÂuÒÂ–ÖvS¢G'WF‚‡&÷u²t–ÖvR&÷fVBuÒ’ò&÷u²t–ÖvRU$ÂuÒ¢rrÂ–ÖvU&Wf–Ws¢†6å7V&Ö—E&öGV7B‡6W76–öâÂ'W6–æW75Væ—B’ÇÂ6å&Wf–Wu&öGV7B‡6W76–öâ’’ò&÷u²t–ÖvRU$ÂuÒ¢rrÂ–ÖvT6F–öã¢&÷u²t–ÖvR6F–öâ„Õ2’uÒÂ–ÖvT&÷fVC¢G'WF‚‡&÷u²t–ÖvR&÷fVBuÒ’À¢7F—fS¢G'WF‚‡&÷rä7F—fR’Â7Fö6³¢&÷u²u7Fö6²6†V6²ÖöFRuÒÂ'&æ6„f–Æ&–Æ—G“¢&÷u²t'&æ6‚f–Æ&–Æ—G’uÒÂ'&æ6…7Fö6³¢'W6–æW75Væ—BÓÓÒt„äE„ôäRrò†æG†öæT'&æ6…7Fö6´VçG&–W2‡&÷u²t'&æ6‚f–Æ&–Æ—G’uÒ’¢µÒÂ&Vv–öäf–Æ&–Æ—G“¢&÷u²u&Vv–öâf–Æ&–Æ—G’uÒÂv&V†÷W6Tf–Æ&–Æ—G“¢&÷u²uv&V†÷W6Rf–Æ&–Æ—G’uÒÂ6V&6„¶W—v÷&G3¢&÷u²u6V&6‚¶W—v÷&G2uÒÂÆ7EfW&–f–VC¢&÷u²tÆ7BfW&–f–VBBuÒÀ¢&÷fÅ7FGW3¢&öGV7D&÷fÅ7FGW2‡&÷r’Â7V&Ö—GFVD'“¢&÷u²u7V&Ö—GFVB'’uÒÂ7V&Ö—GFVDC¢&÷u²u7V&Ö—GFVBBuÒÂ&÷fVD'“¢&÷u²t&÷fVB'’uÒÂ&÷fVDC¢&÷u²t&÷fVBBuÒÂ&÷fÄæ÷FW3¢&÷u²t&÷fÂæ÷FW2uÒÂV&Æ—6…&WVW7FVC¢G'WF‚‡&÷u²uV&Æ—6‚&WVW7FVBuÒ’Â7V&Ö—GFVE&Vv–öã¢&÷u²u7V&Ö—GFVB&Vv–öâuÒÂ7V&Ö—GFVD'&æ6„–C¢&÷u²u7V&Ö—GFVB'&æ6‚”BuÒÂ7WW'6VFW46FÆöt–C¢&÷u²u7WW'6VFW26FÆör”BuÒÂ6äVF—C¢6å7V&Ö—E&öGV7B‡6W76–öâÂ'W6–æW75Væ—B’bb†6æöæ–6Å&öÆR‡6W76–öâç&öÆR’ÓÓÒtDÔ”ârbb&öGV7D&÷fÅ7FGW2‡&÷r’ÓÒt$õdTBr’Â6å&Wf–Ws¢6å&Wf–Wu&öGV7B‡6W76–öâ’bb&öGV7D&÷fÅ7FGW2‡&÷r’ÓÓÒuTäD”äuô$õdÂp¢Ò“°¢6öç7BÆÆ÷vVBÒ'W6–æW75Væ—BÓâ'W6–æW75W&Ö—GFVB‡6W76–öâÂ²t'W6–æW72Væ—Bs¢'W6–æW75Væ—BÒ“°¢6öç7B&V6÷&G2Ò²âââ†ÆÆ÷vVB‚tÔõDõ"r’ò&÷w5Fôö&¦V7G2†Ö÷F÷%&÷w2’æf–ÇFW"‡&÷rÓâ&öGV7Ef—6–&ÆUFõ6W76–öâ‡6W76–öâÂ&÷rÂv6FÆörrÂtÔõDõ"r’’æÖ‡&÷rÓâÖ6FÆör‡&÷rÂtÔõDõ"r’’¢µÒ’Ââââ†ÆÆ÷vVB‚t„äE„ôäRr’ò&÷w5Fôö&¦V7G2††æG†öæU&÷w2’æf–ÇFW"‡&÷rÓâ†æG†öæUf—6–&ÆUFõ6W76–öâ‡6W76–öâÂ&÷rÂv6FÆörr’’æÖ‡&÷rÓâÖ6FÆör‡&÷rÂt„äE„ôäRr’’¢µÒ•Ó°¢&WGW&â&W2ç7FGW2ƒ#’æ§6öâ‡²Æ—fS¢G'VRÂ&V6÷&G2Ò“°¢Ð ¢–b‡&W6÷W&6RÓÓÒwFVÒr’°¢6öç7B·6&÷w2ÂW6W%&÷w5ÒÒv—B&VE&ævW2‡&WÂ²u4ôÖ7FW"¤órÂW6W%6†VWE&ævUÒ“°¢6öç7B'&æ6„æÖW2Òö&¦V7Bæg&öÔVçG&–W2†'&æ6†W2æÖ‡&÷rÓâ·&÷u²t'&æ6‚”BuÒÂ&÷u²t'&æ6‚æÖRuÕÒ’“°¢6öç7B7Ffd66W72Òö&¦V7Bæg&öÔVçG&–W2‡&÷w5Fôö&¦V7G2‡W6W%&÷w2’æf–ÇFW"‡&÷rÓâ6æöæ–6Å&öÆR‡&÷rå&öÆR’ÓÓÒu5Ddbrbb&÷u²u4”BuÒ’æÖ‡&÷rÓâ¶6ÆVâ‡&÷u²u4”BuÒ’Â6æöæ–6Ä'W6–æW7466W72‡&÷u²t'W6–æW7266W72uÒÂ&÷rå&öÆR•Ò’“°¢6öç7B&V6÷&G2Ò&÷w5Fôö&¦V7G2‡6&÷w2’æf–ÇFW"‡&÷rÓâ6ÆVâ‡&÷rä7F—fR’çFõWW$66R‚’ÓÓÒuE%TRrbb‡6W76–öâç&öÆRÓÓÒtDÔ”ârÇÂ‡6W76–öâç&öÆRÓÓÒu5Ddbrò6ÆVâ‡&÷u²u4”BuÒ’ÓÓÒ6ÆVâ‡6W76–öâç6–B’¢²t%$ä4…õ5UU%d•4õ"rÂt%$ä4…ôÔätU"uÒæ–æ6ÇVFW2‡6W76–öâç&öÆR’ò6ÆVâ‡&÷u²t'&æ6‚”BuÒ’ÓÓÒ6ÆVâ‡6W76–öâæ'&æ6„–B’¢6W76–öâç&Vv–öâÓÓÒtÄÂrÇÂ6æöæ–6Å&Vv–öâ‡&÷rå&Vv–öâ’ÓÓÒ6W76–öâç&Vv–öâ’’’æÖ‡&÷rÓâ°¢6öç7B'&æ6‚Ò'&æ6„æÖW5·&÷u²t'&æ6‚”BuÕÒÇÂ&÷u²t'&æ6‚”BuÓ°¢6öç7B'&æ6„'W6–æW75Væ—BÒ6æöæ–6Ä'W6–æW75Væ—B‡&÷u²t'W6–æW72Væ—BuÒ’ÇÂ‚ò„„äE„ôäWÄ•„ôäWÅ4Ô%E„ôäR’ö’çFW7B†G·&÷u²t'&æ6‚”Bu×ÒG¶'&æ6‡Ö’òt„äE„ôäRr¢tÔõDõ"r“°¢&WGW&â²–C¢&÷u²u4”BuÒÂæÖS¢&÷u²u4æÖRuÒÂ'&æ6‚Â'&æ6„–C¢&÷u²t'&æ6‚”BuÒÂ&Vv–öã¢&÷rå&Vv–öâÂ'W6–æW75Væ—C¢'&æ6„'W6–æW75Væ—BÂ'W6–æW7466W73¢6æöæ–6Ä'W6–æW7466W72‡&÷u²t'W6–æW7266W72uÒÇÂ7Ffd66W75¶6ÆVâ‡&÷u²u4”BuÒ•ÒÇÂt$õD‚rÂu5Ddbr’ÂFVÔ–C¢&÷u²uFVÒ”BuÒÂ66WF–æs¢&÷u²t66WF–ærÆVG2uÒÂÆ7D76–væVC¢&÷u²tÆ7B76–væVBBuÒÓ°¢Ò“°¢&WGW&â&W2ç7FGW2ƒ#’æ§6öâ‡²Æ—fS¢G'VRÂ&V6÷&G2Â'&æ6†W3¢'&æ6†W2æf–ÇFW"‡&÷rÓâ6ÆVâ‡&÷rä7F—fR’çFõWW$66R‚’ÓÓÒuE%TRrbb‡6W76–öâç&öÆRÓÓÒtDÔ”ârÇÂ6æöæ–6Å&Vv–öâ‡&÷rå&Vv–öâ’ÓÓÒ6W76–öâç&Vv–öâ’’æÆVæwF‚Ò“°¢Ð ¢–b…²v–æ&÷‚rÂv÷WF&÷‚rÂv7F—f—G’uÒæ–æ6ÇVFW2‡&W6÷W&6R’’°¢6öç7B6frÒ&W6÷W&6RÓÓÒv–æ&÷‚rò²t7W7FöÖW%ô–æ&÷‚¤3rÂtÖW76vR”BuÒ¢&W6÷W&6RÓÓÒv÷WF&÷‚rò²tÖW76vUô÷WF&÷‚¤3#rÂt÷WF&÷‚”BuÒ¢²t7F—f—G•ôÆör¥£#rÂt7F—f—G’”BuÓ°¢6öç7B·&÷w2Â6†ææVÅ&÷w5ÒÒv—B&VE&ævW2‡&WÂ¶6fu³ÒÂ6†ææVÅ&ævUÒ“°¢6öç7B6†ææVÇ2Ò&÷w5Fôö&¦V7G2†6†ææVÅ&÷w2“°¢6öç7Bf—6–&ÆRÒ&÷w5Fôö&¦V7G2‡&÷w2’æf–ÇFW"‡&÷rÓâ'W6–æW74ÆVD–G2æ†2‡&÷u²tÆVB”BuÒ’ÇÂ'W6–æW74Æ–6F–öä–G2æ†2‡&÷u²tÆ–6F–öâ”BuÒ’’ç&WfW'6R‚“°¢6öç7BÆVDæÖW2Òö&¦V7Bæg&öÔVçG&–W2‡66÷RæÆVG2æÖ‡&÷rÓâ·&÷u²tÆVB”BuÒÂ&÷u²t7W7FöÖW"æÖRuÕÒ’“°¢6öç7BÆVD÷væW'2Òö&¦V7Bæg&öÔVçG&–W2‡66÷RæÆVG2æÖ‡&÷rÓâ·&÷u²tÆVB”BuÒÂ&÷u²t76–væVB4”BuÕÒ’“°¢6öç7BÆ–6F–öä÷væW'2Òö&¦V7Bæg&öÔVçG&–W2‡66÷RæÆ–6F–öç2æÖ‡&÷rÓâ·&÷u²tÆ–6F–öâ”BuÒÂ&÷u²t76–væVB4”BuÕÒ’“°¢6öç7B&V6÷&G2Òf—6–&ÆRæÖ‡&÷rÓâ&W6÷W&6RÓÓÒv–æ&÷‚rò‡°¢–C¢&÷u²tÖW76vR”BuÒÂ7W7FöÖW#¢ÆVDæÖW5·&÷u²tÆVB”BuÕÒÇÂ&÷u²u†öæRçVÖ&W"uÒÂÆVD–C¢&÷u²tÆVB”BuÒÂÆ–6F–öä–C¢&÷u²tÆ–6F–öâ”BuÒÀ¢76–væVE6¢Æ–6F–öä÷væW'5·&÷u²tÆ–6F–öâ”BuÕÒÇÂÆVD÷væW'5·&÷u²tÆVB”BuÕÒÇÂrrÂ†öæS¢&÷u²u†öæRçVÖ&W"uÒÂÖW76vS¢&÷u²t7W7FöÖW"ÖW76vRuÒÀ¢7FGW3¢&÷u²u&ö6W727FGW2uÒÂF–ÖS¢&÷u²u&V6V—fVBBuÒÂGF6†ÖVçEG—S¢&÷u²tGF6†ÖVçBG—RuÒÂÖW76vUG—S¢&÷u²tÖW76vRG—RuÒÂ6†ææVÃ¢&÷rä6†ææVÂÀ¢6†ææVÄ–C¢&÷u²t–çFW&æÂ6†ææVÂ”BuÒÂ†öæTçVÖ&W$–C¢&÷u²uv†G4çVÖ&W"”BuÒÂF—7Æ”çVÖ&W#¢&÷u²uv†G4F—7Æ’çVÖ&W"uÒÂv&–C¢&÷u²ut$”BuÒÂ6öçfW'6F–öä¶W“¢&÷u²t6öçfW'6F–öâ¶W’uÒÂ&÷WF–æu7FGW3¢&÷u²tçVÖ&W"&÷WF–ær7FGW2uÒÂ6†ææVÄæÖS¢6†ææVÄf÷$ÖW76vR‡&÷rÂ6†ææVÇ2“òå²t6†ææVÂæÖRuÒÇÂ&÷u²t–çFW&æÂ6†ææVÂ”BuÒÇÂ&÷u²uv†G4F—7Æ’çVÖ&W"uÒÀ¢6÷W&6S¢&÷rå6÷W&6RÇÂ&÷u²uvV&†öö²6÷W&6RuÒÂ•&ö6W76VC¢G'WF‚‡&÷u²t’&ö6W76VBuÒ’Â•&ö6W76VDC¢&÷u²t’&ö6W76VBBuÒÀ¢‡VÖä†æF÷fW$C¢&÷u²t‡VÖâ†æF÷fW"BuÒÂ‡VÖå&WV—&VC¢‡VÖå7FGW6W2æ†2†6ÆVâ‡&÷u²u&ö6W727FGW2uÒ’çFõWW$66R‚’¢Ò’¢&W6÷W&6RÓÓÒv÷WF&÷‚rò‡°¢–C¢&÷u²t÷WF&÷‚”BuÒÂ&V6—–VçC¢&÷u²u†öæRçVÖ&W"uÒÂÆVD–C¢&÷u²tÆVB”BuÒÂÆ–6F–öä–C¢&÷u²tÆ–6F–öâ”BuÒÂÖW76vS¢&÷u²tÖW76vRFW‡BuÒÇÂ&÷u²uFV×ÆFRæÖRuÒÀ¢7FGW3¢&÷u²u6VæB7FGW2uÒÂF–ÖS¢&÷u²u6VçBBuÒÇÂ&÷u²t7&VFVBBuÒÂ&÷f–FW$ÖW76vT–C¢&÷u²u&÷f–FW"ÖW76vR”BuÒÂ&÷WF–æu7FGW3¢&÷u²u6VæB&÷WF–ær7FGW2uÒÂ6†ææVÄ–C¢&÷u²t–çFW&æÂ6†ææVÂ”BuÒÂ†öæTçVÖ&W$–C¢&÷u²uv†G4çVÖ&W"”BuÒÂv&–C¢&÷u²ut$”BuÒÂ&WÇ•FôÖW76vT–C¢&÷u²u&WÇ’FòÖW76vR”BuÒÂ6†ææVÄæÖS¢6†ææVÄf÷$ÖW76vR‡&÷rÂ6†ææVÇ2“òå²t6†ææVÂæÖRuÒÇÂ&÷u²t–çFW&æÂ6†ææVÂ”BuÒÂF—7Æ”çVÖ&W#¢6†ææVÄf÷$ÖW76vR‡&÷rÂ6†ææVÇ2“òå²tF—7Æ’çVÖ&W"uÒÇÂrrÀ¢GFV×D6÷VçC¢çVÖ&W"‡&÷u²tGFV×B6÷VçBuÒÇÂ’ÂW'&÷$ÖW76vS¢&÷u²tW'&÷"ÖW76vRuÒÂFVÆ—fW&VDC¢&÷u²tFVÆ—fW&VBBuÒÂ&VDC¢&÷u²u&VBBuÒÂ7W7FöÖW%&WÆ–VDC¢&÷u²t7W7FöÖW"&WÆ–VBBuÒÀ¢ÖçVÃ¢6ÆVâ‡&÷u²u6VæB&÷WF–ær7FGW2uÒ’çFõWW$66R‚’ÓÓÒut„E4ô%U4”äU55ôÔåTÂrÇÂ6ÆVâ‡&÷u²u6VæB7FGW2uÒ’çFõWW$66R‚’ÓÓÒtÔåTÅõTäD”ärp¢Ò’¢‡²–C¢&÷u²t7F—f—G’”BuÒÂÆVD–C¢&÷u²tÆVB”BuÒÂÆ–6F–öä–C¢&÷u²tÆ–6F–öâ”BuÒÂG—S¢&÷u²t7F—f—G’G—RuÒÂFW67&—F–öã¢&÷räFW67&—F–öâÂ7F÷#¢&÷u²t7F÷"”BuÒÇÂu7—7FVÒrÂ7FGW3¢&÷u²t7F—f—G’7FGW2uÒÇÂt4ôÕÄUDTBrÂF–ÖS¢&÷u²t7F—f—G’BuÒÒ’“°¢&WGW&â&W2ç7FGW2ƒ#’æ§6öâ‡²Æ—fS¢G'VRÂ&V6÷&G2Ò“°¢Ð ¢6öç7B¶–æ&÷…&÷w2Â÷WF&÷…&÷w2ÂF6†&ö&DFö7VÖVçE&÷w5ÒÒv—B&VE&ævW2‡&WÂ²t7W7FöÖW%ô–æ&÷‚¤3rÂtÖW76vUô÷WF&÷‚¤3#rÂtFö7VÖVçEôÆör¤CSuÒ“°¢6öç7B–æ&÷‚Ò&÷w5Fôö&¦V7G2†–æ&÷…&÷w2’æf–ÇFW"‡&÷rÓâ'W6–æW74ÆVD–G2æ†2‡&÷u²tÆVB”BuÒ’ÇÂ'W6–æW74Æ–6F–öä–G2æ†2‡&÷u²tÆ–6F–öâ”BuÒ’“°¢6öç7B÷WF&÷‚Ò&÷w5Fôö&¦V7G2†÷WF&÷…&÷w2’æf–ÇFW"‡&÷rÓâ'W6–æW74ÆVD–G2æ†2‡&÷u²tÆVB”BuÒ’ÇÂ'W6–æW74Æ–6F–öä–G2æ†2‡&÷u²tÆ–6F–öâ”BuÒ’“°¢6öç7BF6†&ö&DFö7VÖVçG2Ò&÷w5Fôö&¦V7G2†F6†&ö&DFö7VÖVçE&÷w2’æf–ÇFW"‡&÷rÓâ'W6–æW74Æ–6F–öä–G2æ†2‡&÷u²tÆ–6F–öâ”BuÒ’ÇÂ'W6–æW74ÆVD–G2æ†2‡&÷u²tÆVB”BuÒ’“°¢6öç7BFö7VÖVçG4'”Æ–6F–öâÒæWrÖ‚“°¢F6†&ö&DFö7VÖVçG2æf÷$V6‚‡&÷rÓâ²6öç7B¶W’Ò&÷u²tÆ–6F–öâ”BuÓ²–b†¶W’’Fö7VÖVçG4'”Æ–6F–öâç6WB†¶W’Â²âââ†Fö7VÖVçG4'”Æ–6F–öâævWB†¶W’’ÇÂµÒ’Â&÷uÒ“²Ò“°¢6öç7B6ö×ÆWFVBÒ6÷VçB†'W6–æW74Æ–6F–öç2ÂtÆ–6F–öâ7FGW2rÂt4ôÕÄUDTBr“°¢6öç7B”W†6WF–öç2Ò'W6–æW74Æ–6F–öç2æf–ÇFW"‡&÷rÓâ°¢6öç7BÖöFRÒ6ÆVâ‡&÷u²u&ö6W76–ærÖöFRuÒ’çFõWW$66R‚“°¢&WGW&â6ÆVâ‡&÷u²tÆ–6F–öâ7FGW2uÒ’çFõWW$66R‚’ÓÓÒtÔåTÅõ$Ud”UrrÇÂ6ÆVâ‡&÷u²u4&Wf–Wr&WV—&VBuÒ’çFõWW$66R‚’ÓÓÒuE%TRrÇÂ²t•õDõõ4ô„äDõdU"rÂt•ôU„4UD”ôåõDõõ5DdbrÂt•ôU„4UD”ôåõ5DdeôÔåTÂuÒæ–æ6ÇVFW2†ÖöFR“°¢Ò’æÆVæwFƒ°¢6öç7BÆ×5&VG’Ò'W6–æW74Æ–6F–öç2æf–ÇFW"‡&÷rÓâ²u$TE•ôdõ%ôÄÕ2rÂu$TE’rÂuTUTTBuÒæ–æ6ÇVFW2†6ÆVâ‡&÷u²tÄÕ27V&Ö—76–öâ7FGW2uÒ’çFõWW$66R‚’’ÇÂ6ÆVâ‡&÷u²tÖ–æ–×VÒFö7VÖVçG26ö×ÆWFRuÒ’çFõWW$66R‚’ÓÓÒuE%TRrÇÂFö7VÖVçE7VÖÖ'’†Fö7VÖVçG4'”Æ–6F–öâævWB‡&÷u²tÆ–6F–öâ”BuÒ’ÇÂµÒ’æ”6ö×ÆWFR’æÆVæwFƒ°¢6öç7B‡VÖä†æF÷fW'2Ò–æ&÷‚æf–ÇFW"‡&÷rÓâ‡VÖå7FGW6W2æ†2†6ÆVâ‡&÷u²u&ö6W727FGW2uÒ’çFõWW$66R‚’’’æÆVæwFƒ°¢6öç7BæVVG4GFVçF–öâÒ”W†6WF–öç2²6÷VçB†'W6–æW74Æ–6F–öç2Ât7W'&VçB7FvRrÂu$T4õdU%•õTäD”ärr’²6÷VçB†÷WF&÷‚Âu6VæB7FGW2rÂtd”ÄTBr’²‡VÖä†æF÷fW'3°¢&WGW&â&W2ç7FGW2ƒ#’æ§6öâ‡²Æ—fS¢G'VRÂWFFVDC¢æWrFFR‚’çFô•4õ7G&–ær‚’Â7VÖÖ'“¢²ÆVG3¢'W6–æW74ÆVG2æÆVæwF‚ÂÆ–6F–öç3¢'W6–æW74Æ–6F–öç2æÆVæwF‚Â6öçfW'6–öã¢'W6–æW74ÆVG2æÆVæwF‚ò'W6–æW74Æ–6F–öç2æÆVæwF‚ò'W6–æW74ÆVG2æÆVæwF‚¢Â7–çF†WF–5&V6÷&G3¢66÷RæÆVG2æÆVæwF‚Ò'W6–æW74ÆVG2æÆVæwF‚²66÷RæÆ–6F–öç2æÆVæwF‚Ò'W6–æW74Æ–6F–öç2æÆVæwF‚ÂæVVG4GFVçF–öâÂ6ö×ÆWFVBÂ‡VÖä†æF÷fW'2Â”W†6WF–öç2ÂÆ×5&VG’ÂVç&VD–æ&÷ƒ¢–æ&÷‚æf–ÇFW"‡&÷rÓâ²täUrrÂtU%$õ"rÂt…TÔåô„äDõdU%õ$UT•$TBrÂt54”täTEõDõõ5DdbuÒæ–æ6ÇVFW2†6ÆVâ‡&÷u²u&ö6W727FGW2uÒ’çFõWW$66R‚’’’æÆVæwF‚ÒÒ“°¢Ò6F6‚†W'&÷"’°¢6öç6öÆRæW'&÷"†W'&÷"“°¢&WGW&â&W2ç7FGW2ƒS2’æ§6öâ‡²Æ—fS¢fÇ6RÂW'&÷#¢t5$ÒFF6öææV7F–öâ—2æ÷B6öæf–wW&VB–WBârÒ“°¢Ð§Ð 