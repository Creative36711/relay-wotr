# ScriptCat markers

JSON is one physical line after the exact marker name. Replace every value with facts from the current prompt; placeholders and IDs from another turn are rejected. The marker is the last line of the answer.

## Coordinator

```text
CF_COORDINATOR_RESULT {"mission_id":"<uuid>","turn_id":"<uuid>","updates":[],"dispatch":null,"next":"continue|done|blocked","reason":"fact"}
```

## Executor or Auditor

```text
CF_AGENT_RESULT {"dispatch_id":"<uuid>","run_id":"<uuid>","status":"submitted|blocked","check":0,"report":"path or concise evidence","pr":null,"merged":false}
```

A merged change supplies the real PR URL and sets `merged:true` only after merge. Auditor normally uses `pr:null, merged:false` because its verification is read-only unless its card explicitly allows an additive evidence file.

## Mission review

```text
CF_REVIEW_RESULT {"mission_id":"<uuid>","turn_id":"<uuid>","verdict":"accept|rework|master","reason":"reproduced evidence"}
```

## Answer

```text
CF_ANSWER_RESULT {"question_id":"<uuid>","turn_id":"<uuid>","answer":"full decision","sourceRoleId":"<role-page-uuid>"}
```

## Arbiter

```text
CF_ARBITER_RESULT {"dispatch_id":"<uuid>","turn_id":"<uuid>","verdict":"accept|rework|master","reason":"loop decision"}
```

## Agent provisioning approval

```text
CF_AGENT_PROVISION_RESULT {"request_id":"<uuid>","jobs":[],"reason":"why these create/replace jobs are safe"}
```

Only approved `create`/`replace` jobs for listed non-admin role rows are allowed. Archive/delete/activate/admin commands are not marker jobs.

## Optional question envelope

A result marker may add one `question` object without changing required fields:

```json
{"question":{"text":"...","options":["A","B","C"],"default":"complete reversible choice","gate":false,"need":""}}
```

For a **durable gate**, use `gate:true` together with `need:"<exact active role>"`. ScriptCat stores the original result, gets an answer, and returns it with the original IDs. `sourceRoleId` preserves the source identity. Without gate, work continues on the complete default.

## Invalid

- marker in a code fence;
- prose after marker;
- missing required UUID or `<placeholder>`;
- copied IDs from another card/attempt;
- `pr:null` together with `merged:true`;
- `check:0` when the required command was not run;
- an ordinary question sent as `next:"blocked"`;
- a hand-written Notion feedback row instead of a marker question.
