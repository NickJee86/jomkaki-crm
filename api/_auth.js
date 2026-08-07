import crypto from 'node:crypto';

const COOKIE_NAME = 'jomkaki_crm_session';
const safeEqual = (left, right) => {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
const sign = payload => crypto.createHmac('sha256', process.env.CRM_SESSION_SECRET || '').update(payload).digest('base64url');
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const passwordHash = value => crypto.createHash('sha256').update(String(value || '')).digest('hex');
const staffAccounts = () => {
  try {
    const rows = JSON.parse(process.env.CRM_STAFF_ACCOUNTS_JSON || '[]');
    return Array.isArray(rows) ? rows.map(row => ({ ...row, role: 'STAFF' })) : [];
  } catch { return []; }
};
const accountList = () => [
  { username: process.env.CRM_ADMIN_USERNAME || 'admin', password: process.env.CRM_ACCESS_PASSWORD, role: 'ADMIN', region: 'ALL', name: process.env.CRM_ADMIN_NAME || 'Nick Jee' },
  { username: process.env.CRM_EAST_MANAGER_USERNAME, password: process.env.CRM_EAST_MANAGER_PASSWORD, role: 'REGION_MANAGER', region: 'EAST_MALAYSIA', name: process.env.CRM_EAST_MANAGER_NAME || 'East Malaysia Manager' },
  { username: process.env.CRM_WEST_MANAGER_USERNAME, password: process.env.CRM_WEST_MANAGER_PASSWORD, role: 'REGION_MANAGER', region: 'WEST_MALAYSIA', name: process.env.CRM_WEST_MANAGER_NAME || 'West Malaysia Manager' },
  ...staffAccounts()
].filter(account => account.username && (account.password || account.passwordHash));
const normaliseRegion = value => ['SARAWAK', 'SABAH', 'LABUAN', 'EAST MALAYSIA', 'EAST_MALAYSIA'].includes(String(value || '').trim().toUpperCase()) ? 'EAST_MALAYSIA' : String(value || '').trim().toUpperCase();

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

export function authenticate(username, password) {
  const wanted = String(username || 'admin').trim().toLowerCase();
  return accountList().find(account => account.username.toLowerCase() === wanted && (account.passwordHash ? safeEqual(passwordHash(password), account.passwordHash) : safeEqual(password || '', account.password))) || false;
}

export function setSession(res, account) {
  const payload = encode({ username: account.username, name: account.name, role: account.role, region: account.region, saId: account.saId || '', branchId: account.branchId || '', exp: Date.now() + 28800000 });
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(`${payload}.${sign(payload)}`)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800`);
}

export function clearSession(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
}
