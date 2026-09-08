import { clearSession } from './_auth.js';

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  clearSession(res);
  return res.status(200).json({ ok: true });
}

