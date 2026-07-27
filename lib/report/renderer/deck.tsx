import { ChartBars, ChartFunnel, ChartLine } from "./charts";
import { BOOKING_URL, TESTIMONIALS } from "../template/testimonials";
import { monogram } from "./prospect-image";
import type {
  CalloutBlock,
  ChartBarsBlock,
  ChartFunnelBlock,
  ChartLineBlock,
  ForAgainstBlock,
  ForAgainstRow,
  ReportContent,
  ReportAssets,
  StatGridBlock,
  StepListBlock,
  TableBlock,
} from "../schema";

/*
 * The report as a pitch deck — the same story theconversionbrands.com/pitch-deck
 * tells, personalised: full-screen slides, one idea each, arrow-key and dot
 * navigation, and the prospect's own numbers where the company deck says "here's
 * what this looks like with your numbers".
 *
 * Nothing here is computed. Every slide pulls pieces out of the same stored
 * ReportContent the document renders, so the deck, the PDF and the preview can
 * never disagree. A slide whose section is missing simply doesn't render —
 * a sparse prospect gets a shorter deck, not an emptier one.
 *
 * This is what gets screen-shared on a Loom. The A4 document remains the
 * attachment; this is the walkthrough.
 */

type Section = ReportContent["sections"][number];

function section(content: ReportContent, key: string): Section | undefined {
  return content.sections.find((s) => s.key === key);
}

function firstOf<T extends { type: string }>(sec: Section | undefined, type: T["type"]): T | undefined {
  return sec?.blocks.find((b) => b.type === type) as T | undefined;
}

function calloutOf(sec: Section | undefined, tone: CalloutBlock["tone"]): CalloutBlock | undefined {
  return sec?.blocks.find((b): b is CalloutBlock => b.type === "callout" && b.tone === tone);
}

function Slide({
  kicker,
  title,
  children,
  center,
}: {
  kicker: string;
  title?: string;
  children: React.ReactNode;
  center?: boolean;
}) {
  return (
    <section className="cbd-slide">
      <div className={`cbd-inner${center ? " cbd-inner--center" : ""}`}>
        <div className="cbd-kicker">{kicker}</div>
        {title && <h2 className="cbd-title">{title}</h2>}
        {children}
      </div>
    </section>
  );
}

function FaColumn({ heading, rows, against }: { heading: string; rows: ForAgainstRow[]; against?: boolean }) {
  return (
    <div className={`cb-fa__col${against ? " cb-fa__col--against" : ""}`}>
      <div className="cb-fa__head">{heading}</div>
      {rows.slice(0, 3).map((row, i) => (
        <div key={i} className="cb-fa__row">
          <span className="cb-fa__dots">{"●".repeat(row.weight) + "○".repeat(3 - row.weight)}</span>
          <div>
            <p className="cb-fa__text">{row.text}</p>
            <div className="cb-fa__basis">→ {row.basis}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function ReportDeck({ content, assets }: { content: ReportContent; assets: ReportAssets }) {
  const meta = content.metadata;

  const hero = section(content, "hero");
  const heroCards = firstOf<StatGridBlock>(hero, "stat_grid");
  const priceChart = firstOf<ChartBarsBlock>(hero, "chart_bars");
  const verdictSec = section(content, "verdict");
  const forAgainst = firstOf<ForAgainstBlock>(verdictSec, "for_against");
  const assetsSec = section(content, "assets");
  const ladderTable = firstOf<TableBlock>(assetsSec, "table");
  const funnelSec = section(content, "funnel");
  const funnelChart = firstOf<ChartFunnelBlock>(funnelSec, "chart_funnel");
  const bottleneck = calloutOf(funnelSec, "risk");
  const pnlSec = section(content, "pnl");
  const sensitivity = firstOf<ChartLineBlock>(pnlSec, "chart_line");
  const breakEven = calloutOf(pnlSec, "note");
  const proofTable = firstOf<TableBlock>(section(content, "proof"), "table");
  const roadmap = firstOf<TableBlock>(section(content, "roadmap"), "table");
  const phases = firstOf<StepListBlock>(section(content, "roadmap"), "step_list");
  const decisionSec = section(content, "decision");
  const nextAction = decisionSec?.blocks.find((b): b is CalloutBlock => b.type === "callout");

  const profitCard = heroCards?.stats.find((s) => s.label.toLowerCase().includes("net profit"));

  const slides: React.ReactNode[] = [];

  // 1 · Hook — their name, the verdict, the number.
  slides.push(
    <Slide key="hook" kicker={`Prepared for ${meta.displayName} · @${meta.username}`} center>
      <h1 className="cbd-hook">{meta.thesis}</h1>
      {profitCard && (
        <div className="cbd-hook-stat">
          <span className={`cbd-hook-stat__value${profitCard.tone ? ` cb-money--${profitCard.tone}` : ""}`}>
            {profitCard.value}
          </span>
          <span className="cbd-hook-stat__label">projected net profit per launch</span>
        </div>
      )}
      <div className="cbd-meta">
        Conversion Brands · {meta.preparedAt} · data as of {meta.evidenceCutoffAt}
      </div>
    </Slide>,
  );

  // 2 · Your numbers — the four cards, big.
  if (heroCards) {
    slides.push(
      <Slide key="numbers" kicker="With your numbers" title="How much, how fast, selling what, at what cost">
        <div className="cbd-cards">
          {heroCards.stats.map((stat, i) => (
            <div key={i} className="cb-stat cb-stat--hero">
              <div className="cb-stat__label">{stat.label}</div>
              <div className={`cb-stat__value${stat.tone ? ` cb-money--${stat.tone}` : ""}`}>{stat.value}</div>
              {stat.sublabel && <div className="cb-stat__sub">{stat.sublabel}</div>}
            </div>
          ))}
        </div>
      </Slide>,
    );
  }

  // 3 · The price argument.
  if (priceChart) {
    slides.push(
      <Slide key="price" kicker="The price argument" title="Same audience, same assumptions — only the price moves">
        <ChartBars block={priceChart} />
      </Slide>,
    );
  }

  // 4 · The honest case.
  if (forAgainst) {
    slides.push(
      <Slide key="case" kicker="The honest version" title="The case, for and against">
        <div className="cb-fa">
          <FaColumn heading="For" rows={forAgainst.forRows} />
          <FaColumn heading="Against" rows={forAgainst.againstRows} against />
        </div>
      </Slide>,
    );
  }

  // 5 · What you would sell.
  if (ladderTable) {
    slides.push(
      <Slide key="sell" kicker="The offer ladder" title={assetsSec?.title ?? "What you would sell"}>
        <table className="cb-table">
          <thead>
            <tr>
              {ladderTable.columns.map((col, i) => (
                <th key={i}>{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ladderTable.rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td key={c}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Slide>,
    );
  }

  // 6 · The funnel.
  if (funnelChart) {
    slides.push(
      <Slide key="funnel" kicker="Where it breaks today" title={bottleneck?.title ?? "The funnel"}>
        <ChartFunnel block={funnelChart} />
        {bottleneck && <p className="cbd-note">{bottleneck.text}</p>}
      </Slide>,
    );
  }

  // 7 · Break-even.
  if (sensitivity) {
    slides.push(
      <Slide key="breakeven" kicker="The line that decides it" title={breakEven?.title ?? "Break-even"}>
        <ChartLine block={sensitivity} />
      </Slide>,
    );
  }

  // 8 · The client wall — the homepage's own proof, clickable through to the
  // actual pages built for each person.
  slides.push(
    <Slide key="wall" kicker="It already worked" title="Built for people in your seat">
      <div className="cbd-wall">
        {TESTIMONIALS.map((client) => (
          <a key={client.handle} className="cbd-wall__card" href={client.href} target="_blank" rel="noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element -- static deck */}
            <img src={client.image} alt={`${client.name} — ${client.work}`} loading="lazy" />
            <span className="cbd-wall__name">{client.name}</span>
            <span className="cbd-wall__work">{client.work}</span>
            <span className="cbd-wall__handle">@{client.handle}</span>
          </a>
        ))}
      </div>
    </Slide>,
  );

  // 9 · The numbers behind the wall.
  if (proofTable) {
    slides.push(
      <Slide key="proof" kicker="Proof, at scale" title="Operating proof, not a forecast">
        <table className="cb-table cb-table--figures">
          <thead>
            <tr>
              {proofTable.columns.map((col, i) => (
                <th key={i}>{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {proofTable.rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td key={c}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Slide>,
    );
  }

  // 10 · The plan — four phases, kickoff to live event.
  if (phases) {
    slides.push(
      <Slide key="plan" kicker="Twenty-one days" title="Four phases, kickoff to live event">
        <div className="cbd-phases">
          {phases.steps.map((step) => (
            <div key={step.order} className="cbd-phase">
              <div className="cbd-phase__num">{step.order}</div>
              <div className="cbd-phase__title">{step.title}</div>
              <p className="cbd-phase__desc">{step.description}</p>
              {step.meta && <div className="cbd-phase__meta">{step.meta}</div>}
            </div>
          ))}
        </div>
      </Slide>,
    );
  } else if (roadmap) {
    slides.push(
      <Slide key="plan" kicker="Twenty-one days" title="Kickoff to live event">
        <div className="cbd-plan">
          {roadmap.rows.slice(0, 8).map((row, i) => (
            <div key={i} className="cbd-plan__row">
              <div className="cbd-plan__when">{row[0]}</div>
              <div className="cbd-plan__what">{row[1]}</div>
            </div>
          ))}
        </div>
      </Slide>,
    );
  }

  // 11 · The ask: book the call.
  slides.push(
    <Slide key="ask" kicker="The next step" title={nextAction?.title ?? "Book the build call"} center>
      {nextAction && <p className="cbd-note cbd-note--big">{nextAction.text}</p>}
      <a className="cbd-cta" href={BOOKING_URL} target="_blank" rel="noreferrer">
        Book your call →
      </a>
      <div className="cbd-meta">Conversion Brands</div>
    </Slide>,
  );

  return (
    <div className="cb-report cbd">
      <div className="cbd-progress" id="cbd-progress" />
      <header className="cbd-strip">
        <div className="cbd-strip__brand" dangerouslySetInnerHTML={{ __html: assets.logoMark }} />
        <div className="cbd-strip__who">
          {assets.prospectPhoto ? (
            // eslint-disable-next-line @next/next/no-img-element -- static deck, not a Next page
            <img src={assets.prospectPhoto} alt={meta.displayName} />
          ) : (
            <span className="cbd-strip__mono">{monogram(meta.displayName, meta.username)}</span>
          )}
          <b>{meta.displayName}</b>
        </div>
      </header>
      <main className="cbd-slides" id="cbd-slides">
        {slides}
      </main>
      <nav className="cbd-dots" id="cbd-dots" aria-label="Slides">
        {slides.map((_, i) => (
          <button key={i} data-slide={i} aria-label={`Slide ${i + 1}`} />
        ))}
      </nav>
    </div>
  );
}
