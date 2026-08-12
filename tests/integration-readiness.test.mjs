import test from 'node:test';
import assert from 'node:assert/strict';
import { FUTURE_REPORTING_FIELDS, integrationReadiness, metaConfigurationStatus, publicIntegrationRecords, sharePointConfigurationStatus } from '../api/_integrations.js';

test('Unconfigured integrations stay safe and expose prepared reporting fields',()=>{
  const readiness=integrationReadiness({});
  const records=publicIntegrationRecords({});
  assert.equal(readiness.meta.mode,'MANUAL');
  assert.equal(readiness.meta.productionEnabled,false);
  assert.equal(readiness.lms.productionEnabled,false);
  assert.equal(readiness.sharepoint.productionEnabled,false);
  assert.equal(readiness.safety.whatsappAutomaticSendDisabled,true);
  assert.equal(readiness.safety.lmsProductionSubmissionDisabled,true);
  assert.equal(records.find(record=>record.id==='META_CLOUD').status,'MANUAL_READY');
  assert.equal(records.find(record=>record.id==='LMSPRO').status,'AWAITING_VENDOR');
  assert.equal(records.find(record=>record.id==='SHAREPOINT').status,'AWAITING_CONFIGURATION');
  assert.ok(FUTURE_REPORTING_FIELDS.meta.includes('Delivered At'));
  assert.ok(FUTURE_REPORTING_FIELDS.meta.includes('Read At'));
  assert.ok(FUTURE_REPORTING_FIELDS.lms.includes('LMS Decision At'));
  assert.ok(FUTURE_REPORTING_FIELDS.lms.includes('LMS Error Message'));
});

test('SharePoint distinguishes protected credentials from a verified site write',()=>{
  const credentials={SHAREPOINT_TENANT_ID:'tenant-secret',SHAREPOINT_CLIENT_ID:'client-secret',SHAREPOINT_CLIENT_SECRET:'app-secret'};
  const prepared=sharePointConfigurationStatus(credentials);
  assert.equal(prepared.credentialsConfigured,true);
  assert.equal(prepared.writeVerified,false);
  assert.equal(publicIntegrationRecords(credentials).find(record=>record.id==='SHAREPOINT').status,'CREDENTIALS_READY');
  const verified=sharePointConfigurationStatus({...credentials,SHAREPOINT_SITE_WRITE_VERIFIED_AT:'2026-08-11T12:00:00+08:00'});
  assert.equal(verified.productionEnabled,true);
  const publicJson=JSON.stringify(publicIntegrationRecords({...credentials,SHAREPOINT_SITE_WRITE_VERIFIED_AT:'2026-08-11T12:00:00+08:00'}));
  ['tenant-secret','client-secret','app-secret'].forEach(secret=>assert.equal(publicJson.includes(secret),false));
});

test('Meta reporting activates only when the full approved Cloud configuration exists',()=>{
  const partial=metaConfigurationStatus({WHATSAPP_SEND_MODE:'CLOUD',WHATSAPP_ACCESS_TOKEN:'secret-token'});
  assert.equal(partial.productionEnabled,false);
  const env={
    WHATSAPP_SEND_MODE:'CLOUD',
    WHATSAPP_VERIFY_TOKEN:'verify-secret',
    META_APP_SECRET:'app-secret',
    WHATSAPP_ACCESS_TOKEN:'access-secret',
    WHATSAPP_PHONE_NUMBER_ID:'123456789',
    WHATSAPP_PHONE_VERIFIED_AT:'2026-08-12T13:00:00+08:00'
  };
  const status=metaConfigurationStatus(env);
  const records=publicIntegrationRecords(env);
  assert.equal(status.productionEnabled,true);
  assert.equal(status.reportingReady,true);
  assert.equal(records.find(record=>record.id==='META_CLOUD').status,'CONNECTED');
  const publicJson=JSON.stringify(records);
  ['verify-secret','app-secret','access-secret','123456789'].forEach(secret=>assert.equal(publicJson.includes(secret),false));
});

test('Meta Cloud remains disabled until the official phone number is verified',()=>{
  const env={
    WHATSAPP_SEND_MODE:'CLOUD',
    WHATSAPP_VERIFY_TOKEN:'verify-secret',
    META_APP_SECRET:'app-secret',
    WHATSAPP_ACCESS_TOKEN:'access-secret',
    WHATSAPP_PHONE_NUMBER_ID:'123456789'
  };
  const status=metaConfigurationStatus(env);
  const publicRecord=publicIntegrationRecords(env).find(record=>record.id==='META_CLOUD');
  assert.equal(status.phoneVerified,false);
  assert.equal(status.productionEnabled,false);
  assert.equal(publicRecord.status,'PHONE_VERIFICATION_PENDING');
});

test('Meta readiness recognises protected multi-channel credentials without requiring legacy globals',()=>{
  const partial=metaConfigurationStatus({
    WHATSAPP_SEND_MODE:'CLOUD',
    WHATSAPP_VERIFY_TOKEN:'verify-secret',
    META_APP_SECRET:'app-secret',
    WHATSAPP_WEST_01_ACCESS_TOKEN:'west-secret'
  });
  assert.equal(partial.sendingConfigured,false);
  assert.equal(partial.productionEnabled,false);

  const env={
    WHATSAPP_SEND_MODE:'CLOUD',
    WHATSAPP_VERIFY_TOKEN:'verify-secret',
    META_APP_SECRET:'app-secret',
    WHATSAPP_WEST_01_ACCESS_TOKEN:'west-secret',
    WHATSAPP_WEST_01_PHONE_NUMBER_ID:'1212389721965743',
    WHATSAPP_PHONE_VERIFIED_AT:'2026-08-12T13:00:00+08:00'
  };
  const status=metaConfigurationStatus(env);
  const publicRecord=publicIntegrationRecords(env).find(record=>record.id==='META_CLOUD');
  assert.equal(status.sendingConfigured,true);
  assert.equal(status.configuredSenderCount,1);
  assert.equal(status.credentialModel,'MULTI_CHANNEL');
  assert.equal(status.productionEnabled,true);
  assert.equal(publicRecord.status,'CONNECTED');
  ['verify-secret','app-secret','west-secret','1212389721965743'].forEach(secret=>assert.equal(JSON.stringify(publicRecord).includes(secret),false));
});

test('LMS reporting distinguishes sandbox preparation from production activation',()=>{
  const sandboxEnv={
    LMSPRO_ENABLED:'true',
    LMSPRO_SANDBOX_BASE_URL:'https://sandbox.example.invalid',
    LMSPRO_SUBMIT_PATH:'/applications',
    LMSPRO_AUTH_MODE:'bearer',
    LMSPRO_API_TOKEN:'sandbox-secret'
  };
  const sandbox=publicIntegrationRecords(sandboxEnv).find(record=>record.id==='LMSPRO');
  assert.equal(sandbox.status,'SANDBOX_READY');
  assert.equal(sandbox.reportingReady,false);
  assert.equal(sandbox.automaticActionsEnabled,false);
  const production=publicIntegrationRecords({...sandboxEnv,LMSPRO_PRODUCTION_ENABLED:'true'}).find(record=>record.id==='LMSPRO');
  assert.equal(production.status,'PRODUCTION_READY');
  assert.equal(production.reportingReady,true);
  assert.equal(JSON.stringify(production).includes('sandbox-secret'),false);
});
