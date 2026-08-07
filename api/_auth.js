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
  { username: process.env.CRM_ADMIN_USERNAME || 'admin', password: process.env.CRM_ACCESS_PASSWORD, role: 'ADMIN', region: 'ALL', name: process.env.CRM_ADMIN_NAME || 'Nick Jee' },
  { username: process.env.CRM_EAST_MANAGER_USERNAME, password: process.env.CRM_EAST_MANAGER_PASSWORD, role: 'REGION_MANAGER', region: 'EAST_MALAYSIA', name: process.env.CRM_EAST_MANAGER_NAME || 'East Malaysia Manager' },
  { username: process.env.CRM_WEST_MANAGER_USERNAME, password: process.env.CRM_WEST_MANAGER_PASSWORD, role: 'REGION_MANAGER', region: 'WEST_MALAYSIA', name: process.env.CRM_WEST_MANAGER_NAME || 'West Malaysia Manager' },
  ...staffAccounts()
].filter(account => account.username && (account.password || account.passwordHash));

async function getAccessToken(req) {
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

async function dynamicAccounts(req) {
  try {
    const token = await getAccessToken(req);
    if (!token) return [];
    const range = encodeURIComponent('CRM_User_Access!A1:R1000');
    const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}`, { headers: { authorization: `Bearer ${token}` } });
    if (!response.ok) return [];
    const [headers = [], ...rows] = (await response.json()).values || [];
    return rows.map(row => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? '']))).filter(row => clean(row.Status).toUpperCase() === 'ACTIVE' && clean(row['Login Enabled']).toUpperCase() === 'TRUE' && row.Username && row['Password Hash']).map(row => ({
      username: row.Username, passwordHash: row['Password Hash'], role: clean(row.Role).toUpperCase(), region: normaliseRegion(row.Region), name: row['Display Name'], saId: row['SA ID'], branchId: row['Branch ID'], mustChangePassword: clean(row['Must Change Password']).toUpperCase() === 'TRUE'
    }));
  } catch { return []; }
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
  const dynamic = await dynamicAccounts(req);
  const dynamicAccount = dynamic.find(account => account.username.toLowerCase() === wanted && verifyPassword(password, account.passwordHash));
  if (dynamicAccount) return dynamicAccount;
  return environmentAccounts().find(account => account.username.toLowerCase() === wanted && (account.passwordHash ? verifyPassword(password, account.passwordHash) : safeEqual(password || '', account.password))) || false;
}

export function setSession(res, account) {
  const payload = encode({ username: account.username, name: account.name, role: account.role, region: account.region, saId: account.saId || '', branchId: account.branchId || '', mustChangePassword: !!account.mustChangePassword, exp: Date.now() + 28800000 });
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(`${payload}.${sign(payload)}`)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800`);
}

export function clearSession(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
}
