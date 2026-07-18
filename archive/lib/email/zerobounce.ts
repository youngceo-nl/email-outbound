// https://zerobounce.net — Single email validation
// Docs: https://www.zerobounce.net/docs/email-validation-api-quickstart/
// Status values: valid, invalid, catch-all, unknown, spamtrap, abuse, do_not_mail

import type { VerifyResult } from "./neverbounce";
export type { VerifyResult };

export async function verifyWithZerobounce(opts: {
  apiKey: string;
  email: string;
}): Promise<VerifyResult> {
  try {
    const url = new URL("https://api.zerobounce.net/v2/validate");
    url.searchParams.set("api_key", opts.apiKey);
    url.searchParams.set("email", opts.email);
    url.searchParams.set("ip_address", "");

    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return { status: null, error: `http_${res.status}` };

    const body = await res.json() as {
      status: string; // "valid" | "invalid" | "catch-all" | "unknown" | "spamtrap" | "abuse" | "do_not_mail"
      error?: string;
    };

    if (body.error) return { status: null, error: body.error.slice(0, 80) };

    const mapped: Record<string, VerifyResult["status"]> = {
      "valid": "valid",
      "invalid": "invalid",
      "catch-all": "risky",
      "unknown": "unknown",
      "spamtrap": "invalid",
      "abuse": "invalid",
      "do_not_mail": "invalid",
    };
    const status = mapped[body.status] ?? "unknown";
    return { status, provider: "zerobounce" };
  } catch (err) {
    return { status: null, error: err instanceof Error ? err.message.slice(0, 80) : "fetch_error" };
  }
}
