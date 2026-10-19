import { describe, it, expect } from 'vitest';
import {
  isReportActive,
  selectPrimaryActiveReport,
  evaluateReportProgress,
} from '@/lib/reports/report-status-resolver';
import { resolveEstateName } from '@/lib/estate/estate-resolver';
import { translations } from '@/lib/i18n/translations';
import type { IncidentReportRow } from '@/types/database';

describe('PPR NADI — Resident Home Remediation & Status Verification', () => {
  // 1. dismissed tidak menghasilkan penunjuk pembaikan selesai
  it('1. dismissed does not produce a completed repair indicator', () => {
    const dismissedReport: IncidentReportRow = {
      id: 'rep-dismissed-1',
      reporter_id: 'user-1',
      building_id: 'bldg-1',
      service_zone_id: null,
      category: 'lift',
      description: 'Lif berbunyi bising',
      status: 'dismissed',
      urgency_hint: 'medium',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const evalResult = evaluateReportProgress(dismissedReport);
    expect(evalResult.isDismissed).toBe(true);
    expect(evalResult.canShowProgress).toBe(false);
    expect(evalResult.stepResolved).not.toBe('completed');
    expect(isReportActive(dismissedReport)).toBe(false);
  });

  // 2. linked tidak dianggap pembaikan berjalan tanpa bukti status insiden
  it('2. linked is not assumed to be in-progress repair without incident status proof', () => {
    const linkedReport: IncidentReportRow = {
      id: 'rep-linked-1',
      reporter_id: 'user-1',
      building_id: 'bldg-1',
      service_zone_id: null,
      category: 'water_supply',
      description: 'Tekanan air rendah',
      status: 'linked',
      urgency_hint: 'high',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // When linked without verified incident status
    const evalWithoutIncident = evaluateReportProgress(linkedReport, undefined);
    expect(evalWithoutIncident.canShowProgress).toBe(false);
    expect(evalWithoutIncident.stepAction).not.toBe('completed');
    expect(evalWithoutIncident.stepResolved).not.toBe('completed');

    // When linked with 'investigating' incident status (investigation, NOT repair underway)
    const evalInvestigating = evaluateReportProgress(linkedReport, 'investigating');
    expect(evalInvestigating.stepAction).toBe('pending');
    expect(evalInvestigating.stepResolved).toBe('pending');

    // ONLY when incident is explicitly 'in_maintenance' is stepAction marked active
    const evalInMaintenance = evaluateReportProgress(linkedReport, 'in_maintenance');
    expect(evalInMaintenance.stepAction).toBe('active');
    expect(evalInMaintenance.stepResolved).toBe('pending');

    // ONLY when incident is 'restored' or 'closed' is stepResolved marked completed
    const evalRestored = evaluateReportProgress(linkedReport, 'restored');
    expect(evalRestored.stepAction).toBe('completed');
    expect(evalRestored.stepResolved).toBe('completed');
  });

  // 3. Aduan aktif lebih lama masih dipilih apabila laporan terbaru ditolak
  it('3. older active report is selected when the latest report is dismissed', () => {
    const newerDismissedReport: IncidentReportRow = {
      id: 'rep-newer-dismissed',
      reporter_id: 'user-1',
      building_id: 'bldg-1',
      service_zone_id: null,
      category: 'lift',
      description: 'Laporan baru tapi ditolak',
      status: 'dismissed',
      urgency_hint: 'low',
      created_at: '2026-10-18T10:00:00Z',
      updated_at: '2026-10-18T10:00:00Z',
    };

    const olderActiveReport: IncidentReportRow = {
      id: 'rep-older-active',
      reporter_id: 'user-1',
      building_id: 'bldg-1',
      service_zone_id: null,
      category: 'water_supply',
      description: 'Laporan lama masih dalam semakan',
      status: 'submitted',
      urgency_hint: 'high',
      created_at: '2026-10-17T08:00:00Z',
      updated_at: '2026-10-17T08:00:00Z',
    };

    const reports = [newerDismissedReport, olderActiveReport];
    const selected = selectPrimaryActiveReport(reports);
    expect(selected).not.toBeNull();
    expect(selected?.id).toBe('rep-older-active');
  });

  // 4. Lokasi tidak dikenali tidak berubah menjadi PPR Sentosa
  it('4. unknown location does NOT fall back to PPR Sentosa', () => {
    // Known demo estate
    const demoRes = resolveEstateName('ppr-sentosa-demo', 'ms');
    expect(demoRes.name).toBe('PPR Sentosa');
    expect(demoRes.isSpecified).toBe(true);

    // Known research estate
    const desaRejangRes = resolveEstateName('ppr-desa-rejang', 'ms');
    expect(desaRejangRes.name).toBe('PPR Desa Rejang');
    expect(desaRejangRes.isSpecified).toBe(true);

    // Unknown estate ID in BM
    const unknownResMs = resolveEstateName('unknown-fictional-estate-999', 'ms');
    expect(unknownResMs.name).not.toBe('PPR Sentosa');
    expect(unknownResMs.name).toBe('Kawasan tidak ditentukan');
    expect(unknownResMs.isSpecified).toBe(false);

    // Unknown estate ID in EN
    const unknownResEn = resolveEstateName('unknown-fictional-estate-999', 'en');
    expect(unknownResEn.name).not.toBe('PPR Sentosa');
    expect(unknownResEn.name).toBe('Estate not specified');
    expect(unknownResEn.isSpecified).toBe(false);

    // Null or empty ID
    const emptyRes = resolveEstateName(null, 'ms');
    expect(emptyRes.name).toBe('Kawasan tidak ditentukan');
    expect(emptyRes.isSpecified).toBe(false);
  });

  // 5. Query gagal tidak dipaparkan sebagai senarai kosong yang berjaya
  it('5. query error messages are distinct from empty list states', () => {
    // BM error messages
    expect(translations.ms.residentHome.reportsLoadError).toBe(
      'Maklumat aduan tidak dapat dimuatkan pada masa ini. Sila cuba sebentar lagi.'
    );
    expect(translations.ms.residentHome.bulletinsLoadError).toBe(
      'Maklumat notis tidak dapat dimuatkan pada masa ini. Sila cuba sebentar lagi.'
    );

    // Empty list states are distinct
    expect(translations.ms.residentHome.noReportsYet).toBe('Tiada aduan aktif pada masa ini.');
    expect(translations.ms.residentHome.noNoticesHeading).toBe('Tiada notis komuniti pada masa ini.');

    // EN error messages
    expect(translations.en.residentHome.reportsLoadError).toBe(
      'Unable to load report information at this time. Please try again shortly.'
    );
    expect(translations.en.residentHome.bulletinsLoadError).toBe(
      'Unable to load notices at this time. Please try again shortly.'
    );
  });

  // 6. Notis tanpa maklumat tindakan tidak mendakwa pembaikan sedang berjalan
  it('6. notices empty state does NOT claim all facilities are functioning', () => {
    const bmDesc = translations.ms.residentHome.noNoticesDesc;
    const enDesc = translations.en.residentHome.noNoticesDesc;

    // Must not contain false claims like "semua fasiliti beroperasi seperti biasa"
    expect(bmDesc).not.toContain('beroperasi seperti biasa');
    expect(enDesc).not.toContain('operating as normal');

    // Neutral statement
    expect(bmDesc).toBe('Sebarang notis rasmi pengurusan akan dipaparkan di sini apabila diterbitkan.');
    expect(enDesc).toBe('Any official management notices will be displayed here once published.');
  });

  // 7. Label UI BM / EN tepat
  it('7. UI labels and official taglines in BM and EN are verified', () => {
    // Official taglines
    expect(translations.ms.common.tagline).toBe('Suara Komuniti. Nadi Perubahan.');
    expect(translations.en.common.tagline).toBe('Community Voices. The Pulse of Change.');

    // Resident role badge (only "Penduduk" / "Resident", no false "Sah" / "Verified")
    expect(translations.ms.residentHome.residentRoleBadge).toBe('Penduduk');
    expect(translations.en.residentHome.residentRoleBadge).toBe('Resident');

    // Action Stage label
    expect(translations.ms.residentHome.stageLabel).toBe('Peringkat Tindakan:');
    expect(translations.en.residentHome.stageLabel).toBe('Action Stage:');

    // Stages mapping
    expect(translations.ms.residentHome.stages.investigation).toBe('Pemeriksaan & Siasatan Awal');
    expect(translations.en.residentHome.stages.investigation).toBe('Initial Investigation');
    expect(translations.ms.residentHome.stages.contractor_assigned).toBe('Kontraktor Dilantik');
    expect(translations.en.residentHome.stages.contractor_assigned).toBe('Contractor Assigned');
    expect(translations.ms.residentHome.stages.parts_ordered).toBe('Pesanan Alat Ganti');
    expect(translations.en.residentHome.stages.parts_ordered).toBe('Replacement Parts Ordered');
    expect(translations.ms.residentHome.stages.testing).toBe('Ujian & Verifikasi');
    expect(translations.en.residentHome.stages.testing).toBe('Testing & Verification');
    expect(translations.ms.residentHome.stages.restored).toBe('Fasiliti Telah Dipulihkan');
    expect(translations.en.residentHome.stages.restored).toBe('Facility Restored');

    // Status translations
    expect(translations.ms.status.dismissed).toBe('Tidak Berkaitan / Ditolak');
    expect(translations.en.status.dismissed).toBe('Unrelated / Dismissed');
  });
});
