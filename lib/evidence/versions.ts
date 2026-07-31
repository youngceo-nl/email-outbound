/*
 * Version constants for the qualification pipeline.
 *
 * Every stored decision references these. Changing traversal behavior, page
 * extraction, prompt wording, or the label-to-point mapping REQUIRES bumping the
 * corresponding version — otherwise two decisions carrying the same version
 * string are not actually comparable and the shadow benchmark silently lies.
 */

export const ACQUISITION_VERSION = "acquisition-1.0.0";
export const FIXTURE_REVISION = "fixtures-2026-07-31";
export const EXTRACTION_PROMPT_VERSION = "personal-brand-evidence-v1";
export const CHALLENGER_PROMPT_VERSION = "personal-brand-challenger-v1";
export const SCORECARD_VERSION = "personal-brand-score-v1";
export const CONFIG_VERSION = "config-v1";
export const PIPELINE_VERSION = "commercial-qualification-1.0.0";
