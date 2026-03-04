/**
 * scoring-flow/index.ts
 *
 * Flow 1: Scoring Flow
 *
 * This is the orchestrator — it wires together the four focused modules
 * built in previous steps and defines what happens end-to-end when
 * Syften fires a webhook.
 *
 * The happy path is intentionally easy to read at a glance:
 *
 *   webhook body
 *     → parse mentions          (parse-syften.ts)
 *     → score each with Claude  (claude-scorer.ts)
 *     → format for Slack        (slack-formatter.ts)
 *     → post to #community-engagement
 *
 * In Prismatic, this function becomes the body of a custom component
 * action (or a code-native flow step). The trigger — an HTTP webhook
 * endpoint — is configured in Prismatic's UI and points at this logic.
 *
 * Config variables (stored encrypted in Prismatic):
 *   ANTHROPIC_API_KEY  — Anthropic API key
 *   SLACK_BOT_TOKEN    — Slack bot OAuth token (xoxb-...)
 *   SLACK_CHANNEL      — Channel to post scored mentions into
 */

import { parseSyftenPayload, describeMention } from "./parse-syften.js";
import { scoreMentions } from "./claude-scorer.js";
import { formatScoredMention } from "./slack-formatter.js";
import { createClaudeClient } from "../shared/claude-client.js";
import { postMessage } from "../shared/slack-client.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface ScoringFlowConfig {
  anthropicApiKey: string;
  slackBotToken: string;
  slackChannel: string;
  /**
   * Mentions with a combined_score below this value are silently dropped
   * and never posted to Slack. Keeps the channel signal-to-noise high.
   *
   * Default: 5. Tune upward if too much noise gets through, downward
   * if you feel like you're missing things worth seeing.
   */
  minScore?: number;
  /**
   * Reddit username to exclude (without the u/ prefix).
   * Any mention authored by this account is skipped before scoring —
   * prevents your own posts and comments from burning Claude API calls.
   */
  redditUsername?: string;
}

// Fallback used when minScore is not provided in config
const DEFAULT_MIN_SCORE = 5;

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Run the full scoring flow for one webhook delivery from Syften.
 *
 * Designed to be called from:
 *   - A Prismatic custom component action (pass config from config variables)
 *   - A local test script (pass config from environment variables)
 *   - Any HTTP framework handler (Express, Hono, etc.)
 *
 * Does not throw — errors are caught, logged, and reported to Slack so
 * nothing fails silently in production.
 *
 * @param webhookBody - Raw request body (string or pre-parsed object)
 * @param config      - Secrets and channel name, injected by the caller
 */
export async function runScoringFlow(
  webhookBody: unknown,
  config: ScoringFlowConfig
): Promise<void> {
  // Step 1 — Parse
  // Convert the raw webhook payload into typed SyftenMention objects.
  // If parsing fails entirely (malformed JSON, wrong shape), we catch it
  // below and post an alert to Slack.
  let mentions;
  try {
    mentions = parseSyftenPayload(webhookBody);
  } catch (err) {
    await postErrorToSlack(config, "Failed to parse Syften webhook payload", err);
    return;
  }

  if (mentions.length === 0) {
    console.log("[scoring-flow] Webhook received but no valid mentions found — skipping.");
    return;
  }

  console.log(`[scoring-flow] Received ${mentions.length} mention(s) to score.`);

  // Step 1b — Filter own account
  // Skip mentions authored by the configured Reddit username so your own
  // posts and comments don't get scored or posted to Slack.
  if (config.redditUsername) {
    const own = config.redditUsername.toLowerCase();
    const before = mentions.length;
    mentions = mentions.filter((m) => m.author.toLowerCase() !== own);
    const skipped = before - mentions.length;
    if (skipped > 0) {
      console.log(`[scoring-flow] Skipped ${skipped} mention(s) from own account (${config.redditUsername}).`);
    }
    if (mentions.length === 0) {
      console.log("[scoring-flow] All mentions were from own account — nothing to score.");
      return;
    }
  }

  // Step 2 — Score
  // Call Claude for each mention. scoreMentions() uses Promise.allSettled
  // internally, so individual failures are logged but don't block others.
  const client = createClaudeClient(config.anthropicApiKey);
  const scored = await scoreMentions(client, mentions);

  if (scored.length === 0) {
    await postErrorToSlack(config, "Scoring failed for all mentions in this batch", null);
    return;
  }

  console.log(`[scoring-flow] Scored ${scored.length}/${mentions.length} mention(s) successfully.`);

  // Step 3 — Filter
  // Drop anything below the minimum score threshold before it ever reaches
  // Slack. The goal is a low-noise channel — if it's not worth your attention,
  // it shouldn't take up space.
  const minScore = config.minScore ?? DEFAULT_MIN_SCORE;
  const worthy = scored.filter((item) => item.scoring.combined_score >= minScore);
  const dropped = scored.length - worthy.length;

  if (dropped > 0) {
    console.log(`[scoring-flow] Filtered out ${dropped} mention(s) scoring below ${minScore}.`);
  }
  if (worthy.length === 0) {
    console.log("[scoring-flow] No mentions above threshold — nothing to post.");
    return;
  }

  // Step 4 — Format and post to Slack
  // Process each mention in sequence (not parallel) to avoid flooding the
  // channel if Syften sends a burst at once.
  for (const item of worthy) {
    try {
      const message = formatScoredMention(item, config.slackChannel);
      const ts = await postMessage(config.slackBotToken, message);
      console.log(`[scoring-flow] Posted to Slack: ${describeMention(item.mention)} (ts: ${ts})`);
    } catch (err) {
      // A Slack failure for one mention shouldn't stop the others
      console.error(
        `[scoring-flow] Failed to post to Slack for: ${describeMention(item.mention)}`,
        err
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Error reporting
// ---------------------------------------------------------------------------

/**
 * Post a plain-text error alert to the Slack channel.
 *
 * Keeps the error visible in the same channel where normal output goes,
 * so you don't need to check a separate log viewer for basic issues.
 * For production, you'd want to also write to a proper logging service.
 */
async function postErrorToSlack(
  config: ScoringFlowConfig,
  message: string,
  err: unknown
): Promise<void> {
  const detail = err instanceof Error ? err.message : String(err ?? "no detail");
  console.error(`[scoring-flow] ERROR — ${message}: ${detail}`);

  try {
    await postMessage(config.slackBotToken, {
      channel: config.slackChannel,
      text:    `⚠️ Refract scoring error: ${message}`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `⚠️ *Refract scoring error*\n*${message}*\n\`\`\`${detail}\`\`\``,
          },
        },
      ],
    });
  } catch (slackErr) {
    // If even the error message fails to post, just log it — nothing more we can do
    console.error("[scoring-flow] Could not post error to Slack:", slackErr);
  }
}
