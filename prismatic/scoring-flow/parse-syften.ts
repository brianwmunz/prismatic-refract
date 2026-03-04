/**
 * parse-syften.ts
 *
 * Responsible for one thing: turning the raw Syften webhook body into
 * clean, typed TypeScript objects the rest of the flow can trust.
 *
 * Syften sends an array of mentions even when there's only one match,
 * so the payload always looks like:
 *
 *   [
 *     {
 *       "backend": "Reddit",
 *       "backend_sub": "r/SaaS",
 *       "type": "post",
 *       "item_url": "https://reddit.com/...",
 *       "author": "some_user",
 *       "text": "full post body...",
 *       "title": "Post Title",
 *       "timestamp": "2026-03-03T16:53:58Z",
 *       ...
 *     }
 *   ]
 *
 * See prismatic/shared/types.ts for the full SyftenMention shape.
 */

import type { SyftenMention, SyftenWebhookPayload } from "../shared/types.js";

// ---------------------------------------------------------------------------
// Public API — this is what the flow's first step calls
// ---------------------------------------------------------------------------

/**
 * Parse and validate the raw Syften webhook body.
 *
 * Returns an array of validated mentions. Filters out any items that
 * don't pass validation rather than failing the entire batch — if one
 * mention is malformed, the others should still be processed.
 *
 * @param rawBody - The raw request body from the webhook (string or pre-parsed object)
 * @returns Array of validated SyftenMention objects (may be empty)
 */
export function parseSyftenPayload(rawBody: unknown): SyftenMention[] {
  const parsed = ensureArray(rawBody);

  const mentions: SyftenMention[] = [];

  for (const item of parsed) {
    const result = validateMention(item);
    if (result.ok) {
      mentions.push(result.mention);
    } else {
      // Log but don't throw — a bad item shouldn't kill the whole batch
      console.warn("[parse-syften] Skipping invalid mention:", result.error, item);
    }
  }

  return mentions;
}

/**
 * Build a short, human-readable label for a mention.
 * Useful for Slack messages and log output.
 *
 * Example: "Reddit post in r/SaaS by some_user"
 */
export function describeMention(mention: SyftenMention): string {
  return `${mention.backend} ${mention.type} in ${mention.backend_sub} by ${mention.author}`;
}

/**
 * Check whether a mention came from Reddit.
 * Reddit has a JSON API (append .json to any post URL) that Flow 2 can use
 * to fetch the full post + comments when drafting a reply.
 */
export function isRedditMention(mention: SyftenMention): boolean {
  return mention.backend.toLowerCase() === "reddit";
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

/**
 * Syften always sends JSON, but Prismatic delivers the webhook body
 * as a string. Handle both a raw string and an already-parsed value.
 */
function ensureArray(rawBody: unknown): unknown[] {
  let parsed: unknown = rawBody;

  if (typeof rawBody === "string") {
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      throw new Error(
        `[parse-syften] Webhook body is not valid JSON.\nReceived: ${rawBody.slice(0, 200)}`
      );
    }
  }

  if (!Array.isArray(parsed)) {
    throw new Error(
      `[parse-syften] Expected an array from Syften but got: ${typeof parsed}`
    );
  }

  return parsed;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

// These are the fields we need downstream. If Syften adds new fields
// later, they'll pass through on the object automatically — we only
// enforce what our flow actually depends on.
const REQUIRED_FIELDS = [
  "backend",
  "type",
  "item_url",
  "author",
  "text",
  "title",
  "timestamp",
] as const;

// backend_sub is Reddit-specific (the subreddit). Other platforms like
// dev.to don't send it, so we make it optional and default to empty string.

type ValidationSuccess = { ok: true; mention: SyftenMention };
type ValidationFailure = { ok: false; error: string };
type ValidationResult = ValidationSuccess | ValidationFailure;

/**
 * Validate a single mention object.
 *
 * Returns a discriminated union so the caller can handle success and
 * failure without try/catch — a pattern worth showing in DevRel demos.
 */
function validateMention(item: unknown): ValidationResult {
  if (typeof item !== "object" || item === null) {
    return { ok: false, error: "Item is not an object" };
  }

  const obj = item as Record<string, unknown>;

  // Check all required fields are present and non-empty strings
  for (const field of REQUIRED_FIELDS) {
    if (!obj[field] || typeof obj[field] !== "string") {
      return {
        ok: false,
        error: `Missing or invalid required field: "${field}"`,
      };
    }
  }

  // type must be one of the known values across supported platforms
  const KNOWN_TYPES = ["post", "comment", "article"];
  if (!KNOWN_TYPES.includes(obj["type"] as string)) {
    return {
      ok: false,
      error: `Unknown mention type: "${obj["type"]}" (expected one of: ${KNOWN_TYPES.join(", ")})`,
    };
  }

  // meta is optional — default to empty object if absent.
  // Cast to SyftenMeta since TypeScript can't narrow an index-signature type
  // from a plain object literal without an explicit assertion.
  const meta = (
    typeof obj["meta"] === "object" && obj["meta"] !== null
      ? obj["meta"]
      : {}
  ) as import("../shared/types.js").SyftenMeta;

  return {
    ok: true,
    mention: {
      backend:      obj["backend"] as string,
      backend_sub:  typeof obj["backend_sub"] === "string" ? obj["backend_sub"] : "",
      type:         obj["type"] as "post" | "comment" | "article",
      icon_url:     typeof obj["icon_url"] === "string" ? obj["icon_url"] : "",
      timestamp:    obj["timestamp"] as string,
      item_url:     obj["item_url"] as string,
      author:       obj["author"] as string,
      text:         obj["text"] as string,
      title:        obj["title"] as string,
      title_type:   obj["title_type"] === 1 ? 1 : 0,
      meta,
      lang:         typeof obj["lang"] === "string" ? obj["lang"] : "en",
      filter:       typeof obj["filter"] === "string" ? obj["filter"] : "",
    },
  };
}
