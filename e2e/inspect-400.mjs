import { chromium } from "@playwright/test";

async function inspect400() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  page.on("response", async (res) => {
    if (res.status() >= 400) {
      let body = "";
      try {
        body = await res.text();
      } catch (e) {}
      console.log(`[HTTP ${res.status()}] ${res.url()} -> Body: ${body}`);
    }
  });

  // Login
  await page.goto("http://localhost:8081/auth");
  await page.fill('input[type="email"], input[placeholder*="email" i], input[name="email"]', "rahulpatidar1009@gmail.com");
  await page.fill('input[type="password"]', "Rewainsure@8085");
  await page.click('button[type="submit"]');

  await page.waitForURL((u) => !u.pathname.includes("/auth"), { timeout: 15000 });
  await page.goto("http://localhost:8081/admin");
  await page.waitForTimeout(4000);

  await browser.close();
}

inspect400().catch(console.error);
