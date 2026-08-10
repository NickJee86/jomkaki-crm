import crypto from 'node:crypto';
import { authenticate, clearSession, getSession, hashPassword, migrateEnvironmentAccounts, setSession, validateSession } from './_auth.js';
import { FUTURE_REPORTING_FIELDS, integrationReadiness, publicIntegrationRecords } from './_integrations.js';

const SHEET_ID = process.env.JOMKAKI_SPREADSHEET_ID;
const CLIENT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const PROJECT_NUMBER = process.env.GOOGLE_PROJECT_NUMBER;
const POOL_ID = process.env.GOOGLE_WIF_POOL_ID || 'vercel-production';
const PROVIDER_ID = process.env.GOOGLE_WIF_PROVIDER_ID || 'vercel-jomkaki-production';
const clean = value => String(value ?? '').trim();
const customerAmount = value => clean(value).replace(/^RM\s*/i, '');
const canonicalRegion = value => ['SARAWAK', 'SABAH', 'LABUAN', 'EAST MALAYSIA', 'EAST_MALAYSIA'].includes(clean(value).toUpperCase()) ? 'EAST_MALAYSIA' : clean(value).toUpperCase();
const canonicalRole = value => clean(value).toUpperCase() === 'BRANCH_MANAGER' ? 'BRANCH_SUPERVISOR' : clean(value).toUpperCase();
const canonicalBusinessAccess = (value, role = '') => {
  const access = clean(value).toUpperCase();
  if (['MOTOR', 'HANDPHONE', 'BOTH'].includes(access)) return access;
  const normalizedRole = canonicalRole(role);
  if (normalizedRole === 'ADMIN' || normalizedRole === 'STAFF') return 'BOTH';
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
  ? { unit: 'HANDPHONE', catalog: 'Handphone_Model_Catalog', pricing: 'Handphone_Loan_Pricing', catalogMax: 'Q', pricingMax: 'AB', idPrefix: 'HP' }
  : { unit: 'MOTOR', catalog: 'Motor_Model_Catalog', pricing: 'Motor_Loan_Pricing', catalogMax: 'Q', pricingMax: 'Z', idPrefix: 'MTR' };
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
  const start = columnName(headers.length), end = columnName(headers.length + missing.length - 1);
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(`${sheet}!${start}1:${end}1`)}?valueInputOption=USER_ENTERED`, {
    method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ values: [missing] })
  });
  if (!response.ok) throw new Error(`Unable to extend ${sheet} headers (${response.status})`);
  return [...headers, ...missing];
}

async function getSharePointToken() {
  const tenant = clean(process.env.SHAREPOINT_TENANT_ID), client = clean(process.env.SHAREPOINT_CLIENT_ID), secret = clean(process.env.SHAREPOINT_CLIENT_SECRET);
  if (!tenant || !client || !secret) throw new Error('SharePoint application credentials are not configured');
  const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: client, client_secret: secret, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' })
  });
  if (!response.ok) throw new Error(`SharePoint authentication failed (${response.status})`);
  return (await response.json()).access_token;
}

async function graph(token, url, options = {}) {
  const response = await fetch(`https://graph.microsoft.com/v1.0${url}`, { ...options, headers: { authorization: `Bearer ${token}`, ...(options.headers || {}) } });
  if (!response.ok) throw new Error(`SharePoint request failed (${response.status})`);
  return response.status === 204 ? {} : response.json();
}

async function ensureFolder(token, driveId, parentId, name) {
  const safe = name.replace(/["*:<>?/\\|#%]/g, '-').slice(0, 120);
  const children = await graph(token, `/drives/${driveId}/items/${parentId}/children?$select=id,name,folder`);
  const existing = (children.value || []).find(item => item.folder && item.name.toLowerCase() === safe.toLowerCase());
  if (existing) return existing;
  return graph(token, `/drives/${driveId}/items/${parentId}/children`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: safe, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' }) });
}

async function uploadDocument(req, file, caseId) {
  const bytes = Buffer.from(clean(file.data).replace(/^data:[^;]+;base64,/, ''), 'base64');
  if (!bytes.length || bytes.length > 4 * 1024 * 1024) throw new Error('Document must be between 1 byte and 4 MB');
  const token = await getSharePointToken();
  const host = clean(process.env.SHAREPOINT_HOSTNAME) || 'rexmgt.sharepoint.com';
  const sitePath = clean(process.env.SHAREPOINT_SITE_PATH) || '/sites/JomkakiMotorSecureDocuments';
  const libraryName = clean(process.env.SHAREPOINT_LIBRARY_NAME) || 'Documents';
  const site = await graph(token, `/sites/${host}:${sitePath}?$select=id`);
  const drives = await graph(token, `/sites/${site.id}/drives?$select=id,name,driveType`);
  const drive = (drives.value || []).find(item => item.name.toLowerCase() === libraryName.toLowerCase()) || (drives.value || []).find(item => item.driveType === 'documentLibrary');
  if (!drive) throw new Error('SharePoint document library was not found');
  const root = await graph(token, `/drives/${drive.id}/root?$select=id`);
  const crmFolder = await ensureFolder(token, drive.id, root.id, 'CRM Customer Documents');
  const caseFolder = await ensureFolder(token, drive.id, crmFolder.id, caseId || 'Unassigned');
  const safeName = (clean(file.name) || `document-${Date.now()}`).replace(/["*:<>?/\\|#%]/g, '-').slice(0, 180);
  return graph(token, `/drives/${drive.id}/items/${caseFolder.id}:/${encodeURIComponent(safeName)}:/content?$select=id,name,webUrl`, {
    method: 'PUT', headers: { 'content-type': clean(file.type) || 'application/octet-stream' }, body: bytes
  });
}

const makeId = prefix => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
const now = () => new Date().toISOString();
const temporaryPassword = () => `JK!${crypto.randomBytes(6).toString('base64url')}9a`;
const userSheetRange = 'CRM_User_Access!A1:S1000';
const truth = value => clean(value).toUpperCase() === 'TRUE';
const slug = value => clean(value).toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'ITEM';
const amount = (value, label, optional = false) => {
  const raw = clean(value).replace(/^RM\s*/i, '').replace(/,/g, '');
  if (!raw && optional) return '';
  const number = Number(raw);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${label} must be zero or a positive number`);
  return number;
};
const validDate = (value, label) => {
  const date = clean(value);
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`${label} must use YYYY-MM-DD`);
  return date;
};
const validUrl = (value, label) => {
  const url = clean(value);
  if (url && !/^https?:\/\//i.test(url)) throw new Error(`${label} must start with http:// or https://`);
  return url;
};
const promotionApplies = row => {
  const today = now().slice(0, 10), start = clean(row['Promotion Start']), end = clean(row['Promotion End']);
  return truth(row['Promotion Active']) && clean(row['Promotion Approval Status']).toUpperCase() === 'APPROVED' && clean(row['Promotion Deposit (RM)']) !== '' && (!start || start <= today) && (!end || end >= today);
};
const effectiveDeposit = row => customerAmount(promotionApplies(row) ? row['Promotion Deposit (RM)'] : row['Deposit (RM)']);

async function setPricingDerivedFormulas(req, pricingId, businessUnit = 'MOTOR') {
  const config = businessSheets(businessUnit);
  const [rows] = await readRanges(req, [`${config.pricing}!A1:${config.pricingMax}2000`]);
  const headers = rows?.[0] || [], idIndex = headers.indexOf('Pricing ID');
  const rowIndex = rows.findIndex((row, index) => index > 0 && clean(row[idIndex]) === clean(pricingId));
  if (rowIndex < 1) throw new Error('New pricing record was not found');
  const rowNumber = rowIndex + 1, token = await getAccessToken(req);
  const data = config.unit === 'HANDPHONE' ? [
    { range: `${config.pricing}!AA${rowNumber}`, values: [[`=IFERROR(IF(B${rowNumber}=\"\",\"\",IF(AND(X${rowNumber}=TRUE,Y${rowNumber}=\"APPROVED\",U${rowNumber}<>\"\",OR(V${rowNumber}=\"\",V${rowNumber}<=TODAY()),OR(W${rowNumber}=\"\",W${rowNumber}>=TODAY())),U${rowNumber},H${rowNumber})),\"\")`]] },
    { range: `${config.pricing}!AB${rowNumber}`, values: [[`=IFERROR(IF(B${rowNumber}=\"\",\"\",IF(AND(X${rowNumber}=TRUE,Y${rowNumber}=\"APPROVED\",U${rowNumber}<>\"\",OR(V${rowNumber}=\"\",V${rowNumber}<=TODAY()),OR(W${rowNumber}=\"\",W${rowNumber}>=TODAY())),IF(T${rowNumber}<>\"\",\"Promotion \"&T${rowNumber}&\" untuk\",\"Promotion untuk\"),\"Untuk\")),\"\")`]] }
  ] : [
    { range: `${config.pricing}!Y${rowNumber}`, values: [[`=IFERROR(IF(B${rowNumber}=\"\",\"\",IF(AND(V${rowNumber}=TRUE,W${rowNumber}=\"APPROVED\",S${rowNumber}<>\"\",OR(T${rowNumber}=\"\",T${rowNumber}<=TODAY()),OR(U${rowNumber}=\"\",U${rowNumber}>=TODAY())),S${rowNumber},G${rowNumber})),\"\")`]] },
    { range: `${config.pricing}!Z${rowNumber}`, values: [[`=IFERROR(IF(B${rowNumber}=\"\",\"\",IF(AND(V${rowNumber}=TRUE,W${rowNumber}=\"APPROVED\",S${rowNumber}<>\"\",OR(T${rowNumber}=\"\",T${rowNumber}<=TODAY()),OR(U${rowNumber}=\"\",U${rowNumber}>=TODAY())),IF(R${rowNumber}<>\"\",\"Promotion \"&R${rowNumber}&\" untuk\",\"Promotion untuk\"),\"Untuk\")),\"\")`]] }
  ];
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values:batchUpdate`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data })
  });
  if (!response.ok) throw new Error(`Unable to finish pricing formulas (${response.status})`);
}

async function accountRows(req) {
  const [rows] = await readRanges(req, [userSheetRange]);
  return rowsToObjects(rows);
}

async function validatedAccountScope(req, role, region, branchId, saId, businessAccess) {
  const normalizedRole = canonicalRole(role);
  const normalizedBusinessAccess = canonicalBusinessAccess(businessAccess, normalizedRole);
  const normalizedRegion = ['ADMIN', 'BUSINESS_MANAGER'].includes(normalizedRole) && canonicalRegion(region) === 'ALL' ? 'ALL' : canonicalRegion(region);
  if (normalizedRole === 'ADMIN') return { region: 'ALL', branchId: '', saId: '', businessAccess: 'BOTH' };
  if (normalizedRole === 'BUSINESS_MANAGER') {
    if (!['ALL', 'EAST_MALAYSIA', 'WEST_MALAYSIA'].includes(normalizedRegion)) throw new Error('A valid business region is required');
    return { region: normalizedRegion, branchId: '', saId: '', businessAccess: normalizedBusinessAccess };
  }
  if (!['EAST_MALAYSIA', 'WEST_MALAYSIA'].includes(normalizedRegion)) throw new Error('A valid region is required');
  if (normalizedRole === 'REGION_MANAGER') return { region: normalizedRegion, branchId: '', saId: '', businessAccess: normalizedBusinessAccess };
  const [branchRows, saRows] = await readRanges(req, ['Branch_Master!A1:S1000', 'SA_Master!A1:O1000']);
  const branches = rowsToObjects(branchRows), advisors = rowsToObjects(saRows);
  if (normalizedRole === 'BRANCH_SUPERVISOR') {
    const branch = branches.find(row => clean(row['Branch ID']) === clean(branchId) && clean(row.Active).toUpperCase() === 'TRUE');
    if (!branch) throw new Error('Branch Supervisor requires an active Branch ID');
    if (canonicalRegion(branch.Region) !== normalizedRegion) throw new Error('The selected branch does not belong to this region');
    return { region: normalizedRegion, branchId: clean(branchId), saId: '', businessAccess: normalizedBusinessAccess };
  }
  const advisor = advisors.find(row => clean(row['SA ID']) === clean(saId) && clean(row.Active).toUpperCase() === 'TRUE');
  if (!advisor) throw new Error('Staff requires an active SA ID');
  const advisorBranch = clean(advisor['Branch ID']);
  const branch = branches.find(row => clean(row['Branch ID']) === advisorBranch && clean(row.Active).toUpperCase() === 'TRUE');
  if (!branch || canonicalRegion(advisor.Region || branch.Region) !== normalizedRegion) throw new Error('The selected sales advisor does not belong to this region');
  if (clean(branchId) && clean(branchId) !== advisorBranch) throw new Error('The selected sales advisor does not belong to this branch');
  const advisorAccess = canonicalBusinessAccess(advisor['Business Access'] || 'BOTH', 'STAFF');
  if ((normalizedBusinessAccess === 'BOTH' && advisorAccess !== 'BOTH') || (normalizedBusinessAccess !== 'BOTH' && !businessAllows(advisorAccess, normalizedBusinessAccess))) throw new Error('The selected sales advisor does not have the requested business access');
  return { region: normalizedRegion, branchId: advisorBranch, saId: clean(saId), businessAccess: normalizedBusinessAccess };
}

const accountAccessDescription = identity => {
  if (identity.role === 'ADMIN') return 'All CRM customers, accounts and settings';
  const business = identity.businessAccess === 'BOTH' ? 'Motor and Handphone' : identity.businessAccess === 'HANDPHONE' ? 'Handphone' : 'Motor';
  if (identity.role === 'BUSINESS_MANAGER') return `All ${business} customers and staff${identity.region === 'ALL' ? '' : ` in ${identity.region.replace('_', ' ')}`}`;
  if (identity.role === 'REGION_MANAGER') return `All ${business} branches, staff and customers in ${identity.region.replace('_', ' ')}`;
  if (identity.role === 'BRANCH_SUPERVISOR') return `All ${business} staff and customers in own branch`;
  return `${business} customers and follow-ups assigned to own SA ID`;
};

const humanStatuses = new Set(['HUMAN_HANDOVER_REQUIRED', 'MANAGER_IN_PROGRESS', 'ASSIGNED_TO_STAFF']);
const managerRoles = new Set(['ADMIN', 'REGION_MANAGER', 'BUSINESS_MANAGER', 'BRANCH_SUPERVISOR', 'BRANCH_MANAGER']);
const whatsappPhone = value => {
  let digits = clean(value).replace(/\D/g, '');
  if (digits.startsWith('0')) digits = `60${digits.slice(1)}`;
  return digits;
};

const channelRange = 'WhatsApp_Number_Master!A1:AC1000';
const channelIdPattern = /^JKM-WA-(EAST|WEST)-0([1-5])$/;
const channelEnvironmentPrefix = value => clean(value).toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
const rowTime = row => new Date(row['Received At'] || row['Sent At'] || row['Created At'] || 0).valueOf() || 0;

export function channelRegion(row = {}, branches = []) {
  const explicit = canonicalRegion(row.Region);
  if (['EAST_MALAYSIA', 'WEST_MALAYSIA'].includes(explicit)) return explicit;
  const branch = branches.find(item => clean(item['Branch ID']) === clean(row['Branch ID']));
  const branchRegion = canonicalRegion(branch?.Region);
  if (['EAST_MALAYSIA', 'WEST_MALAYSIA'].includes(branchRegion)) return branchRegion;
  const match = clean(row['Internal Channel ID']).match(channelIdPattern);
  return match ? `${match[1]}_MALAYSIA` : 'UNASSIGNED';
}

function publicChannel(row, branches = [], env = process.env) {
  const credentialKey = channelEnvironmentPrefix(row['Credential Key'] || row['Internal Channel ID']);
  const tokenConfigured = !!clean(env[`${credentialKey}_ACCESS_TOKEN`] || env.WHATSAPP_ACCESS_TOKEN);
  const phoneNumberId = clean(row['Phone Number ID'] || env[`${credentialKey}_PHONE_NUMBER_ID`]);
  return {
    id: row['Internal Channel ID'], name: row['Channel Name'], phoneNumberId: clean(row['Phone Number ID']), displayNumber: row['Display Number'],
    wabaId: row['WABA ID'], appId: row['Meta App ID'], portfolioId: row['Business Portfolio ID'], branchId: row['Branch ID'], region: channelRegion(row, branches), businessUnit: canonicalBusinessUnit(row['Business Unit']) || 'UNASSIGNED', teamId: row['Team ID'],
    slot: row['Channel Slot'], campaignSource: row['Campaign Source'], defaultOwner: row['Default Team / SA'], inboundEnabled: truth(row['Inbound Enabled']),
    outboundEnabled: truth(row['Outbound Enabled']), active: truth(row.Active), connectionAlias: row['Make Connection Alias'], webhookRouteKey: row['Webhook Route Key'],
    environment: row.Environment, lastVerified: row['Last Verified At'], lastInboundAt: row['Last Inbound At'], lastOutboundAt: row['Last Outbound At'],
    status: row['Data Status'], notes: row['Internal Notes'], credentialKey, credentialConfigured: tokenConfigured && !!phoneNumberId
  };
}

const channelForMessage = (message, channels) => {
  const channelId = clean(message?.['Internal Channel ID']);
  const numberId = clean(message?.['WhatsApp Number ID']);
  return channels.find(row => channelId && clean(row['Internal Channel ID']) === channelId) || channels.find(row => numberId && clean(row['Phone Number ID']) === numberId);
};

export function resolveCustomerChannel({ leadId = '', applicationId = '', replyToMessageId = '', preferredChannelId = '', leads = [], applications = [], inbox = [], outbox = [], channels = [], branches = [] } = {}) {
  const matchesCustomer = row => (leadId && clean(row['Lead ID']) === clean(leadId)) || (applicationId && clean(row['Application ID']) === clean(applicationId));
  const application = applications.find(app => clean(app['Application ID']) === clean(applicationId));
  const lead = leads.find(row => clean(row['Lead ID']) === clean(leadId)) || leads.find(row => clean(row['Lead ID']) === clean(application?.['Lead ID']));
  const targetBusiness = rowBusinessUnit(application || lead || {});
  const channelMatchesBusiness = channel => !canonicalBusinessUnit(channel?.['Business Unit']) || canonicalBusinessUnit(channel?.['Business Unit']) === targetBusiness;
  const reply = inbox.find(row => clean(row['Message ID']) === clean(replyToMessageId) && matchesCustomer(row));
  const inbound = [reply, ...inbox.filter(row => matchesCustomer(row)).sort((a, b) => rowTime(b) - rowTime(a))].filter(Boolean);
  for (const message of inbound) {
    const channel = channelForMessage(message, channels);
    if (channel) return { channel, source: reply === message ? 'REPLY_TO_INBOUND_CHANNEL' : 'LATEST_INBOUND_CHANNEL' };
    const numberId = clean(message['WhatsApp Number ID']);
    if (numberId) return { channel: null, source: 'UNREGISTERED_INBOUND_CHANNEL', unregisteredNumberId: numberId };
  }
  const boundId = clean(lead?.['Last Inbound WhatsApp Channel ID'] || lead?.['Primary WhatsApp Channel ID']);
  const boundNumberId = clean(lead?.['Last Inbound WhatsApp Number ID']);
  const bound = channels.find(row => boundId && clean(row['Internal Channel ID']) === boundId) || channels.find(row => boundNumberId && clean(row['Phone Number ID']) === boundNumberId);
  if (bound) return { channel: bound, source: 'CUSTOMER_CHANNEL_BINDING' };
  const previousOutbound = outbox.filter(row => matchesCustomer(row)).sort((a, b) => rowTime(b) - rowTime(a)).map(row => channelForMessage(row, channels)).find(Boolean);
  if (previousOutbound) return { channel: previousOutbound, source: 'LATEST_OUTBOUND_CHANNEL' };
  const preferred = channels.find(row => clean(row['Internal Channel ID']) === clean(preferredChannelId) && channelMatchesBusiness(row));
  if (preferred) return { channel: preferred, source: 'AUTHORIZED_CHANNEL_SELECTION' };
  const targetBranch = clean(lead?.['Selected Branch ID'] || application?.['Assigned Branch ID']);
  const targetRegion = canonicalRegion(lead?.Region || branches.find(row => clean(row['Branch ID']) === targetBranch)?.Region);
  const available = channels.filter(row => truth(row.Active) && truth(row['Outbound Enabled']) && channelMatchesBusiness(row));
  const fallback = available.find(row => targetBranch && clean(row['Branch ID']) === targetBranch) || available.find(row => channelRegion(row, branches) === targetRegion);
  return { channel: fallback || null, source: fallback ? 'REGION_BUSINESS_DEFAULT_CHANNEL' : 'NO_MATCHING_BUSINESS_CHANNEL' };
}

function channelCredentials(channel, env = process.env) {
  const prefix = channelEnvironmentPrefix(channel?.['Credential Key'] || channel?.['Internal Channel ID']);
  return {
    accessToken: clean(env[`${prefix}_ACCESS_TOKEN`] || env.WHATSAPP_ACCESS_TOKEN),
    phoneNumberId: clean(channel?.['Phone Number ID'] || env[`${prefix}_PHONE_NUMBER_ID`] || env.WHATSAPP_PHONE_NUMBER_ID),
    version: clean(env.WHATSAPP_GRAPH_VERSION) || 'v25.0'
  };
}

function publicAccount(row) {
  const role = canonicalRole(row.Role);
  return { id: row['Account ID'], username: row.Username, name: row['Display Name'], role, businessAccess: canonicalBusinessAccess(row['Business Access'], role), saId: row['SA ID'], branchId: row['Branch ID'], region: row.Region, status: row.Status, access: row['Access Scope'], loginEnabled: clean(row['Login Enabled']).toUpperCase() === 'TRUE', mustChangePassword: clean(row['Must Change Password']).toUpperCase() === 'TRUE', failedAttempts: Number(row['Failed Login Attempts'] || 0), lockedUntil: row['Locked Until'], lastVerified: row['Last Verified'], lastPasswordReset: row['Last Password Reset'], notes: row.Notes };
}

async function writeActivity(req, session, payload) {
  await appendObject(req, 'Activity_Log', {
    'Activity ID': makeId('ACT'), 'Activity At': now(), 'Lead ID': payload.leadId || '', 'Application ID': payload.applicationId || '',
    'Activity Type': payload.type, Description: payload.description, 'Actor ID': session.username, 'Activity Status': 'COMPLETED'
  });
}

function rowsToObjects(rows) {
  const [headers = [], ...data] = rows;
  return data.filter(row => row.some(Boolean)).map(row => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ''])));
}

export function scopeData(session, leads, applications, branches) {
  if (session.role === 'ADMIN') return { leads, applications, leadIds: new Set(leads.map(x => x['Lead ID'])), applicationIds: new Set(applications.map(x => x['Application ID'])) };
  const branchRegion = Object.fromEntries(branches.map(row => [row['Branch ID'], canonicalRegion(row.Region)]));
  const permittedLeads = leads.filter(row => businessPermitted(session, row));
  const permittedApplications = applications.filter(row => businessPermitted(session, row));
  if (session.role === 'STAFF') {
    const scopedLeads = permittedLeads.filter(row => clean(row['Assigned SA ID']) === clean(session.saId));
    const leadIds = new Set(scopedLeads.map(row => row['Lead ID']));
    const scopedApplications = permittedApplications.filter(row => clean(row['Assigned SA ID']) === clean(session.saId) || leadIds.has(row['Lead ID']));
    return { leads: scopedLeads, applications: scopedApplications, leadIds, applicationIds: new Set(scopedApplications.map(row => row['Application ID'])) };
  }
  if (['BRANCH_SUPERVISOR', 'BRANCH_MANAGER'].includes(session.role)) {
    const scopedLeads = permittedLeads.filter(row => clean(row['Selected Branch ID']) === clean(session.branchId));
    const leadIds = new Set(scopedLeads.map(row => row['Lead ID']));
    const scopedApplications = permittedApplications.filter(row => clean(row['Assigned Branch ID']) === clean(session.branchId) || leadIds.has(row['Lead ID']));
    return { leads: scopedLeads, applications: scopedApplications, leadIds, applicationIds: new Set(scopedApplications.map(row => row['Application ID'])) };
  }
  if (session.role === 'BUSINESS_MANAGER') {
    const scopedLeads = permittedLeads.filter(row => session.region === 'ALL' || canonicalRegion(row.Region) === session.region);
    const leadIds = new Set(scopedLeads.map(row => row['Lead ID']));
    const scopedApplications = permittedApplications.filter(row => leadIds.has(row['Lead ID']) || session.region === 'ALL' || branchRegion[row['Assigned Branch ID']] === session.region);
    return { leads: scopedLeads, applications: scopedApplications, leadIds, applicationIds: new Set(scopedApplications.map(row => row['Application ID'])) };
  }
  const scopedLeads = permittedLeads.filter(row => canonicalRegion(row.Region) === session.region);
  const leadIds = new Set(scopedLeads.map(row => row['Lead ID']));
  const scopedApplications = permittedApplications.filter(row => leadIds.has(row['Lead ID']) || branchRegion[row['Assigned Branch ID']] === session.region);
  return { leads: scopedLeads, applications: scopedApplications, leadIds, applicationIds: new Set(scopedApplications.map(row => row['Application ID'])) };
}

const count = (rows, field, value) => rows.filter(row => clean(row[field]).toUpperCase() === value).length;
const latestApplicationByLead = applications => {
  const map = new Map();
  applications.forEach(row => { const id = row['Lead ID']; if (id) map.set(id, row); });
  return map;
};
const acceptedVerification = new Set(['VERIFIED', 'AI_VERIFIED', 'APPROVED', 'ACCEPTED']);
const acceptedQuality = new Set(['GOOD', 'PASS', 'PASSED', 'ACCEPTED']);
const incomeDocumentTypes = new Set(['INCOME_PROOF', 'PAYSLIP', 'SALARY_SLIP', 'EPF', 'EPF_STATEMENT']);

export function deriveDocumentReadiness(documents = []) {
  const accepted = documents.filter(row => {
    const verification = clean(row['Verification Status'] || row.verification).toUpperCase();
    const quality = clean(row['Quality Status'] || row.quality).toUpperCase();
    return acceptedVerification.has(verification) && (!quality || acceptedQuality.has(quality)) && clean(row['Manual Review Required'] || row.reviewRequired).toUpperCase() !== 'TRUE';
  });
  const types = new Set(accepted.map(row => clean(row['Document Type'] || row.type).toUpperCase()));
  const missing = [];
  if (!types.has('IC_FRONT')) missing.push('IC_FRONT');
  if (!types.has('IC_BACK')) missing.push('IC_BACK');
  if (![...types].some(type => incomeDocumentTypes.has(type))) missing.push('INCOME_PROOF');
  const exception = documents.some(row => clean(row['Manual Review Required'] || row.reviewRequired).toUpperCase() === 'TRUE' || ['POOR', 'BLURRY', 'FAILED', 'REJECTED'].includes(clean(row['Quality Status'] || row.quality || row['Verification Status'] || row.verification).toUpperCase()));
  return { complete: missing.length === 0 && !exception, missing, exception };
}

const documentSummary = documents => {
  const received = documents.filter(row => clean(row['Document Type']));
  const types = [...new Set(received.map(row => row['Document Type']).filter(Boolean))];
  const readiness = deriveDocumentReadiness(received);
  return { count: received.length, types, needsReview: readiness.exception, aiComplete: readiness.complete, missing: readiness.missing, latest: received.map(x => x['Updated At'] || x['Received At']).filter(Boolean).sort().at(-1) || '' };
};

export default async function handler(req, res) {
  let session = getSession(req);
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Vary', 'Cookie');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (session) {
    try { session = await validateSession(req, session); } catch { session = false; }
  }
  if (!session) clearSession(res);
  if (!session) return res.status(401).json({ live: false, error: 'Authentication required.' });
  if (req.method === 'POST') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const action = clean(body.action);
      if (action === 'changeOwnPassword') {
        const currentPassword = clean(body.currentPassword), newPassword = clean(body.newPassword);
        if (newPassword.length < 10) throw new Error('New password must contain at least 10 characters');
        if (!await authenticate(req, session.username, currentPassword)) return res.status(403).json({ live: false, error: 'Current password is incorrect.' });
        const record = (await accountRows(req)).find(row => clean(row.Username).toLowerCase() === clean(session.username).toLowerCase());
        if (!record) throw new Error('Your account must be migrated by Admin before changing its password');
        const timestamp = now();
        await updateObject(req, 'CRM_User_Access', 'Account ID', record['Account ID'], { 'Password Hash': hashPassword(newPassword), 'Must Change Password': 'FALSE', 'Failed Login Attempts': '0', 'Locked Until': '', 'Last Password Reset': timestamp, 'Updated At': timestamp }, 'R');
        await writeActivity(req, session, { type: 'CRM_OWN_PASSWORD_CHANGED', description: `${session.username} changed their password` });
        setSession(res, { ...session, mustChangePassword: false, authSource: 'sheet', authVersion: timestamp });
        return res.status(200).json({ live: true });
      }
      if (['createUser', 'resetUserPassword', 'setUserEnabled', 'editUser', 'unlockUser', 'migrateLegacyAccounts'].includes(action)) {
        if (session.role !== 'ADMIN') return res.status(403).json({ live: false, error: 'Administrator access is required.' });
        if (action === 'migrateLegacyAccounts') {
          await ensureSheetHeaders(req, 'CRM_User_Access', ['Business Access']);
          const migrated = await migrateEnvironmentAccounts(req);
          await writeActivity(req, session, { type: 'CRM_LEGACY_ACCOUNTS_MIGRATED', description: `${migrated} legacy accounts migrated to CRM management` });
          return res.status(200).json({ live: true, migrated });
        }
        await ensureSheetHeaders(req, 'CRM_User_Access', ['Business Access']);
        const users = await accountRows(req);
        if (action === 'createUser') {
          const username = clean(body.username).toLowerCase(), name = clean(body.name), role = canonicalRole(body.role);
          if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw new Error('Username must be 3–40 letters, numbers, dots, dashes or underscores');
          if (!name || !['ADMIN', 'REGION_MANAGER', 'BUSINESS_MANAGER', 'BRANCH_SUPERVISOR', 'STAFF'].includes(role)) throw new Error('Name and a valid role are required');
          if (users.some(row => clean(row.Username).toLowerCase() === username)) throw new Error('This username already exists');
          const identity = { role, ...(await validatedAccountScope(req, role, body.region, body.branchId, body.saId, body.businessAccess)) };
          const password = clean(body.password) || temporaryPassword();
          if (password.length < 10) throw new Error('Temporary password must contain at least 10 characters');
          const accountId = `${role.replace('_MANAGER', '').replace('REGION', 'REG')}-${Date.now()}`;
          const timestamp = now();
          await appendObject(req, 'CRM_User_Access', {
            'Account ID': accountId, Username: username, 'Display Name': name, Role: role, 'SA ID': identity.saId, 'Branch ID': identity.branchId, Region: identity.region, 'Business Access': identity.businessAccess,
            Status: 'ACTIVE', 'Access Scope': accountAccessDescription(identity),
            'Login Enabled': 'TRUE', 'Last Verified': timestamp.slice(0, 10), Notes: 'Created in CRM by Admin', 'Password Hash': hashPassword(password), 'Must Change Password': 'TRUE', 'Failed Login Attempts': '0', 'Locked Until': '', 'Last Password Reset': timestamp, 'Updated At': timestamp
          });
          await writeActivity(req, session, { type: 'CRM_USER_CREATED', description: `${role} account ${username} created` });
          return res.status(201).json({ live: true, accountId, temporaryPassword: password });
        }
        const accountId = clean(body.accountId), record = users.find(row => clean(row['Account ID']) === accountId);
        if (!record) throw new Error('User account was not found');
        const activeAdmins = users.filter(row => clean(row.Role).toUpperCase() === 'ADMIN' && clean(row.Status).toUpperCase() === 'ACTIVE' && clean(row['Login Enabled']).toUpperCase() === 'TRUE');
        if (record.Username === session.username && action === 'setUserEnabled' && clean(body.enabled).toUpperCase() !== 'TRUE') throw new Error('You cannot disable your own signed-in account');
        if (action === 'resetUserPassword') {
          const password = clean(body.password) || temporaryPassword();
          if (password.length < 10) throw new Error('Temporary password must contain at least 10 characters');
          const timestamp = now();
          await updateObject(req, 'CRM_User_Access', 'Account ID', accountId, { 'Password Hash': hashPassword(password), 'Must Change Password': 'TRUE', 'Failed Login Attempts': '0', 'Locked Until': '', 'Last Password Reset': timestamp, 'Updated At': timestamp }, 'R');
          await writeActivity(req, session, { type: 'CRM_USER_PASSWORD_RESET', description: `Password reset for ${record.Username}` });
          return res.status(200).json({ live: true, temporaryPassword: password });
        }
        if (action === 'editUser') {
          const role = canonicalRole(body.role), name = clean(body.name), username = clean(body.username).toLowerCase();
          if (!name || !/^[a-z0-9._-]{3,40}$/.test(username) || !['ADMIN', 'REGION_MANAGER', 'BUSINESS_MANAGER', 'BRANCH_SUPERVISOR', 'STAFF'].includes(role)) throw new Error('Valid name, username and role are required');
          if (users.some(row => row['Account ID'] !== accountId && clean(row.Username).toLowerCase() === username)) throw new Error('This username already exists');
          if (clean(record.Username).toLowerCase() === clean(session.username).toLowerCase() && role !== 'ADMIN') throw new Error('You cannot remove your own Administrator access');
          if (clean(record.Role).toUpperCase() === 'ADMIN' && role !== 'ADMIN' && activeAdmins.length <= 1) throw new Error('At least one active Administrator must remain');
          const identity = { role, ...(await validatedAccountScope(req, role, body.region, body.branchId, body.saId, body.businessAccess)) };
          await updateObject(req, 'CRM_User_Access', 'Account ID', accountId, { Username: username, 'Display Name': name, Role: role, 'SA ID': identity.saId, 'Branch ID': identity.branchId, Region: identity.region, 'Business Access': identity.businessAccess, 'Access Scope': accountAccessDescription(identity), 'Updated At': now() }, 'S');
          await writeActivity(req, session, { type: 'CRM_USER_EDITED', description: `${username} account details updated` });
          return res.status(200).json({ live: true, accountId });
        }
        if (action === 'unlockUser') {
          await updateObject(req, 'CRM_User_Access', 'Account ID', accountId, { 'Failed Login Attempts': '0', 'Locked Until': '', 'Updated At': now() }, 'R');
          await writeActivity(req, session, { type: 'CRM_USER_UNLOCKED', description: `${record.Username} unlocked` });
          return res.status(200).json({ live: true, accountId });
        }
        const enabled = clean(body.enabled).toUpperCase() === 'TRUE';
        if (!enabled && clean(record.Role).toUpperCase() === 'ADMIN' && activeAdmins.length <= 1) throw new Error('At least one active Administrator must remain');
        await updateObject(req, 'CRM_User_Access', 'Account ID', accountId, { Status: enabled ? 'ACTIVE' : 'DISABLED', 'Login Enabled': enabled ? 'TRUE' : 'FALSE', 'Updated At': now() }, 'R');
        await writeActivity(req, session, { type: enabled ? 'CRM_USER_ENABLED' : 'CRM_USER_DISABLED', description: `${record.Username} ${enabled ? 'enabled' : 'disabled'}` });
        return res.status(200).json({ live: true, accountId, enabled });
      }
      if (['saveWhatsAppChannel', 'setWhatsAppChannelEnabled'].includes(action)) {
        if (session.role !== 'ADMIN') return res.status(403).json({ live: false, error: 'Administrator access is required.' });
        await ensureSheetHeaders(req, 'WhatsApp_Number_Master', ['Business Unit', 'Team ID']);
        const [channelRows, branchRows] = await readRanges(req, [channelRange, 'Branch_Master!A1:S1000']);
        const channels = rowsToObjects(channelRows), branches = rowsToObjects(branchRows);
        const channelId = clean(body.channelId).toUpperCase(), existing = channels.find(row => clean(row['Internal Channel ID']).toUpperCase() === channelId);
        if (!channelId || (!existing && !channelIdPattern.test(channelId))) throw new Error('Use one of the reserved East or West WhatsApp channel slots');
        if (action === 'setWhatsAppChannelEnabled') {
          if (!existing) throw new Error('WhatsApp channel was not found');
          const enabled = truth(body.enabled);
          if (enabled && (!clean(existing['Phone Number ID']) || !clean(existing['Display Number']))) throw new Error('Add the official number and Meta Phone Number ID before enabling this channel');
          if (enabled && !canonicalBusinessUnit(existing['Business Unit'])) throw new Error('Select Motor or Handphone before enabling this channel');
          if (enabled && !channelCredentials(existing).accessToken) throw new Error(`Add the protected ${channelEnvironmentPrefix(existing['Credential Key'] || channelId)}_ACCESS_TOKEN secret in Vercel before enabling this channel`);
          await updateObject(req, 'WhatsApp_Number_Master', 'Internal Channel ID', channelId, { Active: enabled ? 'TRUE' : 'FALSE', 'Inbound Enabled': enabled ? 'TRUE' : 'FALSE', 'Outbound Enabled': enabled ? 'TRUE' : 'FALSE', 'Data Status': enabled ? 'CONNECTED' : 'DISABLED', 'Updated By': session.username, 'Updated At': now() }, 'AC');
          await writeActivity(req, session, { type: enabled ? 'CRM_WHATSAPP_CHANNEL_ENABLED' : 'CRM_WHATSAPP_CHANNEL_DISABLED', description: `${channelId} ${enabled ? 'enabled for inbound and outbound routing' : 'disabled; bound conversations require approved transfer'}` });
          return res.status(200).json({ live: true, channelId, enabled });
        }
        const parsed = channelId.match(channelIdPattern), region = canonicalRegion(body.region || (parsed ? `${parsed[1]}_MALAYSIA` : channelRegion(existing, branches)));
        if (!['EAST_MALAYSIA', 'WEST_MALAYSIA'].includes(region)) throw new Error('Select East Malaysia or West Malaysia');
        if (parsed && region !== `${parsed[1]}_MALAYSIA`) throw new Error('The channel slot must match its East or West region');
        const slot = clean(body.slot || (parsed ? parsed[2] : existing?.['Channel Slot']));
        if (parsed && slot !== parsed[2]) throw new Error('The channel slot number cannot be changed');
        const branchId = clean(body.branchId), branch = branches.find(row => clean(row['Branch ID']) === branchId);
        if (branchId && (!branch || canonicalRegion(branch.Region) !== region)) throw new Error('The selected branch does not belong to this channel region');
        const phoneNumberId = clean(body.phoneNumberId), displayNumber = clean(body.displayNumber), wabaId = clean(body.wabaId);
        if (phoneNumberId && channels.some(row => clean(row['Internal Channel ID']).toUpperCase() !== channelId && clean(row['Phone Number ID']) === phoneNumberId)) throw new Error('This Meta Phone Number ID is already assigned to another channel');
        const active = truth(body.active), inboundEnabled = truth(body.inboundEnabled), outboundEnabled = truth(body.outboundEnabled);
        const businessUnit = canonicalBusinessUnit(body.businessUnit || existing?.['Business Unit']);
        if ((active || inboundEnabled || outboundEnabled) && !businessUnit) throw new Error('Select Motor or Handphone before activating this channel');
        if ((active || inboundEnabled || outboundEnabled) && (!phoneNumberId || !displayNumber)) throw new Error('Official display number and Meta Phone Number ID are required before activation');
        if ((inboundEnabled || outboundEnabled) && !active) throw new Error('Activate the channel before enabling inbound or outbound routing');
        const timestamp = now(), record = {
          'Channel Name': clean(body.name) || `${region === 'EAST_MALAYSIA' ? 'East' : 'West'} Malaysia Official ${slot}`,
          'Phone Number ID': phoneNumberId, 'Display Number': displayNumber, 'WABA ID': wabaId, 'Meta App ID': clean(body.appId),
          'Business Portfolio ID': clean(body.portfolioId), 'Branch ID': branchId, 'Campaign Source': clean(body.campaignSource) || 'ALL',
          'Default Team / SA': clean(body.defaultOwner), 'Inbound Enabled': inboundEnabled ? 'TRUE' : 'FALSE', 'Outbound Enabled': outboundEnabled ? 'TRUE' : 'FALSE',
          Active: active ? 'TRUE' : 'FALSE', 'Make Connection Alias': clean(body.connectionAlias), 'Webhook Route Key': clean(body.webhookRouteKey) || `JKM-WA-${region === 'EAST_MALAYSIA' ? 'EAST' : 'WEST'}-${slot}`,
          Environment: clean(body.environment).toUpperCase() === 'TEST' ? 'TEST' : 'PRODUCTION', 'Last Verified At': clean(body.lastVerified), 'Updated By': session.username,
          'Internal Notes': clean(body.notes), 'Data Status': active ? 'CONNECTED' : (phoneNumberId ? 'READY_FOR_CONNECTION' : 'PENDING_PHONE_SETUP'), Region: region,
          'Channel Slot': slot, 'Credential Key': channelEnvironmentPrefix(body.credentialKey || channelId), 'Updated At': timestamp,
          'Business Unit': businessUnit, 'Team ID': clean(body.teamId)
        };
        if (active && !channelCredentials({ ...(existing || {}), ...record }).accessToken) throw new Error(`Add the protected ${record['Credential Key']}_ACCESS_TOKEN secret in Vercel before activating this channel`);
        if (existing) await updateObject(req, 'WhatsApp_Number_Master', 'Internal Channel ID', channelId, record, 'AC');
        else await appendObject(req, 'WhatsApp_Number_Master', { 'Internal Channel ID': channelId, ...record });
        await writeActivity(req, session, { type: 'CRM_WHATSAPP_CHANNEL_UPDATED', description: `${channelId} configuration updated without exposing access tokens` });
        return res.status(existing ? 200 : 201).json({ live: true, channelId });
      }
      if (action === 'setAdvisorAccepting') {
        if (session.role !== 'ADMIN') return res.status(403).json({ live: false, error: 'Administrator access is required.' });
        const saId = clean(body.saId), accepting = truth(body.accepting);
        if (!saId) throw new Error('Sales advisor ID is required');
        const [rows] = await readRanges(req, ['SA_Master!A1:O1000']);
        const advisor = rowsToObjects(rows).find(row => clean(row['SA ID']) === saId && clean(row.Active).toUpperCase() === 'TRUE');
        if (!advisor) throw new Error('Active sales advisor was not found');
        await updateObject(req, 'SA_Master', 'SA ID', saId, { 'Accepting Leads': accepting ? 'TRUE' : 'FALSE' }, 'L');
        await writeActivity(req, session, { type: accepting ? 'CRM_ADVISOR_ASSIGNMENT_RESUMED' : 'CRM_ADVISOR_ASSIGNMENT_PAUSED', description: `${advisor['SA Name'] || saId} ${accepting ? 'resumed' : 'paused'} automatic lead assignments` });
        return res.status(200).json({ live: true, saId, accepting });
      }
      if (['saveCatalogItem', 'savePricingPromotion', 'setCatalogItemEnabled', 'setPricingEnabled', 'setPromotionEnabled'].includes(action)) {
        if (session.role !== 'ADMIN') return res.status(403).json({ live: false, error: 'Administrator access is required.' });
        const businessUnit = canonicalBusinessUnit(body.businessUnit) || 'MOTOR';
        const config = businessSheets(businessUnit);
        if (action === 'setCatalogItemEnabled') {
          const catalogId = clean(body.catalogId), enabled = truth(body.enabled);
          if (!catalogId) throw new Error('Catalog ID is required');
          const [rows] = await readRanges(req, [`${config.catalog}!A1:${config.catalogMax}1000`]);
          const record = rowsToObjects(rows).find(row => clean(row['Catalog ID']) === catalogId);
          if (!record) throw new Error('Catalog item was not found');
          await updateObject(req, config.catalog, 'Catalog ID', catalogId, { Active: enabled ? 'TRUE' : 'FALSE', 'Last Verified At': now().slice(0, 10) }, config.catalogMax);
          await writeActivity(req, session, { type: enabled ? 'CRM_CATALOG_RESTORED' : 'CRM_CATALOG_DISABLED', description: `${businessUnit} ${record.Brand} ${record.Model} catalog item ${enabled ? 'restored' : 'disabled'}` });
          return res.status(200).json({ live: true, catalogId, enabled, businessUnit });
        }
        if (action === 'setPricingEnabled' || action === 'setPromotionEnabled') {
          const pricingId = clean(body.pricingId), enabled = truth(body.enabled);
          if (!pricingId) throw new Error('Pricing ID is required');
          const [rows] = await readRanges(req, [`${config.pricing}!A1:${config.pricingMax}1000`]);
          const record = rowsToObjects(rows).find(row => clean(row['Pricing ID']) === pricingId);
          if (!record) throw new Error('Pricing record was not found');
          if (action === 'setPromotionEnabled' && enabled && (!clean(record['Promotion Name']) || clean(record['Promotion Deposit (RM)']) === '')) throw new Error('Add a promotion name and deposit before enabling it');
          const changes = action === 'setPricingEnabled' ? { Active: enabled ? 'TRUE' : 'FALSE' } : { 'Promotion Active': enabled ? 'TRUE' : 'FALSE' };
          await updateObject(req, config.pricing, 'Pricing ID', pricingId, { ...changes, 'Last Updated At': now(), 'Updated By': session.username }, config.pricingMax);
          const subject = action === 'setPricingEnabled' ? 'pricing' : 'promotion';
          await writeActivity(req, session, { type: `CRM_${subject.toUpperCase()}_${enabled ? 'ENABLED' : 'DISABLED'}`, description: `${businessUnit} ${record.Brand} ${record.Model} ${record['Price Zone']} ${subject} ${enabled ? 'enabled' : 'disabled'}` });
          return res.status(200).json({ live: true, pricingId, enabled, businessUnit });
        }
        if (action === 'saveCatalogItem') {
          const catalogId = clean(body.catalogId), brand = clean(body.brand), model = clean(body.model), variant = clean(body.variant) || 'Standard';
          const category = clean(body.category).toUpperCase(), fuel = clean(body.fuel).toUpperCase() || 'PETROL', operatingSystem = clean(body.operatingSystem).toUpperCase();
          const tier = clean(body.tier).toUpperCase(), stock = clean(body.stock).toUpperCase();
          if (!brand || !model || !category) throw new Error('Brand, model and category are required');
          if (businessUnit === 'MOTOR' && fuel !== 'PETROL') throw new Error('Fuel type must be PETROL for the current motor catalog');
          if (businessUnit === 'HANDPHONE' && !operatingSystem) throw new Error('Operating system is required for Handphone');
          if (!['PRIMARY', 'SECONDARY', 'ON_REQUEST'].includes(tier)) throw new Error('A valid popularity tier is required');
          if (!['CHECK_BRANCH', 'CHECK_WAREHOUSE', 'CONFIRMED_AVAILABLE', 'UNAVAILABLE'].includes(stock)) throw new Error('A valid stock check mode is required');
          const timestamp = now(), record = {
            Brand: brand, Model: model, Variant: variant, Category: category, ...(businessUnit === 'HANDPHONE' ? { 'Operating System': operatingSystem } : { 'Fuel Type': fuel }), 'Popularity Tier': tier,
            'Product Page URL': validUrl(body.productPageUrl, 'Product page URL'), 'Image URL': validUrl(body.imageUrl, 'Image URL'),
            'Image Caption (MS)': clean(body.imageCaption), 'Image Approved': truth(body.imageApproved) ? 'TRUE' : 'FALSE',
            Active: truth(body.active) ? 'TRUE' : 'FALSE', 'Stock Check Mode': stock, ...(businessUnit === 'HANDPHONE' ? { 'Region Availability': clean(body.regionAvailability || body.branchAvailability) } : { 'Branch Availability': clean(body.branchAvailability) }),
            'Warehouse Availability': clean(body.warehouseAvailability), 'Search Keywords': clean(body.searchKeywords), 'Last Verified At': timestamp.slice(0, 10)
          };
          if (catalogId) {
            await updateObject(req, config.catalog, 'Catalog ID', catalogId, record, config.catalogMax);
            await writeActivity(req, session, { type: 'CRM_CATALOG_UPDATED', description: `${businessUnit} ${brand} ${model} catalog item updated` });
            return res.status(200).json({ live: true, catalogId, businessUnit });
          }
          const [catalogRows] = await readRanges(req, [`${config.catalog}!A1:${config.catalogMax}1000`]);
          const existing = rowsToObjects(catalogRows);
          let newCatalogId = `${config.idPrefix}-${slug(brand)}-${slug(model)}`;
          if (existing.some(row => clean(row['Catalog ID']) === newCatalogId)) newCatalogId = `${newCatalogId}-${Date.now().toString(36).toUpperCase()}`;
          await appendObject(req, config.catalog, { 'Catalog ID': newCatalogId, ...record });
          await writeActivity(req, session, { type: 'CRM_CATALOG_CREATED', description: `${brand} ${model} added to the ${businessUnit.toLowerCase()} catalog` });
          return res.status(201).json({ live: true, catalogId: newCatalogId, businessUnit });
        }

        const pricingId = clean(body.pricingId), catalogId = clean(body.catalogId), zone = clean(body.zone).toUpperCase();
        const [catalogRows, branchRows] = await readRanges(req, [`${config.catalog}!A1:${config.catalogMax}1000`, 'Branch_Master!A1:S1000']);
        const catalogRecord = rowsToObjects(catalogRows).find(row => clean(row['Catalog ID']) === catalogId);
        if (!catalogRecord) throw new Error(`Select a valid ${businessUnit === 'HANDPHONE' ? 'Handphone' : 'Motor'} catalog item`);
        const allowedZones = new Set(['ALL_BRANCHES', 'WEST_MALAYSIA', 'EAST_MALAYSIA', 'SARAWAK', ...rowsToObjects(branchRows).filter(row => truth(row.Active)).map(row => clean(row['Branch ID']))]);
        if (!allowedZones.has(zone)) throw new Error('Select a valid price zone or branch');
        const quoteStatus = clean(body.quoteStatus).toUpperCase(), promotionStatus = clean(body.promotionStatus).toUpperCase();
        if (!['DRAFT', 'APPROVED', 'PAUSED'].includes(quoteStatus) || !['DRAFT', 'APPROVED', 'PAUSED'].includes(promotionStatus)) throw new Error('A valid approval status is required');
        const effectiveFrom = validDate(body.effectiveFrom, 'Effective from'), effectiveTo = validDate(body.effectiveTo, 'Effective to');
        const promotionStart = validDate(body.promotionStart, 'Promotion start'), promotionEnd = validDate(body.promotionEnd, 'Promotion end');
        if (effectiveFrom && effectiveTo && effectiveFrom > effectiveTo) throw new Error('Pricing end date cannot be earlier than its start date');
        if (promotionStart && promotionEnd && promotionStart > promotionEnd) throw new Error('Promotion end date cannot be earlier than its start date');
        const timestamp = now(), pricingRecord = {
          'Catalog ID': catalogId, Brand: catalogRecord.Brand, Model: catalogRecord.Model, Variant: catalogRecord.Variant || 'Standard', 'Price Zone': zone,
          ...(businessUnit === 'HANDPHONE' ? {
            'Product Price (RM)': amount(body.productPrice, 'Product price'), 'Deposit (RM)': amount(body.deposit, 'Deposit'),
            'Monthly 12 Months (RM)': amount(body.month12, '12-month instalment'), 'Monthly 24 Months (RM)': amount(body.month24, '24-month instalment'),
            'Monthly 36 Months (RM)': amount(body.month36, '36-month instalment'), 'Monthly 48 Months (RM)': amount(body.month48, '48-month instalment', true)
          } : {
            'Deposit (RM)': amount(body.deposit, 'Deposit'), 'Monthly 3 Years (RM)': amount(body.year3, '3-year instalment'),
            'Monthly 4 Years (RM)': amount(body.year4, '4-year instalment'), 'Monthly 5 Years (RM)': amount(body.year5, '5-year instalment')
          }),
          Active: truth(body.active) ? 'TRUE' : 'FALSE', 'Effective From': effectiveFrom, 'Effective To': effectiveTo,
          'Quote Approval Status': quoteStatus, 'Last Updated At': timestamp, 'Updated By': session.username, 'Internal Notes': clean(body.internalNotes),
          'Promotion Name': clean(body.promotionName), 'Promotion Deposit (RM)': amount(body.promotionDeposit, 'Promotion deposit', true),
          'Promotion Start': promotionStart, 'Promotion End': promotionEnd, 'Promotion Active': truth(body.promotionActive) ? 'TRUE' : 'FALSE',
          'Promotion Approval Status': promotionStatus, 'Promotion Notes': clean(body.promotionNotes)
        };
        if (truth(body.promotionActive) && (!clean(body.promotionName) || pricingRecord['Promotion Deposit (RM)'] === '')) throw new Error('An active promotion requires a name and promotion deposit');
        if (pricingId) {
          await updateObject(req, config.pricing, 'Pricing ID', pricingId, pricingRecord, config.pricingMax);
          await setPricingDerivedFormulas(req, pricingId, businessUnit);
          await writeActivity(req, session, { type: 'CRM_PRICING_PROMOTION_UPDATED', description: `${businessUnit} ${catalogRecord.Brand} ${catalogRecord.Model} ${zone} pricing and promotion updated` });
          return res.status(200).json({ live: true, pricingId, businessUnit });
        }
        const newPricingId = `PRICE-${config.idPrefix}-${slug(zone)}-${Date.now().toString(36).toUpperCase()}`;
        await appendObject(req, config.pricing, { 'Pricing ID': newPricingId, ...pricingRecord });
        await setPricingDerivedFormulas(req, newPricingId, businessUnit);
        await writeActivity(req, session, { type: 'CRM_PRICING_PROMOTION_CREATED', description: `${businessUnit} ${catalogRecord.Brand} ${catalogRecord.Model} ${zone} pricing and promotion created` });
        return res.status(201).json({ live: true, pricingId: newPricingId, businessUnit });
      }
      if (action === 'createApplication') {
        const customerName = clean(body.customerName), phone = clean(body.phone), catalogId = clean(body.catalogId);
        const businessUnit = clean(body.businessUnit || body.productCategory).toUpperCase() === 'HANDPHONE' ? 'HANDPHONE' : 'MOTOR';
        const productConfig = businessSheets(businessUnit);
        const requestedRegion = canonicalRegion(body.region);
        if (!customerName || !phone || !['EAST_MALAYSIA', 'WEST_MALAYSIA'].includes(requestedRegion)) throw new Error('Customer, phone, region and application type are required');
        const sessionBusinessAccess = canonicalBusinessAccess(session.businessAccess, session.role);
        if (session.role !== 'ADMIN' && sessionBusinessAccess !== 'BOTH' && sessionBusinessAccess !== businessUnit) return res.status(403).json({ live: false, error: `Your account cannot submit ${businessUnit.toLowerCase()} applications.` });
        if (session.role !== 'ADMIN' && session.region !== 'ALL' && requestedRegion !== session.region) return res.status(403).json({ live: false, error: 'This region is outside your access.' });
        if (!catalogId) throw new Error(businessUnit === 'MOTOR' ? 'Select an active motorcycle from the Motor Catalog' : 'Select an active handphone from the Handphone Catalog');
        const [catalogRows, existingLeadRows] = await readRanges(req, [`${productConfig.catalog}!A1:${productConfig.catalogMax}1000`, 'Leads!A1:AO1000']);
        const catalogRecord = rowsToObjects(catalogRows).find(row => clean(row['Catalog ID']) === catalogId && truth(row.Active));
        if (!catalogRecord) throw new Error(businessUnit === 'MOTOR' ? 'Select an active motorcycle from the Motor Catalog' : 'Select an active handphone from the Handphone Catalog');
        const brand = clean(catalogRecord.Brand), model = clean(catalogRecord.Model), variant = clean(catalogRecord.Variant) || 'Standard';
        const normalizedPhone = whatsappPhone(phone), existingCustomer = rowsToObjects(existingLeadRows).find(row => whatsappPhone(row['Phone Number']) === normalizedPhone);
        const customerId = clean(existingCustomer?.['Customer ID']) || makeId('CUS');
        const leadId = makeId('LEAD'), applicationId = makeId('APP'), timestamp = now();
        const assignedSaId = session.role === 'STAFF' ? session.saId : clean(body.saId);
        const assignedBranchId = ['STAFF', 'BRANCH_SUPERVISOR', 'BRANCH_MANAGER'].includes(session.role) ? session.branchId : clean(body.branchId);
        let teamId = clean(body.teamId);
        if (assignedSaId || assignedBranchId) {
          const [branchRows, saRows] = await readRanges(req, ['Branch_Master!A1:S1000', 'SA_Master!A1:O1000']);
          const branches = rowsToObjects(branchRows), advisors = rowsToObjects(saRows);
          const branch = branches.find(row => clean(row['Branch ID']) === assignedBranchId && clean(row.Active).toUpperCase() === 'TRUE');
          if (!branch || (session.role !== 'ADMIN' && canonicalRegion(branch.Region) !== requestedRegion)) throw new Error('The selected branch is outside the application region');
          if (['BRANCH_SUPERVISOR', 'BRANCH_MANAGER'].includes(session.role) && assignedBranchId !== clean(session.branchId)) throw new Error('Branch Supervisor may create cases in their own branch only');
          if (assignedSaId) {
            const advisor = advisors.find(row => clean(row['SA ID']) === assignedSaId && clean(row.Active).toUpperCase() === 'TRUE');
            if (!advisor || clean(advisor['Branch ID']) !== assignedBranchId || (session.role !== 'ADMIN' && canonicalRegion(advisor.Region) !== requestedRegion)) throw new Error('The selected sales advisor does not belong to this branch and region');
            if (!businessAllows(advisor['Business Access'] || 'BOTH', businessUnit)) throw new Error(`The selected sales advisor cannot receive ${businessUnit.toLowerCase()} applications`);
            teamId = clean(advisor['Team ID']) || teamId;
          }
          teamId = teamId || clean(branch?.['Team ID']);
        }
        await ensureSheetHeaders(req, 'Leads', ['Business Unit', 'Customer ID', 'Team ID']);
        await ensureSheetHeaders(req, 'Applications', ['Business Unit', 'Requested Product Price (RM)', 'Requested Deposit (RM)', 'Loan Tenure Months', 'Customer ID', 'Team ID', 'Origin WhatsApp Channel ID']);
        await appendObject(req, 'Leads', {
          'Lead ID': leadId, 'Created At': timestamp, 'Updated At': timestamp, 'Customer Name': customerName, 'Phone Number': phone,
          'Normalized Phone': normalizedPhone, Region: requestedRegion, 'Business Unit': businessUnit, 'Customer ID': customerId, 'Team ID': teamId, State: clean(body.state), 'City or Area': clean(body.city), 'Lead Status': 'NEW', 'Lead Source': 'CRM_MANUAL',
          'Assigned SA ID': assignedSaId, 'Selected Branch ID': assignedBranchId, 'Processing Mode': assignedSaId ? (session.role === 'STAFF' ? 'AI_EXCEPTION_STAFF_MANUAL' : 'MANUAL_ASSIGNED') : 'AI_MANAGED',
          'Next Follow Up At': clean(body.nextFollowUp), Notes: clean(body.notes), 'Created By': session.username
        });
        await appendObject(req, 'Applications', {
          'Application ID': applicationId, 'Lead ID': leadId, 'Created At': timestamp, 'Updated At': timestamp, 'Applicant Name': customerName,
          'Applicant IC Number': clean(body.applicantIcNumber), 'Home Address': clean(body.homeAddress), 'Phone Number': phone, Email: clean(body.email),
          'Employer Name': clean(body.employerName), 'Employer Address': clean(body.employerAddress), 'Employer Phone': clean(body.employerPhone),
          'Employment Duration Months': clean(body.employmentDurationMonths), 'Job Position': clean(body.jobPosition), 'Basic Salary': clean(body.basicSalary),
          'Salary Payment Method': clean(body.salaryPaymentMethod), 'Occupation Category': clean(body.occupationCategory),
          'Reference 1 Name': clean(body.reference1Name), 'Reference 1 Phone': clean(body.reference1Phone), 'Reference 1 Relationship': clean(body.reference1Relationship),
          'Reference 2 Name': clean(body.reference2Name), 'Reference 2 Phone': clean(body.reference2Phone), 'Reference 2 Relationship': clean(body.reference2Relationship),
          'Business Unit': businessUnit, 'Customer ID': customerId, 'Team ID': teamId, 'Product Category': businessUnit === 'HANDPHONE' ? 'HANDPHONE' : 'MOTORCYCLE', 'Product Brand': brand, 'Product Model': model, 'Product Variant': variant, 'Requested Product Price (RM)': businessUnit === 'HANDPHONE' ? customerAmount(body.productPrice) : '', 'Requested Deposit (RM)': businessUnit === 'HANDPHONE' ? customerAmount(body.requestedDeposit) : '', 'Loan Tenure Years': businessUnit === 'MOTOR' ? clean(body.tenure) : '', 'Loan Tenure Months': businessUnit === 'HANDPHONE' ? clean(body.tenureMonths || body.tenure) : '',
          'Bank Account Available': clean(body.bankAccountAvailable).toUpperCase(), 'Direct Debit Status': clean(body.directDebitStatus).toUpperCase(),
          'Agreement Status': clean(body.agreementStatus).toUpperCase(), 'Missing Application Fields': clean(body.missingApplicationFields),
          'Application Status': 'DRAFT', 'Current Stage': 'DOCUMENT_COLLECTION', 'Processing Mode': assignedSaId ? (session.role === 'STAFF' ? 'AI_EXCEPTION_STAFF_MANUAL' : 'MANUAL_ASSIGNED') : 'AI_MANAGED', 'Assigned Branch ID': assignedBranchId, 'Assigned SA ID': assignedSaId,
          'Document Status': 'PENDING', 'Minimum Documents Complete': 'FALSE', 'Missing Documents': clean(body.missingDocuments) || 'IC_FRONT, IC_BACK, INCOME_PROOF',
          'SA Review Required': 'FALSE', 'Next Follow Up At': clean(body.nextFollowUp), 'Created By': session.username, 'Updated By': session.username
        });
        await writeActivity(req, session, { leadId, applicationId, type: 'CRM_MANUAL_APPLICATION_CREATED', description: `${businessUnit === 'HANDPHONE' ? 'Handphone' : 'Motor'} application created for ${brand} ${model}` });
        return res.status(201).json({ live: true, leadId, applicationId, businessUnit });
      }
      if (action === 'uploadDocument') {
        const applicationId = clean(body.applicationId), leadId = clean(body.leadId), documentType = clean(body.documentType);
        if ((!applicationId && !leadId) || !documentType || !body.file?.data) throw new Error('Application or Lead, document type and file are required');
        const [leadRows, applicationRows, branchRows] = await readRanges(req, ['Leads!A1:AO1000', 'Applications!A1:BN1000', 'Branch_Master!A1:S1000']);
        const leadRecords = rowsToObjects(leadRows), applicationRecords = rowsToObjects(applicationRows);
        const scope = scopeData(session, leadRecords, applicationRecords, rowsToObjects(branchRows));
        if (session.role !== 'ADMIN' && !scope.leadIds.has(leadId) && !scope.applicationIds.has(applicationId)) return res.status(403).json({ live: false, error: 'This customer is outside your access.' });
        const applicationRecord = applicationRecords.find(row => clean(row['Application ID']) === applicationId), leadRecord = leadRecords.find(row => clean(row['Lead ID']) === (leadId || clean(applicationRecord?.['Lead ID'])));
        const uploaded = await uploadDocument(req, body.file, applicationId || leadId);
        const documentId = makeId('DOC'), timestamp = now();
        await appendObject(req, 'Document_Log', {
          'Document ID': documentId, 'Received At': timestamp, 'Updated At': timestamp, 'Lead ID': leadId, 'Application ID': applicationId,
          'Document Type': documentType, 'File Name': uploaded.name, 'Mime Type': clean(body.file.type), 'File URL': uploaded.webUrl || '',
          'Classification Status': 'AI_QUEUED', 'Quality Status': 'PENDING_AI', 'Verification Status': 'PENDING_AI', 'Duplicate Status': 'NOT_CHECKED',
          'Manual Review Required': 'FALSE', Remarks: clean(body.remarks), 'Uploaded By': session.username, 'Business Unit': rowBusinessUnit(applicationRecord || leadRecord || {}), 'Customer ID': clean(applicationRecord?.['Customer ID'] || leadRecord?.['Customer ID'])
        });
        await writeActivity(req, session, { leadId, applicationId, type: 'CRM_DOCUMENT_UPLOADED', description: `${documentType} uploaded for automatic AI validation` });
        return res.status(201).json({ live: true, documentId, fileName: uploaded.name });
      }
      if (action === 'updateApplication') {
        const applicationId = clean(body.applicationId);
        const stages = ['APPLICATION_DETAILS_PENDING', 'DOCUMENT_COLLECTION', 'DOCUMENT_VERIFICATION', 'CREDIT_ASSESSMENT', 'BRANCH_HANDOVER', 'RECOVERY_PENDING', 'COMPLETED'];
        const statuses = ['DRAFT', 'IN_PROGRESS', 'MANUAL_REVIEW', 'APPROVED', 'REJECTED', 'COMPLETED', 'CANCELLED'];
        const [leadRows, applicationRows, branchRows, saRows] = await readRanges(req, ['Leads!A1:AO1000', 'Applications!A1:BN1000', 'Branch_Master!A1:S1000', 'SA_Master!A1:O1000']);
        const leads = rowsToObjects(leadRows), applications = rowsToObjects(applicationRows), branches = rowsToObjects(branchRows), salesAdvisors = rowsToObjects(saRows);
        const scope = scopeData(session, leads, applications, branches);
        const record = applications.find(row => clean(row['Application ID']) === applicationId);
        if (!record || !scope.applicationIds.has(applicationId)) return res.status(403).json({ live: false, error: 'This application is outside your access.' });
        const stage = session.role === 'STAFF' ? clean(record['Current Stage']).toUpperCase() : clean(body.stage).toUpperCase();
        const status = session.role === 'STAFF' ? clean(record['Application Status']).toUpperCase() : clean(body.status).toUpperCase();
        const saId = session.role === 'STAFF' ? session.saId : clean(body.saId);
        const branchId = session.role === 'STAFF' ? session.branchId : clean(body.branchId);
        if (!stages.includes(stage) || !statuses.includes(status)) throw new Error('A valid stage and status are required');
        const branchRegion = Object.fromEntries(branches.map(row => [clean(row['Branch ID']), canonicalRegion(row.Region)]));
        if (branchId && (!branchRegion[branchId] || (session.role !== 'ADMIN' && branchRegion[branchId] !== session.region))) throw new Error('The selected branch is outside your access');
        if (['BRANCH_SUPERVISOR', 'BRANCH_MANAGER'].includes(session.role) && branchId !== clean(session.branchId)) throw new Error('Branch Supervisor may assign cases inside their own branch only');
        if (saId) {
          const advisor = salesAdvisors.find(row => clean(row['SA ID']) === saId && clean(row.Active).toUpperCase() === 'TRUE');
          if (!advisor || (session.role !== 'ADMIN' && canonicalRegion(advisor.Region) !== session.region)) throw new Error('The selected sales advisor is outside your access');
          if (!businessAllows(advisor['Business Access'] || 'BOTH', rowBusinessUnit(record))) throw new Error('The selected sales advisor does not have access to this business unit');
          if (['BRANCH_SUPERVISOR', 'BRANCH_MANAGER'].includes(session.role) && clean(advisor['Branch ID']) !== clean(session.branchId)) throw new Error('The selected sales advisor is outside your branch');
          if (branchId && clean(advisor['Branch ID']) !== branchId) throw new Error('The selected sales advisor does not belong to the selected branch');
        }
        await updateObject(req, 'Applications', 'Application ID', applicationId, {
          'Updated At': now(), 'Current Stage': stage, 'Application Status': status, 'Assigned SA ID': saId,
          'Assigned Branch ID': branchId, 'Next Follow Up At': clean(body.nextFollowUp), 'Missing Documents': clean(body.missingDocuments),
          'SA Review Required': session.role === 'STAFF' ? clean(record['SA Review Required']) : clean(body.reviewRequired).toUpperCase() === 'TRUE' ? 'TRUE' : 'FALSE',
          'Handover Reason': session.role === 'STAFF' ? clean(record['Handover Reason']) : clean(body.handoverReason), 'Updated By': session.username
        });
        if (record['Lead ID']) await updateObject(req, 'Leads', 'Lead ID', record['Lead ID'], { 'Assigned SA ID': saId, 'Selected Branch ID': branchId, 'Next Follow Up At': clean(body.nextFollowUp), 'Updated At': now() }, 'AF');
        await writeActivity(req, session, { leadId: record['Lead ID'], applicationId, type: 'CRM_APPLICATION_UPDATED', description: `Application updated to ${stage} / ${status}` });
        return res.status(200).json({ live: true, applicationId });
      }
      if (action === 'reviewDocument') {
        if (!managerRoles.has(session.role)) return res.status(403).json({ live: false, error: 'Manager access is required to resolve an AI document exception.' });
        const documentId = clean(body.documentId), verification = clean(body.verification).toUpperCase(), quality = clean(body.quality).toUpperCase();
        if (!['PENDING', 'VERIFIED', 'REJECTED'].includes(verification) || !['PENDING_REVIEW', 'GOOD', 'POOR'].includes(quality)) throw new Error('A valid review decision is required');
        const [leadRows, applicationRows, branchRows, documentRows] = await readRanges(req, ['Leads!A1:AO1000', 'Applications!A1:BN1000', 'Branch_Master!A1:S1000', 'Document_Log!A1:AA1500']);
        const scope = scopeData(session, rowsToObjects(leadRows), rowsToObjects(applicationRows), rowsToObjects(branchRows));
        const document = rowsToObjects(documentRows).find(row => clean(row['Document ID']) === documentId);
        if (!document || (!scope.applicationIds.has(document['Application ID']) && !scope.leadIds.has(document['Lead ID']))) return res.status(403).json({ live: false, error: 'This document is outside your access.' });
        await updateObject(req, 'Document_Log', 'Document ID', documentId, {
          'Updated At': now(), 'Quality Status': quality, 'Verification Status': verification,
          'Manual Review Required': verification === 'PENDING' ? 'TRUE' : 'FALSE', Remarks: clean(body.remarks), 'Reviewed By': session.username, 'Reviewed At': now()
        }, 'Y');
        await writeActivity(req, session, { leadId: document['Lead ID'], applicationId: document['Application ID'], type: 'CRM_AI_DOCUMENT_EXCEPTION_RESOLVED', description: `${document['Document Type'] || 'Document'} exception marked ${verification}` });
        return res.status(200).json({ live: true, documentId });
      }
      if (action === 'updateApplicantProfile') {
        const applicationId = clean(body.applicationId), catalogId = clean(body.catalogId);
        const [leadRows, applicationRows, branchRows] = await readRanges(req, ['Leads!A1:AO1000', 'Applications!A1:BN1000', 'Branch_Master!A1:S1000']);
        const leads = rowsToObjects(leadRows), applications = rowsToObjects(applicationRows), branches = rowsToObjects(branchRows);
        const scope = scopeData(session, leads, applications, branches);
        const record = applications.find(row => clean(row['Application ID']) === applicationId);
        if (!record || !scope.applicationIds.has(applicationId)) return res.status(403).json({ live: false, error: 'This application is outside your access.' });
        const businessUnit = rowBusinessUnit(record);
        const productConfig = businessSheets(businessUnit);
        const [catalogRows] = await readRanges(req, [`${productConfig.catalog}!A1:${productConfig.catalogMax}1000`]);
        const catalogRecord = rowsToObjects(catalogRows).find(row => clean(row['Catalog ID']) === catalogId && truth(row.Active));
        if (!catalogRecord) throw new Error(businessUnit === 'MOTOR' ? 'Select an active motorcycle from the Motor Catalog' : 'Select an active handphone from the Handphone Catalog');
        const brand = clean(catalogRecord.Brand), model = clean(catalogRecord.Model), variant = clean(catalogRecord.Variant) || 'Standard';
        const changes = {
          'Updated At': now(), 'Applicant Name': clean(body.applicantName), 'Home Address': clean(body.homeAddress),
          'Phone Number': clean(body.phone), Email: clean(body.email), 'Employer Name': clean(body.employerName),
          'Employer Address': clean(body.employerAddress), 'Employer Phone': clean(body.employerPhone),
          'Employment Duration Months': clean(body.employmentDurationMonths), 'Job Position': clean(body.jobPosition),
          'Basic Salary': clean(body.basicSalary), 'Salary Payment Method': clean(body.salaryPaymentMethod),
          'Occupation Category': clean(body.occupationCategory), 'Reference 1 Name': clean(body.reference1Name),
          'Reference 1 Phone': clean(body.reference1Phone), 'Reference 1 Relationship': clean(body.reference1Relationship),
          'Reference 2 Name': clean(body.reference2Name), 'Reference 2 Phone': clean(body.reference2Phone),
          'Reference 2 Relationship': clean(body.reference2Relationship), 'Business Unit': businessUnit, 'Product Category': businessUnit === 'HANDPHONE' ? 'HANDPHONE' : 'MOTORCYCLE',
          'Product Brand': brand, 'Product Model': model, 'Product Variant': variant, 'Requested Product Price (RM)': businessUnit === 'HANDPHONE' ? customerAmount(body.productPrice) : '', 'Requested Deposit (RM)': businessUnit === 'HANDPHONE' ? customerAmount(body.requestedDeposit) : '', 'Loan Tenure Years': businessUnit === 'MOTOR' ? clean(body.loanTenureYears) : '', 'Loan Tenure Months': businessUnit === 'HANDPHONE' ? clean(body.loanTenureMonths) : '',
          'Bank Account Available': clean(body.bankAccountAvailable).toUpperCase(), 'Direct Debit Status': clean(body.directDebitStatus).toUpperCase(),
          'Agreement Status': clean(body.agreementStatus).toUpperCase(), 'Missing Application Fields': clean(body.missingApplicationFields),
          'Updated By': session.username
        };
        if (clean(body.applicantIcNumber)) changes['Applicant IC Number'] = clean(body.applicantIcNumber);
        if (!changes['Applicant Name'] || !changes['Phone Number'] || !changes['Product Brand'] || !changes['Product Model']) throw new Error('Applicant name, phone, product brand and model are required');
        if (changes['Loan Tenure Years'] && !['3', '4', '5'].includes(changes['Loan Tenure Years'])) throw new Error('Motor loan tenure must be 3, 4 or 5 years');
        if (changes['Loan Tenure Months'] && !['12', '24', '36', '48'].includes(changes['Loan Tenure Months'])) throw new Error('Handphone loan tenure must be 12, 24, 36 or 48 months');
        if (changes['Email'] && !/^\S+@\S+\.\S+$/.test(changes['Email'])) throw new Error('Email format is invalid');
        await ensureSheetHeaders(req, 'Applications', ['Business Unit', 'Requested Product Price (RM)', 'Requested Deposit (RM)', 'Loan Tenure Months', 'Customer ID', 'Team ID', 'Origin WhatsApp Channel ID']);
        await updateObject(req, 'Applications', 'Application ID', applicationId, changes, 'BN');
        await writeActivity(req, session, { leadId: record['Lead ID'], applicationId, type: 'CRM_APPLICANT_PROFILE_UPDATED', description: 'Applicant 360 profile updated by authorized staff' });
        return res.status(200).json({ live: true, applicationId });
      }
      if (['sendCustomerMessage', 'recordManualReply', 'requestHumanHandover', 'assignHandover', 'updateHandover', 'markOutboxSent'].includes(action)) {
        const [leadRows, applicationRows, branchRows, inboxRows, outboxRows, saRows, channelRows] = await readRanges(req, ['Leads!A1:AO1000', 'Applications!A1:BN1000', 'Branch_Master!A1:S1000', 'Customer_Inbox!A1:AC1200', 'Message_Outbox!A1:AC1500', 'SA_Master!A1:O1000', channelRange]);
        const leads = rowsToObjects(leadRows), applications = rowsToObjects(applicationRows), branches = rowsToObjects(branchRows), inboxRecords = rowsToObjects(inboxRows), outboxRecords = rowsToObjects(outboxRows), advisors = rowsToObjects(saRows), channels = rowsToObjects(channelRows);
        const scope = scopeData(session, leads, applications, branches);
        const leadId = clean(body.leadId), applicationId = clean(body.applicationId);
        const permitted = (leadId && scope.leadIds.has(leadId)) || (applicationId && scope.applicationIds.has(applicationId));

        if (action === 'sendCustomerMessage') {
          if (!permitted) return res.status(403).json({ live: false, error: 'This customer is outside your access.' });
          const unassignedHandover = inboxRecords.some(row => humanStatuses.has(clean(row['Process Status']).toUpperCase()) && clean(row['Process Status']).toUpperCase() !== 'ASSIGNED_TO_STAFF' && ((leadId && clean(row['Lead ID']) === leadId) || (applicationId && clean(row['Application ID']) === applicationId)));
          if (session.role === 'STAFF' && unassignedHandover) return res.status(403).json({ live: false, error: 'This human handover is controlled by a Manager and has not been assigned to Staff.' });
          const phone = whatsappPhone(body.phone), message = clean(body.message);
          if (!phone || message.length < 1 || message.length > 4000) throw new Error('A valid phone number and message are required');
          const messageType = clean(body.messageType).toUpperCase() === 'TEMPLATE' ? 'TEMPLATE' : 'TEXT', templateName = clean(body.templateName), language = clean(body.language) || 'en_US';
          if (messageType === 'TEMPLATE' && !templateName) throw new Error('An approved Meta template name is required');
          const outboxId = makeId('OUT'), timestamp = now();
          const cloudMode = clean(process.env.WHATSAPP_SEND_MODE).toUpperCase() === 'CLOUD';
          const resolved = resolveCustomerChannel({ leadId, applicationId, replyToMessageId: body.replyToMessageId, preferredChannelId: body.channelId, leads, applications, inbox: inboxRecords, outbox: outboxRecords, channels, branches });
          const route = resolved.channel;
          const targetApplication = applications.find(row => clean(row['Application ID']) === applicationId);
          const targetLead = leads.find(row => clean(row['Lead ID']) === (leadId || clean(targetApplication?.['Lead ID'])));
          const messageBusinessUnit = rowBusinessUnit(targetApplication || targetLead || {}), customerId = clean(targetApplication?.['Customer ID'] || targetLead?.['Customer ID']);
          if (cloudMode && resolved.unregisteredNumberId) throw new Error(`The customer's original WhatsApp number (${resolved.unregisteredNumberId}) is not registered in CRM. Admin must map it before replying.`);
          if (cloudMode && route && (!truth(route.Active) || !truth(route['Outbound Enabled']))) throw new Error(`The customer's bound WhatsApp channel ${route['Internal Channel ID']} is disabled. Admin approval is required before transferring the conversation.`);
          let sendStatus = 'MANUAL_PENDING', providerMessageId = '', errorMessage = '';
          if (cloudMode) {
            const { accessToken, phoneNumberId, version } = channelCredentials(route);
            if (!accessToken || !phoneNumberId) throw new Error('WhatsApp Cloud credentials are not configured');
            const cloudPayload = messageType === 'TEMPLATE' ? { messaging_product: 'whatsapp', to: phone, type: 'template', template: { name: templateName, language: { code: language } } } : { messaging_product: 'whatsapp', recipient_type: 'individual', to: phone, type: 'text', text: { preview_url: false, body: message } };
            const response = await fetch(`https://graph.facebook.com/${version}/${phoneNumberId}/messages`, { method: 'POST', headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' }, body: JSON.stringify(cloudPayload) });
            const result = await response.json().catch(() => ({}));
            if (response.ok) { sendStatus = 'QUEUED'; providerMessageId = result.messages?.[0]?.id || ''; } else { sendStatus = 'FAILED'; errorMessage = result.error?.message || `Meta API error ${response.status}`; }
          }
          await appendObject(req, 'Message_Outbox', { 'Outbox ID': outboxId, 'Created At': timestamp, 'Lead ID': leadId, 'Application ID': applicationId, 'Phone Number': phone, 'Message Type': messageType, 'Message Text': message, 'Template Name': templateName, Language: language, 'Send Status': sendStatus, 'Attempt Count': cloudMode ? '1' : '0', 'Sent At': cloudMode && sendStatus !== 'FAILED' ? timestamp : '', 'Provider Message ID': providerMessageId, 'Error Message': errorMessage, 'WhatsApp Number ID': clean(route?.['Phone Number ID']) || clean(process.env.WHATSAPP_PHONE_NUMBER_ID), 'WABA ID': route?.['WABA ID'] || '', 'Internal Channel ID': route?.['Internal Channel ID'] || '', 'Make Connection Alias': route?.['Make Connection Alias'] || '', 'Reply To Message ID': clean(body.replyToMessageId), 'Send Routing Status': `${cloudMode ? 'CLOUD_API' : 'WHATSAPP_BUSINESS_MANUAL'}:${resolved.source}`, 'Business Unit': messageBusinessUnit, 'Customer ID': customerId, 'Team ID': clean(targetApplication?.['Team ID'] || targetLead?.['Team ID'] || route?.['Team ID']) });
          if (route?.['Internal Channel ID']) await updateObject(req, 'WhatsApp_Number_Master', 'Internal Channel ID', route['Internal Channel ID'], { 'Last Outbound At': timestamp, 'Updated At': timestamp }, 'AC');
          await writeActivity(req, session, { leadId, applicationId, type: cloudMode ? 'CRM_WHATSAPP_MESSAGE_QUEUED' : 'CRM_MANUAL_WHATSAPP_OPENED', description: `${session.username} prepared a customer reply through ${route?.['Channel Name'] || 'the legacy default WhatsApp channel'}` });
          return res.status(sendStatus === 'FAILED' ? 502 : 201).json({ live: sendStatus !== 'FAILED', outboxId, mode: cloudMode ? 'CLOUD' : 'MANUAL', status: sendStatus, channelId: route?.['Internal Channel ID'] || '', channelName: route?.['Channel Name'] || '', displayNumber: route?.['Display Number'] || '', routingSource: resolved.source, whatsappUrl: cloudMode ? '' : `https://wa.me/${phone}?text=${encodeURIComponent(message)}`, error: errorMessage || undefined });
        }

        if (action === 'recordManualReply' || action === 'requestHumanHandover') {
          if (!permitted) return res.status(403).json({ live: false, error: 'This customer is outside your access.' });
          const phone = whatsappPhone(body.phone), message = clean(body.message || body.reason);
          if (!phone || !message) throw new Error('Phone number and message are required');
          const status = action === 'requestHumanHandover' || clean(body.requiresManager).toUpperCase() === 'TRUE' ? 'HUMAN_HANDOVER_REQUIRED' : 'MANUAL_RECORDED';
          const messageId = makeId('MSG'), timestamp = now();
          const resolved = resolveCustomerChannel({ leadId, applicationId, preferredChannelId: body.channelId, leads, applications, inbox: inboxRecords, outbox: outboxRecords, channels, branches });
          const route = resolved.channel;
          const targetApplication = applications.find(row => clean(row['Application ID']) === applicationId), targetLead = leads.find(row => clean(row['Lead ID']) === (leadId || clean(targetApplication?.['Lead ID'])));
          await appendObject(req, 'Customer_Inbox', { 'Received At': timestamp, 'Phone Number': phone, 'Customer Message': message, 'Message ID': messageId, Channel: 'WHATSAPP_BUSINESS', Source: 'CRM_MANUAL', 'Lead ID': leadId, 'Application ID': applicationId, 'Message Type': action === 'requestHumanHandover' ? 'HANDOVER_REQUEST' : 'TEXT', 'Process Status': status, 'AI Processed': 'FALSE', 'WhatsApp Number ID': route?.['Phone Number ID'] || '', 'WhatsApp Display Number': route?.['Display Number'] || '', 'WABA ID': route?.['WABA ID'] || '', 'Conversation Key': `${route?.['Internal Channel ID'] || 'MANUAL'}:${phone}`, 'Webhook Source': 'CRM', 'Number Routing Status': route ? 'MANUAL_MATCHED' : 'MANUAL_TEST', 'Internal Channel ID': route?.['Internal Channel ID'] || '', 'Business Unit': rowBusinessUnit(targetApplication || targetLead || {}), 'Customer ID': clean(targetApplication?.['Customer ID'] || targetLead?.['Customer ID']), 'Team ID': clean(targetApplication?.['Team ID'] || targetLead?.['Team ID'] || route?.['Team ID']) });
          await writeActivity(req, session, { leadId, applicationId, type: status === 'HUMAN_HANDOVER_REQUIRED' ? 'CRM_HUMAN_HANDOVER_REQUESTED' : 'CRM_CUSTOMER_REPLY_RECORDED', description: message.slice(0, 240) });
          return res.status(201).json({ live: true, messageId, status });
        }

        if (action === 'markOutboxSent') {
          const record = outboxRecords.find(row => clean(row['Outbox ID']) === clean(body.outboxId));
          if (!record || !((record['Lead ID'] && scope.leadIds.has(record['Lead ID'])) || (record['Application ID'] && scope.applicationIds.has(record['Application ID'])))) return res.status(403).json({ live: false, error: 'This message is outside your access.' });
          await updateObject(req, 'Message_Outbox', 'Outbox ID', record['Outbox ID'], { 'Send Status': 'MANUAL_SENT', 'Sent At': now(), 'Attempt Count': String(Number(record['Attempt Count'] || 0) + 1), 'Send Routing Status': 'WHATSAPP_BUSINESS_MANUAL' }, 'Z');
          await writeActivity(req, session, { leadId: record['Lead ID'], applicationId: record['Application ID'], type: 'CRM_MANUAL_WHATSAPP_SENT', description: `${session.username} confirmed manual WhatsApp delivery` });
          return res.status(200).json({ live: true, outboxId: record['Outbox ID'] });
        }

        const messageId = clean(body.messageId), inboxRecord = inboxRecords.find(row => clean(row['Message ID']) === messageId);
        if (!inboxRecord || !((inboxRecord['Lead ID'] && scope.leadIds.has(inboxRecord['Lead ID'])) || (inboxRecord['Application ID'] && scope.applicationIds.has(inboxRecord['Application ID'])))) return res.status(403).json({ live: false, error: 'This handover is outside your access.' });
        if (action === 'assignHandover') {
          if (!managerRoles.has(session.role)) return res.status(403).json({ live: false, error: 'Manager access is required to assign a human handover.' });
          const saId = clean(body.saId), advisor = advisors.find(row => clean(row['SA ID']) === saId && clean(row.Active).toUpperCase() === 'TRUE');
          if (!advisor) throw new Error('Select an active sales advisor');
          if (['BRANCH_SUPERVISOR', 'BRANCH_MANAGER'].includes(session.role) && clean(advisor['Branch ID']) !== clean(session.branchId)) throw new Error('This sales advisor is outside your branch');
          if (session.role === 'REGION_MANAGER' && canonicalRegion(advisor.Region) !== session.region) throw new Error('This sales advisor is outside your region');
          const handoverApplication = applications.find(row => clean(row['Application ID']) === clean(inboxRecord['Application ID']));
          const handoverLead = leads.find(row => clean(row['Lead ID']) === clean(inboxRecord['Lead ID']));
          const handoverBusiness = rowBusinessUnit(handoverApplication || handoverLead || {});
          if (!businessAllows(advisor['Business Access'] || 'BOTH', handoverBusiness)) throw new Error(`This sales advisor cannot receive ${handoverBusiness.toLowerCase()} handovers`);
          const assignedBranchId = clean(advisor['Branch ID']);
          if (inboxRecord['Lead ID']) await updateObject(req, 'Leads', 'Lead ID', inboxRecord['Lead ID'], { 'Assigned SA ID': saId, 'Selected Branch ID': assignedBranchId, 'Updated At': now() }, 'AF');
          if (inboxRecord['Application ID']) await updateObject(req, 'Applications', 'Application ID', inboxRecord['Application ID'], { 'Assigned SA ID': saId, 'Assigned Branch ID': assignedBranchId, 'Assigned Supervisor ID': session.username, 'Supervisor Assignment Status': 'ASSIGNED', 'Updated At': now() }, 'BK');
          await updateObject(req, 'Customer_Inbox', 'Message ID', messageId, { 'Process Status': 'ASSIGNED_TO_STAFF', 'AI Processed': 'TRUE', 'AI Processed At': now() }, 'Z');
          await writeActivity(req, session, { leadId: inboxRecord['Lead ID'], applicationId: inboxRecord['Application ID'], type: 'CRM_HANDOVER_ASSIGNED', description: `Human handover assigned to ${saId}` });
          return res.status(200).json({ live: true, messageId, saId });
        }

        const status = clean(body.status).toUpperCase();
        if (!['MANAGER_IN_PROGRESS', 'RESOLVED'].includes(status)) throw new Error('A valid handover status is required');
        if (status === 'MANAGER_IN_PROGRESS' && !managerRoles.has(session.role)) return res.status(403).json({ live: false, error: 'Manager access is required to take over this conversation.' });
        if (session.role === 'STAFF' && clean(inboxRecord['Process Status']).toUpperCase() !== 'ASSIGNED_TO_STAFF') return res.status(403).json({ live: false, error: 'This handover has not been assigned to you.' });
        await updateObject(req, 'Customer_Inbox', 'Message ID', messageId, { 'Process Status': status, 'AI Processed': 'TRUE', 'AI Processed At': now() }, 'Z');
        await writeActivity(req, session, { leadId: inboxRecord['Lead ID'], applicationId: inboxRecord['Application ID'], type: status === 'RESOLVED' ? 'CRM_HANDOVER_RESOLVED' : 'CRM_MANAGER_TAKEOVER', description: `${session.username} updated human handover to ${status}` });
        return res.status(200).json({ live: true, messageId, status });
      }
      return res.status(400).json({ live: false, error: 'Unsupported CRM action.' });
    } catch (error) {
      console.error(error);
      return res.status(400).json({ live: false, error: error.message || 'Unable to save CRM data.' });
    }
  }
  if (req.method !== 'GET') return res.status(405).json({ live: false, error: 'Method not allowed.' });
  const resource = req.query.resource || 'dashboard';
  if (resource === 'session') return res.status(200).json({ live: true, user: { name: session.name, username: session.username, role: canonicalRole(session.role), region: session.region, businessAccess: canonicalBusinessAccess(session.businessAccess, session.role), saId: session.saId || '', branchId: session.branchId || '', mustChangePassword: !!session.mustChangePassword, whatsappMode: clean(process.env.WHATSAPP_SEND_MODE).toUpperCase() === 'CLOUD' ? 'CLOUD' : 'MANUAL' } });
  if (resource === 'integrations') return res.status(200).json({ live: true, records: publicIntegrationRecords(process.env), readiness: integrationReadiness(process.env), reportingFields: FUTURE_REPORTING_FIELDS });
  try {
    if (resource === 'channels') {
      const [channelRows, branchRows] = await readRanges(req, [channelRange, 'Branch_Master!A1:S1000']);
      const branches = rowsToObjects(branchRows);
      const records = rowsToObjects(channelRows).filter(row => row['Internal Channel ID']).map(row => publicChannel(row, branches)).filter(row => {
        if (session.role === 'ADMIN') return true;
        if (!businessAllows(session.businessAccess, row.businessUnit)) return false;
        if (session.role === 'REGION_MANAGER') return row.region === session.region;
        if (['BRANCH_SUPERVISOR', 'BRANCH_MANAGER'].includes(session.role)) return row.region === session.region && (!row.branchId || row.branchId === session.branchId);
        if (session.role === 'BUSINESS_MANAGER') return session.region === 'ALL' || row.region === session.region;
        return false;
      });
      return res.status(200).json({ live: true, records, capacity: { EAST_MALAYSIA: 5, WEST_MALAYSIA: 5 }, dimensions: ['Region', 'Business Unit', 'Team ID', 'Official Number'], secretsExposed: false });
    }
    if (resource === 'users') {
      if (session.role !== 'ADMIN') return res.status(403).json({ live: false, error: 'Administrator access is required.' });
      return res.status(200).json({ live: true, records: (await accountRows(req)).filter(row => row.Username).map(publicAccount) });
    }
    const [leadRows, applicationRows, branchRows] = await readRanges(req, ['Leads!A1:AO1000', 'Applications!A1:BN1000', 'Branch_Master!A1:S1000']);
    const allLeads = rowsToObjects(leadRows), allApplications = rowsToObjects(applicationRows), branches = rowsToObjects(branchRows);
    const scope = scopeData(session, allLeads, allApplications, branches);
    const businessLeads = scope.leads.filter(row => !isSyntheticLeadRow(row));
    const businessApplications = scope.applications.filter(row => !isSyntheticApplicationRow(row));
    const businessLeadIds = new Set(businessLeads.map(row => row['Lead ID']));
    const businessApplicationIds = new Set(businessApplications.map(row => row['Application ID']));

    if (resource === 'qa') {
      if (session.role !== 'ADMIN') return res.status(403).json({ live: false, error: 'Administrator access is required.' });
      const records = [
        ...scope.leads.filter(isSyntheticLeadRow).map(row => ({ type: 'Lead', name: row['Customer Name'] || 'Synthetic lead', id: row['Lead ID'] })),
        ...scope.applications.filter(isSyntheticApplicationRow).map(row => ({ type: 'Application', name: row['Applicant Name'] || 'Synthetic application', id: row['Application ID'] }))
      ];
      return res.status(200).json({ live: true, records });
    }

    if (resource === 'leads') {
      const latest = latestApplicationByLead(businessApplications);
      const records = [...businessLeads].reverse().map(row => {
        const app = latest.get(row['Lead ID']) || {};
        return { id: row['Lead ID'], name: row['Customer Name'] || app['Applicant Name'] || 'Unknown customer', phone: row['Phone Number'], region: row.Region, businessUnit: rowBusinessUnit(Object.keys(app).length ? app : row), synthetic: isSyntheticLeadRow(row) || isSyntheticApplicationRow(app),
          source: row['Lead Source'] || row['Acquisition Source'] || row.Source || row['Enquiry Source'] || 'Not recorded',
          model: [app['Product Brand'], app['Product Model'], app['Product Variant'] || app.Variant].filter(Boolean).join(' ') || row['Enquiry Type'] || `${rowBusinessUnit(row) === 'HANDPHONE' ? 'Handphone' : 'Motor'} enquiry`,
          productBrand: app['Product Brand'], productModel: app['Product Model'], productVariant: app['Product Variant'] || app.Variant,
          tenure: rowBusinessUnit(app) === 'HANDPHONE' ? app['Loan Tenure Months'] : app['Loan Tenure Years'], tenureUnit: rowBusinessUnit(app) === 'HANDPHONE' ? 'MONTHS' : 'YEARS', status: row['Lead Status'], applicationStatus: app['Application Status'], applicationId: app['Application ID'], customerId: row['Customer ID'] || app['Customer ID'], teamId: row['Team ID'] || app['Team ID'],
          sa: row['Assigned SA ID'] || app['Assigned SA ID'] || 'Unassigned', branch: row['Selected Branch ID'] || app['Assigned Branch ID'] || '', state: row.State, city: row['City or Area'],
          notes: row.Notes, channelId: row['Last Inbound WhatsApp Channel ID'] || row['Primary WhatsApp Channel ID'], primaryChannelId: row['Primary WhatsApp Channel ID'], lastInboundNumberId: row['Last Inbound WhatsApp Number ID'], lastInboundAt: row['Last Inbound At'], nextFollowUp: row['Next Follow Up At'] || app['Next Follow Up At'], created: row['Created At'], time: row['Updated At'] || row['Created At'] };
      });
      return res.status(200).json({ live: true, records });
    }

    if (resource === 'applications') {
      const [documentRows, motorPricingRows, handphonePricingRows] = await readRanges(req, ['Document_Log!A1:AA1500', 'Motor_Loan_Pricing!A1:Z1000', 'Handphone_Loan_Pricing!A1:AB1000']);
      const documents = rowsToObjects(documentRows).filter(row => scope.applicationIds.has(row['Application ID']) || scope.leadIds.has(row['Lead ID']));
      const motorPricing = rowsToObjects(motorPricingRows).filter(row => truth(row.Active) && clean(row['Quote Approval Status']).toUpperCase() === 'APPROVED');
      const handphonePricing = rowsToObjects(handphonePricingRows).filter(row => truth(row.Active) && clean(row['Quote Approval Status']).toUpperCase() === 'APPROVED');
      const docsByApplication = new Map(); documents.forEach(row => { const key = row['Application ID']; if (key) docsByApplication.set(key, [...(docsByApplication.get(key) || []), row]); });
      const leadRegion = Object.fromEntries(scope.leads.map(row => [row['Lead ID'], canonicalRegion(row.Region)]));
      const records = [...businessApplications].reverse().map(row => {
        const docs = documentSummary(docsByApplication.get(row['Application ID']) || []);
        const zone = leadRegion[row['Lead ID']];
        const businessUnit = rowBusinessUnit(row);
        const pricing = businessUnit === 'HANDPHONE' ? handphonePricing : motorPricing;
        const quote = pricing.find(p => clean(p.Brand).toUpperCase() === clean(row['Product Brand']).toUpperCase() && clean(p.Model).toUpperCase() === clean(row['Product Model']).toUpperCase() && (clean(p['Price Zone']).toUpperCase() === 'ALL_BRANCHES' || canonicalRegion(p['Price Zone']) === zone)) || {};
        const tenure = clean(businessUnit === 'HANDPHONE' ? row['Loan Tenure Months'] : row['Loan Tenure Years']);
        const monthly = businessUnit === 'HANDPHONE' ? (tenure === '12' ? quote['Monthly 12 Months (RM)'] : tenure === '24' ? quote['Monthly 24 Months (RM)'] : tenure === '36' ? quote['Monthly 36 Months (RM)'] : tenure === '48' ? quote['Monthly 48 Months (RM)'] : '') : (tenure === '3' ? quote['Monthly 3 Years (RM)'] : tenure === '4' ? quote['Monthly 4 Years (RM)'] : tenure === '5' ? quote['Monthly 5 Years (RM)'] : '');
        const ic = clean(row['Applicant IC Number']);
        return { id: row['Application ID'], leadId: row['Lead ID'], customer: row['Applicant Name'] || row['Lead ID'] || 'Unknown customer', region: zone, businessUnit, productCategory: row['Product Category'] || (businessUnit === 'HANDPHONE' ? 'HANDPHONE' : 'MOTORCYCLE'), synthetic: isSyntheticApplicationRow(row),
          stage: row['Current Stage'] || row['Application Status'], status: row['Application Status'], sa: row['Assigned SA ID'] || 'Unassigned', phone: row['Phone Number'],
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
      const [rows] = await readRanges(req, ['Document_Log!A1:AA1500']);
      const records = rowsToObjects(rows).filter(row => businessApplicationIds.has(row['Application ID']) || businessLeadIds.has(row['Lead ID'])).reverse().map(row => ({
        id: row['Document ID'], applicationId: row['Application ID'], leadId: row['Lead ID'], type: row['Document Type'], received: row['Received At'], fileName: row['File Name'], mimeType: row['Mime Type'],
        classification: row['Classification Status'], quality: row['Quality Status'], verification: row['Verification Status'], duplicate: row['Duplicate Status'], reviewRequired: row['Manual Review Required'], remarks: row.Remarks, updated: row['Updated At']
      }));
      return res.status(200).json({ live: true, records });
    }

    if (resource === 'pricing') {
      const [motorRows, handphoneRows] = await readRanges(req, ['Motor_Loan_Pricing!A1:Z1000', 'Handphone_Loan_Pricing!A1:AB1000']);
      const visible = (row, businessUnit) => businessPermitted(session, { 'Business Unit': businessUnit }) && (session.role === 'ADMIN' || (truth(row.Active) && clean(row['Quote Approval Status']).toUpperCase() === 'APPROVED' && (clean(row['Price Zone']).toUpperCase() === 'ALL_BRANCHES' || canonicalRegion(row['Price Zone']) === session.region)));
      const mapPricing = (row, businessUnit) => ({
        id: row['Pricing ID'], catalogId: row['Catalog ID'], businessUnit, brand: row.Brand, model: row.Model, variant: row.Variant, zone: row['Price Zone'], productPrice: customerAmount(row['Product Price (RM)']),
        deposit: effectiveDeposit(row), baseDeposit: customerAmount(row['Deposit (RM)']), year3: customerAmount(row['Monthly 3 Years (RM)']), year4: customerAmount(row['Monthly 4 Years (RM)']), year5: customerAmount(row['Monthly 5 Years (RM)']), month12: customerAmount(row['Monthly 12 Months (RM)']), month24: customerAmount(row['Monthly 24 Months (RM)']), month36: customerAmount(row['Monthly 36 Months (RM)']), month48: customerAmount(row['Monthly 48 Months (RM)']),
        effective: row['Effective From'], effectiveTo: row['Effective To'], active: truth(row.Active), status: row['Quote Approval Status'], internalNotes: session.role === 'ADMIN' ? row['Internal Notes'] : '',
        promotion: promotionApplies(row) || session.role === 'ADMIN' ? row['Promotion Name'] : '', promotionDeposit: customerAmount(row['Promotion Deposit (RM)']), promotionStart: row['Promotion Start'], promotionEnd: row['Promotion End'],
        promotionActive: truth(row['Promotion Active']), promotionStatus: row['Promotion Approval Status'], promotionNotes: session.role === 'ADMIN' ? row['Promotion Notes'] : '', updated: row['Last Updated At'], updatedBy: row['Updated By']
      });
      const records = [...rowsToObjects(motorRows).filter(row => visible(row, 'MOTOR')).map(row => mapPricing(row, 'MOTOR')), ...rowsToObjects(handphoneRows).filter(row => visible(row, 'HANDPHONE')).map(row => mapPricing(row, 'HANDPHONE'))];
      return res.status(200).json({ live: true, records });
    }

    if (resource === 'catalog') {
      const [motorRows, handphoneRows] = await readRanges(req, ['Motor_Model_Catalog!A1:Q1000', 'Handphone_Model_Catalog!A1:Q1000']);
      const mapCatalog = (row, businessUnit) => ({
        id: row['Catalog ID'], businessUnit, brand: row.Brand, model: row.Model, variant: row.Variant, category: row.Category, fuel: row['Fuel Type'], operatingSystem: row['Operating System'], tier: row['Popularity Tier'],
        productPageUrl: row['Product Page URL'], imageUrl: row['Image URL'], image: truth(row['Image Approved']) ? row['Image URL'] : '', imageCaption: row['Image Caption (MS)'], imageApproved: truth(row['Image Approved']),
        active: truth(row.Active), stock: row['Stock Check Mode'], branchAvailability: row['Branch Availability'], regionAvailability: row['Region Availability'], warehouseAvailability: row['Warehouse Availability'], searchKeywords: row['Search Keywords'], lastVerified: row['Last Verified At']
      });
      const allowed = businessUnit => businessPermitted(session, { 'Business Unit': businessUnit });
      const records = [...(allowed('MOTOR') ? rowsToObjects(motorRows).filter(row => session.role === 'ADMIN' || truth(row.Active)).map(row => mapCatalog(row, 'MOTOR')) : []), ...(allowed('HANDPHONE') ? rowsToObjects(handphoneRows).filter(row => session.role === 'ADMIN' || truth(row.Active)).map(row => mapCatalog(row, 'HANDPHONE')) : [])];
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

    const [inboxRows, outboxRows, dashboardDocumentRows] = await readRanges(req, ['Customer_Inbox!A1:AC1000', 'Message_Outbox!A1:AC1200', 'Document_Log!A1:AA1500']);
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
