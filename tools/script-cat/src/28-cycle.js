  // ───────────────────────────── цикл ─────────────────────────────
  let busy = false;
  /** Сколько раз подряд шаг снимали с блокировки по тишине. */
  let stepRestarts = 0;

  /**
   * «Шаг жив». Сторож снимает блокировку через две минуты, а ожидание мержа
   * длится до пяти — без этой отметки долгий, но честный шаг выглядел
   * зависанием, и второй тик запускал его заново поверх первого (24.10, 14:48).
   */
  function stepAlive() {
    busyAt = Date.now();
    // D-006: шаг идёт — заявка «делаю я» должна быть живой, иначе вкладка того
    // же аккаунта посчитает её брошенной и начнёт второй такой же.
    if (typeof wakeHold === "function") wakeHold();
  }

  /**
   * Перейти на страницу роли. Один и тот же переход из одного и того же места
   * дважды за 30 секунд — это не «ещё раз», а зацикливание: значит страница не
   * открылась или адрес в «Ролях» указывает не туда. Тогда пауза и понятная
   * причина, а не бесконечные прыжки.
   */
  async function navigateTo(role, why) {
    if (typeof projectRoleAllowed === "function" && !projectRoleAllowed(role)) return false;
    // D-004: аккаунт цели. Вкладка живёт в контейнере (`location.assign` не
    // меняет контейнер), поэтому переход на роль другого аккаунта откроет её
    // страницу ЧУЖИМ аккаунтом — задание ушло бы не туда. Поэтому чужой аккаунт
    // и доказанный лимит одинаково запрещают переход.
    if (role && typeof roleAccount === "function" && roleAccount(role)) {
      const hit = typeof accountBlocked === "function" ? accountBlocked(roleAccount(role)) : null;
      if (hit && !hit.expired) {
        log(`Не открываю «${role.name}»: «${roleAccount(role)}» в лимите до ${accountResetText(hit.until)}.`, true, { ntfy: "quiet" });
        return false;
      }
      const current = typeof accountMismatchSync === "function" ? accountMismatchSync(role) : { wrong: false };
      if (current.wrong) {
        // Адрес роли из другого контейнера открывается в этом: страница
        // откроется чужим аккаунтом. Это не поломка, а «здесь эта роль не
        // живёт»: вкладка переключается руками, а ход ждёт своего контейнера.
        logThrottled(
          `account-nav:${role.id}`,
          `Не открываю «${role.name}»: роль закреплена за «${current.label}» (${current.expected}), ` +
            `а вкладка в контейнере ${current.seen}. Переход внутри контейнера не переключает аккаунт — ` +
            "эту роль открывает её собственная вкладка; я её будил, работа продолжится там.",
          false,
          600_000,
        );
        // D-006: нажали «Шаг»/«Все вкладки» не в том контейнере — работа не
        // теряется. Ровно этот отказ раньше оставлял Мастера гадать, почему
        // нажатие ничего не сделало; теперь нужная вкладка узнаёт о работе.
        if (typeof wakeOnce === "function") wakeOnce(`nav:${role.id}`, `роль «${role.name}» живёт в другой вкладке`);
        return false;
      }
    }
    // D-008: подпись сайдбара — не единственный свидетель.
    //
    // 24.11, 22:25: ход возвращался Координатору, а вкладка стояла на странице
    // UX & Modding Auditor (другой контейнер). Подпись там была свёрнута до
    // иконок (`icon-collapsed`), проверка выше ответила «сравнивать нечего», и
    // переход открыл адрес Координатора ЧУЖИМ аккаунтом — ровно тот же отказ,
    // что D-007 вылечил для отправки задания.
    //
    // Здесь спрашиваем то же, что и перед отправкой: чья страница? Это не
    // запрет на переход, а выбор: чужая страница отдаёт ход своей вкладке
    // (её будит `wakeOnce`), своя — переходит как обычно.
    if (role && norm(roleFromPath()) !== norm(role.id) && typeof accountPageCheck === "function") {
      const page = await accountPageCheck(role).catch(() => ({ verdict: "unknown" }));
      if (page.verdict === "foreign") {
        logThrottled(
          `page-nav:${role.id}`,
          `Не открываю «${role.name}»: страница открыта аккаунтом ${page.seen}, а роль закреплена за ` +
            `«${page.label}» (${page.expected}). Переход внутри контейнера не переключает аккаунт — ` +
            "ход заберёт вкладка этого аккаунта.",
          false,
          600_000,
        );
        if (typeof wakeOnce === "function") wakeOnce(`nav:${role.id}`, `роль «${role.name}» живёт в другой вкладке`);
        return false;
      }
    }
    const from = location.pathname || "/";
    const last = GM_getValue("cfn-nav", null);
    const recent =
      last &&
      norm(last.roleId) === norm(role.id) &&
      last.from === from &&
      Date.now() - Number(last.at || 0) < 30_000;
    if (recent) {
      pause(
        `Не удалось открыть страницу «${role.name}»: остаюсь на ${from}. ` +
          "Страница не открылась за два перехода подряд — возможно, медленная загрузка или адрес в «Ролях» неверен. Проверьте адрес и нажмите «Продолжить».",
        { kind: "nav", ref: role.id },
      );
      return true;
    }
    // D-015: адрес берётся у пары (роль, слот), если в строке «Ролей» его нет.
    // Пустой адрес — не «поеду в никуда», а причина, названная вслух.
    const deliveryUrl = await roleDeliveryUrl(role);
    if (!deliveryUrl) {
      const addressWhy = await roleAddressWhy(role.name).catch(() => "");
      log(`Страница «${role.name}» не открыта: ${addressWhy || "нет адреса агента"}.`, true);
      return false;
    }
    GM_setValue("cfn-nav", { roleId: role.id, from, at: Date.now() });
    log(`Сейчас ${from} — открываю страницу «${role.name}»: ${why}.`);
    // D-045: отметку перехода и журнал надо довести до хранилища до ухода со
    // страницы, иначе защита от петли прочитает прежнюю отметку и цикл прыгнет
    // снова — уже без памяти о первом переходе.
    await flushBeforeNavigate(handoffKeys());
    location.assign(deliveryUrl);
    return true;
  }

  /**
   * D-004: вкладка стоит в контейнере другого аккаунта.
   *
   * Ни паузы, ни перехода: контейнер меняет человек, а `pause` общая на все
   * вкладки — «эта роль не здесь» остановило бы и те аккаунты, где работа идёт.
   * Шаг просто пропускается; в журнале сказано один раз, что именно не так.
   */
  function idleWrongAccount(me, verdict, fromToggle) {
    if (fromToggle)
      log(`Шаг не выполнен: ${verdict.why}. Эта вкладка в контейнере другого аккаунта — откройте роль в её контейнере.`, true);
    else
      logThrottled(`account-mismatch:${me.id}`, `Шаг пропущен: ${verdict.why}. Вкладка в контейнере другого аккаунта; переключить его может только человек.`, false, 600_000);
    // D-006: вкладка, ушедшая из-за чужого контейнера, — ровно тот случай, когда
    // раньше очередь тихо ждала нажатия. Работа могла быть уже поставлена до
    // того, как выяснилось расхождение, поэтому будим остальных: своя вкладка
    // (в нужном контейнере) подхватит её сама.
    if (typeof wakeOnce === "function") wakeOnce(`wrong:${me.id}`, `вкладка не на своём аккаунте: ${me.name}`);
    return false;
  }

  /**
   * D-004: роль на лимитированном аккаунте — эта вкладка отдыхает.
   *
   * Аккаунты разделены контейнерами Firefox, а `location.assign` контейнер не
   * меняет: уйти «на другой аккаунт» из этой вкладки нельзя — откроется та же
   * учётная запись. Уходят не вкладки, а ход: остальные контейнеры крутят свои
   * шаги сами, и общая очередь (`K.pending`, `K.expect`) достаётся тому, кто
   * может её взять.
   *
   * Поэтому здесь пауза не ставится: `pause` общая на все вкладки, и «лимит
   * рабочего аккаунта» остановил бы ровно то, ради чего всё затевалось —
   * работу остальных. Вкладка молчит до сброса окна и говорит об этом один раз.
   */
  function idleLimitedAccount(me, fromToggle) {
    // D-006: лимит этого аккаунта не должен держать работу, которая может уйти
    // другому. Будим остальные вкладки — та, чей аккаунт доступен, продолжит.
    // Своя роль лимитирована по определению, поэтому проверять нечего: будим.
    if (typeof wakeOnce === "function") wakeOnce(`limit:${accountLabel(roleAccount(me))}`, `аккаунт «${accountLabel(roleAccount(me))}» в лимите`);
    if (fromToggle)
      log(`Шаг не выполнен: «${me.name}» на аккаунте в лимите${accountLimitLines().length ? ` (${accountLimitLines().join("; ")})` : ""}. Работа идёт во вкладках других аккаунтов.`, true);
    else
      logThrottled(
        `account-idle:${me.id}`,
        `Ход этой вкладки ждёт сброса окна: «${me.name}» на лимитированном аккаунте` +
          `${accountLimitLines().length ? ` (${accountLimitLines().join("; ")})` : ""}. Другие аккаунты работают своими вкладками.`,
        false,
        600_000,
      );
    return false;
  }

  // Ожидание, снятое как фантом, — чтобы тик мог вернуть его карточку в Ready.
  let droppedHandoff = null;
  // Ожидание, снятое обновлением скрипта: карточку вернёт первый же шаг.
  let ghostAfterUpdate = null;

  /**
   * Отправка без подтверждения — не отправка.
   *
   * До 1.4.7 `sentAt` ставился сразу после клика, не глядя, дошёл ли он:
   * карточка «review panel» возвращалась и накрывала кнопку Send, сообщение
   * не появлялось, а скрипт потом честно ждал ответа на несуществующий
   * вопрос. Такое ожидание возвращаем в очередь и отправляем заново.
   */
  function reviveUnverifiedHandoff() {
    const waiting = GM_getValue(K.expect, null);
    if (!waiting) return "";
    // Ответный возврат — не рабочая карточка: потеря подтверждения никогда не
    // разрешает его снять. Сначала квитанция/собственная реплика, иначе очередь
    // восстанавливается с теми же question_id/turn_id и тем же текстом.
    if (waiting.kind === "answer-return" && waiting.verified !== true) {
      const proof = typeof restoreMissingSendMark === "function" ? restoreMissingSendMark(waiting) : null;
      if (proof?.verified === true && Number(proof.sentAt) > 0) return "";
      if (GM_getValue(K.pending, null)) return "";
      if (!String(waiting.text || "").trim()) {
        pause("Прямой возврат ответа потерял текст до подтверждения доставки. Ответ в Notion сохранён; локальный маршрут удержан.", {
          kind: "answer-return-lost", ref: waiting.ref || "", turnId: waiting.turnId || "",
        });
        return "answer-return-held";
      }
      GM_setValue(K.pending, {
        roleId: waiting.roleId, roleName: waiting.roleName, roleUrl: waiting.roleUrl,
        roleFn: waiting.roleFn || "", kind: waiting.kind, ref: waiting.ref,
        questionId: waiting.questionId || waiting.ref, missionId: waiting.missionId || "",
        turnId: waiting.turnId, title: waiting.title || "прямой возврат ответа",
        sourceRoleName: waiting.sourceRoleName || "", sourceRoleId: waiting.sourceRoleId || "",
        text: waiting.text, at: Date.now(),
      });
      log("Прямой возврат ответа не подтверждён: восстанавливаю ту же очередь, новая реплика не создана.", true);
      return "revived";
    }
    if (!Number(waiting.sentAt) || waiting.verified === true) return "";

    // Водяной знак относится к чату адресата. На чужой странице чужой ответ
    // нельзя принять за подтверждение доставки старой карточки Reviewer.
    if (waiting.kind === "dispatch" && (waiting.roleFn === "Reviewer" || !waiting.roleFn ||
        norm(waiting.roleName) === norm("Warden")) && !waiting.isDispatchReminder &&
        (!waiting.roleId || norm(roleFromPath()) !== norm(waiting.roleId))) {
      pause("Доставка старой карточки Reviewer не подтверждена, а открыт другой чат. Ожидание сохранено: проверьте чат адресата и Run ID.",
        { kind: "reviewer-task-pending", ref: waiting.ref || "", runId: waiting.runId || "" });
      return "reviewer-held";
    }

    // Если после водяного знака в чате уже что-то появилось, отправка всё-таки
    // дошла (или агент успел ответить): повторять нельзя, иначе будет дубль.
    if (messagesAfter(waiting.watermark || "", waiting.seen).length) {
      GM_setValue(K.expect, { ...waiting, verified: true });
      dbg("revive: после водяного знака есть сообщения — считаю отправку доставленной");
      return "";
    }

    // Это может быть старый уже отправленный ход Reviewer с потерянным
    // подтверждением. Не переотправляем рабочую карточку и не стираем ход.
    if (waiting.kind === "dispatch" && (waiting.roleFn === "Reviewer" || !waiting.roleFn ||
        norm(waiting.roleName) === norm("Warden")) && !waiting.isDispatchReminder) {
      pause("Отправка старой или нераспознанной карточки Reviewer не подтверждена. Не повторяю её и сохраняю ожидание и карточку: проверьте чат и Run ID.",
        { kind: "reviewer-task-pending", ref: waiting.ref || "", runId: waiting.runId || "" });
      return "reviewer-held";
    }
    const text = String(waiting.text || "");
    GM_setValue(K.expect, null);
    GM_setValue("cfn-plan-at", 0);
    if (!text) {
      droppedHandoff = waiting;
      log(
        "Снял ожидание без подтверждённой отправки: в чат ничего не ушло, текста задания не сохранилось. " +
          "Нажмите «Шаг», чтобы начать ход заново.",
        true,
      );
      return "dropped";
    }
    GM_setValue(K.pending, {
      roleId: waiting.roleId,
      roleName: waiting.roleName,
      roleUrl: waiting.roleUrl,
      text,
      at: Date.now(),
    });
    log(
      `Прошлая отправка «${waiting.title || waiting.kind}» не подтверждена (сообщение в чате не появилось) — ` +
        "ставлю задание обратно в очередь и отправляю заново.",
      true,
    );
    return "revived";
  }

  /** Не снимаем потенциально живую старую выдачу Reviewer без очереди. */
  async function holdLegacyUnsentDispatch() {
    const waiting = GM_getValue(K.expect, null);
    if (!waiting || waiting.kind !== "dispatch" || Number(waiting.sentAt) || GM_getValue(K.pending, null)) return false;
    let hold = waiting.roleFn === "Reviewer" || norm(waiting.roleName) === norm("Warden");
    if (!hold) {
      try {
        const owners = (await roleRows({ fresh: true, requireFresh: true }))
          .filter((r) => r.id && norm(r.id) === norm(waiting.roleId));
        hold = !owners.length || owners.some((r) => r.fn === "Reviewer" || norm(r.name) === norm("Warden")) ||
          !owners.some((r) => r.status === "Активна" && ["Executor", "Auditor"].includes(r.fn));
      } catch {
        hold = true;
      }
    }
    if (!hold) return false;
    pause("Старая выдача Reviewer или её адресат не подтверждены. Карточку не откатываю, ожидание сохранено: проверьте чат и Run ID.",
      { kind: "reviewer-task-pending", ref: waiting.ref || "", runId: waiting.runId || "" });
    return true;
  }

  /**
   * Один отложенный повтор нажатого «Шага». Он ничего не отправляет: первый
   * проход остановился до любой отправки, значит дубля не будет. Нужен потому,
   * что кнопка Stop может быть мгновенной заставкой загрузки страницы.
   */
  let stepRetry = 0;
  function scheduleStepRetry(delayMs = 4000) {
    if (stepRetry >= 2) return;
    stepRetry += 1;
    log(`Проверю ещё раз через ${Math.round(delayMs / 1000)} с: если это была заставка загрузки, шаг пойдёт сам.`);
    setTimeout(() => {
      if (busyReason()?.kind === "stop") {
        log("Кнопка Stop всё ещё на месте — шаг остаётся на паузе до вашего нажатия.");
        stepRetry = 0;
        return;
      }
      stepRetry = 0;
      tick(true);
    }, delayMs);
  }

  /**
   * Ход, который лежит у этой вкладки.
   *
   * `K.expect` общий на профиль (так устроен обмен между контейнерами), поэтому
   * «чужой» и «свой» ход здесь различаются не наличием записи, а ролью: если
   * сохранено ожидание роли этой страницы — ход мой. Запись без роли — след
   * старой версии, и она тоже моя.
   */
  const stepOwnsTurn = () => {
    const waiting = GM_getValue(K.expect, null);
    if (!waiting || !waiting.kind) return false;
    if (!String(waiting.roleId || "")) return true;
    const here = typeof roleFromPath === "function" ? roleFromPath() : "";
    return Boolean(here) && norm(waiting.roleId) === norm(here);
  };

  /**
   * Шаг, который доводит уже полученный ход: читает маркер из чата, применяет
   * ответ Координатора, передаёт карточку дальше. Такой шаг ничего не пишет и
   * не читает в базах Notion/Drive, поэтому гейт подключений его не касается.
   *
   * Почему это не мелочь. 28.11 в 01:31 владелец нажал «Дожать ход», вкладка
   * сделала шаг — и упёрлась в «Relay ещё не синхронизировал сохранённые
   * Notion/Drive credentials». Ход лежал в чате целиком, его надо было только
   * прочитать. Кнопка обещала действие и не сделала его из-за входа, который
   * этому действию не нужен. То же и с удержанием после переключения проекта:
   * оно защищает от ЧУЖОЙ работы, а не от продолжения своего же хода.
   */
  const readOnlyStep = (fromToggle, mode = "") =>
    Boolean(fromToggle) && (mode === "read" || mode === "nudge" || stepOwnsTurn());

  /**
   * Режим следующего шага. Сигнатура `tick` остаётся прежней: её проверяют
   * пробы транспорта, и второй параметр там был бы изменением контракта ради
   * одной ветки. Заявка одноразовая и снимается при входе в шаг.
   */
  let requestedStepMode = "";
  const requestReadOnlyStep = () => { requestedStepMode = "read"; };
  const takeStepMode = () => {
    const mode = requestedStepMode;
    requestedStepMode = "";
    return mode;
  };

  /**
   * D-052: «дожать» пришло, пока шаг уже шёл.
   *
   * Просьба пульта одноразовая (`takeNudge`): если вкладка её забрала, а шаг
   * сделать не смогла, человек нажимает кнопку второй раз ровно потому, что
   * первый ничего не изменил (28.11, 14:33: «Пульт просит дочитать ответ» →
   * «Шаг уже выполняется» дважды). Поэтому «шаг занят» — не отказ, а отсрочка:
   * заявка остаётся здесь и выполняется один раз, когда текущий шаг закончится.
   *
   * Повтор идёт отложенным тиком и только заявкой режима `read`: новый запрос
   * шага не создаётся, дубль задания не отправляется, а `tick` сам видит
   * `pending` и сначала доводит отправку. Предел один — чтобы брошенная заявка
   * не будила вкладку вечно.
   */
  let nudgeRetryDeadline = 0;
  function deferNudgeStep(why = "") {
    const now = Date.now();
    if (!nudgeRetryDeadline) nudgeRetryDeadline = now + 600000;
    if (now > nudgeRetryDeadline) {
      nudgeRetryDeadline = 0;
      log(
        "Пульт просил дочитать ответ, но шаг всё это время был занят: просьба снята. " +
          "Нажмите «Дожать ход» ещё раз — ответ в чате не потерян.",
        true,
        { ntfy: "quiet" },
      );
      return false;
    }
    logThrottled(
      "nudge-deferred",
      `Пульт просит дочитать ответ, но шаг уже идёт${why ? ` (${why})` : ""}: ` +
        "просьба сохранена и повторится, как только он закончится.",
      false,
      60000,
    );
    return true;
  }
  /** Отложенная заявка: поднять тик, если шаг уже свободен. Иначе — ждём его конца. */
  function resumeDeferredNudge() {
    if (!nudgeRetryDeadline) return;
    if (busy) return;
    nudgeRetryDeadline = 0;
    requestReadOnlyStep();
    setTimeout(() => tick(true), 0);
  }

  async function tick(fromToggle = false) {
    // Пробы транспорта собирают `tick` из фрагментов, без соседних замыканий:
    // отсутствие заявки — это «обычный шаг», а не поломка.
    const mode = typeof takeStepMode === "function" ? takeStepMode() : "";
    // `readOnlyStep` может отсутствовать только в пробе, которая собирает
    // `tick` из фрагментов: тогда это обычный шаг, а не поломка. Считаем один
    // раз на шаг: оба гейта — подключения и удержание — спрашивают одно и то же.
    const readOnly = typeof readOnlyStep === "function" && readOnlyStep(fromToggle, mode);
    if (typeof projectApproved === "function" && !projectApproved()) {
      if (fromToggle) {
        log(typeof projectBlockedText === "function" ? projectBlockedText()
          : "Проект ещё не разрешён к работе: проверьте его в управлении проектами.", true);
        if (typeof noteFeedbackPipelineHeld === "function") noteFeedbackPipelineHeld();
      }
      return;
    }
    if (typeof projectCredentialsReady === "function" && !projectCredentialsReady() && !readOnly) {
      if (fromToggle) log("Шаг не начат: Relay ещё не синхронизировал сохранённые Notion/Drive credentials. Повторю после подключения; вводить уже сохранённые значения не нужно.", true);
      return;
    }
    // Допуск есть — очередь обратной связи обязана жить, даже если панель
    // монтировалась раньше, чем работа была разрешена (внешний D-023).
    if (typeof armFeedbackWatch === "function") armFeedbackWatch();
    if (typeof projectHeld === "function" && projectHeld() && !readOnly) {
      // fromToggle используется и отложенными автоматическими шагами: право
      // снять удержание есть только у явных кнопок «Шаг»/«Включить».
      if (fromToggle) log("Проект ждёт ручного запуска после переключения.");
      return;
    }
    // Фоновая вкладка в журнале не отмечается: Мастер работает в другой
    // вкладке постоянно, и строка «браузер режет таймеры» превращалась в шум.
    // Растянутые ожидания (`patience`) от этого никуда не делись.
    if (busy) {
      // Шаг мог повиснуть на сетевом запросе без таймаута. Тогда «Шаг» и
      // автоцикл молчат навсегда — снимаем блокировку и говорим об этом.
      //
      // Тишина здесь настоящая: `sleep` и `waitFor` отмечаются в `busyAt`
      // каждые несколько секунд, поэтому живого шага этот сторож не касается.
      // Старый проход остаётся стоять на await, который уже не завершится, —
      // значит перезапуск не дубль, а выход из тупика. Но третий раз подряд —
      // это не сбой одного запроса, а поломка: дальше решает Мастер.
      const silentMs = Date.now() - busyAt;
      if (silentMs < 120000) {
        // D-052: «дожать» при занятом шаге — не отказ. Заявка остаётся до конца
        // шага (deferNudgeStep), и человеку не приходится жать кнопку второй раз.
        if (fromToggle) {
          const deferred = mode === "read" && typeof deferNudgeStep === "function" && deferNudgeStep("прошлый шаг ещё не закончился");
          if (!deferred) log("Шаг уже выполняется: дождитесь его конца, повторный не нужен.");
        }
        return;
      }
      stepRestarts += 1;
      log(
        `Предыдущий шаг молчал ${Math.round(silentMs / 1000)} с (ни одной отметки жизни) — ` +
          `снимаю блокировку и запускаю заново: ${stepRestarts} из 2.`,
        true,
      );
      busy = false;
      if (stepRestarts > 2) {
        pause(
          "Шаг трижды подряд переставал отвечать на одном и том же месте. Параллельных запусков нет: " +
            "снятый проход не продолжается. Проверьте страницу агента и нажмите «Продолжить».",
          { kind: "step" },
        );
        return;
      }
    }
    // Повтор записи снимка не запускает ход и работает также в ручном режиме
    // и на паузе. Его не ждём: сетевой шлюз не должен блокировать «Шаг».
    flushPollJournal().catch((e) => log(`Очередь записи опросов не обработана: ${e.message}`, true));
    // D-092: шаг цикла состоялся — это знаменатель метрики автономности. Считаем
    // здесь, до всех ранних выходов ниже: шаг уже начался, и «сколько остановок
    // на сто ходов» без знаменателя было бы долей от неизвестного.
    try {
      if (typeof healCountTurn === "function") healCountTurn();
    } catch (e) {
      dbg("метрика автономности: шаг не посчитан", e.message);
    }
    // Ложный отказ проверки мержа чинится сам: иначе карточка ждёт Мастера,
    // а работа уже лежит в main (24.10 так было дважды).
    try {
      await selfHealClaim();
    } catch (e) {
      log(`Самопроверка последнего отказа не удалась: ${e.message}`, true);
    }
    // Provisioning Arena-агентов — отдельный административный контур. Он читает
    // свой request/job/lock до auto/pending-логики и не трогает K.pending/K.expect.
    // Пока запрос или job активен, обычный командный цикл не начинается.
    if (typeof consumeProvision === "function" && await consumeProvision()) return;
    // Незавершённая отправка живёт в очереди и не зависит от автоцикла:
    // иначе после перехода на страницу адресата задание никто не досылал.
    const auto = autoOn();
    const pending = GM_getValue(K.pending, null);
    const waiting = GM_getValue(K.expect, null);
    const managerOwnsScheduling = typeof relayManagerSignalAt !== "undefined" &&
      Number(relayManagerSignalAt || 0) > 0 && Date.now() - Number(relayManagerSignalAt) <= 20000;
    const relayOwnsScheduling = typeof relayControlActive === "function" && relayControlActive();
    if ((managerOwnsScheduling || relayOwnsScheduling) && !fromToggle && !pending && !waiting && !GM_getValue(K.step, false)) return;
    if (!auto && !fromToggle && !pending && !waiting) return;
    // Пауза снимается только человеком: тик не имеет права её обойти.
    if (isPaused()) {
      // Единственное исключение — пауза, поставленная прошлой миссией: к
      // текущей она не относится и молча держала бы новый цикл.
      if (!(await clearStaleMissionPause())) {
        if (fromToggle) {
          const own = typeof tabPauseReason === "function" ? tabPauseReason() : GM_getValue(K.paused, "");
          log(`Шаг не выполнен: цикл на паузе (${own}).`, true);
        }
        return;
      }
    }
    // Вопросы к Мастеру живут отдельным сторожем (`watchQuestions`): они видны
    // и на паузе, а тик до паузы не доходит.
    busy = true;
    busyAt = Date.now();
    try {
      // Капча важнее любого шага: она останавливает и отправку, и ответ.
      if (captchaDialog()) {
        // «Отправлено» перед капчей ничего не доказывает: Arena рисует реплику
        // раньше, чем проверка её пропустит. В журнале должно быть «доставка не
        // подтверждена» — иначе непонятно, зачем переотправлять задание.
        const seen = GM_getValue(K.expect, null);
        if (seen?.sentAt && seen.verified !== false) {
          GM_setValue(K.expect, { ...seen, captcha: true, verified: false });
        }
        captchaPause();
        return;
      }
      // D-106 + D-004: дневной лимит токенов важнее любого хода — индикатор в
      // поле ввода блокирует отправку целиком, и продолжение хода, и новое
      // задание не уйдут. Лимит принадлежит АККАУНТУ страницы: рабочий аккаунт
      // останавливает только свою роль (тик идёт дальше и уводит ход), а
      // административный — цикл целиком, потому что спрашивать некого.
      // Индикатор без метки аккаунта — прежняя пауза.
      const accountStop = await accountsTick();
      if (accountStop && accountStop !== "worker") return;
      // Tool-call limit — продолжение того же хода, раньше общей паузы по ошибке.
      if (await handleToolCallLimit()) return;
      // Ошибка на экране важнее любого шага: сначала остановиться.
      if (monitorVisibleErrors()) return;
      // Новая миссия — новый ход: остатки прошлой снимаются до любых решений.
      try {
        if (await syncMissionState()) return;
      } catch (e) {
        dbg("миссия: сверка не удалась", e.message);
        const held = GM_getValue(K.expect, null);
        if (held?.kind === "dispatch" || (held?.kind === "reminder" && held.runId)) {
          logThrottled("dispatch-mission-check", "Не удалось сверить миссию выдачи с Notion: ожидание сохранено, повторю проверку на следующем шаге.", true);
          return;
        }
      }
      dbg("tick: состояние", {
        fromToggle,
        path: location.pathname,
        pending: Boolean(GM_getValue(K.pending, null)),
        expect: GM_getValue(K.expect, null) && {
          kind: GM_getValue(K.expect, null).kind,
          sentAt: GM_getValue(K.expect, null).sentAt,
          verified: GM_getValue(K.expect, null).verified,
        },
      });
      const revived = reviveUnverifiedHandoff();
      if (revived === "reviewer-held") return;
      if (droppedHandoff) {
        const gone = droppedHandoff;
        droppedHandoff = null;
        await releaseUndelivered(gone, "отправка не подтвердилась, текста задания не сохранилось");
      }
      if (ghostAfterUpdate) {
        const gone = ghostAfterUpdate;
        ghostAfterUpdate = null;
        await releaseUndelivered(gone, "обновление скрипта: задание не уходило");
      }
      // Эфемерные пилоты CASEB-P1 читаются до командного транспорта и живут в
      // отдельном namespace; на странице команды consumePilot возвращает false.
      if (await consumePilot()) return;
      if (await consumePending(fromToggle)) return;
      // Фантом старой версии снят, повторять нечего: без нажатия не начинаем ход.
      if (revived === "dropped" && !auto && !fromToggle) return;
      // Ожидание без отметки отправки и без очереди — след упавшей попытки:
      // сообщения в чате нет, карточке в Running делать нечего. Убираем это
      // на любой странице, иначе Координатор видит живой ход там, где работы
      // не начиналось (24.10, CASEA-1.12).
      if (await holdLegacyUnsentDispatch()) return;
      const ghost = await dropGhostHandoff("задание не дошло: отметки отправки нет");
      if (ghost) {
        log(
          `${ghost.expect.roleName || ghost.expect.roleId}: ожидание без отметки отправки — это прошлый ход, ` +
            "а не работа. " +
            (ghost.rolled
              ? "Карточка возвращена в Ready — ход начнётся заново."
              : "Ожидание снято, ход начнётся заново."),
          false,
          { tone: "warn" },
        );
      }
      // Ручной режим: нажатие «Шаг» делает ровно один шаг. Фон (таймер)
      // досылает очередь после перехода, но не читает ответы и не выдаёт
      // новые задания: иначе один ход превращался в цепочку из трёх отправок.
      //
      // D-006: исключение — разбуженная вкладка. Ей сказали «работа есть», и
      // для её роли она действительно есть (очередь или ожидание). Это не
      // новый ход и не выдача: ровно то, что сделало бы нажатие «Шаг» в этой
      // вкладке, только без Мастера, который ищет нужный контейнер.
      const wakeWork = !auto && !fromToggle && typeof wakeActive === "function" && wakeActive() &&
        typeof wakeWorkHere === "function" ? wakeWorkHere() : "";
      const woken = Boolean(wakeWork);
      // Разбудить могли несколько вкладок одного аккаунта: шаг берёт одна.
      // Заявку берёт только та вкладка, у которой работа уже своя (`pending` /
      // `expect`): вкладка, которая лишь пойдёт на чужую страницу, не должна
      // держать заявку, пока её же переход отклонят из-за контейнера.
      // Работа своя — значит роль этой страницы и есть владелец заявки.
      if (woken && wakeWork !== "start" && typeof wakeClaim === "function" && !wakeClaim(roleFromPath())) {
        logThrottled("wake-claim", "Вкладку разбудили, но шаг этого аккаунта уже делает другая вкладка — жду.", false, 60_000);
        return;
      }
      // Строка не на каждый тик: окно будильника десять минут, и повтор одного
      // и того же сообщения каждые пятнадцать секунд — шум, а не новость.
      if (woken) logThrottled("wake-step", "Вкладку разбудили: для её роли есть работа — выполняю шаг.", false, 600_000);
      if (!auto && !fromToggle && !woken) return;
      if (fromToggle) dbg("шаг: начало", () => debugSnapshot());

      // Неотправленное задание важнее всего остального: пока оно в очереди,
      // ни план, ни новый ход не начинаются. В автоцикле страницу адресата
      // открываем сами — иначе после перезагрузки вкладки очередь стояла бы
      // вечно, а браузер ждал бы человека.
      const pendingNow = GM_getValue(K.pending, null);
      if (pendingNow && (fromToggle || autoOn() || woken)) {
        const here = roleFromPath();
        if (norm(here) !== norm(pendingNow.roleId)) {
          const all = await roles();
          const target = all.find((r) => norm(r.id) === norm(pendingNow.roleId)) || null;
          if (target) return navigateTo(target, "там ждёт отправки задание");
        }
      }

      const meId = roleFromPath();
      if (!meId) {
        // Мастер не обязан помнить, на какой странице стоит цикл, но и угадывать
        // ему не нужно: «Шаг» открывает ту страницу, где действительно есть
        // работа. Сначала — адресат неотправленного задания, потом — тот, чей
        // ответ ждём, и только потом Координатор (там начинается новый ход).
        // В автоцикле Мастер не жмёт «Шаг»: цикл сам открывает ту страницу,
        // где есть работа. Иначе «Включить» на главной ничего не делал.
        // D-006: разбуженная вкладка ведёт себя так же — она и нужна затем,
        // чтобы с непрофильной страницы уйти туда, где работа.
        if (!fromToggle && !autoOn() && !woken) return;
        const list = await roles();
        const pendingNow = GM_getValue(K.pending, null);
        const waitingNow = GM_getValue(K.expect, null);
        const byId = (id) => (id ? list.find((r) => norm(r.id) === norm(id)) || null : null);
        const pendingRole = pendingNow ? byId(pendingNow.roleId) : null;
        const waitingRole = waitingNow ? byId(waitingNow.roleId) : null;
        // Координатор — только если он не стоит по лимиту: его аккаунт
        // административный, и переход туда упёрся бы в отказ отправки.
        const coord = list.find((r) => r.fn === "Coordinator" && !accountLimitBlocks(r));
        const target = pendingRole || waitingRole || coord;
        if (!target) {
          log(
            list.length
              ? "Шаг не выполнен: нет активного Coordinator с адресом агента."
              : "Шаг не выполнен: нет ни одной активной роли — проверьте «Статус» в базе «Роли».",
            true,
          );
          return;
        }
        // В ручном режиме отложенный шаг выполняет уже открытая страница.
        // В автоцикле он не нужен: следующий тик продолжит сам.
        if (!pendingNow && fromToggle) GM_setValue(K.step, true);
        const why = target === pendingRole
          ? "там ждёт отправки задание"
          : target === waitingRole
            ? `ждём ответа «${target.name}»`
            : "там начинается ход";
        return navigateTo(target, why);
      }
      const list = await roles();
      // 1.24.0: страница опознаёт себя не только по «Agent URL» строки.
      //
      // До 1.24.0 id роли выводился из ссылки на агента, и адрес страницы был
      // единственным способом понять, кто здесь стоит. Теперь у неадминских
      // ролей адреса в «Ролях» нет — его знает лист «Экземпляры», — и после
      // создания первого агента вкладка осталась бы «не привязанной к роли»
      // ровно в тот момент, когда ей впервые есть что делать.
      //
      // Поэтому: сначала адрес страницы против строки и против экземпляров,
      // затем — почта аккаунта вкладки. Аккаунт слабее адреса (в контейнере
      // может жить несколько ролей), поэтому он идёт вторым и только при
      // однозначном совпадении.
      const mineByPath = (rows) => rows.find((r) => norm(r.id) === norm(meId)) || null;
      let me = mineByPath(list);
      if (!me) me = mineByPath(await rolesFresh().catch(() => []));
      if (!me) {
        const rowsNow = await roleRows().catch(() => []);
        const pairs = await relayInstances(await relaySnapshot().catch(() => null)).catch(() => []);
        const byPair = pairs.find((item) => norm(item["Agent URL"]).includes(norm(meId)) && item["Agent URL"]);
        if (byPair) me = rowsNow.find((r) => norm(r.name) === norm(byPair["Роль"])) || null;
      }
      if (!me) {
        // Аккаунт вкладки → слот → роли этого слота. Одна роль в слоте — ответ;
        // несколько — не угадываем: пусть Мастер откроет нужную страницу.
        const slotId = await relayCurrentSlot().catch(() => "");
        if (slotId) {
          const rowsNow = await roleRows().catch(() => []);
          const pairs = await relayInstances(await relaySnapshot().catch(() => null)).catch(() => []);
          const here = pairs.filter((item) => norm(item["Слот"]) === norm(slotId) && item["Agent URL"]);
          const names = [...new Set(here.map((item) => norm(item["Роль"])))];
          if (names.length === 1) {
            const one = here.find((item) => norm(item["Роль"]) === names[0]);
            const row = rowsNow.find((r) => norm(r.name) === norm(one["Роль"]));
            if (row) me = { ...row, id: row.id || String(one["Agent URL"]).match(/\/agent\/([\w-]+)/)?.[1] || "", url: one["Agent URL"] };
          }
        }
      }
      if (!me) {
        if (fromToggle)
          log(
            list.length
              ? `Шаг не выполнен: страница ${meId} не привязана к активной роли. ` +
                "Ни строки роли, ни «Экземпляров» с этим адресом нет; если агент только что создан, обновите страницу."
              : "Шаг не выполнен: нет ни одной активной роли — проверьте «Статус» в базе «Роли».",
            true,
          );
        return;
      }
      GM_setValue("cfn-me", me.name);
      setStatus();

      // D-004: аккаунт этой вкладки. Сверка идёт здесь, до любых действий:
      // задание, отправленное не в тот контейнер, уходит чужому аккаунту, и
      // заметить это можно только по подписи сайдбара. Непрочитанная подпись —
      // предупреждение в журнале, а не остановка: свёрнутый сайдбар не повод
      // стоять. Доказанное расхождение — пауза Мастеру (D-004).
      {
        const verdict = await accountVerdict(me).catch(() => ({ ok: true }));
        // D-007: подпись сайдбара могла быть не прочитана, а страница всё равно
        // чужая — адрес роли, открытый в контейнере другого аккаунта. Тогда
        // поле ввода не появится никогда, и ждать его незачем (24.11, 21:19).
        if (verdict.ok && typeof accountPageCheck === "function") {
          const page = await accountPageCheck(me).catch(() => ({ verdict: "unknown" }));
          if (page.verdict === "foreign") {
            idleWrongAccount(
              me,
              { why: `роль «${me.name}» закреплена за «${page.label}» (${page.expected}), а страница открыта аккаунтом ${page.seen}` },
              fromToggle,
            );
            return;
          }
        }
        if (!verdict.ok && verdict.kind === "wrong-account") {
          // Вкладка в чужом контейнере для этой роли. Перейти «в свой» нельзя:
          // контейнер меняет только человек. Это не поломка — просто здесь эта
          // роль не живёт, и шаг пропускается молча (в журнале — один раз).
          idleWrongAccount(me, verdict, fromToggle);
          return;
        }
        if (!verdict.ok) {
          // Лимит: эта роль не выдаётся, и увести ход из этой вкладки некуда —
          // она в контейнере своего аккаунта. Исключение — незакрытый ход: ответ
          // агента читается только здесь и ждёт сброса окна (D-045).
          const live = GM_getValue(K.expect, null);
          if (live && Number(live.sentAt) && norm(live.roleId) === norm(me.id))
            logThrottled(`account-limit-live:${me.id}`,
              `Шаг этой ролью пропущен: ${verdict.why}; незакрытый ход сохранён и ждёт сброса окна.`, false, 600_000);
          else
            idleLimitedAccount(me, fromToggle);
          return;
        }
        if (verdict.warn) logThrottled(`account-warn:${me.id}`, `Аккаунт вкладки: ${verdict.warn}.`, false, 600_000);
      }

      // Страница не догружена — шаг ничего не делает. Ни вставки, ни кликов,
      // ни закрытия панелей: на недорисованной странице любое действие либо
      // уходит в пустоту, либо бьёт по чужому элементу.
      const shell = appReady();
      if (!shell.ok) {
        logThrottled(
          "app-ready",
          `Страница ещё грузится (${shell.why}) — ничего не делаю, жду.`,
          false,
          C.tickMs * 4,
        );
        return;
      }

      const working = fromToggle ? await busySettled() : busyReason();
      if (working) {
        if (fromToggle) {
          log(`Шаг не выполнен: агент ещё отвечает (${busyLabel(working)}).`);
          // Ложный Stop исчезает сам: не заставляем Мастера жать второй раз.
          if (working.kind === "stop") scheduleStepRetry();
        }
        return;
      }

      let expect = GM_getValue(K.expect, null);
      // Подтверждённый адресный возврат уже восстановил исходный результат;
      // дочищаем durable-квитанцию перед тем, как этот результат применится.
      if (expect?.resumedAnswerReturn && typeof acknowledgeResumedAnswerReturn === "function") {
        expect = acknowledgeResumedAnswerReturn(expect);
      }

      // D-081: вопрос, который уже записан, важнее любого ожидания.
      //
      // Раньше эта проверка стояла ниже ветки «ожидание принадлежит другой
      // роли», и та возвращала ход раньше: пока цикл ждал ответа агента (а после
      // «Продолжить» — того же Координатора), очередь приёмки не читалась
      // вовсе. Вопрос Координатора лёг строкой в «Обратную связь», но к Warden
      // так и не попал: цикл крутился между Координатором и аудитором, а
      // приёмка ждала страницы, на которую транспорт не собирался заходить.
      //
      // Ответ на вопрос — не «чужой ход»: ход приёмки ставится отдельной
      // записью и снимает ожидание сам. Поэтому проверка идёт до ветки
      // ожидания и работает на любой странице.
      // внешний D-019: очередь ответа не обгоняет живую выдачу — слот ожидания один, и
      // это осознано. Неосознанным было молчание: пока слот занят, строка
      // приёмки могла ждать сутки, и в журнале про неё не было ни слова.
      if ((fromToggle || autoOn()) && expect && typeof noteAnswerStarved === "function") {
        noteAnswerStarved(expect);
      }
      if ((fromToggle || autoOn()) && !GM_getValue(K.expect, null)) {
        const returning = typeof answerReturnPending === "function" ? answerReturnPending() : null;
        if (returning) {
          if (returning.resuming && typeof resumeDeferredAnswerReturn === "function") {
            const sourceId = returning.deferred?.sourceRoleId || returning.deferred?.expect?.roleId || "";
            if (sourceId && norm(sourceId) !== norm(me.id)) {
              const sourceRole = list.find((row) => norm(row.id) === norm(sourceId));
              if (sourceRole && sourceRole.url) {
                await navigateTo(sourceRole, "восстанавливаю исходный ход после адресного ответа");
              } else {
                pause("Адресный ответ подтверждён, но роль-автор исходного результата не найдена. Квитанция и решение сохранены.", {
                  kind: "answer-return-role", ref: returning.questionId || returning.ref || "", turnId: returning.turnId || "",
                });
              }
              return;
            }
            resumeDeferredAnswerReturn(returning);
            return;
          }
          const routed = await startAnswerReturn(returning);
          if (routed === "skip") {
            dropAnswerReturn(returning);
            await continueAfterAnswerReturn(returning, false);
          }
          return;
        }
        // 1.24.0: передаём не «голову», а любую свободную строку.
        //
        // `answerPending()` уже отдаёт незанятую строку (и первой — ту, что
        // держит ход), поэтому одна неготовая строка больше не останавливает
        // остальную обратную связь. Если передача не удалась, строку не
        // трогаем — она остаётся «Ждёт» и ждёт только себя.
        let waiting = answerPending();
        const tried = new Set();
        let guard = 0;
        while (waiting && guard < 5) {
          guard += 1;
          tried.add(norm(waiting.id));
          const missionForAnswer = await missionForQuestion(waiting, await activeMission().catch(() => null));
          const started = await startAnswer(missionForAnswer, waiting);
          if (started || answerQueue().some((item) => norm(item.id) === norm(waiting.id))) return;
          waiting = answerPending(tried);
        }
      }

      if (expect && norm(expect.roleId) !== norm(me.id)) {
        const owner = list.find((r) => norm(r.id) === norm(expect.roleId)) || null;
        const ownerName = expect.roleName || owner?.name || "другой роли";
        if ((fromToggle || autoOn()) && owner) {
          let samePage = false;
          try {
            samePage = new URL(owner.url || (await roleDeliveryUrl(owner)), location.href).pathname === location.pathname;
          } catch {
            samePage = false;
          }
          // Стоим не там, где идёт работа: открываем нужную страницу, а не
          // просим Мастера перейти вручную.
          if (!samePage) {
            if (fromToggle) GM_setValue(K.step, true);
            return navigateTo(owner, `ждём ответа «${owner.name}», а не «${me.name}»`);
          }
        }
        if (fromToggle) log(`Шаг не выполнен: ход ждёт ответа «${ownerName}», а не «${me.name}».`);
        return;
      }

      // Старая версия помечала напоминание отдельным видом ожидания, и после
      // него Координатор «не узнавал» свой ход и запрашивал новый план —
      // отсюда вторая и третья отправки подряд. Приводим к исходному виду.
      if (expect && expect.kind === "reminder") {
        expect = {
          ...expect,
          kind: expect.runId
            ? "dispatch"
            : expect.questionId
              ? "answer"
              : me.fn === "Coordinator" ? "plan" : me.fn === "Reviewer" ? "review" : "dispatch",
        };
        GM_setValue(K.expect, expect);
      }

      // Ожидание без отметки отправки — не ожидание, но только если доставка
      // не доказана. D-044: dropGhostHandoff сначала ищет квитанцию/реплику
      // этой выдачи и восстанавливает `sentAt`; локальный снимок `expect`
      // мог устареть за время сетевых шагов, поэтому решение принимается по
      // живому состоянию, а не по старому объекту.
      if (expect && !Number(expect.sentAt)) {
        const ghost2 = await dropGhostHandoff("задание не дошло: отметки отправки нет");
        const live = GM_getValue(K.expect, null);
        if (!ghost2 && live && Number(live.sentAt)) {
          expect = live;
        } else {
          GM_setValue(K.expect, null);
          GM_setValue("cfn-plan-at", 0);
          log(
            `${me.name}: в чате нет отметки прошлой отправки — это след прошлой попытки, снимаю ожидание и начинаю ход заново.` +
              (ghost2 && ghost2.rolled ? " Карточка возвращена в Ready." : ""),
            true,
          );
          expect = null;
        }
      }

      // Прямой возврат — квитанция уведомления, а не запрос роли ответить.
      // Не прогоняем его через опрос/таймаут ожидания результата: после
      // подтверждённой доставки сразу восстанавливаем исходный ход.
      if (expect?.kind === "answer-return") {
        await answerReturnStep(me, expect, fromToggle);
        return;
      }

      // Опрос вместо ответа — не ответ. Разбираем его раньше любых
      // напоминаний: иначе «маркера нет» превращается в напоминание агенту,
      // который просто ждёт ответа на свой вопрос (24.10, CASEA-1.12).
      const poll = await answerPolls(me, expect);
      if (poll === "answered") {
        log(`Жду, что ${me.name} напишет после ответа на вопрос.`);
        return;
      }
      if (poll === "waiting") {
        // Опрос уже отвечен, продолжения ещё нет. Ждём, но не бесконечно:
        // вопрос в чате — не «свежее сообщение», и общий сторож тишины на нём
        // не сработал бы, оставив карточку в Running навсегда.
        const since = Number((expect && (expect.sentAt || expect.at)) || 0);
        const waitedPoll = since ? Date.now() - since : 0;
        if (expect && waitedPoll > C.replyWaitMs) {
          const stuck = expect;
          dropHandoff(
            `${me.name}: опрос отвечен, но продолжения нет ${Math.round(waitedPoll / 60000)} мин — ` +
              "похоже, ход встал. Очередь и ожидание сняты; нажмите «Продолжить» и пройдите шаг заново.",
          );
          await releaseUndelivered(stuck, "агент не продолжил после ответа на вопрос");
        }
        return;
      }

      // Ждать ответа бесконечно нельзя: если агент не прислал ни строки за
      // replyWaitMs, задание до него, скорее всего, не дошло (например,
      // осталось от старой версии). Молчание тут — ошибка, а не терпение.
      //
      // Но молчание и работа — разные вещи. Задача может идти часами: пока
      // виден Stop или плашка «думает», ход живой, и снимать передачу нельзя —
      // иначе агент останется без ответа, а карточка вернётся в Ready.
      //
      // И третья разница, из-за которой этот блок переписан 25.10: отсутствие
      // ответа на ещё не отрисованной странице — не молчание, а загрузка.
      if (expect) {
        const since = Number(expect.sentAt || expect.at) || 0;
        const waited = Date.now() - since;

        // Отсчёт наблюдения — с того момента, когда страница адресата открылась
        // в этой попытке, а не с отправки: после обрыва связи и «Продолжить»
        // скрипт заходит на страницу, которой ещё секунду назад не видел.
        const path = location.pathname || "/";
        if (expect.seenPath !== path || !Number(expect.seenAt)) {
          expect = { ...expect, seenPath: path, seenAt: Date.now(), readyAt: 0, pageReloaded: false };
          GM_setValue(K.expect, expect);
        }
        const watched = Date.now() - Number(expect.seenAt || Date.now());

        // Пока транскрипт не отрисован, о молчании агента не судим: пустая
        // страница — это загрузка или сеть, а не «задание не дошло».
        const page = pageReady(expect);
        if (page.ok && !Number(expect.readyAt)) {
          // Дальше короткая выдержка: сразу после отрисовки ответ может ещё
          // доезжать, и «пусто» в этот момент ничего не доказывает.
          expect = { ...expect, readyAt: Date.now() };
          GM_setValue(K.expect, expect);
        }
        if (!page.ok) {
          if (watched > C.pageWaitMs) {
            // Ожидание НЕ снимаем и карточку НЕ трогаем: работа могла быть
            // сделана, а ответ — лежать в чате. Это пауза про связь, а не про
            // исполнителя, поэтому после «Продолжить» всё перечитывается.
            expect = { ...expect, seenAt: 0, readyAt: 0, pageReloaded: false };
            GM_setValue(K.expect, expect);
            pause(
              `Страница «${me.name}» не открылась за ${Math.round(watched / 1000)} с (${page.why}). ` +
                "Это не молчание агента: ожидание, очередь и карточка на месте. " +
                "Проверьте связь и нажмите «Продолжить» — скрипт перечитает страницу и заберёт ответ.",
              { kind: "offline", ref: me.id, runId: expect.runId || "" },
            );
            return;
          }
          if (watched > C.pageReloadMs && !expect.pageReloaded) {
            expect = { ...expect, pageReloaded: true };
            GM_setValue(K.expect, expect);
            log(
              `Страница «${me.name}» не отрисовалась за ${Math.round(watched / 1000)} с (${page.why}) — ` +
                "перечитываю её. Ожидание не снимаю: ответ агента остаётся в чате.",
            );
            // D-045: отметка `pageReloaded` должна пережить перезагрузку,
            // иначе страница перечитывается бесконечно.
            await flushBeforeNavigate([K.expect, K.log]);
            location.reload();
            return;
          }
          logThrottled(
            `page-render:${me.id}`,
            `Страница «${me.name}» ещё не отрисовалась (${page.why}) — жду, ответ не снимаю.`,
            false,
            C.tickMs,
          );
          return;
        }

        const observed = Number(expect.readyAt) ? Date.now() - Number(expect.readyAt) : 0;
        const fresh = messagesAfter(expect.watermark || "").length;
        const working = stillWorking();
        if (waited > C.replyWaitMs && observed > C.observeGraceMs && !fresh && !working) {
          const stuck = expect;
          dropHandoff(
            `${me.name} не ответил ни одним сообщением за ${Math.round(waited / 60000)} мин и ничего не делает: ` +
              `страница открыта и видна, ответа в ней нет — похоже, задание до него не дошло. ` +
              `Очередь и ожидание сняты — нажмите «Продолжить» и пройдите шаг заново.`,
          );
          await releaseUndelivered(stuck, "агент не ответил и ничего не делает");
          return;
        }
        if (waited > C.longWaitNoticeMs) {
          logThrottled(
            `long-wait:${expect.ref || expect.roleId || ""}`,
            `Жду ответа «${expect.roleName || expect.roleId}» ${Math.round(waited / 60000)} мин` +
              `${fresh ? " — агент уже отвечает" : working ? " — агент работает" : ""}. ` +
              "Длинная задача может идти часами: ждём, передачу не снимаю.",
            false,
            C.longWaitNoticeMs,
          );
        }
      }

      // D-081: здесь стояла вторая, более поздняя проверка очереди приёмки.
      // Она срабатывала только при пустом ожидании — то есть ровно в тех
      // случаях, когда вопрос и так уже обработан выше. Теперь проверка одна и
      // стоит до ветки ожидания; дубль убран, чтобы не читать базу дважды.

      if (expect?.kind === "dispatch") {
        // У Reviewer тоже бывают карточки. Их вердикт — ответ по карточке,
        // а не назначенная отдельно приёмка миссии.
        await submitExecutor(me, expect, fromToggle);
      } else if (expect?.kind === "heal") {
        // D-073: ответ Maintainer'а разбирается до любой другой ветки — иначе
        // передача транспорта попала бы в чужую роль по функции адресата.
        await healStep(me, expect, fromToggle);
      } else if (expect?.kind === "answer") {
        // Нужная роль из need может быть Warden, Maintainer, Coordinator,
        // Executor или Auditor: answer — вид хода, не фиксированная функция.
        await answerStep(me, expect, fromToggle);
      } else if (me.fn === "Coordinator") {
        await coordinatorStep(me, expect, fromToggle);
      } else if (me.fn === "Reviewer" && expect) {
        if (expect.kind === "review") await reviewStep(me, expect, fromToggle);
        // D-053: арбитраж петли — отдельный ход приёмки со своим маркером.
        else if (expect.kind === "arbiter") await arbiterStep(me, expect, fromToggle);
        else pause(`Неизвестный вид хода приёмки «${expect.kind || "пусто"}»: ничего не меняю.`, {
          kind: "handoff-kind", ref: expect.ref || "",
        });
      } else if (!expect) {
        // Без ожидания `messagesAfter(expect.watermark)` упал бы в catch,
        // и «Шаг» на странице исполнителя ставил бы паузу вместо ответа.
        const coord = list.find((r) => r.fn === "Coordinator");
        if (fromToggle && coord) {
          // «Шаг» не должен упираться в тупик: работа начинается у
          // Координатора, туда и ведём. Раньше здесь была только строка в
          // журнале, и на опустевшей странице исполнителя жать было некуда —
          // например, после того как задание сняли как просроченное.
          log(`У «${me.name}» нет задания в очереди — открываю Координатора: там начинается ход.`);
          GM_setValue(K.step, true);
          return navigateTo(coord, "там начинается ход");
        }
        if (fromToggle) {
          log(`Шаг не выполнен: у «${me.name}» нет задания в очереди. Ход начинается с Координатора.`, true);
        } else if (autoOn() && coord) {
          // В автоцикле незанятая страница исполнителя — не повод стоять:
          // новый ход начинается у Координатора, туда и переходим.
          return navigateTo(coord, "там начинается ход");
        }
      } else {
        pause(`Неизвестный вид хода «${expect.kind || "пусто"}»: карточку и миссию не меняю.`, {
          kind: "handoff-kind", ref: expect.ref || "",
        });
      }
    } catch (e) {
      // «HTTP 400: path failed validation» Мастеру ничего не говорит. Сначала
      // что случилось и что делать, потом техническая строка — она нужна,
      // если придётся разбираться.
      const raw = String((e && e.message) || e);
      // Причина называется по источнику: «Notion» и «шлюз Drive» — разные
      // поломки и разные действия Мастера.
      const plain = e && e.relay === "question-too-long"
        ? "Вопрос или вариант по умолчанию слишком длинный: ничего не усекал и приёмке не передал. " +
          "Сохраните полный материал в Notion и разберите текущий ход вручную."
        : e && e.relay === "binding"
          ? "Мешает привязка карточек: в «Запросах» есть карточки без Mission ID " +
            "или с неизвестным состоянием. Пока неясно, чьи они, очередь этой миссии не собрать: " +
            "выдавать и принимать такие карточки нельзя. Привяжите их через " +
            "проверьте и исправьте их вручную в Notion, затем нажмите «Продолжить» — " +
            "полученный ответ и сами карточки не потеряны, я их не скрываю и не меняю."
          : /битый id|valid uuid|path failed validation/i.test(raw)
        ? "Notion не принял адрес записи: в нём оказался битый id — обычно это " +
          "опечатка в строке-маркере ответа."
        // D-069: файл задания в Drive — не запись в Notion. Раньше этот отказ
        // попадал в последнюю ветку и звучал как «Шаг прервался на записи в
        // Notion», хотя ни одной записи ещё не было.
        : /^Payload не прочитан/.test(raw)
          ? "Файл задания не прочитан из Drive: отправка не начиналась, карточка не тронута. " +
            "Проверьте поле «Payload Drive File ID» (один или несколько id файлов из Arena/payloads) " +
            "и нажмите «Продолжить»."
        : e && e.relay === "gateway"
          ? e.refused
            ? `Шлюз Drive ответил отказом: ${e.reason} Запись не сделана, в Диске ничего не менялось. ` +
              "Если отказ про папку — в карточке указан не журнал: «Output Drive File ID» должен " +
              `указывать на файл из ${C.driveFolder ? `Arena/${C.driveFolder}/logs` : "Arena/logs"}; скрипт вернёт его сам после обновления.`
            : "Шлюз Drive не ответил, ответ агента в журнал не записан. Проверьте, что " +
              "развёртывание Apps Script открыто «любому, у кого есть ссылка», и что ссылка в ⚙ та же."
          : /HTTP (?:429|5\d\d)/i.test(raw)
            ? "Notion ответил сбоем на своей стороне — это не ошибка карточки и не потерянный ход. " +
              "Скрипт повторил запрос и подождал; Notion не восстановился за это время. Обычно проходит за минуту-другую."
            : /HTTP 4\d\d/i.test(raw)
              ? "Notion отклонил запись: он ответил, и сеть тут ни при чём — данные не прошли его проверку. " +
                (/length should be/i.test(raw)
                  ? "Не поместился текст: одно поле принимает не больше 2000 знаков на объект — " +
                    "это дефект скрипта, а не ошибка карточки или ответа. "
                  : "") +
                "Запись не сделана, ход не потерян."
              : e && e.relay === "notion" && e.link
                ? "Связь с Notion пропала: запрос не дошёл, и два зонда (через 5 и 15 с) её не вернули. " +
                  "Обычно это сон машины или вкладка в фоне — проверьте интернет и нажмите «Продолжить». " +
                  "Запись не сделана, ход не потерян."
                : e && e.relay === "notion" || networkish(raw)
                  ? "Notion не ответил: сеть или блокировка запроса. Запись не сделана."
              : "Шаг прервался на записи в Notion.";
      // Шаг Координатора снимает ожидание ДО применения решения (чтобы решение не
      // применилось дважды). Если шаг сорвётся между этими двумя моментами —
      // 08.11 так было дважды, «draft is not defined» сразу после найденного
      // маркера, — ответ уже лежит в чате, но не применён, а ожидания нет:
      // «Продолжить» не перечитывал ничего, а следующий «Шаг» спрашивал новый
      // план, то есть отправлял задание Координатору второй раз. Снимок хода
      // возвращает ожидание, и обещание «перечитает ответ» снова правда.
      // Возврат — только при пустом ожидании (живое главнее), только для свежего
      // снимка и только если маркер правда есть в чате после его водяного знака:
      // иначе к давно применённому ходу вернулось бы его же решение.
      let recovered = false;
      try {
        if (!GM_getValue(K.expect, null)) {
          const snap = GM_getValue(K.planRecover, null);
          const snapFresh = snap && snap.expect && Number(snap.at) && Date.now() - Number(snap.at) < 15 * 60_000;
          const snapHasReply = snapFresh && messagesAfter(snap.expect.watermark || "")
            .some((m) => Boolean(parseMarker(m.raw, "CF_COORDINATOR_RESULT")));
          if (snapFresh && snapHasReply) {
            GM_setValue(K.expect, snap.expect);
            GM_setValue(K.planRecover, null);
            recovered = true;
            // Троттлинг плана снимается: ответ уже в чате, ждать минуту незачем.
            GM_setValue("cfn-plan-at", 0);
            log(
              `Ответ Координатора получен, но решение не применилось: ожидание хода восстановлено ` +
                `(turn ${snap.expect.turnId || "?"}). «Продолжить» перечитает ответ, второй раз задание не уйдёт.`,
              false,
              { ntfy: "quiet", title: "Relay: ожидание восстановлено" },
            );
          }
        }
      } catch (recoverErr) {
        // Сбой внутри восстановления не должен съедать паузу: причина важнее.
        dbg("восстановление хода не удалось", recoverErr && recoverErr.message);
      }
      const stillWaiting = Boolean(GM_getValue(K.expect, null));
      pause(
        `Цикл остановлен. ${plain} ` +
          (recovered
            ? "Ход не потерян: полученный ответ и ожидание восстановлены, после «Продолжить» скрипт перечитает ответ, второй раз задание не уйдёт."
            : stillWaiting
              ? "Ход не потерян: очередь и карточка на месте, после «Продолжить» скрипт перечитает ответ."
              : "Ответ агента получен, но не применён, а ожидание хода уже снято: «Продолжить» его не " +
                "перечитает и заново задание не отправит. Ход и карточки на месте — разберите причину " +
                "и нажмите «Продолжить»: новый план будет запрошен только по вашему «Шаг».") +
          `\nТехнически: ${raw}`,
        { kind: "error" },
      );
    } finally {
      busy = false;
      stepRestarts = 0;
      setStatus();
      // D-052: заявка «дожать», ждавшая конца шага, выполняется сразу — уже как
      // свободный читающий шаг, а не как второй запуск поверх первого.
      try {
        if (typeof resumeDeferredNudge === "function") resumeDeferredNudge();
      } catch (e) {
        dbg("отложенная просьба «дожать» не поднята", e.message);
      }
    }
  }
