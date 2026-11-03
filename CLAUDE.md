# Project: cement-distribution

## How we work
This repo is built by an AI team run with `/team`. The main session is the team
lead and only orchestrates; role agents do the work.

- Source of truth for product, design and architecture: `.team/`
- Read HANDOFF blocks before anything else in `.team/` files.
- Build one slice at a time: `/team build next`.
- Never deploy, push, or create cloud resources without my explicit yes.

## Machine constraints (MacBook Air M1, 8GB RAM)
- No Docker Desktop, no local LLMs. Use SQLite locally or a hosted free-tier DB.
- At most 3 agents running at once.
- Dev server only via tmux: `tmux new -d -s dev "npm run dev"`.
- Playwright: headless, `--workers=1`, Chromium only.

## Stack
<filled in from .team/03-architecture.md after kickoff>

## Commands
- install: `npm install`
- test: `npm test`
- e2e: `npx playwright test --workers=1`
- lint/typecheck: `npm run lint && npm run typecheck`
