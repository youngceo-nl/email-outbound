// Round-robin pool of IG session cookies.
// Merges settings-stored cookies with INSTAGRAM_COOKIES env var (comma-separated).
// Settings cookies rotate first.
let idx = 0;

export function getNextCookie(settingsCookies?: string | null): string | null {
  const fromSettings = (settingsCookies ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const fromEnv = (process.env.INSTAGRAM_COOKIES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const pool = [...fromSettings, ...fromEnv];
  if (pool.length === 0) return null;
  const cookie = pool[idx % pool.length];
  idx++;
  return cookie;
}
