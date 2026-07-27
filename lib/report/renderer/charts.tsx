import type { ChartBarsBlock, ChartFunnelBlock, ChartLineBlock } from "../schema";

/*
 * Charts as inline SVG. The PDF is already HTML rendered by Chromium, so SVG is
 * the natural chart medium here: vector-crisp at print resolution, zero native
 * dependencies, and fully deterministic — the same payload always draws the same
 * pixels.
 *
 * Style rules, from the spec: one accent, one muted grey, red reserved for
 * values below break-even. The brand accent *is* red, so the assignment is:
 * ink for positive, accent for negative — losses are the thing this document
 * must never soften. No gridline clutter, no legends where labels suffice.
 *
 * Geometry only. Every label and figure arrives pre-formatted; nothing here
 * rounds, sums, or formats a number, so a chart can never disagree with the
 * table beside it.
 */

const INK = "#141414";
const ACCENT = "#EF382B";
const MUTED = "#8a8a86";
const HAIRLINE = "#d9d7d2";
const FONT = "'CB Inter', 'Inter', sans-serif";

function scale(domainMin: number, domainMax: number, rangeMin: number, rangeMax: number) {
  const span = domainMax - domainMin || 1;
  return (v: number) => rangeMin + ((v - domainMin) / span) * (rangeMax - rangeMin);
}

function Caption({ text }: { text: string }) {
  return <p className="cb-chart__caption">{text}</p>;
}

/**
 * Chart 1 pattern — vertical bars with a dashed zero line. Bars below zero
 * hang downward in accent red with their value beneath them; there is no way to
 * glance at this and miss that a price point loses money.
 */
export function ChartBars({ block }: { block: ChartBarsBlock }) {
  const W = 700;
  const H = 300;
  const PAD = { top: 34, right: 16, bottom: 56, left: 16 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const values = block.bars.map((b) => b.value);
  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);
  const y = scale(min, max, PAD.top + plotH, PAD.top);
  const zeroY = y(0);

  const slot = plotW / block.bars.length;
  const barW = Math.min(120, slot * 0.55);

  return (
    <figure className="cb-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" style={{ width: "100%", height: "auto", display: "block" }}>
        {/* zero line */}
        <line x1={PAD.left} x2={W - PAD.right} y1={zeroY} y2={zeroY} stroke={INK} strokeWidth={1} strokeDasharray="4 3" />
        {block.bars.map((bar, i) => {
          const cx = PAD.left + slot * i + slot / 2;
          const x = cx - barW / 2;
          const negative = bar.value < 0;
          const top = negative ? zeroY : y(bar.value);
          const height = Math.max(1.5, Math.abs(y(bar.value) - zeroY));
          const valueY = negative ? top + height + 16 : top - 8;
          return (
            <g key={i}>
              <rect x={x} y={top} width={barW} height={height} fill={negative ? ACCENT : INK} />
              <text x={cx} y={valueY} textAnchor="middle" fontFamily={FONT} fontSize={15} fontWeight={700} fill={negative ? ACCENT : INK}>
                {bar.display}
              </text>
              <text x={cx} y={H - PAD.bottom + 22} textAnchor="middle" fontFamily={FONT} fontSize={12.5} fill={INK}>
                {bar.label}
              </text>
              {bar.sublabel && (
                <text x={cx} y={H - PAD.bottom + 38} textAnchor="middle" fontFamily={FONT} fontSize={11} fill={MUTED}>
                  {bar.sublabel}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <Caption text={block.caption} />
    </figure>
  );
}

/**
 * Chart 3 pattern — a line with the below-zero region shaded and the break-even
 * crossing marked. For a negative-economics case this is the proof of the whole
 * argument: the line never reaches the shaded boundary at the current price.
 */
export function ChartLine({ block }: { block: ChartLineBlock }) {
  const W = 700;
  const H = 300;
  const PAD = { top: 20, right: 20, bottom: 46, left: 64 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const xs = block.points.map((p) => p.x);
  const ys = block.points.map((p) => p.y);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(0, ...ys);
  const yMax = Math.max(0, ...ys);
  const sx = scale(xMin, xMax, PAD.left, PAD.left + plotW);
  const sy = scale(yMin, yMax, PAD.top + plotH, PAD.top);
  const zeroY = sy(0);

  const path = block.points.map((p, i) => `${i === 0 ? "M" : "L"}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(" ");

  return (
    <figure className="cb-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" style={{ width: "100%", height: "auto", display: "block" }}>
        {/* loss region: everything below zero */}
        {yMin < 0 && (
          <rect x={PAD.left} y={zeroY} width={plotW} height={PAD.top + plotH - zeroY} fill={ACCENT} opacity={0.07} />
        )}
        <line x1={PAD.left} x2={PAD.left + plotW} y1={zeroY} y2={zeroY} stroke={INK} strokeWidth={1} strokeDasharray="4 3" />
        {/* y ticks */}
        {block.yTicks.map((tick, i) => (
          <g key={`y${i}`}>
            <line x1={PAD.left - 4} x2={PAD.left} y1={sy(tick.y)} y2={sy(tick.y)} stroke={MUTED} strokeWidth={1} />
            <text x={PAD.left - 8} y={sy(tick.y) + 4} textAnchor="end" fontFamily={FONT} fontSize={11} fill={MUTED}>
              {tick.label}
            </text>
          </g>
        ))}
        {/* x ticks */}
        {block.xTicks.map((tick, i) => (
          <g key={`x${i}`}>
            <line x1={sx(tick.x)} x2={sx(tick.x)} y1={PAD.top + plotH} y2={PAD.top + plotH + 4} stroke={MUTED} strokeWidth={1} />
            <text x={sx(tick.x)} y={PAD.top + plotH + 18} textAnchor="middle" fontFamily={FONT} fontSize={11} fill={MUTED}>
              {tick.label}
            </text>
          </g>
        ))}
        <text x={PAD.left + plotW / 2} y={H - 6} textAnchor="middle" fontFamily={FONT} fontSize={11.5} fill={INK}>
          {block.xLabel}
        </text>
        <text
          x={14}
          y={PAD.top + plotH / 2}
          textAnchor="middle"
          fontFamily={FONT}
          fontSize={11.5}
          fill={INK}
          transform={`rotate(-90 14 ${PAD.top + plotH / 2})`}
        >
          {block.yLabel}
        </text>
        <path d={path} fill="none" stroke={INK} strokeWidth={2.25} />
        {block.breakEven && (
          <g>
            <circle cx={sx(block.breakEven.x)} cy={zeroY} r={5} fill={ACCENT} />
            <text x={sx(block.breakEven.x) + 9} y={zeroY - 9} fontFamily={FONT} fontSize={12.5} fontWeight={700} fill={ACCENT}>
              {block.breakEven.label}
            </text>
          </g>
        )}
      </svg>
      <Caption text={block.caption} />
    </figure>
  );
}

/** Chart 2 pattern — descending horizontal bars with stage conversions between them. */
export function ChartFunnel({ block }: { block: ChartFunnelBlock }) {
  const W = 700;
  const ROW = 44;
  const GAP = 10;
  const LABEL_W = 190;
  const H = block.stages.length * (ROW + GAP) + 8;
  const max = Math.max(...block.stages.map((s) => s.value), 1);
  const plotW = W - LABEL_W - 96;

  return (
    <figure className="cb-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" style={{ width: "100%", height: "auto", display: "block" }}>
        {block.stages.map((stage, i) => {
          const top = i * (ROW + GAP);
          const width = Math.max(3, (stage.value / max) * plotW);
          return (
            <g key={i}>
              <text x={LABEL_W - 10} y={top + ROW / 2 + 4} textAnchor="end" fontFamily={FONT} fontSize={12.5} fill={INK}>
                {stage.label}
              </text>
              <rect x={LABEL_W} y={top + 4} width={width} height={ROW - 8} fill={INK} opacity={1 - i * 0.13} />
              <text
                x={LABEL_W + width + 10}
                y={top + ROW / 2 + 4}
                fontFamily={FONT}
                fontSize={13.5}
                fontWeight={700}
                fill={INK}
              >
                {stage.display}
              </text>
              {stage.conversion && (
                <text x={LABEL_W + 2} y={top - 1} fontFamily={FONT} fontSize={10.5} fill={MUTED}>
                  ↓ {stage.conversion}
                </text>
              )}
            </g>
          );
        })}
        <line x1={LABEL_W} x2={LABEL_W} y1={0} y2={H} stroke={HAIRLINE} strokeWidth={1} />
      </svg>
      <Caption text={block.caption} />
    </figure>
  );
}
