import { DEMO_BUILDINGS, DEMO_FACILITIES } from '@/lib/constants/estate-data';

export default function FacilitiesPage() {
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-[#162E22]">Inventori Aset — Demo</h1>
      <p className="text-sm text-[#5C574F]">Senarai aset contoh untuk pratonton. Pengurusan inventori pangkalan data belum tersedia.</p>
      {DEMO_BUILDINGS.map((building) => (
        <section key={building.id} className="rounded-xl border border-[#DDD8CB] bg-white p-5">
          <h2 className="font-semibold text-[#162E22]">{building.name}</h2>
          <ul className="mt-3 space-y-3 text-sm">
            {DEMO_FACILITIES.filter((facility) => facility.buildingId === building.id).map((facility) => (
              <li key={facility.id} className="border-t border-[#DDD8CB] pt-3">
                <span className="font-medium">{facility.name}</span>
                <p className="text-xs text-[#5C574F]">{facility.facilityCode} · {facility.status === 'operational' ? 'Beroperasi' : facility.status === 'degraded' ? 'Gangguan separa' : 'Terhenti'} (contoh)</p>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
