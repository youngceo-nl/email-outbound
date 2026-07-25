import type { Lead } from "@/lib/types";
import { calculateScenario, roundForDisplay } from "./calculations/formulas";
import type { AssumptionKey } from "./assumptions/defaults";
import { limitationsFrom, resolveAssumptions, type ResolveResult } from "./assumptions/resolve";
import { accessLimitations, internalSignals, leadFacts, sourceNotesFrom, type Fact, type InternalSignals } from "./facts";
import { analyseContent, contentObservations } from "./content";
import { compact, count, peopleRange, pct, reportDate, usd } from "./format";
import type { ReportContent, ScenarioSet, Stat } from "./schema";

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
  overrides?: Partial<Record<AssumptionKey, number>>;
  confirmedBy?: string | null;
  /** Injectable so tests and re-renders are deterministic. */
  preparedAt?: Date;
};

export type BuiltReport = {
  content: ReportContent;
  scenarios: ScenarioSet;
  resolution: ResolveResult;
  facts: Fact[];
  /** Never rendered — see facts.ts. */
  signals: InternalSignals;
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
      thesis: `A direct-checkout webinar selling ${offerName}, a selective private backend, and a practical 21-day launch plan.`,
      purpose:
        "Show the simplest webinar model that fits the current offer stack, the economics required for it to work, and the pieces that would need to be built.",
      preparedAt: reportDate(preparedAt),
      // Dated from the lead row's own last refresh, not from today — the figures
      // are as old as the scrape that produced them and the cover says so.
      evidenceCutoffAt: reportDate(lead.updated_at),
    },

    sections: [
      { key: "hero", title: "Webinar Strategy", subtitle: null, blocks: [] },

      {
        key: "overview",
        title: "Context and Planning Note",
        subtitle: "What this document is built from, and what it cannot see.",
        blocks: [
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
          {
            type: "callout",
            tone: "note",
            title: "Required reading for the numbers",
            text: "Observed facts, working assumptions, and calculated outputs are kept separate throughout. Every input is labelled with where it came from in the closing table. The scenarios are a decision model, not a promise of campaign performance.",
          },
        ],
      },

      {
        key: "verdict",
        title: "Executive Verdict",
        subtitle: "The conclusion should be clear in under one minute.",
        blocks: [
          {
            type: "stat_grid",
            stats: [
              { label: "Recommended model", value: "Direct checkout", sublabel: "live or hybrid" },
              {
                label: "Front-end offer",
                value: usd(inputs.projected.front_end_price),
                sublabel: resolution.resolved.find((r) => r.key === "front_end_price")?.tier === "observed" ? "observed price" : "working assumption",
              },
              { label: "Private backend", value: usd(backendPrice), sublabel: "working assumption" },
              { label: "Primary traffic", value: "Organic first", sublabel: "paid accelerator" },
              { label: "Audience", value: lead.followers ? compact(lead.followers) : "Unknown", sublabel: "followers, not traffic" },
              {
                label: "Main constraint",
                value: lead.engagement_rate ? pct(lead.engagement_rate, 2) : "Unknown reach",
                sublabel: lead.engagement_rate ? "engagement rate" : "and launch history",
              },
            ],
          },
          {
            type: "paragraph",
            text: `Build one focused live or hybrid webinar that sells ${offerName} directly at checkout, rather than a front end built around booking a large volume of calls. After purchase, invite a small number of qualified buyers into the private offer — that keeps the scalable offer separate from ${displayName}'s time.`,
          },
          {
            type: "callout",
            tone: "good",
            title: "Recommended first test",
            text: `Organic-first launch, plus a controlled ${usd(inputs.projected.ad_spend)} paid test. The front-end target is simple: sell ${offerName} profitably. The backend is additional upside, not the assumption required to rescue the launch.`,
          },
        ],
      },

      {
        key: "assets",
        title: "Existing Assets and Offer Ladder",
        subtitle: "What is already in place, and what the campaign would need to add.",
        blocks: [
          { type: "stat_grid", stats: audienceStats(lead) },
          {
            type: "table",
            variant: "default",
            emphasizeColumn: null,
            columns: ["Asset group", "Observed position", "Status"],
            rows: assetReadiness(lead),
          },
        ],
      },

      {
        key: "positioning",
        title: "Market and Event Positioning",
        subtitle: "Keep the promise narrow. A broad event converts worse than a specific one.",
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
        title: "Funnel Architecture",
        subtitle: "One event. One checkout. One selective private path.",
        blocks: [
          {
            type: "step_list",
            steps: [
              { order: 1, title: "Traffic", description: "Organic posting, stories, email, paid ads", meta: null },
              { order: 2, title: "Registration", description: "Focused promise and a fixed date", meta: null },
              { order: 3, title: "Confirmation", description: "Calendar, email, SMS, expectations", meta: null },
              { order: 4, title: "Live / hybrid event", description: "Teach, demonstrate, transition", meta: null },
              { order: 5, title: "Checkout", description: "Direct purchase, no sales call", meta: null },
              { order: 6, title: "Buyer onboarding", description: "Immediate access and a first win", meta: null },
              { order: 7, title: "Private application", description: "Invite qualified buyers only", meta: null },
              { order: 8, title: "Private delivery", description: "Limited, high-touch capacity", meta: null },
            ],
          },
          {
            type: "callout",
            tone: "note",
            title: "Energy protection rule",
            text: `${displayName} should not enter the process before a prospect has bought, consumed, or clearly demonstrated fit. The webinar and the front-end product do the filtering first.`,
          },
        ],
      },

      {
        key: "opportunity",
        title: "Projected Opportunity",
        subtitle: "The calculator appears early because this is a business decision, not a creative exercise.",
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
        title: "Expected Scenario P&L",
        subtitle: "The front end should work before any private client is counted.",
        blocks: [
          {
            type: "stat_grid",
            stats: [
              { label: "Paid registrations", value: count(e.paid_registrations), sublabel: "spend / CPL" },
              { label: "Organic registrations", value: count(e.organic_registrations), sublabel: "visitors x opt-in" },
              { label: "Total registrations", value: count(e.total_registrations), sublabel: "combined" },
              { label: "Live attendees", value: count(e.live_attendees), sublabel: `${pct(inputs.projected.show_up_rate)} show-up` },
              { label: "Front-end buyers", value: count(e.front_end_buyers), sublabel: `${pct(inputs.projected.front_end_purchase_rate)} purchase` },
              { label: "Front-end revenue", value: usd(e.gross_front_end_revenue), sublabel: "unrounded math" },
            ],
          },
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
              ["Net profit", usd(e.front_end_net_profit)],
              ["Margin", pct(e.front_end_net_margin)],
              ["Return on total spend", pct(e.return_on_total_spend)],
              ["ROAS (revenue / ad spend)", `${roundForDisplay(e.roas, 2)}x`],
              ["CPA (ad spend / sign-up)", usd(e.cpa)],
            ],
          },
          {
            type: "callout",
            tone: "note",
            title: "Most sensitive assumption",
            text: `The ${pct(inputs.projected.front_end_purchase_rate)} live-attendee purchase rate is the main driver. Under this cost structure the front end breaks even at roughly a ${pct(e.break_even_purchase_rate)} purchase rate from live attendees — so the event, the offer transition, and the checkout follow-up matter more than a small change in traffic cost.`,
          },
        ],
      },

      {
        key: "backend",
        title: "Selective Backend Opportunity",
        subtitle: "The private offer raises lifetime value without creating a high-volume call calendar.",
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
        title: "Relevant Conversion Brands Proof",
        subtitle: "These cases support the operating model. They do not supply this forecast.",
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
        title: "21-Day Launch Roadmap",
        subtitle: "A lean build with limited demands on the client's time.",
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
        title: "Decision and Next Step",
        subtitle: "Confirm the assumptions, then decide whether to build the first test.",
        blocks: [
          { type: "question_list", questions: decisionQuestions(resolution, offerName) },
          {
            type: "callout",
            tone: "good",
            title: "Final recommendation",
            text: `Proceed with an organic-first pilot and a controlled ${usd(inputs.projected.ad_spend)} paid test. Judge the first launch on front-end buyer economics, not on whether it produces a private client. If the conversion holds, repeat the event and improve the backend qualification path. If it does not, fix the event and checkout before adding spend.`,
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
      { source: "Third-party advertising benchmarks", usedFor: "Directional paid cost per registration. Not this account's ad data." },
      { source: "Conversion Brands internal cases", usedFor: "Operating proof and implementation scope." },
    ],
  };

  return { content, scenarios, resolution, facts, signals: internalSignals(lead) };

  /** Builds one scenario row of the projections table. */
  function row(label: string, render: (key: keyof ScenarioSet) => string): string[] {
    return [label, render("worst"), render("projected")];
  }
}

function audienceStats(lead: Lead): Stat[] {
  const stats: Stat[] = [];
  if (lead.followers) stats.push({ label: "Followers", value: compact(lead.followers), sublabel: "public profile" });
  if (lead.engagement_rate) {
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
