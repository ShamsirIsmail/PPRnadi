/**
 * PPR NADI — Staging Security & Target Validation Utilities
 */

export const ALLOWED_STAGING_REF = 'mhtlcvvqwxkhkeqhzbrk';

export function validateStagingApiUrl(apiUrl, expectedRef = ALLOWED_STAGING_REF) {
  if (!apiUrl || typeof apiUrl !== 'string' || apiUrl.trim() === '') {
    throw new Error('STAGING_SUPABASE_URL is required and cannot be empty.');
  }

  let parsed;
  try {
    parsed = new URL(apiUrl);
  } catch (err) {
    throw new Error('STAGING_SUPABASE_URL is not a valid URL: ' + err.message);
  }

  if (parsed.protocol !== 'https:') {
    throw new Error(`Invalid protocol [${parsed.protocol}]. HTTPS is strictly required.`);
  }

  const expectedHostname = `${expectedRef}.supabase.co`;
  if (parsed.hostname.toLowerCase() !== expectedHostname) {
    throw new Error(`Hostname mismatch: expected exactly "${expectedHostname}", got "${parsed.hostname}".`);
  }

  if (parsed.username || parsed.password) {
    throw new Error('Userinfo (username/password) is forbidden in API URL.');
  }

  if (parsed.port !== '' && parsed.port !== '443') {
    throw new Error(`Non-default port [${parsed.port}] is forbidden in API URL.`);
  }

  if (parsed.pathname !== '' && parsed.pathname !== '/') {
    throw new Error(`Non-root path [${parsed.pathname}] is forbidden in API URL.`);
  }

  if (parsed.search !== '' || parsed.searchParams.size > 0) {
    throw new Error('Query string parameters are forbidden in API URL.');
  }

  if (parsed.hash !== '') {
    throw new Error('URL fragment (#) is forbidden in API URL.');
  }

  return true;
}
