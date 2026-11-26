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
import { parseQueue, parseRuns, makeRun, queueToRow, RUN, isLiveRun, leaseItem, PROVISION_KIND } from "./queue.mjs";
import { planOne, planBatch, releaseAndRequeue } from "./dispatch.mjs";
import { accountState, slotGate, limitMark } from "./accounts.mjs";
import { parseEvents, makeEvent, incidentWindow } from "./events.mjs";
import { buildIncidentPackage } from "./incident.mjs";
import { parseSettings } from "./settings.mjs";
import { planSetup, applySetup } from "./setup.mjs";
import { searchDatabases, fetchRoles, notionTokenFrom } from "./notion-db.mjs";
import { ACTIONS, CONTROL, PROTOCOL_VERSION, validateRequest, idle, work } from "./protocol.mjs";
import { SHEETS } from "./schema.mjs";
import { isoNow, norm, clip } from "./util.mjs";
import { makeQueueItem, QUEUE } from "./queue.mjs";
import {
  parseInstances, instanceFor, instanceToRow, agentDecision, instanceKey,
  instancesOfSlot, AGENT_STATE,
} from "./agents.mjs";

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

/** Кеш справочника ролей: настройка, а не данные миссии. */
const ROLES_CACHE_MS = 60000;

/**
 * Сколько служба помнит, что задание на агента уже забрано.
 *
 * Секунды, не минуты: если вкладка упала между захватом и созданием, задание
 * должно вернуться в очередь само, без ручной чистки. Десяти секунд хватает,
 * чтобы отсечь одновременный опрос двух вкладок, и мало, чтобы держать работу
 * после падения.
 */
const PROVISION_CLAIM_MS = 10000;

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
  notionToken = "",
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

  /**
   * Лист «Экземпляры».
   *
   * Его может не быть: книга создана на прошлой версии, а лист появился в
   * 1.20.0. Отсутствие листа — не ошибка и не повод остановить цикл: старые
   * базы держат адрес в строке роли, и мы это поддерживаем. Поэтому ошибка
   * чтения здесь превращается в пустой список, а не в отказ.
   *
   * Молчать при этом нельзя: в журнале должно быть видно, что листа нет,
   * иначе «почему у меня не создаются агенты» будет выясняться наугад.
   */
  /**
   * Справочник ролей из Notion.
   *
   * Кеш на минуту: список ролей — настройка, а не данные миссии, и читать его
   * на каждый `pull` значило бы упереться в лимит Notion. Сбой чтения не
   * останавливает цикл: без справочника административность берётся из строки
   * очереди, где есть `Функция`, а экземпляры — из листа. Это грубее, но
   * лучше, чем отказ.
   */
  async function loadRoles() {
    const settings = memory.settingsCache || {};
    const dataSourceId = settings["notion.rolesDb"] || "";
    const token = notionToken || notionTokenFrom(process.env);
    if (!dataSourceId || !token) return memory.rolesCache || [];
    if (memory.rolesCache && now() - (memory.rolesAt || 0) < ROLES_CACHE_MS) return memory.rolesCache;
    try {
      const rows = await fetchRoles({ token, dataSourceId });
      memory.rolesCache = rows;
      memory.rolesAt = now();
      return rows;
    } catch (error) {
      log(`справочник ролей не прочитан: ${error.message}`);
      return memory.rolesCache || [];
    }
  }

  async function loadInstances() {
    try {
      const { rows } = await store.read("agents");
      memory.instancesMissing = "";
      return { rows, instances: parseInstances(rows) };
    } catch (error) {
      memory.instancesMissing = error.message;
      // 1.24.0: отсутствующий лист — не повод жить без адресов.
      //
      // Раньше книга, созданная до 1.20.0, отвечала ошибкой на чтение
      // «Экземпляров», служба молчала, и ленивое создание агентов не
      // замыкалось: вкладка создавала агента, а адрес некуда было записать.
      // Теперь лист создаётся тем же хранилищем (`ensureSheet`: шапка из
      // схемы, идемпотентно) и читается заново. Если создать не удалось —
      // остаётся прежнее поведение: пустой список и запись в журнал.
      try {
        const made = await store.ensureSheet("agents");
        if (made && made.created) {
          log(`лист «Экземпляры» создан: ${SHEETS.agents.columns.join(", ")}`);
        }
        const { rows } = await store.read("agents");
        memory.instancesMissing = "";
        return { rows, instances: parseInstances(rows) };
      } catch (again) {
        memory.instancesMissing = again.message;
        return { rows: [], instances: [] };
      }
    }
  }


  /**
   * Имена листов книги — для готовности и пульта.
   *
   * Ошибку не глотаем и не превращаем в пустой список: «листов нет» и «книгу не
   * прочитали» требуют разного поведения, и второе — это уже отказ доступа.
   */
  async function sheetTitles() {
    const meta = await store.meta();
    const list = Array.isArray(meta?.sheets) ? meta.sheets : [];
    return list.map((sheet) => String(sheet?.properties?.title || sheet?.title || "")).filter(Boolean);
  }

  async function loadAll() {
    const [slots, queueSheet, runsSheet, eventsSheet, settings, agentsSheet] = await Promise.all([
      loadSlots(),
      store.read("queue"),
      store.read("runs"),
      store.read("events"),
      loadSettings(),
      loadInstances(),
    ]);
    return {
      slots,
      queue: parseQueue(queueSheet.rows),
      runs: parseRuns(runsSheet.rows),
      events: parseEvents(eventsSheet.rows),
      settings,
      instances: agentsSheet.instances,
      agentsRows: agentsSheet.rows,
      roles: memory.rolesCache || [],
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
   * Задание на создание агента: пара (роль, слот) → строка очереди `provision`.
   *
   * Почему отдельная строка очереди, а не сразу выдача карточки. Служба не
   * умеет открывать вкладку — создаёт агента та вкладка, которая живёт в этом
   * контейнере. Значит нужен объект, который вкладка заберёт своим `pull`.
   * Строка очереди для этого уже есть: у неё тот же захват, тот же журнал и та
   * же защита от двойной выдачи. Отдельная таблица заданий завела бы вторую
   * реализацию «кто взял», и они бы разошлись.
   *
   * Задание попадает только в тот слот, для которого агента нет. Второй раз
   * не просим, пока первый не закончился: `создаётся` — это уже обязательство.
   */
  async function requestAgent({ role, slot, data, reason = "" }) {
    const instance = instanceFor(data.instances, role, slot.slotId);
    if (instance && norm(instance.state) === AGENT_STATE.CREATING) {
      return { ok: false, why: `агент ${role} в ${slot.slotId} уже создаётся`, instance };
    }
    // Открытое задание на эту пару — второе не нужно.
    //
    // Открытое, а не только `waiting`: взятое (`leased`) задание — это уже
    // создание в работе. Вторая вкладка того же слота читала лист, видела
    // `leased` как «не ждущее», заводила второе задание и тоже его забирала.
    // Вкладок у слота бывает две (после перезагрузки, дубль окна), и каждая
    // создавала своего агента — второго потом некуда девать.
    const pending = data.queue.find((item) =>
      norm(item["Вид"]) === PROVISION_KIND &&
      norm(item["Роль"]) === norm(role) &&
      norm(item["Слот"]) === norm(slot.slotId) &&
      [QUEUE.WAITING, QUEUE.LEASED].includes(norm(item["Статус"])));
    if (pending) return { ok: false, why: `задание на агента ${role} в ${slot.slotId} уже в очереди`, pending };

    const item = makeQueueItem({
      card: "", title: `Создать агента: ${role}`, role, fn: "",
      slot: slot.slotId, kind: "provision",
      note: reason || `агента ${role} в ${slot.slotId} ещё нет`,
    });
    await store.append("queue", [queueToRow(item)]);
    await record({
      slot: slot.slotId, account: slot.account, kind: "provision", level: "info",
      text: `нужен агент ${role} в ${slot.slotId}: ${reason || "пары нет в «Экземплярах»"}`,
      data: { role, slot: slot.slotId, queueId: item["ID"] },
    });
    return { ok: true, item };
  }

  /** Предел выдач на одну роль: настройка, по умолчанию одна. */
  const maxPerRole = (settings) => {
    const value = Number(settings?.["cycle.maxPerRole"]);
    return Number.isFinite(value) && value >= 1 ? Math.floor(value) : 1;
  };

  /**
   * Забрать задание на агента, если этому слоту оно адресовано.
   *
   * Захват тот же, что у обычной выдачи: строка помечается `leased` и получает
   * «Взял слот». Без этого две вкладки одного слота (после перезагрузки)
   * создали бы двух агентов на одну пару — и один из них остался бы сиротой,
   * потому что в «Экземплярах» хранится один адрес.
   */
  async function takeProvision(slot, data, tab) {
    const item = data.queue.find((row) =>
      norm(row["Вид"]) === PROVISION_KIND &&
      norm(row["Статус"]) === QUEUE.WAITING &&
      norm(row["Слот"]) === norm(slot.slotId));
    if (!item) return null;

    // Захват в памяти до записи в таблицу.
    //
    // Без него две вкладки одного слота (вторая — после перезагрузки или дубль
    // окна) обе читают одну строку, обе видят `waiting`, обе создают агента.
    // Второго агента потом некуда девать: в «Экземплярах» один адрес на пару.
    // Google Sheets не умеет атомарного сравнения-и-записи, поэтому защита
    // живёт здесь: ключ — номер строки, срок короткий, чтобы упавшая вкладка
    // не держала задание вечно.
    const key = `provision:${item["ID"]}`;
    const nowMs = now();
    const held = memory.provisionClaims instanceof Map ? memory.provisionClaims : new Map();
    memory.provisionClaims = held;
    const takenUntil = held.get(key) || 0;
    if (takenUntil > nowMs) return null;
    held.set(key, nowMs + PROVISION_CLAIM_MS);

    const leased = leaseItem(item, { slotId: slot.slotId });
    if (!leased.ok) return null;
    const rowIndex = data.queue.findIndex((row) => norm(row["ID"]) === norm(item["ID"]));
    if (rowIndex >= 0) {
      await store.updateRange("queue", rowIndex + 2, [queueToRow({ ...leased.item, "Статус": QUEUE.LEASED })]);
    }
    await record({
      slot: slot.slotId, account: slot.account, tab, kind: "provision",
      text: `вкладка ${tab || "?"} взяла задание: создать агента ${item["Роль"]} в ${slot.slotId}`,
      data: { queueId: item["ID"], role: item["Роль"] },
    });
    // Ответ того же вида, что и обычная работа: `ok: true`, `work: null`.
    // `kind` отличает задание от выдачи карточки, чтобы вкладка знала, что
    // делать: создать агента, а не выполнять работу по миссии.
    // Причина из строки задания важна вкладке: «агента ещё нет» и «прошлая
    // попытка не удалась: не хватило квоты» требуют разного поведения.
    const reason = String(item["Комментарий"] || "").trim();
    return {
      ...idle(`создай агента роли «${item["Роль"]}» в контейнере ${slot.container || slot.slotId} и сообщи адрес${reason ? ` (${reason})` : ""}`),
      kind: "provision",
      queueId: item["ID"],
      role: item["Роль"],
      slot: slot.slotId,
    };
  }

  /**
   * `agent`: вкладка сообщает адрес созданного агента.
   *
   * Без этого входа цикл ленивого создания не замыкается: служба выдаёт
   * задание «создай агента», вкладка его создаёт — и адресу некуда деться.
   * В «Экземплярах» не появляется строка, пара (роль, слот) навсегда остаётся
   * «нет агента», и каждая следующая карточка этой роли снова требует
   * создания. Ровно та петля, из-за которой создание агентов кажется вечным.
   *
   * Пишем строку по паре, а не по номеру: вкладка могла не знать номера, а
   * пара (роль, слот) — единственный ключ, который у неё есть и который
   * совпадает с ключом в листе.
   */
  async function agentReady({ role = "", slotId = "", url = "", tab = "", note = "", failed = false } = {}) {
    const name = String(role).trim();
    const target = String(slotId).trim();
    const address = String(url).trim();
    if (!name || !target) return { ok: false, why: "нужны роль и слот: без пары адрес некуда записать" };
    if (!failed && !address) return { ok: false, why: "адрес пуст: созданный агент без адреса не считается готовым" };

    const data = await loadAll();
    const slot = slotById(data.slots, target);
    if (!slot) return { ok: false, why: `слота ${target} нет в таблице` };

    const at = isoNow(now());
    const existing = instanceFor(data.instances, name, target);
    const row = instanceToRow({
      role: name,
      slot: target,
      url: failed ? (existing?.url || "") : address,
      state: failed ? AGENT_STATE.BROKEN : AGENT_STATE.CREATED,
      createdAt: existing?.createdAt || at,
      jobId: existing?.jobId || "",
      lastSeen: at,
      note: note || (failed ? "вкладка сообщила: создать не удалось" : ""),
    });

    // Строка уже была — переписываем её, а не заводим вторую: две строки на
    // одну пару означают, что `agentDecision` найдёт первую и будет права
    // ровно наполовину.
    const rows = data.agentsRows || [];
    const index = rows.findIndex((raw) => {
      const found = parseInstances([raw])[0];
      return found && found.key === instanceKey(name, target);
    });
    if (index >= 0) {
      await store.updateRange("agents", index + 2, [row]);
    } else {
      await store.append("agents", [row]);
    }

    // Задание закрывается здесь же: вкладка создала агента, и строка очереди
    // в состоянии «взято» больше никому не нужна. Иначе следующая вкладка
    // этого слота получит то же задание повторно.
    const taskIndex = data.queue.findIndex((item) =>
      norm(item["Вид"]) === PROVISION_KIND &&
      norm(item["Роль"]) === norm(name) &&
      norm(item["Слот"]) === norm(target) &&
      norm(item["Статус"]) !== QUEUE.CANCELLED);
    if (taskIndex >= 0) {
      const item = data.queue[taskIndex];
      await store.updateRange("queue", taskIndex + 2, [queueToRow({
        ...item,
        "Статус": failed ? QUEUE.BLOCKED : QUEUE.DONE,
        "Готово в": at,
        "Комментарий": failed ? (note || "создать не удалось") : "агент создан",
      })]);
    }

    await record({
      slot: target, account: slot.account, tab, kind: "provision",
      level: failed ? "error" : "info",
      text: failed
        ? `агент ${name} в ${target} не создан: ${note || "причина не названа"}`
        : `агент ${name} в ${target} готов: ${address}`,
      data: { role: name, slot: target, url: address },
    });

    return { ok: true, role: name, slot: target, url: address, state: failed ? AGENT_STATE.BROKEN : AGENT_STATE.CREATED };
  }

  /**
   * Выдать план: создать выдачу, пометить строку занятой, записать в журнал.
   *
   * Одна функция на два входа — «шаг» человека и прямой запрос вкладки.
   * Иначе появились бы две реализации выдачи, и они разошлись бы в том, когда
   * строка считается занятой; цена расхождения — двойная выдача карточки.
   */
  async function issue({ plan, slot, data, tab = "", origin = "pull", agentUrl = "" }) {
    const run = makeRun({
      card: plan.item["Карточка"], title: plan.item["Заголовок"], slot: slot.slotId,
      account: slot.account, role: plan.item["Роль"], agentUrl: agentUrl || plan.role?.url || "",
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

    // План строится для ЭТОГО слота: вкладка спрашивает работу для своего
    // контейнера, и агента мы создаём тоже здесь. Без `slotId` план выбирал
    // первый свободный слот, и задание на агента заводилось не тому слоту,
    // который спрашивал, — то есть агент появлялся в контейнере, где работы
    // для него может не быть вовсе.
    const plan = planOne({
      slots: data.slots, queue: data.queue, runs: data.runs, roles: await loadRoles(),
      state: accountState(data.slots.map((item) => item.account), { now: now() }),
      maxPerRole: maxPerRole(data.settings),
      slotId,
    });

    // Задание на создание агента в этом слоте отдаётся раньше плана: пока
    // агента нет, карточке некуда ехать, и вкладка должна получить именно
    // задание, а не «свободных слотов нет».
    const provision = await takeProvision(slot, data, tab);
    if (provision) return provision;

    if (!plan.ok) return idle(plan.why);

    // Захват строки обязан попасть в таблицу, иначе следующая вкладка увидит
    // её свободной и выдаст ту же карточку второй раз.
    // Адрес берётся из экземпляра пары (роль, слот), а не из строки роли.
    //
    // Раньше здесь стоял `plan.role?.url`, но `roles: []` в плане выше — роль
    // по имени не находится никогда, и адрес всегда был пустым. Ошибка была
    // тихой: выдача приходила, агент получал задание без адреса и ждал.
    const decision = agentDecision({
      role: plan.item["Роль"],
      slot: slot.slotId,
      instances: data.instances || [],
      legacyUrl: plan.role?.url || "",
    });
    if (decision.action === "wait") return idle(decision.why);
    if (decision.action === "create") {
      // Агента нет — ставим задание создать его и сразу отдаём это задание
      // той же вкладке. Возвращать «жди» нельзя: вкладка, которая сама может
      // создать агента, стояла бы в ожидании собственной работы, и первый
      // `pull` нового контейнера всегда был бы пустым.
      const requested = await requestAgent({ role: plan.item["Роль"], slot, data, reason: decision.why });
      const task = requested.ok || requested.pending
        ? await takeProvision(slot, await loadAll(), tab)
        : null;
      if (task) return task;
      return idle(`агента «${plan.item["Роль"]}» в ${slot.slotId} готовит другая вкладка этого слота`);
    }

    const run = await issue({ plan, slot, data, tab, origin: "pull", agentUrl: decision.url });
    return work({
      runId: run["Run ID"], card: plan.item["Карточка"], title: plan.item["Заголовок"],
      role: plan.item["Роль"], agentUrl: decision.url, attempt: "1", why: plan.why,
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
    // «Последняя жизнь» экземпляра — не украшение.
    //
    // В схеме листа эта колонка есть, но до 1.24.0 её никто не обновлял: она
    // означала «когда создан». Теперь `beat` продлевает и её, поэтому по книге
    // видно, какой агент пары (роль, слот) ещё открыт, а какой умер вместе со
    // своим контейнером. Без этого приходилось открывать три вкладки глазами.
    try {
      const mine = (data.instances || []).find((item) =>
        norm(item.slot) === norm(run["Слот"]) && norm(item.role) === norm(run["Роль"]));
      if (mine) {
        const rows = data.agentsRows || [];
        const at2 = rows.findIndex((raw) => {
          const found = parseInstances([raw])[0];
          return found && found.key === mine.key;
        });
        if (at2 >= 0) {
          await store.updateRange("agents", at2 + 2, [instanceToRow({ ...mine, lastSeen: at })]);
        }
      }
    } catch (error) {
      // Лист «Экземпляры» может быть недоступен — удар сердца от этого не
      // перестаёт быть ударом сердца.
      log(`«Последняя жизнь» экземпляра не обновлена: ${error.message}`);
    }
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
      //
      // И проверяет агента — так же, как `pull`. Раньше шаг этого не делал:
      // кнопка пульта выдавала карточку с пустым адресом, задания на создание
      // агента не появлялось, и вкладка получала работу, которую некому
      // исполнить. Владелец жмёт «шаг» — значит этот путь обязан работать
      // не хуже, чем прямой запрос вкладки.
      const issued = [];
      const agentRequests = [];
      const roles = await loadRoles();
      for (const item of plan.plans) {
        const fresh = await loadAll();
        const replan = planOne({
          slots: fresh.slots, queue: fresh.queue, runs: fresh.runs, roles,
          state: accountState(fresh.slots.map((slot) => slot.account), { limits, now: now() }),
          itemId: item.item["ID"],
        });
        if (!replan.ok) continue;
        const decision = agentDecision({
          role: replan.item["Роль"],
          slot: replan.slot.slotId,
          instances: fresh.instances || [],
          legacyUrl: replan.role?.url || "",
        });
        if (decision.action === "wait") continue;
        if (decision.action === "create") {
          const asked = await requestAgent({ role: replan.item["Роль"], slot: replan.slot, data: fresh, reason: decision.why });
          if (asked.ok) agentRequests.push({ role: replan.item["Роль"], slot: replan.slot.slotId });
          continue;
        }
        const run = await issue({ plan: replan, slot: replan.slot, data: fresh, origin, agentUrl: decision.url });
        issued.push({ itemId: replan.item["ID"], card: replan.item["Карточка"], slot: replan.slot.slotId, runId: run["Run ID"] });
      }

      memory.lastTick = now();
      memory.lastStep = { at: isoNow(now()), count: issued.length, why: plan.why };
      await record({
        kind: "tick",
        text: `шаг: выдач ${issued.length}${agentRequests.length ? `, заданий на агента ${agentRequests.length}` : ""} (${plan.why})`,
        data: { issued, requested: agentRequests },
      });
      return {
        ok: true, planned: issued.length, requested: agentRequests.length,
        why: plan.why, plans: issued, agentRequests, summary: data.settings,
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
      // Демо-режим — не «ещё одно поле», а ответ на вопрос, который человек
      // задаёт первым: «почему здесь не мои данные». Служба без книги живёт в
      // памяти, и снаружи это отличимо только так: слоты, журнал и мастер при
      // этом выглядят настоящими.
      demo: Boolean(store.demo),
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
    const plan = planSetup({
      projectName: projectName || current["project.name"],
      settings: current,
      databases,
      demo: Boolean(store.demo),
    });
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
      case ACTIONS.AGENT: return agentReady({
        role: body.role, slotId: body.slotId || body.slot, url: body.url,
        tab: body.tab, note: body.note, failed: body.ok === false,
      });
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
    handle, hello, pull, beat, report, event, step, pause, resume, setMode, agentReady,
    enqueue, cancel, setup, snapshot, incidentPackage, loadAll, record, memory, sheetTitles,
    // Только для тестов: эти функции не входят в протокол и не должны
    // вызываться из вкладки. Отдельным объектом, чтобы «наружу» случайно не
    // уехал лишний вход.
    __test: { requestAgent, takeProvision, loadInstances, maxPerRole, sheetTitles },
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
