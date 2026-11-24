// D-004 (1.18.0): квоты Arena разложены по аккаунтам, работа остаётся
// последовательной.
//
// Мастер: «один аккаунт упёрся — остальные работают; админский аккаунт только
// Coordinator, Warden и Transport Maintainer; адреса аккаунтов — в Notion
// (поле «Аккаунт»), в транспорт их вводить не надо; вопрос "как узнать, на
// каком аккаунте вкладка"». Здесь
// проверяется поведение, а не строки:
//   1) подпись аккаунта читается по DOM и переживает свёрнутый сайдбар;
//   2) полночь сброса считается по Москве, а не по поясу браузера;
//   3) лимит принадлежит АККАУНТУ: рабочий аккаунт не останавливает цикл,
//      административный останавливает и зовёт Мастера;
//   4) «Доступность» пишет только транспорт, «Статус» не трогается;
//   5) задача на лимитированном аккаунте не выдаётся и не отправляется, а
//      незакрытый ход не снимается уборкой фантомов;
//   6) вернувшиеся роли подхватывают прежние карточки — очередь не переставляется;
//   7) «Шаг» и автоцикл идут одним путём (проверка в `tick`, а не в кнопке);
//   8) почта аккаунта — из Notion (D-005): ввода в ⚙ нет, смена адреса
//      посреди окна лимита не теряет отметку и не требует правок в браузере.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { healApi } from './helpers/prompt-env.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, '..', 'src');
const src = (name) => readFileSync(join(srcDir, name), 'utf8');
const accountsSrc = src('44-accounts.js');

// ── Стенд: хранилище и сеть подменены, остальное — настоящий код модуля ────
function makeAccounts({ initial = {}, dom = null } = {}) {
  const store = new Map(Object.entries(structuredClone(initial)));
  const patches = [];
  const logs = [];
  const pauses = [];
  const clicks = [];
  const K = {
    accountLimits: 'cfn-account-limits',
    accountSeen: 'cfn-account-seen-v1', accountIdle: 'cfn-account-idle-ask',
    rolesCache: 'cfn-roles-cache',
  };
  const norm = (x) => String(x || '').replace(/-/g, '').toLowerCase();
  const GM_getValue = (key, fallback) => (store.has(key) ? structuredClone(store.get(key)) : fallback);
  const GM_setValue = (key, value) => { store.set(key, structuredClone(value)); };
  const api = new Function(
    'GM_getValue', 'GM_setValue', 'K', 'norm', 'log', 'pause', 'patch', 'sleep', 'document', 'location',
    'dailyUsageLimitBlocked', 'monitorDailyLimit', 'roleRows',
    `${accountsSrc}
     return { moscowMidnight, accountResetText, accountEmailFromDom, accountIconCollapsed,
       accountExpandButton, readAccountEmail, forgetAccountRead,
       accountLimit, accountBlocked, accountLimitText, accountLimitLines, markAccountLimit,
       clearAccountLimit, accountVerdict, accountLimitBlocks, accountHoldsExpect,
       accountLayoutProblems, markTouched: markAccountLimit, accountsTick, accountPlanNote,
       accountIdleNote, accountIdleAskedMark, accountRoleForPath, ACCOUNT_RECONCILE: null };`,
  )(
    GM_getValue,
    GM_setValue,
    K,
    norm,
    (text) => logs.push(String(text)),
    (reason, ctx = {}) => { pauses.push({ reason: String(reason), kind: ctx.kind || '' }); },
    async (pageId, properties) => { patches.push({ pageId, properties }); },
    async () => {},
    dom && dom.document,
    dom && dom.location,
    dom ? dom.blocked : () => false,
    () => { pauses.push({ reason: 'daily-limit', kind: 'daily-limit' }); return true; },
    async (opts = {}) => (globalThis.__relayRoleRows ? globalThis.__relayRoleRows(opts) : store.get('cfn-roles-cache')?.rows || []),
  );
  return { api, store, patches, logs, pauses, clicks, K };
}

// Agent URL в Arena — слаг без пробелов; id строки — его последний сегмент.
const slug = (name) => String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-');
const roleRow = (name, extra = {}) => ({
  id: `${slug(name)}-0000`, name, url: `https://arena.ai/agent/${slug(name)}-0000`, fn: 'Executor',
  status: 'Активна', account: '', available: '', pageId: `page-${name}`, ...extra,
});

// ── 1. Чтение подписи аккаунта ─────────────────────────────────────────────
{
  const label = { textContent: '  kreative36711@gmail.com \n' };
  const dom = { querySelectorAll: (sel) => (sel === 'div.font-heading.text-interactive-active' ? [label] : []) };
  const { api } = makeAccounts({ dom: { document: dom, location: { pathname: '/agent/x' }, blocked: () => false } });
  assert.equal(api.accountEmailFromDom(dom), 'kreative36711@gmail.com',
    'почта читается из подписи сайдбара');

  // Имя аккаунта рядом с почтой не должно стать «почтой».
  const both = { querySelectorAll: () => [{ textContent: 'Kreative' }, label] };
  assert.equal(api.accountEmailFromDom(both), 'kreative36711@gmail.com',
    'берётся только текст, целиком похожий на адрес');

  // Классы сменились — запасной селектор по обоим признакам.
  const spared = { querySelectorAll: (sel) => (sel.includes('font-heading') && !sel.startsWith('div.') ? [label] : []) };
  assert.equal(api.accountEmailFromDom(spared), 'kreative36711@gmail.com',
    'запасной селектор не зависит от точного набора классов');
}

// Свёрнутый сайдбар: сначала жмём «Expand sidebar», потом читаем.
{
  const node = { textContent: 'other@example.com' };
  let expanded = false;
  const button = { click: () => { expanded = true; } };
  const document = {
    querySelectorAll: (sel) => (expanded && sel === 'div.font-heading.text-interactive-active' ? [node] : []),
    querySelector: (sel) => (sel === 'button[aria-label="Expand sidebar"]' ? button : null),
  };
  const { api, logs } = makeAccounts({ dom: { document, location: { pathname: '/agent/a' }, blocked: () => false } });
  const read = await api.readAccountEmail();
  assert.equal(read.email, 'other@example.com', 'после разворота подпись прочитана');
  assert.equal(read.why, 'expanded', 'исход назван: развернули сайдбар');
  assert.deepEqual(logs, [], 'разворот не шумит в журнале');

  // Сайдбар в режиме иконок: почты в разметке нет вовсе — это «неизвестно».
  const iconDoc = {
    querySelectorAll: () => [],
    querySelector: (sel) => (sel === '[data-collapsible="icon"]' ? {} : null),
  };
  const icon = makeAccounts({ dom: { document: iconDoc, location: { pathname: '/agent/b' }, blocked: () => false } });
  const iconRead = await icon.api.readAccountEmail();
  assert.equal(iconRead.email, '', 'в режиме иконок адреса нет');
  assert.equal(iconRead.why, 'icon-collapsed', '«неизвестно» отличается от «чужой аккаунт»');
}

// ── 2. Полночь по Москве, а не по поясу браузера ───────────────────────────
{
  const { api } = makeAccounts();
  // 23.11 22:00 МСК = 19:00 UTC → сброс 24.11 00:00 МСК = 23.11 21:00 UTC.
  assert.equal(api.moscowMidnight(Date.UTC(2026, 10, 23, 19, 0)), Date.UTC(2026, 10, 23, 21, 0),
    'после 21:00 UTC сброс — ближайшая московская полночь');
  // 23.11 05:00 МСК = 02:00 UTC → та же полночь 24.11.
  assert.equal(api.moscowMidnight(Date.UTC(2026, 10, 23, 2, 0)), Date.UTC(2026, 10, 23, 21, 0),
    'до полуночи МСК окно то же');
  // 24.11 00:30 МСК = 23.11 21:30 UTC → уже следующая полночь (25.11).
  assert.equal(api.moscowMidnight(Date.UTC(2026, 10, 23, 21, 30)), Date.UTC(2026, 10, 24, 21, 0),
    'после сброса отсчёт начинается заново');
  assert.equal(api.accountResetText(Date.UTC(2026, 10, 23, 21, 0)), '00:00 МСК 24.11',
    'время сброса называется словами и в МСК');
}

// ── 3. Лимит аккаунта: разметка, отметка, снятие ───────────────────────────
{
  const rows = [
    roleRow('Godot World Engineer', { account: 'account-2' }),
    roleRow('AI & Simulation Engineer', { account: 'account-2', available: 'ОК' }),
    roleRow('Coordinator', { account: 'account-1', fn: 'Coordinator' }),
  ];
  const { api, patches, store, K } = makeAccounts({
    initial: { 'cfn-roles-cache': { at: Date.now(), rows } },
  });
  await api.markAccountLimit('account-2', rows[0]);
  const touched = patches.map((p) => p.pageId).sort();
  assert.deepEqual(touched, ['page-AI & Simulation Engineer', 'page-Godot World Engineer'],
    'отмечены все роли аккаунта, включая уже помеченные «ОК»');
  assert.ok(patches.every((p) => 'Доступность' in p.properties),
    'пишется «Доступность», а не «Статус» (Статус — поле Мастера)');
  assert.ok(patches.every((p) => !('Статус' in p.properties)),
    '«Статус» не тронут: возврат не затрёт решение Мастера');
  assert.equal(patches[0].properties['Доступность'].select.name, 'Лимит');
  const limits = store.get(K.accountLimits);
  assert.equal(limits['account-2'].rows.length, 2, 'чьи строки отметил транспорт — записано');
  assert.ok(api.accountLimitBlocks({ account: 'account-2' }), 'роль этого аккаунта не выдаётся');
  assert.ok(!api.accountLimitBlocks({ account: 'account-1' }), 'административный аккаунт не задет');
  assert.match(api.accountLimitText('account-2'), /лимит до 00:00 МСК/,
    'в тексте есть время сброса');

  // Роль, помеченную человеком, транспорт не перезаписывает.
  patches.length = 0;
  store.set(K.accountLimits, {});
  store.set('cfn-roles-cache', { at: Date.now(), rows: [
    roleRow('Manual', { account: 'account-3', available: 'Лимит', pageId: 'page-manual' }),
  ] });
  await api.markAccountLimit('account-3', null);
  assert.deepEqual(patches, [], 'чужую отметку «Лимит» не перезаписываем');

  // Снятие: возвращается только то, что ставил транспорт. В кеше «Ролей»
  // строки всё ещё «ОК» — настоящий код перечитывает их перед снятием (иначе
  // снятие пропустило бы свои же строки).
  patches.length = 0;
  const liveRows = [
    roleRow('A', { account: 'account-2', available: 'Лимит', pageId: 'page-a' }),
    roleRow('B', { account: 'account-2', available: 'Лимит', pageId: 'page-b' }),
  ];
  store.set(K.accountLimits, { 'account-2': { label: 'account-2', until: Date.now() - 1000,
    rows: ['page-a', 'page-b'], touched: [{ pageId: 'page-a', before: 'ОК' }, { pageId: 'page-b', before: 'ОК' }] } });
  globalThis.__relayRoleRows = async () => liveRows;
  const restored = await api.clearAccountLimit('account-2', { reason: 'окно прошло' });
  assert.equal(restored, 2, 'снятие вернуло «Доступность» нашим ролям');
  assert.ok(patches.every((p) => !('Статус' in p.properties)), 'снятие тоже не трогает «Статус»');
  assert.ok(!api.accountLimit('account-2'), 'отметка лимита удалена');
  delete globalThis.__relayRoleRows;
}

// ── 3б. Смена почты в Notion посреди окна лимита ──────────────────────────
{
  // D-005: адрес меняется в Notion — в браузере править нечего, а отметка
  // лимита не должна стать сиротой под старым ключом.
  const oldEntry = {
    label: 'old@example.com', until: Date.now() + 3600_000,
    rows: ['page-a'], touched: [{ pageId: 'page-a', before: 'ОК' }],
  };
  const rows = [
    roleRow('A', { account: 'new@example.com', available: 'Лимит', pageId: 'page-a' }),
    roleRow('B', { account: 'new@example.com', available: 'ОК', pageId: 'page-b' }),
  ];
  const { api, patches, store, K } = makeAccounts({
    initial: {
      'cfn-roles-cache': { at: Date.now(), rows },
      'cfn-account-limits': { 'old@example.com': oldEntry },
    },
  });
  await api.markAccountLimit('new@example.com', rows[0]);
  assert.deepEqual(patches.map((p) => p.pageId), ['page-b'],
    'строка под прежней отметкой «Лимит» не перезаписывается');
  const limits = store.get(K.accountLimits);
  assert.ok(limits['new@example.com'].touched.some((t) => t.pageId === 'page-a'),
    'прежняя отметка забрана в новый ключ — снимать будет нечего');
  assert.ok(!limits['old@example.com'].touched.some((t) => t.pageId === 'page-a'),
    'старая запись отметку отдала');

  // Снятие ищет строки по pageId, а не по прежнему адресу роли.
  patches.length = 0;
  globalThis.__relayRoleRows = async () => rows.map((r) => ({ ...r, available: 'Лимит' }));
  const restored = await api.clearAccountLimit('new@example.com', { reason: 'окно прошло' });
  assert.equal(restored, 2, 'обе строки вернулись, хотя адрес менялся');
  assert.ok(!api.accountLimit('new@example.com'), 'отметка снята');
  delete globalThis.__relayRoleRows;
}

// ── 4. Классификация пауз и удержание цикла ────────────────────────────────
{
  const { HEAL_PAUSE_CLASS, HEAL_MASTER_ONLY, HEAL_HOLDING, classifyPause, healHoldsCycle } = healApi;
  assert.equal(HEAL_PAUSE_CLASS['account-limit-admin'], 'master',
    'лимит административного аккаунта — класс master');
  assert.equal(HEAL_MASTER_ONLY['account-limit-admin'], 'money',
    'адресат — пункт money: квота аккаунта');
  // Расхождение аккаунтов паузой не ставится: контейнер меняет человек, а
  // `pause` общая на все вкладки — остановка одной погасила бы остальные три.
  assert.equal(HEAL_PAUSE_CLASS['account-wrong'], undefined, 'расхождение аккаунтов — не общая пауза');
  assert.equal(HEAL_MASTER_ONLY['account-wrong'], undefined, 'и не попадает в адресаты пауз');
  assert.ok(HEAL_HOLDING.includes('account-limit-admin'), 'административный лимит держит цикл');
  assert.ok(!HEAL_HOLDING.includes('account-limit'), 'лимит рабочего аккаунта не пауза');
  assert.equal(healHoldsCycle('account-limit-admin', 'Лимит аккаунта account-1'), true,
    'спрашивать некого — стоим');
  const verdict = classifyPause('account-limit-admin', 'Лимит аккаунта account-1');
  assert.equal(verdict.with, 'master', 'адресат разбора — Мастер');
}

// ── 5. Тик: рабочий аккаунт не останавливает цикл, админский останавливает ─
{
  const rows = [
    roleRow('AI & Simulation Engineer', { account: 'account-2' }),
    roleRow('Coordinator', { account: 'account-1', fn: 'Coordinator' }),
  ];
  const worker = makeAccounts({
    initial: { 'cfn-roles-cache': { at: Date.now(), rows } },
    dom: { document: { querySelectorAll: () => [] }, location: { pathname: `/agent/${slug('AI & Simulation Engineer')}-0000` }, blocked: () => true },
  });
  const held = await worker.api.accountsTick();
  assert.equal(held, 'worker', 'рабочий аккаунт не останавливает тик: ход должен уйти другому аккаунту');
  assert.notEqual(held, true, 'прежний `true` молча заканчивал страницу до полуночи — этого быть не должно');
  assert.equal(worker.pauses.filter((p) => p.kind === 'daily-limit').length, 0,
    'прежней паузы daily-limit нет: лимит принадлежит аккаунту, а не вкладке');
  assert.ok(worker.api.accountLimitBlocks({ account: 'account-2' }), 'аккаунт отмечен лимитом');

  const admin = makeAccounts({
    initial: { 'cfn-roles-cache': { at: Date.now(), rows } },
    dom: { document: { querySelectorAll: () => [] }, location: { pathname: `/agent/${slug('Coordinator')}-0000` }, blocked: () => true },
  });
  const stopped = await admin.api.accountsTick();
  assert.equal(stopped, 'admin', 'административный аккаунт останавливает тик');
  const adminPause = admin.pauses.find((p) => p.kind === 'account-limit-admin');
  assert.ok(adminPause, 'пауза account-limit-admin поставлена');
  assert.match(adminPause.reason, /Coordinato?r|Coordinator/, 'в паузе названы административные роли');
  assert.match(adminPause.reason, /00:00 МСК/, 'и время сброса');
}

// ── 6. Сверка вкладки с ожидаемым аккаунтом ───────────────────────────────
{
  // D-005: почта роли — прямо в Notion (поле «Аккаунт»), локальной связки нет.
  const role = roleRow('Godot World Engineer', { account: 'right@example.com' });
  const base = { 'cfn-roles-cache': { at: Date.now(), rows: [role] } };
  const wrong = makeAccounts({
    initial: base,
    dom: {
      document: { querySelectorAll: () => [{ textContent: 'someone@example.com' }], querySelector: () => null },
      location: { pathname: '/agent/whatever-0000' }, blocked: () => false,
    },
  });
  const bad = await wrong.api.accountVerdict(role);
  assert.equal(bad.ok, false, 'чужой аккаунт не пропускается');
  assert.equal(bad.kind, 'wrong-account', 'повод назван: wrong-account');

  const right = makeAccounts({
    initial: base,
    dom: {
      document: { querySelectorAll: () => [{ textContent: 'Right@Example.com' }], querySelector: () => null },
      location: { pathname: '/agent/whatever-0000' }, blocked: () => false,
    },
  });
  assert.equal((await right.api.accountVerdict(role)).ok, true, 'регистр адреса не важен');

  // Подпись не прочитана — не повод стоять: предупреждение, а не пауза.
  const blind = makeAccounts({
    initial: base,
    dom: {
      document: { querySelectorAll: () => [], querySelector: () => null },
      location: { pathname: '/agent/whatever-0000' }, blocked: () => false,
    },
  });
  const blindVerdict = await blind.api.accountVerdict(role);
  assert.equal(blindVerdict.ok, true, 'неизвестность не блокирует работу');
  assert.match(blindVerdict.warn || '', /не прочитан|не сверяется/, 'но говорит об этом');

  // В поле «Аккаунт» не адрес — сверять нечего, роль работает как раньше.
  const legacyRole = roleRow('Legacy', { account: 'account-2' });
  const noMail = makeAccounts({ initial: { 'cfn-roles-cache': { at: Date.now(), rows: [legacyRole] } } });
  const noMailVerdict = await noMail.api.accountVerdict(legacyRole);
  assert.equal(noMailVerdict.ok, true, 'нечто иное, чем адрес, не блокирует работу');
  assert.match(noMailVerdict.warn || '', /нет адреса почты/, 'и причина названа');
}

// ── 7. Незакрытый ход не снимается уборкой ────────────────────────────────
{
  const role = roleRow('Godot World Engineer', { account: 'account-2' });
  const { api, store, K } = makeAccounts({
    initial: { 'cfn-roles-cache': { at: Date.now(), rows: [role] } },
  });
  store.set(K.accountLimits, { 'account-2': { label: 'account-2', until: Date.now() + 3600_000, rows: [], touched: [] } });
  assert.equal(api.accountHoldsExpect({ roleId: role.id, kind: 'dispatch', sentAt: 1 }), true,
    'ожидание на лимитированном аккаунте сохраняется');
  assert.equal(api.accountHoldsExpect({ roleId: 'other', sentAt: 1 }), false, 'чужое ожидание не трогаем');
  const sweep = src('23-coordinator.js');
  assert.match(sweep, /accountHoldsExpect/, 'уборка фантомов спрашивает про лимит');
}

// ── 8. Раскладка ролей по аккаунтам ───────────────────────────────────────
{
  const { api } = makeAccounts();
  const split = api.accountLayoutProblems([
    roleRow('Coordinator', { account: 'account-1', fn: 'Coordinator' }),
    roleRow('Warden', { account: 'account-3', fn: 'Reviewer' }),
  ]);
  assert.ok(split.some((p) => p.code === 'admin-split'), 'административные роли на разных аккаунтах названы');

  const mixed = api.accountLayoutProblems([
    roleRow('Coordinator', { account: 'account-1', fn: 'Coordinator' }),
    roleRow('Godot World Engineer', { account: 'account-1' }),
  ]);
  assert.ok(mixed.some((p) => p.code === 'admin-extra'), 'исполнитель на админском аккаунте назван');

  const unassigned = api.accountLayoutProblems([roleRow('Executor X')]);
  assert.ok(unassigned.some((p) => p.code === 'unassigned'), 'роль без метки названа');

  const clean = api.accountLayoutProblems([
    roleRow('Coordinator', { account: 'account-1', fn: 'Coordinator' }),
    roleRow('Warden', { account: 'account-1', fn: 'Reviewer' }),
    roleRow('Transport Maintainer', { account: 'account-1', fn: 'Maintainer' }),
    roleRow('Executor X', { account: 'account-2' }),
  ]);
  assert.deepEqual(clean, [], 'правильная раскладка замечаний не даёт');
}

// ── 9. Промпт Координатора и «работать нечем» ─────────────────────────────
{
  const ready = [
    { id: 'c1', properties: { 'Кому': { select: { name: 'Godot World Engineer' } } } },
  ];
  const role = roleRow('Godot World Engineer', { account: 'account-2' });
  const { api, store, K } = makeAccounts({ initial: { 'cfn-roles-cache': { at: Date.now(), rows: [role] } } });
  store.set(K.accountLimits, { 'account-2': { label: 'account-2', until: Date.now() + 3600_000, rows: [], touched: [] } });

  const note = api.accountPlanNote();
  assert.match(note, /account-2/, 'недоступный аккаунт назван в плане');
  assert.match(note, /лимит до/, 'со временем сброса');
  assert.match(note, /не выдаются/, 'и что с этим делать');

  const idle = api.accountIdleNote(ready, { missionId: 'm-1' });
  assert.match(idle, /Работать нечем/, 'когда вся работа на лимитированных аккаунтах — это сказано прямо');
  assert.match(idle, /blocked/, 'Координатору дан второй ход: пауза миссии');
  // «Один раз на окно» считается при отправке, а не при сборке текста: план мог
  // не уйти (капча, пауза), и вопрос потерялся бы вместе с ним.
  assert.match(api.accountIdleNote(ready, { missionId: 'm-1' }), /Работать нечем/,
    'пока план не ушёл, вопрос остаётся в тексте — его отправит следующая попытка');
  api.accountIdleAskedMark('m-1');
  const second = api.accountIdleNote(ready, { missionId: 'm-1' });
  assert.equal(second, '', 'после отправки второй раз на то же окно не спрашиваем: это квота Координатора');
  assert.match(api.accountIdleNote(ready, { missionId: 'm-2' }), /Работать нечем/,
    'другая миссия — другое окно');

  // Есть работа на доступном аккаунте — вопрос не нужен вовсе.
  const mixed = [
    ready[0],
    { id: 'c2', properties: { 'Кому': { select: { name: 'Coordinator' } } } },
  ];
  assert.equal(api.accountIdleNote(mixed, { missionId: 'm-2' }), '',
    'если есть карточка на доступном аккаунте, «нечем работать» — неправда');
}

// ── 10. Точки встраивания: общий путь для «Шага» и автоцикла ──────────────
{
  const cycle = src('28-cycle.js');
  assert.match(cycle, /await accountsTick\(\)/, 'тик проверяет аккаунты до любых решений');
  assert.match(cycle, /accountStop !== "worker"/, 'рабочий аккаунт не заканчивает тик паузой');
  assert.match(cycle, /await accountVerdict\(me\)/, 'роль страницы сверяется со своим аккаунтом');
  // «Шаг» и автоцикл идут через один tick: отдельной ветки в кнопке нет.
  assert.doesNotMatch(cycle, /accountVerdict\([^)]*\)[\s\S]{0,200}fromToggle === false/,
    'паритет не зависит от способа запуска');
  const nav = cycle.slice(cycle.indexOf('  async function navigateTo('), cycle.indexOf('  function idleWrongAccount('));
  assert.match(nav, /accountBlocked\(roleAccount\(role\)\)/, 'переход не ведёт на лимитированный аккаунт');
  // Вкладка живёт в контейнере, а location.assign контейнер не меняет: переход
  // на роль чужого аккаунта открыл бы её страницу чужим аккаунтом.
  assert.match(nav, /accountMismatchSync\(role\)/, 'переход сверяет аккаунт цели с контейнером вкладки');
  assert.doesNotMatch(cycle, /huntAnotherAccount/, 'из вкладки нельзя «уйти на другой аккаунт»');
  assert.match(cycle, /function idleLimitedAccount/, 'лимит рабочего аккаунта — тихий отдых вкладки, без общей паузы');
  assert.match(cycle, /function idleWrongAccount/, 'чужой контейнер — тоже отдых, а не пауза на все вкладки');
  const idle = cycle.slice(cycle.indexOf('  function idleWrongAccount('), cycle.indexOf('  function idleLimitedAccount('));
  assert.doesNotMatch(idle, /\bpause\(/, '«эта роль не здесь» не останавливает другие аккаунты');

  const send = src('17-arena-polls.js');
  assert.match(send, /accountLimitBlocks\(role\)/, 'очередь не ставит задание роли в лимите');
  assert.match(send, /async function consumePending/, 'висящая очередь тоже не вставляется в заблокированное поле');
  const pendingFn = send.slice(send.indexOf('  async function consumePending('));
  assert.match(pendingFn.slice(0, 2000), /accountLimitBlocks/, 'очередь ждёт сброса окна, а не съедает попытку');

  const prompt = src('25-legacy-adr.js');
  assert.match(prompt, /accountPlanNote\(\)/, 'план Координатора несёт недоступные аккаунты');
  assert.match(prompt, /accountIdleNote\(queue\.ready/, 'и вопрос «нечем работать» — один раз на окно');
  assert.match(prompt, /accountLimitBlocks\(\{ account: row\.account \}\)/, 'дефект роли называет лимит аккаунта');

  const schema = src('08-projects-ui.js');
  // Поля аддитивны, как Repository: база без них работает по-старому, но если
  // поле есть, оно обязано быть select — иначе метку не прочитать.
  assert.match(schema, /for \(const name of \["Аккаунт", "Доступность"\]\)/, 'схема «Ролей» знает новые поля');
  assert.match(schema, /нужен select/, 'и требует от них select, а не любой тип');

  const ui = src('07-connections-ui.js');
  // D-005: почта в транспорт не вводится — ввода адреса в ⚙ нет вовсе,
  // окно лишь говорит, что адреса читаются из Notion.
  assert.doesNotMatch(ui, /id="cfn-connection-accounts"/, 'поле ввода почты убрано');
  assert.doesNotMatch(ui, /parseAccountMap\(/, 'разбора «метка = почта» больше нет');
  assert.doesNotMatch(accountsSrc, /accountMap\(/, 'локальной связки в модуле аккаунтов нет');
  assert.match(accountsSrc, /accountMail\(label\)/, 'ожидаемый адрес берётся из поля «Аккаунт» роли');
  assert.match(ui, /из поля «Аккаунт» базы «Роли»/, 'окно называет источник почты');
  // Метки владельца — его слова: значение с пробелом законно, потому что оно
  // уже стоит в Notion, и запрещать его значило бы требовать переименования базы.
  assert.doesNotMatch(ui, /одним словом без пробелов/, 'значение с пробелом не отвергается');
}

// ── 11. Оформление выпуска ────────────────────────────────────────────────
{
  const bundle = readFileSync(join(here, '..', 'relay.user.js'), 'utf8');
  assert.match(bundle, /^\/\/ @version\s+1\.18\.4\s*$/m, 'выпуск 1.18.4 объявлен');
}

console.log('OK: 1.18.4 (D-005) — почта аккаунта из Notion, ввода в ⚙ нет; квоты D-004 сохранены: лимит принадлежит аккаунту, админский останавливает цикл, «Статус» не трогается');
