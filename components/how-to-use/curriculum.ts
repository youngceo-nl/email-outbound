export interface Lesson {
  step: number;
  title: string;
  hasSop: boolean;
  body: string[];
  /** Google Doc file ID for the attached SOP, embedded via /preview. */
  docId?: string;
}

export interface Chapter {
  title: string;
  lessons: Lesson[];
}

export const CURRICULUM: Chapter[] = [
  {
    title: "Daily Workflow - Step by Step",
    lessons: [
      {
        step: 1,
        title: "Log into Clay",
        hasSop: true,
        docId: "1PhHM7aHAjsvmAEken794Kx1DYTPnW50CQgA7egR_t8M",
        body: [
          "Get credentials from Discord #clay-account-rotation (link: TBD - confirm with Ops). Copy/paste only, never guess or modify.",
        ],
      },
      {
        step: 2,
        title: "Pick & scrape seed accounts",
        hasSop: true,
        docId: "1KlQygMODIZ6G4u7j4JwMAUFhfEl3KJ4_KqdmA46eIfo",
        body: [
          "Choose accounts that clearly follow relevant infopreneurs/creators. Add as seed, start scrape, then check the pipeline (new / excluded counts).",
          "If the backfill stalls, stop and report it - do not force-rerun. Large \"waiting review\" queues are a dev escalation, not VA work.",
        ],
      },
      {
        step: 3,
        title: "Set up the Clay table for the batch",
        hasSop: true,
        docId: "1_cOWAvWf3ZDKta-fcghSdLHMGwGh1skm3m9oSAejLhk",
        body: [
          "Open the table link, confirm template/structure matches the source. Add a \"Text Done\" column, filter Done = empty, paste in the batch (~15 leads), delete the placeholder header row.",
        ],
      },
      {
        step: 4,
        title: "Process Handover badges one at a time",
        hasSop: true,
        docId: "15H9E9NqlWzpOCSW2c50E0sRmwwLPQM_Vk_Qik8ahGZY",
        body: [
          "Copy, enrich, upload - one badge at a time. Use Cancel to pause without losing the record; never run multiple badges in parallel.",
        ],
      },
      {
        step: 5,
        title: "Enrich each lead",
        hasSop: true,
        docId: "1MtXzxkw8kHPhSKVqJKe22a5oLbBElbukF6Y43jjfWVQ",
        body: [
          "Search order: LinkedIn -> YouTube/social bio -> Hunter.io (domain + name) -> website (footer, privacy policy, T&Cs) -> mobile email button.",
          "No result after all sources? Mark \"open and lost\" with a dash and move on - do not reprocess a closed lead.",
        ],
      },
      {
        step: 6,
        title: "Verify the Program Name",
        hasSop: true,
        docId: "1YuVy0faAyAaboRn9Jh1WyXf649x5Us6Wq60OOEdIeeM",
        body: [
          "Check the lead's Instagram bio, display name, logo and linked pages. Replace the generic auto-filled name only when confirmed; otherwise keep the default greeting - never guess.",
        ],
      },
      {
        step: 7,
        title: "Export enriched leads & hand over",
        hasSop: true,
        docId: "16pnWdsPN5A-j_c2TacQJm2jmBRnXOkPw4IKan8At618",
        body: [
          "Confirm every lead's personal-email field is filled or dashed. Tools -> Export -> Download CSV, rename with the batch ID, then Upload Enriched CSV in the Handover tab and check the match summary.",
        ],
      },
      {
        step: 8,
        title: "Send emails",
        hasSop: true,
        docId: "1bljFaZdgBUSi6QULt59X-pBEDZrlBPIhyhSl_VmpBjY",
        body: [
          "Once Program Name is confirmed, click Send Email immediately for every eligible lead. Quick visual check, then Send. Replies are handled separately - do not action them here.",
        ],
      },
      {
        step: 9,
        title: "End-of-day report",
        hasSop: false,
        body: [
          "Post in Discord #eod: tasks completed, KPIs hit, blockers, tomorrow's priorities, open questions.",
        ],
      },
    ],
  },
];
