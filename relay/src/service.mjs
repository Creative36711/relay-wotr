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
import { parseSettings, SETTINGS, coerceSetting } from "./settings.mjs";
import { parseTurnMarker } from "./markers.mjs";
import { planSetup, applySetup } from "./setup.mjs";
import { searchDatabases, fetchRoles, notionTokenFrom, pingNotion, describeNonJson } from "./notion-db.mjs";
import { ACTIONS, CONTROL, PROTOCOL_VERSION, validateRequest, idle, work } from "./protocol.mjs";
import { SHEETS, rowToObject } from "./schema.mjs";
import { isoNow, norm, clip } from "./util.mjs";
import { makeQueueItem, newQueueId, QUEUE } from "./queue.mjs";
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
    // Настройки кешируются на время шага: их читает и справочник ролей, и
    // пределы, и пульт. Без кеша `loadRoles` видел пустой объект — и
    // справочник не читался никогда, даже когда токен и ID были на месте.
    settingsCache: null,
    settingsAt: 0,
    // Токен Notion, введённый в пульте. Пусто — берётся из окружения.
    notionToken: "",
    clients: new Map(), // ScriptCat tab heartbeat and local hold state
    slotMismatches: new Map(), // rate limit incorrect Firefox container/account bindings
    coordinatorTurnRequest: null, // one panel Step waiting for the admin Arena tab
    projectApprovalRequests: new Map(), // explicit pult request; ScriptCat validates locally before granting
  };
}

const SLOT_CACHE_MS = 30000;

/** Кеш справочника ролей: настройка, а не данные миссии. */
const ROLES_CACHE_MS = 60000;
const SUPPORTED_SCRIPT_VERSION = "1.34.1";
const TURN_REQUEST_TTL_MS = 15 * 60_000;
const TURN_REQUEST_CLAIM_MS = 30_000;
const CLIENT_ACTIVE_MS = 3 * 60_000;

function versionAtLeast(actual, minimum) {
  const parse = (value) => {
    const hit = String(value || "").trim().match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
    return hit ? hit.slice(1).map(Number) : null;
  };
  const a = parse(actual);
  const b = parse(minimum);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i += 1) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return true;
}

/**
 * Кеш настроек.
 *
 * Короткий, потому что мастер настройки пишет в тот же лист: если держать
 * минуту, только что найденный ID роли не подхватился бы, и «применил, а всё
 * равно ✕» выглядело бы как поломка.
 */
const SETTINGS_CACHE_MS = 3000;

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
  // Сеть для проверки токена из пульта. Параметром, а не глобальным fetch:
  // тест «токен принят» не должен ходить в настоящий Notion.
  notionFetch = globalThis.fetch,
  // Куда положить принятый токен, чтобы перезапуск не требовал ввода снова.
  // Пусто — токен живёт только в памяти (поведение прежних версий).
  saveNotionToken = null,
  // Рабочие чтения из Notion (поиск баз, справочник ролей): если задан, идут
  // через него — обычно это fetch с мостом (см. createNotionFetch). Проверка
  // сети (`notionNet`) этим параметром не пользуется: она меряет прямой путь.
  notionDataFetch = null,
  now = () => Date.now(),
  memory = createMemoryState(),
  slotsCacheMs = SLOT_CACHE_MS,
  log = () => {},
} = {}) {
  if (!store) throw new Error("служба без хранилища не работает");

  let autoRunnerTimer = null;
  let autoRunnerBusy = false;

  async function loadSlots(force = false) {
    if (!force && memory.slotsCache && now() - memory.slotsAt < slotsCacheMs) return memory.slotsCache;
    const { rows } = await store.read("slots");
    memory.slotsCache = parseSlots(rows);
    memory.slotsAt = now();
    return memory.slotsCache;
  }

  async function loadSettings(force = false) {
    if (!force && memory.settingsCache && now() - (memory.settingsAt || 0) < SETTINGS_CACHE_MS) {
      return memory.settingsCache;
    }
    const { rows } = await store.read("settings");
    const values = parseSettings(rows);
    // Настройка таймаута должна действительно управлять Apps Script bridge.
    // Раньше книга могла содержать 45000 мс, но адаптер молча обрывал запросы
    // на фиксированных 20000 мс — ровно ошибка, которую видел владелец.
    if (typeof store.setTimeoutMs === "function") store.setTimeoutMs(values["net.gmTimeoutMs"]);
    memory.settingsCache = values;
    memory.settingsAt = now();
    return values;
  }

  /**
   * Запись одной настройки: лист «Настройки», строка по ключу.
   *
   * Нужна ходу цикла (D-025): `cycle.turn`/`cycle.round` — состояние, которое
   * обязано пережить перезапуск, но читается так же, как обычная настройка.
   * Кэш сбрасывается сразу: следующий шаг обязан видеть свежий ход.
   */
  async function writeSetting(key, value) {
    const spec = SETTINGS[key];
    const coerced = spec ? coerceSetting(key, value) : String(value ?? "").trim();
    const { rows } = await store.read("settings");
    const index = rows.findIndex((row) => String(row?.[0] ?? "").trim() === key);
    const cells = [key, String(coerced), spec?.type || "text", spec?.group || "basic", String(spec?.default ?? ""), spec?.description || ""];
    if (index >= 0) await store.updateRange("settings", index + 2, [cells]);
    else await store.append("settings", [cells]);
    memory.settingsCache = null;
    return String(coerced);
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
    // Книга — источник по умолчанию: она читается всегда, а Notion может быть
    // недоступен (фильтр, VPN, нет токена). Раньше отсутствие Notion делало
    // роли пустыми, и цикл выглядел сломанным при живой книге.
    const fromBook = await rolesFromBook();
    if (fromBook.length) return fromBook;

    // Notion — обогащение: он знает репозиторий и готовность роли. Падение
    // Notion здесь не отказ: берём то, что уже прочитали.
    const settings = await loadSettings();
    const dataSourceId = settings["notion.rolesDb"] || "";
    const token = notionTokenNow();
    if (!dataSourceId || !token) return memory.rolesCache || [];
    if (memory.rolesCache && now() - (memory.rolesAt || 0) < ROLES_CACHE_MS) return memory.rolesCache;
    try {
      const rows = await fetchRoles({ token, dataSourceId, fetchImpl: notionDataFetch || notionFetch });
      memory.rolesCache = rows;
      memory.rolesAt = now();
      return rows;
    } catch (error) {
      // Тихая деградация опасна: без записи в журнал «почему роль без
      // репозитория» выясняется наугад.
      log(`справочник ролей из Notion не прочитан: ${error.message}`);
      memory.rolesNotionError = error.message;
      return memory.rolesCache || [];
    }
  }

  /** Роли из листа «Роли». Пустой лист — это «нет ролей», а не ошибка. */
  async function rolesFromBook() {
    let rows = [];
    try {
      rows = (await store.read("roles")).rows;
    } catch (error) {
      // Листа может не быть в книге прошлой версии: создаём сами, как и
      // «Экземпляры». Если не вышло — не падаем, идём в Notion.
      try {
        await store.ensureSheet("roles");
        rows = (await store.read("roles")).rows;
      } catch {
        return [];
      }
    }
    const out = [];
    for (const raw of rows) {
      const row = rowToObject("roles", raw);
      const name = String(row["Роль"] || "").trim();
      if (!name) continue;
      out.push({
        pageId: "",
        name,
        fn: String(row["Функция"] || "").trim(),
        status: String(row["Статус"] || "").trim(),
        url: String(row["Agent URL"] || "").trim(),
        repo: String(row["Репозиторий"] || "").trim(),
        agentAdmin: false,
        agentState: "не требуется",
        source: "book",
      });
    }
    return out;
  }

  /**
   * Действующий токен Notion.
   *
   * Порядок: введённый в пульте → переданный при сборке службы → окружение.
   * Пульта нет в этом списке случайно: владелец получает токен в Notion и не
   * должен ради него перезапускать транспорт с переменной в командной строке.
   */
  const notionTokenNow = () => memory.notionToken || notionToken || notionTokenFrom(process.env);

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
  async function agentReady({ role = "", slotId = "", url = "", tab = "", note = "", failed = false, queueId = "" } = {}) {
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
    // Закрываем именно активное задание, предпочтительно по выданному queueId.
    // Старые завершённые строки той же пары остаются в книге; выбирать первую
    // по роли/слоту означало бы повторно закрыть историю и оставить новую строку
    // leased навсегда.
    const taskIndex = data.queue.findIndex((item) => {
      const active = [QUEUE.WAITING, QUEUE.LEASED].includes(norm(item["Статус"]));
      const matchesPair = norm(item["Вид"]) === PROVISION_KIND &&
        norm(item["Роль"]) === norm(name) && norm(item["Слот"]) === norm(target);
      return active && matchesPair && (!queueId || norm(item["ID"]) === norm(queueId));
    });
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

  function rememberClient({ slotId = "", tab = "", scriptVersion = "", localPaused = false, localPauseReason = "", localBusy = false, localWaiting = "", projectId = "", projectName = "", projectApproved, projectBlockReason = "", projectApprovalFailure, source = "hello" } = {}) {
    if (!slotId || !tab) return;
    const clients = memory.clients instanceof Map ? memory.clients : new Map();
    memory.clients = clients;
    const nowMs = now();
    for (const [key, client] of clients) {
      if (nowMs - Number(client.seenAt || 0) > CLIENT_ACTIVE_MS * 3) clients.delete(key);
    }
    const key = `${slotId}:${tab}`;
    const version = String(scriptVersion || "").trim();
    const paused = Boolean(localPaused);
    const previous = clients.get(key) || {};
    const changed = !previous.slotId || previous.scriptVersion !== version || previous.localPaused !== paused ||
      (typeof projectApproved === "boolean" && (
        previous.projectApproved !== projectApproved || previous.projectId !== String(projectId || "") ||
        previous.projectName !== String(projectName || "") || previous.projectBlockReason !== String(projectBlockReason || "") ||
        (typeof projectApprovalFailure === "string" && previous.projectApprovalFailure !== projectApprovalFailure)
      ));
    const next = {
      ...previous, slotId, tab, scriptVersion: version, localPaused: paused,
      localPauseReason: paused ? String(localPauseReason || previous.localPauseReason || "").replace(/\s+/g, " ").slice(0, 160) : "",
      localBusy: Boolean(localBusy), localWaiting: String(localWaiting || "").slice(0, 120), seenAt: nowMs,
      projectId: String(projectId || previous.projectId || "").slice(0, 120),
      projectName: String(projectName || previous.projectName || "").slice(0, 120),
      projectApproved: typeof projectApproved === "boolean" ? projectApproved : (previous.projectApproved ?? null),
      projectBlockReason: typeof projectApproved === "boolean"
        ? (projectApproved ? "" : String(projectBlockReason || previous.projectBlockReason || "unapproved").slice(0, 240))
        : String(projectBlockReason || previous.projectBlockReason || "").slice(0, 240),
      ...(typeof projectApprovalFailure === "string"
        ? { projectApprovalFailure: projectApprovalFailure.replace(/\s+/g, " ").slice(0, 280) }
        : projectApproved === true ? { projectApprovalFailure: "" } : {}),
    };
    if (source === "hello") next.lastHelloAt = nowMs;
    if (source === "pull") next.lastPullAt = nowMs;
    if (source === "beat") next.lastBeatAt = nowMs;
    clients.set(key, next);
    return changed;
  }

  function clearCoordinatorTurnRequest() {
    memory.coordinatorTurnRequest = null;
  }

  /**
   * `hello`: вкладка называет себя.
   *
   * Опознание по аккаунту: вкладка читает почту из подписи Arena и говорит её
   * службе. Слот ищется по аккаунту, а не по имени контейнера, — переименование
   * контейнера не должно ломать транспорт. Неизвестный аккаунт — честный
   * отказ с подсказкой, какой слот добавить.
   */
  async function hello({ account = "", tab = "", path = "", scriptVersion = "", localPaused = false, localPauseReason = "", localBusy = false, localWaiting = "", expectedSlot = "", projectId = "", projectName = "", projectApproved, projectBlockReason = "", projectApprovalFailure } = {}) {
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
    const expected = String(expectedSlot || "").trim();
    if (expected && expected !== slot.slotId) {
      const text = `менеджер открыл контейнер для слота ${expected}, но аккаунт в Arena опознан как ${slot.slotId}; работа заблокирована`;
      const key = `${tab}:${expected}:${slot.slotId}`;
      const mismatches = memory.slotMismatches instanceof Map ? memory.slotMismatches : new Map();
      memory.slotMismatches = mismatches;
      if (now() - Number(mismatches.get(key) || 0) >= 60000) {
        mismatches.set(key, now());
        await record({ slot: slot.slotId, account, tab, kind: "accounts", level: "error", text, data: { expectedSlot: expected, actualSlot: slot.slotId, path } });
      }
      return { ok: false, why: text, expectedSlot: expected, actualSlot: slot.slotId };
    }
    if (memory.slotMismatches instanceof Map) {
      for (const key of memory.slotMismatches.keys()) if (key.startsWith(`${tab}:`)) memory.slotMismatches.delete(key);
    }
    const clientChanged = rememberClient({
      slotId: slot.slotId, tab, scriptVersion, localPaused, localPauseReason, localBusy, localWaiting,
      projectId, projectName, projectApproved, projectBlockReason, projectApprovalFailure, source: "hello",
    });
    if (clientChanged) {
      const projectStatus = typeof projectApproved === "boolean"
        ? projectApproved
          ? `; профиль «${projectName || projectId || "проекта"}» допущен`
          : `; профиль «${projectName || projectId || "проекта"}» заблокирован (${projectBlockReason || "причина не передана"})`
        : "";
      await record({
        slot: slot.slotId, account, tab, kind: "state",
        level: projectApproved === false ? "warn" : "info",
        text: `вкладка ${tab || "?"} опознана как слот ${slot.slotId} (${slot.admin ? "административный" : "рабочий"})${projectStatus}`,
        data: {
          path, scriptVersion: String(scriptVersion || ""), localPaused: Boolean(localPaused),
          localPauseReason: localPaused ? String(localPauseReason || "").replace(/\s+/g, " ").slice(0, 160) : "",
          ...(typeof projectApproved === "boolean" ? {
            projectId: String(projectId || "").slice(0, 120),
            projectName: String(projectName || "").slice(0, 120),
            projectApproved,
            projectBlockReason: String(projectBlockReason || "").slice(0, 240),
          } : {}),
        },
      });
    }
    const approvalKey = String(projectId || "").toLowerCase();
    let approval = approvalKey && memory.projectApprovalRequests instanceof Map
      ? memory.projectApprovalRequests.get(approvalKey)
      : null;
    if (projectApproved === true && approval) {
      memory.projectApprovalRequests.delete(approvalKey);
      approval = null;
    }
    const projectApprovalRequest = approval && now() - approval.at <= 5 * 60_000
      ? { id: approval.id, projectId: String(projectId), requestedAt: isoNow(now()) }
      : null;
    if (approval && !projectApprovalRequest) memory.projectApprovalRequests.delete(approvalKey);
    return {
      ok: true,
      slot: { slotId: slot.slotId, admin: slot.admin, container: slot.container, account: slot.account },
      protocol: PROTOCOL_VERSION,
      requiredScriptVersion: SUPPORTED_SCRIPT_VERSION,
      ...(projectApprovalRequest ? { projectApprovalRequest } : {}),
    };
  }

  /** Ask the matching live admin tab to run the existing read-only project checks. */
  async function requestProjectApproval({ projectId = "" } = {}) {
    const id = String(projectId || "").trim().toLowerCase();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
      return { ok: false, why: "Не удалось проверить ID профиля из вкладки." };
    const slots = await loadSlots();
    const admins = new Set(slots.filter((item) => item.admin).map((item) => norm(item.slotId)));
    const client = [...memory.clients.values()].find((item) => admins.has(norm(item.slotId)) &&
      String(item.projectId || "").toLowerCase() === id && item.projectApproved === false &&
      item.projectBlockReason === "unapproved" && now() - Number(item.seenAt || 0) <= CLIENT_ACTIVE_MS);
    if (!client) return { ok: false, why: "Живая админ-вкладка с этим профилем не найдена или причина блокировки другая. Обновите пульт; профиль, очередь и ожидания не изменены." };
    if (!versionAtLeast(client.scriptVersion, SUPPORTED_SCRIPT_VERSION))
      return { ok: false, why: `Для проверки и работы нужен ScriptCat ${SUPPORTED_SCRIPT_VERSION} или новее; сейчас ${client.scriptVersion || "версия неизвестна"}. Обновите запись ScriptCat и вкладку.` };
    const requestId = `approval-${now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    if (!(memory.projectApprovalRequests instanceof Map)) memory.projectApprovalRequests = new Map();
    memory.projectApprovalRequests.set(id, { id: requestId, at: now() });
    await record({ slot: client.slotId, tab: client.tab, kind: "ui", level: "warn",
      text: `пульт запросил проверку и допуск профиля «${client.projectName || id}»`,
      data: { projectId: id, requestId } });
    return { ok: true, projectId: id, projectName: client.projectName || id, requestId,
      why: "Запрос отправлен в открытую админ-вкладку. Она проверит сохранённые подключения и схему только чтением; автоцикл не включается." };
  }

  /**
   * `pull`: «дай работу».
   *
   * Ответ всегда один из трёх: работа, «жди» с причиной, «тебе сюда нельзя».
   * Третье — не ошибка вкладки, а расхождение раскладки: административный
   * контейнер не берёт рабочие роли, и вкладка должна об этом сказать человеку.
   */
  async function pull({ slotId = "", tab = "", roleHint = "", scriptVersion = "", localPaused = false, localPauseReason = "",
    projectId = "", projectName = "", projectApproved, projectBlockReason = "" } = {}) {
    const data = await loadAll();
    const slot = slotById(data.slots, slotId);
    if (!slot) return { ok: false, why: `слота ${slotId} нет в таблице` };
    if (!slot.enabled) return idle(`слот ${slotId} выключен`);
    rememberClient({ slotId, tab, scriptVersion, localPaused, localPauseReason, projectId, projectName, projectApproved,
      projectBlockReason, source: "pull" });

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

    if (!versionAtLeast(scriptVersion, SUPPORTED_SCRIPT_VERSION)) {
      return {
        ...idle(`обновите ScriptCat до ${SUPPORTED_SCRIPT_VERSION}: текущая вкладка не сообщает совместимую версию`),
        updateRequired: true,
        requiredScriptVersion: SUPPORTED_SCRIPT_VERSION,
      };
    }

    // Do not hand new work to a tab whose selected project is explicitly
    // blocked or differs from Relay's active profile. Existing runs are
    // returned above so they can finish; only new work is held.
    const client = memory.clients instanceof Map ? memory.clients.get(`${slotId}:${tab}`) : null;
    if (client?.projectApproved === false) {
      const why = `профиль «${client.projectName || client.projectId || "проекта"}» не допущен: ${client.projectBlockReason || "нужна проверка настроек проекта"}`;
      if (memory.coordinatorTurnRequest) {
        await record({ slot: slot.slotId, account: slot.account, tab, kind: "state", level: "warn",
          text: `запрос Координатора снят: ${why}`, data: { turnRequestId: memory.coordinatorTurnRequest.id } });
        clearCoordinatorTurnRequest();
      }
      return idle(why);
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

    // Ручной «Шаг» пульта при пустой книге должен запустить не очередную
    // раздачу (раздавать нечего), а старый проверенный планирующий ход в
    // Coordinator-tab. Это отдельный control signal: не Notion-карточка и не
    // Run. Один короткий claim не даёт двум admin-вкладкам отправить два плана.
    const request = memory.coordinatorTurnRequest;
    if (slot.admin && request && liveRuns.length === 0) {
      if (now() - Number(request.createdAt || 0) > TURN_REQUEST_TTL_MS ||
          String(data.settings["cycle.turn"] || "coordinator") !== "coordinator") {
        clearCoordinatorTurnRequest();
      } else if (!data.queue.some((item) => norm(item["Статус"]) === QUEUE.WAITING)) {
        if (Number(request.claimUntil || 0) <= now()) {
          request.claimedBy = String(tab || "?");
          request.claimUntil = now() + TURN_REQUEST_CLAIM_MS;
          await record({
            slot: slot.slotId, account: slot.account, tab, kind: "state",
            text: `вкладка получила планирующий ход Координатора ${request.id}`,
            data: { turnRequestId: request.id, scriptVersion: String(scriptVersion || "") },
          });
          return {
            ...idle("планирующий ход Координатора"),
            kind: "turn",
            turn: "coordinator",
            turnId: request.id,
          };
        }
      } else {
        clearCoordinatorTurnRequest();
      }
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
  async function beat({ slotId = "", runId = "", tab = "", waiting = "", silentMs = 0, scriptVersion = "", localPaused = false, localPauseReason = "" } = {}) {
    rememberClient({ slotId, tab, scriptVersion, localPaused, localPauseReason, localBusy: true, localWaiting: waiting, source: "beat" });
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
  /**
   * Переходы хода по решению из маркера (D-025/D-026).
   *
   * FSM, а не «кто первый попался»: решение применяется только из того
   * состояния, в котором оно легитимно — иначе повторный отчёт того же
   * маркера задвигал бы ход назад и дублировал круг доработок.
   */
  async function applyTurnDecision(decision, { slotId = "", tab = "", runId = "", card = "" } = {}) {
    if (!decision) return { applied: false, why: "в маркере нет решения хода" };
    const turnNow = String((await loadSettings())["cycle.turn"] || "coordinator");
    if (decision.kind === "coordinator") {
      if (decision.next === "done") {
        if (turnNow !== "coordinator") return { applied: false, why: `ход уже «${turnNow}»: done не применяю` };
        await writeSetting("cycle.turn", "warden");
        await record({ slot: slotId, tab, kind: "state", text: "ход: миссия готова — передана приёмке (Warden)", runId, card });
        return { applied: true, turn: "warden" };
      }
      if (turnNow === "coordinator") return { applied: false, why: "ход уже у Координатора" };
      await writeSetting("cycle.turn", "coordinator");
      await record({ slot: slotId, tab, kind: "state", text: `ход: план Координатора (next: ${clip(decision.next, 40)}) — цикл открыт`, runId, card });
      return { applied: true, turn: "coordinator" };
    }
    if (decision.kind === "review") {
      if (turnNow !== "warden") return { applied: false, why: `вердикт приёмки при ходе «${turnNow}» не применяю` };
      const settingsNow = await loadSettings();
      if (decision.verdict === "accept") {
        await writeSetting("cycle.turn", "done");
        await record({ slot: slotId, tab, kind: "state", text: "приёмка: миссия принята — цикл завершён", runId, card });
        return { applied: true, turn: "done" };
      }
      if (decision.verdict === "rework") {
        const round = (Number(settingsNow["cycle.round"]) || 0) + 1;
        await writeSetting("cycle.round", round);
        await writeSetting("cycle.turn", "coordinator");
        if (round > 3) {
          await pause({ reason: `приёмка: возврат №${round} — лимит доработок (3), нужен Мастер` });
        } else {
          await record({ slot: slotId, tab, kind: "state", level: "warn", text: `приёмка: возврат (круг ${round}) — ход Координатору`, runId, card });
        }
        return { applied: true, turn: "coordinator", round };
      }
      await pause({ reason: "приёмка: master — без владельца не продолжить" });
      return { applied: true, turn: turnNow };
    }
    return { applied: false, why: "нет решения хода" };
  }

  async function report({ slotId = "", tab = "", payload = {} } = {}) {
    const at = isoNow(now());

    if (payload.turnClaimRenew) {
      const request = memory.coordinatorTurnRequest;
      const data = await loadAll();
      const slot = slotById(data.slots, slotId);
      const matches = request && slot?.admin && String(request.id) === String(payload.turnRequestId || "") &&
        String(request.claimedBy || "") === String(tab || "") &&
        now() - Number(request.createdAt || 0) <= TURN_REQUEST_TTL_MS;
      if (matches) request.claimUntil = now() + TURN_REQUEST_CLAIM_MS;
      return { ok: true, turnClaimRenewed: Boolean(matches) };
    }

    // Маркер хода без выдачи (D-026): план Координатора и вердикт приёмки —
    // служебные ходы, у них нет Run ID в книге. Вкладка присылает текст
    // маркера, служба применяет FSM хода; строгость ниже («выдачи нет») к
    // таким отчётам не относится — нечего путать с потерянной выдачей.
    if (payload.turnAck) {
      const request = memory.coordinatorTurnRequest;
      const matches = request && String(request.id) === String(payload.turnRequestId || "");
      if (matches && payload.retry) {
        request.claimedBy = "";
        request.claimUntil = 0;
      } else if (matches) clearCoordinatorTurnRequest();
      const missionError = String(payload.missionError || "")
        .replace(/(?:ntn|secret)_[A-Za-z0-9_-]{12,}/gi, "[TOKEN REDACTED]")
        .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]")
        .slice(0, 240);
      await record({
        slot: slotId, tab, kind: "state", level: missionError || payload.noMission ? "warn" : "info",
        text: missionError
          ? `планирующий ход не начат: проверка миссии в Notion завершилась ошибкой — ${missionError}; запрос оставлен для повтора`
          : payload.noMission
            ? "планирующий ход не начат: активной миссии в Notion нет"
            : payload.retry
              ? "планирующий ход повторится: вкладка пока не создала ожидание"
              : "планирующий ход принят вкладкой",
        data: { turnRequestId: String(payload.turnRequestId || ""), noMission: Boolean(payload.noMission), retry: Boolean(payload.retry),
          ...(missionError ? { missionError } : {}) },
      });
      return { ok: true, turnAck: true, cleared: Boolean(matches && !payload.retry) };
    }
    if (payload.markerOnly) {
      const decision = parseTurnMarker(payload.markerRaw || "");
      const applied = await applyTurnDecision(decision, { slotId, tab, card: String(payload.markerCard || "") });
      if (decision?.kind === "coordinator") clearCoordinatorTurnRequest();
      return { ok: true, markerOnly: true, ...applied };
    }

    const data = await loadAll();
    const runId = norm(payload.runId);
    const run = data.runs.find((item) => norm(item["Run ID"]) === runId) || null;
    const markerRunId = String(payload.markerRunId || "").trim();
    const markerCard = String(payload.markerCard || "").trim();
    const verdict = [];

    // Вкладка не смогла выдать карточку (D-026): выдача закрывается как
    // failed, строка очереди — в blocked с причиной, слот свободен. Без этого
    // строка висела бы в leased вечно, а слот — занятым phantom'ом.
    if (payload.failed && run) {
      const index = data.runs.indexOf(run);
      await store.updateRange("runs", index + 2, [[
        run["Run ID"], run["Карточка"], run["Заголовок"], run["Слот"], run["Аккаунт"],
        run["Роль"], run["Agent URL"], RUN.FAILED, run["Выдан"], at,
        run["Ожидание"], run["Попытка"], clip(payload.markerRaw || "", 500), clip(payload.why || "", 4000),
      ]]);
      const rowIndex = data.queue.findIndex((item) =>
        norm(item["Карточка"]) === norm(run["Карточка"]) && norm(item["Статус"]) === QUEUE.LEASED);
      if (rowIndex >= 0) {
        const row = data.queue[rowIndex];
        await store.updateRange("queue", rowIndex + 2, [queueToRow({
          ...row,
          "Статус": QUEUE.BLOCKED,
          "Комментарий": clip(String(payload.why || "вкладка не смогла выдать"), 400),
        })]);
      }
      const released = releaseAndRequeue({
        runs: data.runs.map((item) => (norm(item["Run ID"]) === runId ? { ...item, "Статус": RUN.FAILED } : item)),
        slotId, runId, status: RUN.FAILED, at,
      });
      await record({
        slot: slotId, tab, kind: "dispatch", level: "warn",
        text: `выдача ${runId} не состоялась: ${clip(String(payload.why || "причина не названа"), 200)}`,
        card: run["Карточка"], runId,
      });
      return { ok: false, failed: true, why: `выдача не состоялась: ${payload.why || "причина не названа"}`, freedSlot: released.freedSlot };
    }

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
    const queueIndex = data.queue.findIndex((item) =>
      norm(item["Карточка"]) === norm(run["Карточка"]) &&
      norm(item["Статус"]) === QUEUE.LEASED &&
      norm(item["Взял слот"]) === norm(slotId));
    if (queueIndex >= 0) {
      const queueItem = data.queue[queueIndex];
      await store.updateRange("queue", queueIndex + 2, [queueToRow({
        ...queueItem,
        "Статус": QUEUE.DONE,
        "Готово в": at,
        "Комментарий": "ответ принят",
      })]);
    }
    await record({
      slot: slotId, tab, kind: "state",
      text: released.freedSlot ? `слот ${slotId} свободен: ход возвращён Координатору` : "слот ещё занят другой выдачей",
      runId,
    });

    // Ход цикла (D-025/D-026): принятый ответ может нести решение хода —
    // общая машина переходов (applyTurnDecision) выше.
    const decision = parseTurnMarker(payload.markerRaw || "");
    if (decision) await applyTurnDecision(decision, { slotId, tab, runId, card: run?.["Карточка"] || "" });

    return { ok: true, runId, freedSlot: released.freedSlot, busySlots: released.busySlots };
  }

  /** `event`: любая запись журнала от вкладки или пульта. */
  async function event({ slotId = "", account = "", tab = "", scriptVersion = "", localPaused = false, localPauseReason = "", kind = "state", level = "info", text = "", card = "", runId = "", durationMs = "", data = null } = {}) {
    if (data && data.relayClientState === true) {
      rememberClient({
        slotId, tab, scriptVersion, localPaused, localPauseReason,
        localBusy: Boolean(data.localBusy), localWaiting: String(data.localWaiting || ""),
        projectId: String(data.projectId || ""), projectName: String(data.projectName || ""),
        projectApproved: typeof data.projectApproved === "boolean" ? data.projectApproved : undefined,
        projectBlockReason: String(data.projectBlockReason || ""), source: "state",
      });
    } else if (data && typeof data.projectApprovalResult === "boolean") {
      // Detailed, read-only approval outcome from the live admin tab. Keep it
      // alongside its project state so the control panel can explain a block.
      rememberClient({
        slotId, tab, scriptVersion, localPaused,
        projectId: String(data.projectId || ""), projectName: String(data.projectName || ""),
        projectApproved: data.projectApprovalResult,
        projectBlockReason: data.projectApprovalResult ? "" : "unapproved",
        projectApprovalFailure: String(data.projectApprovalFailure || ""),
        source: "event",
      });
    }
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
      // A blocked project must be visible and actionable in the control plane,
      // not discovered only after the panel has created a coordinator request.
      // Older clients omit this field and retain the previous behavior.
      const adminIds = new Set(data.slots.filter((slot) => slot.admin).map((slot) => norm(slot.slotId)));
      const blockedAdmin = [...(memory.clients instanceof Map ? memory.clients.values() : [])]
        .find((client) => adminIds.has(norm(client.slotId)) && client.projectApproved === false &&
          now() - Number(client.seenAt || 0) <= CLIENT_ACTIVE_MS);
      if (blockedAdmin) {
        const why = `профиль «${blockedAdmin.projectName || blockedAdmin.projectId || "проекта"}» не допущен: ${blockedAdmin.projectBlockReason || "нужна проверка настроек проекта"}`;
        memory.lastStep = { at: isoNow(now()), count: 0, why, turnRequested: false, turnRequestId: "" };
        if (origin !== "auto") await record({ kind: "tick", level: "warn", text: `шаг не запущен: ${why}` });
        return { ok: false, planned: 0, requested: 0, why, plans: [], agentRequests: [], turnRequested: false };
      }
      // Ход завершён (D-025): приёмка приняла миссию — новых выдач нет.
      // Новый цикл открывает маркер Координатора (next не в done) либо
      // человек в листе «Настройки» (cycle.turn).
      if (data.settings["cycle.turn"] === "done") {
        const why = "цикл завершён: миссия принята приёмкой";
        memory.lastTick = now();
        memory.lastStep = { at: isoNow(now()), count: 0, why };
        if (origin !== "auto" || memory.lastAutoIdleReason !== why) await record({ kind: "tick", text: `шаг: ${why}` });
        memory.lastAutoIdleReason = origin === "auto" ? why : "";
        return { ok: true, planned: 0, requested: 0, why, plans: [], agentRequests: [], summary: data.settings };
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

      // Ход цикла (D-025): когда выдавать нечего, «выдач 0» — не вся правда.
      // Правда называется по протоколу: пустая очередь — планирующий ход
      // Координатора, готовая миссия — приёмка, принятая — цикл завершён.
      let why = plan.why;
      let turnRequested = false;
      let turnRequestId = "";
      if (!issued.length && !agentRequests.length) {
        const turn = String(data.settings["cycle.turn"] || "coordinator");
        const waiting = data.queue.filter((item) => norm(item["Статус"]) === QUEUE.WAITING).length;
        const live = data.runs.filter(isLiveRun).length;
        if (turn === "warden") why = "миссия у приёмки (Warden): ждёт accept или rework";
        else if (!waiting && turn === "coordinator" && ["panel", "auto"].includes(origin) && live === 0) {
          let request = memory.coordinatorTurnRequest;
          if (!request || now() - Number(request.createdAt || 0) > TURN_REQUEST_TTL_MS) {
            request = { id: newQueueId(now()), createdAt: now(), claimedBy: "", claimUntil: 0 };
            memory.coordinatorTurnRequest = request;
            await record({
              kind: "state", text: `пульт запросил планирующий ход Координатора ${request.id}`,
              data: { turnRequestId: request.id, origin },
            });
          }
          turnRequested = true;
          turnRequestId = request.id;
          why = `ход у Координатора: запрос плана ${request.id} ожидает admin-вкладку`;
        } else if (!waiting && turn === "coordinator") {
          why = "ход у Координатора: очередь пуста — нажмите «Шаг», чтобы передать планирующий ход вкладке Coordinator";
        }
      }

      memory.lastTick = now();
      memory.lastStep = { at: isoNow(now()), count: issued.length, why, turnRequested, turnRequestId };
      const autoIdle = origin === "auto" && !issued.length && !agentRequests.length && !turnRequested;
      const repeatedAutoIdle = autoIdle && memory.lastAutoIdleReason === why;
      if (!repeatedAutoIdle) {
        await record({
          kind: "tick",
          text: issued.length || agentRequests.length
            ? `шаг: выдач ${issued.length}${agentRequests.length ? `, заданий на агента ${agentRequests.length}` : ""} (${plan.why})`
            : `шаг: ${why}`,
          data: { issued, requested: agentRequests },
        });
      }
      memory.lastAutoIdleReason = autoIdle ? why : "";
      return {
        ok: true, planned: issued.length, requested: agentRequests.length,
        turnRequested, turnRequestId,
        why, plans: issued, agentRequests, summary: data.settings,
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

  /**
   * Перезапросить планирующий ход Координатора.
   *
   * Зачем кнопка. Пока запрос хода жив, пульт блокировал «Шаг» («Шаг уже
   * ожидает»), чтобы человек не создал второй ход. Но если админ-вкладка
   * стоит на паузе (капча, ошибка), запрос живёт 15 минут, и всё это время
   * кнопка была мёртвой: «нельзя совершить никаких действий». Выхода не было
   * вообще — только ждать или лезть в ScriptCat руками.
   *
   * Теперь запрос можно снять и попросить заново. Это безопасно: старый
   * запрос не был взят вкладкой (взятый обрабатывается), а новый получит та
   * вкладка, которая первой спросит работу.
   */
  async function retryTurn() {
    const previous = memory.coordinatorTurnRequest;
    if (!previous) return { ok: false, why: "запроса хода нет: нажмите «Шаг»" };
    if (Number(previous.claimUntil || 0) > now()) {
      return { ok: false, why: "запрос уже взят админ-вкладкой: дождитесь ответа или снимите паузу в ScriptCat" };
    }
    clearCoordinatorTurnRequest();
    await record({ kind: "ui", text: `старый запрос плана ${previous.id} снят человеком; запрашиваю заново` });
    return step({ origin: "panel" });
  }

  async function resume() {
    memory.paused = false;
    memory.pauseReason = "";
    await record({ kind: "ui", text: "пауза снята" });
    return { ok: true, paused: false };
  }

  async function autoRunnerTick() {
    if (autoRunnerBusy || memory.paused) return;
    autoRunnerBusy = true;
    try {
      const settings = await loadSettings();
      if (settings["cycle.mode"] !== "auto") {
        stopAutoRunner();
        return;
      }
      const outstandingTurn = memory.coordinatorTurnRequest;
      if (outstandingTurn && now() - Number(outstandingTurn.createdAt || 0) <= TURN_REQUEST_TTL_MS) return;
      await step({ origin: "auto" });
    } catch (error) {
      const text = `автоцикл Relay: шаг не выполнен — ${String(error?.message || error).slice(0, 220)}`;
      log(text);
      await record({ kind: "tick", level: "error", text }).catch(() => {});
    } finally {
      autoRunnerBusy = false;
    }
  }

  function stopAutoRunner() {
    if (autoRunnerTimer) clearInterval(autoRunnerTimer);
    autoRunnerTimer = null;
  }

  function startAutoRunner() {
    if (autoRunnerTimer) return;
    autoRunnerTimer = setInterval(() => { void autoRunnerTick(); }, 15000);
    autoRunnerTimer.unref?.();
  }

  async function bootAutoRunner() {
    // До 1.34.0 Relay-кнопка режима не сохраняла выбор, поэтому старые книги
    // содержат manual + прежний default=manual. Владелец просил автозапуск по
    // умолчанию: мигрируем именно старый default один раз. Если в новой версии
    // человек выберет manual, writeSetting уже запишет default=auto, и выбор
    // переживёт перезапуск без повторного переключения.
    const { rows } = await store.read("settings");
    const modeRow = rows.find((row) => String(row?.[0] || "").trim() === "cycle.mode");
    if (modeRow && String(modeRow[1] || "").trim() === "manual" && String(modeRow[4] || "").trim() === "manual") {
      await writeSetting("cycle.mode", "auto");
      await record({ kind: "state", text: "автоцикл включён при обновлении: прежнее значение manual было значением по умолчанию, а не сохранённым выбором" });
    }
    const settings = await loadSettings(true);
    if (settings["cycle.mode"] === "auto") startAutoRunner();
    return { ok: true, mode: settings["cycle.mode"] };
  }

  async function setMode({ mode = "manual" } = {}) {
    const next = mode === "auto" ? "auto" : "manual";
    await writeSetting("cycle.mode", next);
    if (next === "auto") startAutoRunner();
    else stopAutoRunner();
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
      // Подключён ли Notion — для пульта: поле «Токен» показывается только
      // пока справочник не читается, иначе оно приглашает сломать рабочее.
      notion: { ready: Boolean(notionTokenNow()) },
      requiredScriptVersion: SUPPORTED_SCRIPT_VERSION,
      scriptClients: [...(memory.clients instanceof Map ? memory.clients.values() : [])]
        .filter((client) => now() - Number(client.seenAt || 0) <= CLIENT_ACTIVE_MS)
        .map((client) => ({
          ...client,
          seenAt: isoNow(client.seenAt),
          lastHelloAt: client.lastHelloAt ? isoNow(client.lastHelloAt) : "",
          lastPullAt: client.lastPullAt ? isoNow(client.lastPullAt) : "",
          lastBeatAt: client.lastBeatAt ? isoNow(client.lastBeatAt) : "",
        })),
      turnRequest: memory.coordinatorTurnRequest ? {
        id: memory.coordinatorTurnRequest.id,
        createdAt: isoNow(memory.coordinatorTurnRequest.createdAt),
        claimed: Number(memory.coordinatorTurnRequest.claimUntil || 0) > now(),
      } : null,
      mode: data.settings["cycle.mode"],
      // Ход цикла (D-025): для строки запуска пульта — кто держит очередь
      // решений прямо сейчас. Пусто/координатор — цикл открыт.
      cycle: {
        turn: data.settings["cycle.turn"] || "coordinator",
        round: Number(data.settings["cycle.round"]) || 0,
      },
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
    // Настройки читаем заново: мастер мог прийти сразу после записи токена, а
    // кеш трёхсекундной давности — не повод искать базы без ключа.
    const current = await loadSettings(true);
    let databases = [];
    let searchError = "";
    if (notionSearch) {
      try {
        // Токен — тем, что сейчас в памяти: мастер мог прийти сразу после
        // ввода токена в пульте, и искать по пустому окружению значило бы
        // вернуть «база не видна» при принятом токене.
        databases = await notionSearch({ token: notionTokenNow() });
      } catch (error) {
        searchError = error.message;
      }
    }
    let rolesInBook = false;
    try {
      rolesInBook = (await store.read("roles")).rows.length > 0;
    } catch {
      rolesInBook = false;
    }
    const plan = planSetup({
      projectName: projectName || current["project.name"],
      settings: current,
      databases,
      rolesInBook,
      demo: Boolean(store.demo),
      // «Токена нет» и «токен есть, но баз не видно» — разные новости. Второе
      // значит, что интеграции не дали доступ к странице, и искать надо там.
      searchable: Boolean(notionTokenNow()),
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
      notes: plan.notes || [],
      written: applied.written || [],
      advancedLeftToDefaults: plan.advancedLeftToDefaults,
      hasNotionToken: Boolean(notionTokenNow()),
    };
  }

  /**
   * Перенести роли из Notion в лист «Роли».
   *
   * Зачем перенос, а не чтение каждый раз. У владельца сеть до Notion режется
   * фильтром; пока роли жили только там, цикл был «не настроен» при живой
   * книге. После переноса книга самодостаточна, а Notion остаётся источником
   * обновлений: перенести можно повторно, лист перезапишется.
   *
   * Пишем пачками по 200 строк: у правки листа есть пределы, а строк ролей
   * бывает много.
   */
  async function rolesToBook() {
    const settings = await loadSettings(true);
    const dataSourceId = settings["notion.rolesDb"] || "";
    const token = notionTokenNow();
    if (!dataSourceId || !token) {
      return { ok: false, why: "роли неоткуда взять: нет ни токена Notion, ни ID базы «Роли». Заполните лист «Роли» в книге руками — цикл работает и так" };
    }
    let rows = [];
    try {
      rows = await fetchRoles({ token, dataSourceId, fetchImpl: notionDataFetch || notionFetch });
    } catch (error) {
      return { ok: false, why: `Notion не ответил: ${error.message}` };
    }
    if (!rows.length) return { ok: false, why: "в базе «Роли» нет строк: переносить нечего" };

    const values = rows.map((role) => [
      role.name, role.fn, role.status, role.url, role.repo,
      role.agentState === "не требуется" ? "нет" : "да", "",
    ]);
    try {
      await store.ensureSheet("roles").catch(() => {});
      // Шапка остаётся, строки перезаписываются начиная со второй.
      await store.updateRange("roles", 2, values);
    } catch (error) {
      return { ok: false, why: `лист «Роли» не записался: ${error.message}` };
    }
    memory.rolesCache = rows;
    memory.rolesAt = now();
    await record({ kind: "ui", text: `роли перенесены в книгу: ${rows.length}` });
    return { ok: true, why: `перенесено ролей: ${rows.length}. Notion для работы больше не нужен`, count: rows.length };
  }

  /**
   * Замер записи в книгу.
   *
   * Нужен, чтобы «медленно» перестало быть догадкой. Мост к Apps Script ходит
   * по одному запросу за операцию, и на каждый шаг уходит несколько чтений и
   * записей — при 700 мс на запрос шаг занимает секунды. Числа показываем
   * человеку, вместо того чтобы просить его верить.
   */
  async function measureBook() {
    const started = now();
    const timings = {};
    let readMs = 0;
    try {
      const t0 = now();
      await store.read("slots");
      readMs = now() - t0;
      timings.readSlotsMs = readMs;
    } catch (error) {
      return { ok: false, why: `книга не читается: ${error.message}` };
    }
    const t1 = now();
    try {
      await store.meta();
      timings.metaMs = now() - t1;
    } catch {
      timings.metaMs = null;
    }
    // Одна настоящая запись: строка журнала. Чтение и запись стоят по-разному,
    // и обе нужны, чтобы оценить шаг.
    const t2 = now();
    try {
      // Строка собирается так же, как в `record`: хранилище ждёт массив ячеек,
      // а не объект. Ошибка здесь превращала бы замер в «книга не пишется».
      const sample = makeEvent({ kind: "ui", text: "замер: проверка скорости книги" });
      await store.append("events", [[
        sample["Время"], sample["Слот"], sample["Аккаунт"], sample["Вкладка"], sample["Вид"],
        sample["Уровень"], sample["Текст"], sample["Карточка"], sample["Run ID"],
        sample["Длительность мс"], sample["Данные"],
      ]]);
      timings.appendMs = now() - t2;
    } catch (error) {
      return { ok: false, why: `книга не пишется: ${error.message}`, timings };
    }
    const stepMs = (timings.readSlotsMs || 0) * 4 + (timings.appendMs || 0) * 2;
    return {
      ok: true,
      timings,
      totalMs: now() - started,
      stepEstimateMs: stepMs,
      why: `книга читается за ${(readMs / 1000).toFixed(1)} с, пишется за ${(timings.appendMs / 1000).toFixed(1)} с. ` +
        `Один шаг цикла — около ${(stepMs / 1000).toFixed(1)} с: мост ходит по одному запросу за операцию`,
    };
  }

  /**
   * Проверка сети до Notion — отдельно от токена.
   *
   * Владелец сидит за VPN, прокси или антивирусом, и запрос умирает до всякой
   * аутентификации. Пока «нет ответа» и «токен не принят» — один текст, он
   * будет перевыпускать рабочий ключ. Эта проверка говорит, где искать.
   */
  async function notionNet() {
    const result = await pingNotion({ fetchImpl: notionFetch });
    await record({ kind: "ui", level: result.ok ? "info" : "warn", text: `сеть до Notion: ${result.why}` });
    return result;
  }

  /**
   * Токен Notion, введённый в пульте.
   *
   * Зачем вход, а не переменная окружения: токен владелец получает в Notion
   * за десять секунд, а «остановите транспорт, задайте NOTION_TOKEN, запустите
   * заново» — это шаг, который откладывают. Живёт он только в памяти службы:
   * книга доступна по мосту, и класть туда чужой токен незачем.
   *
   * Проверяем сразу поиском: «сохранено» без проверки — это обещание, которое
   * человек обнаружит ложным на кнопке «Найти и применить».
   */
  async function notionTokenSet({ token = "" } = {}) {
    const value = String(token || "").trim();
    if (!value) return { ok: false, why: "токен пуст" };
    if (!/^(secret_|ntn_)/.test(value)) {
      return {
        ok: false,
        why: "токен Notion начинается с ntn_ (новый) или secret_ (старый): похоже, вставилась не та строка",
      };
    }
    let found = [];
    try {
      found = await searchDatabases({ token: value, fetchImpl: notionDataFetch || notionFetch });
    } catch (error) {
      // «Не принял токен» и «до Notion не дошли» — разные новости, и лечатся
      // они в разных местах. Первое — в Notion, второе — в сети, и склеивать
      // их в одну строку значит отправлять человека не туда.
      // «Не дошли», «ответил не Notion» и «не принял токен» — три разные
      // новости. Склеивать их в одну строку значит отправлять человека
      // перевыпускать рабочий ключ.
      const network = /дозвонились|не ответил|не доходит/i.test(error.message);
      const substituted = /вернул не данные|уходил на|ушёл на/i.test(error.message);
      if (network || substituted) return { ok: false, network: true, substituted, why: error.message };
      return { ok: false, why: `Notion не принял токен: ${error.message}` };
    }
    memory.notionToken = value;
    // Справочник ролей теперь читается другим токеном — старый кеш не годится.
    memory.rolesCache = null;
    memory.rolesAt = 0;
    await record({
      kind: "ui", level: "info",
      text: `токен Notion принят: видно баз — ${found.length}`,
      data: { databases: found.map((item) => item.title) },
    });
    // Локальное сохранение — отдельно от успеха проверки: токен принят, даже
    // если файл записать не удалось (папка только для чтения). Человеку
    // говорим правду о том, ждёт ли его ввод при следующем запуске.
    let tail = " При перезапуске службы токен нужно будет ввести снова.";
    if (typeof saveNotionToken === "function") {
      let saved = null;
      try {
        saved = saveNotionToken(value);
      } catch (error) {
        saved = { ok: false, why: error.message };
      }
      tail = saved && saved.ok
        ? " Токен сохранён локально (notion-token.txt) — при перезапуске вводить не нужно."
        : ` Сохранить локально не удалось (${saved && saved.why ? saved.why : "неизвестная причина"}) — при перезапуске ввод будет нужен снова.`;
    }
    return {
      ok: true,
      why: `токен принят. Видно баз: ${found.length}${found.length ? ` (${found.map((item) => item.title).join(", ")})` : ""}. ` +
        "Нажмите «Найти и применить»." + tail,
      databases: found.map((item) => item.title),
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
      if (norm(duplicate["Роль"]) === norm(role) && norm(duplicate["Вид"]) === norm(kind)) {
        return { ok: true, duplicate: true, itemId: duplicate["ID"], item: duplicate };
      }
      return { ok: false, why: `карточка ${cardId} уже в очереди для роли «${duplicate["Роль"]}" (${duplicate["Статус"]}, строка ${duplicate["ID"]})` };
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
    clearCoordinatorTurnRequest();
    await record({
      slot: item["Слот"], kind: "queue",
      text: `в очередь поставлено: ${item["Заголовок"] || cardId}${item["Роль"] ? ` (${item["Роль"]})` : ""}`,
      card: cardId,
    });
    // Ход завершён, а человек ставит работу — цикл открыт заново (D-025):
    // иначе «В очередь» молча упёрся бы в «цикл завершён» на следующем шаге.
    if (String(data.settings["cycle.turn"] || "coordinator") === "done") {
      await writeSetting("cycle.turn", "coordinator");
      await record({ kind: "state", text: "новая работа: ход возвращён Координатору (цикл после приёмки открыт заново)", card: cardId });
    }
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
      case ACTIONS.PULL: {
        const result = await pull(body);
        const settings = await loadSettings();
        return { ...result, cycleMode: settings["cycle.mode"] === "auto" ? "auto" : "manual" };
      }
      case ACTIONS.BEAT: return beat(body);
      case ACTIONS.AGENT: return agentReady({
        role: body.role, slotId: body.slotId || body.slot, url: body.url,
        tab: body.tab, note: body.note, failed: body.ok === false, queueId: body.queueId,
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
      case CONTROL.RETRY_TURN: return retryTurn();
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
    bootAutoRunner, stopAutoRunner,
    enqueue, cancel, setup, requestProjectApproval, notionTokenSet, notionNet, rolesToBook, measureBook, retryTurn, snapshot, incidentPackage, loadAll, record, memory, sheetTitles,
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
