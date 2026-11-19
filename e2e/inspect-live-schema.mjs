import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://lgqgnsngxhqdzpstiddj.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxncWduc25neGhxZHpwc3RpZGRqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxOTM2NTksImV4cCI6MjA5Mjc2OTY1OX0.P1GOBl3rK3P4gtzzp7B68c9zdw4mTo0_H-R6U0Dv5_Q";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function inspect() {
  console.log("=== Inspecting Live Supabase Schema & Auth Configuration ===");

  // 1. Check sign-in with known credentials
  const { data: auth, error: authErr } = await supabase.auth.signInWithPassword({
    email: "rahulpatidar1009@gmail.com",
    password: "Rewainsure@8085"
  });

  if (authErr) {
    console.error("Auth error with rahulpatidar1009@gmail.com:", authErr.message);
    // Try with rewainsure@gmail.com
    const { data: auth2, error: authErr2 } = await supabase.auth.signInWithPassword({
      email: "rewainsure@gmail.com",
      password: "Rewainsure@8085"
    });
    if (authErr2) {
      console.error("Auth error with rewainsure@gmail.com:", authErr2.message);
    } else {
      console.log("Logged in as rewainsure@gmail.com! User ID:", auth2.user.id);
    }
  } else {
    console.log("Logged in as rahulpatidar1009@gmail.com! User ID:", auth.user.id);
  }

  // 2. Query available roles in user_roles
  const { data: roles } = await supabase.from("user_roles").select("*");
  console.log("User roles visible to caller:", roles?.length, roles);

  // 3. Query profiles
  const { data: profiles } = await supabase.from("profiles").select("id, full_name, mobile, requested_role, is_approved, is_active, company_id, is_super_admin");
  console.log("Profiles visible to caller:", profiles?.length);
  if (profiles) {
    console.table(profiles);
  }

  // 4. Query companies
  const { data: companies } = await supabase.from("companies").select("id, name, code, is_active");
  console.log("Companies visible:", companies);

  // 5. Query leads count
  const { count: leadsCount } = await supabase.from("leads").select("*", { count: "exact", head: true });
  console.log("Total leads count visible:", leadsCount);

  // 6. Test invite_code_required RPC
  const { data: inviteReq, error: inviteErr } = await supabase.rpc("invite_code_required");
  console.log("invite_code_required RPC:", { inviteReq, error: inviteErr?.message });

  // 7. Check break_logs schema
  const { data: breakLogs, error: breakErr } = await supabase.from("break_logs").select("*").limit(1);
  console.log("break_logs sample:", breakLogs, "error:", breakErr?.message);
}

inspect().catch(console.error);
