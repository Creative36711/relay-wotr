// Журнал событий — единый для всех вкладок и всех слотов.
//
// Зачем он вместо прежнего журнала в браузере. Прежний жил в `GM_setValue`
// одной вкладки, был кольцевым буфером на 200 строк и не содержал действий
// человека. Поэтому разбор поломки начинался с нуля: к моменту, когда ход
// уходил Maintainer'у, нужные строки уже были вытеснены, а из другой вкладки
// их не было видно вообще.
//
// Здесь пишут все, и у каждой записи есть источник: слот, аккаунт, вкладка.
// Дорожка UI отделена от дорожки транспорта намеренно — «нажал Пауза» и
// «notion не ответил» это разные факты, и путать их в одном тексте нельзя.

import { rowToObject, objectToRow } from "./schema.mjs";

/** Виды событий. Список закрытый, чтобы фильтры в пульте были осмысленными. */
export const EVENT_KINDS = [
  "ui",        // действие человека: шаг, пауза, автоцикл, настройки
  "tick",      // шаг цикла: начался, чем кончился
  "queue",     // очередь: поставлено, взято, освобождено
  "dispatch",  // выдача: отправлено, доставлено, подтверждено
  "reply",     // ответ агента: прочитан, разобран, дефект маркера
  "marker",    // разбор маркера: успех и конкретный дефект
  "net",       // сеть: таймаут, повтор, отказ
  "guard",     // сторож: busyAt, зависание, перезапуск
  "accounts",  // аккаунты: лимит, чужой контейнер, сверка почты
  "incident",  // передача Maintainer'у: собрано, отправлено, ответ
  "state",     // состояние: блокировка, захват, смена режима
];

export const EVENT_LEVELS = ["info", "warn", "error"];

/**
 * Безопасная сериализация данных события.
 *
 * Данные не должны ронять запись: если внутри есть циклическая ссылка или
 * слишком длинный текст, лучше усечь, чем потерять само событие.
 */
export function packData(data, limit = 2000) {
  if (data === undefined || data === null) return "";
  try {
    const text = typeof data === "string" ? data : JSON.stringify(data);
    return text.length > limit ? `${text.slice(0, limit)}…` : text;
  } catch {
    return String(data).slice(0, limit);
  }
}

/**
 * Запись события.
 *
 * `tab` — короткий идентификатор вкладки внутри слота (последние 4 знака
 * случайного id): по нему видно, что два события пришли из разных окон.
 */
export function makeEvent({
  at = new Date().toISOString(),
  slot = "",
  account = "",
  tab = "",
  kind = "state",
  level = "info",
  text = "",
  card = "",
  runId = "",
  durationMs = "",
  data = null,
} = {}) {
  return rowToObject("events", objectToRow("events", {
    "Время": at,
    "Слот": slot,
    "Аккаунт": account,
    "Вкладка": tab,
    "Вид": EVENT_KINDS.includes(kind) ? kind : "state",
    "Уровень": EVENT_LEVELS.includes(level) ? level : "info",
    "Текст": String(text || "").slice(0, 900),
    "Карточка": card,
    "Run ID": runId,
    "Длительность мс": durationMs,
    "Данные": packData(data),
  }));
}

/** Разбор строк листа в объекты событий. Пустые строки пропускаются. */
export function parseEvents(rows) {
  return (rows || [])
    .map((row) => rowToObject("events", row))
    .filter((event) => event["Время"])
    .map((event) => ({
      at: event["Время"],
      slot: event["Слот"],
      account: event["Аккаунт"],
      tab: event["Вкладка"],
      kind: event["Вид"],
      level: event["Уровень"],
      text: event["Текст"],
      card: event["Карточка"],
      runId: event["Run ID"],
      durationMs: event["Длительность мс"],
      data: event["Данные"],
      atMs: Date.parse(event["Время"]) || 0,
    }));
}

/**
 * Отбор событий для пакета инцидента.
 *
 * Правило отбора — не «последние N», а «окно вокруг момента». Иначе самая
 * полезная часть (что происходило за минуту до поломки) вытесняется тем, что
 * случилось после.
 *
 * Приоритет при переполнении: ошибки и предупреждения сохраняются первыми,
 * затем записи с совпадающим слотом или run id — именно они объясняют поломку.
 */
export function incidentWindow(events, {
  around = Date.now(),
  windowMs = 600000,
  maxEvents = 400,
  slot = "",
  runId = "",
  card = "",
  kinds = null,
} = {}) {
  const from = around - windowMs;
  const to = around + windowMs;
  const inWindow = events.filter((event) => {
    if (!event.atMs) return false;
    if (event.atMs < from || event.atMs > to) return false;
    if (Array.isArray(kinds) && kinds.length && !kinds.includes(event.kind)) return false;
    return true;
  });
  const weight = (event) => {
    let score = 0;
    if (event.level === "error") score += 100;
    else if (event.level === "warn") score += 40;
    if (runId && event.runId === runId) score += 60;
    if (card && event.card === card) score += 50;
    if (slot && event.slot === slot) score += 20;
    // Ближе к моменту — полезнее.
    score += Math.max(0, 30 - Math.abs(event.atMs - around) / 20000);
    return score;
  };
  const kept = inWindow.length > maxEvents
    ? [...inWindow].sort((a, b) => weight(b) - weight(a)).slice(0, maxEvents)
    : inWindow;
  return kept.sort((a, b) => a.atMs - b.atMs);
}

/**
 * Дорожки для человека и для Maintainer'а.
 *
 * `ui` и `transport` разделены: в разборе первое отвечает на «что делал
 * человек», второе — «что делал транспорт». Смешанный текст читается хуже и
 * провоцирует неверный вывод («нажали паузу» вместо «notion не ответил»).
 */
export function splitLanes(events) {
  const ui = [];
  const transport = [];
  for (const event of events) {
    if (event.kind === "ui") ui.push(event);
    else transport.push(event);
  }
  return { ui, transport };
}

/** Короткая строка для ленты пульта. */
export function eventLine(event) {
  const where = [event.slot, event.tab ? `#${event.tab}` : ""].filter(Boolean).join(" ");
  const mark = event.level === "error" ? "✕" : event.level === "warn" ? "!" : "·";
  return `${mark} ${event.at.slice(11, 19)} ${where ? `[${where}] ` : ""}${event.text}`;
}
