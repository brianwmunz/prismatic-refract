# Refract

A DevRel community engagement pipeline built on [Prismatic](https://prismatic.io).

Refract monitors developer communities (Reddit, HN, dev.to, etc.) via [Syften](https://syften.com), scores each mention with Claude, surfaces the best opportunities in Slack, and drafts replies on demand — all with one emoji reaction.

---

## How it works

Refract runs two Prismatic flows:

```
Syften (webhook)
    │
    ▼
Flow 1 — Scoring
    │  Parse mention → Score with Claude → Filter low-signal → Post to #community-engagement
    │
    │   You react with 👀 on a post worth replying to
    ▼
Flow 2 — Drafting
       Fetch full post from Reddit → Draft reply with Claude → Post to Slack thread
```

### Two engagement types

Claude classifies every mention into one of two categories:

| Type | What it means | What to do |
|---|---|---|
| 🎯 **Prismatic Opportunity** | Directly about integrations, iPaaS, or topics where Prismatic expertise applies | Share expertise; point to Prismatic or Prismatic content when genuinely appropriate |
| 💬 **General Engagement** | A chance to be helpful and build community reputation, even if off-topic | Be useful; don't mention Prismatic |

Within Prismatic Opportunities, Claude flags **🍎 Low Hanging Fruit** — posts with a clear question and a clear answer available. These are the highest-priority items to address.

### Scoring and filtering

Every mention gets two scores (1–10):
- **Relevance** — how close is this to Prismatic's product space?
- **Engagement** — how much value would a thoughtful reply add?

The `combined_score` is the higher of the two. Mentions scoring below the threshold (default: **5**) are dropped silently and never reach Slack.

---

## Project structure

```
prismatic-refract/
│
├── prismatic/
│   ├── scoring-flow/
│   │   ├── index.ts          # Flow 1 orchestrator
│   │   ├── parse-syften.ts   # Validates and parses Syften webhook payload
│   │   ├── prompts.ts        # Scoring system prompt + user message builder
│   │   ├── claude-scorer.ts  # Calls Claude, returns ScoredMention
│   │   └── slack-formatter.ts # Builds Slack Block Kit messages
│   │
│   ├── drafting-flow/
│   │   ├── index.ts          # Flow 2 orchestrator (triggered by 👀 reaction)
│   │   ├── fetch-post.ts     # Fetches full post content from Reddit JSON API
│   │   ├── prompts.ts        # Drafting system prompt + user message builder
│   │   └── claude-drafter.ts # Calls Claude, parses DRAFT / NOTES response
│   │
│   └── shared/
│       ├── types.ts          # All TypeScript interfaces
│       ├── claude-client.ts  # Anthropic API wrapper
│       └── slack-client.ts   # Slack Web API wrapper
│
├── scripts/
│   └── test-scoring-flow.ts  # End-to-end test for Flow 1 (no Slack required)
│
├── devrel-engagement-plan.md # Full project plan and architecture notes
├── package.json
└── tsconfig.json
```

---

## Prerequisites

- **Node.js 18+** (native `fetch` required; tested on Node 25)
- **Anthropic API key** — get one at [console.anthropic.com](https://console.anthropic.com)
- **Syften PRO account** — needed for webhook delivery
- **Slack workspace** with a bot app configured (see [Prismatic setup](#prismatic-setup))
- **Prismatic account** — [prismatic.io](https://prismatic.io)

---

## Local setup

```bash
# Clone and install
git clone <repo-url>
cd prismatic-refract
npm install
```

---

## Running the test script

The test script runs the full scoring pipeline against real Syften sample payloads. It does **not** post to Slack — it prints formatted Block Kit output so you can verify scoring and formatting locally.

```bash
# Set your API key as an environment variable — never paste it in chat or commit it
export ANTHROPIC_API_KEY=sk-ant-...

npm run test:scoring
```

**Example output:**

```
STAGE 1: Parse
  ✓ Parsed 2 mention(s)
  • Reddit post in r/SaaS by Jazzlike_Set_892

STAGE 2: Score  (Claude API)
  ✓ combined_score: 10  (relevance: 10 | engagement: 8)
    reasoning: This is directly in Prismatic's core space...
    angle:     Share insights on integration strategy...

STAGE 3: Format
  ✓ Priority tier: 🔴 HIGH
  ✓ Block count: 7
```

---

## Configuration

Both flows are configured via environment variables locally and Prismatic config variables in production. All secrets are injected at runtime — nothing is hardcoded.

| Variable | Used in | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Both flows | Anthropic API key (`sk-ant-...`) |
| `SLACK_BOT_TOKEN` | Both flows | Slack bot OAuth token (`xoxb-...`) |
| `SLACK_CHANNEL` | Both flows | Channel ID for `#community-engagement` |

### Tuning the score threshold

In `prismatic/scoring-flow/index.ts`, the default minimum score is **5**. You can override it when calling `runScoringFlow`:

```typescript
await runScoringFlow(webhookBody, {
  anthropicApiKey: "...",
  slackBotToken:   "...",
  slackChannel:    "...",
  minScore:        6,  // raise to reduce noise, lower to see more
});
```

---

## Tuning the prompts

All Claude instructions live in standalone `prompts.ts` files — separate from flow logic so you can tune them without touching anything else.

| File | What to tune |
|---|---|
| `scoring-flow/prompts.ts` | Scoring rubric, Prismatic's relevant topic areas, how the two engagement types are defined |
| `drafting-flow/prompts.ts` | Voice and tone guidelines, when to mention Prismatic, draft length |

After a week of real data, review which scores felt accurate and adjust the rubric. Adding a few example posts with ideal scores (few-shot prompting) is a good next step once you have real data.

---

## Prismatic setup

See [devrel-engagement-plan.md](./devrel-engagement-plan.md) for the full architecture. High-level steps:

1. **Install the `prism` CLI** and authenticate with your Prismatic account
2. **Wrap the flows** with Prismatic's `@prismatic-io/spectral` SDK to define triggers, steps, and config variables
3. **Deploy** — Prismatic gives you HTTPS webhook endpoints for each flow
4. **Configure Syften** — point its webhook at Flow 1's endpoint
5. **Configure the Slack app** — subscribe to `reaction_added` events, point at Flow 2's endpoint
6. **Store secrets** as encrypted Prismatic config variables

---

## Syften webhook payload

Syften delivers mentions as a JSON array. Each item looks like:

```json
{
  "backend":     "Reddit",
  "backend_sub": "r/SaaS",
  "type":        "post",
  "item_url":    "https://reddit.com/r/SaaS/comments/...",
  "author":      "username",
  "title":       "Post title",
  "text":        "Full post body...",
  "timestamp":   "2026-03-03T16:53:58Z",
  "filter":      "the syften filter query that matched",
  "meta":        {}
}
```

`meta` is populated with AI verdict fields (`ai_accepted`, `ai_reason`) when Syften's AI filtering is enabled on a filter.

---

## Build walkthrough

This section documents how Refract was built from scratch — every file, command, and decision — so you can follow the same steps or teach the pattern to others.

---

### Phase 1: Project foundation

**Goal:** A TypeScript project that can be tested locally with `tsx` and compiled with `tsc`.

```bash
# Create the project directory
mkdir prismatic-refract && cd prismatic-refract

# Create the directory structure
mkdir -p prismatic/scoring-flow prismatic/drafting-flow prismatic/shared scripts
```

**`package.json`** — two runtime dependencies, `tsx` for running TypeScript directly:

```json
{
  "scripts": {
    "build": "tsc",
    "test:scoring": "tsx scripts/test-scoring-flow.ts"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.39.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsx": "^4.21.0",
    "typescript": "^5.7.0"
  }
}
```

```bash
npm install
```

**`tsconfig.json`** — key decision: `"module": "NodeNext"` with `.js` extensions in all import paths. This is the modern TypeScript ESM setup and is required for `tsx` to resolve imports correctly. Note: this is different from the Prismatic integration's tsconfig, which uses `"moduleResolution": "node"` (see Phase 6).

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./dist",
    "strict": true,
    "esModuleInterop": true
  },
  "include": ["prismatic/**/*.ts", "scripts/**/*.ts"]
}
```

> **Teaching point:** NodeNext module resolution requires that all local imports use `.js` file extensions even though the actual files are `.ts`. TypeScript resolves `.js` → `.ts` at compile time. This is a common source of confusion but is the correct modern approach.

---

### Phase 2: Shared layer

Three files that both flows depend on.

**`prismatic/shared/types.ts`** — all TypeScript interfaces in one place. Defines `SyftenMention`, `ScoringResult`, `DraftResult`, and `ScoredMention`. Start here because every other file imports from it.

**`prismatic/shared/claude-client.ts`** — a wrapper around the Anthropic SDK with three exports:
- `createClaudeClient(apiKey)` — factory, takes a key string
- `callClaudeForScore(client, systemPrompt, userMessage, model?)` — calls Claude, parses JSON response into `ScoringResult`, validates required fields
- `draftResponse(client, systemPrompt, userMessage, model?)` — calls Claude, returns raw text

**`prismatic/shared/slack-client.ts`** — HTTP wrapper for two Slack API methods:
- `postMessage(token, payload)` — posts to a channel, returns the message `ts` (timestamp)
- `postThreadReply(token, channel, threadTs, text, blocks?)` — posts a reply in a thread
- `fetchMessage(token, channel, ts)` — retrieves a specific message by its timestamp (used by Flow 2)

> **Teaching point:** We use Node's built-in `fetch` (available since Node 18) instead of the `@slack/web-api` SDK to keep dependencies minimal and make the HTTP calls visible and teachable. All Slack API methods follow the same pattern: `POST https://slack.com/api/<method>` with a JSON body and `Authorization: Bearer <token>` header.

---

### Phase 3: Scoring flow (Flow 1)

Built in this order so each file can be tested before the next depends on it.

#### `prismatic/scoring-flow/parse-syften.ts`

Parses and validates the raw Syften webhook body.

Key decisions:
- Accepts `unknown` input (string or pre-parsed object) — Prismatic delivers webhook bodies as strings
- Syften always sends an **array**, even for a single mention — `parseSyftenPayload()` always returns `SyftenMention[]`
- Uses a **discriminated union** for validation results (`{ ok: true, mention } | { ok: false, error }`) instead of try/catch — cleaner for expected failures
- Invalid items are logged and skipped; a bad mention doesn't kill the whole batch

#### `prismatic/scoring-flow/prompts.ts`

Contains everything Claude sees: the system prompt, model constant, and user message builder. Keeping prompts in their own file means you can tune the scoring rubric without touching any flow logic.

The prompt defines **two engagement types**:
- **General** — build community reputation, be helpful regardless of topic
- **Prismatic** — integrations/iPaaS space, can reference expertise or point to Prismatic

It also defines **Low Hanging Fruit** criteria: clear question + available answer + not already covered + Munz/Prismatic can answer it clearly.

#### `prismatic/scoring-flow/claude-scorer.ts`

Two exports:
- `scoreMention(client, mention)` — scores one mention, returns `ScoredMention` (mention + scoring bundled)
- `scoreMentions(client, mentions[])` — scores a batch using `Promise.allSettled` so one failure doesn't block others

> **Teaching point:** `Promise.allSettled` vs `Promise.all` — `allSettled` resolves when every promise settles (fulfilled or rejected), while `all` rejects as soon as any one fails. For batch processing where partial success is acceptable, always use `allSettled`.

#### `prismatic/scoring-flow/slack-formatter.ts`

Builds Slack Block Kit message payloads from a `ScoredMention`. Three priority tiers:
- 🔴 **High** (`combined_score >= 7`) — full detail layout
- 🟡 **Medium** (`4–6`) — same layout, quieter indicator
- ⚪ **Low** (`<= 3`) — condensed single line

> **Teaching point:** High and medium share one `buildFullBlocks()` function with the indicator emoji as a parameter — avoids duplicating 30 lines of Block Kit structure just to change one character.

Every message includes a `refract_metadata` context block (`block_id: "refract_metadata"`) containing JSON with the post URL, scores, and reasoning. Flow 2 finds this block by ID when it needs to reconstruct context.

> **Teaching point:** Using `block_id` to identify a specific block is more robust than relying on array position. Slack guarantees block IDs are unique within a message.

#### `prismatic/scoring-flow/index.ts`

The orchestrator. Connects all four modules:

```
parseSyftenPayload()
  → scoreMentions()     [Claude API]
  → filter by minScore
  → formatScoredMention()
  → postMessage()       [Slack API]
```

Errors at any stage post an alert to Slack rather than failing silently. Sequential posting (`for...of` not `Promise.all`) avoids channel flooding if Syften sends a burst.

---

### Phase 4: Drafting flow (Flow 2)

#### `prismatic/drafting-flow/prompts.ts`

Same structure as the scoring prompts. Voice guidelines for Claude: sound like a real person, match the subreddit register, never mention Prismatic unprompted, be transparent ("I work at Prismatic so I'm biased") if directly asked about iPaaS tools.

#### `prismatic/drafting-flow/fetch-post.ts`

Fetches full post content from Reddit's public JSON API.

```
Reddit URL:  https://reddit.com/r/saas/comments/abc123/title/
JSON API:    https://reddit.com/r/saas/comments/abc123/title/.json?raw_json=1
```

Returns an array of two listings: `[0]` = post data, `[1]` = comment tree. We extract the post body and top 5 comments by score.

> **Teaching point:** Reddit's JSON API requires a non-empty `User-Agent` header or it returns `429 Too Many Requests`. Always set one when calling the Reddit API unauthenticated.

Returns `null` on failure — the drafting flow degrades gracefully and Claude uses the Syften snippet instead.

#### `prismatic/drafting-flow/claude-drafter.ts`

Claude is asked to return plain text in a structured format (not JSON) because drafts contain quotes, newlines, and markdown that JSON-encoding reliably mangles:

```
DRAFT:
<the comment text>

---
NOTES:
<reasoning and suggestions for Munz>
```

`parseDraftResponse()` splits on the `\n---\n` separator. If Claude omits the separator, the whole response is treated as the draft rather than throwing.

#### `prismatic/drafting-flow/index.ts`

The orchestrator. Handles the full lifecycle:

1. Validate event: only proceed if `reaction === "eyes"` AND channel matches
2. Fetch the original Slack message by `ts`
3. Find and parse the `refract_metadata` block
4. Fetch full post content (best-effort)
5. Draft with Claude
6. Post draft + notes as a thread reply

---

### Phase 5: Testing locally

```bash
# Add tsx to run TypeScript directly without compiling
npm install --save-dev tsx

# Set your API key — never hardcode it, never paste it in chat
export ANTHROPIC_API_KEY=sk-ant-...

# Run the scoring flow test
npm run test:scoring
```

The test script (`scripts/test-scoring-flow.ts`) runs three stages and prints results at each one:
- **Stage 1** (no API needed): parse the two real Syften example payloads
- **Stage 2** (calls Claude): score each mention and print reasoning
- **Stage 3** (no API needed): format as Block Kit and print block-by-block preview

If `ANTHROPIC_API_KEY` is not set, stages 1 and 3 still run using mock scores so you can verify parsing and formatting without API access.

---

### Phase 6: Prismatic integration

**Goal:** Wrap the standalone TypeScript in Prismatic's `@prismatic-io/spectral` SDK, deploy as a code-native integration, and get live HTTPS webhook endpoints.

#### Install and authenticate

```bash
# Install the Prismatic CLI
npm install -g @prismatic-io/prism

# Log in (opens browser)
prism login

# Verify login
prism me
```

#### Initialize the code-native integration scaffold

```bash
# Run from the project root — creates an integration/ subdirectory
prism integrations:init integration --clean

# Install integration dependencies
cd integration && npm install

# Add the Anthropic SDK (needed since our business logic imports it)
npm install @anthropic-ai/sdk
```

The scaffold creates:
```
integration/
├── src/
│   ├── index.ts          # Integration definition
│   ├── flows.ts          # Flow definitions (onTrigger + onExecution)
│   ├── configPages.ts    # Config wizard shown when deploying an instance
│   ├── componentRegistry.ts
│   └── client.ts
├── webpack.config.js     # Bundles everything to dist/index.js
├── tsconfig.json
└── package.json
```

#### Configure webpack to work with the parent directory

The scaffold's default webpack config only looks in `integration/`. Our business logic lives in `prismatic/` one level up. Two additions to `webpack.config.js`:

```js
resolve: {
  extensions: [".ts", ".js"],
  // Our parent-directory code uses NodeNext .js extensions in imports.
  // This tells webpack to look for the .ts file when it sees a .js import.
  extensionAlias: {
    ".js": [".ts", ".js"],
  },
  // Allow webpack to find node_modules from the project root
  modules: ["node_modules", path.resolve(__dirname, "../node_modules")],
},
```

Also update the integration's `tsconfig.json` to include the parent TypeScript files:

```json
"include": ["src", ".spectral/*", "../prismatic/**/*.ts"]
```

#### Two spectral API gotchas

**1. No "password" dataType for configVar**

The `configVar` type does not accept `"password"` as a `dataType`. Use `"string"` instead. Prismatic encrypts all config variables at rest — the masking behavior in the UI is controlled separately.

```typescript
// ❌ This throws a TypeScript error
configVar({ dataType: "password" })

// ✅ Correct
configVar({ dataType: "string" })
```

**2. Accessing the webhook body in `onExecution`**

In Prismatic code-native flows, data passes from `onTrigger` into `onExecution` through `params`, not through `context`. The exact path to the webhook body is:

```typescript
// ❌ context.trigger does not exist in onExecution
const body = context.trigger.payload.body.data;

// ✅ Correct — params carries what onTrigger returned
onExecution: async (context, params) => {
  const body = params.onTrigger.results.body.data;
}
```

The `onTrigger` function returns `{ payload }`, and spectral makes the entire trigger payload available at `params.onTrigger.results`.

#### Build and deploy

```bash
# From the integration/ directory
npm run build       # Runs webpack → produces dist/index.js

# Import to your Prismatic org
prism integrations:import

# Open the integration in the Prismatic designer
prism integrations:open <integrationId>
# The integration ID is saved in integration/.spectral/prism.json after import
```

#### After each code change

```bash
# Rebuild and re-import in one step (defined in integration/package.json)
npm run import
```

---

### Phase 7: Publishing and deploying to production

Once both flows are tested in the designer, publish a versioned release and deploy it as a live instance.

#### Publish the integration

Publishing creates an immutable version that can be deployed to instances. Do this after every set of changes you want to promote to production.

```bash
# From the integration/ directory (after running npm run import)
prism integrations:publish <integrationId> -c "Initial release — scoring and drafting flows"

# The integration ID is in integration/.spectral/prism.json
```

You can also grab the ID programmatically:
```bash
cat integration/.spectral/prism.json
# {"integrationId":"SW50ZWdyYXRpb246..."}
```

#### Create a customer and deploy an instance

In Prismatic, instances are always deployed to a **customer** — even for internal tools. Create a customer to deploy to:

1. In the Prismatic dashboard, go to **Customers** → **Add Customer**
2. Name it something like **DevRel** or **Internal**
3. Click into the customer → **Instances** tab → **Add Instance**
4. Select **Refract** from the integration list
5. Fill in the config variables:
   - **Anthropic API Key** — your `sk-ant-...` key
   - **Slack Bot Token** — your `xoxb-...` token
   - **Slack Channel ID** — the channel ID (e.g. `C0AJ86R6SH4`) — not the channel name
   - **Minimum Score** — `5` (raise to reduce noise, lower to see more)
6. Click **Deploy**

> **Teaching point:** Use the channel **ID**, not the name. The ID is found by right-clicking the channel in Slack → View channel details → bottom of the About tab. The Slack API's `conversations.history` method requires the channel ID — passing a name like `#community-engagement` returns a `channel_not_found` error.

#### Get the webhook URLs

Once the instance is deployed, expand each flow in the **Trigger details** section to reveal its endpoint URL:

- **Score Mention** endpoint — receives Syften webhook payloads
- **Draft Response** endpoint — receives Slack `reaction_added` events

Copy both URLs — you'll need them in the next two steps.

#### Configure Syften

1. Log into Syften → go to **Settings** → **Webhooks** (or the webhook destination setting for your filters)
2. Set the webhook URL to your **Score Mention** endpoint URL
3. Save — every new mention that matches your Syften filters will now POST to Flow 1

#### Configure the Slack Events API

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → your Slack app
2. Click **Event Subscriptions** in the left nav
3. Toggle **Enable Events** on
4. Paste your **Draft Response** endpoint URL into the **Request URL** field
5. Slack sends a `url_verification` challenge — the flow handles it automatically and responds with the correct `challenge` value. The field should show **Verified** within a few seconds.
6. Under **Subscribe to bot events** → **Add Bot User Event** → select `reaction_added`
7. Click **Save Changes**

> **Teaching point:** The `url_verification` challenge is Slack's way of confirming that the URL you registered actually belongs to you. Slack sends a POST with `{"type": "url_verification", "challenge": "<token>"}` and expects the same token back in the response body. We handle this in `integration/src/flows.ts` inside the `onTrigger` function for the Draft Response flow.

The flow is now live. Adding a 👀 reaction to any scored message in `#community-engagement` triggers Flow 2 automatically.

---

### Slack metadata gotcha: use `plain_text`, not `mrkdwn`

One non-obvious issue you'll encounter when storing structured data in Slack messages: **Slack's `mrkdwn` renderer auto-links bare URLs** by wrapping them in `<>` angle brackets.

If you store JSON in a `mrkdwn` context block element:
```json
{"post_url": "https://reddit.com/r/saas/comments/..."}
```

Slack rewrites it to:
```json
{"post_url": "<https://reddit.com/r/saas/comments/...>"}
```

When Flow 2 reads this back and calls `JSON.parse()`, the value is no longer a valid URL — `new URL("<https://...>")` throws.

**Fix:** Use `"type": "plain_text"` for any context block element that contains raw data. Slack passes `plain_text` content through verbatim without processing it.

```typescript
// ❌ Slack auto-links URLs inside mrkdwn, corrupting JSON
{ type: "mrkdwn", text: JSON.stringify(metadata) }

// ✅ plain_text is passed through verbatim
{ type: "plain_text", text: JSON.stringify(metadata) }
```

This applies any time you're embedding machine-readable data (JSON, URLs, IDs) in a Slack message that another system will read back later.

---

### Key architectural decisions

| Decision | Why |
|---|---|
| Business logic in `prismatic/`, Prismatic wrapper in `integration/` | The business logic is framework-agnostic and testable with `tsx` before touching Prismatic |
| Prompts in standalone `prompts.ts` files | Tune Claude's instructions without touching any flow logic |
| `Promise.allSettled` for batch scoring | One bad Claude API call doesn't block the rest of the batch |
| `block_id: "refract_metadata"` on every scored message | Flow 2 finds the metadata by ID, not position — robust to block order changes |
| Plain text `DRAFT: / --- / NOTES:` format for drafting | JSON-encoding long free-form text (with quotes, newlines, markdown) is unreliable; a fixed string delimiter is simpler |
| Score threshold filter before Slack posting | Keeps `#community-engagement` signal-to-noise high; low-value mentions never reach the channel |
| Sequential Slack posting (`for...of` not `Promise.all`) | Prevents channel flooding if Syften delivers a burst of mentions at once |

---

## Future enhancements

See the Future Enhancements section in [devrel-engagement-plan.md](./devrel-engagement-plan.md) for the full list, including:

- **`/refract-digest` slash command** — on-demand summary of the last 24 hours with AI-ranked recommendations
- **Engagement tracking** — log which posts you replied to and how they performed
- **Weekly digest** — summarize top-scoring posts and engagement metrics
- **Multi-person support** — per-person tone customization for teammates
