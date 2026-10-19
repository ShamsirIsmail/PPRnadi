import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateReportDraftAction } from '@/app/actions/ai-draft';
import { transcribeAudioAction } from '@/app/actions/voice-transcribe';
import {
  resetRateLimitsForTesting,
  acquireAiSlot,
  resolveMaxTokensConfig,
  DEFAULT_MAX_TOKENS,
  MIN_CONFIG_TOKENS,
  MAX_CONFIG_TOKENS,
  REFILL_WINDOW_MS,
} from '@/lib/ai/rate-limiter';
import { resolveAiConfig } from '@/lib/ai/provider-config';
import { validateAudioSignature } from '@/lib/validators/audio-signature';
import { extractCanonicalBlockKey } from '@/lib/location/block-utils';
import { translations } from '@/lib/i18n/translations';

// Configurable DB mock state
let mockBuildingData: {
  id: string;
  name: string;
  code: string;
  total_floors: number;
  estate_id: string;
} | null = {
  id: 'building-uuid-blok-a',
  name: 'Blok A',
  code: 'BLK_A',
  total_floors: 15,
  estate_id: 'ppr-sentosa-demo',
};
let mockBuildingError: Error | null = null;

let mockZonesData: Array<{
  id: string;
  name: string;
  zone_code: string;
  floor_start?: number;
  floor_end?: number;
}> | null = [
  { id: 'zone-low', name: 'Zon Rendah (Aras 1-7)', zone_code: 'A-LOW', floor_start: 1, floor_end: 7 },
  { id: 'zone-high', name: 'Zon Tinggi (Aras 8-15)', zone_code: 'A-HIGH', floor_start: 8, floor_end: 15 },
];
let mockZonesError: Error | null = null;

// Mock Supabase Server Client & Resident Session
vi.mock('@/lib/auth/session', () => ({
  requireResident: vi.fn().mockResolvedValue({
    user: { id: 'resident-uuid-a1b2c3' },
    profile: {
      id: 'resident-uuid-a1b2c3',
      role: 'resident',
      assigned_estate_id: 'ppr-sentosa-demo',
      assigned_building_id: 'building-uuid-blok-a',
    },
  }),
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn().mockResolvedValue({
    from: (table: string) => {
      if (table === 'buildings') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: mockBuildingError ? null : mockBuildingData,
                error: mockBuildingError,
              }),
            }),
          }),
        };
      }
      if (table === 'service_zones') {
        return {
          select: () => ({
            eq: async () => ({
              data: mockZonesError ? null : mockZonesData,
              error: mockZonesError,
            }),
          }),
        };
      }
      return { select: () => ({ eq: async () => ({ data: [], error: null }) }) };
    },
  }),
}));

describe('Canonical Block Key Extraction (extractCanonicalBlockKey)', () => {
  it('normalizes building code BLK_A to A', () => {
    expect(extractCanonicalBlockKey('BLK_A')).toBe('A');
  });

  it('normalizes prefix codes like DR_BLK_A to A', () => {
    expect(extractCanonicalBlockKey('DR_BLK_A')).toBe('A');
  });

  it('normalizes spoken Malay phrase "Blok A" to A', () => {
    expect(extractCanonicalBlockKey('Blok A')).toBe('A');
  });

  it('normalizes spoken English phrase "Block A" to A', () => {
    expect(extractCanonicalBlockKey('Block A')).toBe('A');
  });

  it('normalizes single letter "A" to A', () => {
    expect(extractCanonicalBlockKey('A')).toBe('A');
  });

  it('normalizes numbered blocks like "BLK_12" and "Blok 12" to 12', () => {
    expect(extractCanonicalBlockKey('BLK_12')).toBe('12');
    expect(extractCanonicalBlockKey('Blok 12')).toBe('12');
    expect(extractCanonicalBlockKey('12')).toBe('12');
  });

  it('returns null for empty, whitespace, null, or undefined input', () => {
    expect(extractCanonicalBlockKey(null)).toBeNull();
    expect(extractCanonicalBlockKey(undefined)).toBeNull();
    expect(extractCanonicalBlockKey('')).toBeNull();
    expect(extractCanonicalBlockKey('   ')).toBeNull();
  });
});

describe('AI Provider Configuration Resolver (resolveAiConfig)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.GEMINI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.AI_PROVIDER;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('reports unconfigured when no API keys are present', () => {
    const res = resolveAiConfig();
    expect(res.isConfigured).toBe(false);
    expect(res.config).toBeUndefined();
  });

  it('rejects ambiguous setup when both keys exist but AI_PROVIDER is not set', () => {
    process.env.GEMINI_API_KEY = 'test-gemini-key';
    process.env.OPENAI_API_KEY = 'test-openai-key';

    const res = resolveAiConfig();
    expect(res.isConfigured).toBe(false);
    expect(res.error).toContain('AI_PROVIDER tidak ditetapkan');
  });

  it('correctly resolves Gemini when AI_PROVIDER=gemini and uses active gemini-2.5-flash model', () => {
    process.env.GEMINI_API_KEY = 'test-gemini-key';
    process.env.AI_PROVIDER = 'gemini';

    const res = resolveAiConfig();
    expect(res.isConfigured).toBe(true);
    expect(res.config?.provider).toBe('gemini');
    expect(res.config?.draftModel).toBe('gemini-2.5-flash');
  });

  it('correctly resolves OpenAI when AI_PROVIDER=openai and uses active gpt-4o-mini and whisper-1 models', () => {
    process.env.OPENAI_API_KEY = 'test-openai-key';
    process.env.AI_PROVIDER = 'openai';

    const res = resolveAiConfig();
    expect(res.isConfigured).toBe(true);
    expect(res.config?.provider).toBe('openai');
    expect(res.config?.draftModel).toBe('gpt-4o-mini');
    expect(res.config?.transcribeModel).toBe('whisper-1');
  });
});

describe('AI Incident Drafting Action (generateReportDraftAction)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.GEMINI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.AI_PROVIDER;
    resetRateLimitsForTesting();

    mockBuildingData = {
      id: 'building-uuid-blok-a',
      name: 'Blok A',
      code: 'BLK_A',
      total_floors: 15,
      estate_id: 'ppr-sentosa-demo',
    };
    mockBuildingError = null;

    mockZonesData = [
      { id: 'zone-low', name: 'Zon Rendah (Aras 1-7)', zone_code: 'A-LOW', floor_start: 1, floor_end: 7 },
      { id: 'zone-high', name: 'Zon Tinggi (Aras 8-15)', zone_code: 'A-HIGH', floor_start: 8, floor_end: 15 },
    ];
    mockZonesError = null;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('rejects input text shorter than 5 characters', async () => {
    const result = await generateReportDraftAction('air');
    expect(result.success).toBe(false);
    expect(result.code).toBe('VALIDATION_ERROR');
    expect(result.error).toContain('terlalu pendek');
  });

  it('rejects input text exceeding 3,000 characters', async () => {
    const longText = 'x'.repeat(3001);
    const result = await generateReportDraftAction(longText);
    expect(result.success).toBe(false);
    expect(result.code).toBe('VALIDATION_ERROR');
    expect(result.error).toContain('had maksimum 3,000 aksara');
  });

  it('returns truthful API_NOT_AVAILABLE with no fake mock when AI service is unconfigured', async () => {
    const result = await generateReportDraftAction(
      'Paip air di koridor tingkat 12 pecah dan air melimpah ke tangga'
    );
    expect(result.success).toBe(false);
    expect(result.code).toBe('API_NOT_AVAILABLE');
    expect(result.draft).toBeUndefined();
    expect(result.message).toContain('Perkhidmatan AI belum tersedia');
  });

  it('proves AI_SIMULATION_PROVIDER=true does NOT activate fake responses in runtime', async () => {
    process.env.AI_SIMULATION_PROVIDER = 'true';
    process.env.AI_PROVIDER = 'simulated';

    const result = await generateReportDraftAction(
      'Paip air di koridor tingkat 12 pecah dan air melimpah ke tangga'
    );
    expect(result.success).toBe(false);
    expect(result.code).toBe('API_NOT_AVAILABLE');
    expect(result.draft).toBeUndefined();
  });

  it('strictly enforces rate limits without bypass even when AI_SIMULATION_PROVIDER=true', async () => {
    process.env.AI_SIMULATION_PROVIDER = 'true';
    const residentId = 'resident-uuid-a1b2c3';

    // Exhaust 5 slots (RATE_LIMIT_MAX_TOKENS = 5)
    for (let i = 0; i < 5; i++) {
      const slot = acquireAiSlot(residentId);
      expect(slot.allowed).toBe(true);
      slot.release?.();
    }

    // 6th request must be rejected
    const blockedSlot = acquireAiSlot(residentId);
    expect(blockedSlot.allowed).toBe(false);
    expect(blockedSlot.code).toBe('RATE_LIMITED');
  });

  it('fails with DATABASE_ERROR when buildings query fails (no fake fallback)', async () => {
    mockBuildingError = new Error('Database connection failed');

    const result = await generateReportDraftAction('Paip pecah di tingkat 12 Blok A');
    expect(result.success).toBe(false);
    expect(result.code).toBe('DATABASE_ERROR');
    expect(result.error).toContain('Gagal mendapatkan data sah bangunan');
  });

  it('fails with DATABASE_ERROR when service_zones query fails', async () => {
    mockZonesError = new Error('Database service_zones query failed');

    const result = await generateReportDraftAction('Paip pecah di tingkat 12 Blok A');
    expect(result.success).toBe(false);
    expect(result.code).toBe('DATABASE_ERROR');
    expect(result.error).toContain('Gagal mendapatkan data sah zon perkhidmatan');
  });

  it('matches canonical block BLK_A when resident mentions "Blok A", "Block A", or "A"', async () => {
    process.env.GEMINI_API_KEY = 'test-gemini-key';
    process.env.AI_PROVIDER = 'gemini';

    const testPhrases = ['Blok A', 'Block A', 'A'];

    for (const phrase of testPhrases) {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      title: 'Paip Pecah di Koridor Tingkat 12',
                      description: 'Air melimpah dari paip pecah di tingkat 12.',
                      category: 'water_supply',
                      matched_zone_id: 'zone-high',
                      mentioned_block: phrase,
                      mentioned_floor: 12,
                      missing_fields: [],
                    }),
                  },
                ],
              },
            },
          ],
        }),
      } as unknown as Response);

      const result = await generateReportDraftAction(`Paip pecah di tingkat 12 ${phrase}`);
      expect(result.success).toBe(true);
      expect(result.draft?.blockMismatchWarning).toBeNull();
      expect(result.draft?.matchedZoneId).toBe('zone-high');
      expect(result.draft?.mentionedBlock).toBe('A');
    }
  });

  it('detects block mismatch when speech mentions another block (e.g. Blok C vs assigned BLK_A) and sets matchedZoneId to null', async () => {
    process.env.GEMINI_API_KEY = 'test-gemini-key';
    process.env.AI_PROVIDER = 'gemini';

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    title: 'Lif Rosak di Blok C',
                    description: 'Lif di Blok C tidak berfungsi.',
                    category: 'lift',
                    matched_zone_id: 'zone-high', // Should be rejected due to block mismatch
                    mentioned_block: 'Blok C',
                    mentioned_floor: 5,
                    missing_fields: [],
                  }),
                },
              ],
            },
          },
        ],
      }),
    } as unknown as Response);

    const result = await generateReportDraftAction('Lif rosak di Blok C tingkat 5');

    expect(result.success).toBe(true);
    // Matched zone must be nullified because mentioned block C does not match assigned BLK_A
    expect(result.draft?.matchedZoneId).toBeNull();
    expect(result.draft?.blockMismatchWarning).toContain('Blok C');
    expect(result.draft?.missingFields).toContain(result.draft?.blockMismatchWarning);
  });

  it('rejects an alien zone ID not recorded in database service_zones', async () => {
    process.env.GEMINI_API_KEY = 'test-gemini-key';
    process.env.AI_PROVIDER = 'gemini';

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    title: 'Lampu Tangga Terpadam',
                    description: 'Lampu tangga padam di tingkat 3.',
                    category: 'corridor_lighting',
                    matched_zone_id: 'zone-alien-unregistered-999',
                    mentioned_block: 'A',
                    mentioned_floor: 3,
                    missing_fields: [],
                  }),
                },
              ],
            },
          },
        ],
      }),
    } as unknown as Response);

    const result = await generateReportDraftAction('Lampu tangga terpadam di tingkat 3 Blok A');
    expect(result.success).toBe(true);
    expect(result.draft?.matchedZoneId).toBeNull();
  });

  it('nullifies matchedZoneId and warns if mentioned floor exceeds total building floors (e.g. 20 on 15-floor building)', async () => {
    process.env.GEMINI_API_KEY = 'test-gemini-key';
    process.env.AI_PROVIDER = 'gemini';

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    title: 'Paip Pecah',
                    description: 'Paip pecah di tingkat 20.',
                    category: 'water_supply',
                    matched_zone_id: 'zone-high',
                    mentioned_block: 'A',
                    mentioned_floor: 20,
                    missing_fields: [],
                  }),
                },
              ],
            },
          },
        ],
      }),
    } as unknown as Response);

    const result = await generateReportDraftAction('Paip pecah di tingkat 20');
    expect(result.success).toBe(true);
    expect(result.draft?.invalidFloorWarning).toContain('15 tingkat');
    expect(result.draft?.matchedZoneId).toBeNull();
    expect(result.draft?.mentionedFloor).toBeNull();
  });

  it('handles corrupted JSON response gracefully with stable error code', async () => {
    process.env.GEMINI_API_KEY = 'test-gemini-key';
    process.env.AI_PROVIDER = 'gemini';

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: 'NOT VALID JSON {{{' }] } }],
      }),
    } as unknown as Response);

    const result = await generateReportDraftAction('Paip air bocor di tangga');
    expect(result.success).toBe(false);
    expect(result.code).toBe('UPSTREAM_ERROR');
    expect(result.error).toContain('Format respons AI tidak sah');
  });

  it('handles request timeout (AbortError) and releases slot cleanly', async () => {
    process.env.GEMINI_API_KEY = 'test-gemini-key';
    process.env.AI_PROVIDER = 'gemini';

    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    global.fetch = vi.fn().mockRejectedValue(abortError);

    const result = await generateReportDraftAction('Paip air bocor di koridor');
    expect(result.success).toBe(false);
    expect(result.code).toBe('DRAFT_TIMEOUT');
    expect(result.error).toContain('AI mengambil masa lebih lama daripada biasa');
    expect(result.error).toContain('Teks anda masih disimpan');
    expect(result.rawText).toBe('Paip air bocor di koridor');

    // Verify slot is released: a subsequent call is not blocked by concurrency
    const nextSlot = acquireAiSlot('resident-uuid-a1b2c3');
    expect(nextSlot.allowed).toBe(true);
    nextSlot.release?.();
  });

  it('handles HTTP 503 high demand gracefully with SERVICE_BUSY and friendly message', async () => {
    process.env.GEMINI_API_KEY = 'test-gemini-key';
    process.env.AI_PROVIDER = 'gemini';

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
    } as unknown as Response);

    const inputTranscript = 'Lif rosak di tingkat 3 Blok A';
    const result = await generateReportDraftAction(inputTranscript);

    expect(result.success).toBe(false);
    expect(result.code).toBe('SERVICE_BUSY');
    expect(result.error).toContain('Bantuan AI sedang sibuk');
    expect(result.error).toContain('Cuba lagi sebentar nanti atau teruskan dengan menaip');
    expect(result.rawText).toBe(inputTranscript);

    // Verify slot is released cleanly
    const nextSlot = acquireAiSlot('resident-uuid-a1b2c3');
    expect(nextSlot.allowed).toBe(true);
    nextSlot.release?.();
  });

  it('enforces rate limiting when exceeding token capacity', async () => {
    for (let i = 0; i < 5; i++) {
      await generateReportDraftAction('Permintaan percubaan yang sah');
    }

    const blocked = await generateReportDraftAction('Permintaan ke-6 yang sepatutnya disekat');
    expect(blocked.success).toBe(false);
    expect(blocked.code).toBe('RATE_LIMITED');
    expect(blocked.error).toContain('Had kekerapan permintaan dicapai');
  });

  it('rejects double-clicks or overlapping concurrent draft requests with CONCURRENT_REQUEST', async () => {
    process.env.GEMINI_API_KEY = 'test-gemini-key';
    process.env.AI_PROVIDER = 'gemini';

    // Simulate an ongoing slow in-flight request by holding the slot
    const slot = acquireAiSlot('resident-uuid-a1b2c3');
    expect(slot.allowed).toBe(true);

    // Concurrent request attempted while slot is held
    const concurrentResult = await generateReportDraftAction('Permintaan kedua bertindih');
    expect(concurrentResult.success).toBe(false);
    expect(concurrentResult.code).toBe('CONCURRENT_REQUEST');
    expect(concurrentResult.error).toContain('Permintaan draf terdahulu masih diproses');
    expect(concurrentResult.rawText).toBe('Permintaan kedua bertindih');

    // Release held slot
    slot.release?.();

    // Verify subsequent request succeeds after release
    const nextSlot = acquireAiSlot('resident-uuid-a1b2c3');
    expect(nextSlot.allowed).toBe(true);
    nextSlot.release?.();
  });
});

describe('Audio Container & Signature Validation (validateAudioSignature)', () => {
  it('validates genuine WebM EBML header (0x1A 0x45 0xDF 0xA3)', () => {
    const webmHeader = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81]);
    const res = validateAudioSignature(webmHeader);
    expect(res.valid).toBe(true);
    expect(res.detectedFormat).toBe('webm');
  });

  it('validates genuine WAV RIFF header', () => {
    const wavBuffer = Buffer.alloc(16);
    wavBuffer.write('RIFF', 0, 'ascii');
    wavBuffer.write('WAVE', 8, 'ascii');
    const res = validateAudioSignature(wavBuffer);
    expect(res.valid).toBe(true);
    expect(res.detectedFormat).toBe('wav');
  });

  it('validates genuine OGG header (OggS)', () => {
    const oggBuffer = Buffer.alloc(16);
    oggBuffer.write('OggS', 0, 'ascii');
    const res = validateAudioSignature(oggBuffer);
    expect(res.valid).toBe(true);
    expect(res.detectedFormat).toBe('ogg');
  });

  it('validates genuine MP4 audio header (ftyp)', () => {
    const mp4Buffer = Buffer.alloc(16);
    mp4Buffer.write('ftyp', 4, 'ascii');
    const res = validateAudioSignature(mp4Buffer);
    expect(res.valid).toBe(true);
    expect(res.detectedFormat).toBe('mp4');
  });

  it('validates genuine MP3 header with ID3 tag', () => {
    const mp3Buffer = Buffer.alloc(16);
    mp3Buffer.write('ID3', 0, 'ascii');
    const res = validateAudioSignature(mp3Buffer);
    expect(res.valid).toBe(true);
    expect(res.detectedFormat).toBe('mp3');
  });

  it('rejects spoofed text file masquerading as audio', () => {
    const fakeAudio = Buffer.from('Hello this is a plain text file not an audio container at all');
    const res = validateAudioSignature(fakeAudio);
    expect(res.valid).toBe(false);
    expect(res.error).toContain('tidak sah');
  });
});

describe('Voice Transcription Action (transcribeAudioAction)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.GEMINI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.AI_PROVIDER;
    resetRateLimitsForTesting();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('rejects missing or empty audio file', async () => {
    const fd = new FormData();
    const result = await transcribeAudioAction(fd);
    expect(result.success).toBe(false);
    expect(result.code).toBe('VALIDATION_ERROR');
    expect(result.error).toContain('Tiada fail audio yang sah');
  });

  it('rejects audio under 1,000 bytes with AUDIO_TOO_SMALL', async () => {
    const fd = new FormData();
    const tinyBlob = new Blob([new Uint8Array(50)], { type: 'audio/webm' });
    fd.append('audio', tinyBlob, 'tiny.webm');

    const result = await transcribeAudioAction(fd);
    expect(result.success).toBe(false);
    expect(result.code).toBe('AUDIO_TOO_SMALL');
    expect(result.error).toContain('terlalu pendek');
  });

  it('rejects spoofed binary with AUDIO_INVALID_CONTAINER', async () => {
    const fd = new FormData();
    const fakeBuffer = Buffer.alloc(2000, 0x41); // 'AAAA...'
    const fakeBlob = new Blob([new Uint8Array(fakeBuffer)], { type: 'audio/webm' });
    fd.append('audio', fakeBlob, 'fake.webm');

    const result = await transcribeAudioAction(fd);
    expect(result.success).toBe(false);
    expect(result.code).toBe('AUDIO_INVALID_CONTAINER');
    expect(result.error).toContain('Format fail audio tidak sah');
  });

  it('reports truthful API_NOT_AVAILABLE with no fake mock when API keys are absent', async () => {
    const fd = new FormData();
    const validWebm = Buffer.alloc(2000);
    validWebm[0] = 0x1a;
    validWebm[1] = 0x45;
    validWebm[2] = 0xdf;
    validWebm[3] = 0xa3;

    const validBlob = new Blob([new Uint8Array(validWebm)], { type: 'audio/webm' });
    fd.append('audio', validBlob, 'test.webm');

    const result = await transcribeAudioAction(fd);
    expect(result.success).toBe(false);
    expect(result.code).toBe('API_NOT_AVAILABLE');
    expect(result.message).toContain('Perkhidmatan transkripsi suara belum tersedia');
  });

  it('proves transcribeAudioAction never returns fake transcript when AI_SIMULATION_PROVIDER=true', async () => {
    process.env.AI_SIMULATION_PROVIDER = 'true';
    process.env.AI_PROVIDER = 'simulated';

    const fd = new FormData();
    const validWebm = Buffer.alloc(2000);
    validWebm[0] = 0x1a;
    validWebm[1] = 0x45;
    validWebm[2] = 0xdf;
    validWebm[3] = 0xa3;

    const validBlob = new Blob([new Uint8Array(validWebm)], { type: 'audio/webm' });
    fd.append('audio', validBlob, 'test.webm');

    const result = await transcribeAudioAction(fd);
    expect(result.success).toBe(false);
    expect(result.code).toBe('API_NOT_AVAILABLE');
    expect(result.text).toBeUndefined();
  });

  it('handles transcription timeout (AbortError) and releases slot cleanly', async () => {
    process.env.GEMINI_API_KEY = 'test-gemini-key';
    process.env.AI_PROVIDER = 'gemini';

    const validWebm = Buffer.alloc(2000);
    validWebm[0] = 0x1a;
    validWebm[1] = 0x45;
    validWebm[2] = 0xdf;
    validWebm[3] = 0xa3;
    const validBlob = new Blob([new Uint8Array(validWebm)], { type: 'audio/webm' });
    const fd = new FormData();
    fd.append('audio', validBlob, 'test.webm');

    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    global.fetch = vi.fn().mockRejectedValue(abortError);

    const result = await transcribeAudioAction(fd);
    expect(result.success).toBe(false);
    expect(result.code).toBe('TIMEOUT');
    expect(result.error).toContain('Masa pemprosesan audio tamat');

    // Verify slot was released
    const slot = acquireAiSlot('resident-uuid-a1b2c3');
    expect(slot.allowed).toBe(true);
    slot.release?.();
  });
});

describe('Bilingual Error and Warning Localization (BM / EN)', () => {
  const allCodes = [
    'UNAUTHORIZED',
    'VALIDATION_ERROR',
    'DATABASE_ERROR',
    'RATE_LIMITED',
    'CONCURRENT_REQUEST',
    'TIMEOUT',
    'DRAFT_TIMEOUT',
    'AUDIO_TOO_SMALL',
    'AUDIO_TOO_LARGE',
    'AUDIO_INVALID_CONTAINER',
    'SERVICE_BUSY',
    'UPSTREAM_ERROR',
    'API_NOT_AVAILABLE',
    'BLOCK_MISMATCH',
    'INVALID_FLOOR',
  ] as const;

  it('provides resident-friendly Malay messages without technical stack traces for all error codes', () => {
    for (const code of allCodes) {
      const msg = translations.ms.voiceErrors[code];
      expect(msg).toBeDefined();
      expect(typeof msg).toBe('string');
      expect(msg.length).toBeGreaterThan(10);
      expect(msg).not.toMatch(/error:\s*at\s+/i); // No stack traces
      expect(msg).not.toMatch(/undefined|null|object Object/);
    }
  });

  it('provides resident-friendly English messages without technical stack traces for all error codes', () => {
    for (const code of allCodes) {
      const msg = translations.en.voiceErrors[code];
      expect(msg).toBeDefined();
      expect(typeof msg).toBe('string');
      expect(msg.length).toBeGreaterThan(10);
      expect(msg).not.toMatch(/error:\s*at\s+/i);
      expect(msg).not.toMatch(/undefined|null|object Object/);
    }
  });

  it('includes truthful privacy disclosure in both BM and EN without claiming provider-level guarantees', () => {
    expect(translations.ms.voiceReport.privacyDisclosure).toContain('tidak menyimpan fail audio anda secara kekal');
    expect(translations.en.voiceReport.privacyDisclosure).toContain('does not permanently store your audio files');
  });
});

describe('AI Rate Limiter Configuration Validation & Token Bucket Semantics', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.AI_RATE_LIMIT_MAX_TOKENS;
    resetRateLimitsForTesting();
  });

  afterEach(() => {
    process.env = originalEnv;
    resetRateLimitsForTesting();
  });

  describe('Configuration Validator (resolveMaxTokensConfig)', () => {
    it('exports standard Token Bucket constants with correct documented boundaries', () => {
      expect(MIN_CONFIG_TOKENS).toBe(1);
      expect(MAX_CONFIG_TOKENS).toBe(50);
      expect(REFILL_WINDOW_MS).toBe(60000);
    });

    it('defaults safely to 5 when configuration is missing, undefined, null, or empty string', () => {
      expect(resolveMaxTokensConfig()).toBe(DEFAULT_MAX_TOKENS);
      expect(resolveMaxTokensConfig(undefined)).toBe(DEFAULT_MAX_TOKENS);
      expect(resolveMaxTokensConfig(null)).toBe(DEFAULT_MAX_TOKENS);
      expect(resolveMaxTokensConfig('')).toBe(DEFAULT_MAX_TOKENS);
      expect(resolveMaxTokensConfig('   ')).toBe(DEFAULT_MAX_TOKENS);
    });

    it('accepts valid positive integers within the documented range (1 to 50)', () => {
      expect(resolveMaxTokensConfig('1')).toBe(1);
      expect(resolveMaxTokensConfig('5')).toBe(5);
      expect(resolveMaxTokensConfig('10')).toBe(10);
      expect(resolveMaxTokensConfig('25')).toBe(25);
      expect(resolveMaxTokensConfig('50')).toBe(50);
      expect(resolveMaxTokensConfig('  8  ')).toBe(8);
    });

    it('rejects non-numeric strings and NaN, falling back safely to default 5', () => {
      expect(resolveMaxTokensConfig('abc')).toBe(DEFAULT_MAX_TOKENS);
      expect(resolveMaxTokensConfig('NaN')).toBe(DEFAULT_MAX_TOKENS);
      expect(resolveMaxTokensConfig('undefined')).toBe(DEFAULT_MAX_TOKENS);
      expect(resolveMaxTokensConfig('true')).toBe(DEFAULT_MAX_TOKENS);
    });

    it('rejects Infinity and -Infinity, falling back safely to default 5', () => {
      expect(resolveMaxTokensConfig('Infinity')).toBe(DEFAULT_MAX_TOKENS);
      expect(resolveMaxTokensConfig('-Infinity')).toBe(DEFAULT_MAX_TOKENS);
    });

    it('rejects negative numbers, falling back safely to default 5', () => {
      expect(resolveMaxTokensConfig('-1')).toBe(DEFAULT_MAX_TOKENS);
      expect(resolveMaxTokensConfig('-5')).toBe(DEFAULT_MAX_TOKENS);
      expect(resolveMaxTokensConfig('-100')).toBe(DEFAULT_MAX_TOKENS);
    });

    it('rejects zero, falling back safely to default 5', () => {
      expect(resolveMaxTokensConfig('0')).toBe(DEFAULT_MAX_TOKENS);
    });

    it('rejects decimals / floating-point numbers, falling back safely to default 5', () => {
      expect(resolveMaxTokensConfig('3.14')).toBe(DEFAULT_MAX_TOKENS);
      expect(resolveMaxTokensConfig('0.5')).toBe(DEFAULT_MAX_TOKENS);
      expect(resolveMaxTokensConfig('5.0')).toBe(DEFAULT_MAX_TOKENS);
    });

    it('rejects mixed alphanumeric text, falling back safely to default 5 (preventing raw parseInt leniency)', () => {
      expect(resolveMaxTokensConfig('5abc')).toBe(DEFAULT_MAX_TOKENS);
      expect(resolveMaxTokensConfig('abc5')).toBe(DEFAULT_MAX_TOKENS);
      expect(resolveMaxTokensConfig('5 tokens')).toBe(DEFAULT_MAX_TOKENS);
      expect(resolveMaxTokensConfig('10px')).toBe(DEFAULT_MAX_TOKENS);
    });

    it('rejects values exceeding documented maximum limit (50), falling back safely to default 5', () => {
      expect(resolveMaxTokensConfig('51')).toBe(DEFAULT_MAX_TOKENS);
      expect(resolveMaxTokensConfig('100')).toBe(DEFAULT_MAX_TOKENS);
      expect(resolveMaxTokensConfig('99999')).toBe(DEFAULT_MAX_TOKENS);
    });
  });

  describe('Token Bucket Burst Capacity & Controlled Clock Refill', () => {
    it('allows an immediate burst up to the default 5 tokens and rejects the 6th', () => {
      const resident = 'resident-burst-test';
      const baseTime = 1000000;

      // Exhaust burst capacity (5 tokens)
      for (let i = 0; i < 5; i++) {
        const slot = acquireAiSlot(resident, baseTime);
        expect(slot.allowed).toBe(true);
        slot.release?.();
      }

      // 6th request at the same timestamp must be blocked
      const blocked = acquireAiSlot(resident, baseTime);
      expect(blocked.allowed).toBe(false);
      expect(blocked.code).toBe('RATE_LIMITED');
      // With 5 tokens over 60s, 1 token takes exactly 12s (12000ms)
      expect(blocked.retryAfterSeconds).toBe(12);
    });

    it('refills tokens proportionally using a controlled clock without losing partial credit', () => {
      const resident = 'resident-refill-test';
      const t0 = 2000000;

      // Consume all 5 tokens
      for (let i = 0; i < 5; i++) {
        const slot = acquireAiSlot(resident, t0);
        expect(slot.allowed).toBe(true);
        slot.release?.();
      }

      // Advance clock by 6,000ms (0.5 tokens refilled, still < 1 token needed)
      const halfRefilled = acquireAiSlot(resident, t0 + 6000);
      expect(halfRefilled.allowed).toBe(false);
      expect(halfRefilled.code).toBe('RATE_LIMITED');
      expect(halfRefilled.retryAfterSeconds).toBe(6);

      // Advance clock by another 6,000ms (total 12,000ms: exactly 1.0 token refilled)
      const oneRefilled = acquireAiSlot(resident, t0 + 12000);
      expect(oneRefilled.allowed).toBe(true);
      oneRefilled.release?.();

      // Immediately requesting another slot at t0 + 12000 should now be blocked
      const blockedAgain = acquireAiSlot(resident, t0 + 12000);
      expect(blockedAgain.allowed).toBe(false);
      expect(blockedAgain.code).toBe('RATE_LIMITED');

      // Advance clock by full 60,000ms from t0 + 12000 -> full bucket (5 tokens) restored
      const fullTime = t0 + 72000;
      for (let i = 0; i < 5; i++) {
        const slot = acquireAiSlot(resident, fullTime);
        expect(slot.allowed).toBe(true);
        slot.release?.();
      }
      expect(acquireAiSlot(resident, fullTime).allowed).toBe(false);
    });

    it('dynamically respects valid AI_RATE_LIMIT_MAX_TOKENS environment setting', () => {
      process.env.AI_RATE_LIMIT_MAX_TOKENS = '2';
      const resident = 'resident-custom-env';
      const now = 3000000;

      const slot1 = acquireAiSlot(resident, now);
      expect(slot1.allowed).toBe(true);
      slot1.release?.();

      const slot2 = acquireAiSlot(resident, now);
      expect(slot2.allowed).toBe(true);
      slot2.release?.();

      // 3rd must be blocked with custom capacity 2
      const slot3 = acquireAiSlot(resident, now);
      expect(slot3.allowed).toBe(false);
      expect(slot3.code).toBe('RATE_LIMITED');
    });

    it('safely falls back to default 5 when AI_RATE_LIMIT_MAX_TOKENS is invalid in environment (prevents unlimited bypass)', () => {
      process.env.AI_RATE_LIMIT_MAX_TOKENS = 'abc'; // Corrupt config
      const resident = 'resident-corrupt-env';
      const now = 4000000;

      for (let i = 0; i < 5; i++) {
        const slot = acquireAiSlot(resident, now);
        expect(slot.allowed).toBe(true);
        slot.release?.();
      }

      // 6th must still be blocked (proves no unlimited bypass!)
      const slot6 = acquireAiSlot(resident, now);
      expect(slot6.allowed).toBe(false);
      expect(slot6.code).toBe('RATE_LIMITED');
    });
  });

  describe('Concurrency Gate & Lock Release', () => {
    it('strictly enforces exactly 1 in-flight request per resident', () => {
      const resident = 'resident-concurrent-test';
      const now = 5000000;

      const slot1 = acquireAiSlot(resident, now);
      expect(slot1.allowed).toBe(true);

      // Second request before slot1 is released must be blocked with CONCURRENT_REQUEST
      const slot2 = acquireAiSlot(resident, now);
      expect(slot2.allowed).toBe(false);
      expect(slot2.code).toBe('CONCURRENT_REQUEST');
      expect(slot2.retryAfterSeconds).toBe(5);

      // Release slot 1
      slot1.release?.();

      // Now next request must be permitted
      const slot3 = acquireAiSlot(resident, now);
      expect(slot3.allowed).toBe(true);
      slot3.release?.();
    });

    it('ensures release function is idempotent and does not corrupt state on multiple calls', () => {
      const resident = 'resident-idempotent-release';
      const now = 6000000;

      const slot = acquireAiSlot(resident, now);
      expect(slot.allowed).toBe(true);

      slot.release?.();
      slot.release?.(); // Second call
      slot.release?.(); // Third call

      const nextSlot = acquireAiSlot(resident, now);
      expect(nextSlot.allowed).toBe(true);
      nextSlot.release?.();
    });
  });

  describe('Resident Isolation', () => {
    it('isolates rate limits and concurrency locks between distinct resident IDs', () => {
      const residentA = 'resident-A';
      const residentB = 'resident-B';
      const now = 7000000;

      // Exhaust Resident A
      for (let i = 0; i < 5; i++) {
        const s = acquireAiSlot(residentA, now);
        s.release?.();
      }
      expect(acquireAiSlot(residentA, now).allowed).toBe(false);

      // Resident B is completely unaffected
      const slotB = acquireAiSlot(residentB, now);
      expect(slotB.allowed).toBe(true);

      // Holding lock for B does not block A's concurrency (A is rate-limited, but not locked)
      expect(acquireAiSlot(residentB, now).code).toBe('CONCURRENT_REQUEST');
      slotB.release?.();
    });
  });
});

