import crypto from 'node:crypto';
import { getAccessToken } from './_auth.js';

export const config = { api: { bodyParser: false } };

const SHEET_ID = process.env.JOMKAKI_SPREADSHEET_ID;
const clean = value => String(value ?? '').trim();
const digits = value => clean(value).replace(/\D/g, '').replace(/^0/, '60');
const makeId = prefix => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
const requiresManager = text => /(human|agent|manager|supervisor|real person|真人|人工|客服|经理|主管|pegawai|pengurus|ejen|orang sebenar)/i.test(clean(text));
const columnName = index => {
  let name = '';
  for (let value = index + 1; value; value = Math.floor((value - 1) / 26)) name = String.fromCharCode(65 + ((value - 1) % 26)) + name;
  return name;
};

async function rawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function readSheet(token, range) {
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}`, { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Unable to read ${range}`);
  return (await response.json()).values || [];
}

const objects = rows => {
  const [headers = [], ...values] = rows;
  return values.map((row, index) => ({ rowNumber: index + 2, ...Object.fromEntries(headers.map((header, column) => [header, row[column] ?? ''])) })).filter(row => Object.values(row).some(Boolean));
};

async function appendObject(token, sheet, object) {
  const [headers = []] = await readSheet(token, `${sheet}!1:1`);
  const values = headers.map(header => object[header] ?? '');
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(sheet + '!A:A')}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ values: [values] }) });
  if (!response.ok) throw new Error(`Unable to write ${sheet}`);
}

async function ensureHeaders(token, sheet, requiredHeaders) {
  const [headers = []] = await readSheet(token, `${sheet}!1:1`);
  const missing = requiredHeaders.filter(header => !headers.includes(header));
  if (!missing.length) return;
  const start = columnName(headers.length), end = columnName(headers.length + missing.length - 1);
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(`${sheet}!${start}1:${end}1`)}?valueInputOption=USER_ENTERED`, { method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ values: [missing] }) });
  if (!response.ok) throw new Error(`Unable to extend ${sheet} headers`);
}

async function updateObject(token, sheet, idHeader, id, changes, maxColumn = 'Z') {
  const rows = await readSheet(token, `${sheet}!A1:${maxColumn}2000`), headers = rows[0] || [], idIndex = headers.indexOf(idHeader);
  const rowIndex = rows.findIndex((row, index) => index > 0 && clean(row[idIndex]) === clean(id));
  if (rowIndex < 1) return;
  const data = Object.entries(changes).filter(([header]) => headers.includes(header)).map(([header, value]) => ({ range: `${sheet}!${columnName(headers.indexOf(header))}${rowIndex + 1}`, values: [[value ?? '']] }));
  if (!data.length) return;
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values:batchUpdate`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data }) });
  if (!response.ok) throw new Error(`Unable to update ${sheet}`);
}

const truth = value => clean(value).toUpperCase() === 'TRUE';
const canonicalRegion = value => ['SARAWAK', 'SABAH', 'LABUAN', 'EAST MALAYSIA', 'EAST_MALAYSIA'].includes(clean(value).toUpperCase()) ? 'EAST_MALAYSIA' : clean(value).toUpperCase();
const canonicalBusinessUnit = value => ['MOTOR', 'HANDPHONE'].includes(clean(value).toUpperCase()) ? clean(value).toUpperCase() : '';
const credentialPrefix = value => clean(value).toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
const normalizedWords = value => clean(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const customerAmount = value => clean(value).replace(/^RM\s*/i, '').replace(/,/g, '');

export function extractCustomerName(value = '') {
  let candidate = clean(value)
    .replace(/^(?:nama\s+saya|saya\s+bernama|my\s+name\s+is|i\s+am|i'm|call\s+me|saya|我叫|我是)\s*/i, '')
    .replace(/[?.!,;:]+$/g, '').trim();
  const normalized = normalizedWords(candidate);
  if (!candidate || candidate.length < 2 || candidate.length > 60) return '';
  if (/\d/.test(candidate) || candidate.split(/\s+/).length > 5) return '';
  if (/^(hi|hello|hey|hai|morning|afternoon|evening|yes|no|ok|okay|motor|moto|phone|iphone|handphone|yamaha|honda)$/i.test(normalized)) return '';
  if (!/^[\p{L}][\p{L}'’ -]*$/u.test(candidate)) return '';
  return candidate.replace(/\s+/g, ' ');
}

const stateAliases = [
  ['EAST_MALAYSIA', 'Sarawak', ['sarawak', 'kuching', 'batu kawa', 'satok', 'samarahan', 'kota samarahan', 'bintulu', 'miri', 'sibu', 'serian', 'sri aman']],
  ['EAST_MALAYSIA', 'Sabah', ['sabah', 'kota kinabalu', 'kk', 'sandakan', 'tawau', 'lahad datu']],
  ['EAST_MALAYSIA', 'Labuan', ['labuan']],
  ['WEST_MALAYSIA', 'Selangor', ['selangor', 'petaling jaya', 'pj', 'shah alam', 'klang', 'klang valley']],
  ['WEST_MALAYSIA', 'Kuala Lumpur', ['kuala lumpur', 'kl']],
  ['WEST_MALAYSIA', 'Negeri Sembilan', ['negeri sembilan', 'seremban', 'nilai']],
  ['WEST_MALAYSIA', 'Penang', ['penang', 'pulau pinang']],
  ['WEST_MALAYSIA', 'Johor', ['johor', 'johor bahru', 'jb']],
  ['WEST_MALAYSIA', 'Perak', ['perak', 'ipoh']],
  ['WEST_MALAYSIA', 'Melaka', ['melaka', 'malacca']],
  ['WEST_MALAYSIA', 'Kedah', ['kedah', 'alor setar']],
  ['WEST_MALAYSIA', 'Pahang', ['pahang', 'kuantan']],
  ['WEST_MALAYSIA', 'Kelantan', ['kelantan', 'kota bharu']],
  ['WEST_MALAYSIA', 'Terengganu', ['terengganu', 'kuala terengganu']],
  ['WEST_MALAYSIA', 'Perlis', ['perlis']],
  ['WEST_MALAYSIA', 'Putrajaya', ['putrajaya']]
];
const includesTerm = (text, term) => (` ${text} `).includes(` ${normalizedWords(term)} `);

export function resolveCustomerLocation(value = '', businessUnit = '', branches = []) {
  const text = normalizedWords(value), unit = canonicalBusinessUnit(businessUnit);
  if (!text || text.length > 100) return null;
  const stateMatch = stateAliases.find(([, , aliases]) => aliases.some(alias => includesTerm(text, alias)));
  if (!stateMatch) return null;
  const [region, state, aliases] = stateMatch;
  const area = aliases.filter(alias => includesTerm(text, alias)).sort((a, b) => b.length - a.length)[0] || clean(value);
  const active = branches.filter(branch => truth(branch.Active) && canonicalBusinessUnit(branch['Business Unit']) === unit);
  const directMatches = active.map(branch => {
    const terms = [branch['Branch Name'], branch.City, ...clean(branch['Direct Coverage Areas']).split('|')].filter(Boolean);
    const score = Math.max(0, ...terms.filter(term => includesTerm(text, term)).map(term => normalizedWords(term).length));
    return { branch, score };
  }).filter(match => match.score > 0).sort((a, b) => b.score - a.score);
  let selected = directMatches[0]?.branch || null;
  if (!selected) {
    const sameRegion = active.filter(branch => canonicalRegion(branch.Region) === region);
    if (sameRegion.length === 1) selected = sameRegion[0];
  }
  return {
    region,
    state,
    city: area.replace(/\b\w/g, letter => letter.toUpperCase()),
    branchId: clean(selected?.['Branch ID']),
    teamId: clean(selected?.['Team ID']),
    resolved: Boolean(selected)
  };
}

export function buildImmediateAcknowledgement(text = '', messageType = 'text') {
  if (!['text', 'button', 'interactive'].includes(clean(messageType).toLowerCase())) return '';
  const message = clean(text);
  if (/[一-鿿]/u.test(message)) return '您好，我们已收到您的信息，正在马上为您查询。请稍等一下，很快回复您。';
  if (/\b(hai|nak|mahu|boleh|harga|ansuran|motor|telefon|dokumen|pinjaman)\b/i.test(message)) return 'Hai, kami telah menerima mesej anda dan sedang menyemaknya sekarang. Sila tunggu sebentar, kami akan balas secepat mungkin.';
  return "Hi, we've received your message and are checking it now. Please give us a moment and we'll reply shortly.";
}

export function shouldSendImmediateAcknowledgement({ route = {}, routeUsable = false, human = false, messageType = 'text', previousInboundAt = '', receivedAt = '' } = {}) {
  // Customer-facing replies are created only by the qualification scenario.
  // A separate webhook acknowledgement caused two replies for one message and
  // made the conversation feel automated, so it remains disabled by design.
  void route;
  void routeUsable;
  void human;
  void messageType;
  void previousInboundAt;
  void receivedAt;
  return false;
}

export function buildInitialConversationState({ lead = {}, application = {}, route = {}, phone = '', text = '', messageId = '', receivedAt = '', numberId = '', displayNumber = '', entryId = '', channelId = '', businessUnit = '', teamId = '' } = {}) {
  return {
    'State ID': makeId('STATE'),
    'Lead ID': clean(lead['Lead ID']),
    'Application ID': clean(application['Application ID']),
    'Phone Number': digits(phone),
    'Current Step': 'STEP_01_WELCOME',
    'Qualification Status': 'IN_PROGRESS',
    'Customer Name': clean(lead['Customer Name']),
    'Product Category': clean(businessUnit),
    'Selected Branch ID': clean(lead['Selected Branch ID']),
    'Last Customer Message': clean(text),
    'Last Message ID': clean(messageId),
    'Last Customer Reply At': clean(receivedAt),
    'Follow Up Attempts': '0',
    'Escalation Required': 'FALSE',
    'Updated At': clean(receivedAt) || new Date().toISOString(),
    'Internal Channel ID': clean(channelId),
    'WhatsApp Number ID': clean(numberId),
    'WABA ID': clean(route['WABA ID'] || entryId),
    'WhatsApp Display Number': clean(displayNumber || route['Display Number']),
    'Channel Binding Status': clean(channelId) ? 'BOUND' : 'UNBOUND',
    'Business Unit': clean(businessUnit),
    'Customer ID': clean(lead['Customer ID']),
    'Team ID': clean(teamId)
  };
}

const instantLanguage = text => {
  const value = clean(text);
  if (/[\u3400-\u9fff]/u.test(value)) return 'ZH';
  if (/\b(hai|saya|nak|mahu|boleh|cari|motor|telefon|harga|ansuran|pinjaman|dokumen|dari)\b/i.test(value)) return 'MS';
  if (/\b(i|i'm|my|we|our|looking|want|need|interested|how|what|where|which|monthly|payment|price|apply)\b/i.test(value)) return 'EN';
  return 'MS';
};

const instantCopy = (language, key, values = {}) => {
  const name = clean(values.name), location = clean(values.location), brand = clean(values.brand), model = clean(values.model);
  const amount = customerAmount(values.amount), tenure = clean(values.tenure), options = clean(values.options);
  const copies = {
    EN: {
      NAME: 'Hi, welcome to JomKaki Motor. May I know your name?',
      NAME_RETRY: 'May I know the name I should use for you?',
      LOCATION: `Nice to meet you${name ? `, ${name}` : ''}. Which city or state are you from?`,
      LOCATION_RETRY: 'Which city or state are you currently staying in?',
      PRODUCT: `Thank you${location ? `, noted ${location}` : ''}. Are you looking for a motorcycle or phone? You can tell me the model directly.`,
      MODEL: 'Which motorcycle or phone model are you interested in? You can send me the model name directly.',
      MODEL_CLARIFY: `Do you mean ${options}? Choose one so I can send the correct photo and monthly instalment.`,
      DOCUMENT: 'Received. I will check this document. You may continue sending the remaining documents here one by one.',
      QUOTE: `For ${brand} ${model}, the ${tenure} instalment is RM${amount} per month, subject to branch confirmation. For a shop-loan check, we need the front and back of your MyKad plus your latest payslip or EPF statement. If this suits you, you can send them here one by one.`
    },
    MS: {
      NAME: 'Hai, selamat datang ke JomKaki Motor. Boleh saya tahu nama anda?',
      NAME_RETRY: 'Boleh saya tahu nama yang patut saya gunakan untuk anda?',
      LOCATION: `Salam kenal${name ? `, ${name}` : ''}. Anda tinggal di bandar atau negeri mana?`,
      LOCATION_RETRY: 'Boleh beritahu anda sekarang tinggal di bandar atau negeri mana?',
      PRODUCT: `Terima kasih${location ? `, lokasi ${location} sudah dicatat` : ''}. Anda sedang cari motor atau telefon? Boleh terus beritahu model yang anda mahu.`,
      MODEL: 'Model motor atau telefon yang mana anda minat? Boleh terus hantar nama model kepada saya.',
      MODEL_CLARIFY: `Maksud anda ${options}? Pilih satu ya supaya saya boleh hantar gambar dan ansuran bulanan yang betul.`,
      DOCUMENT: 'Dokumen sudah diterima. Saya akan semak dahulu. Anda boleh terus hantar dokumen lain satu per satu di sini.',
      QUOTE: `Untuk ${brand} ${model}, ansuran ${tenure} ialah RM${amount} sebulan, tertakluk kepada pengesahan cawangan. Untuk semakan loan kedai, kami perlukan IC depan dan belakang serta slip gaji terkini atau penyata EPF. Kalau sesuai, boleh hantar satu per satu di sini.`
    },
    ZH: {
      NAME: '你好，欢迎联系 JomKaki Motor。请问我应该怎么称呼你？',
      NAME_RETRY: '请问可以告诉我你的名字吗？',
      LOCATION: `很高兴认识你${name ? `，${name}` : ''}。请问你目前住在哪个城市或州属？`,
      LOCATION_RETRY: '请问你目前住在哪个城市或州属？',
      PRODUCT: `谢谢${location ? `，已记录你在 ${location}` : ''}。你想找摩托还是手机？可以直接告诉我型号。`,
      MODEL: '你对哪一款摩托或手机有兴趣？可以直接把型号发给我。',
      MODEL_CLARIFY: `请问你是指 ${options}？请选择一个，我才能发送正确的照片和月供。`,
      DOCUMENT: '文件已经收到，我会先检查。其余文件可以继续在这里逐份发送。',
      QUOTE: `${brand} ${model} 的 ${tenure} 月供是每月 RM${amount}，最终以分行确认为准。申请店内贷款需要 MyKad 正反面，以及最新薪水单或 EPF 记录。如果这个方案适合你，可以在这里逐份发送文件。`
    }
  };
  return copies[language]?.[key] || copies.EN[key] || '';
};

const productUnitFromText = (text, fallback = '') => /\b(iphone|phone|handphone|telefon|smartphone)\b/i.test(clean(text)) ? 'HANDPHONE' : /\b(motor|moto|motorcycle|yamaha|honda|sym|moda)\b/i.test(clean(text)) ? 'MOTOR' : canonicalBusinessUnit(fallback);

const modelAliasStopWords = new Set(['apple', 'iphone', 'phone', 'handphone', 'telefon', 'motor', 'model', 'official', 'standard', 'baru', 'new', 'pro', 'max', 'silver', 'black', 'white', 'blue', 'orange', 'gold', 'green', 'red', 'grey', 'gray']);
const compactModelText = value => normalizedWords(value).replace(/\s+/g, '');
const oneEditAway = (left, right) => {
  if (Math.abs(left.length - right.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) { i += 1; j += 1; continue; }
    if (++edits > 1) return false;
    if (left.length > right.length) i += 1;
    else if (right.length > left.length) j += 1;
    else { i += 1; j += 1; }
  }
  return edits + Number(i < left.length || j < right.length) <= 1;
};

const productAliases = row => {
  const model = normalizedWords(row.Model), brand = normalizedWords(row.Brand), words = model.split(' ').filter(Boolean);
  const aliases = new Set([model, `${brand} ${model}`.trim()]);
  for (let start = 0; start < words.length; start += 1) {
    for (let end = start + 1; end <= words.length; end += 1) {
      const phrase = words.slice(start, end).join(' ');
      if (compactModelText(phrase).length >= 3) aliases.add(phrase);
    }
    const shorthand = words.slice(start).map(word => /^\d/.test(word) ? word : word[0]).join('');
    if (shorthand.length >= 3) aliases.add(shorthand);
  }
  for (const word of normalizedWords(row['Search Keywords']).split(' ')) {
    if ((word.length >= 3 || /^\d{2,}$/.test(word)) && !modelAliasStopWords.has(word)) aliases.add(word);
  }
  for (const word of words) {
    const match = word.match(/^([a-z]{2,})(\d{2,})([a-z]*)$/i);
    if (match) {
      aliases.add(match[1]);
      aliases.add(match[2]);
    }
  }
  return [...aliases].filter(alias => compactModelText(alias).length >= 2);
};

export function matchInstantProduct(text, catalogs = []) {
  const query = normalizedWords(text), compactQuery = compactModelText(text);
  if (!query || !compactQuery) return { product: null, options: [], ambiguous: false };
  const matches = catalogs.filter(row => truth(row.Active)).map(row => {
    const model = normalizedWords(row.Model), compactModel = compactModelText(row.Model);
    let score = 0;
    if (query === model) score = 2400;
    else if (compactQuery === compactModel) score = 2300;
    else if (model && includesTerm(query, model)) score = 2200;
    else if (compactModel.length >= 4 && compactQuery.includes(compactModel)) score = 2100;
    for (const alias of productAliases(row)) {
      const compactAlias = compactModelText(alias);
      if (query === alias || compactQuery === compactAlias) score = Math.max(score, 1600 + compactAlias.length);
      else if (alias.length >= 3 && includesTerm(query, alias)) score = Math.max(score, 1400 + compactAlias.length);
      else if (compactAlias.length >= 3 && compactQuery.includes(compactAlias)) score = Math.max(score, 1200 + compactAlias.length);
      else if (compactQuery.length >= 4 && compactAlias.length >= 4 && oneEditAway(compactQuery, compactAlias)) score = Math.max(score, 1000 + compactAlias.length);
    }
    return { row, score, modelKey: normalizedWords(row.Model) };
  }).filter(match => match.score >= 1000);
  const bestByModel = new Map();
  for (const match of matches) if (!bestByModel.has(match.modelKey) || bestByModel.get(match.modelKey).score < match.score) bestByModel.set(match.modelKey, match);
  const ranked = [...bestByModel.values()].sort((a, b) => b.score - a.score || clean(a.row.Model).localeCompare(clean(b.row.Model)));
  if (!ranked.length) return { product: null, options: [], ambiguous: false };
  const close = ranked.filter(match => match.score >= ranked[0].score - 80);
  if (close.length > 1) {
    const options = close.slice(0, 4).map(match => `${clean(match.row.Brand)} ${clean(match.row.Model)}`.trim());
    return { product: null, options, ambiguous: true };
  }
  return { product: ranked[0].row, options: [], ambiguous: false };
}

const instantRate = (product, pricingRows = [], unit = '', region = '') => {
  if (!product) return null;
  const normalizedRegion = canonicalRegion(region);
  const candidates = pricingRows.filter(row => clean(row['Catalog ID']) === clean(product['Catalog ID']) && truth(row.Active) && ['APPROVED', ''].includes(clean(row['Quote Approval Status']).toUpperCase()));
  const ranked = candidates.sort((a, b) => {
    const zone = row => clean(row['Price Zone']).toUpperCase();
    const score = row => canonicalRegion(zone(row)) === normalizedRegion ? 3 : zone(row) === 'ALL_BRANCHES' || zone(row) === 'ALL' ? 2 : 1;
    return score(b) - score(a);
  });
  const row = ranked[0];
  if (!row) return null;
  const rates = canonicalBusinessUnit(unit) === 'HANDPHONE'
    ? [['60 months', row['Monthly 60 Months (RM)']], ['48 months', row['Monthly 48 Months (RM)']], ['36 months', row['Monthly 36 Months (RM)']], ['24 months', row['Monthly 24 Months (RM)']], ['12 months', row['Monthly 12 Months (RM)']]]
    : [['5 years', row['Monthly 5 Years (RM)']], ['4 years', r…1123 tokens truncated…antChannelCredentials(route);
  const imageUrl = clean(decision.imageUrl);
  const payload = imageUrl
    ? { messaging_product: 'whatsapp', recipient_type: 'individual', to: digits(phone), type: 'image', image: { link: imageUrl, caption: clean(decision.text).slice(0, 1024) } }
    : { messaging_product: 'whatsapp', recipient_type: 'individual', to: digits(phone), type: 'text', text: { preview_url: false, body: clean(decision.text) } };
  const response = await fetch(`https://graph.facebook.com/${binding.version}/${binding.phoneNumberId}/messages`, {
    method: 'POST',
    headers: { authorization: `Bearer ${binding.accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const result = await response.json().catch(() => ({}));
  return {
    sent: response.ok,
    binding,
    providerMessageId: clean(result.messages?.[0]?.id),
    error: response.ok ? '' : clean(result.error?.message) || `Meta API error ${response.status}`,
    messageType: imageUrl
      ? (decision.productUnit === 'HANDPHONE' ? 'HANDPHONE_IMAGE' : 'MOTOR_IMAGE')
      : 'TEXT'
  };
}

async function sendImmediateAcknowledgement(token, { route, phone, text, messageType, messageId, lead, application, receivedAt, businessUnit, teamId }) {
  if (clean(process.env.WHATSAPP_SEND_MODE).toUpperCase() !== 'CLOUD') return { sent: false, skipped: 'CLOUD_MODE_DISABLED' };
  const acknowledgement = buildImmediateAcknowledgement(text, messageType);
  if (!acknowledgement) return { sent: false, skipped: 'UNSUPPORTED_MESSAGE_TYPE' };
  const binding = instantChannelCredentials(route);
  const outboxId = makeId('OUT'), timestamp = new Date().toISOString();
  const response = await fetch(`https://graph.facebook.com/${binding.version}/${binding.phoneNumberId}/messages`, {
    method: 'POST',
    headers: { authorization: `Bearer ${binding.accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: digits(phone), type: 'text', text: { preview_url: false, body: acknowledgement } })
  });
  const result = await response.json().catch(() => ({}));
  const providerMessageId = clean(result.messages?.[0]?.id);
  const errorMessage = response.ok ? '' : clean(result.error?.message) || `Meta API error ${response.status}`;
  await appendObject(token, 'Message_Outbox', {
    'Outbox ID': outboxId, 'Created At': timestamp, 'Lead ID': lead['Lead ID'] || '', 'Application ID': application['Application ID'] || '',
    'Phone Number': digits(phone), 'Message Type': 'TEXT', 'Message Text': acknowledgement, 'Send Status': response.ok ? 'SENT' : 'FAILED',
    'Attempt Count': '1', 'Sent At': response.ok ? timestamp : '', 'Provider Message ID': providerMessageId, 'Error Message': errorMessage,
    'WhatsApp Number ID': binding.phoneNumberId, 'WABA ID': route['WABA ID'] || '', 'Internal Channel ID': binding.channelId,
    'Make Connection Alias': route['Make Connection Alias'] || '', 'Reply To Message ID': messageId || '',
    'Send Routing Status': `${response.ok ? 'WEBHOOK_IMMEDIATE_ACK' : 'WEBHOOK_IMMEDIATE_ACK_FAILED'}:${binding.channelId}`,
    'Business Unit': businessUnit, 'Customer ID': lead['Customer ID'] || '', 'Team ID': teamId
  });
  if (response.ok) await updateObject(token, 'WhatsApp_Number_Master', 'Internal Channel ID', binding.channelId, { 'Last Outbound At': timestamp, 'Updated At': timestamp }, 'AC');
  return { sent: response.ok, outboxId, providerMessageId, error: errorMessage, receivedAt };
}

async function updateOutboxStatus(token, providerId, status, errorMessage = '') {
  const rows = await readSheet(token, 'Message_Outbox!A1:Z1500');
  const headers = rows[0] || [], providerIndex = headers.indexOf('Provider Message ID');
  const rowIndex = rows.findIndex((row, index) => index > 0 && clean(row[providerIndex]) === clean(providerId));
  if (rowIndex < 1) return;
  const normalizedStatus = clean(status).toUpperCase(), timestamp = new Date().toISOString();
  const changes = { 'Send Status': normalizedStatus, 'Error Message': errorMessage };
  if (normalizedStatus === 'SENT') changes['Sent At'] = timestamp;
  if (normalizedStatus === 'DELIVERED') changes['Delivered At'] = timestamp;
  if (normalizedStatus === 'READ') changes['Read At'] = timestamp;
  const data = Object.entries(changes).filter(([header]) => headers.includes(header)).map(([header, value]) => ({ range: `Message_Outbox!${columnName(headers.indexOf(header))}${rowIndex + 1}`, values: [[value]] }));
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values:batchUpdate`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data }) });
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET') {
    if (clean(req.query['hub.mode']) === 'subscribe' && clean(req.query['hub.verify_token']) === clean(process.env.WHATSAPP_VERIFY_TOKEN)) return res.status(200).send(clean(req.query['hub.challenge']));
    return res.status(403).send('Verification failed');
  }
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  const raw = await rawBody(req), signature = clean(req.headers['x-hub-signature-256']), secret = clean(process.env.META_APP_SECRET);
  if (!secret || !signature) return res.status(401).json({ ok: false });
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`;
  const supplied = Buffer.from(signature), calculated = Buffer.from(expected);
  if (supplied.length !== calculated.length || !crypto.timingSafeEqual(supplied, calculated)) return res.status(401).json({ ok: false });
  try {
    const payload = JSON.parse(raw.toString('utf8') || '{}'), token = await getAccessToken(req);
    if (!token) throw new Error('Google authorization unavailable');
    const [leadRows, applicationRows, routeRows, branchRows, stateRows, inboxRows, motorCatalogRows, motorPricingRows, handphoneCatalogRows, handphonePricingRows] = await Promise.all([
      readSheet(token, 'Leads!A1:AP1000'),
      readSheet(token, 'Applications!A1:CC1000'),
      readSheet(token, 'WhatsApp_Number_Master!A1:AC1000'),
      readSheet(token, 'Branch_Master!A1:S1000'),
      readSheet(token, 'Conversation_State!A1:AK2000'),
      readSheet(token, 'Customer_Inbox!A1:AC1200'),
      readSheet(token, 'Motor_Model_Catalog!A1:Q1000'),
      readSheet(token, 'Motor_Loan_Pricing!A1:Z1000'),
      readSheet(token, 'Handphone_Model_Catalog!A1:AB1000'),
      readSheet(token, 'Handphone_Loan_Pricing!A1:AO1000')
    ]);
    const leads = objects(leadRows);
    const applications = objects(applicationRows);
    const routes = objects(routeRows);
    const branches = objects(branchRows);
    const conversationStates = objects(stateRows);
    const motorCatalog = objects(motorCatalogRows), motorPricing = objects(motorPricingRows);
    const handphoneCatalog = objects(handphoneCatalogRows), handphonePricing = objects(handphonePricingRows);
    const existingMessageIds = new Set(objects(inboxRows).map(row => clean(row['Message ID'])).filter(Boolean));
    for (const entry of payload.entry || []) for (const change of entry.changes || []) {
      const value = change.value || {}, numberId = value.metadata?.phone_number_id || '', displayNumber = value.metadata?.display_phone_number || '';
      for (const message of value.messages || []) {
        if (message.id && existingMessageIds.has(clean(message.id))) continue;
        const phone = digits(message.from), text = message.text?.body || message.button?.text || message.interactive?.button_reply?.title || message.interactive?.list_reply?.title || `[${message.type || 'message'}]`;
        const contact = (value.contacts || []).find(item => digits(item.wa_id) === phone) || (value.contacts || [])[0] || {};
        const profileName = extractCustomerName(contact.profile?.name);
        const route = routes.find(row => clean(row['Phone Number ID']) === clean(numberId)) || {};
        const channelId = clean(route['Internal Channel ID']), branchId = clean(route['Branch ID']);
        const branch = branches.find(row => clean(row['Branch ID']) === branchId) || {};
        const routeRegion = canonicalRegion(route.Region || branch.Region) || 'UNASSIGNED';
        const routeBusinessUnit = canonicalBusinessUnit(route['Business Unit']) || 'UNASSIGNED';
        let teamId = clean(route['Team ID'] || branch['Team ID']);
        const receivedAt = new Date(Number(message.timestamp || Date.now() / 1000) * 1000).toISOString();
        const routeUsable = !!channelId && routeBusinessUnit !== 'UNASSIGNED' && truth(route.Active) && truth(route['Inbound Enabled']);
        let lead = leads.find(row => digits(row['Phone Number']) === phone && clean(row['Business Unit']).toUpperCase() === routeBusinessUnit);
        const previousInboundAt = clean(lead?.['Last Inbound At']);
        let conversationState = lead ? conversationStates.find(row => clean(row['Lead ID']) === clean(lead['Lead ID'])) : null;
        const human = requiresManager(text);
        const instantDecision = buildInstantSalesDecision({
          state: conversationState || {}, lead: lead || {}, text, messageType: message.type || 'text', routeBusinessUnit, routeRegion, branches,
          motorCatalog, motorPricing, handphoneCatalog, handphonePricing
        });
        let instantResult = { sent: false };
        if (routeUsable && !human && instantDecision.handled) instantResult = await sendInstantSalesMessage({ route, phone, decision: instantDecision });
        if (!lead) {
          const timestamp = new Date().toISOString();
          const existingCustomer = leads.find(row => digits(row['Phone Number']) === phone), customerId = clean(existingCustomer?.['Customer ID']) || makeId('CUS');
          lead = { 'Lead ID': makeId('LEAD'), 'Customer ID': customerId, 'Customer Name': existingCustomer?.['Customer Name'] || profileName || `WhatsApp Customer ${phone.slice(-4)}`, 'Phone Number': phone, 'Normalized Phone': phone, Region: routeRegion, 'Business Unit': routeBusinessUnit, 'Team ID': teamId, 'Selected Branch ID': branchId, 'Assigned SA ID': '' };
          await ensureHeaders(token, 'Leads', ['Lead Source', 'Created By', 'Updated By']);
          await appendObject(token, 'Leads', { ...lead, 'Created At': timestamp, 'Updated At': timestamp, 'Lead Status': 'NEW', 'Processing Mode': 'AI_MANAGED', 'Lead Source': 'WHATSAPP_CLOUD', 'Source Channel': 'WHATSAPP_CLOUD', 'Primary WhatsApp Channel ID': channelId, 'Last Inbound WhatsApp Channel ID': channelId, 'Last Inbound WhatsApp Number ID': numberId, 'Last Inbound At': receivedAt, Notes: 'AI-managed Lead; Staff remains unassigned unless document collection or follow-up fails', 'Created By': 'META_WEBHOOK', 'Updated By': 'META_WEBHOOK' });
          leads.push(lead);
        } else {
          await ensureHeaders(token, 'Leads', ['Lead Source', 'Created By', 'Updated By']);
          await updateObject(token, 'Leads', 'Lead ID', lead['Lead ID'], { 'Last Inbound WhatsApp Channel ID': channelId, 'Last Inbound WhatsApp Number ID': numberId, 'Last Inbound At': receivedAt, 'Last Customer Reply At': receivedAt, 'Updated At': receivedAt, 'Updated By': 'META_WEBHOOK', 'Business Unit': routeBusinessUnit, 'Team ID': teamId }, 'AP');
        }
        const application = applications.filter(row => row['Lead ID'] && row['Lead ID'] === lead['Lead ID']).at(-1) || {};
        conversationState = conversationState || conversationStates.find(row => clean(row['Lead ID']) === clean(lead['Lead ID']));
        if (!conversationState) {
          conversationState = buildInitialConversationState({ lead, application, route, phone, text, messageId: message.id, receivedAt, numberId, displayNumber, entryId: entry.id, channelId, businessUnit: routeBusinessUnit, teamId });
          if (instantResult.sent) {
            conversationState['Current Step'] = instantDecision.nextStep || conversationState['Current Step'];
            conversationState['Last AI Reply'] = clean(instantDecision.text);
            conversationState['Last AI Reply At'] = new Date().toISOString();
            conversationState['Product Category'] = clean(instantDecision.productUnit || routeBusinessUnit);
          }
          await appendObject(token, 'Conversation_State', conversationState);
          conversationStates.push(conversationState);
        } else {
          const identityState = {};
          const leadIdentity = {};
          const step = clean(conversationState['Current Step']).toUpperCase();
          if (step === 'STEP_01_NAME') {
            const customerName = extractCustomerName(text);
            if (customerName) {
              identityState['Customer Name'] = customerName;
              leadIdentity['Customer Name'] = customerName;
            }
          }
          if (step === 'STEP_02_LOCATION') {
            const location = resolveCustomerLocation(text, routeBusinessUnit, branches);
            if (location) {
              leadIdentity.Region = location.region;
              leadIdentity.State = location.state;
              leadIdentity['City or Area'] = location.city;
              if (location.branchId) {
                leadIdentity['Selected Branch ID'] = location.branchId;
                identityState['Selected Branch ID'] = location.branchId;
              }
              if (location.teamId) {
                teamId = location.teamId;
                leadIdentity['Team ID'] = location.teamId;
                identityState['Team ID'] = location.teamId;
              }
            }
          }
          if (Object.keys(leadIdentity).length) {
            leadIdentity['Updated At'] = receivedAt;
            leadIdentity['Updated By'] = 'META_WEBHOOK_SALES_FLOW';
            await updateObject(token, 'Leads', 'Lead ID', lead['Lead ID'], leadIdentity, 'AP');
            Object.assign(lead, leadIdentity);
          }
          const latestInbound = {
            'Last Customer Message': clean(text),
            'Last Message ID': clean(message.id),
            'Last Customer Reply At': clean(receivedAt),
            'Updated At': clean(receivedAt) || new Date().toISOString(),
            'Internal Channel ID': clean(channelId),
            'WhatsApp Number ID': clean(numberId),
            'WABA ID': clean(route['WABA ID'] || entry.id),
            'WhatsApp Display Number': clean(displayNumber || route['Display Number']),
            'Channel Binding Status': clean(channelId) ? 'BOUND' : 'UNBOUND',
            'Business Unit': clean(routeBusinessUnit),
            'Customer ID': clean(lead['Customer ID']),
            'Team ID': clean(teamId),
            ...(instantResult.sent ? {
              'Current Step': clean(instantDecision.nextStep || conversationState['Current Step']),
              'Last AI Reply': clean(instantDecision.text),
              'Last AI Reply At': new Date().toISOString(),
              'Product Category': clean(instantDecision.productUnit || conversationState['Product Category'] || routeBusinessUnit)
            } : {}),
            ...identityState
          };
          await updateObject(token, 'Conversation_State', 'State ID', conversationState['State ID'], latestInbound, 'AK');
          Object.assign(conversationState, latestInbound);
        }
        const routingStatus = !channelId ? 'UNREGISTERED_CHANNEL' : !routeUsable ? 'CHANNEL_DISABLED_ADMIN_REVIEW' : routeRegion === 'UNASSIGNED' ? 'ADMIN_REVIEW_REQUIRED' : 'MATCHED';
        await appendObject(token, 'Customer_Inbox', { 'Received At': receivedAt, 'Phone Number': phone, 'Customer Message': text, 'Attachment Type': ['image', 'document'].includes(message.type) ? message.type : '', 'Message ID': message.id || makeId('MSG'), Channel: 'WHATSAPP', Source: 'META_CLOUD', 'Lead ID': lead['Lead ID'] || '', 'Application ID': application['Application ID'] || '', 'Message Type': message.type || 'text', 'Process Status': !routeUsable || routeRegion === 'UNASSIGNED' ? 'HUMAN_HANDOVER_REQUIRED' : human ? 'HUMAN_HANDOVER_REQUIRED' : instantResult.sent ? 'AI_REPLIED_INSTANTLY' : 'NEW', 'AI Processed': instantResult.sent ? 'TRUE' : 'FALSE', 'Webhook ID': makeId('WEBHOOK'), 'WhatsApp Number ID': numberId, 'WhatsApp Display Number': displayNumber || route['Display Number'], 'WABA ID': route['WABA ID'] || entry.id || '', 'Conversation Key': `${channelId || numberId || 'UNROUTED'}:${phone}`, 'Webhook Source': 'META_CLOUD', 'Number Routing Status': routingStatus, 'Internal Channel ID': channelId, 'Business Unit': clean(instantDecision.productUnit || routeBusinessUnit), 'Customer ID': lead['Customer ID'] || '', 'Team ID': teamId });
        if (instantResult.sent || instantResult.error) {
          const timestamp = new Date().toISOString();
          const imageOutboxPrefix = instantDecision.productUnit === 'HANDPHONE' ? 'JKM-HP-IMG' : 'JKM-S03C-IMG';
          const outboxId = instantDecision.imageUrl && message.id ? `${imageOutboxPrefix}-${message.id}` : makeId('OUT');
          await appendObject(token, 'Message_Outbox', {
            'Outbox ID': outboxId, 'Created At': timestamp, 'Lead ID': lead['Lead ID'] || '', 'Application ID': application['Application ID'] || '',
            'Phone Number': phone, 'Message Type': instantResult.messageType || 'TEXT', 'Message Text': clean(instantDecision.text), 'Image URL': clean(instantDecision.imageUrl),
            'Image Caption': clean(instantDecision.text), 'Send Status': instantResult.sent ? 'SENT' : 'FAILED', 'Attempt Count': '1', 'Sent At': instantResult.sent ? timestamp : '',
            'Provider Message ID': instantResult.providerMessageId || '', 'Error Message': instantResult.error || '', 'WhatsApp Number ID': numberId,
            'WABA ID': route['WABA ID'] || entry.id || '', 'Internal Channel ID': channelId, 'Make Connection Alias': route['Make Connection Alias'] || '',
            'Reply To Message ID': message.id || '', 'Send Routing Status': `${instantResult.sent ? 'WEBHOOK_INSTANT_SALES' : 'WEBHOOK_INSTANT_SALES_FAILED'}:${channelId}`,
            'Business Unit': clean(instantDecision.productUnit || routeBusinessUnit), 'Customer ID': lead['Customer ID'] || '', 'Team ID': teamId
          });
        }
        if (channelId) await updateObject(token, 'WhatsApp_Number_Master', 'Internal Channel ID', channelId, { 'Last Inbound At': receivedAt, 'Last Verified At': receivedAt, 'Updated At': receivedAt }, 'AC');
        const media = message.document || message.image;
        if (media?.id) {
          await ensureHeaders(token, 'Document_Log', ['Uploaded By', 'Reviewed By', 'Reviewed At']);
          await appendObject(token, 'Document_Log', {
          'Document ID': makeId('DOC'), 'Application ID': application['Application ID'] || '', 'Lead ID': lead['Lead ID'] || '',
          'Received At': new Date(Number(message.timestamp || Date.now() / 1000) * 1000).toISOString(), 'Message ID': message.id || '',
          'Document Type': 'UNCLASSIFIED', 'Media ID': media.id, 'Mime Type': media.mime_type || '', 'File Name': message.document?.filename || '',
          'Classification Status': 'AI_QUEUED', 'Quality Status': 'PENDING_AI', 'Verification Status': 'PENDING_AI', 'Duplicate Status': 'NOT_CHECKED',
          'Manual Review Required': 'FALSE', Remarks: 'Received from WhatsApp and queued for automatic AI validation', 'Updated At': new Date().toISOString(), 'Uploaded By': 'META_WEBHOOK', 'Business Unit': routeBusinessUnit, 'Customer ID': lead['Customer ID'] || ''
          });
        }
        if (message.id) existingMessageIds.add(clean(message.id));
      }
      for (const status of value.statuses || []) await updateOutboxStatus(token, status.id, status.status, status.errors?.[0]?.title || '');
    }
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ ok: false });
  }
}

