-- ====================================================================
-- TITAN CRM Migration: 20260701000002_rls_telecaller_area_cleanup.sql
-- Remediates: BUG-DB-01, BUG-DB-02
-- Description:
--   1. Drops redundant overlapping permissive RLS policy "Admins view all leads"
--      on public.leads (already fully governed by "Admins manage leads" FOR ALL).
--   2. Replaces un-scoped legacy telecaller area policies ("Telecallers view leads in their areas"
--      and "Telecallers update leads in their areas") with tenant-isolated policies enforcing
--      company_id = public.user_company_id().
--   3. Enforces tenant isolation on manager lead policies as defense-in-depth.
-- ====================================================================

-- 1. Eliminate duplicate permissive admin policy on leads (BUG-DB-01)
DROP POLICY IF EXISTS "Admins view all leads" ON public.leads;

-- 2. Enforce strict company_id isolation on Telecaller area policies (BUG-DB-02)
DROP POLICY IF EXISTS "Telecallers view leads in their areas" ON public.leads;
CREATE POLICY "Telecallers view leads in their areas" ON public.leads
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'telecaller')
    AND company_id = public.user_company_id()
    AND public.telecaller_has_area(auth.uid(), area_id)
  );

DROP POLICY IF EXISTS "Telecallers update leads in their areas" ON public.leads;
CREATE POLICY "Telecallers update leads in their areas" ON public.leads
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'telecaller')
    AND company_id = public.user_company_id()
    AND public.telecaller_has_area(auth.uid(), area_id)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'telecaller')
    AND company_id = public.user_company_id()
    AND public.telecaller_has_area(auth.uid(), area_id)
  );

-- 3. Enforce strict company_id isolation on Manager policies (Defense-in-depth)
DROP POLICY IF EXISTS "Managers view team leads" ON public.leads;
CREATE POLICY "Managers view team leads" ON public.leads
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'manager')
    AND company_id = public.user_company_id()
    AND public.manager_can_see_lead(auth.uid(), area_id)
  );

DROP POLICY IF EXISTS "Managers update team leads" ON public.leads;
CREATE POLICY "Managers update team leads" ON public.leads
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'manager')
    AND company_id = public.user_company_id()
    AND public.manager_can_see_lead(auth.uid(), area_id)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'manager')
    AND company_id = public.user_company_id()
    AND public.manager_can_see_lead(auth.uid(), area_id)
  );
