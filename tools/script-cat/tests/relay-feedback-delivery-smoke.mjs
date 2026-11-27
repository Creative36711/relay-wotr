// Проба 1.16.8 (внешний D-023): очередь обратной связи не имеет права стоять молча.
//
// Инцидент 22.11, внешняя карточка (ручной режим, «Шаг»): строка «остановка без
// автоматического пути» (`41f6f0cf-5705-8139-b90b-c69c24308819`) висела «Ждёт» с
// пустым «Ответом», `answerQueue` был пуст, журнал не говорил ничего. Три независимые
// причины, и каждая из них по отдельности глушила передачу:
//   1. `appendQuestionBody` держал строку в «незавершённых телах» бессрочно: любая
//      ошибка записи (обрезанный ответ Notion, правка человека в теле) навсегда
//      исключала строку и из `adopted`, и из `due`.
//   2. `flushQuestionBodies` не ловил исключение внутри петли: одна битая строка
//      обрывала весь проход, и очередь остальных вопросов в этом цикле не
//      обрабатывалась.
//   3. передача лежала внутри ветки `if (active)` — без прочитанной активной миссии
//      (сбой Notion, две активные миссии) очередь приёмки не пополнялась вовсе.
// Плюс вкладка без допуска: `watchQuestions` молча возвращался, а панель на «Шаг»
// отвечала «Проект ещё не разрешён к работе» и при повреждённом профиле, и при
// удержании переключения, — человек шёл подтверждать допуск, которого уже не было.
//
// Разделён на два прогона с одинаковым харнессом: `build()` собирает живой код бандла,
// и каждая проверка утверждает ПОВЕДЕНИЕ, а не наличие строки. Поэтому проба красная
// на 1.16.7 по всем четырём поведенческим секциям (проверено подменой бандла), а не
// только на номере выпуска.

import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const src = readFileSync(new URL('../relay.user.js', import.meta.url), 'utf8');
const at = (needle, from = 0) => {
  const i = src.indexOf(needle, from);
  assert.ok(i > 0, `фрагмент на месте: ${needle.trim().slice(0, 50)}`);
  return i;
};

const questionBlock = src.slice(at('  const Q = {'), at('  // Свежие счётчики очереди:', at('  const Q = {')));
const answerBlock = src.slice(
  at('  const answerQueue = () => {'),
  at('  async function dispatchTask(', at('  const answerQueue = () => {')),
);

const rt = (p) => (p?.rich_text || p?.title || []).map((x) => x.plain_text || x.text?.content || '').join('');
const sel = (p) => p?.select?.name || '';
const norm = (x) => String(x || '').replace(/-/g, '').toLowerCase();
const richText = (s) => (String(s || '') ? [{ type: 'text', text: { content: String(s) } }] : []);
const copy = (value) => structuredClone(value);

const waitRow = (id, text) => ({
  id,
  properties: {
    'Вопрос': { title: [{ plain_text: text }] },
    'Статус': { select: { name: 'Ждёт' } },
    'Ответ': { rich_text: [] },
    'По умолчанию': { rich_text: rt('работать по-прежнему') },
    'Варианты': { rich_text: [] },
    'Миссия': { rich_text: rt('PRJ-7') },
    'Доставлено': { date: null },
    'Срок': { date: null },
    'Что блокирует': { rich_text: [] },
    'Карточка': { rich_text: [] },
  },
});

// Общий харнесс: реальные `refreshQuestions`, `flushQuestionBodies` и `appendQuestionBody`
// против модели Notion и хранилища ScriptCat.
const makeHarness = ({ activeMission, maxTries = 3, holdMs = 1800000 }) => {
  const db = [], store = new Map(), logs = [], writes = [];
  const get = (key, fallback) => (store.has(key) ? copy(store.get(key)) : fallback);
  const set = (key, value) => store.set(key, copy(value));
  const query = async (id, filter) => {
    const statuses = (filter?.or || []).map((c) => (c.select?.is_empty ? '' : c.select?.equals));
    return copy(db.filter((row) => statuses.includes(sel(row.properties['Статус']) || '')));
  };
  const notion = async (method, path) => {
    if (method === 'GET' && /^blocks\/.+\/children/.test(path)) return { results: [], has_more: false, next_cursor: null };
    if (method === 'PATCH' && /^blocks\/.+\/children$/.test(path)) {
      writes.push(path);
      return {};
    }
    if (method === 'GET' && path.startsWith('pages/')) {
      const row = db.find((item) => item.id === path.slice('pages/'.length));
      if (!row) throw new Error('нет строки');
      return copy(row);
    }
    throw new Error(`неожиданный Notion ${method} ${path}`);
  };
  const patch = async (id, props) => {
    const row = db.find((item) => item.id === id);
    if (!row) throw new Error('нет строки для обновления');
    Object.assign(row.properties, copy(props));
  };
  const api = new Function(
    'C', 'K', 'rt', 'sel', 'norm', 'richText', 'GM_getValue', 'GM_setValue', 'query', 'notion', 'patch',
    'activeMission', 'missionSame', 'log', 'logThrottled', 'dbg', 'document', 'window', 'uid',
    'technicalInfo', 'roleContext', 'reviewerRole', 'sendToRole', 'messagesAfter', 'parseMarker', 'markerMissing',
    'pause', 'firstLine', 'roles', 'queueOf', 'requestPlan', 'isUuid', 'roleRows',
    `${questionBlock}\n${answerBlock}\nreturn { refreshQuestions, flushQuestionBodies, questionBodyPending, answerQueue, openQuestions, watchQuestions };`,
  )(
    {
      repo: 'example/relay-fixture', questions: 'ds-1', questionCheckMs: 600000, questionTextMax: 180,
      questionTextFull: 12000, questionLineMax: 3, questionDefaultMax: 200,
      questionBodyHoldMs: holdMs, questionBodyMaxTries: maxTries, adrCheckMs: 600000,
    },
    { qQueue: 'q-queue', answers: 'answers', expect: 'expect', pending: 'pending' },
    rt, sel, norm, richText, get, set, query, notion, patch,
    activeMission, (a, b) => String(a).toLowerCase() === String(b).toLowerCase(),
    (text, error, options) => logs.push({ text, error, options }),
    (key, text, error) => logs.push({ key, text, error }),
    () => {}, undefined, { setInterval: () => 1, clearInterval: () => {} },
    () => 'turn-1', () => 'ТЕХНИКА', () => 'РОЛЬ', async () => ({ name: 'Warden', fn: 'Reviewer' }),
    async () => true, () => [], () => null, async () => false,
    (reason) => { throw new Error(`неожиданная пауза: ${reason}`); },
    (text) => String(text || '').split('\n')[0], async () => [], async () => ({ summary: '' }),
    async () => {}, (value) => Boolean(value), async () => [],
  );
  return { api, db, store, logs, writes, copy };
};

// ── 1. Передача не зависит от чтения активной миссии ─────────────────────────
// Страховка в обе стороны: миссия нужна фильтром, а не условием самой передачи.
{
  const h = makeHarness({ activeMission: async () => copy({ id: 'm', properties: { 'Миссия': { title: [{ plain_text: 'PRJ-7' }] } } }) });
  h.db.push(waitRow('row-ok', 'Проверить доставку'));
  await h.api.refreshQuestions({ force: true, quiet: true });
  assert.equal(h.api.answerQueue().filter((i) => i.id === 'row-ok').length, 1,
    'строка «Ждёт» без ответа передана приёмке');
}
{
  const h = makeHarness({ activeMission: async () => { throw new Error('Найдено несколько активных миссий'); } });
  h.db.push(waitRow('row-nomission', 'остановка без автоматического пути'));
  await h.api.refreshQuestions({ force: true, quiet: true });
  assert.equal(h.api.answerQueue().filter((i) => i.id === 'row-nomission').length, 1,
    'сбой чтения миссии не снимает передачу с очереди');
  assert.ok(h.logs.some((l) => /Активная миссия не прочитана/.test(l.text || '')),
    'сбой назван в журнале, а не проглочен');
}
{
  // Активной миссии нет вовсе — долг транспорта остаётся долгом транспорта.
  const h = makeHarness({ activeMission: async () => null });
  h.db.push(waitRow('row-nomission2', 'вопрос без миссии'));
  await h.api.refreshQuestions({ force: true, quiet: true });
  assert.equal(h.api.answerQueue().filter((i) => i.id === 'row-nomission2').length, 1,
    'пустая база миссий не блокирует очередь приёмки');
}

// ── 2. Удержание незаписанного тела ограничено сроком ───────────────────────
{
  const h = makeHarness({ activeMission: async () => null, holdMs: 3_600_000, maxTries: 9 });
  h.db.push(waitRow('row-body', 'Вопрос с незаписанным телом'));
  h.store.set('cfn-question-bodies', [{ rowId: 'row-body', q: { text: 'Вопрос с незаписанным телом' }, ctx: {}, at: Date.now(), tries: 0 }]);
  await h.api.refreshQuestions({ force: true, quiet: true });
  assert.equal(h.api.answerQueue().filter((i) => i.id === 'row-body').length, 0,
    'пока тело ждёт записи, обрезанный материал приёмке не уходит');
  assert.equal(h.api.questionBodyPending('row-body'), true, 'свежее удержание активно');
  const aged = copy(h.store.get('cfn-question-bodies'));
  aged[0].at = Date.now() - 7_200_000;
  h.store.set('cfn-question-bodies', aged);
  await h.api.refreshQuestions({ force: true, quiet: true });
  assert.equal(h.api.questionBodyPending('row-body'), false, 'после срока удержание гаснет');
  assert.equal(h.api.answerQueue().filter((i) => i.id === 'row-body').length, 1,
    'просроченная строка передаётся по тому, что есть в базе, а не висит вечно');
  assert.ok(h.db.some((row) => row.id === 'row-body' && sel(row.properties['Статус']) === 'Ждёт'),
    'строка остаётся «Ждёт», пока ответа нет');
}

// ── 3. Живой `flushQuestionBodies`: битая строка не обрывает проход ─────────
{
  const helpersFrom = at('  const questionBodies = () => {');
  const appendFrom = at('  async function appendQuestionBody(row, q, ctx = {}) {', helpersFrom);
  const flushFrom = at('  async function flushQuestionBodies() {', appendFrom);
  const flushTo = at('  // Если вопрос создали вручную в Notion', flushFrom);
  const code = src.slice(helpersFrom, appendFrom) +
    '\n  function questionQueuedForRow() { return false; }\n' +
    '  const Q = { wait: "Ждёт", done: "Решено", byDefault: "Принят дефолт", cancelled: "Отменён" };\n' +
    '  const questionMaterial = (url) => String(url || "");\n' +
    '  const answerQueue = () => { const list = GM_getValue("answers", []); return Array.isArray(list) ? list : []; };\n' +
    '  const requeued = [];\n' +
    '  function queueQuestion(q, ctx) { requeued.push({ q, ctx }); }\n' +
    '  function questionFromRow(row) { return { text: rt(row?.properties?.["Вопрос"]), fullText: "", fallback: "", options: [], need: "" }; }\n' +
    '  const questionFromRowComplete = async (row) => questionFromRow(row);\n' +
    '  function queueAnswer(row, q, ctx) {\n' +
    '    const list = answerQueue().filter((item) => item.id !== row.id);\n' +
    '    list.push({ id: row.id, text: q.text, fullText: q.fullText || q.text, fallback: q.fallback, role: (ctx || {}).roleName || "" });\n' +
    '    GM_setValue("answers", list);\n' +
    '    return list.at(-1);\n' +
    '  }\n' +
    '  const answerHandoffKey = (id) => `cfn-q-handoff:${id}`;\n' +
    '  function handWaitingRow(row, q, ctx) {\n' +
    '    if (!row || !row.id) return false;\n' +
    '    const status = sel(row.properties?.["Статус"]);\n' +
    '    if (status && status !== Q.wait) return false;\n' +
    '    if (rt(row.properties?.["Ответ"]).trim()) return false;\n' +
    '    GM_setValue(answerHandoffKey(row.id), Date.now());\n' +
    '    queueAnswer(row, q || questionFromRow(row), ctx || {});\n' +
    '    return true;\n' +
    '  }\n' +
    src.slice(appendFrom, flushFrom) + src.slice(flushFrom, flushTo);

  const build = ({ maxTries, rows }) => {
    const store = new Map([['cfn-question-bodies', [
      { rowId: 'bad', q: { text: 'плохая', fullText: 'полный текст плохой строки' }, ctx: {}, at: 1, tries: 0 },
      { rowId: 'good', q: { text: 'хорошая', fullText: 'полный текст хорошей строки' }, ctx: {}, at: 1, tries: 0 },
    ]]]);
    const logs = [], writes = [];
    const instance = new Function(
      'C', 'K', 'GM_getValue', 'GM_setValue', 'log', 'logThrottled', 'dbg', 'richText', 'rt', 'sel', 'norm',
      'withQuestionWriteLock', 'notion', 'patch', 'isUuid',
      `${code}\nreturn { flushQuestionBodies, questionBodies, questionBodyPending, answerQueue, requeued };`,
    )(
      { questionCheckMs: 600000, questionBodyHoldMs: 1800000, questionBodyMaxTries: maxTries },
      { answers: 'answers', qQueue: 'q-queue' },
      (key, fallback) => (store.has(key) ? structuredClone(store.get(key)) : fallback),
      (key, value) => store.set(key, structuredClone(value)),
      (text, error, options) => logs.push({ text, error, options }),
      (key, text, error) => logs.push({ key, text, error }),
      () => {},
      (s) => (String(s || '') ? [{ type: 'text', text: { content: String(s) } }] : []),
      (props) => (props?.rich_text || props?.title || []).map((x) => x.plain_text || x.text?.content || '').join(''),
      (props) => props?.select?.name || '',
      (x) => String(x || '').replace(/-/g, '').toLowerCase(),
      async (work) => work(),
      async (method, path) => {
        if (method === 'GET' && /^blocks\/.+\/children/.test(path)) {
          const id = path.split('/')[1];
          if (id === 'bad') throw new Error('Notion blocks 503');
          return { results: [], has_more: false, next_cursor: null };
        }
        if (method === 'PATCH' && /^blocks\/.+\/children$/.test(path)) {
          writes.push(path);
          return {};
        }
        if (method === 'GET' && path.startsWith('pages/')) {
          const row = rows[path.slice('pages/'.length)];
          if (!row) throw new Error('нет строки');
          return structuredClone(row);
        }
        throw new Error(`неожиданный Notion ${method} ${path}`);
      },
      async () => {},
      (value) => Boolean(value),
    );
    return { store, logs, writes, instance };
  };

  // Одна падающая строка: вторая обработана в том же проходе, неудача посчитана.
  const rows = { good: { id: 'good', properties: { 'Вопрос': { title: [{ plain_text: 'хорошая' }] }, 'Статус': { select: { name: 'Ждёт' } }, 'Ответ': { rich_text: [] } } } };
  const h = build({ maxTries: 9, rows });
  await h.instance.flushQuestionBodies();
  const left = h.store.get('cfn-question-bodies');
  assert.deepEqual(left.map((item) => item.rowId), ['bad'],
    'битая строка осталась в очереди тел, а хорошая — записана и отпущена');
  assert.equal(left[0].tries, 1, 'неудача посчитана');
  assert.equal(h.writes.length, 1, 'PATCH тела выполнен ровно для хорошей строки');
  assert.ok(h.instance.answerQueue().some((item) => item.id === 'good'),
    'хорошая строка передана приёмке в том же проходе');
  assert.ok(h.logs.some((l) => /попытка 1 из 9/.test(l.text || '')),
    'задержка из-за битой строки видна в журнале, а не только в `dbg`');

  // После лимита попыток строка отпускается, а не держит очередь бессрочно.
  const h2 = build({ maxTries: 1, rows });
  await h2.instance.flushQuestionBodies();
  assert.deepEqual(h2.store.get('cfn-question-bodies'), [],
    'после предела попыток битая строка убирается из незавершённых');
  assert.equal(h2.instance.questionBodyPending('bad'), false, 'удержание снято вместе с записью');
  assert.ok(h2.logs.some((l) => l.error === true && /отпускаю/.test(l.text || '')),
    'отпускание строки объявлено в журнале как ошибка, а не как тишина');
}

// ── 4. Простой объясняется причиной, сторож не снимается допуском ────────────
{
  const from = at('  const projectBlockReason = () => {');
  const to = at('  const K = {', from);
  const block = src.slice(from, to);
  const run = ({ profile = {}, approved = false }) => new Function(
    'ACTIVE_PROFILE', 'GM_getValue',
    `${block}; return { projectBlockReason, projectBlockedText };`,
  )(profile, (key, fallback) => (key === 'cfn-project-approved' ? approved : fallback));
  assert.match(run({ profile: { invalid: true } }).projectBlockedText(), /повреждён|обновите страницу/,
    'повреждённый профиль — отдельная подсказка');
  assert.match(run({ profile: { legacy: true } }).projectBlockedText(), /не выбрала проект|выберите профиль/,
    'вкладка без профиля — отдельная подсказка');
  assert.match(run({}).projectBlockedText(), /Разрешить работу/,
    'снятый допуск — с указанием, где его вернуть');
  assert.match(run({}).projectBlockedText(), /«Подключениях»/,
    'сказано, что допуск снимает правка подключений');
  assert.equal(run({ approved: true }).projectBlockReason(), '',
    'разрешённый проект не имеет причины блокировки');

  const tickFrom = at('  async function tick(');
  const cycle = src.slice(tickFrom, tickFrom + 5000);
  assert.match(cycle, /projectBlockedText\(\)/, 'шаг называет причину');
  assert.match(cycle, /noteFeedbackPipelineHeld\(\)/, 'шаг говорит и про очередь обратной связи');
  assert.match(cycle, /armFeedbackWatch\(\)/, 'шаг вооружает сторожей, когда допуск появился');
  const mountFrom = at('  function mount() {');
  const mountEnd = at('  async function toggleAuto()', mountFrom);
  const panel = src.slice(mountFrom, mountEnd);
  assert.doesNotMatch(panel, /ui\.step|ui\.wake|ui\.toggle/, 'executor widget no longer duplicates Relay cycle controls');
  assert.match(panel, /ui\.relay/, 'executor widget links to the main Relay console');
  assert.ok(!/log\("Проект ещё не разрешён к работе: проверьте его в управлении проектами\.", true\);\s*\n\s*return;/.test(src),
    'прежнее универсальное сообщение не осталось ни в одной точке');

  const watchdogFrom = at('  let questionsWatch = 0;');
  const watchdog = src.slice(watchdogFrom, at('\n  }', at('  function armFeedbackWatch()', watchdogFrom)));
  assert.match(watchdog, /const questionsWatchArmed = \(\) => questionsWatch !== 0;/, 'взводимость сторожа читаема');
  assert.ok(!/if \(typeof projectApproved === "function" && !projectApproved\(\)\) return;\s*\n\s*if \(questionsWatch\) return;/.test(watchdog),
    'сторож вопросов не снимается из-за допуска');
  assert.match(watchdog, /function noteFeedbackPipelineHeld\(\)/, 'есть явное объяснение простоя очереди');
  assert.match(watchdog, /logThrottled\(\s*\n?\s*"feedback-pipeline-held"/, 'простой пишется с троттлингом, а не на каждый шаг');
  assert.match(watchdog, /вкладка держит переключение проекта/, 'удержание вкладки называется своей причиной');
  assert.match(watchdog, /Управление проектами/, 'подсказка ведёт туда, где допуск возвращается');

  const decFrom = at('  let decisionsWatch = 0;');
  const decisions = src.slice(decFrom, at('\n  }', decFrom));
  assert.ok(!/if \(typeof projectApproved === "function" && !projectApproved\(\)\) return;\s*\n\s*if \(decisionsWatch\) return;/.test(decisions),
    'сторож ADR тоже не снимается из-за допуска');

  const bootFrom = at('  const originalProjectTick = tick;');
  const boot = src.slice(bootFrom, at('  const originalProjectPollFlush', bootFrom));
  assert.match(boot, /noteFeedbackPipelineHeld\(\)/, 'тихий кэш вопросов сопровождается записью в журнале');
}

// ── 5. Оформление выпуска и настройки ───────────────────────────────────────
assert.match(src, /^\/\/ @version\s+1\.35\.6\s*$/m, 'сборка 1.35.6 объявлена');
assert.match(src, /\|\| "1.35.6";/, 'SCRIPT_VERSION совпадает с @version');
{
  const from = at('  const C = {');
  const cfg = src.slice(from, src.indexOf('\n  };', from));
  assert.match(cfg, /questionBodyHoldMs: \d+/, 'срок удержания строки без тела назван');
  assert.match(cfg, /questionBodyMaxTries: \d+/, 'число попыток дописывания названо');
  assert.match(src, /C\.questionBodyHoldMs/, 'ожидание читает срок из конфига');
  assert.match(src, /C\.questionBodyMaxTries/, 'попытки ограничены конфигом');
  // Отдельный механизм `arenaResendMax` не трогается этим решением.
  assert.match(cfg, /arenaResendMax: \d+/, 'механизм повторной отправки ответа не смешан с удержанием тела');
}

// Пороги и переход счётчика между попытками — на живом коде helper-ов.
{
  const helpers = src.slice(at('  const questionBodies = () => {'), at('  async function questionBlocks(id) {'));
  assert.match(helpers, /if \(questionBodyAgeMs\(item\) >= questionBodyHoldMs\(\)\) return false;/,
    'удержание гаснет по сроку');
  assert.match(helpers, /at: Number\(previous\?\.at\) \|\| Date\.now\(\), tries: Number\(previous\?\.tries\) \|\| 0/,
    'возраст и счётчик не обнуляются при повторной записи');
  const mk = (store, C, now = 10_000_000) => new Function(
    'C', 'GM_getValue', 'GM_setValue', 'Date',
    `${helpers}; return { questionBodyPending, questionBodyTries, questionBodyHoldMs, bumpQuestionBodyTry, rememberQuestionBody };`,
  )(
    C,
    (key, fallback) => (store.has(key) ? store.get(key) : fallback),
    (key, value) => store.set(key, value),
    { now: () => now },
  );
  const C = { questionCheckMs: 600000, questionBodyHoldMs: 1800000, questionBodyMaxTries: 3 };
  assert.equal(mk(new Map([['cfn-question-bodies', [{ rowId: 'r1', at: 9_999_999 }]]]), C).questionBodyPending('r1'), true,
    'свежее тело держит передачу');
  assert.equal(mk(new Map([['cfn-question-bodies', [{ rowId: 'r1', at: 1_000 }]]]), C).questionBodyPending('r1'), false,
    'просроченное тело передачу не держит');
  assert.equal(mk(new Map(), C).questionBodyPending('r1'), false, 'без записи держать нечего');
  assert.ok(mk(new Map(), C).questionBodyHoldMs() >= 600000, 'срок не короче периода проверки вопросов');
  assert.ok(mk(new Map(), { ...C, questionCheckMs: 7_200_000 }).questionBodyHoldMs() >= 7_200_000,
    'частый опрос не укорачивает удержание');
  const counted = new Map([['cfn-question-bodies', [{ rowId: 'r1', at: 1 }]]]);
  const api = mk(counted, C);
  assert.equal(api.bumpQuestionBodyTry('r1'), 1, 'первая неудача посчитана');
  assert.equal(api.bumpQuestionBodyTry('r1'), 2, 'вторая посчитана');
  assert.equal(api.questionBodyTries('r1'), 2, 'счётчик живёт в записи строки');
  // Дополнение вопроса не обнуляет ни срок, ни попытки: иначе удержание
  // испарялось бы на каждом обновлении материала.
  const kept = new Map([['cfn-question-bodies', [{ rowId: 'r2', q: { fullText: 'а' }, at: 5, tries: 1 }]]]);
  const keepApi = mk(kept, { ...C, questionBodyMaxTries: 3 });
  keepApi.rememberQuestionBody({ id: 'r2' }, { fullText: 'а' }, {}, 'Полный текст вопроса');
  const after = kept.get('cfn-question-bodies')[0];
  assert.equal(after.at, 5, 'дополнение вопроса не обнуляет срок удержания');
  assert.equal(after.tries, 1, 'дополнение вопроса не обнуляет счётчик попыток');
  // Сравнение тела нормализует переводы строк: Notion вернул тот же текст,
  // и повторная запись поверх правки человека не нужна.
  const body = src.slice(at('  async function appendQuestionBody(row, q, ctx = {}) {'),
    at('  function supplementalQuestion(q, row) {'));
  assert.match(body, /const sameText = /, 'есть нормализованное сравнение текста');
  assert.match(body, /sameText\(blockText\(blocks\[main \+ 1\]\), full\)/, 'проверка «уже записано» не зависит от переводов строк');
  assert.match(body, /tries >= questionBodyMaxTries\(\)/, 'после предела попыток строка отпускается');
  assert.match(body, /forgetQuestionBody\(row\.id\);\s*\n\s*log\(/, 'отпускание объявлено в журнале');
}

console.log('OK: внешний D-023 — удержание тела ограничено сроком и числом попыток, одна битая строка');
console.log('    не обрывает проход, передача не зависит от активной миссии, а простой объясняется причиной.');
