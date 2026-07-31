// Intercept network traffic to find YouTube's email reveal API endpoint
import { chromium } from 'playwright';

const PROFILE_DIR = '/tmp/yt-automation-profile';
const ABOUT_URL = 'https://www.youtube.com/@erickavelaars/about';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const context = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless: false,
  args: ['--disable-blink-features=AutomationControlled', '--no-first-run'],
  userAgent: UA, locale: 'nl-NL', timezoneId: 'Europe/Amsterdam',
  viewport: { width: 1280, height: 900 },
});
await context.addInitScript(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  window.chrome ??= { runtime: {} };
});

// Capture all POST requests to YouTube API
const apiCalls = [];
context.on('request', req => {
  if (req.method() === 'POST' && req.url().includes('youtube.com')) {
    const body = req.postData();
    apiCalls.push({ url: req.url(), bodyStart: body?.slice(0, 200) });
  }
});
context.on('response', async resp => {
  if (resp.url().includes('youtubei') && resp.status() === 200) {
    const body = await resp.text().catch(() => '');
    if (body.includes('@') || body.includes('email')) {
      console.log('\n>>> API response with email/@ content:');
      console.log('URL:', resp.url().slice(0, 100));
      console.log('Body snippet:', body.slice(0, 500));
    }
  }
});

const page = await context.newPage();
await page.goto(ABOUT_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(3000);

console.log('Title:', await page.title());
console.log('Logged in:', await page.locator('#avatar-btn').isVisible().catch(() => false));

// Get the captcha div HTML BEFORE clicking
const captchaDiv = await page.evaluate(() => {
  const captchas = document.querySelectorAll('[data-callback], .g-recaptcha, #recaptcha');
  return [...captchas].map(el => ({ tag: el.tagName, html: el.outerHTML.slice(0, 300) }));
});
console.log('\nCaptcha divs before click:', JSON.stringify(captchaDiv, null, 2));

// Click View email
console.log('\nClicking "View email"...');
const btn = page.getByText(/view email address|e-mailadres weergeven/i).first();
await btn.scrollIntoViewIfNeeded();
await btn.click();
await page.waitForTimeout(3000);

// Get HTML of the modal/dialog
const modalHtml = await page.evaluate(() => {
  const dialog = document.querySelector('[role="dialog"], ytd-popup-container, #ytd-popup-container');
  const modal = document.querySelector('.ytd-simple-modal-renderer, ytd-simple-modal-renderer');
  return (dialog || modal)?.innerHTML?.slice(0, 2000) || 'no modal found';
});
console.log('\nModal HTML:', modalHtml);

// Get the captcha div HTML AFTER clicking
const captchaDivAfter = await page.evaluate(() => {
  const captchas = document.querySelectorAll('[data-callback], .g-recaptcha, #recaptcha');
  return [...captchas].map(el => ({ tag: el.tagName, attrs: Object.fromEntries([...el.attributes].map(a => [a.name, a.value.slice(0, 100)])) }));
});
console.log('\nCaptcha divs after click:', JSON.stringify(captchaDivAfter, null, 2));

// Look for forms specifically
const formData = await page.evaluate(() => {
  return [...document.querySelectorAll('form')].map(f => ({
    action: f.action, method: f.method,
    fields: [...f.querySelectorAll('[name]')].map(i => `${i.tagName}[name=${i.name}]`)
  }));
});
console.log('\nAll forms:', JSON.stringify(formData, null, 2));

// Try to find YouTube's callback name
const cbName = await page.evaluate(() => {
  // Look for data-callback attributes
  const allCb = [...document.querySelectorAll('[data-callback]')].map(e => e.getAttribute('data-callback'));
  // Look for data-sitekey
  const allSk = [...document.querySelectorAll('[data-sitekey]')].map(e => e.getAttribute('data-sitekey'));
  // Look in window for known callback patterns
  const windowFns = Object.keys(window).filter(k => k.includes('callback') || k.includes('recaptcha') || k.includes('captcha')).slice(0, 10);
  return { callbacks: allCb, sitekeys: allSk, windowFns };
});
console.log('\nCallbacks/sitekeys:', JSON.stringify(cbName, null, 2));

console.log('\nKeeping browser open 90s — please MANUALLY solve the captcha so I can capture the API request');
console.log('After solving, check the terminal for the API call...\n');

// Wait and watch for API calls
let lastLen = 0;
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(3000);
  if (apiCalls.length > lastLen) {
    console.log('\n[New API calls at', new Date().toLocaleTimeString(), ']');
    apiCalls.slice(lastLen).forEach(c => console.log(' POST', c.url.slice(0, 100)));
    lastLen = apiCalls.length;
  }
  // Check if email revealed
  const mail = await page.locator('a[href^="mailto:"]').first().getAttribute('href').catch(() => null);
  if (mail) {
    console.log('\n!!! EMAIL REVEALED:', mail);
    break;
  }
}

await context.close();
