import { authenticate, setSession } from './_auth.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  const account = await authenticate(req, req.body?.username, req.body?.password);
  if (!account) return res.status(401).json({ ok: false, error: 'Incorrect username or password.' });
  setSession(res, account);
  return res.status(200).json({ ok: true, user: { name: account.name, role: account.role, region: account.region } });
}
