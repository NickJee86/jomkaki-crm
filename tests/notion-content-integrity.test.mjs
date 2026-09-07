import test from 'node:test';
import assert from 'node:assert/strict';
import { blockPlainText, buildNotionSnapshot, chunkPageContent, propertyText } from '../tools/sync-notion-knowledge.mjs';

const rich = text => [{ plain_text: text }];
const json = data => new Response(JSON.stringify(data), { status: 200 });
const page = index => ({
  object: 'page', id: `page-${index}`, properties: {
    Title: { type: 'title', title: rich(`KB-FAQ-${String(index).padStart(3, '0')}`) },
    Status: { type: 'status', status: { name: 'Approved' } },
    Type: { type: 'select', select: { name: 'FAQ' } }
  }
});

test('formatting does not remove spaces between Notion text runs', () => {
  const runs = [...rich('Hantar '), ...rich('IC depan'), ...rich(' dan '), ...rich('belakang.')];
  assert.equal(blockPlainText({ type: 'paragraph', paragraph: { rich_text: runs } }), 'Hantar IC depan dan belakang.');
  assert.equal(propertyText({ type: 'title', title: [...rich('Branch '), ...rich('Kuching')] }), 'Branch Kuching');
});

test('Notion tables retain cell order, empty cells and answer content', () => {
  assert.equal(blockPlainText({ type: 'table_row', table_row: { cells: [rich('Kuching'), [], rich('Jalan Kulas')] } }), 'Kuching |  | Jalan Kulas');
  assert.equal(blockPlainText({ type: 'table_row', table_row: { cells: [[], []] } }), '');
});

test('single long paragraphs stay bounded without dropping words or splitting emoji', () => {
  const content = 'Dokumen lengkap perlu dihantar dahulu. '.repeat(100).trim();
  const chunks = chunkPageContent({ content, pageId: 'policy' }, 80);
  assert.ok(chunks.every(chunk => chunk.text.length <= 80));
  assert.equal(chunks.map(chunk => chunk.text).join(' '), content);
  const emoji = chunkPageContent({ content: '🛵'.repeat(17) }, 5);
  assert.equal(emoji.map(chunk => chunk.text).join(''), '🛵'.repeat(17));
  assert.ok(emoji.every(chunk => chunk.text.length <= 5 && chunk.text.isWellFormed()));
});

test('sync retrieves pages, nested table rows and later block pages completely', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push(url);
    if (url.endsWith('/data_sources/source')) return json({ properties: { Status: { type: 'status' } } });
    if (url.endsWith('/query')) {
      const next = JSON.parse(options.body).start_cursor;
      return json({ results: Array.from({ length: 5 }, (_, i) => page(i + (next ? 6 : 1))), has_more: !next, next_cursor: next ? null : 'page-cursor' });
    }
    if (url.includes('/blocks/page-1/children')) return json({ results: [{ id: 'table', type: 'table', has_children: true, table: { table_width: 2 } }], has_more: false });
    if (url.includes('/blocks/table/children')) {
      const next = new URL(url).searchParams.has('start_cursor');
      return json({ results: [{ type: 'table_row', table_row: { cells: [rich(next ? 'Petaling Jaya' : 'Kuching'), rich(next ? 'Sungai Way' : 'Jalan Kulas')] } }], has_more: !next, next_cursor: next ? null : 'row-cursor' });
    }
    return json({ results: [{ type: 'paragraph', paragraph: { rich_text: rich('Approved FAQ content for this page.') } }], has_more: false });
  };
  const result = await buildNotionSnapshot({ apiKey: 'test-only', dataSourceId: 'source', fetchImpl });
  assert.equal(result.pages.length, 10);
  const tableText = result.chunks.filter(chunk => chunk.pageId === 'page-1').map(chunk => chunk.text).join('\n');
  assert.equal(tableText, 'Kuching | Jalan Kulas\nPetaling Jaya | Sungai Way');
  assert.ok(calls.some(url => url.includes('start_cursor=row-cursor')));
});

test('an empty or test-only sync cannot replace usable knowledge', async () => {
  const fetchImpl = async url => {
    if (url.endsWith('/data_sources/source')) return json({ properties: { Status: { type: 'status' } } });
    if (url.endsWith('/query')) return json({ results: Array.from({ length: 10 }, (_, i) => page(i + 1)), has_more: false });
    return json({ results: [], has_more: false });
  };
  await assert.rejects(buildNotionSnapshot({ apiKey: 'test-only', dataSourceId: 'source', fetchImpl }), /no usable Approved knowledge/);
});
