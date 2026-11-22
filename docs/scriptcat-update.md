# ScriptCat для WOTR Remaster

Сейчас **1.16.8** (WOTR-D-023), локальная адаптация upstream 1.16.1.

## Источник и граница provenance

Точный source repository, imported tree `fe8ec936…`, removal parent
`eecb687…`, MIT license и команда воспроизведения находятся только в
`tools/script-cat/UPSTREAM.md`. Это не operational target и не источник
продуктовых правил. Текущий target задаёт только WOTR profile:
`Creative36711/open-bfme@main`.

Regression fixtures сохраняют transport-семантику snapshot, но с 1.16.4
обезличены до `CASE-*`/`fixture-*`: прежние product names, repositories и card
prefixes не должны попадать ни в prompts, ни в comments/tests/contracts, где их
может принять за текущие Transport Maintainer.

## Выпуск 1.16.2 (WOTR-D-008)

Поведение доставки upstream 1.16.1 сохранено. Добавлены один WOTR target,
`pilot.wotr`, WOTR roles/phases/retail/determinism gates и regulation 1.0.

## Выпуск 1.16.3 (WOTR-D-014)

Transport protocol не менялся. Regulation 1.1 закрепил Upstream Integrator как
Executor, единственного Transport Maintainer, declared build/retail Cost gates,
точные локали `en`, `ru`, `zh-Hans`, `ja`, `pt-BR`, `de`, `fr`, `ko` и WOTR
bootstrap preflight.

## Выпуск 1.16.4 (WOTR-D-017)

Transport protocol остаётся 1.11. Полная WOTR-адаптация source layer:

- embedded regulation 1.2 включает ADR-004 player entry, адаптацию существующего
  launcher/one-archive pipeline и миссию portable playtest;
- после отдельного решения начать подготовку миссии обязательная B0-репетиция
  до её рабочих карточек закреплена в prompts/regulation;
- former-project names, repositories и card prefixes удалены из runtime source
  comments, contracts, tests, browser/regression fixtures;
- точный imported repository разрешён только в явно неоперационном
  `tools/script-cat/UPSTREAM.md`;
- portability guard сканирует всё дерево ScriptCat, включая tests,
  regression-tests, browser-tests, contracts и sanitized upstream fixtures;
- bundle regenerated из 45 source files и regulation digest; полный gate и
  artifact hash записаны в `docs/evidence/scriptcat-1.16.4.md`.

## Выпуск 1.16.5 (WOTR-D-018)

Transport protocol остаётся 1.11; правила доставки, маркеры и бюджеты не менялись.
Выпуск закрывает два дефекта выдачи, из-за которых WOTR-1.1 B0 трижды не выходила
на Integration Auditor, а разбор уезжал не тому адресату:

- `27-review-answers.dispatchTask` перечитывает карточку перед созданием журнала тем
  же предполётным гейтом, что и первый осмотр, — с зоной адресата. Без третьего
  аргумента `unownedPaths` (D-092) терял пропуск прозаической «Зоны записи» и
  отвергал неизменённую карточку;
- отказ повторной проверки называется отдельно (`повторная предполётная проверка: …`)
  и по этому слову `classifyPause` ведёт его транспорту: пауза `redispatch` больше не
  означает «решает приёмка» для случая, когда правка постановки ничего не меняет.
  Отказ первого осмотра (`предварительная проверка: …`) по-прежнему дефект
  постановки и строка в «Обратную связь»;
- вид дефекта передаётся машиной в `heal.defect` — он попадает в ключ инцидента и в
  бриф разбора, поэтому пределы `healMaintainerMax` считаются по одной поломке, а не
  по новому кругу.

Полный gate и hashes сборки — в `docs/evidence/scriptcat-1.16.5.md`.

## Выпуск 1.16.6 (WOTR-D-019)

Transport protocol остаётся 1.11; маркеры, профили, бюджеты и краткий регламент не менялись.
Выпуск закрывает «цикл идёт, а вопрос в «Обратной связи» висит»: очередь адресата обязана
доезжать до адресата, а не ждать следующего промпта.

- `24-feedback.refreshQuestions` больше не исключает строку пожизненной отметкой
  `cfn-q-handoff:<id>`: «передано» проверяется по живому следу (`answerHandoffLive` — очередь
  приёмки, ход ответа или возврата, неотправленное задание, квитанция возврата). Отметка
  старше окна `questionCheckMs` и следа нет — строка передаётся приёмке заново;
- пределы повторов задаёт `answerRehandoffMax` (2), после них это потерянная доставка, а не
  «очередь подождёт»: пауза вида `answer-orphan` размечается транспорту и уходит
  Transport Maintainer'у, цикл на ней не стоит (`40-heal-core.HEAL_PAUSE_CLASS`);
- адресат (`need`) живёт в очереди и у вопроса без `gate` и восстанавливается из строки базы
  независимо от «ждёт ответа»: `gate` решает, держать ли ход, а не кому отвечать. Маркер
  роли по-прежнему читается строго — `parseQuestion` не тронут (D-083);
- `27-review-answers.startAnswer` держит очередь только ради `gate`-вопроса: обычный вопрос
  с неготовым адресатом отвечает приёмка, подмена названа в журнале (`answer-need-fallback`)
  и голова очереди больше не запирается;
- долгое ожидание свободного слота названо (`answer-starved`), закрытая строка обнуляет
  счётчик повторных передач.

Полный gate и hashes сборки — в `docs/evidence/scriptcat-1.16.6.md`.

## Выпуск 1.16.7 (WOTR-D-021)

Transport protocol остаётся 1.11; маркеры, профили, бюджеты и краткий регламент не менялись.
Выпуск меняет одну политику остановки: предупреждение Arena о достижении лимита вызовов
инструментов перестало быть поводом останавливать цикл.

- `C.toolLimitContinueMax` (2) удалён: `30-tool-limit.continueToolLimitTurn` и
  `continuePilotToolLimit` больше не сравнивают `toolLimitContinuations` с пределом и не
  ставят `pause`/`tool_limit_paused` по числу продолжений. Это не ошибка в классическом
  смысле — граница хода, после которой Arena сама просит «send a message to continue»;
  останавливать начатую работу из-за счётчика значило выбрасывать сделанное;
- счётчик остаётся числом в журнале и в логе (`toolLimitContinuations`, исход
  `tool_limit_continued`), поэтому разбор по-прежнему видит, сколько продолжений ушло на ход;
- останавливать ход имеют право только настоящие отказы: отсутствие прогресса
  (`tool_limit_no_progress` — после продолжения нет ни одного нового содержательного
  сообщения, только повторный лимит), несобранный или недоставленный continuation, и
  живая карточка Reviewer без шаблона продолжения (там по-прежнему Мастер);
- темп задаёт не цикл, а агент: новое продолжение возможно только при новом статусном
  сообщении (`lastToolLimitMessageId`), когда страница не занята (`busySettled()`), и только
  пока ход не завершён маркером; `tool-limit`-пауза при отказе доставки никуда не делась.

Проба `tools/script-cat/regression-tests/tool-limit-continuation-integration.mjs` красная на
1.16.6 (третий лимит давал паузу) и зелёная на 1.16.7: третий и четвёртый ходы продолжаются,
пауза приходит по отсутствию прогресса; у пилота проверяется то же. Статические ожидания
`tool-limit-continuation-smoke` закрепляют отсутствие ключа предела и в модуле, и в конфиге.

Полный gate и hashes сборки — в `docs/evidence/scriptcat-1.16.7.md`.

## Выпуск 1.16.8 (WOTR-D-023)

Transport protocol остаётся 1.11; маркеры, профили, бюджеты, гейты и краткий регламент не
менялись. Выпуск закрывает класс «тихий простой транспорта»: строка «Обратной связи» могла
висеть «Ждёт» с пустым «Ответом» при работающем цикле (и при ручном «Шаге»), а очередь
приёмки — быть пустой, и ни панель, ни журнал об этом не говорили.

Три независимые причины, каждая из которых по отдельности глушила передачу:

- `appendQuestionBody` держал строку в «незавершённых телах» бессрочно. Пока запись тела
  живёт в очереди, строка намеренно не уходит приёмке (иначе агент получает обрезанный
  вместо полного материала), но у ожидания не было края: `Notion 503`, обрезанный ответ или
  ручная правка абзаца в теле навечно исключали строку и из `adopted`, и из `due`. Теперь
  удержание ограничено `C.questionBodyHoldMs` (не короче `questionCheckMs`) и
  `C.questionBodyMaxTries` попыток; после края строка передаётся по тому, что лежит в базе,
  и отпускание записано в журнал ошибкой, а не тишиной;
- `flushQuestionBodies` не ловил исключение внутри петли — одна битая строка обрывала весь
  проход, и очередь остальных вопросов в этом цикле не обрабатывалась. Теперь каждая строка
  изолирована, ошибки считаются в ту же метрику попыток;
- передача лежала внутри `if (active)` (активная миссия). Миссия нужна, чтобы отфильтровать
  чужие строки и закрыть просроченные, а не как условие самой доставки; теперь сбой её
  чтения пишется в журнал, приёмка идёт без фильтра по миссии, а `closeExpired` остаётся
  под условием (без миссии закрывать нечем).

Видимость простоя: у «Шага» и «Продолжить» больше нет единого дежурного текста.
`projectBlockedText()` различает повреждённый профиль, вкладку без выбранного проекта и
снятый допуск (допуск снимается сам при смене Notion/Drive/GitHub-доступов в «Подключениях» —
это было второй половиной того же сбоя). Сторожа вопросов и ADR больше не снимаются допуском
вкладки, а если фоновый проход приглушён, в журнал идёт `feedback-pipeline-held` с конкретной
причиной и адресом, где её снять.

Проба `tools/script-cat/tests/relay-feedback-delivery-smoke.mjs` собирается на живом коде
бандла (не на поиске подстрок) и красная на 1.16.7 по поведению: строка не передаётся без
прочитанной миссии, удержание не гаснет, битая строка обрывает проход. Интеграционная сюита
`relay-feedback-integration.mjs` дополнена сценарием «свежее удержание держит → просроченное
отпускает».

Полный gate и hashes сборки — в `docs/evidence/scriptcat-1.16.8.md`.

## Установка

1. Импортировать `tools/script-cat/wotr-project.json` через окно проектов
   ScriptCat.
2. Убедиться, что активная вкладка показывает **War Of The Ring: Remaster**,
   `Creative36711/open-bfme@main` и Drive folder `wotr-remaster`.
3. Сохранить Notion/GitHub/Gateway connections локально; secrets не входят в
   profile file.
4. Зарегистрировать Drive profile `wotr-remaster` только через Gateway flow.
5. Проверить подключения и вручную разрешить профиль. Автоцикл остаётся
   выключен до ручного включения.
6. Userscript устанавливает человек из принятого
   `tools/script-cat/relay.user.js` после сравнения SHA-256 с build report.
7. Старый browser profile можно хранить изолированно, но вкладка WOTR не должна
   быть открыта под ним; ScriptCat fail-closed не подменяет отсутствующий профиль.

## Gate

```bash
npm run scriptcat:check
npm run scriptcat:guard
npm run test:scriptcat
npm run test:scriptcat:regression
npm run test:scriptcat:tool-limit
```

Либо `npm run verify:scriptcat`. Успех: каждый процесс rc 0, Node summary
`# fail 0`, bundle version equals runtime fallback, embedded digest equals source,
coverage contains all rule IDs, а full-tree guard не находит прежних product/card
идентификаторов вне строго разрешённой provenance-записи.

## Обновление

Transport Maintainer changes `src/**` only on a dedicated card. A source change
must bump both `@version` and `SCRIPT_VERSION`, add/update decision and regression
evidence, run `node tools/script-cat/build.mjs`, then complete the full gate.
Browser installation is never performed silently by repository tooling.
