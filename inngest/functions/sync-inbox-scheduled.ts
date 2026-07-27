import { inngest } from "@/inngest/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSettings } from "@/lib/config/settings";
import { syncInboxCore } from "@/lib/inbox/sync";

// Keeps inbox_messages/leads.reply_count/sentiment fresh on a timer instead
// of only on a manual "Refresh" click (app/actions/inbox.ts's syncInbox()) —
// required for route-followup-leads' warm-chain routing to be meaningfully
// automatic, since it reads inbox_messages.sentiment. Its own function so it
// can be disabled independently of the routing/auto-send jobs if needed.
export const syncInboxScheduled = inngest.createFunction(
  {
    id: "sync-inbox-scheduled",
    name: "Scheduled inbox sync (Gmail + reply sentiment)",
    retries: 1,
    concurrency: [{ limit: 1 }],
  },
  { cron: "*/30 * * * *" }, // start slow — each tick does a Gmail fetch/search plus one OpenAI call per new reply
  async ({ step }) => {
    return step.run("sync", async () => {
      const admin = createAdminClient();
      const settings = await getSettings();
      return syncInboxCore(admin, settings);
    });
  },
);
