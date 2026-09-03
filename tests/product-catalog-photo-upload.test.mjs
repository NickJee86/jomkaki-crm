import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const api = read('../api/crm.js');
const imageApi = read('../api/product-image.js');
const ui = read('../product-business.js');
const css = read('../business-architecture.css');
const html = read('../index.html');

test('Motor and Handphone catalog forms support direct camera or file photo upload', () => {
  assert.match(ui, /Take or choose product photo/);
  assert.match(ui, /name="photo" type="file"/);
  assert.match(ui, /capture="environment"/);
  assert.match(ui, /validateBrowserFile\(photo, \{ imageOnly: true \}\)/);
  assert.match(ui, /uploadProductCatalogImage/);
  assert.match(ui, /imageApproved = 'FALSE'/);
  assert.match(ui, /fileData\(photo\)/);
  assert.match(ui, /productPhotoPreview/);
});

test('Product photos are stored in the dedicated SharePoint catalog folder and remain controlled by approval', () => {
  assert.match(api, /CRM Product Catalog Photos/);
  assert.match(api, /Image File ID/);
  assert.match(api, /validatePublicImageLink/);
  assert.match(api, /not publicly available/);
  assert.match(api, /Image MIME Type/);
  assert.match(api, /pendingApproval \? 'FALSE' : 'TRUE'/);
  assert.match(api, /CATALOG_IMAGE_UPLOADED/);
  assert.match(api, /Use a JPG, PNG or WebP product photo so WhatsApp can display it/);
  assert.match(api, /catalogMax: 'AD'/);
});

test('Public product image route only resolves a catalog-linked SharePoint file', () => {
  assert.match(imageApi, /catalogRecord\(req, businessUnit, catalogId\)/);
  assert.match(imageApi, /record\?\.\['Image File ID'\]/);
  assert.match(imageApi, /items\/\$\{encodeURIComponent\(fileId\)\}\/content/);
  assert.match(imageApi, /Cache-Control.*public/);
  assert.doesNotMatch(imageApi, /req\.query\?\.fileId/);
});

test('Catalog keeps approved, pending and rejected records in separate workflow areas', () => {
  assert.match(ui, /data-catalog-status="APPROVED"/);
  assert.match(ui, /data-catalog-status="PENDING_APPROVAL"/);
  assert.match(ui, /data-catalog-status="REJECTED"/);
  assert.match(ui, /Rejected submissions stay here.*never mix with the live catalog/);
  assert.match(ui, /let selectedStatus = approvedCount/);
  assert.doesNotMatch(ui, /id="catalogApprovalFilter"/);
  assert.match(ui, /Pending photo approval/);
  assert.match(css, /catalog-workflow-tabs/);
  assert.match(css, /catalog-workflow-tab\.rejected\.active/);
  assert.match(css, /product-photo-preview/);
  assert.match(html, /catalog-workflow2/);
});
