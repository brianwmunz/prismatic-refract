// Syften webhook payload
// Syften sends an array — usually one item per call, but handle multiples to be safe.
export interface SyftenMention {
  backend: string;          // Platform name, e.g. "Reddit", "HackerNews"
  backend_sub: string;      // Community, e.g. "r/SaaS". Empty string for platforms that don't have sub-communities (dev.to).
  type: "post" | "comment" | "article";
  icon_url: string;         // Platform favicon URL
  timestamp: string;        // ISO 8601, e.g. "2026-03-03T16:53:58Z"
  item_url: string;         // Direct link to the post or comment
  author: string;           // Username
  text: string;             // Full post/comment body
  title: string;            // Post title; for comments, the parent post title
  title_type: 0 | 1;        // 0 = post, 1 = comment
  meta: SyftenMeta;         // AI verdict fields when AI filtering is enabled
  lang: string;             // Language code, e.g. "en"
  filter: string;           // The Syften filter query that matched
}

// Populated only when AI filtering is active on the Syften filter
export interface SyftenMeta {
  ai_accepted?: boolean;
  ai_reason?: string;
  [key: string]: unknown;   // Guard against undocumented fields
}

export type SyftenWebhookPayload = SyftenMention[];

// Claude scoring response (Flow 1)
//
// Two distinct opportunity types drive everything downstream:
//
//   "general"   — A chance to be helpful and build community reputation,
//                 even if the topic isn't about integrations. Value comes
//                 from visibility and goodwill.
//
//   "prismatic" — Directly about integrations, iPaaS, or topics where
//                 Prismatic expertise is genuinely relevant. The goal is
//                 to show expertise or point to Prismatic / Prismatic content.
//
export interface ScoringResult {
  relevance_score: number;       // How relevant to Prismatic's space (1–10)
  engagement_score: number;      // General engagement value (1–10)
  combined_score: number;        // Higher of the two — drives Slack priority tier
  engagement_type: "general" | "prismatic";
  reasoning: string;             // 2–3 sentences explaining the scores
  prismatic_opportunity: boolean; // True if pointing to Prismatic/content is natural
  low_hanging_fruit: boolean;    // True if this is a clear question with a clear answer available
  suggested_angle: string;       // One sentence: what kind of reply fits
}

// Enriched mention passed between flow steps
export interface ScoredMention {
  mention: SyftenMention;
  scoring: ScoringResult;
}

// Claude drafting response (Flow 2)
export interface DraftResult {
  skip: boolean;         // True if Claude recommends not responding
  skip_reason: string;   // Populated when skip is true
  draft: string;         // The comment text, ready to copy-paste
  notes: string;         // Claude's reasoning and suggestions for Munz
  reply_target: ReplyTarget;
}

export interface ReplyTarget {
  target: "op" | "comment";
  reasoning: string;  // One sentence explaining the recommendation
}
