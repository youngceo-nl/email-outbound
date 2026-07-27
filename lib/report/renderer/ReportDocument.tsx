import { Block } from "./blocks";
import { ChartBars } from "./charts";
import { monogram } from "./prospect-image";
import { TIER_LABEL, type ReportAssets, type ReportContent } from "../schema";

/*
 * The document. Takes validated ReportContent and renders it deterministically —
 * no branching on model output, no formatting decisions. Everything the language
 * model contributes has already been schema-checked and numerically validated
 * before it reaches here.
 *
 * Page one is the whole sale. A reader gives this document fifteen seconds
 * before deciding whether to give it five minutes, so the first page answers
 * their four questions — how much, how fast, selling what, at what cost — plus
 * the one-sentence verdict and the chart that proves it. Everything else in the
 * document is supporting material for a reader those fifteen seconds convinced.
 */

/**
 * Page one. Exactly six elements: header strip, verdict sentence, four KPI
 * cards, the hero chart, and a footer pointing at the math and the ask.
 *
 * The cards and chart come from the hero section's blocks (built, like every
 * figure, by the calculator) — this component lays them out and adds nothing.
 */
function VerdictPage({ content, assets }: { content: ReportContent; assets: ReportAssets }) {
  const { metadata } = content;
  const hero = content.sections.find((s) => s.key === "hero");
  const cards = hero?.blocks.find((b) => b.type === "stat_grid");
  const chart = hero?.blocks.find((b) => b.type === "chart_bars");

  return (
    <section className="cb-cover cb-verdictpage">
      <header className="cb-verdictpage__strip">
        <div className="cb-verdictpage__mark" dangerouslySetInnerHTML={{ __html: assets.logoMark }} />
        <div className="cb-verdictpage__who">
          {assets.prospectPhoto ? (
            // eslint-disable-next-line @next/next/no-img-element -- print document, not a Next page
            <img className="cb-verdictpage__photo" src={assets.prospectPhoto} alt={metadata.displayName} />
          ) : (
            <span className="cb-verdictpage__monogram">{monogram(metadata.displayName, metadata.username)}</span>
          )}
          <span>
            <b>{metadata.displayName}</b>
            {metadata.verified && <span className="cb-prospect__check"> ✓</span>} &nbsp;·&nbsp; @{metadata.username}
            {metadata.followersDisplay && <> &nbsp;·&nbsp; {metadata.followersDisplay} followers</>}
            &nbsp;·&nbsp; {metadata.preparedAt}
          </span>
        </div>
      </header>

      <h1 className="cb-verdictpage__verdict">{metadata.thesis}</h1>

      {cards && cards.type === "stat_grid" && (
        <div className="cb-verdictpage__cards">
          {cards.stats.map((stat, i) => (
            <div key={i} className="cb-stat cb-stat--hero">
              <div className="cb-stat__label">{stat.label}</div>
              <div className="cb-stat__value">{stat.value}</div>
              {stat.sublabel && <div className="cb-stat__sub">{stat.sublabel}</div>}
            </div>
          ))}
        </div>
      )}

      {chart && chart.type === "chart_bars" && <ChartBars block={chart} />}

      <footer className="cb-verdictpage__foot">
        Full math in <b>The numbers</b> &nbsp;·&nbsp; Next step in <b>What we need from you</b> &nbsp;·&nbsp; Basis of
        every figure in the appendix &nbsp;·&nbsp; Data as of <b>{metadata.evidenceCutoffAt}</b>
      </footer>
    </section>
  );
}

/**
 * §0 and §10's provenance content is rendered from the resolved assumption set
 * rather than authored, so the document's own account of what it knows can't
 * drift from the numbers it used. This is the structural guarantee that keeps a
 * generated report honest instead of honest-if-the-model-behaves.
 */
function Provenance({ content }: { content: ReportContent }) {
  if (content.assumptions.length === 0 && content.sourceNotes.length === 0) return null;

  return (
    <section className="cb-section">
      <div className="cb-section__head">
        <h2 className="cb-section__title">
          <span className="cb-section__number">·</span> Assumptions &amp; sources
        </h2>
      </div>
      <p className="cb-section__sub">
        Every figure in this document is one of three things: observed on a public page, a category benchmark, or a
        stated working assumption. This is which.
      </p>

      {content.assumptions.length > 0 && (
        <table className="cb-table">
          <thead>
            <tr>
              <th>Input</th>
              <th>Value</th>
              <th>Basis</th>
              <th>Where it came from</th>
            </tr>
          </thead>
          <tbody>
            {content.assumptions.map((a) => (
              <tr key={a.key}>
                <td>{a.label}</td>
                <td>{a.display}</td>
                <td>
                  <span className={`cb-tier cb-tier--${a.tier}`}>{TIER_LABEL[a.tier]}</span>
                </td>
                <td>{a.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {content.limitations.length > 0 && (
        <>
          <h3>Known limits</h3>
          <ul className="cb-questions">
            {content.limitations.map((limit, i) => (
              <li key={i}>{limit}</li>
            ))}
          </ul>
        </>
      )}

      {content.sourceNotes.length > 0 && (
        <>
          <h3>Source notes</h3>
          <table className="cb-table">
            <thead>
              <tr>
                <th>Source</th>
                <th>Used for</th>
              </tr>
            </thead>
            <tbody>
              {content.sourceNotes.map((note, i) => (
                <tr key={i}>
                  <td>{note.source}</td>
                  <td>{note.usedFor}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <p className="cb-disclaimer">
        Prepared by Conversion Brands. This document uses public information and stated planning assumptions. The
        scenarios are a decision model, not a guarantee of campaign performance.
      </p>
    </section>
  );
}

export function ReportDocument({ content, assets }: { content: ReportContent; assets: ReportAssets }) {
  const main = content.sections.filter((s) => s.key !== "hero" && !s.appendix);
  const appendix = content.sections.filter((s) => s.appendix);

  const renderSection = (section: ReportContent["sections"][number], number: string | null) => (
    <section key={section.key} id={section.key} className="cb-section">
      <div className="cb-section__head">
        <h2 className="cb-section__title">
          {number && <span className="cb-section__number">{number}.</span>} {section.title}
        </h2>
      </div>
      {section.subtitle && <p className="cb-section__sub">{section.subtitle}</p>}
      {section.blocks.map((block, i) => (
        <Block key={i} block={block} />
      ))}
    </section>
  );

  return (
    <div className="cb-report">
      <VerdictPage content={content} assets={assets} />
      {main.map((section, i) => renderSection(section, String(i + 1)))}

      {appendix.length > 0 && (
        <div className="cb-appendix-divider">
          <div className="cb-appendix-divider__rule" />
          <h2>Appendix</h2>
          <p>
            Supporting material: what this document was built from, how their content performs, and the operating
            proof behind the model. Reference, not argument.
          </p>
        </div>
      )}
      {appendix.map((section) => renderSection(section, null))}

      <Provenance content={content} />
    </div>
  );
}
