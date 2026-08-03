import { Inngest, EventSchemas } from "inngest";

type Events = {
  "crawl/seed.requested": {
    data: {
      crawl_job_id: string;
      seed_id: string;
      seed_username: string;
      // Optional one-off override of the configured scrape provider.
      provider_override?: string | null;
    };
  };
  "crawl/profile.discovered": {
    data: {
      crawl_job_id: string;
      seed_id: string | null;
      username: string;
      depth: number;
      parent_username: string | null;
    };
  };
  "crawl/recurse.requested": {
    data: {
      crawl_job_id: string;
      seed_id: string | null;
      username: string;
      depth: number;
    };
  };
  "leads/backfill.metadata.requested": {
    data: {
      usernames: string[];
      crawl_job_id?: string | null;
    };
  };
  /*
   * Batched bio-link pre-filter, between starting a run and fanning out to
   * Steel. Carries the whole lead list rather than one event per lead: the
   * saving comes from asking Apify about fifty profiles at once.
   */
  "run/prefilter.requested": {
    data: {
      run_id: string;
      leads: Array<{ id: string; username: string }>;
    };
  };
  "lead/profile-acquisition.requested": {
    data: {
      lead_id: string;
      username: string;
      crawl_job_id?: string | null;
      event_index?: number;
      /* Set when the lead is part of a named test run — see /test-environment. */
      run_id?: string | null;
    };
  };
  "lead/qualification.requested": {
    data: {
      lead_id: string;
      evidence_snapshot_id: string;
      crawl_job_id?: string | null;
      /* Carried from the acquisition event so a run stays attributable. */
      run_id?: string | null;
    };
  };
  "lead/score.requested": {
    data: {
      lead_id: string;
      crawl_job_id?: string | null;
      /** Set to true to bypass the "already scored" skip guard and force a re-classification */
      force?: boolean;
    };
  };
  /*
   * Observational. Runs the evidence-first pipeline on a lead the live scorer
   * has already decided, and records the comparison. Consuming it never changes
   * the lead — see inngest/functions/shadow-qualify.ts.
   */
  "lead/shadow-qualify.requested": {
    data: {
      lead_id: string;
      crawl_job_id?: string | null;
      /** The live scorer's verdict, captured at send time rather than re-read later. */
      legacy_status?: string | null;
      legacy_score?: number | null;
    };
  };
};

// Decide dev vs. cloud deterministically instead of letting the SDK guess.
// Rule: only talk to Inngest Cloud when a real event key is configured.
// Otherwise force dev mode so events always go to the local dev server
// (http://localhost:8288). This makes the "401 Event key not found" cloud
// fallback impossible during local development — no key, no cloud, ever.
// Set INNGEST_DEV=0 (or "false") to override and force cloud explicitly.
const isDev =
  process.env.INNGEST_DEV !== undefined
    ? process.env.INNGEST_DEV !== "0" && process.env.INNGEST_DEV !== "false"
    : !process.env.INNGEST_EVENT_KEY;

export const inngest = new Inngest({
  id: "email-outbound",
  schemas: new EventSchemas().fromRecord<Events>(),
  isDev,
});
