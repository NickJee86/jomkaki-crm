import crypto from 'node:crypto';
import { getSession, hashPassword } from './_auth.js';

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

async function accountRows(req) {
  const [rows] = await readRanges(req, [userSheetRange]);
  return rowsToObjects(rows);
}

function publicAccount(row) {
  return { id: row['Account ID'], username: row.Username, name: row['Display Name'], role: row.Role, saId: row['SA ID'], branchId: row['Branch ID'], region: row.Region, status: row.Status, access: row['Access Scope'], loginEnabled: clean(row['Login Enabled']).toUpperCase() === 'TRUE', mustChangePassword: clean(row['Must Change Password']).toUpperCase() === 'TRUE', lastVerified: row['Last Verified'], lastPasswordReset: row['Last Password Reset'], notes: row.Notes };
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

function scopeData(session, leads, applications, branches) {
  if (session.role === 'ADMIN') return { leads, applications, leadIds: new Set(leads.map(x => x['Lead ID'])), applicationIds: new Set(applications.map(x => x['Application ID'])) };
  const branchRegion = Object.fromEntries(branches.map(row => [row['Branch ID'], canonicalRegion(row.Region)]));
  if (session.role === 'STAFF') {
    const scopedLeads = leads.filter(row => clean(row['Assigned SA ID']) === clean(session.saId));
    const leadIds = new Set(scopedLeads.map(row => row['Lead ID']));
    const scopedApplications = applications.filter(row => clean(row['Assigned SA ID']) === clean(session.saId) || leadIds.has(row['Lead ID']));
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
const documentSummary = documents => {
  const received = documents.filter(row => clean(row['Document Type']));
  const types = [...new Set(received.map(row => row['Document Type']).filter(Boolean))];
  const needsReview = received.some(row => clean(row['Manual Review Required']).toUpperCase() === 'TRUE' || ['POOR', 'BLURRY', 'FAILED'].includes(clean(row['Quality Status']).toUpperCase()));
  return { count: received.length, types, needsReview, latest: received.map(x => x['Updated At'] || x['Received At']).filter(Boolean).sort().at(-1) || '' };
};

export default async function handler(req, res) {
  const session = getSession(req);
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Vary', 'Cookie');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (!session) return res.status(401).json({ live: false, error: 'Authentication required.' });
  if (req.method === 'POST') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const action = clean(body.action);
      if (['createUser', 'resetUserPassword', 'setUserEnabled'].includes(action)) {
        if (session.role !== 'ADMIN') return res.status(403).json({ live: false, error: 'Administrator access is required.' });
        const users = await accountRows(req);
        if (action === 'createUser') {
          const username = clean(body.username).toLowerCase(), name = clean(body.name), role = clean(body.role).toUpperCase();
          const region = role === 'ADMIN' ? 'ALL' : canonicalRegion(body.region);
          if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw new Error('Username must be 3–40 letters, numbers, dots, dashes or underscores');
          if (!name || !['ADMIN', 'REGION_MANAGER', 'BRANCH_MANAGER', 'STAFF'].includes(role)) throw new Error('Name and a valid role are required');
          if (users.some(row => clean(row.Username).toLowerCase() === username)) throw new Error('This username already exists');
          if (role !== 'ADMIN' && !['EAST_MALAYSIA', 'WEST_MALAYSIA'].includes(region)) throw new Error('A valid region is required');
          if (role === 'STAFF' && !clean(body.saId)) throw new Error('Staff accounts require an SA ID');
          const password = clean(body.password) || temporaryPassword();
          if (password.length < 10) throw new Error('Temporary password must contain at least 10 characters');
          const accountId = `${role.replace('_MANAGER', '').replace('REGION', 'REG')}-${Date.now()}`;
          await appendObject(req, 'CRM_User_Access', {
            'Account ID': accountId, Username: username, 'Display Name': name, Role: role, 'SA ID': clean(body.saId), 'Branch ID': clean(body.branchId), Region: region,
            Status: 'ACTIVE', 'Access Scope': role === 'ADMIN' ? 'All CRM customers, accounts and settings' : role === 'REGION_MANAGER' ? `All ${region.replace('_', ' ')} branches, staff and customers` : role === 'BRANCH_MANAGER' ? 'All staff and customers in own branch' : 'Customers and follow-ups assigned to own SA ID',
            'Login Enabled': 'TRUE', 'Last Verified': now().slice(0, 10), Notes: 'Created in CRM by Admin', 'Password Hash': hashPassword(password), 'Must Change Password': 'TRUE', 'Failed Login Attempts': '0', 'Locked Until': '', 'Last Password Reset': now(), 'Updated At': now()
          });
          await writeActivity(req, session, { type: 'CRM_USER_CREATED', description: `${role} account ${username} created` });
          return res.status(201).json({ live: true, accountId, temporaryPassword: password });
        }
        const accountId = clean(body.accountId), record = users.find(row => clean(row['Account ID']) === accountId);
        if (!record) throw new Error('User account was not found');
        if (record.Username === session.username && action === 'setUserEnabled' && clean(body.enabled).toUpperCase() !== 'TRUE') throw new Error('You cannot disable your own signed-in account');
        if (action === 'resetUserPassword') {
          const password = clean(body.password) || temporaryPassword();
          if (password.length < 10) throw new Error('Temporary password must contain at least 10 characters');
          await updateObject(req, 'CRM_User_Access', 'Account ID', accountId, { 'Password Hash': hashPassword(password), 'Must Change Password': 'TRUE', 'Failed Login Attempts': '0', 'Locked Until': '', 'Last Password Reset': now(), 'Updated At': now() }, 'R');
          await writeActivity(req, session, { type: 'CRM_USER_PASSWORD_RESET', description: `Password reset for ${record.Username}` });
          return res.status(200).json({ live: true, temporaryPassword: password });
        }
        const enabled = clean(body.enabled).toUpperCase() === 'TRUE';
        await updateObject(req, 'CRM_User_Access', 'Account ID', accountId, { Status: enabled ? 'ACTIVE' : 'DISABLED', 'Login Enabled': enabled ? 'TRUE' : 'FALSE', 'Updated At': now() }, 'R');
        await writeActivity(req, session, { type: enabled ? 'CRM_USER_ENABLED' : 'CRM_USER_DISABLED', description: `${record.Username} ${enabled ? 'enabled' : 'disabled'}` });
        return res.status(200).json({ live: true, accountId, enabled });
      }
      if (action === 'createApplication') {
        const customerName = clean(body.customerName), phone = clean(body.phone), brand = clean(body.brand), model = clean(body.model);
        const requestedRegion = canonicalRegion(body.region);
        if (!customerName || !phone || !brand || !model || !['EAST_MALAYSIA', 'WEST_MALAYSIA'].includes(requestedRegion)) throw new Error('Customer, phone, region, brand and model are required');
        if (session.role !== 'ADMIN' && requestedRegion !== session.region) return res.status(403).json({ live: false, error: 'This region is outside your access.' });
        const leadId = makeId('LEAD'), applicationId = makeId('APP'), timestamp = now();
        const assignedSaId = session.role === 'STAFF' ? session.saId : clean(body.saId);
        const assignedBranchId = session.role === 'STAFF' ? session.branchId : clean(body.branchId);
        await appendObject(req, 'Leads', {
          'Lead ID': leadId, 'Created At': timestamp, 'Updated At': timestamp, 'Customer Name': customerName, 'Phone Number': phone,
          Region: requestedRegion, State: clean(body.state), 'City or Area': clean(body.city), 'Lead Status': 'NEW', 'Lead Source': 'CRM_MANUAL',
          'Assigned SA ID': assignedSaId, 'Selected Branch ID': assignedBranchId, 'Next Follow Up At': clean(body.nextFollowUp), Notes: clean(body.notes), 'Created By': session.username
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
          'Application Status': 'DRAFT', 'Current Stage': 'DOCUMENT_COLLECTION', 'Assigned Branch ID': assignedBranchId, 'Assigned SA ID': assignedSaId,
          'Document Status': 'PENDING', 'Minimum Documents Complete': 'FALSE', 'Missing Documents': clean(body.missingDocuments) || 'IC_FRONT, IC_BACK, INCOME_PROOF',
          'SA Review Required': 'TRUE', 'Next Follow Up At': clean(body.nextFollowUp), 'Created By': session.username, 'Updated By': session.username
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
          'Classification Status': 'MANUAL', 'Quality Status': 'PENDING_REVIEW', 'Verification Status': 'PENDING', 'Duplicate Status': 'NOT_CHECKED',
          'Manual Review Required': 'TRUE', Remarks: clean(body.remarks), 'Uploaded By': session.username
        });
        await writeActivity(req, session, { leadId, applicationId, type: 'CRM_DOCUMENT_UPLOADED', description: `${documentType} uploaded for manual review` });
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
        const stage = clean(body.stage).toUpperCase(), status = clean(body.status).toUpperCase();
        const saId = session.role === 'STAFF' ? session.saId : clean(body.saId);
        const branchId = session.role === 'STAFF' ? session.branchId : clean(body.branchId);
        if (!stages.includes(stage) || !statuses.includes(status)) throw new Error('A valid stage and status are required');
        const branchRegion = Object.fromEntries(branches.map(row => [clean(row['Branch ID']), canonicalRegion(row.Region)]));
        if (branchId && (!branchRegion[branchId] || (session.role !== 'ADMIN' && branchRegion[branchId] !== session.region))) throw new Error('The selected branch is outside your access');
        if (saId) {
          const advisor = salesAdvisors.find(row => clean(row['SA ID']) === saId && clean(row.Active).toUpperCase() === 'TRUE');
          if (!advisor || (session.role !== 'ADMIN' && canonicalRegion(advisor.Region) !== session.region)) throw new Error('The selected sales advisor is outside your access');
        }
        await updateObject(req, 'Applications', 'Application ID', applicationId, {
          'Updated At': now(), 'Current Stage': stage, 'Application Status': status, 'Assigned SA ID': saId,
          'Assigned Branch ID': branchId, 'Next Follow Up At': clean(body.nextFollowUp), 'Missing Documents': clean(body.missingDocuments),
          'SA Review Required': clean(body.reviewRequired).toUpperCase() === 'TRUE' ? 'TRUE' : 'FALSE', 'Handover Reason': clean(body.handoverReason), 'Updated By': session.username
        });
        await writeActivity(req, session, { leadId: record['Lead ID'], applicationId, type: 'CRM_APPLICATION_UPDATED', description: `Application updated to ${stage} / ${status}` });
        return res.status(200).json({ live: true, applicationId });
      }
      if (action === 'reviewDocument') {
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
        await writeActivity(req, session, { leadId: document['Lead ID'], applicationId: document['Application ID'], type: 'CRM_DOCUMENT_REVIEWED', description: `${document['Document Type'] || 'Document'} marked ${verification}` });
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
      return res.status(400).json({ live: false, error: 'Unsupported CRM action.' });
    } catch (error) {
      console.error(error);
      return res.status(400).json({ live: false, error: error.message || 'Unable to save CRM data.' });
    }
  }
  if (req.method !== 'GET') return res.status(405).json({ live: false, error: 'Method not allowed.' });
  const resource = req.query.resource || 'dashboard';
  if (resource === 'session') return res.status(200).json({ live: true, user: { name: session.name, username: session.username, role: session.role, region: session.region, saId: session.saId || '', branchId: session.branchId || '' } });
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
          tenure, deposit: customerAmount(quote['Effective Deposit (RM)'] || quote['Deposit (RM)']), monthly: customerAmount(monthly), priceZone: quote['Price Zone'], promotion: quote['Promotion Name'],
          branch: row['Assigned Branch ID'], reviewRequired: row['SA Review Required'], nextFollowUp: row['Next Follow Up At'], documentStatus: row['Document Status'], minimumDocumentsComplete: row['Minimum Documents Complete'],
          missingDocuments: row['Missing Documents'], documentsReceived: docs.count, documentTypes: docs.types, documentNeedsReview: docs.needsReview, documentUpdated: docs.latest,
          icMasked: ic ? `******${ic.slice(-4)}` : '', homeAddress: row['Home Address'], email: row.Email,
          employerName: row['Employer Name'], employerAddress: row['Employer Address'], employerPhone: row['Employer Phone'],
          employmentDurationMonths: row['Employment Duration Months'], jobPosition: row['Job Position'], basicSalary: row['Basic Salary'],
          salaryPaymentMethod: row['Salary Payment Method'], occupationCategory: row['Occupation Category'], eligibilityStatus: row['Eligibility Status'], eligibilityReason: row['Eligibility Reason'],
          reference1Name: row['Reference 1 Name'], reference1Phone: row['Reference 1 Phone'], reference1Relationship: row['Reference 1 Relationship'],
          reference2Name: row['Reference 2 Name'], reference2Phone: row['Reference 2 Phone'], reference2Relationship: row['Reference 2 Relationship'],
          bankAccountAvailable: row['Bank Account Available'], directDebitStatus: row['Direct Debit Status'], agreementStatus: row['Agreement Status'],
          lmsCaseId: row['LMS Case ID'], lmsSubmissionStatus: row['LMS Submission Status'], cadStatus: row['CAD Status'], cadRemarks: row['CAD Remarks'],
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
      const records = rowsToObjects(rows).filter(row => clean(row.Active).toUpperCase() === 'TRUE' && clean(row['Quote Approval Status']).toUpperCase() === 'APPROVED' && (session.role === 'ADMIN' || canonicalRegion(row['Price Zone']) === session.region)).map(row => ({
        id: row['Pricing ID'], brand: row.Brand, model: row.Model, variant: row.Variant, zone: row['Price Zone'], deposit: customerAmount(row['Effective Deposit (RM)'] || row['Deposit (RM)']), year3: customerAmount(row['Monthly 3 Years (RM)']), year4: customerAmount(row['Monthly 4 Years (RM)']), year5: customerAmount(row['Monthly 5 Years (RM)']), effective: row['Effective From'], status: 'APPROVED', promotion: row['Promotion Name']
      }));
      return res.status(200).json({ live: true, records });
    }

    if (resource === 'catalog') {
      const [rows] = await readRanges(req, ['Motor_Model_Catalog!A1:Q1000']);
      return res.status(200).json({ live: true, records: rowsToObjects(rows).filter(row => clean(row.Active).toUpperCase() === 'TRUE').map(row => ({ id: row['Catalog ID'], brand: row.Brand, model: row.Model, variant: row.Variant, category: row.Category, fuel: row['Fuel Type'], tier: row['Popularity Tier'], image: clean(row['Image Approved']).toUpperCase() === 'TRUE' ? row['Image URL'] : '', stock: row['Stock Check Mode'] })) });
    }

    if (resource === 'team') {
      const [saRows] = await readRanges(req, ['SA_Master!A1:L1000']);
      const branchNames = Object.fromEntries(branches.map(row => [row['Branch ID'], row['Branch Name']]));
      const records = rowsToObjects(saRows).filter(row => clean(row.Active).toUpperCase() === 'TRUE' && (session.role === 'ADMIN' || (session.role === 'STAFF' ? clean(row['SA ID']) === clean(session.saId) : canonicalRegion(row.Region) === session.region))).map(row => ({ id: row['SA ID'], name: row['SA Name'], branch: branchNames[row['Branch ID']] || row['Branch ID'], branchId: row['Branch ID'], region: row.Region, accepting: row['Accepting Leads'], lastAssigned: row['Last Assigned At'] }));
      return res.status(200).json({ live: true, records, branches: branches.filter(row => clean(row.Active).toUpperCase() === 'TRUE' && (session.role === 'ADMIN' || canonicalRegion(row.Region) === session.region)).length });
    }

    if (['inbox', 'outbox', 'activity'].includes(resource)) {
      const cfg = resource === 'inbox' ? ['Customer_Inbox!A1:Z1000', 'Message ID'] : resource === 'outbox' ? ['Message_Outbox!A1:Z1200', 'Outbox ID'] : ['Activity_Log!A1:Z1200', 'Activity ID'];
      const [rows] = await readRanges(req, [cfg[0]]);
      const visible = rowsToObjects(rows).filter(row => session.role === 'ADMIN' || scope.leadIds.has(row['Lead ID']) || scope.applicationIds.has(row['Application ID'])).slice(-300).reverse();
      const records = visible.map(row => resource === 'inbox' ? ({ id: row['Message ID'], customer: row['Phone Number'], leadId: row['Lead ID'], phone: row['Phone Number'], message: row['Customer Message'], status: row['Process Status'], time: row['Received At'], attachmentType: row['Attachment Type'] }) : resource === 'outbox' ? ({ id: row['Outbox ID'], recipient: row['Phone Number'], leadId: row['Lead ID'], applicationId: row['Application ID'], message: row['Message Text'] || row['Template Name'], status: row['Send Status'], time: row['Sent At'] || row['Created At'] }) : ({ id: row['Activity ID'], leadId: row['Lead ID'], applicationId: row['Application ID'], type: row['Activity Type'], description: row.Description, actor: row['Actor ID'] || 'System', status: row['Activity Status'] || 'COMPLETED', time: row['Activity At'] }));
      return res.status(200).json({ live: true, records });
    }

    const [inboxRows, outboxRows] = await readRanges(req, ['Customer_Inbox!A1:Z1000', 'Message_Outbox!A1:Z1200']);
    const inbox = rowsToObjects(inboxRows).filter(row => session.role === 'ADMIN' || scope.leadIds.has(row['Lead ID']));
    const outbox = rowsToObjects(outboxRows).filter(row => session.role === 'ADMIN' || scope.leadIds.has(row['Lead ID']) || scope.applicationIds.has(row['Application ID']));
    const completed = count(scope.applications, 'Application Status', 'COMPLETED');
    const needsAttention = count(scope.applications, 'Application Status', 'MANUAL_REVIEW') + count(scope.applications, 'Current Stage', 'RECOVERY_PENDING') + count(outbox, 'Send Status', 'FAILED');
    return res.status(200).json({ live: true, updatedAt: new Date().toISOString(), summary: { leads: scope.leads.length, applications: scope.applications.length, conversion: scope.leads.length ? scope.applications.length / scope.leads.length : 0, needsAttention, completed, unreadInbox: inbox.filter(row => ['NEW', 'ERROR'].includes(clean(row['Process Status']).toUpperCase())).length } });
  } catch (error) {
    console.error(error);
    return res.status(503).json({ live: false, error: 'CRM data connection is not configured yet.' });
  }
}
