import { Block } from "./blocks";
import { monogram } from "./prospect-image";
import { TIER_LABEL, type ReportAssets, type ReportContent } from "../schema";

/*
 * The document. Takes validated ReportContent and renders it deterministically —
 * no branching on model output, no formatting decisions. Everything the language
 * model contributes has already been schema-checked and numerically validated
 * before it reaches here.
 */

/**
 * The prospect's own face on the cover, which is what makes the document read as
 * prepared *for them* rather than generated. The reference achieves this with a
 * pasted profile screenshot; this is the same idea from data we already hold.
 *
 * Degrades to initials whenever the photo is missing, private, expired or
 * blocked — every one of which is a normal outcome, so the fallback has to look
 * intentional rather than broken.
 */
function ProspectCard({ content, photo }: { content: ReportContent; photo: string | null }) {
  const { displayName, username, followersDisplay, verified } = content.metadata;

  return (
    <aside className="cb-prospect">
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element -- print document, not a Next page
        <img className="cb-prospect__photo" src={photo} alt={displayName} />
      ) : (
        <div className="cb-prospect__monogram">{monogram(displayName, username)}</div>
      )}
      <div className="cb-prospect__name">
        {displayName}
        {verified && <span className="cb-prospect__check"> ✓</span>}
      </div>
      <div className="cb-prospect__handle">@{username}</div>
      {followersDisplay && (
        <div className="cb-prospect__stat">
          <b>{followersDisplay}</b> followers
        </div>
      )}
    </aside>
  );
}

function Cover({ content, assets }: { content: ReportContent; assets: ReportAssets }) {
  const { metadata } = content;
  return (
    <section className="cb-cover">
      {/* Raw SVG injection is safe here and only here: logoMark is a committed
          asset read off disk by fonts.ts (extracted from the brand guide), never
          lead data and never model output. Everything else in this document goes
          through React's escaping. */}
      <div className="cb-cover__mark" dangerouslySetInnerHTML={{ __html: assets.logoMark }} />
      <div className="cb-cover__rule" />
      <div className="cb-cover__top">
        <div className="cb-cover__headline">
          <h1>{metadata.reportTitle}</h1>
          <div className="cb-cover__for">Prepared for {metadata.displayName}</div>
          <p className="cb-cover__thesis">{metadata.thesis}</p>
        </div>
        <ProspectCard content={content} photo={assets.prospectPhoto} />
      </div>
      <div className="cb-cover__purpose">
        <h2>Purpose</h2>
        <p>{metadata.purpose}</p>
      </div>
      <div className="cb-cover__meta">
        Prepared by <b>Conversion Brands</b> &nbsp;·&nbsp; Planning document &nbsp;·&nbsp;{" "}
        <b>{metadata.preparedAt}</b> &nbsp;·&nbsp; Data as of <b>{metadata.evidenceCutoffAt}</b>
      </div>
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
        Every figure above is one of three things: observed on a public page, a category benchmark, or a stated
        working assumption. This is which.
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
  // Numbered by position, not from a fixed key→number map: a report that omits a
  // section (no post data means no content section) then still reads 0, 1, 2…
  // rather than skipping a number and looking like a missing page.
  let counter = 0;
  const numbers = content.sections.map((section) => (section.key === "hero" ? null : String(counter++)));

  return (
    <div className="cb-report">
      {content.sections.map((section, index) => {
        if (section.key === "hero") return <Cover key="hero" content={content} assets={assets} />;
        const number = numbers[index];

        return (
          <section key={section.key} id={section.key} className="cb-section">
            <div className="cb-section__head">
              <h2 className="cb-section__title">
                <span className="cb-section__number">{number}.</span> {section.title}
              </h2>
            </div>
            {section.subtitle && <p className="cb-section__sub">{section.subtitle}</p>}
            {section.blocks.map((block, i) => (
              <Block key={i} block={block} />
            ))}
          </section>
        );
      })}
      <Provenance content={content} />
    </div>
  );
}
