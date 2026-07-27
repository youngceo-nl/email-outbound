this file contains the plan for the logic of getting leads into campaigns

## Status (last checked 2026-07-27)

- [x] Campaign type required (info/partnerships)
- [x] Percentage-slider template split — built, not yet exercised with real data
- [ ] Outreach Ready integrated into campaigns tab — **deferred, not doing right now** (see note below)
- [x] Per-campaign-type inboxes + catch-all + campaign tag on replies. on the campaigns tab, we need a master inbox, per campaign inboxes, all leads to be tagget with from what campaign and variant they're from *(re-scoped and built 2026-07-27, see note below)*
- [x] Sent/received timestamps in inbox *(built 2026-07-27, see note below)*
- [x] Positive-reply templates in master inbox (Loom-audit example) *(built 2026-07-27 — re-scoped: authored per-campaign, in-app thread-aware send, see note below)* yeah so what this means is that we write reply templates in the campaigns and then when a reply comes, the VA has a template ready with which he can reply. 
- [x] Cold/warm follow-up chains, auto-assigned, with a menu for manual-input steps *(moved up from "future" — built this pass, see note below; ships inert/paused until manually enabled)*
- [ ] Auto-mark "booked" in email tool on meeting scheduled (optional per original note)

a campaign MUST have a type it is for, either   info or partnerships 

**[x] DONE** — `campaigns.campaign_type` is `not null` with a `check` constraint
restricting it to `infopreneur`/`partnership` (doc's "info"/"partnerships").
Verified live: a direct insert with a null type is rejected by the database,
not just blocked in the UI.

and then for different copy templates the leads get verdeeld according to a percentage slider for control over how many get tested.

**[x] BUILT, UNTESTED WITH REAL DATA** — `campaign_variants` table holds
weighted variants (must sum to 100%), `rollVariant()` does the weighted-random
split per lead, UI has a % input + progress bar per variant. Verified the
100%-sum invariant holds and the DB constraint is enforced. Not yet verified
against a real split in production: the one live campaign ("Info") has a
single 100%-weight variant with **zero email steps configured** and **zero
leads assigned** — the split logic has never actually fired end-to-end yet.

###outreach ready
outreach ready is going to be kept as an inspiration to make the campaign page more functional and as a reserve to fix potential future workflow of program enrichment. 

**[ ] DEFERRED** — each campaign already has its own equivalent "Send" tab
(`/campaigns/[id]`) that mirrors Outreach Ready's UI/logic as a parallel
queue, rather than Outreach Ready being literally nested inside the
Campaigns nav section. Decided 2026-07-26: leave as-is for now — *"we're
going to be pulling inspiration from it until we don't need it anymore."*
Revisit only if that stops being good enough.

###inboxes
there's going to be inboxes per campaign type and one inbox that catches all. an email convo from a specific campaign gets a tag with from which campaign it's from

on the campaigns tab, we need a master inbox, per campaign inboxes, all leads to be tagged with from what campaign and variant they're from

**[x] DONE (2026-07-27)** — a shared query (`lib/inbox/rows.ts`'s
`getInboxRows(admin, { campaignId? })`) now backs three surfaces instead of
one: Outreach Ready's existing inbox (unchanged, everything), a new
**master inbox** tab on `/campaigns` (`?tab=inbox`, everything again — same
data, just also reachable from the Campaigns section, per the confirmed
scope: "if there's replies from our outbound that weren't sent from a real
campaign, then mark them as non-campaign"), and a new **per-campaign inbox**
tab on every `/campaigns/[id]` (scoped to just that campaign's leads).

Every row now always carries a tag — `"{campaign name} · {variant label}"`
when campaign-assigned, or an explicit **"Non-campaign"** badge when not
(previously: a badge or nothing, silently). New
`components/campaigns/campaign-inbox-panel.tsx` (list + detail, reusing the
existing `InboxDetail` component) powers both new tabs; a shared
`inboxCampaignTag()` helper keeps the tag text identical across all three
surfaces.

Verified live: created a real campaign+variant-assigned test reply and
confirmed it resolves to the correct tag in both the master inbox and its
owning campaign's inbox tab (and does *not* leak into a different
campaign's inbox); confirmed the 21 real existing replies all correctly
show "Non-campaign" (matches known state — no lead is assigned to a
campaign yet, same unexercised-in-production caveat as the template split
above). Cleaned up all test data after.


---------------------------------------------------------
#feature to add in the future:
lead reply marking as p/n by AI

**[x] DONE (2026-07-27)** — reply sentiment classification
(`lib/openai/classify-reply.ts`, wired into `syncInbox()` in
`app/actions/inbox.ts`) is 3-way (positive/neutral/negative, not just p/n)
and triggers a Discord alert on positive replies. Found and fixed two real
bugs while verifying: the `sentiment` DB column had never actually been
applied (silently failing since it was first built), and the classifier had
no working API key configured (switched from Claude to OpenAI, which was
already configured) — both confirmed fixed with a live test against real
API calls.

You replied on Jan 10, 2024, 12:51 PM GMT +5:30
so sent times and dates

**[x] DONE (2026-07-27)** — the inbox detail pane now shows both timestamps
with an explicit timezone abbreviation, matching this example's shape:
`"Sent {date} → Replied {date}"` (falls back to just `"Replied {date}"` for
a legacy row with no resolvable originating send). Pulled from
`outreach_messages.sent_at` via `inbox_messages.outreach_message_id` — both
already existed in the schema, this was a join, not a migration. Lands in
all three inbox surfaces at once (Outreach Ready, master inbox, per-campaign
inbox) since they all share `lib/inbox/rows.ts`'s `getInboxRows()`.
Verified live: cross-checked a real row's resolved `sent_at` directly
against its `outreach_messages` row (exact match) and confirmed sent-time
never falls after received-time across all 21 real replies.

templates for positive replies in the master inbox that you can type the message yourself or that it goes by template. 

yeah so what this means is that we write reply templates in the campaigns and then when a reply comes, the VA has a template ready with which he can reply.

**[x] DONE (2026-07-27)** — scope confirmed: authored per-campaign (not
per-reply), auto-rendered for the VA the moment a reply is classified
positive, and sent from an in-app "Send reply" button (not just prefilled
for the VA's own email client).

- **`campaigns.positive_reply_template`** (new column) — one canned reply
  per campaign, authored on that campaign's Overview tab
  (`components/campaigns/campaign-reply-template-form.tsx`), same
  `{{first_name}}`/`{{program_name}}` placeholder syntax as outreach
  templates.
- **`InboxDetail`** now renders that template (via the same
  `buildLeadContext`/`renderTemplate` outreach templates use) into an
  editable box whenever a reply's AI sentiment is `positive` — across all
  three inbox surfaces at once, since they share `getInboxRows()`.
- **`sendInboxReply`** (`app/actions/inbox.ts`) sends the edited reply for
  real, in the SAME Gmail thread as the original conversation — discovered
  that `sendEmail()`/`gmailSend()` (`lib/outreach/gmail.ts`,
  `lib/google/gmail-api.ts`) already fully supported thread-aware replies
  (`inReplyTo`/`references`/`threadId`), built for a need that hadn't been
  used yet — no new Gmail API code needed, just a new caller. Deliberately
  does **not** reuse `sendOutreachEmailCore`: that function's "already
  sent" / "lead replied — stopped" guards are about the outreach sequence
  and would incorrectly block replying to someone who, by definition here,
  already replied.
- New `inbox_messages.replied_at`/`reply_sent_by` columns power a
  persistent "You replied on ..." line once sent (reusing the timezone-
  explicit formatting from the timestamps feature above); the compose box
  hides itself once replied.

Verified live (all via direct DB/function checks, deliberately never
triggering a real Gmail send): a synthetic positive reply resolved the
correct campaign template, the correct thread id (via the
`outreach_messages` join), and the correct inbound Message-Id; template
rendering produced real values with no leftover `{{...}}` placeholders;
the `replied_at` write path round-trips correctly through `getInboxRows()`.
**Not verified**: an actual end-to-end send through the real UI — that
needs a logged-in manual check (with `OUTREACH_DRY_RUN=1` first) since
nothing here should risk firing a real email during automated verification.


template example:

Hey name - no worries, thanks for getting back to me!

We just recorded a quick 4-minute breakdown of a previous case study and how we could potentially achieve something similar for you.

For name: How we can get you 25+ high ticket clients in 3 weeks (https://www.loom.com/share/847ab70b765c40719356c3289a221657)
 (https://www.loom.com/share/847ab70b765c40719356c3289a221657)
You can click on the video or link above to watch ^

Looking forward to your response.

Best regards,
Julian

specifieke manier van formatting: gif thumbnail. 
automatiseren




er zijn 2 follow up chains, cold foloowup and warm folwouyp. we want them to get auto assigned to their leads and when a followup email needs input, to get a menu for those who do.

**[x] DONE (2026-07-27)** — a campaign can now be tagged `campaign_role`:
`cold_followup` or `warm_followup` (at most one live chain of each per
lead track, DB-enforced). Two new Inngest cron jobs:
`route-followup-leads` (hourly) auto-assigns a lead into the cold chain once
its primary sequence completes with zero replies, or into the warm chain
the moment it gets a *positive* reply (even interrupting an in-progress
sequence) — a *negative* reply always halts everything, in every chain.
`auto-send-followups` (every 30 min) sends due steps with no human click,
*unless* a template placeholder (e.g. `{{program_name}}`) doesn't resolve to
something real for that lead — those are left alone and simply keep showing
up in that chain's existing Send tab (now with a "needs input: ..." badge),
which **is** "the menu for those who need input." `sendOutreachEmail` and
`assignLeadsToCampaign`'s core logic were extracted into shared,
auth-agnostic functions so the manual UI and these background jobs run
identical code — verified with a live regression pass that the manual
assign/send flow behaves unchanged.

Also added, since the warm chain can't work without it: a scheduled inbox
sync (`sync-inbox-scheduled`, every 30 min) — previously
`inbox_messages.sentiment` only ever updated on a manual "Refresh" click.

**Ships inert.** Every new cold/warm chain is created `status: paused`, and
both jobs skip anything that isn't `status: active` — per explicit
instruction, nothing auto-sends until a chain is deliberately switched on,
which hasn't been done yet. Confirmed via live test: zero active non-primary
chains exist right now.

Caught and fixed one real bug while building this: the existing Send-tab
query unconditionally hid any lead with `reply_count > 0` — correct for
primary/cold chains, but would have made the warm chain's queue (and the
auto-send job reading it) permanently empty, since a warm-chain lead by
definition has a reply. Fixed to only exclude on a *negative* reply for
warm chains; verified live that a positive-only reply correctly surfaces a
due row, and a subsequent negative reply correctly removes it again.

stel imeadn plant een meeting in, dan moet diegene automatisch in de email tool als email booked staan. (optional if too much effort. first get a booked client)

**[ ] NOT STARTED** (marked optional in the original note)