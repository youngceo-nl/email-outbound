// Outreach categories, derived from the AI `business_model` classification —
// not a stored column. The classifier already separates agencies (B2B service
// sellers) from infopreneurs (coaches / course sellers); this just folds its
// seven-value enum into the three buckets outreach cares about.
//
//   agency                        -> partnerships  (potential partners, B2B)
//   course | coaching             -> info          (individuals we pitch to)
//   ecom | saas | creator | ...   -> other         (everything else, incl. null)

export type LeadCategory = "partnerships" | "info" | "other";

export const LEAD_CATEGORIES: LeadCategory[] = ["partnerships", "info", "other"];

export const CATEGORY_LABELS: Record<LeadCategory, string> = {
  partnerships: "Partnerships",
  info: "Info",
  other: "Other",
};

/** business_model values that define each named category. Other is the remainder. */
const PARTNERSHIPS_MODELS = ["agency"];
const INFO_MODELS = ["course", "coaching"];

export function leadCategory(businessModel: string | null | undefined): LeadCategory {
  if (businessModel && PARTNERSHIPS_MODELS.includes(businessModel)) return "partnerships";
  if (businessModel && INFO_MODELS.includes(businessModel)) return "info";
  return "other";
}

/**
 * The business_model values that map to a category — for DB filtering. Other
 * is the open-ended remainder (anything not agency/course/coaching, including
 * null), so it returns null to signal "use a NOT IN / else" filter rather than
 * an IN list.
 */
export function businessModelsFor(category: LeadCategory): string[] | null {
  if (category === "partnerships") return PARTNERSHIPS_MODELS;
  if (category === "info") return INFO_MODELS;
  return null;
}

export type CategoryTemplate = { subject: string; body: string };
export type CategoryTemplates = Record<LeadCategory, CategoryTemplate>;
