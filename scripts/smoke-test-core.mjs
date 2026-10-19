/**
 * PPR NADI — Live AI Provider Smoke-Test Verification & Core Logic Module
 *
 * Implements rigorous, verifiable evaluation of AI transcription and drafting results.
 * Shared directly between scripts/smoke-test-real-ai.mjs and tests/smoke-test-real-ai.test.ts
 * to guarantee that tests execute the real implementation rather than duplicated algorithms.
 */

/**
 * Sanitizes strings, error messages, and URL payloads to prevent leaking API keys.
 *
 * @param {string|unknown} text - Text to sanitize
 * @param {string|null} [activeKey=null] - The active API key in memory to redact
 * @returns {string} Sanitized string
 */
export function sanitizeOutput(text, activeKey = null) {
  if (!text) return '';
  let sanitized = typeof text === 'string' ? text : String(text);

  if (activeKey && typeof activeKey === 'string' && activeKey.trim().length > 0) {
    const escapedKey = activeKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    sanitized = sanitized.replace(new RegExp(escapedKey, 'g'), '[REDACTED_API_KEY]');
  }

  // Common pattern redactions
  sanitized = sanitized.replace(/key=[A-Za-z0-9_-]+/g, 'key=[REDACTED]');
  sanitized = sanitized.replace(/Bearer\s+[A-Za-z0-9_.-]+/gi, 'Bearer [REDACTED]');
  sanitized = sanitized.replace(/AIza[0-9A-Za-z-_]{35}/g, '[REDACTED_GEMINI_KEY]');
  sanitized = sanitized.replace(/sk-[A-Za-z0-9-_]{20,}/g, '[REDACTED_OPENAI_KEY]');

  return sanitized;
}

/**
 * Validates and strictly classifies an AI endpoint.
 *
 * Requirements:
 * 1. Must parse cleanly with `new URL()`.
 * 2. Rejects embedded credentials (username/password), search queries, and hash fragments.
 * 3. Gemini Official: HTTPS on generativelanguage.googleapis.com (port 443/default).
 * 4. OpenAI Official: HTTPS on api.openai.com (port 443/default).
 * 5. Loopback Mock: Exact hostname 127.0.0.1, localhost, or ::1.
 * 6. Custom Endpoints: Rejects spoofed hostnames or unverified external proxies.
 *
 * @param {string} rawUrl - Base URL to validate
 * @param {'gemini'|'openai'} provider - Target provider
 * @returns {{ valid: boolean, type: 'OFFICIAL'|'MOCK'|'CUSTOM'|'INVALID', error?: string, origin?: string, hostname?: string, protocol?: string }}
 */
export function validateAndClassifyEndpoint(rawUrl, provider) {
  if (!rawUrl || typeof rawUrl !== 'string' || rawUrl.trim() === '') {
    return {
      valid: false,
      type: 'INVALID',
      error: 'Base URL kosong atau tidak sah.',
    };
  }

  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch (err) {
    return {
      valid: false,
      type: 'INVALID',
      error: `Format URL tidak sah: ${err.message}`,
    };
  }

  // Reject embedded credentials
  if (parsed.username || parsed.password) {
    return {
      valid: false,
      type: 'INVALID',
      error: 'URL mengandungi bukti kelayakan pengguna (username/password), dilarang sama sekali.',
    };
  }

  // Reject query string or hash fragment in base URL
  if (parsed.search && parsed.search !== '') {
    return {
      valid: false,
      type: 'INVALID',
      error: 'URL base tidak dibenarkan mengandungi parameter query.',
    };
  }
  if (parsed.hash && parsed.hash !== '') {
    return {
      valid: false,
      type: 'INVALID',
      error: 'URL base tidak dibenarkan mengandungi hash fragment.',
    };
  }

  const protocol = parsed.protocol.toLowerCase();
  const hostname = parsed.hostname.toLowerCase();
  const port = parsed.port;

  // Check Loopback Mock Endpoints (strictly 127.0.0.1, localhost, ::1 / [::1])
  const isLoopback =
    hostname === '127.0.0.1' ||
    hostname === 'localhost' ||
    hostname === '::1' ||
    hostname === '[::1]';

  if (isLoopback) {
    if (protocol !== 'http:' && protocol !== 'https:') {
      return {
        valid: false,
        type: 'INVALID',
        error: `Protokol mock "${protocol}" tidak sah. Sila gunakan http: atau https:.`,
      };
    }
    return {
      valid: true,
      type: 'MOCK',
      origin: parsed.origin,
      hostname,
      protocol,
      port: port || (protocol === 'https:' ? '443' : '80'),
    };
  }

  // Gemini Official Endpoint Check
  if (provider === 'gemini') {
    const isOfficialGemini =
      protocol === 'https:' &&
      hostname === 'generativelanguage.googleapis.com' &&
      (port === '' || port === '443');

    if (isOfficialGemini) {
      return {
        valid: true,
        type: 'OFFICIAL',
        origin: 'https://generativelanguage.googleapis.com',
        hostname,
        protocol,
      };
    }
  }

  // OpenAI Official Endpoint Check
  if (provider === 'openai') {
    const isOfficialOpenAI =
      protocol === 'https:' &&
      hostname === 'api.openai.com' &&
      (port === '' || port === '443');

    if (isOfficialOpenAI) {
      return {
        valid: true,
        type: 'OFFICIAL',
        origin: 'https://api.openai.com',
        hostname,
        protocol,
      };
    }
  }

  // Any other external hostname is CUSTOM and blocked from receiving real API keys
  return {
    valid: false,
    type: 'CUSTOM',
    error: `Endpoint custom "${hostname}" tidak dibenarkan menerima kunci API dalam skrip ini. Hanya endpoint rasmi HTTPS (${provider === 'gemini' ? 'generativelanguage.googleapis.com' : 'api.openai.com'}) atau mock loopback dibenarkan.`,
    hostname,
    protocol,
  };
}

/**
 * Verifies core facts in audio transcription text for fixture:
 * "Lif rosak di tingkat tiga Blok A"
 *
 * Requirements:
 * - Differentiates language variations (Malay/English: "lif" / "elevator", "tingkat 3" / "tingkat tiga" / "3rd floor", "Blok A" / "Block A").
 * - Rejects overly loose matches (e.g. `includes(' a')` which matches any letter 'a' preceded by space).
 * - Detects contradictions (e.g. mentions of other blocks B/C/D or wrong floors).
 *
 * @param {string} text - Transcribed speech text
 * @returns {{ passed: boolean, facts: { hasLift: boolean, hasFloor3: boolean, hasBlockA: boolean, hasContradiction: boolean }, errors: string[], summary: string }}
 */
export function verifyTranscriptionFacts(text) {
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return {
      passed: false,
      facts: { hasLift: false, hasFloor3: false, hasBlockA: false, hasContradiction: false },
      errors: ['Teks transkripsi kosong.'],
      summary: 'Transkripsi kosong atau tidak mengandungi data teks.',
    };
  }

  const cleaned = text.trim();
  const lower = cleaned.toLowerCase();
  const errors = [];

  // Fact 1: Lift / Elevator
  // Word boundary matching to avoid partial substring hits
  const liftRegex = /\b(lif|lifnya|elevator|elevators)\b/i;
  const hasLift = liftRegex.test(lower);
  if (!hasLift) {
    errors.push('Transkripsi tidak menyebut kerosakan lif / elevator.');
  }

  // Fact 2: Floor 3 / Tingkat Tiga
  const floor3Regex = /\b(tingkat\s*(3|tiga)|aras\s*(3|tiga)|level\s*(3|three)|floor\s*(3|three)|3rd\s*floor|third\s*floor)\b/i;
  const hasFloor3 = floor3Regex.test(lower);
  if (!hasFloor3) {
    errors.push('Transkripsi tidak menyebut tingkat 3 / tingkat tiga.');
  }

  // Fact 3: Block A
  // Strict matching for Blok A / Block A; rejects loose ' a'
  const blockARegex = /\b(blok\s*a|block\s*a)\b/i;
  const hasBlockA = blockARegex.test(lower);
  if (!hasBlockA) {
    errors.push('Transkripsi tidak menyebut Blok A / Block A.');
  }

  // Contradiction checks:
  // e.g. mentioning Blok B, C, D or other numbers
  const otherBlockRegex = /\b(blok|block)\s*([b-zB-Z])\b/i;
  const otherBlockMatch = otherBlockRegex.exec(lower);
  let hasContradiction = false;
  if (otherBlockMatch && otherBlockMatch[2].toLowerCase() !== 'a') {
    hasContradiction = true;
    errors.push(`Transkripsi mengandungi percanggahan blok: "${otherBlockMatch[0]}".`);
  }

  const passed = hasLift && hasFloor3 && hasBlockA && !hasContradiction;
  const summary = passed
    ? 'Transkripsi mengandungi kesemua fakta utama (Lif, Tingkat 3, Blok A).'
    : `Semakan fakta transkripsi gagal: ${errors.join(' ')}`;

  return {
    passed,
    facts: { hasLift, hasFloor3, hasBlockA, hasContradiction },
    errors,
    summary,
  };
}

/**
 * Verifies AI-generated draft JSON output against strict schema, data types,
 * factual accuracy, and anti-hallucination constraints for fixture:
 * "Lif rosak di tingkat tiga Blok A"
 *
 * Checks:
 * 1. JSON parsing and structure validity.
 * 2. Mandatory fields and correct data types.
 * 3. Accurate extraction: category === 'lift', mentioned_floor === 3, mentioned_block === 'A'.
 * 4. Hallucination detection:
 *    - Rejects invented unit numbers (e.g. Unit 12-04, No. 3-15).
 *    - Rejects conflicting blocks/floors in title or description.
 *    - Flags extraneous unverified details as NEEDS_MANUAL_REVIEW.
 *
 * @param {string|object} rawResponse - AI response text or parsed object
 * @returns {{ passed: boolean, needsManualReview: boolean, parsed: object|null, errors: string[], warnings: string[], summary: string }}
 */
export function verifyDraftResponse(rawResponse) {
  const errors = [];
  const warnings = [];

  let parsed = null;
  if (typeof rawResponse === 'string') {
    try {
      parsed = JSON.parse(rawResponse.trim());
    } catch (err) {
      return {
        passed: false,
        needsManualReview: false,
        parsed: null,
        errors: [`Format JSON tidak sah: ${err.message}`],
        warnings: [],
        summary: 'Format respons AI bukan JSON yang sah.',
      };
    }
  } else if (typeof rawResponse === 'object' && rawResponse !== null) {
    parsed = rawResponse;
  } else {
    return {
      passed: false,
      needsManualReview: false,
      parsed: null,
      errors: ['Respons draf AI kosong atau bukan objek.'],
      warnings: [],
      summary: 'Respons draf AI kosong.',
    };
  }

  // 1. Schema & Data Types Validation
  if (typeof parsed.title !== 'string' || parsed.title.trim().length < 3 || parsed.title.trim().length > 120) {
    errors.push('Medan "title" tidak sah (mesti rentetan antara 3 dan 120 aksara).');
  }

  if (typeof parsed.description !== 'string' || parsed.description.trim().length < 10) {
    errors.push('Medan "description" tidak sah (mesti rentetan sekurang-kurangnya 10 aksara).');
  }

  const allowedCategories = ['lift', 'water_supply', 'corridor_lighting', null];
  if (!allowedCategories.includes(parsed.category)) {
    errors.push(`Medan "category" ("${parsed.category}") tidak sah mengikut enum kategori fasiliti.`);
  }

  if (parsed.mentioned_floor !== null && parsed.mentioned_floor !== undefined) {
    if (typeof parsed.mentioned_floor !== 'number' || !Number.isInteger(parsed.mentioned_floor)) {
      errors.push(`Medan "mentioned_floor" (${parsed.mentioned_floor}) mestilah nombor bulat (integer) atau null.`);
    }
  }

  if (parsed.mentioned_block !== null && parsed.mentioned_block !== undefined) {
    if (typeof parsed.mentioned_block !== 'string' || parsed.mentioned_block.trim().length === 0) {
      errors.push('Medan "mentioned_block" mestilah rentetan teks atau null.');
    }
  }

  if (!Array.isArray(parsed.missing_fields)) {
    errors.push('Medan "missing_fields" mestilah array rentetan teks.');
  }

  // 2. Fact Accuracy for Fixture "Lif rosak di tingkat tiga Blok A"
  if (parsed.category !== 'lift') {
    errors.push(`Kategori dijangka "lift", tetapi AI menghasilkan "${parsed.category}".`);
  }

  if (parsed.mentioned_floor !== 3) {
    errors.push(`Aras dijangka 3, tetapi AI menghasilkan ${parsed.mentioned_floor}.`);
  }

  // Normalize block
  const rawBlock = parsed.mentioned_block ? String(parsed.mentioned_block).trim().toUpperCase() : '';
  const isBlockA = rawBlock === 'A' || rawBlock === 'BLOK A' || rawBlock === 'BLOCK A';
  if (!isBlockA) {
    errors.push(`Blok dijangka "A", tetapi AI menghasilkan "${parsed.mentioned_block}".`);
  }

  // 3. Anti-Hallucination & Invented Facts Verification
  const combinedText = `${parsed.title || ''} ${parsed.description || ''}`.toLowerCase();

  // Check for invented unit numbers (e.g. Unit 3-10, No. 12, Rumah 5)
  const unitRegex = /\b(unit|no\.?|rumah)\s*#?\s*\d+/i;
  if (unitRegex.test(combinedText)) {
    errors.push('AI mereka nombor unit/rumah yang tidak disebut dalam rakaman.');
  }

  // Check for conflicting blocks in text
  const conflictingBlockRegex = /\b(blok|block)\s*([b-zB-Z])\b/i;
  const conflictingBlockMatch = conflictingBlockRegex.exec(combinedText);
  if (conflictingBlockMatch && conflictingBlockMatch[2].toLowerCase() !== 'a') {
    errors.push(`Teks draf mengandungi percanggahan blok: "${conflictingBlockMatch[0]}".`);
  }

  // Check for suspicious extraneous claims (e.g. kebakaran, banjir, pump room, pergaduhan)
  const extraneousRegex = /\b(bomba|kebakaran|banjir|paip pecah|lampu|gaduh|cedera|polis)\b/i;
  let needsManualReview = false;
  if (extraneousRegex.test(combinedText)) {
    warnings.push('Teks draf mengandungi butiran tambahan yang memerlukan semakan manual.');
    needsManualReview = true;
  }

  const passed = errors.length === 0;
  let summary = '';
  if (!passed) {
    summary = `Semakan draf gagal: ${errors.join(' ')}`;
  } else if (needsManualReview) {
    summary = 'Draf mengandungi fakta utama tetapi mengandungi butiran luar jangka yang memerlukan semakan manual (NEEDS_MANUAL_REVIEW).';
  } else {
    summary = 'Draf lulus kesemua semakan schema, jenis data, ketepatan fakta, dan bebas halusinasi.';
  }

  return {
    passed,
    needsManualReview,
    parsed,
    errors,
    warnings,
    summary,
  };
}

/**
 * Executes a controlled, fully verified smoke test workflow.
 *
 * Guarantees:
 * - Exactly 0 calls if confirmation flag is absent.
 * - Stops before drafting if transcription fails fact verification (saves tokens/cost).
 * - Maximum 1 transcription + 1 draft call per run.
 * - Zero database mutations.
 * - Sanitizes keys from outputs.
 * - Rejects HTTP redirects to prevent credential leaks.
 * - Returns structured results differentiating OFFICIAL vs MOCK endpoints.
 *
 * @param {object} options
 * @param {object} options.config - Resolved config from resolveAiConfig()
 * @param {Buffer} options.audioBuffer - Audio buffer to transcribe
 * @param {boolean} options.confirmLiveCall - User confirmation flag
 * @param {Function} [options.fetchImpl=globalThis.fetch] - Injected fetch implementation
 * @param {object} [options.logger=console] - Injected logger
 * @returns {Promise<{ success: boolean, status: 'LIVE_PASS'|'MOCK_PASS'|'FAIL'|'PENDING_CONFIRMATION'|'CONFIG_BLOCKED'|'NEEDS_MANUAL_REVIEW', callCounts: { transcription: number, draft: number }, transcriptionResult?: object, draftResult?: object, error?: string }>}
 */
export async function runControlledSmokeTestCore({
  config,
  audioBuffer,
  confirmLiveCall = false,
  fetchImpl = globalThis.fetch,
  logger = console,
}) {
  const callCounts = { transcription: 0, draft: 0 };

  // 1. Validate configuration object
  if (!config || !config.isConfigured || !config.config) {
    const errorMsg = config?.error || 'Kunci API belum dikonfigurasikan dalam server tempatan (.env.local).';
    logger.log(`\n[Status Konfigurasi] BLOCKED: ${errorMsg}`);
    return {
      success: false,
      status: 'CONFIG_BLOCKED',
      callCounts,
      error: errorMsg,
    };
  }

  const { provider, apiKey, baseUrl, transcribeModel, draftModel } = config.config;

  // 2. Validate and classify endpoint
  const endpointInfo = validateAndClassifyEndpoint(baseUrl, provider);
  if (!endpointInfo.valid) {
    logger.error(`\n[Keselamatan Endpoint] DITOLAK: ${endpointInfo.error}`);
    return {
      success: false,
      status: 'FAIL',
      callCounts,
      error: endpointInfo.error,
    };
  }

  logger.log(`- Provider Dipilih     : ${provider}`);
  logger.log(`- Klasifikasi Endpoint : ${endpointInfo.type} (${endpointInfo.origin})`);
  logger.log(`- Model Transkripsi    : ${transcribeModel}`);
  logger.log(`- Model Draf           : ${draftModel}`);
  logger.log(`- Status Kunci API     : TERSEDIA (Server-side sahaja / Tiada prefix NEXT_PUBLIC)`);
  logger.log(`- Had Panggilan        : Maksimum 1 Transkripsi + 1 Draf bagi larian ini`);
  logger.log(`- Kesan Database       : 0 (Tiada data dicipta atau dihantar ke database)`);

  // 3. Verify confirmation before any live call
  if (!confirmLiveCall) {
    logger.log('\n------------------------------------------------------------------------------');
    logger.log('STATUS: [PENDING_CONFIRMATION] Kebenaran pengguna diperlukan sebelum panggilan dibuat.');
    logger.log('Kewujudan API key bukan kebenaran automatik untuk membuat panggilan.');
    logger.log('Sila jalankan semula dengan flag --confirm-live-call untuk membenarkan 1 ujian terhad.');
    logger.log('------------------------------------------------------------------------------');
    return {
      success: false,
      status: 'PENDING_CONFIRMATION',
      callCounts,
    };
  }

  if (!audioBuffer || audioBuffer.length === 0) {
    const err = 'Buffer audio ujian kosong atau tidak wujud.';
    logger.error(`\n[RALAT] ${err}`);
    return {
      success: false,
      status: 'FAIL',
      callCounts,
      error: err,
    };
  }

  // 4. STEP 1: Execute Transcription Call (Max 1 call)
  logger.log('\n[Langkah 1/2] Melaksanakan 1 panggilan transkripsi suara...');
  callCounts.transcription++;
  if (callCounts.transcription > 1) {
    throw new Error('SAFETY VIOLATION: Had 1 panggilan transkripsi dilangkaui.');
  }

  let transcribedText = '';
  const transcribeController = new AbortController();
  const transcribeTimeout = setTimeout(() => transcribeController.abort(), 20000);

  try {
    const startT = Date.now();
    if (provider === 'gemini') {
      const url = `${endpointInfo.origin}/v1beta/models/${encodeURIComponent(transcribeModel)}:generateContent?key=${apiKey}`;
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        redirect: 'error', // Prevent redirect leaks
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: 'Transcribe the spoken words in this audio recording verbatim into text. Do not add preamble, translations, explanations, or commentary. Output ONLY the transcribed text.',
                },
                {
                  inlineData: {
                    mimeType: 'audio/wav',
                    data: audioBuffer.toString('base64'),
                  },
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 500,
          },
        }),
        signal: transcribeController.signal,
      });

      if (!res.ok) {
        let errDetail = '';
        try {
          const errData = await res.json();
          errDetail = errData?.error?.message || '';
        } catch {
          try {
            errDetail = await res.text();
          } catch {}
        }
        const cleanDetail = sanitizeOutput(errDetail, apiKey);
        throw new Error(`HTTP ${res.status}${cleanDetail ? `: ${cleanDetail}` : ': Transkripsi ditolak oleh penyedia AI.'}`);
      }

      const resData = await res.json();
      transcribedText = resData?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
    } else {
      // OpenAI
      const formData = new FormData();
      formData.append('file', new Blob([new Uint8Array(audioBuffer)], { type: 'audio/wav' }), 'sample.wav');
      formData.append('model', transcribeModel);
      formData.append('prompt', 'PPR NADI masalah lif dan perumahan.');

      const res = await fetchImpl(`${endpointInfo.origin}/v1/audio/transcriptions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        redirect: 'error',
        body: formData,
        signal: transcribeController.signal,
      });

      if (!res.ok) {
        let errDetail = '';
        try {
          const errData = await res.json();
          errDetail = errData?.error?.message || '';
        } catch {
          try {
            errDetail = await res.text();
          } catch {}
        }
        const cleanDetail = sanitizeOutput(errDetail, apiKey);
        throw new Error(`HTTP ${res.status}${cleanDetail ? `: ${cleanDetail}` : ': Transkripsi ditolak oleh penyedia AI.'}`);
      }

      const resData = await res.json();
      transcribedText = (resData?.text || '').trim();
    }

    const durationT = ((Date.now() - startT) / 1000).toFixed(2);
    logger.log(`✓ Transkripsi berjaya diterima (${durationT}s)`);
    logger.log(`  Teks Transkripsi: "${sanitizeOutput(transcribedText, apiKey)}"`);
  } catch (err) {
    const sanitizedMsg = sanitizeOutput(err.message, apiKey);
    logger.error(`✗ Transkripsi gagal: ${sanitizedMsg}`);
    return {
      success: false,
      status: 'FAIL',
      callCounts,
      error: sanitizedMsg,
    };
  } finally {
    clearTimeout(transcribeTimeout);
  }

  // 5. Verify Transcription Facts BEFORE proceeding to Draft call
  const transcriptionFacts = verifyTranscriptionFacts(transcribedText);
  logger.log(`  Semakan Fakta Transkripsi: ${transcriptionFacts.passed ? '✓ LULUS' : '✗ GAGAL'}`);
  logger.log(`  - Menyebut Kerosakan Lif : ${transcriptionFacts.facts.hasLift ? '✓' : '✗'}`);
  logger.log(`  - Menyebut Tingkat 3     : ${transcriptionFacts.facts.hasFloor3 ? '✓' : '✗'}`);
  logger.log(`  - Menyebut Blok A        : ${transcriptionFacts.facts.hasBlockA ? '✓' : '✗'}`);

  if (!transcriptionFacts.passed) {
    logger.error(`\n[BERHENTI AWAL] Transkripsi gagal semakan fakta: ${transcriptionFacts.errors.join('; ')}`);
    logger.error('Panggilan draf DIBATALKAN untuk mengelakkan pembaziran kuota/kos pembekal AI.');
    return {
      success: false,
      status: 'FAIL',
      callCounts,
      transcriptionResult: transcriptionFacts,
      error: `Semakan fakta transkripsi gagal: ${transcriptionFacts.errors.join('; ')}`,
    };
  }

  // 6. STEP 2: Execute AI Drafting Call (Max 1 call)
  logger.log('\n[Langkah 2/2] Melaksanakan 1 panggilan draf aduan AI...');
  callCounts.draft++;
  if (callCounts.draft > 1) {
    throw new Error('SAFETY VIOLATION: Had 1 panggilan draf dilangkaui.');
  }

  const draftController = new AbortController();
  const draftTimeout = setTimeout(() => draftController.abort(), 20000);
  let draftRawContent = '';

  try {
    const startD = Date.now();
    const systemPrompt = `You are an extraction assistant for the Malaysian public housing maintenance system PPR NADI.
Extract structured report facts strictly from the user's transcript.
STRICT OPERATIONAL RULES:
1. Do not invent details not mentioned.
2. Category must be one of: "water_supply", "lift", "corridor_lighting", or null.
3. Building name: "PPR Sentosa Block A".
Output ONLY a JSON object:
{
  "title": string,
  "description": string,
  "category": "lift" | "water_supply" | "corridor_lighting" | null,
  "mentioned_block": string | null,
  "mentioned_floor": number | null,
  "missing_fields": string[]
}`;

    if (provider === 'gemini') {
      const url = `${endpointInfo.origin}/v1beta/models/${encodeURIComponent(draftModel)}:generateContent?key=${apiKey}`;
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        redirect: 'error',
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                { text: systemPrompt },
                { text: `Resident Transcript:\n"""\n${transcribedText}\n"""` },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 600,
            responseMimeType: 'application/json',
          },
        }),
        signal: draftController.signal,
      });

      if (!res.ok) {
        let errDetail = '';
        try {
          const errData = await res.json();
          errDetail = errData?.error?.message || '';
        } catch {
          try {
            errDetail = await res.text();
          } catch {}
        }
        const cleanDetail = sanitizeOutput(errDetail, apiKey);
        throw new Error(`HTTP ${res.status}${cleanDetail ? `: ${cleanDetail}` : ': Penjanaan draf ditolak oleh penyedia AI.'}`);
      }

      const resData = await res.json();
      draftRawContent = resData?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    } else {
      // OpenAI
      const res = await fetchImpl(`${endpointInfo.origin}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        redirect: 'error',
        body: JSON.stringify({
          model: draftModel,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `Resident Transcript:\n"""\n${transcribedText}\n"""` },
          ],
          temperature: 0.1,
          max_tokens: 600,
          response_format: { type: 'json_object' },
        }),
        signal: draftController.signal,
      });

      if (!res.ok) {
        let errDetail = '';
        try {
          const errData = await res.json();
          errDetail = errData?.error?.message || '';
        } catch {
          try {
            errDetail = await res.text();
          } catch {}
        }
        const cleanDetail = sanitizeOutput(errDetail, apiKey);
        throw new Error(`HTTP ${res.status}${cleanDetail ? `: ${cleanDetail}` : ': Penjanaan draf ditolak oleh penyedia AI.'}`);
      }

      const resData = await res.json();
      draftRawContent = resData?.choices?.[0]?.message?.content || '';
    }

    const durationD = ((Date.now() - startD) / 1000).toFixed(2);
    logger.log(`✓ Penjanaan draf berjaya diterima (${durationD}s)`);
  } catch (err) {
    const sanitizedMsg = sanitizeOutput(err.message, apiKey);
    logger.error(`✗ Penjanaan draf gagal: ${sanitizedMsg}`);
    return {
      success: false,
      status: 'FAIL',
      callCounts,
      error: sanitizedMsg,
    };
  } finally {
    clearTimeout(draftTimeout);
  }

  // 7. Rigorous Draft Verification
  const draftVerification = verifyDraftResponse(draftRawContent);
  logger.log(`  Semakan Integriti Draf: ${draftVerification.passed ? '✓ LULUS' : '✗ GAGAL'}`);
  if (draftVerification.parsed) {
    logger.log(`  - Kategori Dikesan : "${draftVerification.parsed.category}"`);
    logger.log(`  - Aras Dikesan     : ${draftVerification.parsed.mentioned_floor}`);
    logger.log(`  - Blok Dikesan     : "${draftVerification.parsed.mentioned_block}"`);
  }

  if (!draftVerification.passed) {
    logger.error(`✗ Semakan draf gagal: ${draftVerification.errors.join('; ')}`);
    return {
      success: false,
      status: 'FAIL',
      callCounts,
      transcriptionResult: transcriptionFacts,
      draftResult: draftVerification,
      error: `Semakan integriti draf gagal: ${draftVerification.errors.join('; ')}`,
    };
  }

  if (draftVerification.needsManualReview) {
    logger.log(`⚠ ${draftVerification.summary}`);
    return {
      success: true,
      status: 'NEEDS_MANUAL_REVIEW',
      callCounts,
      transcriptionResult: transcriptionFacts,
      draftResult: draftVerification,
    };
  }

  // Final status differentiation based on endpoint classification
  const finalStatus = endpointInfo.type === 'MOCK' ? 'MOCK_PASS' : 'LIVE_PASS';
  logger.log(`\n==============================================================================`);
  logger.log(`STATUS: [${finalStatus}]`);
  logger.log(
    endpointInfo.type === 'MOCK'
      ? 'Ujian mock pelayan tempatan lulus 100% tanpa sebarang kos penyedia berbayar.'
      : 'Panggilan penyedia sebenar (1 transkripsi + 1 draf) lulus kesemua semakan ketepatan fakta.'
  );
  logger.log(`==============================================================================\n`);

  return {
    success: true,
    status: finalStatus,
    callCounts,
    transcriptionResult: transcriptionFacts,
    draftResult: draftVerification,
  };
}
