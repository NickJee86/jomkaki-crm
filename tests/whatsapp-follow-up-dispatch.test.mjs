import test from 'node:test';
import assert from 'node:assert/strict';
import { FOLLOW_UP_APPLICATION_HEADERS } from '../api/_follow-up.js';

const response = (body = {}, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const fixedNow = Date.parse('2026-09-07T04:00:00.000Z');
const table = (headers, records = []) => [headers, ...records.map(record => headers.map(header => record[header] || ''))];
const columnIndex = letters => [...letters].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1;

async function setup(t, { failSentLog = false, uncertainSend = false } = {}) {
  const env = { JOMKAKI_SPREADSHEET_ID: 'mock-sheet', GOOGLE_SERVICE_ACCOUNT_EMAIL: 'test@example.invalid', GOOGLE_PROJECT_NUMBER: '123', WHATSAPP_SEND_MODE: 'CLOUD', FOLLOWUP_TEST_ACCESS_TOKEN: 'mock-token' };
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(() => { for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value; });
  const RealDate = Date;
  t.mock.method(globalThis, 'Date', class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [fixedNow])); }
    static now() { return fixedNow; }
  });
  const appHeaders = ['Application ID', 'Lead ID', 'Phone Number', 'Application Status', 'Missing Documents', 'Origin WhatsApp Channel ID', 'Created At', 'Updated At', 'Updated By', ...FOLLOW_UP_APPLICATION_HEADERS, 'Assigned SA ID', 'Assigned Branch ID', 'Handover Reason', 'SA Review Required', 'Processing Mode'];
  const leadHeaders = ['Lead ID', 'Phone Number', ...FOLLOW_UP_APPLICATION_HEADERS, 'Assigned SA ID', 'Selected Branch ID', 'Handover Reason', 'Processing Mode', 'Lead Status'];
  const outboxHeaders = ['Outbox ID', 'Created At', 'Lead ID', 'Application ID', 'Phone Number', 'Message Type', 'Message Text', 'Template Name', 'Language', 'Send Status', 'Attempt Count', 'Sent At', 'Provider Message ID', 'Error Message', 'WhatsApp Number ID', 'Internal Channel ID', 'Automation Key', 'Follow Up Rule', 'Follow Up Attempt'];
  const tables = {
    Applications: table(appHeaders, [{ 'Application ID': 'APP-TEST', 'Lead ID': 'LEAD-TEST', 'Phone Number': '0123456789', 'Application Status': 'OPEN', 'Missing Documents': 'IC_FRONT', 'Origin WhatsApp Channel ID': 'FOLLOWUP_TEST', 'Created At': '2026-09-07T01:00:00.000Z', 'Last Customer Reply At': '2026-09-07T01:00:00.000Z' }]),
    Leads: table(leadHeaders, [{ 'Lead ID': 'LEAD-TEST', 'Phone Number': '0123456789' }]),
    Document_Log: [['Application ID']],
    Message_Outbox: [outboxHeaders],
    WhatsApp_Number_Master: table(['Internal Channel ID', 'Phone Number ID', 'Active', 'Outbound Enabled', 'Last Verified At'], [{ 'Internal Channel ID': 'FOLLOWUP_TEST', 'Phone Number ID': 'test-number', Active: 'TRUE', 'Outbound Enabled': 'TRUE', 'Last Verified At': '2026-09-07T01:00:00.000Z' }]),
    Follow_Up_Settings: table(['Rule ID', 'First Delay Hours'], [{ 'Rule ID': 'DOCUMENTS_NOT_STARTED', 'First Delay Hours': '1' }]),
    Activity_Log: [['Activity ID', 'Occurred At', 'Lead ID', 'Application ID', 'Activity Type', 'Description', 'Actor Username']],
    Conversation_State: [['Lead ID']],
    SA_Master: [['Last Assigned At']]
  };
  const facts = { sends: 0, reservedBeforeSend: false, failedSentLog: false, writes: [] };
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    if (url.includes('sts.googleapis.com')) return response({ access_token: 'mock-federated' });
    if (url.includes('iamcredentials.googleapis.com')) return response({ accessToken: 'mock-sheets' });
    if (url.includes('graph.facebook.com')) {
      facts.sends += 1;
      facts.reservedBeforeSend = tables.Message_Outbox.some((row, index) => index && row[outboxHeaders.indexOf('Send Status')] === 'SENDING');
      if (uncertainSend) throw new Error('Connection ended after request upload');
      return response({ messages: [{ id: 'wamid.followup-safe' }] });
    }
    if (url.includes('/values:batchUpdate')) {
      const data = JSON.parse(options.body).data;
      facts.writes.push(...data);
      if (failSentLog && !facts.failedSentLog && data.some(cell => cell.range.startsWith('Message_Outbox!') && cell.values[0][0] === 'SENT')) { facts.failedSentLog = true; return response({}, 503); }
      for (const cell of data) {
        const [, sheet, letters, row] = cell.range.match(/^(.+)!([A-Z]+)(\d+)$/);
        tables[sheet][Number(row) - 1][columnIndex(letters)] = cell.values[0][0];
      }
      return response();
    }
    const range = decodeURIComponent(new URL(url).pathname.split('/values/')[1] || '');
    const sheet = range.split('!')[0];
    if (!tables[sheet]) throw new Error(`Unexpected test endpoint: ${url}`);
    if (range.endsWith(':append')) {
      assert.equal(new URL(url).searchParams.get('valueInputOption'), 'RAW');
      tables[sheet].push(...JSON.parse(options.body).values);
      return response({ updates: { updatedRange: `${sheet}!A${tables[sheet].length}:Z${tables[sheet].length}` } });
    }
    return response({ values: /!(?:1:1|A1:Z1)$/.test(range) ? [tables[sheet][0]] : tables[sheet] });
  });
  const { runFollowUpDispatch } = await import(`../api/follow-up-dispatch.js?test=${Math.random()}`);
  return { run: () => runFollowUpDispatch({ headers: { 'x-vercel-oidc-token': 'mock-oidc' } }), facts, tables, outboxHeaders };
}

test('follow-up reserves a durable send record before contacting Meta and retries do not duplicate an accepted message', async t => {
  const { run, facts, tables, outboxHeaders } = await setup(t, { failSentLog: true });
  await assert.rejects(run, /Unable to update Message_Outbox/);
  assert.equal(facts.reservedBeforeSend, true);
  assert.equal(tables.Message_Outbox[1][outboxHeaders.indexOf('Send Status')], 'SENDING');
  const retried = await run();
  assert.equal(facts.sends, 1);
  assert.equal(retried.results[0].skipped, 'DUPLICATE');
});

test('follow-up with an ambiguous network outcome is held and not delivered again', async t => {
  const { run, facts, tables, outboxHeaders } = await setup(t, { uncertainSend: true });
  const result = await run();
  assert.equal(result.summary.sent, 0);
  assert.equal(tables.Message_Outbox[1][outboxHeaders.indexOf('Send Status')], 'DELIVERY_UNKNOWN');
  await run();
  assert.equal(facts.sends, 1);
});
