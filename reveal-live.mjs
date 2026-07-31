// Visible Chrome test — watch the reveal flow live
import { chromium } from 'playwright';

const COOKIE_STR = 'VISITOR_PRIVACY_METADATA=CgJOTBIiEh4SHAsMDg8QERITFBUWFxgZGhscHR4fICEiIyQlJicgYQ%3D%3D; __Secure-3PSID=g.a000_Qinm_jQ4vHlsRgAo0VNM8rkI01khCBI8r5QPC3g9zyqkNBdwbrsDAgXkfRoGq-08gBRiAACgYKAZESARUSFQHGX2MiZ-Pc_IQ5tdwdhRuBzUFpIBoVAUF8yKpdBa5ymQFsJwrVLNx62qaz0076; __Secure-1PSIDTS=sidts-CjQByojQU0hCkhyCrgjVAinXrlM5R-Gn0FOHvAz00LkUOPd80-TCttUCxnVSpl1cnSbN-Xq8EAA; SAPISID=6Y9snhI0i8Y07gE5/ARx1Inu75_12b8mYo; __Secure-1PSIDCC=AKEyXzXIinmtM0rl8BYo2jAME24d0GouiDe-2L4M64MEiPifyeV3aX5-k5dSaACiWsXfOw9jNA; SSID=Aw16kwx79yq2cSuni; __Secure-1PAPISID=6Y9snhI0i8Y07gE5/ARx1Inu75_12b8mYo; __Secure-1PSID=g.a000_Qinm_jQ4vHlsRgAo0VNM8rkI01khCBI8r5QPC3g9zyqkNBddyDUi0TU5yvl7vNvgtX6kwACgYKAWASARUSFQHGX2MifJAwsGxkkubWlItHnSgFaxoVAUF8yKodq6-ACJI3q0XlRh81tqW0076; __Secure-3PAPISID=6Y9snhI0i8Y07gE5/ARx1Inu75_12b8mYo; __Secure-3PSIDCC=AKEyXzUrPjw2VjJIqZMyqTiw-qpMZYd567crGkpT4FMnfC7R5LeNi4UW9uukTVLwu7aL2l7uBKs; __Secure-3PSIDTS=sidts-CjQByojQU0hCkhyCrgjVAinXrlM5R-Gn0FOHvAz00LkUOPd80-TCttUCxnVSpl1cnSbN-Xq8EAA; __Secure-BUCKET=CH0; LOGIN_INFO=AFmmF2swRgIhAIAjFOevoMUtYLwlZvRSs7tMMZ-p3al46sbJcK-yg2KiAiEAvOLl9q3jcQkj4sVFYteJNvnNy3X2lwAq1LzvH5cwo70:QUQ3MjNmeXVSWFZPMDRlUnRHam9LZEZuZ2Y1Zm1ManFodG9RYjNMVTliWE9aNG85U1NiNGdZem9BSWlnbzQ1MV80ZzltUFFyaFdnU25TMEt0V0k3ZG5UOW1Qd1NIeUlGdEhER0J5Yk1fY0ZOengxQjZFZXJDOUZYUDNEc1NORVY2U2pFX2RFd2JpOV93YkxqR1ZFa0tvNE0wWGc2Y3h5b29n; NID=532=h9emv_05PCTXnvri524Wcx52koqMbVpv2_R2ZgGCQtqHlgjEp8S-h3l0ezDAct8d6IUoC2pERMG2_zy7ya9FirKj6BWF65kcJL2UK4NBDngDyUbAyOTlT7AFEkuXWRvix8JQRnqko8aYs2SyZUQ5OTE_v91XApq8n2vA_2K2viVrE7srq0__2MK0URMm6QAjwHeVhZe1cxeG3H5G_wiBSZMRIaIGKbTraEC7UFDSTIBgkBh7Zw7kCfuYVVSKeitj31tiHNVg4WoR8nB5HGlBps2h9mi4DepC41gFJnfcCToa7277t2iuX4VXmvMN2dDI31bGQOlNOqrrtVpfzTcD2609disCE-q-xk9FmttB; PREF=f7=300&tz=Europe.Amsterdam&f4=4010000&f5=30000; SOCS=CAISEwgDEgk3OTc1MDYwMTUaAm5sIAEaBgiAiaTFBg; VISITOR_INFO1_LIVE=018zyz5ppow';

const ABOUT_URL = 'https://www.youtube.com/@erickavelaars/about';

function parseCookies(str) {
  return str.split(';').map(c => c.trim()).filter(Boolean).map(c => {
    const i = c.indexOf('=');
    if (i === -1) return null;
    const name = c.slice(0, i).trim();
    const value = c.slice(i + 1).trim();
    if (!name) return null;
    // __Secure-BUCKET is a Lax cookie, __Secure-*PSID* can be Lax too
    const sameSite = name.startsWith('__Secure-3') ? 'None' : 'Lax';
    return { name, value, domain: '.youtube.com', path: '/', secure: true, sameSite };
  }).filter(Boolean);
}

console.log('Launching Chrome (visible)...');
const browser = await chromium.launch({
  headless: false,
  channel: 'chrome',
  args: [
    '--disable-blink-features=AutomationControlled',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=IsolateOrigins,site-per-process',
  ],
  slowMo: 100,
});

const ctx = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  locale: 'nl-NL',
  timezoneId: 'Europe/Amsterdam',
  viewport: { width: 1400, height: 900 },
});

await ctx.addInitScript(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  Object.defineProperty(navigator, 'languages', { get: () => ['nl-NL', 'nl', 'en-US'] });
  Object.defineProperty(navigator, 'plugins', { get: () => [1,2,3,4,5] });
  window.chrome ??= { runtime: {} };
});

// Step 1: Navigate to YouTube homepage first (establishes base cookies)
const page = await ctx.newPage();
console.log('Step 1: Navigate to youtube.com...');
await page.goto('https://www.youtube.com/', { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForTimeout(2000);
console.log('  → Page title:', await page.title());

// Step 2: Set our cookies on top of the base session
console.log('Step 2: Setting cookies...');
const cookies = parseCookies(COOKIE_STR);
console.log('  → Setting', cookies.length, 'cookies');

// Add them one by one to skip any that fail
let added = 0, skipped = [];
for (const c of cookies) {
  try { await ctx.addCookies([c]); added++; }
  catch (e) { skipped.push(c.name + ': ' + e.message.slice(0, 60)); }
}
console.log(`  → Added ${added}, skipped ${skipped.length}`);
if (skipped.length) skipped.forEach(s => console.log('    SKIP:', s));

// Step 3: Navigate directly to About page
console.log('\nStep 3: Navigating to About page...');
const resp = await page.goto(ABOUT_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
console.log('  → Status:', resp?.status(), '| URL:', page.url().slice(0, 80));
await page.waitForTimeout(3000);
console.log('  → Title:', await page.title());

// Step 4: Check login state
const loginState = await page.evaluate(() => {
  const d = window.ytInitialData;
  if (!d) return 'no-ytInitialData';
  const s = JSON.stringify(d);
  if (s.includes('"signInForBusinessEmail"')) return 'gated-sign-in-gate';
  if (s.includes('"viewEmail"') || s.includes('viewEmailAddress')) return 'view-email-button';
  return 'unknown';
}).catch(() => 'eval-error');
console.log('  → ytInitialData state:', loginState);

// Check for avatar (logged-in indicator)
const avatarVisible = await page.locator('#avatar-btn, ytd-topbar-logo-renderer').first().isVisible().catch(() => false);
console.log('  → Avatar visible (logged in?):', avatarVisible);

// Check page text
const bodyText = await page.evaluate(() => document.body.innerText || '');
const hasSignIn = /sign in|log in|inloggen|aanmelden/i.test(bodyText);
const hasEmailGate = /log in om e-mailadres|sign in to see email/i.test(bodyText);
const hasViewEmail = /view email address|e-mailadres weergeven/i.test(bodyText);
console.log('  → Sign-in text on page:', hasSignIn);
console.log('  → Email gate text:', hasEmailGate);
console.log('  → View email button:', hasViewEmail);

// Grab the About section
const aboutText = await page.locator('ytd-channel-about-metadata-renderer, #description, yt-formatted-string').allTextContents().catch(() => []);
if (aboutText.length) {
  console.log('  → About section (first 300 chars):', aboutText.join(' ').slice(0, 300));
}

console.log('\n--- Browser staying open for 90 seconds so you can inspect it ---');
console.log('--- Check: are you logged in? Is there a "View email" button? ---\n');
await page.waitForTimeout(90000);
await browser.close();
console.log('Done.');
