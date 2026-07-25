/*
 * Pulls the embedded CB fonts and logo lockups out of the saved brand-guide HTML
 * into lib/report/renderer/assets.
 *
 *   node scripts/extract-brand-assets.mjs ["path/to/brand guide.html"]
 *
 * One-shot: the extracted files are committed, so this only needs re-running when
 * the brand guide itself changes. Kept in the repo rather than thrown away so the
 * provenance of those binary assets is recorded somewhere.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_SRC = "C:/Users/CLERICK/Downloads/Conversion Brands \u2014 Brand & Style Guide.html";
const SRC = process.argv[2] ?? DEFAULT_SRC;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "lib", "report", "renderer", "assets");
const FONT_DIR = join(OUT, "fonts");
mkdirSync(FONT_DIR, { recursive: true });

let html;
try {
  html = readFileSync(SRC, "utf8");
} catch {
  console.error(`Could not read the brand guide at:\n  ${SRC}\n\nPass the path as the first argument.`);
  process.exit(1);
}

// ── fonts ───────────────────────────────────────────────────────────────────
// Each @font-face block carries one family, one weight (or a variable range),
// and one or more data: URIs. Only the first URI per block is kept — the others
// are duplicate subsets of the same face.
const slug = (s) => s.replace(/^CB /, "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
const faces = [];

for (const raw of html.split("@font-face{").slice(1)) {
  const block = raw.slice(0, raw.indexOf("}"));
  const family = block.match(/font-family:\s*'([^']+)'/)?.[1];
  // Skip anything the browser extension that saved this page injected.
  if (!family || !family.startsWith("CB ")) continue;

  const weight = block.match(/font-weight:\s*([\d\s]+);/)?.[1].trim() ?? "400";
  const uri = block.match(/data:font\/(woff2?);base64,([A-Za-z0-9+/=]+)/);
  if (!uri) continue;

  const [, format, b64] = uri;
  const file = `${slug(family)}-${weight.replace(/\s+/g, "-")}.${format}`;
  const bytes = Buffer.from(b64, "base64");
  writeFileSync(join(FONT_DIR, file), bytes);
  faces.push({ family, weight, file, kb: (bytes.length / 1024).toFixed(1) });
}

// ── logo ────────────────────────────────────────────────────────────────────
// Keyed on viewBox rather than a class name: the two lockups have distinct,
// unique viewBoxes and that attribute lives inside the opening tag, so walking
// back from it always lands on the right <svg>. Class markers are not
// symmetrical here — cover-mark sits on the svg, logo-panel on its parent div.
function grabSvg(viewBox) {
  const at = html.indexOf(`viewBox="${viewBox}"`);
  if (at === -1) return null;
  const start = html.lastIndexOf("<svg", at);
  const end = html.indexOf("</svg>", start);
  if (start === -1 || end === -1) return null;
  return html.slice(start, end + "</svg>".length);
}

const mark = grabSvg("0 0 240 243");

// The lockup is the mark path plus a live <text> set in CB Funnel Display — not
// outlined letterforms — so it only renders once the embedded font is present.
// Its text fill is hardcoded to ink; swap in currentColor so the wordmark can
// flip to white on the Ink surface. The mark's own fill stays accent red on every
// ground, per the brand guide, so that one is left alone.
let wordmark = grabSvg("0 0 1240.33 342.79");
if (wordmark) wordmark = wordmark.replace('<text fill="#1E1B18"', '<text fill="currentColor"');

if (mark) writeFileSync(join(OUT, "logo-mark.svg"), mark);
if (wordmark) writeFileSync(join(OUT, "logo-wordmark.svg"), wordmark);

for (const f of faces) console.log(`  ${f.file.padEnd(30)} ${f.family} ${f.weight}  ${f.kb}kb`);
console.log(`  ${"logo-mark.svg".padEnd(30)} ${mark ? "ok" : "NOT FOUND"}`);
console.log(`  ${"logo-wordmark.svg".padEnd(30)} ${wordmark ? "ok" : "NOT FOUND"}`);
