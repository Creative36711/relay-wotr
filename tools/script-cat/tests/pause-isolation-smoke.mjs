// Пауза принадлежит вкладке, а не всем контейнерам (1.35.7).
//
// 28.11 в 00:44:32 капча появилась в админском контейнере и поставила паузу.
// `cfn-paused` — ключ хранилища ScriptCat, общий для всех вкладок профиля:
// через секунду в отчёте службы стояли четыре `localPaused: true` с одной и
// той же причиной (admin, worker-1, worker-2, worker-3), а пульт не мог
// запустить ни одного хода. Человек не мог сделать вообще ничего: «Шаг»
// заблокирован, ход некому взять.
//
// Здесь проверяется само правило, а не текст: две вкладки на одном общем
// хранилище — пауза одной не видна другой, снятие у соседа не размораживает
// чужую, а общий ключ остаётся пустым (иначе он снова заморозит всех).
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '..', 'src', '06-pause-panel.js'), 'utf8');

/** Вырезать функцию по имени: стенду не нужен весь скрипт со страницей. */
function grab(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start > 0, `в 06-pause-panel.js нет функции ${name}`);
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`функция ${name} не закрылась`);
}

const tabKeyLine = source
  .split('\n')
  .find((line) => line.includes('const PAUSE_TAB_KEY'))
  ?.trim();
assert.ok(tabKeyLine, 'ключ паузы вкладки объявлен');

const body = [
  grab('tabBornAt'),
  grab('tabPauseReason'),
  grab('tabPauseSet'),
  grab('tabPauseContext'),
  grab('tabPauseContextSet'),
].join('\n');

/** Хранилище ScriptCat — общее; sessionStorage — своё у каждой вкладки. */
function makeTab(shared) {
  const session = new Map();
  const sessionStorage = {
    getItem: (key) => (session.has(key) ? session.get(key) : null),
    setItem: (key, value) => session.set(key, String(value)),
    removeItem: (key) => session.delete(key),
  };
  const GM_getValue = (key, fallback) => (shared.has(key) ? shared.get(key) : fallback);
  const GM_setValue = (key, value) => shared.set(key, value);
  const K = { paused: 'cfn-paused' };
  // eslint-disable-next-line no-new-func
  const factory = new Function(
    'sessionStorage', 'GM_getValue', 'GM_setValue', 'K',
    `${tabKeyLine}\nconst PAUSE_CTX_TAB_KEY = "cfn-pause-context-tab-v1";\nconst TAB_BORN_KEY = "cfn-tab-born-v1";\n${body}\nreturn { tabPauseReason, tabPauseSet, isPaused: () => Boolean(tabPauseReason()) };`,
  );
  const api = factory(sessionStorage, GM_getValue, GM_setValue, K);
  return { ...api, session };
}

const shared = new Map();
const admin = makeTab(shared);
const worker = makeTab(shared);

// 1. Капча в админском контейнере.
admin.tabPauseSet('Появилась капча (Security Verification)');
assert.equal(admin.isPaused(), true, 'вкладка с капчей стоит на паузе');
assert.equal(worker.isPaused(), false, 'соседний контейнер обязан продолжать работу');

// 2. «Продолжить» в рабочей вкладке не размораживает чужую.
worker.tabPauseSet('');
assert.equal(admin.isPaused(), true, 'чужая пауза не снимается соседней вкладкой');

// 3. Человек решил капчу — снимается только своя.
admin.tabPauseSet('');
assert.equal(admin.isPaused(), false, 'своя пауза снимается');

// 4. Общий ключ — история, а не действующая пауза: запись в него не морозит
//    соседнюю вкладку (она уже читала своё вкладочное значение).
shared.set('cfn-paused', { reason: 'причина из админской вкладки', at: Date.now() });
assert.equal(worker.isPaused(), false, 'общий ключ не морозит соседнюю вкладку');

// 5. Пауза, поставленная ДО открытия вкладки, — наследие прошлой сессии: её
//    причина не теряется, и вкладка честно стоит на паузе.
const legacy = new Map([['cfn-paused', 'старая пауза прошлой сессии']]);
const inherited = makeTab(legacy);
assert.equal(inherited.isPaused(), true, 'остатки прошлой сессии не теряются');

// 6. Пауза, поставленная ПОСЛЕ открытия вкладки (капча у соседа), не
//    наследуется: иначе одно окно проверки снова морозит все контейнеры.
const sharedLate = new Map();
const neighbour = makeTab(sharedLate);
sharedLate.set('cfn-paused', { reason: 'капча у админа', at: Date.now() });
assert.equal(neighbour.isPaused(), false, 'чужая свежая пауза не наследуется');

console.log('пауза у каждой вкладки своя: ок');
