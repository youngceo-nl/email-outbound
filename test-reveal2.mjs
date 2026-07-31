// Reveal email by clicking the reCAPTCHA checkbox directly (no CapSolver for the click)
// With a real Google session the checkbox may auto-pass without an image challenge.
import { chromium } from 'playwright';

const CAPSOLVER_KEY = 'CAP-CA1A07C5F6C9B465AA7967DBBFA391AD700C9E436AE0DDFFF2BA9CD43134FE75';
const PROFILE_DIR = '/tmp/yt-automation-profile';
const ABOUT_URL = 'https://www.youtube.com/@erickavelaars/about';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function solveRecaptchaV2({ websiteURL, websiteKey }) {
  const body = {
    clientKey: CAPSOLVER_KEY,
    task: { type: 'ReCaptchaV2TaskProxyLess', websiteURL, websiteKey },
  };
  console.log('  Submitting to CapSolver (v2 proxyless)...');
  const r = await fetch('https://api.capsolver.com/createTask', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const { errorId, errorDescription, taskId } = await r.json();
  if (errorId) throw new Error(`CapSolver create: ${errorDescription}`);
  console.log('  Task ID:', taskId);
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const p = await (await fetch('https://api.capsolver.com/getTaskResult', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientKey: CAPSOLVER_KEY, taskId }),
    })).json();
    if (p.status === 'ready') { console.log(`  Solved in ~${(i+1)*3}s`); return p.solution?.gRecaptchaResponse; }
    if (p.status === 'failed') throw new Error(`CapSolver failed: ${p.errorDescription}`);
    if (i % 4 === 3) console.log(`  Still solving (${(i+1)*3}s)...`);
  }
  throw new Error('CapSolver timeout');
}

const context = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless: false, // visible so we can watch
  args: ['--disable-blink-features=AutomationControlled', '--no-first-run', '--no-default-browser-check'],
  userAgent: UA, locale: 'nl-NL', timezoneId: 'Europe/Amsterdam',
  viewport: { width: 1280, height: 900 },
});
await context.addInitScript(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  window.chrome ??= { runtime: {} };
});

const page = await context.newPage();
await page.goto(ABOUT_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(3000);
console.log('Title:', await page.title());

// Click View email
console.log('\nClicking "View email"...');
const btn = page.getByText(/view email address|e-mailadres weergeven/i).first();
await btn.scrollIntoViewIfNeeded();
await btn.click();
await page.waitForTimeout(3000);

const captchaFrame = await page.locator('iframe[src*="recaptcha/api2/anchor"]').count();
console.log('reCAPTCHA frame present:', captchaFrame > 0);

// ── Approach 1: Click the checkbox directly in the iframe ─────────────────────
let emailRevealed = null;
if (captchaFrame > 0) {
  const anchorFrame = page.frameLocator('iframe[src*="recaptcha/api2/anchor"]');
  const checkbox = anchorFrame.locator('.recaptcha-checkbox');

  console.log('\nApproach 1: Clicking reCAPTCHA checkbox...');
  await checkbox.click({ timeout: 10000 }).catch(e => console.log('  Click failed:', e.message));
  await page.waitForTimeout(5000);

  // Check if auto-passed (checkbox becomes checked, email appears)
  const tokenValue = await page.locator('#g-recaptcha-response').inputValue().catch(() => '');
  console.log('  Token auto-filled:', tokenValue ? `yes (${tokenValue.slice(0,30)}...)` : 'no');

  // Check if email appeared
  const mailLink = await page.locator('a[href^="mailto:"]').first().getAttribute('href').catch(() => null);
  if (mailLink) {
    emailRevealed = mailLink.replace('mailto:', '').split('?')[0].trim();
    console.log('\n✓✓ EMAIL REVEALED (auto-pass):', emailRevealed);
  }

  // Check if image challenge appeared (bframe visible)
  const bframeVisible = await page.locator('iframe[src*="recaptcha/api2/bframe"]').first().isVisible().catch(() => false);
  console.log('  Image challenge appeared:', bframeVisible);

  if (!emailRevealed && tokenValue) {
    // Token was auto-filled — need to trigger the callback
    console.log('\nApproach 1b: Token auto-filled but email not shown — firing callback via grecaptcha...');
    await page.evaluate((tok) => {
      // Try all objects in ___grecaptcha_cfg looking for any function that accepts a token
      const cfg = window.___grecaptcha_cfg;
      if (!cfg?.clients) return;
      for (const cid of Object.keys(cfg.clients)) {
        const cl = cfg.clients[cid];
        for (const key of Object.keys(cl)) {
          const v = cl[key];
          if (typeof v === 'function') {
            try { v(tok); } catch {}
          }
        }
      }
    }, tokenValue);
    await page.waitForTimeout(3000);
    const ml2 = await page.locator('a[href^="mailto:"]').first().getAttribute('href').catch(() => null);
    if (ml2) { emailRevealed = ml2.replace('mailto:', '').split('?')[0].trim(); console.log('✓ Email after callback:', emailRevealed); }
  }
}

// ── Approach 2: If checkbox didn't work, use CapSolver + smarter injection ────
if (!emailRevealed) {
  console.log('\nApproach 2: Using CapSolver token + brute-force callback search...');

  const iframeSrc = await page.locator('iframe[src*="recaptcha/api2/anchor"]').first().getAttribute('src');
  const siteKey = iframeSrc?.match(/[?&]k=([^&]+)/)?.[1];
  console.log('  siteKey:', siteKey);

  let token;
  try {
    token = await solveRecaptchaV2({ websiteURL: ABOUT_URL, websiteKey: siteKey });
    console.log('  Token:', token?.slice(0, 50) + '...');
  } catch(e) {
    console.log('  CapSolver error:', e.message);
    await page.screenshot({ path: '/tmp/debug-captcha-fail.png' });
    await context.close();
    process.exit(1);
  }

  // Inject token + try all possible callback patterns
  await page.evaluate((tok) => {
    // 1. Set the textarea
    document.querySelectorAll('#g-recaptcha-response, [name="g-recaptcha-response"]')
      .forEach(t => { t.value = tok; t.dispatchEvent(new Event('change', { bubbles: true })); });

    // 2. Try grecaptcha direct call
    try { window.grecaptcha?.enterprise?.execute(tok); } catch {}
    try { window.grecaptcha?.execute(tok); } catch {}

    // 3. Brute-force: walk ___grecaptcha_cfg.clients[0] looking for any function
    const cfg = window.___grecaptcha_cfg;
    if (!cfg?.clients) return;
    const walked = new Set();
    function walk(obj, depth) {
      if (!obj || depth > 4 || typeof obj !== 'object' || walked.has(obj)) return;
      walked.add(obj);
      for (const k of Object.keys(obj)) {
        const v = obj[k];
        // Call any function that might be a callback (length 1 = takes one arg = token)
        if (typeof v === 'function' && v.length === 1) {
          try { v(tok); } catch {}
        } else if (v && typeof v === 'object') {
          walk(v, depth + 1);
        }
      }
    }
    for (const cid of Object.keys(cfg.clients)) {
      walk(cfg.clients[cid], 0);
    }
  }, token);

  await page.waitForTimeout(5000);
  await page.screenshot({ path: '/tmp/debug-after-inject.png' });

  const ml = await page.locator('a[href^="mailto:"]').first().getAttribute('href').catch(() => null);
  if (ml) { emailRevealed = ml.replace('mailto:', '').split('?')[0].trim(); console.log('\n✓✓ EMAIL REVEALED (CapSolver):', emailRevealed); }
  else {
    const txt = await page.evaluate(() => document.body.innerText || '');
    const em = txt.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi)?.find(e => !['youtube.com','google.com','gstatic.com'].some(d => e.includes(d)));
    if (em) { emailRevealed = em; console.log('\n✓ Email in page text:', em); }
    else console.log('\n✗ Email not found after CapSolver injection — screenshots in /tmp/');
  }
}

if (emailRevealed) {
  console.log('\n=== FINAL RESULT: ' + emailRevealed + ' ===');
} else {
  console.log('\n=== FAILED — keeping browser open 60s for inspection ===');
  await page.waitForTimeout(60000);
}
await context.close();
