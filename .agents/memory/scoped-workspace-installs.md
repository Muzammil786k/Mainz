---
name: Scoped workspace installs
description: Dependency installation strategy when one workspace package is blocked by the package firewall.
---

For targeted service work, install and check that workspace package with its dependencies instead of restoring every package when an unrelated workspace dependency is blocked. In Replit monorepos, the language-package installer may target the root and fail with `ERR_PNPM_ADDING_TO_ROOT`; scope changes to the owning workspace instead.

**Why:** A full workspace restore was blocked by the package firewall while fetching an unrelated API-generation dependency, but the API server's filtered workspace install completed. The package installer also defaults to the workspace root rather than inferring the target service.

**How to apply:** Keep dependency changes and verification scoped to the affected `@workspace` package and its workspace dependency graph; do not change unrelated dependencies just to get targeted checks running.
