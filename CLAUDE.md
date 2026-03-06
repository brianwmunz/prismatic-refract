# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Does

**Refract** is a DevRel community engagement pipeline deployed on [Prismatic](https://prismatic.io). It monitors developer communities (Reddit, HN, dev.to, etc.) via [Syften](https://syften.com) webhooks, scores mentions with Claude AI, surfaces high-signal posts to Slack, and enables emoji-driven drafting and logging workflows.

## Commands

### Root (business logic development)
```bash
npm run build          # TypeScript compile
npm run dev            # TypeScript watch mode
npm run test:scoring   # Run local end-to-end scoring test (no Slack needed)
```

### Integration (Prismatic deployment)
```bash
cd integration
npm run build          # webpack bundle → dist/index.js
npm run import         # build + deploy to Prismatic via prism CLI
npm test               # jest unit tests
npm run lint           # eslint
```

### Local testing
```bash
ANTHROPIC_API_KEY=sk-... tsx scripts/test-scoring-flow.ts
```

## Architecture

The repo is split into two layers:

**`prismatic/`** — Framework-agnostic business logic (testable with `tsx` locally):
- `scoring-flow/` — Parses Syften webhook → scores with Claude → filters → posts to Slack
- `drafting-flow/` — Triggered by 👀 reaction → fetches Reddit post → drafts reply with Claude → posts thread
- `logging-flow/` — Triggered by ✅ reaction → creates Notion entry → confirms in thread
- `shared/` — Anthropic/Slack/Notion API clients, shared TypeScript types

**`integration/`** — Prismatic wrapper that exposes the three flows as a deployable integration:
- `src/index.ts` — Integration definition (wraps all flows)
- `src/flows.ts` — Prismatic flow definitions that call into `prismatic/` code
- `src/configPages.ts` — Config wizard UI (API keys, channel IDs, thresholds)
- `webpack.config.js` — Bundles parent directory code into `dist/index.js`

### Cross-flow coordination

Flows communicate via Slack Block ID metadata. When Flow 1 posts a scored message, it embeds JSON in the `block_id` field (`refract_metadata`) containing the post URL, source platform, and scoring data. Flows 2 and 3 read this metadata by fetching the original Slack message and parsing block IDs.

### Config variables

All secrets are injected at runtime via `context.configVars` in Prismatic (not `.env`). Locally, set `ANTHROPIC_API_KEY` before running test scripts.

Key config vars: `ANTHROPIC_API_KEY`, `SLACK_BOT_TOKEN`, `SLACK_CHANNEL`, `NOTION_TOKEN`, `NOTION_DATABASE_ID`, `minScore`, `redditUsername`.

### Prompt files

Each flow has a `prompts.ts` file that contains the system prompt and user prompt templates. Edit these files to tune scoring criteria or drafting tone — they're designed to be the primary tuning surface.

### Module system

TypeScript uses `NodeNext` module resolution throughout. Both `tsconfig.json` files use `"module": "NodeNext"` — imports require explicit `.js` extensions even for `.ts` source files.
