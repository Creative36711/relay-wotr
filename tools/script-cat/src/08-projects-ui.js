  // ───────────────────────────── управление проектами ─────────────────────────────
  // Смена адресов источников у уже работающего профиля не переносит очередь:
  // изменённая копия получает новый UUID и новое пространство состояния.
  let projectAsyncWork = 0;
  const PROJECT_HOLD_PREFIX = "cfn-project-switch-hold:";
  function projectHeld() {
    try { return sessionStorage.getItem(PROJECT_HOLD_PREFIX + ACTIVE_PROFILE.id) === "1"; }
    catch { return true; }
  }
  function releaseProjectHold() {
    try {
      const held = projectHeld();
      sessionStorage.removeItem(PROJECT_HOLD_PREFIX + ACTIVE_PROFILE.id);
      // Отложенный шаг старой сессии не должен запуститься второй раз при
      // следующей навигации: пользователь сейчас запускает этот шаг вручную.
      if (held) GM_setValue(K.step, false);
      return true;
    } catch { return false; }
  }
  function projectRoleAllowed(role) {
    if (ACTIVE_PROFILE.legacy) return true;
    // D-015: у рабочих ролей «Agent URL» в «Ролях» пуст — адрес берётся из
    // листа «Экземпляры» (пара роль + слот), и проверять здесь нечего:
    // отсутствие адреса назовёт `roleDeliveryUrl` ниже, с причиной. А вот
    // НЕПРАВИЛЬНЫЙ адрес — стоп: страница открылась бы не в том контейнере.
    const raw = String(role?.url || "").trim();
    if (!raw) return true;
    try {
      const target = new URL(raw, location.href);
      if (target.origin === location.origin && /^\/agent\/[\w-]+\/?$/.test(target.pathname)) return true;
    } catch { /* остановка ниже */ }
    pause("Адрес роли должен быть страницей агента Arena на том же домене, что и эта вкладка. " +
      "Иначе браузер потеряет выбранный профиль: поправьте Agent URL в базе «Роли».",
      { kind: "project-role-origin", ref: role.id || "" });
    return false;
  }
  function trackProjectTask(promise) {
    projectAsyncWork += 1;
    return Promise.resolve(promise).finally(() => { projectAsyncWork -= 1; });
  }

  /** Проверка схемы и ролей только чтением, до включения фоновых сторожей. */
  async function validateProjectSchema(settings, { readOnly = false } = {}) {
    // Варианты «Функция» живут внутри проверки: проба исполняет ровно этот
    // срез (regression-tests/relay-project-schema-integration.mjs), и помощник,
    // вынесенный наружу, в ней просто не существует.
    /**
     * Обязательные варианты «Функция» — те, что несут систему, плюс те, что уже
     * стоят в строках.
     *
     * `Maintainer` сам по себе не обязателен: закулисная роль может и не быть
     * заведена, и требовать её вариант «на всякий случай» значило бы ломать
     * включение любому проекту без неё (D-074 требовал вариант, D-075 п. 6
     * заменяет это правилом «вариант следует за строкой»). Если строка с
     * `Maintainer` есть, вариант становится обязательным и дописывается сам.
     */
    const BASE_FUNCTIONS = ["Coordinator", "Executor", "Auditor", "Reviewer"];

    function ensureFunctionOption(roleSchema, used = []) {
      const prop = roleSchema?.["Функция"];
      if (!prop || prop.type !== "select") return { missing: [], prop: null, required: [] };
      const options = Array.isArray(prop.select?.options) ? prop.select.options : [];
      const required = [...new Set([...BASE_FUNCTIONS, ...(used || []).filter(Boolean)])];
      const missing = required.filter((fn) => !options.some((option) => String(option.name || "") === fn));
      return { missing, prop, options, required };
    }

    /** PATCH только вариантов select «Функция»; существующие не трогаются. */
    async function patchFunctionOptions(roleSchema, functions) {
      const prop = roleSchema?.["Функция"];
      const options = Array.isArray(prop?.select?.options) ? prop.select.options : [];
      if (!options.length) return false;
      const next = [
        ...options.map((option) => ({ id: option.id, name: option.name, color: option.color })),
        ...functions.filter((fn) => !options.some((option) => String(option.name || "") === fn)).map((fn) => ({ name: fn })),
      ];
      const headers = { Authorization: `Bearer ${C.notion}`, "Notion-Version": C.notionV, "Content-Type": "application/json" };
      await request("PATCH", `https://api.notion.com/v1/data_sources/${C.roles}`, headers,
        { properties: { "Функция": { select: { options: next } } } });
      return true;
    }
    const headers = { Authorization: `Bearer ${settings.notion}`, "Notion-Version": C.notionV, "Content-Type": "application/json" };
    const contracts = [
      ["Роли", C.roles, { "Роль": "title", "Функция": "select", "Статус": "select", "Agent URL": "url", "Зона записи": "rich_text", "Гейт": "rich_text", "Репозиторий": "rich_text" },
        // «Функция» проверяется после чтения строк: вариант добавляется под
        // существующую строку (D-075 п. 6), а не «на всякий случай».
        { "Статус": ["Активна"] }],
      ["Миссии", C.missions, { "Миссия": "title", "Состояние": "select", "Создана": "date", "Завершена": "date", "Возвращена": "date", "Круг": "number", "Замечания": "rich_text", "Итог": "rich_text", "ТЗ URL": "url" },
        { "Состояние": ["Активна", "Возвращена", "Завершена", "Провалена"] }],
      ["Запросы", C.requests, { "Запрос": "title", "Миссия": "rich_text", "Mission ID": "rich_text", "Dependency": "rich_text", "Кому": "select", "Sequence": "number", "Dispatch State": "select", "Run ID": "rich_text", "Recipient Agent ID": "rich_text", "Started At": "date", "Submitted At": "date", "PR": "url", "Check": "select", "Output Drive File ID": "rich_text", "Payload Drive File ID": "rich_text", "Намерение": "rich_text", "Инварианты": "rich_text", "Acceptance": "rich_text", "Свободно": "rich_text", "Scope": "rich_text", "Ответ": "rich_text", "Branch": "rich_text", "Report SHA": "rich_text" },
        { "Dispatch State": ["Draft", "Ready", "Running", "Submitted", "Accepted", "Rework", "Blocked"], "Check": ["pass", "fail"] }],
      // D-080: единственное место, где описана схема «Обратной связи». Раньше
      // `Тип` жил только формулой в NOTION-TEMPLATE.json → afterCreate, и код в
      // Notion писал поле, которого в этой таблице не было.
      //
      // `Срок` остаётся в схеме: транспорт его больше не пишет (сроков нет), но
      // старые строки хранят дату и она нужна истории. `Тип` — select: значение
      // ставит транспорт (`questionProps`), потому что формула не отличает
      // «вопрос про ADR» от «предложения ADR».
      ["Обратная связь", C.questions, { "Вопрос": "title", "Статус": "select", "Тип": "select", "По умолчанию": "rich_text", "Ответ": "rich_text", "Варианты": "rich_text", "Срок": "date", "Доставлено": "date", "Материал": "url", "Роль": "rich_text", "Карточка": "rich_text", "Миссия": "rich_text", "Что блокирует": "rich_text" },
        { "Статус": ["Ждёт", "Решено", "Принят дефолт", "Отменён"], "Тип": ["Вопрос", "Предложение"] }],
    ];
    const schemas = {};
    const warnings = [];
    try {
      for (const [label, id, fields, options] of contracts) {
        const source = await request("GET", `https://api.notion.com/v1/data_sources/${id}`, headers);
        if (!source || source.object !== "data_source" || !source.properties) throw new Error(`«${label}»: источник не вернул схему.`);
        const errors = [];
        for (const [name, type] of Object.entries(fields)) {
          if (source.properties[name]?.type !== type) errors.push(`${name}: нужен ${type}`);
        }
        // Repository — additive for existing databases; absent cards inherit
        // the freshly-read role repo. If present, it must be a text property.
        for (const name of ["Repository", "Репозиторий"]) {
          if (source.properties[name] && source.properties[name].type !== "rich_text") errors.push(`${name}: нужен rich_text`);
        }
        // D-004: поля аккаунтов аддитивны, как Repository. База без них работает
        // по-старому (лимит аккаунта не отслеживается), но если поле есть, оно
        // должно быть select: иначе транспорт не прочитает адрес и промолчит.
        // Имена — литералами, а не константами модуля аккаунтов: эту функцию
        // пробы вырезают из бандла и исполняют отдельно, внешних `const` там нет.
        if (label === "Роли") {
          for (const name of ["Аккаунт", "Доступность"]) {
            if (source.properties[name] && source.properties[name].type !== "select") errors.push(`${name}: нужен select`);
          }
          // Поля provisioning: проверяются только если присутствуют — база без
          // них работает по-старому, как «Аккаунт» по D-004. «Agent Admin» из
          // списка убран: D-024 отменил админ-флаг, и советовать его завести
          // значило бы вернуть выброшенную механику.
          for (const [name, type] of Object.entries({ "Agent State": "select" })) {
            if (source.properties[name] && source.properties[name].type !== type) errors.push(`${name}: нужен ${type}`);
          }
        }
        for (const [name, required] of Object.entries(options)) {
          const actual = source.properties[name]?.select?.options;
          if (!Array.isArray(actual)) errors.push(`${name}: нет списка select`);
          else for (const value of required) if (!actual.some((option) => option.name === value)) errors.push(`${name}: нет «${value}»`);
        }
        // D-080: лишние поля — не отказ, а подсказка Мастеру. Живую схему правит
        // только он; транспорт сообщает, что видит поле, которого нет в этой
        // таблице, чтобы поле не выглядело рабочим. Разница «живое || схема»
        // молчала: `Тип` был в живой базе, но не здесь, и код писал его в пустоту.
        // Поля, которые транспорт читает или пишет, но которые не нужны для
        // работы базы (аддитивные по D-004/D-005, как «Аккаунт»). Раньше
        // «Agent State» попадал в «лишние», и человеку советовали его удалить —
        // а по нему переносится состав ролей в книгу.
        // Проверка типов для них есть выше: «лишнее» здесь значит «не
        // обязательное», а не «ненужное».
        // Поля для людей («Устав») сюда НЕ входят: их никто не читает, и
        // человек должен об этом узнать, а не считать поле рабочим.
        const additive = label === "Роли"
          ? ["Repository", "Репозиторий", "Аккаунт", "Доступность", "Agent State", "Agent Job ID", "Agent Created At", "Previous Agent URL"]
          : ["Repository", "Репозиторий"];
        const extra = Object.keys(source.properties || {}).filter((name) => !(name in fields) && !additive.includes(name));
        if (extra.length) warnings.push(`«${label}»: лишние поля — ${extra.join(", ")} (схема их не знает; правьте схему в Notion только сами).`);
        // D-004: поля аккаунтов аддитивны — база без них работает по-старому.
        // Но «работает по-старому» значит «лимит аккаунта не отслеживается», и
        // человек, вписывающий «Аккаунт» в пустоту, должен узнать об этом здесь,
        // а не по тому, что роль не перестаёт выдаваться.
        if (label === "Роли") {
          const absent = ["Аккаунт", "Доступность"].filter((name) => !source.properties[name]);
          if (absent.length)
            warnings.push(
              `«${label}»: нет полей ${absent.join(", ")} — квоты по аккаунтам не отслеживаются. ` +
                "Добавьте их сами в Notion (select) или возьмите схему из шаблона; транспорт схему не правит.",
            );
        }
        if (errors.length) throw new Error(`«${label}»: ${errors.join(", ")}.`);
        schemas[label] = source.properties;
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
      const rows = [], cursors = new Set();
      let cursor = "";
      while (true) {
        const page = await request("POST", `https://api.notion.com/v1/data_sources/${C.roles}/query`, headers,
          { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) }, { retry: false });
        if (!page || !Array.isArray(page.results) || typeof page.has_more !== "boolean") throw new Error("База «Роли» вернула неполный список.");
        rows.push(...page.results);
        if (rows.length > 1000) throw new Error("База «Роли» слишком велика для проверки.");
        if (!page.has_more) break;
        cursor = String(page.next_cursor || "");
        if (!cursor || cursors.has(cursor)) throw new Error("База «Роли» вернула неверный курсор.");
        cursors.add(cursor);
      }
      const mapped = rows.map(mapRoleRow);
      // D-075 п. 6: вариант «Функция» добавляется по факту строки роли — тем же
      // приёмом, что «Кому» для адресата (provisionEnsureRecipientOption).
      // Иначе включение проекта отказывает, пока вариант не добавили руками,
      // хотя строка уже есть. Вариант списка — не право: право несёт строка.
      //
      // Добавляем только те значения, под которые строка действительно есть.
      // База без строки Maintainer остаётся без варианта и честно отказывает:
      // иначе вариант появился бы из воздуха и выглядел бы как право.
      const rowFunctions = [...new Set(mapped.map((role) => String(role.fn || "").trim()).filter(Boolean))];
      const fnGap = ensureFunctionOption(schemas["Роли"], rowFunctions);
      const addable = rowFunctions.filter((fn) => fnGap.missing.includes(fn));
      if (addable.length && readOnly)
        throw new Error(`«Роли»: не хватает вариантов Функция ${addable.map((fn) => `«${fn}»`).join(", ")}. Проверка из пульта ничего не меняет; исправьте схему Notion и повторите.`);
      if (addable.length) {
        await patchFunctionOptions(schemas["Роли"], addable);
        const fresh = await request("GET", `https://api.notion.com/v1/data_sources/${C.roles}`, headers);
        if (fresh?.properties) schemas["Роли"] = fresh.properties;
      }
      const stillMissing = ensureFunctionOption(schemas["Роли"], rowFunctions).missing;
      if (stillMissing.length) {
        throw new Error(`«Роли»: Функция: нет «${stillMissing[0]}». ` +
          "Добавьте вариант в схему базы «Роли»: он должен следовать за строкой роли, а строка с такой функцией не читается.");
      }
      const active = mapped.filter((role) => role.status === "Активна");
      if (active.filter((role) => role.fn === "Coordinator").length !== 1) throw new Error("Нужен ровно один активный Coordinator.");
      if (!active.some((role) => role.fn === "Reviewer")) throw new Error("Нужна активная роль Reviewer для приёмки и вопросов.");
      if (!active.some((role) => ["Executor", "Auditor"].includes(role.fn))) throw new Error("Нужен активный исполнитель или аудитор.");
      const roleIds = new Set();
      const recipientOptions = schemas["Запросы"]["Кому"].select.options || [];
      for (const role of active) {
        // D-015: у рабочих ролей «Agent URL» в «Ролях» снят — рабочий адрес
        // живёт в листе «Экземпляры» (пара роль + слот) и появляется там,
        // когда агента создаёт сам транспорт. Пустой адрес — норма, а не
        // поломка: проверяем только то, что заполнено, и не требуем того,
        // что создаётся лениво при выдаче. Требовать URL у каждой активной
        // роли — запрет на включение проекта, который чинится только правкой
        // базы, хотя системе от неё ничего не нужно.
        const rawUrl = String(role.url || "").trim();
        if (rawUrl) {
          let url;
          try { url = new URL(rawUrl); } catch { throw new Error(`У роли «${role.name}» некорректный Agent URL.`); }
          if (url.origin !== location.origin || !/^\/agent\/[\w-]+\/?$/.test(url.pathname) || !role.id)
            throw new Error(`У роли «${role.name}» Agent URL должен быть страницей агента на домене этой вкладки.`);
          if (roleIds.has(role.id.toLowerCase())) throw new Error("Несколько активных ролей используют один Agent URL.");
          roleIds.add(role.id.toLowerCase());
        }
        if (["Executor", "Auditor"].includes(role.fn) && !recipientOptions.some((option) => option.name === role.name))
          throw new Error(`В «Запросы → Кому» отсутствует вариант «${role.name}».`);
      }
      const branch = await request("GET", `https://api.github.com/repos/${C.repo}/branches/${encodeURIComponent(C.branch)}`, githubHeaders(settings.github));
      if (!branch || branch.name !== C.branch) throw new Error(`GitHub не подтвердил ветку ${C.branch}.`);
      // D-004: раскладка ролей по аккаунтам задаётся человеком, но проверяется
      // здесь: иначе лимит исполнителей отрезал бы Координатора и приёмку, а
      // причина была бы видна только по журналу одного контейнера.
      if (typeof accountLayoutProblems === "function") {
        for (const problem of accountLayoutProblems(mapped)) warnings.push(`«Роли»: ${problem.text}.`);
      }
      const base = "Основные поля, варианты select, роли и базовая ветка читаются. Права записи и содержимое старых карточек не проверялись.";
      return { ok: true, text: warnings.length ? `${base} ${warnings.join(" ")}` : base };
    } catch (e) {
      return { ok: false, text: `Схема или роли не прошли проверку: ${connectionProblem(e, settings)}` };
    }
  }

  /**
   * Approval can be initiated from the Relay console. It reuses the exact same
   * read-only validation as the former Arena dialog; the console's explicit
   * confirmation is the human authorization. It never starts the auto-cycle.
   */
  let relayApprovalBusy = false;
  async function approveProjectFromRelay(request = {}) {
    const requestId = String(request.id || "").slice(0, 100);
    if (!requestId || String(request.projectId || "") !== String(ACTIVE_PROFILE.id || "")) return false;
    if (relayApprovalBusy || ACTIVE_PROFILE.legacy || ACTIVE_PROFILE.invalid) return false;
    if (projectApproved()) return true;
    if (busy || projectAsyncWork > 0) {
      log("Проверка проекта из пульта отложена: дождитесь завершения текущей операции. Состояние и очередь не изменены.", true);
      return false;
    }
    if (autoOn()) {
      GM_setValue(K.auto, false);
      log("Проверка проекта из пульта: локальное автоуправление временно выключено. Очередь и ожидания сохранены.");
    }
    relayApprovalBusy = true;
    const settings = connectionSettings();
    const profileUnchanged = () => JSON.stringify(resolveProfile(ACTIVE_PROFILE.id)) === JSON.stringify(ACTIVE_PROFILE);
    try {
      if (!settings.notion || !settings.gwUrl || !settings.gwKey) {
        const missing = [!settings.notion && "Notion token", !settings.gwUrl && "Drive Gateway URL", !settings.gwKey && "Drive Gateway key"].filter(Boolean);
        throw new Error(`Relay пока не получил сохранённые подключения: ${missing.join(", ")}. Дождитесь синхронизации локального профиля и повторите проверку; повторно вводить сохранённые значения не нужно.`);
      }
      if (!profileUnchanged()) throw new Error("Профиль изменился в другой вкладке; обновите эту Arena-вкладку и повторите.");
      log("Пульт запросил проверку проекта. Проверяю Notion, Drive, GitHub и схему только чтением…");
      const results = await Promise.all([probeNotionConnection(settings), probeDriveConnection(settings), probeGithubConnection(settings)]);
      if (results.some((result) => !result.ok)) throw new Error(results.map((result) => result.text).join(" "));
      const schema = await validateProjectSchema(settings, { readOnly: true });
      if (!schema.ok) throw new Error(schema.text);
      if (!profileUnchanged() || !sameConnections(settings, connectionSettings()))
        throw new Error("Профиль или подключения изменились во время проверки; допуск не выдан.");
      // Approval is not a request to resume the cycle. Keep all queued and
      // in-flight data untouched and leave automation off until the operator
      // separately enables it from Relay.
      GM_setValue("cfn-project-ever-approved", true);
      GM_setValue("cfn-project-approved", true);
      if (typeof K !== "undefined") GM_setValue(K.auto, false);
      watchQuestions(); watchDecisions();
      const successText = `Проверка пройдена: ${schema.text} Работа разрешена; автоцикл не запущен.`;
      log(successText, false);
      if (typeof relayPost === "function") await relayPost({ action: "event", slotId: relayClient?.slotId || "",
        kind: "state", level: "info", text: successText,
        data: { projectApprovalResult: true, projectId: ACTIVE_PROFILE.id, projectName: ACTIVE_PROFILE.name, projectApprovalFailure: "" } });
      return true;
    } catch (error) {
      const reason = connectionProblem(error, settings).replace(/[.。]+$/, "");
      const failureText = `Проверка из пульта не завершена: ${reason}. Допуск не изменён.`;
      log(failureText, true);
      if (typeof relayPost === "function") await relayPost({ action: "event", slotId: relayClient?.slotId || "",
        kind: "state", level: "warn", text: failureText,
        data: { projectApprovalResult: false, projectId: ACTIVE_PROFILE.id, projectName: ACTIVE_PROFILE.name, projectApprovalFailure: reason } });
      return false;
    } finally {
      relayApprovalBusy = false;
    }
  }

  /** UUID базы из HTTPS-ссылки Notion; ID представления в query не используется. */
  function notionDatabaseId(value) {
    try {
      const url = new URL(String(value || "").trim());
      if (url.protocol !== "https:" || url.username || url.password ||
          !["app.notion.com", "notion.so", "www.notion.so"].includes(url.hostname)) return "";
      const path = decodeURIComponent(url.pathname);
      const matches = path.match(/[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}/ig) || [];
      const id = (matches.at(-1) || "").replace(/-/g, "").toLowerCase();
      return id.length === 32 ? `${id.slice(0,8)}-${id.slice(8,12)}-${id.slice(12,16)}-${id.slice(16,20)}-${id.slice(20)}` : "";
    } catch { return ""; }
  }

  /** Read-only план миграции: никаких fuzzy-сопоставлений и молчаливых правок. */
  async function inspectMissionMigration() {
    const [missions, cards] = await Promise.all([query(C.missions), query(C.requests)]);
    const active = missions.filter((row) => ["Активна", "Возвращена"].includes(sel(row.properties?.["Состояние"])));
    const states = new Set(["Draft", "Ready", "Running", "Submitted", "Accepted", "Rework", "Blocked"]);
    const mapped = [], existing = [], conflicts = [];
    for (const row of cards) {
      const label = rt(row.properties?.["Миссия"]).trim();
      const current = cardMissionId(row);
      const title = taskTitle(row) || "без названия";
      const matches = label ? missions.filter((item) => rt(item.properties?.["Миссия"]).trim() === label ||
        (isUuid(label) && norm(item.id) === norm(label))) : [];
      if (!states.has(taskState(row))) { conflicts.push({ row, why: "пустое или неизвестное состояние" }); continue; }
      if (current) {
        const problem = cardBindingIssue(row, missions);
        if (problem) conflicts.push({ row, why: problem });
        else existing.push({ row, id: current });
        continue;
      }
      if (matches.length !== 1) {
        conflicts.push({ row, why: !label ? "пустое название миссии" :
          matches.length ? "несколько миссий с таким названием" : "нет точного совпадения названия или ID" });
        continue;
      }
      mapped.push({ row, mission: matches[0], id: matches[0].id, title, label });
    }
    if (active.length > 1) conflicts.push({ row: null, why: `активных или возвращённых миссий: ${active.length}` });
    if (cards.some((row) => taskState(row) === "Running"))
      conflicts.push({ row: null, why: "есть карточки Running: сначала завершите или разберите текущие ходы" });
    return { mapped, existing, conflicts, count: cards.length };
  }

  function formatMissionMigration(plan) {
    const lines = [`Карточек: ${plan.count}; уже привязано: ${plan.existing.length}; ` +
      `точных предложений: ${plan.mapped.length}; требуют ручной проверки: ${plan.conflicts.length}.`];
    for (const item of plan.mapped) lines.push(`ПРЕДЛОЖЕНИЕ ${item.row.id} · ${item.title} → ${item.id} · ${item.label}`);
    for (const item of plan.conflicts) lines.push(`ПРОВЕРИТЬ ${item.row?.id || "общая проверка"} · ${item.row ? taskTitle(item.row) : ""}: ${item.why}`);
    lines.push("Сверьте каждую строку с карточкой и миссией. Названия, состояния, ответы, Run ID и журналы не меняются.");
    return lines.join("\n");
  }

  async function applyMissionMigration(plan) {
    let written = 0;
    for (const item of plan.mapped) {
      // Не используем старый снимок, если карточку или миссию поправили после
      // предпросмотра. Notion не поддерживает атомарный compare-and-set.
      const [row, mission] = await Promise.all([
        notion("GET", `pages/${item.row.id}`), notion("GET", `pages/${item.id}`),
      ]);
      if (row.last_edited_time !== item.row.last_edited_time || mission.last_edited_time !== item.mission.last_edited_time ||
          cardMissionId(row) || rt(row.properties?.["Миссия"]).trim() !== item.label || taskState(row) === "Running" ||
          norm(mission.id) !== norm(item.id)) {
        throw new Error(`Изменение карточки или миссии ${item.row.id}; уже записано ${written}. Обновите предпросмотр.`);
      }
      await patch(item.row.id, { "Mission ID": { rich_text: richText(item.id) } });
      written += 1;
    }
    return written;
  }
