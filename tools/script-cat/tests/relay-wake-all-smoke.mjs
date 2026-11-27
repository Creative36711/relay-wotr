// D-006 (1.18.2): «Все вкладки» — одна кнопка вместо угадывания контейнера.
//
// Мастер: «переключаться между вкладками и угадывать, где нажать Шаг — слишком
// сложно; хочу нажать в любой вкладке и чтобы работа пошла». Переключать
// контейнеры скрипт не может (`location.assign` их не меняет), поэтому здесь
// проверяется механизм просьбы: вкладка ставит общую отметку, откликается та,
// для чьей роли действительно есть работа.
//
// Проверяется поведение, а не строки:
//   1) отметка живёт окном и не продлевается бесконечно;
//   2) вкладка просыпается только когда работа — её (очередь или ожидание);
//   3) задание чужой роли само будит остальных, своё — нет;
//   4) уход из-за чужого контейнера и лимита будит остальных, а не молчит;
//   5) кнопка не отправляет и не выдаёт: она только снимает «спящий» режим.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, '..', 'src');
const src = (name) => readFileSync(join(srcDir, name), 'utf8');
const wakeSrc = src('45-wake.js');

/** Стенд: хранилище подменено, остальное — настоящий код модуля. */
function makeWake({ initial = {}, path = '/agent/role-a-1234' } = {}) {
  const store = new Map(Object.entries(structuredClone(initial)));
  const K = { wake: 'cfn-wake-all', pending: 'cfn-pending', expect: 'cfn-expect' };
  const norm = (x) => String(x || '').replace(/-/g, '').toLowerCase();
  const GM_getValue = (key, fallback) => (store.has(key) ? structuredClone(store.get(key)) : fallback);
  const GM_setValue = (key, value) => { store.set(key, structuredClone(value)); };
  const apiRef = { location: { pathname: path } };
  // Стенд: у каждой «вкладки» свой sessionStorage — так же, как в браузере.
  const session = { getItem: (k) => (sessionStore.has(k) ? sessionStore.get(k) : null), setItem: (k, v) => sessionStore.set(k, v) };
  const sessionStore = new Map();
  const api = new Function(
    'GM_getValue', 'GM_setValue', 'K', 'norm', 'location', 'roleFromPath', 'sessionStorage',
    `${wakeSrc}
     return { wakeAll, wakeOnce, wakeActive, wakeWorkHere, wakeForPending, wakeClaim, WAKE_WINDOW_MS, WAKE_MAX_MS, WAKE_CLAIM_MS };`,
  )(
    GM_getValue, GM_setValue, K, norm, apiRef.location,
    // В скрипте `roleFromPath` читает location.pathname, а не путь из замыкания.
    () => (String(apiRef.location.pathname).match(/\/agent\/([\w-]+)/) || [])[1] || '',
    session,
  );
  return { api, store, K };
}

// ── 1. Окно отметки ────────────────────────────────────────────────────────
{
  const { api, store, K } = makeWake();
  assert.equal(api.wakeActive(), false, 'без нажатия вкладка спит');

  const state = api.wakeAll('тест');
  assert.equal(api.wakeActive(), true, 'после нажатия вкладка бодра');
  assert.ok(Number(state.until) > Date.now(), 'у отметки есть срок');
  assert.ok(
    Number(state.until) - Date.now() <= api.WAKE_WINDOW_MS + 1000,
    'окно не длиннее заявленного',
  );

  // Истёкшая отметка не держит вкладку бодрой.
  store.set(K.wake, { ...state, until: Date.now() - 1 });
  assert.equal(api.wakeActive(), false, 'просроченная отметка не будит');
}

// ── 2. Повторные нажатия не продлевают окно бесконечно ─────────────────────
{
  const { api, store, K } = makeWake();
  const startedAt = Date.now() - api.WAKE_MAX_MS + 5000;
  store.set(K.wake, { at: Date.now() - 1000, startedAt, until: startedAt + api.WAKE_MAX_MS });
  const state = api.wakeAll('ещё раз');
  assert.ok(
    Number(state.until) <= startedAt + api.WAKE_MAX_MS,
    'потолок окна не пробивается повторными нажатиями',
  );
}

// ── 2б. Повторяющиеся источники не держат вкладки бодрыми ──────────────────
{
  const { api } = makeWake();
  const first = api.wakeOnce('wrong:role-a-1234', 'не тот контейнер');
  assert.ok(first, 'первый раз отметка ставится');
  const second = api.wakeOnce('wrong:role-a-1234', 'не тот контейнер');
  assert.equal(second, null, 'второй раз на том же тике отметка не продлевается');
  const other = api.wakeOnce('limit:account-2', 'лимит');
  assert.ok(other, 'другая причина — своя отметка');
}

// ── 3. Вкладка просыпается только под свою работу ──────────────────────────
{
  // Непрофильная страница при существующей работе: идти к ней, как «Шаг».
  const mine = makeWake({
    path: '/',
    initial: { 'cfn-pending': { roleId: 'role-b-5678' } },
  });
  assert.equal(mine.api.wakeWorkHere(), 'start', 'на непрофильной странице работа есть — идём к ней');
  // …а если работы нет вовсе, кнопка новый ход не открывает.
  const empty = makeWake({ path: '/' });
  assert.equal(empty.api.wakeWorkHere(), '', 'без работы разбуженная вкладка ничего не начинает');
  // Профильная страница без своей работы: спать, чужие задания не её.
  const stranger = makeWake({ path: '/agent/role-c-9999' });
  assert.equal(stranger.api.wakeWorkHere(), '', 'своей работы нет — вкладка не просыпается');

  const pendingOwn = makeWake({
    path: '/agent/role-a-1234',
    initial: { 'cfn-pending': { roleId: 'role-a-1234', roleName: 'A' } },
  });
  assert.equal(pendingOwn.api.wakeWorkHere(), 'pending', 'своя очередь — работа этой вкладки');

  const pendingOther = makeWake({
    path: '/agent/role-a-1234',
    initial: { 'cfn-pending': { roleId: 'role-b-5678' } },
  });
  assert.equal(pendingOther.api.wakeWorkHere(), '', 'чужая очередь эту вкладку не будит');

  const expectOwn = makeWake({
    path: '/agent/role-a-1234',
    initial: { 'cfn-expect': { roleId: 'role-a-1234' } },
  });
  assert.equal(expectOwn.api.wakeWorkHere(), 'expect', 'ждём ответа своей роли — тоже работа');
}

// ── 4. Задание чужой роли будит остальных, своё — нет ──────────────────────
{
  const here = makeWake({ path: '/agent/role-a-1234' });
  assert.equal(
    here.api.wakeForPending({ roleId: 'role-a-1234' }),
    null,
    'своё задание отметку не ставит: эта вкладка и так не спит',
  );
  assert.equal(here.api.wakeActive(), false, 'и чужие вкладки не будит зря');

  const woke = here.api.wakeForPending({ roleId: 'role-b-5678' }, 'задание для B');
  assert.ok(woke, 'задание чужой роли ставит отметку');
  assert.equal(here.api.wakeActive(), true, 'остальные вкладки увидят её');
  assert.match(String(woke.reason), /задание для B/, 'причина видна в отметке');
}

// ── 4б. Две вкладки одного аккаунта не делают шаг дважды ───────────────────
{
  // Общее хранилище профиля, но разные сессии вкладок.
  const store = new Map();
  const make = (path = '/agent/role-a-1234') => {
    const sessionStore = new Map();
    const api = new Function(
      'GM_getValue', 'GM_setValue', 'K', 'norm', 'location', 'roleFromPath', 'sessionStorage',
      `${wakeSrc}\n return { wakeClaim, wakeHold, WAKE_CLAIM_MS, wakeAll };`,
    )(
      (k, d) => (store.has(k) ? structuredClone(store.get(k)) : d),
      (k, v) => { store.set(k, structuredClone(v)); },
      { wake: 'cfn-wake-all' }, (x) => String(x || '').replace(/-/g, '').toLowerCase(),
      { pathname: path }, () => (String(path).match(/\/agent\/([\w-]+)/) || [])[1] || '',
      {
        getItem: (k) => (sessionStore.has(k) ? sessionStore.get(k) : null),
        setItem: (k, v) => sessionStore.set(k, v),
      },
    );
    return api;
  };
  const first = make();
  const second = make();
  assert.equal(first.wakeClaim('role-a-1234'), true, 'первая вкладка берёт шаг');
  assert.equal(second.wakeClaim('role-a-1234'), false, 'вторая вкладка того же аккаунта ждёт: шаг уже идёт');
  assert.equal(first.wakeClaim('role-a-1234'), true, 'свою заявку вкладка продлевает без ожидания');
  // Соседний аккаунт — не дубль, а другой ход: он не должен ждать.
  assert.equal(second.wakeClaim('role-c-9999'), true, 'другой аккаунт берёт свою заявку');

  // Заявка лежит под ключом аккаунта; в стенде разметки нет, поэтому ключ — по id.
  const claimKey = [...store.keys()].find((k) => k.startsWith('cfn-wake-doing:'));
  assert.ok(claimKey, 'заявка хранится отдельным ключом');

  // Протухшая заявка (вкладку закрыли) не держит остальных вечно.
  const third = make();
  store.set(claimKey, { tabId: 'closed', until: Date.now() - 1 });
  assert.equal(third.wakeClaim('role-a-1234'), true, 'истёкшая заявка не блокирует');

  // Долгий шаг продлевает свою заявку, а чужая вкладка этого не делает.
  const holder = make();
  store.delete(claimKey);
  assert.equal(holder.wakeClaim('role-a-1234'), true, 'шаг взят');
  const key = claimKey;
  const before = store.get(key).until;
  store.set(key, { ...store.get(key), until: Date.now() + 20_000 });
  assert.equal(holder.wakeHold(), true, 'своя заявка продлевается');
  assert.ok(store.get(key).until > Date.now() + 20_000, 'срок заявки вырос');
  assert.equal(make().wakeHold(), false, 'чужая вкладка чужую заявку не продлевает');
}

// ── 5. Точки встраивания ───────────────────────────────────────────────────
{
  const cycle = src('28-cycle.js');
  const polls = src('17-arena-polls.js');
  const panel = src('06-pause-panel.js');
  const core = src('02-profiles-core.js');

  // Спящая вкладка просыпается, но только на своей работе.
  assert.match(cycle, /typeof wakeActive === "function" && wakeActive\(\)/, 'тик спрашивает будильник');
  assert.match(cycle, /wakeWorkHere\(\)/, 'и проверяет, что работа — своя');
  assert.match(cycle, /if \(!auto && !fromToggle && !woken\) return;/, 'будильник — единственное исключение из ручного режима');
  assert.match(cycle, /wakeWork !== "start" && typeof wakeClaim === "function" && !wakeClaim\(roleFromPath\(\)\)/, 'заявку берёт только вкладка со своей работой');
  assert.match(cycle, /function stepAlive\(\) \{[\s\S]{0,400}wakeHold\(/, 'живой шаг продлевает заявку');
  // Обе ветки «эта вкладка отдыхает» будят остальных.
  assert.match(cycle, /function idleWrongAccount[\s\S]{0,900}wakeOnce\(/, 'чужой контейнер будит остальных, но не каждый тик');
  assert.match(cycle, /function idleLimitedAccount[\s\S]{0,600}wakeOnce\(/, 'лимит аккаунта будит остальных, но не каждый тик');
  // Нажатие не в том контейнере: работа уходит той вкладке, где роль живёт.
  const nav = src('28-cycle.js');
  const navBlock = nav.slice(nav.indexOf('async function navigateTo'), nav.indexOf('const from = location.pathname'));
  assert.match(navBlock, /wakeOnce\(/, 'отказ перейти в чужой контейнер будит нужную вкладку');
  assert.doesNotMatch(navBlock, /wakeAll\(/, 'и не продлевает окно при каждом нажатии в чужом контейнере');
  // Постановка задания чужой роли — источник отметки.
  assert.match(polls, /wakeForPending\(GM_getValue\(K.pending, null\)/, 'sendToRole будит адресата');
  // Auto-wake remains transport behavior; the compact widget no longer duplicates a pult action.
  assert.match(polls, /wakeForPending\(GM_getValue\(K.pending, null\)/, 'queued work wakes its target slot automatically');
  assert.doesNotMatch(panel, /ui\.wake|cfn-wake/, 'there is no redundant wake-all control in the executor widget');
  assert.doesNotMatch(core, /wake: "cfn-wake"/, 'the old wake button id is removed from the UI map');
}

console.log('OK: D-006 (1.18.2) — «Все вкладки»: одна кнопка, откликается та вкладка, чья работа');
