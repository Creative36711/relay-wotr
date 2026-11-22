# WOTR Remaster · Notion IDs

Дата сверки: 2026-11-20. Используются ID **data source**, не view/database URL IDs.

## Project pages

| Назначение | ID | URL |
|---|---|---|
| Root | `41e6f0cf-5705-810b-8b81-d85ca92783b2` | https://app.notion.com/p/War-Of-The-Ring-Remaster-41e6f0cf5705810b8b81d85ca92783b2 |
| Регламент | `41e6f0cf-5705-8178-ac91-c320891b1d7b` | https://app.notion.com/p/WOTR-Remaster-41e6f0cf57058178ac91c320891b1d7b |
| План фаз | `41e6f0cf-5705-8145-a438-d4689316f146` | https://app.notion.com/p/WOTR-Remaster-41e6f0cf57058145a438d4689316f146 |
| WOTR-1.1 draft | `41e6f0cf-5705-81d8-9a15-eca7e646f077` | https://app.notion.com/p/WOTR-1-1-41e6f0cf570581d89a15eca7e646f077 |
| WOTR-1.2 spec | `41f6f0cf-5705-8191-8f0f-e6e074a6fe53` | https://app.notion.com/p/WOTR-1-2-Player-entry-and-portable-playtest-package-41f6f0cf570581918f0fe6e074a6fe53 |

## Databases

| База | Database ID | Data source ID |
|---|---|---|
| Роли | `41e6f0cf-5705-81cf-9ea9-f7564f42f77c` | `41e6f0cf-5705-81ce-bba9-000b94dd2784` |
| Миссии | `41e6f0cf-5705-8153-9d7f-c9c962db5d9a` | `41e6f0cf-5705-8115-8638-000b8448175c` |
| Запросы | `41e6f0cf-5705-81c7-afff-ffed76acd10a` | `41e6f0cf-5705-8176-a3fd-000bc17308b8` |
| Обратная связь | `41e6f0cf-5705-81b7-9dbb-c9a16835ba85` | `41e6f0cf-5705-817d-8029-000b2ef5c15c` |

## Seeded mission rows

| Object | Page ID | State |
|---|---|---|
| WOTR-1.1 mission | `41e6f0cf-5705-819a-a3ba-c15034fef51e` | Active |
| WOTR-1.1 B0 | `41e6f0cf-5705-818e-8c4f-ce0f5c0df68e` | Ready |
| WOTR-1.2 mission | `41f6f0cf-5705-8139-9897-eaf4f79e4799` | Draft; no live request cards; preparation not authorized |

WOTR-1.2 has no live row in «Запросах»; its prematurely created B0 is in trash. Do not create a replacement or start preparation after WOTR-1.1 automatically: a separate future decision is required.

## Profile values

```text
roles=41e6f0cf-5705-81ce-bba9-000b94dd2784
missions=41e6f0cf-5705-8115-8638-000b8448175c
requests=41e6f0cf-5705-8176-a3fd-000bc17308b8
questions=41e6f0cf-5705-817d-8029-000b2ef5c15c
repo=Creative36711/open-bfme
branch=main
driveFolder=wotr-remaster
```

Canonical import file: `tools/script-cat/wotr-project.json` in `Creative36711/relay-wotr` (the transport
repository). It contains metadata only. Notion token, GitHub token, Gateway URL/key and all session state are stored locally by ScriptCat and must never be committed.

## Authority

- Master/Warden create and govern role/mission rows.
- Coordinator edits mission request planning fields within its rules.
- ScriptCat alone writes dispatch identity/state, run IDs and transport timestamps.
- Role `Status`, `Agent URL`, `Agent Admin`, archive/delete and browser installation remain human-controlled.
