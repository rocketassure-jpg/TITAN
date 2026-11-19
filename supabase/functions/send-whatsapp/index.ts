import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    const token = authHeader.replace("Bearer ", "");
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    const userId = user.id;

    // Verify caller profile status (must be active and approved)
    const { data: profile } = await supabase
      .from("profiles")
      .select("company_id, is_active, is_approved")
      .eq("id", userId)
      .maybeSingle();

    if (!profile || !profile.is_active || !profile.is_approved) {
      return new Response(JSON.stringify({ error: "Account inactive or pending approval" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Role check — must be telecaller/manager/admin to send on company WhatsApp
    const { data: roleRow } = await supabase
      .from("user_roles").select("role").eq("user_id", userId)
      .in("role", ["admin", "manager", "telecaller"]).maybeSingle();
    if (!roleRow) return new Response(JSON.stringify({ error: "Forbidden: insufficient role" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { lead_id, phone_number, template, message } = await req.json();
    if (!phone_number || !template) return new Response(JSON.stringify({ error: "phone_number and template required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (typeof phone_number !== "string" || phone_number.length > 20) return new Response(JSON.stringify({ error: "Invalid phone" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const safeMsg = String(message || "").slice(0, 1500);
    const safeTpl = String(template).slice(0, 200);

    // If lead_id is provided, enforce tenant boundary
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

    const token = Deno.env.get("META_WHATSAPP_TOKEN");
    const phoneId = Deno.env.get("META_WHATSAPP_PHONE_ID");
    let status = "sent";
    let errorMsg: string | null = null;

    if (!token || !phoneId) {
      status = "skipped";
      errorMsg = "META_WHATSAPP_TOKEN / META_WHATSAPP_PHONE_ID not configured";
    } else {
      const cleaned = phone_number.replace(/\D/g, "");
      const body: any = {
        messaging_product: "whatsapp",
        to: cleaned,
        type: "text",
        text: { body: safeMsg || `Hello! ${safeTpl}` },
      };
      const r = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) { status = "failed"; errorMsg = await r.text(); }
    }

    await supabase.from("whatsapp_logs").insert({ lead_id: lead_id || null, phone_number, template: safeTpl, message: safeMsg, status, error: errorMsg, sent_by: userId });
    return new Response(JSON.stringify({ ok: status !== "failed", status, error: errorMsg }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
