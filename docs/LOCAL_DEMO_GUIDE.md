# PPR NADI — Local Interactive Demo & Verification Guide

**Document Version:** 1.0.0  
**Target Environment:** Local Synthetic Demo (`ppr-nadi` / `supabase_db_ppr-nadi`)  
**Workspace:** `C:\Dev\ppr-nadi`  
**Application URL:** `http://127.0.0.1:3000`

---

## 1. Environment & Architecture Overview

PPR NADI is configured for local evaluation using a dedicated Dockerized Supabase stack:
- **Supabase API (Kong Gateway):** `http://127.0.0.1:64321`
- **PostgreSQL Database:** `127.0.0.1:64322` (`postgres` user, database `postgres`)
- **Docker Container:** `supabase_db_ppr-nadi`
- **Next.js Web Application:** `http://127.0.0.1:3000`

> [!NOTE]
> This environment is a **local synthetic demonstration instance** containing synthetic Malaysian PPR estate fixtures (PPR Sentosa and PPR Lestari). All data is synthetic for testing and presentation purposes.

---

## 2. Starting the Application & Checking Availability

### Step 1: Check Supabase Availability
Ensure that the local Supabase container and database are healthy:

```powershell
# Check container status
docker ps --filter "name=supabase_db_ppr-nadi"

# Verify PostgreSQL connectivity
"C:\Program Files\PostgreSQL\18\bin\psql.exe" "postgresql://postgres:postgres@127.0.0.1:64322/postgres" -c "SELECT current_database(), version();"

# Verify Supabase Auth API health
Invoke-RestMethod -Uri "http://127.0.0.1:64321/auth/v1/health" -Method Get
```

### Step 2: Start the Next.js Dev Server
If the Next.js development server is not already active:

```powershell
npm run dev
```

Navigate to `http://127.0.0.1:3000` in Google Chrome or any modern browser.

---

## 3. Obtaining Demo Credentials

Permanent demo accounts are provisioned via `scripts/provision-demo-users.mjs` and preserve their IDs and assignments across test runs.

### Credential Source
Demo credentials are kept securely in the local, git-ignored configuration file:
- **Location:** `C:\Dev\ppr-nadi\.env.local`
- **Keys:**
  - `DEMO_RESIDENT_PASSWORD` (Password for `resident@sentosa.local`)
  - `DEMO_MANAGER_PASSWORD` (Password for `manager@sentosa.local`)
  - `DEMO_OTHER_RESIDENT_PASSWORD` (Password for `resident.other@lestari.local`)
  - `DEMO_UNASSIGNED_PASSWORD` (Password for `unassigned@sentosa.local`)

> [!SECURITY]
> In accordance with repository security policies:
> - Passwords, service-role keys, and JWT session tokens are **never printed, logged, or hardcoded** in browser client bundles.
> - The `/login` page provides convenience buttons that populate the demo **email addresses** only. Passwords must be sourced from your local `.env.local`.

---

## 4. Demo Account Profiles & Assignments

| Email | Role | Assigned Estate | Building / Unit | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| `resident@sentosa.local` | `resident` | PPR Sentosa Demo (`ppr-sentosa-demo`) | Blok A, Unit 05-01 | Primary resident reporter |
| `manager@sentosa.local` | `management` | PPR Sentosa Demo (`ppr-sentosa-demo`) | Estate-wide authority | Management inbox, triage, notices |
| `resident.other@lestari.local`| `resident` | PPR Lestari Demo (`ppr-lestari-demo`) | Blok C, Unit 02-14 | Cross-estate isolation testing |
| `unassigned@sentosa.local` | `resident` | *None* | *None* | Unassigned / unverified resident testing |

---

## 5. End-to-End Walkthrough: Report → Review → Incident → Notice

### Walkthrough Sequence

```mermaid
sequenceDiagram
    autonumber
    actor Resident as Resident (resident@sentosa.local)
    participant UI as Next.js Web App
    participant DB as PostgreSQL + Storage
    actor Manager as Management (manager@sentosa.local)

    Resident->>UI: Log in at /login
    Resident->>UI: Submit report with photos at /resident/lapor
    UI->>DB: Store report ('submitted') + upload evidence
    Resident->>UI: View submitted report at /resident/sejarah
    
    Manager->>UI: Log in at /login
    Manager->>UI: Open /management/inbox & click "Sahkan Semakan"
    UI->>DB: Update report status to 'reviewed'
    
    Manager->>UI: Open /management/incidents & click "Cipta Insiden Baharu"
    UI->>DB: Create incident record
    Manager->>UI: Click "Sahkan Insiden (Confirm)"
    UI->>DB: Update incident status to 'confirmed'
    
    Manager->>UI: Return to /management/inbox & link report
    UI->>DB: Insert incident_report_links ('linked')
    
    Manager->>UI: Click "Terbitkan Notis Rasmi" on incident
    UI->>DB: Insert published_incident_bulletins
    
    Resident->>UI: View /resident dashboard
    UI-->>Resident: Render official sanitized bulletin notice
```

### Step-by-Step Instructions

1. **Resident Login & Report Submission**:
   - Go to `http://127.0.0.1:3000/login`.
   - Click the **"Log Masuk Penduduk"** convenience button to populate `resident@sentosa.local`.
   - Paste the password from `DEMO_RESIDENT_PASSWORD` in `.env.local` and submit.
   - Click **"Hantar Laporan"** (`/resident/lapor`).
   - Select a category (e.g., *Lif Penumpang*), choose urgency, attach up to 3 photo files, provide a description, and submit.
   - The UI displays **"Laporan Telah Disimpan"** with active report ID and attachment count.
   - Navigate to **"Sejarah"** (`/resident/sejarah`) to verify your report is listed.

2. **Management Review & Incident Creation**:
   - Log out via the header button or navigate to `/login`.
   - Click the **"Log Masuk Pengurusan"** convenience button (`manager@sentosa.local`).
   - Enter `DEMO_MANAGER_PASSWORD` from `.env.local` and submit.
   - Navigate to **"Peti Masuk Semakan Laporan Penduduk"** (`/management/inbox`).
   - Locate the submitted report. Inspect the details and attached photo evidence.
   - Click **"Sahkan Semakan"** to move the report to `reviewed`.
   - Navigate to **"Pusat Kawalan Insiden"** (`/management/incidents`).
   - Click **"Cipta Insiden Baharu"**, select the building (*Blok A*), set category, title, and internal notes. Submit.
   - On the created incident card, click **"Sahkan Insiden (Confirm)"**.

3. **Report Linking & Official Bulletin Publication**:
   - Return to `/management/inbox`.
   - On the reviewed report card, select the newly confirmed incident from the dropdown and click **"Pautkan"** (status changes to `linked`).
   - In `/management/incidents`, click **"Terbitkan Notis Rasmi"** on the incident card.
   - Enter the public notice title and message (in Bahasa Malaysia). Click **"Terbitkan Sekarang"**.

4. **Resident Notice Visibility**:
   - Log out of management and log back in as `resident@sentosa.local`.
   - On the Resident Dashboard (`/resident`), the official published bulletin is displayed under **"Status Fasiliti & Notis Rasmi"**.
   - Notice that internal management notes and management user IDs are strictly sanitized and never visible to the resident.

---

## 6. Historical Data Status & Recovery Disclosure

Independent database inspection identified that previous automated test runs purged accounts using overly broad patterns (`email LIKE '%@sentosa.local'`).

- **Account Restoration**:
  The permanent demo accounts (`resident@sentosa.local`, `manager@sentosa.local`, etc.) have been restored with their verified UUIDs and profile assignments using `scripts/provision-demo-users.mjs`.
- **Historical Report Loss**:
  Any individual test incident reports or attachments deleted by previous test cleanups **were not recovered** merely by recreating the accounts. Recreating auth accounts restores authentication and profile linkages, but deleted domain rows remain absent unless restored from a pre-existing PostgreSQL database backup.
- **Available Recovery Options**:
  1. *Fresh Synthetic Seed*: Run `node scripts/provision-demo-users.mjs` to ensure baseline demo users and profiles are initialized.
  2. *Re-seeding Baseline Demo Reports*: If demo reports are needed for a presentation, submit them following Section 5 above or apply a dedicated presentation fixture script.
  3. *Unrelated Data Safety*: No unrelated tables or existing fixtures were touched or wiped.
