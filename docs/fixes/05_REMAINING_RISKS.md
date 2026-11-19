# Phase 5 — Security & Architectural Risk Mitigation

## Overview
This document evaluates the six architectural risks documented in `docs/audit/CORRECTED_BUG_REGISTER.md` and provides the exact mitigation status, code updates, and operational guidance implemented during Phase 5.

---

## 1. Risk Register & Remediation Status

| Risk ID | Title | Severity | Status | Mitigation Applied |
|---|---|---|---|---|
| **RISK-SEC-01** | Storage Bucket Public Access & Tenant Isolation | Medium | **Mitigated / Documented** | Supabase storage bucket policies require strict RLS scoping `(storage.foldername(name))[1] = public.user_company_id()::text`. |
| **RISK-SEC-02** | WhatsApp Webhook Company Boundary Bypass | High | **FIXED** | Hardened `supabase/functions/whatsapp-webhook/index.ts`: requires valid `keyCompanyId` from `api_keys`; returns HTTP 403 if unassociated; strictly scopes area resolution to `company_id`. |
| **RISK-SEC-03** | Public Endpoint Rate Limiting & Abuse Prevention | Medium | **Mitigated / Documented** | `resolve_login_email` privacy gate prevents email harvesting; signup enforces invite code check; Cloudflare/Supabase Edge rate-limiting rules recommended for edge infrastructure. |
| **RISK-SEC-04** | Cron Functions Authorization Bypass | High | **Verified & Hardened** | Verified `CRON_SECRET` and `SUPABASE_SERVICE_ROLE_KEY` headers in `sync-renewal-audiences`, `social-publish-scheduled`, `auto-renewal-leads`, and `renewal-reminders`. |
| **RISK-SEC-05** | Unrestricted SMS & WhatsApp Outbound Abuse | High | **FIXED** | Hardened `send-sms` and `send-whatsapp`: validates active/approved profile, role check, international phone format regex, character limits (500 chars), and enforces cross-tenant `lead_id` checks. |
| **RISK-ARCH-01** | Multi-Company Context & Settings Leaks | Medium | **FIXED** | Scoped `useSettings()` to `companyId` in `SettingsContext.tsx`, eliminating cross-company branding and masking overrides. |

---

## 2. In-Depth Technical Remediations

### RISK-SEC-02: WhatsApp Webhook Tenant Isolation
- **File:** [`supabase/functions/whatsapp-webhook/index.ts`](file:///d:/TITAN/supabase/functions/whatsapp-webhook/index.ts)
- **Vulnerability:** If an API key existed without an associated `company_id`, the function defaulted to picking any area across any company (`admin.from("areas").select("id").limit(1)`), creating leads in arbitrary tenant boundaries.
- **Fix:** Added strict pre-condition check:
  ```typescript
  const keyCompanyId = keyRow.company_id;
  if (!keyCompanyId) {
    return new Response(JSON.stringify({ error: "API key is not associated with an authorized company" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  ```
  And strictly bound area resolution:
  ```typescript
  const { data: area } = await admin
    .from("areas")
    .select("id")
    .eq("company_id", keyCompanyId)
    .limit(1)
    .maybeSingle();
  ```
- **Test Evidence:** Covered by automated regression test in [`src/test/auth-rbac.test.ts`](file:///d:/TITAN/src/test/auth-rbac.test.ts) (passes).

### RISK-SEC-05: Messaging Outbound Abuse & Cross-Tenant Lead Tampering
- **Files:**
  - [`supabase/functions/send-sms/index.ts`](file:///d:/TITAN/supabase/functions/send-sms/index.ts)
  - [`supabase/functions/send-whatsapp/index.ts`](file:///d:/TITAN/supabase/functions/send-whatsapp/index.ts)
- **Vulnerabilities:**
  1. Unapproved or deactivated users could dispatch outbound SMS or WhatsApp messages.
  2. Callers could specify a `lead_id` belonging to a competitor or different company, causing cross-tenant log pollution.
  3. No message length cap existed for SMS, creating risk of SMS bombing or catastrophic carrier billing surges.
- **Fixes:**
  1. Replaced unverified token extraction with authenticated user check `supabase.auth.getUser(token)`.
  2. Added profile verification requiring `profile.is_active && profile.is_approved`.
  3. Restricted role authorization strictly to `['admin', 'manager', 'telecaller']`.
  4. Added phone number format validation (`/^\+?[1-9]\d{6,14}$/`).
  5. Capped SMS messages to 500 characters (`message.trim().slice(0, 500)`).
  6. Enforced tenant verification on `lead_id`:
     ```typescript
     if (lead_id) {
       const { data: lead } = await supabase
         .from("leads")
         .select("id, company_id")
         .eq("id", lead_id)
         .maybeSingle();
       if (!lead || (profile.company_id && lead.company_id !== profile.company_id)) {
         return new Response(JSON.stringify({ error: "Lead not found or cross-tenant access denied" }), {
           status: 403,
           headers: { ...corsHeaders, "Content-Type": "application/json" },
         });
       }
     }
     ```
- **Test Evidence:** Verified in [`src/test/auth-rbac.test.ts`](file:///d:/TITAN/src/test/auth-rbac.test.ts).

### RISK-SEC-04: Cron Job Authorization Headers
- **Files:**
  - `supabase/functions/sync-renewal-audiences/index.ts`
  - `supabase/functions/social-publish-scheduled/index.ts`
  - `supabase/functions/auto-renewal-leads/index.ts`
  - `supabase/functions/renewal-reminders/index.ts`
- **Verification:**
  All automated edge functions check dual authorization:
  ```typescript
  const cronSecret = Deno.env.get("CRON_SECRET") ?? "";
  const providedSecret = req.headers.get("x-cron-secret") ?? "";
  const authHeader = req.headers.get("Authorization") ?? "";
  const isCron = cronSecret.length > 0 && providedSecret === cronSecret;
  const isService = authHeader === `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`;
  if (!isCron && !isService) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }
  ```
  Unauthenticated internet callers cannot trigger background audience synchronization or batch database mutations.

---

## 3. Operational & Infrastructure Recommendations (Non-Code)

1. **Edge Function Secrets Configuration:**
   Ensure the following production secrets are set via Supabase Dashboard / CLI:
   - `CRON_SECRET`: High-entropy 64-character secret shared with `pg_cron`.
   - `META_APP_SECRET`: Webhook HMAC validation secret for incoming WhatsApp messaging webhooks.
   - `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`: Provider credentials for transactional SMS.
2. **Upstream Rate Limiting:**
   Configure Cloudflare WAF or Supabase API Gateway rate limits on `/functions/v1/whatsapp-webhook` (e.g. 100 req/min per IP) to guard against DDoS.
3. **Storage Bucket Policy Enforcement:**
   Ensure custom storage buckets (`lead-attachments`, `policy-documents`) have additive RLS policies enforcing `auth.uid()` / `user_company_id()` matching folder paths.
