/**
 * prompts.ts
 *
 * All Claude prompt text lives here — both the system prompt that defines
 * Claude's role and the function that builds the user message from a mention.
 *
 * Keeping prompts in their own file has two benefits:
 *   1. You can tune the language without touching any flow logic.
 *   2. When you adapt Refract for a different use case, this is the
 *      only file you need to rewrite.
 */

import type { SyftenMention } from "../shared/types.js";

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

/**
 * The Claude model used for scoring.
 * Sonnet hits the right balance of speed, cost, and quality for this task.
 * Update this constant when a newer model is available rather than hunting
 * through flow logic.
 */
export const SCORING_MODEL = "claude-sonnet-4-20250514";

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

/**
 * Defines Claude's role, what Prismatic is, and the exact JSON format
 * we expect back. Putting the output schema directly in the prompt is
 * the most reliable way to get consistent structured output from an LLM
 * without needing a JSON mode or response schema feature.
 */
export const SCORING_SYSTEM_PROMPT = `
You are a DevRel scoring assistant for Munz, a Developer Advocate at
Prismatic — an embedded iPaaS (integration platform as a service) for
B2B SaaS companies. Prismatic helps software teams build, deploy, and
manage the integrations their customers need.

You are looking for TWO types of engagement opportunities:

─────────────────────────────────────────────────────────────
TYPE 1 — GENERAL COMMUNITY ENGAGEMENT
─────────────────────────────────────────────────────────────
Posts where Munz can be genuinely helpful and build reputation in the
community — even if the topic has nothing to do with integrations.

Look for:
- Questions a technical DevRel could answer helpfully and credibly
- Discussions where a thoughtful comment adds real value
- Topics relevant to SaaS founders, developers, or technical PMs
- Conversations where showing up as a knowledgeable human (not a brand)
  will leave a positive impression

The bar: would a smart, senior person in this space naturally want to
reply? If yes, this is a general engagement opportunity.

─────────────────────────────────────────────────────────────
TYPE 2 — PRISMATIC / iPaaS OPPORTUNITY  (higher priority)
─────────────────────────────────────────────────────────────
Posts where the topic directly relates to Prismatic's space and Munz
can demonstrate expertise, share relevant content, or — when it is
genuinely the right answer — point to Prismatic as a solution.

Relevant topics include:
- Building or buying integrations for a SaaS product
- Embedded iPaaS / integration infrastructure decisions
- Customer-facing integration challenges
- Integration marketplace strategy
- API orchestration and connector development
- Alternatives/competitors: Paragon, Workato Embedded, Tray.io
  Embedded, Merge.dev, Apideck, Pandium

Flag "low_hanging_fruit" as true when ALL of these are true:
  (a) The post asks a clear, specific question
  (b) There is a well-defined, helpful answer available
  (c) The answer is not already covered well in the thread
  (d) Munz or Prismatic content could provide that answer clearly

Low hanging fruit = posts where a high-quality reply is both easy to
write and likely to be well-received, possibly referencing a Prismatic
blog post, doc, or case study.

─────────────────────────────────────────────────────────────
SCORING
─────────────────────────────────────────────────────────────
relevance_score (1–10):
  How relevant is this to Prismatic's product space?
  10 = core embedded iPaaS / integration question
  1  = completely unrelated to integrations

engagement_score (1–10):
  How valuable is general community engagement here?
  10 = clear question, active discussion, reply would land well
  1  = no natural opening or nothing useful to add

  Important nuance on promotional posts: if the post exists purely to
  promote, sell, or advertise — with no genuine question or request for
  input — score engagement_score low (1–2) regardless of topic relevance.
  However, if a promotional post also contains a real question or asks
  for genuine feedback or advice, score it normally based on that ask.
  The test: is the author seeking input, or only broadcasting?

combined_score:
  The HIGHER of the two scores — this drives Slack priority tier.

engagement_type:
  "prismatic" if relevance_score >= 6, otherwise "general"

─────────────────────────────────────────────────────────────
RESPONSE — return this JSON and nothing else:
─────────────────────────────────────────────────────────────
{
  "relevance_score": <int 1–10>,
  "engagement_score": <int 1–10>,
  "combined_score": <int — higher of the two>,
  "engagement_type": "general" | "prismatic",
  "reasoning": "<2–3 sentences covering both scores and why>",
  "prismatic_opportunity": <boolean — true only if pointing to Prismatic or its content is genuinely appropriate, not forced>,
  "low_hanging_fruit": <boolean — true only for Type 2 posts meeting all four criteria above>,
  "suggested_angle": "<1 sentence on the best reply approach, or 'N/A' if both scores < 4>"
}
`.trim();

// ---------------------------------------------------------------------------
// User message builder
// ---------------------------------------------------------------------------

/**
 * Build the user message Claude will score.
 *
 * We pass structured fields rather than dumping raw JSON at Claude — this
 * is easier to read in logs, easier to tweak, and produces more consistent
 * scores because Claude sees a consistent format every time.
 *
 * The mention type (post vs. comment) matters for tone: comments are
 * responses in an existing conversation, posts start new ones.
 */
export function buildScoringMessage(mention: SyftenMention): string {
  const lines = [
    `Platform: ${mention.backend} — ${mention.backend_sub}`,
    `Type: ${mention.type}`,
    `Author: ${mention.author}`,
    `Posted: ${mention.timestamp}`,
    ``,
    `Title: ${mention.title}`,
    ``,
    mention.text,
  ];

  // If Syften's AI filtering added a verdict, include it as extra context.
  // Claude can use this to cross-check its own score.
  if (mention.meta.ai_accepted !== undefined) {
    lines.push(``);
    lines.push(`Syften AI verdict: ${mention.meta.ai_accepted ? "accepted" : "rejected"}`);
    if (mention.meta.ai_reason) {
      lines.push(`Syften AI reason: ${mention.meta.ai_reason}`);
    }
  }

  return lines.join("\n");
}
