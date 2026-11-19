# TITAN Insurance CRM — Functional Quality Audit

**Audit Date:** November 2026  
**Auditor:** Principal QA Architect & Automation Test Engineer  
**Scope:** Functional verification of core application workflows, edge cases, data transformations, and business rules.

---

## 1. Executive Summary

This functional audit examines the operational correctness of the TITAN Insurance CRM platform across 12 functional domains. Testing encompassed unit test execution (Vitest), integration checks against PostgREST and Supabase schemas, form validation inspection, and boundary analysis.

### Functional Health Matrix

| Domain | Status | Critical Findings Summary |
| :--- | :--- | :--- |
| **Authentication & RBAC** | FAILED | Auto-approval bypass (`is_approved=true` hardcoded); unapproved users bypass route guards. |
| **Telecaller Calling Queue** | WARNING | Stale statistics bug via missing React Hook dependencies; search ignores formatted phone numbers. |
| **CSV Importer** | FAILED | Common Indian column header `"Mobile No"` fails auto-matching; error payloads discarded on chunk failures; Step 3 unmounts prematurely. |
| **Insurance Calculation Engine** | WARNING | IEEE 754 floating-point rounding creates fractional paisa bugs; broker financial losses are masked to ₹0. |
| **Customer 360 & Policies** | PASSED | Rich data model across Motor, Health, Life; cascade relations intact. |
| **Claims Workflow** | PASSED | 10-stage progression, aging tracker, and document linkages function as designed. |
| **Renewals & Messaging** | WARNING | Webhook receiver ignores URL `?api_key=` parameter; SMS API lacks rate-limiting. |
| **Settings & Branding** | WARNING | Settings updates lack database error handling, causing silent failures on permission denial. |

---

## 2. Deep-Dive Functional Analysis by Module

### 2.1. Authentication & Tenant Onboarding

#### Behavior & Workflow
- **Signup Mechanism:** Users register via `supabase.auth.signUp()`. Metadata (`requested_role`, `company_code`, `create_company`) is passed in `raw_user_meta_data`.
- **Database Trigger:** PostgreSQL trigger `on_auth_user_created` fires `handle_new_user()`.
- **Synthetic Email Generation:** For staff members without corporate email, the system synthesizes email as `<mobile>@<company_code>.staff.local` (e.g., `9876543210@rocket.staff.local`).

#### Identified Defects & Functional Gaps
1. **Approval Bypass in Route Guards (`ProtectedRoute.tsx` Line 14):**
   - The route guard only checks:
     ```tsx
     if (profileStatus && !profileStatus.is_active) {
       return <PendingApproval reason={...} />;
     }
     ```
   - It **never inspects `profileStatus.is_approved`**.
   - Consequently, an unapproved user whose `is_active` defaults to `true` is granted full access to the role-protected dashboards immediately.
2. **Hardcoded Auto-Approval in Trigger (`20260610194138` Line 260):**
   - When any user registers, the database trigger executes:
     ```sql
     INSERT INTO public.profiles (..., is_approved, is_active, ...) VALUES (..., true, true, ...);
     ```
   - All self-registered users are automatically approved without admin intervention.
3. **Role Precedence (`AuthContext.tsx` Line 13):**
   - `pickRole` uses `roles.includes("admin") ? "admin" : ...`. If a user possesses multiple role rows in `user_roles`, the highest tier always takes precedence.

---

### 2.2. Telecaller Calling Queue (`src/components/CallingList.tsx`)

#### Behavior & Workflow
- Displays assigned leads partitioned into buckets (`today`, `overdue`, `interested`, `followup`, etc.).
- Paginated with default page size of 50.
- Telecallers update call dispositions, record notes, and trigger direct WhatsApp/phone calls.

#### Identified Defects & Functional Gaps
1. **Stale State in Today's Calling Stats (ESLint Warning / React Hook Bug):**
   - Lines 201 & 210 in `CallingList.tsx`:
     ```tsx
     useEffect(() => {
       loadTodayStats();
     }, []); // Missing loadTodayStats and user
     ```
   - `loadTodayStats` relies on `user.id`. When the component mounts or user session refreshes, `loadTodayStats` executes with a stale closure of `user`. If a telecaller submits a disposition, the summary metrics on top of the screen fail to update reactively until a full browser reload.
2. **Search Regex Failure on Formatted Numbers (`useLeadsPaginated.ts` Line 125):**
   - Filter query logic:
     ```ts
     const s = debouncedSearch.trim();
     if (s) {
       if (/^\d+$/.test(s)) q = q.ilike("phone_number", `%${s}%`);
       else q = q.ilike("customer_name", `%${s}%`);
     }
     ```
   - If an agent searches `"+91 98765 43210"` or `"98765-43210"`, `/^\d+$/.test(s)` evaluates to `false` because of spaces, plus signs, and hyphens.
   - The query falls back to `customer_name ILIKE '%+91 98765 43210%'`, returning 0 leads despite the phone number existing in the database.
3. **Lead Disappearance from "Today" Bucket on Follow-up (`useLeadsPaginated.ts` Line 97):**
   - Case `"today"` enforces:
     ```ts
     q = q.lte("call_date", t)
          .not("status", "in", `(${COMPLETED_STATUSES.join(",")})`)
          .is("last_called_at", null);
     ```
   - As soon as a telecaller calls a lead and logs a status (e.g., "Follow-up for 4 PM"), `last_called_at` is stamped with the timestamp. The lead immediately vanishes from "Today", even though the follow-up call date is today.

---

### 2.3. Smart CSV Importer (`src/components/admin/SmartCSVImporter.tsx`)

#### Behavior & Workflow
- 3-step file ingestion: File Upload → Column Mapping → Batch Database Insertion.
- Employs fuzzy header auto-matching (`autoMatch`) and date normalization (`parseDate`).

#### Identified Defects & Functional Gaps
1. **Column Auto-Match Failure on `"Mobile No"` (`SmartCSVImporter.tsx` Line 71):**
   - In `autoMatch`:
     ```ts
     if (h.includes("mobile1") || h === "mobile" || h === "phone" || h.includes("contact")) return "phone_number";
     ```
   - When given header `"Mobile No"`, `h` becomes `"mobileno"`.
   - Because `"mobileno"` is not equal to `"mobile"`, does not include `"mobile1"`, and does not include `"contact"`, it returns `"__skip__"`.
   - Because `phone_number` is a mandatory field, the import process is blocked by default on standard Indian insurance spreadsheets.
2. **Silent Failure on Batch Insert Error (`SmartCSVImporter.tsx` Line 190):**
   - In `doImport`:
     ```ts
     const { error, count } = await supabase.from("leads").insert(chunk, { count: "exact" });
     if (error) failed += chunk.length;
     ```
   - The Postgres error details (`error.message`, `error.details`) are discarded. The user is only told that "X leads failed", with zero diagnostic context regarding which constraint or field failed.
3. **Premature Dismissal of Summary Dialog (`SmartCSVImporter.tsx` Line 199):**
   - `onDone()` is invoked in the same synchronous turn as `setStep(3)`. Parent dialog containers close immediately upon completion, preventing the user from reviewing the duplicates or failure report.

---

### 2.4. Insurance Calculation Engine (`src/components/PremiumCalculator.tsx`)

#### Behavior & Workflow
- Real-time calculation of Own Damage (OD), Third Party (TP), Add-ons, Goods & Services Tax (GST 18%), and Broker Commission margins.
- Supports PDF quote generation via `jspdf` and `jspdf-autotable`.

#### Identified Defects & Functional Gaps
1. **Floating-Point Precision Loss on IDV Depreciation:**
   - In `depreciationByAge(8)`: depreciation is `0.55`.
   - Calculating IDV for ₹5,00,000 ex-showroom:
     $$500000 \times (1 - 0.55) = 500000 \times 0.44999999999999996 = 224999.99999999997$$
   - Without `Math.round()` on `idv`, downstream calculations and PDF tables display fractional cents/paisa.
2. **Deficit Masking in Broker Net-in-Pocket (`PremiumCalculator.tsx` Line 118):**
   - In margin calculation:
     ```ts
     const customerPays = Math.max(0, grossPremium - Number(f.customerDiscount));
     const netInPocket = Math.max(0, grossCommission - Number(f.customerDiscount));
     ```
   - If an agent offers a customer discount exceeding the broker's commission (e.g., Commission = ₹1,200, Customer Discount = ₹2,000), the actual net position is $-\text{₹}800$ (a net loss).
   - `Math.max(0, ...)` clamps the value to `₹0`, hiding the deficit from the broker.
3. **Dead Code in Add-on Total Calculation (`PremiumCalculator.tsx` Line 100):**
   - Line 100 computes:
     ```ts
     const addonTotal = addonItems.reduce((s, a) => s + idv * a.rate * 0.01 * 100 * 0.01, 0);
     ```
   - This variable is redundant and completely overwritten by `addonsSum` on Line 102 (`addonsCalc.reduce(...)`).

---

### 2.5. Settings & Tenant Configuration (`src/contexts/SettingsContext.tsx`)

#### Behavior & Workflow
- Manages company brand colors (`applyBrand`), logo URL, and phone number masking policies.

#### Identified Defects & Functional Gaps
1. **Unscoped `app_settings` Query (`SettingsContext.tsx` Line 58):**
   - Query:
     ```ts
     const { data } = await supabase.from("app_settings").select("*").limit(1).maybeSingle();
     ```
   - Does not filter by `company_id`. Relies solely on RLS to isolate settings. If multiple settings rows exist or if an admin belongs to a multi-branch entity, an arbitrary record is returned.
2. **Missing Mutation Error Handling (`SettingsContext.tsx` Lines 77 & 82):**
   - In `saveMasking` and `saveBrand`:
     ```ts
     await supabase.from("app_settings").update({ masking_config: m }).eq("id", settingsId);
     setMasking(m);
     ```
   - If the database update fails due to network termination or an RLS restriction, no error is caught or reported. The React local state updates optimistically, leading the user to believe the change was persisted when it was not.

---

## 3. Boundary & Error Scenario Test Matrix

| Test Scenario | Module | Input / Condition | Expected Behavior | Actual Behavior | Result |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Zero Vehicle Age** | Calculator | `mfgYear = 2026` | 5% depreciation applied | 5% applied correctly | PASS |
| **Max Vehicle Age (>5 yrs)** | Calculator | `mfgYear = 2015` | 55% depreciation applied | 55% applied with IEEE 754 precision artifact | WARNING |
| **NCB with Prior Claim** | Calculator | `claimLastYear = true, ncb = 50` | NCB reset to 0% | Reset to 0% correctly | PASS |
| **Anti-Theft Cap** | Calculator | `antiTheft = true, exShowroom = 50L` | Discount capped at ₹500 | Capped at ₹500 correctly | PASS |
| **Discount Exceeds Commission** | Calculator | `customerDiscount > commission` | Display negative margin / deficit warning | Clamped to ₹0, hiding deficit | FAIL |
| **Invalid Date in CSV** | CSV Importer | `"32/13/2025"` or `"unknown"` | Date set to null | Returns `null` correctly | PASS |
| **Indian Date Format** | CSV Importer | `"25/12/2025"` | Converted to `"2025-12-25"` | Converted correctly | PASS |
| **Standard "Mobile No" Header** | CSV Importer | Header `"Mobile No"` | Auto-matched to `phone_number` | Skipped as `"__skip__"` | FAIL |
| **CSV Batch Failure** | CSV Importer | Constraint violation in chunk | Display error message with reason | Error discarded, silent count increment | FAIL |
| **Unapproved User Access** | Auth / RBAC | `is_approved = false, is_active = true` | Block user at `/dashboard` | Route allowed through | FAIL |
| **Admin Route Escalation** | Auth / RBAC | Role `telecaller` navigating to `/admin` | Redirected to `/dashboard` | Redirected correctly | PASS |
| **Predictable Password** | Team Admin | Create user "Amit", "9876543210" | Strong random temporary password | Generates predictable `"Amit3210"` | WARNING |
| **Phone Masking Edge Case** | Utilities | `phone = "123"` (<5 digits) | Graceful fallback | Returns `"123"` without crash | PASS |
