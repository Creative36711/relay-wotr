  // ─────────────── D-026: клиент протокола службы Relay ───────────────
  //
  // Вкладка — исполнитель (D-009): решения принимает служба, здесь действия
  // протокола и обязанность не терять выдачу. Pull-задача provision запускает
  // разрешённое создание именно в своём worker-слоте; планирования нет.
  //
  //   hello  — «я вкладка аккаунта X» → слот (один раз, дальше кеш);
  //   pull   — «дай работу» → строка очереди книги (карточка миссии);
  //   beat   — «я жива» → продление выдачи, пока агент работает;
  //   report — «ответ прочитан» → разбор маркера и переход хода в службе;
  //   event  — «вот что случилось» → журнал пульта;
  //   bye    — «вкладка уходит» → выдача не остаётся висеть без присмотра.
  //
  // Промпт собирает не клиент: выдача карточки — это старая, проверенная
  // механика (`dispatchTask`), только Run ID теперь приходит из книги, а не
  // рождается локально. План Координатора и вердикт приёмки остаются
  // служебными ходами вкладки; их маркеры уходят в службу отдельно —
  // без выдачи, потому что у служебного хода Run ID в книге нет.

  /** Как часто холостая вкладка спрашивает работу. */
  const RELAY_CLIENT_TICK_MS = 15000;
  /** Удар сердца: реже — квота, чаще — шум в журнале. */
  const RELAY_BEAT_MS = 60000;
  /** Один и тот же маркер хода не отчитываем дважды. */
  const RELAY_MARKER_DEDUPE_MS = 60000;

  const relayClient = {
    slotId: "",
    account: "",
    admin: false,
    expectedSlot: "",
    tab: "",
    helloAt: 0,
    lastBeatAt: 0,
    lastTurnClaimRenewAt: 0,
    turnRequestId: "",
    lastContactAt: 0,
    lastError: "",
    lastPresenceAt: 0,
    lastLocalHold: "",
    lastHoldReportAt: 0,
    lastMarker: { hash: "", at: 0 },
    warned: { hello: "", pull: "", version: "" },
    projectApprovalRequests: new Set(),
  };

  if (typeof window !== "undefined") {
    window.addEventListener("relay-container-manager-mode", (event) => {
      let detail = event && event.detail;
      if (typeof detail === "string") { try { detail = JSON.parse(detail); } catch { return; } }
      if (!detail || detail.source !== "relay-container-manager") return;
      const expected = detail.leader === false ? "" : String(detail.slotId || "").slice(0, 80);
      const managedTab = Number(detail.browserTabId) > 0 ? `ff-${Number(detail.browserTabId)}` : "";
      if (expected !== relayClient.expectedSlot || (managedTab && managedTab !== relayClient.tab)) {
        relayClient.expectedSlot = expected;
        relayClient.slotId = "";
        relayClient.lastPresenceAt = 0;
        if (managedTab) relayClient.tab = managedTab;
      }
    });
  }

  function relayControlActive() {
    return relayConfigured() && Boolean(relayClient.lastContactAt) && Date.now() - relayClient.lastContactAt <= 180000;
  }

  function relayConnectionLabel() {
    if (!relayConfigured()) {
      return `Node Relay: авто-поиск 127.0.0.1:8787${relayClient.lastError ? ` · ${relayClient.lastError}` : ""}`;
    }
    if (!relayClient.slotId) {
      const state = relayClient.lastContactAt ? "не зарегистрирован" : "нет связи";
      return `Node Relay: ${state}${relayClient.lastError ? ` · ${relayClient.lastError}` : ""}`;
    }
    const localPaused = typeof isPaused === "function" && isPaused();
    if (!relayControlActive()) return `Node Relay: нет сигнала (${relayClient.slotId})${relayClient.lastError ? ` · ${relayClient.lastError}` : ""}`;
    return `Node Relay: ${relayClient.slotId}${localPaused ? " · ScriptCat на паузе" : " · подключён"}`;
  }

  /** Идентификатор вкладки: один на загрузку страницы, не общий на вкладки. */
  function relayTabId() {
    if (!relayClient.tab) {
      relayClient.tab = `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    }
    return relayClient.tab;
  }

  function relayVersionAtLeast(actual, minimum) {
    const parse = (value) => {
      const hit = String(value || "").trim().match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
      return hit ? hit.slice(1).map(Number) : null;
    };
    const a = parse(actual);
    const b = parse(minimum);
    if (!a || !b) return false;
    for (let index = 0; index < 3; index += 1) {
      if (a[index] > b[index]) return true;
      if (a[index] < b[index]) return false;
    }
    return true;
  }

  /** Только поля для диагностики: промпты, текст и URL никогда не уходят в Relay. */
  function relayLocalStateSummary(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const out = {};
    for (const key of ["kind", "roleId", "roleName", "roleFn", "turnId", "runId", "ref"]) {
      const item = value[key];
      if (typeof item === "string" && item.trim()) out[key] = item.trim().slice(0, 120);
    }
    for (const key of ["at", "sentAt", "tries"]) {
      const item = Number(value[key]);
      if (Number.isFinite(item) && item > 0) out[key] = item;
    }
    for (const key of ["verified", "undelivered", "captcha"]) {
      if (typeof value[key] === "boolean") out[key] = value[key];
    }
    if (value.heal && typeof value.heal === "object") {
      const heal = {};
      for (const key of ["kind", "runId"]) {
        const item = value.heal[key];
        if (typeof item === "string" && item.trim()) heal[key] = item.trim().slice(0, 120);
      }
      if (Object.keys(heal).length) out.heal = heal;
    }
    return out;
  }

  /** POST действия в службу. Служба живёт на машине владельца, без неё — тишина. */
  async function relayPost(body) {
    const base = relayBase();
    if (!base) return null;
    try {
      const data = await request(
        "POST", `${base}/api/agent`,
        { "Content-Type": "application/json" },
        JSON.stringify({
          ...body,
          scriptVersion: SCRIPT_VERSION,
          localPaused: typeof isPaused === "function" ? isPaused() : false,
          // D-037: пульт и отчёт саппорта должны видеть, ПОЧЕМУ вкладка на
          // паузе, а не только факт паузы — иначе после сброса хода кнопка
          // «Шаг» мертва без единой объяснимой строки.
          localPauseReason: typeof isPaused === "function" && isPaused() && typeof GM_getValue === "function"
            ? String(GM_getValue(K.paused, "") || "").replace(/\s+/g, " ").slice(0, 160)
            : "",
          v: 1,
          tab: relayTabId(),
        }),
        { retry: false },
      );
      if (data && typeof data === "object") {
        relayClient.lastContactAt = Date.now();
        relayContactAt = relayClient.lastContactAt;
        relayClient.lastError = "";
      } else {
        const detail = "служба Relay вернула ответ в неизвестном формате";
        if (relayClient.lastError !== detail) log(`Служба Relay: ${detail}.`, true, { ntfy: "quiet" });
        relayClient.lastError = detail;
      }
      return data;
    } catch (error) {
      const detail = String((error && error.message) || error || "ошибка связи").slice(0, 140);
      if (relayClient.lastError !== detail) {
        relayClient.lastError = detail;
        log(`Служба Relay: запрос не прошёл — ${detail}.`, true, { ntfy: "quiet" });
      }
      return null;
    }
  }

  /** Опознание: почта контейнера → слот книги. Кеш живёт до перезагрузки. */
  async function relayIdentity({ force = false } = {}) {
    const nowMs = Date.now();
    // Обычный вызов держит кеш до 10 минут; forced presence обязан обходить кеш.
    // Иначе после перезапуска Node оставался бы slotId, но служба не видела
    // вкладку до следующего полноценного pull.
    if (relayClient.slotId && !force && nowMs - relayClient.helloAt < 600000) return relayClient.slotId;
    const read = typeof readAccountEmail === "function"
      ? await readAccountEmail({ expand: false }).catch(() => null)
      : null;
    // Do not fall back to accountSeen(): GM storage is shared by tabs, so a
    // worker container could inherit the last email read in the admin tab
    // (or vice versa) and register itself as the wrong slot.
    const email = String((read && read.email) || "").trim();
    if (!email) {
      const reason = read?.why === "icon-collapsed"
        ? "подпись аккаунта скрыта свернутой панелью Arena"
        : "почта текущей вкладки Arena не прочитана";
      if (relayClient.lastError !== reason) {
        relayClient.lastError = reason;
        log(`Служба Relay: ${reason}.`, true, { ntfy: "quiet" });
      }
      return "";
    }
    const expectedSlot = typeof relayManagerExpectedSlot === "function" ? relayManagerExpectedSlot() : "";
    const waitingState = GM_getValue(K.expect, null);
    const pendingState = GM_getValue(K.pending, null);
    const localBusy = Boolean(waitingState || pendingState);
    const localWaiting = waitingState
      ? `expect:${String(waitingState.kind || "ход")}`
      : pendingState ? "pending" : "";
    const projectConfigUpdatedAt = String(GM_getValue("cfn-relay-settings-updated-at", "") || "");
    const projectCredentialsSynced = GM_getValue("cfn-relay-project-credentials-synced", false) === true;
    const res = await relayPost({
      action: "hello", account: email, expectedSlot, localBusy, localWaiting,
      projectId: typeof ACTIVE_PROFILE !== "undefined" ? ACTIVE_PROFILE.id : "",
      projectName: typeof ACTIVE_PROFILE !== "undefined" ? ACTIVE_PROFILE.name : "",
      projectProfile: typeof projectProfileSnapshot === "function" ? projectProfileSnapshot() : null,
      projectCredentials: !projectCredentialsSynced && typeof projectCredentialsSnapshot === "function"
        ? projectCredentialsSnapshot() : {},
      projectConfigUpdatedAt,
      projectApproved: typeof projectApproved === "function" ? projectApproved() : undefined,
      projectBlockReason: typeof projectBlockReason === "function" ? projectBlockReason() : "",
      path: typeof location !== "undefined" ? location.pathname : "",
    });
    relayClient.helloAt = nowMs;
    if (res?.projectSelection && !localBusy && !busy && !(Number(projectAsyncWork) > 0) &&
        typeof applyRelayProjectSelection === "function") {
      if (applyRelayProjectSelection(res.projectSelection)) {
        log("Пульт выбрал другой проект. Переключаю только эту вкладку без изменения очереди и ожиданий.");
        location.reload();
        return "";
      }
      log("Переключение профиля из пульта не выполнено. Проверьте доступность профиля и перезагрузите вкладку вручную.", true);
    }
    if (res?.projectSettingsUnavailable && !localBusy && !busy && !(Number(projectAsyncWork) > 0) &&
        typeof applyRelayProjectSettingsUnavailable === "function") {
      if (applyRelayProjectSettingsUnavailable(res.projectSettingsUnavailable))
        log("Подключения удалены в пульте. Допуск снят; локальные очереди и ожидания сохранены.", true);
    }
    let settingsRefresh = { applied: false, profileChanged: false, settingsChanged: false };
    if (res?.projectSettings && !localBusy && !busy && !(Number(projectAsyncWork) > 0) &&
        typeof applyRelayProjectSettings === "function") {
      settingsRefresh = applyRelayProjectSettings(res.projectSettings);
      if (settingsRefresh.profileChanged) {
        log("Настройки профиля из пульта приняты. Перезагружаю вкладку без изменения очереди и ожиданий.");
        location.reload();
        return "";
      }
      if (settingsRefresh.settingsChanged) {
        log("Подключения обновлены из пульта. Допуск сброшен для повторной проверки; очередь и ожидания сохранены.", true);
      }
    }
    const approvalRequest = res?.projectApprovalRequest;
    if (approvalRequest && approvalRequest.projectId === String(ACTIVE_PROFILE?.id || "") &&
        approvalRequest.id && !relayClient.projectApprovalRequests.has(approvalRequest.id)) {
      relayClient.projectApprovalRequests.add(approvalRequest.id);
      while (relayClient.projectApprovalRequests.size > 20)
        relayClient.projectApprovalRequests.delete(relayClient.projectApprovalRequests.values().next().value);
      if (typeof approveProjectFromRelay === "function") {
        void Promise.resolve(approveProjectFromRelay(approvalRequest)).catch((error) => {
          log(`Проверка проекта по запросу пульта не завершена: ${String(error?.message || error).slice(0, 180)}.`, true);
        });
      } else {
        log("Получен запрос проверки проекта из пульта, но в этой версии нет проверки профиля. Обновите ScriptCat.", true);
      }
    }
    if (res && res.ok && res.slot) {
      relayClient.lastError = "";
      relayClient.lastPresenceAt = nowMs;
      relayClient.slotId = String(res.slot.slotId || "");
      relayClient.account = email;
      relayClient.admin = Boolean(res.slot.admin);
      const required = String(res.requiredScriptVersion || "");
      const mismatch = required && !relayVersionAtLeast(SCRIPT_VERSION, required) ? `${SCRIPT_VERSION} → ${required}` : "";
      if (mismatch && relayClient.warned.version !== mismatch) {
        relayClient.warned.version = mismatch;
        log(`Обновите ScriptCat: установлена версия ${SCRIPT_VERSION}, пульт Relay требует ${required}. Откройте ссылку обновления в пульте.`, true, { ntfy: "quiet" });
      } else if (!mismatch) relayClient.warned.version = "";
      if (relayClient.warned.hello !== relayClient.slotId) {
        relayClient.warned.hello = relayClient.slotId;
        log(`Служба Relay: вкладка опознана как слот ${relayClient.slotId} (${email}).`);
      }
      return relayClient.slotId;
    }
    if (res && res.ok === false) {
      const why = String(res.why || "аккаунт не привязан к слоту");
      relayClient.lastError = why;
      if (relayClient.warned.hello !== why) {
        relayClient.warned.hello = why;
        log(`Служба Relay: ${why}.`, true, { ntfy: "quiet" });
      }
    }
    return "";
  }

  /** Отчёт службе: выдача закрыта несостоявшейся — строка и слот не висят. */
  async function relayWorkFailed(work, why) {
    const slotId = await relayIdentity().catch(() => "");
    if (!slotId || !work || !work.runId) return;
    await relayPost({ action: "report", slotId, payload: { runId: work.runId, failed: true, why: String(why || "причина не названа") } });
    await relayPost({
      action: "event", slotId, kind: "dispatch", level: "warn", runId: work.runId, card: work.card || "",
      text: `выдача ${work.runId} не состоялась: ${String(why || "").slice(0, 300)}`,
    });
  }

  /** Передать выбранную Координатором Notion-карточку в очередь Node-службы. */
  async function relayEnqueueTask(card, roleName) {
    const cardId = String(card?.id || "").trim();
    const name = String(roleName || "").trim();
    if (!relayConfigured()) return { ok: false, why: "служба Relay не подключена" };
    if (!cardId || !name) return { ok: false, why: "в карточке не хватает ID или роли" };
    const directory = await roleRows().catch(() => []);
    const role = directory.find((item) => String(item.name || "").trim() === name);
    if (!role || !["Executor", "Auditor"].includes(role.fn)) {
      return { ok: false, why: `роль «${name}» не найдена как Executor/Auditor в «Ролях»` };
    }
    const result = await relayPost({
      action: "enqueue",
      card: cardId,
      title: typeof taskTitle === "function" ? taskTitle(card) : cardId,
      role: name,
      fn: role.fn,
      note: "план Координатора из очереди Notion",
    });
    return result && typeof result === "object" ? result : { ok: false, why: "служба Relay не ответила" };
  }

  /**
   * Удержание после переключения проекта (D-035): ход или выдача из пульта —
   * явное действие Мастера, и оно же снимает удержание. Без этого вкладка с
   * оставшимся ключом удержания (его могла записать старая версия скрипта)
   * уходила в вечный цикл «планирующий ход повторится: вкладка пока не
   * создала ожидание» — служба передавала ход, а вкладка молча стояла.
   */
  function relayReleaseSwitchHold(reason) {
    if (typeof projectHeld !== "function" || !projectHeld()) return;
    const released = typeof releaseProjectHold === "function" && releaseProjectHold();
    log(released
      ? `Удержание после переключения снято: ${reason} — явное действие пульта.`
      : `Удержание после переключения не снялось (хранилище вкладки), но ${reason} — явное действие пульта: выполняю.`,
      false, { ntfy: "quiet" });
  }

  /**
   * Взять работу: карточка книги → та же выдача, что и всегда.
   *
   * `dispatchTask` собирает промпт из карточки Notion, ставит Running и
   * ставит ожидание (`K.pending`/`K.expect`) — дальше страницу адресата
   * открывает и отправляет штатный цикл. Единственное отличие от старого
   * пути: Run ID приходит из книги (`work.runId`), и ответ уходит в службу.
   */
  async function relayTakeWork(work, slotId) {
    const card = String(work.card || "").trim();
    const role = String(work.role || "").trim();
    if (!card || !role) {
      await relayWorkFailed(work, "в выдаче нет карточки или роли");
      return;
    }
    if (typeof isUuid === "function" && !isUuid(card)) {
      await relayWorkFailed(work, `карточка «${card}» не UUID Notion — промпт из неё не собрать`);
      return;
    }
    const mission = await activeMission().catch(() => null);
    if (!mission) {
      await relayWorkFailed(work, "активной миссии нет: карточке неоткуда взять контекст и промпт");
      return;
    }
    relayReleaseSwitchHold("выдача работы из очереди");
    let problem = "";
    try {
      const done = await dispatchTask(card, role, mission, { runId: String(work.runId) });
      problem = done === true ? "" : String(done || "выдача не состоялась");
    } catch (error) {
      problem = String((error && error.message) || error);
    }
    if (problem) await relayWorkFailed(work, problem);
  }

  /** Удар сердца, пока агент работает: служба видит живой слот и выдачу. */
  async function relayBeat(slotId, waiting) {
    const nowMs = Date.now();
    if (!waiting) return;
    if (waiting.kind === "plan" && relayClient.turnRequestId) {
      if (nowMs - relayClient.lastTurnClaimRenewAt < 10000) return;
      relayClient.lastTurnClaimRenewAt = nowMs;
      await relayPost({ action: "report", slotId, payload: {
        turnClaimRenew: true, turnRequestId: relayClient.turnRequestId,
      } });
      return;
    }
    if (!waiting.runId) return;
    if (nowMs - relayClient.lastBeatAt < RELAY_BEAT_MS) return;
    relayClient.lastBeatAt = nowMs;
    const silentMs = relayClient.lastContactAt ? nowMs - relayClient.lastContactAt : 0;
    await relayPost({
      action: "beat", slotId, runId: String(waiting.runId),
      waiting: String(waiting.kind || ""), silentMs,
    });
  }

  /**
   * Маркер служебного хода (план/приёмка) — в службу.
   *
   * У плана и приёмки нет выдачи в книге, поэтому отчёт отдельный:
   * `markerOnly`. Служба применяет FSM хода сама; здесь — только текст
   * маркера и защита от повторов (ответ перечитывают несколько раз).
   */
  async function relayTurnMarker(raw) {
    const text = String(raw || "").trim();
    if (!text) return;
    const hash = `${text.length}:${text.slice(0, 120)}`;
    const nowMs = Date.now();
    if (relayClient.lastMarker.hash === hash && nowMs - relayClient.lastMarker.at < RELAY_MARKER_DEDUPE_MS) return;
    const slotId = await relayIdentity().catch(() => "");
    if (!slotId) return;
    const res = await relayPost({ action: "report", slotId, payload: { markerOnly: true, markerRaw: text } });
    if (res && res.ok) {
      relayClient.lastMarker = { hash, at: nowMs };
      if (res.applied) log(`Служба Relay: ход обновлён (${res.turn || "по маркеру"}).`, false, { ntfy: "quiet" });
    }
  }

  /**
   * Отчёт по рабочей выдаче: ответ агента уходит в службу с тем же Run ID,
   * что был в книге. Вызывается из разбора ответа (submitExecutor), когда
   * карточка уже Submitted — то есть ответ действительно принят.
   */
  async function relayReportDispatch(expect, hit, result, answer) {
    if (!expect || !expect.runId) return;
    const slotId = await relayIdentity().catch(() => "");
    if (!slotId) return;
    await relayPost({
      action: "report", slotId,
      payload: {
        runId: String(expect.runId),
        markerRunId: String((result && result.run_id) || ""),
        markerCard: String((result && result.dispatch_id) || ""),
        markerRaw: String((hit && hit.raw) || ""),
        answer: String((answer && answer.body) || "").slice(0, 4000),
      },
    });
  }

  /** Тик клиента: опознание → работа или удар сердца. Никаких решений. */
  function coordinatorTurnAck({ expect = null, pending = null, navigating = false, mission = null, missionError = "" } = {}) {
    const started = Boolean(expect || pending || navigating);
    return {
      turnAck: true,
      retry: !started && Boolean(mission || missionError),
      noMission: !started && !mission && !missionError,
      ...(missionError ? { missionError } : {}),
    };
  }

  async function relayClientTick() {
    if (!relayClient.turnRequestId) relayClient.turnRequestId = String(GM_getValue("cfn-relay-turn-request-id", "") || "");
    if (typeof relayManagerMayPoll === "function" && !relayManagerMayPoll()) return;
    // Даже без ручной настройки пробуем стандартный IPv4 loopback. После первого
    // ответа службы relayConfigured() становится true; никакой ввод URL не нужен.
    // Объявляем вкладку службе даже при локальной паузе. Иначе пульт видит
    // «административный клиент не найден» и не может объяснить, что именно
    // мешает команде. Пауза по-прежнему запрещает брать работу/turn.
    const refreshPresence = !relayClient.lastPresenceAt || Date.now() - Number(relayClient.lastPresenceAt) >= 60000;
    const slotId = await relayIdentity({ force: refreshPresence }).catch(() => "");
    if (typeof setStatus === "function") setStatus();
    if (!slotId) return;
    const paused = typeof isPaused === "function" && isPaused();
    if (paused) {
      // Пауза запрещает pull, но не должна делать вкладку невидимой пульту.
      // Лёгкий hello раз в минуту поддерживает свежий статус без спама в журнал.
      if (Date.now() - Number(relayClient.lastPresenceAt || 0) >= 60000) {
        await relayIdentity({ force: true }).catch(() => "");
      }
      return;
    }
    if (GM_getValue(K.step, false) && projectApproved() &&
        typeof projectCredentialsReady === "function" && projectCredentialsReady() &&
        !projectHeld() && !busy && !GM_getValue(K.pending, null) && !GM_getValue(K.expect, null)) {
      GM_setValue(K.step, false);
      log("Подключения синхронизированы; выполняю сохранённый отложенный шаг.");
      if (typeof tick === "function") await tick(true);
      return;
    }
    const pending = GM_getValue(K.pending, null);
    const waiting = GM_getValue(K.expect, null);
    if (pending || waiting) {
      // Не берём новую работу поверх текущего локального хода. Для admin это
      // было непрозрачно: пульт видел hello, но не знал, почему pull не случился.
      // Записываем препятствие и в виджет, и в журнал пульта, с ограничением частоты.
      const holdKey = waiting ? `expect:${String(waiting.kind || "")}` : pending ? "pending" : "";
      if (holdKey &&
          (relayClient.lastLocalHold !== holdKey || Date.now() - Number(relayClient.lastHoldReportAt || 0) >= 60000)) {
        const reason = waiting
          ? `локально сохранено ожидание ${String(waiting.kind || "ход")}${waiting.runId ? ` (${String(waiting.runId).slice(0, 40)})` : ""}`
          : "локально сохранён незавершённый pending-шаг";
        const text = relayClient.admin
          ? `Админская вкладка не опросила очередь Relay: ${reason}. Состояние не сброшено автоматически.`
          : `Клиент ${slotId} удерживает pull: ${reason}.`;
        relayClient.lastLocalHold = holdKey;
        relayClient.lastHoldReportAt = Date.now();
        if (relayClient.admin) log(text, true, { ntfy: "quiet" });
        await relayPost({
          action: "event", slotId, kind: "state", level: relayClient.admin ? "warn" : "info", text,
          data: {
            relayClientState: true,
            localBusy: true,
            localWaiting: holdKey,
            localState: {
              expect: relayLocalStateSummary(waiting),
              pending: relayLocalStateSummary(pending),
            },
          },
        });
      }
      if (waiting || pending) await relayBeat(slotId, waiting || pending);
      return;
    }
    relayClient.lastLocalHold = "";
    const provision = typeof provisionRequestState === "function" ? provisionRequestState() : null;
    const queuedProvision = GM_getValue(K.provisionRelayQueue, []).some((item) => String(item.slotId || "") === slotId);
    const ownProvision = Boolean(provision && ((!provision.relay) || String(provision.targetSlot || "") === slotId));
    if (ownProvision || queuedProvision) {
      if (typeof consumeProvision === "function") await consumeProvision();
      return;
    }
    const res = await relayPost({
      action: "pull", slotId, projectId: ACTIVE_PROFILE?.id || "", projectName: ACTIVE_PROFILE?.name || "",
      projectApproved: typeof projectApproved === "function" ? projectApproved() : false,
      projectBlockReason: typeof projectBlockReason === "function" ? projectBlockReason() : "",
    });
    if (res && (res.cycleMode === "auto" || res.cycleMode === "manual") && typeof autoSet === "function") {
      const wasAuto = typeof autoOn === "function" && autoOn();
      const shouldAuto = res.cycleMode === "auto";
      if (wasAuto !== shouldAuto) {
        autoSet(shouldAuto);
        log(`Автоцикл ScriptCat ${shouldAuto ? "включён" : "выключен"} режимом Relay.`, false, { ntfy: "quiet" });
        if (shouldAuto && !paused && res.kind !== "turn" && !res.work && typeof tick === "function") {
          setTimeout(() => tick(false), 0);
        }
      }
    }
    if (!res || !res.ok) {
      if (res && res.ok === false && relayClient.warned.pull !== String(res.why || "")) {
        relayClient.warned.pull = String(res.why || "");
        log(`Служба Relay: работа не выдана — ${relayClient.warned.pull}.`, false, { ntfy: "quiet" });
      }
      return;
    }
    relayClient.warned.pull = "";
    if (res.kind === "provision") {
      // Задание очереди Relay само является разрешением на создание. Сценарий
      // сохраняет локальное состояние до навигации Arena, создаёт агента в
      // текущем worker-контейнере и возвращает URL вместе с queueId.
      if (typeof provisionStartRelayTask === "function") {
        await provisionStartRelayTask({ roleName: res.role, slotId: res.slot || slotId, queueId: res.queueId });
      } else {
        await relayPost({ action: "agent", role: res.role, slotId: res.slot || slotId, queueId: res.queueId, ok: false, note: "ScriptCat provisioning-интеграция отсутствует" });
      }
      return;
    }
    if (res.kind === "turn" && res.turn === "coordinator") {
      relayClient.turnRequestId = String(res.turnId || "");
      GM_setValue("cfn-relay-turn-request-id", relayClient.turnRequestId);
      relayClient.lastTurnClaimRenewAt = Date.now();
      // Пульт «Шаг» не читает Notion и не может сам начать разговор. Он
      // передаёт одноразовый сигнал admin-вкладке; дальше используем тот же
      // coordinatorStep/requestPlan, что и старый ручной цикл. Если открыта
      // не Coordinator, tick(true) сам перейдёт на неё и сохранит шаг.
      log("Пульт Relay передал планирующий ход: запускаю Координатора.", false, { ntfy: "quiet" });
      relayReleaseSwitchHold("планирующий ход Координатора");
      if (typeof tick === "function") await tick(true);
      const expectAfter = GM_getValue(K.expect, null);
      const pendingAfter = GM_getValue(K.pending, null);
      const navigating = Boolean(GM_getValue(K.step, false));
      let mission = null;
      let missionError = "";
      // Любое локально сохранённое ожидание/отправка означает, что ScriptCat
      // принял turn и уже владеет ходом. ACK здесь снимает 30-секундный claim;
      // Arena delivery подтверждается отдельно собственным marker/expect flow.
      // Проверять миссию надо только если tick вообще не оставил локального состояния.
      if (!expectAfter && !pendingAfter && !navigating && typeof activeMission === "function") {
        try { mission = await activeMission(); }
        catch (error) { missionError = String((error && error.message) || error || "Notion не ответил").slice(0, 240); }
      }
      const turnAck = await relayPost({
        action: "report", slotId,
        payload: {
          ...coordinatorTurnAck({ expect: expectAfter, pending: pendingAfter, navigating, mission, missionError }),
          turnRequestId: res.turnId,
        },
      });
      if (turnAck && turnAck.ok) {
        relayClient.turnRequestId = "";
        GM_setValue("cfn-relay-turn-request-id", "");
      }
      return;
    }
    if (res.work) await relayTakeWork(res.work, slotId);
  }

  /** Запуск клиента из загрузки: первый вопрос — через паузу, дальше по таймеру. */
  function relayClientStart() {
    const run = () => {
      Promise.resolve()
        .then(() => relayClientTick())
        .catch(async (error) => {
          const detail = String((error && error.message) || error || "ошибка тика").slice(0, 220);
          const text = `Служба Relay: тик клиента не прошёл — ${detail}`;
          log(text, true, { ntfy: "quiet" });
          if (relayClient.slotId) {
            await relayPost({ action: "event", slotId: relayClient.slotId, kind: "net", level: "error", text });
          }
        });
    };
    // Synchronize Relay-owned credentials before the boot routine can consume
    // a deferred manual step on a freshly navigated Coordinator page.
    const initialSync = Promise.resolve().then(() => relayIdentity({ force: true })).catch((error) => {
      const detail = String((error && error.message) || error || "ошибка начального hello").slice(0, 180);
      log(`Служба Relay: начальная синхронизация не завершена — ${detail}.`, true, { ntfy: "quiet" });
      return "";
    }).finally(() => {
      setTimeout(run, 5000);
      setInterval(run, RELAY_CLIENT_TICK_MS);
    });
    // Вкладка уходит — выдача не должна остаться без присмотра.
    window.addEventListener("pagehide", () => {
      const waiting = GM_getValue(K.expect, null);
      if (relayClient.slotId && waiting && waiting.runId) {
        relayPost({ action: "bye", slotId: relayClient.slotId, runId: String(waiting.runId) }).catch(() => {});
      }
    });
    return initialSync;
  }
