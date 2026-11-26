// Мастер первичной настройки.
//
// Требование владельца: «минимум ввода — ключи и ID должны получаться сами».
// Поэтому мастер не спрашивает, где лежит база «Роли»: он её ищет. Спрашивает
// он ровно то, что нельзя вывести ниоткуда, — имя проекта, и то лишь для
// человекочитаемых подписей.
//
// Правило, которое здесь соблюдается буквально: **в расширенных настройках нет
// ничего, без чего цикл не работает**. Поэтому мастер пишет только базовые
// ключи, а расширенные остаются со значениями по умолчанию.

import { SETTINGS, basicKeys, auditSettings } from "./settings.mjs";
import { SHEETS } from "./schema.mjs";

const norm = (value) => String(value ?? "").trim().toLowerCase();

/**
 * Поиск базы по названию среди того, что видит интеграция.
 *
 * Ошибка «нашлось две базы с одним названием» — полезнее, чем молчаливый выбор
 * первой: иначе транспорт начнёт писать в чужую копию, и это выяснится через
 * неделю.
 */
export function pickDatabase(results, title, { demo = false, searchable = true } = {}) {
  const wanted = norm(title);
  const hits = (results || []).filter((item) => norm(item?.title) === wanted);
  if (!hits.length) {
    const similar = (results || []).filter((item) => norm(item?.title).includes(wanted)).map((item) => item.title);
    if (demo) {
      // В демо-режиме искать негде: книга в памяти, Notion не подключён.
      // Совет «дайте интеграции доступ» здесь — ложный след: человек идёт
      // проверять доступ там, где доступа ещё нет вовсе.
      return {
        ok: false,
        why: `база «${title}» не найдена: служба запущена в демо-режиме, книга не подключена`,
      };
    }
    if (!results || !results.length) {
      // Пустой поиск — это не всегда «базы нет». Если искать было нечем, так и
      // говорим: назвать причиной доступ к странице значит отправить человека
      // чинить не то.
      if (searchable) {
        return {
          ok: false,
          why: `база «${title}» не видна: токен есть, но интеграция её не видит — дайте интеграции доступ к странице проекта`,
        };
      }
      return {
        ok: false,
        why: "Notion не подключён: транспорт не знает токен, искать базы нечем — вставьте токен в поле «Токен Notion» на пульте",
      };
    }
    return {
      ok: false,
      why: similar.length
        ? `базы «${title}» нет, но есть похожие: ${similar.join(", ")}`
        : `база «${title}» не найдена: дайте интеграции доступ к странице проекта`,
    };
  }
  if (hits.length > 1) {
    return {
      ok: false,
      why: `баз с названием «${title}» несколько (${hits.length}): оставьте одну, иначе транспорт не поймёт, куда писать`,
      hits,
    };
  }
  return { ok: true, id: hits[0].dataSourceId || hits[0].id, item: hits[0] };
}

/**
 * План настройки: что уже есть, чего не хватает, что будет записано.
 *
 * Побочных эффектов нет — план можно показать человеку до записи. Это и есть
 * «мастер»: один экран, где видно всё, и одна кнопка «применить».
 */
export function planSetup({ projectName = "", settings = {}, databases = [], gateway = null, demo = false, searchable = true } = {}) {
  const steps = [];
  const discovered = {};

  // Демо — это не «не нашлось», это «искать негде». Показывать три ✕ по
  // ключам, которые нельзя заполнить, значит предлагать человеку чинить то,
  // что он не ломал. В демо шагов нет вовсе: есть одна причина.
  if (demo) {
    return {
      ok: false,
      steps: [],
      discovered: {},
      requiredMissing: [],
      advancedLeftToDefaults: Object.keys(SETTINGS).filter((key) => SETTINGS[key].group === "advanced").length,
      why: "служба в демо-режиме: книга не подключена, искать в Notion нечего — сначала вставьте адрес и ключ моста",
      demo: true,
    };
  }

  const roles = pickDatabase(databases, "Роли", { demo, searchable });
  steps.push({
    key: "notion.rolesDb",
    ok: roles.ok,
    // Справочник ролей улучшает раскладку (адреса, административность), но
    // цикл работает и без него: функция и имя роли есть в самой строке
    // очереди. Значит это замечание, а не блокировка.
    required: false,
    recommended: true,
    why: roles.ok
      ? "найдена база «Роли»"
      : `${roles.why}. Без справочника цикл работает: роль и функция берутся из строки очереди`,
    value: roles.ok ? roles.id : "",
  });
  if (roles.ok) discovered["notion.rolesDb"] = roles.id;

  // «Слоты» и «Запросы» транспорт не читает: слоты — лист книги, запросы
  // приходят строкой очереди. Шаг показываем только когда база реально
  // нашлась — иначе это ✕ про то, что и не требовалось.
  const slots = pickDatabase(databases, "Слоты", { demo });
  if (slots.ok) {
    steps.push({
      key: "notion.slotsDb",
      ok: true,
      required: false,
      why: "найдена база «Слоты» (необязательно: слоты читаются из книги)",
      value: slots.id,
    });
    discovered["notion.slotsDb"] = slots.id;
  }

  const requests = pickDatabase(databases, "Запросы", { demo });
  if (requests.ok) {
    steps.push({
      key: "notion.requestsDb",
      ok: true,
      required: false,
      why: "найдена база «Запросы» (необязательно: карточки приходят строкой очереди)",
      value: requests.id,
    });
    discovered["notion.requestsDb"] = requests.id;
  }

  if (gateway) {
    steps.push({
      key: "drive.logsFolderId",
      ok: Boolean(gateway.folderId),
      why: gateway.folderId ? `папка логов найдена: ${gateway.folderId}` : "папка логов не найдена: шлюз Drive не ответил",
      value: gateway.folderId || "",
      required: false,
    });
    if (gateway.folderId) discovered["drive.logsFolderId"] = gateway.folderId;
  }

  steps.push({
    key: "project.name",
    ok: Boolean(projectName || settings["project.name"]),
    why: projectName ? "название задано" : "название проекта не задано",
    value: projectName || settings["project.name"] || "",
    required: true,
  });

  const requiredMissing = steps.filter((step) => step.required && !step.ok);
  const notes = steps.filter((step) => !step.required && !step.ok);
  return {
    ok: requiredMissing.length === 0,
    steps,
    discovered,
    requiredMissing: requiredMissing.map((step) => step.key),
    // Замечания — то, что не мешает циклу. Пульт показывает их спокойно, а не
    // ✕: иначе «работает» и «сломано» выглядят одинаково.
    notes: notes.map((step) => `${step.key}: ${step.why}`),
    advancedLeftToDefaults: Object.keys(SETTINGS).filter((key) => SETTINGS[key].group === "advanced").length,
    why: requiredMissing.length
      ? requiredMissing.map((step) => `${step.key}: ${step.why}`).join("; ")
      : notes.length
        ? `цикл можно запускать; ключи и ID вводить не нужно. Замечание: ${notes.map((step) => `${step.key} — ${step.why}`).join("; ")}`
        : "всё, что нужно циклу, найдено; ключи и ID вводить не нужно",
  };
}

/**
 * Проверка готовности перед запуском: то, что человек увидит вместо падения.
 *
 * `sheets` — имена листов, которые реально есть в книге (`store.meta()`).
 * Проверка появилась в 1.24.0 после того, как выяснилось: книга владельца жила
 * без листа «Экземпляры» с 1.20.0, а готовность этого не замечала. Цена
 * молчания — адрес созданного агента некуда записать, и каждая карточка роли
 * заново требует создания. Теперь недостающий лист назван, а не потерян.
 *
 * Отсутствие `sheets` (старый вызов, демо) проверку не включает: молчаливое
 * «всё хорошо» здесь честнее ложной тревоги.
 */
export function readiness({ settings = {}, slots = [], sheets = null, notes: extraNotes = [] } = {}) {
  const problems = [];
  const notes = [...extraNotes];
  // Справочник ролей — улучшение, а не условие: без него административность
  // берётся из строки очереди, а адрес агента — из «Экземпляров». Пока это
  // считалось отказом, пульт объявлял неготовым исправный цикл.
  if (!settings["notion.rolesDb"]) {
    notes.push("справочник ролей в Notion не подключён: роль и функция берутся из строки очереди — цикл работает");
  }
  // «Слоты» в Notion не нужны с тех пор, как слоты переехали в книгу: ключ
  // остаётся в реестре для старых книг, но готовность от него не зависит.

  const active = slots.filter((slot) => slot.enabled);
  if (!active.length) problems.push("нет ни одного активного слота: цикл некому работать");
  if (!active.some((slot) => slot.admin)) problems.push("нет административного слота: Координатору негде жить");
  if (!active.some((slot) => !slot.admin)) problems.push("нет рабочего слота: исполнительские роли некуда выдавать");
  if (Array.isArray(sheets) && sheets.length) {
    const have = new Set(sheets.map((name) => norm(name)));
    // «Состояние» в списке нет намеренно: служба его не читает и не пишет —
    // единственная строка состояния живёт в «Настройках». Требовать лист,
    // которого никто не касается, значит слать владельца делать работу без
    // результата (и ровно этим пугала строка запуска).
    const missing = Object.entries(SHEETS)
      .filter(([key]) => key !== "state")
      .map(([, sheet]) => sheet.name)
      .filter((name) => !have.has(norm(name)));
    if (missing.length) {
      problems.push(`в книге нет листов: ${missing.join(", ")} — служба создаст их при первом чтении, но проверьте доступ`);
    }
  }
  const audit = auditSettings();
  problems.push(...audit);
  return { ok: problems.length === 0, problems, notes };
}

/**
 * Применение плана: запись в лист «Настройки».
 *
 * Пишется только то, что найдено. Ключ, который не нашёлся, не затирается
 * пустотой — иначе мастер случайно стёр бы рабочую настройку.
 */
export async function applySetup({ store, plan, now = () => Date.now() }) {
  if (!plan?.ok) return { ok: false, why: plan?.why || "план не готов" };
  const { rows } = await store.read("settings");
  const existing = new Map();
  for (const row of rows) {
    const key = String(row?.[0] ?? "").trim();
    if (key) existing.set(key, row);
  }
  const writes = [];
  for (const [key, value] of Object.entries(plan.discovered)) {
    const row = existing.get(key);
    const spec = SETTINGS[key] || { type: "text", group: "basic", default: "" };
    const cells = [key, String(value), spec.type, spec.group, String(spec.default), spec.description || ""];
    if (row) writes.push({ key, row: cells });
    else writes.push({ key, append: cells });
  }
  for (const write of writes) {
    if (write.append) await store.append("settings", [write.append]);
    else {
      const index = [...existing.keys()].indexOf(write.key) + 2;
      await store.updateRange("settings", index, [write.row]);
    }
  }
  return { ok: true, written: writes.map((write) => write.key), at: new Date(now()).toISOString() };
}

/** Какие ключи мастер вообще вправе заполнять сам. */
export const discoverableKeys = () => basicKeys().filter((key) => key !== "cycle.mode");
