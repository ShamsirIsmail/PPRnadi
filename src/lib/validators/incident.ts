import { z } from 'zod';
import { facilityCategorySchema } from './report';

export const incidentSeveritySchema = z.enum(['critical', 'major', 'minor']);
export const incidentStatusSchema = z.enum(['investigating', 'confirmed', 'in_maintenance', 'restored', 'closed']);
export const updateStageSchema = z.enum(['investigation', 'contractor_assigned', 'parts_ordered', 'testing', 'restored']);

export const verifyIncidentSchema = z.object({
  reportIds: z.array(z.string().uuid()).min(1, 'At least one report must be linked'),
  buildingId: z.string().uuid('Building ID must be a UUID'),
  primaryFacilityId: z.string().uuid().optional(),
  title: z.string().trim().min(5, 'Incident title must be at least 5 characters'),
  category: facilityCategorySchema,
  severity: incidentSeveritySchema,
  internalNotes: z.string().trim().optional(),
});

export const publishBulletinSchema = z.object({
  incidentId: z.string().uuid('Invalid incident ID'),
  updateTitle: z.string().trim().min(5, 'Update title must be at least 5 characters'),
  messageBm: z.string().trim().min(10, 'Message in BM must be at least 10 characters'),
  stage: updateStageSchema,
});

export const restoreIncidentSchema = z.object({
  incidentId: z.string().uuid('Invalid incident ID'),
  restorationEvidence: z.string().trim().min(5, 'Restoration verification notes are required'),
  finalStatus: z.literal('restored'),
});

export type VerifyIncidentInput = z.infer<typeof verifyIncidentSchema>;
export type PublishBulletinInput = z.infer<typeof publishBulletinSchema>;
export type RestoreIncidentInput = z.infer<typeof restoreIncidentSchema>;
