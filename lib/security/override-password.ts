/**
 * Shared override-password gate for costly or destructive actions
 * (re-scraping an account, deleting a campaign). The password is env-only and
 * deliberately not in app_settings: there is one shared login, so anything on
 * the Settings page is visible to the same person this is meant to slow down.
 * It guards against an accidental click, not against an attacker.
 */
export function checkOverridePassword(password: string | undefined, action: string): string | null {
  const expected = process.env.RESCRAPE_OVERRIDE_PASSWORD;
  if (!expected) return `RESCRAPE_OVERRIDE_PASSWORD must be set in the environment to ${action}.`;
  if (!password) return `Enter the override password to ${action}.`;
  if (!timingSafeEqual(password, expected)) return "Wrong override password.";
  return null;
}

/** Constant-time compare so a wrong guess can't be narrowed by response timing. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
