// Пакет инцидента для Transport Maintainer'а.
//
// Требование владельца: «при передаче хода он должен получать больше
// информации, чем сейчас, как минимум видеть лог и что нажимает пользователь».
// Отсюда форма передачи: не абзац текста, а пакет с фиксированными разделами,
// который одинаково читается и человеком, и агентом.
//
// Ключевое отличие от прежней передачи: раньше Maintainer получал последние
// 12 строк журнала одной вкладки. Теперь — окно событий ±N минут из всех
// слотов, отдельную дорожку действий человека и таблицу всех живых выдач.
// Именно последняя закрывает случай «исполнитель написал не тот run id»:
// проверить, чей это run, было нечем.

import { incidentWindow, splitLanes, eventLine } from "./events.mjs";
import { isLiveRun } from "./queue.mjs";

const norm = (value) => String(value ?? "").trim();

/** Раздел «кто где»: что сейчас в воздухе и на каком слоте. */
export function liveRunsTable(runs = []) {
  const live = runs.filter(isLiveRun);
  if (!live.length) return ["Живых выдач нет."];
  const lines = ["| Run ID | Карточка | Слот | Роль | Выдан | Последняя жизнь |", "|---|---|---|---|---|---|"];
  for (const run of live) {
    lines.push(
      `| ${norm(run["Run ID"])} | ${norm(run["Карточка"]).slice(0, 8)}… | ${norm(run["Слот"])} | ` +
      `${norm(run["Роль"])} | ${norm(run["Выдан"]).slice(11, 19)} | ${norm(run["Последняя жизнь"]).slice(11, 19)} |`,
    );
  }
  return lines;
}

/**
 * Проверка «чей это run id» — та самая, которой не хватало.
 *
 * Возвращает не «да/нет», а объяснение: найден, не найден, найден но закрыт,
 * либо принадлежит другой карточке. Для Maintainer'а это разные поломки.
 */
export function runIdVerdict(runs, { runId = "", card = "" } = {}) {
  const wanted = norm(runId);
  if (!wanted) return { verdict: "missing", text: "в маркере нет run id" };
  const hit = runs.find((run) => norm(run["Run ID"]) === wanted);
  if (!hit) {
    const partial = runs.filter((run) => norm(run["Run ID"]).includes(wanted.slice(0, 8)) && wanted.length >= 8);
    if (partial.length === 1) {
      return {
        verdict: "mismatch",
        text: `run id ${wanted} не найден, но похож на ${norm(partial[0]["Run ID"])}: похоже, исполнитель исказил идентификатор`,
        run: partial[0],
      };
    }
    return { verdict: "unknown", text: `run id ${wanted} не найден ни в одной выдаче` };
  }
  const status = norm(hit["Статус"]);
  if (card && norm(hit["Карточка"]) !== norm(card)) {
    return {
      verdict: "foreign",
      text: `run id ${wanted} принадлежит карточке ${norm(hit["Карточка"])}, а не ${norm(card)}`,
      run: hit,
    };
  }
  if (!isLiveRun(hit)) {
    return {
      verdict: "closed",
      text: `run id ${wanted} найден, но выдача уже ${status}: ответ пришёл повторно или с опозданием`,
      run: hit,
    };
  }
  return { verdict: "ok", text: `run id ${wanted} найден и жив (слот ${norm(hit["Слот"])})`, run: hit };
}

/**
 * Сборка пакета.
 *
 * `events` — уже прочитанные строки листа «События», `runs` — «Выдачи».
 * Функция чистая: сети не трогает, поэтому её поведение проверяется тестом.
 */
export function buildIncidentPackage({
  incident = {},
  events = [],
  runs = [],
  queue = [],
  slots = [],
  settings = {},
  now = Date.now(),
  windowMs = 600000,
  maxEvents = 400,
} = {}) {
  const slot = norm(incident.slot);
  const card = norm(incident.card);
  const runId = norm(incident.runId);
  const window = incidentWindow(events, {
    around: incident.atMs || now, windowMs, maxEvents, slot, runId, card,
  });
  const { ui, transport } = splitLanes(window);
  const guardWindow = incidentWindow(events, {
    around: incident.atMs || now, windowMs, maxEvents: 60, slot, kinds: ["guard", "net"],
  });
  const idVerdict = runIdVerdict(runs, { runId, card });
  const hanging = queue.filter((item) => norm(item["Статус"]) === "blocked");

  const lines = [
    `ПАКЕТ ИНЦИДЕНТА · ${incident.kind || "не назван"}${incident.cls ? ` · класс ${incident.cls}` : ""}`,
    `Слот: ${slot || "не определён"}; карточка: ${card || "—"}; run: ${runId || "—"}.`,
    `Остановка: ${norm(incident.reason) || "причина не названа"}.`,
    incident.expectedRunId
      ? `Транспорт ждал run ${incident.expectedRunId}: ${runIdVerdict(runs, { runId: incident.expectedRunId, card }).text}.`
      : "",
    "",
    "## Что видел пользователь (действия в пульте)",
    ...(ui.length ? ui.map((event) => eventLine(event)) : ["Действий человека в окне инцидента нет."]),
    "",
    "## Что делал транспорт",
    ...(transport.length ? transport.map((event) => eventLine(event)) : ["Событий транспорта в окне нет."]),
    "",
    "## Сторожевые и сетевые срабатывания (окно 120 с по busyAt)",
    ...(guardWindow.length ? guardWindow.map((event) => eventLine(event)) : ["Не срабатывали."]),
    "",
    "## Чей это run id",
    idVerdict.text,
    "",
    "## Все живые выдачи (проверка «а чей это run»)",
    ...liveRunsTable(runs),
    "",
    "## Очередь на момент разбора",
    hanging.length
      ? hanging.map((item) => `удержано: ${norm(item["Карточка"]).slice(0, 8)}… ${norm(item["Роль"])} — ${norm(item["Комментарий"])}`).join("\n")
      : "Удержанных строк нет.",
    "",
    "## Слоты",
    ...(slots.length
      ? slots.map((item) => `${item.slotId}${item.admin ? " (адм.)" : ""}: ${item.container || "?"} / ${item.account || "?"} — ${item.status}`)
      : ["Слотов не найдено."]),
    "",
    `Сборка ${settings["transport.version"] || settings.transportVersion || "?"}; событий в пакете: ${window.length} из ${events.length}; окно ${Math.round(windowMs / 60000)} мин.`,
    "",
    "Правило ответа: первой строкой FIXED <что исправлено> либо NOTFIXED <почему>. Коммит и установку делает Мастер (D-027).",
  ];

  return {
    text: lines.filter((line) => line !== "" || true).join("\n").replace(/\n{3,}/g, "\n\n"),
    facts: {
      slot, card, runId,
      runIdVerdict: idVerdict.verdict,
      events: window.length,
      uiEvents: ui.length,
      transportEvents: transport.length,
      guardEvents: guardWindow.length,
      liveRuns: runs.filter(isLiveRun).length,
      blocked: hanging.length,
      windowMs,
    },
    idVerdict,
  };
}
