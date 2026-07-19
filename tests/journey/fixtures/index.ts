/**
 * MAR-387 — golden-journey fixtures.
 *
 * A small set of golden goals the mechanical client walks. Each fixture pins a
 * goal, the canned clarifying answers the client folds in when asked (keyed by
 * `ClarifyingQuestion["id"]`), and a note on what journey shape it exercises.
 * Kept separate from the suite so a later OpenRouter real-LLM variant can drive
 * the identical fixtures and diff an LLM's choices against the mechanical golden.
 *
 * Coverage across the set is deliberate: every scope-aware ⭐ terminal shape is
 * exercised (MAR-386, updated by MAR-395) —
 *   • golden_email_calendar → answer_clarifying_questions → dry run → prepare_runtime (medium, durable)
 *   • competitor_price_monitor → dry run → prepare_runtime (medium, durable, no questions)
 *   • one_shot_inbox_summary → build_in_assistant → assistant_surface terminal (small)
 *   • readonly_attended_inbox_summary → build_in_assistant → assistant_surface (small, explicit no-write/no-durable regression)
 *   • gmail_lead_to_crm → dry run → build_brief (medium, attended runtime)
 *   • multi_agent_coder_loop → generate_linear_project → linear_issues (large — plan it)
 *
 * MAR-395: the two SMALL fixtures used to terminate on `attended_dry_run`. A
 * small, attended goal is now recommended INTO a no-code assistant surface it
 * can actually live in; the in-chat dry run stays in the menu as a preview.
 *
 * MAR-392 also locks six semantic goal shapes across the matrix: read-only,
 * fully unattended, explicitly allowed outbound sends, multiple clarifying
 * questions, validated playbooks, and a deliberately vague starting goal.
 */
import type { JourneyFixture } from "../../../src/journey/mechanicalClient.js";

export const JOURNEY_FIXTURES: JourneyFixture[] = [
  {
    name: "golden_email_calendar",
    // The P0-02 golden prompt (RESPONSE-UX / MAR-385). Durable + build intent, and
    // the one goal that raises exactly one material question (calendar_notification).
    goal:
      "Build an email and calendar assistant that reads unread Gmail meeting requests, " +
      "checks my real Google Calendar, drafts a reply with two available 30-minute slots, " +
      "and only after I approve creates one Calendar event and one Gmail draft. Never send " +
      "the email. I will be present for approval and I want visible run logs.",
    canned_answers: {
      // Recommended option is private_hold; the phrase "private hold" is a stated
      // signal that clears the question so the next plan converges.
      calendar_notification:
        "Keep the calendar entry as a private hold on my calendar and do not notify the other person.",
    },
    coverage_tags: [],
    expectations: {
      initial: {
        recommended_next_click_id: "answer_clarifying_questions",
        clarifying_questions: [
          {
            id: "calendar_notification",
            question_includes: ["private hold", "real invitation", "Google may email"],
            options: [
              "A private hold on my calendar — the other person is NOT notified (sendUpdates=none)",
              "A real invitation the other person receives — Google may email them on my behalf",
            ],
          },
        ],
      },
      resolved: {
        recommended_next_click_id: "dry_run_in_chat",
        clarifying_questions: [],
        route_includes: ["email_read", "calendar_write", "human_approval_gate"],
        route_excludes: ["email_send", "optional_email_send"],
        enforced_approval_gates: ["human_approval_gate"],
      },
    },
    notes:
      "Exercises the clarifying-answer fold loop, then reaches the prepare_runtime " +
      "terminal (offline-required) with the walking-skeleton disclosure present.",
  },
  {
    name: "competitor_price_monitor",
    goal:
      "Build an agent that checks 5 competitor pages every morning, detects price changes, " +
      "and sends me a Slack summary. I want to approve before anything external is changed.",
    canned_answers: {},
    coverage_tags: ["validated_playbook"],
    expectations: {
      initial: {
        plan_source: "playbook",
        playbook_id: "competitor_price_monitor",
        route_includes: ["scheduled_trigger", "page_monitor", "slack_notification", "audit_log"],
        enforced_approval_gates: [],
        automation_clearance_level: "L2",
        clarifying_questions: [],
      },
    },
    notes:
      "No clarifying questions; scheduled + offline-required, so the mechanical client " +
      "goes straight to the prepare_runtime terminal.",
  },
  {
    name: "one_shot_inbox_summary",
    goal: "summarize my inbox for me now",
    canned_answers: {},
    coverage_tags: [],
    expectations: {
      initial: {
        recommended_next_click_id: "build_in_assistant",
      },
    },
    notes:
      "Genuinely one-shot / small scope (nothing must outlive the session). MAR-395: the ⭐ " +
      "is a no-code assistant surface the goal can actually live in, not the in-chat dry run; " +
      "the dry run stays offered as a preview and carries NO walking-skeleton nag.",
  },
  {
    name: "readonly_attended_inbox_summary",
    goal:
      "Read my unread inbox now and give me a concise five-bullet summary in this chat. " +
      "This is read-only and attended: do not send, delete, archive, label, or modify any email; " +
      "do not create a scheduled or persistent agent.",
    canned_answers: {},
    coverage_tags: ["read_only"],
    expectations: {
      initial: {
        plan_source: "composed",
        route_includes: ["email_read"],
        route_excludes: [
          "email_draft",
          "email_send",
          "optional_email_send",
          "human_approval_gate",
          "scheduled_trigger",
          "state_store",
        ],
        enforced_approval_gates: [],
        automation_clearance_level: "L0",
        clarifying_questions: [],
        // MAR-395: small + attended + read-only → a no-code assistant surface.
        recommended_next_click_id: "build_in_assistant",
      },
    },
    seeded_attended_execution: {
      kind: "inbox_summary",
      expected_bullet_count: 5,
      messages: [
        {
          id: "seed-ops-417",
          from: "release@example.test",
          subject: "OPS-417 release review moved",
          body: "The release review moved to Tuesday at 14:00 UTC. No response is requested.",
          unread: true,
          required_anchor: "OPS-417",
        },
        {
          id: "seed-inv-204",
          from: "billing@example.test",
          subject: "Invoice INV-204 due Friday",
          body: "Invoice INV-204 is due Friday and is awaiting internal review.",
          unread: true,
          required_anchor: "INV-204",
        },
        {
          id: "seed-sec-881",
          from: "security@example.test",
          subject: "SEC-881 blocked login",
          body: "Security blocked a new login under alert SEC-881. No account change is required.",
          unread: true,
          required_anchor: "SEC-881",
        },
        {
          id: "seed-dr-52",
          from: "design@example.test",
          subject: "DR-52 feedback requested",
          body: "Feedback on design review DR-52 is requested by Wednesday.",
          unread: true,
          required_anchor: "DR-52",
        },
        {
          id: "seed-lunch-19",
          from: "events@example.test",
          subject: "LUNCH-19 order confirmed",
          body: "The LUNCH-19 team order is confirmed for lobby delivery at 12:30.",
          unread: true,
          required_anchor: "LUNCH-19",
        },
      ],
    },
    notes:
      "Explicit read-only/attended boundary: negated scheduled and persistent terms must not " +
      "create durable components or redundant build/hosting questions. Carries a five-message " +
      "synthetic inbox for an opt-in, integration-free execution check in the Lab.",
  },
  {
    name: "fully_unattended_price_monitor",
    goal:
      "Check 5 competitor product pages every hour; detect price changes; send an internal " +
      "Slack alert with a one-line summary when price drops below a configurable threshold; " +
      "fully unattended scheduled run with no human in the loop; read-only on all external " +
      "sites; deduplicate alerts.",
    canned_answers: {},
    coverage_tags: ["fully_unattended", "validated_playbook"],
    expectations: {
      initial: {
        plan_source: "playbook",
        playbook_id: "competitor_price_monitor",
        recommended_next_click_id: "dry_run_in_chat",
        route_includes: [
          "scheduled_trigger",
          "page_monitor",
          "deduplication",
          "state_store",
          "slack_notification",
          "audit_log",
        ],
        route_excludes: ["human_approval_gate"],
        enforced_approval_gates: [],
        automation_clearance_level: "L2",
        clarifying_questions: [],
      },
    },
    notes:
      "Fully unattended, no-human shape: the validated price-monitor route stays read-only " +
      "on monitored sites, carries deduplication/state, and must not claim a gate it does not contain.",
  },
  {
    name: "outbound_send_allowed",
    goal:
      "Read new support emails, classify urgency, and send an acknowledgement email automatically. " +
      "Outbound email sends are explicitly allowed, but never delete or modify incoming mail. " +
      "Run when I manually start it and show me the result.",
    canned_answers: {},
    coverage_tags: ["outbound_send_allowed"],
    expectations: {
      initial: {
        plan_source: "composed",
        recommended_next_click_id: "dry_run_in_chat",
        route_includes: [
          "email_read",
          "intent_classifier",
          "email_draft",
          "human_approval_gate",
          "optional_email_send",
        ],
        enforced_approval_gates: ["human_approval_gate"],
        automation_clearance_level: "L3",
        clarifying_questions: [],
      },
    },
    notes:
      "Explicitly permits outbound email, proving the planner retains the send path while " +
      "keeping the external write behind an enforced approval gate.",
  },
  {
    name: "vague_email_assistant",
    goal: "Build an email assistant.",
    canned_answers: {
      write_permission: "It may write or update only after my approval.",
      build_surface: "Build it inside ChatGPT.",
      hosting_monitoring: "Run it inside ChatGPT and I will check it manually.",
    },
    coverage_tags: ["multiple_clarifying_questions", "deliberately_vague"],
    expectations: {
      initial: {
        plan_source: "composed",
        recommended_next_click_id: "answer_clarifying_questions",
        clarifying_questions: [
          {
            id: "write_permission",
            question_includes: ["make changes", "read-and-report only"],
            options: [
              "Read & report only",
              "Write/update — with my approval",
              "Write/update automatically",
              "Not sure yet",
            ],
          },
          {
            id: "build_surface",
            question_includes: ["Where do you want to build", "scope is locked"],
            options: [
              "Codex",
              "Cursor / Claude Code",
              "Portable agent handoff prompt",
              "Not sure yet",
            ],
          },
          {
            id: "hosting_monitoring",
            question_includes: ["Where should it run", "monitor runs and approvals"],
            options: [
              "Local/cron + logs",
              "Hosted endpoint/job + logs",
              "Inside the client + manual checks",
              "Not sure yet",
            ],
          },
        ],
      },
      resolved: {
        plan_source: "composed",
        recommended_next_click_id: "dry_run_in_chat",
        route_includes: ["email_read", "email_draft", "human_approval_gate", "optional_email_send"],
        enforced_approval_gates: ["human_approval_gate"],
        automation_clearance_level: "L3",
        clarifying_questions: [],
      },
    },
    notes:
      "Deliberately vague goal: pins three material questions and their alternatives, then " +
      "proves the recommended answers converge to a terminal plan without freelancing.",
  },
  {
    name: "validated_content_pipeline",
    goal:
      "Start from a content brief, generate copy and visuals, send them to a reviewer for " +
      "approval, then publish externally only after approval.",
    canned_answers: {},
    coverage_tags: ["validated_playbook"],
    expectations: {
      initial: {
        plan_source: "playbook",
        playbook_id: "content_approval_pipeline",
        recommended_next_click_id: "dry_run_in_chat",
        route_includes: [
          "content_idea_intake",
          "copy_generation",
          "design_brief_generation",
          "human_approval_gate",
          "external_publish",
          "audit_log",
        ],
        enforced_approval_gates: ["human_approval_gate"],
        automation_clearance_level: "L4",
        clarifying_questions: [],
      },
    },
    notes:
      "Explicit validated-playbook shape: content generation and external publishing remain " +
      "ordered behind the non-droppable approval gate.",
  },
  {
    name: "gmail_lead_to_crm",
    goal:
      "Build an agent that reads new leads from Gmail, drafts a reply, updates the CRM, " +
      "and alerts sales in Slack after approval.",
    canned_answers: {},
    coverage_tags: ["validated_playbook"],
    expectations: {
      initial: {
        plan_source: "playbook",
        playbook_id: "email_lead_to_crm",
        route_includes: ["email_read", "crm_note_write", "human_approval_gate"],
        enforced_approval_gates: ["human_approval_gate"],
      },
    },
    notes:
      "Medium scope but attended runtime (manual trigger), so the dry run leads to the " +
      "build_brief deliverable rather than a runtime setup contract.",
  },
  {
    name: "multi_agent_coder_loop",
    goal:
      "Run a coder agent and a reviewer agent in a loop until all tests pass, maximum 5 " +
      "iterations, then open a pull request for my approval.",
    canned_answers: {},
    coverage_tags: [],
    notes:
      "Large scope (multi-agent loop), so the ⭐ is generating the plan as Linear issues — " +
      "the plan-it path, not a single build prompt.",
  },
];
