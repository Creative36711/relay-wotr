// Проба 1.4.40: Координатор сам распоряжается очередью — включая черновики.
//
// Случай Мастера (2026-10-24). На приёмке CASEA-1.8 Координатор написал:
// «старый Draft 1.9 архивирован — перевести Draft в Ready я не вправе», и
// создал такую же карточку заново. Причина была не в правах, а в двух вещах:
//   • в промпте стояло «Ready, Running и Submitted ставит движок» — читается
//     как запрет выдавать существующий черновик;
//   • в строке «Очередь: …» черновиков не было вовсе, то есть Координатор не
//     видел собственный задел (CASEA-1.10 лежал Draft и в очереди не появлялся).
//
// Здесь проверяется: права выданы, черновики видны списком, счётчик Draft есть,
// а подсказки на промах говорят «выдай черновик», а не «создайте карточку».

import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const src = readFileSync(new URL('../relay.user.js', import.meta.url), 'utf8');
import { assertUserscriptVersionContract } from '../version-oracle.mjs';
const versionMatch = assertUserscriptVersionContract(src);
const V = versionMatch[1];

assert.match(src, new RegExp(`@version\\s+${V.replace(/\./g, '\\.')}`), `версия ${V}`);

// ── 1. Промпт: очередь — зона Координатора (декларативный компилятор) ──────
const { PromptCompiler, planRequest } = await import('./helpers/prompt-env.mjs');
const draftLineText = 'Черновики: CASEA-1.10 · Регрессия и отчёт (Build/Release, Sequence 100).';
const readyLineText = 'Готовы к выдаче: CASEA-1.10 · Регрессия и отчёт (Build/Release, Sequence 100).';
const prompt = PromptCompiler.compile(planRequest({
  queue: { summary: '1 Submitted, 0 Running, 1 Ready, 0 Rework, 2 Draft', draft: draftLineText, ready: readyLineText },
})).text;

assert.match(prompt, /1 Submitted, 0 Running, 1 Ready, 0 Rework, 2 Draft/, 'черновики есть в счётчике очереди');
assert.match(prompt, /CASEA-1\.10 · Регрессия и отчёт/, 'черновики перечислены списком');
assert.match(prompt, /Черновики правь под оракул, выдавай сам/, 'выдача подходящего черновика — право Coordinator');
assert.match(prompt, /Running\/Submitted — движок/, 'граница движка названа точно');
assert.match(prompt, /Accepted\/Rework\/Ready — ты/, 'Ready — не движок, а Координатор');
assert.match(prompt, /Готовы к выдаче: CASEA-1\.10 · Регрессия и отчёт \(Build\/Release, Sequence 100\)/, 'Ready перечислен с ролью');
assert.match(prompt, /next — имя роли выдаваемой карточки или done/, 'адресат берётся из карточки');
// D-022: worker readiness and account/container policy stay with Relay.
assert.match(prompt, /Relay выбирает слот\/аккаунт с учётом квоты/);
assert.match(prompt, /Не проверяй Status, worker URL\/Agent State, слот или квоту/);
assert.match(prompt, /Admin URL\/права\/удаление — Мастер/,
  'administrative role state remains human-managed');
assert.match(prompt, /Reviewer карточку не выдавай/, 'Reviewer не получает рабочую карточку');
assert.doesNotMatch(prompt, /не вправе|нельзя переводить Draft/i, 'запрета на выдачу черновика нет');

// ── 2. draftLine: список, а не число ────────────────────────────────────────
// Разбор дефекта адресата вынесен в roleDefect: его теперь используют и
// readyLine, и reworkLine (D-075 п. 2), а не только черновики.
const lineFrom = src.indexOf('  function roleDefect(role, known = []) {');
const lineTo = src.indexOf('  async function coordinatorStep(');
assert.ok(lineFrom > 0 && lineTo > lineFrom, 'draftLine на месте');
const draftLine = new Function(
  'C', 'taskTitle', 'taskRole', 'norm',
  `${src.slice(lineFrom, lineTo)}; return draftLine;`,
)(
  { draftLineMax: 2 },
  (card) => card.properties['Запрос'].title[0].text.content,
  (card) => card.properties['Кому']?.select?.name || '',
  (x) => String(x || '').replace(/-/g, '').toLowerCase(),
);

const card = (title, who, seq, check = '') => ({
  id: title,
  properties: {
    'Запрос': { title: [{ text: { content: title } }] },
    'Кому': { select: who ? { name: who } : null },
    'Sequence': { number: seq },
    'Check': { select: check ? { name: check } : null },
  },
});

assert.match(draftLine([]), /Черновиков нет/, 'пустой задел назван словами');
assert.match(draftLine([]), /предложи сам/, 'и это не приглашение ждать Мастера');

const two = draftLine(
  [card('CASEA-1.10 · Регрессия и отчёт', 'Build/Release', 100), card('CASEA-1.9 · Реестр caps', 'FixtureExecutor', 90)],
  ['FixtureExecutor', 'Build/Release'],
);
assert.match(two, /CASEA-1\.9 · Реестр caps \(FixtureExecutor, Sequence 90\)/, 'порядок по Sequence, роль и номер видны');
assert.match(two, /CASEA-1\.10 · Регрессия и отчёт \(Build\/Release, Sequence 100\)/, 'второй черновик тоже в списке');
assert.ok(two.indexOf('Sequence 90') < two.indexOf('Sequence 100'), 'сначала меньший Sequence');

const three = draftLine([
  card('A · один', 'FixtureExecutor', 10),
  card('B · два', 'FixtureExecutor', 20),
  card('C · три', 'FixtureExecutor', 30),
]);
assert.match(three, /и ещё 1/, 'лишнее сверх лимита свёрнуто');
assert.ok(!/C · три/.test(three), 'свёрнутые не перечисляются');

// Роль не задана — так и пишем, а не пустые скобки.
assert.match(draftLine([card('D · четыре', '', 40)]), /роль не задана/, 'пустая роль названа');

// Directory rows expose only semantic role/Function to Coordinator planning.
const row = (name, fn, status = '', url = '') => ({ name, fn, status, url });
const DIRECTORY = [
  row('FixtureExecutor', 'Executor', 'Активна', 'https://arena.ai/agent/fixtureExecutor'),
  row('Build/Release', 'Executor', 'Ждёт', ''),
  row('Studio', 'Auditor', 'Активна', ''),
  row('Reviewer', 'Reviewer', 'Активна', 'https://arena.ai/agent/reviewer'),
];

for (const name of ['Build/Release', 'Studio']) {
  const line = draftLine([card(`role ${name}`, name, 50)], DIRECTORY);
  assert.doesNotMatch(line, /Статус|Agent URL/, 'worker readiness is not a planning defect');
}
assert.match(draftLine([card('G · семь', 'UI/UX', 70)], DIRECTORY), /UI\/UX — нет в «Ролях»/,
  'unknown role definition remains a structural issue');
assert.match(draftLine([card('R · reviewer', 'Reviewer', 80)], DIRECTORY),
  /Reviewer — Функция «Reviewer» не является рабочей/,
  'non-worker Function cannot receive a work card');
assert.doesNotMatch(draftLine([card('H · восемь', 'fixtureExecutor', 90)], DIRECTORY), /нет в «Ролях»/,
  'role matching remains case-insensitive');
assert.doesNotMatch(draftLine([card('I · девять', 'Build/Release', 100)], []), /нет в «Ролях»/,
  'without directory facts the helper does not invent a missing-role defect');

// ── 2a. readyLine: что лежит в Ready — с ролью ─────────────────────────────
const rFrom = src.indexOf('  function readyLine(cards, known = []) {');
const rTo = src.indexOf('  async function coordinatorStep(');
assert.ok(rFrom > 0 && rTo > rFrom, 'readyLine на месте');
// D-075 п. 2: readyLine принимает список ролей и называет дефект адресата,
// поэтому в песочницу идёт и roleDefect.
const readyLine = new Function(
  'C', 'taskTitle', 'taskRole', 'norm',
  `${src.slice(src.indexOf('  function roleDefect(role, known = []) {'), src.indexOf('  /**\n   * Что уже лежит в Ready'))}
   ${src.slice(rFrom, rTo)}; return readyLine;`,
)(
  { readyLineMax: 2 },
  (card) => card.properties['Запрос'].title[0].text.content,
  (card) => card.properties['Кому']?.select?.name || '',
  (x) => String(x || '').replace(/-/g, '').toLowerCase(),
);

assert.match(readyLine([]), /Ready пуст/, 'пустой Ready назван словами');
assert.match(
  readyLine([card('CASEA-1.10 · Регрессия и отчёт', 'Build/Release', 100)]),
  /CASEA-1\.10 · Регрессия и отчёт \(Build\/Release, Sequence 100\)/,
  'у готовой карточки видно, кому её выдавать',
);
assert.match(readyLine([card('Без роли', '', 10)]), /роль не задана/, 'пустая роль названа');
assert.match(readyLine([card('K-6', 'Executor Core', 60, 'fail')]), /Check=fail: результат не принят, сначала нужен Rework\/разбор Warden/, 'Coordinator явно видит fail и нужное состояние');
{
  const many = readyLine([
    card('A · один', 'FixtureExecutor', 10),
    card('B · два', 'FixtureExecutor', 20),
    card('C · три', 'FixtureExecutor', 30),
  ]);
  assert.match(many, /и ещё 1/, 'лишнее сверх readyLineMax свёрнуто');
  assert.ok(!/C · три/.test(many), 'свёрнутые не перечисляются');
  assert.ok(many.indexOf('A · один') < many.indexOf('B · два'), 'порядок по Sequence');
}

// ── 3. queueOf считает Draft ───────────────────────────────────────────────
const qFrom = src.indexOf('  async function queueOf(mission, { strict = false } = {}) {');
const qTo = src.indexOf('  function draftLine(cards, known = []) {');
// 1.4.63: очередь запоминает карточки в Rework — по этой памяти транспорт
// снимает следы прошлого ответа при повторной выдаче.
const remembered = [];
const queueOf = new Function(
  'tasks',
  'rememberRework',
  'assertMissionBindings',
  `${src.slice(qFrom, qTo)}; return queueOf;`,
)(
  async (state) =>
    Array.from({ length: { Submitted: 1, Running: 0, Ready: 1, Rework: 1, Draft: 2 }[state] || 0 }, (_, i) => ({
      id: `${state}-${i}`,
    })),
  (cards) => remembered.push(...cards.map((c) => c.id)),
  async () => {},
);

queueOf({ id: 'm1' }).then((queue) => {
  assert.equal(queue.draft.length, 2, 'черновики читаются отдельным запросом');
  assert.equal(queue.summary, '1 Submitted, 0 Running, 1 Ready, 1 Rework, 2 Draft, 0 Blocked', 'счётчик Draft в строке очереди');
  assert.deepEqual(remembered, ['Rework-0'], 'карточка из Rework запомнена для повторной выдачи');

  // ── 4. Ход Координатора передаёт черновики в промпт ──────────────────────
  const planFrom = src.indexOf('  async function requestPlan(');
  const planTo = src.indexOf('  async function dispatchTask(', planFrom);
  const plan = src.slice(planFrom, planTo);
  assert.match(plan, /const drafts = draftLine\(queue\.draft \|\| \[\], directory\);/, 'список черновиков собирается');
  assert.match(plan, /const directory = await roleRows\(\)/, 'и сверяется со всей базой «Роли», а не только с активными');
  assert.match(
    plan,
    /coordinatorPrompt\(\s*mission,\s*role,\s*summary,\s*turnId,\s*planNote,\s*answerLine,\s*drafts,\s*readyLine\(queue\.ready, directory\),\s*reworkLine\(queue\.rework, directory\),\s*briefing\.openLine,\s*briefing\.answersLine,?\s*\)/s,
    'и уходит в промпт (D-075 п. 2: списки получают базу «Роли», чтобы дефект адресата был виден)',
  );
  assert.match(plan, /\$\{\(queue\.draft \|\| \[\]\)\.length\} Draft/, 'запасной счётчик тоже знает про Draft');

  // ── 5. Подсказки на промах говорят про черновик, а не «создайте карточку» ─
  const routeFrom = src.indexOf('  function decisionRoute(next,');
  const routeTo = src.indexOf('  // Свежие счётчики очереди');
  const decisionRoute = new Function(
    'norm',
    `${src.slice(routeFrom, routeTo)}; return decisionRoute;`,
  )((x) => String(x || '').replace(/-/g, '').toLowerCase());

  const roles = [{ name: 'Coordinator', fn: 'Coordinator' }, { name: 'FixtureExecutor', fn: 'Executor' }];

  const ask = decisionRoute('FixtureExecutor', { roles, readyRoles: [] });
  assert.equal(ask.kind, 'ask', 'нет карточки — просим, а не падаем');
  assert.match(ask.note, /переведи в Ready подходящий Draft/, 'подсказка предлагает выдать черновик');

  const again = decisionRoute('FixtureExecutor', { roles, readyRoles: [], misses: 1 });
  assert.equal(again.kind, 'pause', 'второй промах — пауза');
  assert.match(again.reason, /Нажмите «Продолжить»/, 'выход — продолжить, а не «создайте карточку»');
  assert.match(again.reason, /создать карточку или выдать черновик/, 'сказано, что он умеет');

  const directory = [
    { name: 'Coordinator', fn: 'Coordinator', status: 'Активна', url: 'https://arena.ai/agent/c' },
    { name: 'FixtureExecutor', fn: 'Executor', status: 'Активна', url: 'https://arena.ai/agent/k' },
    { name: 'Build/Release', fn: 'Auditor', status: 'Ждёт', url: '' },
  ];
  const assigned = decisionRoute('Build/Release', { roles, readyRoles: ['Build/Release'], directory });
  assert.deepEqual(assigned, { kind: 'dispatch', roleName: 'Build/Release' },
    'non-active status and empty worker URL do not veto Coordinator role assignment');

  const self = decisionRoute('Coordinator', { roles, readyRoles: [] });
  assert.match(self.note, /выдай работу сам/, 'ход вернулся — выдай сам');

  console.log(
    `OK: relay ${V} — Coordinator plans by role/function; Relay owns status, URL, slot and account quota; Draft/Ready authority remains intact`,
  );
});
