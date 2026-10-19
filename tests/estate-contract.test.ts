import { describe, it, expect } from 'vitest';
import { 
  DEMO_BUILDINGS, 
  DEMO_ZONES, 
  DEMO_FACILITIES,
  REAL_ESTATE_DESA_REJANG,
  DESA_REJANG_BUILDINGS,
  DESA_REJANG_ESTATE,
} from '@/lib/constants/estate-data';

describe('Estate Data Contract & Constraints (PPR Sentosa Synthetic Demo)', () => {
  it('verifies exact building floor counts: Block A (15), Block B (15), Block C (12)', () => {
    const blockA = DEMO_BUILDINGS.find((b) => b.code === 'BLK_A');
    const blockB = DEMO_BUILDINGS.find((b) => b.code === 'BLK_B');
    const blockC = DEMO_BUILDINGS.find((b) => b.code === 'BLK_C');

    expect(blockA).toBeDefined();
    expect(blockA?.totalFloors).toBe(15);
    expect(blockA?.totalUnits).toBe(180);

    expect(blockB).toBeDefined();
    expect(blockB?.totalFloors).toBe(15);
    expect(blockB?.totalUnits).toBe(180);

    expect(blockC).toBeDefined();
    expect(blockC?.totalFloors).toBe(12);
    expect(blockC?.totalUnits).toBe(144);
  });

  it('guarantees that service zones never exceed the physical floor count of their building', () => {
    for (const zone of DEMO_ZONES) {
      const parentBuilding = DEMO_BUILDINGS.find((b) => b.id === zone.buildingId);
      expect(parentBuilding).toBeDefined();
      if (parentBuilding && parentBuilding.totalFloors && zone.floorRange) {
        expect(zone.floorRange[0]).toBeGreaterThanOrEqual(1);
        expect(zone.floorRange[1]).toBeLessThanOrEqual(parentBuilding.totalFloors);
        expect(zone.floorRange[0]).toBeLessThanOrEqual(zone.floorRange[1]);
      }
    }
  });

  it('verifies that facilities exist for water, lifts, and corridor lighting in Block B', () => {
    const blockBFacilities = DEMO_FACILITIES.filter((f) => f.buildingId === 'bldg-b');
    const categories = blockBFacilities.map((f) => f.category);

    expect(categories).toContain('water_supply');
    expect(categories).toContain('lift');
    expect(categories).toContain('corridor_lighting');
  });
});

describe('Field Study Site Configuration: PPR/PA Desa Rejang, Setapak Jaya', () => {
  it('verifies exact 12 blocks from Blok A to Blok L', () => {
    expect(DESA_REJANG_ESTATE.blocks).toHaveLength(12);
    const expectedBlockNames = [
      'Blok A', 'Blok B', 'Blok C', 'Blok D', 
      'Blok E', 'Blok F', 'Blok G', 'Blok H', 
      'Blok I', 'Blok J', 'Blok K', 'Blok L'
    ];
    const actualBlockNames = DESA_REJANG_ESTATE.blocks.map((b) => b.name);
    expect(actualBlockNames).toEqual(expectedBlockNames);
  });

  it('verifies exact aggregate totals: 2,791 units and 38 lifts', () => {
    expect(REAL_ESTATE_DESA_REJANG.totalBlocks).toBe(12);
    expect(REAL_ESTATE_DESA_REJANG.totalUnits).toBe(2791);
    expect(REAL_ESTATE_DESA_REJANG.totalLifts).toBe(38);
    expect(REAL_ESTATE_DESA_REJANG.isRealResearchSite).toBe(true);
  });

  it('enforces anti-hallucination policy: does NOT assume uniform 18 floors for all blocks', () => {
    // Verified floors must remain null or explicitly marked pending_verification until surveyed
    for (const block of DESA_REJANG_ESTATE.blocks) {
      expect(block.verifiedFloors).toBeNull();
      expect(block.verificationStatus).toBe('pending_verification');
    }
    // Check DESA_REJANG_BUILDINGS adapter respects null floors
    for (const b of DESA_REJANG_BUILDINGS) {
      expect(b.totalFloors).toBeNull();
      expect(b.totalUnits).toBeNull();
      expect(b.totalLifts).toBeNull();
      expect(b.activeIncidentCount).toBe(0); // Zero fake synthetic incidents attached to Desa Rejang
    }
  });

  it('provides extensible asset slots and spatial cluster references for each block', () => {
    const validClusters = ['utara', 'tengah', 'selatan'];
    for (const block of DESA_REJANG_ESTATE.blocks) {
      expect(validClusters).toContain(block.cluster);
      expect(block.spatialReference.relativePosition).toBeTruthy();
      expect(block.spatialReference.accessRoad).toBeTruthy();
      // Zero unverified assets hallucinated
      expect(block.assets).toEqual([]);
    }
  });
});
