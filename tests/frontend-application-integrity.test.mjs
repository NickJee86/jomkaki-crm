import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../app-v2.js', import.meta.url), 'utf8');
const section = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `Missing source: ${start}`);
  return source.slice(from, to);
};
const line = prefix => source.split(/\r?\n/).find(value => value.startsWith(prefix));
function context(data = {}, extras = {}) {
  const value = vm.createContext({ state: { data: { applications: [], leads: [], inbox: [], outbox: [], ...data } }, alert() {}, ...extras });
  vm.runInContext([
    line('const normalizePhone='),
    section('function customer360TimeValue(', 'function customer360Conversation('),
    section('function whatsappReplyContext(', 'function whatsappSalesPresets(')
  ].join('\n'), value);
  return value;
}

test('blank application IDs cannot merge unrelated customer messages into Customer 360', () => {
  const leads = Array.from({ length: 17 }, (_, i) => ({ id: `L${i + 1}`, name: `Customer ${i + 1}`, phone: `6010000${String(i).padStart(4, '0')}` }));
  const applications = leads.map(lead => ({ id: '', leadId: lead.id, customer: lead.name, phone: lead.phone }));
  leads.push({ ...leads[0], id: 'L1-DUPLICATE' });
  const app = context({ applications, leads });
  const customer = app.resolveCustomer360({ applicationId: '', leadId: 'L1', phone: leads[0].phone });
  assert.equal(customer.application, undefined);
  assert.equal(customer.applications.length, 0);
  assert.deepEqual(Array.from(customer.leadIds), ['L1', 'L1-DUPLICATE']);
  assert.equal(customer.matches({ applicationId: '', leadId: 'L2', phone: leads[1].phone }), false);
  assert.equal(customer.matches({ applicationId: '', leadId: 'L1-DUPLICATE' }), true);
  assert.equal(customer.matches({ phone: leads[0].phone }), true);
  const unscoped = app.resolveCustomer360({ applicationId: '', leadId: '', phone: '' });
  assert.equal(unscoped.application, undefined);
  assert.equal(unscoped.lead, undefined);
  assert.equal(unscoped.matches({ applicationId: '', leadId: '' }), false);
});

test('an explicitly unavailable application cannot silently open a different case for its lead', () => {
  const app = context({ applications: [{ id: 'OTHER-CASE', leadId: 'L1', phone: '60100000000' }], leads: [{ id: 'L1', phone: '60100000000' }] });
  const customer = app.resolveCustomer360({ applicationId: 'MISSING-CASE', leadId: 'L1', phone: '60100000000' });
  assert.equal(customer.application, undefined);
  assert.equal(customer.applications.length, 0);
  assert.equal(customer.matches({ applicationId: 'OTHER-CASE' }), false);
});

test('reply previews ignore malformed applications but preserve a correctly scoped lead conversation', () => {
  const app = context({
    applications: [{ id: '', leadId: 'WRONG', customer: 'Unrelated customer', phone: '60199999999' }],
    leads: [{ id: 'RIGHT', phone: '60100000000' }, { id: 'WRONG', phone: '60199999999' }],
    inbox: [{ id: 'M1', leadId: 'WRONG', phone: '60199999999', time: '2026-09-07T01:00:00Z' }, { id: 'M2', leadId: 'RIGHT', phone: '60100000000', time: '2026-09-07T02:00:00Z' }]
  });
  assert.equal(app.whatsappReplyContext({}).messages.length, 0);
  const reply = app.whatsappReplyContext({ leadId: 'RIGHT', applicationId: '', phone: '60100000000' });
  assert.equal(reply.application, undefined);
  assert.equal(reply.lead.id, 'RIGHT');
  assert.deepEqual(Array.from(reply.messages, message => message.id), ['M2']);
});

test('application table actions disable missing IDs and recheck a case before invoking handlers', () => {
  const app = context({ applications: [{ id: '', customer: 'Malformed' }, { id: 'A1', customer: 'Valid' }] });
  for (const attribute of ['data-app', 'data-upload', 'data-whatsapp']) {
    let invoked = 0;
    const attributes = { [attribute]: '' }, button = { getAttribute: key => attributes[key], setAttribute: (key, value) => { attributes[key] = value; }, closest: () => null };
    app.bindApplicationRecordAction(button, attribute, () => { invoked++; });
    assert.equal(button.disabled, true);
    assert.equal(button.onclick, null);
    assert.match(button.title, /Data integrity issue/);
    attributes[attribute] = 'A1';
    app.bindApplicationRecordAction(button, attribute, () => { invoked++; });
    button.onclick();
    assert.equal(invoked, 1);
    app.state.data.applications = [];
    button.onclick();
    assert.equal(invoked, 1, 'A removed case cannot fall back to a different customer');
    app.state.data.applications = [{ id: 'A1', customer: 'Valid' }];
  }
});

test('application-scoped mutations reject blank IDs before any network access', async () => {
  const requests = [], app = context({}, { fetch: async (url, options) => { requests.push(JSON.parse(options.body)); return { ok: true, status: 200, json: async () => ({ live: true }) }; } });
  vm.runInContext(section('async function post(', 'const MAX_UPLOAD_BYTES='), app);
  for (const action of ['uploadDocument', 'updateApplication', 'updateApplicantProfile', 'sendCreditConsent', 'verifyCreditConsent', 'setCreditConsentOutcome', 'prepareCreditCheck']) {
    for (const applicationId of ['', ' ', undefined]) await assert.rejects(app.post(action, { applicationId }), /Data integrity issue/);
  }
  assert.equal(requests.length, 0);
  await app.post('sendCustomerMessage', { leadId: 'RIGHT', phone: '60100000000', message: 'Scoped customer reply' });
  assert.equal(requests.length, 1, 'Lead-level customer messaging remains available');
});

test('blank application records cannot directly open upload or editing forms', () => {
  let forms = 0, app = context({}, { formModal: () => { forms++; } });
  vm.runInContext([
    line('function uploadDocument('), line('function editApplication('), line('function editApplicantProfile(')
  ].join('\n'), app);
  for (const record of [undefined, { id: '' }, { id: '  ' }]) {
    app.uploadDocument(record);
    app.editApplication(record);
    app.editApplicantProfile(record);
  }
  assert.equal(forms, 0);
});

test('new-message customer selection never resolves an empty option to a malformed application', () => {
  const app = context({ applications: [{ id: '', customer: 'Malformed' }, { id: 'A1', customer: 'Valid' }], leads: [{ id: 'L1', name: 'Lead', phone: '60100000000' }] }, { esc: value => String(value ?? '') });
  vm.runInContext(line('const customerOptions=') + '\n' + line('function customerTarget(') + '\nglobalThis.options=customerOptions;', app);
  assert.equal(app.customerTarget(''), null);
  assert.equal(app.customerTarget(undefined), null);
  assert.doesNotMatch(app.options(), /Malformed/);
  assert.match(app.options(), /value="L1"/);
  assert.equal(app.customerTarget('L1').leadId, 'L1');
});

test('message grouping uses real per-message fallback timestamps, never lead-level dates', () => {
  const app = context();
  vm.runInContext(line('function customerConversationTime('), app);
  assert.equal(app.customerConversationTime({ time: '', received: '2026-09-03T02:00:00Z' }), Date.parse('2026-09-03T02:00:00Z'));
  assert.equal(app.customerConversationTime({ time: 'invalid', created: '2026-09-04T02:00:00Z' }), Date.parse('2026-09-04T02:00:00Z'));
  assert.equal(app.customerConversationTime({ time: '', lastInboundAt: '2026-09-07T02:00:00Z' }), 0);
});
