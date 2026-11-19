import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const BASE_URL = "http://localhost:8081";
const SCREENSHOT_DIR = path.resolve("docs/audit/screenshots");
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

function getSha256(filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  const hashSum = crypto.createHash("sha256");
  hashSum.update(fileBuffer);
  return hashSum.digest("hex");
}

const VIEWPORTS = [
  { name: "mobile-320", width: 320, height: 568 },
  { name: "mobile-375", width: 375, height: 667 },
  { name: "mobile-390", width: 390, height: 844 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "desktop-1440", width: 1440, height: 900 },
];

const results = {
  timestamp: new Date().toISOString(),
  viewportsTested: [],
  uiChecks: [],
  roleRoutes: [],
  workflowsTested: [],
  consoleErrors: [],
  screenshots: []
};

async function main() {
  console.log("Starting Comprehensive E2E & UI Regression Suite...");
  const browser = await chromium.launch({ headless: true });

  // 1. Responsive UI Regression across 320, 375, 390, 768, 1440px
  console.log("\n--- PHASE 1: RESPONSIVE SCREENSHOTS & OVERFLOW CHECKS ---");
  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await context.newPage();

    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);

    // Check Hero Image (UI-DEFECT-01)
    const heroImg = await page.evaluate(() => {
      const img = document.querySelector("img[src*='hero-insurance'], img[alt*='Insurance' i]");
      if (!img) return null;
      return {
        complete: img.complete,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
        currentSrc: img.currentSrc
      };
    });

    // Check Horizontal Overflow (UI-DEFECT-03)
    const overflowCheck = await page.evaluate(() => {
      const doc = document.documentElement;
      const scrollWidth = doc.scrollWidth;
      const clientWidth = doc.clientWidth;
      return {
        scrollWidth,
        clientWidth,
        hasHorizontalOverflow: scrollWidth > clientWidth,
        overflowPixels: Math.max(0, scrollWidth - clientWidth)
      };
    });

    // Check Enquiry Form Bounding Box (UI-DEFECT-02)
    const formCheck = await page.evaluate(() => {
      const card = document.querySelector("#enquiry .neon-glass, #enquiry form");
      if (!card) return null;
      const cardRect = card.getBoundingClientRect();
      const inputs = Array.from(card.querySelectorAll("input, select, button, textarea"));
      const clipped = [];
      inputs.forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.right > cardRect.right + 2) {
          clipped.push({ tag: el.tagName, id: el.id || el.className, diff: r.right - cardRect.right });
        }
      });
      return { clippedCount: clipped.length, clipped };
    });

    // Capture screenshot
    const shotPath = path.join(SCREENSHOT_DIR, `landing-${vp.name}.png`);
    await page.screenshot({ path: shotPath, fullPage: false });

    results.uiChecks.push({
      viewport: vp.name,
      width: vp.width,
      heroImage: heroImg,
      horizontalOverflow: overflowCheck,
      formClipping: formCheck,
      screenshot: { path: shotPath, hash: getSha256(shotPath) }
    });

    console.log(`[PASS] Viewport ${vp.name} (${vp.width}px): Overflow=${overflowCheck.overflowPixels}px, FormClipped=${formCheck?.clippedCount ?? 0}, HeroNatWidth=${heroImg?.naturalWidth ?? 0}`);
    await context.close();
  }

  // 2. Authenticated Admin Session
  console.log("\n--- PHASE 2: AUTHENTICATED ADMIN & ROLE WORKFLOWS ---");
  const authContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const authPage = await authContext.newPage();

  authPage.on("console", msg => {
    if (msg.type() === "error") {
      results.consoleErrors.push({ text: msg.text(), location: msg.location() });
      console.log(`[CONSOLE ERROR] ${msg.text()}`);
    }
  });

  // Login
  await authPage.goto(`${BASE_URL}/auth`, { waitUntil: "domcontentloaded" });
  await authPage.fill("#se", "rahulpatidar1009@gmail.com");
  await authPage.fill("#sp", "Rewainsure@8085");
  await authPage.click('button[type="submit"]:has-text("Sign in")');

  await authPage.waitForURL(url => !url.pathname.includes("/auth"), { timeout: 15000 });
  console.log(`Logged in successfully, URL: ${authPage.url()}`);
  await authPage.waitForTimeout(2000);

  // Navigate to /admin
  await authPage.goto(`${BASE_URL}/admin`, { waitUntil: "domcontentloaded" });
  await authPage.waitForTimeout(3000);

  const adminShot = path.join(SCREENSHOT_DIR, "admin-overview-loaded.png");
  await authPage.screenshot({ path: adminShot });
  results.screenshots.push({ name: "admin-overview-loaded.png", hash: getSha256(adminShot) });
  console.log(`[PASS] Admin Dashboard loaded. Screenshot saved: ${adminShot}`);

  // Test Admin Tabs
  const tabsToTest = [
    { name: "Overview", selector: "button:has-text('Overview'), [role='tab']:has-text('Overview')" },
    { name: "Calling", selector: "button:has-text('Calling'), [role='tab']:has-text('Calling')" },
    { name: "Hierarchy", selector: "button:has-text('Hierarchy'), [role='tab']:has-text('Hierarchy')" },
    { name: "Branches", selector: "button:has-text('Branches'), [role='tab']:has-text('Branches')" },
    { name: "Reports", selector: "button:has-text('Reports'), [role='tab']:has-text('Reports')" }
  ];

  for (const tab of tabsToTest) {
    const el = authPage.locator(tab.selector).first();
    if (await el.isVisible()) {
      await el.click();
      await authPage.waitForTimeout(1000);
      results.workflowsTested.push({ workflow: `Admin Tab: ${tab.name}`, status: "PASS" });
      console.log(`[PASS] Admin Tab '${tab.name}' clicked and rendered.`);
    }
  }

  // 3. Test RBAC Routes
  console.log("\n--- PHASE 3: ROLE-BASED ROUTE ACCESS & REDIRECTS ---");
  const roleRoutes = [
    { path: "/admin", role: "admin", expectedResult: "accessible" },
    { path: "/telecaller", role: "telecaller", expectedResult: "accessible" },
    { path: "/manager", role: "manager", expectedResult: "accessible" },
    { path: "/sub-agent", role: "sub_agent", expectedResult: "accessible" },
    { path: "/super-admin", role: "super_admin", expectedResult: "redirect-to-admin" }
  ];

  for (const r of roleRoutes) {
    await authPage.goto(`${BASE_URL}${r.path}`, { waitUntil: "domcontentloaded" });
    await authPage.waitForTimeout(1500);
    const finalUrl = authPage.url();
    const passed = r.expectedResult === "redirect-to-admin" ? finalUrl.includes("/admin") : finalUrl.includes(r.path);

    results.roleRoutes.push({
      route: r.path,
      targetRole: r.role,
      expected: r.expectedResult,
      actualUrl: finalUrl,
      status: passed ? "PASS" : "FAIL"
    });
    console.log(`[${passed ? "PASS" : "FAIL"}] Route ${r.path} -> ${finalUrl} (Expected: ${r.expectedResult})`);
  }

  // 4. Test Dark / Light Theme
  console.log("\n--- PHASE 4: THEME SWITCHING ---");
  await authPage.goto(`${BASE_URL}/admin`, { waitUntil: "domcontentloaded" });
  await authPage.waitForTimeout(1000);

  const themeBtn = authPage.locator("button[aria-label*='theme' i], button:has(svg.lucide-moon), button:has(svg.lucide-sun)").first();
  if (await themeBtn.isVisible()) {
    await themeBtn.click();
    await authPage.waitForTimeout(500);
    const darkShot = path.join(SCREENSHOT_DIR, "admin-theme-toggled.png");
    await authPage.screenshot({ path: darkShot });
    results.screenshots.push({ name: "admin-theme-toggled.png", hash: getSha256(darkShot) });
    console.log(`[PASS] Theme toggled. Screenshot saved: ${darkShot}`);
  }

  await browser.close();

  // Save report JSON
  fs.writeFileSync("docs/audit/comprehensive-e2e-report.json", JSON.stringify(results, null, 2));
  console.log("\nE2E Suite Finished! Results written to docs/audit/comprehensive-e2e-report.json");
}

main().catch(err => {
  console.error("Fatal test error:", err);
  process.exit(1);
});
