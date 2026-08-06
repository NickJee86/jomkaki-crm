import { clearSession } from './_auth.js';

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  clearSession(res);
  return res.status(200).json({ ok: true });
}

