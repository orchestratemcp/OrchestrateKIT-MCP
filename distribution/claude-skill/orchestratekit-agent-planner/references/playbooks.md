# Published Playbooks

This is the portable offline catalogue for the OrchestrateKit Agent Planner Skill. Prefer live OrchestrateMCP `plan_workflow`, `get_playbook`, and playbook resources when connected.

## codebase_agent_workflow

- Title: Codebase Agent Workflow
- Workflow: coding-agent
- Risk: medium
- Use for: feature implementation from a well-scoped issue description; bug fix with regression test
- Summary: Blueprint for an AI coding agent that scans a codebase, plans targeted edits, runs tests, and prepares a PR summary.
- Safety notes: feature branch first; no production or main-branch write access; require PR review before merge.

## competitor_price_monitor

- Title: Competitor Price Monitor with Threshold Alerts
- Workflow: monitoring
- Risk: low
- Use for: recurring competitor page checks; read-only price-change monitoring with internal Slack alerts
- Summary: Unattended price-watch pattern that polls known pages, detects changes, deduplicates repeat events, validates prices, and posts an internal alert.
- Safety notes: read-only external browsing; polite polling; notification-only egress.

## content_approval_pipeline

- Title: Content Approval Pipeline
- Workflow: content-approval
- Risk: high
- Use for: social post generation; blog or campaign drafts for editor review
- Summary: AI-assisted content creation with schema validation, explicit human approval, and audited external publishing.
- Safety notes: never publish without human approval; validate schema before publish; audit synchronously.

## data_extraction_enrichment

- Title: Data Extraction and Enrichment
- Workflow: data-pipeline
- Risk: medium
- Use for: job listing aggregation; product or content data extraction with validation
- Summary: Scrape, normalize, deduplicate, and validate structured data without autonomous downstream publishing.
- Safety notes: validate before downstream use; respect rate limits; avoid semantic storage unless retrieval requires it.

## dynamic_worker_loop

- Title: Dynamic Worker Loop (bounded, reviewer-independent)
- Workflow: agentic-loop
- Risk: high
- Use for: iterative build/refine tasks; quality loops with independent review
- Summary: Bounded planner, coder, tester, and independent reviewer loop with state checkpoints, audit logs, and final human approval.
- Safety notes: hard iteration cap; independent reviewer; no external write, deploy, send, or publish before final gate.

## email_calendar_assistant

- Title: Email and Calendar Assistant
- Workflow: email-calendar
- Risk: high
- Use for: scheduling assistant drafts; inbox triage with suggested replies
- Summary: Reads email, classifies intent, drafts replies, and optionally schedules or sends only after approval.
- Safety notes: no email send or calendar write without approval; show full draft and recipient list; do not bundle approvals.

## email_lead_to_crm

- Title: Email Lead to CRM with Follow-up
- Workflow: crm-sales
- Risk: high
- Use for: inbound sales email qualification; company research before CRM note and outreach draft
- Summary: Identifies company leads, writes CRM notes, and drafts personalized follow-ups behind approval.
- Safety notes: no CRM write or email send without approval; compensate failed paired actions; validate before research spend.

## invoice_intake_po_match

- Title: Invoice Intake with PO Match and Mandatory Human Gate
- Workflow: data-etl
- Risk: high
- Use for: accounts-payable invoice intake; document-from-email ingest against a system of record
- Summary: Extracts invoice PDFs, normalizes totals and line items, matches POs, and holds every invoice behind a human gate.
- Safety notes: approval is mandatory even on clean matches; withhold ledger-write credentials; reject low-confidence extraction.

## morning_email_triage

- Title: Morning Email Triage (Draft-Only, Never Auto-Send)
- Workflow: email-triage
- Risk: medium
- Use for: scheduled inbox sorting; draft-only reply preparation
- Summary: Classifies inbox messages and saves reply drafts behind a human review path with a hard no-send guarantee.
- Safety notes: withhold send scope; approval means save-as-draft; treat email bodies as untrusted input.

## pr_review_readonly

- Title: Read-Only PR Review with Hard No-Write Guarantee
- Workflow: code-review
- Risk: low
- Use for: automatic first-pass PR review; read-only diff analysis with reviewer summary
- Summary: Webhook-triggered PR reviewer that scans a diff and posts findings without editing, approving, pushing, or merging.
- Safety notes: read-only repo scopes plus comment permission; validate webhook payload; treat diff content as untrusted.

## research_agent_citations

- Title: Research Agent with Citations
- Workflow: research
- Risk: medium
- Use for: competitive analysis; technical documentation summarization
- Summary: Research workflow that retrieves, ranks, synthesizes, checks freshness, and verifies citations.
- Safety notes: do not present as authoritative for legal, medical, or financial decisions; include freshness metadata; verify citations.

## scheduled_data_report

- Title: Scheduled Data Report to Slack (Unattended)
- Workflow: data-etl
- Risk: low
- Use for: recurring internal metrics reports; dashboards-as-a-message to Slack
- Summary: Scheduled read-only reporting from a data source, validation, rendering, and internal Slack notification.
- Safety notes: read-only data scopes; validate result sets; reject schema drift instead of coercing.
