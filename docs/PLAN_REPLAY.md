# Plan Replay

Plan Replay is the local verifier for a Plan Passport. It compares the planned route and safety gates from `export_build_brief({ delivery_mode: "plan_passport" })` against a caller-supplied event log or checklist.

It is deterministic and stateless:

- no runtime execution
- no hosted replay service
- no writes to LAB, Linear, or the registry
- no LLM calls

## Tool

Use `replay_plan_passport` with either:

- `plan_passport`: the structured passport object
- `build_brief.plan_passport`: an `export_build_brief` result wrapper

Pass local evidence in `observed_run`:

```json
{
  "steps": ["email_read", "email_draft", "human_approval_gate", "optional_email_send"],
  "events": [
    { "type": "approval", "component_id": "human_approval_gate", "approved": true },
    { "type": "send", "component_id": "optional_email_send" }
  ],
  "checklist": [
    { "id": "external-write-before-approval-forbidden", "status": "pass" }
  ],
  "actual": { "build_target": "code" }
}
```

The result includes:

- `status`: `pass`, `warning`, or `fail`
- `drift_chips`: route drift, approval failures, forbidden actions, target mismatch, or failed checklist items
- `missing_evidence`: route steps, approval gates, telemetry, build target, or acceptance tests that lack evidence
- `lab_evidence`: a local object LAB can store as replay evidence
- `corpus_contract_candidate`: present only on failure and human-gated
- `linear_issue_candidate`: present only on failure and human-gated

Missing evidence is reported separately from confirmed failure. A replay can pass only when every planned route step, required gate, acceptance test, and build target has matching evidence.
