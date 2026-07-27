import type { Lead } from "@/lib/types";
import { calculateScenario, roundForDisplay, type ScenarioOutputs } from "./calculations/formulas";
import {
  DEFAULT_PRICE_BAND,
  ORGANIC_REACH_RATE,
  matchNiche,
  type AssumptionKey,
  type ReportOverrides,
} from "./assumptions/defaults";
import { limitationsFrom, resolveAssumptions, type ResolveResult } from "./assumptions/resolve";
import {
  RUNG_LABEL,
  RUNGS,
  buildLadder,
  ladderSummary,
  routeLadder,
  type CapturedPrice,
  type Ladder,
  type PriceBand,
  type RouteDecision,
} from "./ladder";
import { accessLimitations, internalSignals, leadFacts, sourceNotesFrom, type Fact, type InternalSignals } from "./facts";
import { analyseContent, contentObservations } from "./content";
import { compact, count, peopleRange, pct, reportDate, usd } from "./format";
import type { ForAgainstRow, ReportBlock, ReportContent, ScenarioSet, Stat } from "./schema";

/*
 * Assembles a full report from a lead row.
 *
 * Division of labour, which is the whole design: this file owns *structure and
 * numbers*, and every figure it emits comes from the calculator or the fact set.
 * The prose here is deliberately plain template copy — Phase 5 replaces the
 * argued paragraphs with model output, constrained to the same fact set, and the
 * numeric validation gate then checks that nothing the model wrote invented a
 * figure. Keeping the structure independent of the model means a generation
 * failure degrades to a dull-but-true document rather than nothing.
 */

export type BuildArgs = {
  lead: Lead;
  overrides?: ReportOverrides;
  confirmedBy?: string | null;
  /** Injectable so tests and re-renders are deterministic. */
  preparedAt?: Date;
  /**
   * Live competitor-price research for this prospect's niche, when it ran.
   * Replaces the defaults table's assumed band with a researched one, and the
   * competitors render in the document as the evidence behind it.
   */
  research?: NicheResearch | null;
};

export type NicheResearch = {
  band: { mid: number; high: number };
  competitors: Array<{ name: string; price: string; url: string }>;
  /** One line describing the niche as researched — printed with the band. */
  nicheLabel: string;
};

export type BuiltReport = {
  content: ReportContent;
  scenarios: ScenarioSet;
  resolution: ResolveResult;
  facts: Fact[];
  /** Never rendered — see facts.ts. */
  signals: InternalSignals;
  /** The offer ladder, the routing decision it produced, and the band used. */
  ladder: LadderResult;
};

export type PricePoint = {
  key: "observed" | "band_mid" | "band_high";
  label: string;
  price: number;
  outputs: ScenarioOutputs;
};

export type LadderResult = {
  ladder: Ladder;
  decision: RouteDecision;
  band: PriceBand;
  /** The §3.3 payload — what the dossier and (later) charts consume. */
  summary: ReturnType<typeof ladderSummary>;
  /**
   * The projected scenario re-run at up to three front-end prices: what was
   * observed, the category band's midpoint, and its top end. Same assumptions
   * throughout — only the price moves, which is what makes the comparison an
   * argument rather than three unrelated guesses.
   */
  pricePoints: PricePoint[];
  /** False when the projected case loses money at the modelled price. */
  viable: boolean;
};

export function buildReport(args: BuildArgs): BuiltReport {
  const { lead } = args;
  const preparedAt = args.preparedAt ?? new Date();

  const resolution = resolveAssumptions({
    followers: lead.followers,
    niche: lead.niche,
    businessModel: lead.business_model,
    funnelPrice: lead.funnel_price,
    funnelPriceObservedAt: lead.funnel_extracted_at,
    funnelPlatform: lead.funnel_platform,
    overrides: args.overrides,
    confirmedBy: args.confirmedBy,
  });

  const scenarios: ScenarioSet = {
    projected: calculateScenario(resolution.inputs.projected),
    worst: calculateScenario(resolution.inputs.worst),
  };

  const ladderResult = deriveLadder(lead, resolution, scenarios, args.overrides, args.research);

  const facts = leadFacts(lead);
  const contentAnalysis = analyseContent(lead);
  const displayName = lead.full_name?.trim() || lead.username;
  const offerName = lead.funnel_program_name?.trim() || "the current offer";
  const audience = lead.audience_type?.trim() || "their audience";
  const e = scenarios.projected;
  const inputs = resolution.inputs;
  // Backend fields are optional on ScenarioInputs because they sit outside the
  // calculator's model, but the resolver always supplies both — pinned once here
  // so the section bodies below don't each repeat a fallback.
  const backendPrice = inputs.projected.backend_offer_price ?? 0;
  const ascensionRate = inputs.projected.backend_ascension_rate ?? 0;

  const content: ReportContent = {
    schemaVersion: "1.0",
    metadata: {
      leadId: lead.id,
      username: lead.username,
      displayName,
      followersDisplay: lead.followers ? compact(lead.followers) : null,
      verified: lead.is_verified,
      reportTitle: "Webinar Strategy",
      // The route decides the argument. One fixed sentence for every prospect was
      // the templated-output smell in its purest form; this is still a template
      // sentence per shape, but the shape is chosen by their evidence — and the
      // model's pass 1 sharpens it against the dossier.
      //
      // Discovery deliberately keeps the standard sentence for now: its route
      // thesis says "this is a diagnostic, not a projection", which would sit
      // over a document that still contains projection sections until the
      // per-route skeletons land (v3 §3.5). A thesis must not contradict the
      // pages under it.
      thesis:
        ladderResult.decision.route === "standard" || ladderResult.decision.route === "discovery"
          ? `A direct-checkout webinar selling ${offerName}, a selective private backend, and a practical 21-day launch plan.`
          : ladderResult.summary.thesis,
      purpose:
        "Show the simplest webinar model that fits the current offer stack, the economics required for it to work, and the pieces that would need to be built.",
      preparedAt: reportDate(preparedAt),
      // Dated from the lead row's own last refresh, not from today — the figures
      // are as old as the scrape that produced them and the cover says so.
      evidenceCutoffAt: reportDate(lead.updated_at),
    },

    sections: [
      {
        key: "hero",
        title: "Webinar Strategy",
        subtitle: null,
        // Page one, the whole sale: the four questions a prospect actually has
        // (how much, how fast, selling what, at what cost) and the chart that
        // carries the price argument. The renderer lays these out as the cover.
        blocks: heroBlocks(ladderResult, e, inputs.projected.front_end_price, offerName, resolution),
      },

      {
        key: "overview",
        title: "What This Was Built From",
        subtitle: "Inputs, their roles, and what we could not see.",
        appendix: true,
        blocks: [
          {
            type: "table",
            variant: "default",
            emphasizeColumn: null,
            columns: ["Asset group", "Observed position", "Status"],
            rows: assetReadiness(lead),
          },
          {
            type: "table",
            variant: "default",
            emphasizeColumn: null,
            columns: ["Input", "How it is used"],
            rows: [
              ["Public Instagram profile", "Audience size, posting cadence, and engagement signals."],
              [
                lead.funnel_extracted_at ? "Public offer page" : "Offer page (not reviewed)",
                lead.funnel_extracted_at
                  ? "Current offer, description, and listed price."
                  : "No linked offer page was reviewed, so the offer and price are assumptions.",
              ],
              ["Conversion Brands calculator", "Registrations, attendance, purchase rate, costs, and revenue."],
              ["Internal webinar cases", "Operating proof — not a forecast for this account."],
            ],
          },
        ],
      },

      {
        key: "verdict",
        title: "The Case For and Against",
        subtitle: "Sorted by weight. Every row states its basis.",
        blocks: [
          {
            type: "paragraph",
            text: `One webinar, selling ${offerName} at direct checkout. The columns below are the honest version of that call.`,
          },
          forAgainstBlock({ lead, ladder: ladderResult, e, resolution, contentAnalysis }),
        ],
      },

      {
        key: "assets",
        title: "What You Would Sell",
        subtitle: "Every price found, its rung, and the gap.",
        blocks: [
          ...ladderBlocks(ladderResult),
          ...(RUNGS.every((rung) => ladderResult.ladder.rungs[rung].length === 0)
            ? [
                {
                  type: "callout" as const,
                  tone: "note" as const,
                  title: "No public price could be read",
                  text: "Nothing on the linked pages carried a readable price. The deal value modelled in this document is a category starting point, and confirming the real offer is the first item in What We Need From You.",
                },
              ]
            : []),
          {
            type: "paragraph",
            text: `Comparable mid-ticket programs: ${usd(ladderResult.band.mid)}–${usd(ladderResult.band.high)} (${ladderResult.band.source}). This model runs on ${usd(inputs.projected.front_end_price)}.`,
          },
          // The researched band's evidence, in the body — not the appendix. This
          // is what replaces "assumption" labels with named comparables (v3 §3.4).
          ...(args.research && args.research.competitors.length > 0
            ? [
                {
                  type: "table" as const,
                  variant: "default" as const,
                  emphasizeColumn: null,
                  columns: ["Comparable program", "Price", "Source"],
                  rows: args.research.competitors.map((c) => [c.name, c.price, c.url.replace(/^https?:\/\//, "")]),
                },
              ]
            : []),
          { type: "stat_grid", stats: audienceStats(lead).slice(0, 3) },
        ],
      },

      {
        key: "positioning",
        title: "Event Positioning",
        subtitle: "Keep the promise narrow. A broad event converts worse than a specific one.",
        appendix: true,
        blocks: [
          {
            type: "table",
            variant: "default",
            emphasizeColumn: null,
            columns: ["Field", "Observed or recommended"],
            rows: [
              ["Category", lead.niche ?? "Not classified from public material."],
              ["Business model", lead.business_model ?? "Not classified from public material."],
              ["Audience", audience],
              ["Current offer", offerName],
              ["Recommended CTA", `Enrol directly in ${offerName} at ${usd(inputs.projected.front_end_price)}.`],
            ],
          },
        ],
      },

      // Omitted entirely when the scrape captured no usable post data — an empty
      // "content performance" heading is worse than no heading.
      ...(contentAnalysis
        ? [
            {
              key: "content" as const,
              appendix: true,
              title: "Content and Engagement",
              subtitle: `Measured from the ${contentAnalysis.postsAnalysed} most recent non-pinned posts.`,
              blocks: [
                {
                  type: "stat_grid" as const,
                  stats: [
                    {
                      label: "Median engagement",
                      value: count(contentAnalysis.medianEngagement),
                      sublabel: "likes + comments per post",
                    },
                    {
                      label: "Best post",
                      value: count(contentAnalysis.top[0].engagement),
                      sublabel:
                        contentAnalysis.spikeRatio > 0 ? `${contentAnalysis.spikeRatio.toFixed(1)}x the median` : null,
                    },
                    ...(contentAnalysis.reels.averageViews
                      ? [
                          {
                            label: "Average reel views",
                            value: compact(contentAnalysis.reels.averageViews),
                            sublabel: `across ${count(contentAnalysis.reels.count)} reels`,
                          },
                        ]
                      : []),
                  ],
                },
                {
                  type: "table" as const,
                  variant: "default" as const,
                  emphasizeColumn: null,
                  columns: ["Top posts", "Format", "Likes", "Comments", "Engagement"],
                  rows: contentAnalysis.top.map((post) => [
                    post.hook,
                    post.isReel ? "Reel" : "Static",
                    post.likes === null ? "—" : count(post.likes),
                    post.comments === null ? "—" : count(post.comments),
                    count(post.engagement),
                  ]),
                },
                ...(contentAnalysis.reels.count > 0 && contentAnalysis.statics.count > 0
                  ? [
                      {
                        type: "table" as const,
                        variant: "figures" as const,
                        emphasizeColumn: null,
                        columns: ["Format", "Posts in sample", "Average engagement"],
                        rows: [
                          ["Reels", count(contentAnalysis.reels.count), count(contentAnalysis.reels.averageEngagement)],
                          ["Static", count(contentAnalysis.statics.count), count(contentAnalysis.statics.averageEngagement)],
                        ],
                      },
                    ]
                  : []),
                ...contentObservations(contentAnalysis, lead).map((text) => ({ type: "paragraph" as const, text })),
              ],
            },
          ]
        : []),

      {
        key: "funnel",
        title: "Where the Funnel Breaks Today",
        subtitle: "The drop-offs, and the constraint that decides everything.",
        blocks: [funnelChartBlock(lead, resolution, e)],
      },

      {
        key: "opportunity",
        title: "Full Scenario Model",
        subtitle: "Both cases, every line. The argument pages use the projected column.",
        appendix: true,
        blocks: [
          {
            type: "paragraph",
            text: "All three scenarios use the same offer prices. Organic visitors mean actual registration-page visitors, modelled as a share of audience — not followers, and not total content reach.",
          },
          {
            type: "table",
            variant: "figures",
            emphasizeColumn: 2,
            columns: ["Metric", "Worst case", "Projected"],
            rows: [
              row("Organic visitors", (k) => count(inputs[k].organic_visitors)),
              row("Ad spend", (k) => usd(inputs[k].ad_spend)),
              row("Cost per lead", (k) => usd(inputs[k].paid_cost_per_registration)),
              row("Opt-in rate (organic only)", (k) => pct(inputs[k].organic_optin_rate)),
              row("Show-up rate", (k) => pct(inputs[k].show_up_rate)),
              row("Sign-up rate", (k) => pct(inputs[k].front_end_purchase_rate)),
              row("Paid leads", (k) => count(scenarios[k].paid_registrations)),
              row("Total registrations", (k) => count(scenarios[k].total_registrations)),
              row("Show-ups", (k) => count(scenarios[k].live_attendees)),
              row("Sign-ups", (k) => count(scenarios[k].front_end_buyers)),
              row("Cost / registration", (k) => usd(scenarios[k].cost_per_registration)),
              row("CPA (ad spend / sign-up)", (k) => usd(scenarios[k].cpa)),
              row("Revenue", (k) => usd(scenarios[k].net_front_end_revenue)),
              row("ROAS (revenue / ad spend)", (k) => `${roundForDisplay(scenarios[k].roas, 2)}x`),
              row("Net profit", (k) => usd(scenarios[k].front_end_net_profit)),
              row("Margin", (k) => pct(scenarios[k].front_end_net_margin)),
              row("Backend clients", (k) => peopleRange(scenarios[k].backend_clients)),
            ],
          },
        ],
      },

      {
        key: "pnl",
        title: "The Numbers",
        subtitle: "The P&L, and the line the launch lives or dies on.",
        blocks: [
          {
            type: "table",
            variant: "figures",
            emphasizeColumn: null,
            columns: ["P&L item", "Projected case"],
            rows: [
              ["Revenue", usd(e.net_front_end_revenue)],
              ["Ad spend", `-${usd(inputs.projected.ad_spend)}`],
              // Named lines straight from the calculator's expense rows, so the
              // report shows the same breakdown the team modelled.
              ...e.expense_amounts.map((line) => [line.name, `-${usd(line.amount)}`]),
              ["Total expenses", `-${usd(e.total_expenses)}`],
              ["Net profit", `${e.front_end_net_profit >= 0 ? "+" : ""}${usd(e.front_end_net_profit)}`],
              ["Margin", pct(e.front_end_net_margin)],
              ["ROAS (revenue / ad spend)", `${roundForDisplay(e.roas, 2)}x`],
              ["CPA (ad spend / sign-up)", usd(e.cpa)],
            ],
          },
          sensitivityChartBlock(resolution, e),
          {
            type: "callout",
            tone: "note",
            title: "Break-even",
            text: `Break-even is a ${pct(e.break_even_purchase_rate)} purchase rate from live attendees; the model runs at ${pct(inputs.projected.front_end_purchase_rate)}. Everything in the build plan exists to clear that line.`,
          },
        ],
      },

      {
        key: "backend",
        title: "Backend Ascension Detail",
        subtitle: "The private offer raises lifetime value. It is upside, never the rescue plan.",
        appendix: true,
        blocks: [
          {
            type: "stat_grid",
            stats: [
              { label: "Front-end buyers", value: count(e.front_end_buyers), sublabel: "expected case" },
              { label: "Ascension rate", value: pct(ascensionRate), sublabel: "working assumption" },
              { label: "Practical outcome", value: peopleRange(e.backend_clients), sublabel: "per launch" },
            ],
          },
          {
            type: "table",
            variant: "figures",
            emphasizeColumn: null,
            columns: ["Outcome", "Gross revenue", "Approx. net after front-end costs"],
            rows: [1, 2].map((n) => [
              `Front-end + ${n} private client${n > 1 ? "s" : ""}`,
              usd(e.gross_front_end_revenue + backendPrice * n),
              usd(e.front_end_net_profit + backendPrice * n),
            ]),
          },
          {
            type: "callout",
            tone: "good",
            title: "How to read the backend",
            text: `At ${count(e.front_end_buyers)} buyers, a ${pct(ascensionRate)} ascension rate means zero private clients in some launches and one in others. The correct story is higher buyer quality and selective upside across repeated campaigns — not one guaranteed client per launch.`,
          },
        ],
      },

      {
        key: "proof",
        title: "Operating Proof",
        subtitle: "These cases support the operating model. They do not supply this forecast.",
        appendix: true,
        blocks: [
          {
            type: "table",
            variant: "figures",
            emphasizeColumn: null,
            columns: ["Internal campaign", "Registrations", "Live / calls", "Deals", "Revenue"],
            rows: [
              ["Mini-masterclass, larger audience", count(2777), "480 live / 131 applications", count(40), "$121,191 in 21 days"],
              ["Mini-masterclass, smaller audience", count(129), "61 live / 24 calls", count(16), "$86,191 in 14 days"],
            ],
          },
          {
            type: "callout",
            tone: "risk",
            title: "What cannot be assumed",
            text: "This account's audience, price, event format, and sales model are different. These cases show that concentrated audience activation can create meaningful revenue quickly. They do not justify copying another campaign's registration, attendance, or close rate.",
          },
        ],
      },

      {
        key: "roadmap",
        title: "The 21-Day Build",
        subtitle: "What gets built. Your time: three sessions.",
        blocks: [
          {
            type: "table",
            variant: "default",
            emphasizeColumn: null,
            columns: ["Timing", "Build work", "Client involvement"],
            rows: [
              ["Days 1-3", "Confirm offer, promise, price, capacity, checkout terms, targets.", "One strategy session."],
              ["Days 4-7", "Build registration, confirmation, tracking, checkout logic, calendar.", "Approve the event promise."],
              ["Days 5-10", "Write the outline, guided experience, slides, and offer transition.", "Review claims and outline."],
              ["Days 8-12", "Build email, SMS, calendar, no-show, replay, deadline, buyer flows.", "None unless needed."],
              ["Days 10-14", "Prepare organic promotion and a small paid creative test.", "Record short promotional assets."],
              ["Days 15-19", "Promote, test tracking, rehearse, run technical QA.", "One rehearsal or recording block."],
              ["Day 20", "Run the live or hybrid event.", "Present live, or approve a recorded format."],
              ["Day 21+", "Replay, deadline follow-up, onboarding, private application review.", "Review qualified applicants only."],
            ],
          },
        ],
      },

      {
        key: "decision",
        title: "What We Need From You",
        subtitle: "Three confirmations, one decision.",
        blocks: [
          { type: "question_list", questions: decisionQuestions(resolution, offerName).slice(0, 3) },
          {
            type: "callout",
            tone: ladderResult.viable ? "good" : "risk",
            title: ladderResult.viable ? "The one next action" : "The one next action — after the price",
            // The viability gate applies to the deterministic copy too: a losing
            // projected case may never carry a proceed recommendation (v3 §8).
            text: ladderResult.viable
              ? `Confirm the three items above, then run an organic-first pilot with a ${usd(inputs.projected.ad_spend)} paid test. Judge it on front-end buyers alone.`
              : `Do not launch at today's price — it loses money. Set the price first (page one shows the same launch at category pricing), then pilot.`,
          },
        ],
      },
    ],

    assumptions: resolution.assumptions,
    // Both halves are generated: what we could not access (from the lead row) and
    // what had to be assumed (from how the cascade resolved).
    limitations: [...accessLimitations(lead), ...limitationsFrom(resolution)],
    sourceNotes: [
      ...sourceNotesFrom(facts),
      ...(args.research
        ? [
            {
              source: `Live competitor research: ${args.research.competitors.map((c) => c.name).join(", ")}`,
              usedFor: `The ${usd(args.research.band.mid)}–${usd(args.research.band.high)} category price band.`,
            },
          ]
        : []),
      { source: "Third-party advertising benchmarks", usedFor: "Directional paid cost per registration. Not this account's ad data." },
      { source: "Conversion Brands internal cases", usedFor: "Operating proof and implementation scope." },
    ],
  };

  return { content, scenarios, resolution, facts, signals: internalSignals(lead), ladder: ladderResult };

  /** Builds one scenario row of the projections table. */
  function row(label: string, render: (key: keyof ScenarioSet) => string): string[] {
    return [label, render("worst"), render("projected")];
  }
}

function audienceStats(lead: Lead): Stat[] {
  const stats: Stat[] = [];
  if (lead.followers) stats.push({ label: "Followers", value: compact(lead.followers), sublabel: "public profile" });
  // Follower-based engagement is meaningless for reel-driven accounts — the old
  // generator printed a 175.75% "engagement rate" and called it the main
  // constraint. Above 50% the ratio is measuring reach, not engagement, so it
  // is suppressed rather than printed as if it meant something.
  if (lead.engagement_rate && lead.engagement_rate <= 0.5) {
    stats.push({ label: "Engagement rate", value: pct(lead.engagement_rate, 2), sublabel: "recent posts" });
  }
  if (lead.posts_last_30_days !== null) {
    stats.push({ label: "Posts, last 30 days", value: count(lead.posts_last_30_days), sublabel: "publishing cadence" });
  }
  if (lead.funnel_price) stats.push({ label: "Listed price", value: lead.funnel_price, sublabel: "their offer page" });
  if (lead.avg_likes) stats.push({ label: "Average likes", value: count(lead.avg_likes), sublabel: "recent posts" });
  if (lead.reels_last_30_days !== null) {
    stats.push({ label: "Reels, last 30 days", value: count(lead.reels_last_30_days), sublabel: "short-form cadence" });
  }

  // The grid is a 3-up; a trailing row of one looks like a mistake, so pad the
  // count down to a multiple of three rather than leaving an orphan.
  const usable = stats.length >= 3 ? stats.slice(0, stats.length - (stats.length % 3)) : stats;
  return usable.length > 0
    ? usable
    : [{ label: "Audience data", value: "Not available", sublabel: "profile could not be measured" }];
}

function assetReadiness(lead: Lead): string[][] {
  const rows: string[][] = [];

  rows.push([
    "Audience",
    lead.followers
      ? `${compact(lead.followers)} followers on the public profile. Owned reach and launch traffic are unknown.`
      : "Audience size could not be measured.",
    lead.followers ? "Usable, unknown depth" : "Confirm",
  ]);

  rows.push([
    "Publishing cadence",
    lead.posts_last_30_days !== null
      ? `${count(lead.posts_last_30_days)} posts in the last 30 days${lead.reels_last_30_days !== null ? `, ${count(lead.reels_last_30_days)} of them reels` : ""}.`
      : "Publishing cadence could not be measured.",
    lead.activity_status === "very_active" || lead.activity_status === "active" ? "Ready" : "Confirm",
  ]);

  rows.push([
    "Core offer",
    lead.funnel_program_name
      ? `${lead.funnel_program_name}${lead.funnel_price ? ` listed at ${lead.funnel_price}` : ", no public price found"}.`
      : "No offer page was reviewed.",
    lead.funnel_price ? "Ready" : "Confirm",
  ]);

  rows.push([
    "Checkout path",
    lead.funnel_platform
      ? `Hosted on ${lead.funnel_platform}. Event-specific checkout and deadline logic would need work.`
      : "No checkout path was verified.",
    "Revise",
  ]);

  rows.push([
    "Registration page",
    "No event-specific registration page was found.",
    "Build",
  ]);

  return rows;
}

/**
 * The questions worth asking, driven by what actually needs confirming.
 *
 * Anything the cascade flagged becomes a question, so the document asks about its
 * own weakest inputs instead of a fixed list that may not apply.
 */
function decisionQuestions(resolution: ResolveResult, offerName: string): { order: number; question: string }[] {
  const questions: string[] = [];

  if (resolution.needsConfirmation.includes("front_end_price")) {
    questions.push(`Is ${offerName} the intended webinar checkout offer, and is the price used here correct?`);
  }
  if (resolution.needsConfirmation.includes("backend_offer_price")) {
    questions.push("What is the private offer's real price, and how many clients can be taken per launch?");
  }
  if (resolution.needsConfirmation.includes("organic_visitors")) {
    questions.push("What audience and list can actually be activated for a launch?");
  }
  questions.push("Will the event be live once, recurring live, or recorded-hybrid?");
  questions.push("Which organic channels will actively promote it?");
  questions.push("What refund, trial, payment-plan, and financing terms apply to buyers?");

  return questions.map((question, i) => ({ order: i + 1, question }));
}

/**
 * Builds the offer ladder from everything the funnel scrape captured, routes the
 * report from it, and re-runs the projected economics at the category band.
 *
 * The band is a labelled starting point until niche price research (v3 §3.4)
 * replaces it with cited competitors — its tier says so and the report prints it.
 */
function deriveLadder(
  lead: Lead,
  resolution: ResolveResult,
  scenarios: ScenarioSet,
  overrides?: ReportOverrides,
  research?: NicheResearch | null,
): LadderResult {
  const captured: CapturedPrice[] =
    lead.funnel_prices && lead.funnel_prices.length > 0
      ? lead.funnel_prices
      : lead.funnel_price
        ? [{ raw: lead.funnel_price, label: lead.funnel_program_name, url: lead.funnel_url, source: "offer_page" }]
        : [];

  // Prices the team typed into the generate menu outrank the scrape in the
  // ladder too — same precedence the cascade gives them. The low ticket exists
  // only here: it has no scenario input, but a low rung that exists is
  // evidence, and it changes the route.
  const humanEntries: CapturedPrice[] = [];
  const humanFrontEnd = resolution.resolved.find((r) => r.key === "front_end_price");
  if (humanFrontEnd?.tier === "human") {
    humanEntries.push({ raw: usd(humanFrontEnd.value), label: "Front-end offer (set by the team)", url: null, source: "human" });
  }
  const humanBackend = resolution.resolved.find((r) => r.key === "backend_offer_price");
  if (humanBackend?.tier === "human") {
    humanEntries.push({ raw: usd(humanBackend.value), label: "Backend offer (set by the team)", url: null, source: "human" });
  }
  if (overrides?.ladder_low_price && overrides.ladder_low_price > 0) {
    humanEntries.push({ raw: usd(overrides.ladder_low_price), label: "Entry offer (set by the team)", url: null, source: "human" });
  }

  const ladder = buildLadder([...humanEntries, ...captured]);
  const niche = matchNiche(lead.niche, lead.business_model);
  const band: PriceBand = research
    ? {
        mid: research.band.mid,
        high: research.band.high,
        source: `researched: ${research.competitors.length} comparable programs in ${research.nicheLabel}`,
        tier: "researched",
      }
    : niche?.priceBand
      ? {
          ...niche.priceBand,
          source: `starting point for ${niche.label.toLowerCase()} — not yet researched`,
          tier: "assumed",
        }
      : { ...DEFAULT_PRICE_BAND, source: "category starting point (no niche match)", tier: "assumed" };
  const decision = routeLadder(ladder, band);

  // The observed point is the price a webinar would actually sell: the routed
  // mid entry when one exists, otherwise the top capture product — which is
  // exactly the case where this chart argues the price is the constraint.
  const observedEntry =
    decision.modeledEntry ?? ladder.rungs.low[0] ?? ladder.rungs.high[0] ?? null;

  const at = (price: number): ScenarioOutputs =>
    calculateScenario({ ...resolution.inputs.projected, front_end_price: price });

  const pricePoints: PricePoint[] = [
    ...(observedEntry
      ? [
          {
            key: "observed" as const,
            label: `Observed (${observedEntry.raw})`,
            price: observedEntry.amount,
            outputs: at(observedEntry.amount),
          },
        ]
      : []),
    { key: "band_mid" as const, label: `Category band mid (${usd(band.mid)})`, price: band.mid, outputs: at(band.mid) },
    {
      key: "band_high" as const,
      label: `Category band high (${usd(band.high)})`,
      price: band.high,
      outputs: at(band.high),
    },
  ];

  return {
    ladder,
    decision,
    band,
    summary: ladderSummary(ladder, decision, band),
    pricePoints,
    viable: scenarios.projected.front_end_net_profit > 0,
  };
}

/**
 * The ladder rendered as evidence: every price found, its rung, and which rungs
 * are empty. The missing rung is frequently the whole argument — a document that
 * shows the gap is making a case, one that hides it is filling a form.
 */
function ladderBlocks(result: LadderResult): ReportContent["sections"][number]["blocks"] {
  const anyEntry = RUNGS.some((rung) => result.ladder.rungs[rung].length > 0);
  if (!anyEntry) return [];

  const rows: string[][] = [];
  for (const rung of RUNGS) {
    const entries = result.ladder.rungs[rung];
    if (entries.length === 0) {
      rows.push([RUNG_LABEL[rung], "—", "Nothing found at this rung"]);
      continue;
    }
    for (const entry of entries) {
      const period = entry.period === "monthly" ? " per month" : entry.period === "annual" ? " per year" : "";
      rows.push([
        RUNG_LABEL[rung],
        entry.label ?? "Unnamed offer",
        `${entry.raw}${period && !/mo|month|yr|year/i.test(entry.raw) ? period : ""}`,
      ]);
    }
  }

  return [
    {
      type: "table",
      variant: "default",
      emphasizeColumn: null,
      columns: ["Rung", "Offer", "As found"],
      rows,
    },
    ...(result.ladder.missing.includes("mid")
      ? [
          {
            type: "callout" as const,
            tone: "note" as const,
            title: "The missing rung",
            text: `No mid-ticket offer is publicly visible — and that is the rung a direct-checkout webinar sells. ${result.decision.reasoning}`,
          },
        ]
      : []),
  ];
}

/** "$12k" / "-$5k" — y-axis ticks only; tables always carry full figures. */
function compactMoney(value: number): string {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  return abs >= 1000 ? `${sign}$${Math.round(abs / 1000)}k` : `${sign}$${Math.round(abs)}`;
}

/**
 * Page one's cards and hero chart. The four cards answer the reader's four
 * questions in the order they ask them: how much, how fast, selling what, at
 * what cost. When the economics are negative the layout does not change — the
 * loss renders in red and the verdict names the cause, because leading with a
 * bad number honestly beats burying it on the P&L page.
 */
function heroBlocks(
  ladder: LadderResult,
  e: ScenarioSet["projected"],
  frontEndPrice: number,
  offerName: string,
  resolution: ResolveResult,
): ReportBlock[] {
  const priceTier = resolution.resolved.find((r) => r.key === "front_end_price")?.tier;
  const offerShort = offerName.length > 30 ? `${offerName.slice(0, 28)}…` : offerName;

  const cards: ReportBlock = {
    type: "stat_grid",
    stats: [
      {
        label: "Net profit per launch",
        value: `${e.front_end_net_profit >= 0 ? "+" : ""}${usd(roundForDisplay(e.front_end_net_profit, 0))}`,
        sublabel: "projected case",
        tone: e.front_end_net_profit >= 0 ? ("good" as const) : ("bad" as const),
      },
      { label: "Time to first revenue", value: "21 days", sublabel: "kickoff to live event" },
      {
        label: "What you sell",
        value: usd(frontEndPrice),
        sublabel: priceTier === "observed" || priceTier === "human" ? offerShort : `${offerShort} — price assumed`,
      },
      { label: "Projected CPA", value: usd(roundForDisplay(e.cpa, 0)), sublabel: "ad spend per buyer" },
    ],
  };

  const points = ladder.pricePoints;
  if (points.length < 2) return [cards];

  const observed = points.find((p) => p.key === "observed");
  const bandMid = points.find((p) => p.key === "band_mid");
  const caption =
    observed && observed.outputs.front_end_net_profit < 0 && bandMid && bandMid.outputs.front_end_net_profit > 0
      ? `At ${usd(observed.price)} the launch loses ${usd(Math.abs(roundForDisplay(observed.outputs.front_end_net_profit, 0)))}. At ${usd(bandMid.price)}, the same audience and the same conversion assumptions net ${usd(roundForDisplay(bandMid.outputs.front_end_net_profit, 0))} — the price is the constraint, not the funnel.`
      : `Same audience, same conversion assumptions — only the price moves. The category band is ${ladder.band.tier === "researched" ? "researched" : "a stated starting point"}, and every figure traces to the closing table.`;

  const chart: ReportBlock = {
    type: "chart_bars",
    caption,
    bars: points.map((point) => ({
      label: point.key === "observed" ? "Today's price" : point.key === "band_mid" ? "Category mid" : "Category high",
      sublabel: usd(point.price),
      value: point.outputs.front_end_net_profit,
      display: usd(roundForDisplay(point.outputs.front_end_net_profit, 0)),
    })),
  };

  return [cards, chart];
}

/**
 * The case for / the case against, generated from the payload — a row cannot
 * exist without a basis, and the against column always carries at least one
 * high-weight row (break-even sensitivity is calculated on every report). A
 * document with no serious objection reads as a pitch.
 */
function forAgainstBlock(args: {
  lead: Lead;
  ladder: LadderResult;
  e: ScenarioSet["projected"];
  resolution: ResolveResult;
  contentAnalysis: ReturnType<typeof analyseContent>;
}): ReportBlock {
  const { lead, ladder, e, resolution, contentAnalysis } = args;
  const forRows: ForAgainstRow[] = [];
  const againstRows: ForAgainstRow[] = [];
  const sample = contentAnalysis?.postsAnalysed ?? 0;

  // ── for ──
  const avgViews = contentAnalysis?.reels.averageViews ?? null;
  if (avgViews !== null && avgViews > 0 && lead.followers) {
    const ratio = avgViews / lead.followers;
    if (ratio >= 1) {
      forRows.push({
        text: `Reels average ${compact(avgViews)} views against ${compact(lead.followers)} followers — reach is ${ratio.toFixed(1)}x the follower base and already proven.`,
        weight: 3,
        basis: `observed, ${sample} posts`,
      });
    } else if (ratio >= 0.2) {
      forRows.push({
        text: `Reels average ${compact(avgViews)} views, ${pct(ratio)} of the follower base — a launch announcement borrows real reach, not just a follower count.`,
        weight: 2,
        basis: `observed, ${sample} posts`,
      });
    }
  }
  const bestMid = ladder.decision.modeledEntry;
  if (bestMid) {
    forRows.push({
      text: `A mid-ticket offer already exists at ${bestMid.raw} — the webinar sells something already built.`,
      weight: 3,
      basis: "observed, offer page",
    });
  } else if (ladder.ladder.rungs.low.length > 0) {
    forRows.push({
      text: `A capture product at ${ladder.ladder.rungs.low[0].raw} already exists — this audience is used to paying something.`,
      weight: 2,
      basis: "observed, offer page",
    });
  }
  const bandMidPoint = ladder.pricePoints.find((p) => p.key === "band_mid");
  if (bandMidPoint && bandMidPoint.outputs.front_end_net_profit > 0) {
    forRows.push({
      text: `At ${usd(bandMidPoint.price)} the modelled launch nets ${usd(roundForDisplay(bandMidPoint.outputs.front_end_net_profit, 0))} — the audience does not need to grow for the math to work.`,
      weight: 2,
      basis: "calculated",
    });
  }
  if (lead.followers && forRows.length < 4) {
    forRows.push({
      text: `${compact(lead.followers)} followers on Instagram — enough audience to fill a first event before any paid spend.`,
      weight: lead.followers >= 50000 ? 2 : 1,
      basis: "observed, profile",
    });
  }
  if ((lead.posts_last_30_days ?? 0) >= 12 && forRows.length < 4) {
    forRows.push({
      text: `${lead.posts_last_30_days} posts in the last 30 days — the distribution habit a dated event needs already exists.`,
      weight: 1,
      basis: "observed, profile",
    });
  }
  if (forRows.length === 0) {
    forRows.push({
      text: "The model itself: a dated event with direct checkout is the shortest path from an engaged audience to revenue that exists.",
      weight: 1,
      basis: "assumed",
    });
  }

  // ── against ──
  againstRows.push({
    text: `The purchase rate is the whole model. Break-even sits at ${pct(e.break_even_purchase_rate)} of live attendees; below that the launch loses money.`,
    weight: 3,
    basis: "calculated",
  });
  const observedPoint = ladder.pricePoints.find((p) => p.key === "observed");
  if (ladder.decision.route === "missing_mid") {
    againstRows.push({
      text: `No offer above ${ladder.ladder.rungs.low[0]?.raw ?? "the capture product"} exists today. The product a webinar sells has to be built before the event can run.`,
      weight: 3,
      basis: "observed, all linked pages",
    });
  }
  if (ladder.decision.route === "repricing" && bestMid) {
    againstRows.push({
      text: `${bestMid.raw} sits far below the category band of ${usd(ladder.band.mid)}–${usd(ladder.band.high)}. The case rests on repricing, not on the funnel.`,
      weight: 3,
      basis: "calculated vs category band",
    });
  }
  if (observedPoint && observedPoint.outputs.front_end_net_profit < 0 && ladder.decision.route !== "missing_mid") {
    againstRows.push({
      text: `At today's price the projected case loses ${usd(Math.abs(roundForDisplay(observedPoint.outputs.front_end_net_profit, 0)))} per launch.`,
      weight: 3,
      basis: "calculated",
    });
  }
  const priceTier = resolution.resolved.find((r) => r.key === "front_end_price")?.tier;
  if (priceTier === "assumed" && againstRows.length < 4) {
    againstRows.push({
      text: "The deal value is an assumption, not an observed price. Every revenue figure in this document moves with it.",
      weight: 2,
      basis: "assumed",
    });
  }
  if (!contentAnalysis && againstRows.length < 4) {
    againstRows.push({
      text: "No recent post data could be read, so demand is unmeasured — the audience number carries more weight here than it should.",
      weight: 2,
      basis: "observed, scrape",
    });
  }
  if (againstRows.length < 3) {
    againstRows.push({
      text: "Cost per lead is a benchmark, not this account's advertising data. The first paid test resets this model.",
      weight: 1,
      basis: "researched benchmark",
    });
  }

  const byWeight = (a: ForAgainstRow, b: ForAgainstRow) => b.weight - a.weight;
  return {
    type: "for_against",
    forRows: forRows.sort(byWeight).slice(0, 4),
    againstRows: againstRows.sort(byWeight).slice(0, 4),
  };
}

/**
 * Chart 3: net profit against live-attendee purchase rate, break-even marked.
 * For a negative-economics case this is the proof of the whole argument — the
 * line never reaches zero at the current price, and the reader can see it.
 */
function sensitivityChartBlock(resolution: ResolveResult, e: ScenarioSet["projected"]): ReportBlock {
  const points: Array<{ x: number; y: number }> = [];
  for (let rate = 5; rate <= 30; rate += 2.5) {
    const outputs = calculateScenario({ ...resolution.inputs.projected, front_end_purchase_rate: rate / 100 });
    points.push({ x: rate, y: outputs.front_end_net_profit });
  }
  const ys = points.map((p) => p.y);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const breakEvenPct = e.break_even_purchase_rate * 100;
  const crossesInRange = breakEvenPct >= 5 && breakEvenPct <= 30 && maxY > 0;

  const caption =
    minY > 0
      ? `Profitable across the entire modelled range of purchase rates at ${usd(resolution.inputs.projected.front_end_price)}.`
      : maxY <= 0
        ? `At ${usd(resolution.inputs.projected.front_end_price)} the line never crosses zero — no purchase rate in range makes this launch profitable. The price is the constraint.`
        : `The launch is profitable above a ${pct(e.break_even_purchase_rate)} purchase rate. Everything in the build plan exists to clear that line.`;

  return {
    type: "chart_line",
    caption,
    xLabel: "Live-attendee purchase rate",
    yLabel: "Net profit per launch",
    points,
    xTicks: [5, 10, 15, 20, 25, 30].map((x) => ({ x, label: `${x}%` })),
    yTicks: [
      ...(minY < 0 ? [{ y: minY, label: compactMoney(minY) }] : []),
      { y: 0, label: "$0" },
      ...(maxY > 0 ? [{ y: maxY, label: compactMoney(maxY) }] : []),
    ],
    breakEven: crossesInRange ? { x: breakEvenPct, label: `break-even ${pct(e.break_even_purchase_rate)}` } : null,
  };
}

/** Chart 2: the funnel as descending bars, conversions labelled between stages. */
function funnelChartBlock(lead: Lead, resolution: ResolveResult, e: ScenarioSet["projected"]): ReportBlock {
  const inputs = resolution.inputs.projected;
  const stages = [
    ...(lead.followers
      ? [{ label: "Reachable audience", value: lead.followers, display: compact(lead.followers), conversion: null }]
      : []),
    {
      label: "Registration-page visitors",
      value: inputs.organic_visitors,
      display: count(inputs.organic_visitors),
      conversion: lead.followers ? `${pct(ORGANIC_REACH_RATE)} promotion reach` : null,
    },
    {
      label: "Registrations",
      value: e.total_registrations,
      display: count(e.total_registrations),
      conversion: `${pct(inputs.organic_optin_rate)} opt-in + paid leads`,
    },
    {
      label: "Live attendees",
      value: e.live_attendees,
      display: count(e.live_attendees),
      conversion: `${pct(inputs.show_up_rate)} show-up`,
    },
    {
      label: "Buyers",
      value: e.front_end_buyers,
      display: count(e.front_end_buyers),
      conversion: `${pct(inputs.front_end_purchase_rate)} purchase`,
    },
  ];

  return {
    type: "chart_funnel",
    caption: `Paid leads enter at the registration stage (${count(e.paid_registrations)} of ${count(e.total_registrations)} modelled). The binding constraint is the final conversion: ${pct(inputs.front_end_purchase_rate)} modelled against a ${pct(e.break_even_purchase_rate)} break-even.`,
    stages,
  };
}
