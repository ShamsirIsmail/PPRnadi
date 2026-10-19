/**
 * Centralized resolution and validation for AI provider and model configurations.
 * Guarantees server-side secret isolation and rejects ambiguous multi-key setups.
 */

export type AiProviderType = 'gemini' | 'openai';

export interface ResolvedAiConfig {
  provider: AiProviderType;
  apiKey: string;
  baseUrl: string;
  draftModel: string;
  transcribeModel: string;
}

export interface AiConfigResult {
  isConfigured: boolean;
  config?: ResolvedAiConfig;
  error?: string;
}

// Active models with verified text and audio capabilities
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
const DEFAULT_OPENAI_DRAFT_MODEL = 'gpt-4o-mini';
const DEFAULT_OPENAI_TRANSCRIBE_MODEL = 'whisper-1';

const DEFAULT_GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com';
const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com';

import { isAiBlocked, recordBlockedAiAttempt } from './ai-guard';

/**
 * Resolves the active AI provider and model configuration.
 * Never leaks the API key in error messages or logs.
 */
export function resolveAiConfig(): AiConfigResult {
  if (isAiBlocked()) {
    recordBlockedAiAttempt('resolveAiConfig');
    return {
      isConfigured: false,
      error: 'TEST_GUARD_BLOCKED: Panggilan penyedia AI disekat sepenuhnya oleh pengawal ujian pelayan.',
    };
  }

  const geminiKey = process.env.GEMINI_API_KEY?.trim();
  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  const explicitProvider = process.env.AI_PROVIDER?.trim().toLowerCase();

  // If both keys exist but provider is not explicitly designated, reject ambiguous resolution
  if (geminiKey && openaiKey && !explicitProvider) {
    return {
      isConfigured: false,
      error:
        'Kedua-dua kunci API (Gemini & OpenAI) wujud serentak tetapi AI_PROVIDER tidak ditetapkan. Sila tetapkan AI_PROVIDER=gemini atau AI_PROVIDER=openai dalam konfigurasi pelayan.',
    };
  }

  let selectedProvider: AiProviderType | null = null;

  if (explicitProvider) {
    if (explicitProvider === 'gemini') {
      if (!geminiKey) {
        return {
          isConfigured: false,
          error: 'AI_PROVIDER ditetapkan kepada "gemini" tetapi GEMINI_API_KEY belum dikonfigurasikan.',
        };
      }
      selectedProvider = 'gemini';
    } else if (explicitProvider === 'openai') {
      if (!openaiKey) {
        return {
          isConfigured: false,
          error: 'AI_PROVIDER ditetapkan kepada "openai" tetapi OPENAI_API_KEY belum dikonfigurasikan.',
        };
      }
      selectedProvider = 'openai';
    } else {
      return {
        isConfigured: false,
        error: `Nilai AI_PROVIDER "${explicitProvider}" tidak sah. Sila gunakan "gemini" atau "openai".`,
      };
    }
  } else if (geminiKey) {
    selectedProvider = 'gemini';
  } else if (openaiKey) {
    selectedProvider = 'openai';
  }

  if (!selectedProvider) {
    return {
      isConfigured: false,
    };
  }

  if (selectedProvider === 'gemini') {
    const draftModel = process.env.AI_MODEL?.trim() || process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
    const transcribeModel = process.env.AI_TRANSCRIBE_MODEL?.trim() || draftModel;
    const baseUrl = process.env.GEMINI_BASE_URL?.trim() || DEFAULT_GEMINI_BASE_URL;
    return {
      isConfigured: true,
      config: {
        provider: 'gemini',
        apiKey: geminiKey!,
        baseUrl,
        draftModel,
        transcribeModel,
      },
    };
  }

  const draftModel = process.env.AI_MODEL?.trim() || process.env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_DRAFT_MODEL;
  const transcribeModel = process.env.AI_TRANSCRIBE_MODEL?.trim() || DEFAULT_OPENAI_TRANSCRIBE_MODEL;
  const baseUrl = process.env.OPENAI_BASE_URL?.trim() || DEFAULT_OPENAI_BASE_URL;

  return {
    isConfigured: true,
    config: {
      provider: 'openai',
      apiKey: openaiKey!,
      baseUrl,
      draftModel,
      transcribeModel,
    },
  };
}
