# ScriptCat protocol · проект

Transport protocol version: 1.12. ScriptCat release: 1.18.0 (upstream behavior through D-122 plus project-neutral transport, D-003, and Arena account quotas, D-004).

## 1. Identity

Every issued turn has immutable identity:

- mission: `mission_id` + `turn_id`;
- card: `dispatch_id` + `run_id`;
- question: `question_id` + `turn_id`;
- arbiter: original card ID + arbiter `turn_id`.

A reply with missing, placeholder or foreign IDs is not credited. A retry or continuation retains the same identity; it is not a new task.

## 2. Roles and markers

| Function | Full turn | Final marker |
|---|---|---|
| Coordinator | queue plan | `CF_COORDINATOR_RESULT` |
| Executor | implementation | `CF_AGENT_RESULT` |
| Auditor | independent verification | `CF_AGENT_RESULT` |
| Reviewer/Warden | mission acceptance | `CF_REVIEW_RESULT` |
| Reviewer/role | question answer | `CF_ANSWER_RESULT` |
| Reviewer | loop arbitration | `CF_ARBITER_RESULT` |

Marker is the final physical line, with no prose or code fence after it. It never replaces a factual report.

## 3. Prompt budgets

Budgets limit transport instructions, not verbatim task facts. Instructions are never silently truncated; large data is compressed or moved to a payload with an explicit pointer.

Required overhead limits represented by current profiles: ≤2800, ≤2200, ≤3400, ≤1500, ≤2400, ≤1800, ≤2000, ≤700, ≤250 and ≤900 characters. A full prompt also has a hard limit; exceeding it is an explicit transport pause.

The profile names and exact blocks are generated in `tools/script-cat/contracts/prompt-coverage.json`
(that path lives in `Creative36711/relay-wotr`, where the bundle is built). Continuation profiles contain no full assignment and no Git-write authority.

## 4. Ordinary cycle

1. Coordinator sees the current mission queue.
2. It accepts/reworks a submitted card and issues one eligible Ready/Draft card with declared `build: none|focused|full` and `retail: none|reuse|hydrate` Cost gate.
3. ScriptCat resolves the fresh role row, target repo/base and zone.
4. Transport stores run identity and delivers the compiled prompt.
5. Agent reports work and emits the required marker.
6. ScriptCat validates IDs, marker shape, PR claim and role boundary before recording the result.
7. Independent audits run as separate cards.
8. Coordinator sends `next:"done"` only when the mission result is complete.
9. Reviewer runs the mission oracle and returns `accept`, `rework` or `master`.

Running/Submitted and transport identity fields belong to ScriptCat. Coordinator owns Ready/Accepted/Rework and planning fields. Reviewer owns mission verdict, not request execution.

## 5. Questions

A question is the optional `question` object in the same result marker:

```json
{"text":"...","options":["A","B","C"],"default":"full reversible default","gate":false,"need":""}
```

Without `gate`, the current result continues on `default`; an answer arrives in a later turn. `gate:true` is only for a physically blocked next step and requires the exact active role in `need`. Manual chat polls and hand-written feedback rows are not protocol messages.

## 6. Durable-возврат результата по `gate` (D-105)

A gated question does not destroy the original result. ScriptCat stores the result envelope and source role, sends the question, then resumes the original decision with **исходными ID** after the answer. The answer marker may carry `sourceRoleId`; delivery receipts prevent replay or credit to another turn.

The same applies to `CF_REVIEW_RESULT`, `CF_ANSWER_RESULT` and `CF_ARBITER_RESULT` optional questions. A question is additive; required marker fields remain unchanged.

## 7. Delivery and continuation

- Failed Arena submission is retried at most by the configured safeguard and names the real reason.
- Tool-call limit continuation preserves IDs and sends only continuation facts.
- A composer containing text that was not registered by the editor is healed only from `writePrompt` evidence and within the bounded retry count.
- Missing marker receives bounded reminders; work is not re-issued.
- A repeated transport defect routes to Transport Maintainer; access, captcha, browser install and account quota route to the human owner.

## 8. PR claims

`"pr":null,"merged":false` is valid when no Git change was needed. `merged:true` requires a real PR URL and GitHub evidence that the PR merged into the card's base repository/branch. ScriptCat verifies repo, base, merge commit and path zone where available. Network uncertainty is `unknown`, not an invented failure or pass.

## 9. Mission roster

Before issue, ScriptCat verifies that every required function has exactly one usable active row, valid Agent URL, target repository and allowed zone. Reviewer is never issued an executor card. A missing role is a named roster pause; Coordinator does not work around it by changing `Кому` to Warden.

## 10. Recovery truth

Recovery reads durable Notion/GitHub/local state before sending. It never fabricates a new run ID to escape a stalled card. A completed/merged claim is checked against GitHub. A pause records class, reference, version and build fingerprint; continuation states exactly what was and was not preserved.
