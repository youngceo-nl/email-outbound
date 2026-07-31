/*
 * Direct-response CTA detection.
 *
 * A "DM WORD" / "comment WORD" instruction is the strongest conversion signal an
 * Instagram profile can carry: it evidences an operating DM or comment funnel.
 * The spec puts it at the top intent level regardless of what the visitor
 * eventually receives.
 *
 * This is detected deterministically because the extractor kept conflating two
 * different things: WHAT the visitor receives (a blueprint — informational) with
 * HOW direct the action is (comment a keyword — direct sales intent). Surfacing
 * the pattern as explicit evidence removes the ambiguity rather than hoping a
 * prompt sentence lands.
 *
 * This detects the CTA pattern. It does not score it and does not decide
 * anything — the extractor still interprets, and TypeScript still scores.
 */

export type DirectResponseCta = {
  action: "dm" | "comment" | "apply" | "book";
  /** The user-supplied token, e.g. the word to comment. Null when unstructured. */
  keyword: string | null;
  /** Where it was found, for citation. */
  source: string;
  phrase: string;
};

/*
 * Ordered by specificity. A keyword-carrying pattern must be tried before its
 * bare equivalent, or "DM me READY" degrades to a plain "dm" with no token.
 */
const PATTERNS: Array<{ action: DirectResponseCta["action"]; pattern: RegExp; keywordGroup: number }> = [
  // comment "WORD" / comment the word WORD / comment WORD below
  {
    action: "comment",
    pattern: /\bcomment(?:\s+the\s+word)?\s*[:\-]?\s*["“”'‘’]?([A-Za-z0-9][\w-]{1,24})["“”'‘’]?/i,
    keywordGroup: 1,
  },
  /*
   * "DM: WORD", "DM me WORD", "message us WORD". The optional colon matters —
   * bios routinely write `Info? DM: "RUTHLESS"`, which a whitespace-only
   * separator misses entirely.
   */
  {
    action: "dm",
    pattern: /\b(?:dm|message)\s*[:\-]?\s*(?:me\s+|us\s+)?["“”'‘’]?([A-Za-z0-9][\w-]{1,24})["“”'‘’]?/i,
    keywordGroup: 1,
  },
  /*
   * "send" only counts with an explicit me/us target. Without that constraint
   * "I'll send you the blueprint" — the REWARD half of a comment funnel — was
   * being detected as a second, phantom DM CTA.
   */
  {
    action: "dm",
    pattern: /\bsend\s+(?:me|us)\s+["“”'‘’]?([A-Za-z0-9][\w-]{1,24})["“”'‘’]?/i,
    keywordGroup: 1,
  },
  { action: "comment", pattern: /\bcomment\s+below\b/i, keywordGroup: 0 },
  { action: "dm", pattern: /\b(?:dm|message)\s+(?:me|us)\b/i, keywordGroup: 0 },
  { action: "apply", pattern: /\bappl(?:y|ication)\b[^.\n]{0,40}/i, keywordGroup: 0 },
  { action: "book", pattern: /\bbook\s+(?:a\s+)?(?:call|session|consult)[^.\n]{0,30}/i, keywordGroup: 0 },
];

/*
 * Words that follow "DM"/"comment" grammatically but are not the keyword itself.
 * Without this, "DM me for details" yields the keyword "for".
 */
const STOPWORDS = new Set([
  "me", "us", "you", "for", "if", "to", "and", "or", "the", "a", "an", "your",
  "my", "when", "with", "about", "below", "now", "here", "this", "that", "it",
  "word", "over", "get", "them", "their", "our",
]);

export function detectDirectResponseCtas(
  text: string | null | undefined,
  source: string,
): DirectResponseCta[] {
  if (!text) return [];
  const found: DirectResponseCta[] = [];
  const seen = new Set<string>();

  for (const { action, pattern, keywordGroup } of PATTERNS) {
    // Scan globally so a bio with both a DM and a comment CTA reports both.
    const global = new RegExp(pattern.source, `${pattern.flags.replace("g", "")}g`);
    for (const match of text.matchAll(global)) {
      const rawKeyword = keywordGroup > 0 ? match[keywordGroup] : null;
      const keyword =
        rawKeyword && !STOPWORDS.has(rawKeyword.toLowerCase()) ? rawKeyword : null;

      // A bare "dm me" is only worth reporting if no keyword variant already fired.
      const key = `${action}:${keyword?.toLowerCase() ?? ""}`;
      if (seen.has(key)) continue;
      if (!keyword && found.some((cta) => cta.action === action && cta.keyword)) continue;
      seen.add(key);

      const at = match.index ?? 0;
      found.push({
        action,
        keyword,
        source,
        phrase: text.slice(Math.max(0, at - 20), at + match[0].length + 60).replace(/\s+/g, " ").trim(),
      });
      if (found.length >= 6) return found;
    }
  }
  return found;
}

/** Collects direct-response CTAs across every Instagram text surface. */
export function collectDirectResponseCtas(surfaces: Array<{ text: string | null; source: string }>): DirectResponseCta[] {
  const out: DirectResponseCta[] = [];
  const seen = new Set<string>();
  for (const surface of surfaces) {
    for (const cta of detectDirectResponseCtas(surface.text, surface.source)) {
      const key = `${cta.action}:${cta.keyword?.toLowerCase() ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(cta);
      if (out.length >= 8) return out;
    }
  }
  return out;
}
