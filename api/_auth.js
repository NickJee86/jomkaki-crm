import crypto from 'node:crypto';

const COOKIE_NAME = 'jomkaki_crm_session';
const SHEET_ID = process.env.JOMKAKI_SPREADSHEET_ID;
const CLIENT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const PROJECT_NUMBER = process.env.GOOGLE_PROJECT_NUMBER;
const POOL_ID = process.env.GOOGLE_WIF_POOL_ID || 'vercel-production';
const PROVIDER_ID = process.env.GOOGLE_WIF_PROVIDER_ID || 'vercel-jomkaki-production';
const clean = value => String(value ?? '').trim();
const safeEqual = (left, right) => {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
const sign = payload => crypto.createHmac('sha256', process.env.CRM_SESSION_SECRET || '').update(payload).digest('base64url');
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const legacyPasswordHash = value => crypto.createHash('sha256').update(String(value || '')).digest('hex');
const normaliseRegion = value => ['SARAWAK', 'SABAH', 'LABUAN', 'EAST MALAYSIA', 'EAST_MALAYSIA'].includes(clean(value).toUpperCase()) ? 'EAST_MALAYSIA' : clean(value).toUpperCase();
const normaliseRole = value => clean(value).toUpperCase() === 'BRANCH_MANAGER' ? 'BRANCH_SUPERVISOR' : clean(value).toUpperCase();
const normaliseBusinessAccess = (value, role) => {
  const normalizedRole = normaliseRole(role);
  if (normalizedRole === 'ADMIN' || normalizedRole === 'REGION_MANAGER') return 'BOTH';
  const access = clean(value).toUpperCase();
  if (['MOTOR', 'HANDPHONE', 'BOTH'].includes(access)) return access;
  if (normalizedRole === 'STAFF') return 'BOTH';
  if (normalizedRole === 'BUSINESS_MANAGER') return 'HANDPHONE';
  return 'MOTOR';
};

export function hashPassword(value) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(value || ''), salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(value, stored) {
  const parts = clean(stored).split('$');
  if (parts.length === 3 && parts[0] === 'scrypt') {
    const calculated = crypto.scryptSync(String(value || ''), parts[1], 64).toString('hex');
    return safeEqual(calculated, parts[2]);
  }
  return safeEqual(legacyPasswordHash(value), stored);
}

const staffAccounts = () => {
  try {
    const rows = JSON.parse(process.env.CRM_STAFF_ACCOUNTS_JSON || '[]');
    return Array.isArray(rows) ? rows.map(row => ({ ...row, role: 'STAFF' })) : [];
  } catch { return []; }
};

const environmentAccounts = () => [
  { username: process.env.CRM_ADMIN_USERNAME || 'admin', password: process.env.CRM_ACCESS_PASSWORD, role: 'ADMIN', region: 'ALL', businessAccess: 'BOTH', name: process.env.CRM_ADMIN_NAME || 'Nick Jee' },
  { username: process.env.CRM_EAST_MANAGER_USERNAME, password: process.env.CRM_EAST_MANAGER_PASSWORD, role: 'REGION_MANAGER', region: 'EAST_MALAYSIA', businessAccess: 'BOTH', name: process.env.CRM_EAST_MANAGER_NAME || 'East Malaysia Manager' },
  { username: process.env.CRM_WEST_MANAGER_USERNAME, password: process.env.CRM_WEST_MANAGER_PASSWORD, role: 'REGION_MANAGER', region: 'WEST_MALAYSIA', businessAccess: 'BOTH', name: process.env.CRM_WEST_MANAGER_NAME || 'West Malaysia Manager' },
  ...staffAccounts()
].filter(account => account.username && (account.password || account.passwordHash)).map(account => ({ ...account, role: normaliseRole(account.role), businessAccess: normaliseBusinessAccess(account.businessAccess, account.role), authSource: 'environment', authVersion: 'environment' }));

export async function getAccessToken(req) {
  const oidcToken = req.headers['x-vercel-oidc-token'] || process.env.VERCEL_OIDC_TOKEN;
  if (!oidcToken || !CLIENT_EMAIL || !PROJECT_NUMBER || !SHEET_ID) return '';
  const providerResource = `projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}/providers/${PROVIDER_ID}`;
  const sts = await fetch('https://sts.googleapis.com/v1/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ audience: `//iam.googleapis.com/${providerResource}`, grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange', requested_token_type: 'urn:ietf:params:oauth:token-type:access_token', scope: 'https://www.googleapis.com/auth/cloud-platform', subject_token_type: 'urn:ietf:params:oauth:token-type:jwt', subject_token: oidcToken })
  });
  if (!sts.ok) return '';
  const federatedToken = (await sts.json()).access_token;
  const response = await fetch(`https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(CLIENT_EMAIL)}:generateAccessToken`, {
    method: 'POST', headers: { authorization: `Bearer ${federatedToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ scope: ['https://www.googleapis.com/auth/spreadsheets'], lifetime: '3600s' })
  });
  return response.ok ? (await response.json()).accessToken : '';
}

async function dynamicAccountDirectory(req) {
  try {
    const token = await getAccessToken(req);
    if (!token) return { available: false, accounts: [] };
    const range = encodeURIComponent('CRM_User_Access!A1:S1000');
    const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}`, { headers: { authorization: `Bearer ${token}` } });
    if (!response.ok) return { available: false, accounts: [] };
    const [headers = [], ...rows] = (await response.json()).values || [];
    const accounts = rows.map((values, index) => ({ rowNumber: index + 2, ...Object.fromEntries(headers.map((header, column) => [header, values[column] ?? ''])) })).filter(row => row.Username).map(row => ({
      id: row['Account ID'], username: row.Username, passwordHash: row['Password Hash'], role: normaliseRole(row.Role), region: normaliseRegion(row.Region), businessAccess: normaliseBusinessAccess(row['Business Access'], row.Role), name: row['Display Name'], saId: row['SA ID'], branchId: row['Branch ID'], mustChangePassword: clean(row['Must Change Password']).toUpperCase() === 'TRUE', failedAttempts: Number(row['Failed Login Attempts'] || 0), lockedUntil: row['Locked Until'], rowNumber: row.rowNumber, active: clean(row.Status).toUpperCase() === 'ACTIVE' && clean(row['Login Enabled']).toUpperCase() === 'TRUE', authSource: 'sheet', authVersion: clean(row['Updated At'])
    }));
    return { available: true, accounts };
  } catch { return { available: false, accounts: [] }; }
}

async function dynamicAccounts(req) {
  return (await dynamicAccountDirectory(req)).accounts;
}

export function getSession(req) {
  if (!process.env.CRM_ACCESS_PASSWORD || !process.env.CRM_SESSION_SECRET) return false;
  const cookies = Object.fromEntries(String(req.headers.cookie || '').split(';').map(item => item.trim().split('=').map(decodeURIComponent)).filter(parts => parts.length === 2));
  const [payload, suppliedSignature] = String(cookies[COOKIE_NAME] || '').split('.');
  if (!payload || !suppliedSignature || !safeEqual(suppliedSignature, sign(payload))) return false;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!session.exp || Date.now() > session.exp) return false;
    return { ...session, region: normaliseRegion(session.region) };
  } catch { return false; }
}

export async function authenticate(req, username, password) {
  const wanted = clean(username || 'admin').toLowerCase();
  const environmentAccount = environmentAccounts().find(account => account.username.toLowerCase() === wanted && (account.passwordHash ? verifyPassword(password, account.passwordHash) : safeEqual(password || '', account.password)));
  // Preview deployments need an isolated administrator credential so staging
  // access is not coupled to the live Sheet-backed account directory.
  if (process.env.VERCEL_ENV === 'preview' && environmentAccount?.role === 'ADMIN') return environmentAccount;
  const dynamic = await dynamicAccounts(req);
  const dynamicAccount = dynamic.find(account => account.username.toLowerCase() === wanted);
  if (dynamicAccount?.passwordHash) {
    if (!dynamicAccount.active) return false;
    if (dynamicAccount.lockedUntil && new Date(dynamicAccount.lockedUntil).getTime() > Date.now()) return false;
    const token = await getAccessToken(req);
    if (verifyPassword(password, dynamicAccount.passwordHash)) {
      if (dynamicAccount.failedAttempts || dynamicAccount.lockedUntil) await updateLoginSecurity(token, dynamicAccount.rowNumber, 0, '');
      return dynamicAccount;
    }
    const attempts = dynamicAccount.failedAttempts + 1;
    await updateLoginSecurity(token, dynamicAccount.rowNumber, attempts, attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : '');
    return false;
  }
  if (dynamicAccount && !dynamicAccount.active) return false;
  return environmentAccount || false;
}

export async function validateSession(req, session) {
  if (!session?.username) return false;
  if (process.env.VERCEL_ENV === 'preview' && clean(session.authSource) === 'environment') {
    const previewAccount = environmentAccounts().find(item => item.username.toLowerCase() === clean(session.username).toLowerCase());
    if (previewAccount?.role === 'ADMIN') return session;
  }
  const directory = await dynamicAccountDirectory(req);
  if (!directory.available) {
    // A temporary Google/Sheets outage must not sign out a user who still has a
    // valid, signed and unexpired session cookie. Account changes are enforced
    // again as soon as the directory becomes reachable.
    if (clean(session.authSource) === 'sheet') return { ...session, validationDeferred: true };
    const environment = environmentAccounts().find(item => item.username.toLowerCase() === clean(session.username).toLowerCase());
    return environment ? session : false;
  }
  const account = directory.accounts.find(item => item.username.toLowerCase() === clean(session.username).toLowerCase());
  if (account?.passwordHash) {
    if (!account.active || (account.lockedUntil && new Date(account.lockedUntil).getTime() > Date.now())) return false;
    if (clean(session.authSource) !== 'sheet' || clean(session.authVersion) !== clean(account.authVersion)) return false;
    return { ...session, name: account.name, role: account.role, region: account.region, businessAccess: account.businessAccess, saId: account.saId || '', branchId: account.branchId || '', mustChangePassword: account.mustChangePassword };
  }
  if (account && !account.active) return false;
  if (clean(session.authSource) === 'sheet') return false;
  const environment = environmentAccounts().find(item => item.username.toLowerCase() === clean(session.username).toLowerCase());
  return environment ? session : false;
}

export async function migrateEnvironmentAccounts(req) {
  const token = await getAccessToken(req);
  if (!token) throw new Error('Google Sheets authorization is unavailable');
  const range = encodeURIComponent('CRM_User_Access!A1:S1000');
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}`, { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error('Unable to read CRM accounts');
  const [headers = [], ...rows] = (await response.json()).values || [];
  const existing = new Set(rows.map(row => clean(row[headers.indexOf('Username')]).toLowerCase()).filter(Boolean));
  let migrated = 0;
  for (const account of environmentAccounts()) {
    if (existing.has(clean(account.username).toLowerCase())) continue;
    const timestamp = new Date().toISOString();
    const placeholderIndex = rows.findIndex(row => !clean(row[headers.indexOf('Password Hash')]) && clean(row[headers.indexOf('Role')]).toUpperCase() === clean(account.role).toUpperCase() && normaliseRegion(row[headers.indexOf('Region')]) === normaliseRegion(account.region));
    const object = {
      'Account ID': placeholderIndex >= 0 ? clean(rows[placeholderIndex][headers.indexOf('Account ID')]) || `MIG-${account.role}-${Date.now()}-${migrated + 1}` : `MIG-${account.role}-${Date.now()}-${migrated + 1}`, Username: clean(account.username).toLowerCase(), 'Display Name': account.name, Role: account.role,
      'SA ID': account.saId || '', 'Branch ID': account.branchId || '', Region: account.region, 'Business Access': normaliseBusinessAccess(account.businessAccess, account.role), Status: 'ACTIVE',
      'Access Scope': account.role === 'ADMIN' ? 'All CRM customers, accounts and settings' : account.role === 'REGION_MANAGER' ? `All ${String(account.region).replace('_', ' ')} branches, staff and customers` : 'Customers and follow-ups assigned to own SA ID',
      'Login Enabled': 'TRUE', 'Last Verified': timestamp.slice(0, 10), Notes: 'Migrated from Vercel environment by Admin',
      'Password Hash': account.passwordHash || hashPassword(account.password), 'Must Change Password': 'FALSE', 'Failed Login Attempts': '0', 'Locked Until': '', 'Last Password Reset': timestamp, 'Updated At': timestamp
    };
    const values = headers.map(header => object[header] ?? '');
    const write = placeholderIndex >= 0
      ? await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(`CRM_User_Access!A${placeholderIndex + 2}:S${placeholderIndex + 2}`)}?valueInputOption=USER_ENTERED`, { method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ values: [values] }) })
      : await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent('CRM_User_Access!A:A')}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ values: [values] }) });
    if (!write.ok) throw new Error(`Unable to migrate ${account.username}`);
    existing.add(clean(account.username).toLowerCase());
    migrated += 1;
  }
  return migrated;
}

async function updateLoginSecurity(token, rowNumber, attempts, lockedUntil) {
  if (!token) return;
  const data = [{ range: `CRM_User_Access!O${rowNumber}`, values: [[String(attempts)]] }, { range: `CRM_User_Access!P${rowNumber}`, values: [[lockedUntil]] }];
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values:batchUpdate`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data }) });
}

export function setSession(res, account) {
  const payload = encode({ username: account.username, name: account.name, role: normaliseRole(account.role), region: account.region, businessAccess: normaliseBusinessAccess(account.businessAccess, account.role), saId: account.saId || '', branchId: account.branchId || '', mustChangePassword: !!account.mustChangePassword, authSource: account.authSource || 'environment', authVersion: account.authVersion || 'environment', iat: Date.now(), exp: Date.now() + 28800000 });
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(`${payload}.${sign(payload)}`)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800`);
}

export function clearSession(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
}

