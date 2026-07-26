import { calculateScenario, roundForDisplay, type ExpenseLine, type ScenarioInputs } from "../calculations/formulas";
import { compact, count, peopleRange, pct, usd } from "../format";
import type { ReportContent, ScenarioSet } from "../schema";

/*
 * The golden fixture: the reference report rebuilt through our own pipeline.
 *
 * Its purpose is the Phase 1 design gate — render this, put the PDF beside
 * Aaron_Alexander_Webinar_Strategy_Redesigned.pdf, and any divergence is a bug
 * in the renderer rather than a question about the data. It doubles as a
 * regression target: the scenario tables below are *computed*, not typed in, so
 * if the formulas or the display rounding ever drift the fixture stops matching
 * the reference and we find out here instead of in front of a prospect.
 */

/*
 * Inputs exactly as the reference report states them, mapped onto the
 * calculator's two columns: its "Expected" case becomes `projected`, its
 * "Conservative" case becomes `worst`. Its third "Strong" column has no home in a
 * two-scenario model, so it lives on as AARON_STRONG purely so the formulas test
 * can still prove we reproduce all three of the published columns.
 *
 * Expense lines are the reference's own three, in its order.
 */
const REFERENCE_EXPENSES: ExpenseLine[] = [
  { name: "Sales / partner commission", type: "percent_of_revenue", value: 0.175 },
  { name: "Tools / software", type: "fixed", value: 400 },
  { name: "Fixed performance floor", type: "fixed", value: 3000 },
];

const SHARED = {
  front_end_price: 997,
  expenses: REFERENCE_EXPENSES,
  backend_offer_price: 20000,
  backend_ascension_rate: 0.025,
};

export const AARON_INPUTS: Record<keyof ScenarioSet, ScenarioInputs> = {
  projected: {
    ...SHARED,
    organic_visitors: 2500,
    organic_optin_rate: 0.25,
    ad_spend: 2500,
    paid_cost_per_registration: 25,
    show_up_rate: 0.25,
    front_end_purchase_rate: 0.15,
  },
  worst: {
    ...SHARED,
    organic_visitors: 1500,
    organic_optin_rate: 0.2,
    ad_spend: 2500,
    paid_cost_per_registration: 45,
    show_up_rate: 0.25,
    front_end_purchase_rate: 0.1,
  },
};

/** The reference's third column. Rendered nowhere; asserted in the formulas test. */
export const AARON_STRONG: ScenarioInputs = {
  ...SHARED,
  organic_visitors: 4000,
  organic_optin_rate: 0.35,
  ad_spend: 5000,
  paid_cost_per_registration: 20,
  show_up_rate: 0.35,
  front_end_purchase_rate: 0.18,
};

export function aaronScenarios(): ScenarioSet {
  return {
    projected: calculateScenario(AARON_INPUTS.projected),
    worst: calculateScenario(AARON_INPUTS.worst),
  };
}

export function aaronReport(): ReportContent {
  const s = aaronScenarios();
  const e = s.projected;
  const inputs = AARON_INPUTS;
  // Backend is optional on ScenarioInputs (outside the calculator's model); the
  // fixture always sets it, so pin it once rather than guarding at each use.
  const backendPrice = SHARED.backend_offer_price;
  const ascensionRate = SHARED.backend_ascension_rate;

  return {
    schemaVersion: "1.0",
    metadata: {
      leadId: null,
      username: "aaronalexander",
      displayName: "Aaron Alexander",
      // No photo is wired for the fixture, so this exercises the monogram
      // fallback — the path a private or expired image takes.
      followersDisplay: compact(191_000),
      verified: true,
      reportTitle: "Webinar Strategy",
      thesis: "Direct checkout webinar, selective private backend, and a practical 21-day launch plan.",
      purpose:
        "Show the simplest webinar model that fits the current offer stack, the economics required for it to work, and the pieces that would need to be built.",
      preparedAt: "25 Jul 2026",
      evidenceCutoffAt: "25 Jul 2026",
    },

    sections: [
      { key: "hero", title: "Webinar Strategy", subtitle: null, blocks: [] },

      {
        key: "overview",
        title: "Context and Planning Note",
        subtitle: "This was prepared to make the opportunity concrete after the gap in follow-up.",
        blocks: [
          {
            type: "callout",
            tone: "risk",
            title: "Why you are receiving this",
            text: "Rather than restart with another general follow-up, we prepared the strategy below to show the exact model we would explore, the assumptions behind it, and where the risk sits.",
          },
          {
            type: "table",
            variant: "default",
            emphasizeColumn: null,
            columns: ["Input", "How it is used"],
            rows: [
              ["Public offer pages", "Map the current free, $397, $997, and private offer paths."],
              ["Public audience signals", "Confirm there is an audience and authority, without treating followers as traffic."],
              ["Referral context", "Use a direct-purchase webinar and keep private work selective."],
              ["Conversion Brands calculator", "Model organic visitors, paid CPL, attendance, purchase rate, costs, and revenue."],
              ["Internal webinar cases", "Show operating proof, not promised benchmarks."],
            ],
          },
          {
            type: "callout",
            tone: "note",
            title: "Required reading for the numbers",
            text: "Observed facts, working assumptions, and calculated outputs are kept separate throughout. The expected scenario is a decision model, not a promise of campaign performance.",
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
              { label: "Opportunity rating", value: "Strong", sublabel: "with data gaps" },
              { label: "Recommended model", value: "Direct checkout", sublabel: "live or hybrid" },
              { label: "Front-end offer", value: usd(inputs.projected.front_end_price), sublabel: "NSR Level 1" },
              { label: "Private backend", value: "$20K", sublabel: "working assumption" },
              { label: "Primary traffic", value: "Organic first", sublabel: "paid accelerator" },
              { label: "Main constraint", value: "Unknown reach", sublabel: "and history" },
            ],
          },
          {
            type: "paragraph",
            text: "Build one focused live or hybrid webinar that sells the $997 certification directly at checkout. Do not build the front end around booking a large volume of calls. After purchase, invite a small number of qualified buyers to apply for the private immersion — this keeps the scalable offer separate from Aaron's time.",
          },
          {
            type: "callout",
            tone: "good",
            title: "Recommended first test",
            text: `Organic-first launch, plus a controlled ${usd(inputs.projected.ad_spend)} paid test. The front-end target is simple: sell the ${usd(inputs.projected.front_end_price)} certification profitably. The $20,000 backend is additional upside, not the assumption required to rescue the launch.`,
          },
        ],
      },

      {
        key: "assets",
        title: "Existing Assets and Offer Ladder",
        subtitle: "The business already has the core pieces. The main work is organizing them into one campaign.",
        blocks: [
          {
            type: "stat_grid",
            stats: [
              { label: "Instagram", value: compact(191000), sublabel: "provided screenshot" },
              { label: "Podcast", value: "20M+", sublabel: "downloads in bio" },
              { label: "Free entry", value: "2-minute", sublabel: "NSR reset" },
            ],
          },
          {
            type: "ladder",
            steps: [
              { price: "Free", name: "2-Minute Reset", role: "Lead capture and first result" },
              { price: "$397", name: "Align Breathing Program", role: "Consumer path" },
              { price: "$997", name: "NSR Level 1", role: "Recommended webinar checkout" },
              { price: "$20K", name: "Private Immersion", role: "Selective backend assumption" },
            ],
          },
          {
            type: "table",
            variant: "default",
            emphasizeColumn: null,
            columns: ["Asset group", "Observed position", "Status"],
            rows: [
              ["Core offer", "The $997 certification is self-paced and has a direct checkout.", "Ready"],
              ["Audience", "Large public audience. Owned reach and launch traffic are unknown.", "Usable, unknown depth"],
              ["Proof", "Strong public authority, testimonials, clear practitioner outcomes.", "Strong"],
              ["Free entry point", "The 2-minute reset can warm and retarget prospects.", "Ready"],
              ["Checkout path", "Certification checkout exists. Event-specific deadline logic needs work.", "Revise"],
              ["Private backend", "Public 12-week immersion exists. Price and capacity need confirmation.", "Confirm"],
            ],
          },
        ],
      },

      {
        key: "positioning",
        title: "Simple Market and Event Positioning",
        subtitle: "Keep the ICP and event promise narrow. Do not turn this into a broad wellness webinar.",
        blocks: [
          {
            type: "table",
            variant: "default",
            emphasizeColumn: null,
            columns: ["Field", "Working recommendation"],
            rows: [
              ["Primary buyer", "Coaches, therapists, trainers, movement professionals, and health professionals."],
              ["Desired outcome", "Understand nervous-system regulation and apply a clear, safe protocol."],
              ["Visible problem", "They know individual techniques but lack a system for when, why, and how to use them."],
              ["Buying trigger", "They want confidence applying regulation tools without random methods or vague theory."],
              ["Confidence", "High. The public certification page names these buyers and outcomes directly."],
            ],
          },
          {
            type: "callout",
            tone: "good",
            title: "Nervous System Regulation With the Breath",
            text: "A practical live class for coaches and health professionals who want a clear, physiology-based system to change state safely and use it in real-world settings.",
          },
        ],
      },

      {
        key: "funnel",
        title: "Funnel Architecture",
        subtitle: "One event. One checkout. One selective private path.",
        blocks: [
          {
            type: "step_list",
            steps: [
              { order: 1, title: "Traffic", description: "Podcast, Instagram, YouTube, email, paid ads", meta: null },
              { order: 2, title: "Registration", description: "Focused promise and date", meta: null },
              { order: 3, title: "Confirmation", description: "Calendar, email, SMS, expectations", meta: null },
              { order: 4, title: "Live / Hybrid Event", description: "Teach, demonstrate, transition", meta: null },
              { order: 5, title: "$997 Checkout", description: "Direct purchase, no sales call", meta: null },
              { order: 6, title: "Buyer Onboarding", description: "Immediate access and first win", meta: null },
              { order: 7, title: "Private Application", description: "Invite qualified buyers only", meta: null },
              { order: 8, title: "$20K Immersion", description: "Limited, high-touch delivery", meta: null },
            ],
          },
          {
            type: "callout",
            tone: "note",
            title: "Energy protection rule",
            text: "Aaron should not enter the process before a prospect has bought, consumed, or clearly demonstrated fit. The webinar and front-end product do the filtering first.",
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
            text: "All three scenarios use the same front-end price and backend assumption. Organic visitors mean actual registration-page visitors, not followers or total content reach.",
          },
          {
            type: "table",
            variant: "figures",
            emphasizeColumn: 2,
            columns: ["Metric", "Worst case", "Projected"],
            rows: [
              ["Organic visitors", count(inputs.worst.organic_visitors), count(inputs.projected.organic_visitors)],
              ["Ad spend", usd(inputs.worst.ad_spend), usd(inputs.projected.ad_spend)],
              ["Cost per lead", usd(inputs.worst.paid_cost_per_registration), usd(inputs.projected.paid_cost_per_registration)],
              ["Opt-in rate (organic)", pct(inputs.worst.organic_optin_rate), pct(inputs.projected.organic_optin_rate)],
              ["Show-up rate", pct(inputs.worst.show_up_rate), pct(inputs.projected.show_up_rate)],
              ["Sign-up rate", pct(inputs.worst.front_end_purchase_rate), pct(inputs.projected.front_end_purchase_rate)],
              ["Paid leads", count(s.worst.paid_registrations), count(s.projected.paid_registrations)],
              ["Total registrations", count(s.worst.total_registrations), count(s.projected.total_registrations)],
              ["Show-ups", count(s.worst.live_attendees), count(s.projected.live_attendees)],
              ["Sign-ups", count(s.worst.front_end_buyers), count(s.projected.front_end_buyers)],
              ["Cost / registration", usd(s.worst.cost_per_registration), usd(s.projected.cost_per_registration)],
              ["CPA (ad spend / sign-up)", usd(s.worst.cpa), usd(s.projected.cpa)],
              ["Revenue", usd(s.worst.net_front_end_revenue), usd(s.projected.net_front_end_revenue)],
              ["ROAS (revenue / ad spend)", `${roundForDisplay(s.worst.roas, 2)}x`, `${roundForDisplay(s.projected.roas, 2)}x`],
              ["Net profit", usd(s.worst.front_end_net_profit), usd(s.projected.front_end_net_profit)],
              ["Margin", pct(s.worst.front_end_net_margin), pct(s.projected.front_end_net_margin)],
              ["Backend clients", peopleRange(s.worst.backend_clients), peopleRange(s.projected.backend_clients)],
            ],
          },
          {
            type: "callout",
            tone: "risk",
            title: "CPL assumption",
            text: `The ${usd(inputs.projected.paid_cost_per_registration)} expected CPL is a working midpoint between education and broader lead benchmarks. Wellness traffic can be materially more expensive, so the downside case uses ${usd(inputs.worst.paid_cost_per_registration)}. Confidence: medium until account-level data exists.`,
          },
        ],
      },

      {
        key: "pnl",
        title: "Expected Scenario P&L",
        subtitle: "The front-end model should work before any private client is counted.",
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
            text: `The ${pct(inputs.projected.front_end_purchase_rate)} live-attendee purchase rate is the main driver. Under this cost structure the front end breaks even at roughly a ${pct(e.break_even_purchase_rate)} purchase rate from live attendees — so the event, offer transition, and checkout follow-up matter more than a small change in CPL.`,
          },
        ],
      },

      {
        key: "backend",
        title: "Selective Backend Opportunity",
        subtitle: "The private offer increases lifetime value without creating a high-volume call calendar.",
        blocks: [
          {
            type: "stat_grid",
            stats: [
              { label: "Front-end buyers", value: count(e.front_end_buyers), sublabel: "expected case" },
              { label: "Ascension rate", value: pct(ascensionRate), sublabel: "working assumption" },
              { label: "Practical outcome", value: peopleRange(e.backend_clients), sublabel: "single launch" },
            ],
          },
          {
            type: "table",
            variant: "figures",
            emphasizeColumn: null,
            columns: ["Outcome", "Gross revenue", "Approx. net after front-end costs"],
            rows: [
              ["Front-end only", usd(e.gross_front_end_revenue), usd(e.front_end_net_profit)],
              [
                "Front-end + 1 private client",
                usd(e.gross_front_end_revenue + backendPrice),
                usd(e.front_end_net_profit + backendPrice),
              ],
              [
                "Front-end + 2 private clients",
                usd(e.gross_front_end_revenue + backendPrice * 2),
                usd(e.front_end_net_profit + backendPrice * 2),
              ],
            ],
          },
          {
            type: "callout",
            tone: "good",
            title: "How to present the backend",
            text: `Do not promise one $20,000 client from every launch. At ${count(e.front_end_buyers)} buyers, ${pct(ascensionRate)} means zero in some launches and one in others. The correct story is higher buyer quality and selective upside across repeated campaigns.`,
          },
        ],
      },

      {
        key: "proof",
        title: "Relevant Conversion Brands Proof",
        subtitle: "The cases support the operating model. They do not supply this forecast.",
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
            text: "This prospect's audience, price, event format, and sales model are different. The internal cases show that concentrated audience activation can create meaningful revenue quickly. They do not justify copying another campaign's registration, attendance, or close rate.",
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
              ["Days 1-3", "Confirm offer, event promise, price, capacity, checkout terms, targets.", "One strategy session."],
              ["Days 4-7", "Build registration, confirmation, tracking, checkout logic, calendar.", "Approve event promise."],
              ["Days 5-10", "Write webinar outline, guided experience, slides, offer transition.", "Review claims and outline."],
              ["Days 8-12", "Build email, SMS, calendar, no-show, replay, deadline, buyer flows.", "None unless needed."],
              ["Days 10-14", "Prepare organic promotion and a small paid creative test.", "Record short promotional assets."],
              ["Days 15-19", "Promote, test tracking, rehearse, run technical QA.", "One rehearsal or recording block."],
              ["Day 20", "Run the live or hybrid event.", "Present live or approve recorded format."],
              ["Day 21+", "Replay, deadline follow-up, onboarding, private application review.", "Review only qualified applicants."],
            ],
          },
        ],
      },

      {
        key: "decision",
        title: "Decision and Next Step",
        subtitle: "Confirm the assumptions, then decide whether to build the first test.",
        blocks: [
          {
            type: "question_list",
            questions: [
              { order: 1, question: "Is the $997 certification the intended webinar checkout offer?" },
              { order: 2, question: "Is $20,000 the correct private price, and how many clients can be taken?" },
              { order: 3, question: "Will the event be live once, recurring live, or recorded-hybrid?" },
              { order: 4, question: "What organic channels will actively promote it?" },
              { order: 5, question: "Does the fixed performance floor sit inside the campaign P&L as modeled?" },
              { order: 6, question: "What refund, trial, payment-plan, and financing terms apply to webinar buyers?" },
            ],
          },
          {
            type: "callout",
            tone: "good",
            title: "Final recommendation",
            text: `Proceed with an organic-first pilot and a controlled ${usd(inputs.projected.ad_spend)} paid test. Judge the first launch on front-end buyer economics, not on whether it produces a private client. If the ${usd(inputs.projected.front_end_price)} conversion holds, repeat the event and improve the backend qualification path. If it does not, fix the event and checkout before adding spend.`,
          },
        ],
      },
    ],

    // In production these come from the resolver, tagged by where each value was
    // actually found. Hand-written here only because the fixture has no lead row.
    assumptions: [
      { key: "front_end_price", label: "Front-end price", display: usd(inputs.projected.front_end_price), tier: "observed", source: "Public certification page, 25 Jul 2026" },
      { key: "backend_offer_price", label: "Backend price", display: "$20,000", tier: "human", source: "Referral context — not shown publicly" },
      { key: "ad_spend", label: "Ad spend", display: usd(inputs.projected.ad_spend), tier: "human", source: "Agreed test budget" },
      { key: "paid_cost_per_registration", label: "Paid CPL", display: usd(inputs.projected.paid_cost_per_registration), tier: "researched", source: "Education / Meta lead benchmarks — not account data" },
      { key: "organic_optin_rate", label: "Opt-in rate", display: pct(inputs.projected.organic_optin_rate), tier: "assumed", source: "Working assumption" },
      { key: "show_up_rate", label: "Show-up rate", display: pct(inputs.projected.show_up_rate), tier: "assumed", source: "Working assumption" },
      { key: "front_end_purchase_rate", label: "Purchase rate", display: pct(inputs.projected.front_end_purchase_rate), tier: "assumed", source: "Working assumption" },
      { key: "backend_ascension_rate", label: "Ascension rate", display: pct(ascensionRate), tier: "assumed", source: "Working assumption" },
    ],

    limitations: [
      "No access to the email list, story views, customer list, ad account, pixel history, or prior launch data.",
      "No verified active campaign data from the prospect's ad account. The paid CPL is a planning assumption.",
      "The $20,000 private price is a working assumption from referral context. It is not shown publicly.",
      "Organic visitors are modeled separately from followers and podcast downloads.",
      "The model shows scenarios. It does not predict a guaranteed result.",
    ],

    sourceNotes: [
      { source: "Public website and offer pages", usedFor: "Positioning, authority, testimonials, and the offer ladder." },
      { source: "Public certification page", usedFor: "Front-end buyer, curriculum, and the observed $997 price." },
      { source: "Provided Instagram screenshot", usedFor: "191K followers and 20M+ podcast downloads shown in the bio." },
      { source: "Third-party CPL benchmark reports", usedFor: "Directional paid lead cost ranges. Not account data." },
      { source: "Conversion Brands internal cases", usedFor: "Operating proof and implementation scope." },
    ],
  };
}
