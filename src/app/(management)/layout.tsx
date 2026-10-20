import React, { Suspense } from 'react';
import { requireManager } from '@/lib/auth/session';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { ManagementShell, type InitialPendingReport } from '@/components/management/ManagementShell';

export const instant = false;

export default async function ManagementLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { profile } = await requireManager();
  const supabase = await createServerSupabaseClient();

  // Query pending reports count & initial reports for manager's assigned estate
  let pendingCount = 0;
  let initialReports: InitialPendingReport[] = [];
  const estateName =
    profile.assigned_estate_id === 'ppr-desa-rejang'
      ? 'PPR Desa Rejang'
      : 'PPR Sentosa';

  try {
    const { data: reports, count } = await supabase
      .from('incident_reports')
      .select(`
        id,
        category,
        description,
        created_at,
        building_id,
        buildings!inner(name, estate_id),
        service_zones(name)
      `, { count: 'exact' })
      .eq('buildings.estate_id', profile.assigned_estate_id!)
      .eq('status', 'submitted')
      .order('created_at', { ascending: false })
      .limit(20);

    pendingCount = count || 0;
    initialReports = (reports || []).map((r) => {
      const bldg = r.buildings as unknown as { name?: string } | null;
      const zone = r.service_zones as unknown as { name?: string } | null;
      const bldgName = bldg?.name || 'Blok';
      const zoneName = zone?.name ? ` · ${zone.name}` : '';
      return {
        id: r.id,
        category: r.category,
        description: r.description,
        location: `${bldgName}${zoneName}`,
        created_at: r.created_at,
      };
    });
  } catch (err) {
    console.error('[ManagementLayout Error]:', err);
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
      initialPendingReports={initialReports}
    >
      <Suspense fallback={<div className="animate-pulse p-4 text-xs text-[#37455b]">Memuatkan...</div>}>
        {children}
      </Suspense>
    </ManagementShell>
  );
}
