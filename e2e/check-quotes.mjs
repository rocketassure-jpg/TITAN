import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://lgqgnsngxhqdzpstiddj.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxncWduc25neGhxZHpwc3RpZGRqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxOTM2NTksImV4cCI6MjA5Mjc2OTY1OX0.P1GOBl3rK3P4gtzzp7B68c9zdw4mTo0_H-R6U0Dv5_Q";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function checkQuotes() {
  const { data: authData } = await supabase.auth.signInWithPassword({
    email: "rahulpatidar1009@gmail.com",
    password: "Rewainsure@8085"
  });

  const { data: quotes, error: qErr } = await supabase
    .from("motor_quotes")
    .select("id, company_id, gross_premium, net_premium, status")
    .limit(5);

  console.log("Visible motor_quotes for Rahul:", JSON.stringify(quotes, null, 2));

  const { data: leads, error: lErr } = await supabase
    .from("leads")
    .select("id, customer_name, phone_number, company_id, status")
    .limit(5);

  console.log("Visible leads for Rahul:", JSON.stringify(leads, null, 2));
}

checkQuotes().catch(console.error);
