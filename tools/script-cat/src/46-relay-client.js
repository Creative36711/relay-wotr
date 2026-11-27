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
    tab: "",
    helloAt: 0,
    lastBeatAt: 0,
    lastContactAt: 0,
    lastMarker: { hash: "", at: 0 },
    warned: { hello: "", pull: "", version: "" },
  };

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

  /** POST действия в службу. Служба живёт на машине владельца, без неё — тишина. */
  async function relayPost(body) {
    const base = relayBase();
    if (!base) return null;
    try {
      const data = await request(
        "POST", `${base}/api/agent`,
        { "Content-Type": "application/json" },
        JSON.stringify({ ...body, scriptVersion: SCRIPT_VERSION, v: 1, tab: relayTabId() }),
        { retry: false },
      );
      if (data && typeof data === "object") relayClient.lastContactAt = Date.now();
      return data;
    } catch {
      return null;
    }
  }

  /** Опознание: почта контейнера → слот книги. Кеш живёт до перезагрузки. */
  async function relayIdentity({ force = false } = {}) {
    if (relayClient.slotId && !force) return relayClient.slotId;
    const nowMs = Date.now();
    // Повтор hello раз в 10 минут: аккаунт в книге могут добавить после старта.
    if (relayClient.slotId && nowMs - relayClient.helloAt < 600000) return relayClient.slotId;
    const read = typeof readAccountEmail === "function"
      ? await readAccountEmail({ expand: false }).catch(() => null)
      : null;
    const email = String((read && read.email) || (typeof accountSeen === "function" ? accountSeen().email : "") || "").trim();
    if (!email) return "";
    const res = await relayPost({ action: "hello", account: email, path: typeof location !== "undefined" ? location.pathname : "" });
    relayClient.helloAt = nowMs;
    if (res && res.ok && res.slot) {
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
    const directory = await roles().catch(() => []);
    const role = directory.find((item) => String(item.name || "").trim() === name);
    if (!role || !["Executor", "Auditor"].includes(role.fn)) {
      return { ok: false, why: `роль «${name}» не является активным исполнителем` };
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
    if (!waiting || !waiting.runId) return;
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
  async function relayClientTick() {
    if (!relayConfigured()) return;
    if (typeof isPaused === "function" && isPaused()) return;
    const slotId = await relayIdentity().catch(() => "");
    if (!slotId) return;
    const pending = GM_getValue(K.pending, null);
    const waiting = GM_getValue(K.expect, null);
    if (pending || waiting) {
      // Работа идёт — служба не должна решить, что слот мёртв.
      if (waiting) await relayBeat(slotId, waiting);
      return;
    }
    const provision = typeof provisionRequestState === "function" ? provisionRequestState() : null;
    const queuedProvision = GM_getValue(K.provisionRelayQueue, []).some((item) => String(item.slotId || "") === slotId);
    const ownProvision = Boolean(provision && ((!provision.relay) || String(provision.targetSlot || "") === slotId));
    if (ownProvision || queuedProvision) {
      if (typeof consumeProvision === "function") await consumeProvision();
      return;
    }
    const res = await relayPost({ action: "pull", slotId });
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
      // Пульт «Шаг» не читает Notion и не может сам начать разговор. Он
      // передаёт одноразовый сигнал admin-вкладке; дальше используем тот же
      // coordinatorStep/requestPlan, что и старый ручной цикл. Если открыта
      // не Coordinator, tick(true) сам перейдёт на неё и сохранит шаг.
      log("Пульт Relay передал планирующий ход: запускаю Координатора.", false, { ntfy: "quiet" });
      if (typeof tick === "function") await tick(true);
      const expectAfter = GM_getValue(K.expect, null);
      const pendingAfter = GM_getValue(K.pending, null);
      const navigating = Boolean(GM_getValue(K.step, false));
      if (!expectAfter && !pendingAfter && !navigating) {
        const mission = typeof activeMission === "function" ? await activeMission().catch(() => null) : null;
        await relayPost({
          action: "report", slotId,
          payload: {
            turnAck: true, turnRequestId: res.turnId,
            noMission: !mission, retry: Boolean(mission),
          },
        });
      }
      return;
    }
    if (res.work) await relayTakeWork(res.work, slotId);
  }

  /** Запуск клиента из загрузки: первый вопрос — через паузу, дальше по таймеру. */
  function relayClientStart() {
    if (!relayConfigured()) return;
    const run = () => {
      Promise.resolve()
        .then(() => relayClientTick())
        .catch((e) => log(`Служба Relay: тик клиента не прошёл — ${e && e.message}`, false, { ntfy: "quiet" }));
    };
    setTimeout(run, 5000);
    setInterval(run, RELAY_CLIENT_TICK_MS);
    // Вкладка уходит — выдача не должна остаться без присмотра.
    window.addEventListener("pagehide", () => {
      const waiting = GM_getValue(K.expect, null);
      if (relayClient.slotId && waiting && waiting.runId) {
        relayPost({ action: "bye", slotId: relayClient.slotId, runId: String(waiting.runId) }).catch(() => {});
      }
    });
  }
