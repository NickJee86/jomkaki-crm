import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildAiFallbackRequest, buildAutomaticApplication, buildDocumentProgressReply, buildImmediateAcknowledgement, buildInitialConversationState, buildInstantSalesDecision, buildMediaProxyUrl, extractCustomerName, hasRecentDocumentAcknowledgement, inferDocumentTypeFromFileName, instantChannelCredentials, isDocumentStatusQuestion, isStaleInboundMessage, matchInstantProduct, releaseInboundMessage, requestAiFallbackReply, reserveInboundMessage, resolveCustomerLocation, sanitizeAiFallbackReply, shouldSendImmediateAcknowledgement } from '../api/whatsapp-webhook.js';
import { verifyMediaProxyQuery } from '../api/whatsapp-media.js';
import { approvedMonthlyRateFields, JOMKAKI_KNOWLEDGE } from '../api/_jomkaki-knowledge.js';

const source = fs.readFileSync(new URL('../api/whatsapp-webhook.js', import.meta.url), 'utf8');
const route = {
  'Internal Channel ID': 'JKM-WA-WEST-01',
  'Phone Number ID': 'W-100',
  'Credential Key': 'WHATSAPP_WEST_01',
  'Outbound Enabled': 'TRUE'
};

test('approved Notion knowledge snapshot governs language, pricing and consent rules', () => {
  assert.equal(JOMKAKI_KNOWLEDGE.status, 'APPROVED');
  assert.equal(JOMKAKI_KNOWLEDGE.conversation.defaultLanguage, 'MS');
  assert.equal(JOMKAKI_KNOWLEDGE.conversation.targetReplySeconds, 5);
  assert.equal(JOMKAKI_KNOWLEDGE.conversation.discloseAutomation, false);
  assert.equal(JOMKAKI_KNOWLEDGE.conversation.answerCustomerIntentBeforeProfileQuestions, true);
  assert.equal(JOMKAKI_KNOWLEDGE.conversation.profileCollectionIsNonBlocking, true);
  assert.equal(JOMKAKI_KNOWLEDGE.conversation.aiFallback.model, 'gpt-4.1-mini');
  assert.equal(JOMKAKI_KNOWLEDGE.conversation.aiFallback.reasoningEffort, '');
  assert.equal(JOMKAKI_KNOWLEDGE.conversation.aiFallback.noSilenceFallback, true);
  assert.equal(JOMKAKI_KNOWLEDGE.pricing.exposeCashPrice, false);
  assert.equal(JOMKAKI_KNOWLEDGE.pricing.exposeMotorDeposit, true);
  assert.equal(JOMKAKI_KNOWLEDGE.pricing.exposeHandphoneDeposit, false);
  assert.equal(JOMKAKI_KNOWLEDGE.documents.consentRequiredBeforeLms, true);
  assert.deepEqual(approvedMonthlyRateFields('HANDPHONE').map(([, field]) => field), [
    'Monthly 60 Months (RM)', 'Monthly 48 Months (RM)', 'Monthly 36 Months (RM)', 'Monthly 24 Months (RM)', 'Monthly 12 Months (RM)'
  ]);
});

test('inbound message reservation blocks concurrent duplicate delivery and permits retry after release', () => {
  const messageId = `wamid.test.${Date.now()}`;
  assert.equal(reserveInboundMessage(messageId, 1000), true);
  assert.equal(reserveInboundMessage(messageId, 1001), false);
  releaseInboundMessage(messageId);
  assert.equal(reserveInboundMessage(messageId, 1002), true);
  releaseInboundMessage(messageId);
});

test('instant acknowledgement follows the customer language without quoting prices', () => {
  const chinese = buildImmediateAcknowledgement('è¯·é—® Y16ZR æœˆä¾›å¤šå°‘ï¼Ÿ', 'text');
  const malay = buildImmediateAcknowledgement('Hai, nak tanya ansuran motor', 'text');
  const english = buildImmediateAcknowledgement('How much is the monthly payment?', 'text');
  assert.match(chinese, /å·²æ”¶åˆ°/);
  assert.match(malay, /telah menerima/);
  assert.match(english, /received/);
  [chinese, malay, english].forEach(message => {
    assert.doesNotMatch(message, /RM|selling price|cash price|å”®ä»·|ä»·é’±/i);
    assert.doesNotMatch(message, /\b(?:AI|bot|chatbot|automated)\b/i);
  });
  assert.equal(buildImmediateAcknowledgement('[document]', 'document'), '');
});

test('webhook acknowledgement stays disabled so one inbound produces one final reply', () => {
  assert.equal(shouldSendImmediateAcknowledgement({ route, routeUsable: true, messageType: 'text', receivedAt: '2026-08-14T07:00:00Z' }), false);
  assert.equal(shouldSendImmediateAcknowledgement({ route, routeUsable: true, messageType: 'text', previousInboundAt: '2026-08-14T07:00:00Z', receivedAt: '2026-08-14T07:00:30Z' }), false);
  assert.equal(shouldSendImmediateAcknowledgement({ route, routeUsable: true, messageType: 'text', previousInboundAt: '2026-08-14T07:00:00Z', receivedAt: '2026-08-14T07:02:00Z' }), false);
  assert.equal(shouldSendImmediateAcknowledgement({ route, routeUsable: false, messageType: 'text' }), false);
  assert.equal(shouldSendImmediateAcknowledgement({ route, routeUsable: true, human: true, messageType: 'text' }), false);
  assert.equal(shouldSendImmediateAcknowledgement({ route: { ...route, 'Outbound Enabled': 'FALSE' }, routeUsable: true, messageType: 'text' }), false);
});

test('webhook persists the next conversation step before sending the reply', () => {
  const persistIndex = source.indexOf("await updateObject(token, 'Conversation_State', 'State ID', conversationState['State ID'], latestInbound, 'AK')");
  const sendIndex = source.indexOf('instantResult = await sendInstantSalesMessage({ route, phone, decision: instantDecision })');
  assert.ok(persistIndex > 0);
  assert.ok(sendIndex > persistIndex);
  assert.match(source, /'Last AI Message': clean\(instantDecision\.text\)/);
  assert.doesNotMatch(source, /'Last AI Reply'/);
});

test('an older Meta delivery can be recorded but must never receive a reply', () => {
  assert.equal(isStaleInboundMessage('2026-08-15T00:58:51.000Z', '2026-08-15T02:14:16.000Z'), true);
  assert.equal(isStaleInboundMessage('2026-08-15T02:14:16.000Z', '2026-08-15T02:14:16.000Z'), false);
  assert.equal(isStaleInboundMessage('2026-08-15T02:15:00.000Z', '2026-08-15T02:14:16.000Z'), false);
  assert.match(source, /IGNORED_STALE_OR_REDELIVERED/);
  assert.match(source, /if \(staleInbound\)[\s\S]*?continue;/);
});

test('a rapid document batch receives one acknowledgement while every file stays queued', () => {
  const first = buildInstantSalesDecision({ state: { 'Current Step': 'STEP_04_DOCUMENTS' }, text: '[document]', messageType: 'document' });
  assert.equal(first.handled, true);
  assert.equal(first.documentQueued, true);
  assert.match(first.text, /Dokumen (?:anda )?sudah diterima/i);
  assert.match(first.text, /tak perlu hantar semula/i);
  assert.doesNotMatch(first.text, /satu per satu/i);

  const recentState = { 'Last AI Message': first.text, 'Last AI Message At': '2026-08-15T02:00:00.000Z' };
  assert.equal(hasRecentDocumentAcknowledgement(recentState, Date.parse('2026-08-15T02:01:00.000Z')), true);
  const next = buildInstantSalesDecision({ state: recentState, text: '[document]', messageType: 'document', suppressDocumentAcknowledgement: true });
  assert.equal(next.handled, false);
  assert.equal(next.documentQueued, true);
  assert.equal(next.text, '');
  assert.equal(hasRecentDocumentAcknowledgement(recentState, Date.parse('2026-08-15T02:03:00.000Z')), false);
  assert.match(source, /AI_DOCUMENT_QUEUED/);
});

test('document follow-up questions receive a useful reply instead of silence', () => {
  const documents = [
    { 'Message ID': 'm1', 'File Name': 'PROOF_OF_IDENTITY_123.pdf', 'Document Type': 'UNCLASSIFIED', 'Verification Status': 'PENDING_AI' },
    { 'Message ID': 'm2', 'File Name': 'PAYSLIPS_123.pdf', 'Document Type': 'UNCLASSIFIED', 'Verification Status': 'PENDING_AI' },
    { 'Message ID': 'm3', 'File Name': 'EPF_STATEMENT_123.pdf', 'Document Type': 'UNCLASSIFIED', 'Verification Status': 'PENDING_AI' },
    { 'Message ID': 'm4', 'File Name': 'BANK_STATEMENT_123.pdf', 'Document Type': 'UNCLASSIFIED', 'Verification Status': 'PENDING_AI' },
    { 'Message ID': 'm5', 'File Name': 'PROOF_OF_ADDRESS_123.pdf', 'Document Type': 'UNCLASSIFIED', 'Verification Status': 'PENDING_AI' },
    { 'Message ID': 'm6', 'File Name': 'PROOF_OF_IDENTITY_123.pdf', 'Document Type': 'UNCLASSIFIED', 'Verification Status': 'PENDING_AI' }
  ];
  assert.equal(isDocumentStatusQuestion('dah hantar semua, apa lagi perlu?'), true);
  const decision = buildInstantSalesDecision({ state: { 'Current Step': 'STEP_04_DOCUMENTS' }, text: 'dah hantar semua, apa lagi perlu?', messageType: 'text', documents });
  assert.equal(decision.handled, true);
  assert.equal(decision.nextStep, 'STEP_04_DOCUMENTS');
  assert.match(decision.text, /sudah terima 5 fail/i);
  assert.match(decision.text, /dokumen minimum ialah IC depan dan belakang/i);
  assert.match(decision.text, /tak perlu hantar semula/i);
  assert.match(decision.text, /CTOS\/CCRIS/i);
});

test('document progress lists only the missing requirement after verification', () => {
  const reply = buildDocumentProgressReply('MS', [
    { 'Message ID': 'm1', 'Document Type': 'IC_FRONT', 'Verification Status': 'AI_VERIFIED', 'Quality Status': 'GOOD' },
    { 'Message ID': 'm2', 'Document Type': 'IC_BACK', 'Verification Status': 'AI_VERIFIED', 'Quality Status': 'GOOD' }
  ]);
  assert.match(reply, /slip gaji atau penyata EPF/i);
  assert.doesNotMatch(reply, /IC depan dan IC belakang/i);
});

test('known customer document filenames get a safe preliminary classification', () => {
  assert.equal(inferDocumentTypeFromFileName('PROOF_OF_IDENTITY_1780477282198.pdf'), 'IDENTITY_DOCUMENT');
  assert.equal(inferDocumentTypeFromFileName('PAYSLIPS_1780477332925.pdf'), 'PAYSLIP');
  assert.equal(inferDocumentTypeFromFileName('EPF_STATEMENT_1780471763828.pdf'), 'EPF_STATEMENT');
  assert.equal(inferDocumentTypeFromFileName('holiday-photo.jpg'), 'UNCLASSIFIED');
});

test('automatic WhatsApp application binds the lead, product and channel', () => {
  const application = buildAutomaticApplication({
    applicationId: 'APP-AUTO-1',
    receivedAt: '2026-08-15T03:00:00.000Z',
    lead: { 'Lead ID': 'LEAD-1', 'Customer ID': 'CUS-1', 'Customer Name': 'Amin', 'Phone Number': '60123456789', Region: 'EAST_MALAYSIA', 'Selected Branch ID': 'BR-BTU', 'Team ID': 'TEAM-BTU' },
    state: { 'Customer Name': 'Amin' },
    decision: { productUnit: 'MOTOR', product: { Brand: 'Yamaha', Model: 'NMAX V3', Variant: 'Standard' } },
    channelId: 'JKM-WA-EAST-01'
  });
  assert.equal(application['Application ID'], 'APP-AUTO-1');
  assert.equal(application['Lead ID'], 'LEAD-1');
  assert.equal(application['Origin WhatsApp Channel ID'], 'JKM-WA-EAST-01');
  assert.equal(application['Product Model'], 'NMAX V3');
  assert.equal(application['Current Stage'], 'DOCUMENT_COLLECTION');
});

test('signed WhatsApp media proxy URLs expire and cannot be forged', () => {
  const url = buildMediaProxyUrl({ mediaId: 'MEDIA-1', channelId: 'JKM-WA-EAST-01', credentialKey: 'WHATSAPP_EAST_01', expires: 2000, secret: 'test-secret', baseUrl: 'https://crm.example.test' });
  const parsed = new URL(url);
  const query = Object.fromEntries(parsed.searchParams.entries());
  assert.equal(verifyMediaProxyQuery(query, 'test-secret', 1000).valid, true);
  assert.equal(verifyMediaProxyQuery({ ...query, id: 'MEDIA-2' }, 'test-secret', 1000).valid, false);
  assert.equal(verifyMediaProxyQuery(query, 'test-secret', 3000).valid, false);
});

test('instant channel credentials remain strict even though webhook acknowledgement is disabled', () => {
  const credentials = instantChannelCredentials(route, { WHATSAPP_WEST_01_ACCESS_TOKEN: 'protected-token', WHATSAPP_GRAPH_VERSION: 'v26.0' });
  assert.deepEqual(credentials, { channelId: 'JKM-WA-WEST-01', phoneNumberId: 'W-100', accessToken: 'protected-token', version: 'v26.0' });
  assert.throws(() => instantChannelCredentials(route, { WHATSAPP_ACCESS_TOKEN: 'legacy-token' }), /incomplete/);
  assert.match(source, /WHATSAPP_SEND_MODE/);
  assert.match(source, /WEBHOOK_IMMEDIATE_ACK/);
  assert.match(source, /'Send Status': response\.ok \? 'SENT' : 'FAILED'/);
  assert.doesNotMatch(source, /await sendImmediateAcknowledgement\(token/);
});

test('first inbound message creates the conversation state required by Make', () => {
  const state = buildInitialConversationState({
    lead: { 'Lead ID': 'LEAD-1', 'Customer ID': 'CUS-1', 'Customer Name': 'Test Customer', 'Selected Branch ID': 'BR-1' },
    application: {},
    route: { 'WABA ID': 'WABA-1', 'Display Number': '+60 14-795 2387' },
    phone: '016-896 8888',
    text: 'I am looking for Yamaha Y16ZR.',
    messageId: 'wamid-1',
    receivedAt: '2026-08-14T08:05:36.000Z',
    numberId: 'PHONE-1',
    channelId: 'JKM-WA-WEST-01',
    businessUnit: 'MOTOR',
    teamId: 'TEAM-WEST'
  });
  assert.match(state['State ID'], /^STATE-/);
  assert.equal(state['Lead ID'], 'LEAD-1');
  assert.equal(state['Phone Number'], '60168968888');
  assert.equal(state['Current Step'], 'STEP_01_WELCOME');
  assert.equal(state['Last Customer Message'], 'I am looking for Yamaha Y16ZR.');
  assert.equal(state['Channel Binding Status'], 'BOUND');
  assert.equal(state['Escalation Required'], 'FALSE');
});

test('sales onboarding safely captures the customer name', () => {
  assert.equal(extractCustomerName('Nama saya Ahmad Hakim'), 'Ahmad Hakim');
  assert.equal(extractCustomerName('Call me Mei Ling'), 'Mei Ling');
  assert.equal(extractCustomerName('Yamaha Y16ZR'), '');
  assert.equal(extractCustomerName('hi'), '');
});

test('customer area resolves to the correct active business branch', () => {
  const branches = [
    { 'Branch ID': 'BR-WM-PJ', 'Branch Name': 'Petaling Jaya', Region: 'WEST_MALAYSIA', City: 'Petaling Jaya', 'Direct Coverage Areas': 'Petaling Jaya|Kuala Lumpur|Selangor|Klang Valley|Seremban|Nilai|Penang', Active: 'TRUE', 'Business Unit': 'MOTOR', 'Team ID': 'TEAM-MOTOR-WEST-PJ' },
    { 'Branch ID': 'BR-SWK-BKW', 'Branch Name': 'Batu Kawa', Region: 'SARAWAK', City: 'Kuching', 'Direct Coverage Areas': 'Batu Kawa', Active: 'TRUE', 'Business Unit': 'MOTOR', 'Team ID': 'TEAM-MOTOR-EAST-BKW' },
    { 'Branch ID': 'BR-SWK-STK', 'Branch Name': 'Satok', Region: 'SARAWAK', City: 'Kuching', 'Direct Coverage Areas': 'Satok', Active: 'TRUE', 'Business Unit': 'MOTOR', 'Team ID': 'TEAM-MOTOR-EAST-STK' },
    { 'Branch ID': 'BR-SWK-BTU', 'Branch Name': 'Bintulu', Region: 'SARAWAK', City: 'Bintulu', 'Direct Coverage Areas': 'Bintulu', Active: 'TRUE', 'Business Unit': 'MOTOR', 'Team ID': 'TEAM-MOTOR-EAST-BTU' }
  ];
  assert.deepEqual(resolveCustomerLocation('Saya dari Batu Kawa, Sarawak', 'MOTOR', branches), {
    region: 'EAST_MALAYSIA', state: 'Sarawak', city: 'Batu Kawa', branchId: 'BR-SWK-BKW', teamId: 'TEAM-MOTOR-EAST-BKW', resolved: true
  });
  assert.equal(resolveCustomerLocation('KL', 'MOTOR', branches).branchId, 'BR-WM-PJ');
  assert.equal(resolveCustomerLocation('bintu;u', 'MOTOR', branches).branchId, 'BR-SWK-BTU');
  assert.equal(resolveCustomerLocation('bintlu', 'MOTOR', branches).city, 'Bintulu');
  assert.equal(resolveCustomerLocation('hello', 'MOTOR', branches), null);
});

test('instant sales flow asks name, then location, then product', () => {
  const welcome = buildInstantSalesDecision({ state: { 'Current Step': 'STEP_01_WELCOME' }, text: 'Hi', messageType: 'text' });
  assert.equal(welcome.nextStep, 'STEP_01_NAME');
  assert.match(welcome.text, /nama/i);
  assert.match(welcome.text, /terima kasih|ansuran bulanan/i);
  assert.doesNotMatch(welcome.text, /age|\bAI\b/i);
  assert.doesNotMatch(welcome.text, /[ã_u¶‰žËkºwµçA…ÍÍ•ÉÐ¹•ÅÕ…°¡‘•¥Í¥½¸¹ÁÉ½‘ÕÐ¹5½‘•°°€1ÄÌÔXàœ¤ì(€…ÍÍ•ÉÐ¹•ÅÕ…°¡‘•¥Í¥½¸¹¥µ…•UÉ°°€¡ÑÑÁÌè¼½‘¸¹•á…µÁ±”¹Ñ•ÍÐ½±ŒÄÌÔµØà¹©Áœœ¤ì(€…ÍÍ•ÉÐ¹µ…Ñ ¡‘•¥Í¥½¸¹Ñ•áÐ°€½‘•Á½Í¥Ð¸©I4ÔÀÀ½¤¤ì(€…ÍÍ•ÉÐ¹µ…Ñ ¡‘•¥Í¥½¸¹Ñ•áÐ°€½I4ÈäÔ¼¤ì(€…ÍÍ•ÉÐ¹‘½•Í9½Ñ5…Ñ ¡‘•¥Í¥½¸¹Ñ•áÐ°€½¹‘„µ…¡ÔÍ…å„Í•µ…¬å…¹œµ…¹…ñdÄÕiH½¤¤ì)ô¤ì()Ñ•ÍÐ Ñ¡”Ý¡½±”…Ñ…±½Õ”…•ÁÑÌ¹…ÑÕÉ…°ÕÍÑ½µ•ÈÍ¡½ÉÑ¡…¹¥¹ÍÑ•…½˜½¹±äÍ•±•Ñ••á…µÁ±•Ìœ°€ ¤€ôøì(€½¹ÍÐ…Ñ…±½œ€ôl(€€€ì€…Ñ…±½œ%œè€5QHµe4µ9Y`œ°	É…¹è€e…µ…¡„œ°5½‘•°è€9Y`œ°Ñ¥Ù”è€QIUœ°€M•…É -•åÝ½É‘Ìœè€å…µ…¡„¹ÙàÍ½½Ñ•Èœô°(€€€ì€…Ñ…±½œ%œè€5QHµ!=8µ]Yœ°	É…¹è€!½¹‘„œ°5½‘•°è€]…Ù”±Á¡„œ°Ñ¥Ù”è€QIUœ°€M•…É -•åÝ½É‘Ìœè€¡½¹‘„Ý…Ù”…±Á¡„œô°(€€€ì€…Ñ…±½œ%œè€5QHµ!=8µILÄÔÁHœ°	É…¹è€!½¹‘„œ°5½‘•°è€ILÄÔÁHœ°Ñ¥Ù”è€QIUœ°€M•…É -•åÝ½É‘Ìœè€¡½¹‘„ÉÌÄÔÀÉÌÄÔÁÈœô°(€€€ì€…Ñ…±½œ%œè€5QHµMe4µ!UM-dœ°	É…¹è€Me4œ°5½‘•°è€!ÕÍ­ä€ÈÀÀœ°Ñ¥Ù”è€QIUœ°€M•…É -•åÝ½É‘Ìœè€Íå´¡ÕÍ­ä¡ÕÍ­äÈÀÀœô°(€€€ì€…Ñ…±½œ%œè€5QHµ5=µ5=œ°	É…¹è€5=œ°5½‘•°è€5½„œ°Ñ¥Ù”è€QIUœ°€M•…É -•åÝ½É‘Ìœè€µ½‘„µ½„œô(€tì(€…ÍÍ•ÉÐ¹•ÅÕ…°¡µ…Ñ¡%¹ÍÑ…¹ÑAÉ½‘ÕÐ ¹…¬Ñ•¹½¬¹Ùàœ°…Ñ…±½œ¤¹ÁÉ½‘ÕÐ¹5½‘•°°€9Y`œ¤ì(€…ÍÍ•ÉÐ¹•ÅÕ…°¡µ…Ñ¡%¹ÍÑ…¹ÑAÉ½‘ÕÐ Ý…Ù”…‘„üœ°…Ñ…±½œ¤¹ÁÉ½‘ÕÐ¹5½‘•°°€]…Ù”±Á¡„œ¤ì(€…ÍÍ•ÉÐ¹•ÅÕ…°¡µ…Ñ¡%¹ÍÑ…¹ÑAÉ½‘ÕÐ ÉÌÄÔÀ‰•É…Á„Í•‰Õ±…¸œ°…Ñ…±½œ¤¹ÁÉ½‘ÕÐ¹5½‘•°°€ILÄÔÁHœ¤ì(€…ÍÍ•ÉÐ¹•ÅÕ…°¡µ…Ñ¡%¹ÍÑ…¹ÑAÉ½‘ÕÐ ¡ÕÍ­ä…‘„ÍÑ½¬­„œ°…Ñ…±½œ¤¹ÁÉ½‘ÕÐ¹5½‘•°°€!ÕÍ­ä€ÈÀÀœ¤ì(€…ÍÍ•ÉÐ¹•ÅÕ…°¡µ…Ñ¡%¹ÍÑ…¹ÑAÉ½‘ÕÐ Í…å„µ¥¹…Ðµ½„œ°…Ñ…±½œ¤¹ÁÉ½‘ÕÐ¹5½‘•°°€5½„œ¤ì)ô¤ì()Ñ•ÍÐ …¸Õ¹ÁÉ¥•‰…Í”µ½‘•°™…±±Ì‰…¬Ñ¼¥ÑÌ…ÁÁÉ½Ù•ÁÉ¥•Ù…É¥…¹Ð¥¹ÍÑ•…½˜½¥¹œÍ¥±•¹Ðœ°€ ¤€ôøì(€½¹ÍÐ‘•¥Í¥½¸€ô‰Õ¥±‘%¹ÍÑ…¹ÑM…±•Í•¥Í¥½¸¡ì(€€€ÍÑ…Ñ”èì€ÕÉÉ•¹ÐMÑ•Àœè€MQA|ÀÍ}AI=UPœ°€ÕÍÑ½µ•È9…µ”œè€-…µ¥Ìœ°€AÉ½‘ÕÐ…Ñ•½Éäœè€5=Q=Hœô°(€€€±•…èì€ÕÍÑ½µ•È9…µ”œè€-…µ¥Ìœ°I•¥½¸è€MQ}51eM%œ°MÑ…Ñ”è€M…É…Ý…¬œ°€¥Ñä½ÈÉ•„œè€	¥¹ÑÕ±Ôœô°(€€€Ñ•áÐè€µ½Ñ½È¹µ…àœ°µ•ÍÍ…•QåÁ”è€Ñ•áÐœ°É½ÕÑ•	ÕÍ¥¹•ÍÍU¹¥Ðè€5=Q=Hœ°É½ÕÑ•I•¥½¸è€]MQ}51eM%œ°(€€€µ½Ñ½É…Ñ…±½œèl(€€€€€ì€…Ñ…±½œ%œè€5QHµe4µ95`œ°	É…¹è€e…µ…¡„œ°5½‘•°è€95`œ°Ñ¥Ù”è€QIUœ°€M•…É -•åÝ½É‘Ìœè€å…µ…¡„¹µ…à¸µ…àœô°(€€€€€ì€…Ñ…±½œ%œè€5QHµe4µ95aXÌœ°	É…¹è€e…µ…¡„œ°5½‘•°è€95`XÌœ°Ñ¥Ù”è€QIUœ°€%µ…”ÁÁÉ½Ù•œè€QIUœ°€%µ…”UI0œè€¡ÑÑÁÌè¼½‘¸¹•á…µÁ±”¹Ñ•ÍÐ½¹µ…àµØÌ¹©Áœœ°€M•…É -•åÝ½É‘Ìœè€å…µ…¡„¹µ…àØÌœô(€€€t°(€€€µ½Ñ½ÉAÉ¥¥¹œèl(€€€€€ì€…Ñ…±½œ%œè€5QHµe4µ95aXÌœ°€AÉ¥”i½¹”œè€MQ}51eM%œ°Ñ¥Ù”è€QIUœ°€EÕ½Ñ”ÁÁÉ½Ù…°MÑ…ÑÕÌœè€AAI=Yœ°€5½¹Ñ¡±ä€Ìe•…ÉÌ€¡I4¤œè€œÔÈØœ°€5½¹Ñ¡±ä€Ðe•…ÉÌ€¡I4¤œè€œÐÈÔœ°€5½¹Ñ¡±ä€Ôe•…ÉÌ€¡I4¤œè€œÌØÔœô(€€€t(€ô¤ì(€…ÍÍ•ÉÐ¹•ÅÕ…°¡‘•¥Í¥½¸¹ÁÉ½‘ÕÐ¹5½‘•°°€95`XÌœ¤ì(€…ÍÍ•ÉÐ¹•ÅÕ…°¡‘•¥Í¥½¸¹¹•áÑMÑ•À°€MQA|ÀÑ}=U59QLœ¤ì(€…ÍÍ•ÉÐ¹•ÅÕ…°¡‘•¥Í¥½¸¹¥µ…•UÉ°°€¡ÑÑÁÌè¼½‘¸¹•á…µÁ±”¹Ñ•ÍÐ½¹µ…àµØÌ¹©Áœœ¤ì(€…ÍÍ•ÉÐ¹µ…Ñ ¡‘•¥Í¥½¸¹Ñ•áÐ°€½95`XÌ¼¤ì(€…ÍÍ•ÉÐ¹µ…Ñ ¡‘•¥Í¥½¸¹Ñ•áÐ°€½I4ÌØÔ¼¤ì)ô¤ì()Ñ•ÍÐ „É•½¹¥Í•µ½‘•°Ý¥Ñ¡½ÕÐ…ÁÁÉ½Ù•É•¥½¹…°ÁÉ¥¥¹œ•ÑÌ„ÕÍ•™Õ°É•Á±ä¥¹ÍÑ•…½˜Í¥±•¹”œ°€ ¤€ôøì(€½¹ÍÐ‘•¥Í¥½¸€ô‰Õ¥±‘%¹ÍÑ…¹ÑM…±•Í•¥Í¥½¸¡ì(€€€ÍÑ…Ñ”èì€ÕÉÉ•¹ÐMÑ•Àœè€MQA|ÀÍ}AI=UPœ°€AÉ½‘ÕÐ…Ñ•½Éäœè€5=Q=Hœô°(€€€±•…èì€ÕÍÑ½µ•È9…µ”œè€-…µ¥Ìœ°I•¥½¸è€MQ}51eM%œ°MÑ…Ñ”è€M…É…Ý…¬œ°€¥Ñä½ÈÉ•„œè€	¥¹ÑÕ±Ôœô°Ñ•áÐè€¹…¬¹µ…àœ°µ•ÍÍ…•QåÁ”è€Ñ•áÐœ°É½ÕÑ•	ÕÍ¥¹•ÍÍU¹¥Ðè€5=Q=Hœ°(€€€µ½Ñ½É…Ñ…±½œèmì€…Ñ…±½œ%œè€5QHµe4µ95`œ°	É…¹è€e…µ…¡„œ°5½‘•°è€95`œ°Ñ¥Ù”è€QIUœ°€M•…É -•åÝ½É‘Ìœè€å…µ…¡„¹µ…àœõt°(€€€µ½Ñ½ÉAÉ¥¥¹œèmt(€ô¤ì(€…ÍÍ•ÉÐ¹•ÅÕ…°¡‘•¥Í¥½¸¹¡…¹‘±•°ÑÉÕ”¤ì(€…ÍÍ•ÉÐ¹•ÅÕ…°¡‘•¥Í¥½¸¹¹•áÑMÑ•À°€MQA|ÀÍ}AI=UPœ¤ì(€…ÍÍ•ÉÐ¹µ…Ñ ¡‘•¥Í¥½¸¹Ñ•áÐ°€½95`¼¤ì(€…ÍÍ•ÉÐ¹µ…Ñ ¡‘•¥Í¥½¸¹Ñ•áÐ°€½Í•µ…¬‘•¹…¸…Ý…¹…¸½¤¤ì)ô¤ì()Ñ•ÍÐ …µ‰¥Õ½ÕÌÍ¡½ÉÑ¡…¹…Í­Ì½¹”¹…ÑÕÉ…°±…É¥™¥…Ñ¥½¸¥¹ÍÑ•…½˜Õ•ÍÍ¥¹œœ°€ ¤€ôøì(€½¹ÍÐ…Ñ…±½œ€ôl(€€€ì€…Ñ…±½œ%œè€5QHµe4µdÄÙiHœ°	É…¹è€e…µ…¡„œ°5½‘•°è€dÄÙiHœ°Ñ¥Ù”è€QIUœ°€M•…É -•åÝ½É‘Ìœè€å…µ…¡„äÄØäÄÙéÈäÄØéÈœô°(€€€ì€…Ñ…±½œ%œè€5QHµe4µdÄÙ	Lœ°	É…¹è€e…µ…¡„œ°5½‘•°è€dÄØ	Lœ°Ñ¥Ù”è€QIUœ°€M•…É -•åÝ½É‘Ìœè€å…µ…¡„äÄØ…‰Ìœô(€tì(€½¹ÍÐµ…Ñ €ôµ…Ñ¡%¹ÍÑ…¹ÑAÉ½‘ÕÐ äÄØœ°…Ñ…±½œ¤ì(€…ÍÍ•ÉÐ¹•ÅÕ…°¡µ…Ñ ¹…µ‰¥Õ½ÕÌ°ÑÉÕ”¤ì(€…ÍÍ•ÉÐ¹‘••ÁÅÕ…°¡µ…Ñ ¹½ÁÑ¥½¹Ì°le…µ…¡„dÄØ	Lœ°€e…µ…¡„dÄÙiHt¤ì(€½¹ÍÐ‘•¥Í¥½¸€ô‰Õ¥±‘%¹ÍÑ…¹ÑM…±•Í•¥Í¥½¸¡ì(€€€ÍÑ…Ñ”èì€ÕÉÉ•¹ÐMÑ•Àœè€MQA|ÀÍ}AI=UPœ°€AÉ½‘ÕÐ…Ñ•½Éäœè€5=Q=Hœô°(€€€±•…èì€ÕÍÑ½µ•È9…µ”œè€)¥´œ°I•¥½¸è€MQ}51eM%œô°Ñ•áÐè€äÄØœ°µ•ÍÍ…•QåÁ”è€Ñ•áÐœ°É½ÕÑ•	ÕÍ¥¹•ÍÍU¹¥Ðè€5=Q=Hœ°µ½Ñ½É…Ñ…±½œè…Ñ…±½œ(€ô¤ì(€…ÍÍ•ÉÐ¹•ÅÕ…°¡‘•¥Í¥½¸¹¹•áÑMÑ•À°€MQA|ÀÍ}AI=UPœ¤ì(€…ÍÍ•ÉÐ¹µ…Ñ ¡‘•¥Í¥½¸¹Ñ•áÐ°€½5…­ÍÕ…¹‘„e…µ…¡„dÄØ	L…Ñ…Ôe…µ…¡„dÄÙiH¼¤ì(€…ÍÍ•ÉÐ¹‘½•Í9½Ñ5…Ñ ¡‘•¥Í¥½¸¹Ñ•áÐ°€½I5q¼¤ì)ô¤ì()Ñ•ÍÐ ‰É…¹µ½¹±äÅÕ•ÍÑ¥½¹Ì‘¼¹½Ð¥¹Ù•¹Ð…¸…É‰¥ÑÉ…Éäµ½‘•°Í¡½ÉÑ±¥ÍÐœ°€ ¤€ôøì(€½¹ÍÐ…Ñ…±½œ€ôl(€€€ì€…Ñ…±½œ%œè€5QHµe4µ=œ°	É…¹è€e…µ…¡„œ°5½‘•°è€¼Ù…¹Ñ¥èœ°Ñ¥Ù”è€QIUœ°€M•…É -•åÝ½É‘Ìœè€å…µ…¡„•¼…Ù…¹Ñ¥èœô°(€€€ì€…Ñ…±½œ%œè€5QHµe4µ=œ°	É…¹è€e…µ…¡„œ°5½‘•°è€¼•…Èœ°Ñ¥Ù”è€QIUœ°€M•…É -•åÝ½É‘Ìœè€å…µ…¡„•¼•…Èœô°(€€€ì€…Ñ…±½œ%œè€5QHµe4µdÄØœ°	É…¹è€e…µ…¡„œ°5½‘•°è€dÄÙiHœ°Ñ¥Ù”è€QIUœ°€M•…É -•åÝ½É‘Ìœè€å…µ…¡„äÄØäÄÙéÈœô(€tì(€…ÍÍ•ÉÐ¹•ÅÕ…°¡µ…Ñ¡%¹ÍÑ…¹ÑAÉ½‘ÕÐ ¹…¬Ñ…¹å„µ½Ñ½Èå…µ…¡„œ°…Ñ…±½œ¤¹ÁÉ½‘ÕÐ°¹Õ±°¤ì(€…ÍÍ•ÉÐ¹•ÅÕ…°¡µ…Ñ¡%¹ÍÑ…¹ÑAÉ½‘ÕÐ ¹…¬Ñ…¹å„µ½Ñ½Èå…µ…¡„œ°…Ñ…±½œ¤¹…µ‰¥Õ½ÕÌ°™…±Í”¤ì)ô¤ì()Ñ•ÍÐ Í¡½ÉÐ±…É¥™¥…Ñ¥½¸…¹ÍÝ•ÉÌ…É”½µ‰¥¹•Ý¥Ñ Ñ¡”ÁÉ•Ù¥½ÕÌÕÍÑ½µ•Èµ½‘•°Ý½É‘Ìœ°€ ¤€ôøì(€½¹ÍÐ…Ñ…±½œ€ôl(€€€ì€…Ñ…±½œ%œè€5QHµe4µ=œ°	É…¹è€e…µ…¡„œ°5½‘•°è€¼Ù…¹Ñ¥èœ°Ñ¥Ù”è€QIUœ°€M•…É -•åÝ½É‘Ìœè€å…µ…¡„•¼…Ù…¹Ñ¥èœô°(€€€ì€…Ñ…±½œ%œè€5QHµe4µ=œ°	É…¹è€e…µ…¡„œ°5½‘•°è€¼•…Èœ°Ñ¥Ù”è€QIUœ°€M•…É -•åÝ½É‘Ìœè€å…µ…¡„•¼•…Èœô°(€€€ì€…Ñ…±½œ%œè€5QHµe4µ= œ°	É…¹è€e…µ…¡„œ°5½‘•°è€¼•…È!å‰É¥œ°Ñ¥Ù”è€QIUœ°€M•…É -•åÝ½É‘Ìœè€å…µ…¡„•¼•…È¡å‰É¥œô(€tì(€½¹ÍÐ‘•¥Í¥½¸€ô‰Õ¥±‘%¹ÍÑ…¹ÑM…±•Í•¥Í¥½¸¡ì(€€€ÍÑ…Ñ”èì€ÕÉÉ•¹ÐMÑ•Àœè€MQA|ÀÍ}AI=UPœ°€AÉ½‘ÕÐ…Ñ•½Éäœè€5=Q=Hœ°€1…ÍÐÕÍÑ½µ•È5•ÍÍ…”œè€•¼œô°(€€€±•…èì€ÕÍÑ½µ•È9…µ”œè€-…µ¥Ìœ°I•¥½¸è€MQ}51eM%œ°€¥Ñä½ÈÉ•„œè€	¥¹ÑÕ±Ôœô°(€€€Ñ•áÐè€•…Èœ°µ•ÍÍ…•QåÁ”è€Ñ•áÐœ°É½ÕÑ•	ÕÍ¥¹•ÍÍU¹¥Ðè€5=Q=Hœ°É½ÕÑ•I•¥½¸è€MQ}51eM%œ°(€€€µ½Ñ½É…Ñ…±½œè…Ñ…±½œ°(€€€µ½Ñ½ÉAÉ¥¥¹œèmì€…Ñ…±½œ%œè€5QHµe4µ=œ°€AÉ¥”i½¹”œè€MQ}51eM%œ°Ñ¥Ù”è€QIUœ°€EÕ½Ñ”ÁÁÉ½Ù…°MÑ…ÑÕÌœè€AAI=Yœ°€5½¹Ñ¡±ä€Ôe•…ÉÌ€¡I4¤œè€œÈÔÀœõt(€ô¤ì(€…ÍÍ•ÉÐ¹•ÅÕ…°¡‘•¥Í¥½¸¹ÁÉ½‘ÕÐ¹5½‘•°°€¼•…Èœ¤ì(€…ÍÍ•ÉÐ¹•ÅÕ…°¡‘•¥Í¥½¸¹¹•áÑMÑ•À°€MQA|ÀÑ}=U59QLœ¤ì(€…ÍÍ•ÉÐ¹µ…Ñ ¡‘•¥Í¥½¸¹Ñ•áÐ°€½¼•…È¼¤ì(€…ÍÍ•ÉÐ¹‘½•Í9½Ñ5…Ñ ¡‘•¥Í¥½¸¹Ñ•áÐ°€½•…È!å‰É¥‘ñA¥±¥ Í…ÑÔ½¤¤ì)ô¤ì()Ñ•ÍÐ „Ñ•¹ÕÉ”™½±±½ÜµÕÀ…¹ÍÝ•ÉÌ½¹±äÑ¡”É•ÅÕ•ÍÑ•µ½¹Ñ¡±äÉ…Ñ”Ý¥Ñ¡½ÕÐÉ•Í•¹‘¥¹œÑ¡”ÁÉ½‘ÕÐ¥µ…”œ°€ ¤€ôøì(€½¹ÍÐ‘•¥Í¥½¸€ô‰Õ¥±‘%¹ÍÑ…¹ÑM…±•Í•¥Í¥½¸¡ì(€€€ÍÑ…Ñ”èì€ÕÉÉ•¹ÐMÑ•Àœè€MQA|ÀÑ}=U59QLœ°€AÉ½‘ÕÐ…Ñ•½Éäœè€5=Q=Hœ°€M•±•Ñ•AÉ½‘ÕÐ	É…¹œè€e…µ…¡„œ°€M•±•Ñ•AÉ½‘ÕÐ5½‘•°œè€¼•…Èœ°€1…ÍÐÕÍÑ½µ•È5•ÍÍ…”œè€•¼•…Èœô°(€€€±•…èì€ÕÍÑ½µ•È9…µ”œè€-…µ¥Ìœ°I•¥½¸è€MQ}51eM%œ°€¥Ñä½ÈÉ•„œè€	¥¹ÑÕ±Ôœô°(€€€Ñ•áÐè€‰•É…Á„‰Õ±…¹…¸­…±…Ô€ÌÑ…¡Õ¸œ°µ•ÍÍ…•QåÁ”è€Ñ•áÐœ°É½ÕÑ•	ÕÍ¥¹•ÍÍU¹¥Ðè€5=Q=Hœ°É½ÕÑ•I•¥½¸è€MQ}51eM%œ°(€€€µ½Ñ½É…Ñ…±½œèmì€…Ñ…±½œ%œè€5QHµe4µ=œ°	É…¹è€e…µ…¡„œ°5½‘•°è€¼•…Èœ°Ñ¥Ù”è€QIUœ°€%µ…”ÁÁÉ½Ù•œè€QIUœ°€%µ…”UI0œè€¡ÑÑÁÌè¼½‘¸¹•á…µÁ±”¹Ñ•ÍÐ½•¼µ•…È¹©Áœœõt°(€€€µ½Ñ½ÉAÉ¥¥¹œèmì€…Ñ…±½œ%œè€5QHµe4µ=œ°€AÉ¥”i½¹”œè€MQ}51eM%œ°Ñ¥Ù”è€QIUœ°€EÕ½Ñ”ÁÁÉ½Ù…°MÑ…ÑÕÌœè€AAI=Yœ°€5½¹Ñ¡±ä€Ìe•…ÉÌ€¡I4¤œè€œÌÄÀœ°€5½¹Ñ¡±ä€Ôe•…ÉÌ€¡I4¤œè€œÈÈÔœõt(€ô¤ì(€…ÍÍ•ÉÐ¹•ÅÕ…°¡‘•¥Í¥½¸¹¹•áÑMÑ•À°€MQA|ÀÑ}=U59QLœ¤ì(€…ÍÍ•ÉÐ¹•ÅÕ…°¡‘•¥Í¥½¸¹¥µ…•UÉ°°Õ¹‘•™¥¹•¤ì(€…ÍÍ•ÉÐ¹µ…Ñ ¡‘•¥Í¥½¸¹Ñ•áÐ°€¼ÌÑ…¡Õ¸¼¤ì(€…ÍÍ•ÉÐ¹µ…Ñ ¡‘•¥Í¥½¸¹Ñ•áÐ°€½I4ÌÄÀ¼¤ì(€…ÍÍ•ÉÐ¹‘½•Í9½Ñ5…Ñ ¡‘•¥Í¥½¸¹Ñ•áÐ°€½I4ÈÈÕñ%‘•Á…¹ñÍ±¥À…©¤½¤¤ì)ô¤ì()Ñ•ÍÐ Á¡½¹”Í¡½ÉÑ¡…¹É½ÕÁÌ½±½ÕÈÉ½ÝÌ…¹¥‘•¹Ñ¥™¥•ÌÑ¡”É•ÅÕ•ÍÑ•µ½‘•°™…µ¥±äœ°€ ¤€ôøì(€½¹ÍÐ…Ñ…±½œ€ôl(€€€ì€…Ñ…±½œ%œè€!@´ÄÝA4´ÈÔØµ	1,œ°	É…¹è€ÁÁ±”œ°5½‘•°è€¥A¡½¹”€ÄÜAÉ¼5…àœ°Y…É¥…¹Ðè€œÈÔÙ	±…¬œ°Ñ¥Ù”è€QIUœ°€M•…É -•åÝ½É‘Ìœè€…ÁÁ±”¥Á¡½¹”€ÄÜÁÉ¼µ…à€ÈÔÙˆ‰±…¬½™™¥¥…°œô°(€€€ì€…Ñ…±½œ%œè€!@´ÄÝA4´ÔÄÈµ	1Tœ°	É…¹è€ÁÁ±”œ°5½‘•°è€¥A¡½¹”€ÄÜAÉ¼5…àœ°Y…É¥…¹Ðè€œÔÄÉ	±Õ”œ°Ñ¥Ù”è€QIUœ°€M•…É -•åÝ½É‘Ìœè€…ÁÁ±”¥Á¡½¹”€ÄÜÁÉ¼µ…à€ÔÄÉˆ‰±Õ”½™™¥¥…°œô°(€€€ì€…Ñ…±½œ%œè€!@´ÄÝ@´ÈÔØµ	1,œ°	É…¹è€ÁÁ±”œ°5½‘•°è€¥A¡½¹”€ÄÜAÉ¼œ°Y…É¥…¹Ðè€œÈÔÙ	±…¬œ°Ñ¥Ù”è€QIUœ°€M•…É -•åÝ½É‘Ìœè€…ÁÁ±”¥Á¡½¹”€ÄÜÁÉ¼€ÈÔÙˆ‰±…¬½™™¥¥…°œô(€tì(€½¹ÍÐµ…Ñ €ôµ…Ñ¡%¹ÍÑ…¹ÑAÉ½‘ÕÐ œÄÝÁ´œ°…Ñ…±½œ¤ì(€…ÍÍ•ÉÐ¹•ÅÕ…°¡µ…Ñ ¹…µ‰¥Õ½ÕÌ°™…±Í”¤ì(€…ÍÍ•ÉÐ¹•ÅÕ…°¡µ…Ñ ¹ÁÉ½‘ÕÐ¹5½‘•°°€¥A¡½¹”€ÄÜAÉ¼5…àœ¤ì(€…ÍÍ•ÉÐ¹•ÅÕ…°¡µ…Ñ¡%¹ÍÑ…¹ÑAÉ½‘ÕÐ ¹…¬¥ÀÄÝÁ´œ°…Ñ…±½œ¤¹ÁÉ½‘ÕÐ¹5½‘•°°€¥A¡½¹”€ÄÜAÉ¼5…àœ¤ì(€…ÍÍ•ÉÐ¹•ÅÕ…°¡µ…Ñ¡%¹ÍÑ…¹ÑAÉ½‘ÕÐ ¥Á¡½¹”€ÄÜÁÉ½µà…‘„üœ°…Ñ…±½œ¤¹ÁÉ½‘ÕÐ¹5½‘•°°€¥A¡½¹”€ÄÜAÉ¼5…àœ¤ì)ô¤ì()Ñ•ÍÐ Á¡½¹”Í¡½ÉÑ¡…¹…¸½Ù•ÉÉ¥‘”„ÍÑ…±”µ½Ñ½È…Ñ•½ÉäÝ¥Ñ¡½ÕÐ…Í­¥¹œÑ¡”ÕÍÑ½µ•ÈÑ¼É•ÍÑ…ÉÐœ°€ ¤€ôøì(€½¹ÍÐ‘•¥Í¥½¸€ô‰Õ¥±‘%¹ÍÑ…¹ÑM…±•Í•¥Í¥½¸¡ì(€€€ÍÑ…Ñ”èì€ÕÉÉ•¹ÐMÑ•Àœè€MQA|ÀÍ}AI=UPœ°€ÕÍÑ½µ•È9…µ”œè€µ¥¸œ°€AÉ½‘ÕÐ…Ñ•½Éäœè€5=Q=Hœô°(€€€±•…èì€ÕÍÑ½µ•È9…µ”œè€µ¥¸œ°I•¥½¸è€MQ}51eM%œô°Ñ•áÐè€¹…¬€ÄÝÁ´œ°µ•ÍÍ…•QåÁ”è€Ñ•áÐœ°É½ÕÑ•	ÕÍ¥¹•ÍÍU¹¥Ðè€5=Q=Hœ°(€€€¡…¹‘Á¡½¹•…Ñ…±½œèmì€…Ñ…±½œ%œè€!@´ÄÝA4œ°	É…¹è€ÁÁ±”œ°5½‘•°è€¥A¡½¹”€ÄÜAÉ¼5…àœ°Ñ¥Ù”è€QIUœ°€M•…É -•åÝ½É‘Ìœè€¥Á¡½¹”€ÄÜÁÉ¼µ…àœõt°(€€€¡…¹‘Á¡½¹•AÉ¥¥¹œèmì€…Ñ…±½œ%œè€!@´ÄÝA4œ°€AÉ¥”i½¹”œè€MQ}51eM%œ°Ñ¥Ù”è€QIUœ°€EÕ½Ñ”ÁÁÉ½Ù…°MÑ…ÑÕÌœè€AAI=Yœ°€5½¹Ñ¡±ä€ØÀ5½¹Ñ¡Ì€¡I4¤œè€œÄääœõt(€ô¤ì(€…ÍÍ•ÉÐ¹•ÅÕ…°¡‘•¥Í¥½¸¹ÁÉ½‘ÕÑU¹¥Ð°€!9A!=9œ¤ì(€…ÍÍ•ÉÐ¹µ…Ñ ¡‘•¥Í¥½¸¹Ñ•áÐ°€½I4Äää¼¤ì)ô¤ì()Ñ•ÍÐ ¡…¹‘Á¡½¹”ÅÕ½Ñ•ÌÉ•µ…¥¸µ½¹Ñ¡±äµ½¹±ä•Ù•¸Ý¡•¸Í½ÕÉ”É½ÝÌ½¹Ñ…¥¸‘•Á½Í¥Ð…¹Í•±±¥¹œÁÉ¥”œ°€ ¤€ôøì(€½¹ÍÐ‰…Í”€ôì(€€€ÍÑ…Ñ”èì€ÕÉÉ•¹ÐMÑ•Àœè€MQA|ÀÍ}AI=UPœ°€ÕÍÑ½µ•È9…µ”œè€µ¥¸œ°€AÉ½‘ÕÐ…Ñ•½Éäœè€!9A!=9œô°(€€€±•…èì€ÕÍÑ½µ•È9…µ”œè€µ¥¸œ°I•¥½¸è€MQ}51eM%œ°€¥Ñä½ÈÉ•„œè€	¥¹ÑÕ±Ôœô°µ•ÍÍ…•QåÁ”è€Ñ•áÐœ°É½ÕÑ•	ÕÍ¥¹•ÍÍU¹¥Ðè€!9A!=9œ°É½ÕÑ•I•¥½¸è€MQ}51eM%œ°(€€€¡…¹‘Á¡½¹•…Ñ…±½œèmì€…Ñ…±½œ%œè€!@´ÄÝA4œ°	É…¹è€ÁÁ±”œ°5½‘•°è€¥A¡½¹”€ÄÜAÉ¼5…àœ°Ñ¥Ù”è€QIUœ°€M•…É -•åÝ½É‘Ìœè€¥Á¡½¹”€ÄÜÁÉ¼µ…àœõt°(€€€¡…¹‘Á¡½¹•AÉ¥¥¹œèmì€…Ñ…±½œ%œè€!@´ÄÝA4œ°€AÉ¥”i½¹”œè€MQ}51eM%œ°Ñ¥Ù”è€QIUœ°€EÕ½Ñ”ÁÁÉ½Ù…°MÑ…ÑÕÌœè€AAI=Yœ°€5½¹Ñ¡±ä€ØÀ5½¹Ñ¡Ì€¡I4¤œè€œÄääœ°€•Á½Í¥Ð€¡I4¤œè€œàààœ°€M•±±¥¹œAÉ¥”€¡I4¤œè€œÔäääœõt(€ôì(€½¹ÍÐÅÕ½Ñ”€ô‰Õ¥±‘%¹ÍÑ…¹ÑM…±•Í•¥Í¥½¸¡ì€¸¸¹‰…Í”°Ñ•áÐè€¹…¬¥Á¡½¹”€ÄÜÁÉ¼µ…àœô¤ì(€…ÍÍ•ÉÐ¹µ…Ñ ¡ÅÕ½Ñ”¹Ñ•áÐ°€½I4Äää¼¤ì(€…ÍÍ•ÉÐ¹‘½•Í9½Ñ5…Ñ ¡ÅÕ½Ñ”¹Ñ•áÐ°€½‘•Á½Í¥ÑñI4ààáðÔääåñ¡…É„©Õ…±…¹ñÍ•±±¥¹œÁÉ¥”½¤¤ì((€½¹ÍÐ‘•Á½Í¥ÑEÕ•ÍÑ¥½¸€ô‰Õ¥±‘%¹ÍÑ…¹ÑM…±•Í•¥Í¥½¸¡ì(€€€€¸¸¹‰…Í”°(€€€ÍÑ…Ñ”èì€¸¸¹‰…Í”¹ÍÑ…Ñ”°€M•±•Ñ•AÉ½‘ÕÐ	É…¹œè€ÁÁ±”œ°€M•±•Ñ•AÉ½‘ÕÐ5½‘•°œè€¥A¡½¹”€ÄÜAÉ¼5…àœô°(€€€Ñ•áÐè€‘•Á½Í¥Ð‰•É…Á„üœ(€ô¤ì(€…ÍÍ•ÉÐ¹µ…Ñ ¡‘•Á½Í¥ÑEÕ•ÍÑ¥½¸¹Ñ•áÐ°€½¡…¹å„¸©…¹ÍÕÉ…¸‰Õ±…¹…¸½¤¤ì(€…ÍÍ•ÉÐ¹‘½•Í9½Ñ5…Ñ ¡‘•Á½Í¥ÑEÕ•ÍÑ¥½¸¹Ñ•áÐ°€½I4ààáðÔäää½¤¤ì)ô¤ì()Ñ•ÍÐ Á½ÍÐµÅÕ½Ñ”Í…±•ÌÅÕ•ÍÑ¥½¹ÌÉ••¥Ù”…¸¥µµ•‘¥…Ñ”¹…ÑÕÉ…°5…±…ä…¹ÍÝ•È¥¹ÍÑ•…½˜Í¥±•¹”œ°€ ¤€ôøì(€½¹ÍÐ‰…Í”€ôì(€€€ÍÑ…Ñ”èì€ÕÉÉ•¹ÐMÑ•Àœè€MQA|ÀÑ}=U59QLœ°€ÕÍÑ½µ•È9…µ”œè€µ¥¸œ°€AÉ½‘ÕÐ…Ñ•½Éäœè€5=Q=Hœô°(€€€±•…èì€ÕÍÑ½µ•È9…µ”œè€µ¥¸œ°I•¥½¸è€MQ}51eM%œ°€¥Ñä½ÈÉ•„œè€	¥¹ÑÕ±Ôœô°(€€€µ•ÍÍ…•QåÁ”è€Ñ•áÐœ°É½ÕÑ•	ÕÍ¥¹•ÍÍU¹¥Ðè€5=Q=Hœ°É½ÕÑ•I•¥½¸è€MQ}51eM%œ(€ôì(€½¹ÍÐ‘½Õµ•¹ÑÌ€ô‰Õ¥±‘%¹ÍÑ…¹ÑM…±•Í•¥Í¥½¸¡ì€¸¸¹‰…Í”°Ñ•áÐè€‘½­Õµ•¸…Á„Á•É±ÔÕ¹ÑÕ¬…ÁÁ±äüœô¤ì(€½¹ÍÐ‰Õ‘•Ð€ô‰Õ¥±‘%¹ÍÑ…¹ÑM…±•Í•¥Í¥½¸¡ì€¸¸¹‰…Í”°Ñ•áÐè€µ…¡…°±… °…‘„µÕÉ… Í¥­¥Ðüœô¤ì(€½¹ÍÐÕ¹­¹½Ý¸€ô‰Õ¥±‘%¹ÍÑ…¹ÑM…±•Í•¥Í¥½¸¡ì€¸¸¹‰…Í”°Ñ•áÐè€‰½±• •áÁ±…¥¸±…¤üœô¤ì(€…ÍÍ•ÉÐ¹µ…Ñ ¡‘½Õµ•¹ÑÌ¹Ñ•áÐ°€½%‘•Á…¸‘…¸‰•±…­…¹œ¼¤ì(€…ÍÍ•ÉÐ¹µ…Ñ ¡‰Õ‘•Ð¹Ñ•áÐ°€½	…©•Ð‰Õ±…¹…¸¼¤ì(€…ÍÍ•ÉÐ¹µ…Ñ ¡Õ¹­¹½Ý¸¹Ñ•áÐ°€½µ½‘•°°…¹ÍÕÉ…¸‰Õ±…¹…¸°‘½­Õµ•¸¼¤ì(€…ÍÍ•ÉÐ¹•ÅÕ…°¡Õ¹­¹½Ý¸¹…¥…±±‰…¬°ÑÉÕ”¤ì(€m‘½Õµ•¹ÑÌ°‰Õ‘•Ð°Õ¹­¹½Ý¹t¹™½É… ¡É•ÍÕ±Ð€ôø…ÍÍ•ÉÐ¹•ÅÕ…°¡É•ÍÕ±Ð¹¡…¹‘±•°ÑÉÕ”¤¤ì)ô¤ì()Ñ•ÍÐ ­¹½Ý±•‘”$™…±±‰…¬É•ÅÕ•ÍÐ¥ÌÁÉ¥Ù…äµÁÉ•Í•ÉÙ¥¹œ°™…ÍÐ…¹…¹¹½Ð•áÁ½Í”…¸Õ¹ÍÕÁÁ½ÉÑ•…µ½Õ¹Ðœ°…Íå¹Œ€ ¤€ôøì(€½¹ÍÐÉ•ÅÕ•ÍÐ€ô‰Õ¥±‘¥…±±‰…­I•ÅÕ•ÍÐ¡ì(€€€Ñ•áÐè€‰½±• •áÁ±…¥¸±…¤üœ°(€€€ÍÑ…Ñ”èì€ÕÉÉ•¹ÐMÑ•Àœè€MQA|ÀÑ}=U59QLœ°€ÕÍÑ½µ•È9…µ”œè€µ¥¸œ°€M•±•Ñ•AÉ½‘ÕÐ5½‘•°œè€dÄÙiHœô°(€€€±•…èìI•¥½¸è€MQ}51eM%œ°€¥Ñä½ÈÉ•„œè€	¥¹ÑÕ±Ôœô°(€€€É½ÕÑ•	ÕÍ¥¹•ÍÍU¹¥Ðè€5=Q=Hœ°(€€€Á¡½¹”è€œØÀÄÈÌÐÔØÜàäœ(€ô¤ì(€…ÍÍ•ÉÐ¹•ÅÕ…°¡É•ÅÕ•ÍÐ¹µ½‘•°°€ÁÐ´Ð¸Äµµ¥¹¤œ¤ì(€…ÍÍ•ÉÐ¹•ÅÕ…°¡É•ÅÕ•ÍÐ¹É•…Í½¹¥¹œ°Õ¹‘•™¥¹•¤ì(€…ÍÍ•ÉÐ¹•ÅÕ…°¡É•ÅÕ•ÍÐ¹ÍÑ½É”°™…±Í”¤ì(€…ÍÍ•ÉÐ¹•ÅÕ…°¡É•ÅÕ•ÍÐ¹Í…™•Ñå}¥‘•¹Ñ¥™¥•È¹±•¹Ñ °€ØÐ¤ì(€…ÍÍ•ÉÐ¹•ÅÕ…°¡É•ÅÕ•ÍÐ¹¥¹ÁÕÐ¹¥¹±Õ‘•Ì œØÀÄÈÌÐÔØÜàäœ¤°™…±Í”¤ì(€…ÍÍ•ÉÐ¹•ÅÕ…°¡É•ÅÕ•ÍÐ¹µ…á}½ÕÑÁÕÑ}Ñ½­•¹Ì°€ÄàÀ¤ì((€½¹ÍÐ™•Ñ¡%µÁ°€ô…Íå¹Œ€¡}ÕÉ°°½ÁÑ¥½¹Ì¤€ôøì(€€€½¹ÍÐ‰½‘ä€ô)M=8¹Á…ÉÍ”¡½ÁÑ¥½¹Ì¹‰½‘ä¤ì(€€€…ÍÍ•ÉÐ¹•ÅÕ…°¡‰½‘ä¹µ½‘•°°€ÁÐ´Ð¸Äµµ¥¹¤œ¤ì(€€€…ÍÍ•ÉÐ¹•ÅÕ…°¡‰½‘ä¹É•…Í½¹¥¹œ°Õ¹‘•™¥¹•¤ì(€€€…ÍÍ•ÉÐ¹•ÅÕ…°¡‰½‘ä¹ÍÑ½É”°™…±Í”¤ì(€€€É•ÑÕÉ¸ì½¬èÑÉÕ”°©Í½¸è…Íå¹Œ€ ¤€ôø€¡ì½ÕÑÁÕÐèmì½¹Ñ•¹ÐèmìÑ•áÐè€	½±• °‰…¡…¥…¸µ…¹„å…¹œ…¹‘„µ…¡ÔÍ…å„Ñ•É…¹­…¸‘•¹…¸±•‰¥ ©•±…ÌüƒÂ~b(M½…±…¸­•‘Õ„üœõtõtô¤ôì(€ôì(€½¹ÍÐÉ•Á±ä€ô…Ý…¥ÐÉ•ÅÕ•ÍÑ¥…±±‰…­I•Á±ä¡ì(€€€Ñ•áÐè€‰½±• •áÁ±…¥¸±…¤üœ°(€€€ÍÑ…Ñ”èì€ÕÉÉ•¹ÐMÑ•Àœè€MQA|ÀÑ}=U59QLœô°(€€€Á¡½¹”è€œØÀÄÈÌÐÔØÜàäœ°(€€€•¹Øèì=A9%}A%}-dè€Í¬µÑ•ÍÐœ°=A9%}5=0è€ÁÐ´Ð¸Äµµ¥¹¤œô°(€€€™•Ñ¡%µÁ°(€ô¤ì(€…ÍÍ•ÉÐ¹•ÅÕ…°¡É•Á±ä¹¥¹±Õ‘•Ì ŸÂ~b(œ¤°™…±Í”¤ì(€…ÍÍ•ÉÐ¹•ÅÕ…° ¡É•Á±ä¹µ…Ñ  ½pü½œ¤ñðmt¤¹±•¹Ñ °€Ä¤ì(€…ÍÍ•ÉÐ¹•ÅÕ…°¡Í…¹¥Ñ¥é•¥…±±‰…­I•Á±ä !…É„¥…±… I4äää¸	•É…Á„‰…©•Ð…¹‘„üœ°€5Lœ¤°€œœ¤ì(€…ÍÍ•ÉÐ¹•ÅÕ…°¡Í…¹¥Ñ¥é•¥…±±‰…­I•Á±ä M…å„…‘…±… $å…¹œµ•µ‰…¹ÑÔ…¹‘„¸œ°€5Lœ¤°€œœ¤ì)ô¤ì()Ñ•ÍÐ ½Ñ¡•Èµµ½‘•°É•ÅÕ•ÍÐÍÕ•ÍÑÌ„Íµ…±°…ÁÁÉ½Ù•É•¥½¹…°±¥ÍÐ…¹…Í­Ì½¹”ÅÕ•ÍÑ¥½¸œ°€ ¤€ôøì(€½¹ÍÐ‘•¥Í¥½¸€ô‰Õ¥±‘%¹ÍÑ…¹ÑM…±•Í•¥Í¥½¸¡ì(€€€ÍÑ…Ñ”èì€ÕÉÉ•¹ÐMÑ•Àœè€MQA|ÀÑ}=U59QLœ°€ÕÍÑ½µ•È9…µ”œè€µ¥¸œ°€AÉ½‘ÕÐ…Ñ•½Éäœè€5=Q=Hœô°(€€€±•…èì€ÕÍÑ½µ•È9…µ”œè€µ¥¸œ°I•¥½¸è€MQ}51eM%œ°€¥Ñä½ÈÉ•„œè€	¥¹ÑÕ±Ôœô°(€€€Ñ•áÐè€…‘„µ½Ñ½È…Á„µ½‘•°±…¥¸üœ°µ•ÍÍ…•QåÁ”è€Ñ•áÐœ°É½ÕÑ•	ÕÍ¥¹•ÍÍU¹¥Ðè€5=Q=Hœ°É½ÕÑ•I•¥½¸è€MQ}51eM%œ°(€€€µ½Ñ½É…Ñ…±½œèl(€€€€€ì€…Ñ…±½œ%œè€4Äœ°	É…¹è€e…µ…¡„œ°5½‘•°è€95`œ°Ñ¥Ù”è€QIUœô°(€€€€€ì€…Ñ…±½œ%œè€4Èœ°	É…¹è€e…µ…¡„œ°5½‘•°è€dÄÙiHœ°Ñ¥Ù”è€QIUœô°(€€€€€ì€…Ñ…±½œ%œè€4Ìœ°	É…¹è€!½¹‘„œ°5½‘•°è€ILÄÔÁHœ°Ñ¥Ù”è€QIUœô(€€€t°(€€€µ½Ñ½ÉAÉ¥¥¹œèl(€€€€€ì€…Ñ…±½œ%œè€4Äœ°€AÉ¥”i½¹”œè€MQ}51eM%œ°Ñ¥Ù”è€QIUœ°€EÕ½Ñ”ÁÁÉ½Ù…°MÑ…ÑÕÌœè€AAI=Yœ°€5½¹Ñ¡±ä€Ôe•…ÉÌ€¡I4¤œè€œÌØÔœô°(€€€€€ì€…Ñ…±½œ%œè€4Èœ°€AÉ¥”i½¹”œè€MQ}51eM%œ°Ñ¥Ù”è€QIUœ°€EÕ½Ñ”ÁÁÉ½Ù…°MÑ…ÑÕÌœè€AAI=Yœ°€5½¹Ñ¡±ä€Ôe•…ÉÌ€¡I4¤œè€œÌÈÜœô°(€€€€€ì€…Ñ…±½œ%œè€4Ìœ°€AÉ¥”i½¹”œè€MQ}51eM%œ°Ñ¥Ù”è€QIUœ°€EÕ½Ñ”ÁÁÉ½Ù…°MÑ…ÑÕÌœè€AAI=Yœ°€5½¹Ñ¡±ä€Ôe•…ÉÌ€¡I4¤œè€œÈääœô(€€€t(€ô¤ì(€…ÍÍ•ÉÐ¹•ÅÕ…°¡‘•¥Í¥½¸¹¡…¹‘±•°ÑÉÕ”¤ì(€…ÍÍ•ÉÐ¹µ…Ñ ¡‘•¥Í¥½¸¹Ñ•áÐ°€½e…µ…¡„95`¼¤ì(€…ÍÍ•ÉÐ¹•ÅÕ…° ¡‘•¥Í¥½¸¹Ñ•áÐ¹µ…Ñ  ½pü½œ¤ñðmt¤¹±•¹Ñ °€Ä¤ì)ô¤ì(