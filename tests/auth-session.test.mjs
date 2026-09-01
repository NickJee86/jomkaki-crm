import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

process.env.CRM_ACCESS_PASSWORD = 'environment-password';
process.env.CRM_SESSION_SECRET = 'test-session-secret-with-enough-entropy';
process.env.JOMKAKI_SPREADSHEET_ID = 'sheet-test';
process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'crm@example.test';
process.env.GOOGLE_PROJECT_NUMBER = '123456';
process.env.VERCEL_OIDC_TOKEN = 'oidc-test';

const authSource = await fs.readFile(new URL('../api/_auth.js', import.meta.url), 'utf8');
const auth = await import(`data:text/javascript;base64,${Buffer.from(authSource).toString('base64')}`);
const passwordHash = auth.hashPassword('Temporary!123');
let enabled = true;
let authVersion = '2026-08-07T10:00:00.000Z';
let includeLegacyPlaceholder = false;
let includeAdminAccount = false;
let directoryAvailable = true;

const headers = ['Account ID','Username','Display Name','Role','SA ID','Branch ID','Region','Status','Access Scope','Login Enabled','Last Verified','Notes','Password Hash','Must Change Password','Failed Login Attempts','Locked Until','Last Password Reset','Updated At','Business Access'];
globalThis.fetch = async url => {
  const target = String(url);
  if (target.includes('sts.googleapis.com')) return new Response(JSON.stringify({ access_token: 'federated' }), { status: 200 });
  if (target.includes('generateAccessToken')) return new Response(JSON.stringify({ accessToken: 'google-token' }), { status: 200 });
  if (target.includes('/values/CRM_User_Access')) {
    if (!directoryAvailable) return new Response(JSON.stringify({ error: 'temporary outage' }), { status: 503 });
    const row = ['STAFF-1','staff.one','Staff One','STAFF','SA-1','BR-1','EAST_MALAYSIA',enabled?'ACTIVE':'DISABLED','Own customers',enabled?'TRUE':'FALSE','','',passwordHash,'FALSE','0','','',authVersion,'BOTH'];
    const values = [headers, row];
    if (includeAdminAccount) values.push(['ADMIN-1','admin','Production Admin','ADMIN','','','ALL','ACTIVE','All customers','TRUE','','',auth.hashPassword('production-only-password'),'FALSE','0','','','2026-09-01T10:00:00.000Z','BOTH']);
    if (includeLegacyPlaceholder) values.push(['STAFF-LEGACY','legacy.staff','Legacy Staff','STAFF','SA-2','BR-1','EAST_MALAYSIA','ACTIVE','Own customers','TRUE','','Legacy Vercel account','','FALSE','0','','','','BOTH']);
    return new Response(JSON.stringify({ values }), { status: 200 });
  }
  return new Response(JSON.stringify({}), { status: 200 });
};

const responseHeaders = {};
auth.setSession({ setHeader(name, value) { responseHeaders[name] = value; } }, { username: 'staff.one', name: 'Staff One', role: 'STAFF', region: 'EAST_MALAYSIA', saId: 'SA-1', branchId: 'BR-1', authSource: 'sheet', authVersion });
const cookie = responseHeaders['Set-Cookie'].split(';')[0];
const request = { headers: { cookie } };
const signed = auth.getSession(request);
assert.equal(signed.username, 'staff.one');
assert.equal((await auth.validateSession(request, signed)).saId, 'SA-1');
assert.equal((await auth.validateSession(request, signed)).businessAccess, 'BOTH');

directoryAvailable = false;
assert.equal((await auth.validateSession(request, signed)).username, 'staff.one', 'temporary account-directory failure must preserve a valid signed session');
directoryAvailable = true;

enabled = false;
assert.equal(await auth.validateSession(request, signed), false, 'disabled account must invalidate an existing session');
enabled = true;
authVersion = '2026-08-07T11:00:00.000Z';
assert.equal(await auth.validateSession(request, signed), false, 'password reset or account edit must invalidate an older session version');

process.env.CRM_STAFF_ACCOUNTS_JSON = JSON.stringify([{ username: 'legacy.staff', password: 'Legacy!Password123', name: 'Legacy Staff', region: 'EAST_MALAYSIA', saId: 'SA-2', branchId: 'BR-1', businessAccess: 'BOTH' }]);
includeLegacyPlaceholder = true;
const legacyAccount = await auth.authenticate({ headers: {} }, 'legacy.staff', 'Legacy!Password123');
assert.equal(legacyAccount.authSource, 'environment', 'an active placeholder row without a hash must not shadow its Vercel account');
const legacyHeaders = {};
auth.setSession({ setHeader(name, value) { legacyHeaders[name] = value; } }, legacyAccount);
const legacyCookie = legacyHeaders['Set-Cookie'].split(';')[0];
const legacySession = auth.getSession({ headers: { cookie: legacyCookie } });
assert.equal((await auth.validateSession({ headers: { cookie: legacyCookie } }, legacySession)).username, 'legacy.staff', 'a legacy environment session must remain valid while its Sheet row has no hash');

includeAdminAccount = true;
process.env.VERCEL_ENV = 'preview';
const previewAdmin = await auth.authenticate({ headers: {} }, 'admin', 'environment-password');
assert.equal(previewAdmin.authSource, 'environment', 'Preview must accept its isolated administrator credential even when the live Sheet has an admin account');
const previewHeaders = {};
auth.setSession({ setHeader(name, value) { previewHeaders[name] = value; } }, previewAdmin);
const previewCookie = previewHeaders['Set-Cookie'].split(';')[0];
const previewSession = auth.getSession({ headers: { cookie: previewCookie } });
assert.equal((await auth.validateSession({ headers: { cookie: previewCookie } }, previewSession)).authSource, 'environment', 'Preview must preserve its isolated administrator session during CRM data refreshes');
delete process.env.VERCEL_ENV;

console.log('auth-session tests passed');

