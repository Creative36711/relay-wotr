// Диспетчер: решает, кому достанется работа, и разносит её по слотам.
//
// Требование владельца дословно: «скрипт должен проверять, какой контейнер
// закончил работу и тут же передавать ход обратно координатору, даже если
// другие контейнеры ещё работают». Отсюда — решение принимается на каждую
// строку отдельно, а не «пакетом по всем слотам».
//
// Второе требование: «координатор сам решает, когда выдавать следующую
// карточку… не должен выдавать карточки ради загрузки агентов». Поэтому:
//   • количество одновременных выдач просит Координатор, но не больше предела;
//   • слот подбирается по правилу (свободен, аккаунт не в лимите, роль
//     допустима в этом типе слота), а не случайно;
//   • явное указание слота Координатором — сильнее правила;
//   • каждая выдача оставляет в журнале причину выбора: «почему именно так».

import { claimable, planDispatch, queueSummary, leaseItem, QUEUE } from "./queue.mjs";
import { slotAcceptsRole, slotById } from "./slots.mjs";
import { roleLimits, byAccountCost } from "./limits.mjs";
import { isAdminRole } from "./schema.mjs";
import { slotGate } from "./accounts.mjs";
import { norm } from "./util.mjs";

/**
 * Кто может взять строку.
 *
 * Свободный слот — это не «нет выдачи», а «нет выдачи и аккаунт не в лимите».
 * Иначе диспетчер выдаст работу туда, где она немедленно упрётся в квоту, и
 * это будет выглядеть как зависание.
 */
export function assignable(slots, { state = new Map(), runs = [], roles = [], maxParallelPerSlot = 1 } = {}) {
  const liveRuns = runs.filter((run) => ["issued", "alive"].includes(norm(run["Статус"])));
  return slots
    .filter((slot) => slot.enabled)
    .map((slot) => ({ slot, gate: slotGate(slot, { state, liveRuns, maxParallelPerSlot }) }))
    .filter(({ gate }) => gate.ok)
    .map(({ slot }) => slot);
}

/**
 * План одной выдачи.
 *
 * Возвращает либо «выдаём: слот такой-то, строка такая-то, причина такая», либо
 * отказ с причиной. Побочных эффектов нет — поэтому план можно показать
 * человеку до того, как что-то произойдёт.
 *
 * Административность роли берётся из двух источников: из справочника ролей,
 * если он передан, и из колонки «Функция» самой строки очереди. Второй важнее:
 * он есть всегда, даже когда связь с Notion недоступна, а цена ошибки высока —
 * Coordinator, ушедший на рабочий слот, съедает квоту исполнителя (D-004).
 */
export function planOne({
  slots, queue, runs, roles = [], state, itemId = "", slotId = "",
  maxParallelPerSlot = 1, maxPerRole = 1,
}) {
  const roleByName = new Map(roles.map((role) => [norm(role.name), role]));
  const free = assignable(slots, { state, runs, roles, maxParallelPerSlot });
  if (!free.length) {
    const reasons = slots
      .filter((slot) => slot.enabled)
      .map((slot) => slotGate(slot, { state, liveRuns: runs.filter((run) => ["issued", "alive"].includes(norm(run["Статус"]))), maxParallelPerSlot }).why)
      .filter(Boolean);
    return { ok: false, why: `свободных слотов нет${reasons.length ? `: ${reasons.join("; ")}` : ""}` };
  }

  // Строка очереди: названная явно, иначе первая доступная.
  const candidates = itemId
    ? queue.filter((item) => norm(item["ID"]) === norm(itemId))
    : free.flatMap((slot) => claimable(slots, slot.slotId, { queue, roles, roleAllows: slotAcceptsRole }));
  if (!candidates.length) return { ok: false, why: itemId ? `строки ${itemId} нет` : "в очереди нет работы, подходящей свободным слотам" };

  const item = candidates[0];
  const role = roleByName.get(norm(item["Роль"])) || null;
  // Административность видна и без справочника: имя роли и функция в строке
  // очереди несут её сами. Справочник лишь уточняет, если он доступен.
  const adminNeeded = role
    ? isAdminRole(role.name, role.fn)
    : isAdminRole(item["Роль"], item["Функция"]);

  // Слот: названный в строке — сильнее правила; названный в вызове — сильнее всех.
  const wanted = norm(slotId) || norm(item["Слот"]);
  // Выбор слота — по расходу аккаунта, а не по порядку в таблице.
  //
  // Квота считается на аккаунт, и все роли дублируются на каждом аккаунте.
  // Значит «первый свободный» — худший выбор: первый аккаунт выгорит, а
  // остальные будут стоять. Ровный расход оставляет запас, из которого можно
  // добрать, когда один аккаунт всё-таки упрётся в лимит.
  const byType = byAccountCost(free, { runs, state, admin: adminNeeded }).map((entry) => entry.slot);
  const target = wanted
    ? free.find((slot) => norm(slot.slotId) === wanted)
    : byType[0];

  if (!target) {
    const exists = wanted ? slotById(slots, wanted) : null;
    if (!wanted) {
      return {
        ok: false,
        why: adminNeeded
          ? `для административной роли «${item["Роль"] || item["Функция"]}» нет свободного административного слота`
          : `для рабочей роли «${item["Роль"] || "без имени"}» нет свободного рабочего слота`,
      };
    }
    if (!exists) return { ok: false, why: `слота ${wanted} нет в таблице` };
    const gate = slotGate(exists, { state, liveRuns: runs, maxParallelPerSlot });
    return { ok: false, why: gate.why || `слот ${wanted} занят` };
  }

  // Явно названный слот проверяется по типу: ошибка раскладки не должна
  // выполняться молча только потому, что человек её выбрал.
  if (Boolean(target.admin) !== Boolean(adminNeeded)) {
    return {
      ok: false,
      why: adminNeeded
        ? `административная роль «${item["Роль"] || item["Функция"]}» не может идти в рабочий слот ${target.slotId}`
        : `рабочая роль «${item["Роль"] || "без имени"}» не может идти в административный слот ${target.slotId}`,
    };
  }

  // Пределы на роль и на карточку. Стоят здесь, а не в вызывающем коде:
  // захват строки — последняя точка, после которой отказ стоит дорого
  // (строку придётся возвращать в очередь, а вкладка уже могла её увидеть).
  // Причина отказа уходит и в журнал, и Координатору, поэтому она говорит,
  // какая именно роль занята и где, а не «нельзя».
  const limits = roleLimits({
    role: item["Роль"],
    card: item["Карточка"],
    runs,
    maxPerRole,
  });
  if (!limits.ok) return { ok: false, why: limits.why, limits };

  const leased = leaseItem(item, { slotId: target.slotId });
  if (!leased.ok) return { ok: false, why: leased.why };

  return {
    ok: true,
    item,
    slot: target,
    role,
    why: `строка ${item["ID"]} → слот ${target.slotId} (${target.container || "контейнер не назван"}, ${target.account || "аккаунт не назван"})`,
  };
}

/**
 * Сколько выдач делать сейчас.
 *
 * `requested` приходит от Координатора: он может попросить меньше, чем
 * позволяет предел, — «сейчас выгоднее одна карточка, чем четыре». Диспетчер
 * не спорит с этим решением и не «добирает» до предела.
 */
export function planBatch({
  slots, queue, runs, state, roles = [], maxParallel = 1, requested = null,
  maxParallelPerSlot = 1, maxPerRole = 1,
}) {
  const summary = queueSummary({ queue, runs, slots });
  const free = assignable(slots, { state, runs, maxParallelPerSlot }).length;
  const decision = planDispatch({ queueSummary: { ...summary, idleSlots: new Array(free).fill(0) }, maxParallel, requested });
  const plans = [];
  let takenQueue = queue;
  let takenRuns = runs;
  for (let i = 0; i < decision.count; i += 1) {
    const plan = planOne({
      slots, queue: takenQueue, runs: takenRuns, roles, state, maxParallelPerSlot, maxPerRole,
    });
    if (!plan.ok) break;
    plans.push(plan);
    takenQueue = takenQueue.map((item) => (norm(item["ID"]) === norm(plan.item["ID"]) ? { ...item, "Статус": QUEUE.LEASED } : item));
    // Перенос в «занятые» обязан нести роль, карточку и аккаунт, и не только
    // слот. Раньше здесь была одна пара полей — и проверка пределов внутри
    // пакета не видела ни роли, ни карточки: три карточки одной роли уезжали в
    // три контейнера, хотя `planOne` по отдельности каждую из них запрещал.
    // Ошибка была невидимой, потому что вне пакета всё работало.
    takenRuns = [...takenRuns, {
      "Run ID": `plan-${i}`,
      "Слот": plan.slot.slotId,
      "Аккаунт": plan.slot.account,
      "Роль": plan.item["Роль"],
      "Карточка": plan.item["Карточка"],
      "Статус": "issued",
    }];
  }
  return { plans, why: decision.why, requested: decision.count };
}

/**
 * Возврат хода.
 *
 * Слот закончил — ход возвращается сразу, не дожидаясь остальных. Это и есть
 * асинхронность; здесь она выражена одной функцией, чтобы не размазывать
 * условие «свободен ли ещё кто-то» по коду цикла.
 */
export function releaseAndRequeue({ runs, slotId, runId, status = "submitted", at = new Date().toISOString() }) {
  const updated = runs.map((run) => {
    if (norm(run["Run ID"]) !== norm(runId)) return run;
    return { ...run, "Статус": status, "Последняя жизнь": at };
  });
  const stillBusy = updated.filter((run) => ["issued", "alive"].includes(norm(run["Статус"]))).map((run) => run["Слот"]);
  const freed = !stillBusy.includes(slotId);
  return {
    runs: updated,
    freedSlot: freed ? slotId : "",
    busySlots: [...new Set(stillBusy.filter(Boolean))],
    next: freed ? "ход свободен: можно выдавать следующую строку на этот слот" : "слот ещё занят другой выдачей",
  };
}

/** Живые выдачи конкретного слота: по ним видно, чем он занят. */
export const slotRuns = (runs, slotId) =>
  runs.filter((run) => norm(run["Слот"]) === norm(slotId) && ["issued", "alive"].includes(norm(run["Статус"])));
