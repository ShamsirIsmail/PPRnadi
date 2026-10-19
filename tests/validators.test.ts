import { describe, it, expect } from 'vitest';
import { residentReportSchema, reportAttachmentSchema } from '@/lib/validators/report';
import { verifyIncidentSchema, publishBulletinSchema } from '@/lib/validators/incident';

describe('Resident Report Validation (Zod)', () => {
  it('accepts valid report submission for water supply', () => {
    const input = {
      buildingId: '10000000-0000-4000-8000-000000000002',
      category: 'water_supply',
      description: 'Tiada air keluar dari paip dapur sejak 2 petang',
      urgencyHint: 'high',
    };
    const result = residentReportSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it('rejects description shorter than 5 characters', () => {
    const input = {
      buildingId: '10000000-0000-4000-8000-000000000002',
      category: 'water_supply',
      description: 'air',
      urgencyHint: 'medium',
    };
    const result = residentReportSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain('sekurang-kurangnya 5 aksara');
    }
  });

  it('rejects invalid facility categories', () => {
    const input = {
      buildingId: '10000000-0000-4000-8000-000000000002',
      category: 'swimming_pool', // Invalid for PPR
      description: 'Kerosakan fasiliti tidak sah',
    };
    const result = residentReportSchema.safeParse(input);
    expect(result.success).toBe(false);
  });
});

describe('Report Attachment Validation (Zod)', () => {
  it('accepts valid JPG and PNG files under 5MB', () => {
    const validJpg = {
      fileName: 'pump-leak.jpg',
      mimeType: 'image/jpeg',
      fileSizeBytes: 2 * 1024 * 1024, // 2MB
    };
    expect(reportAttachmentSchema.safeParse(validJpg).success).toBe(true);

    const validWebp = {
      fileName: 'corridor-dark.webp',
      mimeType: 'image/webp',
      fileSizeBytes: 1024 * 500, // 500KB
    };
    expect(reportAttachmentSchema.safeParse(validWebp).success).toBe(true);
  });

  it('rejects files larger than 5MB', () => {
    const oversize = {
      fileName: 'huge-video.png',
      mimeType: 'image/png',
      fileSizeBytes: 6 * 1024 * 1024, // 6MB
    };
    const result = reportAttachmentSchema.safeParse(oversize);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain('tidak boleh melebihi 5MB');
    }
  });

  it('rejects dangerous or non-image MIME types (PDF, EXE, MP4)', () => {
    const invalidPdf = {
      fileName: 'document.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 1024 * 1024,
    };
    expect(reportAttachmentSchema.safeParse(invalidPdf).success).toBe(false);
  });
});

describe('Incident Management Validation (Zod)', () => {
  it('validates verifyIncidentSchema payload', () => {
    const payload = {
      reportIds: ['a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'],
      buildingId: '10000000-0000-4000-8000-000000000002',
      title: 'Kegagalan Pam Penggalak Blok B',
      category: 'water_supply',
      severity: 'major',
      internalNotes: 'Tekanan pam jatuh ke 0.5 bar',
    };
    expect(verifyIncidentSchema.safeParse(payload).success).toBe(true);
  });

  it('validates bulletin publication payload', () => {
    const bulletin = {
      incidentId: '40c0f8d8-6641-434a-b33b-a6f0db2f2b87',
      updateTitle: 'Pembaikan Pam Penggalak Blok B',
      messageBm: 'Kontraktor telah tiba dan sedang membaiki pam utama.',
      stage: 'contractor_assigned',
    };
    expect(publishBulletinSchema.safeParse(bulletin).success).toBe(true);
  });
});

