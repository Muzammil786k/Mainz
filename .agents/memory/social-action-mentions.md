---
name: Social action mentions
description: Target-mention behavior for Discord social-action replies.
---

Social action responses must not ping the target member. Show the actor and target by display name in the embed, and disable parsed mentions in the reply.

**Why:** The user asked to remove the target's visible `@mention` from GIF command replies; not pinging them also avoids an unwanted notification.

**How to apply:** Keep mention-based target selection for the command input, but do not emit user mention markup in social-action response content or embeds.
