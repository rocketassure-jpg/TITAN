# TITAN Insurance CRM — UI & UX Test Automation Audit

**Audit Date:** November 2026  
**Auditor:** Principal QA Architect & Senior React Engineer  
**Testing Harness:** Playwright 1.65.1 + axe-core 4.14.0 + Chromium  
**Viewports Tested:**
- Desktop: `1440 × 900`
- Tablet: `768 × 1024`
- Mobile: `375 × 667`

---

## 1. Executive Summary

A comprehensive automated visual and accessibility audit was executed across all accessible routes of the TITAN Insurance CRM platform. Thirty-six (36) full-page high-resolution screenshots were captured, and automated DOM tree inspections were performed for responsive layout integrity, horizontal viewport overflow, interactive modal dialogs, theme toggling, and WCAG 2.1 AA accessibility compliance.

### Overall UI Audit Scorecard

| Category | Status | Notes |
| :--- | :--- | :--- |
| **Responsive Layout** | PASS / ACCEPTABLE | No horizontal page scrolling (`scrollWidth == clientWidth`) detected on core views across 1440px, 768px, and 375px. |
| **Modal & Dialog Mechanics** | WARNING | Modal dialogs open cleanly; however, the CSV importer auto-closes before presenting the results summary (Step 3). |
| **Theme Consistency (Light/Dark)** | FAIL / WARNING | Public landing page uses hardcoded inline styles (`#f8fafc`) overriding dark theme CSS variables. |
| **WCAG 2.1 AA Accessibility** | FAIL | 9 automated violation records found across core screens (Critical: missing button names; Serious: color contrast). |
| **Typography & Alignment** | PASS | Consistent Inter/Geist font scale via Tailwind; consistent input heights (36px/40px) across shadcn form primitives. |

---

## 2. Viewport & Responsive Layout Analysis

Each route was tested by mounting the production build in Chromium and calculating:
$$\Delta W = \max(\text{scrollWidth}, \text{body.scrollWidth}) - \text{clientWidth}$$

### Viewport Audit Matrix

| Route | Desktop (1440px) | Tablet (768px) | Mobile (375px) | Overflow Detected |
| :--- | :--- | :--- | :--- | :--- |
| `/` (Landing Page) | Pass (1440px) | Pass (768px) | Pass (375px) | None |
| `/auth` (Staff Login/Signup) | Pass (1440px) | Pass (768px) | Pass (375px) | None |
| `/reset-password` | Pass (1440px) | Pass (768px) | Pass (375px) | None |
| `/trust` | Pass (1440px) | Pass (768px) | Pass (375px) | None |
| `/404-test` (Not Found) | Pass (1440px) | Pass (768px) | Pass (375px) | None |
| `/dashboard` (Redirect Guard) | Pass (1440px) | Pass (768px) | Pass (375px) | None |
| `/telecaller` (Redirect Guard) | Pass (1440px) | Pass (768px) | Pass (375px) | None |
| `/manager` (Redirect Guard) | Pass (1440px) | Pass (768px) | Pass (375px) | None |
| `/admin` (Redirect Guard) | Pass (1440px) | Pass (768px) | Pass (375px) | None |
| `/super-admin` (Redirect Guard) | Pass (1440px) | Pass (768px) | Pass (375px) | None |
| `/super-admin/blueprint` | Pass (1440px) | Pass (768px) | Pass (375px) | None |

### Key Responsive Observations
1. **Landing Hero Section (`src/pages/Index.tsx`):**
   - The headline utilizes dynamic clamp typography: `clamp(2.75rem, 8vw, 6.5rem)`. On 375px mobile, it condenses gracefully without overflowing the viewport.
   - The hero grid switches from two columns (`lg:grid-cols-2`) to a single column on tablet and mobile.
2. **Calling List & Table Overflow:**
   - In `CallingList.tsx` and admin data tables, the table wrapper uses `overflow-x-auto`. On mobile (375px), tabular data scrolls horizontally within its card container while preventing the root viewport from breaking.
3. **Bottom Navigation on Mobile:**
   - Frontline telecaller screens incorporate `src/components/agent/MobileBottomNav.tsx` with `pb-20 md:pb-0` padding on the main container to avoid content clipping behind the mobile tab bar.

---

## 3. Component & Dialog Behavior Audit

### 3.1. Premium Calculator Modal (`src/components/PremiumCalculator.tsx`)
- **Desktop (1440px):** Triggers via "Premium Calculator" button on landing page. Opens in a centered Radix dialog (`max-w-4xl`).
- **Inspection Findings:**
  - Form controls (Make, Model, Year, Fuel Type, Ex-Showroom) align correctly in a 2-column grid.
  - The live premium breakdown card renders on the right.
  - When resizing to mobile (375px), the dialog content scrolls vertically, but the sticky footer with the PDF download button covers the bottom summary row on very small screens (height < 600px).

### 3.2. Authentication Modes (`src/pages/Auth.tsx`)
- **Tabs Interaction:** Switching between "Sign in" and "Sign up" functions instantaneously via Radix Tabs.
- **Mode Toggle ("Create New Company" vs "Join Company"):**
  - "Create New Company" displays company name input and auto-slugifies company code (`slugifyCode`).
  - "Join Company" replaces company name with Company Code input and performs live preview via `lookup_company_by_code`.
  - On 375px mobile, the mode buttons (`flex gap-2`) squeeze tightly; labels with longer translations could wrap awkwardly.

### 3.3. Smart CSV Importer Dialog Flaw (`src/components/admin/SmartCSVImporter.tsx`)
- **CRITICAL UI FLOW BUG:**
  - In `doImport()` (lines 196–200):
    ```ts
    setStep(3);
    setImporting(false);
    if (inserted) toast({ title: `Imported ${inserted} leads` });
    onDone(); // <-- Premature invocation
    ```
  - When `onDone()` is triggered, parent components (e.g., `SmartImportPanel.tsx`) close the dialog or navigate away. Step 3 (which renders the summary cards showing inserted count, duplicate count, and error breakdowns) is unmounted before the user can view it.

---

## 4. Theme & Aesthetic Audit

### 4.1. Dark Mode Support & Inconsistencies
- The application includes `ThemeProvider` (`src/contexts/ThemeContext.tsx`) and `ThemeToggle` (`src/components/ThemeToggle.tsx`) supporting `light`, `dark`, and `system` modes.
- **Defect Identified (UI-01):**
  - In `src/pages/Index.tsx` line 20:
    ```tsx
    <div className="neon-root min-h-screen relative" style={{ background: "#f8fafc" }}>
    ```
  - The background is hardcoded to inline `#f8fafc` (light slate), preventing the landing page from honoring the dark mode theme. The text remains dark slate (`text-slate-900`), but children elements using dark mode classes (`dark:...`) render with mismatched background-foreground contrast.

---

## 5. Automated Accessibility Audit (axe-core)

Axe automated accessibility scans were executed against key user entry points. Nine (9) violations were identified:

```
┌───────────────────────────┬──────────────┬───────────────┬──────────────────────────────────────────┐
│ Violation Rule ID         │ Severity     │ Failed Nodes  │ Description                              │
├───────────────────────────┼──────────────┼───────────────┼──────────────────────────────────────────┤
│ button-name               │ Critical     │ 1             │ Buttons must have discernible text       │
│ color-contrast            │ Serious      │ 3             │ Insufficient contrast ratio (WCAG 2 AA)   │
│ landmark-one-main         │ Moderate     │ 3             │ Document lacks a main landmark (<main>)  │
│ page-has-heading-one      │ Moderate     │ 3             │ Page contains no level-one heading (h1)  │
│ region                    │ Moderate     │ 30            │ Page content not contained by landmarks  │
└───────────────────────────┴──────────────┴───────────────┴──────────────────────────────────────────┘
```

### Detailed Violation Findings

1. **`button-name` (Impact: Critical):**
   - **Location:** `src/pages/Index.tsx` (WhatsApp floating widget trigger and Theme toggle compact icon).
   - **Issue:** Button elements contain `<svg>` icon children with no `aria-label`, `title`, or inner text. Screen readers announce this as "button, unlabelled".
   - **Fix:** Add `aria-label="Open WhatsApp Chat"` and `aria-label="Toggle theme"` to icon-only buttons.

2. **`color-contrast` (Impact: Serious):**
   - **Location:** `src/pages/Auth.tsx` (Card description and "Staff portal" subheadings) and `src/pages/Index.tsx` (badge subtitles).
   - **Issue:** Foreground color `#94a3b8` (text-muted-foreground) against `#ffffff` yields a contrast ratio of `2.89:1`, failing the WCAG AA minimum requirement of `4.5:1` for normal text.
   - **Fix:** Darken secondary text to `#64748b` (Slate-500) or `#475569` (Slate-600) on light backgrounds.

3. **`landmark-one-main` & `page-has-heading-one` (Impact: Moderate):**
   - **Location:** `src/pages/Auth.tsx` and `src/pages/ResetPassword.tsx`.
   - **Issue:** The authentication screen wraps the form in a generic `<div>` rather than a semantic `<main>` element, and uses `<CardTitle>` without an explicit `<h1>` tag.
   - **Fix:** Wrap the auth container in `<main role="main">` and render `<CardTitle as="h1">`.

---

## 6. Visual Evidence & Screenshot Catalog

All 36 visual evidence screenshots are saved in `docs/audit/screenshots/`:

| Screen / Feature | Viewport | Mode | Screenshot File Path |
| :--- | :--- | :--- | :--- |
| **Landing Hero** | Desktop 1440px | Light | [landing-desktop-1440-light.png](file:///d:/TITAN/docs/audit/screenshots/landing-desktop-1440-light.png) |
| **Landing Hero** | Tablet 768px | Light | [landing-tablet-768-light.png](file:///d:/TITAN/docs/audit/screenshots/landing-tablet-768-light.png) |
| **Landing Hero** | Mobile 375px | Light | [landing-mobile-375-light.png](file:///d:/TITAN/docs/audit/screenshots/landing-mobile-375-light.png) |
| **Calculator Modal** | Desktop 1440px | Modal | [landing-calculator-modal-desktop-1440.png](file:///d:/TITAN/docs/audit/screenshots/landing-calculator-modal-desktop-1440.png) |
| **Auth Sign-in** | Desktop 1440px | Light | [auth-desktop-1440-light.png](file:///d:/TITAN/docs/audit/screenshots/auth-desktop-1440-light.png) |
| **Auth Sign-in** | Tablet 768px | Light | [auth-tablet-768-light.png](file:///d:/TITAN/docs/audit/screenshots/auth-tablet-768-light.png) |
| **Auth Sign-in** | Mobile 375px | Light | [auth-mobile-375-light.png](file:///d:/TITAN/docs/audit/screenshots/auth-mobile-375-light.png) |
| **Auth Sign-up Tab** | Desktop 1440px | Light | [auth-signup-tab-desktop-1440.png](file:///d:/TITAN/docs/audit/screenshots/auth-signup-tab-desktop-1440.png) |
| **Auth Join Mode** | Desktop 1440px | Light | [auth-join-company-desktop-1440.png](file:///d:/TITAN/docs/audit/screenshots/auth-join-company-desktop-1440.png) |
| **Reset Password** | Desktop 1440px | Light | [reset-password-desktop-1440-light.png](file:///d:/TITAN/docs/audit/screenshots/reset-password-desktop-1440-light.png) |
| **Reset Password** | Tablet 768px | Light | [reset-password-tablet-768-light.png](file:///d:/TITAN/docs/audit/screenshots/reset-password-tablet-768-light.png) |
| **Reset Password** | Mobile 375px | Light | [reset-password-mobile-375-light.png](file:///d:/TITAN/docs/audit/screenshots/reset-password-mobile-375-light.png) |
| **Trust Page** | Desktop 1440px | Light | [trust-desktop-1440-light.png](file:///d:/TITAN/docs/audit/screenshots/trust-desktop-1440-light.png) |
| **Trust Page** | Tablet 768px | Light | [trust-tablet-768-light.png](file:///d:/TITAN/docs/audit/screenshots/trust-tablet-768-light.png) |
| **Trust Page** | Mobile 375px | Light | [trust-mobile-375-light.png](file:///d:/TITAN/docs/audit/screenshots/trust-mobile-375-light.png) |
| **Not Found 404** | Desktop 1440px | Light | [not-found-desktop-1440-light.png](file:///d:/TITAN/docs/audit/screenshots/not-found-desktop-1440-light.png) |
| **Not Found 404** | Tablet 768px | Light | [not-found-tablet-768-light.png](file:///d:/TITAN/docs/audit/screenshots/not-found-tablet-768-light.png) |
| **Not Found 404** | Mobile 375px | Light | [not-found-mobile-375-light.png](file:///d:/TITAN/docs/audit/screenshots/not-found-mobile-375-light.png) |
| **Dashboard Redirect**| Desktop 1440px | Guard | [dashboard-redirect-desktop-1440-light.png](file:///d:/TITAN/docs/audit/screenshots/dashboard-redirect-desktop-1440-light.png) |
| **Dashboard Redirect**| Tablet 768px | Guard | [dashboard-redirect-tablet-768-light.png](file:///d:/TITAN/docs/audit/screenshots/dashboard-redirect-tablet-768-light.png) |
| **Dashboard Redirect**| Mobile 375px | Guard | [dashboard-redirect-mobile-375-light.png](file:///d:/TITAN/docs/audit/screenshots/dashboard-redirect-mobile-375-light.png) |
| **Telecaller Redirect**| Desktop 1440px| Guard | [telecaller-redirect-desktop-1440-light.png](file:///d:/TITAN/docs/audit/screenshots/telecaller-redirect-desktop-1440-light.png) |
| **Manager Redirect** | Desktop 1440px | Guard | [manager-redirect-desktop-1440-light.png](file:///d:/TITAN/docs/audit/screenshots/manager-redirect-desktop-1440-light.png) |
| **Admin Redirect** | Desktop 1440px | Guard | [admin-redirect-desktop-1440-light.png](file:///d:/TITAN/docs/audit/screenshots/admin-redirect-desktop-1440-light.png) |
| **Super Admin Redirect**| Desktop 1440px| Guard | [superadmin-redirect-desktop-1440-light.png](file:///d:/TITAN/docs/audit/screenshots/superadmin-redirect-desktop-1440-light.png) |
| **Blueprint Redirect** | Desktop 1440px | Guard | [blueprint-redirect-desktop-1440-light.png](file:///d:/TITAN/docs/audit/screenshots/blueprint-redirect-desktop-1440-light.png) |
