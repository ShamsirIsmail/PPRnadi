# PPR NADI — Laporan Akhir Remedi Voice AI, Kod Sebenar & Pengasingan Ujian (Final Verification Report)

**Tarikh:** 18 Oktober 2026  
**Ruang Kerja:** `C:\Dev\ppr-nadi`  
**Status Pengesahan:** Lulus Sepenuhnya pada Persekitaran Terasing (88/88 Ujian Unit, 17/17 Ujian Suara Pelayar, 10/10 Senario Regresi Borang E2E, 12/12 Langkah Pemulihan Terputus Rangkaian)

---

## 1. Ringkasan Eksekutif & Skop Pembetulan

Semakan bebas pasca-remedi telah menetapkan keperluan untuk menutup kelemahan bukti ujian:
1. **Menguji Kod Sebenar Aplikasi (Bukan Salinan Logik):**
   - Memansuhkan fungsi ujian pendua `stopRecordingSessionFixed` dalam `tests/voice-recording.test.ts`.
   - Mengekstrak kitaran hayat rakaman dan pengurusan perakam audio ke dalam modul pengeluaran sebenar `src/lib/voice/recording-session.ts`.
   - Mengimport dan menggunakan modul yang sama dalam komponen sebenar `src/components/resident/VoiceNarrativeModal.tsx` dan fail ujian unit `tests/voice-recording.test.ts`.
   - Mengemukakan bukti regresi di mana ralat listener berganda sengaja disuntik dan dikesan gagal oleh ujian, serta lulus semula selepas dipulihkan.
2. **Membuktikan Ketiadaan Panggilan Transkripsi Semasa Timeout / Batal Menggunakan Server Hulu:**
   - Menggantikan teknik pengesanan URL pihak pelanggan (client-side URL sniffing) dengan pemantauan pelayan mock hulu (`tests/upstream-mock-server.mjs`) pada port `3928`.
   - Membezakan permintaan transkripsi audio (`transcriptionRequestCount`) daripada permintaan draf teks AI (`draftRequestCount`).
   - Mengesahkan perubahan kiraan (delta) adalah **tepat 0** untuk senario Timeout (missing stop event), Klik Batal (X), Tekan Escape, Had Saiz 5MB, dan Pelepasan Sesi Lapuk.
   - Mengesahkan rakaman sah menghasilkan pertambahan tepat 1 panggilan dengan saiz muatan audio tepat **2012 bait** tanpa pendua.
3. **Pengasingan Mutlak Ujian Pelayar:**
   - Menghasilkan runner ujian automatik `tests/run-isolated-suite.mjs` dengan skrip `npm run test:browser:isolated`.
   - Menetapkan sasaran aplikasi terasing pada `http://127.0.0.1:3001` dan direktori binaan `.next-test` (`NEXT_DIST_DIR=.next-test`).
   - Menyediakan guard keselamatan tegas yang menolak sasaran port 3000 bagi melindungi pelayan preview.
   - Teardown selamat yang hanya mematikan proses anak (child process PID) yang dilancarkan oleh runner sendiri tanpa membunuh proses mengikut nombor port.
   - Mengesahkan server preview port 3000 kekal berjalan dan tidak terganggu.

---

## 2. Modul Kod Sebenar & Penghapusan Salinan Algoritma

### A. Ekstraksi Modul Pengeluaran Sebenar
* **Fail Baharu:** [`src/lib/voice/recording-session.ts`](file:///c:/Dev/ppr-nadi/src/lib/voice/recording-session.ts)
* **Kandungan & Tanggungjawab Modul:**
  - `setupSessionRecorderListeners(session, onStopCallback)`: Mendaftarkan satu handler tunggal (`ondataavailable`) sepanjang kitaran hayat sesi untuk mengumpul chunk audio dan mengira `totalBytes`. Mengelakkan sebarang listener `dataavailable` tambahan semasa henti.
  - `stopMediaRecorderSafely(session, timeoutMs)`: Mengendalikan proses berhenti perakam W3C yang hanya mendengar event `stop` dan `error`, dengan had masa terkawal (`RECORDER_STOP_TIMEOUT_MS = 4000ms`).
  - `stopSessionMediaTracks(session)`: Menghentikan semua trek mikrofon perkakasan (`track.stop()`) sebaik sahaja rakaman selesai atau dibatalkan.
  - `stopSessionHardware(session)`: Membersihkan semua sumber perkakasan termasuk pemasa auto-stop (`clearTimeout`), `SpeechRecognition.abort()`, dan trek audio.
  - Pemalar Piawai: `MAX_RECORDING_SECONDS = 60`, `MAX_RECORDING_BYTES = 5 * 1024 * 1024` (5 MB), `RECORDER_STOP_TIMEOUT_MS = 4000`.
  - Fungsi utiliti MIME audio dan pengesanan pelayar: `getSupportedAudioMime()`, `getExtensionFromMime()`.

### B. Komponen Sebenar Menggunakan Modul
* **Fail:** [`src/components/resident/VoiceNarrativeModal.tsx`](file:///c:/Dev/ppr-nadi/src/components/resident/VoiceNarrativeModal.tsx)
* Komponen modal pengeluaran mengimport secara langsung fungsi-fungsi kitaran hayat daripada `@/lib/voice/recording-session`. Tiada lagi implementasi inline yang berasingan atau pendua antara fail pengeluaran dan ujian.

### C. Ujian Unit Menguji Kod Sebenar
* **Fail:** [`tests/voice-recording.test.ts`](file:///c:/Dev/ppr-nadi/tests/voice-recording.test.ts)
* Fungsi `stopRecordingSessionFixed` telah **dibuang sepenuhnya**. Ujian kini mengimport terus:
  ```ts
  import {
    setupSessionRecorderListeners,
    stopMediaRecorderSafely,
    stopSessionMediaTracks,
    stopSessionHardware,
    MAX_RECORDING_BYTES,
    type RecordingSession,
    type SpeechRecognitionInstance,
  } from '@/lib/voice/recording-session';
  ```

---

## 3. Bukti Ujian Regresi (Injected Bug vs Restored Code)

Bagi membuktikan bahawa ujian unit mengesahkan kod pengeluaran sebenar dan mampu menangkap pepijat asal:

1. **Suntikan Pepijat Sementara (Injected Duplicate Listener Bug):**
   Dalam `src/lib/voice/recording-session.ts`, fungsi `stopMediaRecorderSafely` diubah sementara dengan menambah kembali listener `dataavailable` kedua semasa menunggu stop:
   ```ts
   // Injected temporary regression:
   recorder.addEventListener('dataavailable', (e) => {
     if (e.data && e.data.size > 0) {
       session.audioChunks.push(e.data);
       session.totalBytes += e.data.size;
     }
   });
   ```
2. **Hasil Ujian Regresi:**
   Ujian unit dijalankan menggunakan `npm test`. Ujian **gagal serta-merta** dengan ralat:
   ```
   FAIL tests/voice-recording.test.ts > Real Recording Session Module > collects normal chunks and delayed (>500ms) final chunk exactly once without duplication
   AssertionError: expected 4 to be 3
   - Expected: 3
   + Received: 4
   ```
   Jumlah bait yang terkumpul meningkat kepada 20 bait (chunk akhir 5 bait dikira dua kali).
3. **Pemulihan Kod (Restored Production Code):**
   Listener kedua dipadamkan daripada `src/lib/voice/recording-session.ts`. Ujian dijalankan semula dan **lulus sepenuhnya (88/88 ujian unit lulus, 100%)**.
   Ini membuktikan ujian tidak bergantung kepada salinan logik, tetapi secara aktif mengawal integriti modul pengeluaran sebenar.

---

## 4. Bukti Ketiadaan Panggilan Transkripsi Semasa Timeout & Senario Batal

Pengesahan panggilan transkripsi dipantau secara langsung pada pelayan mock hulu (`http://127.0.0.1:3928/mock-stats`). Pelayan ini memisahkan `transcriptionRequestCount` (permintaan audio) daripada `draftRequestCount` (permintaan teks draf AI).

Setiap senario merekodkan baseline kiraan sebelum interaksi bermula dan menyemak pertambahan kiraan (delta) sebaik sahaja senario selesai.

### Jadual Kiraan Hulu Sebelum & Selepas Senario

| Senario Ujian Pelayar | Fail & No. Ujian | Kiraan Sebelum | Kiraan Selepas | Delta Transkripsi | Status & Pengesahan |
| :--- | :--- | :---: | :---: | :---: | :--- |
| **Batal Rakaman via Butang X** | `tests/browser-voice-workflow.mjs` (Test 1) | 0 | 0 | **0** | **LULUS**: Mikrofon ditutup serta-merta, 0 panggilan transkripsi hulu. |
| **Batal Rakaman via Kekunci Escape** | `tests/browser-voice-workflow.mjs` (Test 2) | 0 | 0 | **0** | **LULUS**: Mikrofon ditutup serta-merta, 0 panggilan transkripsi hulu. |
| **Rakaman Sah (Final Chunk >500ms)** | `tests/browser-voice-workflow.mjs` (Test 5) | 0 | 1 | **+1** | **LULUS**: Tepat 1 panggilan transkripsi. Saiz muatan audio diterima: **2012 bait** (tepat tanpa pendua). |
| **Timeout Berhenti (Missing Stop Event)** | `tests/browser-voice-workflow.mjs` (Test 6) | 1 | 1 | **0** | **LULUS**: Selepas timeout 4000ms tamat, ralat dipaparkan dan **0** transkripsi dipanggil. |
| **Had Saiz Audio Terlampau (5 MB)** | `tests/browser-voice-workflow.mjs` (Test 9) | 1 | 1 | **0** | **LULUS**: Auto-stop serta-merta, amaran had saiz dipaparkan, **0** transkripsi dipanggil. |
| **Pelepasan Stop Tertunda Sesi 1 (Overlap)**| `tests/browser-voice-workflow.mjs` (Test 10) | 1 | 1 | **0** | **LULUS**: Event stop tertunda dari Sesi 1 tidak mencetuskan sebarang transkripsi untuk Sesi 1. |

---

## 5. Skop Pengasingan Aplikasi, Database & Teardown Selamat

### A. Pengasingan Aplikasi & Binaan
- **Port Aplikasi Terasing:** `http://127.0.0.1:3001`
- **Direktori Binaan Terasing:** `.next-test` (dikonfigurasikan melalui `NEXT_DIST_DIR=.next-test` dan dimasukkan dalam `.gitignore`)
- **Guard Penolakan Port 3000:** Skrip `tests/run-isolated-suite.mjs` mengandungi logik pemeriksaan ketat yang serta-merta menamatkan pelaksanaan jika `TEST_APP_URL` diarahkan ke port 3000:
  ```js
  const parsedTarget = new URL(TARGET_URL);
  if (parsedTarget.port === '3000' || TARGET_URL.includes(':3000')) {
    console.error('\n[FATAL SAFETY GUARD VIOLATION] Target URL points to port 3000!');
    process.exit(1);
  }
  ```

### B. Pengasingan Teardown Selamat
- Runner mengesan dan mendaftarkan proses anak (child process) yang dimulakan oleh runner itu sendiri (`Next.js Test Server (port 3001)` dan `Upstream Mock Server`).
- Semasa penamatan (teardown atau SIGINT/SIGTERM), pembersihan **hanya mematikan PID spesifik yang didaftarkan** (cth: PID 25048).
- Runner **tidak membunuh proses secara melulu berasaskan carian nombor port** (tiada `netstat` kill atau bunuh semua node.exe).

### C. Skop Pangkalan Data (Ketelusan Penuh)
- **Database:** Local Supabase PostgreSQL instance (`127.0.0.1:64322`).
- **Penjelasan Pengasingan:** Mengikut amalan jujur kejuruteraan, pangkalan data **bukanlah pangkalan data berasingan fizikal**, sebaliknya berkongsi instance demo tempatan yang sama dengan pelayan preview.
- **Keselamatan Data Ujian:** Ujian menggunakan pengguna sintetik (`synthetic auth users`) dan token unik setiap larian (`runToken`). Blok teardown memadamkan semua pengguna sintetik dan fail storan yang dicipta oleh ujian. Akaun demo kekal (`resident@sentosa.local`, `manager@sentosa.local`) dan rekod storan asas (tepat 30 objek) disahkan kekal utuh sebelum dan selepas ujian.

### D. Pengesahan Server Preview Port 3000
Server preview pada port 3000 disahkan kekal aktif tanpa gangguan:
```
HTTP/1.1 200 OK
Vary: rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch, Accept-Encoding
x-nextjs-cache: HIT
Content-Type: text/html; charset=utf-8
```

---

## 6. Perintah, Exit Code, Jumlah Ujian & URL Sasaran

Semua perintah telah dijalankan dan lulus 100%:

| Bil | Perintah Pelaksanaan | Exit Code | URL Sasaran / Persekitaran | Jumlah Ujian & Hasil |
| :---: | :--- | :---: | :--- | :--- |
| 1 | `npm run lint` | **0** | Tempatan | **0 errors, 0 warnings** (ESLint 9 memeriksa kod TS dan MJS). |
| 2 | `npx tsc --noEmit` | **0** | Tempatan | **0 type errors** (TypeScript 5 semakan jenis ketat lulus 100%). |
| 3 | `npm test` | **0** | In-Memory (Vitest 5) | **88/88 ujian unit lulus (100%)**:<br>• `tests/estate-contract.test.ts` (7 ujian)<br>• `tests/report-boundary.test.ts` (8 ujian)<br>• `tests/validators.test.ts` (8 ujian)<br>• `tests/ai-draft.test.ts` (57 ujian)<br>• `tests/voice-recording.test.ts` (8 ujian) |
| 4 | `npm run test:browser:isolated`<br>(atau `node tests/run-isolated-suite.mjs`) | **0** | `http://127.0.0.1:3001`<br>(Build: `.next-test`) | **3 suite pelayar lengkap lulus 100%**: |
| 4a| ↳ `node tests/browser-voice-workflow.mjs` | **0** | `http://127.0.0.1:3001` | **17/17 ujian lulus (100%)** — Ujian kitaran hayat audio, chunk deduplication, auto-stop 60s, had 5MB, zon AI, dwibahasa (25.0s). |
| 4b| ↳ `node tests/browser-workflow.mjs` | **0** | `http://127.0.0.1:3001` | **10/10 senario lulus (100%)** — Aliran borang, bukti gambar >1MB, pendaftaran durable, pengurusan insiden, buletin penduduk, RLS (25.1s). |
| 4c| ↳ `node tests/browser-response-loss.mjs` | **0** | `http://127.0.0.1:3001` | **12/12 langkah lulus (100%)** — Pemulihan terputus rangkaian, tiada rekod pendua, integriti storan (7.1s). |

---

## 7. Status Pengkategorian Ujian (Test Classification & Limitations)

Bagi menjamin ketelusan audit tanpa sebarang dakwaan palsu atau andaian:

| Kategori Pengujian | Status | Butiran & Skop Pengesahan |
| :--- | :---: | :--- |
| **Semakan Kod (Code Review)** | **LULUS** | Struktur kod mematuhi prinsip single-handler W3C MediaRecorder, tiada salinan algoritma dalam ujian, validasi konfigurasi rate limiter ketat dengan nilai selamat 1..50. |
| **Ujian Automasi Menggunakan Mock** | **LULUS** | 88 ujian unit Vitest dan 39 senario pelayar Playwright lulus sepenuhnya menggunakan mock instrumen Chrome MediaDevices dan mock server upstream port 3928. |
| **Ujian Mikrofon Fizikal Sebenar** | **BELUM DIUJI** | Memerlukan peranti fizikal sebenar (telefon pintar/komputer riba penduduk), mikrofon perkakasan sebenar, dan persekitaran akustik sebenar PPR (gema koridor, hingar latar belakang). Belum dijalankan dalam persekitaran pembangunan automatik. |
| **Ujian Provider AI Sebenar dengan Kunci Berbayar** | **BELUM DIUJI** | Sengaja tidak dijalankan bagi mematuhi skop keselamatan projek (mengelakkan pembaziran kuota API berbayar dan melindungi kunci rahsia). Kod pengeluaran disahkan menghantar format payload Google Gemini / OpenAI Whisper yang mematuhi spesifikasi rasmi. |
