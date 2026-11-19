# TITAN Insurance CRM — Security Architecture & Vulnerability Audit

**Audit Date:** November 2026  
**Auditor:** Principal Supabase Security Auditor & DevSecOps Architect  
**Classification:** HIGH RISK  
**Scope:** PostgreSQL RLS Policies, Edge Functions, Authentication & Authorization, Tenant Data Isolation, API Secrets & Cryptography, PII Exposure.

---

## 1. Executive Summary & Threat Model

A security analysis of the TITAN Insurance CRM platform revealed several high-impact vulnerabilities spanning privilege escalation, cross-tenant data modification (IDOR), unauthenticated PII enumeration, and client-side-only data protection.

Because TITAN operates as a multi-tenant platform housing sensitive financial records, vehicle registration certificates, and customer health profiles, cross-tenant boundary integrity is paramount.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          SECURITY AUDIT SUMMARY                             │
├────────────────────┬──────────┬──────────────┬──────────────────────────────┤
│ Severity           │ Count    │ Status       │ Primary Threat Category      │
├────────────────────┼──────────┼──────────────┼──────────────────────────────┤
│ P0 (Critical)      │ 2        │ CONFIRMED    │ Privilege Escalation & IDOR  │
│ P1 (High)          │ 3        │ CONFIRMED    │ PII Harvesting & Data Leak   │
│ P2 (Medium)        │ 4        │ CONFIRMED    │ Secrets & Abuse Vectors      │
│ P3 (Low)           │ 2        │ CONFIRMED    │ Predictable Passwords & Hash │
└────────────────────┴──────────┴──────────────┴──────────────────────────────┘
```

---

## 2. Vulnerability Register (Ranked by Severity)

### SEC-01: Critical Privilege Escalation via User Signup Metadata
- **Severity:** P0 (Critical) | **CVSS 3.1:** 9.8 (`CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H`)
- **Module:** Authentication & Multi-Tenancy
- **Location:** `supabase/migrations/20260610194138_c57becab-bc0c-4621-984e-7d1f73b72184.sql` Lines 254–275 & `20260613182037_bb20fa79-a7ee-4f03-896a-37596161ce8b.sql` Lines 24–68
- **Threat Vector:** Remote unauthenticated attacker joining an existing enterprise tenant.

#### Vulnerability Description
In Supabase, `auth.users` raw metadata can be freely supplied by any client during `supabase.auth.signUp({ options: { data: { ... } } })`.
In `handle_new_user()`, the trigger extracts `requested_role` from user metadata:
```sql
_req := NEW.raw_user_meta_data->>'requested_role';
_safe_role := CASE WHEN _req IN ('telecaller','manager') THEN _req ELSE 'telecaller' END::app_role;
```
And immediately inserts the role row into `user_roles`:
```sql
INSERT INTO public.user_roles (user_id, role)
VALUES (NEW.id, _safe_role)
ON CONFLICT DO NOTHING;
```
Additionally, `is_approved` is hardcoded to `true`:
```sql
INSERT INTO public.profiles (id, ..., is_approved, is_active, company_id, ...)
VALUES (NEW.id, ..., true, true, _company_id, ...);
```

#### Exploitation Scenario
1. An attacker obtains an existing company's code (e.g., `"ROCKET"` or `"TITAN"`), which is easily discoverable via the public `lookup_company_by_code` RPC.
2. The attacker calls `supabase.auth.signUp({ email, password, options: { data: { company_code: 'ROCKET', requested_role: 'manager' } } })`.
3. The database trigger executes with `SECURITY DEFINER` privileges.
4. The user is instantly provisioned as an active, approved **Manager** of the victim company without any existing Admin approving the request.
5. The attacker accesses `/manager`, viewing subordinate employee performance, customer names, policy counts, and team quotas.

#### Remediation
1. New signups joining an existing company must default to `is_approved = false` and `requested_role = NULL`.
2. Roles must **NEVER** be inserted into `public.user_roles` based on client-provided metadata. Only an authenticated company Admin or Super Admin using the `team-admin` Edge Function may insert into `user_roles`.
3. Route guards (`ProtectedRoute.tsx`) must strictly check `profileStatus.is_approved === true`.

---

### SEC-02: Cross-Tenant Insecure Direct Object Reference (IDOR) in Payment Link Generation
- **Severity:** P0 (Critical) | **CVSS 3.1:** 8.6 (`CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:C/C:N/I:H/A:N`)
- **Module:** Motor Quotation & Payment Gateway
- **Location:** `supabase/functions/generate-payment-link/index.ts` Lines 22–68
- **Threat Vector:** Low-privilege authenticated user from Tenant A mutating records in Tenant B.

#### Vulnerability Description
The `generate-payment-link` edge function authenticates the caller with `supabase.auth.getUser()`, but fails to enforce tenant isolation:
```ts
const { motor_quote_id } = await req.json();

// Queries quote across entire database using service role (bypasses RLS)
const { data: quote } = await supabase
  .from("motor_quotes").select("*").eq("id", motor_quote_id).maybeSingle();

// Directly overwrites quote and associated lead in another company!
await supabase.from("motor_quotes").update({
  payment_link: paymentUrl,
  status: "payment_sent",
}).eq("id", motor_quote_id);

if (quote.lead_id) {
  await supabase.from("leads").update({
    payment_link: paymentUrl, status: "Quote Sent",
  }).eq("id", quote.lead_id);
}
```

#### Exploitation Scenario
1. Attacker signs up with their own trial account (Company A).
2. Attacker obtains or enumerates a `motor_quote_id` belonging to a rival broker (Company B).
3. Attacker sends a POST request to `/functions/v1/generate-payment-link` with their valid Company A JWT and Company B's `motor_quote_id`.
4. The service-role client modifies Company B's quote status and lead status to `"Quote Sent"`, corrupting Company B's sales pipeline and CRM records.

#### Remediation
Validate that the quote belongs to the caller's company before performing any updates:
```ts
const callerCompanyId = (await supabase.from("profiles").select("company_id").eq("id", userData.user.id).single()).data?.company_id;

const { data: quote } = await supabase
  .from("motor_quotes")
  .select("*")
  .eq("id", motor_quote_id)
  .eq("company_id", callerCompanyId)
  .maybeSingle();

if (!quote) return json({ error: "Quote not found or unauthorized" }, 404);
```

---

### SEC-03: Unauthenticated PII Harvesting & User Enumeration via Public RPC
- **Severity:** P1 (High) | **CVSS 3.1:** 7.5 (`CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N`)
- **Module:** Public Authentication Helper
- **Location:** `supabase/migrations/20260616033648_b6a6f1f7-4beb-474d-b5f1-abf9a39ae748.sql` Lines 85–107
- **Threat Vector:** Unauthenticated Internet bot / scraper.

#### Vulnerability Description
To support mobile-number-based login, a public PostgreSQL RPC `resolve_login_email` was created and granted to `anon`:
```sql
CREATE OR REPLACE FUNCTION public.resolve_login_email(_login text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
...
  SELECT id INTO _uid FROM public.profiles WHERE mobile = _digits LIMIT 1;
  SELECT email INTO _email FROM auth.users WHERE id = _uid LIMIT 1;
  RETURN _email;
$$;
GRANT EXECUTE ON FUNCTION public.resolve_login_email(text) TO anon, authenticated;
```

#### Exploitation Scenario
1. An attacker iterates through mobile number ranges (e.g. `9826000000` to `9826099999`) using a simple script calling:
   ```bash
   curl -X POST 'https://<project>.supabase.co/rest/v1/rpc/resolve_login_email' \
     -H 'apikey: <anon_key>' \
     -H 'Content-Type: application/json' \
     -d '{"_login": "9826012345"}'
   ```
2. For every registered customer or staff member, the RPC returns their real email address from `auth.users`.
3. Attacker builds a clean target list of confirmed phone numbers and email addresses for spear-phishing or credential stuffing.

#### Remediation
1. Revoke public execution of `resolve_login_email`:
   ```sql
   REVOKE EXECUTE ON FUNCTION public.resolve_login_email(text) FROM anon;
   ```
2. Move mobile-to-email resolution into a secure, rate-limited Edge Function with CAPTCHA or IP throttling.

---

### SEC-04: Client-Side-Only PII Masking
- **Severity:** P1 (High) | **CVSS 3.1:** 6.5 (`CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:N/A:N`)
- **Module:** Data Protection & Lead Security
- **Location:** `src/hooks/useMaskingPolicy.ts` Lines 14–28
- **Threat Vector:** Frontline telecaller or rogue staff member extracting unmasked customer contact databases.

#### Vulnerability Description
The application claims to provide phone number masking ("XXXXXX 7946") for telecallers. However, inspection of `useMaskingPolicy.ts` and `CallingList.tsx` confirms that masking is performed **entirely in React client-side code**:
```ts
export const useMaskingPolicy = (): MaskingPolicy => {
  const { role } = useAuth();
  const { masking } = useSettings();
  ...
  return {
    display: (p) => policy.masked ? maskPhone(p) : formatPhone(p),
    full: (p) => formatPhone(p), // <-- Raw unmasked phone is always available
  };
};
```
The raw `phone_number` is fetched directly from Supabase via `select('id, customer_name, phone_number, ...')`.

#### Impact
Any frontline agent with browser DevTools can open the Network tab, inspect the Supabase PostgREST payload, or run in the console:
```js
console.table(window.__REACT_DEVTOOLS_GLOBAL_HOOK__...)
```
and exfiltrate the full unmasked phone numbers of thousands of customers.

#### Remediation
Implement PostgreSQL Dynamic Data Masking or provide telecallers with access via a database view (`telecaller_leads_view`) where `phone_number` is masked on the server using `mask_phone(phone_number)` unless a click-to-call API is dispatched.

---

### SEC-05: Missing Webhook Query Parameter Authentication & Null Tenant Fallback
- **Severity:** P1 (High) | **CVSS 3.1:** 7.3 (`CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:H/A:N`)
- **Module:** WhatsApp & Lead Webhook Receiver
- **Location:** `supabase/functions/whatsapp-webhook/index.ts` Lines 33–37 & 66–79
- **Threat Vector:** Webhook spoofing or lead injection into arbitrary company accounts.

#### Vulnerability Description
1. Documentation states `?api_key=xxx` can be passed in query string, but the code strictly checks `req.headers.get("x-api-key")`:
   ```ts
   const apiKey = req.headers.get("x-api-key");
   if (!apiKey) return new Response(..., { status: 401 });
   ```
   Webhooks sent with URL query parameters fail authentication.
2. In lines 66–79:
   ```ts
   let areaQuery = admin.from("areas").select("id").limit(1);
   if (keyCompanyId) areaQuery = areaQuery.eq("company_id", keyCompanyId);
   const { data: area } = await areaQuery.maybeSingle();
   ```
   If an API key row has a `null` `company_id` (e.g. system-level legacy key), `areaQuery` selects the first area in the database belonging to **any** company, and inserts incoming leads into Company B's pipeline.

---

### SEC-06: Plaintext Storage of OAuth Access Tokens
- **Severity:** P2 (Medium) | **CVSS 3.1:** 5.5 (`CVSS:3.1/AV:N/AC:L/PR:H/UI:N/S:U/C:H/I:N/A:N`)
- **Module:** Marketing Automation Integrations
- **Location:** `supabase/migrations/20260614182208_6f838cc7-3d27-44e9-ae99-6958105d5336.sql` Line 11
- **Threat Vector:** Database leak or compromise exposing social media account credentials.

#### Vulnerability Description
In `marketing_integrations`, long-lived access tokens for Facebook Pages, Instagram, and LinkedIn are stored as raw text (`access_token TEXT`).
If a database snapshot, backup CSV, or export is intercepted, third-party social accounts can be commandeered.

#### Remediation
Encrypt access tokens at rest using Supabase Vault (`vault.create_secret`) or pgcrypto (`pgp_sym_encrypt`).

---

### SEC-07: Unprotected Edge Function Cron Endpoints
- **Severity:** P2 (Medium) | **CVSS 3.1:** 5.3 (`CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:L/A:N`)
- **Module:** Scheduled Tasks (`sync-renewal-audiences`, `social-publish-scheduled`)
- **Location:** `supabase/config.toml` Lines 9–13 & Function Handlers Line 10
- **Threat Vector:** Denial of service or quota exhaustion.

#### Vulnerability Description
In `supabase/config.toml`:
```toml
[functions.sync-renewal-audiences]
verify_jwt = false

[functions.social-publish-scheduled]
verify_jwt = false
```
The functions attempt to authenticate via `x-cron-secret` matching `Deno.env.get("CRON_SECRET")`. However, if `CRON_SECRET` is unset in the environment, `cronSecret.length > 0` evaluates to `false`, effectively leaving authorization dependent on `SUPABASE_SERVICE_ROLE_KEY`. Any configuration drift where secrets are omitted exposes these endpoints to unauthorized execution.

---

### SEC-08: SMS Toll Fraud & Spam Abuse Vector
- **Severity:** P2 (Medium) | **CVSS 3.1:** 5.3 (`CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:N/A:L`)
- **Module:** SMS Communication
- **Location:** `supabase/functions/send-sms/index.ts` Lines 18–45
- **Threat Vector:** Compromised frontline telecaller credentials used to blast SMS.

#### Vulnerability Description
Any authenticated user with role `telecaller` can invoke `/functions/v1/send-sms` with arbitrary destination numbers and arbitrary message text.
The function lacks:
- Rate limiting (e.g. max 50 SMS/day per agent).
- Destination allowlist (e.g. only Indian +91 numbers).
- Template enforcement (telecallers can send arbitrary non-insurance messages or phishing links at company expense).

---

### SEC-09: Storage Bucket Access Control Gaps
- **Severity:** P2 (Medium) | **CVSS 3.1:** 4.3 (`CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:L/I:N/A:N`)
- **Module:** Supabase Storage
- **Location:** `supabase/migrations/20260613185709_4784b192-d9ef-4eb8-9653-17e886116ce8.sql`
- **Threat Vector:** Accessing attachments outside customer docs.

#### Vulnerability Description
Storage RLS policies were explicitly written for `bucket_id = 'customer-docs'`. If additional buckets (`claim-docs`, `rto-docs`, `marketing-assets`) are created without identical folder-level isolation policies (`(storage.foldername(name))[1] = user_company_id()::text`), cross-company document access may be possible.

---

### SEC-10: Predictable Default User Passwords
- **Severity:** P3 (Low) | **CVSS 3.1:** 3.8 (`CVSS:3.1/AV:N/AC:H/PR:L/UI:N/S:U/C:L/I:L/A:N`)
- **Module:** Team Administration
- **Location:** `supabase/functions/team-admin/index.ts` Lines 10–16
- **Threat Vector:** Insider guessing coworker credentials.

#### Vulnerability Description
`defaultPasswordFor` generates a deterministic password:
```ts
export const defaultPasswordFor = (name: string, mobile: string) => {
  const letters = (name || "").replace(/[^A-Za-z]/g, "");
  const head = (letters.slice(0, 4) || "user").padEnd(4, "x");
  const cap = head.charAt(0).toUpperCase() + head.slice(1).toLowerCase();
  const digits = (mobile || "").replace(/\D/g, "").slice(-4).padStart(4, "0");
  return `${cap}${digits}`;
};
```
For employee "Suresh Kumar" with phone ending in "4567", the password is always `"Sure4567"`. Anyone who knows the employee's name and mobile number can log in before the user changes their password.
