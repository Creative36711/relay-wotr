  // ───────────────────────────── профили проекта ─────────────────────────────
  // Метаданные не содержат секретов. Каждый рабочий профиль получает свой
  // префикс UUID. Старые ключи остаются нетронутыми и копируются только явно.
  const rawGet = GM_getValue;
  const rawSet = GM_setValue;
  const PROFILE_REGISTRY_KEY = "cfn-project-profiles-v1";
  const PROFILE_SESSION_KEY = "cfn-active-project-v1";
  const LEGACY_PROFILE_ID = "unconfigured";
  const PROJECT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const LEGACY_PROFILE = Object.freeze({
    id: LEGACY_PROFILE_ID, name: "Проект не настроен", legacy: true, invalid: true,
    roles: "", missions: "", requests: "", questions: "", pageUrl: "", questionsUrl: "", repo: "",
    branch: "main", driveFolder: "", repos: [], roleRepos: [],
  });

  /** Один репозиторий профиля и его базовая ветка. */
  const REPO_ENTRY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
  const BRANCH_ENTRY = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/;

  // Provisioning Arena-агентов: выключен по умолчанию и не содержит проектных
  // имён. Bootstrap-пробник задаётся владельцем профиля; пустой пробник не
  // отправляется. Значения ниже — аддитивные настройки старых профилей.
  const PROVISION_DEFAULTS = Object.freeze({
    agentProvisionEnabled: false,
    agentProvisionMode: "manual",
    agentProvisionRepoAllowlist: [],
    agentBootstrapPrompt: "",
    agentProvisionMaxJobs: 3,
    agentProvisionDailyMax: 5,
    agentBootstrapWaitMs: 600000,
    agentUrlWaitMs: 30000,
    agentRenameAttempts: 3,
    agentProvisionAutoActivate: true,
    agentProvisionArchiveOld: true,
  });
  const provisionInt = (value, fallback, min, max) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : fallback;
  };
  function normalizeProvisionConfig(profile = {}) {
    const allow = Array.isArray(profile.agentProvisionRepoAllowlist)
      ? [...new Set(profile.agentProvisionRepoAllowlist.map((x) => String(x || "").trim()).filter(Boolean))]
      : [];
    return {
      agentProvisionEnabled: profile.agentProvisionEnabled === true,
      agentProvisionMode: profile.agentProvisionMode === "auto" ? "auto" : "manual",
      agentProvisionRepoAllowlist: allow,
      agentBootstrapPrompt: String(profile.agentBootstrapPrompt || ""),
      agentProvisionMaxJobs: provisionInt(profile.agentProvisionMaxJobs, PROVISION_DEFAULTS.agentProvisionMaxJobs, 1, 20),
      agentProvisionDailyMax: provisionInt(profile.agentProvisionDailyMax, PROVISION_DEFAULTS.agentProvisionDailyMax, 1, 100),
      agentBootstrapWaitMs: provisionInt(profile.agentBootstrapWaitMs, PROVISION_DEFAULTS.agentBootstrapWaitMs, 1000, 3600000),
      agentUrlWaitMs: provisionInt(profile.agentUrlWaitMs, PROVISION_DEFAULTS.agentUrlWaitMs, 1000, 300000),
      agentRenameAttempts: provisionInt(profile.agentRenameAttempts, PROVISION_DEFAULTS.agentRenameAttempts, 1, 10),
      agentProvisionAutoActivate: profile.agentProvisionAutoActivate !== false,
      agentProvisionArchiveOld: profile.agentProvisionArchiveOld !== false,
    };
  }

  /**
   * Привести профиль к единой форме без смены UUID и без сброса состояния.
   * У старых профилей (без `repos`) единственный репозиторий из `repo`/`branch`
   * становится главным; у новых `repo`/`branch` всегда дублируют главную запись.
   */
  function normalizeProfile(profile) {
    if (!profile || typeof profile !== "object") return profile;
    const p = { ...profile };
    const repos = Array.isArray(p.repos) ? p.repos.slice() : [];
    if (repos.length === 0 && (p.repo || p.branch)) {
      repos.push({ repo: p.repo || "", branch: p.branch || "main", main: true });
    }
    let main = repos.find((r) => r && r.main === true);
    if (!main && repos.length) main = repos[0];
    if (main) {
      p.repo = String(main.repo || "");
      p.branch = String(main.branch || "main");
    }
    if (repos.length) p.repos = repos;
    if (!Array.isArray(p.roleRepos)) p.roleRepos = [];
    Object.assign(p, normalizeProvisionConfig(p));
    return p;
  }

  function profileMainEntry(profile = ACTIVE_PROFILE) {
    const repos = Array.isArray(profile?.repos) ? profile.repos : [];
    const main = repos.find((r) => r && r.main === true);
    return main || repos[0] || null;
  }

  function profileRepoBranch(repo, profile = ACTIVE_PROFILE) {
    const entry = (Array.isArray(profile?.repos) ? profile.repos : []).find(
      (r) => r && String(r.repo || "").toLowerCase() === String(repo || "").toLowerCase(),
    );
    return entry ? String(entry.branch || "main") : String(profile?.branch || "main");
  }

  function profileSessionRepo(roleId) {
    if (!roleId) return String(C.repo || "");
    const map = Array.isArray(C.roleRepos) ? C.roleRepos : [];
    const hit = map.find((m) => m && String(m.roleId || "").toLowerCase() === String(roleId).toLowerCase());
    return hit ? String(hit.repo || "") : String(C.repo || "");
  }

  function profileRegistry() {
    const value = rawGet(PROFILE_REGISTRY_KEY, []);
    return Array.isArray(value) ? value : [];
  }
  function validProfile(profile) {
    if (!profile || !PROJECT_UUID.test(String(profile.id || "")) ||
        !String(profile.name || "").trim() || String(profile.name).length > 80) return false;
    const ids = [profile.roles, profile.missions, profile.requests, profile.questions];
    if (ids.some((id) => !PROJECT_UUID.test(String(id || ""))) ||
        new Set(ids.map((id) => id.toLowerCase())).size !== 4) return false;
    try {
      for (const value of [profile.pageUrl, profile.questionsUrl]) {
        const url = new URL(value);
        if (url.protocol !== "https:" || url.username || url.password ||
            !["app.notion.com", "notion.so", "www.notion.so"].includes(url.hostname)) return false;
      }
    } catch { return false; }
    const p = normalizeProfile(profile);
    const repos = Array.isArray(p.repos) ? p.repos : [];
    if (!repos.length) return false;
    let mainSeen = 0;
    const repoSet = new Set();
    for (const entry of repos) {
      if (!entry || typeof entry !== "object" || !REPO_ENTRY.test(String(entry.repo || "")) ||
          String(entry.repo).includes("..") ||
          !BRANCH_ENTRY.test(String(entry.branch || "")) || String(entry.branch).includes("..") ||
          String(entry.branch).includes("//") || String(entry.branch).includes("/.") ||
          String(entry.branch).endsWith("/") || String(entry.branch).endsWith(".") ||
          String(entry.branch).endsWith(".lock"))
        return false;
      const key = String(entry.repo).toLowerCase();
      if (repoSet.has(key)) return false;
      repoSet.add(key);
      if (entry.main === true) mainSeen += 1;
    }
    if (mainSeen !== 1) return false;
    const roleRepos = Array.isArray(p.roleRepos) ? p.roleRepos : [];
    const reposLower = new Set(repos.map((r) => String(r.repo).toLowerCase()));
    for (const m of roleRepos) {
      if (!m || typeof m !== "object" || !PROJECT_UUID.test(String(m.roleId || "")) ||
          !reposLower.has(String(m.repo || "").toLowerCase())) return false;
    }
    const folder = String(p.driveFolder || "");
    if (!/^[a-z0-9][a-z0-9._-]{0,50}$/.test(folder) || folder.includes("..") ||
      ["logs", "payloads", "artifacts"].includes(folder)) return false;
    const prov = normalizeProvisionConfig(p);
    return prov.agentProvisionRepoAllowlist.every((r) => REPO_ENTRY.test(r) && !r.includes(".."));
  }
  function selectedProfileId() {
    try { return sessionStorage.getItem(PROFILE_SESSION_KEY) || LEGACY_PROFILE_ID; }
    catch {
      // Профиль вкладки неизвестен: не подменяем его рабочим Relay.
      return "session-storage-unavailable";
    }
  }
  function resolveProfile(id) {
    if (id === LEGACY_PROFILE_ID) return LEGACY_PROFILE;
    const matches = profileRegistry().filter((p) => p && p.id === id);
    if (matches.length !== 1 || !validProfile(matches[0])) {
      // Никогда не подменяем повреждённый/удалённый профиль на Relay.
      return Object.freeze({ id: String(id || "invalid"), name: "Профиль недоступен", invalid: true,
        roles: "", missions: "", requests: "", questions: "", pageUrl: "", questionsUrl: "",
        repo: "", branch: "main", driveFolder: "" });
    }
    // Копия и closure неизменяемы до полной перезагрузки вкладки.
    return Object.freeze({ ...matches[0], legacy: false, invalid: false });
  }
  const ACTIVE_PROFILE = Object.freeze(normalizeProfile(resolveProfile(selectedProfileId())));
  const projectStorageKey = (id, key) => `project:${id}:${String(key)}`;
  let RELAY_PROJECT_CREDENTIALS = null;
  const PROJECT_SECRET_FIELDS = {
    "cfn-notion-token": "notion", "cfn-gw-url": "gwUrl", "cfn-gw-key": "gwKey",
    "cfn-github-token": "github", "cfn-ntfy-token": "ntfyToken",
  };
  GM_getValue = (key, fallback) => {
    if (String(key) === "cfn-ntfy-topic" && Object.hasOwn(ACTIVE_PROFILE, "ntfyTopic"))
      return String(ACTIVE_PROFILE.ntfyTopic || "");
    const field = PROJECT_SECRET_FIELDS[String(key)];
    if (field && RELAY_PROJECT_CREDENTIALS?.projectId === ACTIVE_PROFILE.id && RELAY_PROJECT_CREDENTIALS.secretsMigrated)
      return RELAY_PROJECT_CREDENTIALS.credentials?.[field] || fallback;
    return rawGet(projectStorageKey(ACTIVE_PROFILE.id, key), fallback);
  };
  GM_setValue = (key, value) => rawSet(projectStorageKey(ACTIVE_PROFILE.id, key), value);

  /** Adopt owner-saved Relay settings only when the local project has no live work. */
  function applyRelayProjectSettings(data) {
    if (!data || data.ok !== true || data.project?.id !== ACTIVE_PROFILE.id || data.secretsMigrated !== true)
      return { applied: false, profileChanged: false, settingsChanged: false };
    const profile = normalizeProfile(data.project);
    if (!validProfile(profile)) return { applied: false, profileChanged: false, settingsChanged: false };
    const registry = profileRegistry();
    const index = registry.findIndex((item) => item?.id === profile.id);
    const previous = index >= 0 ? registry[index] : null;
    const profileChanged = JSON.stringify(normalizeProfile(previous || {})) !== JSON.stringify(profile);
    if (profileChanged) {
      const next = registry.slice();
      if (index >= 0) next[index] = profile;
      else next.push(profile);
      rawSet(PROFILE_REGISTRY_KEY, next);
    }
    const markerKey = projectStorageKey(profile.id, "cfn-relay-settings-updated-at");
    const previousUpdatedAt = String(rawGet(markerKey, "") || "");
    const updatedAt = String(data.updatedAt || "");
    const settingsChanged = Boolean(updatedAt && previousUpdatedAt !== updatedAt);
    RELAY_PROJECT_CREDENTIALS = {
      projectId: profile.id, secretsMigrated: true,
      credentials: data.credentials && typeof data.credentials === "object" ? { ...data.credentials } : {},
    };
    // Remove legacy secret copies only after the Relay file has been read and
    // validated. Queues, expectations, journals and the profile UUID stay local.
    for (const key of Object.keys(PROJECT_SECRET_FIELDS)) rawSet(projectStorageKey(profile.id, key), "");
    if (updatedAt) rawSet(markerKey, updatedAt);
    if (profileChanged || settingsChanged) rawSet(projectStorageKey(profile.id, "cfn-project-approved"), false);
    return { applied: true, profileChanged, settingsChanged };
  }
  function applyRelayProjectSettingsUnavailable(data) {
    if (!data || data.projectId !== ACTIVE_PROFILE.id) return false;
    RELAY_PROJECT_CREDENTIALS = null;
    for (const key of Object.keys(PROJECT_SECRET_FIELDS)) rawSet(projectStorageKey(ACTIVE_PROFILE.id, key), "");
    const markerKey = projectStorageKey(ACTIVE_PROFILE.id, "cfn-relay-settings-updated-at");
    if (data.updatedAt) rawSet(markerKey, String(data.updatedAt));
    rawSet(projectStorageKey(ACTIVE_PROFILE.id, "cfn-project-approved"), false);
    return true;
  }

  /** Accept a pult-selected profile without touching any project's local run state. */
  function applyRelayProjectSelection(data) {
    if (!data || data.ok !== true || !data.project || !data.secretsMigrated) return false;
    const profile = normalizeProfile(data.project);
    if (!validProfile(profile)) return false;
    const registry = profileRegistry();
    const index = registry.findIndex((item) => item?.id === profile.id);
    const next = registry.slice();
    if (index >= 0) next[index] = profile;
    else next.push(profile);
    rawSet(PROFILE_REGISTRY_KEY, next);
    try { sessionStorage.setItem(PROFILE_SESSION_KEY, profile.id); }
    catch { return false; }
    return true;
  }

  const mainEntry = profileMainEntry(ACTIVE_PROFILE);
  Object.assign(C, {
    roles: ACTIVE_PROFILE.roles, missions: ACTIVE_PROFILE.missions, requests: ACTIVE_PROFILE.requests,
    questions: ACTIVE_PROFILE.questions, pageUrl: ACTIVE_PROFILE.pageUrl, questionsUrl: ACTIVE_PROFILE.questionsUrl,
    repo: (mainEntry && mainEntry.repo) || "", branch: (mainEntry && mainEntry.branch) || "main",
    projectName: ACTIVE_PROFILE.name, driveFolder: ACTIVE_PROFILE.driveFolder,
    repos: Array.isArray(ACTIVE_PROFILE.repos) ? ACTIVE_PROFILE.repos : [],
    roleRepos: Array.isArray(ACTIVE_PROFILE.roleRepos) ? ACTIVE_PROFILE.roleRepos : [],
    ...normalizeProvisionConfig(ACTIVE_PROFILE),
  });
  Object.freeze(C);
  const projectApproved = () => !ACTIVE_PROFILE.invalid && !ACTIVE_PROFILE.legacy &&
    GM_getValue("cfn-project-approved", false) === true;
  const projectProfileSnapshot = () => {
    if (ACTIVE_PROFILE.invalid || ACTIVE_PROFILE.legacy) return null;
    const keys = ["id", "name", "roles", "missions", "requests", "questions", "pageUrl", "questionsUrl", "repo", "branch", "driveFolder", "repos", "roleRepos",
      "agentProvisionEnabled", "agentProvisionMode", "agentProvisionRepoAllowlist", "agentBootstrapPrompt", "agentProvisionMaxJobs", "agentProvisionDailyMax",
      "agentBootstrapWaitMs", "agentUrlWaitMs", "agentRenameAttempts", "agentProvisionAutoActivate", "agentProvisionArchiveOld"];
    const snapshot = Object.fromEntries(keys.filter((key) => ACTIVE_PROFILE[key] !== undefined).map((key) => [key, ACTIVE_PROFILE[key]]));
    snapshot.ntfyTopic = String(GM_getValue(K.ntfyTopic, "") || "");
    return snapshot;
  };

  /**
   * Почему вкладка не может работать — тремя словами, а не одним. Прежняя
   * панель отвечала на все три причины одной строкой «проект ещё не разрешён»,
   * и человек шёл в «Управление проектами» подтверждать допуск, которого там уже
   * не было: настоящая причина сидела в sessionStorage вкладки (внешний D-023).
   */
  const projectBlockReason = () => {
    if (ACTIVE_PROFILE.invalid) return "invalid";
    if (ACTIVE_PROFILE.legacy) return "legacy";
    return GM_getValue("cfn-project-approved", false) === true ? "" : "unapproved";
  };
  const projectBlockedText = () => {
    const reason = projectBlockReason();
    if (reason === "invalid")
      return "Профиль вкладки повреждён или изменён в другой вкладке: «Управление проектами» → "
        + "обновите страницу и выберите проект заново. Шаг и очередь обратной связи стоят.";
    if (reason === "legacy")
      return "Эта вкладка не выбрала проект (вкладка открыта без профиля либо sessionStorage недоступен): "
        + "«Управление проектами» → выберите профиль → «Разрешить работу». Шаг и очередь обратной связи стоят.";
    if (reason === "unapproved")
      return "Проект ещё не разрешён к работе: «Управление проектами» → «Разрешить работу». "
        + "Допуск снимается сам при смене Notion, Drive или GitHub-токена в «Подключениях». "
        + "Шаг и очередь обратной связи стоят.";
    return "Работа проекта разрешена.";
  };

  const K = {
    notion: "cfn-notion-token",
    gwUrl: "cfn-gw-url",
    gwKey: "cfn-gw-key",
    auto: "cfn-auto-enabled",
    paused: "cfn-paused",
    log: "cfn-console-log",
    pending: "cfn-pending",
    expect: "cfn-expect",
    mission: "cfn-mission-id",
    merged: "cfn-merged:",
    branch: "cfn-branch",
    pause: "cfn-pause-context",
    // D-104: последние разборы без остановки — по ним видно, что транспорт
    // чинил, пока цикл шёл. Отдельный ключ: паузы-то не было.
    notice: "cfn-notice-log",
    ntfyTopic: "cfn-ntfy-topic",
    ntfyToken: "cfn-ntfy-token",
    ghToken: "cfn-github-token",
    ghAsk: "cfn-github-ask",
    lastResult: "cfn-last-result",
    // Ответ Координатора, который уже получен и разобран, но ещё не применён
    // (шаг Координатора снимает ожидание до применения решения, чтобы оно не
    // применилось дважды). Если шаг сорвётся посередине, «Продолжить» найдёт
    // ход живым и перечитает маркер из чата, а не спросит новый план — иначе
    // задание уходило Координатору второй раз (08.11, дважды).
    planRecover: "cfn-plan-recover",
    errSeen: "cfn-error-seen",
    step: "cfn-step-request",
    debug: "cfn-debug",
    lastSend: "cfn-last-send",
    deadSend: "cfn-dead-send",
    qQueue: "cfn-q-queue",
    answers: "cfn-answer-queue",
    // Ответы, которые записаны в Notion, но ещё не возвращены напрямую автору
    // вопроса. Отдельная durable queue: K.pending остаётся единственным
    // последовательным транспортом, а этот ключ переживает навигацию/сбой.
    answerReturns: "cfn-answer-return-queue",
    collapsed: "cfn-panel-collapsed",
    stateV: "cfn-state-v",
    rolesCache: "cfn-roles-cache",
    // Эфемерные пилоты CASEB-P1: отдельный namespace, НЕ K.pending/K.expect.
    pilots: "cfn-pilots-v1",
    pilotWait: "cfn-pilot-wait:",
    pilotTranscript: "cfn-pilot-transcript:",
    // Provisioning Arena-агентов: отдельный namespace, не K.pending/K.expect.
    provision: "cfn-agent-provision-v1",
    provisionRequest: "cfn-agent-provision-request-v1",
    provisionLock: "cfn-agent-provision-lock",
    provisionRelayQueue: "cfn-agent-provision-relay-queue-v1",
    // D-073: самовосстановление. Инцидент считается по ключу причины, поэтому
    // счётчики автопродолжений и передач Maintainer'у живут вместе с отметкой
    // «какая сборка сломалась» — иначе продолжение после переустановки не
    // доказать, а предохранитель обнулялся бы при каждом переходе страницы.
    heal: "cfn-heal-state",
    heartbeat: "cfn-heartbeat",
    // D-004: аккаунты Arena. Лимиты — состояние АККАУНТА, поэтому ключ общий
    // для вкладок и контейнеров: у каждой вкладки своя сессия, а квота у
    // аккаунта одна. Почта аккаунта — поле «Аккаунт» в Notion (D-005):
    // локального ключа под адрес больше нет.
    accountLimits: "cfn-account-limits",
    accountSeen: "cfn-account-seen-v1",
    accountIdle: "cfn-account-idle-ask",
    // D-006: будильник вкладок. Контейнер меняет только человек, поэтому
    // «хочу, чтобы работа пошла» — это не переход, а просьба к той вкладке,
    // чей аккаунт адресат. Ключ общий: просит любая вкладка, откликается та.
    wake: "cfn-wake-all",
  };

  // sessionStorage также разделён; выбранный ID хранится отдельно на вкладку.
  if (!ACTIVE_PROFILE.legacy) K.auto = projectStorageKey(ACTIVE_PROFILE.id, K.auto);

  const ui = {
    panel: "cfn-panel",
    log: "cfn-log",
    status: "cfn-status",
    toggle: "cfn-toggle",
    step: "cfn-step",
    // D-006: будильник вкладок стоит рядом с «Шаг» и «Включить».
    wake: "cfn-wake",
    stop: "cfn-stop",
    clear: "cfn-clear",
    reset: "cfn-reset",
    questions: "cfn-questions",
    qBadge: "cfn-q-badge",
    collapse: "cfn-collapse",
    count: "cfn-log-count",
    debug: "cfn-debug-toggle",
    agents: "cfn-agents",
    relay: "cfn-open-relay",
  };
