import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const api = readFileSync(new URL('../api/crm.js', import.meta.url), 'utf8');
const app = readFileSync(new URL('../app-v2.js', import.meta.url), 'utf8');

assert.match(app, /async function runGlobalSearch/, 'Global search must have a real navigation and filter handler');
assert.match(app, /globalSearch\.onkeydown/, 'Pressing Enter in global search must be handled');
assert.match(app, /e\.ctrlKey\|\|e\.metaKey/, 'Ctrl or Command + K must focus global search');

assert.match(app, /data-toggle-accepting/, 'Administrator team page must show lead-acceptance controls');
assert.match(app, /setAdvisorAccepting/, 'Lead-acceptance control must call the backend');
assert.match(api, /action === 'setAdvisorAccepting'/, 'Backend must support Staff lead-acceptance changes');
assert.match(api, /CRM_ADVISOR_ASSIGNMENT_(RESUMED|PAUSED)/, 'Lead-acceptance changes must be audited');

const manualApplication = app.slice(app.indexOf('function newApplication'), app.indexOf('function uploadDocument'));
assert.match(manualApplication, /name="catalogId" required/, 'Manual applications must select a catalog motorcycle');
assert.doesNotMatch(manualApplication, /name="brand"/, 'Manual applications must not accept free-text motor brands');
assert.doesNotMatch(manualApplication, /name="model"/, 'Manual applications must not accept free-text motor models');
assert.match(api, /Select an active motorcycle from the Motor Catalog/, 'Backend must reject invalid or inactive catalog selections');
assert.match(api, /Product Brand': clean\(catalogRecord\.Brand\)/, 'Backend must derive the application brand from the catalog');
assert.match(app, /Motorcycle from catalog<select name="catalogId"/, 'Applicant 360 editing must also use the Motor Catalog');

console.log('CRM completion-fix tests passed');
