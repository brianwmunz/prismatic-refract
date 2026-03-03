/**
 * slack-client.ts
 *
 * A thin wrapper around Slack's Web API for the two operations Refract needs:
 *   1. Post a new message to a channel (Flow 1 — scoring output)
 *   2. Post a reply in a thread (Flow 2 — draft output)
 *
 * Uses Node's built-in fetch (available since Node 18) so no extra dependency
 * is needed. If you need to run on Node < 18, swap fetch for node-fetch.
 *
 * Slack API reference: https://api.slack.com/methods/chat.postMessage
 */

import type { SlackBlock, SlackMessagePayload } from "../scoring-flow/slack-formatter.js";

const SLACK_API_BASE = "https://slack.com/api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// Slack API responses always include ok: true/false plus an optional error
// field. We only surface what we need — everything else is discarded.
interface SlackApiResponse {
  ok: boolean;
  error?: string;
  ts?: string;      // Message timestamp — uniquely identifies a message
  channel?: string; // Channel ID Slack echoes back
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Post a Block Kit message to a Slack channel.
 * Returns the message timestamp (ts) which is Slack's unique message ID.
 * Flow 2 needs this ts to post a threaded reply.
 *
 * @param token   - Slack bot token (xoxb-...)
 * @param payload - Built by slack-formatter.ts
 */
export async function postMessage(
  token: string,
  payload: SlackMessagePayload
): Promise<string> {
  const response = await slackPost(token, "chat.postMessage", {
    channel: payload.channel,
    text:    payload.text,
    blocks:  payload.blocks,
  });

  if (!response.ts) {
    throw new Error("[slack-client] postMessage succeeded but no ts returned");
  }

  return response.ts;
}

/**
 * Post a reply into an existing message's thread.
 * Used by Flow 2 to attach the Claude-drafted response under the
 * original scored mention message.
 *
 * @param token     - Slack bot token
 * @param channel   - Channel where the original message lives
 * @param threadTs  - The ts returned when the original message was posted
 * @param text      - Fallback text for notifications
 * @param blocks    - Optional Block Kit blocks (for formatted drafts)
 */
export async function postThreadReply(
  token: string,
  channel: string,
  threadTs: string,
  text: string,
  blocks?: SlackBlock[]
): Promise<void> {
  await slackPost(token, "chat.postMessage", {
    channel,
    thread_ts: threadTs, // This is what makes it a thread reply
    text,
    ...(blocks ? { blocks } : {}),
  });
}

/**
 * Fetch a specific message from a channel by its timestamp.
 * Flow 2 uses this to retrieve the scored message and extract the
 * refract_metadata block when a 👀 reaction is added.
 *
 * @param token   - Slack bot token
 * @param channel - Channel ID
 * @param ts      - Message timestamp from the reaction_added event
 */
export async function fetchMessage(
  token: string,
  channel: string,
  ts: string,
): Promise<SlackBlock[]> {
  // conversations.history with latest+oldest both set to ts returns exactly
  // the one message at that timestamp (inclusive range, limit 1).
  const response = await slackPost(token, "conversations.history", {
    channel,
    latest:    ts,
    oldest:    ts,
    limit:     1,
    inclusive: true,
  });

  // The API returns a messages array — we want the first (and only) item
  const messages = (response as unknown as { messages?: Array<{ blocks?: SlackBlock[] }> }).messages;
  if (!messages || messages.length === 0) {
    throw new Error(`[slack-client] No message found at ts=${ts} in channel=${channel}`);
  }

  return messages[0].blocks ?? [];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Make a POST request to the Slack Web API.
 *
 * All Slack API methods use the same shape:
 *   - POST to https://slack.com/api/<method>
 *   - JSON body
 *   - Authorization: Bearer <token> header
 *   - Response: { ok: true, ...data } or { ok: false, error: "..." }
 */
async function slackPost(
  token: string,
  method: string,
  body: Record<string, unknown>
): Promise<SlackApiResponse> {
  const res = await fetch(`${SLACK_API_BASE}/${method}`, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(
      `[slack-client] HTTP ${res.status} from Slack API (${method})`
    );
  }

  const data = (await res.json()) as SlackApiResponse;

  if (!data.ok) {
    throw new Error(
      `[slack-client] Slack API error on ${method}: ${data.error ?? "unknown"}`
    );
  }

  return data;
}
