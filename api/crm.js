import crypto from 'node:crypto';
import { authenticate, clearSession, getSession, hashPassword, migrateEnvironmentAccounts, setSession, validateSession } from './_auth.js';

const SHEET_ID = process.env.JOMKAKI_SPREADSHEET_ID;
const CLIENT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const PROJECT_NUMBER = process.env.GOOGLE_PROJECT_NUMBER;
const POOL_ID = process.env.GOOGLE_WIF_POOL_ID || 'vercel-production';
const PROVIDER_ID = process.env.GOOGLE_WIF_PROVIDER_ID || 'vercel-jomkaki-production';
const clean = value => String(value ?? '').trim();
const customerAmount = value => clean(value).replace(/^RM\s*/i, '');
const canonicalRegion = value => ['SARAWAK', 'SABAH', 'LABUAN', 'EAST MALAYSIA', 'EAST_MALAYSIA'].includes(clean(value).toUpperCase()) ? 'EAST_MALAYSIA' : clean(value).toUpperCase();

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
const userSheetRange = 'CRM_User_Access!A1:R1000';
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

async function setPricingDerivedFormulas(req, pricingId) {
  const [rows] = await readRanges(req, ['Motor_Loan_Pricing!A1:Z2000']);
  const headers = rows?.[0] || [], idIndex = headers.indexOf('Pricing ID');
  const rowIndex = rows.findIndex((row, index) => index > 0 && clean(row[idIndex]) === clean(pricingId));
  if (rowIndex < 1) throw new Error('New pricing record was not found');
  const rowNumber = rowIndex + 1, token = await getAccessToken(req);
  const data = [
    { range: `Motor_Loan_Pricing!Y${rowNumber}`, values: [[`=IFERROR(IF(B${rowNumber}=\"\",\"\",IF(AND(V${rowNumber}=TRUE,W${rowNumber}=\"APPROVED\",S${rowNumber}<>\"\",OR(T${rowNumber}=\"\",T${rowNumber}<=TODAY()),OR(U${rowNumber}=\"\",U${rowNumber}>=TODAY())),S${rowNumber},G${rowNumber})),\"\")`]] },
    { range: `Motor_Loan_Pricing!Z${rowNumber}`, values: [[`=IFERROR(IF(B${rowNumber}=\"\",\"\",IF(AND(V${rowNumber}=TRUE,W${rowNumber}=\"APPROVED\",S${rowNumber}<>\"\",OR(T${rowNumber}=\"\",T${rowNumber}<=TODAY()),OR(U${rowNumber}=\"\",U${rowNumber}>=TODAY())),IF(R${rowNumber}<>\"\",\"Promotion \"&R${rowNumber}&\" untuk\",\"Promotion untuk\"),\"Untuk\")),\"\")`]] }
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

async function validatedAccountScope(req, role, region, branchId, saId) {
  const normalizedRole = clean(role).toUpperCase();
  const normalizedRegion = normalizedRole === 'ADMIN' ? 'ALL' : canonicalRegion(region);
  if (normalizedRole === 'ADMIN') return { region: 'ALL', branchId: '', saId: '' };
  if (!['EAST_MALAYSIA', 'WEST_MALAYSIA'].includes(normalizedRegion)) throw new Error('A valid region is required');
  if (normalizedRole === 'REGION_MANAGER') return { region: normalizedRegion, branchId: '', saId: '' };
  const [branchRows, saRows] = await readRanges(req, ['Branch_Master!A1:Q1000', 'SA_Master!A1:L1000']);
  const branches = rowsToObjects(branchRows), advisors = rowsToObjects(saRows);
  if (normalizedRole === 'BRANCH_MANAGER') {
    const branch = branches.find(row => clean(row['Branch ID']) === clean(branchId) && clean(row.Active).toUpperCase() === 'TRUE');
    if (!branch) throw new Error('Branch Manager requires an active Branch ID');
    if (canonicalRegion(branch.Region) !== normalizedRegion) throw new Error('The selected branch does not belong to this region');
    return { region: normalizedRegion, branchId: clean(branchId), saId: '' };
  }
  const advisor = advisors.find(row => clean(row['SA ID']) === clean(saId) && clean(row.Active).toUpperCase() === 'TRUE');
  if (!advisor) throw new Error('Staff requires an active SA ID');
  const advisorBranch = clean(advisor['Branch ID']);
  const branch = branches.find(row => clean(row['Branch ID']) === advisorBranch && clean(row.Active).toUpperCase() === 'TRUE');
  if (!branch || canonicalRegion(advisor.Region || branch.Region) !== normalizedRegion) throw new Error('The selected sales advisor does not belong to this region');
  if (clean(branchId) && clean(branchId) !== advisorBranch) throw new Error('The selected sales advisor does not belong to this branch');
  return { region: normalizedRegion, branchId: advisorBranch, saId: clean(saId) };
}

const humanStatuses = new Set(['HUMAN_HANDOVER_REQUIRED', 'MANAGER_IN_PROGRESS', 'ASSIGNED_TO_STAFF']);
const managerRoles = new Set(['ADMIN', 'REGION_MANAGER', 'BRANCH_MANAGER']);
const whatsappPhone = value => {
  let digits = clean(value).replace(/\D/g, '');
  if (digits.startsWith('0')) digits = `60${digits.slice(1)}`;
  return digits;
};

function publicAccount(row) {
  return { id: row['Account ID'], username: row.Username, name: row['Display Name'], role: row.Role, saId: row['SA ID'], branchId: row['Branch ID'], region: row.Region, status: row.Status, access: row['Access Scope'], loginEnabled: clean(row['Login Enabled']).toUpperCase() === 'TRUE', mustChangePassword: clean(row['Must Change Password']).toUpperCase() === 'TRUE', failedAttempts: Number(row['Failed Login Attempts'] || 0), lockedUntil: row['Locked Until'], lastVerified: row['Last Verified'], lastPasswordReset: row['Last Password Reset'], notes: row.Notes };
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
  if (session.role === 'STAFF') {
    const scopedLeads = leads.filter(row => clean(row['Assigned SA ID']) === clean(session.saId));
    const leadIds = new Set(scopedLeads.map(row => row['Lead ID']));
    const scopedApplications = applications.filter(row => clean(row['Assigned SA ID']) === clean(session.saId) || leadIds.has(row['Lead ID']));
    return { leads: scopedLeads, applications: scopedApplications, leadIds, applicationIds: new Set(scopedApplications.map(row => row['Application ID'])) };
  }
  if (session.role === 'BRANCH_MANAGER') {
    const scopedLeads = leads.filter(row => clean(row['Selected Branch ID']) === clean(session.branchId));
    const leadIds = new Set(scopedLeads.map(row => row['Lead ID']));
    const scopedApplications = applications.filter(row => clean(row['Assigned Branch ID']) === clean(session.branchId) || leadIds.has(row['Lead ID']));
    return { leads: scopedLeads, applications: scopedApplications, leadIds, applicationIds: new Set(scopedApplications.map(row => row['Application ID'])) };
  }
  const scopedLeads = leads.filter(row => canonicalRegion(row.Region) === session.region);
  const leadIds = new Set(scopedLeads.map(row => row['Lead ID']));
  const scopedApplications = applications.filter(row => leadIds.has(row['Lead ID']) || branchRegion[row['Assigned Branch ID']] === session.region);
  return { leads: scopedLeads, applications: scopedApplications, leadIds, applicationIds: new Set(scopedApplications.map(row => row['Application ID'])) };
}

const count = (rows, field, value) => rows.filter(row => clean(row[field]).toUpperCase() === value).length;
const latestApplicationByLead = applications => {
  const map = new Map();
  applications.forEach(row => { const id = row['Lead ID']; if (id && !map.has(id)) map.set(id, row); });
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
          const migrated = await migrateEnvironmentAccounts(req);
          await writeActivity(req, session, { type: 'CRM_LEGACY_ACCOUNTS_MIGRATED', description: `${migrated} legacy accounts migrated to CRM management` });
          return res.status(200).json({ live: true, migrated });
        }
        const users = await accountRows(req);
        if (action === 'createUser') {
          const username = clean(body.username).toLowerCase(), name = clean(body.name), role = clean(body.role).toUpperCase();
          if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw new Error('Username must be 3–40 letters, numbers, dots, dashes or underscores');
          if (!name || !['ADMIN', 'REGION_MANAGER', 'BRANCH_MANAGER', 'STAFF'].includes(role)) throw new Error('Name and a valid role are required');
          if (users.some(row => clean(row.Username).toLowerCase() === username)) throw new Error('This username already exists');
          const identity = await validatedAccountScope(req, role, body.region, body.branchId, body.saId);
          const password = clean(body.password) || temporaryPassword();
          if (password.length < 10) throw new Error('Temporary password must contain at least 10 characters');
          const accountId = `${role.replace('_MANAGER', '').replace('REGION', 'REG')}-${Date.now()}`;
          const timestamp = now();
          await appendObject(req, 'CRM_User_Access', {
            'Account ID': accountId, Username: username, 'Display Name': name, Role: role, 'SA ID': identity.saId, 'Branch ID': identity.branchId, Region: identity.region,
            Status: 'ACTIVE', 'Access Scope': role === 'ADMIN' ? 'All CRM customers, accounts and settings' : role === 'REGION_MANAGER' ? `All ${identity.region.replace('_', ' ')} branches, staff and customers` : role === 'BRANCH_MANAGER' ? 'All staff and customers in own branch' : 'Customers and follow-ups assigned to own SA ID',
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
          const role = clean(body.role).toUpperCase(), name = clean(body.name), username = clean(body.username).toLowerCase();
          if (!name || !/^[a-z0-9._-]{3,40}$/.test(username) || !['ADMIN', 'REGION_MANAGER', 'BRANCH_MANAGER', 'STAFF'].includes(role)) throw new Error('Valid name, username and role are required');
          if (users.some(row => row['Account ID'] !== accountId && clean(row.Username).toLowerCase() === username)) throw new Error('This username already exists');
          if (clean(record.Username).toLowerCase() === clean(session.username).toLowerCase() && role !== 'ADMIN') throw new Error('You cannot remove your own Administrator access');
          if (clean(record.Role).toUpperCase() === 'ADMIN' && role !== 'ADMIN' && activeAdmins.length <= 1) throw new Error('At least one active Administrator must remain');
          const identity = await validatedAccountScope(req, role, body.region, body.branchId, body.saId);
          await updateObject(req, 'CRM_User_Access', 'Account ID', accountId, { Username: username, 'Display Name': name, Role: role, 'SA ID': identity.saId, 'Branch ID': identity.branchId, Region: identity.region, 'Access Scope': role === 'ADMIN' ? 'All CRM customers, accounts and settings' : role === 'REGION_MANAGER' ? `All ${identity.region.replace('_', ' ')} branches, staff and customers` : role === 'BRANCH_MANAGER' ? 'All staff and customers in own branch' : 'Customers and follow-ups assigned to own SA ID', 'Updated At': now() }, 'R');
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
      if (['saveCatalogItem', 'savePricingPromotion'].includes(action)) {
        if (session.role !== 'ADMIN') return res.status(403).json({ live: false, error: 'Administrator access is required.' });
        if (action === 'saveCatalogItem') {
          const catalogId = clean(body.catalogId), brand = clean(body.brand), model = clean(body.model), variant = clean(body.variant) || 'Standard';
          const category = clean(body.category).toUpperCase(), fuel = clean(body.fuel).toUpperCase() || 'PETROL';
          const tier = clean(body.tier).toUpperCase(), stock = clean(body.stock).toUpperCase();
          if (!brand || !model || !category) throw new Error('Brand, model and category are required');
          if (fuel !== 'PETROL') throw new Error('Fuel type must be PETROL for the current catalog');
          if (!['PRIMARY', 'SECONDARY', 'ON_REQUEST'].includes(tier)) throw new Error('A valid popularity tier is required');
          if (!['CHECK_BRANCH', 'CHECK_WAREHOUSE', 'CONFIRMED_AVAILABLE', 'UNAVAILABLE'].includes(stock)) throw new Error('A valid stock check mode is required');
          const timestamp = now(), record = {
            Brand: brand, Model: model, Variant: variant, Category: category, 'Fuel Type': fuel, 'Popularity Tier': tier,
            'Product Page URL': validUrl(body.productPageUrl, 'Product page URL'), 'Image URL': validUrl(body.imageUrl, 'Image URL'),
            'Image Caption (MS)': clean(body.imageCaption), 'Image Approved': truth(body.imageApproved) ? 'TRUE' : 'FALSE',
            Active: truth(body.active) ? 'TRUE' : 'FALSE', 'Stock Check Mode': stock, 'Branch Availability': clean(body.branchAvailability),
            'Warehouse Availability': clean(body.warehouseAvailability), 'Search Keywords': clean(body.searchKeywords), 'Last Verified At': timestamp.slice(0, 10)
          };
          if (catalogId) {
            await updateObject(req, 'Motor_Model_Catalog', 'Catalog ID', catalogId, record, 'Q');
            await writeActivity(req, session, { type: 'CRM_CATALOG_UPDATED', description: `${brand} ${model} catalog item updated` });
            return res.status(200).json({ live: true, catalogId });
          }
          const [catalogRows] = await readRanges(req, ['Motor_Model_Catalog!A1:Q1000']);
          const existing = rowsToObjects(catalogRows);
          let newCatalogId = `MTR-${slug(brand)}-${slug(model)}`;
          if (existing.some(row => clean(row['Catalog ID']) === newCatalogId)) newCatalogId = `${newCatalogId}-${Date.now().toString(36).toUpperCase()}`;
          await appendObject(req, 'Motor_Model_Catalog', { 'Catalog ID': newCatalogId, ...record });
          await writeActivity(req, session, { type: 'CRM_CATALOG_CREATED', description: `${brand} ${model} added to the motor catalog` });
          return res.status(201).json({ live: true, catalogId: newCatalogId });
        }

        const pricingId = clean(body.pricingId), catalogId = clean(body.catalogId), zone = clean(body.zone).toUpperCase();
        const [catalogRows, branchRows] = await readRanges(req, ['Motor_Model_Catalog!A1:Q1000', 'Branch_Master!A1:Q1000']);
        const catalogRecord = rowsToObjects(catalogRows).find(row => clean(row['Catalog ID']) === catalogId);
        if (!catalogRecord) throw new Error('Select a valid catalog motorcycle');
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
          'Deposit (RM)': amount(body.deposit, 'Deposit'), 'Monthly 3 Years (RM)': amount(body.year3, '3-year instalment'),
          'Monthly 4 Years (RM)': amount(body.year4, '4-year instalment'), 'Monthly 5 Years (RM)': amount(body.year5, '5-year instalment'),
          Active: truth(body.active) ? 'TRUE' : 'FALSE', 'Effective From': effectiveFrom, 'Effective To': effectiveTo,
          'Quote Approval Status': quoteStatus, 'Last Updated At': timestamp, 'Updated By': session.username, 'Internal Notes': clean(body.internalNotes),
          'Promotion Name': clean(body.promotionName), 'Promotion Deposit (RM)': amount(body.promotionDeposit, 'Promotion deposit', true),
          'Promotion Start': promotionStart, 'Promotion End': promotionEnd, 'Promotion Active': truth(body.promotionActive) ? 'TRUE' : 'FALSE',
          'Promotion Approval Status': promotionStatus, 'Promotion Notes': clean(body.promotionNotes)
        };
        if (truth(body.promotionActive) && (!clean(body.promotionName) || pricingRecord['Promotion Deposit (RM)'] === '')) throw new Error('An active promotion requires a name and promotion deposit');
        if (pricingId) {
          await updateObject(req, 'Motor_Loan_Pricing', 'Pricing ID', pricingId, pricingRecord, 'Z');
          await writeActivity(req, session, { type: 'CRM_PRICING_PROMOTION_UPDATED', description: `${catalogRecord.Brand} ${catalogRecord.Model} ${zone} pricing and promotion updated` });
          return res.status(200).json({ live: true, pricingId });
        }
        const newPricingId = `PRICE-${slug(zone)}-${Date.now().toString(36).toUpperCase()}`;
        await appendObject(req, 'Motor_Loan_Pricing', { 'Pricing ID': newPricingId, ...pricingRecord });
        await setPricingDerivedFormulas(req, newPricingId);
        await writeActivity(req, session, { type: 'CRM_PRICING_PROMOTION_CREATED', description: `${catalogRecord.Brand} ${catalogRecord.Model} ${zone} pricing and promotion created` });
        return res.status(201).json({ live: true, pricingId: newPricingId });
      }
      if (action === 'createApplication') {
        const customerName = clean(body.customerName), phone = clean(body.phone), brand = clean(body.brand), model = clean(body.model);
        const requestedRegion = canonicalRegion(body.region);
        if (!customerName || !phone || !brand || !model || !['EAST_MALAYSIA', 'WEST_MALAYSIA'].includes(requestedRegion)) throw new Error('Customer, phone, region, brand and model are required');
        if (session.role !== 'ADMIN' && requestedRegion !== session.region) return res.status(403).json({ live: false, error: 'This region is outside your access.' });
        const leadId = makeId('LEAD'), applicationId = makeId('APP'), timestamp = now();
        const assignedSaId = session.role === 'STAFF' ? session.saId : clean(body.saId);
        const assignedBranchId = ['STAFF', 'BRANCH_MANAGER'].includes(session.role) ? session.branchId : clean(body.branchId);
        if (assignedSaId || assignedBranchId) {
          const [branchRows, saRows] = await readRanges(req, ['Branch_Master!A1:Q1000', 'SA_Master!A1:L1000']);
          const branches = rowsToObjects(branchRows), advisors = rowsToObjects(saRows);
          const branch = branches.find(row => clean(row['Branch ID']) === assignedBranchId && clean(row.Active).toUpperCase() === 'TRUE');
          if (!branch || (session.role !== 'ADMIN' && canonicalRegion(branch.Region) !== requestedRegion)) throw new Error('The selected branch is outside the application region');
          if (session.role === 'BRANCH_MANAGER' && assignedBranchId !== clean(session.branchId)) throw new Error('Branch Manager may create cases in their own branch only');
          if (assignedSaId) {
            const advisor = advisors.find(row => clean(row['SA ID']) === assignedSaId && clean(row.Active).toUpperCase() === 'TRUE');
            if (!advisor || clean(advisor['Branch ID']) !== assignedBranchId || (session.role !== 'ADMIN' && canonicalRegion(advisor.Region) !== requestedRegion)) throw new Error('The selected sales advisor does not belong to this branch and region');
          }
        }
        await appendObject(req, 'Leads', {
          'Lead ID': leadId, 'Created At': timestamp, 'Updated At': timestamp, 'Customer Name': customerName, 'Phone Number': phone,
          Region: requestedRegion, State: clean(body.state), 'City or Area': clean(body.city), 'Lead Status': 'NEW', 'Lead Source': 'CRM_MANUAL',
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
          'Product Category': 'MOTORCYCLE', 'Product Brand': brand, 'Product Model': model, 'Product Variant': clean(body.variant), 'Loan Tenure Years': clean(body.tenure),
          'Bank Account Available': clean(body.bankAccountAvailable).toUpperCase(), 'Direct Debit Status': clean(body.directDebitStatus).toUpperCase(),
          'Agreement Status': clean(body.agreementStatus).toUpperCase(), 'Missing Application Fields': clean(body.missingApplicationFields),
          'Application Status': 'DRAFT', 'Current Stage': 'DOCUMENT_COLLECTION', 'Processing Mode': assignedSaId ? (session.role === 'STAFF' ? 'AI_EXCEPTION_STAFF_MANUAL' : 'MANUAL_ASSIGNED') : 'AI_MANAGED', 'Assigned Branch ID': assignedBranchId, 'Assigned SA ID': assignedSaId,
          'Document Status': 'PENDING', 'Minimum Documents Complete': 'FALSE', 'Missing Documents': clean(body.missingDocuments) || 'IC_FRONT, IC_BACK, INCOME_PROOF',
          'SA Review Required': 'FALSE', 'Next Follow Up At': clean(body.nextFollowUp), 'Created By': session.username, 'Updated By': session.username
        });
        await writeActivity(req, session, { leadId, applicationId, type: 'CRM_MANUAL_APPLICATION_CREATED', description: `Manual application created for ${brand} ${model}` });
        return res.status(201).json({ live: true, leadId, applicationId });
      }
      if (action === 'uploadDocument') {
        const applicationId = clean(body.applicationId), leadId = clean(body.leadId), documentType = clean(body.documentType);
        if ((!applicationId && !leadId) || !documentType || !body.file?.data) throw new Error('Application or Lead, document type and file are required');
        const [leadRows, applicationRows, branchRows] = await readRanges(req, ['Leads!A1:AF1000', 'Applications!A1:BG1000', 'Branch_Master!A1:Q1000']);
        const scope = scopeData(session, rowsToObjects(leadRows), rowsToObjects(applicationRows), rowsToObjects(branchRows));
        if (session.role !== 'ADMIN' && !scope.leadIds.has(leadId) && !scope.applicationIds.has(applicationId)) return res.status(403).json({ live: false, error: 'This customer is outside your access.' });
        const uploaded = await uploadDocument(req, body.file, applicationId || leadId);
        const documentId = makeId('DOC'), timestamp = now();
        await appendObject(req, 'Document_Log', {
          'Document ID': documentId, 'Received At': timestamp, 'Updated At': timestamp, 'Lead ID': leadId, 'Application ID': applicationId,
          'Document Type': documentType, 'File Name': uploaded.name, 'Mime Type': clean(body.file.type), 'File URL': uploaded.webUrl || '',
          'Classification Status': 'AI_QUEUED', 'Quality Status': 'PENDING_AI', 'Verification Status': 'PENDING_AI', 'Duplicate Status': 'NOT_CHECKED',
          'Manual Review Required': 'FALSE', Remarks: clean(body.remarks), 'Uploaded By': session.username
        });
        await writeActivity(req, session, { leadId, applicationId, type: 'CRM_DOCUMENT_UPLOADED', description: `${documentType} uploaded for automatic AI validation` });
        return res.status(201).json({ live: true, documentId, fileName: uploaded.name });
      }
      if (action === 'updateApplication') {
        const applicationId = clean(body.applicationId);
        const stages = ['APPLICATION_DETAILS_PENDING', 'DOCUMENT_COLLECTION', 'DOCUMENT_VERIFICATION', 'CREDIT_ASSESSMENT', 'BRANCH_HANDOVER', 'RECOVERY_PENDING', 'COMPLETED'];
        const statuses = ['DRAFT', 'IN_PROGRESS', 'MANUAL_REVIEW', 'APPROVED', 'REJECTED', 'COMPLETED', 'CANCELLED'];
        const [leadRows, applicationRows, branchRows, saRows] = await readRanges(req, ['Leads!A1:AF1000', 'Applications!A1:BG1000', 'Branch_Master!A1:Q1000', 'SA_Master!A1:L1000']);
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
        if (session.role === 'BRANCH_MANAGER' && branchId !== clean(session.branchId)) throw new Error('Branch Manager may assign cases inside their own branch only');
        if (saId) {
          const advisor = salesAdvisors.find(row => clean(row['SA ID']) === saId && clean(row.Active).toUpperCase() === 'TRUE');
          if (!advisor || (session.role !== 'ADMIN' && canonicalRegion(advisor.Region) !== session.region)) throw new Error('The selected sales advisor is outside your access');
          if (session.role === 'BRANCH_MANAGER' && clean(advisor['Branch ID']) !== clean(session.branchId)) throw new Error('The selected sales advisor is outside your branch');
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
        const [leadRows, applicationRows, branchRows, documentRows] = await readRanges(req, ['Leads!A1:AF1000', 'Applications!A1:BG1000', 'Branch_Master!A1:Q1000', 'Document_Log!A1:Y1500']);
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
        const applicationId = clean(body.applicationId);
        const [leadRows, applicationRows, branchRows] = await readRanges(req, ['Leads!A1:AF1000', 'Applications!A1:BG1000', 'Branch_Master!A1:Q1000']);
        const leads = rowsToObjects(leadRows), applications = rowsToObjects(applicationRows), branches = rowsToObjects(branchRows);
        const scope = scopeData(session, leads, applications, branches);
        const record = applications.find(row => clean(row['Application ID']) === applicationId);
        if (!record || !scope.applicationIds.has(applicationId)) return res.status(403).json({ live: false, error: 'This application is outside your access.' });
        const changes = {
          'Updated At': now(), 'Applicant Name': clean(body.applicantName), 'Home Address': clean(body.homeAddress),
          'Phone Number': clean(body.phone), Email: clean(body.email), 'Employer Name': clean(body.employerName),
          'Employer Address': clean(body.employerAddress), 'Employer Phone': clean(body.employerPhone),
          'Employment Duration Months': clean(body.employmentDurationMonths), 'Job Position': clean(body.jobPosition),
          'Basic Salary': clean(body.basicSalary), 'Salary Payment Method': clean(body.salaryPaymentMethod),
          'Occupation Category': clean(body.occupationCategory), 'Reference 1 Name': clean(body.reference1Name),
          'Reference 1 Phone': clean(body.reference1Phone), 'Reference 1 Relationship': clean(body.reference1Relationship),
          'Reference 2 Name': clean(body.reference2Name), 'Reference 2 Phone': clean(body.reference2Phone),
          'Reference 2 Relationship': clean(body.reference2Relationship), 'Product Category': clean(body.productCategory) || 'MOTORCYCLE',
          'Product Brand': clean(body.productBrand), 'Product Model': clean(body.productModel), 'Loan Tenure Years': clean(body.loanTenureYears),
          'Bank Account Available': clean(body.bankAccountAvailable).toUpperCase(), 'Direct Debit Status': clean(body.directDebitStatus).toUpperCase(),
          'Agreement Status': clean(body.agreementStatus).toUpperCase(), 'Missing Application Fields': clean(body.missingApplicationFields),
          'Updated By': session.username
        };
        if (clean(body.applicantIcNumber)) changes['Applicant IC Number'] = clean(body.applicantIcNumber);
        if (!changes['Applicant Name'] || !changes['Phone Number'] || !changes['Product Brand'] || !changes['Product Model']) throw new Error('Applicant name, phone, motor brand and model are required');
        if (changes['Loan Tenure Years'] && !['3', '4', '5'].includes(changes['Loan Tenure Years'])) throw new Error('Loan tenure must be 3, 4 or 5 years');
        if (changes['Email'] && !/^\S+@\S+\.\S+$/.test(changes['Email'])) throw new Error('Email format is invalid');
        await updateObject(req, 'Applications', 'Application ID', applicationId, changes);
        await writeActivity(req, session, { leadId: record['Lead ID'], applicationId, type: 'CRM_APPLICANT_PROFILE_UPDATED', description: 'Applicant 360 profile updated by authorized staff' });
        return res.status(200).json({ live: true, applicationId });
      }
      if (['sendCustomerMessage', 'recordManualReply', 'requestHumanHandover', 'assignHandover', 'updateHandover', 'markOutboxSent'].includes(action)) {
        const [leadRows, applicationRows, branchRows, inboxRows, outboxRows, saRows] = await readRanges(req, ['Leads!A1:AF1000', 'Applications!A1:BG1000', 'Branch_Master!A1:Q1000', 'Customer_Inbox!A1:Z1200', 'Message_Outbox!A1:Z1500', 'SA_Master!A1:L1000']);
        const leads = rowsToObjects(leadRows), applications = rowsToObjects(applicationRows), branches = rowsToObjects(branchRows), inboxRecords = rowsToObjects(inboxRows), outboxRecords = rowsToObjects(outboxRows), advisors = rowsToObjects(saRows);
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
          let sendStatus = 'MANUAL_PENDING', providerMessageId = '', errorMessage = '';
          if (cloudMode) {
            const accessToken = clean(process.env.WHATSAPP_ACCESS_TOKEN), phoneNumberId = clean(process.env.WHATSAPP_PHONE_NUMBER_ID), version = clean(process.env.WHATSAPP_GRAPH_VERSION) || 'v25.0';
            if (!accessToken || !phoneNumberId) throw new Error('WhatsApp Cloud credentials are not configured');
            const cloudPayload = messageType === 'TEMPLATE' ? { messaging_product: 'whatsapp', to: phone, type: 'template', template: { name: templateName, language: { code: language } } } : { messaging_product: 'whatsapp', recipient_type: 'individual', to: phone, type: 'text', text: { preview_url: false, body: message } };
            const response = await fetch(`https://graph.facebook.com/${version}/${phoneNumberId}/messages`, { method: 'POST', headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' }, body: JSON.stringify(cloudPayload) });
            const result = await response.json().catch(() => ({}));
            if (response.ok) { sendStatus = 'QUEUED'; providerMessageId = result.messages?.[0]?.id || ''; } else { sendStatus = 'FAILED'; errorMessage = result.error?.message || `Meta API error ${response.status}`; }
          }
          await appendObject(req, 'Message_Outbox', { 'Outbox ID': outboxId, 'Created At': timestamp, 'Lead ID': leadId, 'Application ID': applicationId, 'Phone Number': phone, 'Message Type': messageType, 'Message Text': message, 'Template Name': templateName, Language: language, 'Send Status': sendStatus, 'Attempt Count': cloudMode ? '1' : '0', 'Sent At': cloudMode && sendStatus !== 'FAILED' ? timestamp : '', 'Provider Message ID': providerMessageId, 'Error Message': errorMessage, 'Send Routing Status': cloudMode ? 'CLOUD_API' : 'WHATSAPP_BUSINESS_MANUAL' });
          await writeActivity(req, session, { leadId, applicationId, type: cloudMode ? 'CRM_WHATSAPP_MESSAGE_QUEUED' : 'CRM_MANUAL_WHATSAPP_OPENED', description: `${session.username} prepared a customer reply` });
          return res.status(sendStatus === 'FAILED' ? 502 : 201).json({ live: sendStatus !== 'FAILED', outboxId, mode: cloudMode ? 'CLOUD' : 'MANUAL', status: sendStatus, whatsappUrl: cloudMode ? '' : `https://wa.me/${phone}?text=${encodeURIComponent(message)}`, error: errorMessage || undefined });
        }

        if (action === 'recordManualReply' || action === 'requestHumanHandover') {
          if (!permitted) return res.status(403).json({ live: false, error: 'This customer is outside your access.' });
          const phone = whatsappPhone(body.phone), message = clean(body.message || body.reason);
          if (!phone || !message) throw new Error('Phone number and message are required');
          const status = action === 'requestHumanHandover' || clean(body.requiresManager).toUpperCase() === 'TRUE' ? 'HUMAN_HANDOVER_REQUIRED' : 'MANUAL_RECORDED';
          const messageId = makeId('MSG'), timestamp = now();
          await appendObject(req, 'Customer_Inbox', { 'Received At': timestamp, 'Phone Number': phone, 'Customer Message': message, 'Message ID': messageId, Channel: 'WHATSAPP_BUSINESS', Source: 'CRM_MANUAL', 'Lead ID': leadId, 'Application ID': applicationId, 'Message Type': action === 'requestHumanHandover' ? 'HANDOVER_REQUEST' : 'TEXT', 'Process Status': status, 'AI Processed': 'FALSE', 'Webhook Source': 'CRM', 'Number Routing Status': 'MANUAL_TEST' });
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
          if (session.role === 'BRANCH_MANAGER' && clean(advisor['Branch ID']) !== clean(session.branchId)) throw new Error('This sales advisor is outside your branch');
          if (session.role === 'REGION_MANAGER' && canonicalRegion(advisor.Region) !== session.region) throw new Error('This sales advisor is outside your region');
          const assignedBranchId = clean(advisor['Branch ID']);
          if (inboxRecord['Lead ID']) await updateObject(req, 'Leads', 'Lead ID', inboxRecord['Lead ID'], { 'Assigned SA ID': saId, 'Selected Branch ID': assignedBranchId, 'Updated At': now() }, 'AF');
          if (inboxRecord['Application ID']) await updateObject(req, 'Applications', 'Application ID', inboxRecord['Application ID'], { 'Assigned SA ID': saId, 'Assigned Branch ID': assignedBranchId, 'Assigned Supervisor ID': session.username, 'Supervisor Assignment Status': 'ASSIGNED', 'Updated At': now() }, 'BG');
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
  if (resource === 'session') return res.status(200).json({ live: true, user: { name: session.name, username: session.username, role: session.role, region: session.region, saId: session.saId || '', branchId: session.branchId || '', mustChangePassword: !!session.mustChangePassword, whatsappMode: clean(process.env.WHATSAPP_SEND_MODE).toUpperCase() === 'CLOUD' ? 'CLOUD' : 'MANUAL' } });
  try {
    if (resource === 'users') {
      if (session.role !== 'ADMIN') return res.status(403).json({ live: false, error: 'Administrator access is required.' });
      return res.status(200).json({ live: true, records: (await accountRows(req)).filter(row => row.Username).map(publicAccount) });
    }
    const [leadRows, applicationRows, branchRows] = await readRanges(req, ['Leads!A1:AF1000', 'Applications!A1:BG1000', 'Branch_Master!A1:Q1000']);
    const allLeads = rowsToObjects(leadRows), allApplications = rowsToObjects(applicationRows), branches = rowsToObjects(branchRows);
    const scope = scopeData(session, allLeads, allApplications, branches);

    if (resource === 'leads') {
      const latest = latestApplicationByLead(scope.applications);
      const records = scope.leads.slice(-300).reverse().map(row => {
        const app = latest.get(row['Lead ID']) || {};
        return { id: row['Lead ID'], name: row['Customer Name'] || app['Applicant Name'] || 'Unknown customer', phone: row['Phone Number'], region: row.Region,
          model: [app['Product Brand'], app['Product Model'], app['Product Variant'] || app.Variant].filter(Boolean).join(' ') || row['Enquiry Type'] || 'Motor enquiry',
          productBrand: app['Product Brand'], productModel: app['Product Model'], productVariant: app['Product Variant'] || app.Variant,
          tenure: app['Loan Tenure Years'], status: row['Lead Status'], applicationStatus: app['Application Status'], applicationId: app['Application ID'],
          sa: row['Assigned SA ID'] || app['Assigned SA ID'] || 'Unassigned', branch: row['Selected Branch ID'] || app['Assigned Branch ID'] || '', state: row.State, city: row['City or Area'],
          notes: row.Notes, nextFollowUp: row['Next Follow Up At'] || app['Next Follow Up At'], created: row['Created At'], time: row['Updated At'] || row['Created At'] };
      });
      return res.status(200).json({ live: true, records });
    }

    if (resource === 'applications') {
      const [documentRows, pricingRows] = await readRanges(req, ['Document_Log!A1:Y1500', 'Motor_Loan_Pricing!A1:Z1000']);
      const documents = rowsToObjects(documentRows).filter(row => scope.applicationIds.has(row['Application ID']) || scope.leadIds.has(row['Lead ID']));
      const pricing = rowsToObjects(pricingRows).filter(row => clean(row.Active).toUpperCase() === 'TRUE' && clean(row['Quote Approval Status']).toUpperCase() === 'APPROVED');
      const docsByApplication = new Map(); documents.forEach(row => { const key = row['Application ID']; if (key) docsByApplication.set(key, [...(docsByApplication.get(key) || []), row]); });
      const leadRegion = Object.fromEntries(scope.leads.map(row => [row['Lead ID'], canonicalRegion(row.Region)]));
      const records = scope.applications.slice(-300).reverse().map(row => {
        const docs = documentSummary(docsByApplication.get(row['Application ID']) || []);
        const zone = leadRegion[row['Lead ID']];
        const quote = pricing.find(p => clean(p.Brand).toUpperCase() === clean(row['Product Brand']).toUpperCase() && clean(p.Model).toUpperCase() === clean(row['Product Model']).toUpperCase() && canonicalRegion(p['Price Zone']) === zone) || {};
        const tenure = clean(row['Loan Tenure Years']);
        const monthly = tenure === '3' ? quote['Monthly 3 Years (RM)'] : tenure === '4' ? quote['Monthly 4 Years (RM)'] : tenure === '5' ? quote['Monthly 5 Years (RM)'] : '';
        const ic = clean(row['Applicant IC Number']);
        return { id: row['Application ID'], leadId: row['Lead ID'], customer: row['Applicant Name'] || row['Lead ID'] || 'Unknown customer', region: zone,
          stage: row['Current Stage'] || row['Application Status'], status: row['Application Status'], sa: row['Assigned SA ID'] || 'Unassigned', phone: row['Phone Number'],
          product: [row['Product Brand'], row['Product Model'], row['Product Variant'] || row.Variant].filter(Boolean).join(' '), brand: row['Product Brand'], model: row['Product Model'], variant: row['Product Variant'] || row.Variant,
          tenure, deposit: effectiveDeposit(quote), monthly: customerAmount(monthly), priceZone: quote['Price Zone'], promotion: promotionApplies(quote) ? quote['Promotion Name'] : '',
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
          missingApplicationFields: row['Missing Application Fields'], handoverReason: row['Handover Reason'], assignedSupervisorId: row['Assigned Supervisor ID'], supervisorAssignmentStatus: row['Supervisor Assignment Status'],
          updated: row['Updated At'] || row['Created At'] };
      });
      return res.status(200).json({ live: true, records });
    }

    if (resource === 'documents') {
      const [rows] = await readRanges(req, ['Document_Log!A1:Y1500']);
      const records = rowsToObjects(rows).filter(row => scope.applicationIds.has(row['Application ID']) || scope.leadIds.has(row['Lead ID'])).slice(-500).reverse().map(row => ({
        id: row['Document ID'], applicationId: row['Application ID'], leadId: row['Lead ID'], type: row['Document Type'], received: row['Received At'], fileName: row['File Name'], mimeType: row['Mime Type'],
        classification: row['Classification Status'], quality: row['Quality Status'], verification: row['Verification Status'], duplicate: row['Duplicate Status'], reviewRequired: row['Manual Review Required'], remarks: row.Remarks, updated: row['Updated At']
      }));
      return res.status(200).json({ live: true, records });
    }

    if (resource === 'pricing') {
      const [rows] = await readRanges(req, ['Motor_Loan_Pricing!A1:Z1000']);
      const records = rowsToObjects(rows).filter(row => session.role === 'ADMIN' || (truth(row.Active) && clean(row['Quote Approval Status']).toUpperCase() === 'APPROVED' && canonicalRegion(row['Price Zone']) === session.region)).map(row => ({
        id: row['Pricing ID'], catalogId: row['Catalog ID'], brand: row.Brand, model: row.Model, variant: row.Variant, zone: row['Price Zone'],
        deposit: effectiveDeposit(row), baseDeposit: customerAmount(row['Deposit (RM)']), year3: customerAmount(row['Monthly 3 Years (RM)']), year4: customerAmount(row['Monthly 4 Years (RM)']), year5: customerAmount(row['Monthly 5 Years (RM)']),
        effective: row['Effective From'], effectiveTo: row['Effective To'], active: truth(row.Active), status: row['Quote Approval Status'], internalNotes: session.role === 'ADMIN' ? row['Internal Notes'] : '',
        promotion: promotionApplies(row) || session.role === 'ADMIN' ? row['Promotion Name'] : '', promotionDeposit: customerAmount(row['Promotion Deposit (RM)']), promotionStart: row['Promotion Start'], promotionEnd: row['Promotion End'],
        promotionActive: truth(row['Promotion Active']), promotionStatus: row['Promotion Approval Status'], promotionNotes: session.role === 'ADMIN' ? row['Promotion Notes'] : '', updated: row['Last Updated At'], updatedBy: row['Updated By']
      }));
      return res.status(200).json({ live: true, records });
    }

    if (resource === 'catalog') {
      const [rows] = await readRanges(req, ['Motor_Model_Catalog!A1:Q1000']);
      return res.status(200).json({ live: true, records: rowsToObjects(rows).filter(row => session.role === 'ADMIN' || truth(row.Active)).map(row => ({
        id: row['Catalog ID'], brand: row.Brand, model: row.Model, variant: row.Variant, category: row.Category, fuel: row['Fuel Type'], tier: row['Popularity Tier'],
        productPageUrl: row['Product Page URL'], imageUrl: row['Image URL'], image: truth(row['Image Approved']) ? row['Image URL'] : '', imageCaption: row['Image Caption (MS)'], imageApproved: truth(row['Image Approved']),
        active: truth(row.Active), stock: row['Stock Check Mode'], branchAvailability: row['Branch Availability'], warehouseAvailability: row['Warehouse Availability'], searchKeywords: row['Search Keywords'], lastVerified: row['Last Verified At']
      })) });
    }

    if (resource === 'team') {
      const [saRows] = await readRanges(req, ['SA_Master!A1:L1000']);
      const branchNames = Object.fromEntries(branches.map(row => [row['Branch ID'], row['Branch Name']]));
      const records = rowsToObjects(saRows).filter(row => clean(row.Active).toUpperCase() === 'TRUE' && (session.role === 'ADMIN' || (session.role === 'STAFF' ? clean(row['SA ID']) === clean(session.saId) : session.role === 'BRANCH_MANAGER' ? clean(row['Branch ID']) === clean(session.branchId) : canonicalRegion(row.Region) === session.region))).map(row => ({ id: row['SA ID'], name: row['SA Name'], branch: branchNames[row['Branch ID']] || row['Branch ID'], branchId: row['Branch ID'], region: row.Region, accepting: row['Accepting Leads'], lastAssigned: row['Last Assigned At'] }));
      return res.status(200).json({ live: true, records, branches: branches.filter(row => clean(row.Active).toUpperCase() === 'TRUE' && (session.role === 'ADMIN' || canonicalRegion(row.Region) === session.region)).length });
    }

    if (['inbox', 'outbox', 'activity'].includes(resource)) {
      const cfg = resource === 'inbox' ? ['Customer_Inbox!A1:Z1000', 'Message ID'] : resource === 'outbox' ? ['Message_Outbox!A1:Z1200', 'Outbox ID'] : ['Activity_Log!A1:Z1200', 'Activity ID'];
      const [rows] = await readRanges(req, [cfg[0]]);
      const visible = rowsToObjects(rows).filter(row => session.role === 'ADMIN' || scope.leadIds.has(row['Lead ID']) || scope.applicationIds.has(row['Application ID'])).slice(-300).reverse();
      const leadNames = Object.fromEntries(scope.leads.map(row => [row['Lead ID'], row['Customer Name']]));
      const leadOwners = Object.fromEntries(scope.leads.map(row => [row['Lead ID'], row['Assigned SA ID']]));
      const applicationOwners = Object.fromEntries(scope.applications.map(row => [row['Application ID'], row['Assigned SA ID']]));
      const records = visible.map(row => resource === 'inbox' ? ({ id: row['Message ID'], customer: leadNames[row['Lead ID']] || row['Phone Number'], leadId: row['Lead ID'], applicationId: row['Application ID'], assignedSa: applicationOwners[row['Application ID']] || leadOwners[row['Lead ID']] || '', phone: row['Phone Number'], message: row['Customer Message'], status: row['Process Status'], time: row['Received At'], attachmentType: row['Attachment Type'], humanRequired: humanStatuses.has(clean(row['Process Status']).toUpperCase()) }) : resource === 'outbox' ? ({ id: row['Outbox ID'], recipient: row['Phone Number'], leadId: row['Lead ID'], applicationId: row['Application ID'], message: row['Message Text'] || row['Template Name'], status: row['Send Status'], time: row['Sent At'] || row['Created At'], manual: clean(row['Send Routing Status']).toUpperCase() === 'WHATSAPP_BUSINESS_MANUAL' || clean(row['Send Status']).toUpperCase() === 'MANUAL_PENDING' }) : ({ id: row['Activity ID'], leadId: row['Lead ID'], applicationId: row['Application ID'], type: row['Activity Type'], description: row.Description, actor: row['Actor ID'] || 'System', status: row['Activity Status'] || 'COMPLETED', time: row['Activity At'] }));
      return res.status(200).json({ live: true, records });
    }

    const [inboxRows, outboxRows, dashboardDocumentRows] = await readRanges(req, ['Customer_Inbox!A1:Z1000', 'Message_Outbox!A1:Z1200', 'Document_Log!A1:Y1500']);
    const inbox = rowsToObjects(inboxRows).filter(row => session.role === 'ADMIN' || scope.leadIds.has(row['Lead ID']));
    const outbox = rowsToObjects(outboxRows).filter(row => session.role === 'ADMIN' || scope.leadIds.has(row['Lead ID']) || scope.applicationIds.has(row['Application ID']));
    const dashboardDocuments = rowsToObjects(dashboardDocumentRows).filter(row => scope.applicationIds.has(row['Application ID']) || scope.leadIds.has(row['Lead ID']));
    const documentsByApplication = new Map();
    dashboardDocuments.forEach(row => { const key = row['Application ID']; if (key) documentsByApplication.set(key, [...(documentsByApplication.get(key) || []), row]); });
    const completed = count(scope.applications, 'Application Status', 'COMPLETED');
    const aiExceptions = scope.applications.filter(row => {
      const mode = clean(row['Processing Mode']).toUpperCase();
      return clean(row['Application Status']).toUpperCase() === 'MANUAL_REVIEW' || clean(row['SA Review Required']).toUpperCase() === 'TRUE' || ['AI_TO_SA_HANDOVER', 'AI_EXCEPTION_TO_STAFF', 'AI_EXCEPTION_STAFF_MANUAL'].includes(mode);
    }).length;
    const lmsReady = scope.applications.filter(row => ['READY_FOR_LMS', 'READY', 'QUEUED'].includes(clean(row['LMS Submission Status']).toUpperCase()) || clean(row['Minimum Documents Complete']).toUpperCase() === 'TRUE' || documentSummary(documentsByApplication.get(row['Application ID']) || []).aiComplete).length;
    const humanHandovers = inbox.filter(row => humanStatuses.has(clean(row['Process Status']).toUpperCase())).length;
    const needsAttention = aiExceptions + count(scope.applications, 'Current Stage', 'RECOVERY_PENDING') + count(outbox, 'Send Status', 'FAILED') + humanHandovers;
    return res.status(200).json({ live: true, updatedAt: new Date().toISOString(), summary: { leads: scope.leads.length, applications: scope.applications.length, conversion: scope.leads.length ? scope.applications.length / scope.leads.length : 0, needsAttention, completed, humanHandovers, aiExceptions, lmsReady, unreadInbox: inbox.filter(row => ['NEW', 'ERROR', 'HUMAN_HANDOVER_REQUIRED', 'ASSIGNED_TO_STAFF'].includes(clean(row['Process Status']).toUpperCase())).length } });
  } catch (error) {
    console.error(error);
    return res.status(503).json({ live: false, error: 'CRM data connection is not configured yet.' });
  }
}
