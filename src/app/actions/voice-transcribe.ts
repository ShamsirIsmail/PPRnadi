'use server';

import { requireResident } from '../../lib/auth/session';
import { resolveAiConfig } from '../../lib/ai/provider-config';
import { isAiBlocked, recordBlockedAiAttempt } from '../../lib/ai/ai-guard';
import { acquireAiSlot } from '../../lib/ai/rate-limiter';
import { validateAudioSignature } from '../../lib/validators/audio-signature';

export type VoiceTranscribeErrorCode =
  | 'UNAUTHORIZED'
  | 'VALIDATION_ERROR'
  | 'AUDIO_TOO_SMALL'
  | 'AUDIO_TOO_LARGE'
  | 'AUDIO_INVALID_CONTAINER'
  | 'RATE_LIMITED'
  | 'CONCURRENT_REQUEST'
  | 'TIMEOUT'
  | 'SERVICE_BUSY'
  | 'UPSTREAM_ERROR'
  | 'API_NOT_AVAILABLE';

export interface TranscribeAudioResult {
  success: boolean;
  code: 'SUCCESS' | VoiceTranscribeErrorCode;
  text?: string;
  message?: string;
  error?: string;
  retryAfterSeconds?: number;
}

const MAX_AUDIO_BYTES = 5 * 1024 * 1024; // 5 MB maximum
const MIN_AUDIO_BYTES = 1000; // 1 KB minimum (prevents zero-length empty files)

/**
 * Server Action: Transcribes recorded audio blob into text verbatim.
 *
 * Security & Reliability Safeguards:
 * 1. Authentication: Resident role required.
 * 2. Magic Bytes Validation: Verifies real WebM, WAV, OGG, MP4 or MP3 container headers.
 * 3. Rate Limiting & Concurrency: Per-user token bucket and in-flight mutex.
 * 4. Timeout & Secrets: 25-second AbortController timeout; active models resolved securely.
 * 5. Ephemeral In-Memory Only: Never persisted to disk or Supabase Storage.
 */
export async function transcribeAudioAction(formData: FormData): Promise<TranscribeAudioResult> {
  // 1. Authenticate Resident
  let user: { id: string };
  try {
    const auth = await requireResident();
    user = auth.user;
  } catch {
    return {
      success: false,
      code: 'UNAUTHORIZED',
      error: 'Pengesahan akaun penduduk gagal. Sila log masuk semula.',
    };
  }

  // 2. Validate Runtime Input
  const file = formData.get('audio') as File | null;
  if (!file || typeof file.size !== 'number' || typeof file.arrayBuffer !== 'function') {
    return {
      success: false,
      code: 'VALIDATION_ERROR',
      error: 'Tiada fail audio yang sah diterima oleh pelayan.',
    };
  }

  if (file.size < MIN_AUDIO_BYTES) {
    return {
      success: false,
      code: 'AUDIO_TOO_SMALL',
      error: 'Fail audio terlalu pendek atau tidak mengandungi data rakaman.',
    };
  }

  if (file.size > MAX_AUDIO_BYTES) {
    return {
      success: false,
      code: 'AUDIO_TOO_LARGE',
      error: 'Saiz fail audio melebihi had maksimum 5 MB.',
    };
  }

  // 3. Read Buffer & Validate Magic Bytes Container Signature
  let buffer: Buffer;
  try {
    const arrayBuffer = await file.arrayBuffer();
    buffer = Buffer.from(arrayBuffer);
  } catch {
    return {
      success: false,
      code: 'VALIDATION_ERROR',
      error: 'Gagal membaca aliran data fail audio.',
    };
  }

  const signatureResult = validateAudioSignature(buffer);
  if (!signatureResult.valid) {
    return {
      success: false,
      code: 'AUDIO_INVALID_CONTAINER',
      error: signatureResult.error || 'Tandatangan fail audio tidak sah.',
    };
  }

  // 4. Rate Limiting & Concurrency Check
  const rateLimit = acquireAiSlot(user.id);
  if (!rateLimit.allowed) {
    if (rateLimit.code === 'CONCURRENT_REQUEST') {
      return {
        success: false,
        code: 'CONCURRENT_REQUEST',
        error: 'Permintaan audio terdahulu masih diproses. Sila tunggu sebentar.',
      };
    }
    return {
      success: false,
      code: 'RATE_LIMITED',
      retryAfterSeconds: rateLimit.retryAfterSeconds,
      error: `Had kekerapan permintaan audio dicapai. Sila tunggu ${rateLimit.retryAfterSeconds || 15} saat sebelum mencuba lagi.`,
    };
  }

  const releaseSlot = rateLimit.release || (() => {});

  try {
    // 5. Resolve AI Provider Configuration
    const aiConfigResult = resolveAiConfig();
    if (!aiConfigResult.isConfigured || !aiConfigResult.config) {
      return {
        success: false,
        code: 'API_NOT_AVAILABLE',
        message: 'Perkhidmatan transkripsi suara belum tersedia pada pelayan.',
      };
    }

    const { provider, apiKey, baseUrl, transcribeModel } = aiConfigResult.config;

    // 6. Execute Transcription with AbortController Timeout (25s)
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), 25000);

    let transcribedText = '';

    try {
      if (isAiBlocked()) {
        recordBlockedAiAttempt('voice-transcribe:dispatch');
        return {
          success: false,
          code: 'API_NOT_AVAILABLE',
          message: 'TEST_GUARD_BLOCKED: Panggilan penyedia AI disekat oleh pengawal ujian pelayan.',
        };
      }

      if (provider === 'gemini') {
        const mimeType = file.type || `audio/${signatureResult.detectedFormat || 'webm'}`;
        const url = `${baseUrl}/v1beta/models/${encodeURIComponent(transcribeModel)}:generateContent?key=${apiKey}`;

        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    text: 'Transcribe the spoken words in this audio recording verbatim into text. The speaker may speak in Bahasa Melayu or English (or a natural Malaysian mix of both). Do not add preamble, translations, explanations, or commentary. Output ONLY the transcribed text.',
                  },
                  {
                    inlineData: {
                      mimeType,
                      data: buffer.toString('base64'),
                    },
                  },
                ],
              },
            ],
            generationConfig: {
              temperature: 0.1,
              maxOutputTokens: 1000,
            },
          }),
          signal: abortController.signal,
        });

        if (!res.ok) {
          const isBusy = res.status === 503 || res.status === 429;
          return {
            success: false,
            code: isBusy ? 'SERVICE_BUSY' : 'UPSTREAM_ERROR',
            error: isBusy
              ? 'Bantuan AI sedang sibuk. Cuba lagi sebentar nanti atau teruskan dengan menaip.'
              : 'Perkhidmatan transkripsi suara menghadapi ralat pemprosesan.',
          };
        }

        const resData = await res.json();
        transcribedText =
          resData?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
      } else if (provider === 'openai') {
        const mimeType = file.type || `audio/${signatureResult.detectedFormat || 'webm'}`;
        const ext = signatureResult.detectedFormat || 'webm';
        const whisperFormData = new FormData();
        whisperFormData.append(
          'file',
          new Blob([new Uint8Array(buffer)], { type: mimeType }),
          `recording.${ext}`
        );
        whisperFormData.append('model', transcribeModel);
        whisperFormData.append(
          'prompt',
          'PPR NADI perumahan awam Kuala Lumpur. Masalah lif, paip air, lampu koridor.'
        );

        const res = await fetch(`${baseUrl}/v1/audio/transcriptions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
          body: whisperFormData,
          signal: abortController.signal,
        });

        if (!res.ok) {
          const isBusy = res.status === 503 || res.status === 429;
          return {
            success: false,
            code: isBusy ? 'SERVICE_BUSY' : 'UPSTREAM_ERROR',
            error: isBusy
              ? 'Bantuan AI sedang sibuk. Cuba lagi sebentar nanti atau teruskan dengan menaip.'
              : 'Perkhidmatan transkripsi suara menghadapi ralat pemprosesan.',
          };
        }

        const resData = await res.json();
        transcribedText = (resData?.text || '').trim();
      }
    } finally {
      clearTimeout(timeoutId);
    }

    if (!transcribedText) {
      return {
        success: false,
        code: 'UPSTREAM_ERROR',
        error: 'Tiada pertuturan yang jelas dikesan dalam fail audio.',
      };
    }

    return {
      success: true,
      code: 'SUCCESS',
      text: transcribedText,
    };
  } catch (err: unknown) {
    const isAbort = (err as Error)?.name === 'AbortError';
    return {
      success: false,
      code: isAbort ? 'TIMEOUT' : 'UPSTREAM_ERROR',
      error: isAbort
        ? 'Masa pemprosesan audio tamat (timeout). Sila cuba lagi dengan rakaman yang lebih pendek.'
        : 'Ralat semasa memproses fail audio.',
    };
  } finally {
    releaseSlot();
  }
}
