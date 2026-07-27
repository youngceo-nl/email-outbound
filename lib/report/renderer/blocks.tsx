import type {
  CalloutBlock,
  CaseStudyBlock,
  ClientWallBlock,
  ForAgainstBlock,
  ForAgainstRow,
  LadderBlock,
  ParagraphBlock,
  QuestionListBlock,
  ReportBlock,
  StatGridBlock,
  StepListBlock,
  TableBlock,
} from "../schema";
import { ChartBars, ChartFunnel, ChartLine } from "./charts";

/*
 * Block components. Presentation only — every string arrives pre-formatted, so
 * nothing here does arithmetic or number formatting. That keeps a single source
 * of truth for figures (the calculator) and means the renderer can never
 * disagree with the stored scenario.
 */

function Paragraph({ block }: { block: ParagraphBlock }) {
  return <p>{block.text}</p>;
}

function StatGrid({ block }: { block: StatGridBlock }) {
  // A sparse prospect can yield a single measurable figure, and one tile floating
  // in a three-column grid reads as a rendering fault rather than as scarce data.
  // The grid narrows to match instead.
  const columns = Math.min(block.stats.length, 3);
  return (
    <div className={`cb-stats cb-stats--${columns}`}>
      {block.stats.map((stat, i) => (
        <div key={i} className="cb-stat">
          <div className={`cb-stat__value${stat.tone ? ` cb-money--${stat.tone}` : ""}`}>{stat.value}</div>
          <div className="cb-stat__label">{stat.label}</div>
          {stat.sublabel && <div className="cb-stat__sub">{stat.sublabel}</div>}
        </div>
      ))}
    </div>
  );
}

function Table({ block }: { block: TableBlock }) {
  const figures = block.variant === "figures";
  const emphasis = block.emphasizeColumn;
  // Sign prefixes are semantics the builder wrote, not formatting done here:
  // "-$" renders as a loss, "+$" as a gain. Pure presentation of an existing sign.
  const cellClass = (col: number, cell?: string) => {
    const parts: string[] = [];
    if (emphasis !== null && col === emphasis) parts.push("cb-col-base");
    if (figures && cell?.startsWith("-$")) parts.push("cb-money--bad");
    if (figures && cell?.startsWith("+$")) parts.push("cb-money--good");
    return parts.length > 0 ? parts.join(" ") : undefined;
  };

  return (
    <table className={`cb-table${figures ? " cb-table--figures" : ""}`}>
      <thead>
        <tr>
          {block.columns.map((col, i) => (
            <th key={i} className={cellClass(i)}>
              {col}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {block.rows.map((row, r) => (
          <tr key={r}>
            {row.map((cell, c) => (
              <td key={c} className={cellClass(c, cell)}>
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Callout({ block }: { block: CalloutBlock }) {
  const tone = block.tone === "neutral" ? "" : ` cb-callout--${block.tone}`;
  return (
    <div className={`cb-callout${tone}`}>
      <div className="cb-callout__title">{block.title}</div>
      <p>{block.text}</p>
    </div>
  );
}

function Ladder({ block }: { block: LadderBlock }) {
  return (
    <div className="cb-ladder">
      {block.steps.map((step, i) => (
        <div key={i} className="cb-ladder__step">
          <div className="cb-ladder__price">{step.price}</div>
          <div className="cb-ladder__name">{step.name}</div>
          <div className="cb-ladder__role">{step.role}</div>
        </div>
      ))}
    </div>
  );
}

function StepList({ block }: { block: StepListBlock }) {
  return (
    <div className="cb-steps">
      {block.steps.map((step) => (
        <div key={step.order} className="cb-step">
          <div className="cb-step__order">{step.order}</div>
          <div className="cb-step__title">{step.title}</div>
          <div className="cb-step__desc">{step.description}</div>
          {step.meta && <div className="cb-step__desc">{step.meta}</div>}
        </div>
      ))}
    </div>
  );
}

function QuestionList({ block }: { block: QuestionListBlock }) {
  return (
    <ul className="cb-questions">
      {block.questions.map((q) => (
        <li key={q.order}>{q.question}</li>
      ))}
    </ul>
  );
}

function CaseStudy({ block }: { block: CaseStudyBlock }) {
  return (
    <div className="cb-callout">
      <div className="cb-callout__title">{block.label}</div>
      <p>{block.headline}</p>
      <div className="cb-stats" style={{ marginTop: "3mm", marginBottom: 0 }}>
        {block.metrics.map((metric, i) => (
          <div key={i} className="cb-stat">
            <div className="cb-stat__value">{metric.value}</div>
            <div className="cb-stat__label">{metric.label}</div>
            {metric.sublabel && <div className="cb-stat__sub">{metric.sublabel}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

/** ●●○ — weight as filled dots, the spec's own notation. */
function WeightDots({ weight }: { weight: 1 | 2 | 3 }) {
  return <span className="cb-fa__dots">{"●".repeat(weight) + "○".repeat(3 - weight)}</span>;
}

function ForAgainstColumn({ title, rows, against }: { title: string; rows: ForAgainstRow[]; against?: boolean }) {
  return (
    <div className={`cb-fa__col${against ? " cb-fa__col--against" : ""}`}>
      <div className="cb-fa__head">{title}</div>
      {rows.map((row, i) => (
        <div key={i} className="cb-fa__row">
          <WeightDots weight={row.weight} />
          <div>
            <p className="cb-fa__text">{row.text}</p>
            <div className="cb-fa__basis">→ {row.basis}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ForAgainst({ block }: { block: ForAgainstBlock }) {
  // Sorted by weight descending — the builder supplies them ordered, but the
  // renderer enforces it so a hand-edited payload can't bury the lead.
  const sorted = (rows: ForAgainstRow[]) => [...rows].sort((a, b) => b.weight - a.weight);
  return (
    <div className="cb-fa">
      <ForAgainstColumn title="The case for" rows={sorted(block.forRows)} />
      <ForAgainstColumn title="The case against" rows={sorted(block.againstRows)} against />
    </div>
  );
}

function ClientWall({ block }: { block: ClientWallBlock }) {
  return (
    <div className="cb-wall">
      {block.clients.map((client) => (
        <a key={client.handle} className="cb-wall__card" href={client.href} target="_blank" rel="noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element -- print document */}
          <img src={client.image} alt={`${client.name} — ${client.work}`} loading="lazy" />
          <span className="cb-wall__name">{client.name}</span>
          <span className="cb-wall__work">{client.work}</span>
          <span className="cb-wall__handle">@{client.handle}</span>
        </a>
      ))}
    </div>
  );
}

export function Block({ block }: { block: ReportBlock }) {
  switch (block.type) {
    case "paragraph":
      return <Paragraph block={block} />;
    case "stat_grid":
      return <StatGrid block={block} />;
    case "table":
      return <Table block={block} />;
    case "callout":
      return <Callout block={block} />;
    case "ladder":
      return <Ladder block={block} />;
    case "step_list":
      return <StepList block={block} />;
    case "question_list":
      return <QuestionList block={block} />;
    case "case_study":
      return <CaseStudy block={block} />;
    case "chart_bars":
      return <ChartBars block={block} />;
    case "chart_line":
      return <ChartLine block={block} />;
    case "chart_funnel":
      return <ChartFunnel block={block} />;
    case "for_against":
      return <ForAgainst block={block} />;
    case "client_wall":
      return <ClientWall block={block} />;
  }
}
