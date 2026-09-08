// Every test worker starts offline, including builds that have live credentials.
// Behavioral tests must install an explicit mock before exercising API handlers.
export function isolateTestEnvironment(env = process.env) {
  for (const key of Object.keys(env)) {
    if (/^(?:CRM_|GOOGLE_|JOMKAKI_|WHATSAPP_|META_|LMSPRO_|SHAREPOINT_|NOTION_|OPENAI_)/.test(key)
      || ['VERCEL_ENV', 'VERCEL_OIDC_TOKEN', 'CRON_SECRET'].includes(key)) delete env[key];
  }
  return env;
}
isolateTestEnvironment();

globalThis.fetch = async () => {
  throw new Error('Live network access is disabled in tests. Install an explicit fetch mock.');
};
