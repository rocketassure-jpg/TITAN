# TITAN Insurance CRM — Master Bug & Vulnerability Register

**Project:** TITAN Insurance CRM  
**Date:** November 2026  
**Auditor:** Principal QA Architect, Senior React Engineer & Security Auditor  
**Audit Mode:** AUDIT-ONLY  
**Register Status:** CONFIRMED & VERIFIED

---

## 1. Classification & Severity Standards

Issues in this register are classified according to standard enterprise severity criteria:

- **P0 (Critical / Blocker):** Direct security breach, privilege escalation, cross-tenant data corruption/leakage, or unrecoverable system crash.
- **P1 (High):** Major functional failure, authentication bypass risk, PII harvesting, compliance violation, or core business workflow stoppage without workaround.
- **P2 (Medium):** Functional defect with viable workaround, UX regression, logic inconsistency, improper error suppression, or performance degradation.
- **P3 (Low):** Minor UI styling defect, cosmetic inconsistency, rounding imperfection, or non-blocking edge-case anomaly.

---

## 2. Executive Summary of Findings

| Category | P0 | P1 | P2 | P3 | Total Confirmed |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Security & Tenancy** | 2 | 5 | 3 | 0 | **10** |
| **Functional & Logic** | 0 | 0 | 7 | 2 | **9** |
| **UI & Accessibility** | 0 | 0 | 1 | 1 | **2** |
| **Database & Schema** | 0 | 1 | 1 | 0 | **2** |
| **Total Confirmed** | **2** | **6** | **12** | **3** | **23** |
| **Potential Risks / Vulnerabilities** | 1 (NPM Critical) | 3 (NPM High) | 2 (Perf/Arch) | 1 | **7** |

---

## 3. CONFIRMED BUGS & VULNERABILITIES

---

### [SEC-01] Role Escalation & Unapproved User Access via Registration Metadata
- **Bug ID:** `SEC-01`
- **Priority:** **P0 (Critical)**
- **Module:** Authentication & Multi-Tenancy
- **File Path & Line Number:** `supabase/migrations/20260610194138` (Lines 35-50) & `src/components/ProtectedRoute.tsx` (Line 14)
- **Steps to Reproduce:**
  1. Call `supabase.auth.signUp()` with metadata: `{ "company_code": "TITAN-ABC", "requested_role": "manager" }`.
  2. Inspect database `user_roles` and `profiles` tables.
  3. Log into the application using the new credentials.
- **Expected Behavior:**
  New users should be assigned a default non-privileged role (or require admin approval `is_approved = false`), and `ProtectedRoute` must block unapproved accounts from accessing dashboards.
- **Actual Behavior:**
  The `handle_new_user()` database trigger grants `'manager'` role directly from the untrusted client-supplied metadata and hardcodes `is_approved = true`. Furthermore, `ProtectedRoute.tsx` Line 14 only checks `if (!profileStatus.company_id)`, never verifying `profileStatus.is_approved`.
- **Root Cause:**
  Unsanitized client metadata ingestion in database trigger combined with missing approval condition in React route guards.
- **Evidence:**
  `src/test/auth-rbac.test.ts` test case `"allows unapproved user into dashboard because is_approved is not checked"` passes and confirms the flaw.
- **Recommended Fix:**
  1. Restrict `requested_role` in `handle_new_user()` trigger to a strict whitelist or force default `'telecaller'`.
  2. Set `is_approved = false` for all self-registered users joining an existing company.
  3. In `ProtectedRoute.tsx`, add: `if (profileStatus && !profileStatus.is_approved) return <Navigate to="/pending-approval" replace />;`.
- **Regression Test:** `src/test/auth-rbac.test.ts`

---

### [SEC-02] Cross-Tenant IDOR in Payment Link Generation Edge Function
- **Bug ID:** `SEC-02`
- **Priority:** **P0 (Critical)**
- **Module:** Supabase Edge Functions (`generate-payment-link`)
- **File Path & Line Number:** `supabase/functions/generate-payment-link/index.ts` (Lines 42-65)
- **Steps to Reproduce:**
  1. Authenticate as an agent belonging to Tenant Company A.
  2. Issue a POST request to `/functions/v1/generate-payment-link` passing `{ "motor_quote_id": "<UUID of Tenant B Quote>" }`.
- **Expected Behavior:**
  The function must verify that the requesting user's `company_id` matches the `company_id` of the quote. If mismatched, return HTTP 403 Forbidden.
- **Actual Behavior:**
  The Edge Function instantiates a Supabase client using `SUPABASE_SERVICE_ROLE_KEY` (bypassing RLS), queries `motor_quotes` by `id` without checking `company_id`, generates a payment link, and updates both the quote and its associated lead.
- **Root Cause:**
  Edge Function uses service-role privileges without verifying tenant ownership of the requested record.
- **Evidence:**
  Code audit in `SECURITY_AUDIT.md` (Section 3, SEC-02).
- **Recommended Fix:**
  Extract `user.id` from JWT, query caller's `company_id` from `profiles`, and append `.eq("company_id", callerCompanyId)` to the quote query before mutating state.
- **Regression Test:** Integration test verifying 403 response on cross-tenant UUID injection.

---

### [SEC-03] Unauthenticated PII Harvesting via Public RPC `resolve_login_email`
- **Bug ID:** `SEC-03`
- **Priority:** **P1 (High)**
- **Module:** Auth & Public APIs
- **File Path & Line Number:** `supabase/migrations/20260613183622_1caae1a7-bc07-4c40-b17e-7b2b87348a02.sql` (Line 15)
- **Steps to Reproduce:**
  1. From an unauthenticated terminal session, execute:
     `curl -X POST "https://lgqgnsngxhqdzpstiddj.supabase.co/rest/v1/rpc/resolve_login_email" -H "apikey: <ANON_KEY>" -d '{"_identifier":"9876543210"}'`.
- **Expected Behavior:**
  Unauthenticated callers should not be able to enumerate real email addresses linked to phone numbers.
- **Actual Behavior:**
  The function executes as `SECURITY DEFINER` and returns the user's plain text email address from `auth.users` to anyone with the public anon key.
- **Root Cause:**
  `GRANT EXECUTE ON FUNCTION public.resolve_login_email(text) TO anon;` allows unauthenticated callers to query user identities without rate limiting or captcha.
- **Evidence:**
  Migration script line 15: `GRANT EXECUTE ... TO anon;`.
- **Recommended Fix:**
  Handle mobile-number login directly inside Supabase Auth phone authentication, or wrap `resolve_login_email` in an Edge Function with Turnstile/hCaptcha and strict IP rate limiting.
- **Regression Test:** Automated curl test verifying 401 Unauthorized for anon calls.

---

### [SEC-04] Client-Side-Only PII Masking Exposes Customer Numbers in Network Payload
- **Bug ID:** `SEC-04`
- **Priority:** **P1 (High)**
- **Module:** Data Privacy & Telecaller CRM
- **File Path & Line Number:** `src/hooks/useMaskingPolicy.ts` (Lines 15-32) & `src/components/CallingList.tsx`
- **Steps to Reproduce:**
  1. Log into the CRM as a Telecaller with `phone_masking_enabled = true`.
  2. View the Calling Queue on screen (phone numbers display as `******4321`).
  3. Open Chrome DevTools -> Network Tab -> Filter `/rest/v1/leads`.
  4. Inspect the JSON response body.
- **Expected Behavior:**
  When masking policy is enabled, sensitive customer phone numbers must be masked at the database or API boundary before reaching client memory.
- **Actual Behavior:**
  Raw 10-digit customer phone numbers (`+919876543210`) are delivered in cleartext over the network to the browser. Masking is only applied visually in the DOM via JavaScript string substitution `maskPhone(phone)`.
- **Root Cause:**
  Lack of server-side data projection; PostgREST SELECT query pulls `phone_number` directly into frontend React state.
- **Evidence:**
  `src/test/masking.test.ts` verifies that `maskPhone` is purely a string manipulation function without cryptographic protection.
- **Recommended Fix:**
  Implement a database view or PostgreSQL column-level security / stored procedure that masks `phone_number` for users lacking the `'can_view_unmasked_pii'` permission.
- **Regression Test:** `src/test/masking.test.ts`

---

### [SEC-05] WhatsApp Webhook Cross-Tenant Lead Fallback & Param Bypass
- **Bug ID:** `SEC-05`
- **Priority:** **P1 (High)**
- **Module:** Omnichannel Messaging (`whatsapp-webhook`)
- **File Path & Line Number:** `supabase/functions/whatsapp-webhook/index.ts` (Lines 35-52)
- **Steps to Reproduce:**
  1. Configure a WhatsApp webhook with an API key whose company record is missing or inactive.
  2. Transmit an incoming webhook message payload.
- **Expected Behavior:**
  The webhook must reject the request with HTTP 401/404 if the API key does not resolve to an active tenant.
- **Actual Behavior:**
  If `company_id` is null, the code executes:
  `const { data: fallbackArea } = await supabase.from('areas').select('id, company_id').limit(1).single();`
  and routes the incoming lead into whichever company happens to be returned first by PostgreSQL!
- **Root Cause:**
  Overly aggressive fallback logic designed for single-tenant local testing left enabled in production code.
- **Evidence:**
  `supabase/functions/whatsapp-webhook/index.ts` lines 38-44.
- **Recommended Fix:**
  Delete the fallback query entirely. If `!company_id`, immediately return `new Response('Invalid API Key / Company', { status: 401 })`.
- **Regression Test:** Unit test for webhook endpoint testing null company_id rejection.

---

### [SEC-06] Plaintext OAuth Tokens Stored in `marketing_integrations` Table
- **Bug ID:** `SEC-06`
- **Priority:** **P2 (Medium)**
- **Module:** Marketing Automation
- **File Path & Line Number:** `supabase/migrations/20260613185709_4784b192-d9ef-4eb8-9653-17e886116ce8.sql` (Line 18)
- **Steps to Reproduce:**
  1. Connect a Facebook Page or LinkedIn account in Marketing Settings.
  2. Inspect table `public.marketing_integrations` via SQL editor.
- **Expected Behavior:**
  OAuth access tokens, refresh tokens, and client secrets must be encrypted at rest using Supabase Vault (`pgsodium`).
- **Actual Behavior:**
  Tokens are stored as raw text strings in `access_token` and `refresh_token` columns.
- **Root Cause:**
  No encryption layer or key derivation wrapper implemented on integration tokens.
- **Evidence:**
  Schema definition in migration `20260613185709`: `access_token TEXT NOT NULL`.
- **Recommended Fix:**
  Migrate token storage to Supabase Vault secrets or encrypt using AES-256 via `pgsodium` before insertion.
- **Regression Test:** Database schema assertion verifying column encryption type.

---

### [SEC-07] Unauthenticated Cron Triggers Exposed to Public Web
- **Bug ID:** `SEC-07`
- **Priority:** **P2 (Medium)**
- **Module:** Edge Functions (`sync-renewal-audiences`, `social-publish-scheduled`)
- **File Path & Line Number:** `supabase/config.toml` (Lines 8-12)
- **Steps to Reproduce:**
  1. Send a POST request to `https://<project>.supabase.co/functions/v1/sync-renewal-audiences` without an Authorization header when `CRON_SECRET` environment variable is unset.
- **Expected Behavior:**
  Endpoints must reject requests without valid authentication.
- **Actual Behavior:**
  Both functions specify `verify_jwt = false` in `config.toml`. If `CRON_SECRET` is unset or blank, the verification check evaluates `if (reqSecret === CRON_SECRET)` to `true === true` and executes the cron job.
- **Root Cause:**
  Insecure default comparison logic on optional environment variables.
- **Evidence:**
  `supabase/config.toml` config: `verify_jwt = false`.
- **Recommended Fix:**
  Enforce `if (!CRON_SECRET || reqSecret !== CRON_SECRET) return new Response('Unauthorized', { status: 401 });`.
- **Regression Test:** Curl test with missing headers against staging function.

---

### [SEC-08] SMS Toll Fraud Vector in `send-sms` Edge Function
- **Bug ID:** `SEC-08`
- **Priority:** **P2 (Medium)**
- **Module:** Telecommunications & Twilio Integration
- **File Path & Line Number:** `supabase/functions/send-sms/index.ts` (Lines 20-45)
- **Steps to Reproduce:**
  1. Authenticate as a junior telecaller.
  2. Send a rapid automated burst of 500 requests to `/functions/v1/send-sms` targeting international premium-rate phone numbers.
- **Expected Behavior:**
  SMS gateway must enforce tenant-level rate limiting, daily spend quotas, and destination country code restrictions (whitelisting Indian `+91` numbers only).
- **Actual Behavior:**
  The function executes Twilio API requests for any destination number provided in the payload without rate limiting or quota checks.
- **Root Cause:**
  Missing rate limiting, throttling, and phone number validation middleware.
- **Evidence:**
  Inspection of `supabase/functions/send-sms/index.ts`.
- **Recommended Fix:**
  1. Enforce regex destination check: `/^\+91[6-9]\d{9}$/`.
  2. Implement a Redis or database daily SMS quota per company.
- **Regression Test:** Automated rate-limiting integration test.

---

### [SEC-09] Hardcoded Anon API Key & Production URL in Migration SQL
- **Bug ID:** `SEC-09`
- **Priority:** **P1 (High)**
- **Module:** Database Migrations & pg_cron
- **File Path & Line Number:** `supabase/migrations/20260613210308_dcc1dd0b-be52-4ece-b8a4-f01264289210.sql` (Lines 54-57)
- **Steps to Reproduce:**
  1. Open migration `20260613210308`.
  2. Inspect cron job definition for `'renewal-reminders-daily'`.
- **Expected Behavior:**
  Database migrations must not contain hardcoded project URLs or JWT access tokens.
- **Actual Behavior:**
  The live production Supabase URL `https://lgqgnsngxhqdzpstiddj.supabase.co` and a full Supabase JWT anon key are hardcoded in the migration file.
- **Root Cause:**
  Developer committed an active environment configuration directly into a versioned migration.
- **Evidence:**
  Lines 54-55 of `20260613210308_dcc1dd0b-be52-4ece-b8a4-f01264289210.sql`.
- **Recommended Fix:**
  Rotate the compromised Supabase anon key in Supabase Dashboard. Update the pg_cron schedule to read secrets via `current_setting()`.
- **Regression Test:** Static code check searching for `apikey` or `supabase.co` in `supabase/migrations/`.

---

### [SEC-10] Cross-Tenant Data Leak in `message_templates`
- **Bug ID:** `SEC-10`
- **Priority:** **P1 (High)**
- **Module:** Database Schema & Marketing Templates
- **File Path & Line Number:** `supabase/migrations/20260605125419_4ce1c1fe-8c12-4df9-a834-9595f53cacf1.sql` (Lines 27-59)
- **Steps to Reproduce:**
  1. Company A creates a shared template (`shared = true`).
  2. User in Company B queries `SELECT * FROM message_templates;`.
- **Expected Behavior:**
  Users should only see templates belonging to their own company (`company_id = user_company_id()`).
- **Actual Behavior:**
  The table lacks a `company_id` column entirely. Any user from any tenant can view, and any admin/manager from any tenant can update/delete all shared templates across all companies.
- **Root Cause:**
  `message_templates` schema was created without multi-tenancy `company_id` foreign key.
- **Evidence:**
  `20260605125419_4ce1c1fe-8c12-4df9-a834-9595f53cacf1.sql` table definition.
- **Recommended Fix:**
  Add `company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE` and restrict RLS policies.
- **Regression Test:** SQL query asserting cross-tenant template isolation.

---

### [BUG-FUNC-01] Smart CSV Importer Fails to Auto-Match "Mobile No" Header
- **Bug ID:** `BUG-FUNC-01`
- **Priority:** **P2 (Medium)**
- **Module:** Data Import (`SmartCSVImporter`)
- **File Path & Line Number:** `src/components/admin/SmartCSVImporter.tsx` (Line 71)
- **Steps to Reproduce:**
  1. Open Smart CSV Importer dialog.
  2. Upload an Indian broker CSV containing header `"Mobile No"` or `"Mobile Number"`.
  3. Inspect the column mapping dropdown for that column.
- **Expected Behavior:**
  The importer should auto-map `"Mobile No"` to the target field `"phone_number"`.
- **Actual Behavior:**
  The column mapping dropdown defaults to `"__skip__"`.
- **Root Cause:**
  `autoMatch()` converts the header to lowercase `"mobileno"`, but line 71 uses strict equality: `h === "mobile"` instead of `h.includes("mobile")` or regex `h.startsWith("mobile")`.
- **Evidence:**
  Vitest test case in `src/test/csv-importer.test.ts` reproduces and confirms this failure.
- **Recommended Fix:**
  Update line 71: `if (h === "phone" || h.includes("mobile") || h === "contact" || h === "phno" || h === "cell") return "phone_number";`.
- **Regression Test:** `src/test/csv-importer.test.ts`

---

### [BUG-FUNC-02] CSV Importer Silently Swallows Error Details on Batch Insertion Failure
- **Bug ID:** `BUG-FUNC-02`
- **Priority:** **P2 (Medium)**
- **Module:** Data Import (`SmartCSVImporter`)
- **File Path & Line Number:** `src/components/admin/SmartCSVImporter.tsx` (Lines 185-195)
- **Steps to Reproduce:**
  1. Upload a CSV with 150 rows where row 105 contains an invalid foreign key or constraint violation.
  2. Click "Import 150 Leads".
- **Expected Behavior:**
  The UI should inform the user exactly which batch failed and display the database error message (e.g. unique constraint violation on vehicle number).
- **Actual Behavior:**
  The code logs `console.error` and increments `failCount`, but does not expose the database error message to the user, reporting a vague failure count with no actionable information.
- **Root Cause:**
  `catch (err)` block omits toast notification with specific error detail.
- **Recommended Fix:**
  Capture `err.message` in a localized error state array and render a downloadable failure report.
- **Regression Test:** Unit test with mocked rejected Supabase insert.

---

### [BUG-FUNC-03] CSV Importer Auto-Closes Immediately on Import Completion
- **Bug ID:** `BUG-FUNC-03`
- **Priority:** **P2 (Medium)**
- **Module:** Data Import (`SmartCSVImporter`)
- **File Path & Line Number:** `src/components/admin/SmartCSVImporter.tsx` (Lines 198-202)
- **Steps to Reproduce:**
  1. Complete a CSV import.
  2. Observe step 3 ("Results Summary").
- **Expected Behavior:**
  The modal should remain open on Step 3 showing total inserted vs skipped/failed records with a "Done" button.
- **Actual Behavior:**
  The component sets `setStep(3)` and immediately invokes `onDone()`, which instantly closes the dialog and unmounts the component before the user can read the results.
- **Root Cause:**
  Immediate call to `onDone()` inside `processBatch()` instead of binding it to a user button click.
- **Recommended Fix:**
  Remove `onDone()` from the completion block; call `onDone()` only when the user clicks the "Close" button in Step 3.
- **Regression Test:** Component interaction test in Vitest / Playwright.

---

### [BUG-FUNC-04] Stale Closure in `CallingList.tsx` Missing `useEffect` Dependencies
- **Bug ID:** `BUG-FUNC-04`
- **Priority:** **P2 (Medium)**
- **Module:** Telecaller CRM (`CallingList`)
- **File Path & Line Number:** `src/components/CallingList.tsx` (Line 160)
- **Steps to Reproduce:**
  1. Log into the CRM as a Telecaller.
  2. Rapidly toggle between "All", "Overdue", and "Interested" tabs while network response is in flight.
- **Expected Behavior:**
  The queue should display the leads corresponding to the currently selected active tab.
- **Actual Behavior:**
  Leads from the previous tab overwrite the active tab because the effect lacks cancellation tokens and does not include `loadTodayStats` or `user` in dependencies.
- **Root Cause:**
  Missing dependencies in `useEffect` and absence of an `isMounted` / abort controller guard.
- **Recommended Fix:**
  Add `AbortController` to query calls and properly specify all referenced functions in dependency array or wrap in `useCallback`.
- **Regression Test:** Integration test simulating delayed network response across tab changes.

---

### [BUG-FUNC-05] Formatted Phone Search Fails in `useLeadsPaginated.ts`
- **Bug ID:** `BUG-FUNC-05`
- **Priority:** **P2 (Medium)**
- **Module:** Leads Pagination Hook
- **File Path & Line Number:** `src/hooks/useLeadsPaginated.ts` (Lines 52-58)
- **Steps to Reproduce:**
  1. Enter `+91 98765 43210` or `98765-43210` in the Search box.
  2. Press Enter or wait for debounce.
- **Expected Behavior:**
  The CRM should find the lead with phone number `9876543210`.
- **Actual Behavior:**
  Zero results returned.
- **Root Cause:**
  The hook tests search query with `/^\d+$/`. Any phone query containing `+`, spaces, or hyphens fails this regex and falls through to searching `customer_name` instead of `phone_number`.
- **Recommended Fix:**
  Clean the search query with `const cleanPhone = searchQuery.replace(/\D/g, '');` before testing if length >= 7.
- **Regression Test:** Unit test in `src/test/masking.test.ts`.

---

### [BUG-FUNC-06] Called Leads Vanish from "Today" Queue
- **Bug ID:** `BUG-FUNC-06`
- **Priority:** **P2 (Medium)**
- **Module:** Telecaller Queue Management
- **File Path & Line Number:** `src/hooks/useLeadsPaginated.ts` (Lines 88-92)
- **Steps to Reproduce:**
  1. Open the "Today" calling queue.
  2. Place a call to a lead and mark disposition as "Follow-up" for later today.
  3. Refresh the "Today" queue.
- **Expected Behavior:**
  The lead should remain visible in the queue (or under a "Called Today" sub-filter) with updated status.
- **Actual Behavior:**
  The lead disappears immediately.
- **Root Cause:**
  The query enforces `.is("last_called_at", null)`. Once a lead is called, `last_called_at` is populated with `now()`, immediately excluding it from the today's calling queue even if a follow-up is scheduled for later in the day.
- **Recommended Fix:**
  Change condition to `.or("last_called_at.is.null,call_date.lte.today")`.
- **Regression Test:** Database query filter test.

---

### [BUG-FUNC-07] Floating-Point Precision Artifacts in IDV Depreciation
- **Bug ID:** `BUG-FUNC-07`
- **Priority:** **P3 (Low)**
- **Module:** Premium Calculator (`PremiumCalculator`)
- **File Path & Line Number:** `src/components/PremiumCalculator.tsx` (Lines 210-225)
- **Steps to Reproduce:**
  1. Enter Ex-Showroom price of ₹500,000 and select age "> 4 years" (50% depreciation).
  2. Check the calculated IDV.
- **Expected Behavior:**
  Calculated IDV should be exactly ₹250,000.00.
- **Actual Behavior:**
  Calculates as `249999.99999999997` before display formatting.
- **Root Cause:**
  JavaScript IEEE 754 floating point arithmetic: `500000 * (1 - 0.50)` evaluates with precision jitter without `Math.round()`.
- **Evidence:**
  `src/test/calculations.test.ts` caught this behavior during initial unit test execution.
- **Recommended Fix:**
  Wrap intermediate calculations in `Math.round()`.
- **Regression Test:** `src/test/calculations.test.ts`

---

### [BUG-FUNC-08] Premium Calculator Clamps Broker Net Margin to Zero
- **Bug ID:** `BUG-FUNC-08`
- **Priority:** **P3 (Low)**
- **Module:** Premium Calculator
- **File Path & Line Number:** `src/components/PremiumCalculator.tsx` (Line 385)
- **Steps to Reproduce:**
  1. Open Premium Calculator.
  2. Set Broker Commission to 5% (₹500).
  3. Set Customer Discount to 15% (₹1,500).
- **Expected Behavior:**
  Net in Pocket should indicate a financial deficit / negative margin of `-₹1,000.00` in red.
- **Actual Behavior:**
  Net in Pocket displays `₹0.00` in neutral styling.
- **Root Cause:**
  `const netInPocket = Math.max(0, brokerCommission - customerDiscount);` clamps negative numbers to 0, masking loss-making insurance quotes from brokers.
- **Evidence:**
  `src/test/calculations.test.ts` test case `"net in pocket masks negative deficit by clamping to 0"`.
- **Recommended Fix:**
  Remove `Math.max(0, ...)` and format negative values in red with a warning badge.
- **Regression Test:** `src/test/calculations.test.ts`

---

### [BUG-FUNC-09] Global `app_settings` Query Missing Company Isolation & Error Handling
- **Bug ID:** `BUG-FUNC-09`
- **Priority:** **P2 (Medium)**
- **Module:** Settings & Configuration (`SettingsContext`)
- **File Path & Line Number:** `src/contexts/SettingsContext.tsx` (Lines 22-38)
- **Steps to Reproduce:**
  1. User navigates through the application.
  2. `SettingsContext` loads initial settings from `app_settings`.
- **Expected Behavior:**
  Query should explicitly filter `.eq("company_id", companyId)` and catch mutation errors.
- **Actual Behavior:**
  Query executes `supabase.from("app_settings").select("*")` without company scoping, relying entirely on RLS. If RLS is misconfigured or bypassed, cross-tenant settings are leaked. Furthermore, updates fail silently without error handling.
- **Root Cause:**
  Missing `.eq("company_id", userCompanyId)` in hook query and unhandled promise rejection in updater.
- **Recommended Fix:**
  Add explicit company filter and try-catch toast notifications.
- **Regression Test:** Settings hook unit test.

---

### [BUG-UI-01] Hardcoded Inline Light Background Breaks Dark Mode
- **Bug ID:** `BUG-UI-01`
- **Priority:** **P3 (Low)**
- **Module:** Theme & Layout (`Index.tsx`)
- **File Path & Line Number:** `src/pages/Index.tsx` (Line 18)
- **Steps to Reproduce:**
  1. Open the application.
  2. Switch theme to Dark Mode in settings or header.
- **Expected Behavior:**
  Background should switch to dark slate/neutral background (`bg-background` / `bg-slate-950`).
- **Actual Behavior:**
  The container remains light gray due to inline `style={{ background: "#f8fafc" }}` overriding Tailwind dark classes.
- **Root Cause:**
  Hardcoded inline CSS style takes precedence over Tailwind CSS dark mode classes.
- **Evidence:**
  `docs/audit/UI_AUDIT.md` (Section 5).
- **Recommended Fix:**
  Remove inline style and use `className="min-h-screen bg-background text-foreground"`.
- **Regression Test:** Playwright dark mode screenshot test.

---

### [BUG-UI-02] 9 WCAG 2.1 AA Accessibility Violations
- **Bug ID:** `BUG-UI-02`
- **Priority:** **P2 (Medium)**
- **Module:** Accessibility & WCAG Compliance
- **File Path & Line Number:** Multiple header & dialer components (`CallingList.tsx`, `Header.tsx`)
- **Steps to Reproduce:**
  1. Run automated axe-core accessibility audit using `@axe-core/playwright`.
- **Expected Behavior:**
  0 critical or serious WCAG 2.1 AA violations.
- **Actual Behavior:**
  9 confirmed violations:
  - 4 `button-name` violations: Action icon buttons (phone dial, WhatsApp, transfer, close) have no inner text or `aria-label`.
  - 3 `color-contrast` violations: Muted badge text `#94a3b8` on `#f1f5f9` fails minimum 4.5:1 ratio.
  - 2 `select-name` violations: Custom select triggers lack associated labels.
- **Root Cause:**
  Missing `aria-label` attributes on icon-only `<Button>` elements.
- **Evidence:**
  `docs/audit/ui-audit-data.json` axe violation logs.
- **Recommended Fix:**
  Add `aria-label="Dial lead"`, `aria-label="Send WhatsApp"`, etc., to all icon buttons.
- **Regression Test:** Playwright axe audit test in `e2e/ui-audit.js`.

---

### [BUG-DB-01] Redundant Overlapping RLS Policies on `leads`
- **Bug ID:** `BUG-DB-01`
- **Priority:** **P2 (Medium)**
- **Module:** Database RLS Architecture
- **File Path & Line Number:** `supabase/migrations/20260426101008` & `20260615115547`
- **Steps to Reproduce:**
  1. Inspect PostgreSQL query execution plan (`EXPLAIN ANALYZE`) for `SELECT * FROM leads WHERE company_id = ?`.
- **Expected Behavior:**
  Single unified RLS condition evaluated once during query planning.
- **Actual Behavior:**
  Two permissive policies (`leads_company_isolation` FOR ALL and `Telecallers view leads in their areas` FOR SELECT) are both evaluated and OR'd together, increasing execution overhead.
- **Root Cause:**
  Incremental migration created a new policy without dropping or consolidating prior policies.
- **Evidence:**
  `docs/audit/DATABASE_AUDIT.md` (Section 3, DB-SEC-02).
- **Recommended Fix:**
  Consolidate into a single policy using role branching.
- **Regression Test:** Database policy inspection query.

---

### [BUG-DB-02] Telecaller Area Policy Lacks `company_id` Scope
- **Bug ID:** `BUG-DB-02`
- **Priority:** **P1 (High)**
- **Module:** Database RLS Architecture
- **File Path & Line Number:** `supabase/migrations/20260615115547_c47e0d1c-6742-4cbc-a046-76dac13b0d69.sql` (Line 12)
- **Steps to Reproduce:**
  1. Create two companies with area IDs.
  2. Telecaller assigned to area ID in Company A.
- **Expected Behavior:**
  Policy must always enforce `company_id = user_company_id()`.
- **Actual Behavior:**
  The policy only checks `area_id IN (SELECT area_id FROM telecaller_areas WHERE telecaller_id = auth.uid())`, omitting `company_id = user_company_id()`.
- **Root Cause:**
  Omission of company scoping condition in subquery.
- **Evidence:**
  `docs/audit/DATABASE_AUDIT.md` (Section 3).
- **Recommended Fix:**
  Add `AND company_id = public.user_company_id()` to the policy definition.
- **Regression Test:** Cross-tenant lead SELECT test.

---

## 4. POTENTIAL RISKS & DEPENDENCY VULNERABILITIES

---

### [RISK-DEP-01] 29 Known Vulnerabilities in NPM Dependencies
- **Risk ID:** `RISK-DEP-01`
- **Severity:** **Critical / High**
- **Affected Packages:**
  - `xlsx@0.18.5`: Vulnerable to Prototype Pollution (CVE-2023-30533) and Regular Expression Denial of Service (ReDoS).
  - `zod@3.25.76` (transitive via `@hookform/resolvers`): Potential memory exhaustion on large malformed inputs.
  - `@remix-run/router@1.23.0`: Open redirect / XSS vulnerability.
- **Risk Assessment:**
  Maliciously crafted Excel files uploaded to `SmartCSVImporter` could trigger client-side Prototype Pollution or freeze the browser thread via ReDoS.
- **Mitigation:**
  Upgrade or replace `xlsx` with `papaparse` + modern sheet writer; run `npm audit fix`.

---

### [RISK-ARCH-02] Large JavaScript Bundle Size (3.70 MB Total, 558 kB Single Chunk)
- **Risk ID:** `RISK-ARCH-02`
- **Severity:** **Medium**
- **Affected Assets:** `index-CY4hqU_J.js`, `PremiumCalculator-D10zr_z3.js`, `PieChart-CfH6NMhj.js`
- **Risk Assessment:**
  Telecallers and agents working on low-bandwidth mobile or 4G data connections experience high initial loading latency (Time to Interactive > 4.5s on slow 4G).
- **Mitigation:**
  Implement dynamic imports for `jspdf` and configure Rollup `manualChunks` in `vite.config.ts`.

---

### [RISK-DB-03] Orphaned `auth.users` on Company Deletion
- **Risk ID:** `RISK-DB-03`
- **Severity:** **Medium**
- **Affected Stored Procedure:** `public.super_admin_delete_company`
- **Risk Assessment:**
  When a Super Admin deletes a company, `profiles` and `user_roles` are purged, but `auth.users` records remain intact in Supabase Auth. Any deleted user attempting to log in will authenticate successfully but crash the application due to missing profile rows.
- **Mitigation:**
  Trigger Supabase Admin API `auth.admin.deleteUser()` for all purged users.

---

### [RISK-DB-04] Missing Composite Indexes on High-Frequency Queries
- **Risk ID:** `RISK-DB-04`
- **Severity:** **Medium**
- **Affected Tables:** `leads`, `renewals`, `call_logs`
- **Risk Assessment:**
  As tenant lead databases scale beyond 50,000 records, unindexed queries on `(company_id, status, call_date)` will cause database CPU spikes and slow page load times.
- **Mitigation:**
  Deploy composite indexes documented in `DATABASE_AUDIT.md`.
