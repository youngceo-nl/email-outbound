// Debug: inspect reCAPTCHA state after clicking "View email" on YouTube About page
import { chromium } from 'playwright';

const PROFILE_DIR = '/tmp/yt-automation-profile';
const ABOUT_URL = 'https://www.youtube.com/@erickavelaars/about';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const context = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless: false, // visible so we can see what happens
  args: ['--disable-blink-features=AutomationControlled', '--no-first-run'],
  userAgent: UA,
  locale: 'nl-NL',
  timezoneId: 'Europe/Amsterdam',
  viewport: { width: 1280, height: 900 },
});

await context.addInitScript(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  window.chrome ??= { runtime: {} };
});

// Intercept network requests to YouTube's captcha verification endpoint
const requests = [];
context.on('request', req => {
  if (req.url().includes('youtubei') || req.url().includes('recaptcha') || req.url().includes('email')) {
    requests.push({ url: req.url().slice(0, 120), method: req.method(), postData: req.postData()?.slice(0, 100) });
  }
});

const page = await context.newPage();
await page.goto(ABOUT_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(3000);

console.log('Title:', await page.title());

// Click the view email button
const btn = page.getByText(/view email address|e-mailadres weergeven/i).first();
await btn.scrollIntoViewIfNeeded().catch(() => {});
console.log('\nClicking "View email"...');
await btn.click();
await page.waitForTimeout(4000);

console.log('\nNetwork requests after clicking:');
requests.forEach(r => console.log(' ', r.method, r.url));

// Inspect reCAPTCHA state
const captchaState = await page.evaluate(() => {
  const result = {};

  // Check if grecaptcha exists
  result.hasGrecaptcha = typeof window.grecaptcha !== 'undefined';
  result.hasGrecaptchaEnterprise = typeof window.grecaptcha?.enterprise !== 'undefined';

  // Inspect ___grecaptcha_cfg
  const cfg = window.___grecaptcha_cfg;
  result.hasCfg = !!cfg;
  if (cfg) {
    result.cfgKeys = Object.keys(cfg);
    if (cfg.clients) {
      const clientIds = Object.keys(cfg.clients);
      result.clientIds = clientIds;
      if (clientIds.length > 0) {
        const client = cfg.clients[clientIds[0]];
        // Dump top-level keys of the client
        result.clientTopLevelKeys = Object.keys(client).slice(0, 20);
        // Try to find any function keys
        result.clientFunctionKeys = Object.entries(client)
          .filter(([_, v]) => typeof v === 'function')
          .map(([k]) => k);
        // Try to find callback patterns
        const findAll = (obj, path = '', depth = 0) => {
          if (!obj || depth > 3 || typeof obj !== 'object') return [];
          const found = [];
          for (const k of Object.keys(obj)) {
            const v = obj[k];
            if (k === 'callback' || k === 'f' || k === 'uf') {
              found.push({ path: path + '.' + k, type: typeof v });
            }
            if (v && typeof v === 'object' && depth < 3) {
              found.push(...findAll(v, path + '.' + k, depth + 1));
            }
          }
          return found;
        };
        result.callbackPaths = findAll(client, 'client');
      }
    }
  }
  return result;
});

console.log('\nreCAPTCHA state:');
console.log(JSON.stringify(captchaState, null, 2));

// Also check if there's a form to submit
const formInfo = await page.evaluate(() => {
  const forms = [...document.querySelectorAll('form')];
  return forms.map(f => ({
    action: f.action,
    method: f.method,
    inputs: [...f.querySelectorAll('input, textarea')].map(i => ({ name: i.name, type: i.type, id: i.id })),
  }));
});
console.log('\nForms on page:', JSON.stringify(formInfo, null, 2));

// Check the recaptcha anchor iframe to see its state
const anchorFrame = page.frames().find(f => f.url().includes('recaptcha/api2/anchor'));
if (anchorFrame) {
  console.log('\nreCAPTCHA anchor frame URL:', anchorFrame.url().slice(0, 100));
  const checkboxState = await anchorFrame.evaluate(() => {
    const cb = document.querySelector('.recaptcha-checkbox');
    return cb ? { className: cb.className, ariaChecked: cb.getAttribute('aria-checked') } : null;
  }).catch(e => ({ error: e.message }));
  console.log('Checkbox state:', checkboxState);
}

console.log('\nBrowser staying open 60s for inspection...');
await page.waitForTimeout(60000);
await context.close();
