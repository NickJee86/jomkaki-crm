import { getSession } from './_auth.js';

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
    body: JSON.stringify({ scope: ['https://www.googleapis.com/auth/spreadsheets.readonly'], lifetime: '3600s' })
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

function rowsToObjects(rows) {
  const [headers = [], ...data] = rows;
  return data.filter(row => row.some(Boolean)).map(row => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ''])));
}

function scopeData(session, leads, applications, branches) {
  if (session.role === 'ADMIN') return { leads, applications, leadIds: new Set(leads.map(x => x['Lead ID'])), applicationIds: new Set(applications.map(x => x['Application ID'])) };
  const branchRegion = Object.fromEntries(branches.map(row => [row['Branch ID'], canonicalRegion(row.Region)]));
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
  if (req.method !== 'GET') return res.status(405).json({ live: false, error: 'CRM is read-only.' });
  const resource = req.query.resource || 'dashboard';
  if (resource === 'session') return res.status(200).json({ live: true, user: { name: session.name, username: session.username, role: session.role, region: session.region } });
  try {
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
        return { id: row['Application ID'], leadId: row['Lead ID'], customer: row['Applicant Name'] || row['Lead ID'] || 'Unknown customer', region: zone,
          stage: row['Current Stage'] || row['Application Status'], status: row['Application Status'], sa: row['Assigned SA ID'] || 'Unassigned', phone: row['Phone Number'],
          product: [row['Product Brand'], row['Product Model'], row['Product Variant'] || row.Variant].filter(Boolean).join(' '), brand: row['Product Brand'], model: row['Product Model'], variant: row['Product Variant'] || row.Variant,
          tenure, deposit: customerAmount(quote['Effective Deposit (RM)'] || quote['Deposit (RM)']), monthly: customerAmount(monthly), priceZone: quote['Price Zone'], promotion: quote['Promotion Name'],
          branch: row['Assigned Branch ID'], reviewRequired: row['SA Review Required'], nextFollowUp: row['Next Follow Up At'], documentStatus: row['Document Status'], minimumDocumentsComplete: row['Minimum Documents Complete'],
          missingDocuments: row['Missing Documents'], documentsReceived: docs.count, documentTypes: docs.types, documentNeedsReview: docs.needsReview, documentUpdated: docs.latest,
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
      const records = rowsToObjects(saRows).filter(row => clean(row.Active).toUpperCase() === 'TRUE' && (session.role === 'ADMIN' || canonicalRegion(row.Region) === session.region)).map(row => ({ id: row['SA ID'], name: row['SA Name'], branch: branchNames[row['Branch ID']] || row['Branch ID'], region: row.Region, accepting: row['Accepting Leads'], lastAssigned: row['Last Assigned At'] }));
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
