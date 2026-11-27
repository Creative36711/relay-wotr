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

async function loadProjectProfiles(selectId = "") {
  const select = $("project-select");
  if (!select) return;
  const note = $("project-note");
  $("btn-project-activate")?.classList.add("hidden");
  try {
    const response = await fetch("/api/projects", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.why || `HTTP ${response.status}`);
    projectProfiles = Array.isArray(data.profiles) ? data.profiles : [];
    activeProjectId = String(data.activeProjectId || "");
    select.replaceChildren();
    if (!projectProfiles.length) {
      select.add(new Option("профилей пока нет", ""));
      note.textContent = "Откройте Arena-вкладку с действующим профилем или импортируйте JSON. Секреты сохраните ниже.";
      return;
    }
    select.add(new Option("выберите профиль", ""));
    for (const profile of projectProfiles) {
      const status = profile.secretStatus || {};
      const ready = status.notion && status.gwUrl && status.gwKey;
      const active = profile.id === activeProjectId ? " · активный" : "";
      select.add(new Option(`${profile.name}${active}${ready ? " · подключения сохранены" : " · нужны подключения"}`, profile.id));
    }
    const preferred = selectId || activeProjectId;
    const chosen = preferred && projectProfiles.some((item) => item.id === preferred) ? preferred : "";
    select.value = chosen;
    if (chosen) showProjectProfile(chosen);
    note.textContent = "Секреты скрыты. Пустые поля сохраняют текущее значение.";
  } catch (error) {
    note.textContent = `Профили не загружены: ${error.message}`;
  }
}

function updateProjectCredentialStatus(status = {}) {
  const node = $("project-credential-status");
  if (!node) return;
  const missing = [];
  if (!status.notion) missing.push("Notion token");
  if (!status.gwUrl) missing.push("Drive Gateway URL");
  if (!status.gwKey) missing.push("Drive Gateway key");
  node.classList.toggle("warn", missing.length > 0);
  node.classList.toggle("ok", missing.length === 0);
  node.textContent = missing.length
    ? `Для допуска не хватает: ${missing.join(", ")}. Введите значения выше и нажмите «Сохранить». Старые секреты ScriptCat не переносятся автоматически.`
    : "Обязательные подключения сохранены локально. Теперь откройте admin-вкладку и запустите проверку допуска; цикл не включится автоматически.";
}

function showProjectProfile(id) {
  const found = projectProfiles.find((item) => item.id === id);
  $("btn-project-activate")?.classList.toggle("hidden", !found || found.id === activeProjectId);
  if (!found) return;
  const { secretStatus = {}, updatedAt = "", ...profile } = found;
  $("project-json").value = JSON.stringify(profile, null, 2);
  $("project-json-details").open = false;
  $("project-ntfy-topic").value = String(profile.ntfyTopic || "");
  $("project-notion").value = "";
  $("project-gw-key").value = "";
  $("project-github").value = "";
  $("project-ntfy").value = "";
  $("project-gw-url").value = "";
  updateProjectCredentialStatus(secretStatus);
  $("project-note").textContent = `Сохранено: Notion ${secretStatus.notion ? "✓" : "нет"}; Drive URL ${secretStatus.gwUrl ? "✓" : "нет"}, ключ ${secretStatus.gwKey ? "✓" : "нет"}.`;
}

function newProjectProfile() {
  const uuid = () => crypto.randomUUID();
  const id = uuid();
  const sourceIds = Array.from({ length: 4 }, uuid);
  const profile = {
    id, name: "Новый проект", roles: sourceIds[0], missions: sourceIds[1], requests: sourceIds[2], questions: sourceIds[3],
    pageUrl: "https://www.notion.so/", questionsUrl: "https://www.notion.so/", repo: "owner/repository", branch: "main",
    driveFolder: "project", repos: [{ repo: "owner/repository", branch: "main", main: true }], roleRepos: [],
  };
  $("project-select").value = "";
  $("project-json").value = JSON.stringify(profile, null, 2);
  $("project-json-details").open = true;
  $("project-ntfy-topic").value = "";
  updateProjectCredentialStatus({});
  $("project-note").textContent = "Заполните метаданные в раскрытом JSON и обязательные подключения выше.";
}

async function importProjectProfileFile() {
  const file = $("project-file").files?.[0];
  if (!file) return;
  try {
    if (file.size > 128 * 1024) throw new Error("Файл профиля больше 128 КБ.");
    const parsed = JSON.parse(await file.text());
    const profile = parsed?.format === "scriptcat-project-config" ? parsed.profile : parsed?.profile || parsed;
    if (!profile || typeof profile !== "object" || Array.isArray(profile)) throw new Error("JSON не содержит объекта профиля.");
    $("project-json").value = JSON.stringify(profile, null, 2);
    $("project-json-details").open = true;
    $("project-ntfy-topic").value = String(profile.ntfyTopic || "");
    $("project-select").value = "";
    $("project-note").textContent = "Профиль загружен. Проверьте метаданные и сохраните обязательные подключения отдельно.";
  } catch (error) {
    $("project-note").textContent = `Импорт не выполнен: ${error.message}`;
  } finally { $("project-file").value = ""; }
}

async function saveProjectConfig({ clearSecrets = false } = {}) {
  const note = $("project-note");
  try {
    const profile = JSON.parse($("project-json").value);
    profile.ntfyTopic = $("project-ntfy-topic").value.trim();
    const secrets = {
      notion: $("project-notion").value.trim(), gwUrl: $("project-gw-url").value.trim(),
      gwKey: $("project-gw-key").value.trim(), github: $("project-github").value.trim(),
      ntfyToken: $("project-ntfy").value.trim(),
    };
    note.textContent = "Проверяю и сохраняю профиль локально…";
    const result = await post("/api/projects", { profile, secrets, clearSecrets });
    if (!result.ok) throw new Error(result.why || "Relay отказал в сохранении");
    for (const id of ["project-notion", "project-gw-url", "project-gw-key", "project-github", "project-ntfy"]) $(id).value = "";
    await loadProjectProfiles(result.profile.id);
    note.textContent = `Сохранено: «${result.profile.name}». ${result.profile.secretStatus.notion && result.profile.secretStatus.gwUrl && result.profile.secretStatus.gwKey
      ? "ScriptCat получит обновление при следующем безопасном опросе; при смене настроек понадобится повторная проверка допуска."
      : "Для рабочего подключения заполните Notion token, Drive Gateway URL и key."}`;
    announceAction("Настройки профиля сохранены на службе Relay. Секреты скрыты; профиль и локальное состояние ScriptCat не очищались.", "ok");
  } catch (error) {
    note.textContent = `Не сохранено: ${error.message}`;
    announceAction(`Настройки не сохранены: ${error.message}`, "bad");
  }
}

async function activateSelectedProject() {
  const id = $("project-select").value;
  const profile = projectProfiles.find((item) => item.id === id);
  if (!profile) { $("project-note").textContent = "Сначала выберите сохранённый профиль."; return; }
  if (profile.id === activeProjectId) return;
  if (!window.confirm(`Сделать «${profile.name}» активным проектом? Вкладки переключатся только после завершения локальных шагов. Автоцикл не включается.`)) return;
  try {
    $("project-note").textContent = "Переключаю активный профиль Relay…";
    const result = await post("/api/projects/active", { projectId: profile.id });
    if (!result.ok) throw new Error(result.why || "Relay отказал в переключении");
    activeProjectId = result.activeProjectId;
    await loadProjectProfiles(activeProjectId);
    $("project-note").textContent = `${result.why} Очереди и ожидания каждого проекта остаются в его локальном хранилище.`;
    announceAction("Активный проект изменён в Relay. Вкладки переключатся на безопасном опросе.", "ok");
  } catch (error) {
    $("project-note").textContent = `Проект не переключён: ${error.message}`;
    announceAction(`Проект не переключён: ${error.message}`, "bad");
  }
}

let snapshot = null;
let busy = false;
let controlBusy = false;
let projectProfiles = [];
let activeProjectId = "";

function announceAction(text, tone = "") {
  const node = $("action-feedback");
  if (!node) return;
  node.textContent = text;
  node.className = `action-feedback${tone ? ` ${tone}` : ""}`;
}

function adminClientsFor(shot) {
  const adminSlots = new Set((shot?.slots || []).filter((slot) => slot.admin).map((slot) => slot.slotId));
  return (shot?.scriptClients || []).filter((client) => adminSlots.has(client.slotId));
}

function localHoldDescription(client) {
  const waiting = String(client?.localWaiting || "");
  if (waiting === "expect:heal") return "сохранён незавершённый разбор предыдущей ошибки (heal)";
  if (waiting.startsWith("expect:")) return `сохранено ожидание «${waiting.slice(7) || "ход"}»`;
  if (waiting === "pending") return "сохранён незавершённый шаг";
  return "ScriptCat сообщил о незавершённой локальной работе";
}

function operatorGuidance(shot) {
  const admins = adminClientsFor(shot);
  const heldAdmin = admins.find((client) => client.localBusy || client.localWaiting);
  const pausedAdmin = admins.find((client) => client.localPaused);
  const blockedProject = admins.find((client) => client.projectApproved === false);
  if (shot.demo) return {
    tone: "bad", mark: "!", title: "Это демо, не рабочая книга",
    detail: "Не нажимайте «Шаг» для реальной работы: подключите книгу через настройку Relay.", canStep: false,
  };
  if (shot.paused) return {
    tone: "warn", mark: "Ⅱ", title: "Relay на паузе",
    detail: `Новые автоматические ходы остановлены. ${shot.pauseReason || "Сохранённое состояние не сбрасывается."}`,
    canStep: false,
  };
  if (blockedProject) {
    const reason = String(blockedProject.projectBlockReason || "");
    const profile = projectProfiles.find((item) => item.id === blockedProject.projectId);
    const status = profile?.secretStatus || {};
    const missing = profile ? [
      !status.notion && "Notion token",
      !status.gwUrl && "Drive Gateway URL",
      !status.gwKey && "Drive Gateway key",
    ].filter(Boolean) : [];
    const why = missing.length
      ? `в профиле Relay не сохранены ${missing.join(", ")}`
      : reason === "unapproved" ? "не пройдена проверка допуска"
        : reason === "invalid" ? "профиль недоступен или повреждён"
          : reason === "legacy" ? "вкладка не выбрала профиль"
            : reason === "credentials-missing" ? "вкладке не доставлены обязательные подключения из Relay"
              : reason || "проверка проекта не завершена";
    const next = missing.length
      ? "Введите их в разделе «Проект» выше, нажмите «Сохранить» и повторите проверку из admin-вкладки."
      : "Исправьте указанную причину и повторите проверку из admin-вкладки.";
    return {
      tone: "warn", mark: "!", title: missing.length ? "Для проекта не заданы подключения" : "Проект заблокировал запуск",
      detail: `Профиль «${blockedProject.projectName || blockedProject.projectId || "проекта"}»: ${why}. ${next} Новый ход не отправляю.`,
      canStep: false,
    };
  }
  if (shot.turnRequest && heldAdmin) return {
    tone: "warn", mark: "…", title: "Координатор ждёт Admin; ScriptCat удерживает опрос",
    detail: `${localHoldDescription(heldAdmin)}. Relay сохранил запрос ${shot.turnRequest.id} и не сбросил его. Не нажимайте «Шаг» повторно — нажмите «Скопировать диагностику» и пришлите отчёт агенту.`,
    canStep: false,
  };
  if (shot.turnRequest && pausedAdmin) return {
    tone: "warn", mark: "Ⅱ", title: "Запрос Координатора сохранён, но ScriptCat на паузе",
    detail: `Запрос ${shot.turnRequest.id} остаётся в Relay. Ничего не потеряно; отправьте агенту диагностику, не создавайте повторный «Шаг».`,
    canStep: false,
  };
  if (shot.turnRequest && shot.turnRequest.claimed) return {
    tone: "ok", mark: "✓", title: "Admin принял ход Координатора",
    detail: `Запрос ${shot.turnRequest.id} обрабатывается. Новый «Шаг» сейчас не нужен.`,
    canStep: false,
  };
  if (shot.turnRequest) return {
    tone: "warn", mark: "…", title: "Ход Координатора уже ожидает Admin",
    detail: `Запрос ${shot.turnRequest.id} сохранён. Не нажимайте «Шаг» ещё раз; если ожидание затянулось, скопируйте диагностику.`,
    canStep: false,
  };
  if (heldAdmin) return {
    tone: "warn", mark: "!", title: "ScriptCat сообщил о незавершённой работе",
    detail: `${localHoldDescription(heldAdmin)}. Relay не очищает такое состояние автоматически. Сначала отправьте диагностику агенту.`,
    canStep: false,
  };
  if (pausedAdmin) return {
    tone: "warn", mark: "Ⅱ", title: "Админская вкладка на локальной паузе ScriptCat",
    detail: "Relay видит вкладку, но она не забирает команды. Состояние сохранено; скопируйте диагностику, если не знаете причину паузы.",
    canStep: false,
  };
  if (Number(shot.counts?.waiting || 0) > 0) return {
    tone: "ok", mark: "✓", title: "Работа в очереди",
    detail: `В очереди ${shot.counts.waiting} заданий. Автоцикл выдаст их сам; в ручном режиме «Шаг» по-прежнему доступен.`,
    canStep: true,
  };
  return {
    tone: "ok", mark: "✓", title: shot.mode === "auto" ? "Relay работает автоматически" : "Relay готов к ручному шагу",
    detail: shot.mode === "auto"
      ? "Автоцикл работает. Если хотите запросить один ход вручную, кнопка «Шаг» всё ещё доступна."
      : "Чтобы запросить один планирующий ход Координатора, нажмите «Шаг» один раз.",
    canStep: true,
  };
}

function syncControls(shot = snapshot) {
  if (!shot) return;
  const guidance = operatorGuidance(shot);
  const stepButton = $("btn-step");
  if (stepButton) {
    stepButton.disabled = busy || controlBusy || !guidance.canStep;
    stepButton.textContent = shot.turnRequest
      ? "Шаг уже ожидает"
      : adminClientsFor(shot).some((client) => client.localBusy || client.localWaiting)
        ? "Ожидает ScriptCat"
        : "Шаг";
    stepButton.title = guidance.canStep ? "Запросить один планирующий ход" : guidance.detail;
  }
  for (const id of ["btn-mode", "btn-pause"]) {
    const button = $(id);
    if (button) button.disabled = controlBusy || busy;
  }
}

function renderOperatorGuidance(shot) {
  const guidance = operatorGuidance(shot);
  const card = $("operator-card");
  const approvalButton = $("btn-approve-project");
  const blocked = adminClientsFor(shot).find((client) => client.projectApproved === false &&
    client.projectBlockReason === "unapproved" && /^[0-9a-f-]{36}$/i.test(String(client.projectId || "")));
  if (approvalButton) {
    approvalButton.classList.toggle("hidden", !blocked);
    approvalButton.disabled = !blocked || busy || controlBusy;
    approvalButton.dataset.projectId = blocked?.projectId || "";
    approvalButton.dataset.projectName = blocked?.projectName || blocked?.projectId || "";
    approvalButton.title = blocked
      ? "Админская вкладка сама проверит сохранённые Notion, Drive, GitHub и схему; данные работы не очищаются, автоцикл не включается."
      : "Доступна только для живого проекта с причиной «не разрешён»";
  }
  if (!card) return;
  card.className = `operator-card ${guidance.tone}`;
  $("operator-mark").textContent = guidance.mark;
  $("operator-title").textContent = guidance.title;
  $("operator-detail").textContent = guidance.detail;
  syncControls(shot);
}

function redactDiagnosticText(value) {
  return String(value || "")
    .replace(/(?:ntn|secret)_[A-Za-z0-9_-]{12,}/gi, "[TOKEN REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]")
    .replace(/\b(token|api[_ -]?key|bridge[_ -]?key|password|secret)(\s*[:=]\s*)[^\s,;]+/gi, "$1$2[REDACTED]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[EMAIL REDACTED]");
}

function safeDiagnosticEventData(value) {
  let data = value;
  if (typeof data === "string") {
    try { data = JSON.parse(data); } catch { return null; }
  }
  if (!data || typeof data !== "object" || data.relayClientState !== true) return null;
  const cleanState = (item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const clean = {};
    for (const key of ["kind", "roleId", "roleName", "roleFn", "turnId", "runId", "ref"]) {
      if (typeof item[key] === "string" && item[key].trim()) clean[key] = redactDiagnosticText(item[key].trim().slice(0, 120));
    }
    for (const key of ["at", "sentAt", "tries"]) {
      const number = Number(item[key]);
      if (Number.isFinite(number) && number > 0) clean[key] = number;
    }
    for (const key of ["verified", "undelivered", "captcha"]) {
      if (typeof item[key] === "boolean") clean[key] = item[key];
    }
    if (item.heal && typeof item.heal === "object") {
      const heal = {};
      for (const key of ["kind", "runId"]) {
        if (typeof item.heal[key] === "string" && item.heal[key].trim()) heal[key] = redactDiagnosticText(item.heal[key].trim().slice(0, 120));
      }
      if (Object.keys(heal).length) clean.heal = heal;
    }
    return clean;
  };
  const localState = data.localState && typeof data.localState === "object"
    ? { expect: cleanState(data.localState.expect), pending: cleanState(data.localState.pending) }
    : null;
  return {
    relayClientState: true,
    localBusy: Boolean(data.localBusy),
    localWaiting: String(data.localWaiting || "").slice(0, 120),
    ...(localState ? { localState } : {}),
  };
}

function diagnosticReport(shot, bannerEntries = []) {
  const grouped = new Map();
  for (const event of [...(shot.events || [])].sort((a, b) => String(a.at).localeCompare(String(b.at)))) {
    const data = safeDiagnosticEventData(event.data);
    const item = {
      at: event.at || "", slot: event.slot || "", kind: event.kind || "", level: event.level || "",
      text: redactDiagnosticText(String(event.text || "").slice(0, 500)),
      ...(data ? { data } : {}),
    };
    const key = JSON.stringify([item.slot, item.kind, item.level, item.text, item.data || null]);
    const previous = grouped.get(key);
    if (previous) {
      previous.lastAt = item.at;
      previous.repeatCount += 1;
    } else grouped.set(key, { ...item, firstAt: item.at, lastAt: item.at, repeatCount: 1 });
  }
  const events = [...grouped.values()]
    .sort((a, b) => String(a.lastAt).localeCompare(String(b.lastAt)))
    .slice(-40);
  const banners = (Array.isArray(bannerEntries) ? bannerEntries : []).slice(-20).map((entry) => ({
    at: Number(entry.at) ? new Date(Number(entry.at)).toISOString() : "",
    count: Number(entry.count) || 1,
    text: redactDiagnosticText(String(entry.text || "").slice(0, 500)),
  }));
  return [
    "Relay support report (review before sharing; access tokens and account emails are redacted; local prompt text is never included)",
    JSON.stringify({
      capturedAt: new Date().toISOString(),
      relayVersion: shot.version || "unknown",
      mode: shot.mode || "unknown",
      paused: Boolean(shot.paused),
      pauseReason: redactDiagnosticText(shot.pauseReason || ""),
      cycle: shot.cycle || null,
      lastStep: shot.lastStep || null,
      counts: shot.counts || {},
      turnRequest: shot.turnRequest || null,
      clients: (shot.scriptClients || []).map((client) => ({
        slotId: client.slotId, scriptVersion: client.scriptVersion,
        localPaused: Boolean(client.localPaused), localBusy: Boolean(client.localBusy),
        localWaiting: client.localWaiting || "", seenAt: client.seenAt || "",
        lastHelloAt: client.lastHelloAt || "", lastPullAt: client.lastPullAt || "", lastBeatAt: client.lastBeatAt || "",
        ...(client.projectId ? { projectId: redactDiagnosticText(String(client.projectId).slice(0, 120)) } : {}),
        ...(client.projectName ? { projectName: redactDiagnosticText(String(client.projectName).slice(0, 120)) } : {}),
        ...(typeof client.projectApproved === "boolean" ? { projectApproved: client.projectApproved } : {}),
        ...(client.projectBlockReason ? { projectBlockReason: redactDiagnosticText(String(client.projectBlockReason).slice(0, 240)) } : {}),
      })),
      slots: (shot.slots || []).map((slot) => ({
        slotId: slot.slotId, admin: Boolean(slot.admin), container: slot.container || "",
        state: slot.state || "", activeRuns: (slot.runs || []).length,
      })),
      recentEvents: events,
      pultHistory: banners,
    }, null, 2),
  ].join("\n");
}

const fmtTime = (iso) => {
  const date = new Date(iso || "");
  if (Number.isNaN(date.getTime())) return String(iso || "");
  const parts = Object.fromEntries(new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.day}.${parts.month} ${parts.hour}:${parts.minute}:${parts.second} МСК`;
};
const shortId = (id) => String(id || "").slice(0, 10);
const BANNER_HISTORY_KEY = "relay-banner-history-v1";
let currentBannerText = "";

function bannerHistoryNext(entries, text, at) {
  const next = Array.isArray(entries) ? entries.slice() : [];
  const message = String(text || "").trim().slice(0, 1200);
  if (!message) return next;
  const previous = next[next.length - 1];
  if (previous && previous.text === message && at - Number(previous.at || 0) < 20000) {
    next[next.length - 1] = { text: message, at, count: Number(previous.count || 1) + 1 };
  } else next.push({ text: message, at, count: 1 });
  return next.slice(-50);
}

function loadBannerHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(BANNER_HISTORY_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function renderBannerHistory(entries = loadBannerHistory()) {
  const wrap = $("banner-history-wrap"), host = $("banner-history");
  if (!wrap || !host) return;
  host.replaceChildren();
  for (const entry of entries.slice().reverse()) {
    const row = document.createElement("li");
    const stamp = Number(entry.at) ? fmtTime(new Date(Number(entry.at)).toISOString()) : "время неизвестно";
    row.textContent = `${stamp} · ${entry.text}${Number(entry.count) > 1 ? ` (повторено ${entry.count} раз)` : ""}`;
    host.append(row);
  }
  wrap.classList.toggle("hidden", entries.length === 0);
}

function rememberBanner(text) {
  try {
    const next = bannerHistoryNext(loadBannerHistory(), text, Date.now());
    localStorage.setItem(BANNER_HISTORY_KEY, JSON.stringify(next));
    renderBannerHistory(next);
  } catch { /* приватный режим может запрещать storage; баннер всё равно виден */ }
}

function banner(text) {
  const node = $("banner");
  if (!text) {
    currentBannerText = "";
    node.classList.add("hidden");
    return;
  }
  if (text !== currentBannerText) rememberBanner(text);
  currentBannerText = text;
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
    host.innerHTML = `<div class="muted">Очередь Relay пуста. Нажмите «Шаг», чтобы вызвать планирующий ход Координатора: его выбранная карточка попадёт сюда и будет выдана подходящему слоту.</div>`;
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
    row.textContent = `${fmtTime(event.at)} ${where ? `[${where}] ` : ""}${plain.text}`;
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
  $("btn-mode").title = shot.mode === "auto"
    ? "Остановить создание новых автоматических ходов; очередь и сохранённые ожидания останутся на месте"
    : "Разрешить автоматическое продолжение; ручная кнопка «Шаг» останется доступна";
  $("btn-pause").textContent = shot.paused ? "Продолжить" : "Пауза";
  $("btn-pause").title = shot.paused
    ? "Снять общую паузу Relay; незавершённые состояния не очищаются"
    : "Приостановить действия Relay, не удаляя очередь и незавершённые состояния";
  if (shot.paused) banner(`Пауза: ${shot.pauseReason || "по решению человека"}`);
  else if (shot.turnRequest) {
    const clients = Array.isArray(shot.scriptClients) ? shot.scriptClients : [];
    const adminSlots = new Set((shot.slots || []).filter((slot) => slot.admin).map((slot) => slot.slotId));
    const adminClients = clients.filter((client) => adminSlots.has(client.slotId));
    const adminPaused = adminClients.some((client) => client.localPaused);
    const latestAdminPull = Math.max(0, ...adminClients.map((client) => Date.parse(client.lastPullAt || "") || 0));
    const adminPolledRecently = latestAdminPull > 0 && Date.now() - latestAdminPull <= 30000;
    const heldAdmin = adminClients.find((client) => client.localBusy || client.localWaiting);
    banner(shot.turnRequest.claimed
      ? "Планирующий ход принят административной вкладкой; жду, пока ScriptCat обработает миссию."
      : heldAdmin
        ? ""
        : adminPaused
          ? "Административная вкладка связана, но ScriptCat на локальной паузе. Запрос сохранён."
          : adminClients.length && adminPolledRecently
          ? "Админ-вкладка опросила Relay, но запрос плана ещё не принят. Причину проверьте в Журнале событий ниже."
          : adminClients.length
            ? "Admin зарегистрирован, но ScriptCat не прислал pull-опрос. Проверьте строку Node Relay в виджете; подробности сохраняются в истории сообщений и Журнале."
            : `Запрос ждёт административную вкладку. ScriptCat автоматически подключается к Relay; не вводите адрес вручную.`);
  } else banner("");
  renderOperatorGuidance(shot);
}

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

function renderScriptCatStatus(shot) {
  const node = $("scriptcat-status");
  if (!node) return;
  node.replaceChildren();
  const required = String(shot.requiredScriptVersion || "");
  const clients = Array.isArray(shot.scriptClients) ? shot.scriptClients : [];
  const adminSlots = new Set((shot.slots || []).filter((slot) => slot.admin).map((slot) => slot.slotId));
  const adminClients = clients.filter((client) => adminSlots.has(client.slotId));
  const outdated = clients.filter((client) => !versionAtLeast(client.scriptVersion, required));
  const pausedAdmin = adminClients.some((client) => client.localPaused);
  const latestAdminPull = Math.max(0, ...adminClients.map((client) => Date.parse(client.lastPullAt || "") || 0));
  const adminPolledRecently = latestAdminPull > 0 && Date.now() - latestAdminPull <= 30000;
  if (shot.turnRequest && adminClients.some((client) => client.localBusy || client.localWaiting)) {
    node.classList.add("hidden");
    return;
  }
  if (!adminClients.length) {
    node.append(document.createTextNode(
      `Пульт не получил сигнал от админской вкладки. Адрес Relay подставляется автоматически (http://127.0.0.1:8787): не вводите его вручную. Проверьте одноразовое разрешение localhost/127.0.0.1 в ScriptCat и перезагрузите Arena под admin. `,
    ));
  } else if (outdated.length) {
    const versions = [...new Set(outdated.map((client) => `${client.slotId}: ${client.scriptVersion || "версия не сообщается"}`))];
    node.append(document.createTextNode(
      `Обновите ScriptCat до v${required}: подключённые вкладки используют ${versions.join("; ")}. До обновления новая работа не выдаётся. `,
    ));
  } else if (pausedAdmin) {
    node.append(document.createTextNode(
      `Административная вкладка обнаружена (ScriptCat ${adminClients.map((client) => client.scriptVersion).join(", ")}), но локальная пауза ScriptCat блокирует получение команд. Раскройте виджет → «Обслуживание» → «Снять локальную паузу…»; основной режим работы выбирайте в пульте. `,
    ));
  } else if (shot.turnRequest && adminClients.length && !adminPolledRecently) {
    node.append(document.createTextNode(
      "Admin зарегистрирован, но ещё не опросил очередь Relay. Запрос сохранён; причина появится здесь и в диагностике. ",
    ));
  } else if (shot.turnRequest && adminClients.length && adminPolledRecently && !shot.turnRequest.claimed) {
    node.append(document.createTextNode(
      "Admin недавно опросил Relay, но планирующий ход не был принят. Смотрите Журнал событий: там должна быть причина отказа или локального удержания. ",
    ));
  } else {
    node.classList.add("hidden");
    return;
  }
  if (adminClients.length && outdated.length) {
    const link = document.createElement("a");
    link.href = "https://raw.githubusercontent.com/Creative36711/relay-wotr/main/tools/script-cat/relay.user.js";
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = `Открыть ScriptCat v${required} для обновления`;
    node.append(link);
  }
  node.classList.remove("hidden");
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
    renderScriptCatStatus(shot);
    renderSetupHint(shot);
    renderMountButton(shot);
    renderSlots(shot);
    renderQueue(shot);
    renderEvents(shot);
  } catch (error) {
    $("health-dot").className = "dot bad";
    $("operator-card").className = "operator-card bad";
    $("operator-mark").textContent = "!";
    $("operator-title").textContent = error.network ? "Relay запущен, но нет связи с внешним сервисом" : "Не удалось связаться с Relay";
    $("operator-detail").textContent = error.message;
    for (const id of ["btn-step", "btn-pause", "btn-mode"]) $(id).disabled = true;
    // «Служба не отвечает» — неправда, когда служба отвечает и говорит, что
    // не дотянулась до книги: человек перезапускает процесс, а дело в сети.
    banner(error.network
      ? `${error.message}\nСлужба работает; не проходит запрос наружу. Нажмите «Проверить сеть» в настройке.`
      : `Служба не отвечает: ${error.message}\nПроверьте, что процесс запущен и что таблица состояния доступна.`);
  }
}

async function step() {
  if (busy || controlBusy) return;
  if (snapshot) {
    const guidance = operatorGuidance(snapshot);
    if (!guidance.canStep) {
      announceAction(`«Шаг» не отправлен. ${guidance.detail}`, "warn");
      return;
    }
  }
  busy = true;
  syncControls();
  announceAction("Отправляю один запрос «Шаг»…");
  try {
    await post("/api/control", { action: "ui", text: "нажат «Шаг»" });
    const result = await post("/api/control", { action: "step", origin: "panel" });
    if (result.ok === false) {
      announceAction(`Шаг не выполнен: ${result.why || "служба отказала"}`, "bad");
      banner(result.why);
    } else if (result.planned === 0) {
      announceAction(`Запрос обработан: ${result.why || "пока нет выдач"}`, "warn");
      banner(`Выдач не было: ${result.why}`);
    } else {
      announceAction(`Шаг выполнен: запланировано выдач — ${result.planned}.`, "ok");
      banner(`Запланировано выдач: ${result.planned}`);
    }
  } catch (error) {
    announceAction(`Не удалось отправить «Шаг»: ${error.message}`, "bad");
  } finally {
    busy = false;
    syncControls();
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

async function runConfirmedAction({ pending, actionBody, uiText, verify, done }) {
  if (busy || controlBusy) return;
  controlBusy = true;
  syncControls();
  announceAction(pending);
  try {
    await post("/api/control", { action: "ui", text: uiText });
    const result = await post("/api/control", actionBody);
    if (result?.ok === false) throw new Error(result.why || "служба отказала");
    await refresh();
    if (verify(snapshot, result)) announceAction(done, "ok");
    else announceAction("Команда отправлена, но новое состояние пока не подтверждено. Нажмите «Обновить»; ничего повторно не нажимайте.", "warn");
  } catch (error) {
    announceAction(`Не удалось выполнить действие: ${error.message}`, "bad");
  } finally {
    controlBusy = false;
    syncControls();
  }
}

async function requestProjectApproval() {
  const button = $("btn-approve-project");
  const projectId = String(button?.dataset.projectId || "");
  const projectName = String(button?.dataset.projectName || projectId);
  if (!projectId || busy || controlBusy) return;
  const confirmed = window.confirm(
    `Проверить профиль «${projectName}» в открытой админ-вкладке?\n\n` +
    "ScriptCat проверит сохранённые подключения и структуру баз Notion только чтением; если схеме нужны правки, проверка остановится без изменений. При успехе разрешается работа проекта и запускаются фоновые наблюдатели вопросов и решений, которые могут создавать записи в Notion. Автоцикл не включается; очередь и ожидания сохраняются.\n\n" +
    "Продолжить?",
  );
  if (!confirmed) return;
  controlBusy = true;
  syncControls();
  announceAction("Передаю запрос проверки админ-вкладке…");
  try {
    const result = await post("/api/project-approval", { projectId });
    if (!result?.ok) throw new Error(result?.why || "служба не приняла запрос");
    await refresh();
    announceAction(result.why || "Запрос передан. Дождитесь результата проверки в статусе и журнале.", "ok");
  } catch (error) {
    announceAction(`Не удалось запросить проверку профиля: ${error.message}. Ничего не сброшено.`, "bad");
  } finally {
    controlBusy = false;
    syncControls();
  }
}

async function copyDiagnostics() {
  const note = $("diagnostic-note");
  if (!snapshot) {
    note.textContent = "Пока нет снимка Relay. Нажмите «Обновить» и повторите.";
    return;
  }
  const report = diagnosticReport(snapshot, loadBannerHistory());
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(report);
    else throw new Error("clipboard API unavailable");
  } catch {
    const field = document.createElement("textarea");
    field.value = report;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.append(field);
    field.select();
    const copied = document.execCommand("copy");
    field.remove();
    if (!copied) {
      note.textContent = "Не удалось скопировать автоматически. Выделите и скопируйте журнал вручную.";
      return;
    }
  }
  note.textContent = "Диагностика скопирована. Вставьте её сюда: локальные промпты не включаются; токены и почта маскируются. Проверьте события перед отправкой.";
  announceAction("Диагностика скопирована в буфер обмена. Вставьте её в сообщение агенту.", "ok");
}

function bind() {
  $("btn-step").onclick = step;
  $("btn-refresh").onclick = async () => {
    announceAction("Обновляю состояние Relay…");
    await refresh();
    if (snapshot) announceAction("Состояние обновлено.", "ok");
  };
  $("btn-pause").onclick = () => {
    const paused = snapshot?.paused;
    const nextPaused = !paused;
    void runConfirmedAction({
      pending: nextPaused ? "Останавливаю новые действия…" : "Снимаю паузу…",
      uiText: nextPaused ? "нажата «Пауза»" : "нажато «Продолжить»",
      actionBody: { action: nextPaused ? "pause" : "resume", reason: "кнопка пульта" },
      verify: (shot) => Boolean(shot) && Boolean(shot.paused) === nextPaused,
      done: nextPaused ? "Подтверждено: Relay на паузе; состояние сохранено." : "Подтверждено: пауза снята.",
    });
  };
  $("btn-mode").onclick = () => {
    const next = snapshot?.mode === "auto" ? "manual" : "auto";
    void runConfirmedAction({
      pending: next === "manual" ? "Останавливаю автоцикл…" : "Включаю автоцикл…",
      uiText: `переключён режим: ${next}`,
      actionBody: { action: "mode", mode: next },
      verify: (shot, result) => (shot?.mode || result?.mode) === next,
      done: next === "manual"
        ? "Подтверждено: автоцикл остановлен. Сохранённые ходы и очередь не удалены."
        : "Подтверждено: автоцикл включён.",
    });
  };
  $("btn-copy-diagnostics").onclick = copyDiagnostics;
  $("btn-approve-project").onclick = requestProjectApproval;
  $("project-select").onchange = () => showProjectProfile($("project-select").value);
  $("btn-project-new").onclick = newProjectProfile;
  $("btn-project-activate").onclick = activateSelectedProject;
  $("btn-project-import").onclick = () => $("project-file").click();
  $("project-file").onchange = importProjectProfileFile;
  $("btn-project-save").onclick = () => saveProjectConfig();
  $("btn-project-clear-secrets").onclick = () => {
    const id = $("project-select").value;
    if (!id) { $("project-note").textContent = "Сначала выберите сохранённый профиль."; return; }
    if (!window.confirm("Удалить сохранённые Notion, Drive, GitHub и ntfy credentials для выбранного профиля? Очередь, ожидания и рабочее состояние не трогаются.")) return;
    void saveProjectConfig({ clearSecrets: true });
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
renderBannerHistory();
void loadProjectProfiles();
refresh();
setInterval(refresh, 5000);
