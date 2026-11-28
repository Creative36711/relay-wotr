// «Дожать ход» не должно упираться в подключения проекта (1.35.8, D-022).
//
// Случай Мастера (28.11, 01:31): пульт предложил «Дожать ход», вкладка сделала
// шаг — и журнал получил «Шаг не начат: Relay ещё не синхронизировал
// сохранённые Notion/Drive credentials». Ход при этом лежал в чате целиком:
// его надо было только прочитать. Кнопка обещала действие и не сделала его
// из-за входа, который этому действию не нужен.
//
// Вторая половина той же поломки — дедлок доставки: служба откладывала
// настройки проекта, пока вкладка занята (`localBusy`), а занятая вкладка как
// раз и держала `expect:plan` и ждала эти настройки. Здесь проверяется, что
// сервер больше не откладывает их, а клиент применяет и на занятой вкладке.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("read-only step ignores the credentials gate, planning step still honours it", async () => {
  const cycle = await read("../src/28-cycle.js");
  // Берём ровно функцию и вызываем из неё: вокруг стоят комментарии, и они
  // не должны попадать в исполняемый фрагмент как «незакрытый» код.
  const gate = cycle.slice(
    cycle.indexOf("const readOnlyStep ="),
    cycle.indexOf("\n\n", cycle.indexOf("mode === \"read\"")),
  );
  assert.ok(gate.startsWith("const readOnlyStep ="), "readOnlyStep объявлен рядом с гейтом");

  // Свой ход считается по ожиданию роли этой страницы; в проверке его нет.
  const context = { stepOwnsTurn: () => false };
  vm.createContext(context);
  vm.runInContext(`${gate}\nthis.readOnlyStep = readOnlyStep;`, context);
  const { readOnlyStep } = context;

  assert.equal(readOnlyStep(true, "read"), true, "«дожать» — шаг только на чтение");
  assert.equal(readOnlyStep(true, "nudge"), true, "прежнее имя режима тоже читающее");
  assert.equal(readOnlyStep(true, ""), false, "обычный «Шаг» без режима — не читающий");
  assert.equal(readOnlyStep(false, "read"), false, "режим без явного действия шаг не запускает");

  // Гейт спрашивает readOnlyStep и обходит его только для читающего шага.
  assert.match(
    cycle,
    /projectCredentialsReady\(\) && !readOnly\)/,
    "гейт credentials пропускает только шаг на чтение",
  );
  assert.match(cycle, /async function tick\(fromToggle = false\) \{\s*\n[\s\S]{0,260}?takeStepMode\(\)/, "режим забирается при входе в шаг");
  assert.match(cycle, /const requestReadOnlyStep = \(\) => \{ requestedStepMode = "read"; \};/, "клиент просит читающий шаг явно");
  assert.match(cycle, /Relay ещё не синхронизировал сохранённые Notion\/Drive credentials/,
    "отказ для планирующего шага остался: без подключений в Notion не сходить");
});

test("own held turn is not blocked by the credentials gate or by the switch hold", async () => {
  // 28.11, 11:35: «Пульт просит дочитать ответ» и сразу «Проект ждёт ручного
  // запуска после переключения». Вкладка держала свой же ход, но удержание
  // после переключения проекта считало его чужой работой.
  const cycle = await read("../src/28-cycle.js");
  const owns = cycle.slice(
    cycle.indexOf("const stepOwnsTurn = () =>"),
    cycle.indexOf("\n  };", cycle.indexOf("Boolean(here) && norm(waiting.roleId)")) + 4,
  );
  const run = (waiting, here) => new Function("GM_getValue", "K", "roleFromPath", "norm",
    `${owns}; return stepOwnsTurn();`)(
    () => waiting, { expect: "expect" }, () => here, (v) => String(v || "").trim().toLowerCase());

  assert.equal(run({ kind: "plan", roleId: "role-coordinator" }, "role-coordinator"), true,
    "ожидание своей роли — свой ход");
  assert.equal(run({ kind: "plan", roleId: "role-coordinator" }, "role-worker"), false,
    "ожидание чужой роли — не мой ход");
  assert.equal(run({ kind: "plan" }, ""), true, "запись без роли — след старой версии, ход мой");
  assert.equal(run(null, "role-coordinator"), false, "хода нет");

  assert.match(cycle, /typeof projectHeld === "function" && projectHeld\(\) && !readOnly\)/,
    "удержание после переключения пропускает доведение своего хода");
  assert.match(cycle, /mode === "read" \|\| mode === "nudge" \|\| stepOwnsTurn\(\)/,
    "свой ход входит в читающий шаг");
});

test("the nudge ticks the client in read-only mode", async () => {
  const client = await read("../src/46-relay-client.js");
  assert.match(client, /requestReadOnlyStep\(\)[\s\S]{0,80}await tick\(true\);/,
    "просьба пульта делает шаг режимом чтения, а не обычным «Шаг»");
  assert.match(client, /Пульт просит дочитать ответ — делаю шаг без новой работы\./);
});

test("Relay never postpones project settings while the tab holds a turn", async () => {
  const server = await read("../../../relay/src/server.mjs");
  const answer = server.slice(
    server.indexOf("// Настройки проекта уезжают во вкладку всегда"),
    server.indexOf("return send(response, result.ok === false"),
  );
  assert.match(answer, /projectSettings \? \{ projectSettings \}/, "настройки едут всегда");
  assert.doesNotMatch(answer, /!body\.localBusy\s*\n?\s*\?\s*\{\s*\.\.\.result/,
    "нет ветки «только на простое» для всего ответа");
  assert.match(answer, /projectSelection && !body\.localBusy/, "смена профиля по-прежнему ждёт простоя");
  assert.match(answer, /projectSettingsUnavailable && !body\.localBusy/,
    "отзыв подключений не меняет профиль на ходу");
});

test("a held turn does not swallow the nudge request", async () => {
  // Просьба пульта забиралась и пропадала: шаг не начинался, а служба уже
  // считала, что просьба доставлена. Теперь ждём только печатающего агента.
  const client = await read("../src/46-relay-client.js");
  const tick = client.slice(client.indexOf("async function relayClientTick()"),
    client.indexOf("if (pending || waiting) {"));
  assert.match(tick, /const canTakeNudge = !\(typeof stillWorking === "function" && stillWorking\(\)\);/,
    "ожидание плана и pending больше не запирают просьбу");
  assert.doesNotMatch(tick, /canTakeNudge = !pending/, "старое условие «только на простое» не вернулось");
});

test("Relay says the truth when the admin tab waits for a human", async () => {
  const service = await read("../../../relay/src/service.mjs");
  const nudge = service.slice(service.indexOf("async function nudge("), service.indexOf("function takeNudge("));
  assert.match(nudge, /const holder = active\.find\(\(client\) => String\(client\.localWaiting \|\| ""\)\) \|\| active\[0\];/,
    "спрашиваем про вкладку, которой принадлежит ход");
  assert.match(nudge, /if \(!holder\.localPaused\) \{/, "пауза другой вкладки не отменяет просьбу");
  assert.match(nudge, /const paused = holder;/, "причина паузы берётся у держателя хода");

  const app = await read("../../../relay/web/app.js");
  assert.match(app, /else if \(result\?\.pending\) \{/, "пульт разделяет «передано» и «сохранено, но ждёт человека»");
  assert.match(app, /heldAdmin\.localPaused[\s\S]{0,220}«▶ Продолжить»/, "карточка называет паузу, а не обещает шаг");
});

test("busy tab applies settings instead of waiting to become idle", async () => {
  const client = await read("../src/46-relay-client.js");
  assert.match(client, /if \(res\?\.projectSettings && typeof applyRelayProjectSettings === "function"\) \{/,
    "в условии применения настроек больше нет требования простоя");
  assert.doesNotMatch(client, /res\?\.projectSettings && !localBusy/, "занятая вкладка тоже принимает настройки");
  assert.match(client, /settingsReloadPending = true/, "смена профиля на занятой вкладке откладывается, а не теряется");
  assert.match(client, /if \(relayClient\.settingsReloadPending && !localBusy && !busy && !\(Number\(projectAsyncWork\) > 0\)\) \{/,
    "отложенная перезагрузка случается только на простое");
  assert.match(client, /settingsReloadPending: false,/, "флаг объявлен в состоянии клиента");
});
