# JomKaki External Integration Activation Runbook

Updated: 29 August 2026  
Production safety rule: WhatsApp Cloud is active only for a verified JomKaki number and every message remains bound to that original number. LMSPRO production submission remains OFF until the vendor gate is signed off.

## 1. Meta WhatsApp Cloud gate

- Use only the JomKaki Rider production app and official number. Never modify or reuse any LoanBuddy Meta or WhatsApp connection.
- Meta Business Portfolio ID: `3324547997776070`.
- Meta App ID: `2355506515274797` (`JomKaki Rider AI CRM`).
- WABA ID: `1450874216868670`.
- Official number: `+60147952387`; Phone Number ID: `1212389721965743`; requested Meta display name: `JomKaki Rider`.
- Webhook callback: `https://jomkaki-rider.vercel.app/api/whatsapp-webhook`.
- The App Secret has been rotated and stored only as the Sensitive Vercel variable `META_APP_SECRET`. The verification token is stored only as `WHATSAPP_VERIFY_TOKEN`; never copy either value into Google Sheets, Make notes or this file.
- `WHATSAPP_SEND_MODE=CLOUD` is active for the verified JomKaki production route. Never switch to a LoanBuddy or unrelated Meta asset.
- OTP verification for `+60147952387` was completed on 13 August 2026. Do not request another verification code.
- WhatsApp Manager shows the production number as `Connected`; the Meta-approved display name is active and two-step verification is enabled.
- The approved JomKaki square logo has been uploaded and saved as the production WhatsApp business profile picture. Meta may take a few minutes to propagate the change.
- The callback is saved in Meta and the app is subscribed to the WhatsApp `messages` webhook field on Graph API v26.0.
- A non-expiring production system-user token with `whatsapp_business_management` and `whatsapp_business_messaging` is stored only as the Sensitive Vercel variable `WHATSAPP_WEST_01_ACCESS_TOKEN`.
- The Make S00B dispatcher now uses a dedicated protected dispatch secret shared only with Vercel. Map Receiver, Message Type and Message Text from the JomKaki `Message_Outbox` row.
- The Vercel dispatcher checks queued messages every five minutes. CRM users can also use **Send now** on a queued message without changing the bound official number.
- Verify inbound webhook, exact-number outbound routing, delivery/read status, duplicate prevention, AI reply, document collection, attachment delivery and Manager handover with an approved test phone.
- A message that remains **Sending** for more than ten minutes must be checked in Meta before any resend. This prevents accidental duplicate customer messages.

## 2. SharePoint document gate

- Entra application: `JomKaki CRM SharePoint Documents`.
- Application (client) ID: `813fe035-bc93-42d4-b8c3-763681822b18`.
- Tenant ID: `1400a827-d9c2-42ce-9fee-b15504381412`.
- Required Microsoft Graph application permission: `Sites.Selected` only.
- Grant write access only to `https://rexmgt.sharepoint.com/sites/JomKakiRiderSecureDocuments`.
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
- CRM automated suite: 264 tests passed with zero failures on 29 August 2026, including queued-message recovery, attachment delivery, follow-up, AI knowledge and duplicate-send protection.
- Staff account mapping and role tests: completed; vacant Branch Supervisor positions continue to use the Regional Manager fallback.
- SharePoint Entra permission: `Sites.Selected` is configured and granted; site-specific write verification remains required.
- Meta Vercel preparation: rotated App Secret, verification token, West 01 Phone Number ID and the permanent system-user access token are stored as Sensitive variables; Production was redeployed `Ready`; the deployed callback challenge test passed.
- Meta app and webhook: the production app is published, the CRM callback is saved, and the WhatsApp `messages` field is subscribed on Graph API v26.0.
- Meta connection: the official number is `Connected`, two-step verification is enabled, the webhook is saved and `messages` is subscribed. Cloud outbound uses the same official-number binding as inbound.
- Message Outbox now shows queued, sending, failed, sent, delivered and read states. Queued messages can be dispatched immediately; failed messages have a controlled one-time retry.
- LMSPRO: preparation layer completed; vendor contract, sandbox and credentials remain external blockers.
