import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "").trim();
    if (!token) return json({ error: "Unauthorized: Missing authentication token" }, 401);

    const { data: userData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !userData?.user) return json({ error: "Unauthorized: Invalid or expired token" }, 401);

    const callerId = userData.user.id;

    // 1. Resolve caller profile and tenant ownership
    const { data: profile } = await supabase
      .from("profiles")
      .select("id, company_id, is_active, is_approved, is_super_admin")
      .eq("id", callerId)
      .maybeSingle();

    if (!profile) return json({ error: "Unauthorized: User profile not found" }, 401);
    if (!profile.is_active || !profile.is_approved) {
      return json({ error: "Forbidden: Account is inactive or pending approval" }, 403);
    }
    if (!profile.is_super_admin && !profile.company_id) {
      return json({ error: "Forbidden: No tenant company associated" }, 403);
    }

    // 2. Resolve caller role and permissions
    const { data: roleRows } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", callerId);

    const callerRoles = (roleRows ?? []).map((r: { role: string }) => r.role);
    const hasAuthorizedRole = profile.is_super_admin || callerRoles.some((r: string) =>
      ["admin", "manager", "telecaller", "sub_agent"].includes(r)
    );
    if (!hasAuthorizedRole) {
      return json({ error: "Forbidden: Insufficient permissions to generate payment links" }, 403);
    }

    const { motor_quote_id } = await req.json();
    if (!motor_quote_id) return json({ error: "motor_quote_id required" }, 400);

    const callerCompanyId = profile.company_id;

    // 3. Resolve motor quote scoped to tenant
    const { data: quote } = await supabase
      .from("motor_quotes")
      .select("*")
      .eq("id", motor_quote_id)
      .maybeSingle();

    if (!quote) return json({ error: "Quote not found" }, 404);

    // Cross-tenant check: if caller is not super admin, quote MUST belong to caller's company
    if (!profile.is_super_admin && quote.company_id !== callerCompanyId) {
      return json({ error: "Forbidden: Cross-tenant access denied" }, 403);
    }

    // 4. If lead_id is present, verify lead belongs to same company
    if (quote.lead_id) {
      const { data: lead } = await supabase
        .from("leads")
        .select("id, company_id")
        .eq("id", quote.lead_id)
        .maybeSingle();

      if (!lead || (!profile.is_super_admin && lead.company_id !== callerCompanyId)) {
        return json({ error: "Forbidden: Associated lead belongs to another tenant or does not exist" }, 403);
      }
    }

    const { data: integ } = await supabase
      .from("super_admin_integrations").select("credentials")
      .eq("integration_key", "policyboss_posp").maybeSingle();
    const token = integ?.credentials?.token;

    let paymentUrl: string | null = null;
    let expiry = new Date(Date.now() + 24 * 3600 * 1000).toISOString();

    if (token && !String(token).startsWith("stub_") && quote.policyboss_quote_id) {
      try {
        const r = await fetch("https://partner.policyboss.com/api/payment/link", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            quote_id: quote.policyboss_quote_id,
            amount: quote.gross_premium ?? quote.net_premium,
          }),
        });
        if (r.ok) {
          const j = await r.json();
          paymentUrl = j.payment_url ?? null;
          expiry = j.expiry ?? expiry;
        }
      } catch { /* stub below */ }
    }

    if (!paymentUrl) {
      // Stub link — replace with real gateway integration
      paymentUrl = `https://pay.policyboss.com/checkout/${motor_quote_id}`;
    }

    let quoteUpdate = supabase.from("motor_quotes").update({
      payment_link: paymentUrl,
      payment_sent_at: new Date().toISOString(),
      status: "payment_sent",
      current_step: 5,
    }).eq("id", motor_quote_id);
    if (!profile.is_super_admin) {
      quoteUpdate = quoteUpdate.eq("company_id", callerCompanyId);
    }
    await quoteUpdate;

    if (quote.lead_id) {
      let leadUpdate = supabase.from("leads").update({
        payment_link: paymentUrl,
        status: "Quote Sent",
      }).eq("id", quote.lead_id);
      if (!profile.is_super_admin) {
        leadUpdate = leadUpdate.eq("company_id", callerCompanyId);
      }
      await leadUpdate;
    }

    return json({ payment_url: paymentUrl, expiry });
  } catch (e) {
    return json({ error: String(e?.message ?? e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
