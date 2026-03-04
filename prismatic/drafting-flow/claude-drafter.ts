/**
 * drafting-flow/claude-drafter.ts
 *
 * Calls Claude to draft a reply, then parses the structured response
 * into a clean { draft, notes } object.
 *
 * Claude is asked to return:
 *
 *   DRAFT:
 *   <the comment text>
 *
 *   ---
 *   NOTES:
 *   <reasoning and suggestions>
 *
 * We use a plain-text format rather than JSON here because drafts often
 * contain characters that need escaping in JSON (quotes, newlines), and
 * asking Claude to JSON-encode a long free-form reply introduces errors.
 * Splitting on a fixed delimiter is more robust for this use case.
 */

import Anthropic from "@anthropic-ai/sdk";
import { draftResponse } from "../shared/claude-client.js";
import type { RefractMetadata } from "../scoring-flow/slack-formatter.js";
import type { DraftResult } from "../shared/types.js";
import { DRAFTING_SYSTEM_PROMPT, DRAFTING_MODEL, buildDraftingMessage } from "./prompts.js";

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Generate a draft reply for the given post.
 *
 * @param client      - Anthropic client from createClaudeClient()
 * @param metadata    - Parsed from the refract_metadata Slack block
 * @param fullContent - Full post body + comments if fetched, or null
 */
export async function draftReply(
  client: Anthropic,
  metadata: RefractMetadata,
  fullContent: string | null
): Promise<DraftResult> {
  const userMessage = buildDraftingMessage(metadata, fullContent);
  const raw = await draftResponse(client, DRAFTING_SYSTEM_PROMPT, userMessage, DRAFTING_MODEL);
  return parseDraftResponse(raw);
}

// ---------------------------------------------------------------------------
// Response parser
// ---------------------------------------------------------------------------

/**
 * Split Claude's response into draft, notes, and reply_target sections.
 *
 * Expected format:
 *   DRAFT:\n<text>\n\n---\nNOTES:\n<text>\n\n---\nREPLY TARGET: op|comment\nREASONING: <text>
 *
 * Defensively handles missing sections so a formatting hiccup from Claude
 * doesn't crash the flow — the raw text is always preserved somewhere.
 */
function parseDraftResponse(raw: string): DraftResult {
  const text = raw.trim();

  // Split on all "---" separators
  const sections = text.split("\n---\n").map((s) => s.trim());

  const draftSection = sections[0] ?? "";
  const notesSection = sections[1] ?? "";
  const targetSection = sections[2] ?? "";

  if (sections.length < 2) {
    console.warn("[claude-drafter] Response had no --- separator; using full text as draft");
  }

  const draft = stripLabel(draftSection, "DRAFT:");
  const notes = stripLabel(notesSection, "NOTES:");
  const reply_target = parseReplyTarget(targetSection);

  return { draft, notes, reply_target };
}

/**
 * Parse the REPLY TARGET section into a typed ReplyTarget object.
 * Defaults to "op" with no reasoning if the section is missing or malformed.
 */
function parseReplyTarget(section: string): import("../shared/types.js").ReplyTarget {
  if (!section) {
    return { target: "op", reasoning: "" };
  }

  const lines = section.split("\n").map((l) => l.trim());
  const targetLine = lines.find((l) => l.toUpperCase().startsWith("REPLY TARGET:")) ?? "";
  const reasoningLine = lines.find((l) => l.toUpperCase().startsWith("REASONING:")) ?? "";

  const rawTarget = targetLine.replace(/^REPLY TARGET:\s*/i, "").trim().toLowerCase();
  const target = rawTarget === "comment" ? "comment" : "op";
  const reasoning = reasoningLine.replace(/^REASONING:\s*/i, "").trim();

  return { target, reasoning };
}

function stripLabel(text: string, label: string): string {
  const upper = text.trimStart().toUpperCase();
  if (upper.startsWith(label)) {
    return text.trimStart().slice(label.length).trim();
  }
  return text.trim();
}
