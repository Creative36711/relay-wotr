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

/**
 * Понятная запись журнала.
 *
 * Владелец читает журнал как хронологию поломок: «сеть до Notion», «мастер
 * настройки: не всё найдено». Эти строки писались для нас, а не для него.
 * Переводим в действия: что случилось и что из этого следует.
 */
function plainEvent(event) {
  const text = String(event.text || "");
  const kind = String(event.kind || event["Вид"] || "");
  if (/сеть до Notion/.test(text)) return { tone: "warn", text: `Проверка сети: ${text.replace(/^сеть до Notion:\s*/, "")}` };
  if (/мастер настройки: не всё найдено/.test(text)) return { tone: "warn", text: "Настройка: мастер нашёл не всё (подробности — в списке шагов)" };
  if (/мастер настройки: готово/.test(text)) return { tone: "ok", text: "Настройка: ключи найдены и записаны" };
  if (/роли перенесены в книгу/.test(text)) return { tone: "ok", text: text[0].toUpperCase() + text.slice(1) };
  if (/токен Notion/.test(text)) return { tone: "ok", text: text[0].toUpperCase() + text.slice(1) };
  if (kind === "ui" && /нажат|нажата|переключён/.test(text)) return { tone: "", text: `Вы: ${text}` };
  return { tone: "", text };
}

function renderEvents(shot) {
  const host = $("events");
  const filter = $("event-filter").value;
  const shown = shot.events.filter((event) => !filter || event.kind === filter);
  host.innerHTML = "";
  $("event-note").textContent = `${shown.length} из ${shot.events.length}`;
  for (const event of shown) {
    const row = document.createElement("li");
    const plain = plainEvent(event);
    const tone = plain.tone || (event.level === "error" ? "error" : event.level === "warn" ? "warn" : event.kind === "ui" ? "ui" : "");
    row.className = tone;
    const where = [event.slot, event.tab ? `#${event.tab}` : ""].filter(Boolean).join(" ");
    row.textContent = `${fmtTime(event.at).slice(11)} ${where ? `[${where}] ` : ""}${plain.text}`;
    host.append(row);
  }
}

function renderHeader(shot) {
  $("health-dot").className = "dot ok";
  // Версия бегущего процесса, а не репозитория: GitHub Desktop обновляет
  // файлы, но не перезапускает службу — по этой цифре видно, что именно
  // сейчас отвечает. Пусто — старая сборка без поля version в снимке.
  $("version-line").textContent = shot.version ? `v${shot.version}` : "";
  // Демо-режим называется в шапке, а не угадывается по пустому журналу.
  // Служба без книги выглядит живой: слоты есть, счётчики есть, и «почему
  // здесь не мои данные» человек ищет в книге, а не в строке запуска.
  // Ход цикла (D-025) — в строке запуска: кто держит очередь решений.
  // Названия — протокольные, не кодовые: человек читает «приёмка», а не warden.
  const turnLabels = { coordinator: "Координатор", warden: "приёмка", done: "завершён" };
  $("mode-line").textContent =
    `${shot.mode === "auto" ? "автоцикл" : "ручной шаг"} · предел ${shot.maxParallel}` +
    (shot.cycle ? ` · ход: ${turnLabels[shot.cycle.turn] || shot.cycle.turn}` : "") +
    (shot.paused ? " · на паузе" : "") +
    (shot.demo ? " · ДЕМО (книга не подключена)" : "");
  // На кнопке — то, что произойдёт по нажатию, а не текущий режим. Текущий
  // уже назван в строке выше; дублировать его на кнопке значит заставлять
  // человека проверять: «Автоцикл» — это я включил или ещё нет?
  $("btn-mode").textContent = shot.mode === "auto" ? "Остановить автоцикл" : "Включить автоцикл";
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
    if (!response.ok || shot.ok === false) {
      const error = new Error(shot.why || `HTTP ${response.status}`);
      error.network = Boolean(shot.network);
      throw error;
    }
    snapshot = shot;
    renderHeader(shot);
    renderSetupHint(shot);
    renderMountButton(shot);
    renderSlots(shot);
    renderQueue(shot);
    renderEvents(shot);
  } catch (error) {
    $("health-dot").className = "dot bad";
    // «Служба не отвечает» — неправда, когда служба отвечает и говорит, что
    // не дотянулась до книги: человек перезапускает процесс, а дело в сети.
    banner(error.network
      ? `${error.message}\nСлужба работает; не проходит запрос наружу. Нажмите «Диагностика» в настройке.`
      : `Служба не отвечает: ${error.message}\nПроверьте, что процесс запущен и что таблица состояния доступна.`);
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
    ? "Служба в демо-режиме: книга не подключена, искать в Notion нечего. " +
      "Нажмите «Код для входа в книгу» — там два поля, и демо снимется само."
    : "Ключи и ID подставляются сами: мастер находит базы в Notion и папку логов в Drive. " +
      "Расширенные настройки трогать не нужно — без них цикл работает.";
  // Поле токена нужно только пока Notion не подключён: когда он отвечает,
  // поле превращается в приглашение сломать рабочее. Прячем только поле и
  // его кнопку — строку целиком нельзя: вместе с ней исчезали «Диагностика»
  // и «Роли в книгу», а кнопка переноса ролей нужна именно после принятия
  // токена (раньше она становилась недоступной в момент успеха).
  const row = $("notion-row");
  if (row) row.style.display = shot.demo ? "none" : "";
  if (row && !shot.demo) {
    const hide = shot.notion?.ready ? "none" : "";
    $("notion-token").style.display = hide;
    $("btn-notion").style.display = hide;
  }
}

/**
 * Кнопка «Код для входа в книгу».
 *
 * Зачем кнопка, а не строка в README. Слово «вставьте код ниже» без «ниже» —
 * это тупик: владелец открывает пульт и ищет, откуда взять код. Кнопка ведёт
 * на страницу с тем же кодом, кнопкой «Скопировать» и проверкой связи.
 *
 * Видна только в демо: когда мост настроен, предлагать установку поверх
 * работающего — значит приглашать сломать рабочее.
 */
function renderMountButton(shot) {
  const button = $("btn-mount");
  if (!button) return;
  button.style.display = shot.demo ? "" : "none";
}

async function discover() {
  $("setup-note").textContent = "ищу базы…";
  const result = await post("/api/control", { action: "setup" });
  const host = $("setup-steps");
  host.innerHTML = "";
  for (const item of result.steps || []) {
    const node = document.createElement("div");
    // Три состояния, а не два: сделано, замечание (цикл работает), отказ.
    const state = item.ok ? "ok" : item.required === false ? "note" : "bad";
    node.className = `step ${state}`;
    node.innerHTML = `<span class="mark">${item.ok ? "✓" : item.required === false ? "!" : "✕"}</span>
      <span><span class="key">${escapeHtml(item.key)}</span> — ${escapeHtml(item.why)}${item.hint ? ` <span class="muted">(${escapeHtml(item.hint)})</span>` : ""}</span>`;
    host.append(node);
  }
  // Замечания не красят результат в «сломано»: цикл работает, а справочник
  // ролей или папка логов — улучшение. ✕ остаётся только для того, без чего
  // шаг не проходит.
  const notes = result.notes || [];
  const tail = notes.length ? ` Замечание: ${notes.join("; ")}` : "";
  $("setup-note").textContent = (result.ok
    ? `готово, записано: ${(result.written || []).join(", ") || "ничего нового"}`
    : result.why || "не всё найдено") + tail;
  await refresh();
}

/**
 * Токен Notion из пульта.
 *
 * Раньше единственным способом был `NOTION_TOKEN` при запуске: остановить
 * транспорт, вспомнить синтаксис set в cmd, запустить заново. Владелец
 * получает токен в Notion за десять секунд, а платил за это перезапуском.
 */
/**
 * «Проверить сеть» — без токена.
 *
 * Зачем отдельная кнопка. Когда запрос не доходит (VPN, прокси, антивирус с
 * подменой сертификата), проверка токена отвечает «не принял», и владелец идёт
 * перевыпускать рабочий ключ. Эта проверка стучится в Notion без токена и
 * называет код отказа — по нему видно, что чинить.
 */
/**
 * Диагностика по звеньям.
 *
 * Владелец пять раз получал разные тексты про сеть и ни разу — ответа.
 * Здесь вместо прозы таблица: DNS, порт, TLS, ответ Notion, книга — с
 * отметкой там, где обрыв. Один экран, один вывод, без «попробуйте ещё».
 */
async function checkNotionNet() {
  const host = $("diagnose");
  const note = $("notion-note");
  note.className = "muted";
  note.textContent = "иду по шагам…";
  try {
    const data = await (await fetch("/api/net-deep", { cache: "no-store" })).json();
    const rows = (data.steps || []).map((step) => `
      <div class="diag-row ${step.ok ? "ok" : "bad"}">
        <span class="mark">${step.ok ? "●" : "✕"}</span>
        <span class="diag-name">${escapeHtml(step.name)}</span>
        <span class="diag-detail">${escapeHtml(step.detail)}</span>
      </div>`).join("");
    const raw = data.http?.body
      ? `<details><summary>что ответил Notion дословно</summary><pre>${escapeHtml(data.http.body)}</pre></details>`
      : "";
    host.innerHTML = `<div class="diag-title">${data.ok ? "всё проходит" : "обрыв найден"}</div>${rows}
      <div class="diag-verdict">${escapeHtml(data.verdict || "")}</div>${raw}`;
    host.classList.remove("hidden");
    note.className = data.ok ? "ok" : "bad";
    note.textContent = data.ok ? "Notion доступен" : "смотрите таблицу ниже";
  } catch (error) {
    note.className = "bad";
    note.textContent = `служба не ответила: ${error.message}`;
  }
}

/**
 * «Роли в книгу».
 *
 * Один шаг, который снимает зависимость от Notion: роли переезжают в лист
 * «Роли», и цикл работает на одной книге. Пока это не сделано, недоступный
 * Notion выглядит как «ничего не настроено».
 */
async function rolesToBook() {
  const note = $("notion-note");
  note.className = "muted";
  note.textContent = "переношу роли…";
  const result = await post("/api/roles-to-book", {});
  note.className = result.ok ? "ok" : "bad";
  note.textContent = result.why || (result.ok ? "готово" : "не получилось");
  await refresh();
}

/** Замер книги: цифры вместо слова «медленно». */
async function measureBook() {
  const note = $("setup-note");
  note.textContent = "замеряю книгу…";
  try {
    const result = await (await fetch("/api/book-speed", { cache: "no-store" })).json();
    note.textContent = result.ok ? result.why : `не удалось: ${result.why}`;
  } catch (error) {
    note.textContent = `служба не ответила: ${error.message}`;
  }
}

async function setNotionToken() {
  const field = $("notion-token");
  const note = $("notion-note");
  const token = field.value.trim();
  if (!token) {
    note.className = "bad";
    note.textContent = "вставьте токен";
    return;
  }
  note.className = "muted";
  note.textContent = "проверяю…";
  const result = await post("/api/notion-token", { token });
  note.className = result.ok ? "ok" : "bad";
  note.textContent = result.why || (result.ok ? "токен принят" : "не принят");
  // Ответила чужая страница — это не сеть и не токен: запрос дошёл, но его
  // перехватили. Так и говорим, иначе человек идёт менять рабочий ключ.
  if (result.substituted) {
    note.textContent += " Сеть работает, ответ подменён посредником — поменяйте режим VPN или отключите проверку HTTPS в антивирусе.";
  }
  // Если дело в сети, токен не стираем: человек исправит сеть и нажмёт ещё
  // раз, а не будет искать, куда он его вставлял.
  if (result.ok) field.value = "";
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
    if (next === "auto") {
      // Автоцикл не делает работу сам: карточки выдаются только когда их
      // просит вкладка. Сказать об этом сразу честнее, чем оставить
      // «автоцикл» в шапке и тишину в очереди.
      banner("Автоцикл включён: транспорт будет выдавать работу сам, когда вкладка спросит. " +
        "Очередь наполняет Координатор — вручную или карточкой Notion.");
    }
    await refresh();
  };
  $("btn-discover").onclick = discover;
  const notionButton = $("btn-notion");
  if (notionButton) notionButton.onclick = setNotionToken;
  const netButton = $("btn-notion-net");
  if (netButton) netButton.onclick = checkNotionNet;
  const mountButton = $("btn-mount");
  if (mountButton) mountButton.onclick = () => { window.open("/api/mount", "_blank", "noopener"); };
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
