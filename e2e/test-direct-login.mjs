import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://lgqgnsngxhqdzpstiddj.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxncWduc25neGhxZHpwc3RpZGRqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxOTM2NTksImV4cCI6MjA5Mjc2OTY1OX0.P1GOBl3rK3P4gtzzp7B68c9zdw4mTo0_H-R6U0Dv5_Q";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function test() {
  const { data: auth, error } = await supabase.auth.signInWithPassword({
    email: "rahulpatidar1009@gmail.com",
    password: "Rewainsure@8085"
  });
  console.log("Direct login:", { user: auth?.user?.email, error: error?.message });
}

test().catch(console.error);
