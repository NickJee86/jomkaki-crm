import { lmsproConfigurationStatus } from './_lmspro.js';

const clean = value => String(value ?? '').trim();
const upper = value => clean(value).toUpperCase();

export const FUTURE_REPORTING_FIELDS = {
  meta: [
    'Provider Message ID',
    'Send Routing Status',
    'Send Status',
    'Sent At',
    'Delivered At',
    'Read At',
    'Customer Replied At',
    'AI Processed',
    'AI Processed At',
    'Human Handover At'
  ],
  lms: [
    'LMS Case ID',
    'LMS Submission Status',
    'LMS Submitted At',
    'LMS Decision At',
    'Financier',
    'Approved At',
    'Rejected At',
    'Rejection Reason',
    'LMS Error Code',
    'LMS Error Message'
  ]
};

export function metaConfigurationStatus(env = process.env) {
  const mode = upper(env.WHATSAPP_SEND_MODE) === 'CLOUD' ? 'CLOUD' : 'MANUAL';
  const webhookConfigured = Boolean(clean(env.WHATSAPP_VERIFY_TOKEN) && clean(env.META_APP_SECRET));
  const sendingConfigured = Boolean(clean(env.WHATSAPP_ACCESS_TOKEN) && clean(env.WHATSAPP_PHONE_NUMBER_ID));
  const productionEnabled = mode === 'CLOUD' && webhookConfigured && sendingConfigured;
  return {
    mode,
    webhookConfigured,
    sendingConfigured,
    readyForWebhook: webhookConfigured,
    productionEnabled,
    reportingReady: productionEnabled
  };
}

export function integrationReadiness(env = process.env) {
  const meta = metaConfigurationStatus(env);
  const lms = lmsproConfigurationStatus(env);
  return {
    meta,
    lms,
    safety: {
      whatsappAutomaticSendDisabled: !meta.productionEnabled,
      lmsProductionSubmissionDisabled: !lms.productionEnabled
    }
  };
}

export function publicIntegrationRecords(env = process.env) {
  const { meta, lms } = integrationReadiness(env);
  const metaStatus = meta.productionEnabled ? 'CONNECTED' : meta.webhookConfigured ? 'WEBHOOK_READY' : meta.mode === 'MANUAL' ? 'MANUAL_READY' : 'AWAITING_CONFIGURATION';
  const lmsStatus = lms.productionEnabled ? 'PRODUCTION_READY' : lms.readyForSandbox ? 'SANDBOX_READY' : lms.contractConfigured ? 'CONFIGURED_DISABLED' : 'AWAITING_VENDOR';
  return [
    {
      id: 'META_CLOUD',
      name: 'WhatsApp Meta Cloud',
      status: metaStatus,
      mode: meta.mode,
      reportingReady: meta.reportingReady,
      automaticActionsEnabled: meta.productionEnabled,
      description: meta.productionEnabled ? 'Cloud messaging and delivery reporting are enabled.' : 'Manual WhatsApp remains active. Cloud reporting will activate after Meta credentials and webhook approval.',
      requiredNext: meta.productionEnabled ? 'Monitor delivery, read and reply metrics.' : 'Connect Meta access token, phone number ID, verify token and app secret.'
    },
    {
      id: 'LMSPRO',
      name: 'LMSPRO',
      status: lmsStatus,
      mode: lms.sandboxOnly ? 'SANDBOX_ONLY' : 'PRODUCTION',
      reportingReady: lms.productionEnabled,
      automaticActionsEnabled: lms.productionEnabled,
      description: lms.productionEnabled ? 'Production submission and decision reporting are enabled.' : 'Payload, readiness and idempotency controls are prepared; no production submission is allowed.',
      requiredNext: lms.productionEnabled ? 'Monitor submission, approval and rejection metrics.' : 'Obtain the vendor contract, sandbox endpoint, authentication method and test credentials.'
    }
  ];
}
