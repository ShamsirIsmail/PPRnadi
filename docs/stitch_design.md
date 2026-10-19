---
name: Civic Stewardship
colors:
  surface: '#f8f9ff'
  surface-dim: '#d0dbed'
  surface-bright: '#f8f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#eff4ff'
  surface-container: '#e6eeff'
  surface-container-high: '#dee9fc'
  surface-container-highest: '#d9e3f6'
  on-surface: '#121c2a'
  on-surface-variant: '#414844'
  inverse-surface: '#27313f'
  inverse-on-surface: '#eaf1ff'
  outline: '#717973'
  outline-variant: '#c1c8c2'
  surface-tint: '#3f6653'
  primary: '#012d1d'
  on-primary: '#ffffff'
  primary-container: '#1b4332'
  on-primary-container: '#86af99'
  inverse-primary: '#a5d0b9'
  secondary: '#904d00'
  on-secondary: '#ffffff'
  secondary-container: '#fe932c'
  on-secondary-container: '#663500'
  tertiary: '#002c28'
  on-tertiary: '#ffffff'
  tertiary-container: '#00443f'
  on-tertiary-container: '#5fb5ab'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#c1ecd4'
  primary-fixed-dim: '#a5d0b9'
  on-primary-fixed: '#002114'
  on-primary-fixed-variant: '#274e3d'
  secondary-fixed: '#ffdcc3'
  secondary-fixed-dim: '#ffb77d'
  on-secondary-fixed: '#2f1500'
  on-secondary-fixed-variant: '#6e3900'
  tertiary-fixed: '#9cf2e8'
  tertiary-fixed-dim: '#80d5cb'
  on-tertiary-fixed: '#00201d'
  on-tertiary-fixed-variant: '#00504a'
  background: '#f8f9ff'
  on-background: '#121c2a'
  surface-variant: '#d9e3f6'
typography:
  headline-display:
    fontFamily: Plus Jakarta Sans
    fontSize: 36px
    fontWeight: '700'
    lineHeight: 44px
  headline-display-mobile:
    fontFamily: Plus Jakarta Sans
    fontSize: 28px
    fontWeight: '700'
    lineHeight: 36px
  headline-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 28px
    fontWeight: '700'
    lineHeight: 36px
  headline-lg-mobile:
    fontFamily: Plus Jakarta Sans
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 32px
  headline-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 22px
    fontWeight: '600'
    lineHeight: 30px
  headline-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 26px
  body-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 15px
    fontWeight: '400'
    lineHeight: 22px
  body-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 15px
    fontWeight: '600'
    lineHeight: 20px
  label-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 13px
    fontWeight: '600'
    lineHeight: 18px
  label-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  gutter: 1rem
  gutter-desktop: 1.5rem
  margin: 1rem
  margin-tablet: 1.5rem
  margin-desktop: 2.5rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2rem
---

## Brand & Style

This design system delivers a civic utility platform serving Malaysian public housing (Program Perumahan Rakyat - PPR) residents, community leaders, municipal maintenance contractors, and housing administrators. The visual tone balances public-sector institutional credibility with approachable community care. 

The interface is built around **Functional Civic Realism**:
- **Clarity over ornamentation**: Elimination of gratuitous glassmorphic blurs, artificial glow effects, and hyper-saturated gradients. Visual decisions prioritize high legibility across varied device tiers and daylight outdoor conditions.
- **Dignified utility**: Deep forest greens evoke civic duty, sustainability, and trust. Crisp borders replace deep diffuse shadows, establishing an honest, paper-form legibility tailored for public notices, maintenance tracking, and incident escalation.
- **Multilingual parity**: Architecture accommodates Bahasa Melayu and English interchangeably with zero layout breakage or awkward hyphenation, respecting varying phrase lengths common in institutional Malay terminology (e.g., *Aduan Kerosakan*, *Tindakan Susulan*).
- **Physical accessibility focus**: Generous touch hit targets (minimum 44×44px), high contrast text ratios exceeding WCAG 2.1 AA standards (minimum 4.5:1 for body copy and 7:1 for headers), and distinct iconic cues accompanying all status alerts to ensure full comprehension for color-blind residents.

## Colors

The palette is engineered for high-contrast legibility, daylit readability, and clear civic hierarchy.

### Core Swatches
- **Primary Canvas**: `#FFFFFF` for main surfaces, cards, and data dialogs.
- **Sub-surfaces & Canvas Tint**: `#F8F9FA` for page backdrops, subtle card headers, and table zebra-striping. `#F1F3F5` for input backgrounds, tag backgrounds, and structural divider surfaces.
- **Borders & Dividers**: Crisp, structural boundary line `#E5E7EB` (neutral-border) and `#D1D5DB` (interactive-border).

### Brand & Interactive Roles
- **Primary / Action (`#1B4332`)**: Used for root navigation bars, primary CTA buttons, active state indicators, and verified civic seals.
- **Primary Hover / Pressed (`#143224`)**: Deepened forest green for interactive states.
- **Primary Container (`#E8F3EE`)**: Soft green tint for primary selections, filter pills, and affirmative contextual headers.
- **Accent / Priority Alert (`#D97706` / `#C2410C`)**: Controlled, non-fluorescent warm amber and burnt orange for notices requiring attention, pending resident confirmations, and priority escalations.

### Functional Status Indicators
Status colors must never appear alone; they must pair with explicit text labels and shape-coded icons:
- **Success / Resolved**: `#15803D` (text/icon), `#DCFCE7` (pill background), `#86EFAC` (border). Represents resolved work orders and verified facilities.
- **Under Review / In Progress**: `#B45309` (text/icon), `#FEF3C7` (pill background), `#FCD34D` (border). Denotes reports undergoing contractor review or scheduled repairs.
- **Urgent / Safety Hazard**: `#BE123C` (text/icon), `#FFE4E6` (pill background), `#FDA4AF` (border). Reserved for high-priority incidents like elevator failures, structural electrical faults, or water line ruptures.

### Typography & Readability Neutrals
- **Primary Heading & Deep Text**: `#111827` (almost pure charcoal; never pure `#000000`).
- **Body Text**: `#1F2937` (contrast ratio exceeding 12:1 against `#FFFFFF`).
- **Secondary / Supporting Text**: `#4B5563` (contrast ratio exceeding 4.5:1).
- **Disabled / Structural Text**: `#9CA3AF`.

## Typography

The design system uses **Plus Jakarta Sans** throughout. Its open apertures, tall x-height, and neutral geometric structure ensure instant word-shape recognition on low-spec budget smartphones in bright daylight.

### Mobile Body Rule
- Standard mobile body copy enforces a strict **minimum of 15px (`body-md`)** to prevent eye strain and support varying visual acuity across senior residents.
- Microcopy is strictly capped at `12px` (`label-sm`), permitted only for secondary metadata (e.g., timestamps, receipt reference IDs).

### Multilingual Layout Principles
- **Dynamic Growth**: All navigation tags, badges, and label containers must allow a 25% horizontal width buffer to accommodate Bahasa Melayu compound phrasing without clipping (e.g., "Submit" [6 chars] vs. "Hantar Aduan" [12 chars]; "Maintenance" [11 chars] vs. "Penyelenggaraan" [15 chars]).
- **Vertical Line Heights**: Line heights sit comfortably between 1.4× and 1.5× font size to support diacritic clearance and prevent crowding in dense multi-line community logs.

## Layout & Spacing

A structured 8pt/4pt layout grid is applied to keep maintenance forms and ticket dashboards balanced, scannable, and efficient.

### Grid Framework
- **Mobile (< 640px)**: 4-column fluid layout. Canvas margin `1rem` (16px), column gutter `1rem` (16px). Full-bleed cards are allowed with subtle separator borders.
- **Tablet (640px – 1024px)**: 8-column layout. Canvas margin `1.5rem` (24px), column gutter `1.25rem` (20px).
- **Desktop (> 1024px)**: 12-column layout capped at a maximum width of `1280px` (`80rem`) centered. Canvas margin `2.5rem` (40px), column gutter `1.5rem` (24px).

### Spacing Scale Application
- `space-xs` (4px): Icon-to-text spacing within buttons, badges, and inline status markers.
- `space-sm` (8px): Distance between form labels and input fields, chip list item gaps.
- `space-md` (16px): Internal padding for compact cards, spacing between vertically stacked form fields.
- `space-lg` (24px): Internal padding for standard dashboard containers and ticket summary cards.
- `space-xl` (32px): Vertical distance between distinct functional sections (e.g., Incident Photo Gallery to Assignee Details).

## Elevation & Depth

Visual hierarchy relies on **crisp structural borders and tactile tonal separation**, completely omitting heavy drop shadows, neon spreads, and blurred translucent surfaces.

### Depth Rules
- **Flat Surface Tier (Base)**: `#F8F9FA` acts as the platform backdrop canvas.
- **Card and Modal Tier (Raised)**: `#FFFFFF` is used for content containers, surrounded by a crisp `1px solid #E5E7EB` perimeter. To provide physical grounding without visual noise, raised elements utilize a single, restrained ambient border-drop:
  `box-shadow: 0 1px 3px 0 rgba(17, 24, 39, 0.05), 0 1px 2px 0 rgba(17, 24, 39, 0.03);`
- **Floating Controls Tier (Menus, Alerts & Sticky Bottom Bars)**: Elevates cleanly using:
  `box-shadow: 0 4px 6px -1px rgba(17, 24, 39, 0.07), 0 2px 4px -2px rgba(17, 24, 39, 0.05);`
  accompanied by a top or border rule of `1px solid #D1D5DB`.
- **Zero Glassmorphism**: Overlays utilize high-contrast, solid backdrop masking (`rgba(17, 24, 39, 0.6)`) with no backdrop filter blur, preserving rendering performance across entry-level Android devices and eliminating visual clutter.

## Shapes

The design system employs **Soft (`1`)** roundedness. Radii are modest and utilitarian, reinforcing a calm, civic-minded reliability.

### Corner Radius Standards
- **Buttons, Form Inputs, & Select Dropdowns**: `0.375rem` (6px). Compact, clean, and distinctively architectural.
- **Cards, Panels, & Dialog Bins**: `0.5rem` (8px, `rounded-lg`). Prevents sharp edges on mobile devices while maintaining maximum horizontal space efficiency for maintenance documentation.
- **Chips, Pills, & Badges**: `9999px` (fully rounded pill). Soft circular contours immediately differentiate status identifiers from actionable form fields and card containers.

## Components

### Buttons
- **Touch Target**: Minimum height `44px` on mobile (`48px` recommended for primary action submissions).
- **Primary Button**: Solid background `#1B4332`, text `#FFFFFF`, font `label-lg`. Hover/active state `#143224`. Focused state uses a 2px offset ring in `#1B4332`.
- **Secondary Button**: Background `#FFFFFF`, text `#1B4332`, border `1.5px solid #1B4332`. Hover state shifts surface to `#E8F3EE`.
- **Tertiary / Utility Button**: Background transparent, text `#4B5563`, hover `#F1F3F5`.
- **Destructive / Urgent Escalation Button**: Background `#BE123C`, text `#FFFFFF`, hover `#9F1239`.

### Form Fields & Inputs
- **Base Structure**: Height `44px`, background `#FFFFFF`, border `1px solid #D1D5DB`, border-radius `6px`, padding `0 12px`.
- **Typography**: Text `#111827` at `15px` (`body-md`), placeholder text `#9CA3AF`.
- **Focus State**: Border `#1B4332` with a `0 0 0 3px rgba(27, 67, 50, 0.15)` ring.
- **Labels**: Rendered above inputs in `label-md` (`#1F2937`), with mandatory field stars highlighted in `#BE123C`.
- **Help Text**: Placed underneath input in `13px` (`#4B5563`), immediately transitioning to `#BE123C` upon validation error.

### Status Badges & Chips
- **Geometry**: Height `26px` to `28px`, border-radius `9999px`, horizontal padding `10px`. Includes an explicit 6px indicator dot or mini-icon alongside text.
- **Resolved (Selesai)**: Background `#DCFCE7`, text `#15803D`, border `1px solid #86EFAC`.
- **In Progress (Dalam Tindakan)**: Background `#FEF3C7`, text `#B45309`, border `1px solid #FCD34D`.
- **Emergency / Blocked (Kecemasan / Bahaya)**: Background `#FFE4E6`, text `#BE123C`, border `1px solid #FDA4AF`.

### Checkboxes & Radio Controls
- **Hit Area**: Component housing spans an envelope of at least `44×44px` padding to prevent input errors on touchscreens.
- **Visual Node**: `20×20px` square (`rounded: 4px`) for checkboxes; `20×20px` circular for radios.
- **Checked State**: Background `#1B4332`, white checkmark or center pip. Border `#1B4332`.

### Incident & Notice Cards
- **Card Canvas**: `#FFFFFF`, border `1px solid #E5E7EB`, internal padding `16px` (mobile) to `24px` (desktop).
- **Structure**: Clear semantic flow:
  1. Header: Location context (e.g., *Blok C, Tingkat 4, Lif No. 2*) paired with the Status Badge.
  2. Body: Incident report summary in `body-md` (`#1F2937`).
  3. Footer: Report ID metadata (`#4B5563`), bilingual time-elapsed indicator (e.g., *2 jam yang lalu / 2 hours ago*), and assigned maintenance contractor badge.

### Dual-Language Utility Toggle
- Compact segment control pinned to the header/navigation utility slot.
- Toggle between **BM** and **EN** with an active pill background `#FFFFFF`, high-contrast text `#1B4332`, and container track in `#F1F3F5`.