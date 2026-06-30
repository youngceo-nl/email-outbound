import "server-only";
import { generateTotp } from "@/lib/totp";
import type { LoginResult } from "@/lib/instagram/login-playwright";

// Logs into Instagram using the private mobile API (i.instagram.com).
// Unlike the web login, this produces a mobile sessionid that is accepted by
// i.instagram.com endpoints — including /users/{id}/info/ which exposes
// the public_email field behind the "Email" button on creator profiles.

const MOBILE_UA =
  "Instagram 291.0.0.29.111 Android (30/11; 480dpi; 1080x2137; samsung; SM-G973F; beyond1; exynos9820; en_US; 493494379)";
const APP_ID = "936619743392459";

function randomHex(n: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(n)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function mobileHeaders(opts: {
  deviceId: string;
  guid: string;
  csrf?: string;
  cookies?: string;
}): Record<string, string> {
  return {
    "User-Agent": MOBILE_UA,
    "X-IG-App-ID": APP_ID,
    "X-IG-Capabilities": "3brTvwE=",
    "X-IG-Connection-Type": "WIFI",
    "X-IG-Device-ID": opts.guid,
    "X-IG-Android-ID": opts.deviceId,
    "Accept": "*/*",
    "Accept-Language": "en-US",
    ...(opts.csrf ? { "X-CSRFToken": opts.csrf } : {}),
    ...(opts.cookies ? { "Cookie": opts.cookies } : {}),
  };
}

function parseSetCookies(headers: string[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const h of headers) {
    const [pair] = h.split(";");
    const eq = pair.indexOf("=");
    if (eq > 0) m.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
  return m;
}

function mergeCookies(m: Map<string, string>, headers: string[]): void {
  for (const [k, v] of parseSetCookies(headers)) m.set(k, v);
}

function cookieStr(m: Map<string, string>): string {
  return [...m.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

const KEEP_COOKIES = new Set([
  "sessionid", "csrftoken", "ds_user_id", "mid", "ig_did", "ig_nrcb", "rur",
]);

function buildResult(m: Map<string, string>): LoginResult {
  if (!m.has("sessionid")) {
    return { ok: false, error: "Mobile login succeeded but no sessionid was returned" };
  }
  const cookie = [...m.entries()]
    .filter(([k]) => KEEP_COOKIES.has(k))
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
  return { ok: true, cookie };
}

// Wraps a PKCS#1 RSA public key in an SPKI envelope (required by Web Crypto).
// Instagram's /qe/sync/ sometimes returns PKCS#1 instead of SPKI.
function derTlv(tag: number, content: Uint8Array): Uint8Array {
  const len = content.length;
  const lenEncoded =
    len < 128
      ? new Uint8Array([len])
      : len < 256
        ? new Uint8Array([0x81, len])
        : new Uint8Array([0x82, (len >> 8) & 0xff, len & 0xff]);
  const out = new Uint8Array(1 + lenEncoded.length + content.length);
  out[0] = tag;
  out.set(lenEncoded, 1);
  out.set(content, 1 + lenEncoded.length);
  return out;
}

function wrapPkcs1InSpki(pkcs1: Uint8Array): Uint8Array {
  const oid = new Uint8Array([
    0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00,
  ]);
  const algSeq = derTlv(0x30, oid);
  const bitStr = derTlv(0x03, new Uint8Array([0x00, ...pkcs1]));
  return derTlv(0x30, new Uint8Array([...algSeq, ...bitStr]));
}

function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

async function importRsaPublicKey(pubKeyB64: string): Promise<CryptoKey> {
  const bytes = new Uint8Array(Buffer.from(pubKeyB64, "base64"));
  try {
    return await crypto.subtle.importKey(
      "spki", toArrayBuffer(bytes), { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"],
    );
  } catch {
    // Try wrapping PKCS#1 → SPKI
    return await crypto.subtle.importKey(
      "spki", toArrayBuffer(wrapPkcs1InSpki(bytes)), { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"],
    );
  }
}

// Fetches Instagram's RSA public key used to encrypt passwords.
// Returns null if the endpoint is unreachable or doesn't return key data.
// Also returns all Set-Cookie values from /qe/sync/ so the login POST
// includes mid, ig_did, and other cookies Instagram expects.
async function fetchEncryptionKey(
  deviceId: string,
  guid: string,
): Promise<{ keyId: number; pubKey: string; cookieMap: Map<string, string> } | null> {
  try {
    const res = await fetch("https://i.instagram.com/api/v1/qe/sync/", {
      method: "POST",
      headers: {
        ...mobileHeaders({ deviceId, guid }),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ id: guid, server_config_retrieval: "1" }).toString(),
    });
    const keyId = parseInt(res.headers.get("ig-set-password-encryption-key-id") ?? "0", 10);
    const pubKey = res.headers.get("ig-set-password-encryption-pub-key") ?? "";
    const cookieMap = parseSetCookies(res.headers.getSetCookie?.() ?? []);
    if (!pubKey || !keyId) return null;
    return { keyId, pubKey, cookieMap };
  } catch {
    return null;
  }
}

// Instagram password encryption format 4:
//   #PWD_INSTAGRAM:4:{timestamp}:{base64_payload}
//
// Payload layout (bytes):
//   [0x01]          1 byte  version
//   [key_id]        1 byte  server key ID
//   [iv]           12 bytes AES-GCM nonce
//   [enc_key_len]   2 bytes (LE) length of RSA-encrypted AES key
//   [enc_key]     256 bytes RSA-OAEP(SHA-256) encrypted AES key
//   [gcm_tag]      16 bytes AES-GCM authentication tag
//   [enc_pwd]       N bytes AES-256-GCM ciphertext
async function encryptPassword(
  password: string,
  keyId: number,
  pubKeyB64: string,
  timestamp: number,
): Promise<string> {
  const { subtle, getRandomValues } = crypto;
  const enc = new TextEncoder();

  const aesKey = getRandomValues(new Uint8Array(32));
  const iv = getRandomValues(new Uint8Array(12));

  const rsaKey = await importRsaPublicKey(pubKeyB64);
  const encAesKey = new Uint8Array(
    await subtle.encrypt({ name: "RSA-OAEP" }, rsaKey, aesKey),
  );

  const importedAes = await subtle.importKey("raw", aesKey, "AES-GCM", false, ["encrypt"]);
  const encPwdWithTag = new Uint8Array(
    await subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: enc.encode(String(timestamp)), tagLength: 128 },
      importedAes,
      enc.encode(password),
    ),
  );
  // Web Crypto appends the 16-byte GCM tag at the end of the ciphertext
  const tag = encPwdWithTag.slice(-16);
  const encPwd = encPwdWithTag.slice(0, -16);

  const lenBytes = new Uint8Array(2);
  new DataView(lenBytes.buffer).setUint16(0, encAesKey.length, true /* little-endian */);

  const payload = new Uint8Array(2 + iv.length + 2 + encAesKey.length + 16 + encPwd.length);
  let off = 0;
  payload[off++] = 1;
  payload[off++] = keyId;
  payload.set(iv, off); off += iv.length;
  payload.set(lenBytes, off); off += 2;
  payload.set(encAesKey, off); off += encAesKey.length;
  payload.set(tag, off); off += 16;
  payload.set(encPwd, off);

  return `#PWD_INSTAGRAM:4:${timestamp}:${Buffer.from(payload).toString("base64")}`;
}

export async function loginInstagramMobile(creds: {
  username: string;
  password: string;
  totp_secret?: string | null;
}): Promise<LoginResult> {
  const deviceId = `android-${randomHex(8)}`;
  const guid = crypto.randomUUID();
  const phoneId = crypto.randomUUID();
  const adid = crypto.randomUUID();
  const timestamp = Math.floor(Date.now() / 1000);

  const cookieMap = new Map<string, string>();

  // Step 1: Fetch encryption key (also seeds mid, ig_did, csrftoken cookies)
  const keyData = await fetchEncryptionKey(deviceId, guid);
  if (keyData?.cookieMap) {
    for (const [k, v] of keyData.cookieMap) cookieMap.set(k, v);
  }
  const csrf = cookieMap.get("csrftoken") ?? "";

  let encPassword: string;
  if (keyData) {
    try {
      encPassword = await encryptPassword(creds.password, keyData.keyId, keyData.pubKey, timestamp);
    } catch (err) {
      console.error("[ig-mobile-login] password encryption failed:", err);
      return { ok: false, error: `Password encryption failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  } else {
    return { ok: false, error: "Could not fetch Instagram encryption key — request blocked or network error" };
  }

  // Step 2: POST login
  const loginRes = await fetch("https://i.instagram.com/api/v1/accounts/login/", {
    method: "POST",
    headers: {
      ...mobileHeaders({ deviceId, guid, csrf, cookies: cookieStr(cookieMap) }),
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    },
    body: new URLSearchParams({
      username: creds.username,
      enc_password: encPassword,
      device_id: deviceId,
      phone_id: phoneId,
      guid,
      adid,
      login_attempt_count: "0",
      country_codes: JSON.stringify([{ country_code: "1", source: ["default"] }]),
      google_tokens: "[]",
    }).toString(),
  });

  mergeCookies(cookieMap, loginRes.headers.getSetCookie?.() ?? []);

  const rawBody = await loginRes.text().catch(() => "");
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return {
      ok: false,
      error: `Instagram mobile non-JSON (status ${loginRes.status}): ${rawBody.slice(0, 300)}`,
    };
  }

  // 2FA required
  if (json.two_factor_required) {
    if (!creds.totp_secret) {
      return { ok: false, error: "Instagram requires 2FA but no TOTP secret is configured" };
    }
    const tfInfo = (json.two_factor_info ?? {}) as Record<string, string>;
    const totp = generateTotp(creds.totp_secret);
    const tfRes = await fetch("https://i.instagram.com/api/v1/accounts/two_factor_login/", {
      method: "POST",
      headers: {
        ...mobileHeaders({ deviceId, guid, csrf: cookieMap.get("csrftoken") ?? csrf, cookies: cookieStr(cookieMap) }),
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      },
      body: new URLSearchParams({
        username: creds.username,
        verificationCode: totp,
        identifier: tfInfo.two_factor_identifier ?? "",
        trust_this_device: "0",
        verification_method: "3",
        device_id: deviceId,
        guid,
      }).toString(),
    });
    mergeCookies(cookieMap, tfRes.headers.getSetCookie?.() ?? []);
    let tfJson: Record<string, unknown> = {};
    try { tfJson = await tfRes.json() as Record<string, unknown>; } catch { /* ignore */ }
    if (!tfJson.logged_in_user) {
      return { ok: false, error: "2FA verification failed — check your TOTP secret" };
    }
    return buildResult(cookieMap);
  }

  if (json.logged_in_user) return buildResult(cookieMap);

  const msg =
    typeof json.message === "string" ? json.message :
    typeof json.error_type === "string" ? json.error_type :
    `status ${loginRes.status}`;
  return { ok: false, error: `Mobile login rejected: ${msg}` };
}
