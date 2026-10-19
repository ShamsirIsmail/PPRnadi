# PPR NADI — Laporan Akhir Kebolehpercayaan Peti Masuk, Imutabiliti Pautan & Pengesahan Browser E2E Pasca-Restart

**Tarikh:** 19 Oktober 2026  
**Objektif:** Menyelesaikan dan mengesahkan secara menyeluruh:
1. Ralat pangkalan data inbox tidak disembunyikan (tiada kekosongan palsu / tiada penggantian aduan contoh dalam inbox sebenar).
2. Perubahan pautan insiden dikawal dengan lengkap melalui migration tambahan (sekat mutasi `incident_id` dan `report_id`).
3. Aliran priority diuji melalui Google Chrome sebenar dari penjanaan & pengesahan UI hingga selepas restart proses aplikasi Next.js baharu.
4. Integrasi penambahbaikan Codex (pengasingan bahasa BM/EN tulen, pembacaan pautan insiden dalam `getPriorityDataAction`, dan penyekatan pengesahan apabila versi tidak diketahui).

---

## Status Berasingan (Status Mandatori)

| Kategori Pengesahan | Status | Ringkasan Bukti Sebenar |
| :--- | :--- | :--- |
| **INBOX_ERROR_HANDLING** | **PASS** | `withDbTimeout` dan `fetchWithDbGuard` membezakan 4 keadaan: (a) Berjaya ada rekod, (b) Berjaya senarai kosong, (c) Timeout, (d) Bacaan gagal. Komponen [InboxLoadError](file:///c:/Dev/ppr-nadi/src/app/(management)/management/inbox/InboxLoadError.tsx) memaparkan banner ralat mengikut bahasa pilihan pengguna sahaja (BM sahaja atau English sahaja, tiada teks dwibahasa bercampur). Apabila kueri keutamaan gagal/timeout, sistem **tidak** memaparkan "belum dinilai" atau "belum disahkan", sebaliknya memaparkan lencana ralat berserta butang cuba semula. Borang pengesahan disekat (`decision-blocked-warning`) jika versi keputusan tidak diketahui untuk mengelakkan penulisan data cacat. Inbox sebenar tidak sekali-kali menyuntik aduan contoh apabila database gagal atau kosong. |
| **LINK_MOVE_PROTECTION** | **PASS** | Berdasarkan audit aplikasi, operasi memindahkan pautan sedia ada kepada insiden/aduan lain tidak disokong. Migration tambahan [`20261019150000_incident_link_immutability.sql`](file:///c:/Dev/ppr-nadi/supabase/migrations/20261019150000_incident_link_immutability.sql) melarang mutasi `incident_id` dan `report_id` pada `UPDATE` dengan ralat `LINK_MUTATION_NOT_SUPPORTED` (`ERRCODE = '0A000'`). Operasi standard `INSERT` dan `DELETE` pautan kekal diselaraskan secara deterministik melalui kunci baris `incidents` (`FOR UPDATE`). |
| **APPLICATION_END_TO_END** | **PASS** | Aliran penuh dijalankan melalui pelayar Google Chrome sebenar: Log masuk pengurus -> Buka aduan ujian dalam inbox -> Klik butang "Jana cadangan" di UI -> Pilih keutamaan `immediate_review` & masukkan sebab override di UI -> Klik "Sahkan keputusan pengurus" di UI -> Lencana UI mengesahkan `"Disahkan: Semak serta-merta"`. Tiada import `evaluateReportPriorityAction` atau `confirmPriorityDecisionAction` dalam skrip ujian. |
| **RESTART_PERSISTENCE** | **PASS** | Proses aplikasi ujian pada port terpencil `3005` (PID `18756`) dihentikan. Port pengguna `3000` (PID `13232`) kekal berjalan tanpa disentuh. Proses aplikasi Next.js baharu dimulakan pada port `3005` (PID `36272`). Sesi pelayar Chrome baharu log masuk semula dan membuka aduan yang sama. Keputusan, versi (`v1`), keutamaan, catatan override, dan ID yang sama dipaparkan. Tepat 1 rekod evaluation dan 1 rekod decision di DB (tiada duplikasi). |
| **BROWSER_VERIFICATION** | **PASS** | Dijalankan menggunakan binari **Google Chrome Sebenar** (`C:\Program Files\Google\Chrome\Application\chrome.exe`) melalui Playwright. Seluruh interaksi dari log masuk, penjanaan cadangan, pemilihan dropdown, pengisian teks, penyerahan borang, penukaran bahasa antaramuka (BM <-> EN), penutupan pelayar, sehingga pembukaan pelayar baharu pasca-restart disahkan melalui DOM & atribut elemen UI yang terhidrasi (`data-hydrated="true"`). |
| **LIVE_AI** | **NOT_TESTED** | Tiada panggilan dibuat ke API Gemini berbayar untuk mengelakkan kos dan ketidaktentuan kuota. Upstream Mock AI HTTP Server berasingan digunakan pada port dinamik (`http://127.0.0.1:49704`) untuk meniru respons model `gemini-flash-latest`. Panggilan direkodkan: tepat 1 panggilan semasa penjanaan UI awal, dan **0 panggilan baharu** semasa pembacaan pasca-restart. |

---

## 1. Fail & Migration Yang Berubah

### A. Komponen Ralat Dwibahasa Bersih (Codex Fix)
- [`src/app/(management)/management/inbox/InboxLoadError.tsx`](file:///c:/Dev/ppr-nadi/src/app/(management)/management/inbox/InboxLoadError.tsx)
  - Komponen klien khusus untuk kegagalan dan had masa tamat (timeout) inbox.
  - Mengasingkan teks sepenuhnya:
    - **BM (`locale === 'ms'`):** "Masa sambungan pangkalan data tamat" / "Gagal memuatkan peti masuk", "Senarai aduan tidak dapat dimuatkan. Sila cuba semula.", "Cuba semula".
    - **English (`locale === 'en'`):** "Database connection timed out" / "Unable to load inbox", "The complaints list could not be loaded. Please try again.", "Retry".
  - Tiada pencampuran teks dwibahasa serentak.

### B. Pengendalian Ralat Inbox & Pembacaan Pautan
- [`src/app/(management)/management/inbox/page.tsx`](file:///c:/Dev/ppr-nadi/src/app/%28management%29/management/inbox/page.tsx)
  - Menggunakan `InboxLoadError` untuk ralat `timeout` atau `error` daripada kueri aduan.
  - Menghapuskan penggantian aduan contoh apabila kueri aduan sebenar gagal atau kosong.
- [`src/app/actions/priority.ts`](file:///c:/Dev/ppr-nadi/src/app/actions/priority.ts)
  - `getPriorityDataAction` kini membaca pautan aduan daripada `incident_report_links`.
  - Jika kueri pautan gagal (`linkErr`), respons memulangkan `success: false` berserta ralat eksplisit, dan `currentVersion` tidak dibekalkan (mengelakkan versi 0 palsu).
- [`src/app/(management)/management/inbox/PriorityExplainerPanel.tsx`](file:///c:/Dev/ppr-nadi/src/app/%28management%29/management/inbox/PriorityExplainerPanel.tsx)
  - Pemuatan semula (`reloadPriorityData`) menggantikan evaluation dan keputusan sedia ada dengan data segar dari database.
  - Nilai versi keputusan diselaraskan bersama keputusan (`v{latestDecision.decisionVersion ?? currentVersion}`).
  - Sekiranya pemuatan semula gagal, versi dianggap tidak diketahui (`isVersionKnown = false`), dan borang pengesahan disekat serta-merta dengan amaran `decision-blocked-warning` dan butang sahkan dilumpuhkan (`disabled={isPending || !isVersionKnown}`).
  - Menggunakan `useSyncExternalStore` untuk pengesanan hidrasi klien tanpa mencetuskan cascading render ESLint.

### C. Migration Pangkalan Data Tambahan (Additive Migration)
- [`supabase/migrations/20261019150000_incident_link_immutability.sql`](file:///c:/Dev/ppr-nadi/supabase/migrations/20261019150000_incident_link_immutability.sql)
  - Melindungi integriti pautan `incident_report_links` daripada cubaan `UPDATE` yang mengubah `incident_id` atau `report_id`.
  - Fungsi trigger: `public.guard_incident_link_immutability()`:
    ```sql
    IF (NEW.incident_id IS DISTINCT FROM OLD.incident_id) OR (NEW.report_id IS DISTINCT FROM OLD.report_id) THEN
      RAISE EXCEPTION 'LINK_MUTATION_NOT_SUPPORTED: Pemindahan pautan antara insiden atau aduan tidak disokong. Sila padamkan pautan lama dan cipta pautan baharu.'
        USING ERRCODE = '0A000';
    END IF;
    ```
  - Trigger `ENABLE ALWAYS` pada `public.incident_report_links`:
    - `trg_incident_link_immutability_update` (BEFORE UPDATE)

---

## 2. Bukti Ujian Integrasi Pangkalan Data Sebenar (30/30 LULUS)

Melalui pelaksanaan `npx vitest run tests/real-supabase-priority-integration.test.ts`:
1. **Perlindungan Penulisan Terus (5 ujian):**
   - Percubaan `INSERT` terus ke `report_priority_evaluations` atau `report_priority_decisions` ditolak oleh pangkalan data (kod `42501`).
   - Pengesahan sah dibenarkan secara eksklusif melalui `confirm_priority_decision_rpc`.
2. **Keselamatan Idempotency Key (6 ujian):**
   - Key yang sama dengan payload sama memulangkan keputusan sedia ada tanpa duplikasi.
   - Key yang sama dengan payload berbeza ditolak serta-merta (`IDEMPOTENCY_MISMATCH`).
   - Percubaan rentas aduan atau rentas kawasan (cross-estate) menggunakan key diketahui disekat sepenuhnya.
3. **Penyelarasan Konkurensi & Semakan Lapuk Atomik (3 ujian):**
   - Pengesahan ditolak secara atomik sebagai `STALE_EVALUATION` sekiranya aduan diubah atau pautan ditambah serentak.
4. **Imutabiliti Pautan & Penolakan Pemindahan (3 ujian):**
   - `UPDATE` mengubah `incident_id` ditolak dengan kod `0A000` (`LINK_MUTATION_NOT_SUPPORTED`).
   - `UPDATE` mengubah `report_id` ditolak dengan kod `0A000` (`LINK_MUTATION_NOT_SUPPORTED`).
   - Pautan asal kekal utuh.
   - Operasi standard `INSERT` dan `DELETE` pautan dibenarkan dan kekal diselaraskan.
5. **Pengendalian Ralat Inbox & Pautan (4 ujian):**
   - Kegagalan kueri evaluation memulangkan ralat bersih dan **tidak** mendakwa "belum dinilai".
   - Kegagalan kueri decision pada aduan yang telah disahkan memulangkan ralat dan **tidak** mendakwa "belum disahkan" atau versi 0 sah.
   - Kegagalan kueri laporan aduan memulangkan ralat bersih tanpa mencipta aduan contoh.
   - Kegagalan kueri pautan `incident_report_links` memulangkan ralat dan **tidak** memulangkan status berjaya palsu (`currentVersion` tidak ditentukan).

---

## 3. Bukti Ujian Browser Sebenar (Google Chrome) Pasca-Restart

Ujian automasi pelayar Google Chrome sebenar (`tests/real-process-restart-durability.ts`) telah dijalankan dan disahkan sepenuhnya:

### A. Persekitaran Ujian
- **Pelayar Automasi:** Google Chrome Sebenar (`C:\Program Files\Google\Chrome\Application\chrome.exe` via `playwright-core`)
- **Port Ujian Terpencil:** `3005` (Direktori build terpencil: `.next-test`)
- **Port Aplikasi Pengguna:** `3000` (PID `13232` — disahkan kekal beroperasi tanpa sebarang gangguan)
- **Pelayan Upstream Mock AI:** `http://127.0.0.1:49704`
- **PID Sebelum Restart:** `18756`
- **PID Selepas Restart:** `36272` (Disahkan proses baharu sepenuhnya)

### B. Snapshot Data Sebelum vs Selepas Restart

| Parameter | Snapshot Browser 1 (PID: 18756) | Snapshot Browser 2 Pasca-Restart (PID: 36272) | Status Semakan |
| :--- | :--- | :--- | :--- |
| **Aduan Ujian (Report ID)** | `948612e0-2d42-4932-907b-1b221a347154` | `948612e0-2d42-4932-907b-1b221a347154` | **IDENTIKAL** |
| **Evaluation ID** | `88d2e46a-a959-4e40-9d7e-bed79994ed77` | `88d2e46a-a959-4e40-9d7e-bed79994ed77` | **IDENTIKAL** |
| **Decision ID** | `2cf4c146-bb93-47a2-95a8-7c58d7b2aa7d` | `2cf4c146-bb93-47a2-95a8-7c58d7b2aa7d` | **IDENTIKAL** |
| **Versi Keputusan** | `v1` | `v1` | **IDENTIKAL** |
| **Keutamaan Diputuskan** | `immediate_review` | `immediate_review` | **IDENTIKAL** |
| **Status Override (`isOverride`)** | `true` | `true` | **IDENTIKAL** |
| **Catatan Override** | `"Pemeriksaan fizikal pasukan teknikal di tapak: motor brek perlu dilaraskan."` | `"Pemeriksaan fizikal pasukan teknikal di tapak: motor brek perlu dilaraskan."` | **IDENTIKAL** |
| **Pengurus Yang Mengesahkan** | `b999a4ac-3275-462e-a757-1b3a33131aed` (Siti Nurhaliza) | `b999a4ac-3275-462e-a757-1b3a33131aed` | **IDENTIKAL** |
| **Status Lencana di UI (BM)** | `Disahkan: Semak serta-merta` | `Disahkan: Semak serta-merta` | **IDENTIKAL** |
| **Status Lencana di UI (EN)** | `Confirmed: Immediate review` | `Confirmed: Immediate review` | **IDENTIKAL** |
| **Bilangan Baris Evaluation DB**| `1` | `1` | **TIADA DUPLIKASI** |
| **Bilangan Baris Decision DB** | `1` | `1` | **TIADA DUPLIKASI** |
| **Panggilan Upstream AI Pasca-Restart** | `1` (semasa penjanaan UI) | `0` (semasa pembacaan pasca-restart) | **0 PANGGILAN BERULANG** |

### C. Bukti Pengesahan Bahasa (BM vs EN)
- Semasa sesi Browser 2 di inbox, butang pertukaran bahasa diklik:
  - **Dalam mod BM:** Lencana pengesahan memaparkan `"Disahkan: Semak serta-merta"`. Kad keputusan memaparkan `"Keputusan Semasa Disahkan"`.
  - **Dalam mod EN:** Lencana pengesahan memaparkan `"Confirmed: Immediate review"`.
  - Disahkan: UI memaparkan bahasa yang dipilih secara bersih tanpa teks bercampur.

---

## 4. Ringkasan Perintah Validasi

```bash
# 1. Ujian Unit & Integrasi MVP
npx vitest run tests/priority-explainer.test.ts tests/priority-mvp-durability.test.ts
# Hasil: 29/29 tests passed (termasuk ujian kegagalan bacaan pautan & pemulihan)

# 2. Ujian Integrasi Pangkalan Data Sebenar Supabase
npx vitest run tests/real-supabase-priority-integration.test.ts
# Hasil: 30/30 tests passed (termasuk pautan gagal tidak menghasilkan status berjaya)

# 3. Ujian Automasi Browser Sebenar (Google Chrome) & Restart Durability
npx tsx tests/real-process-restart-durability.ts
# Hasil: PASS (Status Automasi Browser: PASS, PID: 18756 -> 36272, BM/EN disahkan)

# 4. Semakan Statik (Linting & Typecheck)
npx tsc --noEmit
# Hasil: 0 errors
npm run lint
# Hasil: 0 errors, 0 warnings
```

---

## 5. Kesediaan Untuk Ujian Pengguna AI Sebenar

### Status: BERSEDIA UNTUK UJIAN PENGGUNA (READY FOR REAL-AI USER PILOT)
Dengan semua mekanisme keselamatan, kekukuhan ralat inbox, kawalan pautan, dan ketahanan restart disahkan:
- **Asas Keselamatan & Pangkalan Data:** Kebenaran terus (direct write) disekat, RPC menguatkuasakan autoriti peranan pengurus dan semakan lapuk atomik, serta mutasi pautan disekat.
- **Integriti Peti Masuk (Inbox):** Tiada lagi ralat tersembunyi atau status kosong palsu apabila kueri pangkalan data atau pautan gagal.
- **Penyelarasan Bahasa:** Antaramuka menyokong BM dan English secara berasingan tanpa teks bercampur.
- **Perbezaan Kelulusan Mock vs Live AI:**
  - Ujian automasi ini lulus menggunakan **Upstream Mock AI** (mengikut skema tepat Gemini `gemini-flash-latest`) bagi menjamin sifar perbelanjaan API tanpa risiko kuota luaran.
  - Kod pengeluaran (`src/lib/priority/extractor.ts` dan `src/app/actions/priority.ts`) bersedia sepenuhnya untuk diuji oleh pengguna akhir dengan kunci API Gemini sebenar (`GEMINI_API_KEY`) tanpa memerlukan sebarang perubahan kod lanjut.
