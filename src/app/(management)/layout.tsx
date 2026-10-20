import React, { Suspense } from 'react';
import { requireManager } from '@/lib/auth/session';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { ManagementShell } from '@/components/management/ManagementShell';

export const instant = false;

export default async function ManagementLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { profile } = await requireManager();
  const supabase = await createServerSupabaseClient();

  // Query pending reports count & initial report IDs for manager's assigned estate
  let pendingCount = 0;
  let initialReportIds: string[] = [];
  const estateName =
    profile.assigned_estate_id === 'ppr-desa-rejang'
      ? 'PPR Desa Rejang'
      : 'PPR Sentosa';

  try {
    const { data: reports, count } = await supabase
      .from('incident_reports')
      .select('id, buildings!inner(estate_id)', { count: 'exact' })
      .eq('buildings.estate_id', profile.assigned_estate_id!)
      .eq('status', 'submitted');

    pendingCount = count || 0;
    initialReportIds = (reports || []).map((r) => r.id);
  } catch {
    // Graceful fallback
  }

  return (
    <ManagementShell
      managerProfile={{
        id: profile.id,
        fullName: profile.full_name,
        assignedEstateId: profile.assigned_estate_id!,
        role: profile.role,
      }}
      estateName={estateName}
      initialPendingReportsCount={pendingCount}
      initialReportIds={initialReportIds}
    >
      <Suspense fallback={<div className="animate-pulse p-4 text-xs text-[#37455b]">Memuatkan...</div>}>
        {children}
      </Suspense>
    </ManagementShell>
  );
}
