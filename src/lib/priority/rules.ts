/**
 * PPR NADI — Deterministic Priority Rules Engine
 * Evaluates extracted structured facts against versioned, documented prototype rules.
 * 
 * Strict Architectural Guarantees:
 * 1. ZERO AI autonomy in tier assignment: output is 100% deterministic based on facts.
 * 2. Every decision includes explicit rule IDs, policy version, and explanation templates.
 * 3. Negations ("tiada orang") and past resolved events ("semalam") do not trigger active hazards.
 * 4. Unknowns remain unknown; never converted to "no risk" or false assumptions.
 * 5. Single lamp outage is never elevated to critical without safety hazards.
 */

import type {
  StructuredReportFacts,
  RuleEvaluationResult,
  PriorityTier,
} from '@/types/priority-explainer';
import type { FacilityCategory } from '@/types/database';

export const POLICY_VERSION = 'proto-2026-10';

export function evaluatePriorityRules(
  facts: StructuredReportFacts,
  reportCategory?: FacilityCategory | string | null
): RuleEvaluationResult {
  const evaluatedAt = new Date().toISOString();
  const ruleIds: string[] = [];
  const unknownsMs = [...(facts.unknowns.ms || [])];
  const unknownsEn = [...(facts.unknowns.en || [])];
  const questionsMs: string[] = [];
  const questionsEn: string[] = [];

  let recommendedPriority: PriorityTier = 'standard_review';
  let needsMoreInfo = false;
  let ruleBasisExplanation = {
    ms: 'Penilaian peraturan deterministik mengikut Polisi Prototaip PPR NADI.',
    en: 'Deterministic rule evaluation according to PPR NADI Prototype Policy.',
  };
  let primaryReasons = {
    ms: 'Semakan berkala mengikut prosedur standard aduan kemudahan.',
    en: 'Routine review according to standard facility report procedures.',
  };

  const isSafetyActive =
    facts.safety.hasHazard &&
    !facts.safety.isNegated &&
    !facts.safety.isPastResolved;

  // RULE S-01: Reported Safety Hazard
  if (isSafetyActive) {
    recommendedPriority = 'immediate_review';

    if (facts.safety.isUncertain) {
      ruleIds.push('S-01', 'U-01');
      needsMoreInfo = true;
      primaryReasons = {
        ms: 'Laporan menyebut kemungkinan bahaya keselamatan atau orang terperangkap dengan ketidakpastian. Isyarat keselamatan mendahului bilangan aduan dan masa menunggu.',
        en: 'Report mentions possible safety hazard or trapped persons with uncertainty. Safety indicators take precedence over report volume and wait time.',
      };
      ruleBasisExplanation = {
        ms: 'S-01 · Isyarat keselamatan dilaporkan (Dengan ketidakpastian - perlu pengesahan segera tapak)',
        en: 'S-01 · Reported safety indicator (With uncertainty - immediate site verification required)',
      };
      questionsMs.push('Adakah masih ada orang di dalam lif, dan lif yang mana?');
      questionsEn.push('Is anyone still inside the elevator, and which specific elevator?');
    } else {
      ruleIds.push('S-01');
      primaryReasons = {
        ms: 'Laporan menyebut bahaya keselamatan aktif atau orang terperangkap. Isyarat keselamatan mendahului bilangan aduan dan masa menunggu.',
        en: 'Report mentions active safety hazard or trapped individuals. Safety indicators take precedence over report volume and wait time.',
      };
      ruleBasisExplanation = {
        ms: 'S-01 · Isyarat keselamatan aktif dilaporkan',
        en: 'S-01 · Active safety hazard reported',
      };
      questionsMs.push('Adakah pasukan kecemasan atau staf bertugas telah dimaklumkan untuk bantuan segera di lokasi?');
      questionsEn.push('Have emergency response or on-duty staff been alerted for immediate site assistance?');
    }

    if (!facts.location.specificLocation && !facts.location.mentionedFloor) {
      needsMoreInfo = true;
      if (!unknownsMs.includes('Identiti atau lokasi spesifik kerosakan belum disahkan.')) {
        unknownsMs.push('Identiti atau lokasi spesifik kerosakan belum disahkan.');
        unknownsEn.push('Specific identity or precise location of the breakdown is not yet confirmed.');
      }
    }

    return {
      recommendedPriority,
      needsMoreInfo,
      ruleIds,
      primaryReasons,
      verificationQuestions: { ms: questionsMs, en: questionsEn },
      unknowns: { ms: unknownsMs, en: unknownsEn },
      ruleBasisExplanation,
      policyVersion: POLICY_VERSION,
      evaluatedAt,
    };
  }

  // RULE I-02 & I-01: Basic Amenity Disruption (Water Supply / Lift without trapped persons)
  const isAmenityDisruption =
    reportCategory === 'water_supply' ||
    reportCategory === 'lift' ||
    (typeof facts.issueType === 'string' &&
      (facts.issueType.toLowerCase().includes('air') ||
        facts.issueType.toLowerCase().includes('water') ||
        facts.issueType.toLowerCase().includes('lif')));

  if (isAmenityDisruption) {
    const relatedCount = facts.relatedReportsCount ?? 0;

    if (relatedCount >= 2) {
      recommendedPriority = 'high_priority';
      ruleIds.push('I-02');
      primaryReasons = {
        ms: `Gangguan bekalan asas disokong oleh ${relatedCount} laporan yang mungkin berkaitan. Semak skop gangguan sebelum mengesahkan satu insiden bersama.`,
        en: `Basic amenity disruption supported by ${relatedCount} possibly related reports. Verify disruption scope before confirming a shared incident.`,
      };
      ruleBasisExplanation = {
        ms: 'I-02 · Gangguan asas + laporan berkaitan',
        en: 'I-02 · Essential service disruption + related reports',
      };
      questionsMs.push('Unit atau tingkat mana lagi terjejas, dan adakah bekalan alternatif tersedia?');
      questionsEn.push('Which other units or floors are affected, and are alternative supplies available?');
    } else {
      recommendedPriority = 'high_priority';
      needsMoreInfo = true;
      ruleIds.push('I-01');
      primaryReasons = {
        ms: 'Gangguan kemudahan asas dilaporkan. Skop penuh gangguan, punca dan alternatif belum disahkan secara rasmi.',
        en: 'Essential amenity disruption reported. Full scope, root cause, and alternatives are not yet officially confirmed.',
      };
      ruleBasisExplanation = {
        ms: 'I-01 · Gangguan bekalan asas dilaporkan (Laporan tunggal)',
        en: 'I-01 · Reported essential service disruption (Single report)',
      };
      questionsMs.push('Adakah gangguan terhad kepada unit pengadu atau melibatkan seluruh aras/blok?');
      questionsEn.push('Is the disruption limited to the reporter unit or does it affect the entire floor/block?');
    }

    if (unknownsMs.length === 0) {
      unknownsMs.push('Punca, jumlah unit terjejas dan bekalan alternatif belum diketahui.');
      unknownsEn.push('Root cause, number of affected units, and alternative supplies are not yet known.');
    }

    return {
      recommendedPriority,
      needsMoreInfo,
      ruleIds,
      primaryReasons,
      verificationQuestions: { ms: questionsMs, en: questionsEn },
      unknowns: { ms: unknownsMs, en: unknownsEn },
      ruleBasisExplanation,
      policyVersion: POLICY_VERSION,
      evaluatedAt,
    };
  }

  // RULE R-03: Localized Disruption / Corridor Lighting (Single light out, alternatives present)
  const isLighting =
    reportCategory === 'corridor_lighting' ||
    (typeof facts.issueType === 'string' &&
      (facts.issueType.toLowerCase().includes('lampu') ||
        facts.issueType.toLowerCase().includes('light')));

  if (isLighting) {
    recommendedPriority = 'standard_review';
    ruleIds.push('R-03');
    primaryReasons = {
      ms: 'Berdasarkan maklumat tersedia, gangguan dilaporkan terhad kepada satu lampu/titik setempat. Cadangan perlu dinaikkan jika maklumat risiko baharu diterima.',
      en: 'Based on available information, the disruption is reported limited to a localized single point. Recommendation should be escalated if new risk data emerges.',
    };
    ruleBasisExplanation = {
      ms: 'R-03 · Gangguan setempat; risiko belum disahkan',
      en: 'R-03 · Localized disruption; risk unconfirmed',
    };
    questionsMs.push('Adakah laluan masih cukup terang dan terdapat tanda kerosakan pendawaian lain?');
    questionsEn.push('Is the passageway sufficiently lit and are there any signs of other wiring faults?');

    if (unknownsMs.length === 0) {
      unknownsMs.push('Keadaan pendawaian dan pencahayaan sebenar belum diperiksa.');
      unknownsEn.push('Wiring condition and actual ambient illumination have not yet been inspected.');
    }

    return {
      recommendedPriority,
      needsMoreInfo,
      ruleIds,
      primaryReasons,
      verificationQuestions: { ms: questionsMs, en: questionsEn },
      unknowns: { ms: unknownsMs, en: unknownsEn },
      ruleBasisExplanation,
      policyVersion: POLICY_VERSION,
      evaluatedAt,
    };
  }

  // RULE R-04: Other Category / Open Maintenance Request (Direct Management Review)
  if (reportCategory === 'other') {
    recommendedPriority = 'standard_review';
    ruleIds.push('R-04');
    primaryReasons = {
      ms: 'Aduan kategori lain-lain memerlukan penilaian manual pihak pengurusan untuk menentukan skop dan tindakan pembaikan.',
      en: 'Reports under other categories require manual evaluation by management to determine scope and repair action.',
    };
    ruleBasisExplanation = {
      ms: 'R-04 · Kategori lain-lain; tertakluk pada semakan manual pengurusan',
      en: 'R-04 · Other category; subject to manual management review',
    };
    questionsMs.push('Apakah skop kerosakan dan adakah ia memerlukan pembekal perkhidmatan luar?');
    questionsEn.push('What is the scope of damage and does it require an external service contractor?');

    return {
      recommendedPriority,
      needsMoreInfo: true,
      ruleIds,
      primaryReasons,
      verificationQuestions: { ms: questionsMs, en: questionsEn },
      unknowns: { ms: unknownsMs, en: unknownsEn },
      ruleBasisExplanation,
      policyVersion: POLICY_VERSION,
      evaluatedAt,
    };
  }

  // DEFAULT / GEN-01: Standard Review
  ruleIds.push('GEN-01');
  return {
    recommendedPriority,
    needsMoreInfo,
    ruleIds,
    primaryReasons,
    verificationQuestions: { ms: questionsMs, en: questionsEn },
    unknowns: { ms: unknownsMs, en: unknownsEn },
    ruleBasisExplanation,
    policyVersion: POLICY_VERSION,
    evaluatedAt,
  };
}
