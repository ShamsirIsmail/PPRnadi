# PPR NADI — Estate Data Contract & Visual Integration Boundary

## 1. Integration Boundary
The interactive architectural building visual for PPR NADI is developed as an isolated module and integrates directly via:
```text
src/components/estate/
├── types.ts                     # Strict TypeScript data contract
├── BuildingVisualContainer.tsx   # Lightweight accessible SVG/schematic placeholder
└── index.ts                     # Re-exported module boundary
```

## 2. Core Typed Interfaces

```typescript
import type { FacilityCategory, FacilityStatus, IncidentSeverity, IncidentStatus } from '@/types/database';

export interface EstateBuildingData {
  id: string;
  code: string;                      // "BLK_A" | "BLK_B" | "BLK_C"
  name: string;                      // "Blok A"
  totalFloors: number;
  totalUnits: number;
  activeIncidentCount: number;
  worstStatus: FacilityStatus;       // 'operational' | 'degraded' | 'offline'
}

export interface EstateZoneData {
  id: string;
  buildingId: string;
  zoneCode: string;                  // e.g. "B-ZONE-HIGH"
  name: string;                      // e.g. "Blok B Zon Tinggi (T8-T15)"
  floorRange: [number, number];      // [8, 15]
  isAffected: boolean;
  activeIncidentIds: string[];
}

export interface EstateFacilityData {
  id: string;
  buildingId: string;
  facilityCode: string;              // e.g. "PUMP-B-BOOST"
  name: string;
  category: FacilityCategory;        // 'water_supply' | 'lift' | 'corridor_lighting'
  status: FacilityStatus;
  dependentZoneIds: string[];
}

export interface BuildingVisualProps {
  buildings: EstateBuildingData[];
  selectedBuildingId: string | null;
  zones: EstateZoneData[];
  facilities: EstateFacilityData[];
  onSelectBuilding?: (buildingId: string) => void;
  onSelectZone?: (zoneId: string) => void;
  className?: string;
  showOverlayStats?: boolean;
}
```

## 3. Synthetic Demo Estate Parameters: PPR Sentosa

| Building | Code | Total Floors | Total Units | Water Service Zones | Facilities |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Blok A** | `BLK_A` | 15 floors | 180 units | Low (1–7), High (8–15) | Main Pump, Lift 1, Lighting |
| **Blok B** | `BLK_B` | 15 floors | 180 units | Low (1–7), High (8–15) | Main Pump, Booster Pump (Degraded), Lift 1, Lift 2, Corridor Lighting |
| **Blok C** | `BLK_C` | 12 floors | 144 units | Low (1–6), High (7–12) | Main Pump, Lift 1, Lighting |

**Total Synthetic Estate Capacity:** 3 Blocks, 42 Total Floors, 504 Residential Units.

## 4. Visual Rendering Invariants
1. **Floor Bounds:** A zone's `floorRange[1]` must never exceed the building's `totalFloors`.
2. **Accessible Fallback:** The visual container must provide semantic ARIA labels and keyboard navigation between blocks.
3. **Responsive Degradation:** On narrow screens (<640px), the schematic condenses into a vertical zone list with tap targets of at least 44px.
