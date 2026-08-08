const clean = value => String(value ?? '').trim();
const upper = value => clean(value).toUpperCase();

export const LMS_REQUIRED_FIELDS = [
  'Application ID',
  'Applicant Name',
  'Applicant IC Number',
  'Phone Number',
  'Product Brand',
  'Product Model',
  'Loan Tenure Years'
];

export const LMS_REQUIRED_DOCUMENT_GROUPS = {
  IC_FRONT: ['IC_FRONT'],
  IC_BACK: ['IC_BACK'],
  INCOME_PROOF: ['INCOME_PROOF', 'PAYSLIP', 'SALARY_SLIP', 'EPF', 'EPF_STATEMENT']
};

const acceptedVerification = new Set(['VERIFIED', 'AI_VERIFIED', 'APPROVED', 'ACCEPTED']);
const acceptedQuality = new Set(['', 'GOOD', 'PASS', 'PASSED', 'ACCEPTED']);

function acceptedDocument(row) {
  const verification = upper(row['Verification Status'] || row.verification);
  const quality = upper(row['Quality Status'] || row.quality);
  const manualReview = upper(row['Manual Review Required'] || row.reviewRequired) === 'TRUE';
  return acceptedVerification.has(verification) && acceptedQuality.has(quality) && !manualReview;
}

function value(row, sheetHeader, apiField) {
  return clean(row?.[sheetHeader] ?? row?.[apiField]);
}

/**
 * Builds the provider-neutral LMSPRO submission envelope.
 * This function never performs a network request. The vendor-specific adapter
 * may only send the returned payload after the official contract is approved.
 */
export function prepareLmsSubmission(application = {}, documents = []) {
  const missingFields = LMS_REQUIRED_FIELDS.filter(header => !clean(application[header]));
  const accepted = documents.filter(acceptedDocument);
  const byType = new Map();
  accepted.forEach(row => {
    const type = upper(row['Document Type'] || row.type);
    if (type && !byType.has(type)) byType.set(type, row);
  });

  const missingDocuments = Object.entries(LMS_REQUIRED_DOCUMENT_GROUPS)
    .filter(([, aliases]) => !aliases.some(alias => byType.has(alias)))
    .map(([group]) => group);

  const documentPayload = Object.fromEntries(Object.entries(LMS_REQUIRED_DOCUMENT_GROUPS).map(([group, aliases]) => {
    const row = aliases.map(alias => byType.get(alias)).find(Boolean);
    return [group, row ? {
      document_id: value(row, 'Document ID', 'id'),
      document_type: upper(row['Document Type'] || row.type),
      file_name: value(row, 'File Name', 'fileName'),
      file_url: value(row, 'File URL', 'fileUrl'),
      verification_status: upper(row['Verification Status'] || row.verification)
    } : null];
  }));

  const applicationId = value(application, 'Application ID', 'id');
  return {
    ready: missingFields.length === 0 && missingDocuments.length === 0,
    missingFields,
    missingDocuments,
    idempotencyKey: applicationId ? `JOMKAKI:${applicationId}` : '',
    payload: {
      source_system: 'JOMKAKI_CRM',
      source_application_id: applicationId,
      applicant: {
        name: value(application, 'Applicant Name', 'customer'),
        ic_number: value(application, 'Applicant IC Number', 'applicantIcNumber'),
        phone: value(application, 'Phone Number', 'phone'),
        email: value(application, 'Email', 'email'),
        home_address: value(application, 'Home Address', 'homeAddress')
      },
      employment: {
        employer_name: value(application, 'Employer Name', 'employerName'),
        employer_phone: value(application, 'Employer Phone', 'employerPhone'),
        job_position: value(application, 'Job Position', 'jobPosition'),
        employment_duration_months: value(application, 'Employment Duration Months', 'employmentDurationMonths'),
        basic_salary: value(application, 'Basic Salary', 'basicSalary'),
        salary_payment_method: value(application, 'Salary Payment Method', 'salaryPaymentMethod')
      },
      financing: {
        product_category: value(application, 'Product Category', 'productCategory') || 'MOTORCYCLE',
        product_brand: value(application, 'Product Brand', 'brand'),
        product_model: value(application, 'Product Model', 'model'),
        product_variant: value(application, 'Product Variant', 'variant'),
        tenure_years: value(application, 'Loan Tenure Years', 'tenure')
      },
      references: [
        {
          name: value(application, 'Reference 1 Name', 'reference1Name'),
          phone: value(application, 'Reference 1 Phone', 'reference1Phone'),
          relationship: value(application, 'Reference 1 Relationship', 'reference1Relationship')
        },
        {
          name: value(application, 'Reference 2 Name', 'reference2Name'),
          phone: value(application, 'Reference 2 Phone', 'reference2Phone'),
          relationship: value(application, 'Reference 2 Relationship', 'reference2Relationship')
        }
      ],
      documents: documentPayload
    }
  };
}

export function lmsproConfigurationStatus(env = process.env) {
  const enabled = upper(env.LMSPRO_ENABLED) === 'TRUE';
  const sandboxBaseUrl = clean(env.LMSPRO_SANDBOX_BASE_URL);
  const authMode = upper(env.LMSPRO_AUTH_MODE);
  const credentialConfigured = Boolean(clean(env.LMSPRO_API_TOKEN) || (clean(env.LMSPRO_CLIENT_ID) && clean(env.LMSPRO_CLIENT_SECRET)));
  const contractConfigured = Boolean(sandboxBaseUrl && clean(env.LMSPRO_SUBMIT_PATH) && authMode && credentialConfigured);
  return {
    enabled,
    sandboxOnly: upper(env.LMSPRO_PRODUCTION_ENABLED) !== 'TRUE',
    contractConfigured,
    readyForSandbox: enabled && contractConfigured,
    productionEnabled: enabled && contractConfigured && upper(env.LMSPRO_PRODUCTION_ENABLED) === 'TRUE'
  };
}
