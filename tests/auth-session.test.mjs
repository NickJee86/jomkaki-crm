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

const headers = ['Account ID','Username','Display Name','Role','SA ID','Branch ID','Region','Status','Access Scope','Login Enabled','Last Verified','Notes','Password Hash','Must Change Password','Failed Login Attempts','Locked Until','Last Password Reset','Updated At','Business Access'];
globalThis.fetch = async url => {
  const target = String(url);
  if (target.includes('sts.googleapis.com')) return new Response(JSON.stringify({ access_token: 'federated' }), { status: 200 });
  if (target.includes('generateAccessToken')) return new Response(JSON.stringify({ accessToken: 'google-token' }), { status: 200 });
  if (target.includes('/values/CRM_User_Access')) {
    const row = ['STAFF-1','staff.one','Staff One','STAFF','SA-1','BR-1','EAST_MALAYSIA',enabled?'ACTIVE':'DISABLED','Own customers',enabled?'TRUE':'FALSE','','',passwordHash,'FALSE','0','','',authVersion,'BOTH'];
    return new Response(JSON.stringify({ values: [headers, row] }), { status: 200 });
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

enabled = false;
assert.equal(await auth.validateSession(request, signed), false, 'disabled account must invalidate an existing session');
enabled = true;
authVersion = '2026-08-07T11:00:00.000Z';
assert.equal(await auth.validateSession(request, signed), false, 'password reset or account edit must invalidate an older session version');

console.log('auth-session tests passed');
