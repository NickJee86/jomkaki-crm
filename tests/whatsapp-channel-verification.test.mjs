import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const crmSource=fs.readFileSync(new URL('../api/crm.js',import.meta.url),'utf8');

test('WhatsApp channel activation requires a recorded Meta phone verification',()=>{
  assert.match(crmSource,/Record the successful Meta phone verification time before enabling this channel/);
  assert.match(crmSource,/'Last Verified At': lastVerifiedAt/);
});

test('Cloud sending cannot fall back to a different or legacy channel',()=>{
  assert.match(crmSource,/if \(cloudMode && !route\)/);
  assert.match(crmSource,/Customer is not bound to an official WhatsApp channel/);
  assert.match(crmSource,/route && !clean\(route\['Last Verified At'\]\)/);
});
