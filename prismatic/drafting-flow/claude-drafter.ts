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
 * Split Claude's response into the draft text and the notes section.
 *
 * Expected format:
 *   DRAFT:\n<text>\n\n---\nNOTES:\n<text>
 *
 * Defensively handles missing sections so a formatting hiccup from Claude
 * doesn't crash the flow — the raw text is always preserved somewhere.
 */
function parseDraftResponse(raw: string): DraftResult {
  // Normalise line endings
  const text = raw.trim();

  // Split on the "---" separator Claude is instructed to use
  const separatorIndex = text.indexOf("\n---\n");

  let draftSection: string;
  let notesSection: string;

  if (separatorIndex === -1) {
    // No separator — treat everything as the draft, notes are empty
    console.warn("[claude-drafter] Response had no --- separator; using full text as draft");
    draftSection = text;
    notesSection = "";
  } else {
    draftSection = text.slice(0, separatorIndex).trim();
    notesSection = text.slice(separatorIndex + 5).trim(); // skip "\n---\n"
  }

  // Strip the "DRAFT:" and "NOTES:" label prefixes Claude is instructed to add
  const draft = stripLabel(draftSection, "DRAFT:");
  const notes = stripLabel(notesSection, "NOTES:");

  return { draft, notes };
}

function stripLabel(text: string, label: string): string {
  const upper = text.trimStart().toUpperCase();
  if (upper.startsWith(label)) {
    return text.trimStart().slice(label.length).trim();
  }
  return text.trim();
}
