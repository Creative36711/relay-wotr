// Пульт. Никакой сборки и никаких зависимостей, кроме marked: страница должна
// открываться, даже когда транспорт сломан, иначе чинить будет нечем.
//
// Правило, которое здесь соблюдается: пульт ничего не решает. Он показывает
// снимок службы и отправляет действия. Всё, что похоже на решение (кого куда
// выдать, кто свободен, что считать инцидентом), живёт в службе — иначе два
// открытых пульта начнут расходиться в поведении.

const $ = (id) => document.getElementById(id);

const post = async (path, body) => {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  return response.json();
};

let snapshot = null;
let busy = false;

const fmtTime = (iso) => (iso || "").replace("T", " ").replace("Z", "").slice(0, 19);
const shortId = (id) => String(id || "").slice(0, 10);

function banner(text) {
  const node = $("banner");
  if (!text) {
    node.classList.add("hidden");
    return;
  }
  node.textContent = text;
  node.classList.remove("hidden");
}

function renderSlots(shot) {
  const host = $("slots");
  host.innerHTML = "";
  $("counts").textContent =
    `в работе ${shot.counts.inFlight} · в очереди ${shot.counts.waiting} · удержано ${shot.counts.blocked} · активных ${shot.counts.slots}`;
  for (const slot of shot.slots) {
    const node = document.createElement("div");
    node.className = `slot${slot.runs.length ? " busy" : ""}${slot.admin ? " admin" : ""}`;
    const runs = slot.runs.length
      ? slot.runs.map((run) => `<div class="run">${shortId(run.runId)} · ${escapeHtml(run.title || run.card)} · ${escapeHtml(run.role)}</div>`).join("")
      : `<div class="meta">свободен</div>`;
    node.innerHTML = `
      <div class="row space">
        <span class="name">${escapeHtml(slot.slotId)}${slot.admin ? " · адм." : ""}</span>
        <span class="meta">${escapeHtml(slot.state)}</span>
      </div>
      <div class="meta">${escapeHtml(slot.container || "контейнер не назван")} · ${escapeHtml(slot.account || "аккаунт не назван")}</div>
      ${runs}`;
    host.append(node);
  }
}

function renderQueue(shot) {
  const host = $("queue");
  host.innerHTML = "";
  const select = $("queue-slot");
  const current = select.value;
  select.innerHTML = `<option value="">слот подберётся</option>` +
    shot.slots.map((slot) => `<option value="${slot.slotId}">${escapeHtml(slot.slotId)}${slot.admin ? " (адм.)" : ""}</option>`).join("");
  select.value = current;

  if (!shot.queue.length) {
    host.innerHTML = `<div class="muted">Очередь пуста. Работа появляется здесь, когда Координатор ставит карточку.</div>`;
    return;
  }
  for (const item of shot.queue) {
    const node = document.createElement("div");
    node.className = "item";
    node.innerHTML = `
      <span>${escapeHtml(item["Заголовок"] || item["Карточка"])}
        <span class="tag">${escapeHtml(item["Роль"])} · ${escapeHtml(item["Статус"])}${item["Взял слот"] ? ` · ${escapeHtml(item["Взял слот"])}` : ""}</span>
      </span>
      <span class="row">
        <button data-cancel="${item["ID"]}" class="ghost">снять</button>
      </span>`;
    host.append(node);
  }
  for (const button of host.querySelectorAll("[data-cancel]")) {
    button.onclick = async () => {
      await post("/api/control", { action: "cancel", itemId: button.dataset.cancel });
      await refresh();
    };
  }
}

function renderEvents(shot) {
  const host = $("events");
  const filter = $("event-filter").value;
  const shown = shot.events.filter((event) => !filter || event.kind === filter);
  host.innerHTML = "";
  $("event-note").textContent = `${shown.length} из ${shot.events.length}`;
  for (const event of shown) {
    const row = document.createElement("li");
    row.className = event.level === "error" ? "error" : event.level === "warn" ? "warn" : event.kind === "ui" ? "ui" : "";
    const where = [event.slot, event.tab ? `#${event.tab}` : ""].filter(Boolean).join(" ");
    row.textContent = `${fmtTime(event.at).slice(11)} ${where ? `[${where}] ` : ""}${event.text}`;
    host.append(row);
  }
}

function renderHeader(shot) {
  $("health-dot").className = "dot ok";
  // Демо-режим называется в шапке, а не угадывается по пустому журналу.
  // Служба без книги выглядит живой: слоты есть, счётчики есть, и «почему
  // здесь не мои данные» человек ищет в книге, а не в строке запуска.
  $("mode-line").textContent =
    `${shot.mode === "auto" ? "автоцикл" : "ручной шаг"} · предел ${shot.maxParallel}` +
    (shot.paused ? " · на паузе" : "") +
    (shot.demo ? " · ДЕМО (книга не подключена)" : "");
  $("btn-mode").textContent = shot.mode === "auto" ? "Ручной шаг" : "Автоцикл";
  $("btn-pause").textContent = shot.paused ? "Продолжить" : "Пауза";
  if (shot.paused) banner(`Пауза: ${shot.pauseReason || "по решению человека"}`);
  else if (shot.lastStep) banner("");
}

function escapeHtml(text) {
  return String(text ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

async function refresh() {
  try {
    const response = await fetch("/api/snapshot", { cache: "no-store" });
    const shot = await response.json();
    if (!response.ok || shot.ok === false) throw new Error(shot.why || `HTTP ${response.status}`);
    snapshot = shot;
    renderHeader(shot);
    renderSetupHint(shot);
    renderSlots(shot);
    renderQueue(shot);
    renderEvents(shot);
  } catch (error) {
    $("health-dot").className = "dot bad";
    banner(`Служба не отвечает: ${error.message}\nПроверьте, что процесс запущен и что таблица состояния доступна.`);
  }
}

async function step() {
  if (busy) return;
  busy = true;
  $("btn-step").disabled = true;
  try {
    await post("/api/control", { action: "ui", text: "нажат «Шаг»" });
    const result = await post("/api/control", { action: "step", origin: "panel" });
    if (result.ok === false) banner(result.why);
    else if (result.planned === 0) banner(`Выдач не было: ${result.why}`);
    else banner(`Запланировано выдач: ${result.planned}`);
  } finally {
    busy = false;
    $("btn-step").disabled = false;
    await refresh();
  }
}

/**
 * Текст над мастером. В демо он не повторяет «ключи подставляются сами»:
 * подставлять некуда, и совет читается как «ещё немного, и найдётся».
 */
function renderSetupHint(shot) {
  const hint = $("setup-hint");
  if (!hint) return;
  hint.textContent = shot.demo
    ? "Служба запущена в демо-режиме: книга не подключена, поэтому базы Notion искать негде. " +
      "Остановите транспорт, положите рядом ключ sa.json и запустите Запустить транспорт.bat заново."
    : "Ключи и ID подставляются сами: мастер находит базы в Notion и папку логов в Drive. " +
      "Расширенные настройки трогать не нужно — без них цикл работает.";
}

async function discover() {
  $("setup-note").textContent = "ищу базы…";
  const result = await post("/api/control", { action: "setup" });
  const host = $("setup-steps");
  host.innerHTML = "";
  for (const item of result.steps || []) {
    const node = document.createElement("div");
    node.className = `step ${item.ok ? "ok" : "bad"}`;
    node.innerHTML = `<span class="mark">${item.ok ? "✓" : "✕"}</span>
      <span><span class="key">${escapeHtml(item.key)}</span> — ${escapeHtml(item.why)}${item.hint ? ` <span class="muted">(${escapeHtml(item.hint)})</span>` : ""}</span>`;
    host.append(node);
  }
  $("setup-note").textContent = result.ok
    ? `готово, записано: ${(result.written || []).join(", ") || "ничего нового"}`
    : result.why || "не всё найдено";
  await refresh();
}

function bind() {
  $("btn-step").onclick = step;
  $("btn-refresh").onclick = refresh;
  $("btn-pause").onclick = async () => {
    const paused = snapshot?.paused;
    await post("/api/control", { action: "ui", text: paused ? "нажато «Продолжить»" : "нажата «Пауза»" });
    await post("/api/control", { action: paused ? "resume" : "pause", reason: "кнопка пульта" });
    await refresh();
  };
  $("btn-mode").onclick = async () => {
    const next = snapshot?.mode === "auto" ? "manual" : "auto";
    await post("/api/control", { action: "ui", text: `переключён режим: ${next}` });
    await post("/api/control", { action: "mode", mode: next });
    await refresh();
  };
  $("btn-discover").onclick = discover;
  $("event-filter").onchange = () => snapshot && renderEvents(snapshot);
  $("btn-enqueue").onclick = async () => {
    const card = $("queue-card").value.trim();
    if (!card) return;
    await post("/api/control", {
      action: "enqueue",
      card,
      title: $("queue-title").value.trim(),
      role: $("queue-role").value.trim(),
      slotId: $("queue-slot").value,
    });
    $("queue-card").value = "";
    $("queue-title").value = "";
    await refresh();
  };
  $("btn-close-incident").onclick = () => $("incident-dialog").close();
}

bind();
refresh();
setInterval(refresh, 5000);
