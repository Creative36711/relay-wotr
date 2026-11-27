// Проба доставки по паре (роль, слот) — 1.24.1.
//
// Случай, ради которого проба и написана. Владелец удаляет всех исполнителей
// в Arena и ждёт, что транспорт создаст их сам. После создания первая же
// рабочая роль оказывается ровно в том положении, которое прежний код не
// умел: страница агента есть, а `Agent URL` в строке «Ролей» пуст, потому что
// D-015 убрал его у неадминских ролей. До этой правки доставка искала адрес в
// строке — и не находила, а страница не могла опознать себя как роль.
//
// Здесь проверяется одна мысль: адрес доставки — свойство пары, и его
// отсутствие в строке не мешает ни отправке, ни самоопознанию, ни адресату
// обратной связи.

import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const src = readFileSync(new URL('../relay.user.js', import.meta.url), 'utf8');

const block = (from, to) => {
  const at = src.indexOf(from);
  assert.ok(at > 0, `блок «${from}» на месте`);
  const end = src.indexOf(to, at + from.length);
  assert.ok(end > at, `конец блока «${to}» на месте`);
  return src.slice(at, end);
};

// ── 1. Общая точка: строка, затем пара ─────────────────────────────────────
// Разбито нарочно. relayBase и снимок — настоящие (сеть подменена стабом
// `request`), а relayCurrentSlot (почта вкладки) и дальше — стабы, потому что
// аккаунта в Node нет: подставляем слот параметром.
const relayBaseBlock = block('const RELAY_DEFAULT_BASE', 'let relaySnapshotCache');
const snapshotBlock = block('let relaySnapshotCache', 'async function relayCurrentSlot(');
const instancesBlock = block('function relayInstances(shot)', 'async function roleDeliveryUrl(') +
  (() => {
    const at = src.indexOf('async function roleDeliveryUrl(');
    const end = src.indexOf('\n  /**', at);
    return src.slice(at, end);
  })();
// Порядок в исходнике: instanceFor → roleInstanceUrl → roleDeliveryUrl.
// Вырезаем одним куском, чтобы зависимости были видны телу функций.
const roleRowsBlock = (() => {
  const at = src.indexOf('async function instanceFor(');
  assert.ok(at > 0, 'блок instanceFor на месте');
  const deliveryAt = src.indexOf('async function roleDeliveryUrl(', at);
  assert.ok(deliveryAt > at, 'блок roleDeliveryUrl на месте');
  const end = src.indexOf('\n  /**', deliveryAt);
  assert.ok(end > deliveryAt, 'конец roleDeliveryUrl на месте');
  return src.slice(at, end);
})();

const relayBaseApi = (stored = "", contactAt = 0) => {
  const factory = new Function(
    "GM_getValue", `${relayBaseBlock}\n return { relayBase, relayConfigured, markContact: (value) => { relayContactAt = value; } };`,
  );
  const api = factory((key, fallback) => key === "cfn-relay-url" ? stored : fallback);
  if (contactAt) api.markContact(contactAt);
  return api;
};

{
  const automatic = relayBaseApi();
  assert.equal(automatic.relayBase(), "http://127.0.0.1:8787", "стандартный локальный Relay подключается без ручного URL");
  assert.equal(automatic.relayConfigured(), false, "до ответа службы автообнаружение не подавляет прежний режим");
  assert.equal(relayBaseApi("http://localhost:8787").relayBase(), "http://127.0.0.1:8787", "localhost принудительно направляется на IPv4");
  assert.equal(relayBaseApi("http://relay.example:8787").relayBase(), "http://relay.example:8787", "пользовательский сервер сохраняется");
  assert.equal(relayBaseApi("", Date.now()).relayConfigured(), true, "живой автоответ включает Relay режим");
}

const makeUrl = (instances) => {
  const fn = new Function(
    'GM_getValue', 'request', 'norm', 'relayCurrentSlot', 'firstLine', 'Date',
    `${relayBaseBlock}
     ${snapshotBlock}
     ${instancesBlock}
     return { roleDeliveryUrl, roleInstanceUrl, instanceFor, relayInstances };`,
  );
  return fn(
    (key, fallback) => (key === 'cfn-relay-url' ? 'http://localhost:8787' : fallback),
    async () => ({ instances }),
    (x) => String(x || '').replace(/-/g, '').toLowerCase(),
    async () => 'worker-1',
    (text) => String(text || '').split('\n')[0].slice(0, 220),
    Date,
  );
};

// Исполнитель без адреса в строке «Ролей»: адрес живёт только в экземплярах.
{
  const api = makeUrl([{ role: 'Technical Artist', slot: 'worker-1', url: 'https://arena.ai/agent/tech-1', state: 'работает' }]);
  assert.equal(
    await api.roleDeliveryUrl({ name: 'Technical Artist', url: '' }),
    'https://arena.ai/agent/tech-1',
    'адрес доставки берётся у пары, когда в строке «Ролей» пусто',
  );
  assert.equal(
    await api.roleDeliveryUrl({ name: 'Technical Artist', url: 'https://arena.ai/agent/row' }),
    'https://arena.ai/agent/row',
    'адрес строки (админская роль) по-прежнему главный',
  );
  assert.equal(
    await api.roleDeliveryUrl({ name: 'Кого нет в книге', url: '' }),
    '',
    'нет пары — нет адреса, а не подстановка наугад',
  );
}

// ── 2. Самоопознание страницы без «Agent URL» в строке ──────────────────────
// Порядок в исходнике: sendToRole/goTo (8488, 8688) раньше tick (23599).
const tickBlock = (() => {
  const at = src.indexOf('async function tick(fromToggle = false) {');
  assert.ok(at > 0, 'блок tick на месте');
  const end = src.indexOf('async function idleWrongAccount(', at) > at
    ? src.indexOf('function idleWrongAccount(', at)
    : src.length;
  return src.slice(at, end === -1 ? src.length : end);
})();
{
  const tick = tickBlock;
  assert.match(tick, /relayInstances\(await relaySnapshot\(\)/, 'страница ищет себя в «Экземплярах»');
  assert.match(tick, /norm\(item\["Agent URL"\]\)\.includes\(norm\(meId\)\)/, 'по адресу страницы');
  assert.match(tick, /relayCurrentSlot\(\)/, 'и по почте аккаунта, если адрес не совпал');
  assert.match(tick, /names\.length === 1/, 'несколько ролей в слоте — не угадываем');
  assert.match(tick, /обновите страницу/, 'и говорим, что делать, если не нашлось');
}

// ── 3. Отправка и переход не идут «в никуда» ───────────────────────────────
{
  // sendToRole → goTo. Между ними есть вложенные функции, поэтому границу
  // задаём по объявлению goTo, а не по первому отступу.
  const send = (() => {
    const at = src.indexOf('async function sendToRole(');
    const end = src.indexOf('async function goTo(', at);
    assert.ok(at > 0 && end > at, 'блок sendToRole на месте');
    return src.slice(at, end);
  })();
  assert.match(send, /const deliveryUrl = await roleDeliveryUrl\(role\);/, 'адрес спрошен один раз');
  assert.match(send, /location\.assign\(deliveryUrl\)/, 'переход — на адрес пары');
  assert.doesNotMatch(send, /location\.assign\(role\.url\)/, 'на пустой адрес строки больше не переходим');
  assert.match(send, /задание «\$\{role\.name\}» не отправлено|Задание «\$\{role\.name\}» не отправлено/, 'нет адреса — сказано вслух');

  const nav = (() => {
    const at = src.indexOf('async function navigateTo(role, why) {');
    const end = src.indexOf('function idleWrongAccount(', at);
    assert.ok(at > 0 && end > at, 'блок navigateTo на месте');
    return src.slice(at, end);
  })();
  assert.match(nav, /const deliveryUrl = await roleDeliveryUrl\(role\);/, 'переход тоже спрашивает адрес пары');
  assert.match(nav, /location\.assign\(deliveryUrl\)/, 'и открывает именно его');
  // Защита от петли не должна сломаться на пустом адресе.
  assert.match(tickBlock, /owner\.url \|\| \(await roleDeliveryUrl\(owner\)\)/,
    'сравнение «та же страница» терпит пустой url строки');
}

// ── 4. Адресат обратной связи ──────────────────────────────────────────────
{
  const answers = block('async function startAnswer(', 'async function ');
  assert.match(answers, /roleInstanceUrl\(named\.name\)/, 'адресат `need` резолвится у пары');
  assert.match(answers, /const addresseeReady = Boolean\(named && named\.status === "Активна" && namedUrl\);/,
    'готовность адресата — по резолвленному адресу');
}

// ── 5. Настройка видна человеку: без адреса службы пар нет ──────────────────
{
  const ui = block('function connectionSettings()', 'function connectionProblem(');
  assert.match(ui, /relayUrl:/, 'адрес службы хранится в подключениях профиля');
  assert.match(src, /cfn-connection-relay-url/, 'и у него есть поле в окне ⚙');
  assert.match(src, /Служба Relay/, 'подписанное по-человечески');
  const save = block('if (!endpoint.ok && driveChanged)', 'const updates = [');
  assert.match(save, /Адрес службы Relay должен быть полным/, 'опечатку в адресе видно до сохранения');
  assert.match(src, /\["cfn-relay-url", saved\.relayUrl, next\.relayUrl\]/, 'и он сохраняется вместе с остальными');
}

console.log('OK: relay 1.24.1 — адрес агента берётся у пары (роль, слот), а не только из «Ролей»');
