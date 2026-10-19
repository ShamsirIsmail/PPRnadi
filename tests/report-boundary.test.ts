import { describe, expect, it } from 'vitest';
import { residentReportSchema, reportAttachmentSchema } from '@/lib/validators/report';

const validReport = {
  buildingId: '10000000-0000-4000-8000-000000000002',
  category: 'water_supply',
  description: 'Tekanan air rendah di tingkat 14.',
};

describe('Report boundary validation', () => {
  it('defaults new reports to submitted', () => {
    expect(residentReportSchema.parse(validReport).status).toBe('submitted');
  });
  it.each(['reviewed', 'linked', 'dismissed'])('rejects client-created %s status', (status) => {
    expect(residentReportSchema.safeParse({ ...validReport, status }).success).toBe(false);
  });
  it('rejects demo IDs at the future persistence boundary', () => {
    expect(residentReportSchema.safeParse({ ...validReport, buildingId: 'bldg-b' }).success).toBe(false);
  });
  it.each([-1, 0, 1.5])('rejects invalid evidence size %s', (fileSizeBytes) => {
    expect(reportAttachmentSchema.safeParse({ fileName: 'tap.jpg', mimeType: 'image/jpeg', fileSizeBytes }).success).toBe(false);
  });
});
