// Проба 1.16.6 (внешний D-019): очередь обратной связи обязана доезжать до адресата.
//
// Инцидент 11.21, внешняя карточка: строка «остановка без автоматического пути»
// (`41f6f0cf-5705-8139-b90b-c69c24308819`) висела «Ждёт» с пустым «Ответом» при
// работающем цикле: 8 Ready-карточек выдавались, а разбор к приёмке не шёл.
//
// Что проверено в коде и что здесь закреплено:
//   1. `handWaitingRow` ставил отметку «передано» ДО подтверждения доставки, а
//      `refreshQuestions` исключал строку навсегда:
//      `!GM_getValue(answerHandoffKey(row.id), 0)`. Очередь ответа (`cfn-answer-queue`)
//      при этом чистит `dropAnswer`, слот ожидания снимает уборка фантомов —
//      строка оставалась без ходячего следа и без повтора. Теперь повтор разрешён,
//      пока передачи нет ни в очереди, ни в живом ходе, ни в неотправленном
//      задании, ни в квитанции возврата.
//   2. `need` («нужен ответ «X»») обнулялся для вопроса без `gate` — и в
//      `questionFromRow`, и в `queueAnswer`. Строка, адресованная Transport
//      Maintainer'у, по дороге к адресату теряла адресата.
//   3. `startAnswer` при недоступном адресате возвращал `false` и для вопроса,
//      который не держит ход. Голова очереди одна (`answerPending()`), поэтому
//      за такой строкой не шла ни одна другая.
//   4. Долгое ожидание свободного слота не было видно в журнале.
//
// Проба красная на 1.16.5 (пункты 1–4) и зелёная на 1.16.6.
// Рядом лежит 1.16.8 (внешний D-023): удержание незаписанного тела больше не
// бессрочное — строка не может зависнуть «Ждёт» из-за молчаливой ошибки PATCH.

import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { healApi } from './helpers/prompt-env.mjs';

const src = readFileSync(new URL('../relay.user.js', import.meta.url), 'utf8');
const feedback = readFileSync(new URL('../src/24-feedback.js', import.meta.url), 'utf8');
const answers = readFileSync(new URL('../src/27-review-answers.js', import.meta.url), 'utf8');
const config = readFileSync(new URL('../src/01-config.js', import.meta.url), 'utf8');

// ── 0. Выпуск назван (номер меняется каждым релизом транспорта)
assert.match(src, /^\/\/ @version\s+1\.35\.5\s*$/m, 'сборка 1.35.5 объявлена');

// ── 1. Отметка «передано» больше не пожизненная ─────────────────────────────
{
  const cut = (from, to) => {
    const a = src.indexOf(from);
    const b = src.indexOf(to, a);
    assert.ok(a > 0 && b > a, `фрагмент на месте: ${from.trim().slice(0, 60)}`);
    return src.slice(a, b);
  };

  const filter = cut('const adopted = mine.filter(', 'let handed = 0;');
  assert.match(filter, /handoffNeedsRequeue\(row\.id\)/,
    'adoption сверяется с живой передачей, а не с одной отметкой');
  assert.doesNotMatch(filter, /!GM_getValue\(answerHandoffKey\(row\.id\), 0\)/,
    'прежнее пожизненное исключение строки убрано');

  const loop = cut('const rehand = Number(GM_getValue(answerHandoffKey(row.id), 0)) > 0;', 'if (handed) {');
  assert.match(loop, /handWaitingRow\(row, q, \{ roleName: "Relay \(транспорт\)", mission: wanted \}\)/,
    'повтор идёт тем же каналом, что и первая передача');
  assert.match(loop, /bumpAnswerRehandoff\(row\.id\)/, 'повторы считаются');
  assert.match(loop, /tries > C\.answerRehandoffMax/, 'после предела — не молчание, а остановка с видом');
  assert.match(loop, /kind: "answer-orphan"/, 'вид паузы назван: его разбирает транспорт');

  // Живой след — четыре записи, потому что ни одна из них не обязана пережить
  // перезагрузку вкладки.
  const live = cut('function answerHandoffLive(id) {', 'function handoffNeedsRequeue(id) {');
  assert.match(live, /answerQueue\(\)/, 'очередь приёмки');
  assert.match(live, /live\.kind === "answer" \|\| live\.kind === "answer-return"/, 'живой ход ответа или возврата');
  assert.match(live, /GM_getValue\(K\.pending, null\)/, 'неотправленное задание');
  assert.match(live, /answerReturns\(\)/, 'квитанция возврата');

  // ── 1.1. Таблица решений на живом коде бандла ─────────────────────────────
  const helpers = cut('const answerHandoffKey = (id) => `cfn-q-handoff:${id}`;',
    'function handWaitingRow(row, q = null, ctx = {}) {');
  const mk = ({ mark = 0, now = 0, queue = [], expect = null, pending = null, returns = [] }) => {
    const store = new Map();
    if (mark) store.set('cfn-q-handoff:id-1', mark);
    if (expect) store.set('cfn-expect', expect);
    if (pending) store.set('cfn-pending', pending);
    return new Function(
      'GM_getValue', 'GM_setValue', 'K', 'C', 'norm', 'answerQueue', 'answerReturns', 'Date',
      `${helpers}; return { answerHandoffLive, handoffNeedsRequeue, bumpAnswerRehandoff, resetAnswerRehandoff };`,
    )(
      (key, fallback) => (store.has(key) ? store.get(key) : fallback),
      (key, value) => store.set(key, value),
      { expect: 'cfn-expect', pending: 'cfn-pending' },
      { questionCheckMs: 600000 },
      (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase(),
      () => queue,
      () => returns,
      { now: () => now },
    );
  };
  const DAY = 24 * 60 * 60 * 1000;

  // Не передавали вовсе — строка обычным путём попадает в adoption.
  assert.equal(mk({ now: 1000 }).handoffNeedsRequeue('id-1'), true, 'без отметки строка передаётся');
  // Отметка свежая — ход мог ещё не начаться: не трогаем.
  assert.equal(mk({ mark: 999_000, now: 1_000_000 }).handoffNeedsRequeue('id-1'), false,
    'свежая передача не повторяется');
  // Отметка старая, в очереди есть — ждём, дублировать нечего.
  assert.equal(mk({ mark: DAY, now: 10 * DAY, queue: [{ id: 'id-1' }] }).handoffNeedsRequeue('id-1'), false,
    'строка в очереди приёмки — повтора нет');
  assert.equal(mk({ mark: DAY, now: 10 * DAY, queue: [{ id: 'other' }] }).handoffNeedsRequeue('id-1'), true,
    'осиротевшая строка передаётся снова');
  assert.equal(mk({ mark: DAY, now: 10 * DAY, expect: { kind: 'answer', ref: 'id-1' } }).handoffNeedsRequeue('id-1'), false,
    'ход ответа живёт в слоте ожидания — повтора нет');
  assert.equal(mk({ mark: DAY, now: 10 * DAY, expect: { kind: 'answer-return', ref: 'id-1' } }).handoffNeedsRequeue('id-1'), false,
    'квитанция возврата в живом ожидании — тоже передача');
  assert.equal(mk({ mark: DAY, now: 10 * DAY, expect: { kind: 'dispatch', ref: 'card-9' } }).handoffNeedsRequeue('id-1'), true,
    'чужая выдача карточки строку не защищает');
  assert.equal(mk({ mark: DAY, now: 10 * DAY, pending: { questionId: 'id-1' } }).handoffNeedsRequeue('id-1'), false,
    'задание ещё не ушло — ждём, а не дублируем');
  assert.equal(mk({ mark: DAY, now: 10 * DAY, returns: [{ questionId: 'id-1' }] }).handoffNeedsRequeue('id-1'), false,
    'ответ уже ждёт возврата автору');

  // Счётчик: рост и сброс после ответа.
  {
    const api = mk({ mark: DAY, now: 10 * DAY });
    assert.equal(api.bumpAnswerRehandoff('id-1'), 1, 'первый повтор посчитан');
    assert.equal(api.bumpAnswerRehandoff('id-1'), 2, 'второй повтор посчитан');
    assert.equal(api.resetAnswerRehandoff('id-1'), 0, 'после ответа счётчик обнуляется');
    assert.equal(api.bumpAnswerRehandoff('id-1'), 1, 'и новый инцидент начинается с нуля');
  }
}

// ── 2. Адресат переживает чтение строки из базы без `gate` ──────────────────
{
  const from = feedback.indexOf('  function questionFromRow(row) {');
  const to = feedback.indexOf('  /** Отметка «эту строку приёмке уже передавали»');
  assert.ok(from > 0 && to > from, 'разбор строки на месте');
  const block = feedback.slice(from, to);
  assert.match(block, /need: named \? named\[1\]\.trim\(\) : ""/,
    '«нужен ответ «X»» читается и без метки «ждёт ответа»');
  assert.doesNotMatch(block, /need: gate && named/, 'прежнее обнуление убрано');

  // `parseQuestion` остаётся строгим: встречный вопрос без `gate` не должен
  // самим фактом имени роли переключать ход на другую роль.
  assert.match(feedback, /const need = gate \? oneLine\(raw\.need, 80\) : "";/,
    'маркерный вопрос без gate по-прежнему без адресата');

  const queue = answers.slice(answers.indexOf('function queueAnswer(row, q, ctx = {}) {'));
  assert.match(queue.slice(0, 3000), /need: String\(q\.need \|\| ""\)/,
    'очередь хранит адресата и у вопроса, который не держит ход');
  assert.doesNotMatch(queue.slice(0, 3000), /need: q\.gate === true \? String\(q\.need/,
    'прежнее обнуление в `queueAnswer` убрано');
}

// ── 3. Недоступный адресат не блокирует голову очереди ─────────────────────
{
  const from = answers.indexOf('const addresseeReady = Boolean(named');
  const to = answers.indexOf('// Вопрос Warden\'а без `need` не должен отправляться Warden\'у самому.', from);
  assert.ok(from > 0 && to > from, 'ветка адресата на месте');
  const branch = answers.slice(from, to);
  assert.match(branch, /if \(item\.gate === true\) \{/, 'держащий ход вопрос ждёт адресата');
  assert.match(branch.slice(0, branch.indexOf('внешний D-019')), /return false;/,
    'и только он: удерживается в очереди до готовности роли');
  assert.match(branch, /answer-need-fallback:/, 'обычный вопрос уходит приёмке с отметкой в журнале');
  // 1.24.0: адрес адресата берётся из «Экземпляров», если в строке его нет
  // (D-015), поэтому готовность считается по резолвленному адресу, а сам
  // адресат уходит с ним, а не с пустым `url` строки.
  assert.match(branch, /let role = \(addresseeReady \? \{ \.\.\.named, url: namedUrl \} : null\) \|\| \(await reviewerRole\(\)\);/,
    'неготовый адресат не подменяется молча: отвечает приёмка');

  // Фолбэк не должен съедать явный `need` к готовой роли.
  assert.match(answers, /const addresseeReady = Boolean\(named && named\.status === "Активна" && namedUrl\);/,
    'готовность адресата считается по статусу и резолвленному адресу');
  assert.match(answers, /roleInstanceUrl\(named\.name\)/,
    'адрес берётся у пары (роль, слот), а не только из строки');
}

// ── 4. Ожидание свободного слота видно в журнале ────────────────────────────
{
  const from = answers.indexOf('function noteAnswerStarved(expect) {');
  const to = answers.indexOf('const answerQueueDueAt = ', from) > 0
    ? answers.indexOf('const answerQueueDueAt = ', from)
    : answers.indexOf('  /** Что на самом деле пришло в поле', from);
  assert.ok(from > 0, 'счётчик ожидания на месте');
  const block = answers.slice(from, to > from ? to : from + 1600);
  assert.match(block, /if \(!expect\) return false;/, 'со свободным слотом жаловаться не на что');
  assert.match(block, /if \(waited <= C\.questionCheckMs\) return false;/,
    'короткое ожидание — норма, а не тревога');
  assert.match(block, /answer-starved:/, 'долгое ожидание названо отдельным ключом троттлинга');

  const cycle = readFileSync(new URL('../src/28-cycle.js', import.meta.url), 'utf8');
  assert.match(cycle, /noteAnswerStarved\(expect\)/, 'шаг цикла докладывает о starvation перед накачкой очереди');
}

// ── 5. Маршрут разбора: потеря доставки — транспорт, а не Мастер ────────────
{
  const { classifyPause, decideHeal, healHoldsCycle, HEAL_PAUSE_CLASS, HEAL_HOLDING } = healApi;
  assert.equal(HEAL_PAUSE_CLASS["answer-orphan"], "transport", 'вид размечен транспортом');
  assert.equal(HEAL_HOLDING.includes("answer-orphan"), false,
    'цикл на этой остановке не стоит: разбор идёт Maintainer\'у');

  const reason = 'Строка «остановка без автоматического пути» передаётся приёмке 3 раз и каждый раз остаётся без хода';
  const verdict = classifyPause("answer-orphan", reason);
  assert.equal(verdict.cls, "transport", 'класс — транспорт');
  assert.equal(verdict.route, "maintainer", 'маршрут — Transport Maintainer');
  assert.notEqual(verdict.with, "warden", 'приёмка не отвечает за потерянную доставку');
  assert.equal(healHoldsCycle("answer-orphan", reason), false, 'и не ждёт нажатия «Продолжить»');

  const decision = decideHeal(verdict, { escalations: 0 }, {});
  assert.equal(decision.action, "maintainer", 'первый же разбор уходит Transport Maintainer\'у');
  const exhausted = decideHeal(verdict, { escalations: 2 }, {});
  assert.equal(exhausted.action, "master", 'после двух разборов — стоп Мастеру, а не третий разбор');

  // Предел повторных передач — из конфигурации, а не из текста.
  const limit = /answerRehandoffMax:\s*(\d+)/.exec(config);
  assert.ok(limit, 'предел объявлен в конфиге');
  assert.equal(Number(limit[1]), 2, 'две повторные передачи, потом — дефект транспорта');
}

console.log('OK: answer-orphan — осиротевшая строка возвращается в очередь, адресат не теряется, ' +
  'потеря доставки идёт Transport Maintainer\'у');
