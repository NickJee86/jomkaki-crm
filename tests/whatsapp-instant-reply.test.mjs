import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  applicationDetailSideQuestion,
  buildAiFallbackRequest,
  buildAiIntentRequest,
  buildApplicationDetailsForm,
  buildApplicationDetailsTurn,
  buildAutomaticApplication,
  buildDocumentProgressReply,
  buildEarlyConsentReply,
  buildImmediateAcknowledgement,
  buildInitialConversationState,
  buildInstantSalesDecision,
  buildMediaProxyUrl,
  buildProgressiveProfileChanges,
  CREDIT_CONSENT_TEMPLATE_URL,
  customerAskedQuestion,
  extractCustomerName,
  guardConversationProgress,
  hasRecentDocumentAcknowledgement,
  inferDocumentTypeFromFileName,
  instantChannelCredentials,
  isApplicationDetailStep,
  isApplicationDetailsFormResponse,
  isDocumentStatusQuestion,
  isExpiredInboundMessage,
  isStaleInboundMessage,
  matchInstantProduct,
  parseApplicationDetailsForm,
  releaseEarlyConsentDispatch,
  releaseInboundMessage,
  requestAiFallbackReply,
  requestAiIntent,
  reserveEarlyConsentDispatch,
  reserveInboundMessage,
  resolveCustomerLocation,
  sanitizeAiFallbackReply,
  shouldDispatchEarlyConsent,
  shouldSendImmediateAcknowledgement,
  shouldStartApplicationDetails
} from '../api/whatsapp-webhook.js';
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
  assert.equal(JOMKAKI_KNOWLEDGE.conversation.aiFallback.model, 'gpt-5.6-terra');
  assert.equal(JOMKAKI_KNOWLEDGE.conversation.aiFallback.reasoningEffort, 'none');
  assert.equal(JOMKAKI_KNOWLEDGE.conversation.aiFallback.noSilenceFallback, true);
  assert.equal(JOMKAKI_KNOWLEDGE.pricing.exposeCashPrice, false);
  assert.equal(JOMKAKI_KNOWLEDGE.pricing.exposeMotorCashPrice, true);
  assert.equal(JOMKAKI_KNOWLEDGE.pricing.exposeHandphoneCashPrice, false);
  assert.equal(JOMKAKI_KNOWLEDGE.pricing.exposeMotorDeposit, true);
  assert.equal(JOMKAKI_KNOWLEDGE.pricing.exposeHandphoneDeposit, false);
  assert.deepEqual(JOMKAKI_KNOWLEDGE.loanKedai.normalProcessingWorkingDays, [1, 3]);
  assert.equal(JOMKAKI_KNOWLEDGE.loanKedai.primarySalesPath, true);
  assert.equal(JOMKAKI_KNOWLEDGE.loanKedai.proactivelyPromoteCashPurchase, false);
  assert.equal(JOMKAKI_KNOWLEDGE.documents.consentRequiredBeforeLms, true);
  assert.equal(JOMKAKI_KNOWLEDGE.documents.consentDispatchOnFirstApplicationDocument, true);
  assert.equal(JOMKAKI_KNOWLEDGE.documents.consentCanProceedWithMissingDocuments, true);
  assert.equal(JOMKAKI_KNOWLEDGE.documents.applicationDetailsStartAfterConsentSigned, true);
  assert.equal(JOMKAKI_KNOWLEDGE.documents.applicationDetailsCollectionMode, 'SINGLE_WHATSAPP_FORM');
  assert.equal(JOMKAKI_KNOWLEDGE.documents.applicationDetailsOneQuestionAtATime, false);
  assert.equal(JOMKAKI_KNOWLEDGE.documents.inferBankAccountFromBankStatement, true);
  assert.equal(JOMKAKI_KNOWLEDGE.documents.documentsAndConsentCollectedInParallel, true);
  assert.deepEqual(approvedMonthlyRateFields('HANDPHONE').map(([, field]) => field), [
    'Monthly 60 Months (RM)', 'Monthly 48 Months (RM)', 'Monthly 36 Months (RM)', 'Monthly 24 Months (RM)', 'Monthly 12 Months (RM)'
  ]);
});

test('the first application document immediately sends the consent PDF without waiting for all documents', () => {
  const application = { 'Application ID': 'APP-CONSENT-FIRST', 'Credit Consent Status': 'NOT_SENT', 'Minimum Documents Complete': 'FALSE' };
  assert.equal(shouldDispatchEarlyConsent({ messageType: 'document', application }), true);
  assert.equal(shouldDispatchEarlyConsent({ messageType: 'image', application }), true);
  assert.equal(shouldDispatchEarlyConsent({ messageType: 'text', application }), false);
  assert.equal(shouldDispatchEarlyConsent({ messageType: 'document', application: { ...application, 'Credit Consent Status': 'SENT' } }), false);
  assert.equal(shouldDispatchEarlyConsent({ messageType: 'document', application, human: true }), false);
  assert.equal(reserveEarlyConsentDispatch(application['Application ID'], 1000), true);
  assert.equal(reserveEarlyConsentDispatch(application['Application ID'], 1001), false);
  releaseEarlyConsentDispatch(application['Application ID']);
  const reply = buildEarlyConsentReply('MS');
  assert.match(reply, /tandatangani Borang Kebenaran CTOS\/CCRIS/);
  assert.match(reply, /Tak perlu tunggu semua dokumen lengkap/);
  assert.match(reply, new RegExp(CREDIT_CONSENT_TEMPLATE_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(source, /type: 'document'/);
  assert.match(source, /WEBHOOK_CONSENT_FIRST/);
  assert.match(source, /Credit Consent Status': 'SENT'/);
});

test('signed consent sends one complete WhatsApp form without asking fields one by one', () => {
  const application = {
    'Application ID': 'APP-DETAILS-1',
    'Credit Consent Status': 'SENT',
    'Minimum Documents Complete': 'FALSE',
    'Customer Name': 'Amin'
  };
  assert.equal(shouldStartApplicationDetails({ messageType: 'document', application, currentStep: 'STEP_04_DOCUMENTS' }), true);
  assert.equal(shouldStartApplicationDetails({ messageType: 'image', application: { ...application, 'Credit Consent Status': 'SIGNED_PENDING_VERIFICATION' } }), true);
  assert.equal(shouldStartApplicationDetails({ messageType: 'text', application }), false);
  assert.equal(shouldStartApplicationDetails({ messageType: 'document', application, human: true }), false);

  const turn = buildApplicationDetailsTurn({ application, businessUnit: 'MOTOR', start: true });
  assert.equal(turn.handled, true);
  assert.equal(turn.nextStep, 'APPLICATION_FORM_PENDING');
  assert.match(turn.text, /Sementara semakan dibuat/);
  assert.match(turn.text, /hantar semula dalam satu mesej/);
  assert.match(turn.text, /BORANG MAKLUMAT PERMOHONAN/);
  assert.match(turn.text, /Nama pemohon/);
  assert.match(turn.text, /IC pemohon/);
  assert.match(turn.text, /Berapa lama sudah berkhidmat/);
  assert.match(turn.text, /C\. RUJUKAN KELUARGA TERDEKAT/);
  assert.match(turn.text, /12\. Rujukan 2/);
  assert.match(turn.text, /Loan berapa tahun/);
  assert.match(turn.text, /Semak semua maklumat sebelum hantar/);
  assert.doesNotMatch(turn.text, /Sila berikan nombor IC penuh anda/);
  assert.ok(turn.missingFields.includes('Applicant IC Number'));
});

test('a completed WhatsApp form is parsed and saved in one turn', () => {
  const reply = `TOLONG ISI MAKLUMAT DI BAWAH :
Nama pemohon:\n➡️ Amin Rahman
IC pemohon:\n➡️ 900101-13-5555
1. Alamat Rumah\n➡️ 12 Jalan Example, Kuching
2. Nombor tel pemohon\n➡️ 0123456789
3. Nama Syarikat/ Tempat Kerja\n➡️ Example Sdn Bhd
4. Alamat tempat kerja\n➡️ Pending Industrial Park, Kuching
5. Nombor tel tempat kerja\n➡️ 082123456
6. Berapa lama sudah berkhidmat\n➡️ 2 tahun
7. Jawatan\n➡️ Penyelia
8. Email\n➡️ amin@example.com
9. Nama & Tel rujukan 1 (mesti ahli keluarga terdekat)\n➡️ Nama : Ali Rahman\n➡️ Hp : 0121112222\n➡️ Hubungan : Abang
10. Nama & Tel rujukan 2 (mesti ahli keluarga terdekat)\n➡️ Nama : Siti Rahman\n➡️ Hp : 0193334444\n➡️ Hubungan : Isteri
11. Motosikal\n➡️ Jenama: Yamaha\n➡️ Model: Y16ZR\n➡️ Loan Berapa tahun: 5`;
  const parsed = parseApplicationDetailsForm(reply, 'MOTOR');
  assert.equal(parsed.isFormResponse, true);
  assert.deepEqual(parsed.invalidFields, []);
  assert.equal(parsed.changes['Applicant Name'], 'Amin Rahman');
  assert.equal(parsed.changes['Applicant IC Number'], '900101135555');
  assert.equal(parsed.changes['Phone Number'], '60123456789');
  assert.equal(parsed.changes['Employment Duration Months'], '24');
  assert.equal(parsed.changes['Reference 2 Relationship'], 'Isteri');
  assert.equal(parsed.changes['Loan Tenure Years'], '5');
  assert.equal(isApplicationDetailsFormResponse(reply), true);

  const turn = buildApplicationDetailsTurn({ currentStep: 'APPLICATION_FORM_PENDING', text: reply, application: {}, businessUnit: 'MOTOR' });
  assert.equal(turn.nextStep, 'APPLICATION_DETAILS_COMPLETE');
  assert.equal(turn.changes['Product Model'], 'Y16ZR');
  assert.deepEqual(turn.missingFields, []);
  assert.match(turn.text, /Semua maklumat permohonan sudah diterima/);
});

test('the polished WhatsApp form can be copied, filled and parsed without losing any section', () => {
  const completed = {
    'Applicant Name': 'Amin Rahman',
    'Applicant IC Number': '900101135555',
    'Home Address': '12 Jalan Example, Kuching',
    'Phone Number': '60123456789',
    'Email': 'amin@example.com',
    'Employer Name': 'Example Sdn Bhd',
    'Employer Address': 'Pending Industrial Park, Kuching',
    'Employer Phone': '082123456',
    'Employment Duration Months': '24',
    'Job Position': 'Penyelia',
    'Reference 1 Name': 'Ali Rahman',
    'Reference 1 Phone': '60121112222',
    'Reference 1 Relationship': 'Abang',
    'Reference 2 Name': 'Siti Rahman',
    'Reference 2 Phone': '60193334444',
    'Reference 2 Relationship': 'Isteri',
    'Product Brand': 'Yamaha',
    'Product Model': 'Y16ZR',
    'Loan Tenure Years': '5'
  };
  const form = buildApplicationDetailsForm(completed, 'MOTOR');
  const parsed = parseApplicationDetailsForm(form, 'MOTOR');
  assert.equal(parsed.isFormResponse, true);
  assert.deepEqual(parsed.invalidFields, []);
  assert.deepEqual(parsed.changes, completed);
  assert.match(form, /\*A\. MAKLUMAT PEMOHON\*/);
  assert.match(form, /\*B\. MAKLUMAT PEKERJAAN\*/);
  assert.match(form, /\*C\. RUJUKAN KELUARGA TERDEKAT\*/);
  assert.match(form, /\*D\. PILIHAN MOTOSIKAL\*/);
});

test('legacy one-question states migrate to the same prefilled form', () => {
  const saved = { 'Applicant IC Number': '900101135555', 'Phone Number': '60123456789', 'Product Brand': 'Yamaha', 'Product Model': 'Y16ZR' };
  const turn = buildApplicationDetailsTurn({ currentStep: 'APP_DETAILS_EMAIL', text: 'amin@example.com', application: saved, businessUnit: 'MOTOR' });
  assert.equal(turn.nextStep, 'APPLICATION_FORM_PENDING');
  assert.deepEqual(turn.changes, {});
  assert.match(turn.text, /Untuk elak banyak soalan berasingan/);
  assert.match(turn.text, /900101135555/);
  assert.match(turn.text, /60123456789/);
  assert.match(turn.text, /Y16ZR/);
  assert.doesNotMatch(turn.text, /Apakah alamat rumah/);
  assert.equal(isApplicationDetailStep(turn.nextStep), true);
});

test('customer questions are answered before the next application information question', () => {
  assert.equal(applicationDetailSideQuestion('berapa lama proses loan kedai?'), true);
  assert.equal(applicationDetailSideQuestion('apa document perlu'), true);
  assert.equal(applicationDetailSideQuestion('900101135555'), false);
  assert.equal(isApplicationDetailsFormResponse(buildApplicationDetailsForm({}, 'MOTOR')), true);
  assert.match(source, /META_WEBHOOK_APPLICATION_DETAILS/);
  assert.match(source, /SIGNED_PENDING_VERIFICATION/);
  assert.match(source, /applicationDetails: true/);
  assert.match(source, /inferredDocumentType === 'BANK_STATEMENT'/);
  assert.match(source, /'Bank Account Available': 'YES'/);
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
  const chinese = buildImmediateAcknowledgement('请问 Y16ZR 月供多少？', 'text');
  const malay = buildImmediateAcknowledgement('Hai, nak tanya ansuran motor', 'text');
  const english = buildImmediateAcknowledgement('How much is the monthly payment?', 'text');
  assert.match(chinese, /已收到/);
  assert.match(malay, /telah menerima/);
  assert.match(english, /received/);
  [chinese, malay, english].forEach(message => {
    assert.doesNotMatch(message, /RM|selling price|cash price|售价|价钱/i);
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
  const persistIndex = source.indexOf("await updateObject(token, 'Conversation_State', 'State ID', conversationState['State ID'], latestInbound, 'CZ')");
  const sendIndex = source.indexOf('instantResult = await sendInstantSalesMessage({ route, phone, decision: instantDecision })');
  assert.ok(persistIndex > 0);
  assert.ok(sendIndex > persistIndex);
  assert.match(source, /'Last AI Message': clean\(instantDecision\.text\)/);
  assert.doesNotMatch(source, /'Last AI Reply'/);
});

test('every customer question bypasses onboarding gates and gets an answer-first route', () => {
  const decision = buildInstantSalesDecision({
    state: { 'Current Step': 'STEP_01_NAME' },
    text: 'hanya ada berapa model ni sahaja?',
    messageType: 'text',
    routeBusinessUnit: 'MOTOR',
    motorCatalog: [
      { 'Catalog ID': 'M1', Brand: 'Yamaha', Model: 'Y15ZR', Active: 'TRUE' },
      { 'Catalog ID': 'M2', Brand: 'Yamaha', Model: 'NMAX', Active: 'TRUE' }
    ],
    motorPricing: [
      { 'Catalog ID': 'M1', Active: 'TRUE', 'Quote Approval Status': 'APPROVED', 'Monthly 5 Years (RM)': '327' },
      { 'Catalog ID': 'M2', Active: 'TRUE', 'Quote Approval Status': 'APPROVED', 'Monthly 5 Years (RM)': '365' }
    ]
  });
  assert.equal(customerAskedQuestion('hanya ada berapa model ni sahaja?'), true);
  assert.equal(decision.availableModelsIntent, true);
  assert.match(decision.text, /bukan semua model/i);
  assert.doesNotMatch(decision.text, /^Model motor atau telefon/i);
});

test('unknown business questions use the answer-first AI route instead of a fixed profile question', () => {
  const decision = buildInstantSalesDecision({
    state: { 'Current Step': 'STEP_01_NAME' },
    text: 'kalau saya ada dua kerja macam mana kira?',
    messageType: 'text',
    routeBusinessUnit: 'MOTOR'
  });
  assert.equal(decision.aiFallback, true);
  assert.equal(decision.answerCustomerQuestionFirst, true);
  assert.doesNotMatch(decision.text, /nama anda/i);
});

test('profile facts provided during any conversation step are progressively mapped into CRM records', () => {
  const profile = buildProgressiveProfileChanges({
    text: 'nama saya Aiman, saya di Bintulu. kerja dengan ABC Trading gaji RM3000 bajet RM400',
    currentStep: 'STEP_03_PRODUCT',
    routeBusinessUnit: 'MOTOR',
    branches: [{ 'Branch ID': 'BR-BTU', 'Team ID': 'TEAM-EAST', Region: 'EAST_MALAYSIA', State: 'Sarawak', City: 'Bintulu', Active: 'TRUE', 'Business Unit': 'MOTOR' }],
    aiIntent: {
      intent: 'BUDGET', businessUnit: 'MOTOR', customerName: 'Aiman', locationQuery: 'Bintulu', monthlyBudgetRm: 400,
      employerName: 'ABC Trading', jobPosition: 'Sales Assistant', employmentDurationMonths: 18, monthlyIncomeRm: 3000,
      salaryPaymentMethod: 'BANK TRANSFER', tenureYears: 5
    }
  });
  assert.equal(profile.leadChanges['Customer Name'], 'Aiman');
  assert.equal(profile.leadChanges['City or Area'], 'Bintulu');
  assert.equal(profile.stateChanges['Requested Amount'], '400');
  assert.equal(profile.stateChanges['Monthly Income'], '3000');
  assert.equal(profile.applicationChanges['Employer Name'], 'ABC Trading');
  assert.equal(profile.applicationChanges['Loan Tenure Years'], '5');
});

test('an older Meta delivery can be recorded but must never receive a reply', () => {
  assert.equal(isStaleInboundMessage('2026-08-15T00:58:51.000Z', '2026-08-15T02:14:16.000Z'), true);
  assert.equal(isStaleInboundMessage('2026-08-15T02:14:16.000Z', '2026-08-15T02:14:16.000Z'), false);
  assert.equal(isStaleInboundMessage('2026-08-15T02:15:00.000Z', '2026-08-15T02:14:16.000Z'), false);
  assert.equal(isExpiredInboundMessage('2026-08-17T01:50:27.000Z', Date.parse('2026-08-17T13:24:07.000Z')), true);
  assert.equal(isExpiredInboundMessage('2026-08-17T13:20:00.000Z', Date.parse('2026-08-17T13:24:07.000Z')), false);
  assert.match(source, /IGNORED_STALE_OR_REDELIVERED/);
  assert.match(source, /if \(staleInbound\)[\s\S]*?continue;/);
  assert.match(source, /WHATSAPP_MAX_INBOUND_AGE_MS/);
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

test('document-stage conversations can never restart at the name or location questions', () => {
  const documents = [
    { 'Message ID': 'm1', 'Document Type': 'IDENTITY_DOCUMENT', 'Verification Status': 'PENDING_AI' },
    { 'Message ID': 'm2', 'Document Type': 'PAYSLIP', 'Verification Status': 'PENDING_AI' }
  ];
  const guarded = guardConversationProgress({
    state: { 'Current Step': 'STEP_04_DOCUMENTS' },
    documents,
    text: 'apa document perlu?',
    decision: {
      handled: true,
      nextStep: 'STEP_01_NAME',
      text: 'Untuk mula semakan loan kedai, boleh hantar dokumen di sini. Boleh saya tahu nama anda?'
    }
  });
  assert.equal(guarded.nextStep, 'STEP_04_DOCUMENTS');
  assert.equal(guarded.conversationProgressGuarded, true);
  assert.doesNotMatch(guarded.text, /nama anda|bandar atau negeri/i);
  assert.match(guarded.text, /sudah terima 2 fail|sedang membuat semakan/i);
});

test('document progress lists only the missing requirement after verification', () => {
  const reply = buildDocumentProgressReply('MS', [
    { 'Message ID': 'm1', 'Document Type': 'IC_FRONT', 'Verification Status': 'AI_VERIFIED', 'Quality Status': 'GOOD' },
    { 'Message ID': 'm2', 'Document Type': 'IC_BACK', 'Verification Status': 'AI_VERIFIED', 'Quality Status': 'GOOD' }
  ]);
  assert.match(reply, /slip gaji atau penyata EPF/i);
  assert.doesNotMatch(reply, /IC depan dan IC belakang/i);
});

test('received pending documents are never described as missing or requested again', () => {
  const reply = buildDocumentProgressReply('MS', [
    { 'Message ID': 'm1', 'Document Type': 'IDENTITY_DOCUMENT', 'Verification Status': 'PENDING_AI', 'Quality Status': 'PENDING_AI' },
    { 'Message ID': 'm2', 'Document Type': 'PAYSLIP', 'Verification Status': 'PENDING_AI', 'Quality Status': 'PENDING_AI' }
  ]);
  assert.match(reply, /sudah terima 2 fail/i);
  assert.match(reply, /sedang membuat semakan/i);
  assert.match(reply, /tak perlu hantar semula/i);
  assert.doesNotMatch(reply, /masih diperlukan/i);
  assert.match(source, /Verification Pending Documents/);
  assert.match(source, /META_WEBHOOK_DOCUMENT_RECEIVED/);
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
  assert.equal(resolveCustomerLocation('kch', 'MOTOR', branches).city, 'Kuching');
  assert.equal(resolveCustomerLocation('kuchihn', 'MOTOR', branches).city, 'Kuching');
  assert.equal(resolveCustomerLocation('hello', 'MOTOR', branches), null);
});

test('a pure greeting asks for the customer name before the location', () => {
  const welcome = buildInstantSalesDecision({ state: { 'Current Step': 'STEP_01_WELCOME' }, text: 'Hi', messageType: 'text' });
  assert.equal(welcome.nextStep, 'STEP_01_NAME');
  assert.match(welcome.text, /nama anda/i);
  assert.match(welcome.text, /terima kasih|ansuran bulanan/i);
  assert.equal((welcome.text.match(/\?/g) || []).length, 1);
  assert.doesNotMatch(welcome.text, /age|\bAI\b/i);
  assert.doesNotMatch(welcome.text, /[👍😊🙂🤖]/u);

  const name = buildInstantSalesDecision({ state: { 'Current Step': 'STEP_01_NAME' }, text: 'Nick', messageType: 'text' });
  assert.equal(name.customerName, 'Nick');
  assert.equal(name.nextStep, 'STEP_02_LOCATION');
  assert.match(name.text, /bandar|negeri/i);

  const location = buildInstantSalesDecision({
    state: { 'Current Step': 'STEP_02_LOCATION' }, text: 'Kuala Lumpur', messageType: 'text', routeBusinessUnit: 'MOTOR',
    branches: [{ Active: 'TRUE', 'Business Unit': 'MOTOR', Region: 'WEST_MALAYSIA', 'Branch ID': 'BR-WM-PJ', 'Team ID': 'TEAM-WEST', 'Branch Name': 'Petaling Jaya', City: 'Petaling Jaya', 'Direct Coverage Areas': 'Kuala Lumpur|KL|Selangor' }]
  });
  assert.equal(location.nextStep, 'STEP_03_PRODUCT');
  assert.equal(location.location.branchId, 'BR-WM-PJ');
  assert.match(location.text, /motor atau telefon/i);
});

test('a known returning customer gets a useful question instead of a stripped greeting', () => {
  const decision = buildInstantSalesDecision({
    state: { 'Current Step': 'STEP_04_DOCUMENTS', 'Customer Name': 'Nick' },
    lead: { 'Customer Name': 'Nick', Region: 'EAST_MALAYSIA', 'City or Area': 'Kuching' },
    text: 'hi',
    messageType: 'text'
  });
  assert.equal(decision.nextStep, 'STEP_04_DOCUMENTS');
  assert.match(decision.text, /Nick/);
  assert.match(decision.text, /apa yang anda mahu saya semak/i);
  assert.equal((decision.text.match(/\?/g) || []).length, 1);
  assert.doesNotMatch(decision.text, /nama anda/i);
});

test('a shop-loan question is answered before requesting missing profile details', () => {
  const decision = buildInstantSalesDecision({
    state: { 'Current Step': 'STEP_01_WELCOME', 'Product Category': 'MOTOR' },
    lead: {},
    text: 'kalau sy mahu beli motor under kedai dpt tak',
    messageType: 'text',
    routeBusinessUnit: 'MOTOR',
    motorCatalog: [
      { 'Catalog ID': 'MTR-SYM-HUSKY200', Brand: 'SYM', Model: 'Husky 200', Active: 'TRUE', 'Search Keywords': 'sym husky 200 scooter east malaysia sabah sarawak' },
      { 'Catalog ID': 'MTR-MODA-MOCA110', Brand: 'MODA', Model: 'Moca 110', Active: 'TRUE', 'Search Keywords': 'moda moca 110 scooter east malaysia sabah sarawak' }
    ]
  });
  assert.equal(decision.shopLoanIntent, true);
  assert.equal(decision.nextStep, 'STEP_01_NAME');
  assert.match(decision.text, /loan kedai/i);
  assert.match(decision.text, /nama anda/i);
  assert.doesNotMatch(decision.text, /Husky|Moca|pilih satu/i);
  assert.equal((decision.text.match(/\?/g) || []).length, 1);
});

test('a customer location can never be mistaken for catalog search keywords', () => {
  const motorCatalog = [
    { 'Catalog ID': 'MTR-SYM-HUSKY200', Brand: 'SYM', Model: 'Husky 200', Active: 'TRUE', 'Search Keywords': 'sym husky 200 husky200 scooter skuter east malaysia sabah sarawak' },
    { 'Catalog ID': 'MTR-MODA-MOCA110', Brand: 'MODA', Model: 'Moca 110', Active: 'TRUE', 'Search Keywords': 'moda moca moca 110 moca110 scooter skuter east malaysia sabah sarawak' }
  ];
  assert.equal(matchInstantProduct('kuching sarawak', motorCatalog).product, null);
  assert.equal(matchInstantProduct('kuching sarawak', motorCatalog).ambiguous, false);
  const decision = buildInstantSalesDecision({
    state: { 'Current Step': 'STEP_02_LOCATION', 'Customer Name': 'nick', 'Product Category': 'MOTOR' },
    lead: { 'Customer Name': 'nick' },
    text: 'kuching sarawak',
    messageType: 'text',
    routeBusinessUnit: 'MOTOR',
    branches: [{ Active: 'TRUE', 'Business Unit': 'MOTOR', Region: 'SARAWAK', 'Branch ID': 'BR-SWK-KCH', 'Team ID': 'TEAM-MOTOR-EAST-STK', 'Branch Name': 'Kuching', City: 'Kuching', 'Direct Coverage Areas': 'Kuching|Sarawak' }],
    motorCatalog
  });
  assert.equal(decision.nextStep, 'STEP_03_PRODUCT');
  assert.equal(decision.location.branchId, 'BR-SWK-KCH');
  assert.match(decision.text, /model|motor atau telefon/i);
  assert.doesNotMatch(decision.text, /Husky|Moca|pilih satu/i);
});

test('short or ambiguous customer messages default to Bahasa Melayu', () => {
  const greeting = buildInstantSalesDecision({ state: { 'Current Step': 'STEP_01_WELCOME' }, text: 'Hi', messageType: 'text' });
  const name = buildInstantSalesDecision({ state: { 'Current Step': 'STEP_01_NAME', 'Last AI Message': 'May I know your name?' }, text: 'Jim', messageType: 'text' });
  assert.match(greeting.text, /terima kasih|nama anda/i);
  assert.match(name.text, /bandar|negeri/i);
  assert.doesNotMatch(greeting.text, /May I know/i);
  assert.doesNotMatch(name.text, /Which city|Nice to meet/i);
});

test('a casual available-motor question returns real options instead of repeating the model question', () => {
  const decision = buildInstantSalesDecision({
    state: { 'Current Step': 'STEP_03_PRODUCT', 'Customer Name': 'Mike', 'Product Category': 'MOTOR' },
    lead: { 'Customer Name': 'Mike', Region: 'EAST_MALAYSIA', 'City or Area': 'Kuching' },
    text: 'motor apa ada', messageType: 'text', routeBusinessUnit: 'MOTOR', routeRegion: 'EAST_MALAYSIA',
    motorCatalog: [
      { 'Catalog ID': 'M1', Brand: 'Yamaha', Model: 'Y15ZR', Active: 'TRUE' },
      { 'Catalog ID': 'M2', Brand: 'Yamaha', Model: 'NMAX', Active: 'TRUE' },
      { 'Catalog ID': 'M3', Brand: 'Honda', Model: 'RS150R', Active: 'TRUE' }
    ],
    motorPricing: [
      { 'Catalog ID': 'M1', 'Price Zone': 'EAST_MALAYSIA', Active: 'TRUE', 'Quote Approval Status': 'APPROVED', 'Monthly 5 Years (RM)': '327' },
      { 'Catalog ID': 'M2', 'Price Zone': 'EAST_MALAYSIA', Active: 'TRUE', 'Quote Approval Status': 'APPROVED', 'Monthly 5 Years (RM)': '365' },
      { 'Catalog ID': 'M3', 'Price Zone': 'EAST_MALAYSIA', Active: 'TRUE', 'Quote Approval Status': 'APPROVED', 'Monthly 5 Years (RM)': '299' }
    ]
  });
  assert.equal(decision.availableModelsIntent, true);
  assert.match(decision.text, /Yamaha Y15ZR/);
  assert.match(decision.text, /Yamaha NMAX/);
  assert.match(decision.text, /Honda RS150R/);
  assert.doesNotMatch(decision.text, /Model motor atau telefon yang mana/i);
  assert.equal((decision.text.match(/\?/g) || []).length, 1);
});

test('repeating only motor offers real options instead of repeating the same model prompt', () => {
  const decision = buildInstantSalesDecision({
    state: { 'Current Step': 'STEP_03_PRODUCT', 'Product Category': 'MOTOR', 'Last Customer Message': 'motor' },
    lead: { Region: 'EAST_MALAYSIA', 'City or Area': 'Kuching' },
    text: 'motor', messageType: 'text', routeBusinessUnit: 'MOTOR', routeRegion: 'EAST_MALAYSIA',
    motorCatalog: [
      { 'Catalog ID': 'M1', Brand: 'Yamaha', Model: 'XMAX 250', Active: 'TRUE' },
      { 'Catalog ID': 'M2', Brand: 'Yamaha', Model: 'NMAX', Active: 'TRUE' }
    ],
    motorPricing: [
      { 'Catalog ID': 'M1', 'Price Zone': 'EAST_MALAYSIA', Active: 'TRUE', 'Quote Approval Status': 'APPROVED', 'Monthly 5 Years (RM)': '602' },
      { 'Catalog ID': 'M2', 'Price Zone': 'EAST_MALAYSIA', Active: 'TRUE', 'Quote Approval Status': 'APPROVED', 'Monthly 5 Years (RM)': '365' }
    ]
  });
  assert.match(decision.text, /XMAX 250|NMAX/);
  assert.doesNotMatch(decision.text, /^Model motor atau telefon yang mana/i);
});

test('customer frustration triggers a useful recovery reply and never repeats the failed question', () => {
  const decision = buildInstantSalesDecision({
    state: { 'Current Step': 'STEP_03_PRODUCT', 'Customer Name': 'Mike', 'Product Category': 'MOTOR', 'Last AI Message': 'Model motor atau telefon yang mana anda minat?' },
    lead: { 'Customer Name': 'Mike', Region: 'EAST_MALAYSIA', 'City or Area': 'Kuching' },
    text: 'tak faham ke apa saya cakap', messageType: 'text', routeBusinessUnit: 'MOTOR', routeRegion: 'EAST_MALAYSIA',
    motorCatalog: [{ 'Catalog ID': 'M1', Brand: 'Yamaha', Model: 'Y15ZR', Active: 'TRUE' }],
    motorPricing: [{ 'Catalog ID': 'M1', 'Price Zone': 'EAST_MALAYSIA', Active: 'TRUE', 'Quote Approval Status': 'APPROVED', 'Monthly 5 Years (RM)': '327' }]
  });
  assert.equal(decision.serviceRecovery, true);
  assert.match(decision.text, /Maaf/);
  assert.match(decision.text, /Yamaha Y15ZR/);
  assert.doesNotMatch(decision.text, /Model motor atau telefon yang mana/i);
});

test('loan kedai perlukan apa returns the required documents even when AI misclassifies it as processing time', () => {
  const decision = buildInstantSalesDecision({
    state: { 'Current Step': 'STEP_03_PRODUCT', 'Customer Name': 'Amin', 'Product Category': 'MOTOR' },
    lead: { 'Customer Name': 'Amin', Region: 'EAST_MALAYSIA', 'City or Area': 'Kuching' },
    text: 'loan kedai perlukan apa', messageType: 'text', routeBusinessUnit: 'MOTOR', routeRegion: 'EAST_MALAYSIA',
    aiIntent: { intent: 'PROCESSING_TIME', language: 'MS', businessUnit: 'MOTOR', confidence: 0.91 }
  });
  assert.equal(decision.documentRequirementsIntent, true);
  assert.equal(decision.nextStep, 'STEP_04_DOCUMENTS');
  assert.match(decision.text, /IC depan dan belakang/i);
  assert.match(decision.text, /slip gaji terkini atau penyata EPF/i);
  assert.match(decision.text, /semua sekali/i);
  assert.doesNotMatch(decision.text, /1[–-]3 hari|model|bajet bulanan/i);
});

test('frustration after a missed document question answers the original question instead of suggesting models', () => {
  const decision = buildInstantSalesDecision({
    state: {
      'Current Step': 'STEP_03_PRODUCT',
      'Customer Name': 'Amin',
      'Product Category': 'MOTOR',
      'Last Customer Message': 'loan kedai perlukan apa',
      'Last AI Message': 'Biasanya proses mengambil masa 1-3 hari bekerja.'
    },
    lead: { 'Customer Name': 'Amin', Region: 'EAST_MALAYSIA', 'City or Area': 'Kuching' },
    text: 'tak faham ke soalan saya', messageType: 'text', routeBusinessUnit: 'MOTOR', routeRegion: 'EAST_MALAYSIA',
    motorCatalog: [{ 'Catalog ID': 'M1', Brand: 'Yamaha', Model: 'Y15ZR', Active: 'TRUE' }],
    motorPricing: [{ 'Catalog ID': 'M1', 'Price Zone': 'EAST_MALAYSIA', Active: 'TRUE', 'Quote Approval Status': 'APPROVED', 'Monthly 5 Years (RM)': '327' }],
    aiIntent: { intent: 'FRUSTRATED', language: 'MS', businessUnit: 'MOTOR', confidence: 0.99 }
  });
  assert.equal(decision.serviceRecovery, true);
  assert.equal(decision.documentRequirementsIntent, true);
  assert.equal(decision.nextStep, 'STEP_04_DOCUMENTS');
  assert.match(decision.text, /Maaf/i);
  assert.match(decision.text, /IC depan dan belakang/i);
  assert.match(decision.text, /slip gaji terkini atau penyata EPF/i);
  assert.doesNotMatch(decision.text, /Yamaha|Y15ZR|bajet bulanan|1[–-]3 hari/i);
});

test('a promotion question is answered before the missing location question', () => {
  const decision = buildInstantSalesDecision({
    state: { 'Current Step': 'STEP_02_LOCATION', 'Customer Name': 'Charles', 'Product Category': 'MOTOR', 'Last AI Message': 'Salam kenal, Charles. Anda tinggal di bandar atau negeri mana?' },
    lead: { 'Customer Name': 'Charles' },
    text: 'motor apa ada promosi skg', messageType: 'text', routeBusinessUnit: 'MOTOR', routeRegion: 'WEST_MALAYSIA'
  });
  assert.equal(decision.promotionIntent, true);
  assert.equal(decision.nextStep, 'STEP_02_LOCATION');
  assert.match(decision.text, /Promosi motor semasa berbeza mengikut kawasan/i);
  assert.match(decision.text, /bandar atau negeri/i);
  assert.doesNotMatch(decision.text, /Model motor atau telefon|Which motorcycle/i);
  assert.equal((decision.text.match(/\?/g) || []).length, 1);
});

test('a known-location promotion question lists only approved active regional promotions in Malay', () => {
  const decision = buildInstantSalesDecision({
    state: { 'Current Step': 'STEP_03_PRODUCT', 'Customer Name': 'Charles', 'Product Category': 'MOTOR', 'Last AI Message': 'Terima kasih, lokasi Klang sudah dicatat.' },
    lead: { 'Customer Name': 'Charles', Region: 'WEST_MALAYSIA', State: 'Selangor', 'City or Area': 'Klang' },
    text: 'motor apa ada promosi skg', messageType: 'text', routeBusinessUnit: 'MOTOR', routeRegion: 'WEST_MALAYSIA',
    motorCatalog: [
      { 'Catalog ID': 'M1', Brand: 'Yamaha', Model: 'Y15ZR', Active: 'TRUE' },
      { 'Catalog ID': 'M2', Brand: 'Honda', Model: 'RS150R', Active: 'TRUE' },
      { 'Catalog ID': 'M3', Brand: 'SYM', Model: 'Husky 200', Active: 'TRUE' }
    ],
    motorPricing: [
      { 'Catalog ID': 'M1', 'Price Zone': 'WEST_MALAYSIA', Active: 'TRUE', 'Quote Approval Status': 'APPROVED', 'Promotion Active': 'TRUE', 'Promotion Approval Status': 'APPROVED', 'Promotion Name': 'Merdeka Deal', 'Promotion Deposit (RM)': '500', 'Promotion Start': '2026-01-01', 'Promotion End': '2026-12-31' },
      { 'Catalog ID': 'M2', 'Price Zone': 'WEST_MALAYSIA', Active: 'TRUE', 'Quote Approval Status': 'APPROVED', 'Promotion Active': 'TRUE', 'Promotion Approval Status': 'DRAFT', 'Promotion Name': 'Unapproved', 'Promotion Deposit (RM)': '100' },
      { 'Catalog ID': 'M3', 'Price Zone': 'EAST_MALAYSIA', Active: 'TRUE', 'Quote Approval Status': 'APPROVED', 'Promotion Active': 'TRUE', 'Promotion Approval Status': 'APPROVED', 'Promotion Name': 'East Only', 'Promotion Deposit (RM)': '300' }
    ]
  });
  assert.equal(decision.promotionIntent, true);
  assert.match(decision.text, /Yamaha Y15ZR/);
  assert.match(decision.text, /Merdeka Deal/);
  assert.match(decision.text, /deposit RM500/i);
  assert.doesNotMatch(decision.text, /RS150R|Husky|Unapproved|East Only|bandar atau negeri|Which model/i);
  assert.match(decision.text, /Model mana satu/i);
  assert.equal((decision.text.match(/\?/g) || []).length, 1);
});

test('promotion and shorthand location in one message are understood together', () => {
  const decision = buildInstantSalesDecision({
    state: { 'Current Step': 'STEP_02_LOCATION', 'Customer Name': 'Mike', 'Product Category': 'MOTOR' },
    lead: { 'Customer Name': 'Mike' },
    text: 'promosi apa skg kch', messageType: 'text', routeBusinessUnit: 'MOTOR', routeRegion: 'EAST_MALAYSIA',
    branches: [{ Active: 'TRUE', 'Business Unit': 'MOTOR', Region: 'SARAWAK', 'Branch ID': 'BR-SWK-KCH', 'Team ID': 'TEAM-KCH', 'Branch Name': 'Kuching', City: 'Kuching', 'Direct Coverage Areas': 'Kuching|KCH' }],
    motorCatalog: [{ 'Catalog ID': 'M1', Brand: 'Yamaha', Model: 'Y15ZR', Active: 'TRUE' }],
    motorPricing: [{ 'Catalog ID': 'M1', 'Price Zone': 'EAST_MALAYSIA', Active: 'TRUE', 'Quote Approval Status': 'APPROVED', 'Promotion Active': 'TRUE', 'Promotion Approval Status': 'APPROVED', 'Promotion Name': 'Rider Deal', 'Promotion Deposit (RM)': '500', 'Promotion Start': '2026-01-01', 'Promotion End': '2026-12-31' }]
  });
  assert.equal(decision.location.city, 'Kuching');
  assert.equal(decision.location.branchId, 'BR-SWK-KCH');
  assert.match(decision.text, /Yamaha Y15ZR/);
  assert.doesNotMatch(decision.text, /bandar atau negeri/i);
  assert.equal((decision.text.match(/\?/g) || []).length, 1);
});

test('a Malay conversation does not switch to English because the customer uses the word i', () => {
  const decision = buildInstantSalesDecision({
    state: { 'Current Step': 'STEP_03_PRODUCT', 'Customer Name': 'Charles', 'Product Category': 'MOTOR', 'Last AI Message': 'Model motor mana yang anda minat?' },
    lead: { 'Customer Name': 'Charles', Region: 'WEST_MALAYSIA', 'City or Area': 'Klang' },
    text: 'u ni tak faham apa i cakap ke', messageType: 'text', routeBusinessUnit: 'MOTOR'
  });
  assert.match(decision.text, /Model motor atau telefon|Boleh|saya/i);
  assert.doesNotMatch(decision.text, /Which motorcycle|You can send/i);
});

test('a model question is answered before repeating missing profile questions', () => {
  const decision = buildInstantSalesDecision({
    state: {
      'Current Step': 'STEP_01_NAME',
      'Last AI Message': 'Hai, selamat datang ke JomKaki Rider. Boleh saya tahu nama anda?',
      'Product Category': 'MOTOR'
    },
    lead: { 'Customer Name': 'WhatsApp Customer 2387', Region: 'EAST_MALAYSIA', 'Selected Branch ID': 'BR-SWK-BTU' },
    text: 'Y15', messageType: 'text', routeBusinessUnit: 'MOTOR', routeRegion: 'EAST_MALAYSIA',
    motorCatalog: [{ 'Catalog ID': 'MTR-YAM-Y15ZR', Brand: 'Yamaha', Model: 'Y15ZR', Active: 'TRUE', 'Image Approved': 'TRUE', 'Image URL': 'https://cdn.example.test/y15zr.jpg', 'Search Keywords': 'yamaha y15 y15zr y15 zr' }],
    motorPricing: [{ 'Catalog ID': 'MTR-YAM-Y15ZR', 'Price Zone': 'EAST_MALAYSIA', Active: 'TRUE', 'Quote Approval Status': 'APPROVED', 'Monthly 5 Years (RM)': '327' }]
  });
  assert.equal(decision.handled, true);
  assert.equal(decision.productIntent, true);
  assert.equal(decision.product.Model, 'Y15ZR');
  assert.equal(decision.imageUrl, 'https://cdn.example.test/y15zr.jpg');
  assert.equal(decision.nextStep, 'STEP_01_NAME');
  assert.match(decision.text, /Y15ZR|RM327/);
  assert.doesNotMatch(decision.text, /Maaf|supaya saya boleh teruskan|Boleh saya tahu nama anda/i);
});

test('a first-message model enquiry gets the answer and then one natural profile question', () => {
  const decision = buildInstantSalesDecision({
    state: {}, lead: {}, text: 'Y15', messageType: 'text', routeBusinessUnit: 'MOTOR', routeRegion: 'EAST_MALAYSIA',
    motorCatalog: [{ 'Catalog ID': 'MTR-YAM-Y15ZR', Brand: 'Yamaha', Model: 'Y15ZR', Active: 'TRUE', 'Image Approved': 'TRUE', 'Image URL': 'https://cdn.example.test/y15zr.jpg', 'Search Keywords': 'yamaha y15 y15zr y15 zr' }],
    motorPricing: [{ 'Catalog ID': 'MTR-YAM-Y15ZR', 'Price Zone': 'EAST_MALAYSIA', Active: 'TRUE', 'Quote Approval Status': 'APPROVED', 'Monthly 5 Years (RM)': '327' }]
  });
  assert.equal(decision.nextStep, 'STEP_01_NAME');
  assert.match(decision.text, /RM327/);
  assert.match(decision.text, /nama anda/i);
  assert.equal((decision.text.match(/\?/g) || []).length, 1);
});

test('instant motor reply sends approved deposit, image and only one monthly instalment', () => {
  const decision = buildInstantSalesDecision({
    state: { 'Current Step': 'STEP_03_PRODUCT', 'Customer Name': 'Jim', 'Product Category': 'MOTOR' },
    lead: { 'Customer Name': 'Jim', Region: 'WEST_MALAYSIA', State: 'Selangor', 'City or Area': 'Petaling Jaya' }, text: 'I am looking for Yamaha Y16ZR', messageType: 'text', routeBusinessUnit: 'MOTOR', routeRegion: 'WEST_MALAYSIA',
    motorCatalog: [{ 'Catalog ID': 'MTR-YAM-Y16ZR', Brand: 'Yamaha', Model: 'Y16ZR', Active: 'TRUE', 'Image Approved': 'TRUE', 'Image URL': 'https://cdn.example.test/y16zr.jpg' }],
    motorPricing: [{ 'Catalog ID': 'MTR-YAM-Y16ZR', 'Price Zone': 'WEST_MALAYSIA', Active: 'TRUE', 'Quote Approval Status': 'APPROVED', 'Monthly 3 Years (RM)': '394', 'Monthly 4 Years (RM)': '318', 'Monthly 5 Years (RM)': '273', 'Selling Price (RM)': '12000', 'Deposit (RM)': '1000' }]
  });
  assert.equal(decision.nextStep, 'STEP_04_DOCUMENTS');
  assert.equal(decision.imageUrl, 'https://cdn.example.test/y16zr.jpg');
  assert.match(decision.text, /RM273/);
  assert.match(decision.text, /deposit.*RM1000/i);
  assert.doesNotMatch(decision.text, /394|318|12000|selling price/i);
  assert.match(decision.text, /continue with the loan check/i);
  assert.doesNotMatch(decision.text, /MyKad|payslip|EPF/i);
  assert.doesNotMatch(decision.text, /satu per satu|one by one/i);
});

test('cash berapa answers the selected motor cash price without resending its image or loan script', () => {
  const decision = buildInstantSalesDecision({
    state: { 'Current Step': 'STEP_04_DOCUMENTS', 'Customer Name': 'Amin', 'Product Category': 'MOTOR', 'Selected Product Brand': 'Yamaha', 'Selected Product Model': 'Y15 SE' },
    lead: { 'Customer Name': 'Amin', Region: 'EAST_MALAYSIA', 'City or Area': 'Kuching' }, text: 'cash berapa', messageType: 'text', routeBusinessUnit: 'MOTOR', routeRegion: 'EAST_MALAYSIA',
    motorCatalog: [{ 'Catalog ID': 'MTR-YAM-Y15SE', Brand: 'Yamaha', Model: 'Y15 SE', Active: 'TRUE', 'Image Approved': 'TRUE', 'Image URL': 'https://cdn.example.test/y15se.jpg' }],
    motorPricing: [{ 'Catalog ID': 'MTR-YAM-Y15SE', 'Price Zone': 'EAST_MALAYSIA', Active: 'TRUE', 'Quote Approval Status': 'APPROVED', 'Monthly 5 Years (RM)': '340', 'Deposit (RM)': '500', 'Product Price (RM)': '9500' }]
  });
  assert.equal(decision.cashPriceIntent, true);
  assert.equal(decision.imageUrl, undefined);
  assert.match(decision.text, /harga tunai.*RM9500/i);
  assert.doesNotMatch(decision.text, /RM340|deposit|IC|slip gaji|satu per satu/i);
});

test('a direct motor cash-price question answers once and never attaches the product image', () => {
  const decision = buildInstantSalesDecision({
    state: { 'Current Step': 'STEP_03_PRODUCT', 'Product Category': 'MOTOR' }, lead: { Region: 'EAST_MALAYSIA' },
    text: 'Y15 SE cash berapa?', messageType: 'text', routeBusinessUnit: 'MOTOR', routeRegion: 'EAST_MALAYSIA',
    motorCatalog: [{ 'Catalog ID': 'MTR-YAM-Y15SE', Brand: 'Yamaha', Model: 'Y15 SE', Active: 'TRUE', 'Image Approved': 'TRUE', 'Image URL': 'https://cdn.example.test/y15se.jpg' }],
    motorPricing: [{ 'Catalog ID': 'MTR-YAM-Y15SE', 'Price Zone': 'EAST_MALAYSIA', Active: 'TRUE', 'Quote Approval Status': 'APPROVED', 'Monthly 5 Years (RM)': '340', 'Selling Price (RM)': '9300' }]
  });
  assert.equal(decision.cashPriceIntent, true);
  assert.equal(decision.imageUrl, undefined);
  assert.match(decision.text, /harga tunai.*RM9300/i);
});

test('a customer can ask the deposit for the already selected motor', () => {
  const decision = buildInstantSalesDecision({
    state: { 'Current Step': 'STEP_04_DOCUMENTS', 'Customer Name': 'Amin', 'Product Category': 'MOTOR', 'Selected Product Brand': 'Yamaha', 'Selected Product Model': 'Y16ZR' },
    lead: { 'Customer Name': 'Amin', Region: 'EAST_MALAYSIA', 'City or Area': 'Bintulu' }, text: 'deposit berapa?', messageType: 'text', routeBusinessUnit: 'MOTOR', routeRegion: 'EAST_MALAYSIA',
    motorCatalog: [{ 'Catalog ID': 'MTR-YAM-Y16ZR', Brand: 'Yamaha', Model: 'Y16ZR', Active: 'TRUE' }],
    motorPricing: [{ 'Catalog ID': 'MTR-YAM-Y16ZR', 'Price Zone': 'EAST_MALAYSIA', Active: 'TRUE', 'Quote Approval Status': 'APPROVED', 'Monthly 5 Years (RM)': '299', 'Deposit (RM)': '1500', 'Selling Price (RM)': '13000' }]
  });
  assert.equal(decision.productIntent, true);
  assert.equal(decision.imageUrl, undefined);
  assert.match(decision.text, /deposit.*RM1500/i);
  assert.doesNotMatch(decision.text, /RM299|13000|harga jualan/i);
});

test('a missing motor deposit is never guessed', () => {
  const decision = buildInstantSalesDecision({
    state: { 'Current Step': 'STEP_04_DOCUMENTS', 'Customer Name': 'Amin', 'Product Category': 'MOTOR', 'Selected Product Brand': 'Yamaha', 'Selected Product Model': 'Y16ZR' },
    lead: { 'Customer Name': 'Amin', Region: 'EAST_MALAYSIA', 'City or Area': 'Bintulu' }, text: 'depo berapa?', messageType: 'text', routeBusinessUnit: 'MOTOR', routeRegion: 'EAST_MALAYSIA',
    motorCatalog: [{ 'Catalog ID': 'MTR-YAM-Y16ZR', Brand: 'Yamaha', Model: 'Y16ZR', Active: 'TRUE' }],
    motorPricing: [{ 'Catalog ID': 'MTR-YAM-Y16ZR', 'Price Zone': 'EAST_MALAYSIA', Active: 'TRUE', 'Quote Approval Status': 'APPROVED', 'Monthly 5 Years (RM)': '299' }]
  });
  assert.match(decision.text, /belum ada dalam sistem|semak dengan cawangan/i);
  assert.doesNotMatch(decision.text, /RM\d/i);
});

test('known customer model reply survives a stale Make conversation step', () => {
  const decision = buildInstantSalesDecision({
    state: { 'Current Step': 'STEP_01_NAME', 'Customer Name': 'Jim', 'Product Category': 'MOTOR' },
    lead: { 'Customer Name': 'Jim', Region: 'EAST_MALAYSIA', State: 'Sarawak', 'City or Area': 'Bintulu' }, text: 'Yamaha Y16ZR', messageType: 'text', routeBusinessUnit: 'MOTOR', routeRegion: 'WEST_MALAYSIA',
    motorCatalog: [{ 'Catalog ID': 'MTR-YAM-Y16ZR', Brand: 'Yamaha', Model: 'Y16ZR', Active: 'TRUE', 'Image Approved': 'TRUE', 'Image URL': 'https://cdn.example.test/y16zr.jpg' }],
    motorPricing: [{ 'Catalog ID': 'MTR-YAM-Y16ZR', 'Price Zone': 'EAST_MALAYSIA', Active: 'TRUE', 'Quote Approval Status': 'APPROVED', 'Monthly 3 Years (RM)': '420', 'Monthly 4 Years (RM)': '350', 'Monthly 5 Years (RM)': '299' }]
  });
  assert.equal(decision.nextStep, 'STEP_04_DOCUMENTS');
  assert.match(decision.text, /RM299/);
  assert.match(decision.text, /ansuran|dokumen|IC/i);
});

test('customer model shorthand, spacing and small typo are recognised', () => {
  const catalog = [
    { 'Catalog ID': 'MTR-YAM-Y16ZR', Brand: 'Yamaha', Model: 'Y16ZR', Active: 'TRUE', 'Search Keywords': 'yamaha y16 y16zr y16 zr' },
    { 'Catalog ID': 'MTR-HON-RSXW', Brand: 'Honda', Model: 'RS-X Winner', Active: 'TRUE', 'Search Keywords': 'honda rsx rs-x rs x winner' }
  ];
  assert.equal(matchInstantProduct('y16zr', catalog).product.Model, 'Y16ZR');
  assert.equal(matchInstantProduct('y 16 zr', catalog).product.Model, 'Y16ZR');
  assert.equal(matchInstantProduct('y16z', catalog).product.Model, 'Y16ZR');
  assert.equal(matchInstantProduct('saya cari y16z', catalog).product.Model, 'Y16ZR');
  assert.equal(matchInstantProduct('rsx', catalog).product.Model, 'RS-X Winner');
  assert.equal(matchInstantProduct('nak rs x', catalog).product.Model, 'RS-X Winner');
  assert.equal(matchInstantProduct('nak ansuran murah', catalog).product, null);
});

test('a customer can switch from Y15ZR to LC V8 using normal local shorthand', () => {
  const motorCatalog = [{
    'Catalog ID': 'MTR-YAM-LC135V8', Brand: 'Yamaha', Model: 'LC135 V8', Active: 'TRUE',
    'Image Approved': 'TRUE', 'Image URL': 'https://cdn.example.test/lc135-v8.jpg',
    'Search Keywords': 'yamaha lc135 v8 lc v8 lcv8 lc8 135lc'
  }];
  assert.equal(matchInstantProduct('Saya mau lc v8', motorCatalog).product.Model, 'LC135 V8');
  assert.equal(matchInstantProduct('nak lcv8', motorCatalog).product.Model, 'LC135 V8');
  assert.equal(matchInstantProduct('lc8 ada?', motorCatalog).product.Model, 'LC135 V8');
  const decision = buildInstantSalesDecision({
    state: { 'Current Step': 'STEP_04_DOCUMENTS', 'Customer Name': 'Ali', 'Product Category': 'MOTOR', 'Selected Product Brand': 'Yamaha', 'Selected Product Model': 'Y15ZR' },
    lead: { 'Customer Name': 'Ali', Region: 'EAST_MALAYSIA', 'City or Area': 'Bintulu' },
    text: 'Saya mau lc v8', messageType: 'text', routeBusinessUnit: 'MOTOR', routeRegion: 'EAST_MALAYSIA',
    motorCatalog,
    motorPricing: [{ 'Catalog ID': 'MTR-YAM-LC135V8', 'Price Zone': 'EAST_MALAYSIA', Active: 'TRUE', 'Quote Approval Status': 'APPROVED', 'Deposit (RM)': 'RM 500', 'Monthly 3 Years (RM)': 'RM 425', 'Monthly 4 Years (RM)': 'RM 344', 'Monthly 5 Years (RM)': 'RM 295' }]
  });
  assert.equal(decision.product.Model, 'LC135 V8');
  assert.equal(decision.imageUrl, 'https://cdn.example.test/lc135-v8.jpg');
  assert.match(decision.text, /deposit.*RM500/i);
  assert.match(decision.text, /RM295/);
  assert.doesNotMatch(decision.text, /Anda mahu saya semak yang mana|Y15ZR/i);
});

test('the whole catalogue accepts natural customer shorthand instead of only selected examples', () => {
  const catalog = [
    { 'Catalog ID': 'MTR-YAM-NVX', Brand: 'Yamaha', Model: 'NVX', Active: 'TRUE', 'Search Keywords': 'yamaha nvx scooter' },
    { 'Catalog ID': 'MTR-HON-WAVE', Brand: 'Honda', Model: 'Wave Alpha', Active: 'TRUE', 'Search Keywords': 'honda wave alpha' },
    { 'Catalog ID': 'MTR-HON-RS150R', Brand: 'Honda', Model: 'RS150R', Active: 'TRUE', 'Search Keywords': 'honda rs150 rs150r' },
    { 'Catalog ID': 'MTR-SYM-HUSKY', Brand: 'SYM', Model: 'Husky 200', Active: 'TRUE', 'Search Keywords': 'sym husky husky200' },
    { 'Catalog ID': 'MTR-MODA-MOCA', Brand: 'MODA', Model: 'Moca', Active: 'TRUE', 'Search Keywords': 'moda moca' }
  ];
  assert.equal(matchInstantProduct('nak tengok nvx', catalog).product.Model, 'NVX');
  assert.equal(matchInstantProduct('wave ada?', catalog).product.Model, 'Wave Alpha');
  assert.equal(matchInstantProduct('rs150 berapa sebulan', catalog).product.Model, 'RS150R');
  assert.equal(matchInstantProduct('husky ada stock ka', catalog).product.Model, 'Husky 200');
  assert.equal(matchInstantProduct('saya minat moca', catalog).product.Model, 'Moca');
});

test('an unpriced base model falls back to its approved priced variant instead of going silent', () => {
  const decision = buildInstantSalesDecision({
    state: { 'Current Step': 'STEP_03_PRODUCT', 'Customer Name': 'Kamis', 'Product Category': 'MOTOR' },
    lead: { 'Customer Name': 'Kamis', Region: 'EAST_MALAYSIA', State: 'Sarawak', 'City or Area': 'Bintulu' },
    text: 'motor nmax', messageType: 'text', routeBusinessUnit: 'MOTOR', routeRegion: 'WEST_MALAYSIA',
    motorCatalog: [
      { 'Catalog ID': 'MTR-YAM-NMAX', Brand: 'Yamaha', Model: 'NMAX', Active: 'TRUE', 'Search Keywords': 'yamaha nmax n max' },
      { 'Catalog ID': 'MTR-YAM-NMAXV3', Brand: 'Yamaha', Model: 'NMAX V3', Active: 'TRUE', 'Image Approved': 'TRUE', 'Image URL': 'https://cdn.example.test/nmax-v3.jpg', 'Search Keywords': 'yamaha nmax v3' }
    ],
    motorPricing: [
      { 'Catalog ID': 'MTR-YAM-NMAXV3', 'Price Zone': 'EAST_MALAYSIA', Active: 'TRUE', 'Quote Approval Status': 'APPROVED', 'Monthly 3 Years (RM)': '526', 'Monthly 4 Years (RM)': '425', 'Monthly 5 Years (RM)': '365' }
    ]
  });
  assert.equal(decision.product.Model, 'NMAX V3');
  assert.equal(decision.nextStep, 'STEP_04_DOCUMENTS');
  assert.equal(decision.imageUrl, 'https://cdn.example.test/nmax-v3.jpg');
  assert.match(decision.text, /NMAX V3/);
  assert.match(decision.text, /RM365/);
});

test('a recognised model without approved regional pricing gets a useful reply instead of silence', () => {
  const decision = buildInstantSalesDecision({
    state: { 'Current Step': 'STEP_03_PRODUCT', 'Product Category': 'MOTOR' },
    lead: { 'Customer Name': 'Kamis', Region: 'EAST_MALAYSIA', State: 'Sarawak', 'City or Area': 'Bintulu' }, text: 'nak nmax', messageType: 'text', routeBusinessUnit: 'MOTOR',
    motorCatalog: [{ 'Catalog ID': 'MTR-YAM-NMAX', Brand: 'Yamaha', Model: 'NMAX', Active: 'TRUE', 'Search Keywords': 'yamaha nmax' }],
    motorPricing: []
  });
  assert.equal(decision.handled, true);
  assert.equal(decision.nextStep, 'STEP_03_PRODUCT');
  assert.match(decision.text, /NMAX/);
  assert.match(decision.text, /semak dengan cawangan/i);
});

test('ambiguous shorthand asks one natural clarification instead of guessing', () => {
  const catalog = [
    { 'Catalog ID': 'MTR-YAM-Y16ZR', Brand: 'Yamaha', Model: 'Y16ZR', Active: 'TRUE', 'Search Keywords': 'yamaha y16 y16zr y16 zr' },
    { 'Catalog ID': 'MTR-YAM-Y16ABS', Brand: 'Yamaha', Model: 'Y16 ABS', Active: 'TRUE', 'Search Keywords': 'yamaha y16 abs' }
  ];
  const match = matchInstantProduct('y16', catalog);
  assert.equal(match.ambiguous, true);
  assert.deepEqual(match.options, ['Yamaha Y16 ABS', 'Yamaha Y16ZR']);
  const decision = buildInstantSalesDecision({
    state: { 'Current Step': 'STEP_03_PRODUCT', 'Product Category': 'MOTOR' },
    lead: { 'Customer Name': 'Jim', Region: 'EAST_MALAYSIA' }, text: 'y16', messageType: 'text', routeBusinessUnit: 'MOTOR', motorCatalog: catalog
  });
  assert.equal(decision.nextStep, 'STEP_03_PRODUCT');
  assert.match(decision.text, /Maksud anda Yamaha Y16 ABS atau Yamaha Y16ZR/);
  assert.doesNotMatch(decision.text, /RM\d/);
});

test('brand-only questions do not invent an arbitrary model shortlist', () => {
  const catalog = [
    { 'Catalog ID': 'MTR-YAM-EGOA', Brand: 'Yamaha', Model: 'Ego Avantiz', Active: 'TRUE', 'Search Keywords': 'yamaha ego avantiz' },
    { 'Catalog ID': 'MTR-YAM-EGOG', Brand: 'Yamaha', Model: 'Ego Gear', Active: 'TRUE', 'Search Keywords': 'yamaha ego gear' },
    { 'Catalog ID': 'MTR-YAM-Y16', Brand: 'Yamaha', Model: 'Y16ZR', Active: 'TRUE', 'Search Keywords': 'yamaha y16 y16zr' }
  ];
  assert.equal(matchInstantProduct('nak tanya motor yamaha', catalog).product, null);
  assert.equal(matchInstantProduct('nak tanya motor yamaha', catalog).ambiguous, false);
});

test('short clarification answers are combined with the previous customer model words', () => {
  const catalog = [
    { 'Catalog ID': 'MTR-YAM-EGOA', Brand: 'Yamaha', Model: 'Ego Avantiz', Active: 'TRUE', 'Search Keywords': 'yamaha ego avantiz' },
    { 'Catalog ID': 'MTR-YAM-EGOG', Brand: 'Yamaha', Model: 'Ego Gear', Active: 'TRUE', 'Search Keywords': 'yamaha ego gear' },
    { 'Catalog ID': 'MTR-YAM-EGOGH', Brand: 'Yamaha', Model: 'Ego Gear Hybrid', Active: 'TRUE', 'Search Keywords': 'yamaha ego gear hybrid' }
  ];
  const decision = buildInstantSalesDecision({
    state: { 'Current Step': 'STEP_03_PRODUCT', 'Product Category': 'MOTOR', 'Last Customer Message': 'ego' },
    lead: { 'Customer Name': 'Kamis', Region: 'EAST_MALAYSIA', 'City or Area': 'Bintulu' },
    text: 'gear', messageType: 'text', routeBusinessUnit: 'MOTOR', routeRegion: 'EAST_MALAYSIA',
    motorCatalog: catalog,
    motorPricing: [{ 'Catalog ID': 'MTR-YAM-EGOG', 'Price Zone': 'EAST_MALAYSIA', Active: 'TRUE', 'Quote Approval Status': 'APPROVED', 'Monthly 5 Years (RM)': '250' }]
  });
  assert.equal(decision.product.Model, 'Ego Gear');
  assert.equal(decision.nextStep, 'STEP_04_DOCUMENTS');
  assert.match(decision.text, /Ego Gear/);
  assert.doesNotMatch(decision.text, /Gear Hybrid|Pilih satu/i);
});

test('a tenure follow-up answers only the requested monthly rate without resending the product image', () => {
  const decision = buildInstantSalesDecision({
    state: { 'Current Step': 'STEP_04_DOCUMENTS', 'Product Category': 'MOTOR', 'Selected Product Brand': 'Yamaha', 'Selected Product Model': 'Ego Gear', 'Last Customer Message': 'ego gear' },
    lead: { 'Customer Name': 'Kamis', Region: 'EAST_MALAYSIA', 'City or Area': 'Bintulu' },
    text: 'berapa bulanan kalau 3 tahun', messageType: 'text', routeBusinessUnit: 'MOTOR', routeRegion: 'EAST_MALAYSIA',
    motorCatalog: [{ 'Catalog ID': 'MTR-YAM-EGOG', Brand: 'Yamaha', Model: 'Ego Gear', Active: 'TRUE', 'Image Approved': 'TRUE', 'Image URL': 'https://cdn.example.test/ego-gear.jpg' }],
    motorPricing: [{ 'Catalog ID': 'MTR-YAM-EGOG', 'Price Zone': 'EAST_MALAYSIA', Active: 'TRUE', 'Quote Approval Status': 'APPROVED', 'Monthly 3 Years (RM)': '310', 'Monthly 5 Years (RM)': '225' }]
  });
  assert.equal(decision.nextStep, 'STEP_04_DOCUMENTS');
  assert.equal(decision.imageUrl, undefined);
  assert.match(decision.text, /3 tahun/);
  assert.match(decision.text, /RM310/);
  assert.doesNotMatch(decision.text, /RM225|IC depan|slip gaji/i);
});

test('phone shorthand groups colour rows and identifies the requested model family', () => {
  const catalog = [
    { 'Catalog ID': 'HP-17PM-256-BLK', Brand: 'Apple', Model: 'iPhone 17 Pro Max', Variant: '256GB Black', Active: 'TRUE', 'Search Keywords': 'apple iphone 17 pro max 256gb black official' },
    { 'Catalog ID': 'HP-17PM-512-BLU', Brand: 'Apple', Model: 'iPhone 17 Pro Max', Variant: '512GB Blue', Active: 'TRUE', 'Search Keywords': 'apple iphone 17 pro max 512gb blue official' },
    { 'Catalog ID': 'HP-17P-256-BLK', Brand: 'Apple', Model: 'iPhone 17 Pro', Variant: '256GB Black', Active: 'TRUE', 'Search Keywords': 'apple iphone 17 pro 256gb black official' }
  ];
  const match = matchInstantProduct('17pm', catalog);
  assert.equal(match.ambiguous, false);
  assert.equal(match.product.Model, 'iPhone 17 Pro Max');
  assert.equal(matchInstantProduct('nak ip17pm', catalog).product.Model, 'iPhone 17 Pro Max');
  assert.equal(matchInstantProduct('iphone 17 promx ada?', catalog).product.Model, 'iPhone 17 Pro Max');
});

test('phone shorthand can override a stale motor category without asking the customer to restart', () => {
  const decision = buildInstantSalesDecision({
    state: { 'Current Step': 'STEP_03_PRODUCT', 'Customer Name': 'Amin', 'Product Category': 'MOTOR' },
    lead: { 'Customer Name': 'Amin', Region: 'EAST_MALAYSIA' }, text: 'nak 17pm', messageType: 'text', routeBusinessUnit: 'MOTOR',
    handphoneCatalog: [{ 'Catalog ID': 'HP-17PM', Brand: 'Apple', Model: 'iPhone 17 Pro Max', Active: 'TRUE', 'Search Keywords': 'iphone 17 pro max' }],
    handphonePricing: [{ 'Catalog ID': 'HP-17PM', 'Price Zone': 'EAST_MALAYSIA', Active: 'TRUE', 'Quote Approval Status': 'APPROVED', 'Monthly 60 Months (RM)': '199' }]
  });
  assert.equal(decision.productUnit, 'HANDPHONE');
  assert.match(decision.text, /RM199/);
});

test('handphone quotes remain monthly-only even when source rows contain deposit and selling price', () => {
  const base = {
    state: { 'Current Step': 'STEP_03_PRODUCT', 'Customer Name': 'Amin', 'Product Category': 'HANDPHONE' },
    lead: { 'Customer Name': 'Amin', Region: 'EAST_MALAYSIA', 'City or Area': 'Bintulu' }, messageType: 'text', routeBusinessUnit: 'HANDPHONE', routeRegion: 'EAST_MALAYSIA',
    handphoneCatalog: [{ 'Catalog ID': 'HP-17PM', Brand: 'Apple', Model: 'iPhone 17 Pro Max', Active: 'TRUE', 'Search Keywords': 'iphone 17 pro max' }],
    handphonePricing: [{ 'Catalog ID': 'HP-17PM', 'Price Zone': 'EAST_MALAYSIA', Active: 'TRUE', 'Quote Approval Status': 'APPROVED', 'Monthly 60 Months (RM)': '199', 'Deposit (RM)': '888', 'Selling Price (RM)': '5999' }]
  };
  const quote = buildInstantSalesDecision({ ...base, text: 'nak iphone 17 pro max' });
  assert.match(quote.text, /RM199/);
  assert.doesNotMatch(quote.text, /deposit|RM888|5999|harga jualan|selling price/i);

  const depositQuestion = buildInstantSalesDecision({
    ...base,
    state: { ...base.state, 'Selected Product Brand': 'Apple', 'Selected Product Model': 'iPhone 17 Pro Max' },
    text: 'deposit berapa?'
  });
  assert.match(depositQuestion.text, /hanya.*ansuran bulanan/i);
  assert.doesNotMatch(depositQuestion.text, /RM888|5999/i);
});

test('post-quote sales questions receive an immediate natural Malay answer instead of silence', () => {
  const base = {
    state: { 'Current Step': 'STEP_04_DOCUMENTS', 'Customer Name': 'Amin', 'Product Category': 'MOTOR' },
    lead: { 'Customer Name': 'Amin', Region: 'EAST_MALAYSIA', 'City or Area': 'Bintulu' },
    messageType: 'text', routeBusinessUnit: 'MOTOR', routeRegion: 'EAST_MALAYSIA'
  };
  const documents = buildInstantSalesDecision({ ...base, text: 'dokumen apa perlu untuk apply?' });
  const budget = buildInstantSalesDecision({ ...base, text: 'mahal lah, ada murah sikit?' });
  const unknown = buildInstantSalesDecision({ ...base, text: 'boleh explain lagi?' });
  assert.match(documents.text, /IC depan dan belakang/);
  assert.match(budget.text, /Bajet bulanan/);
  assert.match(unknown.text, /model, ansuran bulanan, dokumen/);
  assert.equal(unknown.aiFallback, true);
  [documents, budget, unknown].forEach(result => assert.equal(result.handled, true));
});

test('apa yg perlu after an XMAX quote asks for documents and never repeats the quote or image', () => {
  const decision = buildInstantSalesDecision({
    state: {
      'Current Step': 'STEP_03_PRODUCT',
      'Customer Name': 'Amin',
      'Product Category': 'MOTOR',
      'Selected Product Brand': 'Yamaha',
      'Selected Product Model': 'XMAX 250',
      'Last Customer Message': 'xmax'
    },
    lead: { 'Customer Name': 'Amin', Region: 'EAST_MALAYSIA', 'City or Area': 'Kuching' },
    text: 'apa yg perlu',
    messageType: 'text',
    routeBusinessUnit: 'MOTOR',
    routeRegion: 'EAST_MALAYSIA',
    motorCatalog: [{ 'Catalog ID': 'MTR-YAM-XMAX', Brand: 'Yamaha', Model: 'XMAX 250', Active: 'TRUE', 'Image Approved': 'TRUE', 'Image URL': 'https://cdn.example.test/xmax.jpg' }],
    motorPricing: [{ 'Catalog ID': 'MTR-YAM-XMAX', 'Price Zone': 'EAST_MALAYSIA', Active: 'TRUE', 'Quote Approval Status': 'APPROVED', 'Deposit (RM)': '8000', 'Monthly 5 Years (RM)': '602' }]
  });
  assert.equal(decision.documentRequirementsIntent, true);
  assert.equal(decision.nextStep, 'STEP_04_DOCUMENTS');
  assert.match(decision.text, /IC depan dan belakang/);
  assert.match(decision.text, /semua sekali|beberapa fail/);
  assert.equal(decision.imageUrl, undefined);
  assert.doesNotMatch(decision.text, /RM602|RM8000|XMAX/);
});

test('knowledge AI fallback request is privacy-preserving, fast and cannot expose an unsupported amount', async () => {
  const request = buildAiFallbackRequest({
    text: 'boleh explain lagi?',
    state: { 'Current Step': 'STEP_04_DOCUMENTS', 'Customer Name': 'Amin', 'Selected Product Model': 'Y16ZR' },
    lead: { Region: 'EAST_MALAYSIA', 'City or Area': 'Bintulu' },
    routeBusinessUnit: 'MOTOR',
    phone: '60123456789'
  });
  assert.equal(request.model, 'gpt-5.6-terra');
  assert.equal(request.reasoning.effort, 'none');
  assert.equal(request.store, false);
  assert.equal(request.safety_identifier.length, 64);
  assert.equal(request.input.includes('60123456789'), false);
  assert.equal(request.max_output_tokens, 180);

  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'gpt-4.1-mini');
    assert.equal(body.reasoning, undefined);
    assert.equal(body.store, false);
    return { ok: true, json: async () => ({ output: [{ content: [{ text: 'Boleh, bahagian mana yang anda mahu saya terangkan dengan lebih jelas? 😊 Soalan kedua?' }] }] }) };
  };
  const reply = await requestAiFallbackReply({
    text: 'boleh explain lagi?',
    state: { 'Current Step': 'STEP_04_DOCUMENTS' },
    phone: '60123456789',
    env: { OPENAI_API_KEY: 'sk-test', OPENAI_MODEL: 'gpt-4.1-mini' },
    fetchImpl
  });
  assert.equal(reply.includes('😊'), false);
  assert.equal((reply.match(/\?/g) || []).length, 1);
  assert.equal(sanitizeAiFallbackReply('Harga ialah RM999. Berapa bajet anda?', 'MS'), '');
  assert.equal(sanitizeAiFallbackReply('Saya adalah AI yang membantu anda.', 'MS'), '');
});

test('AI intent understanding uses a strict grounded schema and never receives the raw phone number', async () => {
  const catalog = [{ 'Catalog ID': 'MTR-YAM-NMAX', Brand: 'Yamaha', Model: 'NMAX', Variant: 'Standard', Active: 'TRUE', 'Search Keywords': 'nmax n max yamaha' }];
  const request = buildAiIntentRequest({
    text: 'nma berapa sebulan bah',
    state: { 'Current Step': 'STEP_01_NAME', 'Last AI Message': 'Boleh saya tahu nama anda?' },
    lead: { Region: 'EAST_MALAYSIA' },
    routeBusinessUnit: 'MOTOR',
    phone: '60123456789',
    motorCatalog: catalog
  });
  assert.equal(request.model, 'gpt-5.6-terra');
  assert.equal(request.reasoning.effort, 'none');
  assert.equal(request.reasoning.context, 'current_turn');
  assert.equal(request.text.format.type, 'json_schema');
  assert.equal(request.text.format.strict, true);
  assert.equal(request.input.includes('60123456789'), false);
  assert.match(request.input, /MTR-YAM-NMAX/);

  const interpreted = await requestAiIntent({
    text: 'nma berapa sebulan bah',
    state: { 'Current Step': 'STEP_01_NAME' },
    routeBusinessUnit: 'MOTOR',
    phone: '60123456789',
    motorCatalog: catalog,
    env: { OPENAI_API_KEY: 'sk-test', OPENAI_INTENT_MODEL: 'gpt-5.6-terra' },
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      assert.equal(body.model, 'gpt-5.6-terra');
      assert.equal(body.text.format.name, 'jomkaki_customer_intent');
      return {
        ok: true,
        json: async () => ({ output_text: JSON.stringify({
          intent: 'MODEL_SELECTION', language: 'MS', businessUnit: 'MOTOR', catalogId: 'MTR-YAM-NMAX', normalizedModel: 'Yamaha NMAX', tenureYears: 0,
          locationQuery: '', customerName: '', followUpSubject: 'MONTHLY', needsHuman: false, answerCustomerQuestionFirst: true, suggestedReply: '', confidence: 0.96
        }) })
      };
    }
  });
  assert.equal(interpreted.intent, 'MODEL_SELECTION');
  assert.equal(interpreted.catalogId, 'MTR-YAM-NMAX');
  assert.equal(interpreted.answerCustomerQuestionFirst, true);
});

test('AI-selected typo answers the product question before profile collection and sends one approved image', () => {
  const product = { 'Catalog ID': 'MTR-YAM-NMAX', Brand: 'Yamaha', Model: 'NMAX', Active: 'TRUE', 'Image Approved': 'TRUE', 'Image URL': 'https://example.com/nmax.jpg' };
  const pricing = [{ 'Catalog ID': 'MTR-YAM-NMAX', 'Price Zone': 'EAST_MALAYSIA', Active: 'TRUE', 'Quote Approval Status': 'APPROVED', 'Monthly 5 Years (RM)': '365', 'Deposit (RM)': '500' }];
  const decision = buildInstantSalesDecision({
    state: { 'Current Step': 'STEP_01_NAME' }, lead: { Region: 'EAST_MALAYSIA' }, text: 'nma', messageType: 'text', routeBusinessUnit: 'MOTOR', routeRegion: 'EAST_MALAYSIA',
    motorCatalog: [product], motorPricing: pricing,
    aiIntent: { intent: 'MODEL_SELECTION', language: 'MS', businessUnit: 'MOTOR', catalogId: 'MTR-YAM-NMAX', confidence: 0.96 }
  });
  assert.equal(decision.product.Model, 'NMAX');
  assert.equal(decision.nextStep, 'STEP_01_NAME');
  assert.equal(decision.imageUrl, 'https://example.com/nmax.jpg');
  assert.match(decision.text, /RM365/);
  assert.match(decision.text, /nama anda/i);
  assert.equal((decision.text.match(/\?/g) || []).length, 1);
});

test('AI follow-up intent cannot be misread as another model and repeated model replies do not resend the image', () => {
  const catalog = [
    { 'Catalog ID': 'M1', Brand: 'Yamaha', Model: 'Y15ZR', Active: 'TRUE', 'Image Approved': 'TRUE', 'Image URL': 'https://example.com/y15.jpg', 'Search Keywords': 'y15 y15zr' },
    { 'Catalog ID': 'M2', Brand: 'Honda', Model: 'Dash 125 FI', Active: 'TRUE', 'Search Keywords': 'dash 125 fi' }
  ];
  const pricing = [{ 'Catalog ID': 'M1', 'Price Zone': 'EAST_MALAYSIA', Active: 'TRUE', 'Quote Approval Status': 'APPROVED', 'Monthly 5 Years (RM)': '340', 'Deposit (RM)': '500' }];
  const state = { 'Current Step': 'STEP_04_DOCUMENTS', 'Selected Product Brand': 'Yamaha', 'Selected Product Model': 'Y15ZR', 'Last AI Message': 'Harga tunai belum ada. Saya sudah masukkan permintaan untuk pengesahan cawangan.' };
  const timing = buildInstantSalesDecision({
    state, lead: { Region: 'EAST_MALAYSIA', 'City or Area': 'Bintulu' }, text: 'pastu berapa lama boleh tau', messageType: 'text', routeBusinessUnit: 'MOTOR', motorCatalog: catalog, motorPricing: pricing,
    aiIntent: { intent: 'FOLLOW_UP_TIME', language: 'MS', businessUnit: 'MOTOR', confidence: 0.98 }
  });
  assert.match(timing.text, /cawangan/i);
  assert.match(timing.text, /loan kedai/i);
  assert.equal(timing.product, undefined);
  assert.doesNotMatch(timing.text, /Dash 125/i);

  const repeated = buildInstantSalesDecision({
    state, lead: { Region: 'EAST_MALAYSIA', 'City or Area': 'Bintulu' }, text: 'Y15ZR', messageType: 'text', routeBusinessUnit: 'MOTOR', motorCatalog: catalog, motorPricing: pricing,
    aiIntent: { intent: 'MODEL_SELECTION', language: 'MS', businessUnit: 'MOTOR', catalogId: 'M1', confidence: 0.99 }
  });
  assert.equal(repeated.imageUrl, '');
  assert.match(repeated.text, /RM340/);
  assert.doesNotMatch(repeated.text, /IC depan|penyata EPF/i);
});

test('Loan Kedai processing time is answered from approved knowledge and never becomes cash-price confirmation', () => {
  const state = { 'Current Step': 'STEP_04_DOCUMENTS', 'Selected Product Brand': 'Yamaha', 'Selected Product Model': 'Y15 SE', 'Last AI Message': 'Harga tunai perlu pengesahan cawangan.' };
  for (const text of ['biasa process berapa lama', 'loan kedai berapa hari', 'berapa lama proses permohonan']) {
    const decision = buildInstantSalesDecision({
      state, lead: { Region: 'EAST_MALAYSIA', 'City or Area': 'Kuching' }, text, messageType: 'text', routeBusinessUnit: 'MOTOR',
      aiIntent: { intent: 'FOLLOW_UP_TIME', language: 'MS', businessUnit: 'MOTOR', confidence: 0.9 }
    });
    assert.equal(decision.loanKedaiIntent, true);
    assert.match(decision.text, /1[–-]3 hari bekerja/i);
    assert.match(decision.text, /loan kedai/i);
    assert.doesNotMatch(decision.text, /harga disahkan|maklum balas cawangan|harga tunai/i);
    assert.equal((decision.text.match(/\?/g) || []).length, 1);
  }
});

test('missing approved motor cash price creates a branch handover instead of guessing or repeating a model', () => {
  const decision = buildInstantSalesDecision({
    state: { 'Current Step': 'STEP_04_DOCUMENTS', 'Selected Product Brand': 'Yamaha', 'Selected Product Model': 'Y15ZR' },
    lead: { Region: 'EAST_MALAYSIA', 'City or Area': 'Bintulu' }, text: 'cash berapa', messageType: 'text', routeBusinessUnit: 'MOTOR',
    motorCatalog: [{ 'Catalog ID': 'M1', Brand: 'Yamaha', Model: 'Y15ZR', Active: 'TRUE' }],
    motorPricing: [{ 'Catalog ID': 'M1', 'Price Zone': 'EAST_MALAYSIA', Active: 'TRUE', 'Quote Approval Status': 'APPROVED', 'Monthly 5 Years (RM)': '340' }],
    aiIntent: { intent: 'CASH_PRICE', language: 'MS', businessUnit: 'MOTOR', confidence: 0.99 }
  });
  assert.equal(decision.humanFollowUpRequired, true);
  assert.match(decision.text, /pengesahan cawangan/i);
  assert.match(decision.text, /loan kedai/i);
  assert.doesNotMatch(decision.text, /RM\d+/i);
  assert.equal(decision.imageUrl, undefined);
});

test('other-model request suggests a small approved regional list and asks one question', () => {
  const decision = buildInstantSalesDecision({
    state: { 'Current Step': 'STEP_04_DOCUMENTS', 'Customer Name': 'Amin', 'Product Category': 'MOTOR' },
    lead: { 'Customer Name': 'Amin', Region: 'EAST_MALAYSIA', 'City or Area': 'Bintulu' },
    text: 'ada motor apa model lain?', messageType: 'text', routeBusinessUnit: 'MOTOR', routeRegion: 'EAST_MALAYSIA',
    motorCatalog: [
      { 'Catalog ID': 'M1', Brand: 'Yamaha', Model: 'NMAX', Active: 'TRUE' },
      { 'Catalog ID': 'M2', Brand: 'Yamaha', Model: 'Y16ZR', Active: 'TRUE' },
      { 'Catalog ID': 'M3', Brand: 'Honda', Model: 'RS150R', Active: 'TRUE' }
    ],
    motorPricing: [
      { 'Catalog ID': 'M1', 'Price Zone': 'EAST_MALAYSIA', Active: 'TRUE', 'Quote Approval Status': 'APPROVED', 'Monthly 5 Years (RM)': '365' },
      { 'Catalog ID': 'M2', 'Price Zone': 'EAST_MALAYSIA', Active: 'TRUE', 'Quote Approval Status': 'APPROVED', 'Monthly 5 Years (RM)': '327' },
      { 'Catalog ID': 'M3', 'Price Zone': 'EAST_MALAYSIA', Active: 'TRUE', 'Quote Approval Status': 'APPROVED', 'Monthly 5 Years (RM)': '299' }
    ]
  });
  assert.equal(decision.handled, true);
  assert.match(decision.text, /Yamaha NMAX/);
  assert.equal((decision.text.match(/\?/g) || []).length, 1);
});
