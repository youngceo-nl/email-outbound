Gaps om de pipeline runnende te krijgen
1. Instagram-acquisitie is fragiel (nieuw vandaag ontdekt)
lib/evidence/instagram.ts gebruikt alleen ScrapingBee zonder login — precies het patroon dat het legacy systeem al afgeschaft heeft. Fix: Apify als primary path, de 15 bestaande managed cookies als fallback.

instagarm acquisitie wordt straks hiker, erg schaalbaar en robuust.

**Plan (compact):**
- Nu (deze week): Apify toevoegen als bron in `lib/evidence/instagram.ts`, naast de bestaande ScrapingBee-call. Hergebruik `lib/apify/actors.ts` (`APIFY_PROFILE_ACTOR`/`APIFY_POSTS_ACTOR`, tokens staan al in `.env.local`) en map de output naar dezelfde `InstagramAcquisitionInput`-vorm die de qualifier al verwacht.
- Testen: `npm run qualify <username>` tegen een paar echte leads draaien met Apify als bron, data-kwaliteit en kosten vergelijken met de huidige ScrapingBee-aanpak.
- Later (na saldo op HikerAPI): `/gql/user/medias` in `lib/hikerapi/instagram.ts` verifiëren tegen een echte call — de profielvelden werken al, alleen de posts-mapping is ongetest. Pas daarna overwegen als (goedkopere/robuustere) vervanger van Apify.
- Cookie-pool (15 accounts, `lib/instagram/cookie-pool.ts`) blijft ongewijzigd als fallback voor Highlights/pinned posts, wat geen van beide APIs standaard teruggeeft.

2. Geen persistentie — Taak 2, de grootste blocker
Geen tabellen (lead_evidence_snapshots, lead_commercial_extractions, lead_qualification_decisions, lead_qualification_configs), geen lib/qualification/repository.ts. Alles leeft alleen tijdens een handmatige CLI-run.

**Plan (compact):**
- 1 migratie: de 4 tabellen, elk insert-only (nooit updaten, nieuwe rij per poging) + operationele kolommen op `leads` (`qualification_state`, `qualification_outcome`, `qualification_decision_id`, `qualification_ready_at`, `qualification_review_reason`, `qualification_pipeline_version`) naast de bestaande legacy-kolommen.
- `lib/qualification/repository.ts`: `createEvidenceSnapshot`, `createExtraction`, `createDecision`, `getLatestQualificationBundle`, `getActiveQualificationConfig`, `setLeadQualificationProjection` (deze laatste is de enige die een bestaande rij update — de lead-projectie, niet de historie).
- Migratie moet via `npx supabase link` + `npx supabase db push`, of handmatig in de Supabase-dashboard SQL-editor (nog niet gelinkt).
- Verify: laat `scripts/qualify-profiles.ts` optioneel wegschrijven via de repository i.p.v. alleen naar stdout/`--out`, en bevestig dat 2 runs tegen hetzelfde profiel 2 losse snapshot-rijen opleveren.

3. Geen orchestrator — Taak 10
Geen inngest/functions/qualify-lead.ts. Dit is ook de fix voor het feit dat externe-pagina-evidence nu helemaal niet in de live pipeline zit — die logica bestaat al (lib/evidence/external.ts), hij wordt alleen nergens aangeroepen.

**Plan (compact):**
- Nieuwe `inngest/functions/qualify-lead.ts`: laadt lead → roept `runCommercialQualification` (bestaat al, inclusief externe-pagina- en YouTube-evidence) → schrijft via `lib/qualification/repository.ts` (gap 2) → update `leads.qualification_*`.
- Draait **naast** `score-lead.ts`, niet erin — shadow mode: legacy blijft de bron van waarheid voor wat een lead daadwerkelijk wordt, de nieuwe route logt alleen zijn eigen oordeel ernaast.
- Backfill-fanout (`crawl-seed.ts`/`recurse-following.ts`) triggert straks beide paden, zodat er volume ontstaat om te vergelijken.
- Verify: 20-30 leads laten dubbel verwerken, en de twee decisions (legacy `leads.score`/`review_decision` vs. nieuwe `qualification_outcome`) naast elkaar loggen.

4. Reviewqueue nog legacy — Taak 11
Reviewers zien nog oude scorevelden, geen approval_source, geen exception-only routing.

**Plan (compact):**
- `approval_source` (`automatic` / `manual`) op `leads` gebruiken (komt uit gap 2/3) om de queue te filteren op alleen: score 6.0–7.5, core-gate mist bij score ≥8.0, onzekere track, medium/low certainty, tegenstrijdig bewijs, follower-range-flag — dus geen enkele qualified lead meer die wél voldoet aan alle auto-approval-voorwaarden.
- Lead-detailpagina (`components/review/review-client.tsx`): de 5 dimension-scores + cited evidence + certainty + extraction/scorecard-versie tonen i.p.v. de huidige enkele legacy score.
- Reviewer-acties (approve/reject/defer) blijven bestaan, alleen de reason-codes worden de genormaliseerde set uit de spec (`not_personal_brand`, `agency_service`, `primary_offer_done_for_you_service`, enz.) i.p.v. de huidige ad-hoc reasons.
- Kan pas na gap 2+3 (heeft `approval_source` en de nieuwe decision-data nodig).

5. Geen observability/shadow mode — Taak 12
Geen rollout-settings, geen metrics, geen blind audit.

**Plan (compact):**
- Rollout-setting in `app_settings`: `shadow` / `review_only` / `active`, gelezen door `qualify-lead.ts` (gap 3) om te bepalen of het écht `leads.status` mag aanpassen of alleen mag loggen.
- Cohort-herverwerking: bestaande `rejected_leads` gegroepeerd per oude reden (`no_recent_posts`, `engagement_below_min`, `reels_30d_below_min`, `no_include_keyword_match`, `followers_below_min`/`_above_max`) opnieuw door de nieuwe pipeline in shadow mode, per cohort geteld hoeveel alsnog qualificeren.
- Dashboard-metrics: qualificatiepercentage, reviewer-approval rate, enrichment-succes, uitgesplitst per `qualification_pipeline_version`.
- Wekelijkse blind-audit: sample 40% auto-approved / 20% manual review / 25% near-boundary rejects / 15% deep rejects, score/certainty verborgen tot de reviewer een label geeft.
- Kan pas zinvol na gap 2+3 (heeft echte volume nodig om iets te meten).

6. Geen benchmark/cutover — Taak 13
Geen gelabelde testset, geen precisie/recall-drempel, geen shadow-vergelijking oud vs. nieuw, geen rollback.

**Plan (compact):**
- Labelset opbouwen: 8 referentieprofielen + 100+ handmatig goedgekeurd + 100+ handmatig afgekeurd + grensgevallen + hard negatives (agency-founders met klantresultaten, ecommerce-educators) — gesplitst in dev/validation/sealed-test, geen near-duplicates over sets heen.
- Drempels vooraf vastleggen op de validation-set (precisie ≥90% op auto-qualificatie, recall-verbetering t.o.v. huidige classifier) — pas daarna éénmalig tegen de sealed-test rapporteren, niet erop tunen.
- Shadow-vergelijking op ≥200 profielen (gebruikt gap 5's logging), dan review-only mode, dan pas active mode.
- Rollback-pad: bij een dip onder de drempel, `qualification_pipeline_version` terugzetten naar de vorige — geen destructieve legacy-opruiming vóór dit punt.
- Enige echte afhankelijkheid: gap 2 t/m 5 moeten draaien voordat er iets te benchmarken valt.

Volgorde: 1 en 2 kunnen parallel → 3 (shadow mode, lost ook #1's gebrek aan externe evidence in productie op) → 5+6 → 4 kan er los tussendoor.

Doc staat bijgewerkt in docs/superpowers/2026-07-31-commercial-lead-qualification-status.md. Wil je dat ik met #1 (Apify-primary) begin, of met #2 (de DB-migratie)?