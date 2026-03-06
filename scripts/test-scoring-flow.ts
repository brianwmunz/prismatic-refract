/**
 * scripts/test-scoring-flow.ts
 *
 * End-to-end test for Flow 1 (Scoring Flow) using the real Syften payload
 * examples from the project kickoff.
 *
 * Runs three stages and prints results at each one so you can see exactly
 * what happens at every step of the pipeline:
 *
 *   Stage 1 — Parse     (no API required)
 *   Stage 2 — Score     (requires ANTHROPIC_API_KEY)
 *   Stage 3 — Format    (no API required — prints Block Kit, no Slack post)
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... npm run test:scoring
 */

import { parseSyftenPayload, describeMention } from "../prismatic/scoring-flow/parse-syften.js";
import { scoreMention } from "../prismatic/scoring-flow/claude-scorer.js";
import { formatScoredMention } from "../prismatic/scoring-flow/slack-formatter.js";
import { createClaudeClient } from "../prismatic/shared/claude-client.js";

// ---------------------------------------------------------------------------
// Sample payloads — the real examples from the Syften webhook
// ---------------------------------------------------------------------------

const SAMPLE_POST_PAYLOAD = [
  {
    backend: "Reddit",
    backend_sub: "r/SaaS",
    type: "post",
    icon_url: "https://www.redditstatic.com/shreddit/assets/favicon/192x192.png",
    timestamp: "2026-03-03T16:53:58Z",
    item_url: "https://www.reddit.com/r/SaaS/comments/1rjujws/new_research_on_what_saas_buyers_think_about/",
    author: "Jazzlike_Set_892",
    text: `There's always been lots of surveys and studies out there that show buyers think integrations are a top priority when purchasing a tool, and also when deciding whether to keep a tool. Most buyers want to make sure that if they buy a tool, it integrates well with all the other tools that they use.

New research from Pandium looks at more than just numbers - it shows interviews with people that buy and use SaaS tools all the time.

Some interesting points in it:

* One user found that because an integration didn't work as intended, they lost about $200,000 of pipeline from their systems and had to back-calculate. They then decided to switch tools because of the messed up integration.
* People were willing to walk away from tools - even though they'd committed to many more months in their contract - it just wasn't work using it if the integration was going to not work.
* One user said the very first thing she looks at when she comes to a company is what tools integrate cleanly - and if it doesn't integrate well she cuts that tool.
* Buyers really feel it when the integration isn't designed well and doesn't take into account how people actually use the tools.
* When integrations are done well - they have huge impact on the buyers and make them very committed to the tool.
* No-one wants to have to build their own integrations through tools like Zapier and Workato. And they don't like integrations that are built by vendors through these tools either.`,
    title: "New research on what SaaS buyers think about integrations",
    title_type: 0,
    meta: {},
    lang: "en",
    filter: "site:reddit.com/r/saas/ site:reddit.com/r/devops/ site:reddit.com/r/startups/ site:reddit.com/r/webdev/ workato",
  },
];

const SAMPLE_COMMENT_PAYLOAD = [
  {
    backend: "Reddit",
    backend_sub: "r/SaaS",
    type: "comment",
    icon_url: "https://www.redditstatic.com/shreddit/assets/favicon/192x192.png",
    timestamp: "2026-03-03T17:05:25Z",
    item_url: "https://www.reddit.com/r/SaaS/comments/1rjujws/new_research_on_what_saas_buyers_think_about/o8fuk7m/",
    author: "ycfra",
    text: "the zapier/workato point is huge. when i evaluate tools for my stack the first thing i check is whether integrations are native or duct-taped through middleware. native integrations signal the team actually thought about how their product fits into a real workflow. middleware integrations signal they shipped fast and figured they'd deal with it later.",
    title: "New Research On What Saas Buyers Think About",
    title_type: 1,
    meta: {},
    lang: "en",
    filter: "site:reddit.com/r/saas/ site:reddit.com/r/devops/ site:reddit.com/r/startups/ site:reddit.com/r/webdev/ workato",
  },
];

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

async function main() {
  print.header("REFRACT — SCORING FLOW TEST");

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    print.error(
      "ANTHROPIC_API_KEY is not set.\n" +
      "  Run with: ANTHROPIC_API_KEY=sk-ant-... npm run test:scoring\n" +
      "  Stage 1 (parse) and Stage 3 (format) will still run using mock scores."
    );
  }

  // ─── Stage 1: Parse ───────────────────────────────────────────────────────

  print.stage("1", "Parse");

  // Combine both payloads into one batch to simulate Syften sending multiple
  // mentions (though in practice each webhook call typically has one).
  const combinedPayload = [...SAMPLE_POST_PAYLOAD, ...SAMPLE_COMMENT_PAYLOAD];
  const mentions = parseSyftenPayload(combinedPayload);

  print.ok(`Parsed ${mentions.length} mention(s)`);
  for (const m of mentions) {
    print.bullet(describeMention(m));
    print.indent(`type: ${m.type} | lang: ${m.lang} | filter matched: ...${m.filter.slice(-20)}`);
  }

  // ─── Stage 2: Score ───────────────────────────────────────────────────────

  print.stage("2", "Score  (Claude API)");

  if (!apiKey) {
    print.skip("Skipping — no ANTHROPIC_API_KEY");
  } else {
    const client = createClaudeClient(apiKey);

    // Score each mention individually so we can show per-mention output
    for (const mention of mentions) {
      print.info(`Scoring: ${describeMention(mention)}`);

      try {
        const scored = await scoreMention(client, mention);
        const s = scored.scoring;

        print.ok(`combined_score: ${s.combined_score}  (relevance: ${s.relevance_score} | engagement: ${s.engagement_score})`);
        print.indent(`reasoning:     ${s.reasoning}`);
        print.indent(`angle:         ${s.suggested_angle}`);
        print.indent(`prismatic opp: ${s.prismatic_opportunity}`);

        // Stage 3 runs inside the scoring loop so we pair each score with
        // its formatted output
        // Show whether this mention would pass the default threshold
  const minScore = 5;
  if (s.combined_score < minScore) {
    print.skip(`Score ${s.combined_score} is below threshold (${minScore}) — would be filtered out, not posted to Slack.`);
    continue;
  }

  print.stage("3", `Format  →  mention: "${mention.title.slice(0, 50)}…"`);

        const message = formatScoredMention(scored, "#community-engagement");

        print.ok(`Priority tier: ${priorityLabel(s.combined_score)}`);
        print.ok(`Fallback text: ${message.text}`);
        print.ok(`Block count:   ${message.blocks.length}`);
        print.info("Block Kit preview:");

        for (const [i, block] of message.blocks.entries()) {
          const preview = blockPreview(block);
          print.indent(`[${i + 1}] ${block.type}${block.block_id ? ` (id: ${block.block_id})` : ""}: ${preview}`);
        }
      } catch (err) {
        print.error(`Failed: ${err instanceof Error ? err.message : String(err)}`);
      }

      console.log(); // spacing between mentions
    }
  }

  // If no API key, still show the formatter works using a fake score
  if (!apiKey) {
    print.stage("3", "Format  (using mock scores — no API key)");

    const mockScored = {
      mention: mentions[0],
      scoring: {
        relevance_score:      8,
        engagement_score:     7,
        combined_score:       8,
        engagement_type:      "prismatic" as const,
        prismatic_relevance:  "medium" as const,
        authenticity:         "Appears genuine: specific question with personal context.",
        reasoning:            "Mock reasoning — set ANTHROPIC_API_KEY for real scoring.",
        prismatic_opportunity: true,
        low_hanging_fruit:    true,
        suggested_angle:      "Mock angle.",
      },
    };

    const message = formatScoredMention(mockScored, "#community-engagement");
    print.ok(`Priority tier: ${priorityLabel(mockScored.scoring.combined_score)}`);
    print.ok(`Block count:   ${message.blocks.length}`);
    print.info("Block Kit preview:");
    for (const [i, block] of message.blocks.entries()) {
      print.indent(`[${i + 1}] ${block.type}${block.block_id ? ` (id: ${block.block_id})` : ""}: ${blockPreview(block)}`);
    }
  }

  print.footer("Done");
}

// ---------------------------------------------------------------------------
// Output helpers — keeps the test logic clean and readable
// ---------------------------------------------------------------------------

const DIVIDER = "─".repeat(60);
const BOLD_DIVIDER = "═".repeat(60);

const print = {
  header: (msg: string) => {
    console.log(`\n${BOLD_DIVIDER}`);
    console.log(` ${msg}`);
    console.log(`${BOLD_DIVIDER}\n`);
  },
  footer: (msg: string) => {
    console.log(`\n${BOLD_DIVIDER}`);
    console.log(` ✓ ${msg}`);
    console.log(`${BOLD_DIVIDER}\n`);
  },
  stage: (num: string, name: string) => {
    console.log(`\nSTAGE ${num}: ${name}`);
    console.log(DIVIDER);
  },
  ok:     (msg: string) => console.log(`  ✓ ${msg}`),
  info:   (msg: string) => console.log(`  → ${msg}`),
  bullet: (msg: string) => console.log(`  • ${msg}`),
  indent: (msg: string) => console.log(`    ${msg}`),
  skip:   (msg: string) => console.log(`  ⚠  ${msg}`),
  error:  (msg: string) => console.error(`  ✗ ${msg}`),
};

function priorityLabel(score: number): string {
  if (score >= 7) return "🔴 HIGH";
  if (score > 3)  return "🟡 MEDIUM";
  return "⚪ LOW";
}

// Produce a short readable summary of a block's content for the preview
function blockPreview(block: Record<string, unknown>): string {
  if (block.type === "divider") return "(divider)";

  // Most blocks have a text field nested inside
  const textField =
    (block.text as Record<string, unknown> | undefined)?.text ??
    ((block.elements as Array<Record<string, unknown>> | undefined)?.[0]?.text);

  if (typeof textField === "string") {
    return `"${textField.replace(/\n/g, "↵").slice(0, 80)}${textField.length > 80 ? "…" : ""}"`;
  }

  return "(no preview)";
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

main().catch((err) => {
  console.error("\nUnhandled error in test script:", err);
  process.exit(1);
});
