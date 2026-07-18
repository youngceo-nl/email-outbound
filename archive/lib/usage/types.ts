import "server-only";
import type { ProviderId } from "./pricing";

export type ProviderStatus = {
  id: ProviderId;
  name: string;
  configured: boolean;
  live: boolean;
  plan: string | null;
  used: number | null;
  total: number | null;
  unit: string;
  note: string | null;
  error: string | null;
  fetchedAt: string;
};
