-- Private bucket for persisted profile/post images used as Gate 2 visual
-- evidence ("the individual appears prominently in the content").
--
-- Instagram CDN URLs are signed and expire within days, which breaks the
-- qualification pipeline's replay guarantee: a decision must be reproducible
-- from exactly the bytes that produced it (see lib/qualification/run.ts,
-- requalifyFromSnapshot). Storing the bytes here, keyed by evidence snapshot,
-- is what makes the vision pass replayable the same way the text evidence is.
--
-- Same posture as the `reports` bucket (20260725010000_reports.sql): private,
-- no storage.objects policy, reachable only through the service-role key in
-- Inngest functions via createAdminClient(). Third-party face images at rest —
-- worth a retention rule (e.g. purge once a decision is final) before this
-- runs at volume; not required for the bucket to exist safely today.
insert into storage.buckets (id, name, public)
values ('lead-images', 'lead-images', false)
on conflict (id) do nothing;
