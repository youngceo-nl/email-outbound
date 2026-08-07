# AI optimization — reference leads

Five `QUALIFIED_HIGH_PRIORITY` leads from the 2026-08-06 batch run
(`/test-environment/5df0f1f1-26db-4aae-898e-6e1bc5881edc`), picked as the
anchor set to build the rest of this plan around.

| Lead | Score | Followers | Offer |
|---|---|---|---|
| [@adelman.aspires](https://www.instagram.com/adelman.aspires/) | 12/12 | 483,786 | Health/energy coaching — DM "OPTIMAL" for 1:1 |
| [@heatherblankenshipx3](https://www.instagram.com/heatherblankenshipx3) | 12/12 | 169,556 | Real-estate coaching — private mastermind |
| [@shauneng](https://www.instagram.com/shauneng/) | 11/12 | 11,059 | Ecom scaling coaching |
| [@x_gainz](https://www.instagram.com/x_gainz/) | 11/12 | 334,181 | Fitness coaching — DM "GAINZ" for 1:1 |
| [@ecomtimm](https://www.instagram.com/ecomtimm/) | 11/12 | 9,724 | Ecom coaching — DM "ECOM" to start |

All five passed every ICP gate (follower count, personal brand, coach/consultant,
relevant offer) and scored in the top band of the six-dimension scorecard —
see `docs/scoring-system.md` for what the gates/dimensions mean.




we now have openrouter api in the env.local. with that, we're going to identify what AI model works best and for the best price using these leads.

![alt text](<Scherm­afbeelding 2026-08-07 om 10.37.36.png>)
example: @eric is a good lead, one model messed it up using our structure, the other model worked fine.

## Benchmark results — 2026-08-07

| Model | OK | Repaired | Mismatches vs Haiku | Avg cost/lead | Avg latency |
|---|---|---|---|---|---|
| openai/gpt-4.1-nano | 0/5 | 0 | 0 | ? | ? |

### Per-lead detail

**openai/gpt-4.1-nano**

- `x_gainz`: ERROR — ai_output_invalid: signals.transformation.label: Required; signals.information_funnel.label: Required; signals.: Unrecognized key(s) in object: 'offer_inventory'
- `adelman.aspires`: ERROR — ai_output_invalid: signals.transformation.label: Required; signals.information_funnel.label: Required; signals.conversion_cta.label: Required
- `ecomtimm`: ERROR — ai_output_invalid: signals.citations.4.source_id: String must contain at least 1 character(s); signals.transformation.label: Required; signals.information_funnel.label: Required; signals.conversion_cta.label: Required; signals.: Unrecognized key(s) in object: 'offer_inventory', 'proof_inventory', 'primary_offer', 'primary_offer_delivery', 'done_for_you_service_evidence', 'independent_information_offer_evidence', 'conflicts', 'unknowns', 'acquisition_observations'
- `shauneng`: ERROR — ai_output_invalid: signals.transformation.label: Required; signals.: Unrecognized key(s) in object: 'offer_inventory', 'proof_inventory', 'primary_offer', 'primary_offer_delivery'
- `heatherblankenshipx3`: ERROR — ai_output_invalid: signals pass: Expected ',' or '}' after property value in JSON at position 11923 (line 61 column 6)

## Benchmark results — 2026-08-07

| Model | OK | Repaired | Mismatches vs Haiku | Avg cost/lead | Avg latency |
|---|---|---|---|---|---|
| google/gemini-2.5-flash | 5/5 | 0 | 0 | $0.01826 | 22413ms |
| deepseek/deepseek-chat | 4/5 | 0 | 0 | $0.00721 | 75345ms |
| openai/gpt-4.1-nano | 0/5 | 0 | 0 | ? | ? |
| meta-llama/llama-3.3-70b-instruct | 2/5 | 0 | 0 | $0.00194 | 15445ms |
| qwen/qwen-2.5-72b-instruct | 4/5 | 1 | 0 | $0.00839 | 144996ms |

### Per-lead detail

**google/gemini-2.5-flash**

- `x_gainz`: qualification=QUALIFIED_HIGH_PRIORITY (baseline QUALIFIED_HIGH_PRIORITY), score=12 (baseline 11)
- `adelman.aspires`: qualification=QUALIFIED_HIGH_PRIORITY (baseline QUALIFIED_HIGH_PRIORITY), score=10 (baseline 12)
- `ecomtimm`: qualification=QUALIFIED_HIGH_PRIORITY (baseline QUALIFIED_HIGH_PRIORITY), score=10 (baseline 11)
- `shauneng`: qualification=QUALIFIED_HIGH_PRIORITY (baseline QUALIFIED_HIGH_PRIORITY), score=11 (baseline 11)
- `heatherblankenshipx3`: qualification=QUALIFIED_HIGH_PRIORITY (baseline QUALIFIED_HIGH_PRIORITY), score=12 (baseline 12)

**deepseek/deepseek-chat**

- `x_gainz`: qualification=QUALIFIED_HIGH_PRIORITY (baseline QUALIFIED_HIGH_PRIORITY), score=12 (baseline 11)
- `adelman.aspires`: qualification=QUALIFIED_HIGH_PRIORITY (baseline QUALIFIED_HIGH_PRIORITY), score=10 (baseline 12)
- `ecomtimm`: qualification=MANUAL_REVIEW (baseline QUALIFIED_HIGH_PRIORITY), score=9 (baseline 11)
- `shauneng`: ERROR — provider_error: signals pass: The operation was aborted due to timeout
- `heatherblankenshipx3`: qualification=QUALIFIED_HIGH_PRIORITY (baseline QUALIFIED_HIGH_PRIORITY), score=12 (baseline 12)

**openai/gpt-4.1-nano**

- `x_gainz`: ERROR — ai_output_invalid: signals.transformation.label: Required; signals.proof: Expected object, received array; signals.: Unrecognized key(s) in object: 'offer_inventory', 'conflicts', 'unknowns', 'acquisition_observations'
- `adelman.aspires`: ERROR — ai_output_invalid: signals.transformation.state: Required; signals.transformation.strength: Required; signals.information_funnel.label: Required; signals.: Unrecognized key(s) in object: 'offer_inventory', 'proof_inventory', 'primary_offer', 'primary_offer_delivery', 'done_for_you_service_evidence', 'independent_information_offer_evidence', 'conflicts', 'unknowns', 'acquisition_observations'
- `ecomtimm`: ERROR — ai_output_invalid: signals.transformation.label: Required; signals.information_funnel.label: Required; signals.conversion_cta.label: Required; signals.: Unrecognized key(s) in object: 'offer_inventory', 'proof_inventory', 'primary_offer', 'primary_offer_delivery', 'done_for_you_service_evidence', 'independent_information_offer_evidence', 'conflicts', 'unknowns', 'acquisition_observations'
- `shauneng`: ERROR — ai_output_invalid: signals.citations.0.source_type: Invalid enum value. Expected 'display_name' | 'bio' | 'instagram_metadata' | 'highlight' | 'link_hub' | 'external_page' | 'youtube_channel' | 'youtube_video' | 'pinned_post' | 'recent_post', received 'bio:profile'; signals.citations.3.source_type: Invalid enum value. Expected 'display_name' | 'bio' | 'instagram_metadata' | 'highlight' | 'link_hub' | 'external_page' | 'youtube_channel' | 'youtube_video' | 'pinned_post' | 'recent_post', received 'pinned_post:DbJDBeRjoMs'; signals.transformation.label: Required; signals.information_funnel.label: Required; signals.conversion_cta.label: Required; signals.: Unrecognized key(s) in object: 'offer_inventory', 'proof_inventory', 'primary_offer', 'primary_offer_delivery', 'done_for_you_service_evidence', 'independent_information_offer_evidence', 'conflicts', 'unknowns', 'acquisition_observations'
- `heatherblankenshipx3`: ERROR — ai_output_invalid: signals.transformation.label: Required

**meta-llama/llama-3.3-70b-instruct**

- `x_gainz`: qualification=REJECTED (baseline QUALIFIED_HIGH_PRIORITY), score=9 (baseline 11)
- `adelman.aspires`: ERROR — provider_error: signals pass: The operation was aborted due to timeout
- `ecomtimm`: ERROR — provider_error: signals pass: The operation was aborted due to timeout
- `shauneng`: qualification=REJECTED (baseline QUALIFIED_HIGH_PRIORITY), score=9 (baseline 11)
- `heatherblankenshipx3`: ERROR — provider_error: signals pass: The operation was aborted due to timeout

**qwen/qwen-2.5-72b-instruct**

- `x_gainz`: qualification=QUALIFIED_HIGH_PRIORITY (baseline QUALIFIED_HIGH_PRIORITY), score=12 (baseline 11)
- `adelman.aspires`: qualification=QUALIFIED_HIGH_PRIORITY (baseline QUALIFIED_HIGH_PRIORITY), score=12 (baseline 12)
- `ecomtimm`: qualification=QUALIFIED (baseline QUALIFIED_HIGH_PRIORITY), score=9 (baseline 11)
- `shauneng`: ERROR — provider_error: signals pass: The operation was aborted due to timeout
- `heatherblankenshipx3`: qualification=QUALIFIED_HIGH_PRIORITY (baseline QUALIFIED_HIGH_PRIORITY), score=12 (baseline 12)
