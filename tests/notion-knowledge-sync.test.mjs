import test from 'node:test';
import assert from 'node:assert/strict';
import {
  approvedFilterForProperty,
  auditKnowledgePages,
  blockPlainText,
  buildNotionSnapshot,
  chunkPageContent,
  generatedModule,
  normalizeNotionPage,
  propertyText
} from '../tools/sync-notion-knowledge.mjs';
import fs from 'node:fs';

const runtimeSource = fs.readFileSync(new URL('../api/_jomkaki-knowledge.js', import.meta.url), 'utf8');

const rich = content => [{ type: 'text', plain_text: content, text: { content } }];
const property = (type, value) => type === 'title'
  ? { type, title: rich(value) }
  : type === 'status'
    ? { type, status: { name: value } }
    : type === 'select'
      ? { type, select: { name: value } }
      : { type: 'multi_select', multi_select: value.map(name => ({ name })) };

test('Notion properties and blocks become stable plain text', () => {
  assert.equal(propertyText(property('title', 'KB-FAQ-001 — FAQ')), 'KB-FAQ-001 — FAQ');
  assert.equal(propertyText(property('status', 'Approved')), 'Approved');
  assert.equal(blockPlainText({ type: 'heading_2', heading_2: { rich_text: rich('Eligibility') } }), '# Eligibility');
  assert.equal(blockPlainText({ type: 'bulleted_list_item', bulleted_list_item: { rich_text: rich('No licence may start') } }), '- No licence may start');
});

test('Approved filter follows the live Notion Status property type', () => {
  assert.deepEqual(approvedFilterForProperty({ type: 'select' }), { property: 'Status', select: { equals: 'Approved' } });
  assert.deepEqual(approvedFilterForProperty({ type: 'status' }), { property: 'Status', status: { equals: 'Approved' } });
  assert.throws(() => approvedFilterForProperty({ type: 'rich_text' }), /must be a status or select field/);
});

test('normalized pages retain source identity and split into bounded chunks', () => {
  const page = normalizeNotionPage({
    id: 'page-1',
    url: 'https://notion.so/page-1',
    last_edited_time: '2026-08-21T00:00:00Z',
    properties: {
      Title: property('title', 'KB-ELIGIBILITY-001 — Eligibility'),
      Status: property('status', 'Approved'),
      Category: property('select', 'AI Conversation'),
      Type: property('select', 'Policy'),
      Tags: property('multi_select', ['loan', 'licence'])
    }
  }, `${'# Eligibility\n- Applications may start without a driving licence.\n'.repeat(12)}`);
  assert.equal(page.knowledgeId, 'KB-ELIGIBILITY-001');
  assert.deepEqual(page.tags, ['loan', 'licence']);
  const chunks = chunkPageContent(page, 180);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every(chunk => chunk.text.length <= 220));
});

test('knowledge audit detects the current Consent-policy contradiction', () => {
  const warnings = auditKnowledgePages([
    { pageId: 'a', knowledgeId: 'KB-DOC-001', status: 'Approved', content: 'One or two outstanding documents do not block Consent. This page contains enough approved workflow detail.' },
    { pageId: 'b', knowledgeId: 'KB-TEST-001', status: 'Approved', content: 'Consent form sends only after pre-consent requirements are complete. This is the older test wording.' }
  ]);
  assert.ok(warnings.includes('CONFLICT:CONSENT_TRIGGER_POLICY'));
});

test('runtime excludes test-case knowledge even when an older fallback snapshot contains it', () => {
  assert.match(runtimeSource, /NOTION_SYNCED_KNOWLEDGE\.chunks\.filter\(chunk => !\/\^Test Case\$\/i/);
  assert.match(runtimeSource, /!\/\^KB-TEST-\/i/);
});

test('build sync queries only Approved pages, retrieves content and excludes test cases from runtime chunks', async () => {
  const pages = Array.from({ length: 10 }, (_, index) => {
    const knowledgeId = index === 9 ? 'KB-TEST-001' : `KB-FAQ-${String(index + 1).padStart(3, '0')}`;
    return {
      object: 'page',
      id: `page-${index + 1}`,
      url: `https://notion.so/page-${index + 1}`,
      last_edited_time: '2026-08-21T00:00:00Z',
      properties: {
        Title: property('title', `${knowledgeId} — Page ${index + 1}`),
        Status: property('status', 'Approved'),
        Category: property('select', 'AI Conversation'),
        Type: property('select', index === 9 ? 'Test Case' : 'FAQ'),
        Tags: property('multi_select', ['approved'])
      }
    };
  });
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.includes('/data_sources/') && options.method !== 'POST') {
      return new Response(JSON.stringify({ properties: { Status: { type: 'select' } } }), { status: 200 });
    }
    if (url.includes('/data_sources/')) return new Response(JSON.stringify({ results: pages, has_more: false, next_cursor: null }), { status: 200 });
    const pageNumber = Number(url.match(/page-(\d+)/)?.[1] || 0);
    return new Response(JSON.stringify({
      results: [{ type: 'paragraph', has_children: false, paragraph: { rich_text: rich(`Approved answer for page ${pageNumber}. This content is intentionally long enough for the knowledge audit and runtime retrieval.`) } }],
      has_more: false,
      next_cursor: null
    }), { status: 200 });
  };
  const snapshot = await buildNotionSnapshot({ fetchImpl, apiKey: 'secret', dataSourceId: 'source', now: new Date('2026-08-21T12:00:00Z') });
  assert.equal(snapshot.pages.length, 10);
  assert.equal(snapshot.chunks.length, 9);
  assert.ok(snapshot.chunks.every(chunk => chunk.knowledgeId !== 'KB-TEST-001'));
  assert.match(snapshot.version, /^notion-2026-08-21-/);
  const queryCall = calls.find(call => call.url.endsWith('/query'));
  const queryBody = JSON.parse(queryCall.options.body);
  assert.deepEqual(queryBody.filter, { property: 'Status', select: { equals: 'Approved' } });
  assert.match(generatedModule(snapshot), /NOTION_SYNCED_KNOWLEDGE/);
});

