// Экземпляры агентов: пара (роль, слот) → живой агент Arena.
//
// Зачем отдельный модуль, а не поле в строке роли.
//
// Раньше «одна роль = один агент» держалось на том, что в строке «Ролей» был
// один `Agent URL`. Как только рабочих контейнеров стало три и в каждом нужны
// те же одиннадцать ролей, это перестало выражать действительность: у «Godot
// World» не один адрес, а столько, сколько контейнеров. Notion не хранит массив
// в `url`, а `rich_text` со списком транспорт разобрать не может — и не должен:
// список ссылок в тексте это не структура, а повод для ошибки.
//
// Поэтому ключ здесь — пара. Роль остаётся описанием работы, экземпляр —
// описанием конкретного агента в конкретном контейнере.
//
// Три правила, без которых ленивое создание превращается в лавину:
//
//   1. **Пара, а не роль.** Иначе первый запуск создаст одного «Godot World» и
//      раздаст его адрес всем трём контейнерам — три вкладки будут писать в
//      один чат и никто этого не заметит.
//   2. **Проверка карточки до создания.** Экземпляр создаётся под карточку,
//      которая уже едет в этот слот, а не «потому что слота нет в таблице».
//      Разница видна на сбое чтения: пустая таблица не должна означать
//      «создать тридцать три агента».
//   3. **Состояние решает, нужен ли агент.** `создан` — есть адрес, можно
//      выдавать. `нет`/`ошибка` — нужен. `создаётся` — уже в работе, второй
//      раз не просим.
//
// Ленивое создание — это задание, а не действие: служба не умеет открывать
// вкладку. Она ставит в очередь строку `kind = provision`, вкладка этого слота
// её забирает, создаёт агента и сообщает адрес. До этого момента карточка
// ждёт, а не отказывается: отказ был бы блокером, которого владелец просил не
// делать.

import { SHEETS, rowToObject, objectToRow } from "./schema.mjs";
import { norm } from "./util.mjs";

export const AGENT_STATE = {
  NONE: "нет",              // пары нет вовсе — нужен агент
  CREATING: "создаётся",    // задание выдано, вкладка работает
  CREATED: "создан",        // есть адрес, можно выдавать карточки
  BROKEN: "ошибка",         // создать не удалось: причина в «Заметке»
  RETIRED: "выведен",       // роль в этом слоте больше не нужна
};

/** Состояния, в которых агента нет, но создавать его сейчас не надо. */
const PENDING = new Set([AGENT_STATE.CREATING]);

/** Состояние строки «Экземпляры» → нужен ли агент. */
export function needsAgent(instance) {
  if (!instance) return true;
  const state = norm(instance.state);
  if (state === AGENT_STATE.CREATED && instance.url) return false;
  return !PENDING.has(state);
}

/**
 * Разбор листа «Экземпляры».
 *
 * `key` — нормализованная пара «роль|слот». Он и только он используется для
 * поиска: имена ролей человек правит в Notion, и «Godot World» с двойным
 * пробелом не должен выглядеть новым агентом.
 */
export function parseInstances(rows) {
  const out = [];
  for (const raw of rows || []) {
    const row = rowToObject("agents", raw);
    const role = row["Роль"].trim();
    const slot = row["Слот"].trim();
    if (!role || !slot) continue;
    out.push({
      role,
      slot,
      key: instanceKey(role, slot),
      url: row["Agent URL"].trim(),
      state: row["Состояние"].trim() || AGENT_STATE.NONE,
      createdAt: row["Создан"].trim(),
      jobId: row["Job ID"].trim(),
      lastSeen: row["Последняя жизнь"].trim(),
      note: row["Заметка"],
    });
  }
  return out;
}

/**
 * Ключ пары.
 *
 * Внутренние пробелы сжимаются: имя роли правят руками в Notion, и «Godot
 * World» с двойным пробелом — это та же роль. Без сжатия опечатка в пробеле
 * выглядела бы новым агентом, которого «ещё нет», и создавала дубль.
 */
const pairPart = (value) => norm(value).replace(/\s+/g, " ");
export const instanceKey = (role, slot) => `${pairPart(role)}|${pairPart(slot)}`;

export function instanceFor(instances, role, slot) {
  const key = instanceKey(role, slot);
  return (instances || []).find((item) => item.key === key) || null;
}

/** Экземпляры слота — то, что вкладка этого слота должна держать открытым. */
export const instancesOfSlot = (instances, slot) =>
  (instances || []).filter((item) => norm(item.slot) === norm(slot));

/**
 * Строка листа для записи.
 *
 * Отдельная функция, потому что порядок колонок задаёт `schema.mjs`, и
 * единственный способ не разъехаться — собирать строку только через неё.
 */
export function instanceToRow(instance) {
  return objectToRow("agents", {
    "Роль": instance.role,
    "Слот": instance.slot,
    "Agent URL": instance.url || "",
    "Состояние": instance.state || AGENT_STATE.NONE,
    "Создан": instance.createdAt || "",
    "Job ID": instance.jobId || "",
    "Последняя жизнь": instance.lastSeen || "",
    "Заметка": instance.note || "",
  });
}

/**
 * Что делать с парой (роль, слот) прямо сейчас.
 *
 * Возвращает решение, а не действие: вызывающий сам решает, писать ли строку
 * `provision` в очередь. Так одну и ту же проверку используют и диспетчер, и
 * пульт, и тесты — и они не могут разойтись в трактовке.
 *
 * `legacyUrl` — адрес из строки роли. Пока он есть, а экземпляра нет, пара
 * наследует его: старые базы с одним агентом на роль продолжают работать без
 * миграции. Это важно: требовать ручного переноса адресов при обновлении —
 * верный способ, чтобы обновление не сделали.
 */
export function agentDecision({ role, slot, instances = [], legacyUrl = "" } = {}) {
  const instance = instanceFor(instances, role, slot);
  if (instance && instance.url && norm(instance.state) === AGENT_STATE.CREATED) {
    return { action: "use", url: instance.url, why: `экземпляр ${role} в ${slot} готов`, instance };
  }
  if (instance && PENDING.has(norm(instance.state))) {
    return { action: "wait", why: `агент ${role} в ${slot} уже создаётся`, instance };
  }
  if (legacyUrl && !instance) {
    // Наследование: адрес роли считается адресом экземпляра в этом слоте.
    return {
      action: "use",
      url: legacyUrl,
      inherited: true,
      why: `адрес ${role} взят из строки роли и относится к слоту ${slot}`,
      instance: null,
    };
  }
  const broken = instance && norm(instance.state) === AGENT_STATE.BROKEN;
  return {
    action: "create",
    why: broken
      ? `агент ${role} в ${slot} не создался раньше: ${instance.note || "причина не записана"}`
      : `агента ${role} в ${slot} ещё нет`,
    instance,
  };
}

/**
 * Нужен ли отдельный агент на каждую пару (роль, слот).
 *
 * Административные роли — исключение: они живут только в административном
 * слоте, и второй экземпляр им не нужен и вреден (D-004: квота администратора
 * не должна делить аккаунт с работой).
 */
export const pairNeedsInstance = (role, slot) => Boolean(role && slot);

/**
 * Описание пар для технического промпта Координатора.
 *
 * Координатору нужно не «сколько слотов свободно», а «кого я могу занять прямо
 * сейчас и кого придётся создавать». Без второго он будет считать роль
 * недоступной и не выдаст карточку — ровно та ошибка, которую просил убрать
 * владелец.
 */
export function pairsForPrompt({ roles = [], slots = [], instances = [], liveRuns = [] } = {}) {
  const busy = new Map();
  for (const run of liveRuns) {
    const key = instanceKey(run["Роль"], run["Слот"]);
    busy.set(key, (busy.get(key) || 0) + 1);
  }
  const out = [];
  for (const role of roles) {
    for (const slot of slots) {
      if (!slotAccepts(role, slot)) continue;
      const key = instanceKey(role.name, slot.slotId);
      const decision = agentDecision({
        role: role.name,
        slot: slot.slotId,
        instances,
        legacyUrl: role.url || "",
      });
      out.push({
        role: role.name,
        slot: slot.slotId,
        state: decision.action === "use" ? "готов" : decision.action === "wait" ? "создаётся" : "нет агента",
        busy: busy.get(key) || 0,
        why: decision.why,
      });
    }
  }
  return out;
}

/**
 * Может ли роль жить в слоте. Дублируется здесь намеренно: `agents.mjs` не
 * должен тянуть за собой `slots.mjs` целиком только ради двух условий, а
 * расхождение ловится тестом на одинаковый ответ обеих функций.
 */
function slotAccepts(role, slot) {
  if (!slot || !slot.enabled) return false;
  const admin = Boolean(role?.agentAdmin);
  return admin === Boolean(slot.admin);
}
