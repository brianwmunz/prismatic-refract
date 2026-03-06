/**
 * slack-formatter.ts
 *
 * Turns a ScoredMention into a Slack Block Kit message payload ready to
 * POST to the Slack API.
 *
 * Slack Block Kit works by composing an array of "block" objects. Each
 * block is a self-contained UI element — a section of text, a divider,
 * a context line, etc. The API reference is at:
 * https://api.slack.com/reference/block-kit/blocks
 *
 * Three priority tiers based on combined_score:
 *   🔥  High   (>= 7) — full detail, prominent visual weight
 *   🟡  Medium (4–6)  — same layout, quieter indicator
 *   ⚪  Low    (<= 3) — condensed single-line entry
 *
 * Flow 2 (drafting) needs to look up the original post context from the
 * Slack message. To support that, every message includes a hidden metadata
 * block (block_id: "refract_metadata") containing JSON that Flow 2 can
 * find and parse without re-calling the Syften API.
 */

import type { ScoredMention } from "../shared/types.js";

// ---------------------------------------------------------------------------
// Score thresholds — change these to tune what counts as high/low
// ---------------------------------------------------------------------------

const HIGH_SCORE_THRESHOLD = 7;
const LOW_SCORE_THRESHOLD = 3;
const SNIPPET_MAX_LENGTH = 150;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// A single Slack Block Kit block. We use a loose type here because the
// Block Kit schema has dozens of block shapes — typing every variant would
// add more noise than value for this project.
export interface SlackBlock {
  type: string;
  block_id?: string;
  [key: string]: unknown;
}

// The payload you POST to the Slack API's chat.postMessage endpoint.
export interface SlackMessagePayload {
  channel: string;
  text: string;     // Fallback text for notifications and accessibility
  blocks: SlackBlock[];
}

/**
 * The data embedded in every message so Flow 2 can reconstruct context
 * when the 👀 reaction fires — without needing to call Syften again.
 *
 * Both flows import this type so the shape is guaranteed to match.
 */
export interface RefractMetadata {
  post_url: string;
  post_title: string;
  snippet: string;
  platform: string;
  platform_sub: string;
  relevance_score: number;
  engagement_score: number;
  combined_score: number;
  engagement_type: "general" | "prismatic";
  prismatic_relevance: "high" | "medium" | "low";
  authenticity: string;
  reasoning: string;
  prismatic_opportunity: boolean;
  low_hanging_fruit: boolean;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Build the full Slack message payload for a scored mention.
 *
 * @param scored  - The mention + scoring result from claude-scorer.ts
 * @param channel - The Slack channel ID or name (e.g. "#community-engagement")
 */
export function formatScoredMention(
  scored: ScoredMention,
  channel: string
): SlackMessagePayload {
  const { mention, scoring } = scored;
  const score = scoring.combined_score;

  const blocks =
    score >= HIGH_SCORE_THRESHOLD
      ? buildFullBlocks(scored, "🔥")
      : score > LOW_SCORE_THRESHOLD
        ? buildFullBlocks(scored, "🟡")
        : buildCondensedBlocks(scored);

  // Always append the metadata block — Flow 2 depends on it
  blocks.push(buildMetadataBlock(scored));

  return {
    channel,
    // Slack uses `text` as a fallback when blocks can't render (e.g. in
    // desktop notifications). Keep it short and informative.
    text: `[SCORE: ${score}] ${mention.title} — ${mention.backend} ${mention.backend_sub}`,
    blocks,
  };
}

// ---------------------------------------------------------------------------
// Block builders — full layout (high + medium)
// ---------------------------------------------------------------------------

/**
 * Full detail layout used for medium and high priority mentions.
 * The only difference between the two tiers is the indicator emoji.
 */
function buildFullBlocks(scored: ScoredMention, indicator: string): SlackBlock[] {
  const { mention, scoring } = scored;
  const snippet = truncate(mention.text, SNIPPET_MAX_LENGTH);
  const opportunity = scoring.prismatic_opportunity ? "✅ Yes" : "No";

  return [
    // --- Header: score indicator, numeric score, platform ---
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${indicator} *[SCORE: ${scoring.combined_score}]* | ${mention.backend} — ${mention.backend_sub}`,
      },
    },

    // --- Title + snippet ---
    {
      type: "section",
      text: {
        type: "mrkdwn",
        // Slack renders > as a blockquote, giving the snippet visual separation
        text: `*${mention.title}*\n> _"${snippet}…"_`,
      },
    },

    { type: "divider" },

    // --- Scores, type badge, authenticity, reasoning, angle ---
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: [
          `📊 Relevance: ${scoring.relevance_score} | Engagement: ${scoring.engagement_score}`,
          typeBadge(scoring.engagement_type, scoring.prismatic_relevance, scoring.low_hanging_fruit, scoring.prismatic_opportunity),
          `🔍 *Authenticity:* ${scoring.authenticity}`,
          `🧠 *Reasoning:* ${scoring.reasoning}`,
          `💡 *Angle:* ${scoring.suggested_angle}`,
        ].join("\n"),
      },
    },

    // --- Link + call to action ---
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `🔗 <${mention.item_url}|View Post>`,
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: "React with 👀 to get a draft response.",
        },
      ],
    },
  ];
}

// ---------------------------------------------------------------------------
// Block builders — condensed layout (low priority)
// ---------------------------------------------------------------------------

/**
 * Single-line layout for low-signal mentions.
 * Still worth logging so you have a complete record, but doesn't demand
 * visual attention in the channel.
 */
function buildCondensedBlocks(scored: ScoredMention): SlackBlock[] {
  const { mention, scoring } = scored;

  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `⚪ *[SCORE: ${scoring.combined_score}]* | ${mention.backend} — *${mention.title}* — ${scoring.reasoning} <${mention.item_url}|View>`,
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Metadata block — read by Flow 2 when 👀 reaction fires
// ---------------------------------------------------------------------------

/**
 * Encodes post context as JSON in a context block.
 *
 * The block_id "refract_metadata" is how Flow 2 finds this block when it
 * fetches the message — it iterates the blocks array and looks for that ID.
 * Using block_id is more reliable than relying on position in the array.
 */
function buildMetadataBlock(scored: ScoredMention): SlackBlock {
  const { mention, scoring } = scored;

  const metadata: RefractMetadata = {
    post_url:              mention.item_url,
    post_title:            mention.title,
    snippet:               truncate(mention.text, SNIPPET_MAX_LENGTH),
    platform:              mention.backend,
    platform_sub:          mention.backend_sub,
    relevance_score:       scoring.relevance_score,
    engagement_score:      scoring.engagement_score,
    combined_score:        scoring.combined_score,
    engagement_type:       scoring.engagement_type,
    prismatic_relevance:   scoring.prismatic_relevance,
    authenticity:          scoring.authenticity,
    reasoning:             scoring.reasoning,
    prismatic_opportunity: scoring.prismatic_opportunity,
    low_hanging_fruit:     scoring.low_hanging_fruit,
  };

  return {
    type: "context",
    block_id: "refract_metadata",
    elements: [
      {
        // plain_text prevents Slack from processing the content as mrkdwn.
        // If we use "mrkdwn" here, Slack auto-links any URLs in the JSON,
        // wrapping them in <> angle brackets and breaking JSON.parse() in Flow 2.
        type: "plain_text",
        text: JSON.stringify(metadata),
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Build the type badge line shown in the Slack message.
 * This is the clearest signal about what kind of action to take.
 *
 * Examples:
 *   🎯 *Prismatic Opportunity — High*  🍎 Low Hanging Fruit  🏷️ Point to Prismatic: ✅
 *   🎯 *Prismatic Opportunity — Medium*
 *   💬 *General Engagement*
 */
function typeBadge(
  type: "general" | "prismatic",
  prismaticRelevance: "high" | "medium" | "low",
  lowHangingFruit: boolean,
  prismaticOpportunity: boolean
): string {
  const parts: string[] = [];

  if (type === "prismatic") {
    const tierLabel = {
      high:   "High — Prismatic mentioned",
      medium: "Medium — Adjacent topic",
      low:    "Low — Reputation play",
    }[prismaticRelevance];
    parts.push(`🎯 *Prismatic Opportunity — ${tierLabel}*`);
    if (lowHangingFruit)      parts.push("🍎 *Low Hanging Fruit*");
    if (prismaticOpportunity) parts.push("🏷️ Point to Prismatic: ✅");
  } else {
    parts.push("💬 *General Engagement*");
  }

  return parts.join("  ");
}

/**
 * Truncate text to a maximum character length, breaking at a word boundary
 * where possible to avoid cutting mid-word.
 */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;

  const cut = text.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(" ");

  // If there's a word boundary within the last 20 chars, break there;
  // otherwise just cut hard at maxLength.
  return lastSpace > maxLength - 20 ? cut.slice(0, lastSpace) : cut;
}
