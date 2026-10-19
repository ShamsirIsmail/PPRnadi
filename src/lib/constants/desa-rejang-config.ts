// ==============================================================================
// PPR/PA Desa Rejang, Setapak Jaya, Kuala Lumpur — Field Study Site Configuration
// ==============================================================================
// PENTING — STATUS PENGESAHAN:
// Pembahagian tingkat per-blok (18, 17, 16, 15) ialah ANDAIAN DEMO SEMENTARA
// yang dibenarkan pengguna bagi tujuan simulasi dan prototaip, BUKAN ukuran
// tapak fizikal rasmi. Jangan bentangkan sebagai fakta rasmi bancian.
//
// Andaian Demo Sementara:
//   - Blok A, B, C, D, E, F, G, H : 18 tingkat
//   - Blok I, J                   : 17 tingkat
//   - Blok K                      : 16 tingkat
//   - Blok L                      : 15 tingkat
// ==============================================================================

export type VerificationState = 'verified' | 'pending_verification' | 'unverified';
export type ClusterZone = 'utara' | 'tengah' | 'selatan';

export interface DesaRejangBlockConfig {
  id: string;
  code: string;
  name: string;
  cluster: ClusterZone;
  clusterLabel: string;
  // Temporary demo assumption permitted by user (NOT officially verified survey)
  temporaryDemoFloors: number;
  // Per-block floor count: set to null if unverified by field survey
  verifiedFloors: number | null;
  // Per-block unit count: set to null if unverified by field survey
  verifiedUnits: number | null;
  // Per-block lift allocation: set to null if unverified by field survey
  verifiedLifts: number | null;
  verificationStatus: VerificationState;
  spatialReference: {
    relativePosition: string;
    nearbyLandmarks: string[];
    accessRoad: string;
    googleMapsPinLabel?: string;
  };
  notes: string;
  // Extensible asset slot structure for field team to populate progressively
  assets: Array<{
    id: string;
    code: string;
    name: string;
    category: 'lift' | 'water_supply' | 'corridor_lighting' | 'refuse' | 'general';
    verified: boolean;
    verificationDate?: string;
    notes?: string;
  }>;
}

export interface DesaRejangEstateConfig {
  id: string;
  code: string;
  name: string;
  officialFullName: string;
  location: {
    area: string;
    district: string;
    city: string;
    state: string;
    postalCode: string;
    mainAccessRoads: string[];
    landmarks: string[];
  };
  // Verified Aggregate Research Data
  verifiedTotals: {
    totalBlocks: number;
    totalUnits: number;
    totalLifts: number;
    source: string;
    lastVerifiedDate: string;
    notes: string;
  };
  blocks: DesaRejangBlockConfig[];
}

export const DESA_REJANG_ESTATE: DesaRejangEstateConfig = {
  id: 'ppr-desa-rejang',
  code: 'PPR_PA_DR',
  name: 'PPR/PA Desa Rejang',
  officialFullName: 'Program Perumahan Rakyat & Perumahan Awam Desa Rejang',
  location: {
    area: 'Setapak Jaya',
    district: 'Wangsa Maju / Setapak',
    city: 'Kuala Lumpur',
    state: 'Wilayah Persekutuan Kuala Lumpur',
    postalCode: '54100',
    mainAccessRoads: [
      'Persiaran Rejang',
      'Lebuhraya Duta-Ulu Kelang (DUKE / E33)',
      'Jalan Rejang',
    ],
    landmarks: [
      'Dewan Serbaguna Perumahan Awam Desa Rejang',
      'Seruni Residence Condominium (Utara)',
      'Gelanggang Sukan / Dataran Komuniti Desa Rejang (Tengah)',
      'Persiaran Rejang (Barat)',
      'Lebuhraya DUKE E33 (Selatan)',
    ],
  },
  verifiedTotals: {
    totalBlocks: 12,
    totalUnits: 2791,
    totalLifts: 38,
    source: 'Data Pasukan Kajian Lapangan PPR NADI',
    lastVerifiedDate: 'Oktober 2026',
    notes: 'Jumlah 12 blok (A hingga L), 2,791 unit dan 38 lif disahkan. Bilangan tingkat berbeza mengikut blok dan sedang dikemas kini mengikut verifikasi fizikal tapak.',
  },
  blocks: [
    // --------------------------------------------------------------------------
    // ZON UTARA (North Cluster) — Berhampiran Dewan Serbaguna & Persiaran Rejang
    // --------------------------------------------------------------------------
    {
      id: 'dr-blk-a',
      code: 'DR_BLK_A',
      name: 'Blok A',
      cluster: 'utara',
      clusterLabel: 'Zon Utara (Berhadapan Dewan Serbaguna)',
      temporaryDemoFloors: 18,
      verifiedFloors: null, // Bilangan tingkat belum disahkan oleh pasukan kajian
      verifiedUnits: null,
      verifiedLifts: null,
      verificationStatus: 'pending_verification',
      spatialReference: {
        relativePosition: 'Bahagian utara kawasan perumahan, berhadapan Dewan Serbaguna',
        nearbyLandmarks: ['Dewan Serbaguna PA Desa Rejang', 'Persiaran Rejang Utara'],
        accessRoad: 'Persiaran Rejang',
        googleMapsPinLabel: 'blok A, PPR DESA REJANG',
      },
      notes: 'Blok berdekatan pintu masuk utara. Maklumat tingkat dan aset menanti pengesahan inventori lapangan.',
      assets: [],
    },
    {
      id: 'dr-blk-b',
      code: 'DR_BLK_B',
      name: 'Blok B',
      cluster: 'utara',
      clusterLabel: 'Zon Utara (Kelompok Dewan & Dataran)',
      temporaryDemoFloors: 18,
      verifiedFloors: null,
      verifiedUnits: null,
      verifiedLifts: null,
      verificationStatus: 'pending_verification',
      spatialReference: {
        relativePosition: 'Zon utara, bersebelahan Blok A dan Dewan Serbaguna',
        nearbyLandmarks: ['Dewan Serbaguna', 'Kawasan Tempat Letak Kereta Utara'],
        accessRoad: 'Persiaran Rejang',
      },
      notes: 'Maklumat bilangan tingkat dan lif menanti pengesahan pasukan lapangan.',
      assets: [],
    },
    {
      id: 'dr-blk-c',
      code: 'DR_BLK_C',
      name: 'Blok C',
      cluster: 'utara',
      clusterLabel: 'Zon Utara-Tengah (Selatan Blok A)',
      temporaryDemoFloors: 18,
      verifiedFloors: null,
      verifiedUnits: null,
      verifiedLifts: null,
      verificationStatus: 'pending_verification',
      spatialReference: {
        relativePosition: 'Selatan Blok A, menghubungkan zon utara dan dataran tengah',
        nearbyLandmarks: ['Pintu Masuk Barat Persiaran Rejang', 'Kedai Komuniti'],
        accessRoad: 'Persiaran Rejang',
        googleMapsPinLabel: 'Blok C PPR Desa Rejang',
      },
      notes: 'Kedudukan satelit disahkan pada Persiaran Rejang. Maklumat aset menanti bancian fizikal.',
      assets: [],
    },

    // --------------------------------------------------------------------------
    // ZON TENGAH (Central Cluster) — Berhampiran Gelanggang Sukan & Dataran
    // --------------------------------------------------------------------------
    {
      id: 'dr-blk-d',
      code: 'DR_BLK_D',
      name: 'Blok D',
      cluster: 'tengah',
      clusterLabel: 'Zon Tengah (Sayap Timur)',
      temporaryDemoFloors: 18,
      verifiedFloors: null,
      verifiedUnits: null,
      verifiedLifts: null,
      verificationStatus: 'pending_verification',
      spatialReference: {
        relativePosition: 'Sayap timur zon tengah, berhampiran kawasan hijau',
        nearbyLandmarks: ['Gelanggang Sukan Komuniti (Barat)'],
        accessRoad: 'Jalan Dalaman Desa Rejang',
      },
      notes: 'Maklumat struktur dan fasiliti dalam semakan.',
      assets: [],
    },
    {
      id: 'dr-blk-e',
      code: 'DR_BLK_E',
      name: 'Blok E',
      cluster: 'tengah',
      clusterLabel: 'Zon Tengah (Sayap Timur-Tengah)',
      temporaryDemoFloors: 18,
      verifiedFloors: null,
      verifiedUnits: null,
      verifiedLifts: null,
      verificationStatus: 'pending_verification',
      spatialReference: {
        relativePosition: 'Zon tengah timur, utara Blok H',
        nearbyLandmarks: ['Kawasan Tempat Letak Kereta Timur'],
        accessRoad: 'Jalan Dalaman Desa Rejang',
      },
      notes: 'Maklumat struktur dan fasiliti dalam semakan.',
      assets: [],
    },
    {
      id: 'dr-blk-f',
      code: 'DR_BLK_F',
      name: 'Blok F',
      cluster: 'tengah',
      clusterLabel: 'Zon Tengah (Menghadap Persiaran Rejang)',
      temporaryDemoFloors: 18,
      verifiedFloors: null,
      verifiedUnits: null,
      verifiedLifts: null,
      verificationStatus: 'pending_verification',
      spatialReference: {
        relativePosition: 'Sempadan barat perumahan, menghadap terus ke Persiaran Rejang',
        nearbyLandmarks: ['Persiaran Rejang', 'Kedai Makanan Persiaran Rejang'],
        accessRoad: 'Persiaran Rejang',
        googleMapsPinLabel: 'Blok F , PPR Desa Rejang',
      },
      notes: 'Kedudukan satelit disahkan di Persiaran Rejang tengah. Bilangan tingkat berbeza, menanti pengesahan.',
      assets: [],
    },
    {
      id: 'dr-blk-g',
      code: 'DR_BLK_G',
      name: 'Blok G',
      cluster: 'tengah',
      clusterLabel: 'Zon Tengah (Teras Gelanggang Sukan)',
      temporaryDemoFloors: 18,
      verifiedFloors: null,
      verifiedUnits: null,
      verifiedLifts: null,
      verificationStatus: 'pending_verification',
      spatialReference: {
        relativePosition: 'Tengah-tengah perumahan, bersebelahan gelanggang sukan utama',
        nearbyLandmarks: ['Gelanggang Sukan Berbumbung', 'Dataran Komuniti'],
        accessRoad: 'Jalan Dalaman Desa Rejang',
        googleMapsPinLabel: 'Blok G, PPR Desa Rejang',
      },
      notes: 'Lokasi strategik di tengah perumahan bersebelahan kemudahan rekreasi.',
      assets: [],
    },

    // --------------------------------------------------------------------------
    // ZON SELATAN (South Cluster) — Berhampiran Lebuhraya DUKE (E33)
    // --------------------------------------------------------------------------
    {
      id: 'dr-blk-h',
      code: 'DR_BLK_H',
      name: 'Blok H',
      cluster: 'selatan',
      clusterLabel: 'Zon Selatan-Timur',
      temporaryDemoFloors: 18,
      verifiedFloors: null,
      verifiedUnits: null,
      verifiedLifts: null,
      verificationStatus: 'pending_verification',
      spatialReference: {
        relativePosition: 'Tenggara zon tengah, bersebelahan sempadan hijau timur',
        nearbyLandmarks: ['Fizura Empire Lashes', 'Sempadan Rizab Hijau Timur'],
        accessRoad: 'Jalan Dalaman Desa Rejang',
        googleMapsPinLabel: 'Block H PPR desa rejang setapak',
      },
      notes: 'Kedudukan satelit disahkan pada sayap tenggara.',
      assets: [],
    },
    {
      id: 'dr-blk-i',
      code: 'DR_BLK_I',
      name: 'Blok I',
      cluster: 'selatan',
      clusterLabel: 'Zon Selatan (Koridor Tengah-Selatan)',
      temporaryDemoFloors: 17,
      verifiedFloors: null,
      verifiedUnits: null,
      verifiedLifts: null,
      verificationStatus: 'pending_verification',
      spatialReference: {
        relativePosition: 'Koridor tengah-selatan antara Blok G dan Blok K',
        nearbyLandmarks: ['Laluan Pejalan Kaki Tengah'],
        accessRoad: 'Jalan Dalaman Desa Rejang',
      },
      notes: 'Maklumat struktur dalam proses bancian lapangan.',
      assets: [],
    },
    {
      id: 'dr-blk-j',
      code: 'DR_BLK_J',
      name: 'Blok J',
      cluster: 'selatan',
      clusterLabel: 'Zon Selatan-Tenggara (Menghadap DUKE)',
      temporaryDemoFloors: 17,
      verifiedFloors: null,
      verifiedUnits: null,
      verifiedLifts: null,
      verificationStatus: 'pending_verification',
      spatialReference: {
        relativePosition: 'Bahagian tenggara, menghadap Lebuhraya DUKE (E33)',
        nearbyLandmarks: ['Lebuhraya DUKE (E33) Sektor Timur'],
        accessRoad: 'Laluan Akses Selatan',
        googleMapsPinLabel: 'Blok J, PPR Desa Rejang',
      },
      notes: 'Kedudukan satelit disahkan menghadap lebuhraya E33.',
      assets: [],
    },
    {
      id: 'dr-blk-k',
      code: 'DR_BLK_K',
      name: 'Blok K',
      cluster: 'selatan',
      clusterLabel: 'Zon Selatan-Barat Daya',
      temporaryDemoFloors: 16,
      verifiedFloors: null,
      verifiedUnits: null,
      verifiedLifts: null,
      verificationStatus: 'pending_verification',
      spatialReference: {
        relativePosition: 'Bahagian barat daya, selatan Blok F dan utara Blok L',
        nearbyLandmarks: ['Laluan Persiaran Rejang Selatan'],
        accessRoad: 'Persiaran Rejang / Laluan Dalaman',
        googleMapsPinLabel: 'Blok K, PPR DESA REJANG',
      },
      notes: 'Kedudukan satelit disahkan di sayap barat daya.',
      assets: [],
    },
    {
      id: 'dr-blk-l',
      code: 'DR_BLK_L',
      name: 'Blok L',
      cluster: 'selatan',
      clusterLabel: 'Zon Paling Selatan (PA Desa Rejang / Sebelah DUKE)',
      temporaryDemoFloors: 15,
      verifiedFloors: null,
      verifiedUnits: null,
      verifiedLifts: null,
      verificationStatus: 'pending_verification',
      spatialReference: {
        relativePosition: 'Blok paling selatan kawasan perumahan, paling hampir dengan Lebuhraya DUKE (E33)',
        nearbyLandmarks: ['Lebuhraya DUKE (E33)', 'Sempadan Rizab Lebuhraya Selatan'],
        accessRoad: 'Laluan Akses Blok L',
        googleMapsPinLabel: 'Blok L, PA Desa Rejang',
      },
      notes: 'Blok L bersempadan terus dengan lebuhraya DUKE E33. Maklumat aset dan tingkat belum disahkan.',
      assets: [],
    },
  ],
};
