import type { ManagedAccount } from "@/lib/types";

export function pauseManagedAccount(
  accounts: ManagedAccount[],
  accountUsername: string,
  challenge: string,
): ManagedAccount[] {
  let found = false;
  const updated = accounts.map((account) => {
    if (account.label !== accountUsername) return account;
    found = true;
    return { ...account, paused: true, last_error: `quarantined: ${challenge}` };
  });
  if (!found) throw new Error(`Managed Instagram account ${accountUsername} not found`);
  return updated;
}

export function sanitizeProxyEndpoint(raw: string): string {
  try {
    const url = new URL(raw);
    return `${url.hostname}:${url.port}`;
  } catch {
    return "invalid";
  }
}

export function shouldQuarantine(status: string, errors: string[]): boolean {
  return status === "challenge" || errors.some((error) => /(?:HTTP\s*)?(?:401|403)\b/i.test(error));
}
