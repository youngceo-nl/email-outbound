import type { AppSettings, ManagedAccount } from "../lib/types";

const IDENTITIES = [
  {
    label: "masakonjoku61",
    proxyKey: "OXYLABS_PROXY_1",
    steelProfileId: "bf738a3d-4d46-40e4-91d9-6875e331999c",
  },
  {
    label: "bethannbuczek1",
    proxyKey: "OXYLABS_PROXY_2",
    steelProfileId: "73f41a07-06d5-4c0a-a8db-8cc98c51b474",
  },
  {
    label: "allinedowho",
    proxyKey: "OXYLABS_PROXY_3",
    steelProfileId: "6e9e7e59-cb7f-4a62-b60a-31fb4e6555be",
  },
] as const;

export type ProductionIdentityUpdate = Pick<
  AppSettings,
  | "instagram_accounts"
  | "instagram_proxy_pool"
  | "active_account_group"
  | "ig_cookie_status"
  | "backfill_cancel_requested"
  | "backfill_started_at"
>;

export function buildProductionIdentityUpdate(
  settings: AppSettings,
  env: Record<string, string | undefined>,
): ProductionIdentityUpdate {
  const configured = new Map<string, { proxyUrl: string; steelProfileId: string }>();
  for (const identity of IDENTITIES) {
    const proxyUrl = env[identity.proxyKey]?.trim();
    if (!proxyUrl) throw new Error(`${identity.proxyKey} is required`);
    configured.set(identity.label, { proxyUrl, steelProfileId: identity.steelProfileId });
  }

  const existing = new Map((settings.instagram_accounts ?? []).map((account) => [account.label, account]));
  for (const identity of IDENTITIES) {
    const account = existing.get(identity.label);
    if (!account) throw new Error(`Approved account ${identity.label} is missing`);
    if (!account.cookie?.trim()) throw new Error(`Cookie missing for ${identity.label}`);
  }

  const instagram_accounts: ManagedAccount[] = (settings.instagram_accounts ?? []).map((account) => {
    const identity = configured.get(account.label);
    if (identity) {
      return {
        ...account,
        group: "C",
        paused: false,
        proxy_url: identity.proxyUrl,
        steel_profile_id: identity.steelProfileId,
        last_error: null,
      };
    }
    if ((account.group?.trim() || null) === "C") return { ...account, paused: true };
    return account;
  });

  return {
    instagram_accounts,
    instagram_proxy_pool: [],
    active_account_group: "C",
    ig_cookie_status: "live",
    backfill_cancel_requested: false,
    backfill_started_at: null,
  };
}
