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

    // Role check — must be telecaller/manager/admin to send messages on company accounts
    const { data: roleRow } = await supabase
      .from("user_roles").select("role").eq("user_id", userId)
      .in("role", ["admin", "manager", "telecaller"]).maybeSingle();
    if (!roleRow) return new Response(JSON.stringify({ error: "Forbidden: insufficient role" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { lead_id, phone_number, message } = await req.json();
    if (!phone_number || !message) return new Response(JSON.stringify({ error: "phone_number and message required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    // Input limits and formatting validation to prevent abuse and billing spikes
    const cleanedPhone = String(phone_number).replace(/[\s-]/g, "");
    if (!/^\+?[1-9]\d{6,14}$/.test(cleanedPhone)) {
      return new Response(JSON.stringify({ error: "Invalid phone number format" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (typeof message !== "string" || message.trim().length === 0) {
      return new Response(JSON.stringify({ error: "Message cannot be empty" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const msg = message.trim().slice(0, 500);

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

    const sid = Deno.env.get("TWILIO_ACCOUNT_SID");
    const tok = Deno.env.get("TWILIO_AUTH_TOKEN");
    const from = Deno.env.get("TWILIO_FROM_NUMBER");
    let status = "sent";
    let errorMsg: string | null = null;

    if (!sid || !tok || !from) {
      status = "skipped";
      errorMsg = "Twilio credentials not configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER)";
    } else {
      const auth = btoa(`${sid}:${tok}`);
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: "POST",
        headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ To: phone_number, From: from, Body: msg }),
      });
      if (!r.ok) { status = "failed"; errorMsg = await r.text(); }
    }

    await supabase.from("sms_logs").insert({ lead_id: lead_id || null, phone_number, message: msg, status, error: errorMsg, sent_by: userId });
    return new Response(JSON.stringify({ ok: status !== "failed", status, error: errorMsg }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
