# Notion contract · проект

IDs and URLs: `docs/setup/notion-ids.md`. ScriptCat uses data source IDs.

## Роли

Source of role authority. Human-managed: role title, Status, Agent URL, Agent Admin and archive/delete. Warden/approved planning may define Function, write zone, gate and repository for non-admin roles. Agent State `запрошен` asks provisioning; it does not activate a role by itself.

A working row needs exact Function understood by ScriptCat (`Executor`, `Auditor`, `Coordinator`, `Reviewer`, `Maintainer`), repository `owner/repo` (задаёт профиль), an explicit zone/gate, `Активна`, and a valid Arena URL. Only Warden is an admin/reviewer role for mission acceptance; engineering roles never receive that privilege by name.

## Миссии

One row per mission ID. Warden owns specification version, phase, final oracle, required roster, status and verdict. Coordinator owns the request queue inside the accepted specification, not the mission's intent or oracle. A draft mission does not dispatch work.

## Запросы

One row per card. Coordinator writes title/role/sequence/dependency/intent/invariants/acceptance/Scope/freedom and moves Draft/Ready/Accepted/Rework. ScriptCat writes Dispatch State, Run ID, recipient identity, started/submitted timestamps, output file and validated PR/check claims. Human edits to transport identity invalidate the attempt.

Dependency means a card UUID from the same mission and must be Accepted. Sequence ordering is deterministic. Rework reuses the same card/sequence; a new card is created only for a genuinely new oracle or Scope.

## Обратная связь

Rows are transport-owned envelopes for questions, answers and ADR proposals. Agents create a question through their result marker, not by writing a row manually. `gate` is an explicit field in the envelope semantics, not inferred from wording. A default is complete and actionable; a timeout is not itself a decision.

## State rules

- Missing/empty status is not silently interpreted as accepted.
- `Running` without a valid run identity is recoverable only by ScriptCat's orphan logic.
- `Submitted` requires a validated marker for that dispatch/run.
- `Accepted` is a card result, not mission acceptance.
- `Пауза` names the blocker; changing the assignee to bypass roster checks is forbidden.
