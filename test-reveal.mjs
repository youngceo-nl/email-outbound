// Test the CapSolver email reveal using the persistent Chromium profile.
// Run: node test-reveal.mjs
// Prereq: node login-automation.mjs (creates /tmp/yt-automation-profile)

import { createRequire } from 'module';
import { pathToFileURL } from 'url';

const CHANNEL_URL = 'https://www.youtube.com/@erickavelaars';
const CAPSOLVER_KEY = 'CAP-CA1A07C5F6C9B465AA7967DBBFA391AD700C9E436AE0DDFFF2BA9CD43134FE75';
const PROFILE_DIR = '/tmp/yt-automation-profile';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// ── CapSolver reCAPTCHA Enterprise solver ─────────────────────────────────────
async function solveRecaptcha({ websiteURL, websiteKey }) {
  const body = {
    clientKey: CAPSOLVER_KEY,
    task: {
      type: 'ReCaptchaV2EnterpriseTaskProxyLess',
      websiteURL,
      websiteKey,
      isInvisible: false,
    },
  };

  console.log('  Submitting CAPTCHA task to CapSolver...');
  const createRes = await fetch('https://api.capsolver.com/createTask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const created = await createRes.json();
  if (created.errorId) throw new Error(`CapSolver create: ${created.errorDescription}`);
  const taskId = created.taskId;
  console.log('  Task ID:', taskId);

  // Poll for result
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const pollRes = await fetch('https://api.capsolver.com/getTaskResult', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientKey: CAPSOLVER_KEY, taskId }),
    });
    const result = await pollRes.json();
    if (result.status === 'ready') {
      console.log('  CapSolver solved in ~' + ((i + 1) * 3) + 's');
      return result.solution?.gRecaptchaResponse;
    }
    if (result.status === 'failed') throw new Error(`CapSolver failed: ${result.errorDescription}`);
    if (i % 5 === 4) console.log('  Still solving... (' + ((i + 1) * 3) + 's)');
  }
  throw new Error('CapSolver timed out after 120s');
}

// ── Main ──────────────────────────────────────────────────────────────────────
const { chromium } = await import('playwright');

const aboutUrl = CHANNEL_URL.replace(/\/+$/, '') + '/about';
console.log('='.repeat(60));
console.log('YouTube email reveal test');
console.log('Channel:', CHANNEL_URL);
console.log('Profile:', PROFILE_DIR);
console.log('='.repeat(60) + '\n');

console.log('Launching Chromium with persistent profile (headless)...');
const context = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless: true,
  args: [
    '--disable-blink-features=AutomationControlled',
    '--no-first-run',
    '--no-default-browser-check',
  ],
  userAgent: UA,
  locale: 'nl-NL',
  timezoneId: 'Europe/Amsterdam',
  viewport: { width: 1280, height: 900 },
});

await context.addInitScript(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  Object.defineProperty(navigator, 'languages', { get: () => ['nl-NL', 'nl', 'en-US'] });
  Object.defineProperty(navigator, 'plugins', { get: () => [1,2,3,4,5] });
  window.chrome ??= { runtime: {} };
});

const page = await context.newPage();
const t0 = Date.now();

console.log('Step 1: Navigating to About page...');
const resp = await page.goto(aboutUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
console.log('  Status:', resp?.status(), '| URL:', page.url().slice(0, 80));
await page.waitForTimeout(3000);
console.log('  Title:', await page.title());

// Check login state
const loggedIn = await page.locator('#avatar-btn').isVisible().catch(() => false);
console.log('  Logged in (avatar):', loggedIn);

// Check for the view email button
const bodyText = await page.evaluate(() => document.body.innerText || '');
const hasEmailGate = /log in om e-mailadres|sign in to see email/i.test(bodyText);
const hasViewEmail = /view email address|e-mailadres weergeven/i.test(bodyText);
console.log('  Sign-in gate:', hasEmailGate);
console.log('  View email button:', hasViewEmail);

if (!hasViewEmail) {
  if (hasEmailGate) {
    console.log('\n✗ Sign-in gate visible — session not authenticated in headless mode');
    console.log('  Taking screenshot for inspection...');
    await page.screenshot({ path: '/tmp/reveal-headless-fail.png', fullPage: false });
    console.log('  Screenshot: /tmp/reveal-headless-fail.png');
  } else {
    console.log('\n⚠  Neither email gate nor view email button found');
    // Check if email is directly in page text
    const email = bodyText.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i)?.[0];
    if (email && !['youtube.com','google.com'].some(d => email.includes(d))) {
      console.log('  Email found directly in page text:', email);
    } else {
      console.log('  No email in page text either');
    }
    await page.screenshot({ path: '/tmp/reveal-headless-fail.png', fullPage: false });
    console.log('  Screenshot: /tmp/reveal-headless-fail.png');
  }
  await context.close();
  process.exit(1);
}

console.log('\nStep 2: Clicking "View email" button...');
const revealBtn = page.getByText(/view email address|e-mailadres weergeven/i).first();
await revealBtn.scrollIntoViewIfNeeded().catch(() => {});
await revealBtn.click({ timeout: 10000 });
await page.waitForTimeout(3000);

// Check if CAPTCHA appeared
const captchaFrame = await page.locator('iframe[src*="recaptcha"]').count();
console.log('  reCAPTCHA frame:', captchaFrame > 0 ? 'YES' : 'no');

// Check if email revealed directly
const afterText = await page.evaluate(() => document.body.innerText || '');
const directEmail = afterText.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i)?.[0];
const mailto = await page.locator('a[href^="mailto:"]').first().getAttribute('href').catch(() => null);
if (mailto) {
  const email = mailto.replace('mailto:', '').split('?')[0].trim();
  console.log('\n✓ EMAIL REVEALED (no captcha needed):', email);
  await context.close();
  process.exit(0);
}

if (!captchaFrame) {
  console.log('\n⚠  Button clicked but no CAPTCHA and no email');
  await page.screenshot({ path: '/tmp/reveal-after-click.png', fullPage: false });
  await context.close();
  process.exit(1);
}

// Solve with CapSolver
const iframeSrc = await page.locator('iframe[src*="recaptcha"]').first().getAttribute('src');
const siteKeyMatch = iframeSrc?.match(/[?&]k=([^&]+)/);
const websiteKey = siteKeyMatch?.[1];
console.log('  siteKey:', websiteKey);

if (!websiteKey) {
  console.log('\n✗ Could not extract reCAPTCHA sitekey');
  await context.close();
  process.exit(1);
}

console.log('\nStep 3: Solving CAPTCHA via CapSolver...');
let token;
try {
  token = await solveRecaptcha({ websiteURL: aboutUrl, websiteKey });
  console.log('  Token:', token?.slice(0, 50) + '...');
} catch (err) {
  console.log('\n✗ CapSolver error:', err.message);
  await context.close();
  process.exit(1);
}

// Screenshot right after captcha appeared
await page.screenshot({ path: '/tmp/reveal-captcha.png', fullPage: false });
console.log('  Screenshot of captcha state: /tmp/reveal-captcha.png');

// Debug: what textareas exist?
const textareas = await page.evaluate(() =>
  [...document.querySelectorAll('textarea')].map(t => ({ id: t.id, name: t.name, val: t.value.slice(0, 20) }))
);
console.log('  Textareas on page:', JSON.stringify(textareas));

// Debug: which buttons are visible?
const buttons = await page.evaluate(() =>
  [...document.querySelectorAll('button, [role="button"]')]
    .filter(b => b.offsetParent !== null)
    .map(b => b.textContent?.trim().slice(0, 40))
    .filter(Boolean)
    .slice(0, 10)
);
console.log('  Visible buttons:', buttons);

// Debug: what iframes exist?
const iframes = await page.evaluate(() =>
  [...document.querySelectorAll('iframe')].map(f => f.src.slice(0, 80))
);
console.log('  Iframes:', iframes);

console.log('\nStep 4: Injecting token...');
const injectionResult = await page.evaluate((tok) => {
  const log = [];
  const areas = document.querySelectorAll('textarea#g-recaptcha-response, textarea[name="g-recaptcha-response"]');
  log.push(`textareas found: ${areas.length}`);
  areas.forEach(t => { t.value = tok; });

  try {
    const cfg = window.___grecaptcha_cfg;
    log.push(`___grecaptcha_cfg: ${cfg ? 'exists' : 'missing'}`);
    if (cfg?.clients) {
      const clientIds = Object.keys(cfg.clients);
      log.push(`clients: ${clientIds.length}`);
      const seen = new Set();
      const findCb = (obj, depth) => {
        if (!obj || depth > 6 || seen.has(obj) || typeof obj !== 'object') return null;
        seen.add(obj);
        for (const k of Object.keys(obj)) {
          const v = obj[k];
          if (k === 'callback' && typeof v === 'function') return v;
          const f = findCb(v, depth + 1);
          if (f) return f;
        }
        return null;
      };
      for (const cid of clientIds) {
        const cb = findCb(cfg.clients[cid], 0);
        if (cb) {
          log.push(`calling callback for client ${cid}`);
          try { cb(tok); log.push('callback called OK'); } catch(e) { log.push(`callback error: ${e.message}`); }
          break;
        }
      }
    }
  } catch(e) { log.push(`error: ${e.message}`); }
  return log;
}, token);
console.log('  Injection log:', injectionResult.join(' | '));

// Wait for email to appear
console.log('  Waiting for email to reveal...');
let revealed = null;
const deadline = Date.now() + 12000;
while (Date.now() < deadline) {
  const ml = await page.locator('a[href^="mailto:"]').first().getAttribute('href').catch(() => null);
  if (ml) { revealed = ml.replace('mailto:', '').split('?')[0].trim(); break; }
  const txt = await page.evaluate(() => document.body.innerText || '');
  const m = txt.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i)?.[0];
  if (m && !['youtube.com','google.com','gstatic.com'].some(d => m.includes(d))) { revealed = m; break; }
  await page.waitForTimeout(500);
}

const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
if (revealed) {
  console.log('\n✓✓ SUCCESS — Email revealed in ' + elapsed + 's:', revealed);
} else {
  console.log('\n✗ Email not revealed after token injection (' + elapsed + 's)');
  await page.screenshot({ path: '/tmp/reveal-after-token.png', fullPage: false });
  console.log('  Screenshot: /tmp/reveal-after-token.png');
}

await context.close();
