---
name: Scoped workspace installs
description: Dependency installation strategy when one workspace package is blocked by the package firewall.
---

For targeted service work, install and check that workspace package with its dependencies instead of restoring every package when an unrelated workspace dependency is blocked.

**Why:** A full workspace restore was blocked by the package firewall while fetching an unrelated API-generation dependency, but the API server's filtered workspace install completed.

**How to apply:** Keep dependency installation and verification scoped to the affected `@workspace` package and its workspace dependency graph; do not change unrelated dependencies just to get targeted checks running.
