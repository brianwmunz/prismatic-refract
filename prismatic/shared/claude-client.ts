import Anthropic from "@anthropic-ai/sdk";
import type { ScoringResult } from "./types.js";

// ---------------------------------------------------------------------------
// Client setup
// In Prismatic flows, pass the API key from a config variable (encrypted).
// For local testing, fall back to ANTHROPIC_API_KEY env var.
// ---------------------------------------------------------------------------

export function createClaudeClient(apiKey: string): Anthropic {
  return new Anthropic({ apiKey });
}

// ---------------------------------------------------------------------------
// Shared call wrapper
// Centralises model choice, max_tokens, and error handling so callers stay clean.
// ---------------------------------------------------------------------------

interface RawClaudeResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export async function callClaude(
  client: Anthropic,
  systemPrompt: string,
  userMessage: string,
  model = "claude-sonnet-4-20250514"
): Promise<RawClaudeResponse> {
  const response = await client.messages.create({
    model,
    max_tokens: 1024,
    messages: [{ role: "user", content: userMessage }],
    system: systemPrompt,
  });

  const block = response.content[0];
  if (block.type !== "text") {
    throw new Error(`Unexpected content block type: ${block.type}`);
  }

  return {
    text: block.text,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}

// ---------------------------------------------------------------------------
// Scoring helper
// Parses Claude's JSON response into a typed ScoringResult.
// Throws with the raw text attached if parsing fails — caller can log it.
//
// Named "callClaudeForScore" (not "scoreMention") to distinguish it from
// the higher-level scoreMention() in scoring-flow/claude-scorer.ts, which
// knows about SyftenMentions and builds the prompt itself.
// ---------------------------------------------------------------------------

export async function callClaudeForScore(
  client: Anthropic,
  systemPrompt: string,
  userMessage: string,
  model?: string
): Promise<ScoringResult> {
  const { text } = await callClaude(client, systemPrompt, userMessage, model);

  // Claude occasionally wraps its JSON response in a markdown code fence
  // (```json ... ```) even when instructed not to. Strip it before parsing.
  const json = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    const err = new Error("Claude returned non-JSON for scoring");
    (err as Error & { rawResponse: string }).rawResponse = text;
    throw err;
  }

  // Basic shape validation
  const result = parsed as Record<string, unknown>;
  const required: Array<keyof ScoringResult> = [
    "relevance_score",
    "engagement_score",
    "combined_score",
    "engagement_type",
    "reasoning",
    "prismatic_opportunity",
    "low_hanging_fruit",
    "suggested_angle",
  ];
  for (const field of required) {
    if (!(field in result)) {
      throw new Error(`Scoring response missing field: ${field}`);
    }
  }

  return result as unknown as ScoringResult;
}

// ---------------------------------------------------------------------------
// Drafting helper
// Returns the raw text — the caller (drafting flow) splits on "---" itself.
// ---------------------------------------------------------------------------

export async function draftResponse(
  client: Anthropic,
  systemPrompt: string,
  userMessage: string,
  model?: string
): Promise<string> {
  const { text } = await callClaude(client, systemPrompt, userMessage, model);
  return text;
}
