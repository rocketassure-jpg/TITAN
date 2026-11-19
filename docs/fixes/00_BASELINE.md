# TITAN Insurance CRM — Defect Baseline & Remediation Plan (Phase 0)

**Project:** TITAN Insurance CRM (Multi-tenant Insurance Broker & Tele-CRM Platform)  
**Date:** 18 November 2026  
**Auditor / Engineer:** Principal Full-Stack Engineer, Supabase Security Architect, React/TypeScript Expert & QA Automation Engineer  
**Git Commit Baseline:** `75c8ec74d111890878afcb75e8194e3bff7541ab` (Branch: `main`)  
**Supabase Migration Sequence Range:** `20260426101008_2cf619df-809e-42b3-b6c8-cb3325396e69.sql` through `20260630004752_fe1ada82-9df8-431c-a693-54ce379f2ec7.sql` (72 migration files)  
**Supabase Project ID:** `lgqgnsngxhqdzpstiddj`  
**Test Baseline:** Vitest 3.2.7 — 6 test files, 38 tests passing (Duration: ~20.0s); TypeScript (`tsc --noEmit`) passes with 0 type errors.

---

## 1. Verified Defect & Risk Inventory

Following static codebase analysis, migration review, and runtime trace reconciliation against `docs/audit/CORRECTED_BUG_REGISTER.md` and `docs/audit/RELEASE_READINESS_REPORT.md`:

### 1.1. Confirmed Active Defects (20 Items)

| Issue ID | Severity | Category | File Path & Target Lines | Summary & Reproduction Evidence |
| :--- | :---: | :---: | :--- | :--- |
| **SEC-01** | **P0** | Security | `supabase/migrations/20260616033648_*.sql:30,64,77`<br>`src/components/ProtectedRoute.tsx:14` | Role self-assignment to `manager` & auto-approval in `handle_new_user()`. Client route guard checks only `!is_active`, never `!is_approved`. |
| **SEC-02** | **P0** | Security | `supabase/functions/generate-payment-link/index.ts:11-25,57-68` | Cross-tenant IDOR. Service-role client updates quotes and leads across arbitrary tenants without verifying caller company ownership or role. |
| **NEW-SEC-A** | **P0** | Security | `supabase/migrations/20260616033648_*.sql:55-57` | Invalid company code silently falls back to company `'ROCKET'`, provisioning unauthorized users as approved managers of that tenant. |
| **SEC-03** | **P1** | Security | `supabase/migrations/20260616033648_*.sql:85-107`<br>`src/pages/Auth.tsx:57,74` | Unauthenticated public RPC `resolve_login_email(text)` allows anonymous callers to harvest real registered emails via phone numbers. |
| **NEW-SEC-B** | **P1** | Security | `src/pages/Auth.tsx:40-44, 109-113, 116-133`<br>`supabase/migrations/20260613215828_*.sql:76`<br>`supabase/migrations/20260616033648_*.sql:5-81` | Fail-open invite code gate. `invite_code_required()` returns 401 (revoked in migration), client skips invite, and `handle_new_user()` never validates invites server-side. |
| **BUG-NEW-01** | **P1** | Runtime | `src/components/admin/AdminOverviewPanel.tsx:75`<br>`src/components/CallingList.tsx:171`<br>`src/components/admin/SmartImportPanel.tsx:86` | PostgREST relationship failure (`PGRST200`) when selecting `profiles(...)` from `user_roles`. No foreign key between `user_roles` and `profiles` in Postgres. |
| **BUG-NEW-02** | **P1** | Runtime | `src/components/admin/AdminOverviewPanel.tsx:76,92` | Schema column mismatch (`42703`) querying `break_logs.user_id`. Actual column in schema and RLS policies is `telecaller_id`. |
| **UI-DEFECT-01** | **P2** | UI | `src/pages/Index.tsx:11,89`<br>`src/assets/hero-insurance-neon.jpg.asset.json` | Broken landing hero image (`naturalWidth: 0`). References external Lovable proxy `/__l5e/assets-v1/...` that 404s outside container. |
| **UI-DEFECT-02** | **P2** | UI / Responsive | `src/components/EnquiryForm.tsx:92-101`<br>`src/pages/Index.tsx:107` | Mobile (375px & 320px) form buttons and controls overflow card container by +22.72px due to `whitespace-nowrap px-8` on long text and nested padding. |
| **UI-DEFECT-03** | **P2** | UI / Responsive | `src/pages/SubAgentDashboard.tsx:45` | Root document horizontal scroll overflow on mobile viewports (`scrollWidth: 512px` on `375px`) caused by fixed 3-column grid without responsive wrap. |
| **UI-DEFECT-04** | **P2** | Accessibility | `src/components/CallingList.tsx:52,55`<br>`src/components/LeadActions.tsx:63` | WCAG 2.1 AA contrast violations on status badges (e.g. `bg-muted text-muted-foreground` yielding 2.4:1 contrast ratio against light backgrounds). |
| **BUG-FUNC-04** | **P2** | Functional | `src/components/CallingList.tsx:178-186` | Missing cancellation flag on `dial_logs` query in `CallingList.tsx`, allowing out-of-order race conditions when switching pages or tabs quickly. |
| **BUG-FUNC-05** | **P2** | Functional | `src/hooks/useLeadsPaginated.ts:125` | Strict regex `/^\d+$/` fails on phone numbers with spaces, dashes, or `+91`, causing searches to misclassify phone numbers as customer names. |
| **BUG-FUNC-06** | **P2** | Functional | `src/hooks/useLeadsPaginated.ts:97` | "Today" queue prematurely ejects leads once called due to `.is("last_called_at", null)`. Needs queue clarification to keep call records accessible or align tab semantics. |
| **BUG-FUNC-09** | **P2** | Multi-Tenancy | `src/contexts/SettingsContext.tsx:58,75-85` | Global `app_settings` query lacks tenant isolation (`.eq("company_id", companyId)`), and setting update handlers swallow mutation errors silently. |
| **BUG-DB-01** | **P2** | Database RLS | `supabase/migrations/20260614184705_*.sql:31-35` | Redundant overlapping permissive RLS policies on `public.leads`: `Admins manage leads` (FOR ALL) and `Admins view all leads` (FOR SELECT). |
| **BUG-DB-02** | **P2** | Database RLS | `supabase/migrations/20260426101008_*.sql:121-127` | Legacy telecaller area policies (`Telecallers view leads in their areas`) lack tenant scoping (`company_id = public.user_company_id()`). |
| **BUG-FUNC-07** | **P3** | Functional | `src/components/PremiumCalculator.tsx:78` | IEEE 754 floating-point precision error in motor IDV depreciation (`500000 * (1 - 0.55)` = `224999.99999999997`). Needs integer rounding. |
| **BUG-FUNC-08** | **P3** | Functional | `src/components/PremiumCalculator.tsx:118` | `Math.max(0, grossCommission - customerDiscount)` clamps net broker margin to zero, concealing financial losses when discounts exceed commission. |
| **BUG-UI-01** | **P3** | UI / Theme | `src/pages/Index.tsx:20,47` | Hardcoded inline light background `#f8fafc` overrides Tailwind dark mode classes (`dark:bg-slate-950`). |

---

### 1.2. Architectural & Operational Risks (6 Items)

1. **RISK-SEC-01 (P1):** Visual-only PII masking in React components (`useMaskingPolicy.ts`). Unmasked phone numbers transmitted in API payload to telecallers.
2. **RISK-SEC-02 (P2):** WhatsApp webhook fallback (`supabase/functions/whatsapp-webhook/index.ts:38-44`) falls back to un-scoped area lookup if API key has null `company_id`.
3. **RISK-SEC-03 (P2):** Plaintext OAuth tokens stored in `marketing_integrations` table.
4. **RISK-SEC-04 (P2):** Background cron functions (`sync-renewal-audiences`, `wa-marketing-webhook`) have `verify_jwt = false` in `config.toml`.
5. **RISK-SEC-05 (P2):** SMS dispatch (`send-sms`) lacks tenant-scoped quota enforcement.
6. **RISK-SEC-06 (P2):** Hardcoded staging/production URL committed in migration `20260613210308`.

---

### 1.3. Outdated & Inactive Items (4 Items)

1. **OUTDATED-01:** `message_templates` missing `company_id`. Resolved by migrations `20260613223423` and `20260614184705`.
2. **INACTIVE-01:** `SmartCSVImporter.tsx` header mapping failure on `"Mobile No"`. Orphaned legacy file. Active importer is `SmartImportPanel.tsx`.
3. **INACTIVE-02:** `SmartCSVImporter.tsx` swallows error details. Orphaned legacy file.
4. **INACTIVE-03:** `SmartCSVImporter.tsx` step 3 auto-close. Orphaned legacy file.

---

## 2. Test Baseline & Commands

- **Unit / Integration Runner:** `npm run test` (`vitest run`)
  - Baseline Pass: 6 test suites, 38 passing tests, 0 failures.
- **Type Checking:** `npx tsc --noEmit`
  - Baseline Pass: 0 type errors.
- **E2E / Browser Runner:** `npx playwright test` (available with `@playwright/test` and `@axe-core/playwright`).

---

## 3. Planned Files to Change by Phase

### Phase 1: Critical Security Fixes
- `supabase/migrations/20260701000001_security_hardening.sql` (Additive safe migration):
  - Remediate `handle_new_user()`: eliminate `'ROCKET'` fallback, default role to `'telecaller'`, set `is_approved = false` for joiners, validate invite codes server-side.
  - Secure `resolve_login_email`: replace public unauthenticated email leak with privacy-preserving lookup or synthetic email routing.
- `src/components/ProtectedRoute.tsx`: Enforce both `profileStatus.is_approved` and `profileStatus.is_active`.
- `src/pages/Auth.tsx`: Pass `invite_code` to `signUp()`, handle non-leaking login resolver, handle pending approval UX.
- `supabase/functions/generate-payment-link/index.ts`: Enforce caller authentication, company tenant resolution from `profiles`, role verification, quote `company_id` check, lead `company_id` check.
- `src/test/auth-rbac.test.ts`: Add test cases for role escalation block, approval check, invalid company code rejection.

### Phase 2: Database & Runtime Fixes
- `src/components/admin/AdminOverviewPanel.tsx`:
  - Split `user_roles` query and `profiles` query, join in memory by `user_id` to eliminate `PGRST200`.
  - Fix `break_logs` query: replace `user_id` with `telecaller_id` to eliminate `42703`.
- `src/components/CallingList.tsx` & `src/components/admin/SmartImportPanel.tsx`:
  - Fix `user_roles?select=profiles(...)` queries using separate profiles query to prevent secondary PGRST200 errors.
- `src/contexts/SettingsContext.tsx`:
  - Scope `app_settings` query by `company_id` using `useAuth()`. Add error toast notifications on failed updates.
- `supabase/migrations/20260701000002_rls_telecaller_area_cleanup.sql` (Additive safe migration):
  - Drop redundant `Admins view all leads` policy on `public.leads`.
  - Update legacy `Telecallers view leads in their areas` policy to enforce `company_id = public.user_company_id()`.
  - Update `invite_code_required` and `validate_invite_code` RPCs with clean security definer and tenant scoping.

### Phase 3: UI, Responsiveness & Accessibility
- `src/pages/Index.tsx`:
  - Replace external Lovable asset reference with local bundled image `src/assets/hero-insurance.jpg`.
  - Remove hardcoded inline `#f8fafc` background style to allow dark mode styles (`dark:bg-slate-950`).
- `src/components/EnquiryForm.tsx`:
  - Fix button overflow on mobile viewports (320px/375px) by replacing `whitespace-nowrap px-8` with responsive flex, wrapping, and padding.
- `src/pages/SubAgentDashboard.tsx`:
  - Update metric grid from fixed `grid-cols-3` to responsive `grid-cols-1 sm:grid-cols-3` and add `overflow-x-hidden` container.
- `src/components/CallingList.tsx` & `src/components/LeadActions.tsx`:
  - Fix WCAG 2.1 AA color contrast violations on status badges (increase contrast from 2.4:1 to >4.5:1).

### Phase 4: Functional & Business Logic Fixes
- `src/components/CallingList.tsx`:
  - Add request cancellation / sequencing flag to `dial_logs` fetch to eliminate out-of-order race conditions.
- `src/hooks/useLeadsPaginated.ts`:
  - Normalize search string by removing spaces/dashes before phone number detection (`digits.length >= 5`) to fix formatted phone searches (`+91 98765 43210`).
  - Refine "Today" queue query to prevent premature ejection or add clarity on pending vs completed daily calls.
- `src/components/PremiumCalculator.tsx`:
  - Apply `Math.round()` to motor IDV depreciation to eliminate IEEE 754 fractional precision artifacts.
  - Allow negative net margin on `netInPocket` when customer discount exceeds gross commission, displaying appropriate deficit warning.

### Phase 5 & 6: Remaining Risks & End-to-End Regression
- Update regression test suites in `src/test/` to cover all fixed behaviors.
- Generate comprehensive fix documentation in `docs/fixes/`.
