import "server-only";

export type ApolloResult =
  | { email: string }
  | { reason: string };

export async function findEmailWithApollo({
  apiKey,
  domain,
  fullName,
}: {
  apiKey: string;
  domain: string;
  fullName: string | null;
}): Promise<ApolloResult> {
  const tokens = fullName?.trim().split(/\s+/).filter(Boolean) ?? [];
  const firstName = tokens[0] ?? null;
  const lastName = tokens.slice(1).join(" ") || null;

  const body: Record<string, unknown> = {
    api_key: apiKey,
    organization_domain: domain,
    reveal_personal_emails: false,
  };
  if (firstName) body.first_name = firstName;
  if (lastName) body.last_name = lastName;

  let res: Response;
  try {
    res = await fetch("https://api.apollo.io/api/v1/people/match", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    return { reason: `network_error: ${(err as Error).message.slice(0, 60)}` };
  }

  if (res.status === 401) return { reason: "invalid_api_key" };
  if (res.status === 422) return { reason: "no_match" };
  if (res.status === 429) return { reason: "rate_limited" };
  if (!res.ok) return { reason: `http_${res.status}` };

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return { reason: "parse_error" };
  }

  const email = (json as Record<string, Record<string, string> | null>)?.person?.email ?? null;
  if (!email) return { reason: "no_email" };
  return { email };
}
