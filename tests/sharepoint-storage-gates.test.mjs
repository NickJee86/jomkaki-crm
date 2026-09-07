import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assertSharePointCustomerStorageReady, selectSharePointDocumentLibrary } from '../api/_sharepoint.js';

const source = fs.readFileSync(new URL('../api/crm.js', import.meta.url), 'utf8');
const credentials = { SHAREPOINT_TENANT_ID: 'mock-tenant', SHAREPOINT_CLIENT_ID: 'mock-client', SHAREPOINT_CLIENT_SECRET: 'mock-secret' };
const clean = value => String(value ?? '').trim();
const target = { hostname: 'test.invalid', sitePath: '/sites/synthetic', libraryName: 'Documents', drive: { id: 'mock-drive' }, root: { id: 'mock-root' }, site: { id: 'mock-site' } };

function compileAdapter(name, nextMarker, bindings) {
  const start = source.indexOf(`async function ${name}(`), end = source.indexOf(nextMarker, start);
  assert.ok(start >= 0 && end > start, `Cannot locate ${name} adapter`);
  return new Function(...Object.keys(bindings), `return (${source.slice(start, end).trim()});`)(...Object.values(bindings));
}

test('customer-storage gate uses existing credentials and recorded verification marker without changing them', () => {
  assert.throws(() => assertSharePointCustomerStorageReady({}), /credentials are not configured/);
  for (const marker of [undefined, '', '  ']) {
    assert.throws(() => assertSharePointCustomerStorageReady({ ...credentials, SHAREPOINT_SITE_WRITE_VERIFIED_AT: marker }), error => error.code === 'SHAREPOINT_WRITE_VERIFICATION_REQUIRED');
  }
  const env = { ...credentials, SHAREPOINT_SITE_WRITE_VERIFIED_AT: '2026-09-07T04:00:00.000Z' }, before = { ...env };
  const status = assertSharePointCustomerStorageReady(env);
  assert.equal(status.writeVerified, true);
  assert.equal(status.writeVerifiedAt, env.SHAREPOINT_SITE_WRITE_VERIFIED_AT);
  assert.deepEqual(env, before);
  assert.throws(() => assertSharePointCustomerStorageReady({ SHAREPOINT_SITE_WRITE_VERIFIED_AT: '2026-09-07T04:00:00.000Z' }), /credentials are not configured/);
});

test('an explicit library name never falls back to another available document library', () => {
  const documents = { id: 'documents', name: 'Documents', driveType: 'documentLibrary' };
  const confidential = { id: 'confidential', name: 'Confidential', driveType: 'documentLibrary' };
  assert.equal(selectSharePointDocumentLibrary([documents, confidential], ' confidential '), confidential);
  assert.throws(() => selectSharePointDocumentLibrary([documents], 'Missing Library'), /refusing to use a different library/);
  assert.throws(() => selectSharePointDocumentLibrary([], 'Confidential'), /Configured SharePoint document library/);
});

test('unset library configuration retains the existing default discovery behavior', () => {
  const first = { id: 'shared', name: 'Shared Documents', driveType: 'documentLibrary' };
  const documents = { id: 'documents', name: 'Documents', driveType: 'documentLibrary' };
  assert.equal(selectSharePointDocumentLibrary([first, documents]), documents);
  assert.equal(selectSharePointDocumentLibrary([first]), first);
  assert.throws(() => selectSharePointDocumentLibrary([]), /document library was not found/);
});

test('actual customer-upload adapter refuses unverified storage before authentication or write', async () => {
  const operations = [];
  const upload = compileAdapter('uploadDocument', 'async function uploadSecondHandMotorPhoto', {
    process: { env: { ...credentials } }, assertSharePointCustomerStorageReady,
    validateUploadFile: () => ({ bytes: Buffer.from('synthetic'), mimeType: 'application/pdf', safeName: 'synthetic.pdf' }),
    getSharePointToken: async () => { operations.push('authenticate'); return 'mock-token'; },
    resolveSharePointTarget: async () => { operations.push('resolve'); return target; },
    ensureFolder: async () => { operations.push('folder'); return { id: 'mock-folder' }; },
    graph: async () => { operations.push('upload'); return { id: 'mock-file' }; }
  });
  await assert.rejects(upload({}, {}, 'APP-SYNTHETIC-1'), /SHAREPOINT_SITE_WRITE_VERIFIED_AT/);
  assert.deepEqual(operations, []);
});

test('recorded verification allows the adapter through only to the selected synthetic case folder', async () => {
  const folders = [], uploads = [];
  const upload = compileAdapter('uploadDocument', 'async function uploadSecondHandMotorPhoto', {
    process: { env: { ...credentials, SHAREPOINT_SITE_WRITE_VERIFIED_AT: '2026-09-07T04:00:00.000Z' } }, assertSharePointCustomerStorageReady,
    validateUploadFile: () => ({ bytes: Buffer.from('synthetic'), mimeType: 'application/pdf', safeName: 'synthetic.pdf' }),
    getSharePointToken: async () => 'mock-token', resolveSharePointTarget: async () => target,
    ensureFolder: async (_token, driveId, parentId, name) => { folders.push({ driveId, parentId, name }); return { id: `folder-${folders.length}` }; },
    graph: async (_token, url, options) => { uploads.push({ url, options }); return { id: 'mock-file' }; }
  });
  assert.deepEqual(await upload({}, {}, 'APP-SYNTHETIC-1'), { id: 'mock-file' });
  assert.deepEqual(folders, [
    { driveId: 'mock-drive', parentId: 'mock-root', name: 'CRM Customer Documents' },
    { driveId: 'mock-drive', parentId: 'folder-1', name: 'APP-SYNTHETIC-1' }
  ]);
  assert.equal(uploads.length, 1);
  assert.match(uploads[0].url, /\/items\/folder-2:\/synthetic\.pdf:\/content/);
});

test('actual target resolver rejects an explicit missing library before obtaining a storage root', async () => {
  const calls = [];
  const resolve = compileAdapter('resolveSharePointTarget', 'export async function runControlledSharePointWriteTest', {
    clean, process: { env: { SHAREPOINT_LIBRARY_NAME: 'Missing Library' } }, selectSharePointDocumentLibrary,
    graph: async (_token, url) => {
      calls.push(url);
      if (url.includes('/drives?')) return { value: [{ id: 'wrong-drive', name: 'Documents', driveType: 'documentLibrary' }] };
      return { id: 'mock-site' };
    }
  });
  await assert.rejects(resolve('mock-token'), /refusing to use a different library/);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(url => !url.includes('/root')));
});

test('Admin-only controlled verification remains a separate synthetic-write path without setting the production marker', async () => {
  const uploads = [], activities = [], env = { ...credentials };
  const verify = compileAdapter('runControlledSharePointWriteTest', 'async function uploadDocument', {
    clean, process: { env }, getSharePointToken: async () => 'mock-token', resolveSharePointTarget: async () => target,
    ensureFolder: async (_token, _drive, _parent, name) => { assert.equal(name, 'CRM Integration Tests'); return { id: 'test-folder' }; },
    graph: async (_token, url, options) => { uploads.push({ url, options }); return { name: 'synthetic-test.txt', webUrl: 'https://test.invalid/synthetic-test.txt' }; },
    writeActivity: async (_req, _session, activity) => { activities.push(activity); }
  });
  const result = await verify({}, { username: 'qa-administrator' });
  assert.equal(uploads.length, 1);
  assert.match(uploads[0].url, /\/items\/test-folder:/);
  assert.equal(uploads[0].options.method, 'PUT');
  assert.match(uploads[0].options.body.toString(), /contains no customer data/);
  assert.equal(activities[0].type, 'CRM_SHAREPOINT_WRITE_TEST_SUCCEEDED');
  assert.ok(result.verifiedAt);
  assert.equal(env.SHAREPOINT_SITE_WRITE_VERIFIED_AT, undefined);
  assert.match(source, /action === 'verifySharePointWrite'\)\s*\{\s*if \(session\.role !== 'ADMIN'\)/);
});
