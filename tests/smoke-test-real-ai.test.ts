import { describe, it, expect, vi } from 'vitest';
import {
  validateAndClassifyEndpoint,
  verifyTranscriptionFacts,
  verifyDraftResponse,
  sanitizeOutput,
  runControlledSmokeTestCore,
} from '../scripts/smoke-test-core.mjs';

describe('PPR NADI — AI Smoke-Test Offline Verification Suite', () => {
  // ---------------------------------------------------------------------------
  // 1. ENDPOINT SAFETY & CLASSIFICATION
  // ---------------------------------------------------------------------------
  describe('Endpoint Safety & Classification', () => {
    it('accepts official Gemini endpoint with exact HTTPS hostname and default port', () => {
      const res = validateAndClassifyEndpoint('https://generativelanguage.googleapis.com', 'gemini');
      expect(res.valid).toBe(true);
      expect(res.type).toBe('OFFICIAL');
      expect(res.origin).toBe('https://generativelanguage.googleapis.com');
    });

    it('accepts official OpenAI endpoint with exact HTTPS hostname and default port', () => {
      const res = validateAndClassifyEndpoint('https://api.openai.com', 'openai');
      expect(res.valid).toBe(true);
      expect(res.type).toBe('OFFICIAL');
      expect(res.origin).toBe('https://api.openai.com');
    });

    it('accepts local loopback mock endpoints on various ports and classifies as MOCK', () => {
      const res1 = validateAndClassifyEndpoint('http://127.0.0.1:3928', 'gemini');
      expect(res1.valid).toBe(true);
      expect(res1.type).toBe('MOCK');

      const res2 = validateAndClassifyEndpoint('http://localhost:3000', 'openai');
      expect(res2.valid).toBe(true);
      expect(res2.type).toBe('MOCK');

      const res3 = validateAndClassifyEndpoint('http://[::1]:8080', 'gemini');
      expect(res3.valid).toBe(true);
      expect(res3.type).toBe('MOCK');
    });

    it('rejects spoofed or subdomain-impersonating hostnames as CUSTOM', () => {
      const res1 = validateAndClassifyEndpoint('https://evil-generativelanguage.googleapis.com', 'gemini');
      expect(res1.valid).toBe(false);
      expect(res1.type).toBe('CUSTOM');

      const res2 = validateAndClassifyEndpoint('https://generativelanguage.googleapis.com.attacker.com', 'gemini');
      expect(res2.valid).toBe(false);
      expect(res2.type).toBe('CUSTOM');

      const res3 = validateAndClassifyEndpoint('https://api.openai.com.phishing.net', 'openai');
      expect(res3.valid).toBe(false);
      expect(res3.type).toBe('CUSTOM');
    });

    it('rejects custom unverified third-party proxy endpoints from receiving real keys', () => {
      const res = validateAndClassifyEndpoint('https://ai-proxy.mycompany.org', 'gemini');
      expect(res.valid).toBe(false);
      expect(res.type).toBe('CUSTOM');
      expect(res.error).toContain('Endpoint custom');
    });

    it('rejects insecure HTTP for official Google/OpenAI endpoints', () => {
      const res = validateAndClassifyEndpoint('http://generativelanguage.googleapis.com', 'gemini');
      expect(res.valid).toBe(false);
      expect(res.type).toBe('CUSTOM');
    });

    it('rejects non-standard ports on official endpoints', () => {
      const res = validateAndClassifyEndpoint('https://generativelanguage.googleapis.com:8443', 'gemini');
      expect(res.valid).toBe(false);
      expect(res.type).toBe('CUSTOM');
    });

    it('rejects URLs containing embedded user credentials', () => {
      const res = validateAndClassifyEndpoint('https://user:pass@generativelanguage.googleapis.com', 'gemini');
      expect(res.valid).toBe(false);
      expect(res.type).toBe('INVALID');
      expect(res.error).toContain('bukti kelayakan pengguna');
    });

    it('rejects base URLs with embedded search query parameters', () => {
      const res = validateAndClassifyEndpoint('https://generativelanguage.googleapis.com?inject=evil', 'gemini');
      expect(res.valid).toBe(false);
      expect(res.type).toBe('INVALID');
      expect(res.error).toContain('parameter query');
    });

    it('rejects base URLs with hash fragments', () => {
      const res = validateAndClassifyEndpoint('https://generativelanguage.googleapis.com#section', 'gemini');
      expect(res.valid).toBe(false);
      expect(res.type).toBe('INVALID');
      expect(res.error).toContain('hash fragment');
    });
  });

  // ---------------------------------------------------------------------------
  // 2. SECRET SANITIZATION & REDACTION
  // ---------------------------------------------------------------------------
  describe('Secret Sanitization', () => {
    it('redacts active API key from error messages and text', () => {
      const activeKey = 'AIzaSySecretTestKey12345';
      const raw = `Error fetching from https://example.com/api?key=${activeKey}&other=1`;
      const sanitized = sanitizeOutput(raw, activeKey);
      expect(sanitized).not.toContain(activeKey);
      expect(sanitized).toContain('[REDACTED_API_KEY]');
    });

    it('redacts Authorization Bearer tokens and standard key patterns', () => {
      const raw = 'Request header: Authorization: Bearer sk-proj-1234567890abcdefghijklmn';
      const sanitized = sanitizeOutput(raw);
      expect(sanitized).not.toContain('sk-proj-1234567890abcdefghijklmn');
      expect(sanitized).toContain('Bearer [REDACTED]');
    });
  });

  // ---------------------------------------------------------------------------
  // 3. TRANSCRIPTION FACT VERIFICATION
  // ---------------------------------------------------------------------------
  describe('Transcription Fact Verification', () => {
    it('passes for exact fixture facts: "Lif rosak di tingkat tiga Blok A"', () => {
      const res = verifyTranscriptionFacts('Lif rosak di tingkat tiga Blok A');
      expect(res.passed).toBe(true);
      expect(res.facts.hasLift).toBe(true);
      expect(res.facts.hasFloor3).toBe(true);
      expect(res.facts.hasBlockA).toBe(true);
      expect(res.facts.hasContradiction).toBe(false);
    });

    it('passes for natural language and bilingual variations', () => {
      const resBM = verifyTranscriptionFacts('Aduan: lif di aras 3 blok a telah rosak sejak semalam.');
      expect(resBM.passed).toBe(true);

      const resEN = verifyTranscriptionFacts('Elevator is broken on the 3rd floor Block A.');
      expect(resEN.passed).toBe(true);
    });

    it('fails for empty or missing transcription', () => {
      const res = verifyTranscriptionFacts('');
      expect(res.passed).toBe(false);
      expect(res.errors.length).toBeGreaterThan(0);
    });

    it('rejects loose false positives like standalone letter "a" without Block A', () => {
      // "Lampu koridor rosak a" contains ' a' but no Block A
      const res = verifyTranscriptionFacts('Lampu koridor tingkat tiga rosak a');
      expect(res.facts.hasBlockA).toBe(false);
      expect(res.passed).toBe(false);
    });

    it('fails when floor 3 is omitted', () => {
      const res = verifyTranscriptionFacts('Lif rosak di Blok A');
      expect(res.passed).toBe(false);
      expect(res.facts.hasFloor3).toBe(false);
    });

    it('fails when lift is omitted', () => {
      const res = verifyTranscriptionFacts('Paip air bocor di tingkat tiga Blok A');
      expect(res.passed).toBe(false);
      expect(res.facts.hasLift).toBe(false);
    });

    it('fails when contradictory block is mentioned', () => {
      const res = verifyTranscriptionFacts('Lif rosak di tingkat tiga Blok B');
      expect(res.passed).toBe(false);
      expect(res.facts.hasContradiction).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // 4. DRAFT VERIFICATION & ANTI-HALLUCINATION
  // ---------------------------------------------------------------------------
  describe('Draft Verification & Anti-Hallucination', () => {
    const validDraftObj = {
      title: 'Lif Rosak Tingkat 3',
      description: 'Lif di Blok A tingkat 3 mengalami kerosakan.',
      category: 'lift',
      mentioned_block: 'A',
      mentioned_floor: 3,
      missing_fields: [],
    };

    it('passes for valid structured draft matching fixture facts', () => {
      const res = verifyDraftResponse(JSON.stringify(validDraftObj));
      expect(res.passed).toBe(true);
      expect(res.needsManualReview).toBe(false);
      expect(res.errors).toHaveLength(0);
    });

    it('fails for malformed JSON string', () => {
      const res = verifyDraftResponse('{ invalid json');
      expect(res.passed).toBe(false);
      expect(res.errors[0]).toContain('Format JSON tidak sah');
    });

    it('fails when category is not lift', () => {
      const invalid = { ...validDraftObj, category: 'water_supply' };
      const res = verifyDraftResponse(invalid);
      expect(res.passed).toBe(false);
      expect(res.errors.some((e) => e.includes('Kategori'))).toBe(true);
    });

    it('fails when floor is not 3', () => {
      const invalid = { ...validDraftObj, mentioned_floor: 2 };
      const res = verifyDraftResponse(invalid);
      expect(res.passed).toBe(false);
      expect(res.errors.some((e) => e.includes('Aras'))).toBe(true);
    });

    it('fails when block is not A', () => {
      const invalid = { ...validDraftObj, mentioned_block: 'B' };
      const res = verifyDraftResponse(invalid);
      expect(res.passed).toBe(false);
      expect(res.errors.some((e) => e.includes('Blok'))).toBe(true);
    });

    it('fails when AI invents an unmentioned apartment unit number', () => {
      const hallucinated = {
        ...validDraftObj,
        description: 'Lif rosak di tingkat 3 Blok A berhampiran Unit 3-12.',
      };
      const res = verifyDraftResponse(hallucinated);
      expect(res.passed).toBe(false);
      expect(res.errors.some((e) => e.includes('nombor unit'))).toBe(true);
    });

    it('flags NEEDS_MANUAL_REVIEW if unexpected extraneous claims are detected', () => {
      const suspicious = {
        ...validDraftObj,
        description: 'Lif rosak di tingkat 3 Blok A dan terdapat kebakaran kecil berhampiran.',
      };
      const res = verifyDraftResponse(suspicious);
      expect(res.passed).toBe(true);
      expect(res.needsManualReview).toBe(true);
      expect(res.warnings.length).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // 5. WORKFLOW EXECUTION, CONFIRMATION GUARD & BOUNDED CALLS
  // ---------------------------------------------------------------------------
  describe('Workflow Execution & Bounded Calls', () => {
    const mockAudio = Buffer.from('RIFF....WAVEfmt ....data....');

    it('makes exactly 0 calls if confirmation flag is false', async () => {
      const mockFetch = vi.fn();
      const mockLogger = { log: vi.fn(), error: vi.fn() };

      const res = await runControlledSmokeTestCore({
        config: {
          isConfigured: true,
          config: {
            provider: 'gemini',
            apiKey: 'test-key',
            baseUrl: 'http://127.0.0.1:3928',
            transcribeModel: 'gemini-2.5-flash',
            draftModel: 'gemini-2.5-flash',
          },
        },
        audioBuffer: mockAudio,
        confirmLiveCall: false, // NO CONFIRMATION
        fetchImpl: mockFetch,
        logger: mockLogger,
      });

      expect(res.status).toBe('PENDING_CONFIRMATION');
      expect(res.callCounts.transcription).toBe(0);
      expect(res.callCounts.draft).toBe(0);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns CONFIG_BLOCKED when configuration is missing or incomplete', async () => {
      const mockFetch = vi.fn();
      const mockLogger = { log: vi.fn(), error: vi.fn() };

      const res = await runControlledSmokeTestCore({
        config: { isConfigured: false, error: 'GEMINI_API_KEY belum dikonfigurasikan' },
        audioBuffer: mockAudio,
        confirmLiveCall: true,
        fetchImpl: mockFetch,
        logger: mockLogger,
      });

      expect(res.status).toBe('CONFIG_BLOCKED');
      expect(res.callCounts.transcription).toBe(0);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('rejects custom external endpoints and aborts with 0 calls', async () => {
      const mockFetch = vi.fn();
      const mockLogger = { log: vi.fn(), error: vi.fn() };

      const res = await runControlledSmokeTestCore({
        config: {
          isConfigured: true,
          config: {
            provider: 'gemini',
            apiKey: 'test-key',
            baseUrl: 'https://attacker-proxy.com',
            transcribeModel: 'gemini-2.5-flash',
            draftModel: 'gemini-2.5-flash',
          },
        },
        audioBuffer: mockAudio,
        confirmLiveCall: true,
        fetchImpl: mockFetch,
        logger: mockLogger,
      });

      expect(res.status).toBe('FAIL');
      expect(res.error).toContain('Endpoint custom');
      expect(res.callCounts.transcription).toBe(0);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('stops immediately after failed transcription: 1 transcription call and exactly 0 draft calls', async () => {
      const mockLogger = { log: vi.fn(), error: vi.fn() };

      // Return transcription that fails fact check (mentions wrong facility)
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: 'Lampu koridor rosak di tingkat 1 Blok B' }] } }],
        }),
      });

      const res = await runControlledSmokeTestCore({
        config: {
          isConfigured: true,
          config: {
            provider: 'gemini',
            apiKey: 'test-key',
            baseUrl: 'http://127.0.0.1:3928',
            transcribeModel: 'gemini-2.5-flash',
            draftModel: 'gemini-2.5-flash',
          },
        },
        audioBuffer: mockAudio,
        confirmLiveCall: true,
        fetchImpl: mockFetch,
        logger: mockLogger,
      });

      expect(res.status).toBe('FAIL');
      expect(res.callCounts.transcription).toBe(1);
      expect(res.callCounts.draft).toBe(0); // DRAFT WAS NOT CALLED!
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(res.error).toContain('Semakan fakta transkripsi gagal');
    });

    it('labels local loopback mock success strictly as MOCK_PASS (never LIVE_PASS)', async () => {
      const mockLogger = { log: vi.fn(), error: vi.fn() };

      const mockFetch = vi
        .fn()
        // Transcription response
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [{ content: { parts: [{ text: 'Lif rosak di tingkat tiga Blok A' }] } }],
          }),
        })
        // Draft response
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        title: 'Lif Rosak Blok A',
                        description: 'Lif di Blok A tingkat 3 rosak.',
                        category: 'lift',
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
        });

      const res = await runControlledSmokeTestCore({
        config: {
          isConfigured: true,
          config: {
            provider: 'gemini',
            apiKey: 'mock-key',
            baseUrl: 'http://127.0.0.1:3928',
            transcribeModel: 'gemini-2.5-flash',
            draftModel: 'gemini-2.5-flash',
          },
        },
        audioBuffer: mockAudio,
        confirmLiveCall: true,
        fetchImpl: mockFetch,
        logger: mockLogger,
      });

      expect(res.success).toBe(true);
      expect(res.status).toBe('MOCK_PASS'); // EXPLICITLY MOCK_PASS
      expect(res.callCounts.transcription).toBe(1);
      expect(res.callCounts.draft).toBe(1);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('labels official endpoint success as LIVE_PASS', async () => {
      const mockLogger = { log: vi.fn(), error: vi.fn() };

      const mockFetch = vi
        .fn()
        // Transcription response
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            text: 'Lif rosak di tingkat tiga Blok A',
          }),
        })
        // Draft response
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    title: 'Lif Rosak Blok A',
                    description: 'Lif di Blok A tingkat 3 rosak tidak boleh beroperasi.',
                    category: 'lift',
                    mentioned_block: 'A',
                    mentioned_floor: 3,
                    missing_fields: [],
                  }),
                },
              },
            ],
          }),
        });

      const res = await runControlledSmokeTestCore({
        config: {
          isConfigured: true,
          config: {
            provider: 'openai',
            apiKey: 'sk-test-mock-key-1234567890',
            baseUrl: 'https://api.openai.com',
            transcribeModel: 'whisper-1',
            draftModel: 'gpt-4o-mini',
          },
        },
        audioBuffer: mockAudio,
        confirmLiveCall: true,
        fetchImpl: mockFetch,
        logger: mockLogger,
      });

      expect(res.success).toBe(true);
      expect(res.status).toBe('LIVE_PASS');
      expect(res.callCounts.transcription).toBe(1);
      expect(res.callCounts.draft).toBe(1);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('sanitizes API keys when provider returns an HTTP error body', async () => {
      const mockLogger = { log: vi.fn(), error: vi.fn() };
      const secretKey = 'AIzaSyTopSecretKey987654321';

      const mockFetch = vi.fn().mockRejectedValueOnce(
        new Error(`Failed to fetch from https://generativelanguage.googleapis.com/v1beta?key=${secretKey}`)
      );

      const res = await runControlledSmokeTestCore({
        config: {
          isConfigured: true,
          config: {
            provider: 'gemini',
            apiKey: secretKey,
            baseUrl: 'https://generativelanguage.googleapis.com',
            transcribeModel: 'gemini-2.5-flash',
            draftModel: 'gemini-2.5-flash',
          },
        },
        audioBuffer: mockAudio,
        confirmLiveCall: true,
        fetchImpl: mockFetch,
        logger: mockLogger,
      });

      expect(res.status).toBe('FAIL');
      expect(res.error).not.toContain(secretKey);
      expect(res.error).toContain('[REDACTED_API_KEY]');
    });
  });
});
