// «Дожать ход» при занятом шаге: просьба не пропадает (1.36.2, D-052).
//
// Случай Мастера (28.11, 14:33 МСК). Ответ Координатора уже лежал в чате
// (`CF_COORDINATOR_RESULT`, msg `01a221ee…`), пульт писал «пульт просит дожать
// ход: админ-вкладка дочитает ответ Координатора», а вкладка дважды ответила
// «Шаг уже выполняется». Просьба одноразовая: `takeNudge` снимает её в момент
// выдачи. Значит второй раз человек нажал кнопку не потому, что не дождался, а
// потому что первый раз не изменил ничего.
//
// Здесь проверяются обе половины правки:
//   1. клиент не забирает просьбу, пока шаг идёт (шаг занимает вкладку своей
//      памятью `busy`, а не сетью — `relayPost` ограничен 45 с);
//   2. шаг, к которому просьба пришла, не отказывает, а откладывает её и
//      выполняет сразу после своего конца — без второго нажатия.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("client keeps the request while a step is running", async () => {
  const client = await read("../src/46-relay-client.js");
  const tick = client.slice(
    client.indexOf("async function relayClientTick()"),
    client.indexOf("if (pending || waiting) {"),
  );
  assert.match(tick, /const stepRunning = Boolean\(busy\);/, "занятость шага читается до просьбы");
  assert.match(tick, /if \(canTakeNudge && !stepRunning\) \{/,
    "pull за просьбой не уходит, пока шаг идёт: иначе она снимается вхолостую");
  assert.match(tick, /deferNudgeStep\("прошлый шаг ещё не закончился"\)/,
    "просьба передаётся шагу, а не теряется");
  assert.match(tick, /stepRunning\) \{[\s\S]{0,400}просьба остаётся и повторится после его конца/,
    "в журнале сказано, что просьба сохранена");
});

test("the running step defers the nudge and runs it after its own end", async () => {
  const cycle = await read("../src/28-cycle.js");

  // Заявка объявлена рядом с режимом шага: её поднимает и клиент, и сам шаг.
  assert.match(cycle, /let nudgeRetryDeadline = 0;/, "у отсрочки есть срок жизни");
  assert.match(cycle, /function deferNudgeStep\(why = ""\)/,
    "заявка принимается отдельной функцией");
  assert.match(cycle, /function resumeDeferredNudge\(\)/,
    "и снимается отдельной функцией");
  assert.match(cycle, /nudgeRetryDeadline = now \+ 600000/,
    "предел отсрочки — десять минут, а не вечность");
  assert.match(cycle, /if \(busy\) return;[\s\S]{0,200}requestReadOnlyStep\(\)/,
    "повтор идёт читающим шагом: новая работа не выдаётся");
  assert.match(cycle, /setTimeout\(\(\) => tick\(true\), 0\)/,
    "повтор — отложенный тик, а не второй запуск поверх первого");

  // Занятый шаг: вместо «повторный не нужен» — сохранение заявки.
  const busyBlock = cycle.slice(
    cycle.indexOf("const silentMs = Date.now() - busyAt;"),
    cycle.indexOf("stepRestarts += 1;"),
  );
  assert.match(busyBlock, /mode === "read" && typeof deferNudgeStep === "function" && deferNudgeStep\(/,
    "читающий «дожать» при занятом шаге откладывается");
  assert.match(busyBlock, /if \(!deferred\) log\("Шаг уже выполняется/,
    "обычный «Шаг» по-прежнему только объясняет занятость");
  assert.doesNotMatch(busyBlock, /requestReadOnlyStep\(\)/,
    "занятый шаг не запускает второй шаг из своего сторожа");

  // Конец шага поднимает заявку — после снятия busy, а не до него.
  const finallyBlock = cycle.slice(cycle.indexOf("} finally {"), cycle.indexOf("// ─────────", cycle.indexOf("} finally {")));
  const cleared = finallyBlock.indexOf("busy = false;");
  const resumed = finallyBlock.indexOf("resumeDeferredNudge()");
  assert.ok(cleared > -1 && resumed > cleared, "заявка поднимается уже свободным шагом");
  assert.match(finallyBlock, /typeof resumeDeferredNudge === "function"/,
    "старые сборки без заявки не ломаются");
});

test("deferred nudge state machine: no second step while busy, one after", () => {
  // Проба собирает обе функции из настоящего исходника и проверяет поведение,
  // а не текст: занятость во время заявки и один шаг после её конца.
  const src = [
    "let busy = true;",
    "let requested = 0;",
    "let ticks = 0;",
    "let due = 0;",
    "const calls = [];",
    "const log = (text) => calls.push(String(text));",
    "const logThrottled = (key, text) => calls.push(String(text));",
    "const requestReadOnlyStep = () => { requested += 1; };",
    "const tick = () => { ticks += 1; };",
    "let now = 1_000_000;",
    "const Date = { now: () => now };",
    // Отложенный тик выполняем синхронно: проба проверяет решение, а не таймеры.
    "const setTimeout = (fn) => { fn(); };",
  ].join("\n");
  return read("../src/28-cycle.js").then((cycle) => {
    const body = cycle.slice(
      cycle.indexOf("let nudgeRetryDeadline = 0;"),
      cycle.indexOf("/** Отложенная заявка: поднять тик"),
    );
    const resume = cycle.slice(
      cycle.indexOf("function resumeDeferredNudge()"),
      cycle.indexOf("\n  }\n", cycle.indexOf("function resumeDeferredNudge()")) + 4,
    );
    const deferred = cycle.slice(
      cycle.indexOf("function deferNudgeStep"),
      cycle.indexOf("/** Отложенная заявка: поднять тик"),
    );
    const run = () => new Function(`${src}\n${body}\n${deferred}\n${resume}\n
      return { deferNudgeStep, resumeDeferredNudge, get state() { return { busy, requested, ticks, calls, due: nudgeRetryDeadline }; },
        setBusy: (value) => { busy = value; }, advance: (ms) => { now += ms; } };`)();
    const api = run();

    assert.equal(api.deferNudgeStep("шаг идёт"), true, "заявка принята");
    assert.match(api.state.calls.at(-1), /просьба сохранена и повторится/,
      "журнал говорит правду: просьба ждёт шага");
    assert.ok(api.state.due > 0, "срок жизни заявки выставлен");

    // Шаг ещё идёт — повтор не запускается, второй шаг не появляется.
    api.resumeDeferredNudge();
    assert.equal(api.state.ticks, 0, "пока busy — шаг не поднимается сам");
    assert.equal(api.state.requested, 0, "заявка режима не выставлена");

    // Шаг закончился — заявка выполняется один раз и читающим шагом.
    api.setBusy(false);
    api.resumeDeferredNudge();
    assert.equal(api.state.ticks, 1, "после конца шага просьба выполняется сама");
    assert.equal(api.state.requested, 1, "и именно читающим шагом");
    assert.equal(api.state.due, 0, "заявка одноразовая");

    api.resumeDeferredNudge();
    assert.equal(api.state.ticks, 1, "повторно та же заявка шаг не будит");

    // Просроченная заявка не висит вечно: она снимается и говорит, что делать.
    const late = run();
    late.deferNudgeStep("шаг идёт");
    late.advance(11 * 60 * 1000);
    assert.equal(late.deferNudgeStep("шаг идёт"), false, "просроченная заявка не продлевается");
    assert.match(late.state.calls.at(-1), /Нажмите «Дожать ход» ещё раз/,
      "человеку сказано, как продолжить");
    late.setBusy(false);
    late.resumeDeferredNudge();
    assert.equal(late.state.ticks, 0, "снятая заявка шаг не поднимает");
  });
});

test("service keeps the request until a tab actually takes it", async () => {
  const service = await read("../../../relay/src/service.mjs");
  const take = service.slice(service.indexOf("function takeNudge("), service.indexOf("async function retryTurn("));
  assert.match(take, /memory\.nudge = null;\s*\n\s*return \{ ok: true, nudge: true/,
    "просьбу снимает только факт выдачи вкладке");
  assert.match(take, /if \(target && slotId && !target\.split\(","\)\.some/,
    "чужая вкладка просьбу не забирает");
  assert.match(take, /300000/, "просроченная просьба не выполняется через час");

  // Пульт больше не обещает срок, которого не знает.
  const app = await read("../../../relay/web/app.js");
  const guidance = app.slice(app.indexOf("if (heldAdmin?.localWaiting === \"expect:plan\""),
    app.indexOf("if (shot.turnRequest && heldAdmin)"))
    // Комментарий объясняет, что именно снято, и цитирует прежнюю строку:
    // сравнивать надо текст подсказки, а не историю правки.
    .split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");
  assert.doesNotMatch(guidance, /в течение пятнадцати секунд/,
    "обещание «через пятнадцать секунд» снято: вкладка может быть занята шагом");
  assert.match(guidance, /просьба сохраняется и выполнится сразу после его конца/,
    "вместо срока сказано, что просьба не пропадает");
});

console.log("OK: D-052 — «дожать» при занятом шаге сохраняется и выполняется после его конца");
