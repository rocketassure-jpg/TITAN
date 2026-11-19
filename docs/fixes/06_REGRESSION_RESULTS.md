# Phase 6 — End-to-End Regression Results

## Execution Overview
- **Date:** 2026-11-18
- **Platform:** Windows (NT 10.0.26100) / Node.js
- **Test Runner:** Vitest v3.2.7
- **Compiler:** TypeScript v5.8.3 (`npx tsc --noEmit`)
- **Bundler:** Vite v5.4.19 (`npm run build`)
- **Overall Verdict:** **100% PASS** (7/7 test suites passed, 66/66 unit tests passed, 0 compiler diagnostics, 0 bundle build errors)

---

## 1. Test Suite Execution Details

```
 RUN  v3.2.7 D:/TITAN

 ✓ src/test/example.test.ts (1 test) 14ms
 ✓ src/test/leads-query.test.ts (8 tests) 24ms
 ✓ src/test/csv-importer.test.ts (9 tests) 40ms
 ✓ src/test/auth-rbac.test.ts (29 tests) 59ms
 ✓ src/test/claims-utils.test.ts (5 tests) 33ms
 ✓ src/test/masking.test.ts (8 tests) 24ms
 ✓ src/test/calculations.test.ts (6 tests) 62ms

 Test Files  7 passed (7)
      Tests  66 passed (66)
   Start at  13:10:56
   Duration  25.25s
```

---

## 2. Test Breakdown by Domain

### A. Authentication, RBAC & Security (`src/test/auth-rbac.test.ts` — 29 Tests)
- **Role Escalation via Self-Registration (SEC-01):**
  - Blocks self-registration requesting `admin`, `manager`, `sub_agent` (defaults to unapproved `telecaller`).
  - Preserves initial company owner creation workflow.
- **Route Authorization & Approval Gates (NEW-SEC-A / NEW-SEC-B):**
  - Denies unapproved users (`is_approved = false`) access to protected CRM routes (`<PendingApproval />`).
  - Denies deactivated users (`is_active = false`) access.
  - Allows verified, active, and approved users to proceed.
- **Multi-Tenant Company Verification & Invite Codes (SEC-01):**
  - Rejects unknown company codes (no silent rocket company fallback).
  - Validates invite codes against `app_settings` for company registration.
  - Rejects invalid, expired, or missing invite codes.
- **Cross-Tenant Payment Link IDOR (SEC-02):**
  - Allows Company A user to generate payment link for Company A quote.
  - Blocks Company A user from accessing or updating Company B quote (HTTP 403).
  - Blocks requests where the associated lead belongs to another company.
  - Blocks unapproved users from generating payment links.
- **PII Privacy & Email Enumeration (SEC-03):**
  - Prevents unauthenticated email harvesting via phone numbers (returns `null` for personal emails).
  - Allows synthetic staff email resolution for internal staff mobile login.
- **Edge Function Hardening (RISK-SEC-02, RISK-SEC-04, RISK-SEC-05):**
  - WhatsApp webhook rejects requests with HTTP 403 if API key lacks `company_id`.
  - WhatsApp webhook strictly scopes area lookup to caller company.
  - Send SMS rejects unapproved callers and cross-tenant `lead_id` tampering.
  - Validates phone number formats and caps SMS message length to 500 characters.

### B. Functional & Business Logic (`src/test/calculations.test.ts` & `src/test/leads-query.test.ts` — 14 Tests)
- **Motor Insurance IDV Precision (BUG-FUNC-07):**
  - Rounds IDV to the nearest whole integer avoiding floating-point precision artifacts.
- **Deficit Commission Margin (BUG-FUNC-08):**
  - Removes `Math.max(0, ...)` clamp; allows true negative `netInPocket` when customer discount exceeds gross commission.
- **IRDAI Depreciation & Vehicle Slabs:**
  - 5% depreciation for new vehicles, 55% for >5 years.
  - Caps anti-theft discount at ₹500.
  - Resets NCB to 0% after a claim.
- **Formatted Phone Number Search (BUG-FUNC-05):**
  - Normalizes `+91 98765 43210`, `98765-43210`, `9876543210` to strip formatting and search `phone_number`.
  - Preserves customer name searches without spurious phone filters.
- **"Today's Calls" Queue Filtering (BUG-FUNC-06):**
  - Strictly restricts queue to `call_date = today` and uncalled or scheduled callbacks due today (`last_called_at is null OR last_called_at < today`).

### C. Data Ingestion & PII Masking (`src/test/csv-importer.test.ts` & `src/test/masking.test.ts` — 17 Tests)
- **CSV Import Header Normalization:**
  - Resolves standard aliases across different broker export formats.
- **PII Phone Masking (SEC-04):**
  - Validates client-side and server-side masking behavior for restricted vs privileged roles.

### D. Claims Utilities & Sanity (`src/test/claims-utils.test.ts` & `src/test/example.test.ts` — 6 Tests)
- Verifies claim status transitions and priority calculation algorithms.

---

## 3. Static Type Analysis & Production Build Verification

### TypeScript Type Check
```bash
npx tsc --noEmit
Exit Code: 0 (Zero type errors)
```

### Production Build
```bash
npm run build
Exit Code: 0
Build Output:
  - dist/index.html (2.08 kB)
  - dist/assets/hero-insurance-C1cQ73by.jpg (92.98 kB)
  - dist/assets/index-v-325lqI.css (96.80 kB)
  - dist/assets/CallingList-DZWs0YHP.js (107.77 kB)
  - dist/assets/PremiumCalculator-BaUeAmfl.js (461.20 kB)
  - 3,968 modules transformed successfully
```
All route components, chunk outputs, and bundled local assets verified without runtime syntax or asset resolution errors.
