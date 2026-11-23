# Drive layout · проект

Project root: `Arena/<проект>/`.

```text
logs/       append-only machine journal per dispatch/run
payloads/   large assignment snapshots referenced by file ID
artifacts/  free results and acceptance evidence
```

Files in Drive root are not valid ScriptCat logs, payloads or artifacts.

## logs

Created by ScriptCat/Gateway as `<dispatch_id>_<run_id>.md`. Log is append-only and must not contain credentials, session cookies, full private conversation dumps or retail archives.

## payloads

A task larger than the inline threshold is stored as a snapshot and delivered by Drive file ID. The pointer does not replace inline Intent, Invariants, Oracle and Scope. An agent must read the referenced payload before work.

## artifacts

Recommended names:

```text
<dispatch_id>_<run_id>__<slug>.<ext>
manual__<проект>__<slug>.<ext>
<PROJECT-ID>__<CARD-ID>__<kind>__<date-or-SHA>.<ext>
```

Allowed MIME types:

- `text/plain`
- `text/markdown`
- `application/json`
- `text/csv`
- `image/png`

Maximum decoded artifact size: **262144** bytes. For text this means UTF-8 bytes; for PNG it means decoded base64 bytes. Extensions: `.txt`, `.md`, `.json`, `.csv`, `.png`.

Same name + same content is a duplicate. Same name + different content is an explicit conflict, never a silent overwrite. Optional first-level subdirectory may equal the mission ID; nested arbitrary paths are rejected.

## Product-specific boundary

Do not upload retail BIG, executables, source archives, full builds, caches or secrets through this channel. Large video/build evidence stays in Arena workspace or an explicitly approved external artifact channel; the report records path and hash. PNG evidence is opened by the agent before submission and described in the report.
