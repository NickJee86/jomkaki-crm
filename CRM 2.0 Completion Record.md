# JomKaki Motor CRM 2.0 — Completion Record

Updated: 10 August 2026  
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
- Manual WhatsApp Business replies remain available while Meta Cloud authorization is pending.
- Login, page asset version and browser console were verified on the final production deployment.
- Accounts support Motor, Handphone or Both business access.
- Manual application submission starts with Motorcycle Loan or Handphone Loan and stores separately reportable product data.
- Leads, Applications, Customer 360 and Reports identify and filter Motor and Handphone cases.
- Admin can maintain separate Motor and Handphone catalogs, financing prices and promotions directly in CRM.
- Handphone financing supports product price, deposit and 12/24/36/48-month tenures.
- East and future West Handphone operations are separated by business unit, region, team and official WhatsApp number.
- The same customer can hold separate Motor and Handphone Leads under one Customer ID, preventing mixed conversations while keeping a complete Customer 360 record.
- Inbound and outbound messages preserve the exact official number used by the customer; no reply may silently cross to another business or region.

## Automation and data configuration

- Make S02 blueprint is now business- and team-aware; exception assignment matches Business Unit + Team ID before selecting Staff.
- Make S03C is Motor-only, and the new S03H blueprint is Handphone-only with its own catalog, pricing and customer reply wording.
- Updated blueprints are import-ready but must remain inactive until connections are reselected and a synthetic scenario run passes.
- `ASSIGNED_SA_REQUIRED_FOR_EVERY_LEAD=FALSE`.
- `HANDOVER_AFTER_ATTEMPTS=3`.
- Automatic LMS production submission remains disabled.

## Verification completed

- JavaScript syntax checks passed for the frontend and both production APIs.
- Authentication/session tests passed.
- Role-scope tests passed for Admin, Regional Manager, Business Manager, Branch Supervisor and Staff.
- AI document-readiness tests passed for complete, missing and exception cases.
- Motor/Handphone number isolation, shared Customer ID, monthly Handphone tenure and Make business/team routing tests passed.
- Character-encoding checks passed for the frontend, index and README.
- Vercel reported the final deployment `Ready` in Production.

## External activation blockers

- LMSPRO: official API contract, sandbox endpoint and secured test credentials are still required before real case submission can be enabled.
- WhatsApp Cloud: Meta authorization and production credentials are still required; Manual WhatsApp Business mode remains usable for testing.
