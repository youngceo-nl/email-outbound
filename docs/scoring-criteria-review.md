# How We Decide Who's a Good Lead — Plain-Language Review

This is the same system as `docs/scoring-system.md`, written without the code
so you can review it and mark up anything you want changed. Every number and
word-list below is what's actually live right now.

A profile goes through 4 steps, in order. The first two are instant yes/no
checks — no AI involved, just rules. If it fails either one, it's rejected
immediately and nothing else runs.

---

## Step 1 — Instant disqualifiers

A profile is rejected right away if **any** of these are true:

- Their account is **private**
- They have **fewer than 5,000 followers**, or **more than 500,000**
- Their bio is empty or basically blank (under 5 characters)
- They have no posts at all
- Their bio, name, or username contains one of these words: `fan`, `parody`,
  `meme`, `news`, `paparazzi`, `gossip`, `official army`
- Their bio/name/username matches an obvious junk pattern: anything with
  "meme", "fan page", "memes", "news", "gossip", or "paparazzi"

**Also required to pass:** their bio, name, username, recent captions, or bio
link must contain **at least one** word from this list (almost 90 words —
this is intentionally broad, meant to catch anyone even loosely coach/agency/
creator-flavored):

> coach, mentor, consult, course, mastermind, academy, program, high ticket,
> group coaching, 1:1, done for you, done with you, scale, grow your, 6
> figure, 7 figure, monetize, monetise, passive income, financial freedom,
> quit your 9-5, location freedom, beginner, start your business, step by
> step, zero to one, first client, content creator, personal brand,
> influencer, social media growth, audience, viral, organic growth, ecom,
> ecommerce, info, dropship, fba, smma, agency, copywriting, fitness,
> mindset, crypto, trading, real estate, career, funnel, lead gen, webinar,
> conversion, landing page, offer, closing, sales, sales call, appointment
> setter, dm closing, email marketing, paid ads, apply now, book a call,
> strategy call, discovery call, link in bio, waitlist, case study,
> testimonials, client wins, student results, success stories, helped
> clients, hiring setters, hiring closers, backend systems, ltv, upsell,
> retention, learn, free, learn what i do, what i do, trader

*(If none of these words show up anywhere, the lead is rejected — reason:
"no matching keyword.")*

**Your call:** does this list still match who we're targeting? Anything to
add or remove?

---

## Step 2 — Engagement & activity check

Still no AI yet — just math on their recent posts:

- **Engagement rate must be at least 0.5%** — meaning their average likes
  per post (on recent Reels, or all posts if they have too few Reels) is at
  least 1 in every 200 followers. Below that, rejected.
- **Must have posted at least 1 Reel in the last 30 days** — but only once
  we've actually seen 3+ of their Reels; if we didn't manage to scrape enough
  of their content to judge fairly, we skip this check rather than punish
  them for our own missing data.

**Your call:** is 0.5% the right bar? Too strict, too loose?

---

## Step 3 — AI reads the profile

If a profile survives both checks above, an AI model reads their bio, name,
and recent captions and decides:

- What **niche** they're in and what **business model** they run — a course,
  1:1 coaching, an agency, an online store, software, just a content
  creator, or unclear
- Whether they have a **visible offer** at all, and how confident the AI is
  about it (high / medium / low / none)
- How well they fit **one of our two target profiles**:
  - **Infopreneurs / high-ticket coaches** — sells knowledge (course,
    coaching, mastermind) to consumers, ideally $50k–75k+/month, $500+ offer,
    sold via sales calls, has an engaged audience
  - **Ad/sales agencies** — sells marketing/sales services to *other
    businesses*, with visible client results or case studies

The AI scores this fit as **strong**, **moderate**, or **weak**.

**Your call:** are these still the right two types of leads to target? Full
detail is in `docs/icp.md` if you want to revisit the description itself.

---

## Step 4 — Turning all of that into one score

Four ingredients get combined into a single 0–10 score. Here's how much each
one counts, most important first:

1. **Right kind of business (35% of the score)** — this is the biggest
   factor by design: being the right *type* of account matters more than
   anything else. Strong fit scores high, weak fit scores very low
   (deliberately, so a weak-fit account can't sneak through on other
   strengths). A few things nudge this up a little further: mentioning a
   sales call ("book a call", "DM to apply"), webinar/VSL language, or
   stating revenue proof like "$50k/month" or "7-figure."

   *Special case:* if the AI calls them an online store (ecom), we
   automatically treat that as a weak fit — **unless** their bio link
   mentions something like a mastermind, course, or coaching program, since
   plenty of ecom founders also sell a knowledge product on the side.

2. **How clear and strong their offer is (25%)** — do they have a link in
   their bio, do they visibly sell something, how confident is the AI that
   the offer is real, and does their business type suggest real money
   (course/coaching/agency scores highest; software/ecom/creator scores
   much lower).

3. **How engaged their audience actually is (25%)** — based on the same
   engagement-rate math as Step 2, but scored on a sliding scale instead of
   pass/fail: 6%+ engagement is a perfect score, and it drops off from there
   down to almost nothing below 0.3%.

4. **How active they post (15%)** — the least important ingredient. Based
   purely on how many Reels they've posted in the last 30 days: 12+ is a
   perfect score, dropping to zero if they haven't posted a Reel at all
   recently.

**One hard rule that overrides everything above:** if their business-type
fit came out "weak," their final score can **never** go above 6.5, no matter
how good their engagement or offer looks. This exists so a wrong-industry
account can't qualify just because it happens to have a big, engaged
following.

**Your call:** do these percentages (35/25/25/15) still reflect what matters
most to you? Should "right kind of business" really outweigh everything else
2-to-1 against posting activity?

---

## The final decision

Once that 0–10 score is calculated, it's compared against a cutoff to decide
if the lead is a **yes** ("qualified"), a **maybe** ("review"), or a **no**
("rejected").

> ⚠️ **Right now that cutoff is set to 0.** In practice this means: once a
> lead survives Steps 1 and 2, it is **automatically marked "qualified"** —
> the score from Step 3/4 still gets calculated and saved (so you can see it
> and the reasoning behind it, and the weak-fit 6.5 cap still applies), but
> it no longer actually blocks anyone from being marked "qualified." The
> "maybe" (review) bucket currently never gets used at all.
>
> **Is this intentional?** If not, tell me what cutoff you'd like (the
> system was originally built expecting something like 7.5 out of 10) and
> I'll change it back.

---

## Quick summary of every adjustable number today

| Setting | Current value |
|---|---|
| Minimum followers | 5,000 |
| Maximum followers | 500,000 |
| Minimum engagement rate | 0.5% |
| Minimum Reels posted in last 30 days | 1 |
| Final qualifying cutoff | **0** (see warning above) |
| Which AI does the reading | OpenAI |
| "Right kind of business" weight | 35% |
| "Clear/strong offer" weight | 25% |
| "Audience engagement" weight | 25% |
| "Posting activity" weight | 15% |
| Weak-fit score ceiling | 6.5 out of 10 |

Mark up whatever you want changed and send it back — I'll turn your notes
into the actual settings/config updates.
