// Free path: ScrapingBee the About page, extract with the system's real extractor.
import { extractEmailFromHtml, extractEmailFromText } from "./lib/leads/email-extract";
const apiKey = process.env.SCRAPINGBEE_API_KEY!;
const aboutUrl = "https://www.youtube.com/@caspersmc/about";
const params = new URLSearchParams({ api_key: apiKey, url: aboutUrl, render_js: "true", premium_proxy: "true", block_resources: "true" });
const res = await fetch(`https://app.scrapingbee.com/api/v1/?${params}`);
const body = await res.text();
console.error("scrapingbee HTTP", res.status, "| html length", body.length);
const email = extractEmailFromHtml(body) ?? extractEmailFromText(body);
console.log(JSON.stringify({ source: "youtube_about_free", email: email ?? null }));
