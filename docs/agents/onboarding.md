# Onboarding an Arena role

1. Warden creates or reviews the Notion role row: exact role name, Function, repository, write zone, gate, active/admin policy.
2. For a non-admin role without an agent, set Agent State to `запрошен`. ScriptCat provisioning remains manual unless the owner explicitly enables auto mode.
3. An active admin role approves only listed `create`/`replace` jobs. It cannot grant admin, delete a row or activate a role.
4. Arena creates the agent. A human verifies the resulting URL, role identity and bootstrap result, then writes Agent URL and activates the row.
5. The new agent reads `AGENTS.md`, `docs/REGULATION.md`, its role document and the active mission before any card.
6. First working card is narrow and has a machine-verifiable oracle. The agent records branch, BASE_SHA and existing dirty state before edits.
7. Coordinator dispatches only after roster, repo route, zone and dependency checks pass.

Secrets and private project instructions are not included in bootstrap prompts. The bootstrap probe is public, reversible and contains no `CF_*`, Notion URL/token, internal regulation token or unpublished product material.

Warden's registered Arena URL is `https://arena.ai/agent/01a1f841-ee82-74a2-aa0b-5b98b012a89d`. Replacing it requires a human-controlled role-row update; ScriptCat must not silently rotate the active reviewer.
