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
 * exercised (MAR-386) —
 *   • golden_email_calendar → answer_clarifying_questions → dry run → prepare_runtime (medium, durable)
 *   • competitor_price_monitor → dry run → prepare_runtime (medium, durable, no questions)
 *   • one_shot_inbox_summary → dry run → attended_dry_run terminal (small — the run IS the deliverable)
 *   • readonly_attended_inbox_summary → explicit no-write/no-durable regression (small)
 *   • gmail_lead_to_crm → dry run → build_brief (medium, attended runtime)
 *   • multi_agent_coder_loop → generate_linear_project → linear_issues (large — plan it)
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
    notes:
      "No clarifying questions; scheduled + offline-required, so the mechanical client " +
      "goes straight to the prepare_runtime terminal.",
  },
  {
    name: "one_shot_inbox_summary",
    goal: "summarize my inbox for me now",
    canned_answers: {},
    notes:
      "Genuinely one-shot / small scope (nothing must outlive the session), so the ⭐ is " +
      "the attended dry run itself (terminal), and it carries NO walking-skeleton nag.",
  },
  {
    name: "readonly_attended_inbox_summary",
    goal:
      "Read my unread inbox now and give me a concise five-bullet summary in this chat. " +
      "This is read-only and attended: do not send, delete, archive, label, or modify any email; " +
      "do not create a scheduled or persistent agent.",
    canned_answers: {},
    notes:
      "Explicit read-only/attended boundary: negated scheduled and persistent terms must not " +
      "create durable components or redundant build/hosting questions.",
  },
  {
    name: "gmail_lead_to_crm",
    goal:
      "Build an agent that reads new leads from Gmail, drafts a reply, updates the CRM, " +
      "and alerts sales in Slack after approval.",
    canned_answers: {},
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
    notes:
      "Large scope (multi-agent loop), so the ⭐ is generating the plan as Linear issues — " +
      "the plan-it path, not a single build prompt.",
  },
];
