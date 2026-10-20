import { describe, it, expect } from 'vitest';
import {
  isReportActive,
  evaluateReportProgress,
} from '@/lib/reports/report-status-resolver';
import { translations } from '@/lib/i18n/translations';
import type { ReportStatus, IncidentStatus, FacilityCategory } from '@/types/database';

describe('PPR NADI — Resident History & Report Detail Logic', () => {
  interface MockReportItem {
    id: string;
    category: FacilityCategory;
    description: string;
    status: ReportStatus;
    urgency_hint: string;
    created_at: string;
    buildingName: string;
    linkedIncident?: {
      incidentNumber: string;
      title: string;
      status: string;
    } | null;
  }

  const mockReports: MockReportItem[] = [
    {
      id: 'rep-submitted-1',
      category: 'lift',
      description: 'Lif A rosak di tingkat 5',
      status: 'submitted',
      urgency_hint: 'high',
      created_at: '2026-10-20T08:00:00Z',
      buildingName: 'Blok A',
      linkedIncident: null,
    },
    {
      id: 'rep-reviewed-1',
      category: 'water_supply',
      description: 'Paip utama bocor',
      status: 'reviewed',
      urgency_hint: 'urgent',
      created_at: '2026-10-19T08:00:00Z',
      buildingName: 'Blok B',
      linkedIncident: null,
    },
    {
      id: 'rep-linked-active-1',
      category: 'corridor_lighting',
      description: 'Lampu koridor padam tingkat 3',
      status: 'linked',
      urgency_hint: 'medium',
      created_at: '2026-10-18T08:00:00Z',
      buildingName: 'Blok A',
      linkedIncident: {
        incidentNumber: 'INC-2026-001',
        title: 'Litar Lampu Koridor',
        status: 'in_maintenance',
      },
    },
    {
      id: 'rep-linked-no-incident-1',
      category: 'lift',
      description: 'Lif B bergegar',
      status: 'linked',
      urgency_hint: 'medium',
      created_at: '2026-10-17T08:00:00Z',
      buildingName: 'Blok C',
      linkedIncident: null, // Unknown incident
    },
    {
      id: 'rep-resolved-1',
      category: 'water_supply',
      description: 'Pam air tekanan rendah',
      status: 'linked',
      urgency_hint: 'high',
      created_at: '2026-10-16T08:00:00Z',
      buildingName: 'Blok B',
      linkedIncident: {
        incidentNumber: 'INC-2026-002',
        title: 'Pam Utama Blok B',
        status: 'restored',
      },
    },
    {
      id: 'rep-dismissed-1',
      category: 'corridor_lighting',
      description: 'Lampu dalam rumah sendiri',
      status: 'dismissed',
      urgency_hint: 'low',
      created_at: '2026-10-15T08:00:00Z',
      buildingName: 'Blok A',
      linkedIncident: null,
    },
  ];

  it('1. Filter "all" returns all reports including dismissed', () => {
    const all = mockReports.filter(() => true);
    expect(all).toHaveLength(6);
    expect(all.some((r) => r.status === 'dismissed')).toBe(true);
  });

  it('2. Filter "active" includes submitted, reviewed, and ongoing linked reports, excluding dismissed and resolved', () => {
    const active = mockReports.filter((report) => {
      const incStatus = report.linkedIncident?.status as IncidentStatus | undefined;
      const isActive = isReportActive(report, incStatus ?? null);
      const incProgress = evaluateReportProgress(report, incStatus ?? null);
      const isResolved =
        incProgress.stepResolved === 'completed' ||
        report.linkedIncident?.status === 'resolved' ||
        report.linkedIncident?.status === 'closed';

      return isActive && !isResolved;
    });

    const activeIds = active.map((r) => r.id);
    expect(activeIds).toContain('rep-submitted-1');
    expect(activeIds).toContain('rep-reviewed-1');
    expect(activeIds).toContain('rep-linked-active-1');
    expect(activeIds).toContain('rep-linked-no-incident-1');
    expect(activeIds).not.toContain('rep-resolved-1');
    expect(activeIds).not.toContain('rep-dismissed-1');
    expect(active).toHaveLength(4);
  });

  it('3. Filter "resolved" includes ONLY verified resolved reports, never dismissed', () => {
    const resolved = mockReports.filter((report) => {
      const incStatus = report.linkedIncident?.status as IncidentStatus | undefined;
      const incProgress = evaluateReportProgress(report, incStatus ?? null);
      const isResolved =
        incProgress.stepResolved === 'completed' ||
        report.linkedIncident?.status === 'resolved' ||
        report.linkedIncident?.status === 'closed';

      return isResolved && report.status !== 'dismissed';
    });

    expect(resolved).toHaveLength(1);
    expect(resolved[0].id).toBe('rep-resolved-1');
  });

  it('4. Filter "dismissed" contains exclusively dismissed reports', () => {
    const dismissed = mockReports.filter((r) => r.status === 'dismissed');
    expect(dismissed).toHaveLength(1);
    expect(dismissed[0].id).toBe('rep-dismissed-1');
  });

  it('5. Linked report without incident details does not falsely show completed action or resolution', () => {
    const unverifiedLinked = mockReports.find((r) => r.id === 'rep-linked-no-incident-1')!;
    const evalResult = evaluateReportProgress(unverifiedLinked, null);

    expect(evalResult.canShowProgress).toBe(false);
    expect(evalResult.stepAction).toBe('pending');
    expect(evalResult.stepResolved).toBe('pending');
  });

  it('6. i18n translations contain all required detail, lightbox, and timeline keys in both BM and EN', () => {
    const requiredKeys = [
      'pageTitle',
      'pageSubtitle',
      'newReportBtn',
      'emptyHeading',
      'filterAll',
      'filterActive',
      'filterResolved',
      'filterDismissed',
      'viewDetails',
      'submittedOn',
      'copyRef',
      'copied',
      'copyFailed',
      'copyFullId',
      'backToList',
      'detailPageTitle',
      'detailTimelineTitle',
      'detailEvidenceTitle',
      'detailInfoTitle',
      'detailDismissedBanner',
      'detailLinkedNoteNoIncident',
      'timelineStepReceived',
      'timelineStepReview',
      'timelineStepAction',
      'timelineStepResolved',
      'lightboxClose',
      'lightboxPrev',
      'lightboxNext',
      'lightboxCounter',
      'lightboxLoading',
      'lightboxError',
      'noImagesAttached',
    ] as const;

    for (const key of requiredKeys) {
      expect(translations.ms.history[key], `Missing BM key: ${key}`).toBeDefined();
      expect(translations.en.history[key], `Missing EN key: ${key}`).toBeDefined();
      expect(translations.ms.history[key].length).toBeGreaterThan(0);
      expect(translations.en.history[key].length).toBeGreaterThan(0);
    }
  });
});
