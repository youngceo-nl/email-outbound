# Commercial Lead Qualification — status en gap-analyse

Datum: 2026-07-31, bijgewerkt 2026-08-01
Referentie: [`specs/2026-07-31-commercial-lead-qualification-design.md`](specs/2026-07-31-commercial-lead-qualification-design.md), [`plans/2026-07-31-commercial-lead-qualification-implementation.md`](plans/2026-07-31-commercial-lead-qualification-implementation.md)

## Samenvatting

Er draaien twee systemen naast elkaar:

- **Legacy (live in productie)** — `inngest/functions/score-lead.ts` → `lib/pipeline/filter.ts` → `lib/scoring/score.ts` → `lib/scoring/compute.ts`. Keyword/follower/engagement-gates, één AI-classificatiecall, gewogen score met drempel 7.5. Accepteert agencies nog als "partnership"-track en gebruikt engagement/activity als afwijzingsgrond — precies wat de nieuwe spec verbiedt. Dit bepaalt vandaag de daadwerkelijke lead-status.
- **Nieuw, spec-conform (gebouwd, niet aangesloten)** — `lib/evidence/*` en `lib/qualification/*`. 89 tests, logica komt overeen met de spec. Alleen bereikbaar via `scripts/qualify-profiles.ts`, dat expliciet **niets** naar de database schrijft.

Van het 13-taken implementatieplan zijn taken **1, 3–9 grotendeels af** in code (checkboxes in het plan-document staan overigens nog allemaal uit). Taken **2, 10, 11, 12, 13 zijn niet gestart** — en dat is precies wat nodig is om het nieuwe systeem live te krijgen.

## Wat er nog mist

### Taak 0 (nieuw) — Instagram-acquisitie is fragiel op cookies
`lib/evidence/instagram.ts` haalt Instagram-profielen op via ScrapingBee zonder ingelogde sessie (`scrapingBeeGet`, geen Apify-pad). Dit is exact het patroon dat het legacy systeem al heeft afgeschaft: `docs/scrape/scrape.md:34` — *"Apify is now the standard path; the cookie is the fallback"*. Er staan 15 managed IG-accounts met cookies klaar in `app_settings.instagram_accounts` (`lib/instagram/cookie-pool.ts`), die het legacy systeem al als fallback gebruikt — de nieuwe pipeline gebruikt ze niet.

**Fix:** `lib/evidence/instagram.ts` moet Apify (`APIFY_PROFILE_ACTOR`/`APIFY_POSTS_ACTOR`, al geconfigureerd) als primary path krijgen, met de bestaande cookie-pool alleen als fallback voor surfaces die de Apify-actor niet teruggeeft (Story Highlights, pinned-post detectie).

Losstaand hiervan: ScrapingBee blijft wél nodig voor stap 5 (externe pagina's/link-hubs, `lib/evidence/external.ts`) — dat is een andere use case (bot-detectie op landingspagina's, niet Instagram) en is al kostenbewust gebouwd (gratis fetch eerst, ScrapingBee gelimiteerd als fallback). Die key blijft dus staan.

### Taak 0b (bevinding) — externe-pagina-evidence zit niet in de live pipeline
`inngest/functions/score-lead.ts` (het huidige productiepad) roept nergens `enrichFunnelForLead` of externe-pagina-evidence aan — qualificatie gebeurt vandaag puur op IG-bio + posts. De externe-pagina-scraper bestaat wel (`lib/funnel/enrich.ts` legacy, `lib/evidence/external.ts` nieuw) maar wordt alleen gebruikt in de losse rapport-generator (`lib/report/run.ts`), niet in de qualificatiebeslissing. Dit is geen losse taak — het is precies wat Taak 10 oplost door de nieuwe orchestrator (die externe evidence al meeneemt) op echte leads te zetten.

### Taak 2 — Persistentie (grootste blocker)
Geen enkele tabel voor het nieuwe systeem bestaat. Ontbreekt:
- `lead_evidence_snapshots` (immutable evidence per scrape)
- `lead_commercial_extractions` (AI-extractie, cache-key `lead_id + evidence_snapshot_id + extraction_prompt_version + model`)
- `lead_qualification_decisions` (scorecard-resultaat, cache-key `lead_id + extraction_id + scorecard_version`)
- `lead_qualification_configs` (versioned scorecard-thresholds)
- Operationele kolommen op `leads` (bv. `approval_source`)
- `lib/qualification/repository.ts` om deze tabellen te lezen/schrijven

**Gevolg:** de hele nieuwe beslislogica bestaat alleen "in memory" tijdens een CLI-run. Niets is doorzoekbaar, herhaalbaar of auditeerbaar.

### Taak 10 — Eén gedeelde Inngest-orchestrator
- Geen `inngest/functions/qualify-lead.ts` die echte leads door `runCommercialQualification` routeert.
- Backfill-fanout wijst nog naar het legacy pad.
- Gedupliceerde beslislogica in bestaande entry points is nog niet opgeruimd.

**Gevolg:** het nieuwe systeem verwerkt geen enkele echte lead, ook niet passief.

### Taak 11 — Review-queue op uitzonderingen (nu nog universeel)
- `app/actions/review.ts` en `components/review/review-client.tsx` bestaan, maar zijn gekoppeld aan de **oude** `review_decision`/`rejected_leads`-flow.
- Geen `approval_source` (automatic vs. manual) op leads.
- Reviewqueue filtert nog niet op "alleen uitzonderingen" (spec: alleen 6.0–7.5 score, ontbrekende core-gate bij ≥8.0, onzekere track, medium/low certainty, tegenstrijdig bewijs, follower-range flag).
- Lead-detailpagina toont nog geen dimension-scores, cited evidence, certainty, of extraction/scorecard-versies.

### Taak 12 — Shadow mode, observability, release controls
Niets van dit alles bestaat:
- Rollout-settings (shadow / review-only / active)
- Veilige historische herverwerking in cohorten (`no_recent_posts`, `engagement_below_min`, `reels_30d_below_min`, `no_include_keyword_match`, `followers_below_min`/`followers_above_max`)
- Decision- en funnelmetrics (qualificatiepercentage, reviewer-approval rate, enrichment-succes)
- Wekelijkse blind-audit sampling (40% auto-approved / 20% manual review / 25% near-boundary rejects / 15% deep rejects)
- Pipeline-UI labels aangepast aan het nieuwe systeem

### Taak 13 — Benchmark, cutover, legacy opruimen
Niets van dit alles bestaat:
- Gelabelde benchmark-set (8 referentieprofielen + 100+ goedgekeurd + 100+ afgekeurd + grensgevallen + hard negatives)
- Release-drempels (precisie ≥90% op auto-qualificatie, recall-verbetering t.o.v. huidige classifier)
- Shadow-vergelijking oud vs. nieuw op ≥200 profielen
- Review-only mode, daarna active mode
- Rollback-mechanisme per model-versie
- Verwijderen van legacy eligibility-effecten (keyword/engagement/follower hard-gates) na cutover

## Wat al wél klopt (geen actie nodig)

- Evidence-acquisitie (`lib/evidence/*`): Instagram, external/link-hub, YouTube, CTA-chain, offer/proof-seeds — grotendeels compleet, inclusief capture-status enums.
- Data-quality classificatie (`complete`/`partial`/`unreliable`) en universele deterministische exclusions vóór elke AI-call (`lib/evidence/sufficiency.ts`).
- Strikte scheiding AI-extractie (alleen cited facts, geen scores) vs. deterministische scorer (`lib/qualification/{extract,classify-track,eligibility,score,certainty,decide}.ts`) — inclusief hard business-model gate en challenger-verificatie.
- Prioriteitsscore (`lib/qualification/priority.ts`) — exact volgens spec-gewichten, losstaand van qualificatie.
- Prompt-contracten met anchored labels (geen ruwe scores van het model) in `lib/qualification/{prompt,haiku-contract}.ts`.

## Aanbevolen volgorde

1. **Taak 0** (Apify-primary voor Instagram) — kan parallel aan Taak 2, is nodig voordat acquisitie betrouwbaar op schaal draait.
2. **Taak 2** (persistentie) — zonder dit kan niets van de rest zinvol gebeuren.
3. **Taak 10** (orchestrator, in shadow mode naast legacy) — zet het nieuwe systeem passief aan op echte leads zonder productiegedrag te veranderen. Lost Taak 0b vanzelf op.
4. **Taak 12** (metrics/observability) — nodig om shadow-resultaten te kunnen beoordelen.
5. **Taak 13** (benchmark + cutover) — pas hierna een go/no-go voor actieve routing.
6. **Taak 11** (reviewqueue-vernieuwing) — kan parallel aan 4/5, is nodig vóór active mode.
