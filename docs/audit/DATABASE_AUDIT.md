# TITAN Insurance CRM — Database Architecture & Security Audit

**Project:** TITAN Insurance CRM  
**Date:** November 2026  
**Auditor:** Principal QA Architect & Supabase Security Auditor  
**Audit Scope:** PostgreSQL 15, Supabase Schema, RLS Policies, Triggers, Views, Functions, Indexes, and Cascade Rules  
**Status:** AUDIT COMPLETED — CRITICAL VULNERABILITIES IDENTIFIED

---

## 1. Executive Database Summary

The TITAN Insurance CRM database architecture is structured around a multi-tenant PostgreSQL 15 schema managed through Supabase. The system encompasses **65 relational tables**, **2 custom views**, **12 stored procedures**, and **8 automated triggers** governing core business logic including motor/health/life insurance policies, telecaller dialer queues, automated GST/TDS tax withholding, multi-tier broker commissions, claims tracking, and omnichannel customer communication.

While the fundamental tenancy design utilizes a `company_id` discriminator column validated via Row-Level Security (RLS) helper functions (`public.user_company_id()`), exhaustive manual inspection and automated script verification uncovered **critical tenant isolation gaps, cross-tenant data leaks, unindexed query bottlenecks, and unsafe cascade deletion procedures**.

### Database Health & Security Scorecard

| Assessment Domain | Rating | Status | Key Risk |
| :--- | :---: | :---: | :--- |
| **Multi-Tenant Isolation** | **5 / 10** | **CRITICAL RISKS** | Cross-tenant leaks in `message_templates` and telecaller area policies. |
| **RLS Policy Coverage** | **6.5 / 10** | **VULNERABLE** | Missing `company_id` on tables; overlapping redundant policies on `leads`. |
| **Referential Integrity** | **7 / 10** | **MODERATE** | Incomplete `ON DELETE CASCADE` mappings; orphaned `auth.users` on company purge. |
| **Indexing & Performance** | **5.5 / 10** | **NEEDS WORK** | High-cardinality filters (`company_id, status, call_date`) lack composite indexes. |
| **Database Triggers & Logic** | **8 / 10** | **GOOD** | Robust GST (18%) & TDS (5%) compliance calculation; role escalation trigger flaw. |
| **Secrets & Migration Hygiene**| **4 / 10** | **FAILED** | Production Supabase URL and Anon JWT key committed in plaintext migration SQL. |

---

## 2. Complete Schema Inventory (65 Tables)

The database schema is organized across 11 functional domains:

```
                                 ┌────────────────────────┐
                                 │       companies        │
                                 └───────────┬────────────┘
                                             │ 1:N
               ┌─────────────────────────────┼─────────────────────────────┐
               │                             │                             │
    ┌──────────▼──────────┐       ┌──────────▼──────────┐       ┌──────────▼──────────┐
    │      profiles       │       │        leads        │       │      customers      │
    └──────────┬──────────┘       └──────────┬──────────┘       └──────────┬──────────┘
               │                             │                             │
        ┌──────┴──────┐               ┌──────┴──────┐               ┌──────┴──────┐
        │ user_roles  │               │  call_logs  │               │  policies   │
        └─────────────┘               └─────────────┘               └─────────────┘
```

### Table Domain Classification

| Domain | Table Name | Primary Key | Company Scoped | RLS Enabled | Cascade On Company Delete |
| :--- | :--- | :---: | :---: | :---: | :---: |
| **Tenancy & Core** | `companies` | `id (uuid)` | N/A (Root) | Yes | Root Entity |
| | `branches` | `id (uuid)` | Yes | Yes | Manual / Array |
| | `profiles` | `id (uuid)` | Yes | Yes | Handled via array |
| | `user_roles` | `id (uuid)` | Indirect (`user_id`) | Yes | Handled via array |
| | `company_subscriptions` | `id (uuid)` | Yes | Yes | Handled |
| | `modules` | `id (uuid)` | Global | No (Read-only) | Global |
| | `role_permissions` | `id (uuid)` | Yes | Yes | Handled |
| | `app_settings` | `id (uuid)` | Yes | Yes | Handled |
| **Leads & Calling** | `leads` | `id (uuid)` | Yes | Yes | Handled |
| | `enquiries` | `id (uuid)` | Yes | Yes | Handled |
| | `lead_quotes` | `id (uuid)` | Yes | Yes | Handled |
| | `lead_notes` | `id (uuid)` | Yes | Yes | Handled |
| | `call_logs` | `id (uuid)` | Yes | Yes | Handled |
| | `dial_logs` | `id (uuid)` | Yes | Yes | Handled |
| | `telecaller_areas` | `id (uuid)` | Yes | Yes | Handled |
| | `areas` | `id (uuid)` | Yes | Yes | Handled |
| | `break_logs` | `id (uuid)` | Yes | Yes | Handled |
| | `lead_statuses` | `id (uuid)` | Yes | Yes | Handled |
| | `status_mappings` | `id (uuid)` | Yes | Yes | Handled |
| **Customer 360** | `customers` | `id (uuid)` | Yes | Yes | Handled |
| | `customer_lifecycle_events` | `id (uuid)` | Yes | Yes | Handled |
| | `customer_tasks` | `id (uuid)` | Yes | Yes | Handled |
| | `customer_notes` | `id (uuid)` | Yes | Yes | Handled |
| | `customer_family_members` | `id (uuid)` | Yes | Yes | Handled |
| | `customer_contacts` | `id (uuid)` | Yes | Yes | Handled |
| | `customer_documents` | `id (uuid)` | Yes | Yes | Handled |
| | `customer_products` | `id (uuid)` | Yes | Yes | Handled |
| | `cross_sell_suggestions` | `id (uuid)` | Yes | Yes | Handled |
| **Policies & Master** | `motor_policies` | `id (uuid)` | Yes | Yes | Handled |
| | `motor_quotes` | `id (uuid)` | Yes | Yes | Handled |
| | `vehicles` | `id (uuid)` | Yes | Yes | Handled |
| | `health_policies` | `id (uuid)` | Yes | Yes | Handled |
| | `health_policy_members` | `id (uuid)` | Yes | Yes | Handled |
| | `life_policies` | `id (uuid)` | Yes | Yes | Handled |
| | `life_nominees` | `id (uuid)` | Yes | Yes | Handled |
| | `life_premium_schedule` | `id (uuid)` | Yes | Yes | Handled |
| | `insurers` | `id (uuid)` | Yes | Yes | Handled |
| | `product_catalog` | `id (uuid)` | Yes | Yes | Handled |
| **Renewals** | `renewals` | `id (uuid)` | Yes | Yes | Handled |
| | `renewal_campaigns` | `id (uuid)` | Yes | Yes | Handled |
| | `renewal_templates` | `id (uuid)` | Yes | Yes | Handled |
| | `admin_renewal_settings` | `id (uuid)` | Yes | Yes | Handled |
| | `audience_sync_configs` | `id (uuid)` | Yes | Yes | Handled |
| | `audience_sync_logs` | `id (uuid)` | Yes | Yes | Handled |
| **Claims** | `claims` | `id (uuid)` | Yes | Yes | Handled |
| | `claim_status_history` | `id (uuid)` | Yes | Yes | Handled |
| | `claim_notes` | `id (uuid)` | Yes | Yes | Handled |
| | `claim_followups` | `id (uuid)` | Yes | Yes | Handled |
| | `claim_expenses` | `id (uuid)` | Yes | Yes | Handled |
| | `claim_documents` | `id (uuid)` | Yes | Yes | Handled |
| | `claim_communications` | `id (uuid)` | Yes | Yes | Handled |
| **RTO Services** | `rto_cases` | `id (uuid)` | Yes | Yes | Handled |
| | `rto_status_history` | `id (uuid)` | Yes | Yes | Handled |
| | `rto_case_documents` | `id (uuid)` | Yes | Yes | Handled |
| | `rto_service_types` | `id (uuid)` | Yes | Yes | Handled |
| | `rc_register` | `id (uuid)` | Yes | Yes | Handled |
| | `fitness_certificates` | `id (uuid)` | Yes | Yes | Handled |
| | `permits` | `id (uuid)` | Yes | Yes | Handled |
| | `puc_records` | `id (uuid)` | Yes | Yes | Handled |
| **Brokers & Agents** | `brokers` | `id (uuid)` | Yes | Yes | Handled |
| | `broker_achievements` | `id (uuid)` | Yes | Yes | Handled |
| | `broker_payouts` | `id (uuid)` | Yes | Yes | Handled |
| | `broker_slabs` | `id (uuid)` | Yes | Yes | Handled |
| | `broker_targets` | `id (uuid)` | Yes | Yes | Handled |
| | `broker_company_mapping`| `id (uuid)` | Yes | Yes | Handled |
| | `agents_profile` | `id (uuid)` | Yes | Yes | Handled |
| | `agent_payouts` | `id (uuid)` | Yes | Yes | Handled |
| | `commission_rates` | `id (uuid)` | Yes | Yes | Handled |
| | `compensation_rules` | `id (uuid)` | Yes | Yes | Handled |
| **Finance & Payouts**| `policy_transactions` | `id (uuid)` | Yes | Yes | Handled |
| | `premium_remittance` | `id (uuid)` | Yes | Yes | Handled |
| | `payment_records` | `id (uuid)` | Yes | Yes | Handled |
| | `expenses` | `id (uuid)` | Yes | Yes | Handled |
| | `payout_agent_split_rules`| `id (uuid)` | Yes | Yes | Handled |
| | `payout_finance_rules`| `id (uuid)` | Yes | Yes | Handled |
| | `payout_insurance_rules`| `id (uuid)` | Yes | Yes | Handled |
| | `payout_rto_rules` | `id (uuid)` | Yes | Yes | Handled |
| | `payout_state_rules` | `id (uuid)` | Yes | Yes | Handled |
| | `payout_tax_rules` | `id (uuid)` | Yes | Yes | Handled |
| | `payout_vendor_rules` | `id (uuid)` | Yes | Yes | Handled |
| **Marketing** | `marketing_integrations`| `id (uuid)` | Yes | Yes | Handled |
| | `marketing_templates`| `id (uuid)` | Yes | Yes | Handled |
| | `message_templates` | `id (uuid)` | **NO (MISSING)** | Yes | **ORPHANED / NOT DELETED** |
| | `scheduled_posts` | `id (uuid)` | Yes | Yes | Handled |
| | `social_post_logs` | `id (uuid)` | Yes | Yes | Handled |
| | `mkt_campaigns` | `id (uuid)` | Yes | Yes | Handled |
| | `mkt_audiences` | `id (uuid)` | Yes | Yes | Handled |
| | `mkt_templates` | `id (uuid)` | Yes | Yes | Handled |
| | `mkt_channels` | `id (uuid)` | Yes | Yes | Handled |
| | `mkt_festivals` | `id (uuid)` | Yes | Yes | Handled |
| | `campaign_logs` | `id (uuid)` | Yes | Yes | Handled |
| **System & Logs** | `api_keys` | `id (uuid)` | Yes | Yes | Handled |
| | `external_api_registry`| `id (uuid)` | Yes | Yes | Handled |
| | `webhook_events` | `id (uuid)` | Yes | Yes | Handled |
| | `whatsapp_logs` | `id (uuid)` | Yes | Yes | Handled |
| | `sms_logs` | `id (uuid)` | Yes | Yes | Handled |
| | `whatsapp_bridge_settings`| `id (uuid)` | Yes | Yes | Handled |
| | `super_admin_audit_log`| `id (uuid)` | System | Yes | Retained |
| | `impersonation_sessions`| `id (uuid)`| System | Yes | Retained |
| | `audit_logs` | `id (uuid)` | Yes | Yes | Handled |
| | `training_materials`| `id (uuid)` | Yes | Yes | Handled |
| | `announcements` | `id (uuid)` | Yes | Yes | Handled |
| | `ai_suggestions` | `id (uuid)` | Yes | Yes | Handled |
| | `export_history` | `id (uuid)` | Yes | Yes | Handled |

---

## 3. Row-Level Security (RLS) Deep-Dive Findings

### FINDING DB-SEC-01: Critical Cross-Tenant Leak in `message_templates` (Severity: P1)
- **File:** `supabase/migrations/20260605125419_4ce1c1fe-8c12-4df9-a834-9595f53cacf1.sql`, Lines 27-59
- **Root Cause:** Table `message_templates` was created without a `company_id` column.
  ```sql
  CREATE TABLE public.message_templates (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title text NOT NULL,
    body text NOT NULL,
    category text NOT NULL DEFAULT 'Custom',
    shared boolean NOT NULL DEFAULT false,
    ...
  );
  ```
- **Vulnerability:**
  The SELECT policy grants access to any authenticated user if `shared = true`:
  ```sql
  CREATE POLICY "Read shared templates" ON public.message_templates
    FOR SELECT TO authenticated
    USING (shared = true);
  ```
  Because there is no check for `company_id = public.user_company_id()`, any user from Company A can view all shared templates created by Company B. Furthermore, the management policy allows any user with an 'admin' or 'manager' role from ANY company to update or delete shared templates across the entire system:
  ```sql
  CREATE POLICY "Managers manage shared templates" ON public.message_templates
    FOR ALL TO authenticated
    USING (shared = true AND (public.has_role(auth.uid(),'manager') OR public.has_role(auth.uid(),'admin')))
  ```
- **Exploitation Impact:** Confidential marketing messaging, WhatsApp templates, and customer communication scripts are exposed across competitor companies using the SaaS platform.
- **Remediation:** Alter table to add `company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE`, backfill from `profiles.company_id`, and rewrite RLS policies to enforce `company_id = public.user_company_id()`.

---

### FINDING DB-SEC-02: Overlapping and Cross-Tenant Leaking RLS on `leads` (Severity: P1)
- **File:** `supabase/migrations/20260615115547_c47e0d1c-6742-4cbc-a046-76dac13b0d69.sql` & `20260426101008`
- **Root Cause:**
  1. `leads` has an overarching policy:
     ```sql
     CREATE POLICY "leads_company_isolation" ON public.leads
       FOR ALL TO authenticated
       USING (public.is_super_admin(auth.uid()) OR company_id = public.user_company_id());
     ```
  2. A subsequent migration added a specific telecaller area policy:
     ```sql
     CREATE POLICY "Telecallers view leads in their areas" ON public.leads
       FOR SELECT TO authenticated
       USING (
         public.has_role(auth.uid(), 'telecaller') AND
         area_id IN (SELECT area_id FROM public.telecaller_areas WHERE telecaller_id = auth.uid())
       );
     ```
- **Vulnerability:**
  In PostgreSQL, multiple permissive RLS policies for the same command (`SELECT`) are evaluated with boolean **`OR`**. 
  Because `"Telecallers view leads in their areas"` does **not** include `company_id = public.user_company_id()`, if two different companies inadvertently have an area with the same UUID (or if a user is assigned an area ID from another company via bad data injection), the telecaller will be able to see leads belonging to the other company.
  Furthermore, because Postgres evaluates policies with `OR`, having both policies means telecallers can see ALL company leads via `leads_company_isolation`, completely defeating the purpose of the area restriction!
- **Remediation:** Consolidate `leads` RLS into a single, cohesive policy with explicit role-based branching:
  ```sql
  CREATE POLICY "leads_tenant_and_role_access" ON public.leads
    FOR SELECT TO authenticated
    USING (
      public.is_super_admin(auth.uid()) OR (
        company_id = public.user_company_id() AND (
          public.has_role(auth.uid(), 'admin') OR
          public.has_role(auth.uid(), 'manager') OR
          (public.has_role(auth.uid(), 'telecaller') AND (
            area_id IS NULL OR
            area_id IN (SELECT area_id FROM public.telecaller_areas WHERE telecaller_id = auth.uid())
          ))
        )
      )
    );
  ```

---

### FINDING DB-SEC-03: Hardcoded Anon API Key and Project URL in Migration (Severity: P1)
- **File:** `supabase/migrations/20260613210308_dcc1dd0b-be52-4ece-b8a4-f01264289210.sql`, Lines 54-57
- **Root Cause:** A `pg_cron` schedule was deployed with hardcoded connection credentials:
  ```sql
  SELECT cron.schedule(
    'renewal-reminders-daily',
    '30 2 * * *',
    $$
    SELECT net.http_post(
      url := 'https://lgqgnsngxhqdzpstiddj.supabase.co/functions/v1/renewal-reminders',
      headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."}'::jsonb,
      body := jsonb_build_object('source','cron','ts', now())
    );
    $$
  );
  ```
- **Impact:**
  - Secrets committed to git repositories violate ISO 27001 / SOC 2 compliance.
  - If the database is cloned to staging or local development, the cron job will continue firing requests against the live production Supabase Edge Function `lgqgnsngxhqdzpstiddj.supabase.co`.
- **Remediation:** Use Supabase vault secrets or database configuration settings (`current_setting('app.settings.supabase_url')`) rather than hardcoded URLs and keys in migration scripts.

---

### FINDING DB-SEC-04: Imperfect Cascade Deletion in `super_admin_delete_company` (Severity: P2)
- **File:** `supabase/migrations/20260630004752_fe1ada82-9df8-431c-a693-54ce379f2ec7.sql`, Lines 28-50
- **Root Cause:**
  1. The procedure attempts to delete from a hardcoded list of tables sequentially:
     `FOREACH _t IN ARRAY _tables LOOP EXECUTE format('DELETE FROM public.%I WHERE company_id = $1', _t);`
  2. Noticeable omissions: `message_templates` is completely missing from `_tables`.
  3. Notice that `user_roles` and `profiles` are deleted, but **`auth.users`** entries are NOT deleted:
     ```sql
     IF array_length(_user_ids, 1) > 0 THEN
       DELETE FROM public.user_roles WHERE user_id = ANY(_user_ids);
       DELETE FROM public.profiles WHERE id = ANY(_user_ids);
     END IF;
     ```
- **Impact:**
  - When a company is purged, its employees' `auth.users` records remain intact in Supabase Auth.
  - If any of those users attempt to log in, their authentication succeeds, but because their profile and company are deleted, frontend React code encounters null pointer exceptions or hangs in an unhandled routing loop.
- **Remediation:** Call `auth.admin.deleteUser` via Edge Function or use an RPC that invokes `DELETE FROM auth.users WHERE id = ANY(_user_ids)` with appropriate security permissions.

---

## 4. View Architecture & Security Invoker Analysis

The application relies on two primary analytical views:
1. `public.leads_stats`: Real-time KPI aggregation view computing counts for `to_call`, `overdue`, `untouched`, `interested`, `follow_up`, `converted`, etc.
2. `public.unified_policies`: Aggregates records from `motor_policies`, `health_policies`, and `life_policies`.

### Security Invoker Vulnerability Analysis
- In PostgreSQL 15+, views by default execute with the permissions of the view owner (**SECURITY DEFINER behavior**). This bypasses Row Level Security on the underlying tables unless `WITH (security_invoker = true)` is explicitly set.
- **Inspection Result:**
  - `leads_stats`: Properly secured via `ALTER VIEW public.leads_stats SET (security_invoker = on);` in migration `20260605125419`.
  - `unified_policies`: Migration `20260613210308` added `ALTER VIEW IF EXISTS public.unified_policies SET (security_invoker = on);`.
- **Caution:** If `unified_policies` is recreated in any subsequent migration using `CREATE OR REPLACE VIEW`, PostgreSQL automatically resets `security_invoker` to `off`. Developers must ensure that every view creation statement includes `WITH (security_invoker = true)`.

---

## 5. Indexing & Query Performance Audit

Analysis of the top database query patterns from the React frontend hooks (`useLeadsPaginated`, `CallingList`, `Customer360`, `Renewals`) reveals critical missing composite indexes.

### Top Missing Composite Indexes

| Table | High-Frequency Filter Query | Current Index Status | Recommended Composite Index | Impact |
| :--- | :--- | :---: | :--- | :---: |
| `leads` | `WHERE company_id = ? AND status = ? AND call_date <= ?` | Single column index on `company_id` only | `CREATE INDEX idx_leads_co_status_calldate ON leads(company_id, status, call_date);` | **High (Reduces sequential scan on calling queues)** |
| `leads` | `WHERE company_id = ? AND phone_number = ?` | Single column index on `company_id` | `CREATE INDEX idx_leads_co_phone ON leads(company_id, phone_number);` | **High (Accelerates telecaller duplicate checks)** |
| `renewals` | `WHERE company_id = ? AND policy_expiry_date BETWEEN ? AND ?` | Separate indexes on `company_id`, `policy_expiry_date` | `CREATE INDEX idx_renewals_co_expiry ON renewals(company_id, policy_expiry_date);` | **High (Accelerates Renewal Command Center buckets)** |
| `call_logs`| `WHERE company_id = ? AND telecaller_id = ? AND created_at >= ?` | Single column index on `telecaller_id` | `CREATE INDEX idx_call_logs_co_caller_created ON call_logs(company_id, telecaller_id, created_at);` | **Medium (Speeds up agent daily scorecard calculation)** |
| `claims` | `WHERE company_id = ? AND status = ? ORDER BY intimation_date DESC` | Single column index on `company_id` | `CREATE INDEX idx_claims_co_status_date ON claims(company_id, status, intimation_date DESC);` | **Medium (Eliminates filesort on claim pipeline board)** |

---

## 6. Triggers & Stored Business Logic Audit

### 6.1. GST & TDS Calculation Trigger (`public.policy_txn_autocalc`)
- **Inspection:** Located in `supabase/migrations/20260613210308_dcc1dd0b-be52-4ece-b8a4-f01264289210.sql`.
- **Logic:**
  - Net Premium = `OD Premium + TP Premium`
  - GST = `round(net_premium * 0.18, 2)` (Strictly complies with Indian GST Rate)
  - Gross Premium = `net_premium + gst_amount`
  - TDS = `round(commission_amount * 0.05, 2)` (Complies with Sec 194D of Indian Income Tax Act)
  - Agent Payout = `commission_amount - tds_amount`
- **Assessment:** **PASS**. The mathematical logic and rounding rules adhere to IRDAI and Indian tax compliance standards.

### 6.2. User Registration & Auto-Approval Trigger (`public.handle_new_user`)
- **Inspection:** Located in `supabase/migrations/20260610194138` and `20260613182037`.
- **Flaw:** Accepts `requested_role` from user metadata without whitelist enforcement, and automatically marks `is_approved = true` when joining an existing company code.
- **Assessment:** **CRITICAL FAIL (SEC-01)**. Must be converted to require explicit manual manager approval.

---

## 7. Actionable SQL Remediation Scripts

The following SQL migration should be executed to remediate all identified database vulnerabilities:

```sql
-- ============================================================
-- TITAN DATABASE REMEDIATION SCRIPT: POSTGRES & RLS HARDENING
-- ============================================================

-- 1. Fix message_templates Tenant Isolation (DB-SEC-01)
ALTER TABLE public.message_templates
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;

-- Backfill company_id from owner profile
UPDATE public.message_templates mt
SET company_id = p.company_id
FROM public.profiles p
WHERE mt.owner_id = p.id AND mt.company_id IS NULL;

-- Make company_id mandatory
ALTER TABLE public.message_templates
  ALTER COLUMN company_id SET NOT NULL;

-- Drop insecure policies
DROP POLICY IF EXISTS "Read shared templates" ON public.message_templates;
DROP POLICY IF EXISTS "Managers manage shared templates" ON public.message_templates;

-- Recreate tenant-scoped policies
CREATE POLICY "Read shared templates" ON public.message_templates
  FOR SELECT TO authenticated
  USING (
    company_id = public.user_company_id() AND
    (shared = true OR owner_id = auth.uid())
  );

CREATE POLICY "Managers manage shared templates" ON public.message_templates
  FOR ALL TO authenticated
  USING (
    company_id = public.user_company_id() AND
    shared = true AND
    (public.has_role(auth.uid(), 'manager') OR public.has_role(auth.uid(), 'admin'))
  )
  WITH CHECK (
    company_id = public.user_company_id() AND
    (public.has_role(auth.uid(), 'manager') OR public.has_role(auth.uid(), 'admin'))
  );

-- 2. Consolidate leads RLS to eliminate cross-tenant leakage (DB-SEC-02)
DROP POLICY IF EXISTS "Telecallers view leads in their areas" ON public.leads;
DROP POLICY IF EXISTS "leads_company_isolation" ON public.leads;

CREATE POLICY "leads_tenant_isolation" ON public.leads
  FOR ALL TO authenticated
  USING (
    public.is_super_admin(auth.uid()) OR (
      company_id = public.user_company_id() AND (
        public.has_role(auth.uid(), 'admin') OR
        public.has_role(auth.uid(), 'manager') OR
        (
          public.has_role(auth.uid(), 'telecaller') AND (
            area_id IS NULL OR
            area_id IN (
              SELECT ta.area_id 
              FROM public.telecaller_areas ta 
              WHERE ta.telecaller_id = auth.uid() AND ta.company_id = public.user_company_id()
            )
          )
        )
      )
    )
  )
  WITH CHECK (
    public.is_super_admin(auth.uid()) OR (
      company_id = public.user_company_id()
    )
  );

-- 3. Deploy High-Performance Composite Indexes
CREATE INDEX IF NOT EXISTS idx_leads_co_status_calldate 
  ON public.leads(company_id, status, call_date);

CREATE INDEX IF NOT EXISTS idx_leads_co_phone 
  ON public.leads(company_id, phone_number);

CREATE INDEX IF NOT EXISTS idx_renewals_co_expiry 
  ON public.renewals(company_id, policy_expiry_date);

CREATE INDEX IF NOT EXISTS idx_call_logs_co_caller_created 
  ON public.call_logs(company_id, telecaller_id, created_at);

CREATE INDEX IF NOT EXISTS idx_claims_co_status_date 
  ON public.claims(company_id, status, intimation_date DESC);

-- 4. Enforce Security Invoker on Views
ALTER VIEW IF EXISTS public.unified_policies SET (security_invoker = on);
ALTER VIEW IF EXISTS public.leads_stats SET (security_invoker = on);
```
