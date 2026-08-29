import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../app-v2.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../design-refresh.css', import.meta.url), 'utf8');

test('manual branch reply uses the same short navigation routes as automation', () => {
  assert.match(app, /const JOMKAKI_PUBLIC_URL='https:\/\/jomkaki-rider\.vercel\.app'/);
  assert.match(app, /const branchShortLink=.*\/go\/\$\{branch\.slug\}\/\$\{provider\}/);
  assert.match(app, /Google Maps: \$\{branchShortLink\(branch,'maps'\)\}/);
  assert.match(app, /Waze: \$\{branchShortLink\(branch,'waze'\)\}/);
});

test('forms warn before unsaved work is discarded', () => {
  assert.match(app, /function dirtyForm\(\)/);
  assert.match(app, /function confirmDiscardChanges\(\)/);
  assert.match(app, /window\.addEventListener\('beforeunload'/);
  assert.match(app, /role="dialog" aria-modal="true"/);
  assert.match(app, /form\.dataset\.dirty='true'/);
});

test('follow-up queue supports operational filters and real pagination', () => {
  for (const id of ['followUpQueueSearch', 'followUpQueueOwner', 'followUpQueueBranch', 'followUpQueueTiming', 'followUpQueueSort']) {
    assert.ok(app.includes(`id="${id}"`), `${id} should be rendered`);
  }
  assert.match(app, /const pageSize=25,totalPages=/);
  assert.match(app, /data-followup-page=/);
  assert.match(app, /followUpMaxAttempts:maximums\.get\(ruleId\)\|\|3/);
  assert.match(app, /Last reply \$\{esc\(when\(record\.lastCustomerReplyAt\)\)\}/);
});

test('mobile tables render as record cards instead of requiring horizontal scrolling', () => {
  assert.match(app, /function enhanceResponsiveTables\(root=document\)/);
  assert.match(app, /cell\.dataset\.label=headers\[index\]/);
  assert.match(css, /\.responsive-data-table tbody tr\{display:block/);
  assert.match(css, /content:attr\(data-label\)/);
  assert.match(css, /\.table-scroll-dock\{display:none!important\}/);
});

test('live refresh is view-scoped and backs off when the data source is busy', () => {
  assert.match(app, /const liveResourcesForView=view=>/);
  assert.match(app, /\[429,502,503,504\]\.includes\(response\.status\)/);
  assert.match(app, /state\.nextLiveRefreshAt=Date\.now\(\)\+Math\.min\(300000/);
  assert.match(app, /setInterval\(\(\)=>refreshLiveWorkspace\(\),120000\)/);
  assert.match(app, /refreshLiveWorkspace\(\{force:true,showErrors:true\}\)/);
});
