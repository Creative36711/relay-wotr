// D-007 (1.18.3): задание чужого контейнера забирает своя вкладка, а не уносит чужая.
//
// Журнал Мастера 24.11:
//   21:19:20 Выдан ход UX & Modding Auditor
//   21:19:20 Задание «UX …»: бужу остальные вкладки — отправит та, чей это аккаунт.
//   21:19:20 Перехожу к «UX & Modding Auditor», чтобы отправить задание.
//   21:19:48 Не нашёл поле ввода … (contenteditable 0, textarea 1) путь /agent/…
//
// Вкладка Координатора сделала обе вещи сразу: разбудила нужную вкладку и тут
// же сама пошла по адресу роли в СВОЁМ контейнере. Страница открылась чужим
// аккаунтом, поля ввода нет, задание осталось «в очереди».
//
// Причина: у `sendToRole` был свой переход (`location.assign`), отдельный от
// `navigateTo`, которому проверка контейнера (D-004) досталась. Здесь
// проверяется, что второго, непроверенного пути больше нет.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, '..', 'src');
const src = (name) => readFileSync(join(srcDir, name), 'utf8');

const polls = src('17-arena-polls.js');
const accounts = src('44-accounts.js');
const cycle = src('28-cycle.js');

// ── 1. Проверка «эта страница правда моя» ─────────────────────────────────
{
  const checkSrc = accounts.slice(
    accounts.indexOf('async function accountPageCheck('),
    accounts.indexOf('// ───────────────────────────── роли и раскладка'),
  );
  assert.ok(checkSrc.length > 0, 'проверка страницы объявлена');
  // Кеш подписи растёт по пути: без карты «путь → аккаунт» подпись прошлой
  // страницы считалась бы подписью новой, и роль на чужом аккаунте выглядела
  // бы своей.
  assert.match(accounts, /const accountPageMap = new Map\(\)/, 'соответствие «путь → прочитанный аккаунт» хранится');
  assert.match(checkSrc, /accountPageMap\.get\(here\)/, 'кеш читается по пути страницы');
  assert.match(checkSrc, /accountMail\(fresh\.email\)/, 'сравниваются адреса, а не подписи');
  for (const verdict of ['mine', 'foreign', 'unknown', 'no-label']) {
    assert.match(checkSrc, new RegExp(`"${verdict}"`), `проверка различает «${verdict}»`);
  }
}

// ── 2. Толкающего перехода в чужой контейнер больше нет ───────────────────
{
  const sendSrc = polls.slice(polls.indexOf('async function sendToRole('));
  const sendBlock = sendSrc.slice(0, sendSrc.indexOf('async function goTo('));
  const assignAt = sendBlock.indexOf('location.assign(role.url)');
  const checkAt = sendBlock.indexOf('accountPageCheck(role)');
  assert.ok(assignAt > 0, 'переход на страницу адресата остаётся для своего контейнера');
  assert.ok(checkAt > 0, 'перед переходом спрашиваем, чья это страница');
  assert.ok(checkAt < assignAt, 'проверка идёт ДО перехода, а не после');
  assert.match(sendBlock, /page\.verdict === "foreign"/, 'доказанно чужой аккаунт — отдельная ветка');
  assert.match(sendBlock, /Не ухожу к «\$\{role\.name\}»/, 'в журнале сказано, почему не ухожу');
  // Задание при этом не снимается: его заберёт своя вкладка.
  const foreignBranch = sendBlock.slice(checkAt, assignAt);
  assert.doesNotMatch(foreignBranch, /GM_setValue\(K\.pending, null\)|GM_setValue\(K\.pending, \{ \.\.\./, 'чужой контейнер не трогает очередь');
  // Непрочитанная подпись не запрещает переход: иначе свёрнутый сайдбар
  // останавливал бы обычную работу.
  assert.match(foreignBranch, /verdict === "foreign"/, 'решает только доказанное расхождение');
  assert.doesNotMatch(foreignBranch, /verdict === "unknown"[\s\S]{0,200}return false/, 'неизвестная подпись работу не останавливает');
}

// ── 3. Страница, которая сама называет себя этой ролью, проверку проходит ──
{
  const sendSrc = polls.slice(polls.indexOf('async function sendToRole('));
  assert.match(sendSrc.slice(0, sendSrc.indexOf('async function goTo(')),
    /const hereMe = typeof roleFromPath === "function" \? roleFromPath\(\) : "";/,
    'страница-владелец определяется по адресу роли');
  assert.match(sendSrc.slice(0, sendSrc.indexOf('async function goTo(')),
    /norm\(hereMe\) !== norm\(role\.id\)/,
    'если страница и есть эта роль — третья сторона не при чём');
}

// ── 4. Второй рубеж: вставка не повторяется на чужом аккаунте ─────────────
{
  const consume = polls.slice(polls.indexOf('async function consumePending('), polls.indexOf('async function submitExecutor('));
  assert.match(consume, /pendingRoleRow\(pending\)/, 'поиск поля знает, чья страница должна быть');
  assert.match(consume, /if \(foreign\) \{/, 'чужой аккаунт обрабатывается отдельно');
  const foreignBlock = consume.slice(consume.indexOf('if (foreign) {'), consume.indexOf('if (!editor) {'));
  assert.match(foreignBlock, /pendingSay\(/, 'Мастеру сказано, что происходит');
  assert.match(foreignBlock, /остаётся в очереди/, 'задание не пропадает');
  assert.match(foreignBlock, /return true;/, 'и не повторяется каждые пять секунд: шаг завершается');
  assert.doesNotMatch(foreignBlock, /setTimeout\(\(\) => tick\(false\)/, 'бесконечного повтора нет');
  // Поле ввода ищется с проверкой аккаунта, а не вслепую двадцать секунд.
  assert.match(consume, /ensureComposer\(20000, \{ role: pendingRoleRow\(pending\) \}\)/,
    'ожидание поля знает, чья страница нужна');
}

// ── 5. Тик тоже понимает, что страница чужая ───────────────────────────────
{
  assert.match(cycle, /if \(verdict\.ok && typeof accountPageCheck === "function"\)/,
    'когда подпись сайдбара не прочитана, тик проверяет страницу сам');
  assert.match(cycle, /page\.verdict === "foreign"[\s\S]{0,300}idleWrongAccount\(/, 'чужой аккаунт уводит шаг в «не здесь»');
  // «Не здесь» будит остальные вкладки (D-006) — иначе работа ждала бы Мастера.
  const idle = cycle.slice(cycle.indexOf('function idleWrongAccount('), cycle.indexOf('function idleLimitedAccount('));
  assert.match(idle, /wakeOnce\(/, 'уход из-за чужого аккаунта будит нужную вкладку');
}

console.log('OK: D-007 (1.18.3) — задание уносит только своя вкладка: перед переходом спрашиваем, чья страница');
