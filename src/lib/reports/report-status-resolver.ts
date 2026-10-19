import type { IncidentReportRow, IncidentStatus } from '@/types/database';

/**
 * Determines whether a report is currently active (ongoing assessment or remediation).
 * A dismissed report is NEVER considered active.
 * A linked report is active only if the linked incident is ongoing (or pending status).
 */
export function isReportActive(
  report: IncidentReportRow,
  incidentStatus?: IncidentStatus | null
): boolean {
  if (report.status === 'dismissed') {
    return false;
  }
  if (report.status === 'submitted' || report.status === 'reviewed') {
    return true;
  }
  if (report.status === 'linked') {
    if (incidentStatus) {
      return incidentStatus !== 'restored' && incidentStatus !== 'closed';
    }
    // Linked without verified incident closure remains in active assessment
    return true;
  }
  return false;
}

/**
 * Selects the most relevant active report from the resident's report history.
 * If the latest report is dismissed, this continues searching for any older active report.
 */
export function selectPrimaryActiveReport(
  reports: IncidentReportRow[],
  incidentMap?: Record<string, { status: IncidentStatus }>
): IncidentReportRow | null {
  if (!reports || reports.length === 0) return null;

  for (const report of reports) {
    const incStatus = incidentMap?.[report.id]?.status;
    if (isReportActive(report, incStatus)) {
      return report;
    }
  }

  return null;
}

export type StepState = 'completed' | 'active' | 'pending';

export interface ReportProgressEvaluation {
  isDismissed: boolean;
  canShowProgress: boolean;
  stepReceived: StepState;
  stepReview: StepState;
  stepAction: StepState;
  stepResolved: StepState;
}

/**
 * Evaluates progress indicators strictly without making false assumptions.
 * - 'dismissed' does NOT show progress and is NEVER marked as completed repair.
 * - 'linked' alone does NOT mark 'Tindakan' or 'Selesai' unless incident status verifies it.
 */
export function evaluateReportProgress(
  report: IncidentReportRow,
  incidentStatus?: IncidentStatus | null
): ReportProgressEvaluation {
  if (report.status === 'dismissed') {
    return {
      isDismissed: true,
      canShowProgress: false,
      stepReceived: 'pending',
      stepReview: 'pending',
      stepAction: 'pending',
      stepResolved: 'pending',
    };
  }

  if (report.status === 'submitted') {
    return {
      isDismissed: false,
      canShowProgress: true,
      stepReceived: 'active',
      stepReview: 'pending',
      stepAction: 'pending',
      stepResolved: 'pending',
    };
  }

  if (report.status === 'reviewed') {
    return {
      isDismissed: false,
      canShowProgress: true,
      stepReceived: 'completed',
      stepReview: 'active',
      stepAction: 'pending',
      stepResolved: 'pending',
    };
  }

  if (report.status === 'linked') {
    // If incident status is known and verified
    if (incidentStatus === 'restored' || incidentStatus === 'closed') {
      return {
        isDismissed: false,
        canShowProgress: true,
        stepReceived: 'completed',
        stepReview: 'completed',
        stepAction: 'completed',
        stepResolved: 'completed',
      };
    }

    if (incidentStatus === 'in_maintenance') {
      return {
        isDismissed: false,
        canShowProgress: true,
        stepReceived: 'completed',
        stepReview: 'completed',
        stepAction: 'active',
        stepResolved: 'pending',
      };
    }

    if (incidentStatus === 'investigating' || incidentStatus === 'confirmed') {
      return {
        isDismissed: false,
        canShowProgress: true,
        stepReceived: 'completed',
        stepReview: 'active',
        stepAction: 'pending',
        stepResolved: 'pending',
      };
    }

    // Incident status unknown: do not assume repair action or resolution!
    return {
      isDismissed: false,
      canShowProgress: false, // Don't show misleading progress steps when status is unknown
      stepReceived: 'completed',
      stepReview: 'completed',
      stepAction: 'pending',
      stepResolved: 'pending',
    };
  }

  return {
    isDismissed: false,
    canShowProgress: false,
    stepReceived: 'pending',
    stepReview: 'pending',
    stepAction: 'pending',
    stepResolved: 'pending',
  };
}
