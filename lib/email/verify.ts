import "server-only";
import { verifyWithNeverbounce } from "./neverbounce";
import { verifyWithZerobounce } from "./zerobounce";
import type { VerifyResult } from "./neverbounce";

export type { VerifyResult };

// Run email through whichever verifier is configured.
// Tries Zerobounce first, then Neverbounce — caller can pass both keys and we pick.
// Returns null when no verifier is configured (caller skips verification).
export async function verifyEmail(opts: {
  email: string;
  zerobounceKey: string | null | undefined;
  neverbounceKey: string | null | undefined;
}): Promise<VerifyResult | null> {
  if (opts.zerobounceKey?.trim()) {
    return verifyWithZerobounce({ apiKey: opts.zerobounceKey.trim(), email: opts.email });
  }
  if (opts.neverbounceKey?.trim()) {
    return verifyWithNeverbounce({ apiKey: opts.neverbounceKey.trim(), email: opts.email });
  }
  return null; // no verifier configured
}

// Map a verification result to the email_status value we store in the DB.
// "valid"   → confirmed deliverable — send
// "risky"   → catch-all domain, likely fine — send
// "unknown" → couldn't verify — send (better than losing a lead over it)
// "invalid" → confirmed bad — skip
export function verifyStatusToEmailStatus(result: VerifyResult): string {
  if (result.status === null) return "found"; // verification error — treat as unverified
  return result.status; // "valid" | "risky" | "unknown" | "invalid"
}
