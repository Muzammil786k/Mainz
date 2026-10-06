---
name: API server runtime
description: Why this API server uses Node's built-in HTTP server instead of Express.
---

Keep the API on Node's built-in HTTP server unless the blocked dependency is cleared and a framework change is explicitly requested. The API currently exposes `/api/healthz`; retain CORS handling and structured request logging when adding or changing routes.

**Why:** Replit's Package Firewall blocked `proxy-addr@2.0.7`, which Express 5.2.1 depends on. `proxy-addr@2.0.7` was already its latest release, so bypassing the firewall or pinning the same package was not a safe option. The user approved removing Express, and the existing API surface only needed its health route.

**How to apply:** Add small API handlers using `node:http`. If future API needs make a framework worthwhile, choose a safe maintained dependency that installs through the package firewall and preserve the existing health route and middleware behavior.
