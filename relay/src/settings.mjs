// Настройки проекта: база и расширенные.
//
// Владелец просил «разделить на дефолтные и расширенные, чтобы без
// необходимости не лезть». Здесь это доведено до правила, а не до раскладки
// полей по двум экранам:
//
//   basic     — то, без чего цикл не работает, или то, что должно получаться
//               само (мастер настройки, автопоиск баз и папок).
//   advanced  — редкое и опасное: таймауты, пределы, ручные переопределения.
//
// Инвариант, который проверяется тестом: **в advanced нет ни одного ключа,
// без которого цикл не запустится**. Если такой ключ появляется — он обязан
// переехать в basic или получить значение по умолчанию при первой записи.

import { arrayToMap } from "./util.mjs";

/**
 * Реестр ключей.
 *
 * `default` обязателен для всех: расширенные настройки не должны требовать
 * ввода, иначе «туда можно не лезть» превращается в «туда придётся лезть».
 */
export const SETTINGS = {
  "project.name": { group: "basic", type: "text", default: "" },
  "notion.rolesDb": { group: "basic", type: "text", default: "" },
  "notion.slotsDb": { group: "basic", type: "text", default: "" },
  "notion.requestsDb": { group: "basic", type: "text", default: "" },
  "drive.logsFolderId": { group: "basic", type: "text", default: "" },
  "ntfy.topic": { group: "basic", type: "text", default: "" },

  "cycle.mode": { group: "basic", type: "enum", values: ["manual", "auto"], default: "auto" },
  "cycle.maxParallel": { group: "advanced", type: "number", default: 2, min: 1, max: 8 },
  // Предел одновременных выдач одной роли. По умолчанию 1: агенты одной роли
  // делят файлы и оракул, и «параллельно быстрее» здесь означает «дороже».
  // Поднимать имеет смысл только для роли, которая точно не пересекается по
  // файлам с другой работой той же роли.
  "cycle.maxPerRole": { group: "advanced", type: "number", default: 1, min: 1, max: 8 },
  "cycle.slotIdleMs": { group: "advanced", type: "number", default: 180000, min: 60000 },
  "cycle.tickMs": { group: "advanced", type: "number", default: 5000, min: 1000 },
  // Ход цикла (D-025): кто держит очередь решений. `coordinator` — рабочий и
  // планирующий ходы, `warden` — приёмка (next: "done" от Координатора),
  // `done` — миссия принята, цикл стоит. Пишется службой по маркерам.
  "cycle.turn": { group: "basic", type: "enum", values: ["coordinator", "warden", "done"], default: "coordinator" },
  // Круг доработок приёмки: счётчик возвратов. Лимит — 3, как во вкладке:
  // четвёртый возврат будит Мастера (пауза с причиной).
  "cycle.round": { group: "advanced", type: "number", default: 0, min: 0, max: 99 },

  "net.gmTimeoutMs": { group: "advanced", type: "number", default: 45000, min: 5000 },
  "net.notionTimeoutMs": { group: "advanced", type: "number", default: 8000, min: 2000 },
  "net.ntfyTimeoutMs": { group: "advanced", type: "number", default: 15000, min: 2000 },
  "net.retryWaitsMs": { group: "advanced", type: "text", default: "800,2500,6000" },

  "guard.busySilenceMs": { group: "advanced", type: "number", default: 120000, min: 30000 },
  "guard.stepRestarts": { group: "advanced", type: "number", default: 3, min: 1 },

  "incident.windowMs": { group: "advanced", type: "number", default: 600000, min: 60000 },
  "incident.maxEvents": { group: "advanced", type: "number", default: 400, min: 50 },

  "transport.version": { group: "basic", type: "text", default: "1.25.0" },
};

/** Ключи, без которых цикл не работает: они обязаны быть в basic. */
export const REQUIRED_KEYS = ["project.name", "notion.rolesDb"];

const toNumber = (value, fallback) => {
  const n = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : fallback;
};

/** Приведение значения по типу ключа. */
export function coerceSetting(key, value) {
  const spec = SETTINGS[key];
  if (!spec) return String(value ?? "");
  if (spec.type === "number") {
    const n = toNumber(value, spec.default);
    const min = spec.min ?? -Infinity;
    const max = spec.max ?? Infinity;
    return Math.min(max, Math.max(min, n));
  }
  if (spec.type === "enum") {
    const text = String(value ?? "").trim();
    return spec.values.includes(text) ? text : spec.default;
  }
  return String(value ?? "").trim();
}

/**
 * Разбор листа «Настройки» в плоскую карту.
 *
 * Значение из таблицы главнее значения по умолчанию, кроме случая, когда
 * ячейка пуста и у ключа есть непустой default: пустая ячейка означает
 * «не трогали», а не «сотри».
 */
export function parseSettings(rows) {
  const map = arrayToMap(rows);
  const values = {};
  for (const key of Object.keys(SETTINGS)) {
    const spec = SETTINGS[key];
    const raw = map[key];
    values[key] = raw === undefined || raw === "" ? spec.default : coerceSetting(key, raw);
  }
  // Ключи, которых нет в реестре, сохраняем как есть: так мастер настройки
  // может пометить шаг пройденным, не расширяя код.
  for (const [key, value] of Object.entries(map)) {
    if (!(key in values)) values[key] = value;
  }
  return values;
}

/** Строки для записи в лист «Настройки». */
export function settingsRows(values = {}) {
  return Object.entries(SETTINGS).map(([key, spec]) => [
    key,
    String(values[key] ?? spec.default),
    spec.type,
    spec.group,
    String(spec.default),
    spec.description || "",
  ]);
}

export const basicKeys = () => Object.keys(SETTINGS).filter((key) => SETTINGS[key].group === "basic");
export const advancedKeys = () => Object.keys(SETTINGS).filter((key) => SETTINGS[key].group === "advanced");

/**
 * Самопроверка реестра. Возвращает список нарушений, пустой список — всё в порядке.
 *
 * Проверяются ровно те обещания, которые даны владельцу: расширенные настройки
 * необязательны, у всего есть значение по умолчанию, обязательные ключи лежат
 * в базе, а не в расширенных.
 */
export function auditSettings() {
  const problems = [];
  for (const [key, spec] of Object.entries(SETTINGS)) {
    if (spec.type === "number" && typeof spec.default !== "number") {
      problems.push(`${key}: числовой ключ без числового значения по умолчанию`);
    }
    if (spec.type === "enum" && !spec.values.includes(spec.default)) {
      problems.push(`${key}: значение по умолчанию «${spec.default}» не из списка`);
    }
    if (spec.type !== "number" && (spec.default === undefined || spec.default === null)) {
      problems.push(`${key}: нет значения по умолчанию`);
    }
  }
  for (const key of REQUIRED_KEYS) {
    if (!SETTINGS[key]) problems.push(`${key}: обязательный ключ отсутствует в реестре`);
    else if (SETTINGS[key].group !== "basic") problems.push(`${key}: обязательный ключ должен быть в basic, а он ${SETTINGS[key].group}`);
  }
  for (const key of advancedKeys()) {
    const spec = SETTINGS[key];
    if (spec.group !== "advanced") continue;
    if (spec.default === undefined || spec.default === "") {
      problems.push(`${key}: расширенная настройка без значения по умолчанию — туда придётся лезть`);
    }
  }
  return problems;
}
