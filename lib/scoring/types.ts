// Narrow AI output — just the things code can't do (read bio + captions and
// infer what they're selling and to whom).
export type AiClassification = {
  niche: string;                       // e.g. "fitness coaching"
  business_model:                      // bucketed for filtering
    | "course" | "coaching" | "agency" | "ecom" | "saas" | "creator" | "unknown";
  offer_type: string;                  // brief: "$497 course", "1:1 coaching", "unknown"
  audience_type: string;               // e.g. "women 25-45 wanting to lose weight"
  has_visible_offer: boolean;          // bio/captions clearly mention a paid offer
  offer_confidence: "high" | "medium" | "low" | "none";
};
