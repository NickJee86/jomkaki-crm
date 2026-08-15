import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildImmediateAcknowledgement, buildInitialConversationState, buildInstantSalesDecision, extractCustomerName, instantChannelCredentials, matchInstantProduct, resolveCustomerLocation, shouldSendImmediateAcknowledgement } from '../api/whatsapp-webhook.js';

const source = fs.readFileSync(new URL('../api/whatsapp-webhook.js', import.meta.url), 'utf8');
const route = {
  'Internal Channel ID': 'JKM-WA-WEST-01',
  'Phone Number ID': 'W-100',
  'Credential Key': 'WHATSAPP_WEST_01',
  'Outbound Enabled': 'TRUE'
};

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
  assert.doesNotMatch(welcome.text, /age|\bAI\b/i);

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

test('short or ambiguous customer messages default to Bahasa Melayu', () => {
  const greeting = buildInstantSalesDecision({ state: { 'Current Step': 'STEP_01_WELCOME' }, text: 'Hi', messageType: 'text' });
  const name = buildInstantSalesDecision({ state: { 'Current Step': 'STEP_01_NAME' }, text: 'Jim', messageType: 'text' });
  assert.match(greeting.text, /selamat datang|nama anda/i);
  assert.match(name.text, /bandar|negeri/i);
  assert.doesNotMatch(greeting.text, /May I know/i);
});

test('instant product reply sends approved image and only one monthly instalment', () => {
  const decision = buildInstantSalesDecision({
    state: { 'Current Step': 'STEP_03_PRODUCT', 'Product Category': 'MOTOR' },
    lead: { Region: 'WEST_MALAYSIA' }, text: 'I am looking for Yamaha Y16ZR', messageType: 'text', routeBusinessUnit: 'MOTOR', routeRegion: 'WEST_MALAYSIA',
    motorCatalog: [{ 'Catalog ID': 'MTR-YAM-Y16ZR', Brand: 'Yamaha', Model: 'Y16ZR', Active: 'TRUE', 'Image Approved': 'TRUE', 'Image URL': 'https://cdn.example.test/y16zr.jpg' }],
    motorPricing: [{ 'Catalog ID': 'MTR-YAM-Y16ZR', 'Price Zone': 'WEST_MALAYSIA', Active: 'TRUE', 'Quote Approval Status': 'APPROVED', 'Monthly 3 Years (RM)': '394', 'Monthly 4 Years (RM)': '318', 'Monthly 5 Years (RM)': '273', 'Selling Price (RM)': '12000', 'Deposit (RM)': '1000' }]
  });
  assert.equal(decision.nextStep, 'STEP_04_DOCUMENTS');
  assert.equal(decision.imageUrl, 'https://cdn.example.test/y16zr.jpg');
  assert.match(decision.text, /RM273/);
  assert.doesNotMatch(decision.text, /394|318|deposit|selling price/i);
  assert.match(decision.text, /MyKad|payslip|EPF/i);
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
    lead: { 'Customer Name': 'Kamis', Region: 'EAST_MALAYSIA' },
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
    lead: { 'Customer Name': 'Kamis', Region: 'EAST_MALAYSIA' }, text: 'nak nmax', messageType: 'text', routeBusinessUnit: 'MOTOR',
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

