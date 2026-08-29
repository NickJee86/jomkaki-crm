import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const html = read('../index.html');
const app = read('../app-v2.js');
const auth = read('../api/_auth.js');

test('primary navigation keeps follow-up as a first-class daily workspace', () => {
  const views = [...html.matchAll(/class="nav-item(?: active)?" data-view="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(views, ['dashboard', 'customers', 'workbench', 'followup', 'products', 'reports', 'management']);
  assert.match(app, /function customers\(\)/);
  assert.match(app, /function products\(\)/);
  assert.match(app, /function management\(\)/);
  assert.match(app, /function followup\(\)/);
  assert.match(app, /function bindPrimaryNavigation\(\)/);
  assert.match(app, /item\.onclick=\(\)=>navigateToView\(item\.dataset\.view\)/);
  assert.match(app, /function bindShellNavigation\(\)/);
  assert.match(app, /messageQueue\.onclick=\(\)=>navigateToView\('outbox'\)/);
  assert.match(app, /syncPrimaryNavigation\(\);bindPrimaryNavigation\(\);bindShellNavigation\(\)/);
  assert.match(app, /Daily customer recovery, document collection and reminder delivery/);
  assert.match(app, /Customer 360/);
  assert.match(html, /Tasks & Approvals/);
  assert.match(html, />Follow-up<\/button>/);
});

test('refresh errors preserve the authenticated workspace', () => {
  assert.match(app, /if\(error\?\.message==='AUTH'\)/);
  assert.match(app, /if\(wasLoaded\)\{shell\.hidden=false;gate\.classList\.add\('hidden'\);render\(\);showWorkspaceError/);
  assert.match(app, /Your login is still active/);
  assert.match(app, /refreshLiveWorkspace\(\{force:true,showErrors:true\}\)/);
  assert.match(app, /const liveResourcesForView=view=>/);
});

test('sheet-backed sessions tolerate a temporary account directory outage', () => {
  assert.match(auth, /async function dynamicAccountDirectory/);
  assert.match(auth, /available:\s*false,\s*accounts:\s*\[\]/);
  assert.match(auth, /validationDeferred:\s*true/);
  assert.match(auth, /clean\(session\.authSource\)\s*===\s*'sheet'/);
});
