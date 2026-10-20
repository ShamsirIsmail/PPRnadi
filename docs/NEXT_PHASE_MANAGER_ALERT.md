# PPR NADI — Spesifikasi Animasi & Kiraan Alert Pengurus (Fasa Seterusnya)

> **Status:** DIDOKUMENTASIKAN DALAM BACKLOG (BELUM DIBINA / TIADA FAKE NOTIFICATION)  
> **Sasaran:** Fasa Peningkatan Pengurusan & Operasi Tapak

---

## 1. Objektif
Apabila aduan kerosakan baharu dihantar oleh penduduk dalam kawasan kendalian pengurus yang sah (contohnya PPR Desa Rejang), portal pengurusan (`/management/inbox`) perlu memaparkan makluman animasi visual dan kiraan belum dibaca (*unread badge*) yang tepat tanpa memerlukan muat semula halaman secara manual.

---

## 2. Prinsip & Spesifikasi Masa Hadapan

1. **Dicetuskan Oleh Data Baharu Sebenar:**
   - Sambungan Supabase Realtime Postgres Changes (`INSERT` pada jadual `incident_reports`) yang ditapis mengikut peranan pengurus dan kawasan PPR yang ditetapkan (`estate_id`).
   - Tidak membina simulasi atau notifikasi palsu (*no mock notifications*).

2. **Tiada Animasi/Bunyi Berulang Bagi Rekod Lama:**
   - Apabila halaman dimuat semula (*refresh*), rekod sedia ada yang telah dipaparkan tidak boleh mencetuskan animasi atau bunyi.
   - Penjejakan masa capaian terakhir (*last acknowledged timestamp*) disimpan dalam pangkalan data atau storan sesi pengurus.

3. **Kiraan Belum Dibaca (*Unread Counter*):**
   - Kiraan lencana dinamik menunjukkan bilangan laporan baharu yang belum dibuka (*awaiting review*).
   - Tindakan klik pada kad laporan menolak laporan tersebut daripada kiraan belum dibaca.

4. **Deduplikasi Sambungan Semula (*Reconnect Deduplication*):**
   - Mengendalikan penutupan atau sambungan semula rangkaian (WebSocket reconnect) dengan menyemak `client_report_id` atau rentetan `id` agar satu aduan baharu tidak dikira atau dimaklumkan dua kali.

5. **Audio Pilihan & Beretika (*Non-Intrusive Audio*):**
   - Bunyi amaran pendek bersifat pilihan (*opt-in toggle*) dengan kebenaran interaksi pengguna terdahulu (mematuhi polisi Autoplay pelayar moden).
   - Pengurus boleh membisukan (*mute*) bunyi amaran pada bila-bila masa.

6. **Aksesibiliti & Reduced Motion:**
   - Menyokong media query `prefers-reduced-motion` untuk menggantikan animasi pergerakan dengan penunjuk statik warna lembut.
   - Menyediakan `aria-live="polite"` dan `role="status"` untuk pembaca skrin (*screen reader accessible announcements*).

7. **Integriti Keselamatan & RLS:**
   - Semua siaran masa nyata dan data laporan kekal dikawal sepenuhnya oleh Row Level Security (RLS) Supabase; pengurus tidak menerima maklumat atau data aduan daripada kawasan PPR lain.
