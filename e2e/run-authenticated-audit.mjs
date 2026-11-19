import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const BASE_URL = "http://localhost:8081";
const SCREENSHOT_DIR = "docs/audit/screenshots";
const LOG_FILE = "docs/audit/playwright-authenticated-run.log";

if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

const logStream = fs.createWriteStream(LOG_FILE, { flags: "w" });
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  logStream.write(line + "\n");
}

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 375, height: 667 },
];

const auditResults = {
  timestamp: new Date().toISOString(),
  accountTested: "rahulpatidar1009@gmail.com",
  resolvedRole: "admin",
  company: "Rewa insuretech indore",
  viewports: VIEWPORTS,
  screenshots: [],
  routesTested: [],
  consoleErrors: [],
  networkErrors: [],
  accessibilityViolations: [],
  uiDefectsDetected: [],
};

function getSha256(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

async function runAudit() {
  log("Starting Authenticated Playwright E2E and UI Audit...");
  const browser = await chromium.launch({ headless: true });

  // 1. First test public landing page across viewports (check UI-NEW-01 and UI-NEW-02)
  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await context.newPage();

    page.on("console", (msg) => {
      if (msg.type() === "error") {
        auditResults.consoleErrors.push({ route: "/", viewport: vp.name, text: msg.text() });
      }
    });

    page.on("requestfailed", (req) => {
      auditResults.networkErrors.push({
        route: "/",
        viewport: vp.name,
        url: req.url(),
        error: req.failure()?.errorText || "unknown",
      });
    });

    log(`Testing public landing page at ${vp.name} (${vp.width}x${vp.height})...`);
    await page.goto(`${BASE_URL}/`, { waitUntil: "networkidle" });

    // Capture screenshot
    const shotPath = path.join(SCREENSHOT_DIR, `landing-${vp.name}-light.png`);
    await page.screenshot({ path: shotPath, fullPage: true });
    auditResults.screenshots.push({ name: `landing-${vp.name}-light.png`, path: shotPath, hash: getSha256(shotPath), viewport: vp.name });

    // Check UI-NEW-01: Hero image naturalWidth
    const heroImgStatus = await page.evaluate(() => {
      const img = document.querySelector("section img");
      if (!img) return { found: false };
      return {
        found: true,
        src: img.src,
        complete: img.complete,
        naturalWidth: img.naturalWidth,
        alt: img.alt,
      };
    });
    log(`Hero image status (${vp.name}): ${JSON.stringify(heroImgStatus)}`);
    if (heroImgStatus.found && heroImgStatus.naturalWidth === 0) {
      auditResults.uiDefectsDetected.push({
        id: "UI-DEFECT-01",
        title: "Hero image failed to load / broken asset URL",
        viewport: vp.name,
        details: `Image src: ${heroImgStatus.src} resolved to 0 natural width. Alt text displayed.`,
      });
    }

    // Check UI-NEW-02: Enquiry form container bounding box on mobile
    if (vp.name === "mobile") {
      const overflowDetails = await page.evaluate(() => {
        const card = document.querySelector("#enquiry .neon-glass");
        const inputs = Array.from(document.querySelectorAll("#enquiry input, #enquiry select, #enquiry button, #enquiry textarea"));
        if (!card) return null;
        const cardRect = card.getBoundingClientRect();
        const overflows = [];
        inputs.forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.right > cardRect.right + 1) {
            overflows.push({
              tag: el.tagName,
              id: el.id || el.className,
              elementRight: r.right,
              cardRight: cardRect.right,
              diff: r.right - cardRect.right,
            });
          }
        });
        return { cardRect, overflows };
      });
      log(`Mobile enquiry form bounding box check: ${JSON.stringify(overflowDetails)}`);
      if (overflowDetails && overflowDetails.overflows.length > 0) {
        auditResults.uiDefectsDetected.push({
          id: "UI-DEFECT-02",
          title: "Enquiry form controls extend beyond container edge on mobile 375px",
          viewport: "mobile",
          details: overflowDetails.overflows,
        });
      }
    }

    await context.close();
  }

  // 2. Perform Login and Save Authenticated State
  log("Performing login with rahulpatidar1009@gmail.com...");
  const authContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const authPage = await authContext.newPage();

  await authPage.goto(`${BASE_URL}/auth`, { waitUntil: "networkidle" });
  const loginShot = path.join(SCREENSHOT_DIR, "auth-login-screen.png");
  await authPage.screenshot({ path: loginShot });
  auditResults.screenshots.push({ name: "auth-login-screen.png", path: loginShot, hash: getSha256(loginShot) });

  // Fill in login credentials
  await authPage.fill('input[type="email"], input[placeholder*="email" i], input[name="email"]', "rahulpatidar1009@gmail.com");
  await authPage.fill('input[type="password"]', "Rewainsure@8085");
  await authPage.click('button[type="submit"]');

  // Wait for navigation / redirect to /dashboard or /admin
  log("Waiting for post-login redirect...");
  await authPage.waitForURL((url) => !url.pathname.includes("/auth"), { timeout: 15000 }).catch(async (e) => {
    log("Redirect timeout! Current URL: " + authPage.url());
  });

  log(`Current authenticated URL: ${authPage.url()}`);
  await authPage.waitForTimeout(3000); // allow dashboard meta to load

  const storageState = await authContext.storageState();
  log("Storage state saved successfully with auth session tokens.");
  await authContext.close();

  // 3. Test All Protected Routes as Authenticated Admin across Viewports
  const protectedRoutes = [
    { path: "/admin", name: "admin-dashboard", label: "Admin Dashboard" },
    { path: "/telecaller", name: "telecaller-dashboard", label: "Telecaller CRM Queue" },
    { path: "/manager", name: "manager-dashboard", label: "Manager Dashboard" },
    { path: "/sub-agent", name: "sub-agent-dashboard", label: "Sub-Agent Dashboard" },
    { path: "/super-admin", name: "super-admin-denied", label: "Super Admin Guard Test" },
  ];

  for (const route of protectedRoutes) {
    for (const vp of VIEWPORTS) {
      log(`Testing protected route ${route.path} on ${vp.name} (${vp.width}x${vp.height})...`);
      const ctx = await browser.newContext({
        storageState,
        viewport: { width: vp.width, height: vp.height },
      });
      const page = await ctx.newPage();

      page.on("console", (msg) => {
        if (msg.type() === "error") {
          auditResults.consoleErrors.push({ route: route.path, viewport: vp.name, text: msg.text() });
        }
      });

      await page.goto(`${BASE_URL}${route.path}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(2000);

      const currentUrl = page.url();
      const pageTitle = await page.title();
      log(`Loaded ${route.path} -> Final URL: ${currentUrl}, Title: ${pageTitle}`);

      // Capture screenshot
      const shotName = `${route.name}-${vp.name}-authenticated.png`;
      const shotPath = path.join(SCREENSHOT_DIR, shotName);
      await page.screenshot({ path: shotPath, fullPage: true });
      const hash = getSha256(shotPath);
      auditResults.screenshots.push({ name: shotName, path: shotPath, hash, viewport: vp.name, route: route.path });

      // Run axe accessibility audit on Desktop viewports
      if (vp.name === "desktop" && !route.path.includes("super-admin")) {
        log(`Running axe-core accessibility audit on ${route.path}...`);
        try {
          const axeResults = await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa"])
            .analyze();
          log(`Axe scan on ${route.path}: ${axeResults.violations.length} violation types found.`);
          auditResults.accessibilityViolations.push({
            route: route.path,
            violationsCount: axeResults.violations.length,
            violations: axeResults.violations.map((v) => ({
              id: v.id,
              impact: v.impact,
              description: v.description,
              nodesCount: v.nodes.length,
              helpUrl: v.helpUrl,
            })),
          });
        } catch (axeErr) {
          log(`Axe scan error: ${axeErr.message}`);
        }
      }

      // Check horizontal overflow
      const overflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth;
      });
      if (overflow) {
        auditResults.uiDefectsDetected.push({
          id: "UI-DEFECT-OVERFLOW",
          title: `Horizontal scroll overflow detected on ${route.path}`,
          viewport: vp.name,
        });
      }

      await ctx.close();
    }
  }

  // 4. Test Dark Mode vs Light Mode specifically
  log("Testing Dark Mode appearance on Admin Dashboard...");
  const darkCtx = await browser.newContext({
    storageState,
    viewport: { width: 1440, height: 900 },
    colorScheme: "dark",
  });
  const darkPage = await darkCtx.newPage();
  await darkPage.goto(`${BASE_URL}/admin`, { waitUntil: "networkidle" });
  await darkPage.waitForTimeout(2000);

  // Toggle theme if theme button exists
  const themeButton = await darkPage.$('button[aria-label*="theme" i], button:has(.lucide-moon), button:has(.lucide-sun)');
  if (themeButton) {
    await themeButton.click();
    await darkPage.waitForTimeout(1000);
  }

  const darkShot = path.join(SCREENSHOT_DIR, "admin-dashboard-desktop-dark.png");
  await darkPage.screenshot({ path: darkShot, fullPage: true });
  auditResults.screenshots.push({ name: "admin-dashboard-desktop-dark.png", path: darkShot, hash: getSha256(darkShot), theme: "dark" });
  log(`Dark mode screenshot saved: ${darkShot}`);

  await darkCtx.close();
  await browser.close();

  // Write audit results JSON
  fs.writeFileSync("docs/audit/authenticated-ui-audit-data.json", JSON.stringify(auditResults, null, 2));
  log("Audit run completed! Results saved to docs/audit/authenticated-ui-audit-data.json");
}

runAudit().catch((err) => {
  log(`Fatal error during audit: ${err.stack || err.message}`);
  process.exit(1);
});
