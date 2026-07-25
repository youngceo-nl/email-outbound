// No `import "server-only"` guard here: that package isn't a dependency of this
// repo (the archived funnel modules import it and would not compile today). This
// module reads font files off disk and must only ever be imported from server
// code — pulling it into a client bundle would ship ~470kb of base64 to the
// browser for no reason.
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The three CB faces, inlined as base64 data URIs.
 *
 * Inlining rather than serving them is deliberate: the PDF is produced by a
 * headless browser that may be remote (lib/browser/connect.ts talks CDP to a
 * browserless/Browserbase endpoint when BROWSER_WS_ENDPOINT is set), so a
 * relative /fonts URL wouldn't resolve and a race on font loading would show up
 * as a silent fallback to Georgia — the single most visible way for the PDF to
 * stop looking like the reference. Embedded bytes can't race and can't 404.
 *
 * Cost is ~470kb of CSS, which is irrelevant for a server-rendered document.
 * Extracted from the brand guide by scripts/extract-brand-assets.mjs; the .woff2
 * files are committed, so this never touches the network.
 */
const ASSETS = join(process.cwd(), "lib", "report", "renderer", "assets");
const FONT_DIR = join(ASSETS, "fonts");

type Face = { family: string; file: string; weight: string; format: "woff2" | "woff" };

const FACES: Face[] = [
  { family: "CB Funnel Display", file: "funnel-display-400.woff2", weight: "400", format: "woff2" },
  { family: "CB Funnel Display", file: "funnel-display-600.woff2", weight: "600", format: "woff2" },
  { family: "CB Funnel Display", file: "funnel-display-700.woff2", weight: "700", format: "woff2" },
  { family: "CB Funnel Display", file: "funnel-display-800.woff2", weight: "800", format: "woff2" },
  // Variable faces: one file covers the whole range, declared as a weight range
  // so the browser synthesises nothing.
  { family: "CB Inter", file: "inter-100-900.woff2", weight: "100 900", format: "woff2" },
  { family: "CB Geist Mono", file: "geist-mono-100-900.woff", weight: "100 900", format: "woff" },
];

let cached: string | null = null;

/** `@font-face` declarations with the font bytes inlined. Cached for process lifetime. */
export function fontFaceCss(): string {
  if (cached) return cached;

  cached = FACES.map((face) => {
    const b64 = readFileSync(join(FONT_DIR, face.file)).toString("base64");
    const mime = face.format === "woff2" ? "font/woff2" : "font/woff";
    return [
      "@font-face{",
      `font-family:'${face.family}';`,
      `src:url(data:${mime};base64,${b64}) format('${face.format}');`,
      `font-weight:${face.weight};`,
      "font-style:normal;",
      // `block` rather than `swap`: for a PDF we would rather wait than commit a
      // fallback-font frame to paper. The bytes are already local, so the block
      // period is effectively zero.
      "font-display:block;",
      "}",
    ].join("");
  }).join("\n");

  return cached;
}

let cachedLogos: { mark: string; wordmark: string } | null = null;

/**
 * Both lockups as inline SVG strings.
 *
 * The wordmark is the accent-red mark plus a live <text> element set in CB
 * Funnel Display 700 — not outlined letterforms — so it only renders correctly
 * once fontFaceCss() is in the document. Its text fill is `currentColor`, so
 * the caller sets the wordmark colour via CSS `color` and it flips to white on
 * the Ink surface. The mark's own fill stays accent red on every ground, per
 * the brand guide's "keep the mark Accent Red on every background".
 */
export function logos(): { mark: string; wordmark: string } {
  if (cachedLogos) return cachedLogos;
  cachedLogos = {
    mark: readFileSync(join(ASSETS, "logo-mark.svg"), "utf8"),
    wordmark: readFileSync(join(ASSETS, "logo-wordmark.svg"), "utf8"),
  };
  return cachedLogos;
}
