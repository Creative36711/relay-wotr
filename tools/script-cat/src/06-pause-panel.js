  // ───────────────────────────── пауза ─────────────────────────────
  /**
   * Пауза принадлежит ВКЛАДКЕ, а не всем контейнерам сразу.
   *
   * 28.11 в 00:44:32 капча появилась в админском контейнере и поставила паузу.
   * `cfn-paused` — ключ хранилища ScriptCat, а оно общее для всех вкладок
   * профиля: через секунду на паузе стояли все четыре контейнера
   * (`localPaused: true` у admin, worker-1…3 с одной и той же причиной), и
   * пульт не мог запустить ни одного хода. Человек решил капчу в одной
   * вкладке — разморозились все, хотя «Продолжить» он нажимал один раз.
   *
   * Теперь пауза живёт в `sessionStorage`: у каждой вкладки своё состояние,
   * переходы между страницами агентов его сохраняют, а соседние контейнеры
   * оно не трогает. Общий ключ остаётся памятью о прошлой сессии: старую
   * паузу читаем один раз, чтобы не потерять причину, но не наследуем её
   * как действующую.
   */
  const PAUSE_TAB_KEY = "cfn-paused-tab-v1";
  const PAUSE_CTX_TAB_KEY = "cfn-pause-context-tab-v1";
  const TAB_BORN_KEY = "cfn-tab-born-v1";

  /** Когда открылась эта вкладка: по нему отличаем наследие от чужой паузы. */
  function tabBornAt() {
    try {
      const seen = Number(sessionStorage.getItem(TAB_BORN_KEY) || 0);
      if (seen > 0) return seen;
      const born = Date.now();
      sessionStorage.setItem(TAB_BORN_KEY, String(born));
      return born;
    } catch {
      return 0;
    }
  }

  /**
   * Пауза этой вкладки.
   *
   * Наследие — только пауза, поставленная ДО открытия вкладки: она описывает
   * остатки прошлой сессии, и терять её причину незачем. Пауза, поставленная
   * позже (капча в соседнем контейнере), к этой вкладке не относится: именно
   * из-за такого наследования 28.11 замерзли все четыре контейнера сразу.
   */
  function tabPauseReason() {
    try {
      const own = sessionStorage.getItem(PAUSE_TAB_KEY);
      if (own !== null) return own;
      const shared = GM_getValue(K.paused, "");
      let reason = "";
      let at = 0;
      if (shared && typeof shared === "object") {
        reason = String(shared.reason || "");
        at = Number(shared.at || 0);
      } else {
        reason = String(shared || "");
        // Строка — пауза сборки до 1.35.5: считаем её старой.
        at = 0;
      }
      const born = tabBornAt();
      const inherited = reason && (!at || !born || at < born) ? reason : "";
      sessionStorage.setItem(PAUSE_TAB_KEY, inherited);
      return inherited;
    } catch {
      return String(GM_getValue(K.paused, "") || "");
    }
  }

  function tabPauseSet(reason) {
    const value = String(reason || "");
    try {
      if (value) sessionStorage.setItem(PAUSE_TAB_KEY, value);
      else sessionStorage.removeItem(PAUSE_TAB_KEY);
      // Дублируем в общий ключ — но это только история и наследие для
      // вкладки, открытой после паузы. Действующей паузой он больше не
      // считается: `isPaused` читает вкладочное значение, поэтому запись
      // сюда не морозит соседние контейнеры.
      GM_setValue(K.paused, value ? { reason: value, at: Date.now() } : "");
    } catch {
      // Приватный режим: остаётся общее хранилище — прежнее поведение.
      GM_setValue(K.paused, value ? { reason: value, at: Date.now() } : "");
    }
    return value;
  }

  function tabPauseContext() {
    try {
      const raw = sessionStorage.getItem(PAUSE_CTX_TAB_KEY);
      if (raw !== null) return raw ? JSON.parse(raw) : null;
    } catch {
      // Ниже — общий ключ.
    }
    return GM_getValue(K.pause, null);
  }

  function tabPauseContextSet(context) {
    try {
      if (context) sessionStorage.setItem(PAUSE_CTX_TAB_KEY, JSON.stringify(context));
      else sessionStorage.removeItem(PAUSE_CTX_TAB_KEY);
    } catch {
      // Приватный режим: контекст живёт в общем ключе.
    }
    // Общий ключ — история для вкладки, открытой позже; действующим он не
    // считается (см. `tabPauseContext`).
    GM_setValue(K.pause, context || null);
  }

  const isPaused = () => Boolean(tabPauseReason());

  /**
   * Автоцикл — состояние ОКНА, а не хранилища скрипта.
   *
   * Хранилище ScriptCat переживает браузер: включённый однажды автоцикл
   * подхватывал процесс при следующем открытии страницы, без единого нажатия.
   * Теперь флаг лежит в `sessionStorage`: переживает переходы между страницами
   * агентов в той же вкладке, но исчезает вместе с браузером. Новый запуск
   * всегда начинается с ручного «Включить».
   */
  let autoMem = false;
  let relayManagerSlotId = "";
  let relayManagerLeader = true;
  let relayManagerActive = false;
  let relayManagerSignalAt = 0;
  function relayManagerExpectedSlot() {
    return Date.now() - relayManagerSignalAt <= 20000 ? relayManagerSlotId : "";
  }
  function relayManagerMayPoll() {
    return Date.now() - relayManagerSignalAt > 20000 || relayManagerLeader;
  }
  function autoOn() {
    try {
      return sessionStorage.getItem(K.auto) === "1";
    } catch {
      return autoMem;
    }
  }
  function autoSet(on) {
    autoMem = Boolean(on);
    try {
      if (on) sessionStorage.setItem(K.auto, "1");
      else sessionStorage.removeItem(K.auto);
    } catch {
      // Приватный режим или запрет storage: остаётся память вкладки.
    }
  }

  // Firefox companion extension управляет режимом вкладки через изолированный
  // content-script bridge. Пользовательский сайт не получает browser API; сюда
  // попадает только простая команда режима, а не доступ к контейнерам.
  if (typeof window !== "undefined") {
    window.addEventListener("relay-container-manager-mode", (event) => {
      let detail = event && event.detail;
      if (typeof detail === "string") { try { detail = JSON.parse(detail); } catch { return; } }
      if (!detail || detail.source !== "relay-container-manager") return;
      relayManagerSignalAt = Date.now();
      relayManagerLeader = detail.leader !== false;
      relayManagerSlotId = String(detail.slotId || "").slice(0, 80);
      const shouldAuto = detail.mode === "auto";
      const wasActive = relayManagerActive;
      relayManagerActive = Boolean(detail.active);
      const changed = autoOn() !== shouldAuto;
      autoSet(shouldAuto);
      if (changed) log(`Автоцикл ScriptCat ${shouldAuto ? "включён" : "выключен"} менеджером Relay.`, false, { ntfy: "quiet" });
      const wakeOneTick = (changed && shouldAuto) || (!wasActive && relayManagerActive);
      if (!isPaused() && wakeOneTick && typeof tick === "function") setTimeout(() => tick(false), 0);
    });
  }

  /** Старое значение в хранилище скрипта снимаем: оно больше не управляет циклом. */
  function autoForgetPersisted() {
    const stale = GM_getValue(K.auto, false);
    GM_setValue(K.auto, false);
    if (stale) {
      log(
        "Автоцикл прошлой сессии снят: он включается только вручную, кнопкой «Включить».",
        false,
        { skip: true },
      );
    }
  }

  /**
   * Единственная точка остановки. Любая ошибка на экране, таймаут или
   * невыданный маркер приводят сюда: цикл замирает, статус краснеет, уходит
   * громкий пуш, а продолжает только Мастер — кнопкой «Продолжить».
   */
  function pause(reason, context = {}) {
    // Причина, которая была ДО этой паузы: по ней решается, новый это инцидент
    // или уточнение того же самого (D-094).
    const ownReason = () => (typeof tabPauseReason === "function" ? tabPauseReason() : String(GM_getValue(K.paused, "") || ""));
    const before = String(ownReason() || "");
    const info = {
      kind: context.kind || "error",
      reason: String(reason),
      at: Date.now(),
      ref: context.ref || "",
      runId: context.runId || "",
      turnId: context.turnId || "",
      tries: context.tries ?? null,
      // D-084: что не сошлось в ответе агента (маркер, имя, хвост). Поле
      // переживает перезагрузку вместе с паузой: разбор восстановления читает
      // его из состояния, а не из текста причины.
      defect: context.heal && context.heal.defect ? context.heal : null,
      wasAuto: autoOn(),
      // D-092: кому адресована остановка. До этой правки адресат был один —
      // человек, и различать было нечего. Теперь разбор восстановления решает,
      // кто отвечает по существу: `master` (закрытый список, только человек),
      // `warden` (постановка, зоны, очередь), `transport` (технический дефект),
      // `self` (повтор). Поле попадает в состояние паузы, поэтому панель и
      // телеметрия видят адресата, а не догадываются по тексту.
      with: "",
      // D-073: какая сборка сломалась. По этому признаку гейт версии отличает
      // «установлена новая сборка» от «тот же номер, тот же бандл».
      version: SCRIPT_VERSION,
      fingerprint: C.buildFingerprint || "",
    };
    // D-092: адресат остановки считается здесь, а не в панели.
    //
    // 08–09.11 телефон звонил двенадцать раз, и восемь из них были установкой
    // сборки — событием, где человек ничего не решает. Громкий сигнал должен
    // означать «без тебя физически нельзя», иначе он перестаёт что-либо
    // означать. Поэтому громко — только когда адресат `master` (закрытый
    // список MASTER_ONLY) или разбор не смог классифицировать остановку.
    try {
      const verdict = typeof classifyPause === "function" ? classifyPause(info.kind, info.reason) : null;
      info.with = verdict ? String(verdict.with || "") : "";
    } catch {
      info.with = "";
    }
    // D-104: пауза — это когда цикл стоит. Разбор — когда он продолжается.
    //
    // `pause()` вызывается и там, где ничего останавливать не надо: временный
    // сбой повторяется сам, поломка уходит Maintainer'у. Раньше эти вызовы
    // писали в журнал «ПАУЗА» и снимали паузу кнопкой «Продолжить», хотя цикл
    // шёл дальше. Теперь вид остановки сам решает, стоит ли цикл, и запись
    // называется по факту: «ПАУЗА» — только там, где действительно стоим.
    const holds = typeof healHoldsCycle === "function" ? healHoldsCycle(info.kind, info.reason) : true;
    const forHuman = holds && (!info.with || info.with === "master");
    // D-094: вторая пауза того же инцидента не подменяет первую.
    //
    // 09.11 в 23:27:22 пришли две паузы в одну секунду: `prompt-compile` и
    // следом `arena-error` («Something went wrong»). Запись `K.paused` была
    // безусловной, поэтому причина осталась от второй, а `resume()` читал
    // контекст уже другой паузы — и в журнале появлялось «цикл на паузе ()» с
    // пустой причиной. Хуже: heal запускался ОБА раза, то есть на один инцидент
    // уходило два разбора и две передачи Maintainer'у.
    //
    // Теперь живая пауза того же инцидента остаётся на месте: причина и адресат
    // уже записаны, повторно их не пишем и разбор второй раз не запускаем.
    // Другая причина того же инцидента дописывается в контекст (`also`) — чтобы
    // не потерять факт, но не подменять ответственного.
    const live = typeof tabPauseContext === "function" ? tabPauseContext() : GM_getValue(K.pause, null);
    // Один инцидент — это либо буквально та же остановка (ключ совпал), либо
    // каскад по той же карточке: `arena-error` приходит через секунду после
    // `prompt-compile`, и причина у него своя. Вторая пауза каскада описывает
    // симптом, а не новую поломку, поэтому ответственным остаётся первая.
    // Окно короткое: через полминуты та же карточка может дать настоящую новую
    // остановку, и склеивать её с прошлой нельзя.
    // Признак каскада — не `ref` (у `arena-error` это id мёртвого сообщения, у
    // паузы сборки — карточка), а сама передача: она всё ещё не доставлена.
    // Пока один и тот же ход висит неотправленным, ошибка сайта через секунду —
    // его симптом, а не новая поломка. Каскадом считается только `arena-error`:
    // остальные остановки при неотправленном ходе говорят о своём и должны
    // подменять причину как раньше.
    const handoff = GM_getValue(K.expect, null) || GM_getValue(K.pending, null);
    const undelivered = Boolean(handoff && handoff.verified !== true);
    const cascade = info.kind === "arena-error" && undelivered && Number(live?.at) > 0 &&
      info.at - Number(live.at) <= (Number(C.pauseCascadeMs) || 15000);
    // D-102: «ждём установку» — это продолжение той же остановки, а не новая.
    //
    // 10.11, 12:59 и 13:11: две паузы подряд из одной поломки. Первая называла
    // дефект, вторая — что сборка не установлена. Мастер видит два события там,
    // где событие одно, и не понимает, какое из них смотреть.
    //
    // Ключ инцидента совпасть не мог: у пауз разные `kind` и разный текст
    // причины, а сопоставлять их по id бессмысленно. Зато `heal-await-update`
    // приходит только после `pause()` внутри разбора — значит прошлая остановка
    // и есть этот же инцидент. Когда разбор придёт к выводу, который требует
    // действия человека (предел, нет роли, деньги), пауза будет отдельной: это
    // другой `kind`, и правило его не трогает.
    const awaitedUpdate = info.kind === "heal-await-update";
    const sameIncident = Boolean(
      before && live && (
        (typeof healIncidentKey === "function" && healIncidentKey(info) === healIncidentKey(live)) ||
        cascade ||
        awaitedUpdate
      ),
    );
    if (sameIncident) {
      const also = Array.isArray(live.also) ? live.also.slice(-4) : [];
      if (!also.some((item) => item && item.reason === info.reason)) {
        also.push({ kind: info.kind, reason: info.reason, at: info.at });
      }
      if (typeof tabPauseContextSet === "function") tabPauseContextSet({ ...live, also, lastAt: info.at });
      else GM_setValue(K.pause, { ...live, also, lastAt: info.at });
      log(`ПАУЗА (та же остановка, причина уточнена): ${info.reason}`, true, { skip: true, ntfy: false });
      setStatus();
      return;
    }
    if (!holds) {
      // Цикл не останавливаем: причина уходит в журнал, разбор продолжает сам.
      //
      // Паузы нет — значит нет и естественного ограничителя: следующий тик
      // увидит ту же поломку и позвал бы разбор второй раз. Один инцидент =
      // один разбор, как и с паузой (D-094): повтор внутри окна
      // `pauseCascadeMs` только дописывает строку в журнал.
      const seen = Array.isArray(GM_getValue(K.notice, null)) ? GM_getValue(K.notice, null) : [];
      const key = typeof healIncidentKey === "function" ? healIncidentKey(info) : `${info.kind}|${info.reason}`;
      const last = seen.at(-1);
      const repeat = last && last.key === key && info.at - Number(last.at || 0) <= (Number(C.noticeRepeatMs) || 120000);
      const tail = seen.slice(-9);
      if (repeat) {
        tail[tail.length - 1] = { ...last, at: info.at, count: (Number(last.count) || 1) + 1 };
        GM_setValue(K.notice, tail);
        log(`Тот же разбор продолжается (${Number(last.count) || 1} раз): ${info.reason}`, false, { skip: true, ntfy: false });
        return;
      }
      tail.push({ key, kind: info.kind, reason: info.reason, at: info.at, with: info.with || "transport", count: 1 });
      GM_setValue(K.notice, tail);
      log(
        `Разбор без остановки${info.with === "transport" ? " (решает транспорт)" : info.with === "self" ? " (решает повтор)" : ""}: ${info.reason}`,
        true,
        { skip: true },
      );
      setStatus();
      if (context.heal !== false && typeof healAfterPause === "function") {
        Promise.resolve()
          .then(() => healAfterPause(info))
          .catch((e) => log(`Разбор остановки не выполнен: ${(e && e.message) || e}`, true, { ntfy: false }));
      }
      return;
    }
    if (typeof tabPauseSet === "function") tabPauseSet(info.reason);
    else GM_setValue(K.paused, info.reason);
    if (typeof tabPauseContextSet === "function") tabPauseContextSet(info);
    else GM_setValue(K.pause, info);
    log(`ПАУЗА${forHuman ? "" : ` (решает ${info.with === "warden" ? "приёмка" : info.with === "transport" ? "транспорт" : info.with === "install" ? "установка сборки" : "повтор"})`}: ${info.reason}`, true, { skip: true });
    // Тихая пауза — для остановок, которые Мастер не разбирает: вопрос ушёл
    // приёмке, миссию закрыли в обход неё, приёмка сама решает по существу.
    // С 1.4.80 такие события не повод звонить в телефон: их закрывает приёмка,
    // а Мастер нужен только там, где без него физически нельзя (нет роли,
    // нет прав, предел доработок).
    if (context.quiet || !forHuman || info.with === "install") {
      notifyNtfy(`Цикл остановлен: ${info.reason}`, {
        title: context.notifyTitle || "Relay: пауза",
        priority: "2",
        tags: "memo",
        cycleStopped: true,
        key: `pause:${info.kind}:${info.ref}:${info.runId}:${info.turnId}:${info.reason}`,
      });
    } else {
      notifyNtfy(`Цикл остановлен и ждёт Мастера: ${info.reason}`, {
        title: context.notifyTitle || "Relay: пауза",
        priority: "5",
        tags: "warning,rotating_light",
        cycleStopped: true,
      });
      playAlert();
    }
    setStatus();
    // D-073: разбор причины — последним шагом, когда состояние сохранено и Мастер
    // уже уведомлён. Отказ разбора не оставляет цикл без причины: пауза стоит, а
    // телеметрия и передача Maintainer'у — дополнительные шаги.
    // `context.heal === false` — не разбирать (повтор внутри самого разбора).
    if (context.heal !== false && typeof healAfterPause === "function") {
      Promise.resolve()
        .then(() => healAfterPause(info))
        .catch((e) => log(`Разбор остановки не выполнен: ${(e && e.message) || e}`, true, { ntfy: false }));
    }
  }

  /**
   * Передача потерялась: очередь и ожидание маркера относятся к ходу, которого
   * уже нет. Снимаем оба и ставим паузу, чтобы Мастер увидел причину, а не
   * бесконечное «жду ответа».
   */
  function dropHandoff(reason) {
    GM_setValue(K.pending, null);
    GM_setValue(K.expect, null);
    pause(reason, { kind: "no-reply" });
  }

  /**
   * Ход не дошёл до исполнителя — карточка не имеет права оставаться Running.
   *
   * «Running», «Started At» и «Run ID» ставит выдача (`dispatchTask`), и ставит
   * до отправки: иначе Координатор успел бы выдать ту же карточку второй раз.
   * Но «выдана» и «дошла» — разные вещи. Пока сообщения в чате нет, работы по
   * карточке тоже нет, а в Running она ждала бы `releaseStalled` — 45 минут
   * впустую, и всё это время человек видит Running там, где ничего не начато.
   * Вопрос Мастера (53) был ровно про это.
   *
   * Возвращаем Ready и снимаем Run ID со Started At. Своего «Submitted At» и PR
   * у такой карточки нет, поэтому повторная выдача не запрещена.
   */
  function rollbackProps(card, runId) {
    const props = card && card.properties;
    if (!props) return null;
    if (props["Dispatch State"]?.select?.name !== "Running") return null;
    if (props["Submitted At"]?.date?.start || props["PR"]?.url) return null;
    const onCard = rt(props["Run ID"]);
    if (runId && onCard && norm(onCard) !== norm(runId)) return null;
    return {
      "Dispatch State": { select: { name: "Ready" } },
      "Started At": { date: null },
      "Run ID": { rich_text: [] },
    };
  }

  /**
   * Признаки прошлого ответа на карточке: дата, ссылка на PR и номер прогона.
   *
   * Поля эти ставит транспорт, поэтому снимает их тоже он, а не Координатор
   * через коннектор: 25.10 коннектор отвечал `validation_error` на очистку, и
   * карточка запиралась (CASEA-2.3).
   */
  const answeredMarks = (card) => {
    const props = (card && card.properties) || {};
    return {
      "Submitted At": Boolean(props["Submitted At"]?.date?.start),
      "PR": Boolean(props["PR"]?.url),
      "Run ID": Boolean(rt(props["Run ID"])),
    };
  };
  const answeredCard = (card) => Object.values(answeredMarks(card)).some(Boolean);

  /**
   * Доказательство явного возврата в Rework для карточек с Check=fail.
   *
   * Отметка ставится только по снимку очереди, поэтому краткий переход
   * Rework→Ready между опросами может быть пропущен. В таком случае выдача
   * безопасно откажет и вернёт Coordinator техническую инструкцию оставить
   * карточку в Rework до следующего наблюдаемого опроса — без общей паузы на
   * первой попытке и без очистки Submitted At / PR / Run ID.
   */
  const reworkKey = (id) => `cfn-rework:${id}`;
  const reworkSeen = (id) =>
    Boolean(id) && typeof GM_getValue === "function" && Number(GM_getValue(reworkKey(id), 0)) > 0;

  function rememberRework(cards) {
    if (typeof GM_setValue !== "function") return;
    for (const card of cards || []) if (card && card.id) GM_setValue(reworkKey(card.id), Date.now());
  }

  /**
   * Отметка «вот в таком виде страницу оставил ответ».
   *
   * «Submitted At» пишет браузер, «last_edited_time» — Notion: часы у них
   * разные, сравнивать эти два времени напрямую нельзя. Поэтому запоминаем
   * ровно то время, которое Notion вернул на записи ответа: любая правка после
   * него — чужая, то есть карточку трогали уже после вердикта.
   */
  const answerStampKey = (id) => `cfn-answer-stamp:${id}`;
  function rememberAnswerStamp(id, page) {
    const at = page && page.last_edited_time;
    if (id && at && typeof GM_setValue === "function") GM_setValue(answerStampKey(id), String(at));
  }
  function editedSinceAnswer(card) {
    const stamp = card && card.id && GM_getValue(answerStampKey(card.id), "");
    if (!stamp || !card.last_edited_time) return false;
    return String(card.last_edited_time) !== String(stamp);
  }

  /**
   * Почему карточка снова идёт в работу — для журнала.
   *
   * Ни один из этих признаков не обязателен: право на повторную выдачу даёт
   * указание Координатора (см. `redispatchClearProps`). Признаки нужны, чтобы
   * Мастер видел причину, а не догадывался по логу Notion.
   */
  function redispatchWhy(card) {
    if (reworkSeen(card && card.id)) return "её видели в Rework";
    if (card?.properties?.["Check"]?.select?.name === "fail") return "проверка ответа не прошла (Check=fail)";
    if (editedSinceAnswer(card)) return "карточку правили после ответа";
    return "Координатор направил её в работу снова";
  }

  /**
   * Что снять с карточки, которую Координатор снова направил в работу.
   *
   * Ход в Ready направляет только Координатор — транспорт сам из Ready ничего
   * не берёт. Поэтому если он назвал эту карточку, значит работа нужна заново,
   * и следы прошлого ответа снимаются: без этого выдача отказывала и цикл
   * вставал (CASEA-4.9, 27.10).
   *
   * Осторожность сохранена там, где она нужна: если у роли в Ready есть и
   * свежая карточка, и отвеченная, берётся свежая (см. `pickReadyForRole`), —
   * повторная работа не подменяет новую.
   *
   * Чистка идёт одной записью: «Submitted At» (date), «PR» (url) и «Run ID»
   * (rich_text) снимаются пустыми значениями Notion — `null` и `[]`.
   */
  function redispatchClearProps(card) {
    const props = card && card.properties;
    if (!props) return null;
    if (props["Dispatch State"]?.select?.name !== "Ready") return null;
    // A failed check is not, by itself, authorization to erase the prior Run.
    // Only an observed Rework→Ready transition permits the clean redispatch path.
    if (props["Check"]?.select?.name === "fail" && !reworkSeen(card.id)) return null;
    if (!answeredCard(card)) return null;
    return {
      "Submitted At": { date: null },
      "PR": { url: null },
      "Run ID": { rich_text: [] },
    };
  }

  /**
   * Карточка этой роли из Ready: свежая вперёд.
   *
   * Отвеченная карточка — это Rework, а не новая работа. Если Координатор
   * направил ход роли, а у неё в Ready лежат обе, выдавать надо ту, которую ещё
   * не отвечали: иначе повторная работа подменит новую и Мастер получит две
   * копии одного задания.
   */
  function pickReadyForRole(ready, roleName) {
    const mine = (ready || []).filter((t) => norm(taskRole(t)) === norm(roleName));
    if (!mine.length) return null;
    return mine.find((t) => !answeredCard(t)) || mine[0];
  }

  /**
   * Счётчик повторных выдач одной карточки.
   *
   * Одна повторная выдача — нормальный Rework. Третья подряд за шесть часов —
   * это уже зацикливание: Координатор и исполнитель гоняют одну и ту же работу
   * и не замечают этого. Такую петлю показываем Мастеру, а счётчик обнуляем,
   * чтобы «Продолжить» действительно продолжало, а не упиралось в тот же
   * порог.
   */
  const redispatchKey = (id) => `cfn-redispatch:${id}`;
  const REDISPATCH_WINDOW = 6 * 3600 * 1000;
  const REDISPATCH_LIMIT = 3;
  function noteRedispatch(id) {
    const now = Date.now();
    const kept = (GM_getValue(redispatchKey(id), []) || []).map(Number).filter((at) => now - at < REDISPATCH_WINDOW);
    kept.push(now);
    GM_setValue(redispatchKey(id), kept);
    return kept.length;
  }

  /**
   * Вернуть карточку в Ready, если ход так и не ушёл.
   *
   * true — карточка действительно переписана; вызывающий по этому признаку
   * решает, снимать ли очередь и ожидание. Ошибка Notion ход не съедает: всё
   * остаётся как было, и работает прежнее правило 45 минут.
   */
  async function releaseUndelivered(expect, why, { cause = "undelivered" } = {}) {
    if (!expect || expect.kind !== "dispatch" || !expect.ref) return false;
    let card;
    try {
      card = await notion("GET", `pages/${expect.ref}`);
    } catch (e) {
      log(`Карточку «${expect.ref}» не прочитать — статус не снимаю: ${e.message}`, true);
      return false;
    }
    const runId = rt(card.properties["Run ID"]);
    // Сверяем с выдачей, которая не ушла: если карточку уже перевыдали с другим
    // Run ID, откат снял бы чужой, живой ход.
    const props = rollbackProps(card, expect.runId || runId);
    if (!props) return false;
    try {
      await patch(card.id, props);
    } catch (e) {
      log(`«${taskTitle(card)}» осталась в Running: статус не снялся (${e.message}).`, true);
      return false;
    }
    const logId = rt(card.properties["Output Drive File ID"]);
    if (logId) {
      try {
        await gateway("append", logId, {
          marker: `<!-- CF_DISPATCH ${card.id}:${runId}:${cause} -->`,
          entry:
            `\n\n<!-- CF_DISPATCH ${card.id}:${runId}:${cause} -->\n## ` +
            `${cause === "manual-reset" ? "Ход снят Мастером" : "Ход не дошёл до исполнителя"}\n\n` +
            `${why}\n\nКарточка возвращена в Ready, «Started At» и «Run ID» сняты: работы по ней не было.\n`,
        });
      } catch (e) {
        log(`Отметка о неудачной отправке не записалась в журнал: ${e.message}`, true);
      }
    }
    log(
      `«${taskTitle(card)}» возвращена в Ready: ${why}.` +
        (cause === "manual-reset" ? "" : " В Running она бы ждала 45 минут."),
      true,
      { ntfy: "quiet", title: "Relay: карточка возвращена в Ready" },
    );
    return true;
  }

  function resume(reason = "проверено Мастером") {
    const before = typeof tabPauseReason === "function" ? tabPauseReason() : GM_getValue(K.paused, "");
    if (!before) return;
    const paused = typeof tabPauseContext === "function" ? tabPauseContext() : GM_getValue(K.pause, null);
    if (typeof tabPauseSet === "function") tabPauseSet("");
    else GM_setValue(K.paused, "");
    if (typeof tabPauseContextSet === "function") tabPauseContextSet(null);
    else GM_setValue(K.pause, null);
    // Пауза из-за «Something went wrong»: сообщение не приняли, и ожидание
    // ответа — фикция. «Продолжить» — это и есть просьба отправить заново,
    // поэтому окно свежести ошибки (`arenaRetryMs`) считается от нажатия, а в
    // очередь кладётся минимальное сообщение «прочитай карточку сам». Старая
    // отметка «эту ошибку уже видели» снимается: иначе новый код её не тронет.
    if (paused && paused.kind === "arena-error") {
      GM_setValue(K.errSeen, "");
      const waiting = GM_getValue(K.expect, null);
      if (waiting && waiting.kind === "dispatch" && (waiting.roleFn === "Reviewer" || !waiting.roleFn ||
          String(waiting.roleName || "").toLowerCase() === "warden")) {
        pause("Ошибка Arena на старой или нераспознанной карточке Reviewer: не повторяю выдачу и сохраняю ожидание. Проверьте чат и Run ID.",
          { kind: "reviewer-task-pending", ref: waiting.ref || "", runId: waiting.runId || "" });
        return;
      }
      if (waiting) {
        GM_setValue(K.expect, {
          ...waiting,
          sentAt: Date.now(),
          verified: false,
          arenaResend: 0,
        });
        retryRejectedHandoff(
          GM_getValue(K.expect, null),
          { messageId: paused.ref || "" },
          "Пауза была из-за ошибки Arena",
        );
      } else {
        log("Пауза была из-за ошибки Arena, а ожидания уже нет: нажмите «Шаг», чтобы начать ход заново.", true);
      }
    }
    // Новый бюджет напоминаний: Мастер уже посмотрел, почему агент молчал.
    const expect = GM_getValue(K.expect, null);
    if (expect) {
      // «Продолжить» возвращает право и на автоматический повтор после ошибки
      // Arena (`arenaResend`), и на напоминания: Мастер уже увидел ошибку и ждёт,
      // что задание уйдёт само.
      GM_setValue(K.expect, {
        ...expect,
        tries: 0,
        autoResend: 0,
        arenaResend: 0,
        lastReplySig: "",
        lastReplyAt: 0,
      });
    }
    // D-073: пауза снята — либо человеком, либо автопродолжением разбора.
    // Незакрытая передача Maintainer'у снимается вместе с паузой: иначе
    // следующая остановка считала бы, что разбор ещё идёт.
    if (typeof healState === "function") {
      const heal = healState();
      if (heal.pending) saveHealState({ ...heal, pending: null, resumedAt: new Date().toISOString() });
    }
    log(`Пауза снята Мастером (${reason}). Продолжаю.`, false, { ntfy: "quiet" });
    if (GM_getValue(K.pending, null)) {
      // D-045: при потерянном ожидании сообщение уже могло уйти. Обещать
      // повторную отправку нельзя — сначала сверка карточки и чата. Так же и
      // после обновления скрипта: очередь без ожидания разбирает сверка.
      log(
        (paused && paused.kind === "delivery-state-lost") || !expect
          ? "Задание в очереди, но сообщение могло уже уйти: сначала сверю чат и карточку и только потом решу, нужна ли отправка."
          : "Задание уже в очереди — отправляю его заново, новый ход Координатора не нужен.",
        false,
        { ntfy: "quiet" },
      );
    }
  }

  /**
   * Проверка после капчи: задание действительно дошло до агента?
   *
   * 24.10 (13:47) отправка была засчитана в 13:47:03, окно проверки всплыло в
   * 13:47:15. Мастер решил капчу и нажал «Продолжить» — а скрипт, у которого
   * очередь уже была снята, честно ждал ответа на сообщение, которого агент не
   * получал: тридцать минут впустую и карточка в Running.
   *
   * Признак настоящей доставки — поздний: агент начал ход. Если после отметки
   * нет ни одного его сообщения и он не работает, ход потерян.
   */
  async function verifyAfterCaptcha(ctx) {
    if (!ctx || ctx.kind !== "captcha") return false;
    const expect = GM_getValue(K.expect, null);
    if (!expect || !expect.sentAt) return false;
    // Агенту нужно время, чтобы начать: сразу после «Продолжить» он молчит и
    // при доставленном задании.
    for (let i = 0; i < 3; i += 1) {
      await sleep(1500);
      if (stillWorking() || generating()) return false;
    }
    if (messagesAfter(expect.watermark || "").length) return false;
    const isDispatch = expect.kind === "dispatch" && Boolean(expect.ref);
    const rolled = isDispatch ? await releaseUndelivered(expect, "капча не пропустила задание") : true;
    GM_setValue(K.expect, null);
    GM_setValue(K.pending, null);
    if (!rolled) {
      log("Задание до агента не дошло: капча закрыла отправку, а карточку вернуть в Ready не удалось. Статус оставлен как есть.", true);
      return false;
    }
    log(
      isDispatch
        ? "Задание до агента не дошло: капча закрыла отправку, ответа нет. Карточка возвращена в Ready — выдаю заново."
        : "Ход Координатора до агента не дошёл: капча закрыла отправку. Запрошу план заново.",
      true,
      { ntfy: "quiet", title: "Relay: задание не дошло, выдаю заново" },
    );
    return true;
  }

  function roleFromPath() {
    const id = (location.pathname.match(/\/agent\/([\w-]+)/) || [])[1];
    return id || "";
  }

  function relayManagedMode() {
    return typeof relayControlActive === "function" && relayControlActive();
  }

  function setStatus(extra) {
    const el = document.getElementById(ui.status);
    if (!el) return;
    const auto = autoOn();
    const paused = typeof tabPauseReason === "function" ? tabPauseReason() : GM_getValue(K.paused, "");
    const me = GM_getValue("cfn-me", "");
    const short = paused.length > 70 ? `${paused.slice(0, 70)}…` : paused;
    // D-092: панель называет адресата. «Пауза» без адресата читается как
    // «нужен Мастер», а теперь это не так: постановку разбирает приёмка,
    // поломку — транспорт. Красный цвет — только тому, что правда ждёт человека.
    const who = String((typeof tabPauseContext === "function" ? tabPauseContext() : GM_getValue(K.pause, null))?.with || "");
    const label = { master: "ждёт Мастера", warden: "решает приёмка", transport: "решает транспорт", self: "повтор", install: "ждёт установки сборки" }[who] || "";
    // D-004: метка аккаунта рядом с ролью. Без неё на четырёх контейнерах
    // невозможно понять, какая это вкладка, и «почему не идёт» ищут не там.
    const account = (() => {
      try {
        const role = typeof accountRoleForPath === "function" ? accountRoleForPath() : null;
        const labelValue = String(role?.account || "");
        if (!labelValue) return "";
        return typeof accountLimit === "function" && accountLimit(labelValue) ? `${labelValue}: лимит` : labelValue;
      } catch { return ""; }
    })();
    const text = extra || (paused ? `Пауза${label ? ` (${label})` : ""}: ${short}` : auto ? "Работает" : "Выключен");
    const relayLabel = typeof relayConnectionLabel === "function" ? relayConnectionLabel() : "";
    const tail = [relayLabel, account, me].filter(Boolean).join(" · ");
    el.textContent = tail ? `${text} · ${tail}` : text;
    el.title = paused || [text, relayLabel].filter(Boolean).join(" · ");
    // Красным — только пауза, которая действительно ждёт человека.
    el.style.color = paused ? (who && who !== "master" ? "#e8d08a" : "#ff9a9a") : auto ? "#8ee28e" : "inherit";
    const toggle = document.getElementById(ui.toggle);
    if (toggle) {
      toggle.textContent = paused ? "▶ Продолжить" : auto ? "⏸ Стоп" : "▶ Включить";
      if (relayManagedMode()) toggle.title = "Временный локальный автоцикл ScriptCat; основной ручной запуск — в пульте Relay";
      toggle.style.background = paused ? "#3a3320" : auto ? "#3a2a2a" : "#24402a";
      toggle.style.borderColor = paused ? "#6b5a2a" : auto ? "#6b3a3a" : "#3f6b45";
    }
    paintPanelChrome();
  }

  const paintDebugButton = () => {
    const el = document.getElementById(ui.debug);
    if (!el) return;
    const on = debugOn();
    el.style.background = on ? "#2c4a6b" : "#242833";
    el.style.borderColor = on ? "#4a7ba7" : "#343a46";
    el.title = on ? "Отладка включена: подробности в консоли браузера" : "Отладка в консоли браузера (F12)";
  };

  /**
   * Компактный виджет исполнителя, а не второй пульт.
   *
   * Основные команды находятся в Relay. ScriptCat оставляет только имя проекта,
   * краткий статус, ссылку в пульт и по раскрытию — локальный журнал с парой
   * узких инструментов обратной связи/агентов. Развёрнутый журнал закрыт по
   * умолчанию и запоминает выбор в локальном хранилище.
   */
  const panelCollapsed = () => GM_getValue(K.collapsed, true) === true;

  function paintPanelChrome() {
    const panel = document.getElementById(ui.panel);
    if (!panel) return;
    const collapsed = panelCollapsed();
    panel.classList.toggle("cfn-panel-collapsed", collapsed);
    panel.style.width = collapsed ? "270px" : "360px";
    const details = document.getElementById("cfn-panel-details");
    if (details) details.style.display = collapsed ? "none" : "";
    const relayLink = document.getElementById(ui.relay);
    if (relayLink) {
      const base = typeof relayBase === "function" ? relayBase() : "";
      relayLink.href = base || "#";
      relayLink.style.display = base ? "" : "none";
    }
    const status = document.getElementById(ui.status);
    if (status) status.style.maxWidth = collapsed ? "110px" : "190px";
    const localResume = document.getElementById(ui.localResume);
    if (localResume) localResume.style.display = isPaused() ? "" : "none";
    const button = document.getElementById(ui.collapse);
    if (!button) return;
    button.textContent = collapsed ? "⌄" : "⌃";
    button.title = collapsed ? "Показать журнал и дополнительные инструменты" : "Свернуть до статуса";
  }

  function togglePanel() {
    GM_setValue(K.collapsed, !panelCollapsed());
    paintPanelChrome();
  }

  function mount() {
    if (document.getElementById(ui.panel)) return;
    const panel = document.createElement("div");
    panel.id = ui.panel;
    panel.style.cssText = [
      "position:fixed", "right:14px", "bottom:14px", "z-index:2147483000",
      "width:360px", "background:#15171c", "color:#e7eaee", "border:1px solid #2b2f38",
      "border-radius:10px", "font:12px/1.4 ui-monospace,Menlo,Consolas,monospace",
      "box-shadow:0 10px 30px rgba(0,0,0,.45)", "overflow:hidden",
    ].join(";");
    panel.innerHTML = `
      <div style="display:flex;align-items:center;gap:7px;padding:7px 9px;background:#1b1e25;flex-wrap:nowrap">
        <strong id="cfn-panel-project" style="font-size:11px;max-width:95px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">Relay</strong>
        <span style="opacity:.45;font-size:9px" title="версия скрипта">v${SCRIPT_VERSION}</span>
        <span id="${ui.status}" style="opacity:.8;font-size:10px;max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">…</span>
        <span style="flex:1"></span>
        <a id="${ui.relay}" href="#" target="_blank" rel="noopener noreferrer" title="Открыть основной пульт Relay" style="${btnStyle()};text-decoration:none;white-space:nowrap">Пульт ↗</a>
        <button id="${ui.collapse}" aria-label="Показать журнал" title="Показать журнал и дополнительные инструменты" style="${btnStyle()}">⌄</button>
      </div>
      <div id="cfn-panel-details" style="display:none;border-top:1px solid #2b2f38;padding:6px 9px">
        <div style="display:flex;gap:6px;margin-bottom:6px">
          <button id="${ui.questions}" aria-label="Открыть обратную связь в Notion" title="Обратная связь" style="${btnStyle()}">💬 Обратная связь<span id="${ui.qBadge}" style="display:none;margin-left:3px;padding:0 4px;border-radius:7px;background:#b23b3b;color:#fff;font-size:10px;line-height:14px;vertical-align:middle">0</span></button>
          <button id="${ui.agents}" title="Управление Arena-агентами" style="${btnStyle()}">🤖 Агенты</button>
        </div>
        <details style="margin:0 0 6px;font-size:10px">
          <summary style="cursor:pointer;opacity:.65">Обслуживание</summary>
          <div style="display:flex;gap:5px;padding:5px 0;flex-wrap:wrap">
            <button id="${ui.localResume}" title="Снять локальную паузу после подтверждения; основной запуск остаётся в пульте" style="${btnStyle()};display:none">▶ Снять локальную паузу…</button>
            <button id="${ui.debug}" title="Отладка в консоли браузера (F12)" style="${btnStyle()}">🐞</button>
            <button id="${ui.reset}" title="Снять локальный ход; очередь и ожидания будут очищены" style="${btnStyle()}">↺ Сброс хода</button>
            <button id="${ui.clear}" title="Очистить только журнал" style="${btnStyle()}">🧹</button>
          </div>
        </details>
        <div style="display:flex;justify-content:space-between;opacity:.6;font-size:10px;margin:2px 0"><span>Журнал</span><span id="${ui.count}">0/${C.maxLog}</span></div>
        <div id="${ui.log}" style="max-height:125px;overflow:auto"></div>
      </div>`;
    document.body.appendChild(panel);

    document.getElementById(ui.collapse).onclick = () => togglePanel();
    document.getElementById(ui.questions).onclick = () => window.open(C.questionsUrl, "_blank", "noopener");
    document.getElementById(ui.localResume).onclick = () => {
      if (!isPaused()) return;
      const work = toggleAuto();
      return typeof trackProjectTask === "function" ? trackProjectTask(work) : work;
    };
    document.getElementById(ui.clear).onclick = () => clearLog();
    document.getElementById(ui.debug).onclick = () => {
      const on = !debugOn();
      GM_setValue(K.debug, on);
      debugApi.debug(on);
      installDebugApi();
      log(on ? "Отладка включена: подробности идут в консоль браузера (F12)." : "Отладка выключена.");
      paintDebugButton();
    };
    document.getElementById(ui.reset).onclick = () => {
      const work = resetStateDialog();
      (typeof trackProjectTask === "function" ? trackProjectTask(work) : work)
        .catch((error) => log(`Сброс не удался: ${error.message}`, true));
    };
    const agentsButton = document.getElementById(ui.agents);
    if (agentsButton) agentsButton.onclick = () => {
      if (typeof provisionOpenDialog === "function") provisionOpenDialog();
    };
    const projectLabel = document.getElementById("cfn-panel-project");
    if (projectLabel) projectLabel.textContent = C.projectName || "Relay";
    renderLog();
    setStatus();
    paintDebugButton();
    paintPanelChrome();
    paintQuestions(openQuestions().rows);
    watchQuestions();
    // ADR без записи всё ещё обнаруживается в фоне и попадает в ту же базу.
    watchDecisions();
  }

  async function toggleAuto() {
    if (typeof projectApproved === "function" && !projectApproved()) {
      log(typeof projectBlockedText === "function" ? projectBlockedText()
        : "Проект не разрешён к работе: откройте пульт Relay и проверьте активный профиль.", true);
      if (typeof noteFeedbackPipelineHeld === "function") noteFeedbackPipelineHeld();
      return;
    }
    const auto = autoOn();
    const reason = typeof tabPauseReason === "function" ? tabPauseReason() : GM_getValue(K.paused, "");

    // Пауза. Снять её может только человек: подтверждение показывает причину.
    if (reason) {
      if (!confirm(`Цикл стоит на паузе.\n\nПричина: ${reason}\n\nСнять паузу и продолжить?`)) return;
      if (typeof releaseProjectHold === "function" && !releaseProjectHold()) return;
      const ctx = (typeof tabPauseContext === "function" ? tabPauseContext() : GM_getValue(K.pause, null)) || {};
      // Возвращаем тот режим, в котором цикл стоял: пауза не должна
      // превращать ручной шаг в постоянный автоцикл.
      autoSet(ctx.wasAuto === true);
      resume("кнопка «Продолжить»");
      // Капча могла всплыть уже после того, как скрипт записал «отправлено»:
      // тогда без этой проверки «Продолжить» ждёт ответа на неотправленное.
      await verifyAfterCaptcha(ctx);
      tick(true);
      return;
    }

    if (auto) {
      autoSet(false);
      log("Автоцикл выключен.");
      return;
    }

    if (typeof releaseProjectHold === "function" && !releaseProjectHold()) return;
    autoSet(true);
    log("Автоцикл включён.");
    // Обычный тик, а не «Шаг»: в автоцикле нет нажатия, и следующая страница
    // открывается сама, если работы нет на текущей.
    tick(false);
  }

  function btnStyle() {
    return "background:#242833;color:#e7eaee;border:1px solid #343a46;border-radius:6px;padding:2px 6px;cursor:pointer;font:11px/1.2 inherit";
  }
