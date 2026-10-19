# Laporan Verifikasi Penuh: Cadangan Keutamaan AI Sebenar (Ciri 1)
**PPR NADI — Sistem Pengurusan Aduan Perumahan Awam**  
*Tarikh Ujian:* 19 Oktober 2026  
*Enjin Inferens:* Live Google Gemini API (Bukan Mock AI)

---

## 1. Ringkasan Eksekutif & Status Verifikasi

Verifikasi ini membuktikan secara empirikal bahawa inovasi teras PPR NADI — **Cadangan Keutamaan Boleh Dijelaskan (Explainable Priority Recommendation)** — berfungsi sepenuhnya menggunakan enjin AI sebenar Google Gemini, mematuhi semua kekangan integriti faktual, had bajet inferens (tepat 3 panggilan), kedaulatan keputusan manusia (Human-in-the-Loop), dan persistens pangkalan data.

```
LIVE_PROVIDER: PASS
FACT_ACCURACY: PASS
EXPLAINABLE_PRIORITY: PASS
HUMAN_CONFIRMATION: PASS
DATABASE_PERSISTENCE: PASS
DEMO_READINESS: PASS
```

---

## 2. Konfigurasi Provider & Model Efektif

| Parameter | Nilai Efektif | Catatan Pengesahan |
| :--- | :--- | :--- |
| **Penyedia AI (Provider)** | `gemini` | Ditentusahkan daripada persekitaran; tiada mock upstream server. |
| **Endpoint Rasmi** | `https://generativelanguage.googleapis.com` | Sambungan disahkan (TCP port 443 / HTTP 200). |
| **Model Draf / Pengekstrak** | `gemini-flash-latest` | Disahkan dalam katalog rasmi Google Gemini (resolver memetakan ke `gemini-3.8-flash`). |
| **Konfigurasi Penjanaan** | `temperature: 0.0`, `responseMimeType: "application/json"`, `thinkingBudget: 0` | Mengoptimumkan ketepatan deterministik dan mengelakkan kelengahan masa pemikiran. |
| **Had Masa Tamat (Timeout)** | 90 saat (`90000ms`) | Perlindungan terhadap lonjakan latensi rangkaian antarabangsa. |
| **Status Kunci API** | Tersedia & Berfungsi | 53 aksara; terlindung sepenuhnya pada lapisan pelayan tanpa sebarang pendedahan log. |

---

## 3. Hasil Ujian Inferens Sebenar Mengikut Senario

Ujian dijalankan dengan kawalan ketat **maksimum 3 panggilan inferens sebenar** tanpa percubaan semula automatik (zero automatic retries):

```
+----------------------------------------------------------------------------------------+
| Panggilan 1: Risiko Keselamatan Lif Blok A          --> 2,584 ms (LULUS)                |
| Panggilan 2: Gangguan Air + Aduan Berkaitan Blok B  --> 6,128 ms (LULUS)                |
| Panggilan 3: Kerosakan Setempat Lampu Koridor Blok C --> 3,864 ms (LULUS)                |
| JUMLAH PANGGILAN SEBENAR: 3 / 3 (100% Bajet Dipatuhi)                                  |
+----------------------------------------------------------------------------------------+
```

---

### Senario 1: Risiko Keselamatan — Lif Terperangkap (Blok A)
- **Teks Aduan:**
  > *"Lif Blok A berhenti antara tingkat tiga dan empat. Saya dengar orang di dalam meminta bantuan. Saya tidak tahu berapa orang."*
- **Latensi Panggilan:** `2,584 ms`
- **Fakta & Isyarat Diekstrak AI:**
  - `hasHazard`: `true`
  - `hazardType`: `'trapped_person'`
  - `isUncertain`: `false`
  - `sourceQuote`: `"Saya dengar orang di dalam meminta bantuan."` (Disahkan 100% padanan substring teks asal).
  - `unknowns`: `["number of people trapped", "duration of breakdown"]`
  - `status`: `'reported'` | `sourceType`: `'resident_transcript'` (Sistem membezakan transkrip aduan penduduk daripada rekod fakta rasmi).
- **Peraturan Dipadankan:** Peraturan `S-01`
- **Cadangan Keutamaan:** `immediate_review`
- **Penjelasan Boleh Terang (Explainability):**
  - Menerangkan bahawa terdapat indikator mangsa terperangkap dalam lif yang memerlukan tindakan serta-merta tanpa mengandaikan bilangan mangsa yang tidak dinyatakan.

---

### Senario 2: Gangguan Bekalan Asas dengan Korelasi Aduan (Blok B)
- **Teks Aduan:**
  > *"Air tiada di rumah saya di Blok B sejak pagi."*
- **Pautan Insiden Database:** 3 aduan dipautkan ke insiden yang sama dalam jadual `incident_report_links`.
- **Latensi Panggilan:** `6,128 ms`
- **Fakta & Isyarat Diekstrak AI & Database:**
  - `issueType`: Gangguan bekalan air (`water_supply`).
  - `relatedReportsCount`: `3` (Diambil secara berwibawa daripada rekod pangkalan data, bukan halusinasi AI).
  - Fakta Skop Rasmi: *"3 laporan dipautkan ke insiden yang sama dalam pangkalan data."* (`status: verified`, `sourceType: official_record`).
- **Peraturan Dipadankan:** Peraturan `I-02`
- **Cadangan Keutamaan:** `high_priority`
- **Penjelasan Boleh Terang (Explainability):**
  - *"Gangguan bekalan asas disokong oleh 3 laporan yang mungkin berkaitan. Semak skop gangguan sebelum mengesahkan satu insiden bersama."*
  - Sistem tidak membuat andaian bahawa keseluruhan blok terjejas; sebaliknya mengemukakan soalan verifikasi skop untuk pengurus menyemak aras/unit terkesan.

---

### Senario 3: Kerosakan Setempat dengan Penafian Bahaya (Blok C)
- **Teks Aduan:**
  > *"Satu lampu koridor tingkat empat padam. Lampu lain masih menyala. Tiada percikan api."*
- **Latensi Panggilan:** `3,864 ms`
- **Fakta & Isyarat Diekstrak AI:**
  - `hasHazard`: `false` (Penafian dihormati; tiada halusinasi bahaya kebakaran).
  - `isNegated`: `true` (Mengesan frasa penafian *"Tiada percikan api"*).
  - `hasAlternatives`: `true` (Mengesan alternatif *"Lampu lain masih menyala"*).
- **Peraturan Dipadankan:** Peraturan `R-03`
- **Cadangan Keutamaan:** `standard_review`
- **Penjelasan Boleh Terang (Explainability):**
  - *"Berdasarkan maklumat tersedia, gangguan dilaporkan terhad kepada satu lampu/titik setempat. Cadangan perlu dinaikkan jika maklumat risiko baharu diterima."*
  - Mengelakkan eskalasi palsu (false urgency), membolehkan sumber penyelenggaraan difokuskan kepada insiden berkepentingan tinggi.

---

## 4. Pengesahan Pengurus, Persistens & Verifikasi Sifar Panggilan AI

Prinsip teras PPR NADI ialah **AI mencadangkan, pengurus menentukan**:

1. **Pengesahan Keputusan:**
   - Pengurus (`manager@sentosa.local`) mengesahkan cadangan `immediate_review` bagi Senario 1 melalui `confirmPriorityDecisionAction`.
   - Rekod disimpan dengan `decision_version = 1`, `evaluation_id = 0050b269-a3f1-4540-8753-91b55e7e2582`, `decision_id = c3f8e6d8-ffaf-4a4d-8792-14c9a0f1cdf2`.
2. **Pembacaan Semula Melalui Sesi Pengurus Baharu (Fresh Session):**
   - Sesi autentikasi baharu dicipta untuk memuat semula data aduan melalui `getPriorityDataAction`.
   - Data dipulangkan tepat sama:
     - Versi Keputusan: `v1`
     - Keutamaan Disahkan: `immediate_review`
     - Decision ID sepadan secara tepat dengan rekod yang disimpan.
3. **Integriti Kos Inferens (Zero Additional AI Calls):**
   - **Tepat 0 panggilan AI tambahan** dilakukan semasa operasi bacaan semula atau semakan peti masuk (Inbox).
   - Penilaian dan keputusan yang telah dijana kekal tersimpan secara deterministik dalam pangkalan data.
4. **Integriti Status Aduan:**
   - Status aduan dalam pangkalan data kekal sebagai `"submitted"`.
   - Mengesahkan bahawa penetapan keutamaan **tidak** menanda aduan sebagai selesai (`resolved`/`closed`) secara pramatang.

---

## 5. Analisis Punca Kelewatan Awal & Langkah Mitigasi

Semasa percubaan awal, panggilan inferens mengalami masa tamat (timeout) melebihi 45 saat. Siasatan mendalam mendapati dua faktor teknikal:
1. **Model Versi & Overhead Pemikiran (Thinking Mode):**
   - Nama model `gemini-flash-latest` pada masa ini dipetakan oleh Google API kepada generasi `gemini-3.8-flash`.
   - Secara lalai, model generasi baharu menjana token pemikiran (`thoughtSignature`) yang mengambil masa 30–60 saat tambahan.
   - **Penyelesaian:** Menetapkan parameter eksplisit `thinkingConfig: { thinkingBudget: 0 }` dalam `generationConfig`. Hasilnya, latensi inferens menurun secara dramatik kepada **2.5 – 6.1 saat**.
2. **Had Masa Tamat Klien (Client Abort Budget):**
   - Had masa tamat dinaikkan daripada 45 saat kepada 90 saat bagi mengelakkan sambungan terputus akibat latensi penghantaran paket antarabangsa.
3. **Pembersihan JSON:**
   - Pelayan Gemini kadang-kala menghasilkan koma di hujung tatasusunan/objek (*trailing commas*). Fungsi `cleanJsonString` dalam `extractor.ts` membuang koma ini sebelum `JSON.parse`, menghapuskan ralat parsing sepenuhnya.

---

## 6. Penilaian Ketersediaan untuk Ciri Seterusnya

Dengan kejayaan penuh verifikasi Ciri 1:
- [x] Model Gemini sebenar terbukti menghasilkan fakta berstruktur, petikan teks asli yang sahih, dan pengesanan penafian yang tepat.
- [x] Sistem peraturan (`rules.ts`) menghasilkan keputusan keutamaan yang boleh dijelaskan secara telus.
- [x] Keputusan pengurus tersimpan dengan teguh dalam pangkalan data dan boleh dibaca semula tanpa sebarang kos AI berulang.
- [x] Kod bebas daripada ralat kompilasi TypeScript (`tsc --noEmit` lulus) dan linter (`eslint` lulus).

**Kesimpulan:** Sistem kini **100% bersedia** untuk beralih kepada pengujian **Ciri 2: Aduan Suara → Draf yang Boleh Disemak dan Dibetulkan Penduduk** menggunakan model transkripsi dan draf AI sebenar.
