/**
 * logging-flow/index.ts
 *
 * Flow 3: Log Response
 *
 * Triggered when you react with ✅ to a scored message in
 * #community-engagement — meaning you've posted your reply on Reddit
 * and want to log the engagement in Notion.
 *
 * The happy path:
 *
 *   Slack reaction_added event (✅)
 *     → validate: right emoji + right channel
 *     → fetch the original Slack message
 *     → extract refract_metadata (scores, post URL, platform, etc.)
 *     → create a row in the Notion engagement log database
 *     → post a confirmation reply in the Slack thread
 *
 * Config variables:
 *   NOTION_TOKEN       - Notion integration token (starts with secret_)
 *   NOTION_DATABASE_ID - ID of the Notion database to log into
 *   SLACK_BOT_TOKEN    - Same bot token used in Flows 1 and 2
 *   SLACK_CHANNEL      - Channel ID for #community-engagement
 */

import { fetchMessage, postThreadReply } from "../shared/slack-client.js";
import { createNotionEntry, derivePrismaticRelevance } from "../shared/notion-client.js";
import type { SlackBlock } from "../scoring-flow/slack-formatter.js";
import type { RefractMetadata } from "../scoring-flow/slack-formatter.js";
import type { SlackReactionEvent } from "../drafting-flow/index.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface LoggingFlowConfig {
  notionToken:      string;
  notionDatabaseId: string;
  slackBotToken:    string;
  slackChannel:     string;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Run the logging flow for a Slack ✅ reaction_added event.
 *
 * Does not throw — errors are caught and posted as thread replies
 * so failures are visible in Slack without needing to check logs.
 */
export async function runLoggingFlow(
  event: SlackReactionEvent,
  config: LoggingFlowConfig
): Promise<void> {
  // Step 1 — Validate the event
  const reactionEvent = event.event;
  if (!reactionEvent || reactionEvent.type !== "reaction_added") return;
  if (reactionEvent.reaction !== "white_check_mark") return;
  if (!reactionEvent.item || reactionEvent.item.channel !== config.slackChannel) return;

  const messageTs = reactionEvent.item.ts;
  console.log(`[logging-flow] ✅ reaction on message ts=${messageTs} — logging engagement.`);

  // Step 2 — Fetch the original scored message from Slack
  let blocks: SlackBlock[];
  try {
    blocks = await fetchMessage(config.slackBotToken, config.slackChannel, messageTs);
  } catch (err) {
    console.error("[logging-flow] Could not fetch original message:", err);
    await postThreadReply(
      config.slackBotToken, config.slackChannel, messageTs,
      "⚠️ Refract: Could not fetch the original message to log from."
    );
    return;
  }

  // Step 3 — Extract refract_metadata
  const metadata = extractMetadata(blocks);
  if (!metadata) {
    console.error("[logging-flow] refract_metadata block not found in message.");
    await postThreadReply(
      config.slackBotToken, config.slackChannel, messageTs,
      "⚠️ Refract: Could not find metadata in this message. Was it created by Refract?"
    );
    return;
  }

  // Step 4 — Log to Notion
  try {
    await createNotionEntry(config.notionToken, config.notionDatabaseId, {
      postTitle:          metadata.post_title,
      postUrl:            metadata.post_url,
      platform:           metadata.platform,
      platformSub:        metadata.platform_sub,
      score:              metadata.combined_score,
      prismaticRelevance: derivePrismaticRelevance(metadata.engagement_type, metadata.prismatic_opportunity),
      respondedAt:        new Date().toISOString(),
    });
  } catch (err) {
    console.error("[logging-flow] Failed to create Notion entry:", err);
    await postThreadReply(
      config.slackBotToken, config.slackChannel, messageTs,
      `⚠️ Refract: Failed to log to Notion — ${err instanceof Error ? err.message : String(err)}`
    );
    return;
  }

  // Step 5 — Confirm in Slack thread
  await postThreadReply(
    config.slackBotToken, config.slackChannel, messageTs,
    `Logged to Notion`,
    [{
      type: "context",
      elements: [{
        type: "mrkdwn",
        text: `✅ *Logged to Notion* — "${metadata.post_title}" (score: ${metadata.combined_score})`,
      }],
    }]
  );

  console.log(`[logging-flow] Logged to Notion: "${metadata.post_title}"`);
}

// ---------------------------------------------------------------------------
// Metadata extraction (same pattern as drafting-flow/index.ts)
// ---------------------------------------------------------------------------

function extractMetadata(blocks: SlackBlock[]): RefractMetadata | null {
  const metaBlock = blocks.find((b) => b.block_id === "refract_metadata");
  if (!metaBlock) return null;

  const elements = metaBlock.elements as Array<Record<string, unknown>> | undefined;
  const text = elements?.[0]?.text as string | undefined;
  if (!text) return null;

  try {
    return JSON.parse(text.trim()) as RefractMetadata;
  } catch {
    console.error("[logging-flow] Failed to parse refract_metadata JSON:", text.slice(0, 100));
    return null;
  }
}
