  // ───────────────────────────── подключения ─────────────────────────────
  // D-005: адреса аккаунтов вводить не нужно — почта живёт в поле «Аккаунт»
  // базы «Роли» (Notion) и читается оттуда. Настройка профиля и подключений
  // принадлежит локальному пульту Relay; здесь остались транспортные функции
  // и проверки только для чтения при явном допуске проекта.

  /** Старые ключи остаются источником истины: обновление не сбрасывает доступ. */
  function connectionSettings() {
    return {
      notion: String(GM_getValue(K.notion, "") || "").trim(),
      gwUrl: String(GM_getValue(K.gwUrl, "") || "").trim(),
      gwKey: String(GM_getValue(K.gwKey, "") || "").trim(),
      github: String(GM_getValue(K.ghToken, "") || "").trim(),
      // D-030: обычный локальный Relay подхватывается автоматически; поле
      // остаётся только для нестандартного порта/хоста.
      relayUrl: typeof relayBase === "function"
        ? relayBase()
        : String(GM_getValue("cfn-relay-url", "") || "http://127.0.0.1:8787").trim().replace(/\/+$/, ""),
      relayAuto: !String(GM_getValue("cfn-relay-url", "") || "").trim(),
    };
  }

  const sameConnections = (a, b) =>
    a.notion === b.notion && a.gwUrl === b.gwUrl && a.gwKey === b.gwKey && a.github === b.github &&
    a.relayUrl === b.relayUrl;

  /** Не отправлять ключ по HTTP или на похожий на Google чужой адрес без согласия. */
  function connectionEndpoint(value) {
    if (!value) return { ok: true, standard: true, host: "" };
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.username || url.password)
        return { ok: false, message: "Укажите HTTPS-адрес шлюза без имени пользователя и пароля в URL." };
      return {
        ok: true,
        standard: url.origin === "https://script.google.com" && /^\/macros\/s\/[^/]+\/exec\/?$/.test(url.pathname),
        host: url.host,
      };
    } catch {
      return { ok: false, message: "Некорректный URL шлюза: нужен полный HTTPS-адрес веб-приложения /exec." };
    }
  }

  /** Чужой ответ об ошибке не должен показать введённый или сохранённый секрет. */
  function connectionProblem(error, settings) {
    let text = String((error && error.message) || error || "неизвестная ошибка");
    for (const secret of [settings.notion, settings.gwKey, settings.github]) {
      if (secret) text = text.split(secret).join("[скрыто]");
    }
    return text.replace(/\s+/g, " ").slice(0, 280);
  }

  /** Проверка токена и доступа к источникам — только чтение, не проверка записи или всей схемы. */
  async function probeNotionConnection(settings) {
    if (!settings.notion) return { ok: false, text: "Не задан токен Notion." };
    const headers = {
      Authorization: `Bearer ${settings.notion}`,
      "Notion-Version": C.notionV,
      "Content-Type": "application/json",
    };
    try {
      const me = await request("GET", "https://api.notion.com/v1/users/me", headers);
      if (!me || me.object !== "user") throw new Error("Неожиданный ответ users/me.");
    } catch (e) {
      return { ok: false, text: `Токен Notion не проверен: ${connectionProblem(e, settings)}` };
    }
    for (const [name, id] of [["Роли", C.roles], ["Миссии", C.missions], ["Запросы", C.requests], ["Обратная связь", C.questions]]) {
      // Средняя частота Notion — около трёх запросов/с; это проверка по кнопке,
      // а не часть тика, поэтому не трогаем сторож busyAt через sleep().
      await new Promise((resolve) => setTimeout(resolve, 400));
      try {
        const source = await request("GET", `https://api.notion.com/v1/data_sources/${id}`, headers);
        if (!source || source.object !== "data_source") throw new Error("Неожиданный ответ источника.");
      } catch (e) {
        return {
          ok: false,
          text: `Токен принят, но источник «${name}» не прочитан: ${connectionProblem(e, settings)}. Проверьте доступ интеграции.`,
        };
      }
    }
    return { ok: true, text: "Токен и четыре источника читаются. Права записи, варианты и полная схема не проверялись." };
  }

  /** Проверяет тот же транспорт, что и цикл, но с введёнными, ещё не сохранёнными данными. */
  async function probeDriveConnection(settings) {
    if (!settings.gwUrl) return { ok: false, text: "Не задан URL шлюза Drive." };
    if (!settings.gwKey) return { ok: false, text: "Не задан ключ шлюза Drive." };
    try {
      const scoped = typeof ACTIVE_PROFILE !== "undefined" && !ACTIVE_PROFILE.legacy;
      const data = await gatewayWithCredentials("ping", "", scoped ? { projectId: ACTIVE_PROFILE.id } : {}, { url: settings.gwUrl, key: settings.gwKey });
      if (scoped && (!data || data.projectScoped !== true || data.projectId !== ACTIVE_PROFILE.id ||
          data.project?.name !== ACTIVE_PROFILE.driveFolder))
        throw new Error("Шлюз не подтвердил ID и папку этого проекта. Нужен зарегистрированный проектный шлюз 1.6.");
      const version = String((data && data.version) || "");
      const warning = !version
        ? " Версия не указана — совместимость не подтверждена."
        : gatewayIsOld(version)
          ? " Версия старше 1.5: обновите шлюз, старый может писать мимо Arena."
          : "";
      return { ok: true, warning: Boolean(warning), text: `Шлюз ответил${version ? `, версия ${version}` : ""}.${warning} Чтение и запись файлов не проверялись.` };
    } catch (e) {
      return { ok: false, text: `Шлюз Drive не проверен: ${connectionProblem(e, settings)}` };
    }
  }

  /** Репозиторий виден — не значит, что токену доступны содержимое и Pull requests. */
  async function probeGithubConnection(settings) {
    try {
      const repo = await request("GET", `https://api.github.com/repos/${C.repo}`, githubHeaders(settings.github));
      if (!repo || String(repo.full_name || "").toLowerCase() !== C.repo.toLowerCase())
        throw new Error("GitHub вернул неожиданный репозиторий.");
      return {
        ok: true,
        text: `Репозиторий ${C.repo} виден ${settings.github ? "с токеном" : "анонимно"}. Права на PR и файлы не проверялись.`,
      };
    } catch (e) {
      return { ok: false, text: `Репозиторий не проверен: ${connectionProblem(e, settings)}. Для приватного репозитория нужен токен с доступом к нему.` };
    }
  }
