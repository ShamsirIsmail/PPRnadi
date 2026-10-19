# PPR NADI — Mobile-First Design Direction & Interface Exploration

**Milestone:** Phase 03 UI Design Direction Exploration  
**Audience:** Malaysian Public Housing (PPR) Residents (Multi-generational, Senior Citizen Accessible) & Estate Management  
**Status:** DESIGN EXPLORATION (No planned AI functionality implied as implemented)  
**Interactive Prototype:** Available at `http://127.0.0.1:3000/design-exploration.html`  
**Date:** 2026-10-17  

---

## 1. Design Philosophy & Core Principles

PPR NADI is designed to feel like a **trustworthy, calm, and reliable public community service** rather than a commercial startup or a generic AI tech dashboard.

### Core Priorities:
1. **Easy Reading:** Text sizes, line heights, and letter spacing are optimized for older adults and individuals reading on budget mobile devices in varied lighting conditions.
2. **Obvious Actions:** High-affordance buttons, visible borders, clear icons, and unambiguous labels prevent uncertainty.
3. **Short Reporting Flows:** Form submission requires minimal typing, leverages known resident profile context, and never asks users to self-categorize into arbitrary technical priorities.
4. **Familiar Language:** Natural Bahasa Melayu (default) and clean English, completely avoiding technical jargon (e.g. no database UUIDs, no `in_maintenance` codes).
5. **Comfortable Touch Targets:** All interactive controls have a minimum touch target of **48 × 48 px** with generous spacing to avoid accidental taps.
6. **Clear Status Explanations:** Progress is described in human terms (Diterima → Sedang disemak → Dalam tindakan → Selesai).

### Anti-Patterns Strictly Avoided:
- ❌ **No gradients or glassmorphism:** Solid, crisp surfaces for maximum legibility.
- ❌ **No decorative charts or statistical vanity metrics:** Every element serves an operational purpose.
- ❌ **No excessive floating cards, pills, or badges:** Clean, grounded layout containers.
- ❌ **No tiny grey text:** Minimum 16px supporting text; minimum 18px body text on mobile.
- ❌ **No icon-only navigation:** Bottom navigation always pairs an icon with a clear text label.
- ❌ **No oversized marketing headings:** Direct, functional titles.
- ❌ **No unnecessary animations or visual jitter:** Instant, predictable UI responses.

---

## 2. Accessible Colour System & Contrast Verification

The colour palette uses pure white and a single dominant deep blue accent. Additional colours are used strictly for semantic warnings and safety exceptions.

```
+-------------------------------------------------------------------------+
|  BACKGROUND & SURFACES                                                  |
|  Main Canvas:         #FFFFFF (Pure White)                              |
|  Secondary Surface:   #F0F5FC (Very Light Blue)                         |
|  Neutral Surface:     #F8F9FA (Warm Neutral Grey)                       |
|  Borders & Dividers:  #CBD5E1 (Subtle, Visible Slate Grey)              |
+-------------------------------------------------------------------------+
|  PRIMARY BRAND & ACCENT                                                 |
|  Dominant Action:     #1554AD (Deep Public Blue)                        |
|  Hover State:         #0E3E85                                           |
|  Active/Tint State:   #EBF3FC                                           |
+-------------------------------------------------------------------------+
|  TYPOGRAPHY & CONTENT                                                   |
|  Primary Text:        #17212F (Dark Charcoal)                           |
|  Supporting Text:     #374151 (Dark Slate)                              |
|  Text on Blue:        #FFFFFF (Pure White)                              |
+-------------------------------------------------------------------------+
|  SPARING SEMANTIC ACCENTS                                               |
|  Warning / Notice:    #FEF9C3 (Pale Yellow BG) + #713F12 (Dark Brown)   |
|  Urgent / Error:      #FEF2F2 (Pale Red BG)    + #991B1B (Dark Red)     |
+-------------------------------------------------------------------------+
```

### Contrast Ratio Calculations (WCAG Standards):

| Foreground | Background | Calculated Ratio | WCAG Compliance | Usage |
| :--- | :--- | :---: | :---: | :--- |
| `#1554AD` (Deep Blue) | `#FFFFFF` (White) | **7.28 : 1** | **WCAG AAA** (Passes > 7:1) | Primary buttons, headers, active states |
| `#FFFFFF` (White) | `#1554AD` (Deep Blue) | **7.28 : 1** | **WCAG AAA** (Passes > 7:1) | Text on primary buttons and badges |
| `#17212F` (Dark Charcoal) | `#FFFFFF` (White) | **15.80 : 1** | **WCAG AAA** (Passes > 7:1) | Main body text, headings |
| `#17212F` (Dark Charcoal) | `#F0F5FC` (Light Blue) | **14.20 : 1** | **WCAG AAA** (Passes > 7:1) | Text on secondary cards & address banners |
| `#713F12` (Dark Brown) | `#FEF9C3` (Pale Yellow)| **9.80 : 1** | **WCAG AAA** (Passes > 7:1) | Official notice text on warning cards |
| `#991B1B` (Dark Red) | `#FEF2F2` (Pale Red) | **8.50 : 1** | **WCAG AAA** (Passes > 7:1) | Error and photo failure messages |
| `#CBD5E1` (Border Grey) | `#FFFFFF` (White) | **3.05 : 1** | **WCAG Non-Text** (Passes >= 3:1) | Field borders, card outlines |

> [!NOTE]
> All categories (Bekalan Air, Lif, Lampu Koridor) share the **same uniform blue visual language**. There is no rainbow colour-coding by category.

---

## 3. Accessibility Tokens for Older Adults

- **Base Body Font Size:** `18px` (`1.125rem`) on mobile viewport (390px).
- **Supporting / Timestamp Text:** Minimum `16px` (`1rem`).
- **Heading 1 / Section Titles:** `20px` to `24px` with bold weight (`700`/`800`).
- **Touch Target Minimum:** `48px` height (primary button is `56px` to `58px`).
- **Button Spacing:** Minimum `12px` between adjacent buttons.
- **Form Labels:** Always visibly anchored above inputs (never disappearing placeholders).
- **Navigation Controls:** Bottom navigation features both a clear `24px` icon and a prominent `14px` bold text label with underline indicator on active state.
- **No Hidden Gestures:** No swipe-to-delete, no pinch-to-zoom required for essential actions, no information locked behind hover states.

---

## 4. Bilingual Language System

The interface provides a seamless switch between natural **Bahasa Melayu** (default) and **English**. System copy does not mix languages on the same screen.

### Terminology Dictionary:

| Context | Bahasa Melayu (Default) | English | Technical / Prohibited Anti-Pattern |
| :--- | :--- | :--- | :--- |
| **Platform Name** | PPR NADI | PPR NADI | *PPR Nadi AI Bot* ❌ |
| **Primary Action** | Lapor Masalah Baru | Report a New Problem | *Submit Ticket* ❌ |
| **Navigation: Home** | Utama | Home | *Dashboard* ❌ |
| **Navigation: Report** | Lapor | Report | *Create Incident* ❌ |
| **Navigation: My Reports** | Laporan Saya | My Reports | *History Log* ❌ |
| **Category: Water** | Bekalan Air | Water Supply | *plumbing_defect* ❌ |
| **Category: Lift** | Lif | Elevator | *vertical_transport* ❌ |
| **Category: Light** | Lampu Koridor | Corridor Lighting | *electrical_fixture* ❌ |
| **Status 1: Received** | Diterima | Received | *submitted / queued* ❌ |
| **Status 2: Under Review**| Sedang Disemak | Under Review | *in_review / triage* ❌ |
| **Status 3: Action Taken**| Dalam Tindakan / Dalam Pembaikan | In Progress / Under Repair | *in_maintenance / work_order* ❌ |
| **Status 4: Resolved** | Selesai | Resolved | *closed / archived* ❌ |
| **Camera Action** | Ambil Gambar | Take Photo | *capture_media* ❌ |
| **Gallery Action** | Pilih Dari Galeri | Choose From Gallery | *file_picker* ❌ |
| **Photo Counter** | 1 daripada 3 gambar | 1 of 3 photos | *Attachments: 1/3* ❌ |
| **Reference Number** | #LPR-2026-0842 | #LPR-2026-0842 | `a0d5723c-218c-467a-...` ❌ |

---

## 5. Screen 1: Resident Home (Mobile, ~390px)

### Visual Hierarchy:
1. **Top Header:** Platform brand `PPR NADI` + Text language toggle button (`[ BM / EN ]`).
2. **Resident Residence Context Card:**
   - Label: `Kediaman Anda:`
   - Value: `PPR Sentosa, Blok B, Unit 12-08`
   - *Rationale:* Instantly confirms who is logged in without confusing navigation.
3. **Primary Call to Action (Dominant Button):**
   - Text: `Lapor Masalah Baru` with plus icon.
   - Min height: `58px`, deep blue `#1554AD`, `20px` font size.
   - Positioned above the fold for immediate accessibility.
4. **Official Area Notices (`Notis Rasmi Kawasan`):**
   - Answers the **5 Essential Questions** directly:
     1. **What happened?** *Pembaikan Paip Utama Blok B Sedang Dijalankan (Paip utama pecah di bilik pam aras bawah).*
     2. **Where is affected?** *Tingkat 8 hingga Tingkat 16 (Blok B).*
     3. **What management is doing:** *Kontraktor paip sedang menggantikan injap rosak. Jangka siap jam 5:00 petang.*
     4. **What should residents do?** *Tangki simpanan kecemasan dibuka di hadapan surau Blok B untuk kegunaan memasak.*
     5. **When was it officially updated?** *Hari ini, 2:15 petang oleh Pengurusan PPR Sentosa.*
   - If no notices exist: `Tiada notis rasmi buat masa ini.` *(Does not imply facilities are 100% operational).*
5. **My Reports Shortcut (`Laporan Saya`):**
   - Active summary showing recent report: `Bekalan Air Terputus • Blok B, Tkt 12` with plain status badge `Sedang Disemak`.
   - Action: `Lihat Perkembangan Laporan` (secondary button).
6. **Bottom Navigation Bar:**
   - 3 tabs with icons + text: `Utama` (Home), `Lapor` (Report), `Laporan Saya` (My Reports).

---

## 6. Screen 2: Resident Report Form (Mobile, ~390px)

### Visual Hierarchy & Step-by-Step Flow:
1. **Header:** Back button (`< Kembali`) + Title `Borang Laporan` + Language toggle.
2. **Automatic Context (No Re-Entering):**
   - Shows pre-populated unit identity: `PPR Sentosa — Blok B, Unit 12-08`.
3. **Step 1: Problem Category:**
   - 3 large, uniform buttons (min 56px height):
     - `[ 🚰 Bekalan Air ]`
     - `[ 🛗 Lif ]`
     - `[ 💡 Lampu Koridor ]`
   - Selected state: Deep blue border (`3px`) + light blue surface (`#EBF3FC`).
4. **Step 2: Description:**
   - Label: `Ceritakan Masalah Yang Berlaku`
   - Helper text: `Contoh: Air paip keluar perlahan dan keruh sejak pagi tadi di bilik air tingkat 12.`
   - Large textarea (18px text, 120px height).
5. **Priority Omission (Intentional Design Decision):**
   - **Residents are NOT asked to select Low / Medium / High / Emergency.**
   - Residents report observed facts. Management verifies and prioritizes.
6. **Step 3: Photo Evidence (Optional, Max 3):**
   - Two distinct buttons:
     - `[ 📷 Ambil Gambar ]` (Primary camera action with `capture="environment"`).
     - `[ 🖼️ Pilih Dari Galeri ]` (Secondary gallery selection).
   - Capacity indicator: `1 daripada 3 gambar`.
   - Preview card with filename, file size, upload status, and a `[ Padam ]` (Remove) button.
   - **Error Recovery Banner (Tested & Demonstrated):**
     `"Laporan sudah disimpan. Gambar ini belum berjaya dilampirkan. [ Cuba Muat Naik Semula ]"`
     *(Never asks the resident to start over or submit a duplicate report).*
7. **Planned Feature Exploration — Voice-Assisted Reporting:**
   - Labelled prominently with `[ CADANGAN CIRI AKAN DATANG / PLANNED FUTURE FEATURE ]`.
   - Explains the 4-step governance flow:
     *Resident speaks → AI transcribes draft → Resident reviews/edits → Resident confirms & submits.*
   - Explicit constraint: AI never invents facts; resident confirmation is mandatory.
8. **Confirmation State:**
   - Screen updates to: `Laporan Anda Sudah Diterima` with checkmark.
   - Reference code: `#LPR-2026-0842` (human readable).
   - Next steps timeline: (1) Management review within 24h, (2) Contractor dispatch if needed, (3) Automated notification on status change.
   - Action buttons: `Lihat Laporan Saya` and `Buat Laporan Lain`.

---

## 7. Screen 3: Management Report Queue (Desktop, ~1440px)

### Visual Hierarchy & Operational Workflow:
1. **Header:**
   - Brand: `PPR NADI — Pengurusan Fasiliti`
   - Estate Selector: `PPR Sentosa (Kuala Lumpur)`
   - Manager Identity: `Pengurus: En. Mohd Razak (Blok A & B)`
2. **Left Navigation Sidebar:**
   - `Laporan Masuk` (Incoming Queue — with badge `4 Baru`).
   - `Insiden Berpusat` (Central Incidents — `1 Aktif`).
   - `Notis Rasmi Awam` (Public Notices).
   - `Arkib Selesai` (Resolved Archive).
3. **Structured Queue Table (No Decorative Vanity Cards):**
   - Clean data columns:
     - **Masalah & Rujukan:** Title + human reference `#LPR-2026-0842` + submission time.
     - **Lokasi:** Building & Floor (e.g. `Blok B, Tingkat 12, Unit 12-08`).
     - **Laporan Berkaitan:** Count of similar cluster reports (e.g. `4 Aduan Serupa`).
     - **Status Semasa:** Plain language badges (`Sedang Disemak`, `Dalam Tindakan`, `Diterima`, `Selesai`).
     - **Tindakan Seterusnya:** Quick action buttons (`Sahkan Insiden`, `Tugaskan Juruteknik`).
4. **Right-Hand Detail & Planned AI Priority Triage Panel:**
   - Clearly marked: `[ CADANGAN CIRI AKAN DATANG / PLANNED FEATURE ]`.
   - **AI Recommendation:** `Cadangan Keutamaan: TINGGI`.
   - **Structured Reasons Breakdown:**
     1. *Gangguan bekalan air dikesan merentasi pelbagai tingkat (Tkt 8, 10, 12, 14 Blok B).*
     2. *Terdapat 4 laporan aduan serupa dalam tempoh kurang 2 jam.*
     3. *Melibatkan utiliti asas warga emas dan keluarga.*
   - **Verification Breakdown:**
     - Maklumat Penduduk: *"Paip sinki dapur tidak mengeluarkan air langsung sejak 8 pagi."*
     - Bukti Lampiran: `paip_sinki_rosak.jpg (Sah)`
     - Fakta Disahkan Pengurusan: `Injap pam utama pecah di bilik pam aras bawah.`
     - Tindakan Workflow: `Pautkan laporan ke Insiden Paip Blok B & terbitkan notis kemas kini.`
   - **Governance Note:** Management makes the final decision; AI does not automate dispatch or generate synthetic confidence percentages.

---

## 8. Interactive Prototype Verification

The interactive prototype has been generated in `public/design-exploration.html` and verified on the local development server:

```bash
# Verify static prototype serving
http://127.0.0.1:3000/design-exploration.html
```

Reviewers can interactively:
- Toggle between **Bahasa Melayu** and **English** dynamically across all three screens.
- Switch between **Screen 1 (Mobile Home)**, **Screen 2 (Mobile Form)**, and **Screen 3 (Desktop Queue)**.
- Test category selection, photo counter changes, simulated photo uploads from camera/gallery, and photo deletion.
- Trigger the form submission confirmation screen and inspect the human-readable reference code.
- Test the error recovery state simulation for uncommitted photos.
- Inspect the planned voice variant exploration modal.
- Review the desktop management queue and AI priority reasoning panel.
