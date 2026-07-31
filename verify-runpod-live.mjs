import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

await page.goto("http://localhost:3417/login");
await page.fill('input[type="email"]', "julian@theconversionbrands.com");
await page.fill('input[type="password"]', "YsjULvA34614");
await page.click('button[type="submit"]');
await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 15000 });

await page.goto("http://localhost:3417/voice-message");
await page.fill("#message-text", "Hey, saw your page, loved your last post!");
await page.click('button:has-text("Generate voice message")');

console.log("Waiting on RunPod (cold start could take a while)...");
const result = await Promise.race([
  page.waitForSelector("audio", { timeout: 150000 }).then(() => "audio"),
  page.waitForSelector(".text-destructive", { timeout: 150000 }).then(() => "error"),
]);

console.log("Result:", result);
await page.screenshot({ path: "/private/tmp/claude-501/-Users-julian-agency-ai-os/69fe73b1-d39f-456d-8e55-6f3a2f7ec256/scratchpad/runpod-live-result.png" });

if (result === "error") {
  const text = await page.locator(".text-destructive").textContent();
  console.log("Error text:", text);
}

await browser.close();
