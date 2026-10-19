/**
 * PPR NADI — Explainable Priority Recommendations
 * Strict TypeScript types for AI Fact Extraction, Rule-Based Evaluation, and Manager Decisions.
 */

export type PriorityTier = 'immediate_review' | 'high_priority' | 'standard_review';

export type ManagerDecisionTier = PriorityTier | 'needs_more_info';

export type FactStatus = 'reported' | 'verified' | 'unknown';

export type SourceType = 'resident_transcript' | 'official_record' | 'inferred';

export interface ExtractedFactItem {
  id: string;
  category: 'safety' | 'scope' | 'location' | 'duration' | 'alternatives' | 'other';
  label: { ms: string; en: string };
  detail: { ms: string; en: string };
  sourceText: string;
  sourceQuote: string | null;
  status: FactStatus;
  sourceType: SourceType;
  quoteVerified: boolean;
}

export interface StructuredSafetyIndicator {
  hasHazard: boolean;
  hazardType?: 'trapped_person' | 'fire_spark' | 'electric_hazard' | 'falling_debris' | 'structural' | null;
  isNegated: boolean; // e.g., "Tiada orang terperangkap"
  isPastResolved: boolean; // e.g., "Semalam ada terperangkap, sekarang semua dah keluar"
  isUncertain: boolean; // e.g., "Saya tidak pasti ada orang di dalam"
  sourceQuote?: string | null;
}

export interface StructuredLocationContext {
  mentionedBlock: string | null;
  mentionedFloor: number | null;
  specificLocation: string | null;
  sourceQuote?: string | null;
}

export interface StructuredDisruptionScope {
  scope: 'single_point' | 'partial' | 'entire_floor' | 'entire_block' | 'unknown';
  hasAlternatives: boolean; // e.g., "Lampu lain masih menyala"
  sourceQuote?: string | null;
}

export interface StructuredDurationContext {
  rawMention: string | null; // e.g., "sejak pagi", "sejak semalam"
  sourceQuote?: string | null;
}

export interface StructuredReportFacts {
  issueType: string;
  safety: StructuredSafetyIndicator;
  location: StructuredLocationContext;
  scope: StructuredDisruptionScope;
  duration: StructuredDurationContext;
  factsList: ExtractedFactItem[];
  unknowns: { ms: string[]; en: string[] };
  relatedReportsCount?: number; // Verified official count if linked/available
}

export interface RuleEvaluationResult {
  recommendedPriority: PriorityTier;
  needsMoreInfo: boolean;
  ruleIds: string[];
  primaryReasons: { ms: string; en: string };
  verificationQuestions: { ms: string[]; en: string[] };
  unknowns: { ms: string[]; en: string[] };
  ruleBasisExplanation: { ms: string; en: string };
  policyVersion: string;
  evaluatedAt: string;
}

export interface PriorityEvaluationRecord {
  id: string;
  reportId: string;
  inputFingerprint: string;
  policyVersion: string;
  aiModel: string;
  aiProvider: string;
  extractedFacts: StructuredReportFacts;
  ruleResult: RuleEvaluationResult;
  createdAt: string;
}

export interface PriorityDecisionRecord {
  id: string;
  reportId: string;
  evaluationId: string | null;
  decidedPriority: ManagerDecisionTier;
  isOverride: boolean;
  overrideReason: string | null;
  decidedById: string;
  decidedByName: string;
  idempotencyKey?: string | null;
  decisionVersion?: number;
  decidedAt: string;
}

export interface PriorityDataResponse {
  success: boolean;
  evaluation: PriorityEvaluationRecord | null;
  latestDecision: PriorityDecisionRecord | null;
  decisionHistory: PriorityDecisionRecord[];
  currentVersion?: number;
  isDemoCase?: boolean;
  demoKey?: 'lift' | 'water' | 'light';
  error?: string;
}

export interface PriorityLoadState {
  evaluationStatus: 'loaded' | 'timeout' | 'error';
  decisionStatus: 'loaded' | 'timeout' | 'error';
  linkStatus: 'loaded' | 'timeout' | 'error';
  isVersionKnown: boolean;
  userMessage?: { ms: string; en: string };
}

