export const JOMKAKI_KNOWLEDGE = Object.freeze({
  id: 'JOMKAKI-KB',
  version: '2026-08-18.4',
  source: 'https://app.notion.com/p/7754a9dcd852468e8bd4906d11f016e5',
  status: 'APPROVED',
  conversation: Object.freeze({
    defaultLanguage: 'MS',
    targetReplySeconds: 5,
    discloseAutomation: false,
    maximumQuestionsPerReply: 1,
    emojiPolicy: 'ONLY_WHEN_NATURAL',
    answerCustomerIntentBeforeProfileQuestions: true,
    profileCollectionIsNonBlocking: true,
    firstQuestions: Object.freeze(['CUSTOMER_NAME', 'CUSTOMER_LOCATION', 'PRODUCT_AND_MODEL']),
    aiFallback: Object.freeze({
      enabled: true,
      model: 'gpt-5.6-terra',
      reasoningEffort: 'low',
      timeoutMs: 3200,
      maximumCharacters: 420,
      noSilenceFallback: true
    })
  }),
  pricing: Object.freeze({
    exposeCashPrice: false,
    exposeMotorCashPrice: true,
    exposeHandphoneCashPrice: false,
    exposeMotorDeposit: true,
    exposeHandphoneDeposit: false,
    motorMonthlyFields: Object.freeze([
      ['5 years', 'Monthly 5 Years (RM)'],
      ['4 years', 'Monthly 4 Years (RM)'],
      ['3 years', 'Monthly 3 Years (RM)']
    ]),
    handphoneMonthlyFields: Object.freeze([
      ['60 months', 'Monthly 60 Months (RM)'],
      ['48 months', 'Monthly 48 Months (RM)'],
      ['36 months', 'Monthly 36 Months (RM)'],
      ['24 months', 'Monthly 24 Months (RM)'],
      ['12 months', 'Monthly 12 Months (RM)']
    ])
  }),
  documents: Object.freeze({
    minimum: Object.freeze(['IC_FRONT', 'IC_BACK', 'INCOME_PROOF']),
    consentRequiredBeforeCreditCheck: true,
    consentRequiredBeforeLms: true,
    batchAcknowledgementSeconds: 120
  }),
  routing: Object.freeze({
    replyFromOriginalOfficialNumber: true,
    aiCompleteCasesGoDirectlyToLms: true,
    staffReceivesExceptionsOnly: true
  })
});

export function approvedMonthlyRateFields(businessUnit = '') {
  return String(businessUnit).trim().toUpperCase() === 'HANDPHONE'
    ? JOMKAKI_KNOWLEDGE.pricing.handphoneMonthlyFields
    : JOMKAKI_KNOWLEDGE.pricing.motorMonthlyFields;
}

