/*
 * Version constants for the qualification pipeline.
 *
 * Every stored decision references these. Changing traversal behavior, page
 * extraction, prompt wording, or the label-to-point mapping REQUIRES bumping the
 * corresponding version — otherwise two decisions carrying the same version
 * string are not actually comparable and the shadow benchmark silently lies.
 */

/*
 * 1.1.0: adds profile/post images, persisted highlight covers, and the
 * Steel-rendered funnel (capture_method "rendered") to the snapshot. Old
 * snapshots keep validating — the new surfaces are optional — but cannot be
 * replayed into Gate 2 or paid-offer evidence; they report those surfaces as
 * unknown rather than a wrong answer.
 */
export const ACQUISITION_VERSION = "acquisition-1.1.0";
export const FIXTURE_REVISION = "fixtures-2026-07-31";
/* v2 adds coach_or_consultant, offer paid/active status, and funnel maturity. */
export const EXTRACTION_PROMPT_VERSION = "personal-brand-evidence-v2";
export const CHALLENGER_PROMPT_VERSION = "personal-brand-challenger-v1";
/*
 * icp-gates-score-v1: the "Revised Instagram ICP Qualification Logic" PDF's
 * four hard gates + 12-point six-dimension scorer, replacing the old 10-point
 * commercial_fit ladders entirely (not a shadow). Bumped from
 * personal-brand-score-v1 because the label-to-point mapping changed
 * completely — decisions under the two versions are not comparable.
 */
export const SCORECARD_VERSION = "icp-gates-score-v1";
export const VISION_PROMPT_VERSION = "gate2-visual-identity-v1";
export const CONFIG_VERSION = "config-v1";
export const PIPELINE_VERSION = "commercial-qualification-1.0.0";
