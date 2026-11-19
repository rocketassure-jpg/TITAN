import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "fs";
import path from "path";

const BASE_URL = "http://localhost:8081";
const SCREENSHOT_DIR = path.resolve("docs/audit/screenshots");
const AUDIT_DATA_FILE = path.resolve("docs/audit/ui-audit-data.json");

if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

const VIEWPORTS = [
  { name: "desktop-1440", width: 1440, height: 900 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "mobile-375", width: 375, height: 667 },
];

const ROUTES = [
  { path: "/", name: "landing" },
  { path: "/auth", name: "auth" },
  { path: "/reset-password", name: "reset-password" },
  { path: "/trust", name: "trust" },
  { path: "/404-test", name: "not-found" },
  { path: "/dashboard", name: "dashboard-redirect" },
  { path: "/telecaller", name: "telecaller-redirect" },
  { path: "/manager", name: "manager-redirect" },
  { path: "/admin", name: "admin-redirect" },
  { path: "/super-admin", name: "superadmin-redirect" },
  { path: "/super-admin/blueprint", name: "blueprint-redirect" },
];

async function runAudit() {
  console.log("Starting UI Audit across viewports and routes...");
  const browser = await chromium.launch({ headless: true });
  const report = {
    timestamp: new Date().toISOString(),
    viewports: VIEWPORTS,
    results: [],
    consoleErrors: [],
    overflowIssues: [],
    a11yViolations: [],
  };

  const context = await browser.newContext();

  for (const vp of VIEWPORTS) {
    console.log(`\n--- Auditing Viewport: ${vp.name} (${vp.width}x${vp.height}) ---`);
    const page = await context.newPage();
    await page.setViewportSize({ width: vp.width, height: vp.height });

    page.on("console", (msg) => {
      if (msg.type() === "error") {
        const text = msg.text();
        // Ignore expected net::ERR_CONNECTION_REFUSED if any mock API or external asset fails
        report.consoleErrors.push({
          viewport: vp.name,
          url: page.url(),
          text,
        });
      }
    });

    page.on("pageerror", (err) => {
      report.consoleErrors.push({
        viewport: vp.name,
        url: page.url(),
        text: `PAGE CRASH: ${err.message}`,
        stack: err.stack,
      });
    });

    for (const route of ROUTES) {
      const url = `${BASE_URL}${route.path}`;
      const targetName = `${route.name}-${vp.name}`;
      console.log(`Testing [${vp.name}] ${route.path}...`);

      const t0 = Date.now();
      try {
        const response = await page.goto(url, { waitUntil: "networkidle", timeout: 15000 }).catch(async () => {
          return await page.goto(url, { waitUntil: "domcontentloaded", timeout: 10000 });
        });
        const loadDurationMs = Date.now() - t0;
        await page.waitForTimeout(600);

        // Check horizontal overflow
        const overflow = await page.evaluate(() => {
          const docEl = document.documentElement;
          const body = document.body;
          const scrollWidth = Math.max(docEl.scrollWidth, body ? body.scrollWidth : 0);
          const clientWidth = docEl.clientWidth;
          const hasOverflow = scrollWidth > clientWidth;
          const overflowingElements = [];
          if (hasOverflow) {
            const allElements = document.querySelectorAll("*");
            for (const el of allElements) {
              const rect = el.getBoundingClientRect();
              if (rect.right > clientWidth + 2) {
                overflowingElements.push({
                  tag: el.tagName,
                  className: el.className?.toString().slice(0, 100),
                  right: rect.right,
                  clientWidth,
                });
                if (overflowingElements.length >= 5) break;
              }
            }
          }
          return { hasOverflow, scrollWidth, clientWidth, overflowingElements };
        });

        if (overflow.hasOverflow) {
          console.warn(`[OVERFLOW] ${targetName}: scrollWidth=${overflow.scrollWidth} > clientWidth=${overflow.clientWidth}`);
          report.overflowIssues.push({
            route: route.path,
            viewport: vp.name,
            ...overflow,
          });
        }

        // Accessibility audit on key screens
        let a11ySummary = null;
        if (["landing", "auth", "reset-password", "trust"].includes(route.name)) {
          try {
            const axeResults = await new AxeBuilder({ page }).analyze();
            a11ySummary = {
              violationsCount: axeResults.violations.length,
              violations: axeResults.violations.map((v) => ({
                id: v.id,
                impact: v.impact,
                description: v.description,
                help: v.help,
                nodesCount: v.nodes.length,
                helpUrl: v.helpUrl,
              })),
            };
            if (axeResults.violations.length > 0) {
              report.a11yViolations.push({
                route: route.path,
                viewport: vp.name,
                violations: a11ySummary.violations,
              });
            }
          } catch (axeErr) {
            console.warn(`Axe failed on ${targetName}:`, axeErr.message);
          }
        }

        // Screenshot Light Mode
        const ssPath = path.join(SCREENSHOT_DIR, `${targetName}-light.png`);
        await page.screenshot({ path: ssPath, fullPage: true });

        // If landing page, test opening the calculator modal
        if (route.name === "landing" && vp.name === "desktop-1440") {
          try {
            const calcBtn = page.getByRole("button", { name: /Premium Calculator/i }).first();
            if (await calcBtn.isVisible()) {
              await calcBtn.click();
              await page.waitForTimeout(500);
              const modalPath = path.join(SCREENSHOT_DIR, `landing-calculator-modal-${vp.name}.png`);
              await page.screenshot({ path: modalPath });
              // Close modal
              await page.keyboard.press("Escape");
              await page.waitForTimeout(300);
            }
          } catch (e) {
            console.warn("Could not test calculator modal:", e.message);
          }
        }

        // If auth page, test switching to signup tab and toggling modes
        if (route.name === "auth" && vp.name === "desktop-1440") {
          try {
            const signupTab = page.getByRole("tab", { name: /Sign up/i });
            if (await signupTab.isVisible()) {
              await signupTab.click();
              await page.waitForTimeout(400);
              const authSignupPath = path.join(SCREENSHOT_DIR, `auth-signup-tab-${vp.name}.png`);
              await page.screenshot({ path: authSignupPath });

              // Switch to "Join Company"
              const joinBtn = page.getByRole("button", { name: /Join Company/i });
              if (await joinBtn.isVisible()) {
                await joinBtn.click();
                await page.waitForTimeout(300);
                const authJoinPath = path.join(SCREENSHOT_DIR, `auth-join-company-${vp.name}.png`);
                await page.screenshot({ path: authJoinPath });
              }
            }
          } catch (e) {
            console.warn("Could not test auth tabs:", e.message);
          }
        }

        // Test Dark Theme toggle if available
        let darkTested = false;
        try {
          const darkBtn = page.locator("button[aria-label='Toggle theme']").or(page.getByRole("button", { name: /Dark/i }));
          if (await darkBtn.first().isVisible({ timeout: 1000 })) {
            await darkBtn.first().click();
            await page.waitForTimeout(400);
            const ssDarkPath = path.join(SCREENSHOT_DIR, `${targetName}-dark.png`);
            await page.screenshot({ path: ssDarkPath, fullPage: true });
            darkTested = true;
          }
        } catch {
          // No theme toggle on this page or not visible
        }

        report.results.push({
          route: route.path,
          name: route.name,
          viewport: vp.name,
          status: response ? response.status() : "no-response",
          finalUrl: page.url(),
          loadDurationMs,
          overflow,
          a11ySummary,
          darkTested,
        });

      } catch (err) {
        console.error(`ERROR on [${vp.name}] ${route.path}:`, err.message);
        report.results.push({
          route: route.path,
          name: route.name,
          viewport: vp.name,
          error: err.message,
        });
      }
    }
    await page.close();
  }

  await browser.close();

  fs.writeFileSync(AUDIT_DATA_FILE, JSON.stringify(report, null, 2));
  console.log(`\nUI Audit complete! Results saved to ${AUDIT_DATA_FILE}`);
  console.log(`Screenshots captured in: ${SCREENSHOT_DIR}`);
  console.log(`Total overflow issues: ${report.overflowIssues.length}`);
  console.log(`Total a11y violation records: ${report.a11yViolations.length}`);
  console.log(`Total console errors: ${report.consoleErrors.length}`);
}

runAudit().catch(console.error);
