// One place to get a Chromium browser + context, whether it runs locally or on
// a remote/hosted browser. Set BROWSER_WS_ENDPOINT to a CDP WebSocket URL to
// run off your machine — e.g. a self-hosted browserless container
//   ws://YOUR_HOST:3000?token=YOUR_TOKEN
// or a Browserbase / Browserless cloud connect URL. When it's unset we launch
// Chromium locally (dev / worker with a browser installed).
//
// Playwright is imported dynamically so it never lands in the serverless bundle.

import type { Browser, BrowserContext } from "playwright";

export type ConnectResult = { browser: Browser; context: BrowserContext; isRemote: boolean };

export async function connectBrowser(opts: {
  headless?: boolean;
  proxy?: string | null; // local-launch only; for remote, configure the proxy on the provider
  args?: string[]; // extra Chromium launch flags (local-launch only)
  contextOptions?: Parameters<Browser["newContext"]>[0];
}): Promise<ConnectResult> {
  const { chromium } = await import("playwright");
  const endpoint = process.env.BROWSER_WS_ENDPOINT;

  if (endpoint) {
    const browser = await chromium.connectOverCDP(endpoint);
    // Hosted providers (e.g. Browserbase) hand back a pre-configured context;
    // plain browserless starts empty, so create one with our options.
    const existing = browser.contexts()[0];
    const context = existing ?? (await browser.newContext(opts.contextOptions as never));
    return { browser, context, isRemote: true };
  }

  const launchOpts = {
    headless: opts.headless ?? true,
    ...(opts.proxy ? { proxy: { server: opts.proxy } } : {}),
    ...(opts.args ? { args: opts.args } : {}),
  };
  const browser = await chromium.launch(launchOpts);
  const context = await browser.newContext(opts.contextOptions as never);
  return { browser, context, isRemote: false };
}
