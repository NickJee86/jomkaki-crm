import crypto from 'node:crypto';

const clean = value => String(value ?? '').trim();
const credentialPrefix = value => clean(value).toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');

const secureEqual = (left, right) => {
  const a = Buffer.from(clean(left));
  const b = Buffer.from(clean(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

export function verifyMediaProxyQuery(query = {}, secret = process.env.META_APP_SECRET, nowSeconds = Math.floor(Date.now() / 1000)) {
  const id = clean(query.id), channel = clean(query.channel), credential = credentialPrefix(query.credential), expires = Number(query.expires), signature = clean(query.signature);
  if (!id || !channel || !credential || !Number.isFinite(expires) || expires < nowSeconds || expires > nowSeconds + 86400 || !signature || !clean(secret)) return { valid: false };
  const expected = crypto.createHmac('sha256', clean(secret)).update(`${id}|${channel}|${credential}|${expires}`).digest('hex');
  return secureEqual(signature, expected) ? { valid: true, id, channel, credential, expires } : { valid: false };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') return res.status(405).send('Method not allowed');
  const verified = verifyMediaProxyQuery(req.query || {});
  if (!verified.valid) return res.status(403).send('Invalid or expired media link');
  const accessToken = clean(process.env[`${verified.credential}_ACCESS_TOKEN`]);
  if (!accessToken) return res.status(503).send('WhatsApp media route unavailable');
  try {
    const version = clean(process.env.WHATSAPP_GRAPH_VERSION || 'v26.0');
    const metadataResponse = await fetch(`https://graph.facebook.com/${version}/${encodeURIComponent(verified.id)}`, { headers: { authorization: `Bearer ${accessToken}` } });
    if (!metadataResponse.ok) return res.status(502).send('Unable to retrieve WhatsApp media metadata');
    const metadata = await metadataResponse.json();
    if (!/^https:\/\//i.test(clean(metadata.url))) return res.status(502).send('WhatsApp media URL unavailable');
    const fileResponse = await fetch(metadata.url, { headers: { authorization: `Bearer ${accessToken}` } });
    if (!fileResponse.ok) return res.status(502).send('Unable to download WhatsApp media');
    const bytes = Buffer.from(await fileResponse.arrayBuffer());
    res.setHeader('Content-Type', clean(metadata.mime_type || fileResponse.headers.get('content-type') || 'application/octet-stream'));
    res.setHeader('Content-Length', String(bytes.length));
    res.setHeader('Content-Disposition', `inline; filename="whatsapp-${verified.id.replace(/[^A-Za-z0-9_-]/g, '')}"`);
    return res.status(200).send(bytes);
  } catch {
    return res.status(502).send('WhatsApp media download failed');
  }
}
