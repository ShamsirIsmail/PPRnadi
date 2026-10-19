import { z } from 'zod';

export const facilityCategorySchema = z.enum(['water_supply', 'lift', 'corridor_lighting']);
export const urgencyHintSchema = z.enum(['low', 'medium', 'high', 'urgent']);

export const residentReportSchema = z.object({
  buildingId: z.string().uuid('Sila pilih blok perumahan yang sah'),
  serviceZoneId: z.string().uuid().optional(),
  status: z.literal('submitted').default('submitted'),
  category: facilityCategorySchema,
  description: z
    .string()
    .trim()
    .min(5, 'Penerangan kerosakan mesti sekurang-kurangnya 5 aksara')
    .max(1000, 'Penerangan kerosakan terhad kepada 1000 aksara'),
  urgencyHint: urgencyHintSchema.default('medium'),
});

export const reportAttachmentSchema = z.object({
  fileName: z.string().min(1),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp'], {
    message: 'Hanya format gambar JPG, PNG atau WebP dibenarkan',
  }),
  fileSizeBytes: z
    .number().int().positive()
    .max(5 * 1024 * 1024, 'Saiz gambar tidak boleh melebihi 5MB'),
});

export type ResidentReportInput = z.infer<typeof residentReportSchema>;
export type ReportAttachmentInput = z.infer<typeof reportAttachmentSchema>;
