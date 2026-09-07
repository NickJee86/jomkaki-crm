// Every test worker starts offline, including builds that have live credentials.
// Behavioral tests must install an explicit mock before exercising API handlers.
globalThis.fetch = async () => {
  throw new Error('Live network access is disabled in tests. Install an explicit fetch mock.');
};
