// Очередь работы и выдачи.
//
// Раньше единицей работы была вкладка: она держала одно ожидание в памяти, и
// поэтому одновременно могла идти ровно одна карточка. Здесь единица работы —
// строка очереди, а «кто её взял» — отдельная колонка. Отсюда два свойства,
// ради которых всё переделано:
//
//   1. Роль перестала быть «местом». Одна и та же роль может иметь несколько
//      одновременных выдач — разные слоты, разные Agent URL.
//   2. Слот, закончивший работу, сразу возвращает ход, не дожидаясь остальных.
//      Поэтому закрытие одной карточки не ждёт самую долгую.

import { QUEUE_STATES, RUN_STATES, rowToObject, objectToRow } from "./schema.mjs";

export const QUEUE = {
  WAITING: "waiting",
  BLOCKED: "blocked",
  LEASED: "leased",
  DONE: "done",
  CANCELLED: "cancelled",
};

/** Вид строки очереди: не работа по миссии, а задание создать агента. */
export const PROVISION_KIND = "provision";

export const RUN = {
  ISSUED: "issued",
  ALIVE: "alive",
  SUBMITTED: "submitted",
  FAILED: "failed",
  ABANDONED: "abandoned",
};

const norm = (value) => String(value ?? "").trim();

/** Новый id строки очереди. Время в начале: сортировка по строке = по времени. */
export function newQueueId(now = Date.now()) {
  const tail = Math.random().toString(36).slice(2, 8);
  return `q-${new Date(now).toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${tail}`;
}

export function newRunId(now = Date.now()) {
  const tail = Math.random().toString(36).slice(2, 10);
  return `r-${new Date(now).toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${tail}`;
}

/**
 * Строка очереди.
 *
 * `kind` отличает обычную выдачу от служебной (разбор инцидента, вопрос
 * Координатора): у них разные правила удержания и разные сроки.
 */
export function makeQueueItem({
  id = newQueueId(),
  at = new Date().toISOString(),
  card = "",
  title = "",
  role = "",
  fn = "",
  slot = "",
  kind = "dispatch",
  status = QUEUE.WAITING,
  note = "",
} = {}) {
  return {
    "ID": id,
    "Создано": at,
    "Карточка": card,
    "Заголовок": title,
    "Роль": role,
    "Функция": fn,
    "Слот": slot,
    "Вид": kind,
    "Статус": QUEUE_STATES.includes(status) ? status : QUEUE.WAITING,
    "Взял слот": "",
    "Взято в": "",
    "Готово в": "",
    "Комментарий": note,
  };
}

export function makeRun({
  runId = newRunId(),
  card = "",
  title = "",
  slot = "",
  account = "",
  role = "",
  agentUrl = "",
  status = RUN.ISSUED,
  at = new Date().toISOString(),
  expect = "",
} = {}) {
  return {
    "Run ID": runId,
    "Карточка": card,
    "Заголовок": title,
    "Слот": slot,
    "Аккаунт": account,
    "Роль": role,
    "Agent URL": agentUrl,
    "Статус": RUN_STATES.includes(status) ? status : RUN.ISSUED,
    "Выдан": at,
    "Последняя жизнь": at,
    "Ожидание": expect,
    "Попытка": "1",
    "Маркер": "",
    "Ответ": "",
  };
}

export const parseQueue = (rows) =>
  (rows || []).map((row) => rowToObject("queue", row)).filter((item) => norm(item["ID"]));

export const parseRuns = (rows) =>
  (rows || []).map((row) => rowToObject("runs", row)).filter((item) => norm(item["Run ID"]));

export const queueToRow = (item) => objectToRow("queue", item);
export const runToRow = (run) => objectToRow("runs", run);

export const isOpen = (item) => [QUEUE.WAITING, QUEUE.BLOCKED, QUEUE.LEASED].includes(norm(item["Статус"]));
export const isLiveRun = (run) => [RUN.ISSUED, RUN.ALIVE].includes(norm(run["Статус"]));

/**
 * Свободные строки очереди для слота, в порядке постановки.
 *
 * Строка со слотом уходит только в этот слот: Координатор назвал место
 * намеренно (например, «только в textile33b»), и перекидывать её самовольно
 * нельзя — иначе лимит аккаунта превратится в перетягивание работы.
 * Строка без слота — общая: её берёт первый, кто освободился.
 */
export function claimable(slots, slotId, { queue = [], roles = [], roleAllows = () => true } = {}) {
  const slot = slots.find((item) => item.slotId === slotId);
  if (!slot || !slot.enabled) return [];
  const roleByName = new Map(roles.map((role) => [norm(role.name), role]));
  return queue
    .filter((item) => norm(item["Статус"]) === QUEUE.WAITING)
    // Задания на создание агента не раздаются обычной выдачей. Их забирает
    // только тот слот, для которого они поставлены, и отдельным входом:
    // иначе `planOne` выдал бы «создай агента» как рабочую карточку, и вкладка
    // чужого контейнера создала бы агента не в том слоте.
    .filter((item) => norm(item["Вид"]) !== PROVISION_KIND)
    .filter((item) => {
      const target = norm(item["Слот"]);
      return !target || target === slotId;
    })
    .filter((item) => {
      const role = roleByName.get(norm(item["Роль"]));
      return !role || roleAllows(slot, role);
    })
    .sort((a, b) => norm(a["Создано"]).localeCompare(norm(b["Создано"])));
}

/**
 * Захват строки.
 *
 * Проверка «ещё свободна» и запись статуса разнесены намеренно: вызывающий
 * сначала сверяет свежее состояние, потом пишет. Гонка двух вкладок за одну
 * строку разрешается тем, что вторая увидит `leased` и возьмёт следующую —
 * а не тем, что обе пошлют задание.
 */
export function leaseItem(item, { slotId, at = new Date().toISOString() }) {
  if (norm(item["Статус"]) !== QUEUE.WAITING) {
    return { ok: false, why: `строка уже не свободна: ${item["Статус"]}` };
  }
  const target = norm(item["Слот"]);
  if (target && target !== slotId) return { ok: false, why: `строка закреплена за слотом ${target}` };
  return {
    ok: true,
    item: {
      ...item,
      "Статус": QUEUE.LEASED,
      "Взял слот": slotId,
      "Взято в": at,
    },
  };
}

export function finishItem(item, { status = QUEUE.DONE, at = new Date().toISOString(), note = "" } = {}) {
  return {
    ...item,
    "Статус": status,
    "Готово в": at,
    "Комментарий": note || item["Комментарий"],
  };
}

/**
 * Что показывает Координатору сводка очереди.
 *
 * Ему нужен не список строк, а ответ на вопрос «сколько работы сейчас в
 * воздухе и что мешает выдать следующую». Поэтому занятые слоты и причины
 * блокировки названы явно, а не выводятся из количества строк.
 */
export function queueSummary({ queue = [], runs = [], slots = [], now = Date.now() } = {}) {
  const waiting = queue.filter((item) => norm(item["Статус"]) === QUEUE.WAITING);
  const blocked = queue.filter((item) => norm(item["Статус"]) === QUEUE.BLOCKED);
  const live = runs.filter(isLiveRun);
  const busySlots = new Set(live.map((run) => norm(run["Слот"])).filter(Boolean));
  const idle = slots
    .filter((slot) => slot.enabled)
    .filter((slot) => !busySlots.has(slot.slotId))
    .map((slot) => slot.slotId);
  return {
    waiting: waiting.length,
    blocked: blocked.length,
    inFlight: live.length,
    busySlots: [...busySlots],
    idleSlots: idle,
    waitingItems: waiting,
    blockedItems: blocked,
    at: new Date(now).toISOString(),
  };
}

/**
 * Решение «сколько выдавать сейчас».
 *
 * Не «занять все слоты», а «столько, сколько требует проект»: предел задаёт
 * настройка, а Координатор может попросить меньше. Диспетчер никогда не
 * выдаёт больше, чем есть свободных слотов и свободных строк: пустая выдача
 * хуже, чем очередь, которая подождёт.
 */
export function planDispatch({ queueSummary: summary, maxParallel = 1, requested = null } = {}) {
  const free = summary.idleSlots.length;
  const want = Number(requested ?? maxParallel);
  const limit = Math.max(0, Math.min(free, summary.waiting, Number.isFinite(want) ? want : maxParallel));
  return {
    count: limit,
    why: free === 0
      ? "все слоты заняты"
      : summary.waiting === 0
        ? "в очереди нет свободной работы"
        : `свободно слотов: ${free}, в очереди: ${summary.waiting}, предел: ${maxParallel}`,
  };
}
