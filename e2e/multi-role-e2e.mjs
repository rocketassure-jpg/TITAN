import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const BASE_URL = "http://localhost:8081";
const SCREENSHOT_DIR = path.resolve("docs/audit/screenshots/roles");
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

function getSha256(filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  const hashSum = crypto.createHash("sha256");
  hashSum.update(fileBuffer);
  return hashSum.digest("hex");
}

const audit = {
  timestamp: new Date().toISOString(),
  rolesTested: [],
  networkPiiAudits: [],
  unauthorizedRejections: []
};

async function testRole(browser, { roleName, roleString, isSuperAdmin, expectedDefaultRoute, unauthorizedRoutes, testWorkflows }) {
  console.log(`\n========================================`);
  console.log(`TESTING ROLE: ${roleName} (roleString: ${roleString}, isSuperAdmin: ${isSuperAdmin})`);
  console.log(`========================================`);

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  // Route interception to enforce genuine role persona
  await page.route("**/rest/v1/user_roles*", async (route) => {
    const json = [{ user_id: "test-user-id-56ec0517", role: roleString }];
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(json) });
  });

  await page.route("**/rest/v1/profiles*", async (route) => {
    const json = [{
      id: "test-user-id-56ec0517",
      full_name: `Test ${roleName}`,
      is_active: true,
      is_approved: true,
      is_super_admin: isSuperAdmin,
      company_id: "test-company-rewa",
      rejection_reason: null,
      branch_id: null,
      mobile: "9876543210"
    }];
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(json) });
  });

  // Track network responses for PII auditing (SEC-04)
  let rawPiiExposedInNetwork = false;
  page.on("response", async (res) => {
    if (res.url().includes("/rest/v1/leads")) {
      try {
        const text = await res.text();
        if (text.includes("phone_number") && text.match(/[0-9]{10}/)) {
          rawPiiExposedInNetwork = true;
        }
      } catch {}
    }
  });

  // 1. Login with credentials
  await page.goto(`${BASE_URL}/auth`, { waitUntil: "domcontentloaded" });
  await page.fill("#se", "rahulpatidar1009@gmail.com");
  await page.fill("#sp", "Rewainsure@8085");
  await page.click('button[type="submit"]:has-text("Sign in")');

  // Wait for post-login redirection
  await page.waitForURL((url) => !url.pathname.includes("/auth"), { timeout: 15000 });
  await page.waitForTimeout(2000);

  const initialUrl = page.url();
  console.log(`[PASS] Login successful for ${roleName}. Redirected to: ${initialUrl}`);

  // 2. Verify Default Dashboard
  await page.goto(`${BASE_URL}/dashboard`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  const dashboardTarget = page.url();
  const matchedExpectedDashboard = dashboardTarget.includes(expectedDefaultRoute);
  console.log(`[${matchedExpectedDashboard ? "PASS" : "FAIL"}] /dashboard for ${roleName} routed to: ${dashboardTarget} (Expected: ${expectedDefaultRoute})`);

  // Capture screenshot of authenticated role dashboard
  const shotPath = path.join(SCREENSHOT_DIR, `${roleName.toLowerCase()}-dashboard.png`);
  await page.screenshot({ path: shotPath });
  const shotHash = getSha256(shotPath);

  // 3. Test Unauthorized Route Rejections
  const rejectionResults = [];
  for (const unauthRoute of unauthorizedRoutes) {
    await page.goto(`${BASE_URL}${unauthRoute}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    const landedUrl = page.url();
    const rejected = !landedUrl.includes(unauthRoute);
    rejectionResults.push({ route: unauthRoute, landedUrl, rejected });
    console.log(`[${rejected ? "PASS" : "FAIL"}] Unauthorized access to ${unauthRoute}: Redirected to ${landedUrl}`);
  }

  // 4. Role-specific workflows
  const workflowResults = await testWorkflows(page);

  // 5. Logout & Session Check
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${BASE_URL}/dashboard`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1000);
  const loggedOut = page.url().includes("/auth");
  console.log(`[${loggedOut ? "PASS" : "FAIL"}] Session cleared redirects to /auth: ${page.url()}`);

  audit.rolesTested.push({
    roleName,
    roleString,
    isSuperAdmin,
    defaultRouteCheck: { expected: expectedDefaultRoute, actual: dashboardTarget, status: matchedExpectedDashboard ? "PASS" : "FAIL" },
    rejections: rejectionResults,
    workflows: workflowResults,
    rawPiiExposedInNetwork,
    screenshot: { path: shotPath, hash: shotHash }
  });

  await context.close();
}

async function run() {
  console.log("Starting Multi-Role Authenticated E2E Suite...");
  const browser = await chromium.launch({ headless: true });

  // 1. Admin Role
  await testRole(browser, {
    roleName: "Admin",
    roleString: "admin",
    isSuperAdmin: false,
    expectedDefaultRoute: "/admin",
    unauthorizedRoutes: ["/super-admin"],
    testWorkflows: async (page) => {
      await page.goto(`${BASE_URL}/admin`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1000);
      const branchesTab = page.locator("button:has-text('Branches')").first();
      const hasBranches = await branchesTab.isVisible();
      return [{ workflow: "Admin Branches Tab Visible", passed: hasBranches }];
    }
  });

  // 2. Manager Role
  await testRole(browser, {
    roleName: "Manager",
    roleString: "manager",
    isSuperAdmin: false,
    expectedDefaultRoute: "/manager",
    unauthorizedRoutes: ["/admin", "/super-admin"],
    testWorkflows: async (page) => {
      await page.goto(`${BASE_URL}/manager`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1000);
      const teamHeader = (await page.getByText(/My Team|Team|Manager/i).count() > 0);
      return [{ workflow: "Manager Team Panel Rendered", passed: teamHeader }];
    }
  });

  // 3. Telecaller Role
  await testRole(browser, {
    roleName: "Telecaller",
    roleString: "telecaller",
    isSuperAdmin: false,
    expectedDefaultRoute: "/telecaller",
    unauthorizedRoutes: ["/admin", "/manager", "/super-admin"],
    testWorkflows: async (page) => {
      await page.goto(`${BASE_URL}/telecaller`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1000);
      const callingTable = (await page.locator("table").count() > 0) || (await page.getByText(/Queue|Calling|Leads/i).count() > 0);
      return [{ workflow: "Telecaller Calling Queue Rendered", passed: callingTable }];
    }
  });

  // 4. Sub-Agent Role
  await testRole(browser, {
    roleName: "SubAgent",
    roleString: "sub_agent",
    isSuperAdmin: false,
    expectedDefaultRoute: "/sub-agent",
    unauthorizedRoutes: ["/admin", "/manager", "/telecaller", "/super-admin"],
    testWorkflows: async (page) => {
      await page.goto(`${BASE_URL}/sub-agent`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1000);
      const subAgentHeader = (await page.getByText(/Sub-Agent|Dashboard|Policies/i).count() > 0);
      return [{ workflow: "Sub-Agent Dashboard Rendered", passed: subAgentHeader }];
    }
  });

  // 5. Super Admin Role
  await testRole(browser, {
    roleName: "SuperAdmin",
    roleString: "admin",
    isSuperAdmin: true,
    expectedDefaultRoute: "/admin", // Dashboard redirects admin to /admin, but super-admin route is accessible
    unauthorizedRoutes: [], // Super Admin has access to all routes
    testWorkflows: async (page) => {
      await page.goto(`${BASE_URL}/super-admin`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1000);
      const currentUrl = page.url();
      const superAdminAccessible = currentUrl.includes("/super-admin");
      return [{ workflow: "Super Admin Route Accessible", passed: superAdminAccessible }];
    }
  });

  await browser.close();

  fs.writeFileSync("docs/audit/multi-role-e2e-report.json", JSON.stringify(audit, null, 2));
  console.log("\nMulti-Role E2E Complete! Report written to docs/audit/multi-role-e2e-report.json");
}

run().catch((err) => {
  console.error("Multi-role E2E error:", err);
  process.exit(1);
});
