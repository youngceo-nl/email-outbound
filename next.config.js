/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: { serverActions: { bodySizeLimit: "5mb" } },
  // Playwright drives real Chromium and must never be bundled into the server
  // build; it's loaded via dynamic import only where a browser is available.
  serverExternalPackages: ["playwright", "playwright-core"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.cdninstagram.com" },
      { protocol: "https", hostname: "scontent*.cdninstagram.com" },
    ],
  },
};

module.exports = nextConfig;
