# JomKaki Motor CRM 2.0 â€” Production Release

Production CRM for JomKaki Motor, deployed on Vercel and connected to the existing Google Sheets operational database.

## Included

- Secure multi-user login with signed HTTP-only session cookies
- Administrator access across all regions, plus isolated East and West Malaysia manager access
- Live dashboard, leads, applications, inbox, outbox, motor catalog, approved loan pricing and team directory
- Create leads and update lead ownership, status, notes and follow-up date
- Update application stage, status, branch, SA, review requirement and follow-up date
- Queue WhatsApp messages safely in `Message_Outbox` while the Meta connection is pending
- CSV export, search, filters, responsive layout and activity logging
- Customer-facing loan pricing only; cash price, draft pricing and internal pricing notes are excluded

## CRM 2.0 workspaces

- Command Centre with live KPIs, application funnel, action centre and operational health
- My Workbench for due follow-ups, unassigned Leads, manual reviews and message recovery
- Reports & Analytics for region, status, SA ownership, catalogue and conversion reporting
- Visual Lead Pipeline with customer cards and detailed customer drawers
- Application Kanban from new case through documents, details, LMS readiness, CAD and completion
- Three-pane Customer Inbox with conversation history, customer context and safe Outbox queuing
- Message Outbox monitoring and delivery recovery visibility
- Professional Motor Catalog, customer-safe Loan Pricing and Branches & Team management views
- Users & Access, Activity & Audit and System Settings workspaces
- Responsive desktop, tablet and mobile layouts

## Required Vercel environment variables

- `CRM_ACCESS_PASSWORD`
- `CRM_ADMIN_USERNAME` (optional; defaults to `admin`)
- `CRM_ADMIN_NAME` (optional)
- `CRM_EAST_MANAGER_USERNAME`
- `CRM_EAST_MANAGER_PASSWORD`
- `CRM_EAST_MANAGER_NAME` (optional)
- `CRM_WEST_MANAGER_USERNAME`
- `CRM_WEST_MANAGER_PASSWORD`
- `CRM_WEST_MANAGER_NAME` (optional)
- `CRM_SESSION_SECRET`
- `JOMKAKI_SPREADSHEET_ID`
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_PROJECT_NUMBER`
- `GOOGLE_WIF_POOL_ID`
- `GOOGLE_WIF_PROVIDER_ID`
- `SHAREPOINT_TENANT_ID`
- `SHAREPOINT_CLIENT_ID`
- `SHAREPOINT_CLIENT_SECRET` (Sensitive)
- `SHAREPOINT_HOSTNAME` (defaults to `rexmgt.sharepoint.com`)
- `SHAREPOINT_SITE_PATH` (defaults to `/sites/JomkakiMotorSecureDocuments`)
- `SHAREPOINT_LIBRARY_NAME` (defaults to `Documents`)
- `WHATSAPP_SEND_MODE` (`MANUAL` now; change to `CLOUD` after Meta authorization)
- `WHATSAPP_ACCESS_TOKEN` (Sensitive; required only for Cloud mode)
- `WHATSAPP_PHONE_NUMBER_ID` (required only for Cloud mode)
- `WHATSAPP_GRAPH_VERSION` (optional; defaults to `v25.0`)
- `WHATSAPP_VERIFY_TOKEN` (Sensitive; used to verify the Meta webhook)
- `META_APP_SECRET` (Sensitive; used to verify webhook signatures)

Meta webhook callback URL: `https://jomkaki-crm.vercel.app/api/whatsapp-webhook`

## Human handover and account control

- Human handovers enter the Branch/Regional Manager queue first.
- Managers may take over or assign a customer to an active Staff SA ID in their permitted scope.
- Staff can only read and act on customers assigned to their own SA ID.
- Staff cannot approve/reject applications or verify documents; those actions require Manager or Admin access.
- Manual WhatsApp Business replies are recorded in the same Outbox used by future Meta Cloud sending.
- Disabling, resetting or changing an account immediately invalidates its older sessions.
- The final active Administrator cannot be disabled or demoted.

The Google service account must have Editor access to the CRM spreadsheet for operational write actions. Read-only views continue to work if write permission is unavailable.

The Microsoft Entra application must have application permission `Sites.Selected`, with write access granted only to the JomkakiMotorSecureDocuments site. Avoid tenant-wide `Sites.ReadWrite.All` in production.

## Deployment

Drag this entire folder into the existing `jomkaki-crm` Vercel project. Do not upload a ZIP. Confirm the `api` directory and `vercel.json` are listed correctly before deploying to Production.

## Production verification â€” 5 August 2026

- Signed-out state shows only the secure login page; the CRM application shell is hidden with `display: none`.
- West Malaysia Manager login passed and loaded 31 regional Leads.
- East Malaysia Manager login passed and loaded 0 regional Leads at verification time.
- West Malaysia pricing: 93 approved rows; East Malaysia pricing: 49 approved rows.
- West Malaysia team: 3 active SAs; East Malaysia team: 17 active Sarawak SAs.
- Account switching, sign-out and private no-store cache isolation passed.
- Browser error and warning log was clear during the final online regression.

## External blockers

- WhatsApp Business Cloud remains pending until Meta phone verification rate limiting clears and the Make connection can be authorized.
- LMSPRO remains disabled until the official vendor API contract, sandbox endpoint and secured test credentials are provided.
- Make schedules must remain OFF during development and integration testing.

See `../JomKaki External Integration Activation Runbook.md` for the prepared WhatsApp Cloud and LMSPRO activation checklists.
