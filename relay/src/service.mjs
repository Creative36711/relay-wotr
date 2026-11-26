// Служба транспорта: единственное место, где принимаются решения.
//
// Здесь сходятся три потока:
//   1. вкладки спрашивают «что мне делать» и рассказывают, что случилось;
//   2. человек в пульте жмёт «шаг», «пауза», переключает режим;
//   3. диспетчер раздаёт работу по слотам, не дожидаясь друг друга.
//
// Одно сознательное ограничение: служба не лезет в браузер. Она не может
// открыть вкладку, нажать кнопку или переключить контейнер — этого не умеет
// ничто, кроме человека и самой вкладки. Поэтому максимум, что она делает, —
// говорит вкладке «твоя работа: вот она» и ждёт отчёта.

import { parseSlots, slotById, slotByAccount } from "./slots.mjs";
import { parseQueue, parseRuns, makeRun, queueToRow, RUN, isLiveRun } from "./queue.mjs";
import { planOne, planBatch, releaseAndRequeue } from "./dispatch.mjs";
import { accountState, slotGate, limitMark } from "./accounts.mjs";
import { parseEvents, makeEvent, incidentWindow } from "./events.mjs";
import { buildIncidentPackage } from "./incident.mjs";
import { parseSettings } from "./settings.mjs";
import { planSetup, applySetup } from "./setup.mjs";
import { searchDatabases } from "./notion-db.mjs";
import { ACTIONS, CONTROL, PROTOCOL_VERSION, validateRequest, idle, work } from "./protocol.mjs";
import { isoNow, norm, clip } from "./util.mjs";
import { makeQueueItem, QUEUE } from "./queue.mjs";

/**
 * Состояние, которого нет в таблице.
 *
 * Блокировка записи и последний шаг живут в памяти службы: они меняются чаще,
 * чем раз в секунду, и писать их в Sheets на каждый тик значило бы упереться
 * в квоту API. Всё, что должно пережить перезапуск, лежит в таблице.
 */
export function createMemoryState() {
  return {
    lock: null,        // { owner, until }
    lastTick: 0,
    lastStep: null,
    paused: false,
    pauseReason: "",
    slotsCache: null,
    slotsAt: 0,
  };
}

const SLOT_CACHE_MS = 30000;

/**
 * Сборка службы.
 *
 * Зависимости передаются явно (`store`, `notion`, `now`, `log`), поэтому
 * поведение проверяется тестом без сети и без браузера.
 */
export function createService({
  store,
  notion = null,
  notionSearch = null,
  now = () => Date.now(),
  memory = createMemoryState(),
  slotsCacheMs = SLOT_CACHE_MS,
  log = () => {},
} = {}) {
  if (!store) throw new Error("служба без хранилища не работает");

  async function loadSlots(force = false) {
    if (!force && memory.slotsCache && now() - memory.slotsAt < slotsCacheMs) return memory.slotsCache;
    const { rows } = await store.read("slots");
    memory.slotsCache = parseSlots(rows);
    memory.slotsAt = now();
    return memory.slotsCache;
  }

  async function loadSettings() {
    const { rows } = await store.read("settings");
    return parseSettings(rows);
  }

  async function loadAll() {
    const [slots, queueSheet, runsSheet, eventsSheet, settings] = await Promise.all([
      loadSlots(),
      store.read("queue"),
      store.read("runs"),
      store.read("events"),
      loadSettings(),
    ]);
    return {
      slots,
      queue: parseQueue(queueSheet.rows),
      runs: parseRuns(runsSheet.rows),
      events: parseEvents(eventsSheet.rows),
      settings,
    };
  }

  async function record(event) {
    const row = makeEvent(event);
    try {
      await store.append("events", [[
        row["Время"], row["Слот"], row["Аккаунт"], row["Вкладка"], row["Вид"],
        row["Уровень"], row["Текст"], row["Карточка"], row["Run ID"],
        row["Длительность мс"], row["Данные"],
      ]]);
    } catch (error) {
      // Журнал не должен валить работу: событие потеряется, работа — нет.
      log(`событие не записано: ${error.message}`);
    }
    return row;
  }

  /** Блокировка: один шаг за раз, но короткая, чтобы не превращаться в затор. */
  function acquire(owner, ms = 20000) {
    const at = now();
    if (memory.lock && memory.lock.until > at && memory.lock.owner !== owner) {
      return { ok: false, why: `шаг уже идёт (${memory.lock.owner})` };
    }
    memory.lock = { owner, until: at + ms };
    return { ok: true };
  }

  function release(owner) {
    if (memory.lock && memory.lock.owner === owner) memory.lock = null;
  }

  /**
   * Выдать план: создать выдачу, пометить строку занятой, записать в журнал.
   *
   * Одна функция на два входа — «шаг» человека и прямой запрос вкладки.
   * Иначе появились бы две реализации выдачи, и они разошлись бы в том, когда
   * строка считается занятой; цена расхождения — двойная выдача карточки.
   */
  async function issue({ plan, slot, data, tab = "", origin = "pull" }) {
    const run = makeRun({
      card: plan.item["Карточка"], title: plan.item["Заголовок"], slot: slot.slotId,
      account: slot.account, role: plan.item["Роль"], agentUrl: plan.role?.url || "",
      at: isoNow(now()),
    });
    await store.append("runs", [[
      run["Run ID"], run["Карточка"], run["Заголовок"], run["Слот"], run["Аккаунт"],
      run["Роль"], run["Agent URL"], run["Статус"], run["Выдан"], run["Последняя жизнь"],
      run["Ожидание"], run["Попытка"], run["Маркер"], run["Ответ"],
    ]]);

    const rowIndex = data.queue.findIndex((item) => norm(item["ID"]) === norm(plan.item["ID"]));
    if (rowIndex >= 0) {
      const leasedRow = { ...plan.item, "Статус": "leased", "Взял слот": slot.slotId, "Взято в": run["Выдан"] };
      await store.updateRange("queue", rowIndex + 2, [queueToRow(leasedRow)]);
    }

    await record({
      slot: slot.slotId, account: slot.account, tab, kind: "dispatch",
      text: `выдача ${run["Run ID"]}: ${clip(plan.item["Заголовок"] || plan.item["Карточка"], 60)} → ${plan.item["Роль"]}`,
      card: plan.item["Карточка"], runId: run["Run ID"], data: { origin },
    });
    return run;
  }

  /**
   * `hello`: вкладка называет себя.
   *
   * Опознание по аккаунту: вкладка читает почту из подписи Arena и говорит её
   * службе. Слот ищется по аккаунту, а не по имени контейнера, — переименование
   * контейнера не должно ломать транспорт. Неизвестный аккаунт — честный
   * отказ с подсказкой, какой слот добавить.
   */
  async function hello({ account = "", tab = "", path = "" } = {}) {
    const slots = await loadSlots(true);
    const slot = slotByAccount(slots, account);
    if (!slot) {
      await record({
        slot: "", account, tab, kind: "accounts", level: "warn",
        text: `вкладка аккаунта ${account || "без подписи"} не опознана: такого аккаунта нет в таблице слотов`,
        data: { account, path },
      });
      return {
        ok: false,
        why: `аккаунт ${account || "не прочитан"} не привязан ни к одному слоту: добавьте строку в лист «Слоты»`,
        slots: slots.map((item) => ({ slotId: item.slotId, account: item.account, admin: item.admin })),
      };
    }
    await record({
      slot: slot.slotId, account, tab, kind: "state",
      text: `вкладка ${tab || "?"} опознана как слот ${slot.slotId} (${slot.admin ? "административный" : "рабочий"})`,
      data: { path },
    });
    return {
      ok: true,
      slot: { slotId: slot.slotId, admin: slot.admin, container: slot.container, account: slot.account },
      protocol: PROTOCOL_VERSION,
    };
  }

  /**
   * `pull`: «дай работу».
   *
   * Ответ всегда один из трёх: работа, «жди» с причиной, «тебе сюда нельзя».
   * Третье — не ошибка вкладки, а расхождение раскладки: административный
   * контейнер не берёт рабочие роли, и вкладка должна об этом сказать человеку.
   */
  async function pull({ slotId = "", tab = "", roleHint = "" } = {}) {
    const data = await loadAll();
    const slot = slotById(data.slots, slotId);
    if (!slot) return { ok: false, why: `слота ${slotId} нет в таблице` };
    if (!slot.enabled) return idle(`слот ${slotId} выключен`);

    const liveRuns = data.runs.filter(isLiveRun);

    // Сначала — «а не я ли это уже спрашивал». Вкладка, потерявшая ответ
    // (перезагрузка, таймаут), обязана получить ту же выдачу, а не «слот занят»:
    // иначе работа висит, а окно честно ждёт задание, которого не будет.
    const mine = liveRuns.find((run) => norm(run["Слот"]) === norm(slotId));
    if (mine) {
      return work({
        runId: mine["Run ID"], card: mine["Карточка"], title: mine["Заголовок"],
        role: mine["Роль"], agentUrl: mine["Agent URL"], attempt: mine["Попытка"],
        repeated: true, why: "эта выдача уже открыта для слота",
      });
    }

    // Лимит аккаунта проверяется после «своей» выдачи: если работа уже у меня,
    // лимит — повод её завершить, а не повод не начинать.
    const accountGate = slotGate(slot, {
      state: accountState(data.slots.map((item) => item.account), { limits: limitsFromEvents(data.events), now: now() }),
      liveRuns: [],
      maxParallelPerSlot: 99,
    });
    if (!accountGate.ok) return idle(accountGate.why);

    // Предел одновременности действует и здесь: вкладка не может обойти решение
    // Координатора о том, сколько работы идёт разом.
    const maxParallel = Number(data.settings["cycle.maxParallel"]) || 1;
    if (liveRuns.length >= maxParallel) {
      return idle(`предел одновременности: уже идёт ${liveRuns.length} из ${maxParallel}`);
    }

    const plan = planOne({
      slots: data.slots, queue: data.queue, runs: data.runs, roles: [],
      state: accountState(data.slots.map((item) => item.account), { now: now() }),
    });
    if (!plan.ok) return idle(plan.why);

    // Захват строки обязан попасть в таблицу, иначе следующая вкладка увидит
    // её свободной и выдаст ту же карточку второй раз.
    const run = await issue({ plan, slot, data, tab, origin: "pull" });
    return work({
      runId: run["Run ID"], card: plan.item["Карточка"], title: plan.item["Заголовок"],
      role: plan.item["Роль"], agentUrl: plan.role?.url || "", attempt: "1", why: plan.why,
    });
  }

  /** `beat`: вкладка жива. Продлевает выдачу и говорит, чего она ждёт. */
  async function beat({ slotId = "", runId = "", tab = "", waiting = "", silentMs = 0 } = {}) {
    const at = isoNow(now());
    const data = await loadAll();
    const index = data.runs.findIndex((run) => norm(run["Run ID"]) === norm(runId));
    if (index < 0) return { ok: false, why: `выдачи ${runId} нет` };
    const run = data.runs[index];
    if (!isLiveRun(run)) return { ok: false, why: `выдача уже ${run["Статус"]}` };
    const status = Number(silentMs) > 0 ? RUN.ALIVE : RUN.ISSUED;
    await store.updateRange("runs", index + 2, [[
      run["Run ID"], run["Карточка"], run["Заголовок"], run["Слот"], run["Аккаунт"],
      run["Роль"], run["Agent URL"], status, run["Выдан"], at,
      waiting || run["Ожидание"], run["Попытка"], run["Маркер"], run["Ответ"],
    ]]);
    // Молчание дольше стража — это уже событие: по нему и строится окно пакета.
    // Каждый удар сюда писать нельзя: журнал превратится в шум и вытеснит
    // как раз те строки, которые нужны при разборе.
    const guardMs = Number((await loadSettings())["guard.busySilenceMs"]) || 120000;
    if (Number(silentMs) > guardMs) {
      await record({
        slot: slotId, tab, kind: "guard", level: "warn",
        text: `вкладка молчала ${Math.round(Number(silentMs) / 1000)} с и снова на связи`,
        runId, durationMs: Number(silentMs),
      });
    }
    return { ok: true, runId, at };
  }

  /**
   * `report`: разбор ответа агента.
   *
   * Именно здесь закрывается прежняя боль: если маркер называет чужой или
   * несуществующий run id, это не «ход потерян», а факт с объяснением —
   * какой run искали, какой нашли, чей он.
   */
  async function report({ slotId = "", tab = "", payload = {} } = {}) {
    const at = isoNow(now());
    const data = await loadAll();
    const runId = norm(payload.runId);
    const run = data.runs.find((item) => norm(item["Run ID"]) === runId) || null;
    const markerRunId = String(payload.markerRunId || "").trim();
    const markerCard = String(payload.markerCard || "").trim();
    const verdict = [];

    if (!run) verdict.push(`выдачи ${runId || "(пусто)"} нет`);
    if (markerRunId && norm(markerRunId) !== runId) {
      verdict.push(`маркер называет run ${markerRunId}, а выдача — ${runId}`);
    }

    if (run && !isLiveRun(run)) {
      // Повторная доставка того же ответа — не поломка, но и не новая работа.
      return {
        ok: false,
        duplicate: true,
        why: `выдача ${runId} уже ${run["Статус"]}: ответ пришёл повторно`,
      };
    }

    const markerVerdict = runIdVerdictLocal(data.runs, { runId: markerRunId || runId, card: markerCard });

    if (run) {
      const index = data.runs.indexOf(run);
      const nextStatus = payload.ok === false ? RUN.FAILED : RUN.SUBMITTED;
      await store.updateRange("runs", index + 2, [[
        run["Run ID"], run["Карточка"], run["Заголовок"], run["Слот"], run["Аккаунт"],
        run["Роль"], run["Agent URL"], nextStatus, run["Выдан"], at,
        run["Ожидание"], run["Попытка"], clip(payload.markerRaw || "", 500), clip(payload.answer || "", 4000),
      ]]);
    }

    // Принимаем только строго подтверждённое: выдача есть, она жива, агент не
    // сказал «не смог», и маркер указывает именно на неё. Всё остальное —
    // разбор, а не «наверное, сойдёт».
    const accepted = Boolean(run)
      && payload.ok !== false
      && markerVerdict.verdict === "ok"
      && (!markerRunId || norm(markerRunId) === runId)
      && verdict.length === 0;
    await record({
      slot: slotId, account: run?.["Аккаунт"] || "", tab, kind: "reply",
      level: accepted ? "info" : "error",
      text: accepted
        ? `ответ принят: ${run["Заголовок"] || run["Карточка"]}`
        : `ответ не принят: ${verdict.join("; ") || markerVerdict.text}`,
      card: run?.["Карточка"] || markerCard, runId,
      data: { markerRunId, markerCard, markerVerdict: markerVerdict.verdict, ok: payload.ok !== false },
    });

    if (!accepted) {
      // Разбор не начинается с нуля: пакет собирается здесь же, из журнала.
      const incident = buildIncidentPackage({
        incident: {
          kind: "ответ не принят", cls: "transport", slot: slotId,
          card: run?.["Карточка"] || markerCard, runId, expectedRunId: runId,
          reason: verdict.join("; ") || markerVerdict.text, atMs: Date.parse(at),
        },
        events: data.events, runs: data.runs, queue: data.queue, slots: data.slots,
        settings: data.settings, now: Date.parse(at),
      });
      return { ok: false, why: verdict.join("; ") || markerVerdict.text, incident, releasedSlot: slotId };
    }

    const released = releaseAndRequeue({
      runs: data.runs.map((item) => (norm(item["Run ID"]) === runId ? { ...item, "Статус": RUN.SUBMITTED } : item)),
      slotId, runId, status: RUN.SUBMITTED, at,
    });
    await record({
      slot: slotId, tab, kind: "state",
      text: released.freedSlot ? `слот ${slotId} свободен: ход возвращён Координатору` : "слот ещё занят другой выдачей",
      runId,
    });
    return { ok: true, runId, freedSlot: released.freedSlot, busySlots: released.busySlots };
  }

  /** `event`: любая запись журнала от вкладки или пульта. */
  async function event({ slotId = "", account = "", tab = "", kind = "state", level = "info", text = "", card = "", runId = "", durationMs = "", data = null } = {}) {
    const row = await record({ slot: slotId, account, tab, kind, level, text, card, runId, durationMs, data });
    return { ok: true, at: row["Время"] };
  }

  /** Шаг цикла: выдать столько работы, сколько нужно проекту. */
  async function step({ requested = null, origin = "pulse" } = {}) {
    const owner = `step:${origin}`;
    const lock = acquire(owner, 25000);
    if (!lock.ok) return { ok: false, why: lock.why };
    try {
      const data = await loadAll();
      if (data.settings["cycle.mode"] === "manual" && origin === "auto") {
        return idle("режим ручной: автоцикл выключен");
      }
      const limits = limitsFromEvents(data.events);
      const plan = planBatch({
        slots: data.slots, queue: data.queue, runs: data.runs,
        state: accountState(data.slots.map((slot) => slot.account), { limits, now: now() }),
        maxParallel: Number(data.settings["cycle.maxParallel"]) || 1,
        requested,
      });
      // Шаг не «советует», а выдаёт: иначе между планом и запросом вкладки
      // вклинилась бы вторая вкладка и получила ту же карточку.
      const issued = [];
      for (const item of plan.plans) {
        const fresh = await loadAll();
        const replan = planOne({
          slots: fresh.slots, queue: fresh.queue, runs: fresh.runs, roles: [],
          state: accountState(fresh.slots.map((slot) => slot.account), { limits, now: now() }),
          itemId: item.item["ID"],
        });
        if (!replan.ok) continue;
        const run = await issue({ plan: replan, slot: replan.slot, data: fresh, origin });
        issued.push({ itemId: replan.item["ID"], card: replan.item["Карточка"], slot: replan.slot.slotId, runId: run["Run ID"] });
      }

      memory.lastTick = now();
      memory.lastStep = { at: isoNow(now()), count: issued.length, why: plan.why };
      await record({ kind: "tick", text: `шаг: выдач ${issued.length} (${plan.why})`, data: { issued } });
      return {
        ok: true, planned: issued.length, why: plan.why, plans: issued, summary: data.settings,
      };
    } finally {
      release(owner);
    }
  }

  async function pause({ reason = "пауза пользователя" } = {}) {
    memory.paused = true;
    memory.pauseReason = reason;
    await record({ kind: "ui", text: `пауза: ${reason}` });
    return { ok: true, paused: true, reason };
  }

  async function resume() {
    memory.paused = false;
    memory.pauseReason = "";
    await record({ kind: "ui", text: "пауза снята" });
    return { ok: true, paused: false };
  }

  async function setMode({ mode = "manual" } = {}) {
    const next = mode === "auto" ? "auto" : "manual";
    await record({ kind: "ui", text: `режим цикла: ${next}` });
    return { ok: true, mode: next };
  }

  /**
   * Снимок для пульта: всё, что человек должен видеть на одном экране.
   * Один запрос вместо четырёх — иначе пульт мигает рассинхроном.
   */
  async function snapshot({ eventsLimit = 80 } = {}) {
    const data = await loadAll();
    const live = data.runs.filter(isLiveRun);
    const bySlot = new Map();
    for (const slot of data.slots) {
      bySlot.set(slot.slotId, { ...slot, runs: [], state: "свободен" });
    }
    for (const run of live) {
      const entry = bySlot.get(norm(run["Слот"]));
      if (entry) {
        entry.runs.push({ runId: run["Run ID"], card: run["Карточка"], title: run["Заголовок"], role: run["Роль"], at: run["Выдан"] });
        entry.state = "работает";
      }
    }
    return {
      at: isoNow(now()),
      mode: data.settings["cycle.mode"],
      paused: memory.paused,
      pauseReason: memory.pauseReason,
      lastStep: memory.lastStep,
      maxParallel: Number(data.settings["cycle.maxParallel"]) || 1,
      slots: [...bySlot.values()],
      queue: data.queue.filter((item) => ["waiting", "blocked", "leased"].includes(norm(item["Статус"]))),
      runs: live,
      events: data.events.slice(-eventsLimit).reverse(),
      counts: {
        waiting: data.queue.filter((item) => norm(item["Статус"]) === "waiting").length,
        inFlight: live.length,
        blocked: data.queue.filter((item) => norm(item["Статус"]) === "blocked").length,
        slots: data.slots.filter((slot) => slot.enabled).length,
      },
    };
  }

  /** Пакет инцидента по последней тревоге — то, что уходит Maintainer'у. */
  async function incidentPackage({ card = "", runId = "", slot = "", aroundMs = null } = {}) {
    const data = await loadAll();
    const at = aroundMs || now();
    return buildIncidentPackage({
      incident: { kind: "разбор по запросу", cls: "transport", slot, card, runId, atMs: at },
      events: incidentWindow(data.events, { around: at, windowMs: Number(data.settings["incident.windowMs"]) || 600000 }),
      runs: data.runs, queue: data.queue, slots: data.slots, settings: data.settings, now: at,
    });
  }

  /**
   * Мастер настройки: найти базы и записать ключи.
   *
   * Поиск отделён от записи намеренно: человек видит, что нашлось, до того как
   * это попадёт в книгу. Если ключ уже был, он не затирается пустотой.
   */
  async function setup({ projectName = "" } = {}) {
    const current = await loadSettings();
    let databases = [];
    let searchError = "";
    if (notionSearch) {
      try {
        databases = await notionSearch();
      } catch (error) {
        searchError = error.message;
      }
    }
    const plan = planSetup({ projectName: projectName || current["project.name"], settings: current, databases });
    const applied = plan.ok ? await applySetup({ store, plan, now }) : { ok: false, why: plan.why };
    const events = plan.steps.map((step) => `${step.ok ? "✓" : "✕"} ${step.key}: ${step.why}`);
    await record({
      kind: "ui", level: plan.ok ? "info" : "warn",
      text: `мастер настройки: ${plan.ok ? "готово" : "не всё найдено"}`,
      data: { events, searchError },
    });
    return {
      ok: applied.ok,
      why: applied.ok ? plan.why : (searchError ? `${plan.why}; поиск в Notion: ${searchError}` : plan.why),
      steps: plan.steps,
      written: applied.written || [],
      advancedLeftToDefaults: plan.advancedLeftToDefaults,
    };
  }

  /**
   * Поставить карточку в очередь.
   *
   * Слот можно не указывать: тогда его подберёт диспетчер по правилу. Указанный
   * слот — это обещание человека, что работа нужна именно там, и диспетчер его
   * не переписывает.
   */
  async function enqueue({ card = "", title = "", role = "", fn = "Executor", slotId = "", kind = "dispatch", note = "" } = {}) {
    const cardId = String(card || "").trim();
    if (!cardId) return { ok: false, why: "не указана карточка" };
    const data = await loadAll();
    const duplicate = data.queue.find(
      (item) => norm(item["Карточка"]) === norm(cardId) && ["waiting", "blocked", "leased"].includes(norm(item["Статус"])),
    );
    if (duplicate) {
      return { ok: false, why: `карточка ${cardId} уже в очереди (${duplicate["Статус"]}, строка ${duplicate["ID"]})` };
    }
    if (slotId && !slotById(data.slots, slotId)) {
      return { ok: false, why: `слота ${slotId} нет в таблице` };
    }
    const item = makeQueueItem({
      card: cardId, title: String(title || "").trim(), role: String(role || "").trim(),
      fn: String(fn || "Executor").trim(), slot: String(slotId || "").trim(), kind, note,
      at: isoNow(now()),
    });
    await store.append("queue", [queueToRow(item)]);
    await record({
      slot: item["Слот"], kind: "queue",
      text: `в очередь поставлено: ${item["Заголовок"] || cardId}${item["Роль"] ? ` (${item["Роль"]})` : ""}`,
      card: cardId,
    });
    return { ok: true, itemId: item["ID"], item };
  }

  /** Снять строку из очереди. Занятую строку снимать нельзя — сначала отчёт. */
  async function cancel({ itemId = "", reason = "снято человеком" } = {}) {
    const data = await loadAll();
    const index = data.queue.findIndex((item) => norm(item["ID"]) === norm(itemId));
    if (index < 0) return { ok: false, why: `строки ${itemId} нет` };
    const item = data.queue[index];
    if (norm(item["Статус"]) === QUEUE.LEASED) {
      return { ok: false, why: `строка ${itemId} уже в работе на слоте ${item["Взял слот"]}: сначала нужен отчёт вкладки` };
    }
    const next = { ...item, "Статус": QUEUE.CANCELLED, "Готово в": isoNow(now()), "Комментарий": reason };
    await store.updateRange("queue", index + 2, [queueToRow(next)]);
    await record({ kind: "queue", text: `снято из очереди: ${item["Карточка"]} — ${reason}`, card: item["Карточка"] });
    return { ok: true, itemId };
  }

  /** Обработка одного запроса протокола. Возвращает объект ответа. */
  async function handle(body) {
    const check = validateRequest(body);
    if (!check.ok) return { ok: false, why: check.why };
    switch (check.action) {
      case ACTIONS.HELLO: return hello(body);
      case ACTIONS.PULL: return pull(body);
      case ACTIONS.BEAT: return beat(body);
      case ACTIONS.REPORT: return report(body);
      case ACTIONS.EVENT: return event(body);
      case ACTIONS.BYE: {
        await record({ slot: body.slotId || "", tab: body.tab || "", kind: "state", text: "вкладка закрыта" });
        return { ok: true };
      }
      case CONTROL.STEP: return step({ requested: body.requested ?? null, origin: body.origin || "panel" });
      case CONTROL.PAUSE: return pause({ reason: body.reason });
      case CONTROL.RESUME: return resume();
      case CONTROL.MODE: return setMode({ mode: body.mode });
      case CONTROL.ENQUEUE: return enqueue(body);
      case CONTROL.CANCEL: return cancel(body);
      case CONTROL.SETUP: return setup(body);
      case CONTROL.INPUT:
        await record({ slot: body.slotId || "", tab: body.tab || "", kind: "ui", text: String(body.text || "действие в пульте"), data: body.data || null });
        return { ok: true };
      default: return { ok: false, why: `действие «${check.action}» пока не поддержано службой` };
    }
  }

  return {
    handle, hello, pull, beat, report, event, step, pause, resume, setMode,
    enqueue, cancel, setup, snapshot, incidentPackage, loadAll, record, memory,
  };
}

/**
 * Лимиты аккаунтов из журнала.
 *
 * Отметка лимита живёт в журнале, а не в отдельном листе: так её видно рядом с
 * тем, что происходило в этот момент. Срок хранится в поле «Данные» — это
 * единственное место, где помещается метка времени без новой колонки.
 */
function limitsFromEvents(events = []) {
  return events
    .filter((item) => item.kind === "accounts" && /лимит/i.test(item.text))
    .map((item) => ({ account: item.account, until: Number(item.data) || Date.parse(item.data) || 0 }));
}

/** Локальная проверка «чей run», чтобы не тянуть модуль инцидента в горячий путь. */
function runIdVerdictLocal(runs, { runId = "", card = "" } = {}) {
  const wanted = String(runId || "").trim();
  if (!wanted) return { verdict: "missing", text: "run id не назван" };
  const hit = runs.find((run) => norm(run["Run ID"]) === norm(wanted));
  if (!hit) return { verdict: "unknown", text: `run ${wanted} не найден` };
  if (card && norm(hit["Карточка"]) !== norm(card)) return { verdict: "foreign", text: `run ${wanted} от карточки ${hit["Карточка"]}`, run: hit };
  if (!isLiveRun(hit)) return { verdict: "closed", text: `run ${wanted} уже ${hit["Статус"]}`, run: hit };
  return { verdict: "ok", text: `run ${wanted} найден (слот ${hit["Слот"]})`, run: hit };
}

/** Пометка лимита для журнала: используется, когда вкладка увидела индикатор. */
export function limitEvent(mark) {
  return makeEvent({
    slot: mark.slot, account: mark.account, kind: "accounts", level: "warn",
    text: `аккаунт ${mark.account} в лимите до ${new Date(mark.until).toISOString()}`,
    data: mark.until,
  });
}

export { limitMark, makeRun, RUN };
