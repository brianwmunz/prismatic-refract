/**
 * claude-scorer.ts
 *
 * The scoring layer of Flow 1. Takes a parsed SyftenMention, sends it to
 * Claude with our scoring prompt, and returns a typed ScoringResult.
 *
 * This file sits in the middle of the dependency stack:
 *
 *   parse-syften.ts  →  claude-scorer.ts  →  slack-formatter.ts
 *                              ↓
 *                    shared/claude-client.ts  (raw API calls)
 *                    scoring-flow/prompts.ts  (all prompt text)
 *
 * Keeping this layer thin means you can swap the underlying LLM or the
 * prompt without touching anything else in the flow.
 */

import Anthropic from "@anthropic-ai/sdk";
import { callClaudeForScore } from "../shared/claude-client.js";
import type { SyftenMention, ScoringResult, ScoredMention } from "../shared/types.js";
import { SCORING_SYSTEM_PROMPT, SCORING_MODEL, buildScoringMessage } from "./prompts.js";

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Score a single mention using Claude.
 *
 * Returns a ScoredMention — the original mention bundled with its scoring
 * result — so the next step (Slack formatting) has everything it needs
 * in one object without having to re-fetch anything.
 *
 * @param client  - Anthropic client created by createClaudeClient()
 * @param mention - A validated SyftenMention from parseSyftenPayload()
 */
export async function scoreMention(
  client: Anthropic,
  mention: SyftenMention
): Promise<ScoredMention> {
  const userMessage = buildScoringMessage(mention);

  let scoring: ScoringResult;
  try {
    scoring = await callClaudeForScore(client, SCORING_SYSTEM_PROMPT, userMessage, SCORING_MODEL);
  } catch (err) {
    // Re-throw with enough context to debug from a Slack alert or log
    throw enrichError(err, mention);
  }

  return { mention, scoring };
}

/**
 * Score all mentions in a batch, settling each independently.
 *
 * Uses Promise.allSettled so one failed API call doesn't prevent the
 * rest of the batch from being processed. Failed items are logged and
 * skipped rather than crashing the flow.
 *
 * This is the function to call when Syften sends multiple mentions in
 * a single webhook payload.
 *
 * @param client   - Anthropic client
 * @param mentions - Array from parseSyftenPayload()
 */
export async function scoreMentions(
  client: Anthropic,
  mentions: SyftenMention[]
): Promise<ScoredMention[]> {
  const results = await Promise.allSettled(
    mentions.map((mention) => scoreMention(client, mention))
  );

  const scored: ScoredMention[] = [];

  for (const result of results) {
    if (result.status === "fulfilled") {
      scored.push(result.value);
    } else {
      // Log and continue — a failed score is not worth stopping the whole batch
      console.error("[claude-scorer] Failed to score mention:", result.reason);
    }
  }

  return scored;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Attach mention context to an error so it's useful when it surfaces
 * in Slack or a log aggregator.
 */
function enrichError(err: unknown, mention: SyftenMention): Error {
  const base = err instanceof Error ? err : new Error(String(err));
  base.message = `[claude-scorer] Scoring failed for "${mention.title}" (${mention.item_url}): ${base.message}`;
  return base;
}
