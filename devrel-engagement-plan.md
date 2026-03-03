# Refract
## Community Engagement Bot — Project Plan & Claude Code Outline

---

## Syften Integration Options (Research Summary)

Syften offers **four notification delivery methods**: Slack integration, Email, RSS, and **webhooks/API** (webhooks available on the PRO plan at $99.95/mo; you're on this plan). Syften also has a Zapier integration. The API responses include AI verdict fields when AI filtering is enabled. Syften aims for ≤1 minute delay on live content.

Key finding from Syften's documentation: AI filtering (the `$accept:"..."` syntax in filters) only applies to Slack and email notifications. However, the archive, API, and www views still show every match, and **API responses include the AI verdict fields** so you can consume them programmatically.

### Trigger Options Compared

| Option | How it works | Pros | Cons |
|--------|-------------|------|------|
| **A. Syften webhook → Prismatic** | Configure Syften to POST directly to a Prismatic webhook endpoint | Cleanest architecture; no middleman; structured JSON payload; real-time | Need PRO plan (you have it); must discover exact payload format by testing |
| **B. Syften → Slack → Prismatic** | Syften posts to a raw Slack channel; Prismatic subscribes to Slack message events | You already have this working; can see messages visually | Extra hop; must parse Syften's Slack message format (text blob); Slack event subscription adds complexity |
| **C. Syften → Zapier → Prismatic** | Syften triggers a Zapier "New Mention" event, Zapier forwards to Prismatic webhook | Zapier handles Syften's data structure for you | Adds a paid dependency (Zapier); extra latency; defeats the "learn Prismatic" goal |

### Recommendation: Option A (Syften webhook → Prismatic)

This is the simplest and most direct path. You configure Syften's webhook to point at your Prismatic integration's webhook URL. Syften sends a structured JSON payload for each mention, which Prismatic receives and processes.

**Why this wins:**
- No middleman services
- Structured JSON payload (easier to parse than Slack text blobs)
- The Syften webhook likely includes AI verdict fields if you have AI filtering enabled on your filters
- Real-time (~1 min from post to your Slack channel)
- Best Prismatic learning exercise (you're building a webhook-triggered integration from scratch)

**What you need to figure out first:** The exact webhook payload format. Syften has a [GitHub examples repo](https://github.com/syften/syften-examples) with a `webhook/` folder and a `curl/` folder that should show the payload structure. You can also configure the webhook to point at a temporary endpoint (like [webhook.site](https://webhook.site) or Postman) to inspect a few real payloads before building anything.

**Keep the existing Syften → Slack channel as a fallback/backup** so you don't lose any mentions while building this out.

---

## Architecture Overview

```
Syften (webhook) ──POST──→ Prismatic Flow 1 → Claude API (score) → Slack (#community-engagement)
                                                                              │
                                                           React with 👀 emoji
                                                                              │
                                                         Prismatic Flow 2 → Claude API (draft) → Slack thread reply
```

**Two Prismatic flows:**

1. **Scoring Flow** — Triggered by Syften's webhook. Receives the structured mention payload, calls Claude to score relevance (1–10), and posts a formatted summary to `#community-engagement`.
2. **Drafting Flow** — Triggered when you react with 👀 on a scored message. Fetches the original post content, calls Claude to draft a response, and replies in a thread.

---

## Project Plan (Your Tasks)

### Phase 1: Foundation (Day 1–2)

- [ ] **Discover the Syften webhook payload format**
  - Go to [webhook.site](https://webhook.site) and create a temporary endpoint
  - In Syften's settings (Setup → API/Webhooks), configure a webhook pointed at that temporary URL
  - Wait for a few mentions to come through and inspect the JSON payloads
  - Also check the [syften-examples repo](https://github.com/syften/syften-examples/tree/master/webhook) for documented payload structure
  - Document the field names (title, URL, body/snippet, source, subreddit, author, AI verdict, etc.)
- [ ] **Create the Slack channel** `#community-engagement` — where scored/formatted posts will land
- [ ] **Keep your existing Syften → Slack channel running** as a backup during development
- [ ] **Get an Anthropic API key** for the Prismatic integration (use your personal API account, not the org one)
- [ ] **Set up a Prismatic dev environment** — make sure `prism` CLI is working and you can deploy test integrations

### Phase 2: Build Scoring Flow (Day 3–5)

- [ ] Build Flow 1 in Prismatic (see Claude Code outline below)
- [ ] Test with 3–5 real Syften messages manually forwarded to the trigger
- [ ] Tune the Claude system prompt based on initial scoring quality
- [ ] Verify Slack output formatting looks right (especially the visual priority distinction)

### Phase 3: Build Drafting Flow (Day 6–7)

- [ ] Build Flow 2 in Prismatic
- [ ] Test the 👀 emoji reaction trigger end-to-end
- [ ] Tune the Claude drafting prompt — make sure responses sound like you, not like a bot
- [ ] Test with a few real posts and compare drafts to what you'd actually write

### Phase 4: Polish & Go Live (Day 8)

- [ ] Connect Syften's live output to the scoring flow
- [ ] Monitor for a day or two to catch edge cases (duplicate posts, malformed messages, rate limits)
- [ ] Share `#community-engagement` with Brian, JuliAnn, and relevant teammates
- [ ] Document the setup in your DevRel & DX Hub in Notion

---

## Claude Code Outline

This is what you'd hand to Claude Code (or use as your own build guide) to implement each flow as a Prismatic custom integration.

---

### Flow 1: Scoring Flow

#### Trigger
- **Type:** Prismatic webhook endpoint (HTTP POST)
- **Setup:** In Syften's settings, configure the webhook URL to point directly at your Prismatic integration's webhook endpoint. Syften will POST a JSON payload for each new mention.
- **Keep existing Syften → Slack channel running** as a parallel backup.

#### Step 1: Parse the Syften Webhook Payload
- The Syften webhook sends a structured JSON payload (exact format to be confirmed in Phase 1)
- Expected fields (to verify):
  - `url` — direct link to the post
  - `title` — the post title
  - `body` or `snippet` — the post content or preview
  - `source` — platform name (Reddit, HN, dev.to, etc.)
  - `subreddit` or `community` — specific community (if Reddit)
  - `author` — who posted it
  - `filter` — which Syften filter matched
  - AI verdict fields (if AI filtering is enabled on the filter): `ai_accepted`, `ai_reason`, etc.
- Parse the incoming JSON directly — no regex needed since it's structured data
- If any fields are missing, log the raw payload for debugging

#### Step 2: Call Claude API (Scoring)
- **Endpoint:** `POST https://api.anthropic.com/v1/messages`
- **Model:** `claude-sonnet-4-20250514` (fast, cheap, good enough for scoring)
- **System prompt:**

```
You are a DevRel relevance scorer for Prismatic, an embedded iPaaS
(integration platform as a service) for B2B SaaS companies.

Prismatic helps SaaS companies build, deploy, and manage integrations
their customers need. Key topics where Prismatic is relevant:
- Building native integrations for SaaS products
- Embedded iPaaS / integration infrastructure
- B2B SaaS integration challenges (customer-facing integrations)
- Integration marketplace / integration management
- Workflow automation for SaaS platforms (not personal automation)
- API orchestration and connector development
- Competitors: Paragon, Workato Embedded, Tray.io Embedded, Merge.dev

You will receive a community post (from Reddit, dev.to, HN, etc.).
Score it on two dimensions:

1. **Relevance (1–10):** How relevant is this post to Prismatic's
   product space? 10 = directly asking about embedded iPaaS or
   building native SaaS integrations. 1 = completely unrelated.

2. **Engagement Fit (1–10):** How natural and appropriate would it be
   for a Developer Advocate to comment on this post with general
   helpful advice (NOT promoting Prismatic)? Consider: Is the poster
   asking a question? Is there an opportunity to offer genuine
   expertise? Would a comment feel welcome or intrusive? 10 = perfect
   opportunity to be helpful. 1 = no natural opening.

Respond in this exact JSON format and nothing else:
{
  "relevance_score": <int>,
  "engagement_score": <int>,
  "combined_score": <int>,
  "reasoning": "<2-3 sentences explaining both scores>",
  "prismatic_opportunity": <boolean>,
  "suggested_angle": "<1 sentence: what kind of comment would be appropriate, or 'N/A' if engagement score < 4>"
}

The combined_score is the higher of the two individual scores (since
a post can be worth engaging with even if Prismatic isn't relevant,
and vice versa).
```

- **User message:** Pass in the parsed post title, snippet, source, and subreddit

#### Step 3: Post to Slack (`#community-engagement`)
- Parse Claude's JSON response
- Format a Slack Block Kit message:

```
For combined_score >= 7 (high priority):
  🔴 [SCORE: 9] | Reddit — r/saas
  **Post Title Here**
  > "First ~150 chars of post snippet..."
  
  📊 Relevance: 8 | Engagement: 9
  🧠 Reasoning: "This person is asking about building customer-facing
     integrations for their SaaS — core Prismatic territory..."
  💡 Angle: "Share experience with embedded integration patterns"
  🏷️ Prismatic Opportunity: Yes
  🔗 <post_url|View Post>
  
  React with 👀 to get a draft response.

For combined_score 4–6 (medium):
  🟡 [SCORE: 5] | Reddit — r/webdev
  (same format, less visual weight)

For combined_score <= 3 (low):
  ⚪ [SCORE: 2] | HN
  (condensed single-line format — title + link + one-line reasoning)
```

- Store the `post_url`, `post_title`, `post_snippet`, `source_platform`, and scores as metadata in the Slack message (use Slack Block Kit `action` blocks or encode in the message for retrieval by Flow 2)

---

### Flow 2: Draft Response Flow

#### Trigger
- **Type:** Prismatic's Slack connector — "Events API Webhook" trigger (`key: webhook`)
- **Event:** `reaction_added` (standard Slack Events API event)
- **Setup requirements:**
  - Subscribe to `reaction_added` in your Slack app's Event Subscriptions settings
  - Request the `reactions:read` OAuth scope
  - The Prismatic trigger auto-handles Slack's URL verification challenge and routes requests into branches: URL Verify (initial challenge), Notification (actual events), and Management (external testing)
  - Since Slack allows only one webhook URL per app, if you later expand this to multi-customer, you'd need Prismatic's Single-Endpoint Webhook Integration pattern — but for your solo use this is not a concern
- **Filter within the flow:** Only proceed when the emoji is `👀` AND the message is in `#community-engagement`

#### Step 1: Retrieve Original Post Context
- From the reaction event, get the message `ts` (timestamp) to identify which scored message was reacted to
- Extract the `post_url` from the message (parse it from the Block Kit blocks or message text)
- **Optional but recommended:** Use an HTTP GET step to fetch the actual Reddit/dev.to post content from the URL (Reddit has a JSON API: append `.json` to any Reddit URL). This gives Claude the full post + comments for better context.

#### Step 2: Call Claude API (Drafting)
- **Endpoint:** Same as above
- **Model:** `claude-sonnet-4-20250514`
- **System prompt:**

```
You are helping a Developer Advocate named Munz draft a reply to a
community post. Munz works at Prismatic (an embedded iPaaS) but the
goal right now is NOT to promote Prismatic. The goal is to be a
genuinely helpful community member who builds reputation through
useful contributions.

Guidelines for the draft:
- Be helpful, specific, and practical — offer real advice or insight
- Sound like a real person, not a corporate account
- Match the tone of the subreddit/community (casual for r/webdev,
  more technical for r/ExperiencedDevs, etc.)
- NEVER mention Prismatic unless the post is explicitly asking for
  embedded iPaaS recommendations
- If the post IS asking about integration platforms, be transparent:
  "I work at Prismatic so I'm biased, but..." — honesty first
- Keep it concise — Reddit rewards succinct, high-signal comments
- If there's a relevant personal experience angle, use it
- Include a brief note at the end (separated by ---) explaining your
  reasoning for the approach taken

Respond with:
DRAFT:
<the comment text>

---
NOTES:
<why you took this angle, and any suggestions for Munz>
```

- **User message:** Include the post title, full post body (if fetched), subreddit/source, and the original scoring reasoning from Flow 1

#### Step 3: Reply in Slack Thread
- Post Claude's draft as a threaded reply to the original scored message in `#community-engagement`
- Format cleanly — put the draft in a code block or quote block so it's easy to copy-paste
- Include the NOTES section below the draft (outside the quote block)

---

## Claude Code Implementation Notes

When building this in Claude Code, here's the suggested approach:

### Project Structure
```
refract/
├── prismatic/
│   ├── scoring-flow/
│   │   ├── index.ts          # Main flow definition
│   │   ├── parse-syften.ts   # Syften message parser
│   │   ├── claude-scorer.ts  # Claude API scoring logic
│   │   ├── slack-formatter.ts # Block Kit message builder
│   │   └── prompts.ts        # System prompts (keep separate for easy tuning)
│   ├── drafting-flow/
│   │   ├── index.ts          # Main flow definition
│   │   ├── fetch-post.ts     # Reddit/dev.to content fetcher
│   │   ├── claude-drafter.ts # Claude API drafting logic
│   │   └── prompts.ts        # System prompts
│   └── shared/
│       ├── claude-client.ts  # Shared Anthropic API wrapper
│       ├── slack-client.ts   # Shared Slack posting utilities
│       └── types.ts          # TypeScript interfaces
├── package.json
├── tsconfig.json
└── README.md
```

### Build Order for Claude Code
1. Start with `shared/claude-client.ts` — a simple wrapper around the Anthropic API
2. Build `parse-syften.ts` — test with real Syften message samples
3. Build `claude-scorer.ts` + `prompts.ts` — test scoring in isolation
4. Build `slack-formatter.ts` — get the Block Kit formatting right
5. Wire up the scoring flow in `index.ts`
6. Deploy and test scoring end-to-end
7. Then build the drafting flow following the same pattern

### Key Technical Decisions
- **Use Prismatic's HTTP component** for Claude API calls (simple POST requests — no need for a custom Anthropic component)
- **Use Prismatic's Slack component** for posting messages and subscribing to events
- **Store the Anthropic API key** as a Prismatic config variable (encrypted)
- **Error handling:** If Claude returns malformed JSON, catch it and post a "scoring failed" message to Slack with the raw response for debugging
- **Rate limiting:** Syften may burst multiple posts at once. Add a small delay or queue if you hit Anthropic rate limits.

### Prompt Tuning Tips
- The system prompts above are starting points — you'll want to iterate
- Keep prompts in a separate `prompts.ts` file so you can tweak without touching flow logic
- After a week of running, review the scores and adjust the rubric based on what you're actually finding useful vs. noise
- Consider adding example posts with ideal scores to the prompt (few-shot) once you have real data

---

## Future Enhancements (Not for V1)

- **`/refract-digest` slash command:** A Slack slash command that generates an on-demand summary of all mentions from the last 24 hours. Claude reviews the full batch and returns a ranked shortlist of the highest-priority items to address, with a one-line recommendation for each ("answer this one first — clear question, no good answers yet") and a direct link to the scored message in `#community-engagement`. Useful for a morning review routine or catching up after time away.
- **Tracking:** Log which posts you actually responded to and how they performed (upvotes, replies) — could feed back into scoring
- **Auto-fetch full post content** for the scoring step too (not just drafting) for better accuracy
- **Weekly digest:** Summarize engagement metrics and top-scoring posts
- **Multi-person support:** Let teammates also react and get drafts, with tone customization per person
- **Prismatic showcase:** Once working, this becomes a great demo/content piece — "How we built Refract: our DevRel engagement pipeline on our own platform"
