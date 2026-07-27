// Keeps campaign variant weight_pct values always summing to exactly 100 as
// the user edits/adds/removes variants in campaign-variant-editor.tsx, so the
// old "must equal 100%" manual arithmetic never has to happen.
//
// campaign_variants.weight_pct is a DB int column with `check (weight_pct >
// 0)` (supabase/migrations/20260727000000_campaign_variants.sql), so every
// variant is floored at 1 — never 0 — which is also why one variant can never
// grow past `100 - othersCount` percentage points.
const MIN_WEIGHT = 1;

// Splits `pool` across `current.length` slots: each gets the MIN_WEIGHT floor
// plus a share of the remainder proportional to how far above that floor it
// currently sits (equal split if everything is already at the floor). Uses
// largest-remainder rounding so the result is always integers summing to
// exactly `pool` — plain proportional math would produce fractions.
function distributeProportionally(pool: number, current: number[]): number[] {
  const n = current.length;
  if (n === 0) return [];

  const extraPool = pool - n * MIN_WEIGHT;
  const aboveFloor = current.map((w) => Math.max(0, w - MIN_WEIGHT));
  const sumAboveFloor = aboveFloor.reduce((s, w) => s + w, 0);

  const raw = aboveFloor.map(
    (w) => MIN_WEIGHT + (sumAboveFloor > 0 ? (extraPool * w) / sumAboveFloor : extraPool / n),
  );

  const floors = raw.map((r) => Math.floor(r));
  const remainder = pool - floors.reduce((s, f) => s + f, 0);

  const byFractionDesc = raw
    .map((r, i) => ({ i, frac: r - floors[i] }))
    .sort((a, b) => b.frac - a.frac);

  const result = [...floors];
  for (let k = 0; k < remainder; k++) result[byFractionDesc[k % byFractionDesc.length].i] += 1;
  return result;
}

/**
 * User is editing `weights[changedIndex]` to `requestedValue`. Clamps it to
 * what's actually available given the floor, then redistributes the rest
 * across the other variants proportional to their current relative weights.
 */
export function rebalanceOnChange(weights: number[], changedIndex: number, requestedValue: number): number[] {
  const n = weights.length;
  if (n === 0) return [];
  if (n === 1) return [100];

  const othersIdx = weights.map((_, i) => i).filter((i) => i !== changedIndex);
  const maxForChanged = 100 - othersIdx.length * MIN_WEIGHT;
  const newChanged = Math.min(maxForChanged, Math.max(MIN_WEIGHT, Math.round(requestedValue)));
  const pool = 100 - newChanged;

  const distributed = distributeProportionally(
    pool,
    othersIdx.map((i) => weights[i]),
  );

  const result = [...weights];
  result[changedIndex] = newChanged;
  othersIdx.forEach((idx, k) => { result[idx] = distributed[k]; });
  return result;
}

/**
 * A variant at `removedIndex` is being deleted — the survivors split the
 * full 100% proportionally to their current relative weights (equivalent to
 * handing the removed variant's share to the others in proportion).
 */
export function rebalanceOnRemove(weights: number[], removedIndex: number): number[] {
  const survivorWeights = weights.filter((_, i) => i !== removedIndex);
  if (survivorWeights.length === 0) return [];
  if (survivorWeights.length === 1) return [100];
  return distributeProportionally(100, survivorWeights);
}
