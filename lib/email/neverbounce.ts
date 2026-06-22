// https://neverbounce.com — Single email verification
// Docs: https://developers.neverbounce.com/reference/single-verify
// Result codes: 0=valid, 1=invalid, 2=disposable, 3=catchall, 4=unknown

export type VerifyResult =
  | { status: "valid" | "risky" | "invalid" | "unknown"; provider: string }
  | { status: null; error: string };

export async function verifyWithNeverbounce(opts: {
  apiKey: string;
  email: string;
}): Promise<VerifyResult> {
  try {
    const url = new URL("https://api.neverbounce.com/v4/single/check");
    url.searchParams.set("key", opts.apiKey);
    url.searchParams.set("email", opts.email);
    url.searchParams.set("address_info", "0");
    url.searchParams.set("credits_info", "0");

    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return { status: null, error: `http_${res.status}` };

    const body = await res.json() as {
      status: string;
      result: string; // "valid" | "invalid" | "disposable" | "catchall" | "unknown"
      result_code: number;
    };

    if (body.status !== "success") return { status: null, error: body.status ?? "api_error" };

    const mapped: Record<string, VerifyResult["status"]> = {
      valid: "valid",
      invalid: "invalid",
      disposable: "invalid",
      catchall: "risky",
      unknown: "unknown",
    };
    const status = mapped[body.result] ?? "unknown";
    return { status, provider: "neverbounce" };
  } catch (err) {
    return { status: null, error: err instanceof Error ? err.message.slice(0, 80) : "fetch_error" };
  }
}
