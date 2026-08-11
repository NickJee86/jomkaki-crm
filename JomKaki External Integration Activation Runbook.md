# JomKaki External Integration Activation Runbook

Updated: 11 August 2026  
Production safety rule: all Make schedules, WhatsApp Cloud automation and LMSPRO production submission remain OFF until the relevant acceptance gate is signed off.

## 1. Meta WhatsApp Cloud gate

- Use only the JomKaki Motor production app and official number. Never modify or reuse any LoanBuddy Meta or WhatsApp connection.
- Meta Business Portfolio ID: `3324547997776070`.
- Meta App ID: `2355506515274797` (`JomKaki Motor AI CRM`).
- WABA ID: `1450874216868670`.
- Official number: `+60147952387`; Phone Number ID: `1212389721965743`; approved display name: `JomKaki Motor`.
- Webhook callback: `https://jomkaki-crm.vercel.app/api/whatsapp-webhook`.
- The App Secret has been rotated and stored only as the Sensitive Vercel variable `META_APP_SECRET`. The verification token is stored only as `WHATSAPP_VERIFY_TOKEN`; never copy either value into Google Sheets, Make notes or this file.
- Keep `WHATSAPP_SEND_MODE=MANUAL` and keep the West 01 channel inactive until all remaining gates pass.
- Wait for Meta's verification-code rate limit to clear, then verify `+60147952387` once. Do not repeatedly request codes.
- Save the callback in Meta and subscribe the app to the WhatsApp `messages` webhook field.
- Create a permanent production access token with the minimum WhatsApp permissions and store it only as `WHATSAPP_WEST_01_ACCESS_TOKEN` in Vercel.
- Confirm the sender number and display name before saving the Make module. Map Receiver, Message Type and Message Text from the JomKaki `Message_Outbox` row.
- Keep the Make schedule OFF during the synthetic acceptance test. Test with synthetic CRM data and an approved test phone only.
- Verify inbound webhook, exact-number outbound routing, delivery/read status, duplicate prevention, AI reply, document collection and Manager handover.
- Change to `WHATSAPP_SEND_MODE=CLOUD` and enable production scheduling only after the owner signs off the test evidence.

## 2. SharePoint document gate

- Entra application: `JomKaki CRM SharePoint Documents`.
- Application (client) ID: `813fe035-bc93-42d4-b8c3-763681822b18`.
- Tenant ID: `1400a827-d9c2-42ce-9fee-b15504381412`.
- Required Microsoft Graph application permission: `Sites.Selected` only.
- Grant write access only to `https://rexmgt.sharepoint.com/sites/JomkakiMotorSecureDocuments`.
- Do not grant tenant-wide `Sites.ReadWrite.All`.
- Store the client secret only as a Sensitive Vercel environment variable.
- Verify with a non-PII synthetic file, then remove or clearly retain it as test evidence according to the retention policy.
- Confirm that the same app cannot enumerate or write to unrelated SharePoint sites.

## 3. LMSPRO sandbox package required from vendor

Do not invent these values. Obtain all items from the LMSPRO vendor:

- Official sandbox base URL and submission path.
- Authentication method, token URL, scopes and test credentials.
- Application request schema and mandatory/optional field definitions.
- Document upload method, supported formats, size limits and document type codes.
- Idempotency or duplicate-submission contract.
- LMS case ID response field and complete error-code catalogue.
- CAD status callback or polling contract, including authentication and retry rules.
- Rate limits, timeout guidance, maintenance windows and support contact.
- Production endpoint, credential handover process and IP allow-list requirements.

## 4. Prepared LMSPRO controls

The repository contains a provider-neutral preparation module at `api/_lmspro.js`.

- It validates required applicant, motorcycle and loan fields.
- It requires AI-verified IC front, IC back and income proof.
- It rejects documents that still require manual review.
- It creates a stable idempotency key using the CRM Application ID.
- It produces a vendor-neutral payload without sending any network request.
- Configuration remains disabled by default.

Planned environment keys after the vendor package is approved:

- `LMSPRO_ENABLED=false`
- `LMSPRO_SANDBOX_BASE_URL`
- `LMSPRO_SUBMIT_PATH`
- `LMSPRO_AUTH_MODE`
- `LMSPRO_API_TOKEN` or `LMSPRO_CLIENT_ID` plus `LMSPRO_CLIENT_SECRET`
- `LMSPRO_PRODUCTION_ENABLED=false`

## 5. LMSPRO acceptance sequence

1. Add sandbox configuration with `LMSPRO_PRODUCTION_ENABLED=false`.
2. Run unit tests and validate the vendor mapping with synthetic data.
3. Submit one synthetic application using a fixed idempotency key.
4. Repeat the same request and confirm that no duplicate LMS case is created.
5. Verify document receipt, LMS case ID, validation errors and CAD status handling.
6. Record test evidence and obtain owner/vendor sign-off.
7. Add production credentials through the secret store.
8. Enable production only in an approved window with monitoring and rollback.

## 6. Current status

- Google Sheet dashboard and application state alignment: completed.
- CRM automated suite: 55 tests passed with zero failures on 11 August 2026; syntax checks passed for 29 JavaScript files.
- Staff account mapping and role tests: completed; vacant Branch Supervisor positions continue to use the Regional Manager fallback.
- SharePoint Entra permission: `Sites.Selected` is configured and granted; site-specific write verification remains required.
- Meta Vercel preparation: rotated App Secret, verification token and West 01 Phone Number ID are stored; Production was redeployed `Ready`; the deployed callback challenge test passed.
- Meta remaining blockers: the developer Webhook Configuration panel is currently failing to load, the official number is still `Unverified` because of Meta rate limiting, the `messages` subscription is not yet saved and the permanent access token is not yet available. Manual mode remains active.
- Make business-aware blueprints and safety controls are prepared and tested locally; keep the WhatsApp sender OFF until the Meta acceptance sequence passes.
- LMSPRO: preparation layer completed; vendor contract, sandbox and credentials remain external blockers.
