#!/usr/bin/env node
/**
 * PPR NADI — Controlled Live AI Provider Smoke-Test CLI
 *
 * Requirements & Safety Guarantees:
 * 1. Independent standalone CLI: Never runs automatically in npm test or CI.
 * 2. Strict Call Bounding: Maximum 1 transcription request + 1 drafting request per run.
 * 3. Zero Database Mutations: Does not create, insert, or persist any complaint records.
 * 4. Zero Secrets Leaked: Never prints API keys, Authorization headers, or raw audio streams.
 * 5. Uses Production Resolver: Directly imports and uses resolveAiConfig() from src/lib/ai/provider-config.ts.
 * 6. Explicit User Consent: Requires `--confirm-live-call` flag to authorize any live call.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveAiConfig } from '../src/lib/ai/provider-config.ts';
import { runControlledSmokeTestCore, sanitizeOutput } from './smoke-test-core.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

// Load environment from .env.local
try {
  process.loadEnvFile(path.join(ROOT_DIR, '.env.local'));
} catch {
  // Ignored if missing or already loaded
}

const FIXTURE_PATH = path.join(ROOT_DIR, 'tests', 'fixtures', 'synthetic-voice-sample.wav');

async function main() {
  console.log('==============================================================================');
  console.log('PPR NADI — CONTROLLED LIVE AI PROVIDER SMOKE TEST');
  console.log('==============================================================================');
  console.log('[SKOP UJIAN]');
  console.log('Skrip ini menguji sambungan dan ketepatan hasil penyedia AI secara terkawal.');
  console.log('Ia TIDAK membuktikan keseluruhan aliran pelayar, authentication, atau');
  console.log('penghantaran borang berfungsi.');
  console.log('==============================================================================');

  const resolved = resolveAiConfig();
  const confirmLiveCall = process.argv.includes('--confirm-live-call');

  let audioBuffer = Buffer.alloc(0);
  if (fs.existsSync(FIXTURE_PATH)) {
    audioBuffer = fs.readFileSync(FIXTURE_PATH);
  }

  // If configuration is incomplete or conflicting
  if (!resolved.isConfigured || !resolved.config) {
    console.log('\n[Status Konfigurasi AI Semasa]');
    console.log(`- Status Kunci API : TIDAK DITEMUI / TIDAK LENGKAP`);
    if (resolved.error) {
      console.log(`- Mesej Konfigurasi: ${resolved.error}`);
    }
    console.log('\n------------------------------------------------------------------------------');
    console.log('STATUS: [BLOCKED] API key belum tersedia dalam konfigurasi server tempatan.');
    console.log('------------------------------------------------------------------------------');
    console.log('\nPanduan Persediaan Selamat untuk Pengguna:');
    console.log('1. Buka fail `.env.local` dalam direktori akar projek `c:\\Dev\\ppr-nadi`.');
    console.log('2. Masukkan konfigurasi provider yang ingin digunakan:');
    console.log('   Untuk Google Gemini:');
    console.log('     AI_PROVIDER=gemini');
    console.log('     GEMINI_API_KEY=kunci_api_anda_di_sini');
    console.log('   ATAU untuk OpenAI:');
    console.log('     AI_PROVIDER=openai');
    console.log('     OPENAI_API_KEY=kunci_api_anda_di_sini');
    console.log('\nPERINGATAN KESELAMATAN KRITIKAL:');
    console.log('- JANGAN gunakan awalan NEXT_PUBLIC_ (kunci tidak boleh didedahkan kepada browser).');
    console.log('- JANGAN menampal kunci API dalam chat atau berkongsi secara terbuka.');
    console.log('- Selepas menyimpan `.env.local`, jalankan semula skrip ini.');
    console.log('------------------------------------------------------------------------------\n');
    process.exit(0);
  }

  const result = await runControlledSmokeTestCore({
    config: resolved,
    audioBuffer,
    confirmLiveCall,
    fetchImpl: globalThis.fetch,
    logger: console,
  });

  if (!result.success && result.status === 'FAIL') {
    process.exit(1);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('\n[FATAL ERROR]', sanitizeOutput(err.message));
  process.exit(1);
});
