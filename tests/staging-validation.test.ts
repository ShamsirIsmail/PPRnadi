import { describe, it, expect } from 'vitest';
import { validateStagingApiUrl, ALLOWED_STAGING_REF } from '../scripts/staging-validation.mjs';
import { validateStagingProjectRef, validateStagingDatabaseUrl } from '../scripts/migrate-staging.mjs';

describe('Staging API URL & Target Security Validation', () => {
  it('accepts canonical Supabase HTTPS staging URL', () => {
    expect(validateStagingApiUrl('https://mhtlcvvqwxkhkeqhzbrk.supabase.co')).toBe(true);
    expect(validateStagingApiUrl('https://mhtlcvvqwxkhkeqhzbrk.supabase.co/')).toBe(true);
  });

  it('rejects HTTP protocol', () => {
    expect(() => validateStagingApiUrl('http://mhtlcvvqwxkhkeqhzbrk.supabase.co')).toThrow(/HTTPS is strictly required/i);
  });

  it('rejects another project reference', () => {
    expect(() => validateStagingApiUrl('https://otherproject123.supabase.co')).toThrow(/Hostname mismatch/i);
  });

  it('rejects domain with extra suffix / phishing subdomain', () => {
    expect(() => validateStagingApiUrl('https://mhtlcvvqwxkhkeqhzbrk.supabase.co.attacker.com')).toThrow(/Hostname mismatch/i);
    expect(() => validateStagingApiUrl('https://mhtlcvvqwxkhkeqhzbrk-other.supabase.co')).toThrow(/Hostname mismatch/i);
  });

  it('rejects project reference disguised in path or query parameters', () => {
    expect(() => validateStagingApiUrl('https://evil.com/mhtlcvvqwxkhkeqhzbrk')).toThrow(/Hostname mismatch/i);
    expect(() => validateStagingApiUrl('https://evil.com?ref=mhtlcvvqwxkhkeqhzbrk')).toThrow(/Hostname mismatch/i);
  });

  it('rejects URL with userinfo embedded', () => {
    expect(() => validateStagingApiUrl('https://admin:pass@mhtlcvvqwxkhkeqhzbrk.supabase.co')).toThrow(/Userinfo/i);
  });

  it('rejects non-standard ports', () => {
    expect(() => validateStagingApiUrl('https://mhtlcvvqwxkhkeqhzbrk.supabase.co:8443')).toThrow(/Non-default port/i);
    expect(() => validateStagingApiUrl('https://mhtlcvvqwxkhkeqhzbrk.supabase.co:3000')).toThrow(/Non-default port/i);
  });

  it('rejects URLs with query strings or hash fragments', () => {
    expect(() => validateStagingApiUrl('https://mhtlcvvqwxkhkeqhzbrk.supabase.co/?apiKey=123')).toThrow(/Query string/i);
    expect(() => validateStagingApiUrl('https://mhtlcvvqwxkhkeqhzbrk.supabase.co/#fragment')).toThrow(/fragment/i);
  });

  it('strictly validates STAGING_PROJECT_REF in migration runner', () => {
    expect(validateStagingProjectRef('mhtlcvvqwxkhkeqhzbrk')).toBe('mhtlcvvqwxkhkeqhzbrk');
    expect(() => validateStagingProjectRef('')).toThrow(/required and cannot be empty/i);
    expect(() => validateStagingProjectRef('wrong-ref')).toThrow(/does not match/i);
    expect(() => validateStagingProjectRef(null)).toThrow(/required/i);
    expect(() => validateStagingProjectRef(undefined)).toThrow(/required/i);
  });

  it('strictly validates STAGING_DATABASE_URL against loopback and project ref', () => {
    // Rejects local/loopback
    expect(() => validateStagingDatabaseUrl('postgresql://postgres:pass@localhost:5432/postgres', ALLOWED_STAGING_REF)).toThrow(/local or loopback/i);
    expect(() => validateStagingDatabaseUrl('postgresql://postgres:pass@127.0.0.1:5432/postgres', ALLOWED_STAGING_REF)).toThrow(/local or loopback/i);

    // Rejects other project
    expect(() => validateStagingDatabaseUrl('postgresql://postgres:pass@db.other-project.supabase.co:5432/postgres', ALLOWED_STAGING_REF)).toThrow(/does not match staging project/i);

    // Accepts direct connection
    const direct = validateStagingDatabaseUrl(`postgresql://postgres:SecretPass@db.${ALLOWED_STAGING_REF}.supabase.co:5432/postgres`, ALLOWED_STAGING_REF);
    expect(direct.isDirect).toBe(true);

    // Accepts pooler connection with EXACT username
    const pooler = validateStagingDatabaseUrl(`postgresql://postgres.${ALLOWED_STAGING_REF}:SecretPass@aws-0-ap-southeast-1.pooler.supabase.co:6543/postgres`, ALLOWED_STAGING_REF);
    expect(pooler.isPooler).toBe(true);

    // Rejects pooler connection if username is missing or partial
    expect(() => validateStagingDatabaseUrl(`postgresql://postgres:SecretPass@aws-0-ap-southeast-1.pooler.supabase.co:6543/postgres`, ALLOWED_STAGING_REF)).toThrow(/does not match staging project/i);
  });
});
