# TITAN Insurance CRM — Security Fixes Report (Phase 1)

**Date:** 18 November 2026  
**Auditor / Engineer:** Principal Full-Stack Engineer, Supabase Security Architect & QA Automation Engineer  
**Status:** COMPLETED & VERIFIED WITH REGRESSION TESTS  

---

## 1. Summary of Remediated Security Vulnerabilities

| Bug ID | Priority | Module | Root Cause | Fix Implemented | Status |
| :--- | :---: | :--- | :--- | :--- | :---: |
| **SEC-01** | **P0** | Auth & Multi-Tenancy | `handle_new_user()` accepted `requested_role` from user metadata and automatically set `is_approved = true`. Client guard `ProtectedRoute.tsx` evaluated only `!is_active`, never `!is_approved`. | Updated trigger to strictly default non-creator signups to `telecaller` and set `is_approved = false`. Updated `ProtectedRoute.tsx` to evaluate both `!is_active` and `!is_approved`. | **VERIFIED** |
| **NEW-SEC-A** | **P0** | Multi-Tenancy | `handle_new_user()` silently fell back to company code `'ROCKET'` when an invalid code was entered, granting foreign users manager access. | Removed fallback to `'ROCKET'`. Trigger now raises exception `RAISE EXCEPTION 'Invalid or inactive company code: %'` to immediately abort unauthorized signup transactions. | **VERIFIED** |
| **SEC-02** | **P0** | Supabase Edge Functions | `generate-payment-link/index.ts` used service-role key to query and update quotes/leads without validating caller company ownership or role. | Enforced caller authentication, resolved caller company and role from `profiles` and `user_roles`. Added tenant boundary assertions (`quote.company_id === callerCompanyId` and `lead.company_id === callerCompanyId`). Scoped updates strictly to tenant. | **VERIFIED** |
| **SEC-03** | **P1** | Database RPC | Public RPC `resolve_login_email` exposed real user emails from `auth.users` to anonymous callers querying with phone numbers. | Added privacy gate in `resolve_login_email`: only synthetic staff identifiers (`*.staff.local`, `*.internal`) are returned. Real personal emails (`@gmail.com`, etc.) return `NULL`. Updated client error handling in `Auth.tsx`. | **VERIFIED** |
| **NEW-SEC-B** | **P1** | Auth / Multi-Tenancy | Invite codes were checked only in browser UI with fail-open 401 error behavior, and never passed or checked in database trigger. | Added server-side invite code validation inside `handle_new_user()`. Updated `Auth.tsx` to pass `invite_code` in signup metadata and support tenant-specific invite requirement checks. | **VERIFIED** |

---

## 2. Technical Ground Truth & Files Changed

### 2.1. `supabase/migrations/20260701000001_security_hardening.sql`
- **Replaced `handle_new_user()` trigger:**
  - Initial creator (`_is_first`) retains `admin` role and `is_super_admin = true`.
  - Company creator (`_create_company = 'true'`) provisions new company, subscriptions, and `admin` role.
  - Organization joiners (`_create_company IS DISTINCT FROM 'true'`):
    - Company code must resolve to active company in `public.companies`. Missing/invalid code raises exception.
    - If company has an `invite_code` configured in `public.app_settings`, server-side check validates `raw_user_meta_data->>'invite_code'` against it. Missing/incorrect code aborts transaction.
    - Assigned role is strictly defaulted to `telecaller`.
    - Profile is inserted with `is_approved = false, is_active = true`.
- **Replaced `resolve_login_email(_login text)` RPC:**
  - Scans digits, resolves profile, retrieves email from `auth.users`.
  - Filters output: returns email ONLY if it matches synthetic staff domain pattern (`%.staff.local` or `%.internal`). Otherwise returns `NULL`.
- **Updated `invite_code_required` and `validate_invite_code`:**
  - Added optional `_company_code` parameter to support tenant-aware checks.
  - Granted execute to `anon, authenticated`.

### 2.2. `src/components/ProtectedRoute.tsx`
- Added explicit evaluation of `profileStatus.is_approved`:
  ```typescript
  if (profileStatus) {
    if (!profileStatus.is_active) {
      return <PendingApproval reason={profileStatus.rejection_reason || "Aapka account admin ne deactivate kar diya hai. Admin se contact karein."} />;
    }
    if (!profileStatus.is_approved) {
      return <PendingApproval reason={null} />;
    }
  }
  ```
  Unapproved users are stopped before rendering any dashboard, KPI cards, or customer lists.

### 2.3. `src/pages/Auth.tsx`
- Updated `handleSignUp` to forward `invite_code` in `supabase.auth.signUp()` metadata.
- Updated `verifyCode` to check tenant-specific invite requirement via `invite_code_required`.
- Updated `handleSignIn` and `handleForgot` to provide clear, privacy-preserving feedback when a phone number does not resolve to a synthetic staff account.

### 2.4. `supabase/functions/generate-payment-link/index.ts`
- Verified caller JWT via `supabase.auth.getUser()`.
- Resolved caller profile from `profiles`: verified `is_active` and `is_approved`.
- Verified caller role from `user_roles`: authorized roles are `admin`, `manager`, `telecaller`, `sub_agent` (or `is_super_admin`).
- Scoped motor quote retrieval and updates to `callerCompanyId`.
- Verified associated `lead` tenant matches `callerCompanyId`.
- Returned explicit HTTP 401, 403, and 404 responses.

---

## 3. Regression Test Executions & Results

- **Test Suite:** `src/test/auth-rbac.test.ts`
- **Tests Added / Updated:**
  - `enforces approval check: unapproved users are blocked at route guard (SEC-01)`
  - `blocks deactivated users even if previously approved`
  - `allows active and approved users access to their authorized role route`
  - `denies self-registration role escalation: requested_role 'manager' strictly provisions as 'telecaller'`
  - `rejects unknown company code without falling back to default ROCKET company (NEW-SEC-A)`
  - `enforces server-side invite code validation when configured (NEW-SEC-B)`
  - `allows initial company creator onboarding with admin role`
  - `allows Company A user to generate payment link for Company A quote (SEC-02)`
  - `blocks Company A user from modifying Company B quote (IDOR prevented)`
  - `blocks when quote and associated lead company mismatch`
  - `blocks unapproved caller from generating payment links`
  - `blocks unauthenticated real email harvesting via phone number (SEC-03)`
  - `returns synthetic staff email for legitimate staff mobile login`
  - `returns safe null on invalid or non-existent mobile number`
  - `preserves direct email input unchanged`
