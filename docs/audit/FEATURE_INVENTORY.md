# TITAN Insurance CRM — Module & Feature Inventory

**Project:** TITAN Insurance CRM (Multi-tenant Insurance Broker & Tele-CRM Platform)  
**Audit Date:** November 2026  
**Auditor:** Principal QA Architect & Security Auditor  
**Audit Mode:** AUDIT-ONLY (Read-Only Inspection)

---

## 1. System Architecture Overview

TITAN Insurance CRM is an enterprise-grade, multi-tenant insurance agency and tele-calling customer relationship management system. It provides end-to-end policy lifecycle management across Motor, Health, Life, and RTO services, combined with telecaller queue management, commission accounting, renewal automation, claims tracking, and omnichannel customer communication.

```
                           ┌───────────────────────────────┐
                           │   Client Application (Vite)   │
                           │   React 18 + TS + Tailwind    │
                           └───────────────┬───────────────┘
                                           │
                    ┌──────────────────────┴──────────────────────┐
                    │                                             │
         ┌──────────▼──────────┐                       ┌──────────▼──────────┐
         │  PostgREST API /    │                       │  Supabase Edge      │
         │  Auth / Realtime    │                       │  Functions (Deno)   │
         └──────────┬──────────┘                       └──────────┬──────────┘
                    │                                             │
                    └──────────────────────┬──────────────────────┘
                                           │
                                ┌──────────▼──────────┐
                                │   PostgreSQL 15     │
                                │   RLS + pg_cron     │
                                └─────────────────────┘
```

---

## 2. User Roles & Permission Hierarchy

The platform implements a strict multi-tier role-based access model:

| Role Key | Role Title | Scope | Capabilities |
| :--- | :--- | :--- | :--- |
| `super_admin` | Platform Super Admin | Cross-Company Global | System-wide visibility, tenant creation/deletion, impersonation, billing overrides, global templates, system audits. |
| `admin` | Company Owner / Principal Broker | Single Tenant (Company) | Full access to company settings, team management, payouts, brokers, commission slabs, all leads, and financial transactions. |
| `manager` | Team Leader / Branch Manager | Subordinate Telecallers | Lead reassignment, performance reporting, sub-team call audits, quota oversight, customer profile approval. |
| `telecaller` | Frontline Sales Agent | Assigned Areas & Leads | Daily calling queue, lead status disposition, walk-in/reference entry, premium calculation, quote generation. |
| `sub_agent` | Point of Sale Person (POSP) / Referral | Self-Generated Business | Own quote submissions, policy transactions, commission tracking, wallet payout visibility. |

---

## 3. Application Route Inventory

Routes are registered in `src/App.tsx` and wrapped with lazy-loaded Suspense boundaries and role guards (`ProtectedRoute.tsx`):

| Route Path | Component File | Guard / Requirements | Purpose |
| :--- | :--- | :--- | :--- |
| `/` | `src/pages/Index.tsx` | Public | Public landing page, product showcase, lead enquiry form, embedded calculator modal, WhatsApp widget. |
| `/auth` | `src/pages/Auth.tsx` | Public | Dual-tab login and registration (Create Company vs Join Company flows), forgot password. |
| `/reset-password` | `src/pages/ResetPassword.tsx` | Public (Token required) | Password recovery and credential update form. |
| `/trust` | `src/pages/Trust.tsx` | Public | Security, compliance, data protection, and IRDAI certification credentials. |
| `/dashboard` | `src/pages/Dashboard.tsx` | Authenticated | Smart router: inspects authenticated user role and navigates to the role-specific workspace. |
| `/telecaller` | `src/pages/TelecallerDashboard.tsx` | `requireRole="telecaller"` (or `admin`) | Telecaller workstation: daily calling list, area leads, call disposition, walk-in entry. |
| `/manager` | `src/pages/ManagerDashboard.tsx` | `requireRole="manager"` (or `admin`) | Manager workstation: subordinate telecaller monitoring, lead assignment, team productivity. |
| `/admin` | `src/pages/AdminDashboard.tsx` | `requireRole="admin"` | Company admin control panel: all submodules, finance, settings, imports, team configuration. |
| `/sub-agent` | `src/pages/SubAgentDashboard.tsx` | `requireRole="sub_agent"` (or `admin`) | Sub-agent / POSP workstation: policy submission, commission rates, wallet payouts. |
| `/super-admin` | `src/pages/SuperAdminDashboard.tsx` | `requireSuperAdmin={true}` | Global platform control: company billing, global metrics, tenant seeds, user impersonation. |
| `/super-admin/blueprint` | `src/pages/SuperAdminBlueprint.tsx` | `requireSuperAdmin={true}` | Migration safety toolkit: full database exports, system blueprint generation, source backup. |
| `*` | `src/pages/NotFound.tsx` | Catch-all (404) | Fallback screen for non-existent paths. |

---

## 4. Module & Feature Catalog

### 4.1. Core Sales & Tele-Calling
- **Calling Queue (`src/components/CallingList.tsx`):**
  - Bucket tabs: Today, Overdue, Interested, Follow-up, Cold, Untouched, Not Picked, Quote Sent, Premium Quoted, Negotiation, Converted, Transfer to Senior, Not Interested, Policy Issued, All.
  - Disposition actions: Update status, record notes, set callback date/time, trigger WhatsApp/SMS.
  - Multi-selection: Bulk lead assignment, bulk status change, bulk deletion.
  - Phone number masking: Conditional masking based on company policy (`useMaskingPolicy.ts`).
  - View modes: Grid/Block card view vs compact table list view.
  - Revival Date Filter: Date range filtering on policy expiry dates (`RevivalDateFilter.tsx`).
- **Lead Capture & Enquiries:**
  - Walk-in / Reference customer entry (`src/components/admin/AddCustomerForm.tsx`).
  - Public website enquiry intake (`src/components/EnquiryForm.tsx`).
  - Lead timeline and activity trail (`src/components/LeadTimeline.tsx`).

### 4.2. Customer 360 & Policy Management
- **Customer Hub (`src/components/admin/customers360/`):**
  - Customer 360 profile drawer with consolidated lifetime value, open policies, and family graph.
  - Tabs: Profile details, Products, Family members, Contacts, Notes, Tasks, Documents, Lifecycle events.
  - Cross-sell recommendation engine (`CrossSellWidget.tsx`).
- **Motor Insurance (`src/components/admin/motor/`):**
  - Vehicle master, RC registration data, PUC, fitness, permit tracking.
  - 5-step motor quotation wizard (`src/components/admin/quotation/MotorQuoteWizard.tsx`).
- **Health Insurance (`src/components/admin/health/`):**
  - Individual, family floater, and group health policies; covered members and sum insured tracking.
- **Life Insurance (`src/components/admin/life/`):**
  - Term, endowment, and ULIP policies; nominee allocations and premium payment schedules.
- **RTO Services (`src/components/admin/rto/`):**
  - RTO case lifecycle: transfer, hypothecation termination, NOC, driving license, fitness renewal.

### 4.3. Insurance Calculation Engine (`src/components/PremiumCalculator.tsx`)
- IRDAI tariff compliance calculation:
  - Age-based IDV depreciation schedule (5% to 55%).
  - Vehicle classification OD rates (TwoWheeler, PrivateCar, GCV, PCV, SchoolBus, Tractor).
  - Cubic capacity (CC) cubic-step third-party (TP) tariff lookup.
  - No Claim Bonus (NCB) slab deductions (0% to 50%).
  - Voluntary deductible discounts & anti-theft certificate discounts (capped at ₹500).
  - Commercial and company discounts.
  - Add-on package pricing (Zero Depreciation, Engine Protect, RSA, Consumables, Key Protect).
  - GST calculation (18%).
  - Broker commission estimation & net-in-pocket margin analysis.
  - Instant PDF quote export via `jspdf` and `jspdf-autotable`.

### 4.4. Renewals & Retention Engine (`src/components/admin/renewals/`)
- Renewal Command Center: Expiry buckets (Next 7, 15, 30, 60, 90 days, Expired).
- Multi-channel renewal campaigns: Automated WhatsApp, SMS, and Email follow-ups.
- Audience synchronization: Direct audience push to Meta Ads Custom Audiences via Graph API.
- Reassignment rules: Escalation to senior agents when policies are within critical expiry windows.

### 4.5. Claims Management (`src/components/admin/claims/`)
- Complete 10-stage claims workflow (Intimated → Documents Submitted → Surveyor Assigned → Assessment → Settled/Rejected).
- Claim aging analytics (0-7, 8-15, 16-30, 31-60, 60+ days) with severity color coding.
- Surveyor details, garage/hospital liaison tracking, claim expenses, and document repository.

### 4.6. Finance, Commissions & Payouts (`src/components/admin/accounts/` & `brokers/`)
- Commission tracking across Insurers, Brokers, and Sub-Agents.
- Tiered broker slab simulator (`SlabSimulator.tsx`).
- TDS deductions (5%) and GST reconciliation.
- Monthly agent payout calculation, net payable computation, UTR reference tracking.

### 4.7. Marketing & Automation Hub (`src/components/admin/marketing/`)
- Scheduled social post publisher (Facebook Pages, Instagram, LinkedIn).
- AI content generation (`mkt-ai-content` and `mkt-ai-image` Edge Functions).
- Festival greeting automation and event-triggered customer messaging.

### 4.8. Data Import & Export (`src/components/admin/SmartCSVImporter.tsx`)
- Intelligent 3-step CSV importer with fuzzy header auto-matching.
- Indian date format normalization (DD/MM/YYYY to ISO).
- Duplicate vehicle registration number detection.
- Batch database insertion (100 rows per transaction).

---

## 5. Supabase Database Schema Inventory (65 Tables)

| Domain | Tables |
| :--- | :--- |
| **Auth & Multi-Tenancy** | `companies`, `profiles`, `user_roles`, `branches`, `company_subscriptions`, `modules`, `role_permissions`, `app_settings` |
| **Leads & Calling** | `leads`, `enquiries`, `lead_quotes`, `lead_notes`, `call_logs`, `dial_logs`, `telecaller_areas`, `areas`, `break_logs`, `lead_statuses`, `status_mappings` |
| **Customer 360** | `customers`, `customer_lifecycle_events`, `customer_tasks`, `customer_notes`, `customer_family_members`, `customer_contacts`, `customer_documents`, `customer_products`, `cross_sell_suggestions` |
| **Policies & Master Data** | `motor_policies`, `motor_quotes`, `vehicles`, `health_policies`, `health_policy_members`, `life_policies`, `life_nominees`, `life_premium_schedule`, `insurers`, `product_catalog` |
| **Renewals** | `renewals`, `renewal_campaigns`, `renewal_templates`, `admin_renewal_settings`, `audience_sync_configs`, `audience_sync_logs` |
| **Claims** | `claims`, `claim_status_history`, `claim_notes`, `claim_followups`, `claim_expenses`, `claim_documents`, `claim_communications` |
| **RTO Services** | `rto_cases`, `rto_status_history`, `rto_case_documents`, `rto_service_types`, `rc_register`, `fitness_certificates`, `permits`, `puc_records` |
| **Brokers & Agents** | `brokers`, `broker_achievements`, `broker_payouts`, `broker_slabs`, `broker_targets`, `broker_company_mapping`, `agents_profile`, `agent_payouts`, `commission_rates`, `compensation_rules` |
| **Finance & Payouts** | `policy_transactions`, `premium_remittance`, `payment_records`, `expenses`, `payout_agent_split_rules`, `payout_finance_rules`, `payout_insurance_rules`, `payout_rto_rules`, `payout_state_rules`, `payout_tax_rules`, `payout_vendor_rules` |
| **Marketing & Social** | `marketing_integrations`, `marketing_templates`, `scheduled_posts`, `social_post_logs`, `mkt_campaigns`, `mkt_audiences`, `mkt_templates`, `mkt_channels`, `mkt_festivals`, `campaign_logs` |
| **Integrations & System** | `api_keys`, `external_api_registry`, `webhook_events`, `whatsapp_logs`, `sms_logs`, `whatsapp_bridge_settings`, `super_admin_audit_log`, `impersonation_sessions`, `audit_logs`, `training_materials`, `announcements`, `ai_suggestions`, `export_history` |

---

## 6. Edge Function Inventory (24 Functions)

| Function Name | JWT Verified (`verify_jwt`) | Public Endpoint | Key Security Risk / Notes |
| :--- | :--- | :--- | :--- |
| `whatsapp-webhook` | `false` | Yes | Uses `x-api-key` header; misses query param; cross-tenant fallback when company_id is null. |
| `wa-marketing-webhook` | `false` | Yes | Handles incoming customer responses from marketing campaigns. |
| `sync-renewal-audiences` | `false` | Yes | Protected by `x-cron-secret` or service key; vulnerable if secret unset. |
| `social-publish-scheduled` | `false` | Yes | 5-minute cron for Facebook/LinkedIn posting; unauthenticated if secret unset. |
| `auto-renewal-leads` | `true` | No | Background sync converting expiring policies to active leads. |
| `claude-suggest` | `true` | No | AI agent assistance for lead disposition suggestions. |
| `customer-automations` | `true` | No | Event-triggered automations for customer lifecycle milestones. |
| `fetch-vehicle-details` | `true` | No | VAHAN API bridge for vehicle registration lookup. |
| `generate-payment-link` | `true` | No | **CRITICAL IDOR**: Updates quote and lead without cross-tenant ownership validation. |
| `insurance-chat` | `true` | No | Customer service chatbot powering website chat widget. |
| `marketing-send` | `true` | No | Broadcast message dispatch across WhatsApp/SMS/Email. |
| `mkt-ai-content` | `true` | No | AI generation of marketing copy and social captions. |
| `mkt-ai-image` | `true` | No | AI generation of festival and promotional banners. |
| `policyboss-auth` | `true` | No | OAuth authentication with PolicyBoss POSP portal. |
| `policyboss-kyc-submit` | `true` | No | Submission of POSP KYC documents to aggregator. |
| `renewal-reminders` | `true` | No | Dispatch of renewal notifications. |
| `run-renewal-campaign` | `true` | No | Execution trigger for specific renewal campaign batches. |
| `send-renewal-message` | `true` | No | Single message dispatch for individual renewal records. |
| `send-sms` | `true` | No | Twilio SMS dispatch; lacks rate-limiting or content validation. |
| `send-whatsapp` | `true` | No | Meta WhatsApp Cloud API bridge; lacks per-user throttling. |
| `sheets-sync` | `true` | No | Google Sheets bi-directional lead sync. |
| `super-admin-actions` | `true` | No | Global management API (impersonation, company creation, table queries). |
| `team-admin` | `true` | No | Admin user creation, password reset, and member deletion. |
| `whatsapp-bridge` | `true` | No | Webhook and message gateway for third-party WhatsApp BSPs (Wati, Interakt). |
