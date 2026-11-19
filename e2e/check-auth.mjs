import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://lgqgnsngxhqdzpstiddj.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxncWduc25neGhxZHpwc3RpZGRqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxOTM2NTksImV4cCI6MjA5Mjc2OTY1OX0.P1GOBl3rK3P4gtzzp7B68c9zdw4mTo0_H-R6U0Dv5_Q";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function main() {
  console.log("Attempting sign in with rahulpatidar1009@gmail.com...");
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: "rahulpatidar1009@gmail.com",
    password: "Rewainsure@8085"
  });

  if (authError) {
    console.error("Sign-in failed:", authError.message);
    return;
  }

  const user = authData.user;
  console.log("Sign-in successful!");
  console.log("User ID:", user.id);
  console.log("Email:", user.email);

  // Query profile
  const { data: profile, error: profError } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (profError) {
    console.error("Profile query error:", profError);
  } else {
    console.log("Profile:", JSON.stringify(profile, null, 2));
  }

  // Query user_roles
  const { data: roles, error: rolesError } = await supabase
    .from("user_roles")
    .select("*")
    .eq("user_id", user.id);

  if (rolesError) {
    console.error("Roles query error:", rolesError);
  } else {
    console.log("Roles:", JSON.stringify(roles, null, 2));
  }

  // Query company
  if (profile?.company_id) {
    const { data: company, error: coError } = await supabase
      .from("companies")
      .select("*")
      .eq("id", profile.company_id)
      .maybeSingle();
    console.log("Company:", JSON.stringify(company, null, 2));
  }
}

main().catch(console.error);
