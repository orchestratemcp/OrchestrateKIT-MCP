/**
 * MAR-387 — golden-journey fixtures.
 *
 * A small set of golden goals the mechanical client walks. Each fixture pins a
 * goal, the canned clarifying answers the client folds in when asked (keyed by
 * `ClarifyingQuestion["id"]`), and a note on what journey shape it exercises.
 * Kept separate from the suite so a later OpenRouter real-LLM variant can drive
 * the identical fixtures and diff an LLM's choices against the mechanical golden.
 *
 * Coverage across the set is deliberate: the three terminal/branch shapes the
 * CURRENT `recommended_next_click` can produce are all exercised —
 *   • golden_email_calendar → answer_clarifying_questions → prepare_runtime
 *   • competitor_price_monitor → prepare_runtime (no questions)
 *   • one_shot_inbox_summary → build_brief (genuinely one-shot, not durable)
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
      "Genuinely one-shot (nothing must outlive the session), so the recommended click " +
      "is build_brief and the attended dry run carries NO walking-skeleton nag.",
  },
];
