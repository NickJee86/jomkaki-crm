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

## Automation and data configuration

- Make S02 is named `S02 — AI Exception Staff Round Robin` and remains `Inactive`.
- No Make scenario was run during this change.
- `ASSIGNED_SA_REQUIRED_FOR_EVERY_LEAD=FALSE`.
- `HANDOVER_AFTER_ATTEMPTS=3`.
- Automatic LMS production submission remains disabled.

## Verification completed

- JavaScript syntax checks passed for the frontend and both production APIs.
- Authentication/session tests passed.
- Role-scope tests passed for Admin, Regional Manager, Business Manager, Branch Supervisor and Staff.
- AI document-readiness tests passed for complete, missing and exception cases.
- Character-encoding checks passed for the frontend, index and README.
- Vercel reported the final deployment `Ready` in Production.

## External activation blockers

- LMSPRO: official API contract, sandbox endpoint and secured test credentials are still required before real case submission can be enabled.
- WhatsApp Cloud: Meta authorization and production credentials are still required; Manual WhatsApp Business mode remains usable for testing.
