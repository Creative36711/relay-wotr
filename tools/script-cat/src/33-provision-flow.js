  // ───────────────────── provisioning: задание Relay (D-024) ─────────────────────
  // Один вход: служба Relay даёт задание «создать агента роли R в контейнере S».
  // Это уже разрешение — отдельного согласования админ-роли нет. Координатор
  // выдаёт карточку и не проверяет, есть ли агент: транспорт сам идёт в
  // названный контейнер, и если роли там нет — создаёт её (роль есть → задание,
  // роли нет → агент). Контур не пишет K.pending/K.expect и не меняет общий
  // Agent URL роли в Notion.
  //
  // Активация одна и та же для всех: после создания сессии отправляется
  // фиксированный первый промпт (test.jpg), ответ не проверяется, а адрес
  // берётся из адресной строки после этого ответа.

  let provisionRunning = false;

  function provisionLog(text, error = false, options = {}) {
    log(text, error, { ntfy: "quiet", title: "Relay: provisioning", ...options });
  }
  function provisionPause(reason, request, job, extra = {}) {
    const fields = {
      requestId: request?.requestId || "", jobId: job?.id || "",
      rolePageId: job?.rolePageId || "", repo: job?.repo || "",
      step: job?.state || request?.state || "", reason,
    };
    provisionEvent(extra.event || "provision_paused", fields);
    if (job) {
      // Relay-задания имеют собственный retry/отчётный контур. Не выключаем
      // общий автоцикл и не ставим проект на глобальную паузу из-за одного
      // контейнера; сначала сообщим Relay, чтобы карточка не ждала бесконечно.
      job.state = request?.relay ? "relay_failed_pending" : (extra.jobState || "paused");
      job.error = reason;
      provisionSaveJob(job);
    }
    if (request) {
      request.state = request.relay ? "approved" : "paused";
      request.error = reason;
      saveProvisionRequest(request);
    }
    if (!request?.relay) {
      autoSet(false);
      pause(reason, { kind: "provision", ref: job?.rolePageId || request?.requestId || "", ...extra.pause });
    } else {
      provisionLog(`Relay provisioning остановлен: ${reason}. Сообщу отказ службе.`, true);
    }
    return true;
  }

  /**
   * Есть ли свойство в живой схеме «Ролей». Возвращает проверку, а не объект:
   * вызывающему нужно ровно «можно ли писать в это поле».
   *
   * Кеш не нужен: вызывается один раз на роль при provisioning, а лишний
   * запрос дешевле, чем роль, которая встала из-за удалённого поля.
   */
  async function provisionCanWriteProps(pageId) {
    let properties = {};
    try {
      const page = await notion("GET", `pages/${pageId}`);
      properties = page?.properties || {};
    } catch (error) {
      // Не прочитали схему — не пишем необязательные поля вовсе. Молча
      // «разрешить всё» здесь означало бы повторить ту же ошибку.
      provisionEvent("provision_schema_unread", { rolePageId: pageId, error: String(error?.message || error) });
      properties = {};
    }
    return (name) => Object.prototype.hasOwnProperty.call(properties, name);
  }

  async function provisionFreshRole(pageId) {
    try {
      const page = await notion("GET", `pages/${pageId}`);
      return page && !page.archived ? mapRoleRow(page) : null;
    } catch (error) {
      if (/404|object_not_found|не найден/i.test(String(error?.message || error))) return null;
      throw error;
    }
  }

  async function provisionBusyContext() {
    const names = new Set();
    const ids = new Set();
    const cards = await query(C.requests, {
      or: [
        { property: "Dispatch State", select: { equals: "Running" } },
        { property: "Dispatch State", select: { equals: "Submitted" } },
      ],
    });
    for (const card of cards) {
      const name = taskRole(card);
      if (name) names.add(norm(name));
      const recipient = rt(card.properties?.["Recipient Agent ID"]);
      if (recipient) ids.add(norm(recipient));
    }
    const pending = GM_getValue(K.pending, null);
    const expect = GM_getValue(K.expect, null);
    for (const turn of [pending, expect]) {
      if (!turn) continue;
      if (turn.roleName) names.add(norm(turn.roleName));
      if (turn.roleId) ids.add(norm(turn.roleId));
      if (turn.ref) ids.add(norm(turn.ref));
    }
    return { names, ids, cards };
  }

  /**
   * Занят ли этот контейнер командным ходом.
   *
   * Спрашивать «есть ли `K.pending`/`K.expect` вообще» нельзя: хранилище
   * ScriptCat общее для всех контейнеров профиля, поэтому ход Координатора
   * видели все вкладки и провижининг объявлял простой занятым на каждом слоте
   * (28.11: создание агента не начиналось ни разу, хотя рабочие слоты стояли
   * свободными). Берём только ход, который принадлежит этой вкладке.
   */
  function provisionLocalHandoff() {
    const owned = (value) => Boolean(value) &&
      (typeof relayOwnsHandoff !== "function" || relayOwnsHandoff(value));
    return owned(GM_getValue(K.pending, null)) || owned(GM_getValue(K.expect, null));
  }

  /**
   * Почему контейнер сейчас не берётся за создание агента.
   *
   * D-024: список причин короткий и не содержит «блокеров модели» — админ-роли,
   * allowlist, включённости контура и пустого пробника больше нет. Остаётся
   * только то, что физически мешает шагу: нет доступа к Notion, цикл на паузе,
   * идёт свой командный ход, контур занят другой вкладкой или исчерпан суточный
   * предел. Ни одна из причин не требует человека с админ-правами.
   */
  function provisionIdleReason() {
    if (!C.notion) return "нет Notion-токена профиля";
    if (typeof isPaused === "function" ? isPaused() : GM_getValue(K.paused, "")) return "цикл на паузе";
    if (provisionLocalHandoff()) return "активный командный ход";
    if (provisionLockHeldByOther()) return "provisioning занят другой вкладкой";
    if (!provisionDailyAllow()) return "суточный лимит создания агентов";
    return "";
  }

  async function provisionEnsureRecipientOption(roleName) {
    const ds = await notion("GET", `data_sources/${C.requests}`);
    const prop = ds?.properties?.["Кому"];
    if (!prop || prop.type !== "select") throw new Error("в «Запросах» нет select-поля «Кому»");
    const options = Array.isArray(prop.select?.options) ? prop.select.options : [];
    if (options.some((o) => norm(o.name) === norm(roleName))) return true;
    const next = [...options.map((o) => ({ id: o.id, name: o.name, color: o.color })), { name: roleName }];
    await notion("PATCH", `data_sources/${C.requests}`, { properties: { "Кому": { select: { options: next } } } });
    return true;
  }

  /**
   * Можно ли активировать роль после создания агента.
   *
   * D-024: «блокеров модели» нет. Роль не активируется только тогда, когда это
   * физически нельзя или вредно прямо сейчас: строки уже нет, Agent URL в
   * Notion успел стать другим, имени на sidebar нет (агент не создан по факту),
   * по роли уже идёт работа. Проверки «остаётся ли активный Reviewer/Coordinator»
   * убраны: это правило состава миссии, а не создание агента, и оно не должно
   * стоять между владельцем и ролью.
   */
  async function provisionActivationBlockReason(job, cfg) {
    const rows = await rolesFresh();
    const row = rows.find((r) => norm(r.pageId) === norm(job.rolePageId));
    if (!row) return "строка роли исчезла";
    if (norm(row.url) !== norm(job.agentUrl)) return "Agent URL в Notion не равен новому";
    const item = provisionFindSidebarItem(provisionAgentUuid(job.agentUrl));
    if (!item || provisionText(item) !== job.roleName) return "имя sidebar не равно роли";
    const busy = await provisionBusyContext();
    if (busy.names.has(norm(job.roleName)) || busy.ids.has(norm(job.roleAgentId)) || busy.ids.has(norm(job.rolePageId))) {
      return "по роли есть активная работа";
    }
    if (["Executor", "Auditor", "Auditory"].includes(job.fn)) {
      try { await provisionEnsureRecipientOption(job.roleName); }
      catch (error) { return `не удалось добавить «Кому»: ${error.message}`; }
    }
    return "";
  }

  async function provisionPatchNotion(job, request) {
    const row = await provisionFreshRole(job.rolePageId);
    if (!row) return provisionPause("Provisioning: строка роли исчезла до записи Notion.", request, job, { event: "provision_conflict" });
    const currentUrl = String(row.url || "").trim();
    const newUrl = job.agentUrl;
    if (currentUrl && norm(currentUrl) !== norm(newUrl) && norm(currentUrl) !== norm(job.oldAgentUrl)) {
      return provisionPause("Provisioning: Agent URL уже изменён другим процессом (conflict).", request, job, { event: "provision_conflict" });
    }
    if (row.status === "Активна" && currentUrl && norm(currentUrl) !== norm(newUrl)) {
      return provisionPause("Provisioning: роль уже активна с другим Agent URL.", request, job, { event: "provision_conflict" });
    }
    const alreadyUrl = norm(currentUrl) === norm(newUrl);
    // Только те поля, что есть в схеме. Notion отвечает validation_error на всю
    // запись целиком, если в ней есть хоть одно отсутствующее свойство, — и
    // тогда не применяется НИЧЕГО, включая Agent URL и Agent State. Пока
    // «Agent Job ID» и «Agent Created At» были в базе, это было незаметно;
    // после их удаления provisioning вставал бы на каждой роли.
    //
    // Схема — единственный источник правды о полях. `row` — уже разобранная
    // строка, свойств Notion в ней нет, поэтому спрашиваем живой объект: без
    // этого проверка была бы всегда истинной и ничего не защищала.
    const canWrite = await provisionCanWriteProps(job.rolePageId);
    const props = {};
    if (canWrite("Agent Job ID")) props["Agent Job ID"] = { rich_text: richText(job.id) };
    if (canWrite("Agent Created At")) props["Agent Created At"] = { date: { start: nowIso() } };
    if (!alreadyUrl) props["Agent URL"] = { url: newUrl };
    if (job.action === "replace" && job.oldAgentUrl && canWrite("Previous Agent URL")) props["Previous Agent URL"] = { url: job.oldAgentUrl };
    // Пустая запись в Notion — это не «ничего не делать», а лишний вызов,
    // который на старом поле падал бы целиком. Поэтому не шлём её вовсе.
    if (Object.keys(props).length && !(row.status === "Активна" && alreadyUrl)) await patch(job.rolePageId, props);
    provisionEvent("provision_notion_updated", { requestId: request.requestId, jobId: job.id, rolePageId: job.rolePageId, repo: job.repo, step: "notion_updated" });
    job.state = "notion_updated";
    provisionSaveJob(job);
    return false;
  }

  async function provisionArchiveOld(job, request) {
    const cfg = provisionConfig();
    if (job.action !== "replace" || !cfg.agentProvisionArchiveOld || !job.oldAgentUrl) {
      job.state = "done"; provisionSaveJob(job);
      provisionEvent("provision_job_done", { requestId: request.requestId, jobId: job.id, rolePageId: job.rolePageId, repo: job.repo, step: "done" });
      return false;
    }
    const oldUuid = provisionAgentUuid(job.oldAgentUrl);
    const newUuid = provisionAgentUuid(job.agentUrl);
    if (!oldUuid || oldUuid === newUuid) {
      return provisionPause("Provisioning: старый Agent URL не отличим от нового; архив не выполняется.", request, job, { event: "provision_conflict" });
    }
    if (provisionCurrentAgentUuid() !== oldUuid) {
      job.state = "archiving_old"; provisionSaveJob(job);
      location.assign(job.oldAgentUrl);
      return true;
    }
    job.state = "archiving_old"; provisionSaveJob(job);
    const result = await provisionArchiveAgent(oldUuid);
    if (result.archived) {
      provisionEvent("provision_old_archived", { requestId: request.requestId, jobId: job.id, rolePageId: job.rolePageId, repo: job.repo, step: "archiving_old" });
    } else {
      provisionEvent("provision_old_archive_unverified", { requestId: request.requestId, jobId: job.id, rolePageId: job.rolePageId, repo: job.repo, step: "archiving_old", reason: result.reason });
      provisionLog(`Provisioning: архив старого агента не подтверждён (${result.reason}). Замена не откатывается; проверьте старый чат вручную.`, true, { ntfy: "normal" });
    }
    job.state = "done"; provisionSaveJob(job);
    provisionEvent("provision_job_done", { requestId: request.requestId, jobId: job.id, rolePageId: job.rolePageId, repo: job.repo, step: "done" });
    return false;
  }

  function provisionRelayQueue() {
    const value = GM_getValue(K.provisionRelayQueue, []);
    return Array.isArray(value) ? value : [];
  }

  function provisionSaveRelayQueue(queue) {
    GM_setValue(K.provisionRelayQueue, Array.isArray(queue) ? queue.slice(-50) : []);
  }

  function provisionQueueRelayTask(task) {
    const queue = provisionRelayQueue();
    const id = String(task?.queueId || "");
    if (!id || queue.some((item) => String(item.queueId || "") === id)) return false;
    queue.push({
      queueId: id,
      roleName: String(task.roleName || "").trim(),
      slotId: String(task.slotId || "").trim(),
      error: String(task.error || "").trim(),
      at: nowIso(),
    });
    provisionSaveRelayQueue(queue);
    return true;
  }

  async function provisionReportRelay(job, request, failed = false) {
    const now = Date.now();
    if (now - Number(job.relayReportAttemptAt || 0) < 15000) return true;
    job.state = failed ? "relay_failed_pending" : "relay_ready_pending";
    job.relayReportAttemptAt = now;
    provisionSaveJob(job);
    const result = await relayPost({
      action: "agent", role: job.roleName, slotId: job.relaySlotId,
      queueId: job.relayQueueId, url: failed ? "" : job.agentUrl,
      ok: !failed, note: failed ? String(job.error || "создать не удалось").slice(0, 300) : "",
    });
    if (!result || !result.ok) {
      provisionLog(`Relay provisioning: служба не подтвердила ${failed ? "отказ" : "адрес"} для «${job.roleName}» / ${job.relaySlotId}; повторю автоматически.`, true);
      return true;
    }
    job.state = "done";
    job.relayResult = failed ? "failed" : "created";
    provisionSaveJob(job);
    provisionEvent(failed ? "provision_rejected" : "provision_job_done", {
      requestId: request.requestId, jobId: job.id, rolePageId: job.rolePageId,
      repo: job.repo, step: failed ? "relay_failed" : "relay_ready",
      reason: failed ? job.error : "",
    });
    provisionLog(failed
      ? `Relay: создание «${job.roleName}» в ${job.relaySlotId} не удалось; очередь получила причину.`
      : `Relay: адрес «${job.roleName}» сохранён для ${job.relaySlotId}.`);
    return false;
  }

  async function provisionBeginRelayFailure(role, target, id, reason) {
    let request = provisionRequestState();
    if (request && !(request.relay && String(request.queueId || "") === id)) {
      provisionQueueRelayTask({ queueId: id, roleName: role, slotId: target, error: reason });
      return true;
    }
    const requestId = request?.requestId || uid();
    const job = provisionNewJob({ rolePageId: "", roleName: role, fn: "Executor", repo: "", action: "create" }, requestId);
    Object.assign(job, {
      relay: true, relaySlotId: target, relayQueueId: id,
      state: "relay_failed_pending", error: String(reason || "создать не удалось").slice(0, 300),
    });
    request = {
      ...(request || {}),
      requestId, state: "approved", relay: true, queueId: id, targetSlot: target,
      roleName: role, resumeAuto: false, approvedJobs: [],
      jobIds: [...(request?.jobIds || []), job.id],
      createdAt: request?.createdAt || nowIso(), updatedAt: nowIso(), error: job.error,
    };
    saveProvisionRequest(request);
    provisionSaveJob(job);
    provisionAcquireLock(requestId, false);
    await provisionReportRelay(job, request, true);
    return true;
  }

  /**
   * Задание службы Relay: создать агента роли R в контейнере S.
   *
   * D-024: задание — и есть разрешение. Здесь нет ни согласования админ-роли,
   * ни проверки «это административный контейнер», ни allowlist, ни пробника в
   * профиле: транспорт идёт в назначенный контейнер и делает там ровно одно —
   * роли нет → создать агента, роль есть → ничего не ломать. Отказ остаётся
   * только один: задание пришло не тому контейнеру или роль нельзя завести
   * вовсе (нет строки / Maintainer). Причина уходит в очередь как есть.
   */
  async function provisionStartRelayTask({ roleName = "", slotId = "", queueId = "", error = "" } = {}) {
    const role = String(roleName || "").trim();
    const target = String(slotId || "").trim();
    const id = String(queueId || "").trim();
    if (!role || !target || !id) {
      provisionLog("Relay provisioning: в задании не хватает роли, слота или queueId.", true);
      return false;
    }
    let active = provisionRequestState();
    if (active) {
      if (active.relay && String(active.queueId || "") === id && active.state === "relay_preparing") {
        // Восстановление после перезагрузки до проверки роли.
      } else if (active.relay && String(active.queueId || "") === id) return true;
      else {
        provisionQueueRelayTask({ queueId: id, roleName: role, slotId: target, error });
        provisionLog(`Relay: задание ${id} поставлено в локальную очередь provisioning; текущий процесс завершится первым.`);
        return true;
      }
    } else {
      const requestId = uid();
      active = {
        requestId, state: "relay_preparing", relay: true, queueId: id,
        targetSlot: target, roleName: role, resumeAuto: false,
        approvedJobs: [], jobIds: [], createdAt: nowIso(), updatedAt: nowIso(),
      };
      saveProvisionRequest(active);
      provisionAcquireLock(requestId, false);
    }
    if (error) return provisionBeginRelayFailure(role, target, id, error);
    const actualSlot = typeof relayIdentity === "function" ? await relayIdentity() : "";
    if (!actualSlot || actualSlot !== target) {
      const why = !actualSlot ? "контейнер не опознан" : `задание для ${target}, вкладка опознана как ${actualSlot}`;
      return provisionBeginRelayFailure(role, target, id, why);
    }
    const cfg = provisionConfig();
    let row = null;
    try {
      row = (await rolesFresh()).find((item) => norm(item.name) === norm(role)) || null;
    } catch (error) {
      return provisionBeginRelayFailure(role, target, id, `не удалось перечитать роли: ${String(error?.message || error).slice(0, 180)}`);
    }
    const allowed = row ? provisionCandidateFromRow(row, cfg, {}) : { ok: false, reason: "роль не найдена в свежих данных Notion" };
    if (!allowed.ok) return provisionBeginRelayFailure(role, target, id, allowed.reason);
    if (!provisionDailyAllow(cfg)) {
      const why = "достигнут суточный лимит создания агентов профиля";
      return provisionBeginRelayFailure(role, target, id, why);
    }
    const requestId = active.requestId;
    const candidate = allowed.candidate;
    const request = {
      ...active, requestId, state: "approved", relay: true, queueId: id, targetSlot: target,
      roleName: candidate.roleName, resumeAuto: false, approvedJobs: [candidate], jobIds: [],
      updatedAt: nowIso(), error: "",
    };
    saveProvisionRequest(request);
    provisionAcquireLock(requestId, false);
    provisionLog(`Relay provisioning: задание ${id}; создаю экземпляр «${candidate.roleName}» в ${target}.`);
    await consumeProvision();
    return true;
  }

  async function provisionAdvanceJob(job, request) {
    const cfg = provisionConfig();
    if (job.relay && job.state === "relay_ready_pending") return provisionReportRelay(job, request, false);
    if (job.relay && job.state === "relay_failed_pending") return provisionReportRelay(job, request, true);
    const uuid = provisionAgentUuid(job.agentUrl);
    if (captchaDialog()) return provisionPause("Provisioning: капча Arena.", request, job);
    if (detectToolCallLimit()) return provisionPause("Provisioning: tool-call limit на bootstrap; продолжение не поддерживается.", request, job);
    const visibleError = detectVisibleErrorCard();
    if (visibleError) return provisionPause(`Provisioning: ошибка Arena: ${visibleError.text || visibleError}`, request, job);

    if (["validated", "creating"].includes(job.state)) {
      if (provisionLocalHandoff()) {
        return provisionPause("Provisioning: появился активный командный ход; создание не начинаю.", request, job);
      }
      const row = request.relay ? null : await provisionFreshRole(job.rolePageId);
      if (!request.relay && !row) {
        return provisionPause("Provisioning: строка роли исчезла до создания.", request, job, { event: "provision_conflict" });
      }
      if (provisionCurrentAgentUuid()) {
        // Новая сессия создаётся только с /agent. Если вкладка уже в чужом
        // чате, не переиспользуем его и не архивируем.
        job.state = "creating"; provisionSaveJob(job);
        location.assign(location.origin + "/agent");
        return true;
      }
      job.state = "creating"; provisionSaveJob(job);
      if (job.repo) {
        const selected = await provisionSelectRepository(job.repo, cfg);
        provisionEvent("provision_repo_selected", { requestId: request.requestId, jobId: job.id, rolePageId: job.rolePageId, repo: job.repo, step: "repo_selected", reason: selected.alreadySelected ? "already" : `attempts ${selected.attempts}` });
      }
      // D-024: роль без разобранного repo не стопорится — агент создаётся,
      // адрес пары записывается, а repo досоздаётся правкой строки. Иначе
      // «нет репозитория» снова стал бы блокером создания.
      job.state = "repo_selected"; provisionSaveJob(job);
    }

    if (job.state === "repo_selected") {
      const ready = await ensureComposer(C.pageWaitMs);
      if (!ready?.editor) return provisionPause("Provisioning: composer новой сессии не появился.", request, job);
      const probe = provisionBootstrapPrompt();
      if (!writePrompt(ready.editor, probe)) return provisionPause("Provisioning: первый промпт не вставлен.", request, job);
      job.bootstrapMsgId = lastMessageId();
      job.bootstrapSeen = messages().map(nodeId);
      job.bootstrapStartedAt = Date.now();
      job.urlWaitStartedAt = Date.now();
      job.state = "bootstrap_sent";
      provisionSaveJob(job); // до deliver: перезагрузка не должна создать вторую сессию
      const sent = await deliver(ready.editor, probe);
      if (!sent?.ok) return provisionPause("Provisioning: первый промпт не доставлен.", request, job);
      provisionEvent("provision_bootstrap_sent", { requestId: request.requestId, jobId: job.id, rolePageId: job.rolePageId, repo: job.repo, step: "bootstrap_sent" });
    }

    if (job.state === "bootstrap_sent") {
      if (!job.agentUrl) {
        const current = provisionCurrentAgentUuid();
        if (current) {
          job.agentUrl = `${location.origin}/agent/${current}`;
          job.state = "url_captured";
          job.urlCapturedAt = Date.now();
          provisionSaveJob(job); // URL сохраняется до rename/Notion
          provisionEvent("provision_url_captured", { requestId: request.requestId, jobId: job.id, rolePageId: job.rolePageId, repo: job.repo, step: "url_captured" });
        } else {
          if (Date.now() - Number(job.urlWaitStartedAt || Date.now()) > cfg.agentUrlWaitMs) {
            return provisionPause("Provisioning: URL новой сессии не появился за agentUrlWaitMs.", request, job);
          }
          return true;
        }
      } else {
        // Восстановление после перезагрузки: URL уже захвачен, вторую сессию
        // не создаём и bootstrap повторно не отправляем.
        job.state = "url_captured";
        provisionSaveJob(job);
      }
    }

    if (job.state === "url_captured") {
      if (provisionCurrentAgentUuid() !== provisionAgentUuid(job.agentUrl)) { location.assign(job.agentUrl); return true; }
      const waited = Date.now() - Number(job.bootstrapStartedAt || Date.now());
      if (waited > cfg.agentBootstrapWaitMs) return provisionPause("Provisioning: первый ответ агента не пришёл за agentBootstrapWaitMs.", request, job);
      if (stillWorking()) return true;
      const replies = messagesAfter(job.bootstrapMsgId, job.bootstrapSeen || []);
      // D-024: смысл ответа не проверяется — нужен факт первого ответа
      // агента, после которого адрес уже взят из адресной строки. Роутер
      // Arena сам подбирает модель с распознаванием изображения.
      if (!replies.length) return true;
      job.state = "renaming"; provisionSaveJob(job);
    }

    if (job.state === "renaming") {
      try {
        await provisionRenameAgent(provisionAgentUuid(job.agentUrl), job.roleName, cfg);
      } catch (error) {
        return provisionPause(`Provisioning: rename не удался (${error.message}). URL сохранён, новая сессия не создаётся.`, request, job, { jobState: "paused" });
      }
      provisionEvent("provision_renamed", { requestId: request.requestId, jobId: job.id, rolePageId: job.rolePageId, repo: job.repo, step: "renamed" });
      job.state = "renamed"; provisionSaveJob(job);
    }

    if (job.state === "renamed") {
      if (request.relay) {
        job.state = "relay_ready_pending";
        provisionSaveJob(job);
        return provisionReportRelay(job, request, false);
      }
      const paused = await provisionPatchNotion(job, request);
      if (paused) return true;
    }

    if (job.state === "notion_updated") {
      if (!cfg.agentProvisionAutoActivate) {
        provisionEvent("provision_activation_blocked", { requestId: request.requestId, jobId: job.id, rolePageId: job.rolePageId, repo: job.repo, step: "activating", reason: "autoActivate выключен" });
        job.state = "done"; provisionSaveJob(job);
        provisionEvent("provision_job_done", { requestId: request.requestId, jobId: job.id, rolePageId: job.rolePageId, repo: job.repo, step: "done" });
        return false;
      }
      job.state = "activating"; provisionSaveJob(job);
      const block = await provisionActivationBlockReason(job, cfg);
      if (block) {
        provisionEvent("provision_activation_blocked", { requestId: request.requestId, jobId: job.id, rolePageId: job.rolePageId, repo: job.repo, step: "activating", reason: block });
        return provisionPause(`Provisioning: автоактивация заблокирована — ${block}. URL записан, Статус остаётся прежним.`, request, job, { jobState: "paused" });
      }
      const freshRow = await provisionFreshRole(job.rolePageId);
      if (!freshRow || freshRow.status !== "Активна") {
        await patch(job.rolePageId, { "Статус": { select: { name: "Активна" } } });
      }
      provisionEvent("provision_activated", { requestId: request.requestId, jobId: job.id, rolePageId: job.rolePageId, repo: job.repo, step: "activated" });
      job.state = "activated"; provisionSaveJob(job);
    }

    if (job.state === "activated") {
      return provisionArchiveOld(job, request);
    }
    if (job.state === "archiving_old") {
      return provisionArchiveOld(job, request);
    }
    if (job.state === "done") return false;
    return true;
  }

  async function provisionRunNextJob(request) {
    const state = provisionState();
    const active = provisionActiveJob();
    if (active) return provisionAdvanceJob(active, request);
    const nextCandidate = (request.approvedJobs || []).find((c) =>
      !state.jobs.some((j) => norm(j.requestId) === norm(request.requestId) && norm(j.rolePageId) === norm(c.rolePageId) && j.state === "done"));
    if (!nextCandidate) return provisionFinishRequest(request, "все jobs завершены");
    const existing = state.jobs.find((j) => norm(j.requestId) === norm(request.requestId) && norm(j.rolePageId) === norm(nextCandidate.rolePageId));
    let job = existing;
    if (!job) {
      if (!provisionDailyAllow()) return provisionPause("Provisioning: суточный лимит создания агентов.", request, null);
      job = provisionNewJob(nextCandidate, request.requestId);
      if (request.relay) Object.assign(job, {
        relay: true, relaySlotId: request.targetSlot, relayQueueId: request.queueId,
      });
      provisionSaveJob(job);
      request.jobIds = [...(request.jobIds || []), job.id];
      saveProvisionRequest(request);
      provisionDailyConsume();
      provisionEvent("provision_job_started", { requestId: request.requestId, jobId: job.id, rolePageId: job.rolePageId, repo: job.repo, step: "validated" });
      provisionLog(`Provisioning: job ${job.id} — ${job.action} «${job.roleName}» (${job.repo}).`);
    }
    return provisionAdvanceJob(job, request);
  }

  async function provisionFinishRequest(request, reason) {
    provisionEvent("provision_job_done", { requestId: request.requestId, step: "request", reason });
    const state = provisionState();
    state.history = [...state.history, { requestId: request.requestId, at: nowIso(), reason, jobs: request.jobIds || [] }].slice(-50);
    saveProvisionState(state);
    const resume = request.resumeAuto === true && !GM_getValue(K.paused, "");
    saveProvisionRequest(null);
    provisionReleaseLock();
    if (resume) autoSet(true);
    provisionLog(`Provisioning: запрос ${request.requestId} завершён (${reason}). Автоцикл ${resume ? "восстановлен" : "остаётся выключенным"}.`);
    return false;
  }

  /**
   * Ранний вход tick. Не трогает K.pending/K.expect.
   *
   * D-024: единственная модель — задание службы. Локальная очередь заданий
   * остаётся, чтобы второе задание не потерялось, пока первое в работе; но
   * больше нет ни «режима auto/manual», ни запроса админ-роли, ни состояний
   * `prepared`/`sending`/`awaiting` — они существовали только ради согласования.
   */
  async function consumeProvision() {
    if (provisionRunning) return true;
    let request = provisionRequestState();
    if (provisionLockHeldByOther()) {
      // Задание принадлежит контейнеру, а не конкретной вкладке. После
      // закрытия/замены вкладки любая вкладка того же слота может безопасно
      // продолжить создание, сохраняя запрет на запуск в другом контейнере.
      const slotId = request?.relay && typeof relayIdentity === "function"
        ? await relayIdentity().catch(() => "") : "";
      if (request?.relay && slotId && slotId === request.targetSlot) {
        provisionAcquireLock(request.requestId, false);
      } else return Boolean(request);
    }
    if (!request) {
      const slotId = typeof relayIdentity === "function" ? await relayIdentity().catch(() => "") : "";
      const pending = provisionRelayQueue();
      const index = pending.findIndex((item) => String(item.slotId || "") === String(slotId || ""));
      if (index < 0) return false;
      const [task] = pending.splice(index, 1);
      provisionSaveRelayQueue(pending);
      return provisionStartRelayTask(task);
    }
    if (request.relay) {
      const slotId = typeof relayIdentity === "function" ? await relayIdentity().catch(() => "") : "";
      if (!slotId || slotId !== request.targetSlot) return false;
      if (request.state === "relay_preparing") {
        return provisionStartRelayTask({ roleName: request.roleName, slotId: request.targetSlot, queueId: request.queueId });
      }
    }
    provisionRunning = true;
    try {
      // Устаревшие состояния прежней модели (согласование админ-роли) не
      // должны держать очередь мёртвой: задание без работы просто закрывается.
      if (["prepared", "sending", "awaiting"].includes(request.state)) {
        provisionEvent("provision_noop", { requestId: request.requestId, reason: "состояние прежней модели согласования" });
        saveProvisionRequest(null);
        provisionReleaseLock();
        return false;
      }
      if (request.state === "approved") return await provisionRunNextJob(request);
      if (request.state === "paused") return true;
      if (request.state === "done") return await provisionFinishRequest(request, "done");
      return false;
    } catch (error) {
      return provisionPause(`Provisioning: ${error.message || error}`, request, provisionActiveJob());
    } finally {
      provisionRunning = false;
    }
  }

  /** Отмена задания до создания агента (кнопка UI). Активные jobs не отменяет. */
  function provisionCancelRequest() {
    const request = provisionRequestState();
    if (!request || request.state !== "relay_preparing") return false;
    provisionEvent("provision_noop", { requestId: request.requestId, reason: "отменено Мастером" });
    saveProvisionRequest(null);
    provisionReleaseLock();
    return true;
  }
