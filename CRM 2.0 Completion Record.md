# JomKaki Rider CRM 2.0 — Completion Record

Updated: 29 August 2026  
Production: https://jomkaki-crm.vercel.app/

## Current production flow

1. New WhatsApp Leads start as `AI_MANAGED` and remain unassigned.
2. AI follows up with the customer and collects IC front, IC back and an accepted income document.
3. AI-verified complete cases become `READY_FOR_LMS` without Staff or Manager handling.
4. If AI cannot collect all required documents or cannot complete follow-up after three attempts, the Application becomes `AI_TO_SA_HANDOVER`.
5. Make S02 assigns only those AI exceptions to eligible Staff by branch/region round-robin and updates both the Lead and Application.
6. Explicit customer requests for a human enter the Manager handover queue.

## Role visibility

- Administrator: all company Leads, Applications, accounts, reports and audit records.
- Regional Manager: all Leads and Applications in the Manager's own region.
- Business Manager: all permitted Handphone or business-unit cases within the account scope.
- Branch Supervisor: only Leads assigned to the Supervisor's own branch; vacancies fall back to the Regional Manager.
- Staff: only AI exceptions, assigned cases or applications submitted under the Staff member's own SA ID.

## CRM capabilities completed

- Command Centre includes AI Exceptions and Ready for LMS metrics.
- Applications show motorcycle, pricing, required documents, missing documents, AI status and LMS readiness.
- Staff can manually submit an applicant and securely upload documents to SharePoint.
- Uploaded documents enter `AI_QUEUED` / `PENDING_AI`; routine Staff verification is not required.
- Managers can resolve AI document exceptions and all decisions are recorded in Activity & Audit.
- Admin can create, edit, enable, disable, unlock and reset CRM accounts without exposing stored passwords.
- WhatsApp Meta Cloud is active for the verified JomKaki production number. Every reply remains bound to the number that received the customer conversation.
- Message Outbox exposes queued, sending, failed, sent, delivered and read states. Queued messages can be sent immediately and failed messages can be retried safely.
- Login, page asset version and browser console were verified on the final production deployment.
- Accounts support Motor, Handphone or Both business access.
- Manual application submission starts with Motorcycle Loan or Handphone Loan and stores separately reportable product data.
- Leads, Applications, Customer 360 and Reports identify and filter Motor and Handphone cases.
- Admin can maintain separate Motor and Handphone catalogs, financing prices and promotions directly in CRM.
- Handphone financing is monthly-payment only and supports 1–5-year plans. Selling price and deposit are excluded from CRM forms, customer views and AI responses.
- East and future West Handphone operations are separated by business unit, region, team and official WhatsApp number.
- The same customer can hold separate Motor and Handphone Leads under one Customer ID, preventing mixed conversations while keeping a complete Customer 360 record.
- Inbound and outbound messages preserve the exact official number used by the customer; no reply may silently cross to another business or region.
- Branch Supervisors and permitted Handphone managers can submit phone catalog, image and regional monthly-payment changes inside CRM.
- Branch Handphone stock updates take effect immediately for the permitted branch; catalog and commercial changes require approval.
- Regional Managers can approve Handphone submissions only for their own region and cannot approve their own submissions.
- Handphone monthly-payment changes require approval before publication; Motor price-floor exceptions remain Administrator-only.
- Existing approved Handphone catalog and pricing remain live while a replacement version is pending, rejected or corrected.
- AI and customer quotations use only approved, enabled and date-valid Handphone records; the Admin report includes the complete approval queue.

## Automation and data configuration

- Make S02 blueprint is now business- and team-aware; exception assignment matches Business Unit + Team ID before selecting Staff.
- Make S03C is Motor-only, and the new S03H blueprint is Handphone-only with its own catalog, pricing and customer reply wording.
- Updated blueprints are import-ready but must remain inactive until connections are reselected and a synthetic scenario run passes.
- `ASSIGNED_SA_REQUIRED_FOR_EVERY_LEAD=FALSE`.
- `HANDOVER_AFTER_ATTEMPTS=3`.
- Automatic LMS production submission remains disabled.

## Verification completed

- The complete automated suite passed on 29 August 2026: 264 tests, 0 failures.
- JavaScript syntax checks passed for 29 frontend, API and test files.
- Authentication/session tests passed.
- Role-scope tests passed for Admin, Regional Manager, Business Manager, Branch Supervisor and Staff.
- AI document-readiness tests passed for complete, missing and exception cases.
- Motor/Handphone number isolation, shared Customer ID, monthly Handphone tenure and Make business/team routing tests passed.
- Handphone catalog, stock, pricing, regional approval, Admin price-floor exception and safe-version replacement tests passed.
- Character-encoding checks passed for the frontend, index and README.
- The Meta App Secret was rotated; the new secret, verification token and official West 01 Phone Number ID were stored as protected Vercel environment variables.
- Vercel was redeployed after the Meta environment update and reported `Ready` in Production.
- The deployed Meta callback challenge returned the exact expected challenge, confirming that the Vercel Webhook verification path and current verification token are working.
- WhatsApp Manager now reports West 01 as `Connected`; the display name is approved and two-step verification is enabled.
- The protected Make S00B dispatch secret is configured in both Vercel and Make, and the new Vercel production deployment is `Ready`.
- West 01 Cloud outbound is enabled on the verified JomKaki route. A controlled approved-phone smoke test still provides the final operational evidence for delivery, read receipt and attachment handling.
- The official JomKaki logo is saved as the production WhatsApp business profile picture; Meta may take a few minutes to display it everywhere.

## External activation blockers

- LMSPRO: official API contract, sandbox endpoint and secured test credentials are still required before real case submission can be enabled.
- SharePoint: credentials are present, but the site-specific write gate must remain visible until a non-PII upload has been verified and `SHAREPOINT_SITE_WRITE_VERIFIED_AT` is recorded.
