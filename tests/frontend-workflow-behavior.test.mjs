import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const app = fs.readFileSync(new URL('../app-v2.js', import.meta.url), 'utf8');
const product = fs.readFileSync(new URL('../product-business.js', import.meta.url), 'utf8');
const block = (source, start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `Missing source boundaries: ${start}`);
  return source.slice(from, to);
};
const line = prefix => app.split(/\r?\n/).find(value => value.startsWith(prefix));
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[c]);
const records = overrides => ({ leads: [], applications: [], inbox: [], outbox: [], ...overrides });
function crmContext(data = {}) {
  const context = vm.createContext({ state: { data: records(data) }, operationalValue: value => String(value || '').toUpperCase(), whatsappChannelLabel: item => item.channelId || '', esc });
  vm.runInContext([
    line('const normalizePhone='),
    block(app, 'function customerMessagePreview(', 'function customerMessageTypeLabel('),
    block(app, 'function customerMessageTypeLabel(', 'function customerSourceLabel('),
    block(app, 'function customer360TimeValue(', 'function customer360ApplicationList('),
    block(app, 'function customerConversationKey(', 'function inboxTable(rows)'),
    block(app, 'function whatsappReplyContext(', 'function whatsappSalesPresets(')
  ].join('\n'), context);
  return context;
}

test('Customer 360 never joins unrelated people by shared name or empty phone', () => {
  const context = crmContext({
    leads: [{ id: 'L1', name: 'Ali', phone: '' }, { id: 'L2', name: 'Ali', phone: '' }],
    applications: [{ id: 'A2', leadId: 'L2', customer: 'Ali', phone: '' }]
  });
  const customer = context.resolveCustomer360({ leadId: 'L1' });
  assert.equal(customer.application, undefined);
  assert.equal(customer.matches({ leadId: 'L2', customer: 'Ali', phone: '' }), false);
  assert.equal(customer.matches({ customer: 'Ali' }), false);
  assert.equal(customer.matches({ leadId: 'L1' }), true);
});

test('Customer 360 retains linked history across duplicate leads for one real phone', () => {
  const context = crmContext({
    leads: [{ id: 'L1', name: 'Ali', phone: '012-3456789' }, { id: 'L2', name: 'Ali', phone: '+60123456789' }],
    applications: [{ id: 'A1', leadId: 'L1', phone: '0123456789' }, { id: 'A2', leadId: 'L2', phone: '60123456789' }]
  });
  const customer = context.resolveCustomer360({ leadId: 'L1' });
  assert.equal(customer.applications.length, 2);
  assert.equal(customer.matches({ leadId: 'L2' }), true);
  assert.equal(customer.matches({ recipient: '+60 12-3456789' }), true);
  assert.equal(customer.matches({ customer: 'Ali', recipient: '60199999999' }), false);
});

test('Customer 360 is chronological even when a delayed reply refers to an older message', () => {
  const context = crmContext({
    inbox: [{ id: 'I2', time: '2026-09-07T10:10:00Z', message: 'Second' }, { id: 'I1', time: '2026-09-07T10:00:00Z', message: 'First' }],
    outbox: [
      { id: 'O2', time: '2026-09-07T10:30:00Z', replyToMessageId: 'I1', message: 'Delayed reply' },
      { id: 'O1', time: '2026-09-07T10:05:00Z', messageType: 'DOCUMENT', attachmentName: 'quote.pdf' }
    ]
  });
  const messages = context.customer360Conversation({ matches: () => true });
  assert.deepEqual(Array.from(messages, item => item.id), ['I1', 'O1', 'I2', 'O2']);
  assert.equal(messages[3].turnId, 'I1');
  assert.match(messages[1].message, /Document/);
  assert.match(messages[1].meta, /quote\.pdf/);
});

test('inverted source timestamps preserve actual dates and chronological known messages', () => {
  const context = crmContext({
    inbox: [{ id: 'I1', time: '2026-09-07T10:05:00Z', message: 'Question' }],
    outbox: [{ id: 'O1', time: '2026-09-07T10:00:00Z', replyToMessageId: 'I1', message: 'Answer' }]
  });
  const messages = context.customer360Conversation({ matches: () => true });
  assert.deepEqual(Array.from(messages, item => item.id), ['O1', 'I1']);
  assert.equal(messages[0].time, '2026-09-07T10:00:00Z');
  assert.equal(messages[1].time, '2026-09-07T10:05:00Z');
  assert.equal(messages[0].turnId, messages[1].turnId);
});

test('undated incoming messages never inherit a lead or direct reply timestamp', () => {
  const context = crmContext({
    inbox: [{ id: 'I1', message: 'Undated question' }, { id: 'I2', time: 'invalid', message: 'Another undated question' }],
    outbox: [{ id: 'O1', time: '2026-09-07T10:00:00Z', replyToMessageId: 'I1', message: 'Dated reply' }]
  });
  const messages = context.customer360Conversation({ matches: () => true, lead: { lastInboundAt: '2026-09-08T10:00:00Z', lastCustomerReplyAt: '2026-09-08T11:00:00Z', time: '2026-09-08T12:00:00Z', created: '2026-09-01T10:00:00Z' } });
  for (const incoming of messages.filter(item => item.direction === 'incoming')) assert.equal(incoming.time, '');
  const linked = messages.find(item => item.id === 'I1'), reply = messages.find(item => item.id === 'O1');
  assert.equal(linked.sortTime, Date.parse(reply.time), 'A grouping anchor is separate from the displayed timestamp');
  assert.equal(reply.time, '2026-09-07T10:00:00Z');
  context.pretty = String;
  context.when = String;
  context.pill = () => '';
  vm.runInContext(block(app, 'function customer360ConversationSection(', 'function customer360ActivitySection('), context);
  const html = context.customer360ConversationSection(messages);
  assert.equal((html.match(/<time>Time unavailable<\/time>/g) || []).length, 2);
  assert.doesNotMatch(html, /2026-09-08/);
  assert.equal(context.state.data.inbox[0].time, undefined, 'Do not alter source records');
});

test('resolved handovers no longer appear as requiring human attention', () => {
  const context = crmContext();
  assert.equal(context.customer360IncomingStatus({ humanRequired: true, status: 'RESOLVED' }), 'RESOLVED');
});

test('invalid follow-up schedule stays editable and never submits a request', async () => {
  let sent = 0;
  const button = {}, message = {}, cancel = {}, form = { nextAt: { value: 'invalid' }, reason: { value: '' }, querySelector: selector => selector === '#formMessage' ? message : selector === '[data-cancel]' ? cancel : button };
  const context = vm.createContext({ closeActiveDrawer: () => true, formModal() {}, esc, document: { getElementById: () => form }, controlApplicationFollowUp: async () => { sent++; } });
  vm.runInContext(block(app, 'function openFollowUpSchedule(', 'function bindFollowUpControls('), context);
  context.openFollowUpSchedule('A1');
  await form.onsubmit({ preventDefault() {} });
  assert.equal(sent, 0);
  assert.equal(button.disabled, false);
  assert.match(message.textContent, /valid future/);
});

test('uncertain delivery is explicitly marked for verification without exposing a retry', () => {
  const context = vm.createContext({ isDemoRecord: () => false, demoLabel: () => '', esc, when: String, whatsappChannelLabel: () => 'Official', pill: (status, good) => `<span data-good="${good}">${status}</span>`, empty: () => '' });
  vm.runInContext(block(app, 'function outboxAgeMinutes(', 'function outbox(){'), context);
  const html = context.outboxTable([{ id: 'O1', status: 'DELIVERY_UNKNOWN', time: '2026-09-07T10:00:00Z' }]);
  assert.match(html, /Verify delivery in Meta · do not resend/);
  assert.match(html, /data-good="false"/);
  assert.doesNotMatch(html, /data-dispatch-outbox/);
});

test('case switching reads the exact application button attribute', () => {
  let opened;
  const button = { getAttribute: name => name === 'data-360-application' ? 'A2' : null };
  const context = vm.createContext({ document: { querySelector: () => null, querySelectorAll: () => [button] }, openCustomer360: identity => { opened = identity; }, bindDocumentPreviewButtons() {} });
  vm.runInContext(block(app, 'function bindCustomer360Actions(', 'async function openCustomer360('), context);
  context.bindCustomer360Actions({ application: { id: 'A1' } });
  button.onclick();
  assert.equal(opened.applicationId, 'A2');
});

test('one inbox conversation keeps latest reply routing separate from its pending handover', () => {
  const context = crmContext();
  const rows = [
    { id: 'NEW', phone: '+60123456789', time: '2026-09-07T10:00:00Z', channelId: 'CHANNEL-B', status: 'AI_REPLIED' },
    { id: 'OLD', phone: '012-3456789', time: '2026-09-06T10:00:00Z', channelId: 'CHANNEL-A', status: 'HUMAN_HANDOVER_REQUIRED', humanRequired: true }
  ];
  const groups = context.groupCustomerConversations(rows);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].id, 'OLD');
  assert.equal(groups[0].replyMessageId, 'NEW');
  assert.equal(groups[0].channelId, 'CHANNEL-B');
  assert.equal(groups[0].openMessageCount, 1);
});

test('reply window uses the latest inbound on the selected official number, not another channel', () => {
  const context = crmContext({ inbox: [
    { id: 'I1', phone: '0123456789', channelId: 'A', time: '2026-09-06T08:00:00Z' },
    { id: 'I2', phone: '0123456789', channelId: 'A', time: '2026-09-06T10:00:00Z' },
    { id: 'I3', phone: '0123456789', channelId: 'B', time: '2026-09-07T09:00:00Z' }
  ] });
  const inbound = context.latestWhatsAppInbound(context.state.data.inbox[0]);
  assert.equal(inbound.id, 'I2');
  const now = Date.parse('2026-09-07T10:00:00Z');
  assert.equal(context.whatsappServiceWindowOpen(inbound, now), false);
  assert.equal(context.whatsappServiceWindowOpen({ time: '2026-09-07T09:00:00Z' }, now), true);
  assert.equal(context.whatsappServiceWindowOpen({ time: '2026-09-08T09:00:00Z' }, now), false);
  assert.equal(context.whatsappServiceWindowOpen({ time: 'invalid' }, now), false);
});

test('template requests ignore stale customer responses and closed composers', async () => {
  const pending = [];
  const form = { isConnected: true, templateName: {}, language: {}, phone: { value: '' }, attachment: { files: [] } };
  const templateHelp = {};
  const context = vm.createContext({ form, templateHelp, state: { user: { whatsappMode: 'CLOUD' } }, esc, pretty: String, selectedLead: null, selectedApplication: null, isInbox: false, selected: null, syncReplyComposer() {}, matchTemplateToAttachment: () => true, FOLLOW_UP_TEMPLATE_REGISTRY: {}, post: () => new Promise((resolve, reject) => pending.push({ resolve, reject })) });
  vm.runInContext(block(app, '  let templateRequest=0;', '  const applyTarget=' ) + '\nglobalThis.loadTemplates=loadApprovedTemplates;', context);
  const first = context.loadTemplates({ leadId: 'L1' }), second = context.loadTemplates({ leadId: 'L2' });
  pending[1].resolve({ templates: [{ name: 'customer_two', language: 'zh_CN' }] });
  await second;
  pending[0].resolve({ templates: [{ name: 'customer_one', language: 'ms' }] });
  await first;
  assert.match(form.templateName.innerHTML, /customer_two/);
  assert.doesNotMatch(form.templateName.innerHTML, /customer_one/);
  assert.match(form.language.innerHTML, /zh_CN/);
  const closed = context.loadTemplates({ leadId: 'L3' });
  form.isConnected = false;
  pending[2].reject(new Error('late failure'));
  await closed;
  assert.doesNotMatch(templateHelp.textContent, /late failure/);
});

test('required password change loads only session and clears earlier account data', async () => {
  const requested = [], required = [], state = { loaded: true, data: { leads: [{ id: 'PRIVATE' }] } }, shell = {}, gate = { classList: { add() {} } };
  const context = vm.createContext({ state, app: {}, shell, gate, loadedResources: new Set(['leads']), document: { querySelector: () => null }, changePassword: value => required.push(value), get: async resource => { requested.push(resource); return { user: { mustChangePassword: true } }; } });
  vm.runInContext(block(app, 'async function load(){', 'const liveResourcesForView='), context);
  assert.equal(await context.load(), true);
  assert.deepEqual(requested, ['session']);
  assert.deepEqual(required, [true]);
  assert.equal(state.loaded, false);
  assert.equal(state.data.leads.length, 0);
  assert.equal(shell.hidden, true);
});

test('required password dialog blocks dismissal and loads workspace only after successful save', async () => {
  let removed = false, loaded = 0;
  const close = {}, backdrop = { dataset: {}, querySelector: () => close, remove() { removed = true; } }, button = {}, message = {};
  const form = { closest: () => backdrop, querySelector: selector => selector === '#formMessage' ? message : button, currentPassword: { value: 'Temporary!123' }, newPassword: { value: 'SecurePassword!123' }, confirmPassword: { value: 'SecurePassword!123' } };
  const state = { user: { mustChangePassword: true } };
  const context = vm.createContext({ state, document: { getElementById: () => form, querySelector: () => backdrop }, formModal: () => true, post: async () => {}, load: async () => { loaded++; } });
  vm.runInContext(block(app, 'function changePassword(', 'function showTemporaryPassword(') + '\n' + block(app, 'function closeActiveDrawer(', 'function protectFormChanges('), context);
  context.changePassword(true);
  assert.equal(close.hidden, true);
  assert.equal(context.closeActiveDrawer(), false);
  assert.equal(removed, false);
  await form.onsubmit({ preventDefault() {} });
  assert.equal(removed, true);
  assert.equal(state.user.mustChangePassword, false);
  assert.equal(loaded, 1);
});

test('product photos accept WhatsApp-compatible images without restricting document storage', () => {
  const context = vm.createContext({});
  vm.runInContext(block(app, 'const MAX_UPLOAD_BYTES=', 'const fileData=') + '\nglobalThis.validate=validateBrowserFile;', context);
  for (const type of ['image/jpeg', 'image/png']) assert.equal(context.validate({ type, size: 123 }, { imageOnly: true }).type, type);
  for (const type of ['image/webp', 'image/heic', 'application/pdf']) assert.throws(() => context.validate({ type, size: 123 }, { imageOnly: true }), /JPG or PNG/);
  assert.equal(context.validate({ type: 'image/webp', size: 123 }).type, 'image/webp');
});

test('handphone families and manage controls keep same-named models from different brands separate', () => {
  const context = vm.createContext({ state: { user: { role: 'ADMIN' }, data: { catalog: [] } }, esc, pretty: String });
  vm.runInContext(block(product, '  const unitOf', '  function openHandphoneModelOptions('), context);
  const html = context.handphoneCatalogShowcase([
    { id: 'P1', brand: 'Alpha', model: 'Pro', variant: '128GB · Black', active: true, approvalStatus: 'APPROVED' },
    { id: 'P2', brand: 'Beta', model: 'Pro', variant: '256GB · Blue', active: true, approvalStatus: 'APPROVED' }
  ]);
  assert.equal((html.match(/class="handphone-family-card"/g) || []).length, 2);
  assert.match(html, /data-phone-brand="Alpha"/);
  assert.match(html, /data-phone-brand="Beta"/);
});

test('follow-up cards with missing IDs show an integrity warning and disable every record action', () => {
  const applications = [{ customer: 'Missing application ID', status: 'OPEN' }, { id: 'A1', customer: 'Valid customer', status: 'OPEN' }];
  const leads = [{ id: '   ', name: 'Missing lead ID', status: 'NEW' }];
  const context = vm.createContext({ state: { data: { leads } }, businessApplications: () => applications, followUpUpper: value => String(value || '').toUpperCase(), inferredFollowUpRule: () => 'DOCUMENTS_PARTIAL', leadFollowUpRule: () => 'SALES_ENQUIRY_IDLE', pretty: String, esc, ownerOf: () => 'Staff', branchOf: () => 'Branch', when: String });
  vm.runInContext(block(app, 'function followUpQueueCases(', 'function followUpTeamWorkspace('), context);
  const cases = context.followUpQueueCases();
  assert.equal(cases.length, 3, 'Keep broken records visible; never fabricate IDs or drop customers');
  for (const record of cases.filter(record => !record.recordId)) {
    assert.match(record.dataIntegrityError, /Missing record ID/);
    const actions = context.followUpQueueActions(record);
    assert.equal((actions.match(/ disabled /g) || []).length, 4);
    assert.doesNotMatch(actions, /data-(?:app|lead|followup-)/);
  }
  const valid = cases.find(record => record.recordId === 'A1');
  assert.equal(valid.dataIntegrityError, '');
  assert.match(context.followUpQueueActions(valid), /data-app="A1"/);
  assert.match(context.followUpQueueActions(valid), /data-followup-schedule="A1"/);
  context.pageCases = cases.filter(record => !record.recordId);
  vm.runInContext(line('  const queueRows=pageCases') + '\nglobalThis.renderedQueue=queueRows;', context);
  assert.match(context.renderedQueue, /Data integrity warning:/);
  assert.match(context.renderedQueue, /ID unavailable/);
  assert.doesNotMatch(context.renderedQueue, /data-(?:app|lead|followup-)/);
  assert.equal(applications[0].id, undefined);
  assert.equal(leads[0].id, '   ', 'Source data must remain unchanged');
});

test('empty follow-up IDs cannot post or open a scheduling form even if invoked programmatically', async () => {
  let requests = 0, confirmations = 0, forms = 0;
  const alerts = [], context = vm.createContext({ post: async () => { requests++; }, confirm: () => { confirmations++; return true; }, alert: value => alerts.push(value), formModal: () => { forms++; } });
  vm.runInContext(block(app, 'async function controlApplicationFollowUp(', 'function bindFollowUpControls('), context);
  for (const id of [undefined, '', '  ']) {
    await assert.rejects(context.controlApplicationFollowUp(id, 'SEND_NOW'), /Data integrity issue/);
    context.openFollowUpSchedule(id);
  }
  assert.equal(requests, 0);
  assert.equal(confirmations, 0);
  assert.equal(forms, 0);
  assert.equal(alerts.length, 3);
});
