  // ───────────────────────── проверка адресатов миссии ─────────────────────────
  // D-022: Coordinator отвечает за смысловую роль/очередь, Relay — за слот,
  // аккаунт, квоту и создание пары (роль × слот). Предварительная проверка
  // здесь только структурная: строка роли, допустимая Function и наличие имени
  // в select «Кому». Legacy Status/Agent State и worker URL не являются гейтами;
  // рабочие URL живут в «Экземплярах» и создаются Relay.
  // Чистые функции здесь тестируются без DOM, GM и сетевых вызовов.
  const ROSTER_SOURCE = 1;

  /** Структурная пригодность роли; состояние доставки сюда не входит. */
  function rosterRoleGaps(role, { directory = [], recipientOptions = [] } = {}) {
    const gaps = [];
    const name = String(role?.name || "").trim();
    if (!role) return ["роль не названа"];
    if (!name) gaps.push("имя роли пустое");
    const row = directory.find((r) => norm(r.name) === norm(name)) ||
      (role.fn ? role : null);
    if (!row) return [`роли «${name}» нет в «Ролях»`];
    if (!row.fn) gaps.push("Функция не задана");
    else if (!["Executor", "Auditor"].includes(row.fn)) gaps.push(`Функция «${row.fn}» не является рабочей`);
    // «Кому» — только для рабочих ролей. Статус, Agent URL, Agent State,
    // instances and account quota are intentionally resolved by Relay later.
    if (["Executor", "Auditor"].includes(row.fn) && recipientOptions.length &&
      !recipientOptions.some((option) => norm(option) === norm(name))) {
      gaps.push("имени нет в вариантах «Кому»");
    }
    return gaps;
  }

  /**
   * Состав миссии по её карточкам.
   *
   * `cards` — карточки в Draft и Ready (те, что ещё не выданы). Возвращает
   * список ролей, по каждой — годна она или что именно не так, и общий вердикт.
   * Пустая миссия — не некомплект: нарезать очередь вправе Координатор.
   */
  function missionRoster(cards = [], { directory = [], recipientOptions = [] } = {}) {
    const names = [];
    const seen = new Set();
    for (const card of cards || []) {
      const name = String(taskRole(card) || "").trim();
      if (!name || seen.has(norm(name))) continue;
      seen.add(norm(name));
      names.push(name);
    }
    const roles = names.map((name) => {
      const row = (directory || []).find((r) => norm(r.name) === norm(name)) || null;
      const gaps = rosterRoleGaps({ name, ...(row || {}) }, { directory, recipientOptions });
      return { name, fn: row?.fn || "", gaps, ok: gaps.length === 0 };
    });
    const broken = roles.filter((role) => !role.ok);
    return {
      source: ROSTER_SOURCE,
      roles,
      broken,
      ok: broken.length === 0,
      // Ключ некомплекта: только имена и характер дефекта. Ни чисел, ни id —
      // иначе повторная пауза по тому же некомплекту считалась бы новой.
      key: broken.map((role) => `${role.name}:${role.gaps.join(",")}`).sort().join("|"),
    };
  }

  /** Только структурные проблемы могут блокировать выбор роли. */
  function rosterReason(roster, { source = "" } = {}) {
    const broken = roster?.broken || [];
    if (!broken.length) return "";
    const lines = broken.map((role) => {
      const where = source ? ` (${source}, «Кому» = «${role.name}»)` : "";
      if (role.gaps.some((gap) => /нет в «Ролях»/.test(gap))) {
        return `Роли «${role.name}» в базе «Роли» нет${where}; сначала нужна запись роли с точной Function.`;
      }
      return `Роль «${role.name}» не подходит для рабочей карточки${where}: ${role.gaps.join(", ")}. Исправьте определение/адресата, не Agent URL.`;
    });
    return `${lines.join(" ")} Здесь проверяются только определение роли и «Кому»; Relay отвечает за слот, квоту и создание пары.`;
  }

  function rosterGate(cards, { directory = [], recipientOptions = [] } = {}) {
    const roster = missionRoster(cards, { directory, recipientOptions });
    if (roster.ok) return { ok: true, roster, pause: null };
    return {
      ok: false,
      roster,
      kind: "mission-roster",
      cls: "master",
      reason: rosterReason(roster),
    };
  }
