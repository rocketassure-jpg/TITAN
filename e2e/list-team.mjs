import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://lgqgnsngxhqdzpstiddj.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxncWduc25neGhxZHpwc3RpZGRqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxOTM2NTksImV4cCI6MjA5Mjc2OTY1OX0.P1GOBl3rK3P4gtzzp7B68c9zdw4mTo0_H-R6U0Dv5_Q";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function main() {
  let authData, authError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await supabase.auth.signInWithPassword({
        email: "rahulpatidar1009@gmail.com",
        password: "Rewainsure@8085"
      });
      authData = res.data;
      authError = res.error;
      if (!authError) break;
    } catch (e) {
      authError = e;
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  if (authError) {
    console.error("Auth error:", authError.message);
    return;
  }

  const { data: profiles, error: pErr } = await supabase.from("profiles").select("id,full_name,is_active,is_approved,company_id,branch_id,mobile,requested_role");
  console.log("Profiles count:", profiles?.length, "Error:", pErr);
  if (profiles) {
    profiles.forEach(p => {
      console.log(`- ${p.full_name || 'No name'} (${p.id}): roles=[${(roleMap.get(p.id) || []).join(',')}], active=${p.is_active}, approved=${p.is_approved}, mobile=${p.mobile}, reqRole=${p.requested_role}`);
    });
  }

  const { data: companies } = await supabase.from("companies").select("id,name,company_code,is_active");
  console.log("Companies:", companies);
}

main().catch(console.error);
