import { lmsproConfigurationStatus } from './_lmspro.js';

const clean = value => String(value ?? '').trim();
const upper = value => clean(value).toUpperCase();

function configuredWhatsAppSenders(env = {}) {
  const senders = [];
  if (clean(env.WHATSAPP_ACCESS_TOKEN) && clean(env.WHATSAPP_PHONE_NUMBER_ID)) senders.push('LEGACY_SINGLE');
  Object.keys(env).forEach(key => {
    if (!key.startsWith('WHATSAPP_') || !key.endsWith('_ACCESS_TOKEN') || key === 'WHATSAPP_ACCESS_TOKEN') return;
    const prefix = key.slice(0, -'_ACCESS_TOKEN'.length);
    if (clean(env[key]) && clean(env[`${prefix}_PHONE_NUMBER_ID`])) senders.push(prefix);
  });
  return [...new Set(senders)];
}

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
  const configuredSenders = configuredWhatsAppSenders(env);
  const sendingConfigured = configuredSenders.length > 0;
  const productionEnabled = mode === 'CLOUD' && webhookConfigured && sendingConfigured;
  return {
    mode,
    webhookConfigured,
    sendingConfigured,
    configuredSenderCount: configuredSenders.length,
    credentialModel: configuredSenders.some(sender => sender !== 'LEGACY_SINGLE') ? 'MULTI_CHANNEL' : configuredSenders.length ? 'LEGACY_SINGLE' : 'NONE',
    readyForWebhook: webhookConfigured,
    productionEnabled,
    reportingReady: productionEnabled
  };
}

export function sharePointConfigurationStatus(env = process.env) {
  const credentialsConfigured = Boolean(clean(env.SHAREPOINT_TENANT_ID) && clean(env.SHAREPOINT_CLIENT_ID) && clean(env.SHAREPOINT_CLIENT_SECRET));
  const writeVerifiedAt = clean(env.SHAREPOINT_SITE_WRITE_VERIFIED_AT);
  const writeVerified = credentialsConfigured && Boolean(writeVerifiedAt);
  return {
    credentialsConfigured,
    targetConfigured: true,
    hostname: clean(env.SHAREPOINT_HOSTNAME) || 'rexmgt.sharepoint.com',
    sitePath: clean(env.SHAREPOINT_SITE_PATH) || '/sites/JomkakiMotorSecureDocuments',
    libraryName: clean(env.SHAREPOINT_LIBRARY_NAME) || 'Documents',
    writeVerified,
    writeVerifiedAt,
    productionEnabled: writeVerified,
    reportingReady: writeVerified
  };
}

export function integrationReadiness(env = process.env) {
  const meta = metaConfigurationStatus(env);
  const lms = lmsproConfigurationStatus(env);
  const sharepoint = sharePointConfigurationStatus(env);
  return {
    meta,
    lms,
    sharepoint,
    safety: {
      whatsappAutomaticSendDisabled: !meta.productionEnabled,
      lmsProductionSubmissionDisabled: !lms.productionEnabled,
      unverifiedDocumentStorageBlocked: !sharepoint.writeVerified
    }
  };
}

export function publicIntegrationRecords(env = process.env) {
  const { meta, lms, sharepoint } = integrationReadiness(env);
  const metaStatus = meta.productionEnabled ? 'CONNECTED' : meta.webhookConfigured ? 'WEBHOOK_READY' : meta.mode === 'MANUAL' ? 'MANUAL_READY' : 'AWAITING_CONFIGURATION';
  const lmsStatus = lms.productionEnabled ? 'PRODUCTION_READY' : lms.readyForSandbox ? 'SANDBOX_READY' : lms.contractConfigured ? 'CONFIGURED_DISABLED' : 'AWAITING_VENDOR';
  const sharePointStatus = sharepoint.writeVerified ? 'VERIFIED' : sharepoint.credentialsConfigured ? 'CREDENTIALS_READY' : 'AWAITING_CONFIGURATION';
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
    },
    {
      id: 'SHAREPOINT',
      name: 'Secure customer documents',
      status: sharePointStatus,
      mode: 'MANUAL_UPLOAD',
      reportingReady: sharepoint.reportingReady,
      automaticActionsEnabled: sharepoint.productionEnabled,
      description: sharepoint.writeVerified ? 'The configured SharePoint site and document library passed the controlled write test.' : sharepoint.credentialsConfigured ? 'Credentials and the secure site target are configured; a controlled site-specific write test is still required.' : 'Document uploads remain unavailable until the SharePoint application credentials are configured.',
      requiredNext: sharepoint.writeVerified ? 'Monitor document upload errors and access reviews.' : 'Run one controlled upload test in the JomKaki secure document site and record SHAREPOINT_SITE_WRITE_VERIFIED_AT.'
    }
  ];
}
