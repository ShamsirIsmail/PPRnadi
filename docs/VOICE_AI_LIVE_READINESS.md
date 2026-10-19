# PPR NADI — Laporan Kesediaan Suara & AI Sebenar (Real Voice & AI Live Readiness Report)

**Tarikh:** 18 Oktober 2026  
**Ruang Kerja:** `C:\Dev\ppr-nadi`  
**Pratonton Aktif:** `http://localhost:3000` / `http://192.168.0.115:3000` (PID aktif, disahkan HTTP 200 OK pada halaman login dan borang aduan)

---

## 1. Matriks Status Kesediaan Komponen

Setiap komponen dinilai secara berasingan menggunakan status berasaskan bukti: `PASS`, `MOCK_PASS`, `PENDING_CONFIRMATION`, `FAIL`, `BLOCKED`, atau `NOT RUN`.

| Komponen / Aliran | Status | Justifikasi & Bukti Semasa |
| :--- | :---: | :--- |
| **1. Automasi Ujian Unit & Integrasi** | **PASS** | **122/122 ujian unit lulus (100%)** dalam larian terkini (termasuk ujian pengendali ralat HTTP 503 dan 33 ujian pengesah smoke-test AI luar talian dalam [`tests/smoke-test-real-ai.test.ts`](file:///c:/Dev/ppr-nadi/tests/smoke-test-real-ai.test.ts)).<br>39/39 senario pelayar terasing terdahulu disahkan lulus pada port 3001. |
| **2. Konfigurasi Provider Sebenar** | **PASS** | `GEMINI_MODEL=gemini-flash-latest` dikonfigurasikan dalam `.env.local`. Resolver rasmi aplikasi mengesahkan kedua-dua model transkripsi dan draf menggunakan `gemini-flash-latest` pada endpoint rasmi HTTPS `https://generativelanguage.googleapis.com`. |
| **3. Metadata Endpoint (`models.list`)** | **PASS** | Pemeriksaan metadata rasmi `v1beta/models` berjaya menyenaraikan 46 model yang menyokong `generateContent`, termasuk alias rasmi `gemini-flash-latest`. |
| **4. Smoke-Test Provider Sebenar** | **BELUM LULUS (Gagal HTTP 503)** | Percubaan terkini gagal dengan HTTP 503 (high demand). **Status rasmi: BELUM LULUS ujian sebenar.** Respons 503 sahaja **tidak membuktikan** API key atau keseluruhan konfigurasi adalah sah sepenuhnya. Ujian berhenti serta-merta tanpa panggilan draf, tanpa retry automatik, dan tanpa mutasi pangkalan data. |
| **5. Pengendalian Ralat 503 Dalam Aplikasi** | **PASS (Mock Terbukti)** | Disahkan melalui ujian unit: ralat 503 dipetakan kepada kod `SERVICE_BUSY` dengan mesej mesra pengguna dwibahasa (BM: *"Bantuan AI sedang sibuk. Cuba lagi sebentar nanti atau teruskan dengan menaip."*). Teks, lokasi, dan gambar pengguna dikekalkan sepenuhnya. Butang cuba semula hanya bertindak atas klik manual pengguna tanpa sebarang retry tersembunyi atau auto-hantar. |
| **6. Mikrofon Desktop Fizikal** | **NOT RUN / BELUM DIUJI** | Automasi mock telah mengesahkan logik MediaRecorder, tetapi ujian mikrofon fizikal desktop sebenar **belum dijalankan** oleh pengguna. |
| **7. Mikrofon Telefon Pintar** | **NOT RUN / BELUM DIUJI** | Memerlukan penyambungan Secure Context (USB Port Forwarding atau HTTPS yang dipercayai) pada peranti mudah alih fizikal sebenar. **Belum dijalankan**. |
| **8. Aliran Lengkap: Suara → Draf → Borang → Gambar → Semakan** | **PASS (Mock)**<br>**NOT RUN (Fizikal)** | Aliran integrasi lengkap lulus dalam ujian pelayar instrumen Playwright. Ujian manual pada peranti fizikal sebenar menanti pelaksanaan pengguna. |

---

## 2. Analisis Konfigurasi Sebenar & Diagnosis Ralat 404 & 503

### A. Pengesahan Model Efektif Semasa
Pemeriksaan langsung melalui resolver pengeluaran ([`src/lib/ai/provider-config.ts`](file:///c:/Dev/ppr-nadi/src/lib/ai/provider-config.ts)):
* `AI_PROVIDER`: `gemini`
* `Model Transkripsi Efektif`: `gemini-flash-latest`
* `Model Draf Efektif`: `gemini-flash-latest`
* `Endpoint Rasmi`: `https://generativelanguage.googleapis.com` (HTTPS rasmi disahkan)
* `Status Kunci API`: **TERSEDIA** (Server-side sahaja / Tiada prefix `NEXT_PUBLIC_`). Nilai atau sebahagian kunci tidak dipaparkan.

### B. Penilaian Ralat HTTP 404 & HTTP 503 Terkini
1. **Ralat HTTP 404 Terdahulu (gemini-2.5-flash):**
   * Sekatan akses model 2.5 atau ketiadaan laluan inferens untuk model tersebut merupakan salah satu kemungkinan punca ralat 404, dan bukan punca yang telah dibuktikan bagi akaun ini. Ralat 404 semata-mata tidak membuktikan kesahan atau pengesahan API key.
2. **Ralat HTTP 503 Semasa (gemini-flash-latest):**
   * Panggilan transkripsi sebenar menghasilkan respons daripada Google:
     `HTTP 503: This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.`
   * **Had Penilaian:** Respons HTTP 503 menunjukkan perkhidmatan huluan sedang mengalami kesesakan kapasiti, tetapi respons 503 ini **tidak membuktikan bahawa API key atau keseluruhan konfigurasi adalah sah sepenuhnya** sehingga satu run sebenar berjaya menghasilkan transkripsi dan draf yang sah (`LIVE_PASS`).
   * **Integriti Ujian:**
     - Skrip mematuhi had ketat: berhenti serta-merta tanpa membuat panggilan draf.
     - Tiada retry automatik dijalankan untuk mengelakkan pembaziran kuota atau kos.
     - Pangkalan data tidak disentuh (0 mutasi).
     - Tiada kunci rahsia terdedah.

---

## 3. Semakan Kriteria Semakan Fakta Smoke-Test (Tidak Dilonggarkan)

Modul pengesah [`scripts/smoke-test-core.mjs`](file:///c:/Dev/ppr-nadi/scripts/smoke-test-core.mjs) mengekalkan semakan fakta ketat dan tidak dilonggarkan untuk menyesuaikan hasil AI:
1. **Transkripsi:** Mesti mengandungi kerosakan lif (`/\b(lif|lifnya|elevator)\b/i`), tingkat 3 (`/\b(tingkat\s*(3|tiga)|aras\s*(3|tiga)|floor\s*(3|three))\b/i`), dan Blok A (`/\b(blok\s*a|block\s*a)\b/i`). Padanan longgar ditolak.
2. **Pemberhentian Awal:** Jika transkripsi gagal semakan fakta atau sambungan, panggilan draf dibatalkan serta-merta bagi melindungi kuota pengguna.
3. **Draf & Anti-Halusinasi:** `category === 'lift'`, `mentioned_floor === 3`, `mentioned_block === 'A'`. Nombor unit yang tidak disebut ditolak sebagai halusinasi. Butiran luar jangka ditandakan `NEEDS_MANUAL_REVIEW`.
4. **Klasifikasi Endpoint:** Menolak sebarang endpoint custom atau redirect bagi melindungi kunci API.

---

## 4. Status Pelayan Pratonton Port 3000

* **Server Preview Port 3000:** Sedang berjalan (`npm run start`, PID aktif) memuatkan `GEMINI_MODEL=gemini-flash-latest`.
* **Status HTTP:** `HTTP 200 OK` disahkan pada `http://127.0.0.1:3000/login`.
* **Kawalan Akses:** `http://127.0.0.1:3000/resident/lapor` mengembalikan `HTTP 307` ke `/login`.
* **Integriti Data Demo:**
  - Penduduk: `resident@sentosa.local` (Ahmad bin Razak, Blok A 05-01) utuh.
  - Pengurus: `manager@sentosa.local` (Siti Nurhaliza) utuh.
  - Pangkalan data demo dan fail bukti Storage kekal terpelihara tanpa sebarang mutasi.

---

## 5. Keputusan Larian Sebenar Terkini (Live Smoke-Test)

Arahan yang dijalankan dengan kebenaran pengguna:
```bash
npm run smoke:real-ai -- --confirm-live-call
```

Hasil sanitasi:
```text
==============================================================================
PPR NADI — CONTROLLED LIVE AI PROVIDER SMOKE TEST
==============================================================================
[SKOP UJIAN]
Skrip ini menguji sambungan dan ketepatan hasil penyedia AI secara terkawal.
Ia TIDAK membuktikan keseluruhan aliran pelayar, authentication, atau
penghantaran borang berfungsi.
==============================================================================
- Provider Dipilih     : gemini
- Klasifikasi Endpoint : OFFICIAL (https://generativelanguage.googleapis.com)
- Model Transkripsi    : gemini-flash-latest
- Model Draf           : gemini-flash-latest
- Status Kunci API     : TERSEDIA (Server-side sahaja / Tiada prefix NEXT_PUBLIC)
- Had Panggilan        : Maksimum 1 Transkripsi + 1 Draf bagi larian ini
- Kesan Database       : 0 (Tiada data dicipta atau dihantar ke database)

[Langkah 1/2] Melaksanakan 1 panggilan transkripsi suara...
✗ Transkripsi gagal: HTTP 503: This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.
```

**Ringkasan Larian:**
* Panggilan Transkripsi: 1 dibuat (mengembalikan HTTP 503 daripada Google).
* Panggilan Draf: 0 (dibatalkan serta-merta kerana langkah 1 gagal).
* Retry Automatik: 0.
* Pangkalan Data: 0 rekod dicipta/diubah.
