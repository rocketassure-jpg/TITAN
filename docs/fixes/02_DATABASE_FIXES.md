# TITAN Insurance CRM — Database & Runtime Fixes Report (Phase 2)

**Date:** 18 November 2026  
**Auditor / Engineer:** Principal Full-Stack Engineer, Supabase Security Architect & React/TypeScript Expert  
**Status:** COMPLETED & VERIFIED  

---

## 1. Summary of Remediated Database & Runtime Defects

| Bug ID | Priority | Module | Root Cause | Fix Implemented | Status |
| :--- | :---: | :--- | :--- | :--- | :---: |
| **BUG-NEW-01** | **P1** | Admin Dashboard / PostgREST | PostgREST returned `PGRST200` error when querying `user_roles?select=user_id,role,profiles(full_name,is_active)` because no direct foreign key exists between `user_roles` and `profiles` in Postgres schema. | Corrected query in `AdminOverviewPanel.tsx` by executing separate reads of `user_roles` and `profiles`, mapping profiles in memory by `user_id`. Also resolved similar unjoined patterns in `CallingList.tsx` and `SmartImportPanel.tsx`. | **VERIFIED** |
| **BUG-NEW-02** | **P1** | Admin Dashboard / Break Monitoring | PostgREST returned `42703` column error when selecting `break_logs?select=user_id,started_at,ended_at` because the schema column is `telecaller_id`, not `user_id`. | Replaced `user_id` with `telecaller_id` in `AdminOverviewPanel.tsx` query and downstream `activeBreakIds` mapping. | **VERIFIED** |
| **BUG-NEW-03** | **P1** | Company Invites / RPC | `invite_code_required()` RPC returned HTTP 401 Unauthorized for anonymous visitors because execute permissions were revoked in migration `20260613215828`. | Updated `invite_code_required(_company_code text)` and `validate_invite_code(_code text, _company_code text)` to support tenant-aware lookups with safe `SECURITY DEFINER` and granted execute to `anon, authenticated`. | **VERIFIED** |
| **BUG-FUNC-09** | **P2** | Multi-Tenancy / App Settings | `SettingsContext.tsx` loaded global `app_settings` via `.select("*").limit(1).maybeSingle()` without filtering by `company_id`. Mutation updates silently swallowed errors. | Scoped query by `company_id` via `useAuth()`. Added error toast notifications and user feedback on failed settings updates. | **VERIFIED** |
| **BUG-DB-01** | **P2** | Database RLS | Migration `20260614184705` created two overlapping permissive policies on `public.leads`: `Admins manage leads` (FOR ALL) and `Admins view all leads` (FOR SELECT). | Dropped redundant `Admins view all leads` policy in migration `20260701000002_rls_telecaller_area_cleanup.sql`. | **VERIFIED** |
| **BUG-DB-02** | **P2** | Database RLS | Legacy telecaller area policies (`Telecallers view leads in their areas` and `Telecallers update leads in their areas`) lacked tenant scoping (`company_id = public.user_company_id()`). | Replaced legacy policies in migration `20260701000002_rls_telecaller_area_cleanup.sql` with explicit `company_id = public.user_company_id()` constraints on both Telecaller and Manager policies. | **VERIFIED** |

---

## 2. Technical Ground Truth & Files Changed

### 2.1. `src/components/admin/AdminOverviewPanel.tsx`
- Separated `user_roles` query from `profiles` query:
  ```typescript
  supabase.from("user_roles").select("user_id,role").eq("role", "telecaller"),
  supabase.from("profiles").select("id,full_name,is_active"),
  supabase.from("break_logs").select("telecaller_id,started_at,ended_at").is("ended_at", null),
  ```
- Created `profMap = new Map(profsList.map((p) => [p.id, p]))`.
- Updated `activeBreakIds = new Set(breaksRes.data.map((b) => b.telecaller_id))`.
- Updated leaderboard to resolve full names cleanly via `profMap.get(r.user_id)?.full_name`.

### 2.2. `src/components/CallingList.tsx`
- Replaced nested `user_roles?select=...,profiles(...)` with parallel separate reads and in-memory filter.
- Added cancellation cleanup in `useEffect` to prevent out-of-order race conditions on `dial_logs` fetch.

### 2.3. `src/components/admin/SmartImportPanel.tsx`
- Replaced nested `user_roles?select=...,profiles(...)` with parallel separate reads for managers roster.

### 2.4. `src/contexts/SettingsContext.tsx`
- Scoped `app_settings` query to `companyId` from `useAuth()`.
- Added error handling with user-facing toasts on `saveMasking` and `saveBrand`.

### 2.5. `supabase/migrations/20260701000002_rls_telecaller_area_cleanup.sql`
- Dropped duplicate `Admins view all leads` policy on `public.leads`.
- Replaced un-scoped `Telecallers view leads in their areas` and `Telecallers update leads in their areas` with tenant-isolated definitions requiring `company_id = public.user_company_id()`.
- Added tenant isolation to `Managers view team leads` and `Managers update team leads`.
