### 1. Lead categorization: Partnerships vs. Info ✅

**Desired behavior:**
- Leads identified as sales agencies or ads agencies → tagged/labeled "Partnerships"
- Leads identified as info coaches (individuals) → tagged/labeled "Info"

**Questions — answered:**
- Existing logic, not new: the AI classifier already sets `business_model` during
  scoring (`course | coaching | agency | ecom | saas | creator | unknown`), and the
  classifier prompt already treats agencies and infopreneurs as two distinct target
  types. No new AI step or DB column — `lib/leads/category.ts` just maps
  `agency → Partnerships`, `course|coaching → Info`.
- So: AI classification during enrichment, not manual tagging or keyword rules.
- Leads that are neither (ecom/saas/creator/unknown/null — ~35% of ready leads in
  practice) get a **third category, "Other"** rather than being hidden or forced
  into one of the two — see #2.

---

### 2. Outreach-ready page: pagination by category ✅

**Current behavior:**
![alt text](<Screenshot 2026-07-21 at 11.33.12 AM.png>)
no ability to switch tabs between partnerships and info

**Desired behavior:**
- Add ability to switch between Partnerships and Info leads
- Each category should support different outreach copy/templates when sending

**Shipped:** three tabs (Partnerships / Info / **Other**, per #1) on the rail header with live ready-counts. Each tab has its own subject+body template pair, editable under Settings → Outreach copy (seeded from the old single template, so nothing changed on migrate). Switching tabs auto-selects a lead from that tab; the composer shows a category badge and renders using that lead's own template. Verified against live data: Partnerships 5, Info 21, Other 14 ready leads.

---

### 3. Outreach-ready page: inbox view toggle ✅

**Desired behavior:**
- Add ability to switch between: (a) current view — all leads ready to 
  send, and (b) an inbox view — to see replies and respond to them
- in relation to the category toggle is this the might structure: category --> outbound ready / inbox view

**Shipped:** built exactly on your suggested structure — category tabs (from #2), then a Ready to send / Inbox toggle nested under them, both on the same /outreach-ready page (not a separate page). Restored the reply-sync engine (`syncInbox`) and OAuth connect flow from `archive/`, plus a new Settings -> Gmail card to connect/reconnect. Replies are scoped to the active category tab, with an unread badge on the Inbox pill; selecting a reply marks it read and shows the full message with a "View lead" link.

Along the way this caught and fixed a real, pre-existing bug: the database's `gmail_message_id` uniqueness constraint was a *partial* index, which Postgres can't match against the app's upsert — every sync attempt was silently inserting 0 rows, so `inbox_messages` had been empty this whole time despite real replies sitting in the mailbox. Fixed via migration, then ran a real sync as verification: **20 real replies pulled in across 14 leads** (Info 10, Other 8, Partnerships 2), `leads.reply_count` correctly updated for all 14.

everything you do and accomplish put a checkmark in this md