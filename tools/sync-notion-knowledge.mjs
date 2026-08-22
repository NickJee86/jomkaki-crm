import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const NOTION_VERSION = '2026-03-11';
const DEFAULT_DATA_SOURCE_ID = '92e306aa-31a4-4729-8f24-09b826c95b4d';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUTPUT = path.resolve(__dirname, '..', 'api', '_notion-knowledge.generated.js');

const clean = value => String(value ?? '').replace(/\r/g, '').trim();
const richText = value => Array.isArray(value) ? value.map(item => clean(item?.plain_text || item?.text?.content)).filter(Boolean).join('') : '';

export function propertyText(property = {}) {
  if (!property || typeof property !== 'object') return '';
  if (property.type === 'title') return richText(property.title);
  if (property.type === 'rich_text') return richText(property.rich_text);
  if (property.type === 'status') return clean(property.status?.name);
  if (property.type === 'select') return clean(property.select?.name);
  if (property.type === 'multi_select') return (property.multi_select || []).map(item => clean(item?.name)).filter(Boolean).join(', ');
  if (property.type === 'url') return clean(property.url);
  return '';
}

export function blockPlainText(block = {}) {
  const type = clean(block.type);
  const data = block[type] || {};
  const text = richText(data.rich_text || data.caption || data.title);
  if (!text && type === 'divider') return '---';
  if (!text) return '';
  if (/^heading_[1-4]$/.test(type)) return `# ${text}`;
  if (type === 'bulleted_list_item') return `- ${text}`;
  if (type === 'numbered_list_item') return `1. ${text}`;
  if (type === 'to_do') return `- [${data.checked ? 'x' : ' '}] ${text}`;
  if (type === 'quote') return `> ${text}`;
  return text;
}

export function chunkPageContent(page, maxChars = 1100) {
  const lines = clean(page.content).split('\n').map(clean).filter(Boolean);
  const chunks = [];
  let buffer = '';
  const flush = () => {
    const text = clean(buffer);
    if (text) chunks.push({
      pageId: page.pageId,
      knowledgeId: page.knowledgeId,
      title: page.title,
      category: page.category,
      type: page.type,
      tags: page.tags,
      url: page.url,
      text
    });
    buffer = '';
  };
  for (const line of lines) {
    if (buffer && buffer.length + line.length + 1 > maxChars) flush();
    buffer = buffer ? `${buffer}\n${line}` : line;
  }
  flush();
  return chunks;
}

async function notionRequest(fetchImpl, apiKey, pathname, options = {}, attempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await fetchImpl(`https://api.notion.com/v1${pathname}`, {
      ...options,
      headers: {
        authorization: `Bearer ${apiKey}`,
        'notion-version': NOTION_VERSION,
        'content-type': 'application/json',
        ...(options.headers || {})
      }
    });
    if (response.ok) return response.json();
    const problem = await response.text().catch(() => '');
    lastError = new Error(`Notion ${response.status}: ${problem.slice(0, 300)}`);
    if (![429, 500, 502, 503, 504].includes(response.status) || attempt === attempts) break;
    await new Promise(resolve => setTimeout(resolve, Math.min(4000, 350 * (2 ** (attempt - 1)))));
  }
  throw lastError || new Error('Notion request failed');
}

export function approvedFilterForProperty(property = {}) {
  if (property?.type === 'status') return { property: 'Status', status: { equals: 'Approved' } };
  if (property?.type === 'select') return { property: 'Status', select: { equals: 'Approved' } };
  throw new Error(`Notion Status property must be a status or select field; received ${clean(property?.type) || 'unknown'}`);
}

async function queryApprovedPages({ fetchImpl, apiKey, dataSourceId }) {
  const pages = [];
  let cursor = '';
  const dataSource = await notionRequest(fetchImpl, apiKey, `/data_sources/${encodeURIComponent(dataSourceId)}`);
  const approvedFilter = approvedFilterForProperty(dataSource?.properties?.Status);
  do {
    const body = {
      page_size: 100,
      filter: approvedFilter
    };
    if (cursor) body.start_cursor = cursor;
    const result = await notionRequest(fetchImpl, apiKey, `/data_sources/${encodeURIComponent(dataSourceId)}/query`, {
      method: 'POST',
      body: JSON.stringify(body)
    });
    pages.push(...(result.results || []).filter(item => item?.object === 'page'));
    cursor = result.has_more ? clean(result.next_cursor) : '';
  } while (cursor);
  return pages;
}

async function listBlockChildren({ fetchImpl, apiKey, blockId }) {
  const blocks = [];
  let cursor = '';
  do {
    const query = new URLSearchParams({ page_size: '100' });
    if (cursor) query.set('start_cursor', cursor);
    const result = await notionRequest(fetchImpl, apiKey, `/blocks/${encodeURIComponent(blockId)}/children?${query}`);
    for (const block of result.results || []) {
      blocks.push(block);
      if (block?.has_children) blocks.push(...await listBlockChildren({ fetchImpl, apiKey, blockId: block.id }));
    }
    cursor = result.has_more ? clean(result.next_cursor) : '';
  } while (cursor);
  return blocks;
}

export function normalizeNotionPage(page, content = '') {
  const properties = page?.properties || {};
  const title = propertyText(properties.Title) || propertyText(Object.values(properties).find(value => value?.type === 'title')) || 'Untitled';
  const knowledgeId = clean(title.match(/\bKB-[A-Z]+-\d+\b/i)?.[0]).toUpperCase();
  return {
    pageId: clean(page?.id),
    knowledgeId,
    title,
    status: propertyText(properties.Status),
    category: propertyText(properties.Category),
    type: propertyText(properties.Type),
    tags: propertyText(properties.Tags).split(',').map(clean).filter(Boolean),
    lastEditedTime: clean(page?.last_edited_time),
    url: clean(page?.url),
    content: clean(content)
  };
}

export function auditKnowledgePages(pages = []) {
  const warnings = [];
  const ids = new Map();
  for (const page of pages) {
    if (!page.knowledgeId) warnings.push(`MISSING_KNOWLEDGE_ID:${page.pageId}`);
    if (!/^Approved$/i.test(page.status)) warnings.push(`NON_APPROVED_PAGE:${page.knowledgeId || page.pageId}`);
    if (page.knowledgeId && ids.has(page.knowledgeId)) warnings.push(`DUPLICATE_KNOWLEDGE_ID:${page.knowledgeId}`);
    if (page.knowledgeId) ids.set(page.knowledgeId, page.pageId);
    if (page.content.length < 80) warnings.push(`THIN_PAGE:${page.knowledgeId || page.pageId}`);
  }
  const testPage = pages.find(page => page.knowledgeId === 'KB-TEST-001');
  const earlyConsent = pages.some(page => /one or two (?:outstanding|missing).{0,45}do not block consent/i.test(page.content));
  const strictConsent = /consent form sends only after pre-consent requirements are complete/i.test(testPage?.content || '');
  if (earlyConsent && strictConsent) warnings.push('CONFLICT:CONSENT_TRIGGER_POLICY');
  return [...new Set(warnings)];
}

export async function buildNotionSnapshot({
  fetchImpl = fetch,
  apiKey,
  dataSourceId = DEFAULT_DATA_SOURCE_ID,
  now = new Date()
} = {}) {
  if (!clean(apiKey)) throw new Error('NOTION_API_KEY is required');
  if (!clean(dataSourceId)) throw new Error('NOTION_KB_DATA_SOURCE_ID is required');
  const rawPages = await queryApprovedPages({ fetchImpl, apiKey: clean(apiKey), dataSourceId: clean(dataSourceId) });
  const pages = [];
  for (const rawPage of rawPages) {
    const blocks = await listBlockChildren({ fetchImpl, apiKey: clean(apiKey), blockId: rawPage.id });
    pages.push(normalizeNotionPage(rawPage, blocks.map(blockPlainText).filter(Boolean).join('\n')));
  }
  pages.sort((a, b) => a.knowledgeId.localeCompare(b.knowledgeId) || a.title.localeCompare(b.title));
  if (pages.length < 10) throw new Error(`Notion sync returned only ${pages.length} Approved pages; refusing to replace the safe snapshot`);
  const chunks = pages
    .filter(page => !/^Test Case$/i.test(page.type))
    .flatMap(page => chunkPageContent(page));
  const digest = crypto.createHash('sha256').update(JSON.stringify(pages.map(page => ({ ...page, content: page.content })))).digest('hex').slice(0, 12);
  return {
    schemaVersion: 1,
    sourceType: 'NOTION_APPROVED_BUILD_SYNC',
    sourceDataSourceId: clean(dataSourceId),
    syncedAt: now.toISOString(),
    version: `notion-${now.toISOString().slice(0, 10)}-${digest}`,
    pages: pages.map(({ content, ...page }) => ({ ...page, contentHash: crypto.createHash('sha256').update(content).digest('hex').slice(0, 12) })),
    chunks,
    warnings: auditKnowledgePages(pages)
  };
}

export function generatedModule(snapshot) {
  return `// This file is generated. Edit Notion or tools/sync-notion-knowledge.mjs instead.\nexport const NOTION_SYNCED_KNOWLEDGE = Object.freeze(${JSON.stringify(snapshot, null, 2)});\n`;
}

async function main() {
  const allowFallback = process.argv.includes('--allow-fallback');
  const apiKey = clean(process.env.NOTION_API_KEY);
  const dataSourceId = clean(process.env.NOTION_KB_DATA_SOURCE_ID) || DEFAULT_DATA_SOURCE_ID;
  const output = path.resolve(clean(process.env.NOTION_KB_OUTPUT) || DEFAULT_OUTPUT);
  if (!apiKey) {
    if (allowFallback) {
      console.warn('Notion build sync skipped: NOTION_API_KEY is not configured; keeping the checked-in safe snapshot.');
      return;
    }
    throw new Error('NOTION_API_KEY is required. Share the JomKaki AI Knowledge Base with the Notion integration before syncing.');
  }
  const snapshot = await buildNotionSnapshot({ apiKey, dataSourceId });
  await fs.writeFile(output, generatedModule(snapshot), 'utf8');
  console.log(`Synced ${snapshot.pages.length} Approved Notion pages into ${path.relative(process.cwd(), output)} (${snapshot.version}).`);
  if (snapshot.warnings.length) console.warn(`Knowledge warnings: ${snapshot.warnings.join(', ')}`);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) main().catch(error => {
  console.error(error?.message || error);
  process.exitCode = 1;
});

