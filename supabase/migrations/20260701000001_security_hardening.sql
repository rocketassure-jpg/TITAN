-- ====================================================================
-- TITAN CRM Migration: 20260701000001_security_hardening.sql
-- Remediates: SEC-01, SEC-03, NEW-SEC-A, NEW-SEC-B
-- Description:
--   1. Hardens handle_new_user() trigger:
--      - Removes fallback to 'ROCKET' company.
--      - Aborts registration on invalid company code.
--      - Enforces invite code validation server-side when configured.
--      - Defaults non-creator signups to 'telecaller' role.
--      - Enforces is_approved = false for all users joining existing tenants.
--   2. Restricts resolve_login_email() to prevent unauthenticated PII enumeration
--      of real user email addresses (only internal synthetic staff emails returned).
--   3. Updates invite_code_required() and validate_invite_code() with tenant awareness
--      and safe anon execution grants.
-- ====================================================================

-- 1. Hardened handle_new_user trigger
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _is_first BOOLEAN;
  _req TEXT;
  _safe_role app_role;
  _company_code TEXT;
  _create_company TEXT;
  _company_name TEXT;
  _company_id UUID;
  _new_code TEXT;
  _mobile TEXT;
  _invite_code TEXT;
  _expected_invite TEXT;
BEGIN
  SELECT NOT EXISTS (SELECT 1 FROM public.profiles) INTO _is_first;
  _req            := NEW.raw_user_meta_data->>'requested_role';
  _company_code   := trim(COALESCE(NEW.raw_user_meta_data->>'company_code', ''));
  _create_company := NEW.raw_user_meta_data->>'create_company';
  _company_name   := trim(COALESCE(NEW.raw_user_meta_data->>'company_name', ''));
  _invite_code    := trim(COALESCE(NEW.raw_user_meta_data->>'invite_code', ''));
  _mobile         := regexp_replace(COALESCE(NEW.raw_user_meta_data->>'mobile',''), '\D', '', 'g');
  IF _mobile = '' THEN _mobile := NULL; END IF;

  -- First user ever on the platform is super admin and company creator
  IF _is_first THEN
    IF _company_name = '' THEN _company_name := 'TITAN Head Office'; END IF;
    _new_code := 'TITAN';
    INSERT INTO public.companies (name, code, created_by)
    VALUES (_company_name, _new_code, NEW.id)
    RETURNING id INTO _company_id;

    INSERT INTO public.company_subscriptions (company_id, module_key, billing_cycle, status, end_date)
    SELECT _company_id, module_key, 'lifetime', 'active', NULL
    FROM public.modules;

    INSERT INTO public.profiles (id, full_name, department, requested_role, is_approved, is_active, company_id, is_super_admin, mobile)
    VALUES (
      NEW.id,
      COALESCE(NEW.raw_user_meta_data->>'full_name', 'Admin'),
      NEW.raw_user_meta_data->>'department',
      'admin',
      true,
      true,
      _company_id,
      true,
      _mobile
    );

    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'admin')
    ON CONFLICT DO NOTHING;

    RETURN NEW;
  END IF;

  -- Flow A: Creating a new company (tenant owner / admin)
  IF _create_company = 'true' THEN
    IF _company_name = '' THEN
      RAISE EXCEPTION 'Company name is required to create a new company';
    END IF;

    IF _company_code IS NOT NULL AND length(_company_code) >= 3 THEN
      _new_code := upper(regexp_replace(_company_code, '[^A-Za-z0-9]', '', 'g'));
    ELSE
      _new_code := upper(regexp_replace(_company_name, '[^a-zA-Z0-9]', '', 'g'));
    END IF;

    IF length(_new_code) < 3 THEN
      _new_code := _new_code || substr(md5(NEW.id::text), 1, 6);
    END IF;

    WHILE EXISTS (SELECT 1 FROM public.companies WHERE code = _new_code) LOOP
      _new_code := _new_code || substr(md5(random()::text), 1, 2);
    END LOOP;

    INSERT INTO public.companies (name, code, created_by)
    VALUES (_company_name, _new_code, NEW.id)
    RETURNING id INTO _company_id;

    INSERT INTO public.company_subscriptions (company_id, module_key, billing_cycle, status, end_date)
    SELECT _company_id, module_key,
      CASE WHEN is_always_included THEN 'lifetime' ELSE 'trial' END,
      'active',
      CASE WHEN is_always_included THEN NULL ELSE CURRENT_DATE + INTERVAL '14 days' END
    FROM public.modules;

    INSERT INTO public.profiles (id, full_name, department, requested_role, is_approved, is_active, company_id, is_super_admin, mobile)
    VALUES (
      NEW.id,
      COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
      NEW.raw_user_meta_data->>'department',
      'admin',
      true,
      true,
      _company_id,
      false,
      _mobile
    );

    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'admin')
    ON CONFLICT DO NOTHING;

    RETURN NEW;
  END IF;

  -- Flow B: Joining an existing company
  IF _company_code IS NULL OR length(_company_code) = 0 THEN
    RAISE EXCEPTION 'A valid company code is required to join an existing organization';
  END IF;

  SELECT id INTO _company_id
  FROM public.companies
  WHERE upper(code) = upper(_company_code) AND is_active = true
  LIMIT 1;

  -- CRITICAL SECURITY FIX (NEW-SEC-A): Do NOT fallback to 'ROCKET' company. Abort on invalid code.
  IF _company_id IS NULL THEN
    RAISE EXCEPTION 'Invalid or inactive company code: %', _company_code;
  END IF;

  -- CRITICAL SECURITY FIX (NEW-SEC-B): Server-side invite code validation
  SELECT invite_code INTO _expected_invite
  FROM public.app_settings
  WHERE company_id = _company_id AND invite_code IS NOT NULL AND length(trim(invite_code)) > 0
  LIMIT 1;

  IF _expected_invite IS NOT NULL AND length(trim(_expected_invite)) > 0 THEN
    IF _invite_code IS NULL OR _invite_code = '' OR _invite_code != _expected_invite THEN
      RAISE EXCEPTION 'Invalid or missing invite code for company %', _company_code;
    END IF;
  END IF;

  -- CRITICAL SECURITY FIX (SEC-01): User-supplied metadata NEVER grants manager or admin.
  -- Non-creator registrations strictly default to 'telecaller', and require admin approval.
  _safe_role := 'telecaller'::app_role;

  INSERT INTO public.profiles (
    id, full_name, department, requested_role, is_approved, is_active, company_id, is_super_admin, mobile
  ) VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    NEW.raw_user_meta_data->>'department',
    CASE WHEN _req IN ('telecaller', 'manager', 'sub_agent') THEN _req ELSE 'telecaller' END,
    false, -- Requires admin approval before dashboard access
    true,
    _company_id,
    false,
    _mobile
  );

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, _safe_role)
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$function$;

-- 2. Privacy-preserving resolve_login_email RPC (SEC-03)
-- Never exposes real personal email addresses to unauthenticated callers.
-- Returns synthetic staff login emails (*.staff.local or *.internal) for staff logins.
-- If a user registered with a personal email and provides their password, verifies the password
-- using crypt() before returning the email so legitimate mobile+password sign-in succeeds
-- without exposing personal emails to unauthenticated scrapers/harvesters.
CREATE OR REPLACE FUNCTION public.resolve_login_email(_login text, _password text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, auth
AS $$
DECLARE
  _digits text;
  _email text;
  _uid uuid;
  _enc_pass text;
BEGIN
  IF _login IS NULL OR length(trim(_login)) = 0 THEN RETURN NULL; END IF;
  IF position('@' in _login) > 0 THEN
    -- If caller already supplied an email, echo it back
    RETURN trim(_login);
  END IF;

  _digits := regexp_replace(_login, '\D', '', 'g');
  IF length(_digits) < 6 THEN RETURN NULL; END IF;

  -- Prioritize confirmed user accounts matching the mobile number
  FOR _uid IN
    SELECT p.id
    FROM public.profiles p
    JOIN auth.users u ON u.id = p.id
    WHERE p.mobile = _digits
    ORDER BY u.email_confirmed_at DESC NULLS LAST, p.created_at DESC
  LOOP
    SELECT u.email, u.encrypted_password INTO _email, _enc_pass
    FROM auth.users u
    WHERE u.id = _uid;

    IF _email IS NOT NULL THEN
      -- Synthetic staff email: return directly (used for email-less staff logins)
      IF _email LIKE '%.staff.local' OR _email LIKE '%.internal' THEN
        RETURN _email;
      END IF;

      -- Personal email: only disclose if valid password was provided to authenticate
      IF _password IS NOT NULL AND length(_password) > 0 THEN
        IF extensions.crypt(_password, _enc_pass) = _enc_pass THEN
          RETURN _email;
        END IF;
      END IF;
    END IF;
  END LOOP;

  -- Real personal email without valid password: do not disclose to public callers
  RETURN NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_login_email(text, text) TO anon, authenticated;

-- 3. Tenant-aware invite code functions (BUG-NEW-03 & NEW-SEC-B)
CREATE OR REPLACE FUNCTION public.invite_code_required(_company_code text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _company_code IS NOT NULL AND length(trim(_company_code)) > 0 THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.app_settings a
      JOIN public.companies c ON c.id = a.company_id
      WHERE upper(c.code) = upper(trim(_company_code))
        AND a.invite_code IS NOT NULL
        AND length(trim(a.invite_code)) > 0
    );
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.app_settings
    WHERE invite_code IS NOT NULL
      AND length(trim(invite_code)) > 0
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.invite_code_required(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.validate_invite_code(_code text, _company_code text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _code IS NULL OR length(trim(_code)) = 0 THEN
    RETURN false;
  END IF;

  IF _company_code IS NOT NULL AND length(trim(_company_code)) > 0 THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.app_settings a
      JOIN public.companies c ON c.id = a.company_id
      WHERE upper(c.code) = upper(trim(_company_code))
        AND a.invite_code = trim(_code)
    );
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.app_settings
    WHERE invite_code = trim(_code)
      AND invite_code IS NOT NULL
      AND length(trim(invite_code)) > 0
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.validate_invite_code(text, text) TO anon, authenticated;
