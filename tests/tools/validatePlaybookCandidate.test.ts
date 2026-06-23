import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { loadRegistry } from "../../src/registry/registryLoader.js";
import { validatePlaybookCandidate } from "../../src/tools/validatePlaybookCandidate.js";

/**
 * MAR-169 — validate_playbook_candidate. The playbook-factory gate: read-only,
 * deterministic, stateless. Certifies the STRUCTURAL Definition of Done up to
 * `beta`; never certifies validated/published (those need Lab evidence).
 */
const registry = loadRegistry({ includeBeta: true });

function dod(r: ReturnType<typeof validatePlaybookCandidate>, id: number) {
  return r.dod.find((d) => d.id === id);
}

const FULL_CANDIDATE = `id: my_candidate
version: "0.1.0"
status: draft
title: My Candidate
summary: A well-formed candidate playbook for testing.
workflow_type: data
golden_path_route_id: ""
components: [data_scraper, data_normalizer, deduplication, schema_validation, state_store]
edges: [data_scraper__produces__data_normalizer, data_normalizer__produces__deduplication]
stack_id: default_orchestratekit_stack
risk_level: medium
deterministic_steps: [data_scraper, data_normalizer]
failure_modes: [a, b, c, d, e]
evals: [a, b, c, d, e]
sources:
  - title: test source
    source_type: internal_note
`;

describe("validate_playbook_candidate — happy path", () => {
  it("a real registry playbook qualifies for beta, needs Lab evidence for more", () => {
    const yaml = readFileSync("registry/playbooks/data_extraction_enrichment.playbook.yaml", "utf8");
    const r = validatePlaybookCandidate(yaml, registry);
    expect(r.status).toBe("ok");
    expect(r.qualifies_for).toBe("beta");
    expect(r.blocking).toHaveLength(0);
    // the two evidence items (sessions + benchmark) are unverifiable, never faked
    expect(r.evidence_required.length).toBe(2);
    expect(dod(r, 4)!.ok).toBe("unverifiable");
    expect(dod(r, 5)!.ok).toBe("unverifiable");
  });

  it("a complete hand-written candidate qualifies for beta", () => {
    const r = validatePlaybookCandidate(FULL_CANDIDATE, registry);
    expect(r.status).toBe("ok");
    expect(r.qualifies_for).toBe("beta");
    expect(r.missing_components).toHaveLength(0);
    expect(r.invalid_edges).toHaveLength(0);
  });
});

describe("validate_playbook_candidate — structural failures", () => {
  it("flags unknown components and invalid edges", () => {
    const yaml = FULL_CANDIDATE.replace("state_store]", "ghost_component]").replace(
      "edges: [data_scraper__produces__data_normalizer, data_normalizer__produces__deduplication]",
      "edges: [no_such_edge]",
    );
    const r = validatePlaybookCandidate(yaml, registry);
    expect(r.missing_components).toContain("ghost_component");
    expect(r.invalid_edges).toContain("no_such_edge");
    expect(r.qualifies_for).toBe("draft"); // refs broken ⇒ cannot be candidate
    expect(dod(r, 6)!.ok).toBe(false);
    expect(dod(r, 7)!.ok).toBe(false);
  });

  it("too few evals/failure modes blocks beta but can still be a candidate", () => {
    const yaml = FULL_CANDIDATE.replace("evals: [a, b, c, d, e]", "evals: [a]").replace(
      "failure_modes: [a, b, c, d, e]",
      "failure_modes: [a]",
    );
    const r = validatePlaybookCandidate(yaml, registry);
    expect(r.qualifies_for).toBe("candidate"); // refs ok, but not beta
    expect(dod(r, 2)!.ok).toBe(false);
    expect(dod(r, 3)!.ok).toBe(false);
    expect(r.blocking.length).toBeGreaterThan(0);
  });

  it("a gated external write without an approval policy fails DoD #8", () => {
    const yaml = `id: risky
version: "0.1.0"
status: draft
title: Risky
summary: A candidate that writes to a CRM with no approval policy.
workflow_type: crm
golden_path_route_id: ""
components: [email_read, intent_classifier, crm_note_write, audit_log, state_store]
edges: []
stack_id: default_orchestratekit_stack
risk_level: high
deterministic_steps: [audit_log]
failure_modes: [a, b, c, d, e]
evals: [a, b, c, d, e]
sources:
  - title: t
    source_type: internal_note
`;
    const r = validatePlaybookCandidate(yaml, registry);
    expect(dod(r, 8)!.ok).toBe(false);
    expect(r.qualifies_for).toBe("draft"); // #8 blocks candidate
  });

  it("a no-write pipeline needs no approval policy (DoD #8 passes on risk alone)", () => {
    const r = validatePlaybookCandidate(FULL_CANDIDATE, registry);
    expect(dod(r, 8)!.ok).toBe(true);
  });
});

describe("validate_playbook_candidate — parse / schema errors", () => {
  it("returns invalid_yaml for non-YAML", () => {
    const r = validatePlaybookCandidate("::: not : yaml : [", registry);
    expect(r.status).toBe("invalid_yaml");
    expect(r.qualifies_for).toBeNull();
  });

  it("returns schema_invalid for a missing required field", () => {
    const r = validatePlaybookCandidate("id: x\nsummary: y\n", registry);
    expect(r.status).toBe("schema_invalid");
    expect(r.playbook_id).toBeNull();
  });
});
