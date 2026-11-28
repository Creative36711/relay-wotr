  // ───────────────────────── provisioning: ядро состояния и правил ─────────────────────────
  // Контур создаёт экземпляр агента для пары (роль, слот) по заданию службы
  // Relay: разрешение уже дано `pull`, отдельного согласования нет (D-024).
  // Обходится без K.pending/K.expect и не создаёт рабочие карточки. Имена
  // проектов и ролей транспорта здесь не зашиты.

  const PROVISION_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    // D-073: Maintainer здесь осознанно нет — закулисный агент транспорта не
  // создаётся через provisioning и не получает карточек (D-063/D-027).
  const PROVISION_FUNCTIONS = ["Coordinator", "Executor", "Auditor", "Auditory", "Reviewer"];
  const PROVISION_STATES = ["validated", "creating", "repo_selected", "bootstrap_sent", "url_captured",
    "renaming", "renamed", "notion_updated", "activating", "activated", "archiving_old", "done", "paused", "error"];
  const PROVISION_EVENTS = ["provision_job_started", "provision_repo_selected", "provision_bootstrap_sent",
    "provision_url_captured", "provision_renamed", "provision_notion_updated", "provision_activated",
    "provision_activation_blocked", "provision_old_archived", "provision_old_archive_unverified",
    "provision_job_done", "provision_paused", "provision_conflict", "provision_noop",
    "provision_schema_unread"];
  const PROVISION_BOOTSTRAP_FORBIDDEN = [
    /CF_[A-Z_]+/i, /notion/i, /aux-workspace/i, /REGULATION/, /WARDEN/i, /DECISIONS/,
    /ntn_[A-Za-z0-9]/, /secret_[A-Za-z0-9]/, /ghp_[A-Za-z0-9]/, /github_pat_[A-Za-z0-9]/,
    /Bearer\s+[A-Za-z0-9]/i, /sk-[A-Za-z0-9]{12}/, /app\.notion|notion\.so|notion\.site/i,
  ];

  /**
   * D-024: первый промпт агента — фиксированный и один на всех.
   *
   * Смысл не в ответе, а в том, чтобы новый чат получил ход и появился адрес
   * `…/agent/<uuid>`; сам ответ не проверяется, модель с распознаванием
   * изображений роутер Arena подбирает сам. Поэтому промпт не настройка
   * профиля: `agentBootstrapPrompt` удалён, старое значение игнорируется.
   */
  const PROVISION_PROBE_PROMPT = "Что изображено на картинке test.jpg в репозитории https://github.com/Creative36711/test? " +
    "Если у тебя нет функции визуального распознавания, скажи прямо.";

  const provisionConfig = () => normalizeProvisionConfig(C);
  const provisionBootstrapPrompt = () => PROVISION_PROBE_PROMPT;
  const provisionBootstrapClean = (text) => {
    const s = String(text || "").trim();
    return s.length > 0 && !PROVISION_BOOTSTRAP_FORBIDDEN.some((re) => re.test(s));
  };

  /** Точный owner/repo: строка или https://github.com/owner/repo(.git). */
  function normalizeProvisionRepo(value) {
    let s = String(value || "").trim();
    if (!s) return "";
    s = s.replace(/^https?:\/\/(?:www\.)?github\.com\//i, "").replace(/\.git$/i, "").replace(/\/+$/, "");
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(s) || s.includes("..")) return "";
    return s.toLowerCase();
  }

  function provisionState() {
    const raw = GM_getValue(K.provision, null);
    if (raw && typeof raw === "object") {
      return {
        jobs: Array.isArray(raw.jobs) ? raw.jobs : [],
        journal: Array.isArray(raw.journal) ? raw.journal : [],
        daily: raw.daily && typeof raw.daily === "object" ? raw.daily : { date: "", count: 0 },
        history: Array.isArray(raw.history) ? raw.history : [],
      };
    }
    return { jobs: [], journal: [], daily: { date: "", count: 0 }, history: [] };
  }
  const saveProvisionState = (state) => GM_setValue(K.provision, { ...state, updatedAt: nowIso() });
  const provisionRequestState = () => GM_getValue(K.provisionRequest, null);
  const saveProvisionRequest = (request) => GM_setValue(K.provisionRequest, request);
  const provisionLockState = () => GM_getValue(K.provisionLock, null);

  function provisionTabId() {
    try {
      let id = sessionStorage.getItem("cfn-provision-tab-v1");
      if (!id) { id = uid(); sessionStorage.setItem("cfn-provision-tab-v1", id); }
      return id;
    } catch { return "tab"; }
  }
  function provisionAcquireLock(requestId, resumeAuto) {
    GM_setValue(K.provisionLock, { requestId, tabId: provisionTabId(), at: Date.now(), resumeAuto: Boolean(resumeAuto) });
  }
  const provisionReleaseLock = () => GM_setValue(K.provisionLock, null);
  function provisionLockHeldByOther() {
    const lock = provisionLockState();
    return Boolean(lock && lock.tabId && lock.tabId !== provisionTabId());
  }

  /** Событие журнала: без секретов и полных prompt. */
  function provisionEvent(event, fields = {}) {
    const state = provisionState();
    const entry = {
      at: nowIso(), event,
      requestId: String(fields.requestId || ""), jobId: String(fields.jobId || ""),
      rolePageId: String(fields.rolePageId || ""), repo: String(fields.repo || ""),
      step: String(fields.step || ""), reason: String(fields.reason || "").slice(0, 300),
    };
    state.journal = [...state.journal, entry].slice(-200);
    saveProvisionState(state);
    dbg("provision", entry);
    return entry;
  }

  const provisionDay = () => new Date().toISOString().slice(0, 10);
  function provisionDailyAllow(cfg = provisionConfig()) {
    const { daily } = provisionState();
    const day = provisionDay();
    const count = daily.date === day ? Number(daily.count) || 0 : 0;
    return count < cfg.agentProvisionDailyMax;
  }
  function provisionDailyConsume() {
    const state = provisionState();
    const day = provisionDay();
    const count = state.daily.date === day ? Number(state.daily.count) || 0 : 0;
    state.daily = { date: day, count: count + 1 };
    saveProvisionState(state);
  }

  /**
   * Кандидат из свежей строки роли.
   *
   * D-024: сигнала «Agent State = запрошен», админ-флага и allowlist больше нет.
   * Кандидатом роль делает само задание службы: транспорт идёт в названный
   * контейнер, и если роли там нет — создаёт её. Отказов осталось ровно
   * четыре, и все они — «агента физически нельзя завести или сейчас некуда»:
   * нет строки, недопустимая функция (Maintainer закулисный), пустое имя и
   * живая работа по этой же роли.
   */
  function provisionCandidateFromRow(row, cfg, busy = {}) {
    if (!row || !row.pageId) return { ok: false, reason: "нет строки роли" };
    const name = String(row.name || "").trim();
    if (!name || name.length > 100) return { ok: false, reason: "имя роли пустое или длиннее 100" };
    if (!PROVISION_FUNCTIONS.includes(row.fn)) return { ok: false, reason: "недопустимая функция" };
    const busyNames = busy.names || new Set();
    const busyIds = busy.ids || new Set();
    if (busyNames.has(norm(name)) || busyIds.has(norm(row.id)) || busyIds.has(norm(row.pageId))) {
      return { ok: false, reason: "по роли есть активная работа" };
    }
    // Репозиторий нужен только для выбора repo в composer. Роль без него
    // (или с неразборчивым значением) всё равно получает агента: адрес пары
    // важнее, а repo досоздастся правкой строки, не новой сессией (D-024).
    const repo = normalizeProvisionRepo(row.repo);
    const url = String(row.url || "").trim();
    const action = url ? "replace" : "create";
    return {
      ok: true,
      candidate: {
        rolePageId: row.pageId, roleName: name, fn: row.fn, repo, action,
        oldAgentUrl: action === "replace" ? url : "", roleAgentId: row.id || "",
      },
    };
  }

  function provisionCandidates(rows, cfg, busy = {}) {
    const candidates = [];
    const rejected = [];
    for (const row of rows || []) {
      const result = provisionCandidateFromRow(row, cfg, busy);
      if (result.ok) candidates.push(result.candidate);
      else if (result.reason !== "по роли есть активная работа") {
        rejected.push({ rolePageId: row?.pageId || "", reason: result.reason });
      }
    }
    return { candidates: candidates.slice(0, cfg.agentProvisionMaxJobs), rejected };
  }

  function provisionNewJob(candidate, requestId) {
    const at = nowIso();
    return {
      id: uid(), requestId, rolePageId: candidate.rolePageId, roleName: candidate.roleName,
      fn: candidate.fn, repo: candidate.repo, action: candidate.action,
      oldAgentUrl: candidate.oldAgentUrl || "", state: "validated", agentUrl: "",
      bootstrapMsgId: "", attempts: 0, createdAt: at, updatedAt: at, error: "",
    };
  }
  const provisionJobIndex = (state, job) => state.jobs.findIndex((j) => norm(j.id) === norm(job.id));
  function provisionSaveJob(job) {
    const state = provisionState();
    const next = { ...job, updatedAt: nowIso() };
    const at = provisionJobIndex(state, next);
    if (at === -1) state.jobs.push(next);
    else state.jobs[at] = next;
    state.jobs = state.jobs.slice(-100);
    saveProvisionState(state);
    return next;
  }
  function provisionActiveJob() {
    const request = provisionRequestState();
    if (!request || !Array.isArray(request.jobIds)) return null;
    const state = provisionState();
    for (const id of request.jobIds) {
      const job = state.jobs.find((j) => norm(j.id) === norm(id));
      if (job && !["done", "error"].includes(job.state)) return job;
    }
    return null;
  }
