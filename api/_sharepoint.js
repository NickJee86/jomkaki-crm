import { sharePointConfigurationStatus } from './_integrations.js';

const clean = value => String(value ?? '').trim();

export function assertSharePointCustomerStorageReady(env = process.env) {
  const status = sharePointConfigurationStatus(env);
  if (!status.credentialsConfigured) throw new Error('SharePoint application credentials are not configured');
  if (!status.writeVerified) {
    throw Object.assign(new Error('Customer-document storage is blocked until the controlled SharePoint write test is completed and SHAREPOINT_SITE_WRITE_VERIFIED_AT is recorded'), { code: 'SHAREPOINT_WRITE_VERIFICATION_REQUIRED' });
  }
  // This is the existing administrator-recorded deployment gate, not a new
  // claim that credentials or site permissions were verified by this call.
  return status;
}

export function selectSharePointDocumentLibrary(drives = [], configuredLibraryName = '') {
  const explicitName = clean(configuredLibraryName), requestedName = explicitName || 'Documents';
  const named = drives.find(drive => clean(drive?.id) && clean(drive?.name).toLowerCase() === requestedName.toLowerCase());
  if (named) return named;
  if (explicitName) throw new Error(`Configured SharePoint document library "${explicitName}" was not found; refusing to use a different library`);
  const defaultLibrary = drives.find(drive => clean(drive?.id) && drive.driveType === 'documentLibrary');
  if (!defaultLibrary) throw new Error('SharePoint document library was not found');
  return defaultLibrary;
}
