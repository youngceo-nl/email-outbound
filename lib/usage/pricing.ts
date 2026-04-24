import "server-only";

export type Tier = {
  name: string;
  price: string;
  unit: string;
  highlight?: boolean;
};

export type ProviderId = "apify" | "scrapingbee" | "airscale" | "openai" | "claude";

export type ProviderMeta = {
  id: ProviderId;
  name: string;
  unit: string;
  pricingUrl: string;
  dashboardUrl: string;
  tiers: Tier[];
};

export const PROVIDERS: ProviderMeta[] = [
  {
    id: "apify",
    name: "Apify",
    unit: "USD/month",
    pricingUrl: "https://apify.com/pricing",
    dashboardUrl: "https://console.apify.com/billing",
    tiers: [
      { name: "Free",    price: "$0",   unit: "/mo · $5 platform credit" },
      { name: "Starter", price: "$49",  unit: "/mo · $49 in credits" },
      { name: "Scale",   price: "$499", unit: "/mo · $500 in credits" },
      { name: "Business", price: "$999+", unit: "/mo · custom" },
    ],
  },
  {
    id: "scrapingbee",
    name: "ScrapingBee",
    unit: "API credits/month",
    pricingUrl: "https://www.scrapingbee.com/#pricing",
    dashboardUrl: "https://app.scrapingbee.com/account/api_credits",
    tiers: [
      { name: "Freelance",   price: "$49",   unit: "/mo · 150k credits" },
      { name: "Startup",     price: "$99",   unit: "/mo · 1M credits" },
      { name: "Business",    price: "$249",  unit: "/mo · 3M credits" },
      { name: "Business+",   price: "$599",  unit: "/mo · 8M credits" },
    ],
  },
  {
    id: "airscale",
    name: "AirScale",
    unit: "email lookups",
    pricingUrl: "https://airscale.io/pricing",
    dashboardUrl: "https://app.airscale.io/billing",
    tiers: [
      { name: "Starter", price: "$39",  unit: "/mo · 1k credits" },
      { name: "Growth",  price: "$99",  unit: "/mo · 5k credits" },
      { name: "Scale",   price: "$299", unit: "/mo · 25k credits" },
    ],
  },
  {
    id: "openai",
    name: "OpenAI",
    unit: "USD/1M tokens",
    pricingUrl: "https://openai.com/api/pricing",
    dashboardUrl: "https://platform.openai.com/usage",
    tiers: [
      { name: "gpt-4o-mini", price: "$0.15", unit: "/1M input · $0.60 output" },
      { name: "gpt-4o",      price: "$2.50", unit: "/1M input · $10 output" },
    ],
  },
  {
    id: "claude",
    name: "Anthropic Claude",
    unit: "USD/1M tokens",
    pricingUrl: "https://www.anthropic.com/pricing",
    dashboardUrl: "https://console.anthropic.com/settings/usage",
    tiers: [
      { name: "Haiku 4.5",  price: "$1",   unit: "/1M input · $5 output" },
      { name: "Sonnet 4.6", price: "$3",   unit: "/1M input · $15 output" },
      { name: "Opus 4.7",   price: "$15",  unit: "/1M input · $75 output" },
    ],
  },
];

export function getProviderMeta(id: ProviderId): ProviderMeta {
  const m = PROVIDERS.find((p) => p.id === id);
  if (!m) throw new Error(`unknown provider: ${id}`);
  return m;
}
