  // ─────────────────────── будильник вкладок (D-006) ───────────────────────
  //
  // Контейнер Firefox меняет только человек: `location.assign` его не трогает,
  // поэтому «перейти на другой аккаунт» из вкладки нельзя. Но и гадать, в какой
  // вкладке нажать «Шаг», Мастер не должен. Между вкладками есть общее
  // хранилище — им и пользуемся: любая вкладка ставит отметку «работа есть,
  // просыпайтесь», а откликается та, чей аккаунт адресат.
  //
  // Что здесь важно и почему именно так:
  //
  //  1. Будильник ничего не отправляет и не выдаёт. Он только снимает
  //     «спящий» режим у вкладки, в которой уже лежит работа (`K.pending` или
  //     ожидание её роли). Решение «уходить ли» остаётся за обычным тиком:
  //     одно место решает — меньше способов разойтись с D-045.
  //  2. Отметка с окном жизни (`until`). Забытая отметка не должна держать
  //     чужую вкладку вечно бодрой: будили на десять минут, потом снова спим.
  //  3. Отметку ставит и сама вкладка, когда у неё появилась работа для другой
  //     роли: иначе после решения Координатора весь ход ждал бы нажатия.

  /** Сколько вкладка остаётся разбуженной после одного нажатия. */
  const WAKE_WINDOW_MS = 10 * 60 * 1000;
  /** Дольше этого отметку не продлеваем: засыпание после работы — норма. */
  const WAKE_MAX_MS = 30 * 60 * 1000;

  const wakeState = () => {
    const value = GM_getValue(K.wake, null);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  };

  /** Разбудить все вкладки проекта: одна отметка, общая для всех контейнеров. */
  function wakeAll(reason = "ручное нажатие") {
    const now = Date.now();
    const previous = wakeState();
    // Повторные нажатия продлевают окно, но не бесконечно: иначе вкладка
    // оставалась бы бодрой всю ночь после одного клика.
    const startedAt = previous && previous.at && now - Number(previous.at) < WAKE_MAX_MS
      ? Number(previous.startedAt || previous.at)
      : now;
    GM_setValue(K.wake, {
      at: now,
      startedAt,
      until: Math.min(now + WAKE_WINDOW_MS, startedAt + WAKE_MAX_MS),
      reason: String(reason || ""),
    });
    return GM_getValue(K.wake, null);
  }

  /**
   * Та же отметка, но не чаще раза в `ms`.
   *
   * Для мест, которые повторяются каждый тик: «эта вкладка не на своём
   * аккаунте», «аккаунт в лимите». Без ограничения они продлевали бы отметку
   * каждые пятнадцать секунд, и ручной режим незаметно превращался бы в
   * автоцикл — то есть в то, чего Мастер как раз не просил.
   */
  function wakeOnce(key, reason, ms = 10 * 60 * 1000) {
    const stamp = `cfn-wake-last:${key}`;
    const now = Date.now();
    if (now - Number(GM_getValue(stamp, 0) || 0) < ms) return null;
    GM_setValue(stamp, now);
    return wakeAll(reason);
  }

  /** Вкладка разбужена прямо сейчас? */
  function wakeActive(now = Date.now()) {
    const state = wakeState();
    return Boolean(state && Number(state.until) > now);
  }

  /**
   * Работа ждёт в этой вкладке.
   *
   * Проверяется ровно то, что тик всё равно проверит первым: неотправленная
   * очередь своей роли и ожидание ответа своей роли. Ничего нового здесь не
   * решается — это фильтр «просыпаться или нет», а не второй решатель.
   */
  function wakeWorkHere() {
    const here = typeof roleFromPath === "function" ? roleFromPath() : "";
    const pending = GM_getValue(K.pending, null);
    const waiting = GM_getValue(K.expect, null);
    // Непрофильная страница работу не «держит», но и не должна спать, если
    // работа где-то есть: тогда она пойдёт туда сама — тем же переходом, что
    // делает «Шаг». Если работы нет вовсе, кнопка новый ход не начинает:
    // это остаётся за «Шаг», иначе «Все вкладки» отправляли бы мусорные ходы.
    if (!here) return pending || waiting ? "start" : "";
    if (pending && norm(pending.roleId) === norm(here)) return "pending";
    if (waiting && norm(waiting.roleId) === norm(here)) return "expect";
    return "";
  }

  /**
   * Короткая заявка «шаг делаю я».
   *
   * Разбудить можно несколько вкладок одного аккаунта (человек открывал их
   * раньше). Работа у них общая, поэтому шаг берёт только одна: остальные
   * видят живую заявку и ждут. Заявка живёт недолго (`WAKE_CLAIM_MS`): если
   * вкладку закрыли посреди шага, она не держит остальных дольше минуты.
   */
  const WAKE_CLAIM_MS = 90 * 1000;

  /** Идентификатор вкладки: своя сессия, поэтому у каждой вкладки свой. */
  function wakeTabId() {
    try {
      let id = sessionStorage.getItem("cfn-wake-tab-v1");
      if (!id) {
        id = typeof uid === "function" ? uid() : `t${Date.now()}${Math.random()}`;
        sessionStorage.setItem("cfn-wake-tab-v1", id);
      }
      return id;
    } catch {
      return "";
    }
  }

  /**
   * Ключ заявки — на АККАУНТ, а не на профиль.
   *
   * Заявка общего вида блокировала бы работу соседнего аккаунта: две вкладки
   * разных контейнеров с разными заданиями — это не дубль, а нормальный ход.
   * Аккаунт берём из «Ролей» по id роли; если разметки нет — по самой роли.
   */
  function wakeClaimKey(roleId) {
    let label = "";
    try {
      const role = typeof accountRoleForPath === "function" ? accountRoleForPath(`/agent/${roleId}`) : null;
      label = role && typeof roleAccount === "function" ? roleAccount(role) : "";
    } catch {
      label = "";
    }
    return `cfn-wake-doing:${norm(label || roleId)}`;
  }

  /** Ключ заявки этой вкладки: нужен, чтобы продлевать именно свою. */
  let claimKey = "";

  /** Взять шаг себе. false — его уже делает другая вкладка этого аккаунта. */
  function wakeClaim(roleId, now = Date.now()) {
    const key = wakeClaimKey(roleId);
    const id = wakeTabId();
    const doing = GM_getValue(key, null);
    if (doing && doing.tabId && doing.tabId !== id && Number(doing.until) > now) return false;
    GM_setValue(key, { tabId: id, until: now + WAKE_CLAIM_MS, at: now });
    claimKey = key;
    return true;
  }

  /** Не чаще раза в 30 секунд продлеваем заявку: шаг может идти и минутами. */
  let claimRenewedAt = 0;

  /**
   * «Шаг ещё идёт»: продлить заявку, пока тик жив.
   *
   * Без этого долгий шаг (ожидание мержа — до пяти минут) выглядел бы
   * брошенным, и вторая вкладка того же аккаунта начала бы второй такой же.
   * Заявку не снимаем по завершении: пусть истечёт сама, иначе разбудившая
   * всех вкладка тут же взялась бы за ту же работу ещё раз.
   */
  function wakeHold(now = Date.now()) {
    if (!claimKey) return false;
    const id = wakeTabId();
    const doing = GM_getValue(claimKey, null);
    if (!doing || !doing.tabId || doing.tabId !== id) return false;
    if (now - claimRenewedAt < 30_000) return true;
    claimRenewedAt = now;
    GM_setValue(claimKey, { ...doing, until: now + WAKE_CLAIM_MS });
    return true;
  }

  /**
   * У вкладки появилась работа для чужой роли — сказать об этом остальным.
   *
   * Вызывается там, где очередь поставлена (`sendToRole`). Своя работа отметку
   * не ставит: эта вкладка и так не спит.
   */
  function wakeForPending(pending, reason = "появилось задание") {
    const here = typeof roleFromPath === "function" ? roleFromPath() : "";
    if (!pending || !pending.roleId) return null;
    if (norm(pending.roleId) === norm(here)) return null;
    return wakeAll(reason);
  }
