import "server-only";

export type Tier = {
  name: string;
  price: string;
  unit: string;
  highlight?: boolean;
};

export type ProviderId = "apify" | "scrapingbee" | "openai" | "claude" | "gemini" | "groq";

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
  {
    id: "gemini",
    name: "Google Gemini",
    unit: "USD/1M tokens",
    pricingUrl: "https://ai.google.dev/pricing",
    dashboardUrl: "https://aistudio.google.com/apikey",
    tiers: [
      { name: "Flash (free tier)", price: "$0", unit: "/mo · rate-limited" },
    ],
  },
  {
    id: "groq",
    name: "Groq",
    unit: "USD/1M tokens",
    pricingUrl: "https://groq.com/pricing",
    dashboardUrl: "https://console.groq.com/keys",
    tiers: [
      { name: "Llama 3.3 70B (free tier)", price: "$0", unit: "/mo · rate-limited" },
    ],
  },
];

export function getProviderMeta(id: ProviderId): ProviderMeta {
  const m = PROVIDERS.find((p) => p.id === id);
  if (!m) throw new Error(`unknown provider: ${id}`);
  return m;
}
