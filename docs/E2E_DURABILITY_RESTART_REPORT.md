# PPR NADI — LAPORAN VERIFIKASI KETAT PENYIMPANAN & RESTART
**Status Keseluruhan: PASS (100% Data Durability Across Server Restart)**  
**Tarikh / Masa:** 2026-10-19T22:48:00+08:00 (Waktu Tempatan)  
**Penyedia Sasaran:** Supabase Tempatan (`http://127.0.0.1:64321`) & Pelayan Aplikasi Ujian Mandiri (`http://127.0.0.1:3005`)

---

## 1. Ringkasan Eksekutif & Status Akhir

| Parameter / Assertion | Status | Catatan Bukti |
|---|:---:|---|
| **MANUAL REPORT SUBMISSION** | **PASS** | Satu penghantaran menghasilkan satu aduan (`[data-testid="submit-report-button"]`). Tiada butang AI ditekan. |
| **MANAGEMENT ACCESS** | **PASS** | Pengurus log masuk, kad aduan dibuka secara berskop (`report-card-${id}`), kedua-dua imej dibuka dengan HTTP 200. |
| **APPLICATION RESTART VERIFIED** | **PASS** | Pelayan port 3005 ditamatkan (PID 18952), disahkan tamat/down, dihidupkan semula dengan PID baharu 20864. |
| **SAME REPORT AFTER RESTART** | **PASS** | Pengurus log masuk semula melalui context bersih (cookie/sesi segar). Semua metadata aduan kekal sepadan 100%. |
| **SAME TWO IMAGES AFTER RESTART** | **PASS** | Kedua-dua imej dimuat turun semula melalui UI pengurus, dinyahkod sebagai binari PNG sah, hash SHA-256 kekal sama 100%. |
| **AI NETWORK CALLS** | **0** | Guard pelayan aktif (`TEST_DISABLE_AI_CALLS=true`). Tiada permintaan rangkaian dihantar ke penyedia AI. |
| **LIVE AI** | **NOT TESTED** | Dinyahaktifkan secara sengaja untuk larian ini (`DISABLED FOR THIS RUN`). |
| **PHYSICAL PHONE** | **NOT TESTED** | Ujian dijalankan dalam persekitaran simulasi Chromium headless Playwright. |

---

## 2. Identiti Larian & Pelayan Aplikasi

- **Run ID (UUID):** `c9fe8201-eda6-422e-ba49-7779d451283f`
- **Label Aduan:** `UJIAN E2E DESA REJANG — c9fe8201-eda6-422e-ba49-7779d451283f`
- **Report ID Terhasil:** `e121b593-8a8a-41b8-afbd-36149cbc8f5e`
- **Pelayan Ujian:** Next.js Dev Server pada port terasing `3005` (`NEXT_DIST_DIR=.next-test`)
- **PID Sebelum Restart:** `18952`
- **PID Selepas Restart:** `20864` (Terbukti berbeza dan direkodkan terus dari subsistem rangkaian OS)
- **Ringkasan JSON Tersanitasi:** `C:\Users\shams\.gemini\antigravity-ide\brain\f73c5ee6-76ec-4b98-ac3e-6e23b5a34c2a\e2e-verification-summary.json`

---

## 3. Jadual Perbandingan: BEFORE vs AFTER Restart

| Medan / Objek | Baseline (BEFORE Restart) | Disahkan (AFTER Restart) | Keputusan |
|---|---|---|:---:|
| **Report ID** | `e121b593-8a8a-41b8-afbd-36149cbc8f5e` | `e121b593-8a8a-41b8-afbd-36149cbc8f5e` | **SEPADAN (100%)** |
| **Reporter ID** | `c0000000-0000-4000-8000-000000000001` (resident.rejang) | `c0000000-0000-4000-8000-000000000001` (resident.rejang) | **SEPADAN (100%)** |
| **Building ID** | `5fef3a20-ee34-47d6-b83e-63cbe4df2ce2` (Blok A / DR_BLK_A) | `5fef3a20-ee34-47d6-b83e-63cbe4df2ce2` (Blok A / DR_BLK_A) | **SEPADAN (100%)** |
| **Service Zone ID** | `9e4bad3a-a9b8-4820-91e1-6d59622d453d` (Blok A Zon Tinggi) | `9e4bad3a-a9b8-4820-91e1-6d59622d453d` (Blok A Zon Tinggi) | **SEPADAN (100%)** |
| **Floor Coverage** | Meliputi Tingkat 16 (Zon T10-T18) | Meliputi Tingkat 16 (Zon T10-T18) | **SEPADAN (100%)** |
| **Category** | `corridor_lighting` (Lampu Koridor) | `corridor_lighting` (Lampu Koridor) | **SEPADAN (100%)** |
| **Status** | `submitted` | `submitted` | **SEPADAN (100%)** |
| **Lampiran 1 (ID)** | `c484769b-68cc-4d75-ad71-641e0cf2a84a` | `c484769b-68cc-4d75-ad71-641e0cf2a84a` | **SEPADAN (100%)** |
| **Lampiran 1 (Path)** | `.../e121b593.../e2e-evidence-1_6b7fa434f92a8b80.png` | `.../e121b593.../e2e-evidence-1_6b7fa434f92a8b80.png` | **SEPADAN (100%)** |
| **Lampiran 1 (Saiz)** | 70 bait | 70 bait | **SEPADAN (100%)** |
| **Lampiran 1 (SHA-256)** | `6b7fa434f92a8b80aab02d9bf1a12e49ffcae424e4013a1c4f68b67e3d2bbcd0` | `6b7fa434f92a8b80aab02d9bf1a12e49ffcae424e4013a1c4f68b67e3d2bbcd0` | **SEPADAN (100%)** |
| **Lampiran 1 (Dimensi)**| 1x1 piksel (Dinyahkod binari PNG sah) | 1x1 piksel (Dinyahkod binari PNG sah) | **SEPADAN (100%)** |
| **Lampiran 2 (ID)** | `3d6dae0b-f369-4763-bdec-6190bcebe697` | `3d6dae0b-f369-4763-bdec-6190bcebe697` | **SEPADAN (100%)** |
| **Lampiran 2 (Path)** | `.../e121b593.../e2e-evidence-2_6a55447615e047f7.png` | `.../e121b593.../e2e-evidence-2_6a55447615e047f7.png` | **SEPADAN (100%)** |
| **Lampiran 2 (Saiz)** | 77 bait | 77 bait | **SEPADAN (100%)** |
| **Lampiran 2 (SHA-256)** | `6a55447615e047f7d9854ce740c8fe705bc6c9c15ab012c8e9f39682174c8b5f` | `6a55447615e047f7d9854ce740c8fe705bc6c9c15ab012c8e9f39682174c8b5f` | **SEPADAN (100%)** |
| **Lampiran 2 (Dimensi)**| 2x2 piksel (Dinyahkod binari PNG sah) | 2x2 piksel (Dinyahkod binari PNG sah) | **SEPADAN (100%)** |

---

## 4. Perlindungan Guard AI Server-Side

- **Modul Guard:** `src/lib/ai/ai-guard.ts`
- **Pembolehubah Persekitaran:** `TEST_DISABLE_AI_CALLS=true`, `BLOCK_AI_NETWORK=true`
- **Ujian Unit Luar Talian:** `tests/ai-guard.test.ts` (4/4 lulus 100% tanpa sebarang akses rangkaian)
- **Cubaan Provider Disekat Semasa Larian:** `0`
- **Panggilan Rangkaian Provider Dihantar:** `0` (Sifar mutlak)
- **Status Guard:** `ZERO_ATTEMPTS_GUARANTEED`

---

## 5. Bukti Artifak Screenshot

1. **Penyerahan Aduan Penduduk (UI):**  
   `C:\Users\shams\.gemini\antigravity-ide\brain\f73c5ee6-76ec-4b98-ac3e-6e23b5a34c2a\resident-submitted-run.png` (63,074 bait)
2. **Peti Masuk Pengurusan Sebelum Restart:**  
   `C:\Users\shams\.gemini\antigravity-ide\brain\f73c5ee6-76ec-4b98-ac3e-6e23b5a34c2a\manager-inbox-before-restart.png` (372,037 bait)
3. **Peti Masuk Pengurusan Selepas Restart (Context Segar):**  
   `C:\Users\shams\.gemini\antigravity-ide\brain\f73c5ee6-76ec-4b98-ac3e-6e23b5a34c2a\manager-inbox-after-restart.png` (372,037 bait)
