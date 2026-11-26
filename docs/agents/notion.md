# Notion contract · проект

IDs and URLs: `docs/setup/notion-ids.md`. ScriptCat uses data source IDs.

## Роли

Source of role authority. Human-managed: role title, Status, Agent URL, Agent Admin, the account label `Аккаунт` and archive/delete. Warden/approved planning may define Function, write zone, gate and repository for non-admin roles. Agent State `запрошен` asks provisioning; it does not activate a role by itself.

`Аккаунт` (D-004) is the Arena account a role spends its daily quota from: an opaque label such as `account-1`, never an email — the label→address map lives only in the browser (⚙ «Подключения» → «Аккаунты Arena») because the database is shared. `Доступность` (`ОК` / `Лимит`) is transport-owned: ScriptCat marks an account's roles when the Arena daily limit indicator is visible on that account and restores them after the Moscow midnight reset. Never encode the quota by editing `Статус`: that field is the human's decision and a restore would overwrite it. Administrative roles (Coordinator, Warden, Transport Maintainer) share one account with no working roles on it, so a worker quota cannot take acceptance down.

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

## Поля, которые не работают (проверено кодом, 1.19.0)

Пустой столбец в базе выглядит как приглашение его заполнить. Ниже — то, что
можно заполнять смело, и то, что заполнять бессмысленно, потому что значения
никто не прочитает.

**Пишутся и читаются.** `Agent URL` и `Previous Agent URL` пишет provisioning
(`33-provision-flow.js`), читает вкладка (`12-notion.js`). `Agent State` —
сигнал `запрошен`; его читают `31-provision-core.js` и provisioning-UI, поэтому
это поле живое, даже если пишете его вы. `Аккаунт`, `Доступность`, `Функция`,
`Статус`, `Зона записи`, `Гейт`, `Репозиторий`, `Agent Admin` — живые.

**Только для людей.** `Устав` — ссылка на ТЗ. Код её не читает: в `src/` нет
этой строки вовсе, в промпт она не подгружается. Поле полезно как закладка и
безвредно, но не ждите от него влияния на цикл.

**Не заполнять: значения теряются.** `Agent Job ID` и `Agent Created At` никто
не пишет — ни вкладка, ни служба. Если вы впишете туда что-то руками, это
переживёт только вашу правку: следующий шаг provisioning их не обновит и не
сохранит. Пустое поле здесь — правильное состояние.

**Удалено из шаблона.** `Проверка` (rich_text) в «Запросах» убрана: её не
читает ни один слой, а рядом живёт рабочий `Check` (select `pass`/`fail`/
`none`), который и меняет вердикт. Два похожих столбца рядом сбивали с толку —
именно поэтому один из них убран. В живой базе поле осталось пустым: схему
правит человек, а не транспорт (D-080).

Регрессия зафиксирована: `relay/tests/notion-fields.test.mjs` падает, если
мёртвое поле вернут в шаблон или если живое поле перестанут читать.
