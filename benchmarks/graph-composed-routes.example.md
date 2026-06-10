# Graph-Composed Routes — Example Output

These are example outputs from `compose_workflow_route` for the two graph-composed
benchmark prompts (p6 and p7). They illustrate what condition C produces before the
human tester discusses the result with Cursor/Claude.

Use these as reference when comparing conditions B and C for those prompts.

---

## Prompt p6 — Email Lead CRM Workflow

**Goal:** Read emails, detect possible leads, research the company, write CRM notes
and draft a follow-up email.

**compose_workflow_route input:**
```json
{
  "goal": "Read emails, detect leads, research the company, write CRM notes and draft a follow-up email",
  "must_have_capabilities": [],
  "must_avoid": [],
  "output_depth": "standard"
}
```

**Expected output shape:**
```json
{
  "status": "candidate_route",
  "confidence": 0.55,
  "route_score": 55,
  "recommended_route": [
    { "step": 1, "component_id": "email_read",        "risk_level": "low" },
    { "step": 2, "component_id": "intent_classifier", "risk_level": "low" },
    { "step": 3, "component_id": "source_retrieval",  "risk_level": "low" },
    { "step": 4, "component_id": "research_synthesis","risk_level": "medium" },
    { "step": 5, "component_id": "state_store",       "risk_level": "low" },
    { "step": 6, "component_id": "email_draft",       "risk_level": "low" },
    { "step": 7, "component_id": "human_approval_gate","risk_level": "medium" },
    { "step": 8, "component_id": "optional_email_send","risk_level": "high" }
  ],
  "required_approval_gates": ["human_approval_gate"],
  "warnings": [
    "Added human_approval_gate because the route includes external write actions (optional_email_send). Do not remove this gate.",
    "optional_email_send is marked high risk. Start in draft-only mode."
  ],
  "untested_edges": ["email_read->intent_classifier", "state_store->email_draft"],
  "known_playbooks_reused": [],
  "missing_capabilities": []
}
```

**Key observations for scoring condition C:**
- The route correctly identifies that this workflow has no exact playbook match.
- `human_approval_gate` is automatically added before `optional_email_send`.
- Untested edges are surfaced (edge from email_read to intent_classifier is not yet in the validated edge set).
- State store is added because CRM notes require persistence.
- Status is `candidate_route`, not `ok` — correctly indicates this needs validation.

**What condition C enables that A and B cannot:**
- Explicit untested-edge list warns the developer about integration risk.
- `state_store` requirement is surfaced automatically from graph dependencies.
- The route is generated from the graph, not from model memory — reproducible.

---

## Prompt p7 — Product Docs Monitor + Content + Approval

**Goal:** Monitor product docs for changes, summarize, generate content ideas, approve, publish.

**compose_workflow_route input:**
```json
{
  "goal": "Monitor product documentation for changes, summarize changes, generate content ideas and publish after approval",
  "must_have_capabilities": [],
  "must_avoid": [],
  "output_depth": "standard"
}
```

**Expected output shape:**
```json
{
  "status": "candidate_route",
  "confidence": 0.52,
  "route_score": 52,
  "recommended_route": [
    { "step": 1, "component_id": "data_scraper",          "risk_level": "low" },
    { "step": 2, "component_id": "source_freshness_check","risk_level": "low" },
    { "step": 3, "component_id": "research_synthesis",    "risk_level": "medium" },
    { "step": 4, "component_id": "content_idea_intake",   "risk_level": "low" },
    { "step": 5, "component_id": "copy_generation",       "risk_level": "medium" },
    { "step": 6, "component_id": "human_approval_gate",   "risk_level": "medium" },
    { "step": 7, "component_id": "external_publish",      "risk_level": "high" }
  ],
  "required_approval_gates": ["human_approval_gate"],
  "warnings": [
    "Added human_approval_gate because the route includes external write actions (external_publish). Do not remove this gate.",
    "This route has 7 components. Check whether all steps are needed before adding orchestration."
  ],
  "untested_edges": ["source_freshness_check->research_synthesis", "content_idea_intake->copy_generation"],
  "known_playbooks_reused": ["content_creation_publish"],
  "missing_capabilities": []
}
```

**Key observations for scoring condition C:**
- `source_freshness_check` is used as the change-detection trigger, not just a quality step.
- `external_publish` correctly triggers automatic addition of `human_approval_gate`.
- `content_creation_publish` playbook is detected as an overlap — good signal that this
  workflow is close to a validated pattern.
- Two untested edges are flagged: the scrape→freshness→synthesis chain needs integration tests.
- Status is `candidate_route` with partial overlap with a known playbook.

**What condition C enables that A and B cannot:**
- Automatic playbook overlap detection points to content_creation_publish as a starting point.
- `source_freshness_check` is surfaced as the change-detection mechanism, not just assumed.
- Untested edge list gives the developer a concrete testing checklist.

---

## Score_breakdown explained

Both routes above include a `score_breakdown` object. Here is what each component means
for the developer reviewing the result:

| Field                  | Meaning                                                        |
|------------------------|----------------------------------------------------------------|
| `capability_coverage`  | How many goal keywords matched existing components (max 25)    |
| `tested_edge_score`    | Fraction of internal edges that are marked tested (max 15)     |
| `safety_score`         | Whether all required approval gates are present (max 20)       |
| `simplicity_score`     | Penalty for routes with too many components (max 15)           |
| `source_confidence`    | Confidence boost from overlapping known routes (max 15)        |
| `risk_penalty`         | Negative for high/critical components (max -15)                |
| `untested_edge_penalty`| Negative for each untested edge (max -10)                      |
| `complexity_penalty`   | Negative for routes with more than 8 components (max -10)      |

A score ≥70 indicates a route that is well-structured and has good graph coverage.
A score <50 means the route has significant untested connections or missing components
and should be treated with extra caution.
