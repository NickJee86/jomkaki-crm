import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const api=fs.readFileSync(new URL('../api/crm.js',import.meta.url),'utf8');
const auth=fs.readFileSync(new URL('../api/_auth.js',import.meta.url),'utf8');
const ui=fs.readFileSync(new URL('../business-architecture.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');

test('Roles distinguish Branch Supervisors and Handphone management',()=>{
  assert.match(api,/BRANCH_SUPERVISOR/);
  assert.match(api,/BUSINESS_MANAGER/);
  assert.match(auth,/BRANCH_MANAGER' \? 'BRANCH_SUPERVISOR'/);
  assert.match(ui,/Branch Supervisor/);
  assert.match(ui,/Business Manager/);
  assert.ok(!html.includes('Regional and Branch Managers'));
});

test('One SA login can submit Motor, Handphone or Both',()=>{
  assert.match(auth,/\['MOTOR', 'HANDPHONE', 'BOTH'\]/);
  assert.match(ui,/Motor & Handphone/);
  assert.match(ui,/name="businessUnit" value="MOTOR"/);
  assert.match(ui,/name="businessUnit" value="HANDPHONE"/);
  assert.match(api,/Your account cannot submit/);
  assert.match(ui,/if\(architectureAllows\(state\.user\?\.businessAccess,'MOTOR'\)\)await ensureCatalogForForms\(\)/);
  assert.match(ui,/architectureBusinessAccessLabel/);
  assert.match(ui,/Staff can hold Motor, Handphone or Motor & Handphone access/);
  assert.doesNotMatch(ui,/Staff can hold Motor, Handphone or Both access/);
  assert.doesNotMatch(ui,/pretty\(member\.businessAccess\|\|'BOTH'\)/);
  assert.doesNotMatch(ui,/architectureBusinessPill\(architectureAccess\(user\.businessAccess\)===\x27BOTH\x27\?\x27MOTOR\x27/);
});

test('Staff application entry only offers physical branches',()=>{
  assert.match(ui,/architecturePhysicalBranch/);
  assert.match(ui,/\.filter\(\(\[id,name\]\)=>architecturePhysicalBranch\(id,name\)\)/);
  assert.match(html,/business-architecture\.js\?v=20260829-workflow1/);
});

test('Motor and Handphone application data remain separately reportable',()=>{
  assert.match(api,/'Business Unit': businessUnit/);
  assert.match(api,/'Product Category': businessUnit === 'HANDPHONE'/);
  assert.match(api,/'Requested Product Price \(RM\)'/);
  assert.match(api,/'Requested Deposit \(RM\)'/);
  assert.match(ui,/id="reportBusiness"/);
  assert.match(ui,/Product demand/);
});

test('Vacant Supervisor positions use a Regional Manager fallback',()=>{
  assert.match(ui,/Regional fallback active/);
  assert.match(ui,/Vacant Supervisor positions/);
  assert.match(ui,/Motor branches awaiting a Supervisor/);
  assert.match(ui,/HANDPHONE\|IPHONE\|SMARTPHONE/);
  assert.match(ui,/row\.remove\(\)/);
  assert.match(fs.readFileSync(new URL('../app-v2.js',import.meta.url),'utf8'),/\['BRANCH_SUPERVISOR','BRANCH_MANAGER'\]\.includes\(user\.role\)/);
  assert.match(api,/ensureSheetHeaders\(req, 'CRM_User_Access', \['Business Access'\]\)/);
});

