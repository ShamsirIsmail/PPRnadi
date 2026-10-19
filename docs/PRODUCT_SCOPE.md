# PPR NADI — Product Scope & Innovation Strategy

## 1. Product Identity
**PPR NADI** is a real-time, resident-centred community infrastructure intelligence platform designed for Malaysian *Program Perumahan Rakyat* (PPR).

It is an original hackathon product focused on public housing infrastructure, resident reports, facility maintenance, and the continuity of essential services. It is **NOT** associated with the Malaysian NADI digital community centres, does not collect MyKad data, and does not operate community classes or visitor check-ins.

## 2. Three Core Innovations

### 2.1 Connected Problem Intelligence
In high-density public housing, an issue on floor 14 is rarely an isolated plumbing problem. When multiple residents report dry taps or low pressure across upper levels, the system identifies that these units share a common booster pump (e.g. `PUMP-B-BOOST` on the rooftop).
- Groups related resident reports under one root incident.
- Maps facility dependencies across service zones.
- Suggests likely mechanical root causes.
- Strictly requires human management verification before confirming technical conclusions.

### 2.2 Resource Optimisation
Helps management compare maintenance actions (e.g. valve replacement vs. complete pump motor rebuild) based on transparent criteria:
- Cost, technician availability, vendor SLA, and component lead time.
- Escalates safety-critical issues (e.g., lift failure with trapped occupants or fire corridor blackouts) separately.
- Keeps human operators accountable for financial and vendor commitments.

### 2.3 Resident Continuity
Minimizes community friction and rumors during essential service outages through verified, transparent communication:
- Real-time updates pushed to resident mobile screens without page reloads.
- Authorised temporary relief schedules (e.g., SYABAS / Air Selangor water tankers, shuttle lift priority for elderly/OKU).
- Verified service restoration requiring explicit physical dual-check before an incident is marked restored.

## 3. Primary Demo Story (PPR Sentosa)
- **Estate:** PPR Sentosa (SYNTHETIC DEMO)
- **Buildings:** Blok A (15 floors), Blok B (15 floors), Blok C (12 floors)
- **Scenario:**
  1. Resident in Blok B, Tingkat 14 reports water outage with photograph.
  2. Resident in Blok B, Tingkat 11 reports low water pressure.
  3. Management Triage Inbox detects that both reports belong to `B-ZONE-HIGH` (Floors 8–15) served by `PUMP-B-BOOST`.
  4. Management links both reports to `INC-2026-0042` and dispatches contractor MegaMech.
  5. Management publishes verified update: "Gangguan Bekalan Air Zon Tinggi Blok B — Pembaikan Pam Sedang Berjalan".
  6. Affected residents see the update instantly on their screens via Supabase Realtime.
  7. Management posts temporary support schedule: Water tanker arriving at 5:00 PM at Blok B car park.
  8. Contractor finishes repairs; Management verifies water pressure at 3.2 bar and marks incident restored.
  9. Residents receive final confirmation of service restoration.

## 4. Explicit Out-of-Scope Items for MVP
- No MyKad / IC collection or verification.
- No community centre, tuition, or ICT course management.
- No facility / PC station bookings.
- No visitor check-in or kiosk attendance systems.
- No IoT hardware sensor dependencies.
- No automated unvetted public publishing.
- No payment gateway or maintenance fee billing.
