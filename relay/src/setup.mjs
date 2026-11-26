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
export function pickDatabase(results, title) {
  const wanted = norm(title);
  const hits = (results || []).filter((item) => norm(item?.title) === wanted);
  if (!hits.length) {
    const similar = (results || []).filter((item) => norm(item?.title).includes(wanted)).map((item) => item.title);
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
export function planSetup({ projectName = "", settings = {}, databases = [], gateway = null } = {}) {
  const steps = [];
  const discovered = {};

  const roles = pickDatabase(databases, "Роли");
  steps.push({
    key: "notion.rolesDb",
    ok: roles.ok,
    why: roles.ok ? `найдена база «Роли»` : roles.why,
    value: roles.ok ? roles.id : "",
    required: true,
  });
  if (roles.ok) discovered["notion.rolesDb"] = roles.id;

  const slots = pickDatabase(databases, "Слоты");
  steps.push({
    key: "notion.slotsDb",
    ok: slots.ok,
    why: slots.ok ? "найдена база «Слоты»" : slots.why,
    value: slots.ok ? slots.id : "",
    required: true,
    hint: slots.ok ? "" : "создайте базу «Слоты» под той же страницей, что «Роли»",
  });
  if (slots.ok) discovered["notion.slotsDb"] = slots.id;

  const requests = pickDatabase(databases, "Запросы");
  steps.push({
    key: "notion.requestsDb",
    ok: requests.ok,
    why: requests.ok ? "найдена база «Запросы»" : requests.why,
    value: requests.ok ? requests.id : "",
    required: false,
  });
  if (requests.ok) discovered["notion.requestsDb"] = requests.id;

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
  return {
    ok: requiredMissing.length === 0,
    steps,
    discovered,
    requiredMissing: requiredMissing.map((step) => step.key),
    // Все расширенные настройки остаются по умолчанию: «туда можно не заходить».
    advancedLeftToDefaults: Object.keys(SETTINGS).filter((key) => SETTINGS[key].group === "advanced").length,
    // Причина называется дословно: «баз с названием две» и «базы нет» требуют
    // разных действий человека, и склеивать их в «не хватает» бесполезно.
    why: requiredMissing.length
      ? requiredMissing.map((step) => `${step.key}: ${step.why}`).join("; ")
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
export function readiness({ settings = {}, slots = [], sheets = null } = {}) {
  const problems = [];
  if (!settings["notion.rolesDb"]) problems.push("не найдена база «Роли» — запустите мастер настройки");
  if (!settings["notion.slotsDb"]) problems.push("не найдена база «Слоты» — запустите мастер настройки");
  const active = slots.filter((slot) => slot.enabled);
  if (!active.length) problems.push("нет ни одного активного слота: цикл некому работать");
  if (!active.some((slot) => slot.admin)) problems.push("нет административного слота: Координатору негде жить");
  if (!active.some((slot) => !slot.admin)) problems.push("нет рабочего слота: исполнительские роли некуда выдавать");
  if (Array.isArray(sheets) && sheets.length) {
    const have = new Set(sheets.map((name) => norm(name)));
    const missing = Object.values(SHEETS).map((sheet) => sheet.name).filter((name) => !have.has(norm(name)));
    if (missing.length) {
      problems.push(`в книге нет листов: ${missing.join(", ")} — служба создаст их при первом чтении, но проверьте доступ`);
    }
  }
  const audit = auditSettings();
  problems.push(...audit);
  return { ok: problems.length === 0, problems };
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
