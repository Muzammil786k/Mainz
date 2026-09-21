---
name: Railway monorepo startup
description: Railway/Railpack startup behavior for this pnpm monorepo.
---

Railway should have a root-level `start` script that delegates to the deployable workspace, even when `railway.json` declares a service start command.

**Why:** A Railway build from the GitHub repository reported “No start command detected” despite the repository containing a nested workspace start script and `railway.json`. Root package auto-detection is a safer fallback for this monorepo.

**How to apply:** Keep the root `start` script aligned with the API workspace start command, and verify Railway is deploying the repository root from the latest `main` commit.