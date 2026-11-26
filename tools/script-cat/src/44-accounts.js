  // ─────────────────────── аккаунты Arena и их квоты (D-004) ───────────────────────
  //
  // Работа идёт последовательно, но квота суточного лимита — у аккаунта Arena, а
  // аккаунтов несколько (Firefox Multi-Account Containers). Когда один упирается
  // в лимит, вставать целиком незачем: у остальных квота ещё есть.
  //
  // Три правила, на которых держится всё остальное:
  //
  //  1. Почта аккаунта живёт в «Ролях» (поле «Аккаунт») — Notion единственный
  //     источник (D-005): локальной связки «метка → почта» нет, дублировать
  //     адрес в ⚙ не нужно. Пустое поле — «аккаунт не размечен».
  //  2. Лимит — это состояние АККАУНТА, а не вкладки. Признак один и достоверный:
  //     видимый индикатор в поле ввода (см. `dailyUsageLimitBlocked`). Текст
  //     ошибки, тишина агента и tool-call limit лимитом аккаунта не считаются.
  //  3. «Доступность» — поле транспорта, «Статус» — поле Мастера. Писать лимит в
  //     «Статус» нельзя: возврат «Активна» затёр бы собственное решение Мастера,
  //     принятое за эти часы, а в «Статус» пишет ещё и provisioning.
  //
  // Проверка адреса вкладки — вспомогательная: пока поле «Аккаунт» не сверено
  // с почтой вкладки, скрипт работает, как раньше (иначе свёрнутый сайдбар
  // останавливал бы цикл). Смена почты в Notion подхватывается при следующем
  // чтении «Ролей» — в браузере ничего править не нужно (D-005).

  /**
   * Поле «Роли» с аккаунтом. Значение — почта входа (D-005): она же метка
   * аккаунта, ключ лимитов и ожидаемый адрес сверки вкладки.
   */
  const ACCOUNT_FIELD = "Аккаунт";
  /** Поле «Роли», которое пишет только транспорт: «ОК» или «Лимит». */
  const ACCOUNT_AVAIL_FIELD = "Доступность";
  const ACCOUNT_OK = "ОК";
  const ACCOUNT_LIMIT = "Лимит";
  /** Функции, которые держат административный аккаунт. Он один и без исполнителей. */
  const ACCOUNT_ADMIN_FNS = ["Coordinator", "Reviewer", "Maintainer"];
  /** Почта в подписи сайдбара. Проверка нарочно широкая: это не валидатор почты. */
  const ACCOUNT_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;
  /** Срок повторной проверки окна, если индикатор не погас после сброса. */
  const ACCOUNT_RECHECK_MS = 30 * 60 * 1000;

  const accountLabel = (value) => String(value || "").trim();
  const normAccount = (value) => accountLabel(value).toLowerCase();

  /** Адрес, пригодный для сверки. Всё остальное — «связки нет», а не «пустая почта». */
  function accountMail(value) {
    const mail = String(value || "").trim();
    return ACCOUNT_EMAIL_RE.test(mail) ? mail.toLowerCase() : "";
  }

  /**
   * Ближайшая полночь по Москве.
   *
   * Окно лимита суточное и сбрасывается по часам аккаунта, а не браузера: у
   * Мастера пояс может быть любой, и `new Date().setHours(24,0,0,0)` дал бы
   * чужую полночь. Москва — UTC+3 круглый год; переходов на летнее время нет,
   * поэтому арифметика честная без таблиц зон.
   */
  function moscowMidnight(now) {
    const at = Number.isFinite(Number(now)) ? Number(now) : Date.now();
    const msk = new Date(at + 3 * 3600 * 1000);
    return Date.UTC(msk.getUTCFullYear(), msk.getUTCMonth(), msk.getUTCDate() + 1) - 3 * 3600 * 1000;
  }

  /** Дата сброса словами: «00:00 МСК 24.11». Время всегда полночь — так и пишем. */
  function accountResetText(until) {
    const at = Number(until) || 0;
    if (!at) return "";
    const msk = new Date(at + 3 * 3600 * 1000);
    const day = String(msk.getUTCDate()).padStart(2, "0");
    const month = String(msk.getUTCMonth() + 1).padStart(2, "0");
    return `00:00 МСК ${day}.${month}`;
  }

  // ───────────────────────────── состояние ─────────────────────────────

  const accountObj = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});

  // D-005: локальной связки «метка → почта» больше нет. Ожидаемый адрес берётся
  // прямо из поля «Аккаунт» роли (см. accountVerdict и accountMismatchSync).

  /** Отметки лимитов: метка → { until, roleId, roleName, rows: [pageId], touched }. */
  const accountLimits = () => accountObj(GM_getValue(K.accountLimits, null));
  const accountLimit = (label) => {
    const key = normAccount(label);
    return key ? accountLimits()[key] || null : null;
  };

  /**
   * Лимит аккаунта с точки зрения выдачи.
   *
   * `expired: true` — окно по часам прошло, но индикатор на странице ещё не
   * проверен. Такое состояние НЕ блокирует выдачу: иначе один потерянный
   * браузер держал бы аккаунт до следующей ручной проверки. Если лимит и правда
   * ещё стоит, страница покажет индикатор и отметка вернётся сама.
   */
  function accountBlocked(label) {
    const hit = accountLimit(label);
    if (!hit) return null;
    const until = Number(hit.until) || 0;
    return until && Date.now() >= until ? { ...hit, expired: true } : hit;
  }

  function accountLimitText(label) {
    const hit = accountLimit(label);
    if (!hit) return "";
    return `${accountLabel(label)} — лимит до ${accountResetText(hit.until)}`;
  }

  /** Последнее прочитанное состояние вкладки: нужно панели, журналу и сверке. */
  const accountSeen = () => accountObj(GM_getValue(K.accountSeen, null));
  function rememberAccountSeen(value) {
    const next = { ...accountSeen(), ...accountObj(value), at: Date.now() };
    GM_setValue(K.accountSeen, next);
  }

  // ───────────────────────────── чтение подписи аккаунта ─────────────────────────────

  const accountText = (node) => String(node?.textContent || "").replace(/\s+/g, " ").trim();

  /**
   * Почта из подписи сайдбара.
   *
   * Классы Arena переживут не все релизы, поэтому первым идёт наблюдённый
   * селектор, а за ним — запасной поиск по любому узлу с обоими признаками
   * (`font-heading` + `text-interactive-active`). Принимается только текст,
   * целиком похожий на адрес: имя аккаунта рядом с почтой не должно стать
   * «почтой» и молча сломать сверку.
   */
  function accountEmailFromDom(doc) {
    if (!doc || typeof doc.querySelectorAll !== "function") return "";
    const selectors = [
      "div.font-heading.text-interactive-active",
      '[class*="font-heading"][class*="text-interactive-active"]',
      '[data-testid="account-email"]',
    ];
    const seen = new Set();
    for (const selector of selectors) {
      let nodes = [];
      try {
        nodes = doc.querySelectorAll(selector) || [];
      } catch {
        nodes = [];
      }
      for (const node of nodes) {
        if (!node || seen.has(node)) continue;
        seen.add(node);
        const text = accountText(node);
        if (text && text.length <= 120 && ACCOUNT_EMAIL_RE.test(text)) return text;
      }
    }
    return "";
  }

  /** Кнопка разворота сайдбара: подпись аккаунта есть только в развёрнутом виде. */
  function accountExpandButton(doc) {
    if (!doc || typeof doc.querySelector !== "function") return null;
    const selectors = [
      'button[aria-label="Expand sidebar"]',
      'button[aria-label="Развернуть боковую панель"]',
      'button[aria-label*="xpand sidebar"]',
    ];
    for (const selector of selectors) {
      try {
        const hit = doc.querySelector(selector);
        if (hit) return hit;
      } catch {
        /* селектор не принят — пробуем следующий */
      }
    }
    return null;
  }

  /**
   * Сайдбар в режиме иконок: почты в разметке нет вовсе.
   *
   * Это не «чужой аккаунт» и не «нет аккаунта» — это «неизвестно». Разница
   * важна: неизвестность не останавливает цикл (иначе свёрнутая панель
   * останавливала бы работу), а другой адрес останавливает.
   */
  function accountIconCollapsed(doc) {
    if (!doc || typeof doc.querySelector !== "function") return false;
    const selectors = [
      '[data-collapsible="icon"]',
      '[class*="collapsible=icon"]',
      '[class*="sidebar-width-icon"]',
    ];
    for (const selector of selectors) {
      try {
        if (doc.querySelector(selector)) return true;
      } catch {
        /* селектор не принят — пробуем следующий */
      }
    }
    return false;
  }

  /**
   * Развернуть сайдбар один раз на страницу, а не на каждое чтение.
   *
   * Клик по «Expand sidebar» — действие в интерфейсе Мастера: если он свернул
   * панель намеренно, повторный разворот каждые пятнадцать секунд был бы дракой
   * с ним. Флаг снимается при смене адреса: там панель могла снова свернуться
   * сама.
   */
  let accountExpandTried = { path: "", at: 0 };
  /** Кеш чтения: подпись рисуется асинхронно, но живой DOM перечитывать незачем. */
  let accountPageRead = { path: "", at: 0, value: null };
  /**
   * Неудача кешируется короче удачи: подпись могла не отрисоваться в момент
   * первого чтения, и минутный кеш «missing» держал бы сверку выключенной ровно
   * на том тике, где она нужна.
   */
  const ACCOUNT_READ_TTL_MS = 60 * 1000;
  const ACCOUNT_READ_FAIL_MS = 15 * 1000;

  /**
   * Прочитать аккаунт вкладки. `why` называет исход, а не только неудачу:
   * `label` — прочитано, `expanded` — прочитано после разворота, `missing` —
   * подписи нет, `icon-collapsed` — сайдбар свёрнут до иконок, `no-dom` — нет
   * документа (проба вне браузера).
   */
  async function readAccountEmail({ expand = true, force = false } = {}) {
    if (typeof document === "undefined") return { email: "", why: "no-dom" };
    const path = typeof location !== "undefined" ? String(location.pathname || "") : "";
    const last = accountPageRead.value;
    const ttl = last && last.email ? ACCOUNT_READ_TTL_MS : ACCOUNT_READ_FAIL_MS;
    const fresh = force || accountPageRead.path !== path || Date.now() - Number(accountPageRead.at || 0) > ttl;
    if (!fresh && accountPageRead.value) return accountPageRead.value;
    let value = { email: accountEmailFromDom(document), why: "label" };
    if (!value.email) {
      if (accountIconCollapsed(document)) value = { email: "", why: "icon-collapsed" };
      else if (!expand) value = { email: "", why: "missing" };
      else {
        const tried = accountExpandTried.path === path;
        const button = tried ? null : accountExpandButton(document);
        if (!button || typeof button.click !== "function") value = { email: "", why: "missing" };
        else {
          accountExpandTried = { path, at: Date.now() };
          button.click();
          value = { email: "", why: "missing" };
          for (let i = 0; i < 3; i += 1) {
            await sleep(400);
            const email = accountEmailFromDom(document);
            if (email) {
              value = { email, why: "expanded" };
              break;
            }
          }
          if (!value.email && accountIconCollapsed(document)) value = { email: "", why: "icon-collapsed" };
        }
      }
    }
    accountPageRead = { path, at: Date.now(), value };
    rememberAccountSeen({ email: value.email, why: value.why, path });
    return value;
  }

  /** Сбросить кеш: после смены контейнера/страницы чтение начинается заново. */
  function forgetAccountRead() {
    accountPageRead = { path: "", at: 0, value: null };
  }

  /**
   * D-007: эта ли страница — та роль, за которую себя выдаёт.
   *
   * Контейнер меняет только человек, поэтому адрес роли в чужом контейнере
   * открывается и рисуется, но уже ЧУЖИМ аккаунтом: поле ввода пустое, а
   * задание, уйди оно туда, получил бы не тот. По журналу 24.11: вкладка
   * Координатора открыла `/agent/<UX & Modding Auditor>` (контейнер admin) —
   * страница загрузилась, поля ввода нет, и задание зависло «в очереди».
   *
   * Кеш подписи растёт по пути, поэтому соответствие «путь → прочитанный
   * аккаунт» запоминается: подпись прошлой страницы не переносится на новую.
   * Ответы: `mine` — здесь эта роль живёт; `no-label` — аккаунт роли не
   * размечен, проверять нечего; `unknown` — подпись не прочитана, решает
   * вызывающий; `foreign` — доказанно чужой аккаунт.
   */
  const accountPageMap = new Map();
  async function accountPageCheck(role, { path = "", force = false } = {}) {
    const label = roleAccount(role);
    if (!label) return { verdict: "no-label" };
    const expected = accountMail(label);
    if (!expected) return { verdict: "no-label", label: accountLabel(label) };
    const here = String(path || (typeof location !== "undefined" ? location.pathname : "") || "");
    let read = force ? null : accountPageMap.get(here) || null;
    if (!read) {
      const fresh = await readAccountEmail({ force: true }).catch(() => ({ email: "", why: "error" }));
      read = { email: accountMail(fresh.email), why: fresh.why || "" };
      if (read.email) accountPageMap.set(here, read);
    }
    if (!read.email) return { verdict: "unknown", why: read.why || "missing", label: accountLabel(label) };
    return read.email === expected
      ? { verdict: "mine", email: read.email, label: accountLabel(label) }
      : { verdict: "foreign", seen: read.email, expected, label: accountLabel(label) };
  }

  // ───────────────────────────── роли и раскладка ─────────────────────────────

  const roleAccount = (role) => accountLabel(role?.account || "");
  const roleAvailableLabel = (role) => accountLabel(role?.available || "");
  /** Роль временно недоступна: помечена лимитом в базе (или у себя, или чужая рука). */
  const roleMarkedLimited = (role) => normAccount(roleAvailableLabel(role)) === normAccount(ACCOUNT_LIMIT);
  const accountIsAdministrativeFn = (fn) => ACCOUNT_ADMIN_FNS.includes(String(fn || ""));

  /**
   * Раскладка ролей по аккаунтам: проверка на чтении, без правок в Notion.
   *
   * Требование владельца: административный аккаунт один и на нём только
   * Coordinator, Warden и Transport Maintainer. Скрипт это не исправляет —
   * раскладка задаётся человеком, — но называет дефект вслух: иначе лимит
   * исполнителей отрезал бы Координатора и приёмку, а причина была бы не видна.
   */
  function accountLayoutProblems(rows = []) {
    const byAccount = new Map();
    for (const row of rows || []) {
      const label = roleAccount(row);
      if (!label || (row.status && row.status !== "Активна")) continue;
      if (!byAccount.has(normAccount(label))) byAccount.set(normAccount(label), { label, roles: [] });
      byAccount.get(normAccount(label)).roles.push(row);
    }
    const problems = [];
    const admins = [...byAccount.values()].filter((entry) => entry.roles.some((r) => accountIsAdministrativeFn(r.fn)));
    if (admins.length > 1) {
      problems.push({
        code: "admin-split",
        text: `административные роли разложены по ${admins.length} аккаунтам (${admins.map((a) => a.label).join(", ")}): лимит одного отрежет Координатора и приёмку`,
      });
    }
    for (const entry of admins) {
      const extra = entry.roles.filter((r) => !accountIsAdministrativeFn(r.fn));
      if (extra.length) {
        problems.push({
          code: "admin-extra",
          text: `на административном аккаунте «${entry.label}» есть рабочие роли (${extra.map((r) => r.name).join(", ")}): их квота съест квоту Координатора`,
        });
      }
    }
    const unassigned = (rows || []).filter((r) => !roleAccount(r) && (!r.status || r.status === "Активна"));
    if (unassigned.length) {
      problems.push({
        code: "unassigned",
        text: `у ${unassigned.length} рол. не заполнено поле «${ACCOUNT_FIELD}» (${unassigned.slice(0, 4).map((r) => r.name).join(", ")}): лимит их аккаунта отслеживаться не будет`,
      });
    }
    return problems;
  }

  /**
   * Свежие «Роли» целиком — для снятия лимита.
   *
   * Кеш «Ролей» живёт десять минут и не знает о нашей же записи: к моменту
   * снятия лимита в нём всё ещё «ОК», и снятие пропустило бы все строки.
   * Свежее чтение стоит одного запроса в Notion и случается раз в сутки на
   * аккаунт — это дешевле, чем оставить роль в «Лимит» до правки руками.
   * Отказ чтения не отменяет снятие: тогда работает кеш, а строка, где
   * «Доступность» не «Лимит», всё равно не трогается.
   *
   * Строки для возврата ищутся по pageId, а не по текущему адресу роли (D-005):
   * смена почты в Notion посреди окна не должна терять нашу отметку.
   */
  async function accountRolesAllFresh() {
    if (typeof roleRows === "function") {
      try {
        const rows = await roleRows({ fresh: true });
        if (Array.isArray(rows) && rows.length) return rows;
      } catch (e) {
        log(`Свежее чтение «Ролей» не удалось (${e.message}): снимаю лимит по кешу.`, false, { ntfy: "quiet" });
      }
    }
    const cache = GM_getValue(K.rolesCache, null);
    return cache && Array.isArray(cache.rows) ? cache.rows : [];
  }

  /** Роли одного аккаунта из кеша «Ролей»: без сети, для отметок и сверок. */
  function accountRolesFromCache(label) {
    const key = normAccount(label);
    if (!key) return [];
    const cache = GM_getValue(K.rolesCache, null);
    const rows = cache && Array.isArray(cache.rows) ? cache.rows : [];
    return rows.filter((row) => normAccount(roleAccount(row)) === key);
  }

  /** Роль текущей страницы: id агента из адреса ищется в кеше «Ролей». */
  function accountRoleForPath(pathname) {
    const path = String(pathname || (typeof location !== "undefined" ? location.pathname : "") || "");
    const id = (path.match(/\/agent\/([\w-]+)/) || [])[1];
    if (!id) return null;
    const cache = GM_getValue(K.rolesCache, null);
    const rows = cache && Array.isArray(cache.rows) ? cache.rows : [];
    return rows.find((row) => norm(row.id) === norm(id)) || null;
  }

  // ───────────────────────────── отметка и снятие лимита ─────────────────────────────

  /**
   * Поставить лимит аккаунту: локальная отметка со сроком плюс durable-признак в
   * Notion. Признак нужен другому браузеру и человеку: «почему роль не выдаётся»
   * должно читаться в базе, а не только в журнале одной вкладки.
   *
   * Пишутся только строки, у которых поле «Доступность» ещё не «Лимит»: чужую
   * отметку не перезаписываем и в `rows` записываем лишь те, что поставили сами —
   * иначе снятие вернуло бы «ОК» строке, которую пометил человек.
   */
  async function markAccountLimit(label, role = null) {
    const key = normAccount(label);
    if (!key) return null;
    const limits = accountLimits();
    const until = moscowMidnight(Date.now());
    const previous = limits[key] || null;
    const sameWindow = previous && Number(previous.until) === until;
    const entry = {
      label: accountLabel(label),
      at: sameWindow ? Number(previous.at) || Date.now() : Date.now(),
      until,
      roleId: String(role?.id || previous?.roleId || ""),
      roleName: String(role?.name || previous?.roleName || ""),
      rows: sameWindow && Array.isArray(previous.rows) ? previous.rows.slice() : [],
      touched: sameWindow && Array.isArray(previous.touched) ? previous.touched.slice() : [],
    };
    limits[key] = entry;
    // D-005: смена почты в Notion посреди окна. Строки уже «Лимит» — это могла
    // быть наша отметка под прежним адресом: не перезаписываем её (чужое не
    // трогаем), но забираем в новую запись — иначе под новым ключом снимать
    // будет нечего, а «Доступность» осталась бы «Лимит» до правки руками.
    const rows = accountRolesFromCache(label);
    const limitedNow = new Set(
      rows
        .filter((row) => row.pageId && normAccount(roleAvailableLabel(row)) === normAccount(ACCOUNT_LIMIT))
        .map((row) => String(row.pageId)),
    );
    for (const [otherKey, other] of Object.entries(limits)) {
      if (otherKey === key || !other || !Array.isArray(other.touched)) continue;
      const moved = other.touched.filter((item) => limitedNow.has(String(item.pageId || "")));
      if (!moved.length) continue;
      const movedIds = new Set(moved.map((item) => String(item.pageId || "")));
      entry.touched.push(...moved);
      if (Array.isArray(other.rows)) entry.rows.push(...other.rows.filter((id) => movedIds.has(String(id))));
      other.touched = other.touched.filter((item) => !movedIds.has(String(item.pageId || "")));
      if (Array.isArray(other.rows)) other.rows = other.rows.filter((id) => !movedIds.has(String(id)));
      limits[otherKey] = other;
    }
    for (const row of rows) {
      if (!row.pageId || normAccount(roleAvailableLabel(row)) === normAccount(ACCOUNT_LIMIT)) continue;
      try {
        await patch(row.pageId, { [ACCOUNT_AVAIL_FIELD]: { select: { name: ACCOUNT_LIMIT } } });
        entry.rows.push(row.pageId);
        entry.touched.push({ pageId: row.pageId, before: roleAvailableLabel(row) || ACCOUNT_OK });
      } catch (e) {
        log(`«${row.name}»: отметка лимита в «${ACCOUNT_AVAIL_FIELD}» не записалась (${e.message}) — отметка локальная, роль не выдаётся.`, true, { ntfy: "quiet" });
      }
    }
    limits[key] = entry;
    GM_setValue(K.accountLimits, limits);
    return entry;
  }

  /**
   * Снять лимит аккаунта.
   *
   * Возвращается только то, что поставил сам транспорт: строка, где сейчас стоит
   * «Лимит» и которая в отметке числится нашей. Если человек за это время
   * поправил «Доступность» руками — не трогаем: его правка старше нашей.
   */
  async function clearAccountLimit(label, { reason = "" } = {}) {
    const key = normAccount(label);
    if (!key) return 0;
    const limits = accountLimits();
    const entry = limits[key];
    if (!entry) return 0;
    const ours = Array.isArray(entry.touched) ? entry.touched : [];
    const fresh = await accountRolesAllFresh();
    const byPage = new Map(fresh.map((row) => [String(row.pageId || ""), row]));
    let restored = 0;
    for (const item of ours) {
      const row = byPage.get(String(item.pageId || ""));
      if (!row || normAccount(roleAvailableLabel(row)) !== normAccount(ACCOUNT_LIMIT)) continue;
      try {
        await patch(item.pageId, { [ACCOUNT_AVAIL_FIELD]: { select: { name: accountLabel(item.before) || ACCOUNT_OK } } });
        restored += 1;
      } catch (e) {
        log(`«${row.name}»: «${ACCOUNT_AVAIL_FIELD}» не вернулось после сброса лимита (${e.message}).`, true, { ntfy: "quiet" });
      }
    }
    delete limits[key];
    GM_setValue(K.accountLimits, limits);
    forgetAccountRead();
    if (restored || ours.length) {
      log(
        `Лимит «${entry.label || label}» снят${reason ? ` (${reason})` : ""}: доступность вернулась у ${restored} из ${ours.length} ролей.`,
        false,
        { ntfy: "quiet", title: "Relay: аккаунт снова доступен" },
      );
    }
    return restored;
  }

  // ───────────────────────────── проверки перед ходом ─────────────────────────────

  /**
   * Можно ли сейчас работать ролью.
   *
   * Возвращает `ok`, и при отказе — `why` словами и `kind` повода: `limit` —
   * аккаунт стоит до сброса, `wrong-account` — вкладка не на том аккаунте.
   *
   * Сверка с почтой вкладки — вспомогательная: если адрес не прочитан (сайдбар
   * свёрнут, подпись не отрисовалась), ход не блокируется, но `warn` говорит об
   * этом в журнале. Блокируется только доказанное расхождение.
   */
  async function accountVerdict(role) {
    const label = roleAccount(role);
    if (!label) return { ok: true };
    const hit = accountBlocked(label);
    if (hit && !hit.expired) {
      return {
        ok: false,
        kind: "limit",
        why: `«${accountLabel(label)}» в лимите до ${accountResetText(hit.until)}`,
      };
    }
    // D-005: ожидаемый адрес — значение поля «Аккаунт» (Notion), без локальной
    // связки. Не адрес — значит «связки нет»: сверка пропущена, работа идёт.
    const expected = accountMail(label);
    if (!expected)
      return { ok: true, warn: `в поле «${ACCOUNT_FIELD}» роли нет адреса почты («${accountLabel(label)}»): сверка аккаунта пропущена` };
    const read = await readAccountEmail();
    const seen = accountMail(read.email);
    if (!seen) {
      return {
        ok: true,
        warn: `аккаунт вкладки не прочитан (${read.why || "нет подписи"}): сверка с «${accountLabel(label)}» пропущена`,
      };
    }
    if (seen !== expected) {
      return {
        ok: false,
        kind: "wrong-account",
        why: `роль «${role?.name || role?.id}» закреплена за «${accountLabel(label)}», а вкладка на ${read.email}`,
        seen: read.email,
        expected,
      };
    }
    return { ok: true, email: read.email };
  }

  /**
   * Аккаунт вкладки не тот, что закреплён за ролью.
   *
   * Отдельно от `accountVerdict`, потому что здесь нужен ответ без ожидания:
   * вызывается в местах, где пауза на асинхронное чтение подписи была бы шумом
   * (например, при выборе цепочки перехода). `unknown: true` значит «адрес не
   * прочитан» — это не расхождение.
   */
  function accountMismatchSync(role) {
    const label = roleAccount(role);
    if (!label) return { wrong: false };
    // D-005: ожидаемый адрес — поле «Аккаунт» роли; не адрес — сверять нечего.
    const expected = accountMail(label);
    if (!expected) return { wrong: false };
    const read = accountPageRead.value;
    const seen = accountMail(read && read.email);
    if (!seen) return { wrong: false, unknown: true };
    return seen === expected
      ? { wrong: false, email: seen }
      : { wrong: true, seen, expected, label: accountLabel(label), why: `роль «${role?.name || role?.id}» закреплена за «${accountLabel(label)}», а вкладка на ${seen}` };
  }

  /** Короткая проверка без ожидания подписи: для мест, где пауза была бы шумом. */
  const accountLimitBlocks = (role) => {
    const hit = accountBlocked(roleAccount(role));
    return Boolean(hit && !hit.expired);
  };

  /**
   * Ожидание на лимитированном аккаунте не снимается.
   *
   * Задание уже ушло, агент мог ответить — а ответ читается только на его
   * странице. Уборка фантомов и таймаут «брошенной» карточки вернули бы
   * Running в Ready, и ответ прилетел бы в пустоту (D-045). До сброса окна
   * карточка остаётся как есть, а ход восстанавливается после возврата ролей.
   */
  function accountHoldsExpect(expect) {
    if (!expect) return false;
    const cache = GM_getValue(K.rolesCache, null);
    const rows = cache && Array.isArray(cache.rows) ? cache.rows : [];
    const role = rows.find((row) => norm(row.id) === norm(expect.roleId)) ||
      rows.find((row) => norm(row.name) === norm(expect.roleName));
    if (!role) return false;
    return accountLimitBlocks(role);
  }

  /**
   * Текст недоступности для промпта Координатора и панели.
   *
   * Одна строка на аккаунт: по ней видно, что роль не выдаётся не из-за постановки,
   * а из-за квоты, и до какого времени ждать.
   */
  function accountLimitLines() {
    const limits = accountLimits();
    return Object.values(limits)
      .filter((entry) => entry && entry.label)
      .map((entry) => `${accountLimitText(entry.label)}${Number(entry.until) && Date.now() >= Number(entry.until) ? " (окно прошло — проверю на странице)" : ""}`)
      .filter(Boolean);
  }

  // ───────────────────────────── тик аккаунтов ─────────────────────────────

  const accountLogKey = (label) => `account-log:${normAccount(label)}`;

  /**
   * Проверка аккаунтов на каждом шаге — дешёвая: без Notion, только кеш «Ролей»
   * и DOM текущей страницы.
   *
   * Порядок важен:
   *   • сначала снятие уже прошедшего окна (если мы на странице этого аккаунта);
   *   • потом отметка нового лимита;
   *   • административный аккаунт останавливает цикл паузой, рабочий — нет:
   *     смысл раскладки по аккаунтам как раз в том, чтобы работа продолжалась.
   *
   * Возвращает вид остановки, а не «да/нет»: `admin` — административный аккаунт,
   * тик заканчивается паузой; `worker` — рабочий аккаунт в лимите, роль не
   * выдаётся, паузы нет; `unbound` — лимит без метки, прежняя пауза; пустая
   * строка — лимита нет. Различие принципиальное: раньше рабочий аккаунт
   * возвращал `true`, и вызывающая сторона не могла отличить «стоим» от «здесь
   * просто нечего делать».
   */
  async function accountsTick() {
    const role = accountRoleForPath();
    const label = roleAccount(role);
    const blocked = typeof dailyUsageLimitBlocked === "function" ? dailyUsageLimitBlocked() : false;

    // 1. Сброс: окно прошло, и мы как раз на странице этого аккаунта. Подходит
    //    и текущий адрес, и прежний (по roleId роли): смена почты в Notion
    //    посреди окна не оставляет отметку-сироту под старым ключом (D-005).
    if (label && !blocked) {
      const myRole = role?.id ? norm(role.id) : "";
      for (const [key, entry] of Object.entries(accountLimits())) {
        if (!entry || !(Number(entry.until) && Date.now() >= Number(entry.until))) continue;
        const ours = key === normAccount(label) || Boolean(myRole && entry.roleId && norm(entry.roleId) === myRole);
        if (!ours) continue;
        await clearAccountLimit(entry.label || key, { reason: "индикатор лимита на странице погас" }).catch((e) =>
          log(`Снятие лимита «${accountLabel(entry.label || key)}» не удалось: ${e.message}`, true, { ntfy: "quiet" }));
      }
    }

    // 2. Лимит виден: он принадлежит аккаунту этой страницы.
    if (label && blocked) {
      const entry = accountLimit(label);
      const sameWindow = entry && Number(entry.until) === moscowMidnight(Date.now());
      if (!sameWindow) {
        await markAccountLimit(label, role).catch((e) =>
          log(`Лимит «${accountLabel(label)}» не записан в базу: ${e.message} — роль не выдаётся, отметка локальная.`, true, { ntfy: "quiet" }));
        const lines = accountLimitLines();
        log(
          `Лимит аккаунта «${accountLabel(label)}» (${role?.name || "роль страницы"}): окно до ${accountResetText(moscowMidnight(Date.now()))}. ` +
            `Роли этого аккаунта больше не выдаются${lines.length > 1 ? ` (${lines.join("; ")})` : ""}; остальные аккаунты работают.`,
          true,
          { ntfy: "quiet", title: "Relay: лимит аккаунта" },
        );
      }
      // Только активные административные роли: отключённая роль ничего не
      // спрашивает, и называть её в паузе — пугать Мастера зря.
      const adminRoles = accountRolesFromCache(label)
        .filter((row) => accountIsAdministrativeFn(row.fn) && (!row.status || row.status === "Активна"));
      if (label && adminRoles.length) {
        pause(
          `Лимит аккаунта «${accountLabel(label)}»: на нём административные роли ` +
            `(${adminRoles.map((row) => row.name).join(", ")}), ` +
            `поэтому спросить Координатора некем — спросить его нечем. Окно заканчивается в ${accountResetText(moscowMidnight(Date.now()))}: ` +
            "после сброса нажмите «Продолжить». До сброса повторная попытка снова остановит цикл.",
          { kind: "account-limit-admin", ref: role?.id || "" },
        );
        return "admin";
      }
      // Рабочий аккаунт: цикл не останавливается — ход уходит другим аккаунтом.
      // `false` здесь не значит «можно работать этой ролью»: выдачу роли
      // проверяют `accountLimitBlocks` и `accountVerdict`, а тик должен дойти до
      // поиска другого аккаунта. Прежний `true` останавливал страницу молча:
      // обещанного «хода дальше» не наступало до самой полуночи.
      return "worker";
    }

    // 3. Индикатор без привязки к аккаунту (страница не роль, кеш «Ролей» пуст или
    //    роль без метки) — прежнее поведение: лимит считается лимитом вкладки.
    if (blocked) {
      if (typeof monitorDailyLimit === "function" && monitorDailyLimit()) return "unbound";
    }
    return "";
  }

  /**
   * Заметка Координатору о недоступных аккаунтах.
   *
   * Идёт в план рядом с очередью: без неё Координатор продолжает называть в
   * `next` роли лимитированного аккаунта и получает отказ за отказом — а причина
   * этому не постановка, а квота.
   */
  function accountPlanNote() {
    const lines = accountLimitLines();
    return lines.length
      ? `Недоступны по лимиту квоты: ${lines.join("; ")}. Роли этих аккаунтов не выдаются до сброса — ` +
          "называй в next роль другого аккаунта или оставь карточку в Ready."
      : "";
  }

  /**
   * Вся оставшаяся работа на лимитированных аккаунтах — единственный случай, где
   * спрашивать Координатора вообще имеет смысл.
   *
   * Условие: в Ready есть карточки, и у КАЖДОЙ роль с недоступным аккаунтом.
   * Тогда в план добавляются оба хода, которые есть у Координатора: взять другую
   * карточку (если появится на доступном аккаунте) или поставить миссию на паузу.
   *
   * Спрашиваем один раз на окно лимита: повтор вопроса — это расход квоты на
   * «нам всё ещё плохо». Отметка ставится при ФАКТИЧЕСКОЙ отправке плана
   * (`accountIdleAsked`), а не при сборке текста: план мог не уйти (капча, пауза,
   * ожидание), и тогда вопрос потерялся бы вместе с ним.
   */
  function accountIdleNote(ready = [], { missionId = "" } = {}) {
    if (!ready.length) return "";
    const lines = accountLimitLines();
    if (!lines.length) return "";
    const cache = GM_getValue(K.rolesCache, null);
    const rows = cache && Array.isArray(cache.rows) ? cache.rows : [];
    const roleOf = (card) => rows.find((row) => norm(row.name) === norm(card?.properties?.["Кому"]?.select?.name || ""));
    const blocked = ready.every((card) => {
      const role = roleOf(card);
      return role ? accountLimitBlocks(role) : false;
    });
    if (!blocked) return "";
    if (accountIdleAsked(accountIdleKey(missionId))) return "";
    return (
      `Готовые карточки (${ready.length}) все на лимитированных аккаунтах: ${lines.join("; ")}. ` +
      "Работать нечем до сброса окна. Реши сам: взять другую карточку на доступном аккаунте " +
      "(создай её в Ready и назови роль) или вернуть next:\"blocked\" — миссия тогда встанет на паузу " +
      "до сброса. Спрашиваю один раз на окно лимита."
    );
  }

  /** Ключ окна: миссия плюс состав лимитированных аккаунтов. */
  const accountIdleKey = (missionId) => `idle:${missionId}:${Object.keys(accountLimits()).sort().join(",")}`;
  const accountIdleAsked = (key) => {
    const state = GM_getValue(K.accountIdle, null);
    return Boolean(state && String(state.key || "") === String(key));
  };
  /** План ушёл — теперь вопрос считается заданным. Вызывается после отправки. */
  function accountIdleAskedMark(missionId) {
    if (!missionId || !accountLimitLines().length) return;
    GM_setValue(K.accountIdle, { key: accountIdleKey(missionId), at: Date.now() });
  }
