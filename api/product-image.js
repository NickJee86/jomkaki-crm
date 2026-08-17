import { getAccessToken } from './_auth.js';

const clean = value => String(value ?? '').trim();
const SHEET_ID = process.env.JOMKAKI_SPREADSHEET_ID;

async function sharePointToken() {
  const tenant = clean(process.env.SHAREPOINT_TENANT_ID), client = clean(process.env.SHAREPOINT_CLIENT_ID), secret = clean(process.env.SHAREPOINT_CLIENT_SECRET);
  if (!tenant || !client || !secret) throw new Error('Product image storage is unavailable');
  const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: client, client_secret: secret, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' })
  });
  if (!response.ok) throw new Error('Product image storage authentication failed');
  return (await response.json()).access_token;
}

async function graph(token, path) {
  const response = await fetch(`https://graph.microsoft.com/v1.0${path}`, { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error('Product image could not be retrieved');
  return response;
}

async function catalogRecord(req, businessUnit, catalogId) {
  const token = await getAccessToken(req);
  if (!token || !SHEET_ID) throw new Error('Product catalog is unavailable');
  const sheet = businessUnit === 'HANDPHONE' ? 'Handphone_Model_Catalog' : 'Motor_Model_Catalog';
  const range = encodeURIComponent(`${sheet}!A1:AD1000`);
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}`, { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error('Product catalog could not be read');
  const [headers = [], ...values] = (await response.json()).values || [];
  return values.map(row => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? '']))).find(row => clean(row['Catalog ID']) === catalogId);
}

export default async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') return res.status(405).send('Method not allowed');
  const businessUnit = clean(req.query?.businessUnit).toUpperCase(), catalogId = clean(req.query?.catalogId);
  if (!['MOTOR', 'HANDPHONE'].includes(businessUnit) || !catalogId || catalogId.length > 160) return res.status(400).send('Invalid product image request');
  try {
    const record = await catalogRecord(req, businessUnit, catalogId);
    const fileId = clean(record?.['Image File ID']);
    if (!record || !fileId) return res.status(404).send('Product image not found');
    const token = await sharePointToken();
    const host = clean(process.env.SHAREPOINT_HOSTNAME) || 'rexmgt.sharepoint.com';
    const sitePath = clean(process.env.SHAREPOINT_SITE_PATH) || '/sites/JomkakiMotorSecureDocuments';
    const libraryName = clean(process.env.SHAREPOINT_LIBRARY_NAME) || 'Documents';
    const siteResponse = await graph(token, `/sites/${host}:${sitePath}?$select=id`), site = await siteResponse.json();
    const drivesResponse = await graph(token, `/sites/${site.id}/drives?$select=id,name,driveType`), drives = await drivesResponse.json();
    const drive = (drives.value || []).find(item => clean(item.name).toLowerCase() === libraryName.toLowerCase()) || (drives.value || []).find(item => item.driveType === 'documentLibrary');
    if (!drive) throw new Error('Product image library was not found');
    const fileResponse = await graph(token, `/drives/${drive.id}/items/${encodeURIComponent(fileId)}/content`);
    const bytes = Buffer.from(await fileResponse.arrayBuffer());
    if (!bytes.length || bytes.length > 5 * 1024 * 1024) throw new Error('Product image is invalid');
    res.setHeader('Content-Type', clean(record['Image MIME Type']) || clean(fileResponse.headers.get('content-type')) || 'image/jpeg');
    res.setHeader('Content-Length', String(bytes.length));
    res.setHeader('Content-Disposition', `inline; filename="${catalogId.replace(/[^A-Za-z0-9_-]/g, '')}-product-photo"`);
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800');
    return res.status(200).send(bytes);
  } catch {
    return res.status(502).send('Product image is temporarily unavailable');
  }
}
