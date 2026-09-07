import { getAccessToken } from './_auth.js';

const clean = value => String(value ?? '').trim();
const truth = value => ['TRUE', 'YES', '1', 'Y'].includes(clean(value).toUpperCase());
const SHEET_ID = process.env.JOMKAKI_SPREADSHEET_ID;
const MAX_PRODUCT_IMAGE_BYTES = 5 * 1024 * 1024;

export function validProductImageBytes(bytes, contentType) {
  const type = clean(contentType).toLowerCase().split(';')[0];
  if (type === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === 'image/png') return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (type === 'image/webp') return bytes.length >= 12 && bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
  return false;
}

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
    const approvalStatus = clean(record?.['Approval Status']).toUpperCase() || (clean(record?.['Submitted By']) ? 'PENDING_APPROVAL' : 'APPROVED');
    if (!record || approvalStatus !== 'APPROVED' || !truth(record.Active) || !truth(record['Image Approved']) || !fileId) return res.status(404).send('Product image not found');
    const token = await sharePointToken();
    const host = clean(process.env.SHAREPOINT_HOSTNAME) || 'rexmgt.sharepoint.com';
    const sitePath = clean(process.env.SHAREPOINT_SITE_PATH) || '/sites/JomKakiRiderSecureDocuments';
    const libraryName = clean(process.env.SHAREPOINT_LIBRARY_NAME) || 'Documents';
    const siteResponse = await graph(token, `/sites/${host}:${sitePath}?$select=id`), site = await siteResponse.json();
    const drivesResponse = await graph(token, `/sites/${site.id}/drives?$select=id,name,driveType`), drives = await drivesResponse.json();
    const drive = (drives.value || []).find(item => clean(item.name).toLowerCase() === libraryName.toLowerCase()) || (drives.value || []).find(item => item.driveType === 'documentLibrary');
    if (!drive) throw new Error('Product image library was not found');
    const fileResponse = await graph(token, `/drives/${drive.id}/items/${encodeURIComponent(fileId)}/content`);
    const declaredLength = Number(fileResponse.headers.get('content-length') || 0);
    if (declaredLength > MAX_PRODUCT_IMAGE_BYTES) throw new Error('Product image is too large');
    const bytes = Buffer.from(await fileResponse.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_PRODUCT_IMAGE_BYTES) throw new Error('Product image is invalid');
    const contentType = (clean(record['Image MIME Type']) || clean(fileResponse.headers.get('content-type'))).toLowerCase().split(';')[0];
    if (!validProductImageBytes(bytes, contentType)) throw new Error('Product image type is invalid');
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', String(bytes.length));
    res.setHeader('Content-Disposition', `inline; filename="${catalogId.replace(/[^A-Za-z0-9_-]/g, '')}-product-photo"`);
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800');
    return res.status(200).send(bytes);
  } catch {
    return res.status(502).send('Product image is temporarily unavailable');
  }
}
