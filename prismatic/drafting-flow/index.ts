/**
 * drafting-flow/index.ts
 *
 * Flow 2: Draft Response Flow
 *
 * Triggered when you react with 👀 to a scored message in
 * #community-engagement. Fetches the original post, asks Claude to
 * draft a reply, and posts it as a threaded reply under the message
 * you reacted to.
 *
 * The happy path:
 *
 *   Slack reaction_added event (👀)
 *     → validate: right emoji + right channel
 *     → fetch the original Slack message
 *     → extract refract_metadata (post URL, scores, reasoning)
 *     → fetch full post content from Reddit/source (optional, best-effort)
 *     → call Claude to draft a reply
 *     → post draft as a thread reply in #community-engagement
 *
 * Config variables (stored encrypted in Prismatic):
 *   ANTHROPIC_API_KEY  — same key used in Flow 1
 *   SLACK_BOT_TOKEN    — same bot token used in Flow 1
 *   SLACK_CHANNEL      — channel ID for #community-engagement
 */

import { createClaudeClient } from "../shared/claude-client.js";
import { fetchMessage, postThreadReply } from "../shared/slack-client.js";
import type { SlackBlock } from "../scoring-flow/slack-formatter.js";
import type { RefractMetadata } from "../scoring-flow/slack-formatter.js";
import { fetchPostContent } from "./fetch-post.js";
import { draftReply } from "./claude-drafter.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DraftingFlowConfig {
  anthropicApiKey: string;
  slackBotToken: string;
  slackChannel: string; // Channel ID (not name) — needed to fetch messages
}

/**
 * The shape of Slack's reaction_added event payload.
 * Slack wraps it in an event_callback envelope.
 */
export interface SlackReactionEvent {
  type: string;
  event?: {
    type: string;
    reaction: string;    // Emoji name without colons, e.g. "eyes"
    item?: {
      type: string;
      channel: string;   // Channel ID where the reaction was added
      ts: string;        // Timestamp of the message that was reacted to
    };
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Run the drafting flow for a Slack reaction_added event.
 *
 * Does not throw — errors are caught and posted as thread replies
 * so failures are visible in the same channel without needing to check logs.
 *
 * @param event  - The parsed Slack event payload
 * @param config - Secrets and channel, injected by the caller
 */
export async function runDraftingFlow(
  event: SlackReactionEvent,
  config: DraftingFlowConfig
): Promise<void> {

  // Step 1 — Validate the event
  // Only act on 👀 reactions in #community-engagement.
  // Slack fires reaction_added for every emoji in every channel, so
  // this filter is essential — we ignore everything else.
  const reactionEvent = event.event;
  if (!reactionEvent || reactionEvent.type !== "reaction_added") return;
  if (reactionEvent.reaction !== "eyes") return;
  if (!reactionEvent.item || reactionEvent.item.channel !== config.slackChannel) return;

  const messageTs = reactionEvent.item.ts;
  console.log(`[drafting-flow] 👀 reaction on message ts=${messageTs} — starting draft.`);

  // Step 2 — Retrieve the original scored message from Slack
  // We need the refract_metadata block that Flow 1 embedded in the message.
  let blocks: SlackBlock[];
  try {
    blocks = await fetchMessage(config.slackBotToken, config.slackChannel, messageTs);
  } catch (err) {
    console.error("[drafting-flow] Could not fetch original message:", err);
    await postThreadReply(
      config.slackBotToken, config.slackChannel, messageTs,
      "⚠️ Refract: Could not fetch the original message to draft from."
    );
    return;
  }

  // Step 3 — Extract the refract_metadata block
  // Flow 1 stored all the context we need in a block with block_id "refract_metadata"
  const metadata = extractMetadata(blocks);
  if (!metadata) {
    console.error("[drafting-flow] refract_metadata block not found in message.");
    await postThreadReply(
      config.slackBotToken, config.slackChannel, messageTs,
      "⚠️ Refract: Could not find metadata in this message. Was it created by Refract?"
    );
    return;
  }

  console.log(`[drafting-flow] Drafting reply for: "${metadata.post_title}"`);

  // Step 4 — Fetch full post content (best-effort, non-blocking)
  // If this fails, Claude falls back to the snippet stored in metadata.
  const fullContent = await fetchPostContent(metadata.post_url, metadata.platform)
    .catch((err) => {
      console.warn("[drafting-flow] Post content fetch failed, using snippet:", err);
      return null;
    });

  if (fullContent) {
    console.log("[drafting-flow] Fetched full post content from source.");
  } else {
    console.log("[drafting-flow] Using snippet from metadata (full fetch unavailable).");
  }

  // Step 5 — Draft with Claude
  let draft;
  try {
    const client = createClaudeClient(config.anthropicApiKey);
    draft = await draftReply(client, metadata, fullContent);
  } catch (err) {
    console.error("[drafting-flow] Claude drafting failed:", err);
    await postThreadReply(
      config.slackBotToken, config.slackChannel, messageTs,
      `⚠️ Refract: Draft generation failed — ${err instanceof Error ? err.message : String(err)}`
    );
    return;
  }

  // Step 6 — Post the draft (or skip recommendation) as a thread reply
  if (draft.skip) {
    await postThreadReply(
      config.slackBotToken,
      config.slackChannel,
      messageTs,
      `Refract recommends skipping: ${metadata.post_title}`,
      [{
        type: "section",
        text: {
          type: "mrkdwn",
          text: `🚫 *Refract recommends not responding to this one.*\n${draft.skip_reason}`,
        },
      }]
    );
    console.log(`[drafting-flow] Skip recommended for ts=${messageTs}: ${draft.skip_reason}`);
    return;
  }

  const replyBlocks = buildDraftBlocks(draft.draft, draft.notes, metadata.post_url, draft.reply_target);
  await postThreadReply(
    config.slackBotToken,
    config.slackChannel,
    messageTs,
    `Draft ready for: ${metadata.post_title}`,
    replyBlocks
  );

  console.log(`[drafting-flow] Draft posted to thread for ts=${messageTs}.`);
}

// ---------------------------------------------------------------------------
// Metadata extraction
// ---------------------------------------------------------------------------

/**
 * Find the refract_metadata block in a Slack message's blocks array
 * and parse its JSON payload.
 */
function extractMetadata(blocks: SlackBlock[]): RefractMetadata | null {
  const metaBlock = blocks.find((b) => b.block_id === "refract_metadata");
  if (!metaBlock) return null;

  const elements = metaBlock.elements as Array<Record<string, unknown>> | undefined;
  const text = elements?.[0]?.text as string | undefined;
  if (!text) return null;

  const json = text.trim();

  try {
    return JSON.parse(json) as RefractMetadata;
  } catch {
    console.error("[drafting-flow] Failed to parse refract_metadata JSON:", json.slice(0, 100));
    return null;
  }
}

// ---------------------------------------------------------------------------
// Slack reply formatting
// ---------------------------------------------------------------------------

/**
 * Build the Block Kit blocks for the draft thread reply.
 *
 * Layout:
 *   - Header: "🤖 Draft ready"
 *   - The draft text in a quote block — visually distinct, easy to select and copy
 *   - Divider
 *   - Claude's notes in a context block
 *   - Footer: link back to the original post
 */
function buildDraftBlocks(
  draft: string,
  notes: string,
  postUrl: string,
  replyTarget: import("../shared/types.js").ReplyTarget
): SlackBlock[] {
  const targetEmoji = replyTarget.target === "op" ? "↩️" : "💬";
  const targetLabel = replyTarget.target === "op" ? "Reply to *OP*" : "Reply to *comment*";
  const targetLine = replyTarget.reasoning
    ? `${targetEmoji} ${targetLabel} — ${replyTarget.reasoning}`
    : `${targetEmoji} ${targetLabel}`;

  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "🤖 *Draft ready — review, edit, and post when you're happy with it:*",
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        // Prefix each line with > for Slack's blockquote styling.
        // This makes the draft visually stand out and is easy to select.
        text: draft
          .split("\n")
          .map((line) => `> ${line}`)
          .join("\n"),
      },
    },
    { type: "divider" },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: targetLine,
        },
      ],
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `📝 *Claude's notes:* ${notes}`,
        },
      ],
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `<${postUrl}|View original post>`,
        },
      ],
    },
  ];
}
