import { describe, it, expect } from "vitest";

// Replicate pickRole from AuthContext.tsx
type Role = "admin" | "manager" | "telecaller" | "sub_agent" | null;

const pickRole = (roles: string[]): Role =>
  roles.includes("admin") ? "admin"
  : roles.includes("manager") ? "manager"
  : roles.includes("telecaller") ? "telecaller"
  : roles.includes("sub_agent") ? "sub_agent"
  : null;

// Replicate defaultPasswordFor from team-admin/index.ts
const defaultPasswordFor = (name: string, mobile: string) => {
  const letters = (name || "").replace(/[^A-Za-z]/g, "");
  const head = (letters.slice(0, 4) || "user").padEnd(4, "x");
  const cap = head.charAt(0).toUpperCase() + head.slice(1).toLowerCase();
  const digits = (mobile || "").replace(/\D/g, "").slice(-4).padStart(4, "0");
  return `${cap}${digits}`;
};

// Replicate ProtectedRoute authorization checks (Fixed SEC-01)
const canAccessRoute = (params: {
  user: { id: string } | null;
  role: Role;
  isSuperAdmin: boolean;
  profileStatus: { is_approved: boolean; is_active: boolean } | null;
  requireRole?: Role;
  requireSuperAdmin?: boolean;
}): { allowed: boolean; redirect: string | null; blockReason?: string } => {
  const { user, role, isSuperAdmin, profileStatus, requireRole, requireSuperAdmin } = params;

  if (!user) return { allowed: false, redirect: "/auth" };

  if (profileStatus) {
    if (!profileStatus.is_active) {
      return { allowed: false, redirect: null, blockReason: "Deactivated" };
    }
    if (!profileStatus.is_approved) {
      return { allowed: false, redirect: null, blockReason: "PendingApproval" };
    }
  }

  if (requireSuperAdmin && !isSuperAdmin) {
    return { allowed: false, redirect: "/dashboard" };
  }

  if (requireRole && role !== requireRole && role !== "admin") {
    return { allowed: false, redirect: "/dashboard" };
  }

  return { allowed: true, redirect: null };
};

describe("Authentication & RBAC Logic", () => {
  describe("pickRole priority resolution", () => {
    it("prioritizes admin over manager, telecaller, and sub_agent", () => {
      expect(pickRole(["telecaller", "admin", "manager"])).toBe("admin");
      expect(pickRole(["manager", "telecaller"])).toBe("manager");
      expect(pickRole(["sub_agent", "telecaller"])).toBe("telecaller");
      expect(pickRole(["sub_agent"])).toBe("sub_agent");
    });

    it("returns null when no valid application roles exist", () => {
      expect(pickRole([])).toBeNull();
      expect(pickRole(["viewer", "guest"])).toBeNull();
    });
  });

  describe("defaultPasswordFor generation", () => {
    it("generates predictable 8-character password from name and mobile", () => {
      expect(defaultPasswordFor("Rahul Sharma", "9876543210")).toBe("Rahu3210");
      expect(defaultPasswordFor("Amit", "9123456789")).toBe("Amit6789");
    });

    it("pads short names with 'x' to maintain 4-letter prefix", () => {
      expect(defaultPasswordFor("Om", "9876543210")).toBe("Omxx3210");
      expect(defaultPasswordFor("A", "9876543210")).toBe("Axxx3210");
    });

    it("falls back to 'User' when name has no letters", () => {
      expect(defaultPasswordFor("1234", "9876543210")).toBe("User3210");
      expect(defaultPasswordFor("", "9876543210")).toBe("User3210");
    });
  });

  describe("ProtectedRoute role authorization", () => {
    it("redirects unauthenticated users to /auth", () => {
      const res = canAccessRoute({
        user: null,
        role: null,
        isSuperAdmin: false,
        profileStatus: null,
        requireRole: "admin",
      });
      expect(res.allowed).toBe(false);
      expect(res.redirect).toBe("/auth");
    });

    it("allows admin to access any role-protected route (manager, telecaller, sub_agent)", () => {
      const resManager = canAccessRoute({
        user: { id: "admin-1" },
        role: "admin",
        isSuperAdmin: false,
        profileStatus: { is_approved: true, is_active: true },
        requireRole: "manager",
      });
      expect(resManager.allowed).toBe(true);

      const resTelecaller = canAccessRoute({
        user: { id: "admin-1" },
        role: "admin",
        isSuperAdmin: false,
        profileStatus: { is_approved: true, is_active: true },
        requireRole: "telecaller",
      });
      expect(resTelecaller.allowed).toBe(true);
    });

    it("blocks telecaller from accessing manager or admin routes", () => {
      const resAdmin = canAccessRoute({
        user: { id: "tc-1" },
        role: "telecaller",
        isSuperAdmin: false,
        profileStatus: { is_approved: true, is_active: true },
        requireRole: "admin",
      });
      expect(resAdmin.allowed).toBe(false);
      expect(resAdmin.redirect).toBe("/dashboard");

      const resManager = canAccessRoute({
        user: { id: "tc-1" },
        role: "telecaller",
        isSuperAdmin: false,
        profileStatus: { is_approved: true, is_active: true },
        requireRole: "manager",
      });
      expect(resManager.allowed).toBe(false);
      expect(resManager.redirect).toBe("/dashboard");
    });

    it("blocks non-super-admin from accessing super-admin routes even if role is admin", () => {
      const res = canAccessRoute({
        user: { id: "admin-1" },
        role: "admin",
        isSuperAdmin: false,
        profileStatus: { is_approved: true, is_active: true },
        requireSuperAdmin: true,
      });
      expect(res.allowed).toBe(false);
      expect(res.redirect).toBe("/dashboard");
    });

    it("enforces approval check: unapproved users are blocked at route guard (SEC-01)", () => {
      const unapprovedUser = canAccessRoute({
        user: { id: "user-unapproved" },
        role: "telecaller",
        isSuperAdmin: false,
        profileStatus: { is_approved: false, is_active: true }, // Not approved
        requireRole: "telecaller",
      });

      expect(unapprovedUser.allowed).toBe(false);
      expect(unapprovedUser.blockReason).toBe("PendingApproval");
    });

    it("blocks deactivated users even if previously approved", () => {
      const deactivatedUser = canAccessRoute({
        user: { id: "user-deactivated" },
        role: "telecaller",
        isSuperAdmin: false,
        profileStatus: { is_approved: true, is_active: false },
        requireRole: "telecaller",
      });

      expect(deactivatedUser.allowed).toBe(false);
      expect(deactivatedUser.blockReason).toBe("Deactivated");
    });

    it("allows active and approved users access to their authorized role route", () => {
      const approvedUser = canAccessRoute({
        user: { id: "user-approved" },
        role: "telecaller",
        isSuperAdmin: false,
        profileStatus: { is_approved: true, is_active: true },
        requireRole: "telecaller",
      });

      expect(approvedUser.allowed).toBe(true);
      expect(approvedUser.redirect).toBeNull();
    });
  });

  describe("Server-Side Registration & Multi-Tenancy Guard Rules (SEC-01, NEW-SEC-A, NEW-SEC-B)", () => {
    // Replicate handle_new_user role assignment logic
    const resolveNewUserRoleAndStatus = (input: {
      isFirst: boolean;
      createCompany: boolean;
      requestedRole: string;
      companyCode: string | null;
      activeCompanyCodes: string[];
      inviteCode?: string;
      companyConfiguredInvite?: string;
    }) => {
      if (input.isFirst) {
        return { role: "admin", isApproved: true, companyId: "first-co", error: null };
      }
      if (input.createCompany) {
        return { role: "admin", isApproved: true, companyId: "new-co", error: null };
      }
      // Joining existing company
      if (!input.companyCode || !input.activeCompanyCodes.includes(input.companyCode.toUpperCase())) {
        return { role: null, isApproved: false, companyId: null, error: "Invalid or inactive company code" };
      }
      // Check invite code
      if (input.companyConfiguredInvite && input.companyConfiguredInvite.length > 0) {
        if (!input.inviteCode || input.inviteCode !== input.companyConfiguredInvite) {
          return { role: null, isApproved: false, companyId: null, error: "Invalid or missing invite code" };
        }
      }
      // Non-creator registration strictly defaults to telecaller and is_approved = false
      return { role: "telecaller", isApproved: false, companyId: input.companyCode, error: null };
    };

    it("denies self-registration role escalation: requested_role 'manager' strictly provisions as 'telecaller'", () => {
      const res = resolveNewUserRoleAndStatus({
        isFirst: false,
        createCompany: false,
        requestedRole: "manager",
        companyCode: "REWA123",
        activeCompanyCodes: ["REWA123", "INDORE456"],
      });
      expect(res.error).toBeNull();
      expect(res.role).toBe("telecaller"); // Not manager!
      expect(res.isApproved).toBe(false); // Requires admin approval!
    });

    it("rejects unknown company code without falling back to default ROCKET company (NEW-SEC-A)", () => {
      const res = resolveNewUserRoleAndStatus({
        isFirst: false,
        createCompany: false,
        requestedRole: "telecaller",
        companyCode: "NONEXISTENT",
        activeCompanyCodes: ["REWA123", "INDORE456"],
      });
      expect(res.error).toBe("Invalid or inactive company code");
      expect(res.companyId).toBeNull();
    });

    it("enforces server-side invite code validation when configured (NEW-SEC-B)", () => {
      const withoutInvite = resolveNewUserRoleAndStatus({
        isFirst: false,
        createCompany: false,
        requestedRole: "telecaller",
        companyCode: "REWA123",
        activeCompanyCodes: ["REWA123"],
        companyConfiguredInvite: "SECRET2026",
      });
      expect(withoutInvite.error).toBe("Invalid or missing invite code");

      const withWrongInvite = resolveNewUserRoleAndStatus({
        isFirst: false,
        createCompany: false,
        requestedRole: "telecaller",
        companyCode: "REWA123",
        activeCompanyCodes: ["REWA123"],
        inviteCode: "WRONGCODE",
        companyConfiguredInvite: "SECRET2026",
      });
      expect(withWrongInvite.error).toBe("Invalid or missing invite code");

      const withCorrectInvite = resolveNewUserRoleAndStatus({
        isFirst: false,
        createCompany: false,
        requestedRole: "telecaller",
        companyCode: "REWA123",
        activeCompanyCodes: ["REWA123"],
        inviteCode: "SECRET2026",
        companyConfiguredInvite: "SECRET2026",
      });
      expect(withCorrectInvite.error).toBeNull();
      expect(withCorrectInvite.isApproved).toBe(false);
    });

    it("allows initial company creator onboarding with admin role", () => {
      const creator = resolveNewUserRoleAndStatus({
        isFirst: false,
        createCompany: true,
        requestedRole: "admin",
        companyCode: "NEWBIZ",
        activeCompanyCodes: [],
      });
      expect(creator.error).toBeNull();
      expect(creator.role).toBe("admin");
      expect(creator.isApproved).toBe(true);
    });
  });

  describe("Cross-Tenant Payment Link IDOR Defense (SEC-02)", () => {
    // Replicate generate-payment-link authorization rules
    const authorizePaymentLinkGeneration = (params: {
      caller: {
        id: string;
        companyId: string | null;
        isActive: boolean;
        isApproved: boolean;
        isSuperAdmin: boolean;
        roles: string[];
      };
      quote: { id: string; companyId: string; leadId?: string } | null;
      lead?: { id: string; companyId: string } | null;
    }): { status: number; error: string | null } => {
      const { caller, quote, lead } = params;

      if (!caller.isActive || !caller.isApproved) {
        return { status: 403, error: "Account inactive or pending approval" };
      }

      const hasRole = caller.isSuperAdmin || caller.roles.some((r) => ["admin", "manager", "telecaller", "sub_agent"].includes(r));
      if (!hasRole) {
        return { status: 403, error: "Insufficient permissions" };
      }

      if (!quote) {
        return { status: 404, error: "Quote not found" };
      }

      if (!caller.isSuperAdmin && quote.companyId !== caller.companyId) {
        return { status: 403, error: "Cross-tenant access denied" };
      }

      if (quote.leadId && lead) {
        if (!caller.isSuperAdmin && lead.companyId !== caller.companyId) {
          return { status: 403, error: "Associated lead belongs to another tenant" };
        }
      }

      return { status: 200, error: null };
    };

    it("allows Company A user to generate payment link for Company A quote", () => {
      const res = authorizePaymentLinkGeneration({
        caller: { id: "user-a", companyId: "comp-A", isActive: true, isApproved: true, isSuperAdmin: false, roles: ["telecaller"] },
        quote: { id: "quote-1", companyId: "comp-A", leadId: "lead-1" },
        lead: { id: "lead-1", companyId: "comp-A" },
      });
      expect(res.status).toBe(200);
      expect(res.error).toBeNull();
    });

    it("blocks Company A user from modifying Company B quote (IDOR prevented)", () => {
      const res = authorizePaymentLinkGeneration({
        caller: { id: "user-a", companyId: "comp-A", isActive: true, isApproved: true, isSuperAdmin: false, roles: ["telecaller"] },
        quote: { id: "quote-2", companyId: "comp-B", leadId: "lead-2" },
        lead: { id: "lead-2", companyId: "comp-B" },
      });
      expect(res.status).toBe(403);
      expect(res.error).toBe("Cross-tenant access denied");
    });

    it("blocks when quote and associated lead company mismatch", () => {
      const res = authorizePaymentLinkGeneration({
        caller: { id: "user-a", companyId: "comp-A", isActive: true, isApproved: true, isSuperAdmin: false, roles: ["telecaller"] },
        quote: { id: "quote-1", companyId: "comp-A", leadId: "lead-tampered" },
        lead: { id: "lead-tampered", companyId: "comp-B" },
      });
      expect(res.status).toBe(403);
      expect(res.error).toBe("Associated lead belongs to another tenant");
    });

    it("blocks unapproved caller from generating payment links", () => {
      const res = authorizePaymentLinkGeneration({
        caller: { id: "user-unapproved", companyId: "comp-A", isActive: true, isApproved: false, isSuperAdmin: false, roles: ["telecaller"] },
        quote: { id: "quote-1", companyId: "comp-A" },
      });
      expect(res.status).toBe(403);
    });
  });

  describe("Privacy-Preserving Login Email Resolution (SEC-03)", () => {
    // Replicate resolve_login_email privacy gate with password verification
    const resolveLoginEmail = (
      login: string,
      userDatabase: { mobile: string; email: string; passwordHash: string }[],
      password?: string
    ): string | null => {
      if (!login || login.trim() === "") return null;
      if (login.includes("@")) return login.trim();

      const digits = login.replace(/\D/g, "");
      if (digits.length < 6) return null;

      const found = userDatabase.find((u) => u.mobile === digits);
      if (!found) return null;

      // Synthetic staff accounts: always returned for internal mobile sign-in
      if (found.email.endsWith(".staff.local") || found.email.endsWith(".internal")) {
        return found.email;
      }

      // Personal emails: only returned when caller supplies the correct matching password
      if (password && password === found.passwordHash) {
        return found.email;
      }

      // Real personal emails are NEVER disclosed to unauthenticated callers
      return null;
    };

    const mockUsers = [
      { mobile: "9876543210", email: "personal.ceo@gmail.com", passwordHash: "SecretPass123" },
      { mobile: "9123456789", email: "9123456789@rewa.staff.local", passwordHash: "StaffPass123" },
    ];

    it("blocks unauthenticated real email harvesting via phone number", () => {
      const email = resolveLoginEmail("+91 98765 43210", mockUsers);
      // Without password, must NOT return "personal.ceo@gmail.com"!
      expect(email).toBeNull();
    });

    it("blocks email return when incorrect password is provided", () => {
      const email = resolveLoginEmail("9876543210", mockUsers, "WrongPassword");
      expect(email).toBeNull();
    });

    it("allows legitimate personal-email-backed staff mobile login when correct password is provided", () => {
      const email = resolveLoginEmail("9876543210", mockUsers, "SecretPass123");
      expect(email).toBe("personal.ceo@gmail.com");
    });

    it("returns synthetic staff email for legitimate staff mobile login even without password", () => {
      const email = resolveLoginEmail("9123456789", mockUsers);
      expect(email).toBe("9123456789@rewa.staff.local");
    });

    it("returns safe null on invalid or non-existent mobile number", () => {
      expect(resolveLoginEmail("0000000000", mockUsers)).toBeNull();
      expect(resolveLoginEmail("123", mockUsers)).toBeNull();
    });

    it("preserves direct email input unchanged", () => {
      expect(resolveLoginEmail("admin@company.com", mockUsers)).toBe("admin@company.com");
    });
  });

  describe("Edge Functions Security Hardening (RISK-SEC-02, RISK-SEC-04, RISK-SEC-05)", () => {
    // WhatsApp Webhook multi-tenant isolation logic
    const handleWhatsAppWebhook = (params: {
      apiKey: string | null;
      keyRow: { id: string; revoked: boolean; company_id: string | null } | null;
      payload: { customer_name?: string; phone_number?: string };
      areas: { id: string; company_id: string }[];
    }) => {
      if (!params.apiKey) return { status: 401, error: "Missing api_key" };
      if (!params.keyRow || params.keyRow.revoked) return { status: 401, error: "Invalid api_key" };
      if (!params.keyRow.company_id) return { status: 403, error: "API key is not associated with an authorized company" };

      const matchedArea = params.areas.find((a) => a.company_id === params.keyRow!.company_id);
      if (!matchedArea) return { status: 400, error: "No area configured for company" };

      return { status: 200, companyId: params.keyRow.company_id, areaId: matchedArea.id };
    };

    it("rejects webhook with HTTP 403 if API key lacks company_id (RISK-SEC-02)", () => {
      const res = handleWhatsAppWebhook({
        apiKey: "valid-key-orphan",
        keyRow: { id: "k-1", revoked: false, company_id: null },
        payload: { customer_name: "John", phone_number: "9876543210" },
        areas: [{ id: "area-1", company_id: "comp-A" }],
      });
      expect(res.status).toBe(403);
      expect(res.error).toBe("API key is not associated with an authorized company");
    });

    it("strictly scopes webhook area lookup to the API key's company", () => {
      const res = handleWhatsAppWebhook({
        apiKey: "valid-key",
        keyRow: { id: "k-2", revoked: false, company_id: "comp-A" },
        payload: { customer_name: "John", phone_number: "9876543210" },
        areas: [
          { id: "area-b", company_id: "comp-B" },
          { id: "area-a", company_id: "comp-A" },
        ],
      });
      expect(res.status).toBe(200);
      expect(res.companyId).toBe("comp-A");
      expect(res.areaId).toBe("area-a");
    });

    // SMS sending authorization logic (RISK-SEC-05)
    const authorizeSendSms = (params: {
      caller: { id: string; companyId: string | null; isActive: boolean; isApproved: boolean; role: string };
      phoneNumber: string;
      message: string;
      lead?: { id: string; companyId: string } | null;
    }) => {
      if (!params.caller.isActive || !params.caller.isApproved) {
        return { status: 403, error: "Account inactive or pending approval" };
      }
      if (!["admin", "manager", "telecaller"].includes(params.caller.role)) {
        return { status: 403, error: "Forbidden: insufficient role" };
      }
      const cleaned = params.phoneNumber.replace(/[\s-]/g, "");
      if (!/^\+?[1-9]\d{6,14}$/.test(cleaned)) {
        return { status: 400, error: "Invalid phone number format" };
      }
      if (!params.message || params.message.trim().length === 0) {
        return { status: 400, error: "Message cannot be empty" };
      }
      if (params.lead && params.caller.companyId && params.lead.companyId !== params.caller.companyId) {
        return { status: 403, error: "Lead not found or cross-tenant access denied" };
      }
      return { status: 200, message: params.message.trim().slice(0, 500) };
    };

    it("rejects SMS dispatch from unapproved or inactive caller", () => {
      const res = authorizeSendSms({
        caller: { id: "u1", companyId: "comp-A", isActive: true, isApproved: false, role: "telecaller" },
        phoneNumber: "+919876543210",
        message: "Hello customer",
      });
      expect(res.status).toBe(403);
    });

    it("prevents cross-tenant SMS association (RISK-SEC-05)", () => {
      const res = authorizeSendSms({
        caller: { id: "u1", companyId: "comp-A", isActive: true, isApproved: true, role: "telecaller" },
        phoneNumber: "+919876543210",
        message: "Your policy renewal is due",
        lead: { id: "lead-2", companyId: "comp-B" },
      });
      expect(res.status).toBe(403);
      expect(res.error).toBe("Lead not found or cross-tenant access denied");
    });

    it("validates phone number format and enforces 500-char limit on SMS message", () => {
      const badPhone = authorizeSendSms({
        caller: { id: "u1", companyId: "comp-A", isActive: true, isApproved: true, role: "telecaller" },
        phoneNumber: "invalid-phone",
        message: "Hello",
      });
      expect(badPhone.status).toBe(400);

      const longMsg = "A".repeat(600);
      const res = authorizeSendSms({
        caller: { id: "u1", companyId: "comp-A", isActive: true, isApproved: true, role: "telecaller" },
        phoneNumber: "+919876543210",
        message: longMsg,
      });
      expect(res.status).toBe(200);
      expect(res.message?.length).toBe(500);
    });
  });
});
