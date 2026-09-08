import { authenticate, setSession } from './_auth.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  try {
    const account = await authenticate(req, req.body?.username, req.body?.password);
    if (!account) return res.status(401).json({ ok: false, error: 'Incorrect username or password.' });
    setSession(res, account);
    return res.status(200).json({ ok: true, user: { name: account.name, username: account.username, role: account.role, region: account.region, businessAccess: account.businessAccess, saId: account.saId || '', branchId: account.branchId || '', mustChangePassword: !!account.mustChangePassword } });
  } catch (error) {
    console.error('CRM login unavailable', error);
    return res.status(503).json({ ok: false, error: 'Sign-in is temporarily unavailable. Please try again.' });
  }
}
