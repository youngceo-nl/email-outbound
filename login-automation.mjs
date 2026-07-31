// One-time setup: log into automation YouTube account and save the profile.
// Run once, then reveal-email.ts can reuse the same profile dir.
//
// Usage: node login-automation.mjs
import { chromium } from 'playwright';
import { mkdir } from 'fs/promises';

const PROFILE_DIR = '/tmp/yt-automation-profile';
const EMAIL = 'ramondrake1928@ishowfirstmail.com';
const PASS  = 'fyaphsubM!7188';

await mkdir(PROFILE_DIR, { recursive: true });

console.log('Launching Chrome with fresh profile at', PROFILE_DIR);
console.log('This browser will be VISIBLE — handle any 2FA prompts manually.\n');

// Using bundled Chromium (no channel:'chrome') so it doesn't compete with the
// user's running Chrome instance. Chromium also doesn't have DBSC hardware keys,
// so the session cookies it creates are NOT device-bound and work reliably in
// the same Chromium build across runs.
const context = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless: false,
  args: [
    '--disable-blink-features=AutomationControlled',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-sync',
    '--window-size=1400,900',
  ],
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  locale: 'nl-NL',
  timezoneId: 'Europe/Amsterdam',
  viewport: { width: 1400, height: 900 },
});

await context.addInitScript(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  Object.defineProperty(navigator, 'languages', { get: () => ['nl-NL', 'nl', 'en-US'] });
  window.chrome ??= { runtime: {} };
});

const page = await context.newPage();

// ── Step 1: Sign in ──────────────────────────────────────────────────────────
console.log('Step 1: Going to Google sign-in page...');
await page.goto('https://accounts.google.com/signin/v2/identifier', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(2000);
console.log('Title:', await page.title());
console.log('URL:  ', page.url().slice(0, 80));

// Check if already signed in
if (page.url().includes('myaccount') || page.url().includes('youtube.com')) {
  console.log('\n✓ Already signed in! Skipping login form.\n');
} else {
  // Take screenshot to debug
  await page.screenshot({ path: '/tmp/login-step1.png', fullPage: false });
  console.log('Screenshot saved to /tmp/login-step1.png');
  console.log('Page HTML snippet:', (await page.content()).slice(0, 500));

  // Try multiple selectors for the email field
  const emailField = page.locator('#identifierId, input[type="email"], input[autocomplete="username"]').first();
  await emailField.waitFor({ state: 'visible', timeout: 20000 });
  await emailField.fill(EMAIL);
  await page.keyboard.press('Enter');
  console.log('Submitted email, waiting for password field...');
  await page.waitForTimeout(3000);

  // Fill password
  const passField = page.locator('input[type="password"]').first();
  await passField.waitFor({ state: 'visible', timeout: 15000 });
  await passField.fill(PASS);
  await page.keyboard.press('Enter');
  console.log('Submitted password, waiting...');
  await page.waitForTimeout(5000);

  const url = page.url();
  console.log('Post-login URL:', url.slice(0, 100));

  if (url.includes('challenge') || url.includes('verify') || url.includes('2-step') || url.includes('signin/v2')) {
    console.log('\n⚠  2FA / verification required — complete it in the browser window.');
    console.log('   Waiting up to 120 seconds for you to finish...\n');
    // Wait until we're past the challenge page
    await page.waitForURL(url => !url.includes('challenge') && !url.includes('verify') && !url.includes('signin/v2'), { timeout: 120000 }).catch(() => {
      console.log('Timeout waiting for 2FA — proceeding anyway');
    });
  }
}

// ── Step 2: Navigate to YouTube to confirm login ──────────────────────────────
console.log('\nStep 2: Navigating to YouTube...');
await page.goto('https://www.youtube.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(4000);
console.log('YouTube title:', await page.title());

const avatarBtn = page.locator('#avatar-btn');
const loggedIn = await avatarBtn.isVisible().catch(() => false);
console.log('Logged in (avatar visible):', loggedIn);

if (!loggedIn) {
  const signIn = await page.getByText(/sign in/i).first().isVisible().catch(() => false);
  console.log('Sign-in button visible:', signIn);
  console.log('\n⚠  Not logged in — profile may need to be re-used or 2FA was not completed.');
}

// ── Step 3: Navigate to About page and test ───────────────────────────────────
console.log('\nStep 3: Testing @erickavelaars About page...');
await page.goto('https://www.youtube.com/@erickavelaars/about', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(4000);
console.log('About title:', await page.title());
console.log('Status: logged-in URL means cookie worked if title != Oops');

const bodyText = await page.evaluate(() => document.body.innerText || '');
const hasEmailGate = /log in om|sign in to see email/i.test(bodyText);
const hasViewEmail = /view email address|e-mailadres weergeven/i.test(bodyText);
console.log('Email gate text:', hasEmailGate);
console.log('View email button:', hasViewEmail);

if (hasViewEmail) {
  console.log('\n✓ SUCCESS — "View email" button present! Session is authenticated.');
  console.log('  Profile saved at:', PROFILE_DIR);
  console.log('  The reveal flow can now reuse this profile.\n');
} else if (hasEmailGate) {
  console.log('\n⚠  Sign-in gate — cookies didn\'t authenticate properly.');
} else {
  console.log('\n  No email-related element found. Check the browser window.');
}

// Extract cookies to report to console
const cookies = await context.cookies('https://www.youtube.com');
const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
console.log('\nCurrent session cookies (', cookies.length, ' total):');
cookies.forEach(c => console.log(' ', c.name, '=', c.value.slice(0, 40) + '...'));

console.log('\n--- Browser stays open 90s for inspection ---');
await page.waitForTimeout(90000);
await context.close();
console.log('Done. Profile saved at', PROFILE_DIR);
