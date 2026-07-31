# Commercial lead qualification pipeline

_2026-07-31_

## Goal

Qualify Instagram leads according to whether they are human-led personal
brands that publish and monetize information or expertise. The information
funnel can be direct, such as coaching or a course, or indirect, such as a free
blueprint, roadmap, training, application form, YouTube channel, or link hub
that leads toward an information offer. The decision must primarily reflect
personal-brand and information-funnel fit, not social engagement. Activity and
reach help prioritize qualified leads, but weak likes, views, or posting
cadence do not independently disqualify a strong lead.

Agency owners and service agencies are not the target. A person who owns an
agency qualifies only when their personal profile clearly operates a separate
information business or education funnel for the audience. Selling done-for-you
agency services under a personal brand is still an agency and does not qualify.

The pipeline must explain every decision with stored evidence so a reviewer can
see why a lead qualified, entered review, or was rejected.

## Guiding principles

1. Personal-brand information intent is the primary qualification signal.
2. A human expert, informational transformation, funnel, CTA, and proof matter
   more than likes.
3. Missing scraper data is not evidence that the profile lacks activity.
4. Activity and reach rank qualified leads. They do not define qualification.
5. Obvious non-leads should be removed before an AI call when the evidence is
   reliable.
6. Borderline or ambiguous profiles go to manual review instead of being
   silently rejected.
7. The same evidence should produce the same decision regardless of which
   scrape or scoring entry point processed the lead.

## Desired funnel

```text
Profile discovered
    |
    v
Metadata quality check
    |
    +-- incomplete or unreliable --> retry backfill / data-quality queue
    |
    v
Universal exclusions
    |
    +-- definite exclusion -------> rejected
    |
    v
Commercial AI classification
    |
    v
Commercial-fit score
    |
    +-- 8.0 to 10.0 -------------> qualified
    +-- 6.0 to 7.5 --------------> manual review
    +-- 0.0 to 5.5 --------------> rejected
    |
    v
Priority score for qualified leads
    |
    v
Automatic approval or targeted manual review
    |
    v
Enrichment
```

## Step 1: Collect the qualification evidence

The scorer receives the following normalized evidence:

- Username, display name, bio, category, verification status, follower count,
  following count, total post count, and external link.
- Up to 12 to 18 recent posts, including caption, timestamp, type, pinned
  status, likes, comments, and views when available.
- Pinned-post captions when the scraper can distinguish them.
- Profile highlights or labels when available, especially `results`,
  `testimonials`, `client wins`, `start here`, `my story`, and `apply`.
- Link-in-bio destination type and visible landing-page title when available.
- Previously extracted email and contact details.

The scorer must preserve the evidence timestamp. Social profile data changes,
so a decision is only reproducible when its input snapshot is identifiable.

### Story Highlight evidence

Story Highlight titles are a high-value positive signal because operators use
them as permanent profile-funnel navigation. Capture the normalized title and,
when technically available, the visible cover label. The initial version does
not need to scrape or interpret the stories inside each Highlight.

Normalize case, whitespace, punctuation, hyphens, and common singular or plural
variants before matching. Group titles semantically:

| Signal group | Example titles | Qualification evidence |
|---|---|---|
| Proof | `RESULTS`, `CLIENTS`, `REVIEWS`, `WINS`, `TESTIMONIAL`, `TESTIMONIALS`, `STUDENT WINS` | Client outcomes and operating maturity |
| Offer | `1-1 COACHING`, `COACHING`, `PROGRAM`, `WORK WITH ME` | A concrete paid offer |
| Funnel | `START HERE`, `FREE COURSE`, `APPLY`, `BOOK A CALL` | Deliberate conversion path |
| Authority | `MY STORY`, `YOUTUBE`, `PODCAST` | Founder identity and authority assets |

Matches are semantic, not limited to this exact vocabulary. For example,
`TRANSFORMATIONS`, `CASE STUDIES`, and `SUCCESS STORIES` belong to the Proof
group even though they are not literal entries in the table.

Highlight titles only add evidence. Missing Highlights, unavailable Highlight
data, or unfamiliar titles never cause rejection. A title such as `RESULTS`
supports proof intent, but it does not earn the maximum proof score without
additional supporting content in the bio, posts, landing page, or the
Highlight itself.

Suggested scoring treatment:

- One Proof Highlight supports a 0.5 increase in proof and maturity, capped at
  1.5 unless outcome evidence is also visible.
- One Offer Highlight supports a 0.5 increase in offer evidence, capped at 1.5
  unless the offer itself is described.
- One Funnel Highlight supports a 0.5 increase in conversion intent, capped at
  1.5 unless a direct action is visible.
- Authority Highlights provide supporting context but do not independently
  raise a commercial dimension.
- Two or more distinct commercial groups provide a profile-funnel maturity
  flag used as supporting evidence and as a priority tie-breaker.

The current system does not store Story Highlight titles. Supporting this
signal requires adding a nullable `story_highlight_titles` collection and its
capture timestamp to the backfill result. A null collection means not captured;
an empty collection means captured and none were visible. These states must not
be conflated.

### Primary AI recognition model

Before assigning numeric scores, the AI must explicitly answer four semantic
questions:

1. Is this a human-led personal brand built around expertise or information?
2. What recognizable transformation does the person help an audience achieve?
3. What visible path moves a visitor from content toward information,
   application, coaching, or another conversion step?
4. What proof or authority makes the expertise credible?

These are the highest-value signals in the qualification system. Keywords help
the AI locate evidence, but the AI must interpret complete phrases, context,
and equivalent language rather than count exact matches.

#### High-value phrases and concepts

The AI should recognize these examples and semantic equivalents:

```text
I help
We help
For coaches
For consultants
For men
Build and scale
Get clients
1:1 coaching
Mentorship
Program
Academy
Private coaching
Client results
Testimonials
Apply
Book
DM me
Comment
Blueprint
Free training
Learn from me
Helped [number] people
```

It must also recognize:

- Revenue, client, student, transformation, or audience proof.
- Quantified teaching or impact claims such as `helped 500 people`, `coached
  200 founders`, or `trained 1,000 students`.
- A named mechanism, framework, method, system, challenge, academy, university,
  course, roadmap, or program.
- Equivalent language in captions, Story Highlights, link labels, pinned posts,
  and non-English text.

The phrases do not all have equal meaning in isolation. `Program` without an
owner, audience, or outcome is weak. `I help consultants get clients through
my private coaching program` is strong because it identifies the expert,
audience, transformation, and offer in one statement.

#### Recognizable transformation

The transformation should be understandable without extensive investigation.
Confirmed transformation patterns include:

```text
lose fat and build muscle
build and scale a personal brand
acquire premium clients
build profitable Instagram brands
scale an online consulting business
improve appearance and confidence
get fit and eliminate destructive habits
learn languages
```

The preferred semantic structure is:

```text
specific person or audience + painful or desirable problem + promised result
```

The wording can be explicit, such as `I help Christian men get jacked and drop
vices`, or distributed across the display name, bio, captions, Highlights, and
external destination. The AI must assemble the meaning across surfaces and
cite each supporting source.

A broad topic such as fitness, business, mindset, or languages is not yet a
transformation. The profile needs an outcome, change, solution, or learning
path associated with that topic.

#### Visible conversion path

A qualified personal brand gives the visitor somewhere meaningful to go.
Recognized conversion patterns include:

```text
DM RUTHLESS
DM SCALE
DM LAUNCH
DM READY
comment a keyword
apply through a landing page
download a blueprint
get a roadmap
watch a free training
click an educational link
visit a YouTube channel
open a link hub
request private instruction
book a call
join a program or community
learn from me
```

The core distinction is:

```text
content-only creator: follow me for content
information operator: DM, apply, book, download, watch, learn, request, or join
```

`Follow me` can support audience building but does not count as a commercial or
information conversion path by itself. A YouTube link or link hub counts when
the surrounding profile establishes a human expert and informational
transformation.

`Learn from me` is stronger than `follow me` because it explicitly positions
the person as the teacher and the visitor as a learner. It supports expert
identity and information-funnel intent. It becomes strong conversion evidence
when paired with a course, blueprint, roadmap, YouTube destination, coaching
offer, application, or link hub.

#### Proof and authority

Proof can appear in many forms:

- Client wins and testimonials.
- Student wins and transformations.
- Revenue or sales claims.
- Number of clients or students served.
- Large owned or managed audiences.
- Personal transformation stories.
- Specialized expertise or demonstrated skill.
- Named systems, mechanisms, frameworks, or methodologies.
- Results-oriented Story Highlight folders.
- Strong follower scale or repeat audience reach.
- Visible association with a relevant education brand, program, academy, or
  company.

Examples include:

```text
$4M in sales before 30
139 clients
15,000,000+ followers
helped 500 people
coached 200 founders
trained 1,000 students
client wins
student wins
testimonials
results
my transformation
a proprietary method or branded program
```

The exact proof format is not important. The AI should judge whether credible
evidence exists, whether it belongs to this person, and whether it supports an
information offer. Agency client results do not prove an information business.

Proof strength increases when evidence is specific, quantified, repeated, or
visible across multiple surfaces. Self-reported proof remains useful
positioning evidence but must be labeled as self-reported.

The AI must recognize the semantic pattern, not only the verb `helped`:

```text
helped | coached | trained | taught | mentored | served
    + number or quantity
    + people | clients | students | founders | coaches | consultants | men
```

Extract the action, quantity, and audience separately. `Helped people` without
a quantity is general authority evidence. `Helped 500 coaches get clients` is
strong proof because it combines scale, buyer, and outcome. Do not count a
number when it refers to followers, views, revenue, or years unless it is
classified under the corresponding proof type.

### ICP keyword and phrase taxonomy

Keywords are evidence extractors, not independent decisions. Match them across
the display name, bio, recent captions, pinned captions, Story Highlight
titles, external-link slug, and landing-page title. Preserve the source and
surrounding phrase for every match.

Normalize lowercase, Unicode styling, punctuation, emoji separators, common
abbreviations, singular and plural forms, and spelling variants. Translate
supported non-English evidence into the same semantic groups while preserving
the original text. The initial supported languages are English and Dutch
because both appear in the confirmed ideal examples.

#### Personal-brand expert identity

These terms indicate that the person operates an expertise-based business:

```text
coach, coaching, business coach, transformation coach, physique coach,
performance coach, fitness coach, consultant, consulting, mentor, mentorship,
strategist, educator, expert, advisor, teacher, polyglot, creator, author,
speaker, founder, academy, school, university
```

Strong phrases include:

```text
I help, we help, I teach, I coach, I build, I run, founder of, coach for,
consultant for, behind the brands, face behind, learn from me, work with me,
work with us
```

`Coach` or `consultant` alone is only identity evidence. It becomes strong
commercial evidence when combined with a buyer, transformation, offer, CTA, or
proof signal.

#### Target buyer and audience

These terms help identify a commercially relevant buyer:

```text
coaches, high ticket coaches, online coaches, consultants, online consultants,
service providers, experts, educators, course creators, creators, founders,
entrepreneurs, business owners, personal brands, agencies, ambitious men,
men, guys, Christian men, professionals, language learners, students
```

Audience modifiers strengthen buyer clarity:

```text
high ticket, online, established, ambitious, premium, B2C, B2B, 25-45,
six figure, seven figure
```

The classifier must extract the complete audience phrase. For example, `high
ticket coaches and service providers` is stronger than three disconnected
keyword hits.

#### Transformation and outcome

Commercial transformation language includes:

```text
build, grow, scale, launch, monetize, acquire clients, get clients,
premium clients, enroll clients, book calls, sales calls, increase revenue,
make sales, profitable, personal brand, audience growth, organic growth,
client acquisition, lead generation, appointment setting, conversion,
lose fat, build muscle, get jacked, drop vices, improve appearance,
build confidence, self improvement, learn a language, speak a language
```

High-value phrases taken from or closely modeled on the confirmed ideal
profiles include:

```text
build and scale your personal brand
help high ticket coaches and service providers scale
build profitable Instagram brands
business coach for consultants
improve their appearance to be more confident
help Christian men get jacked and drop vices
exclusive 1-1 language learning
lose fat and build muscle
```

A result phrase is stronger when it joins an action to a concrete outcome.
Generic uses of `grow`, `scale`, or `success` without a buyer or business
context receive only weak evidence.

#### Information offer and funnel

Information-offer terms include:

```text
1:1 coaching, 1-1 coaching, one-to-one coaching, private coaching,
group coaching, consulting, mentorship, mastermind, accelerator, program,
challenge, course, free course, training, workshop, bootcamp, academy,
university, school, community, membership, blueprint, roadmap, guide,
playbook, framework, masterclass, webinar, newsletter, YouTube
```

The following are important policy rules:

- Explicit 1:1 or private coaching is strong offer evidence. It is not a weak
  signal merely because it is not a scalable course.
- A free course, blueprint, roadmap, guide, training, YouTube channel, or
  newsletter is valid information-funnel evidence even when a paid offer is not
  visible on Instagram. It is not treated as proof of a paid offer, but the
  profile can still qualify when personal-brand, expertise, transformation,
  and conversion evidence are strong.
- A branded program name such as a challenge, university, accelerator, or
  proprietary system strengthens offer maturity when the surrounding context
  indicates delivery or transformation.
- `Course`, `program`, or `coaching` mentioned only as someone else's product,
  a past experience, or an unrelated topic does not count as the profile's
  offer.

#### Conversion and CTA

Direct-response and information-funnel phrases include:

```text
DM me, DM us, DM for, send me a DM, message me, DM "[keyword]",
comment "[keyword]", apply, apply now, apply below, book a call,
book a strategy call, schedule a call, work with me, work with us,
join now, enroll, start here, click below, link below, link in bio,
get the blueprint, steal my blueprint, get the training,
get the roadmap, get the guide, free course, free training, download,
watch the training, watch on YouTube, subscribe on YouTube, request coaching,
application form, fill out the application, learn from me
```

Intent levels:

| Level | Examples | Meaning |
|---:|---|---|
| 0 | No next step | No conversion evidence |
| 1 | `follow`, generic link | Audience CTA only |
| 2 | `free guide`, `blueprint`, `roadmap`, `YouTube`, `Linktree`, `watch`, `download` | Information-funnel intent |
| 3 | `DM SCALE`, `apply`, `book a call`, `1:1 coaching` | Direct sales intent |

A direct keyword CTA is especially strong because it shows an operating DM
funnel. Extract the action and keyword separately, such as action `DM` and
keyword `RUTHLESS`, `SCALE`, `LAUNCH`, or `READY`.

#### External-link destination signals

Classify the destination type instead of treating every bio link equally:

| Destination | Evidence strength | Examples |
|---|---:|---|
| Direct application or booking form | Strong | application, apply, Typeform, booking page, calendar |
| Information lead magnet | Strong | blueprint, roadmap, guide, free course, training, webinar |
| Coaching or education page | Strong | coaching, mentorship, academy, university, school, program |
| YouTube channel or video | Moderate | YouTube channel, long-form educational video |
| Link hub | Moderate | Linktree, Beacons, Stan, link.me, linktw.in, direct.me |
| Generic personal website | Weak until inspected | personal domain with unknown destination |
| Agency service page | Negative for this ICP | done-for-you marketing, media, lead generation, client services |
| Store or product checkout | Negative for this ICP | Shopify, product catalog, physical-product checkout |

A YouTube link or link hub is enough to support information-funnel intent when
the profile already has a human expert identity and an educational
transformation. It does not independently qualify an otherwise ambiguous
creator. When a link hub is available, inspect its visible destination labels
for coaching, education, blueprint, roadmap, application, results, or agency
service evidence.

#### Proof, results, and authority

Proof terms include:

```text
results, client results, client wins, student wins, wins, reviews,
testimonials, testimonial, case study, case studies, success stories,
transformations, before and after, helped, clients served, students,
coached, trained, taught, mentored, people helped, revenue, sales, collected,
generated, managed, followers, views,
my story, start here, featured, podcast, YouTube
```

Quantified proof patterns include:

```text
$4M in sales
$50k/month
six figures
seven figures
139 clients
15,000,000+ followers
25M-60M monthly views
grew from [A] to [B]
[number] client transformations
helped [number] people
coached [number] clients
trained [number] students
```

Proof strength is determined by context:

- A proof word alone, such as a Highlight named `RESULTS`, is supporting
  evidence.
- A specific client outcome or quantified result is strong evidence.
- Repeated proof across Highlights, captions, and a landing page is very strong
  evidence.
- The profile's own follower count is audience authority, not client-result
  proof.
- Unverified revenue claims still count as positioning evidence, but the
  classifier records them as self-reported.

#### Business sophistication and ICP relevance

These terms indicate the commercial problems and infrastructure associated
with the target buyer:

```text
high ticket, offer, premium offer, sales calls, closing, sales team,
appointment setter, closer, webinar, VSL, masterclass, launch, funnel,
flywheel, lead generation, client acquisition, booked calls, paid ads,
organic growth, audience, personal brand, conversion, backend systems,
retention, LTV, upsell, revenue, monetization
```

These terms strengthen fit only alongside evidence that the profile owns or
sells an offer. Educational discussion of funnels or sales does not
automatically prove a business.

#### Personal-brand and agency-separation signals

Positive personal-brand signals include:

```text
I help, I teach, my method, my framework, my story, learn from me,
coach, mentor, educator, author, speaker, creator, personal brand,
free blueprint, free roadmap, free guide, free course, training,
YouTube, newsletter, community, coaching, mentorship, mastermind,
academy, university, school, application, DM me, comment a keyword
```

Agency and done-for-you service signals include:

```text
agency, media agency, marketing agency, sales agency, content agency,
growth agency, lead generation agency, appointment setting agency,
media buying, ads agency, done for you, DFY, we manage, we build for you,
our clients, hire our team, client acquisition service, brand management
```

Apply these separation rules:

1. A human face, personal name, or personal-brand content does not override an
   agency service as the core offer.
2. If the primary CTA is to hire the person or team for done-for-you services,
   classify the profile as `agency_service` and reject it from this ICP.
3. If the person owns an agency but separately teaches their expertise through
   coaching, a course, blueprint, roadmap, community, or educational YouTube
   funnel, evaluate only that distinct information offer.
4. Client results from agency delivery do not prove an information offer.
5. An agency founder with only business advice content but no information
   funnel remains excluded.
6. When the agency and information offers are both visible but the primary
   model is unclear, send the lead to manual review rather than automatically
   qualifying it.

#### Dutch equivalents

Map the following Dutch evidence to the same semantic groups:

```text
ik help, wij helpen, coach, coaching, consultant, mentor, traject,
programma, cursus, training, academie, ondernemers, coaches, consultants,
mannen, klanten, premium klanten, klanten krijgen, klanten aantrekken,
opschalen, groeien, omzet, verkopen, resultaat, resultaten, klantresultaten,
reviews, testimonials, succesverhalen, transformaties, mijn verhaal,
start hier, gratis cursus, gratis training, 1-op-1 coaching,
privé coaching, boek een gesprek, plan een gesprek, meld je aan,
stuur een DM, link in bio, vet verliezen, spiermassa opbouwen,
zelfverbetering, zelfvertrouwen, leer van mij, mensen geholpen,
klanten geholpen, studenten geholpen
```

Language must not lower confidence when the evidence can be translated
reliably. Mixed-language profiles are evaluated using the combined meaning.

#### Negative and exclusion context

Likely non-ICP terms include:

```text
fan page, fan account, parody, meme page, memes, news, gossip, paparazzi,
repost, quotes page, entertainment, official army, shop now, online store,
worldwide shipping, discount code, ambassador, affiliate, restaurant,
salon, contractor, transport, SaaS, software platform, agency service,
done for you, media buying, appointment setting agency, content agency
```

These terms are contextual warnings, not blind exclusions. For example, a
coach can discuss software, run an affiliate promotion, or use `shop` in a
caption without becoming a SaaS or ecommerce profile. Automatic exclusion
requires the account's core identity and monetization model to match the
negative category.

#### Cross-signal bundle rules

Count semantic groups, not raw keyword frequency. Repeating `coach` ten times
still produces one identity signal.

Strong commercial evidence exists when at least one of these bundles is found:

1. Human expert identity plus named audience plus informational transformation
   plus direct CTA.
2. Human expert identity plus coaching or education offer plus direct CTA.
3. Human expert identity plus free blueprint, roadmap, course, or training plus
   a capture or application path.
4. Human expert identity plus educational YouTube destination plus a clear
   transformation.
5. Expertise identity plus branded program plus proof-oriented Highlights.

No bundle qualifies when the core offer is agency delivery, done-for-you
services, ecommerce, SaaS, or entertainment.

Automatic qualification still follows the five-dimension score and confidence
rules. A keyword bundle supplies auditable evidence for those dimensions; it
does not bypass exclusions or deterministic validation.

## Step 2: Validate metadata quality

Before filtering or scoring, classify the input as `complete`, `partial`, or
`unreliable`.

### Complete

The profile has a usable bio, follower count, and either recent posts or a
confirmed total-post count of zero.

### Partial

The profile has enough bio and profile evidence for commercial scoring, but
post metrics, views, timestamps, or captions are incomplete. Commercial
scoring proceeds. Activity is recorded as unknown and does not reduce the
commercial score.

### Unreliable

The account reports existing posts but the scraper returned no post sample, or
the core profile fields conflict or are missing. The lead enters a backfill
retry or data-quality queue. It must not be rejected as inactive.

The retry policy should attempt the standard provider and then the configured
fallback. After the retry budget is exhausted, the lead can still receive a
bio-only commercial score if the bio contains enough evidence. Its activity
priority remains unknown.

## Step 3: Apply universal exclusions

Universal exclusions are deterministic and happen before AI classification.
Only reliable, ICP-independent disqualifiers belong here.

Reject when any of the following is confirmed:

- The profile is private and there is not enough public evidence to evaluate
  an offer.
- The account is unavailable, deleted, or clearly impersonating another
  account.
- The identity is an obvious meme, fan, gossip, news, parody, or repost page.
- The bio and identity contain a configured exclusion term with clear semantic
  relevance.
- The profile is a non-commercial personal account with no expertise,
  audience, transformation, offer, CTA, or business evidence.
- The profile's core offer is agency delivery or another done-for-you service,
  with no distinct coaching, education, or information funnel.

Follower count is not a universal hard exclusion. The configured follower
range contributes to priority and can flag a lead for review, but it should not
erase strong commercial evidence. Include keywords are positive evidence, not
a mandatory hard gate. Failure to match an exact keyword never causes an
automatic rejection.

Each exclusion stores a normalized reason and the exact evidence that caused
it. A keyword match alone is insufficient when the surrounding context changes
its meaning.

## Step 4: Classify the commercial track

The AI assigns one primary track:

- `information_personal_brand`: human expert or creator with coaching,
  education, an information product, or an information funnel.
- `agency_service`: personal or company profile whose core offer is
  done-for-you agency or client service delivery.
- `commerce`: physical or digital product seller centered on checkout rather
  than expertise.
- `saas`: software product or platform.
- `non_commercial`: creator or personal account without meaningful information
  or coaching intent.
- `uncertain`: insufficient, mixed, or contradictory evidence.

Track classification and qualification are separate. Only
`information_personal_brand` can qualify automatically. `agency_service`,
`commerce`, `saas`, and `non_commercial` are rejected when confidence is high.
An agency founder with a plausible separate education funnel is `uncertain`
until the distinct information offer is verified.

`uncertain` profiles cannot be automatically rejected when credible
information-funnel signals exist. They enter manual review.

## Step 5: Score commercial fit

Score five dimensions from 0 to 2 in increments of 0.5. Each dimension must
include a short evidence citation copied or paraphrased from the profile.

### Buyer clarity

| Score | Definition |
|---:|---|
| 0 | No identifiable buyer or audience |
| 0.5 | Broad audience implied only by content topic |
| 1 | Buyer category is reasonably inferable |
| 1.5 | A specific buyer is visible but incompletely defined |
| 2 | The target buyer is explicitly named and commercially relevant |

Examples include coaches, consultants, service providers, ambitious men,
Christian men, founders, and language learners.

### Transformation clarity

| Score | Definition |
|---:|---|
| 0 | No result or problem is identifiable |
| 0.5 | General inspiration or lifestyle improvement |
| 1 | Expertise is clear but the outcome is vague |
| 1.5 | A meaningful result is strongly implied |
| 2 | A specific transformation or business outcome is explicit |

Examples include acquiring premium clients, scaling a personal brand, losing
fat, building muscle, improving confidence, or learning a language.

### Information offer and funnel evidence

| Score | Definition |
|---:|---|
| 0 | No evidence of coaching, education, or an information funnel |
| 0.5 | Expertise or educational intent is weakly implied |
| 1 | A YouTube destination, link hub, free resource, or education path is visible |
| 1.5 | Coaching, a course, program, blueprint, roadmap, application, or training is visible |
| 2 | A concrete information offer and delivery or conversion path are explicit |

### Conversion intent

| Score | Definition |
|---:|---|
| 0 | No commercial next step |
| 0.5 | Generic link with unknown purpose |
| 1 | Broad invitation to follow, learn, or visit a site |
| 1.5 | A relevant lead magnet or commercially suggestive CTA |
| 2 | Direct instruction to DM, comment, apply, book, join, or request help |

### Proof and operating maturity

| Score | Definition |
|---:|---|
| 0 | No proof or authority evidence |
| 0.5 | Expertise is claimed without supporting evidence |
| 1 | Credible specialization, personal transformation, or operating history |
| 1.5 | Testimonials, results, a named method, or meaningful audience authority |
| 2 | Strong quantified results, client wins, recognized authority, or repeated proof |

Proof-oriented Story Highlights such as `RESULTS`, `CLIENTS`, `REVIEWS`,
`WINS`, and `TESTIMONIALS` count as supporting evidence under the caps defined
in Step 1. Offer and funnel Highlights support their corresponding dimensions.
They do not create a separate sixth dimension because that would count the same
commercial evidence twice.

The commercial-fit score is the sum of these five dimensions and ranges from
0 to 10.

## Step 6: Make the qualification decision

### Qualified

Automatically qualify when all conditions hold:

- Commercial-fit score is at least 8.0.
- Information offer and funnel evidence is at least 1.0.
- At least one of buyer clarity or transformation clarity is at least 1.5.
- The track is `information_personal_brand`.
- No universal exclusion applies.

Automatically approve the lead for enrichment when all additional conditions
hold:

- Commercial-fit score is at least 8.5.
- AI confidence is at least 0.85.
- Data quality is `complete` or `partial` with all commercial dimensions
  supported.
- Information offer and funnel evidence is at least 1.0. This allows a verified
  YouTube or link-hub education funnel to qualify without a visible paid offer.
- Conversion intent is at least 1.0.
- At least one valid strong commercial bundle is present.
- No contradictory-evidence, follower-range, uncertain-track, or suspicious
  proof flag applies.

Automatic approval is the normal path for obvious ICP leads. It does not wait
for a human to confirm a high-confidence decision.

### Manual review

Send to review when any condition holds:

- Commercial-fit score is 6.0 to 7.5.
- Commercial-fit score is at least 8.0 but a required dimension is missing.
- The track is `uncertain` and credible personal-brand information signals
  exist.
- The AI confidence is below 0.75.
- Evidence is contradictory, such as a strong CTA with no identifiable offer.
- A follower-range flag applies to an otherwise strong lead.
- The lead qualifies but does not meet every automatic-approval condition.

### Rejected

Reject when either condition holds:

- A reliable universal exclusion applies.
- Commercial-fit score is at most 5.5 and AI confidence is at least 0.75.

Low-confidence low scores enter review instead of rejection. Every rejected
lead stores both the normalized reason and the commercial dimension scores.

## Step 7: Calculate activity and reach separately

Activity does not change the commercial qualification decision. It produces a
separate 0 to 10 priority score used to order review, enrichment, and outreach.

### Preferred metrics

When at least three unpinned Reels have valid view counts, calculate:

```text
reel_view_rate = median unpinned Reel views / followers
```

Use the median rather than the mean to reduce the effect of one viral post.
When fewer than three valid Reel view counts exist, mark Reel reach as unknown.

Also calculate:

- Posts in the last 30 days.
- Reels in the last 30 days.
- Days since the most recent captured post.
- Median likes per follower as a secondary signal only.
- Median comments per 1,000 views when both values exist.

### Priority components

| Component | Weight |
|---|---:|
| Commercial-fit score | 50% |
| Proof and maturity | 15% |
| Reel view rate | 15% |
| Posting recency | 10% |
| Posting consistency | 10% |

Unknown activity metrics contribute no negative penalty. The priority score
must expose a data-completeness indicator so unknown activity is not confused
with poor activity.

Likes must never independently reject a lead. A profile with low follower-like
engagement can remain high priority when it has healthy view reach and strong
commercial evidence.

## Step 8: Produce a structured AI response

The classifier returns a versioned object with this logical shape:

```json
{
  "model_version": "commercial-fit-v1",
  "track": "information_personal_brand",
  "confidence": 0.91,
  "recognition": {
    "human_personal_brand": true,
    "recognizable_transformation": true,
    "visible_conversion_path": true,
    "credible_proof_or_authority": true
  },
  "scores": {
    "buyer_clarity": 2,
    "transformation_clarity": 2,
    "offer_evidence": 2,
    "conversion_intent": 2,
    "proof_maturity": 1.5,
    "commercial_fit": 9.5
  },
  "evidence": {
    "buyer": "Christian men",
    "transformation": "get jacked and drop vices",
    "offer": "1:1 transformation coaching",
    "conversion": "DM READY",
    "proof": "client results",
    "story_highlights": ["CLIENT WINS", "CLIENT RESULTS", "MY STORY"]
  },
  "keyword_evidence": [
    {
      "group": "buyer",
      "source": "bio",
      "phrase": "Christian men"
    },
    {
      "group": "conversion",
      "source": "bio",
      "phrase": "DM READY"
    }
  ],
  "commercial_bundles": ["personal expert + buyer + transformation + coaching + direct CTA"],
  "data_quality": "complete",
  "decision": "qualified",
  "decision_reason": "Clear personal brand, audience, transformation, coaching offer, CTA, and proof",
  "review_flags": []
}
```

The backend validates the four recognition answers, score ranges, required
fields, permitted enum values, score totals, and decision rules. Invalid AI
output is retried once. A second invalid response enters a scoring-error queue
rather than being treated as rejection.

## Step 9: Manual review

The review queue sorts by commercial-fit score, then confidence, then priority
score. The reviewer sees:

- Bio, display name, external link, and recent content preview.
- The five dimension scores and supporting evidence.
- Captured Story Highlight titles grouped as Proof, Offer, Funnel, and
  Authority signals.
- Data-quality state and missing metrics.
- AI decision and confidence.
- Any follower, track, or contradictory-evidence flags.

Reviewer actions are `approve`, `reject`, and `defer`. Reject requires a
normalized reason. Reviewer changes are stored separately from the AI result
so model accuracy can be measured without overwriting the original prediction.

Manual review is an exception queue, not a required stage for every qualified
lead. High-confidence profiles that satisfy Step 6 are automatically approved
after the shadow-validation gate is passed. Review capacity is reserved for
borderline, incomplete, contradictory, or low-confidence profiles.

## Step 10: Enrichment handoff

A lead is ready for enrichment when:

- Qualification decision is `qualified`.
- Approval source is either `automatic` under the high-confidence rules or
  `manual` after review.
- No email is already available.
- The lead is not currently assigned to an open enrichment batch.
- The lead has not exceeded the configured enrichment retry limit.

A closed batch must not strand a lead forever. A lead returned without an email
becomes retryable according to its attempt count and cooldown. Batch history is
stored separately from current eligibility.

## Historical reprocessing

Existing rejected profiles should not all be restored at once. Reprocess them
in controlled cohorts, beginning with rejection rules most likely to contain
false negatives under this specification:

1. `no_recent_posts`
2. `engagement_below_min`
3. `reels_30d_below_min`
4. `no_include_keyword_match`
5. `followers_below_min` and `followers_above_max`

Each cohort records its old decision, new decision, reviewer verdict, and
eventual enrichment and outreach outcomes.

## Validation and rollout

### Benchmark set

Create a versioned labeled set containing:

- The eight user-supplied profiles, relabeled against the narrowed personal-brand
  information ICP. Personal information brands are positive examples. Any
  profile whose core model is agency delivery is a negative or mixed example
  unless a separate information funnel is verified.
- At least 50 additional manually approved qualified leads.
- At least 100 manually confirmed bad leads covering each major rejection
  reason.
- Borderline cases that previously caused reviewer disagreement.

No profile used to tune prompt wording or thresholds should be counted as an
independent final evaluation example.

### Offline acceptance criteria

- Every supplied profile centered on a personal information or coaching funnel
  classifies as qualified and should satisfy automatic approval when evidence
  is complete.
- Any supplied profile centered on agency or done-for-you delivery does not
  qualify solely because it uses a personal brand, client proof, or a DM CTA.
- Precision on automatic qualification is at least 90% against reviewer labels.
- Recall on confirmed qualified leads improves relative to the current
  production classifier.
- No profile is rejected solely because likes, views, or post data are missing.
- Story Highlights can strengthen offer, conversion, and proof evidence, but
  missing Highlight data never lowers a score or causes rejection.
- The same stored evidence produces the same deterministic threshold decision.
- Every decision exposes dimension scores, evidence, confidence, and model
  version.
- Every automatic qualification identifies a human personal brand, a
  recognizable transformation, a visible conversion path, and credible proof
  or authority, with cited evidence for each available signal.
- At least 80% of high-confidence qualified profiles bypass manual review after
  the automatic-approval rollout.

### Shadow rollout

Run the new classifier alongside the existing system without changing lead
status. Compare both decisions against manual review for at least 200 profiles.
Report disagreement by reason, track, seed, follower band, and data-quality
state.

### Production rollout

After shadow acceptance:

1. Use the new classifier for new leads while preserving the old result fields.
2. Keep all borderline decisions in manual review.
3. Monitor qualification rate, reviewer approval rate, enrichment success, and
   positive outreach response by model version.
4. Reprocess historical cohorts gradually.
5. Roll back by model version if automatic qualification precision falls below
   the accepted threshold.

## Success metrics

The change succeeds when it improves business outcomes rather than merely
increasing the qualified count. Track:

- Percentage of backfilled profiles reaching AI classification.
- Automatic qualification precision.
- Qualified-lead recall on reviewer-confirmed examples.
- Manual-review approval rate.
- Median time from backfill to review decision.
- Percentage of qualified leads ready for enrichment.
- Email discovery rate by commercial-fit band.
- Positive reply and meeting-booked rate by commercial-fit band.
- Rejection and approval rates by source seed.
- Percentage of decisions with complete stored evidence.

## Out of scope

- Automatically changing current production settings before shadow validation.
- Rebuilding the Instagram scraper.
- Defining outreach copy or campaign segmentation.
- Treating follower count, likes, or views as a direct proxy for purchasing
  power.
- Auto-approving leads before reviewer-labeled precision is established.
