/**
 * integration/src/flows.ts
 *
 * Defines the two Prismatic flows. Each flow is a thin wrapper that:
 *   1. Reads config variables (secrets injected by Prismatic at runtime)
 *   2. Extracts the webhook payload
 *   3. Calls the business logic in ../../prismatic/
 *
 * The business logic itself lives in the prismatic/ directory and has no
 * Prismatic SDK dependency — it can be tested standalone with tsx.
 *
 * Flow 1 — Score Mention
 *   Triggered by: Syften webhook (HTTP POST)
 *   Does: Parse → score with Claude → filter → post to #community-engagement
 *
 * Flow 2 — Draft Response
 *   Triggered by: Slack Events API webhook (reaction_added)
 *   Does: On 👀 reaction → fetch post → draft with Claude → thread reply
 */

import { flow, util } from "@prismatic-io/spectral";
import { runScoringFlow } from "../../prismatic/scoring-flow/index.js";
import { runDraftingFlow } from "../../prismatic/drafting-flow/index.js";

// ---------------------------------------------------------------------------
// Flow 1: Score Mention
// ---------------------------------------------------------------------------

export const scoringFlow = flow({
  name: "Score Mention",
  stableKey: "refract-score-mention-v1",
  description:
    "Receives a Syften webhook, scores the mention with Claude, " +
    "and posts a formatted summary to #community-engagement.",

  onTrigger: async (context, payload) => {
    // Accept all incoming webhook requests.
    // Syften does not send a verification challenge, so no special
    // handling is needed here — just pass the payload through.
    return Promise.resolve({ payload });
  },

  onExecution: async (context, params) => {
    const config = {
      anthropicApiKey:  util.types.toString(context.configVars["Anthropic API Key"]),
      slackBotToken:    util.types.toString(context.configVars["Slack Bot Token"]),
      slackChannel:     util.types.toString(context.configVars["Slack Channel ID"]),
      minScore:         Number(context.configVars["Minimum Score"] ?? 5),
      redditUsername:   util.types.toString(context.configVars["Reddit Username"]) || undefined,
    };

    // Trigger payload flows from onTrigger into onExecution via params.onTrigger.results
    const body = params.onTrigger.results.body.data;

    await runScoringFlow(body, config);

    return { data: "success" };
  },
});

// ---------------------------------------------------------------------------
// Flow 2: Draft Response
// ---------------------------------------------------------------------------

export const draftingFlow = flow({
  name: "Draft Response",
  stableKey: "refract-draft-response-v1",
  description:
    "Triggered when a 👀 reaction is added to a scored message. " +
    "Fetches the original post, drafts a reply with Claude, and posts " +
    "the draft as a thread reply in #community-engagement.",

  onTrigger: async (context, payload, params) => {
    // Slack's Events API sends a URL verification challenge when you first
    // configure the webhook. We must respond with the challenge value or
    // Slack won't accept the endpoint.
    const body = payload.body.data as Record<string, unknown>;

    if (body?.type === "url_verification") {
      return {
        payload,
        response: {
          statusCode: 200,
          contentType: "text/plain",
          body: String(body.challenge ?? ""),
        },
      };
    }

    return Promise.resolve({ payload });
  },

  onExecution: async (context, params) => {
    const slackBotToken = util.types.toString(context.configVars["Slack Bot Token"]);
    const slackChannel  = util.types.toString(context.configVars["Slack Channel ID"]);

    const event = params.onTrigger.results.body.data as import("../../prismatic/drafting-flow/index.js").SlackReactionEvent;

    const anthropicApiKey = util.types.toString(context.configVars["Anthropic API Key"]);
    await runDraftingFlow(event, { anthropicApiKey, slackBotToken, slackChannel });

    return { data: "success" };
  },
});

export default [scoringFlow, draftingFlow];
