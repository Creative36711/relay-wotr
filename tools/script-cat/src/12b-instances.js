  // ───────────────────── экземпляры: адрес пары (роль, слот) ─────────────────────
  // D-015 (1.24.0): у неадминских ролей «Agent URL» в «Ролях» больше нет.
  //
  // Причина не в чистоте базы, а в том, что адрес роли перестал быть адресом
  // работы. У роли столько агентов, сколько рабочих контейнеров, и «Agent URL»
  // в строке роли — один. Пока он держал рабочий адрес, всё зависело от того,
  // какой контейнер его вписал последним: три агента одной роли в трёх
  // контейнерах смотрели в одну строку, и задание уезжало не тому.
  //
  // Теперь рабочий адрес — строка листа «Экземпляры»: `Роль | Слот | Agent URL`.
  // В «Ролях» адрес остался только у админских ролей (Warden, Coordinator) и
  // означает «адрес по умолчанию»: у администратора ровно один агент, и
  // отдельная строка пары для него ничего не уточняет.
  //
  // Здесь только чтение через службу Relay (`/api/snapshot`, CORS `*`), ни
  // записи, ни создания: создаёт лист и строки служба. Нет службы — нет адреса
  // пары, и работает прежний порядок (адрес строки роли), а не тишина.

  /** Сколько живёт прочитанный снимок: шаг читает его несколько раз. */
  const INSTANCES_CACHE_MS = 30000;

  /**
   * Основа службы Relay.
   *
   * Хранится в профиле (`cfn-relay-url`), потому что у каждого проекта своя
   * книга, а значит и свой адрес: это настройка, а не константа сборки.
   * `http://` разрешён нарочно: служба живёт на машине владельца, и HTTPS для
   * localhost — самообман, а не защита.
   */
  const RELAY_DEFAULT_BASE = "http://127.0.0.1:8787";

  function relayStoredBase() {
    const raw = String(GM_getValue("cfn-relay-url", "") || "").trim().replace(/\/+$/, "");
    return /^https?:\/\/[^\s/]+/i.test(raw) ? raw : "";
  }

  function relayBase() {
    const raw = relayStoredBase() || RELAY_DEFAULT_BASE;
    // Node binds 0.0.0.0 (IPv4). `localhost` can resolve to ::1 first in
    // Firefox, where that IPv4-only listener is unreachable. Canonicalize the
    // standard local alias to the explicitly permitted IPv4 loopback.
    return raw.replace(/^(https?:\/\/)localhost(?=:\d|\/|$)/i, (_match, scheme) => `${scheme}127.0.0.1`);
  }

  // Shared, initialized before boot (29-boot can run before 46-relay-client).
  let relayContactAt = 0;

  // Empty setting means auto-discover the standard local service. Other legacy
  // paths only switch to Relay mode after an explicit URL or a recent response.
  const relayConfigured = () => Boolean(
    relayStoredBase() || (relayContactAt && Date.now() - relayContactAt <= 180000),
  );

  /**
   * Снимок состояния из службы.
   *
   * Живёт в памяти вкладки: шаг спрашивает экземпляры несколько раз (очередь
   * приёмки, охрана дублей, гейт состава), и три одинаковых запроса на шаг —
   * это три отказа сети, после которых шаг падает. Тридцать секунд — меньше
   * шага, поэтому свежесть не страдает, а цена сбоя падает.
   */
  let relaySnapshotCache = { at: 0, data: null, base: "" };

  async function relaySnapshot({ fresh = false } = {}) {
    const base = relayBase();
    if (!base) return null;
    const age = Date.now() - Number(relaySnapshotCache.at || 0);
    if (!fresh && relaySnapshotCache.data && relaySnapshotCache.base === base && age < INSTANCES_CACHE_MS) {
      return relaySnapshotCache.data;
    }
    const data = await request("GET", `${base}/api/snapshot`, {}, undefined, { retry: false });
    if (!data || typeof data !== "object") throw new Error("служба Relay вернула не снимок");
    relaySnapshotCache = { at: Date.now(), data, base };
    return data;
  }

  /** Слоты книги: служба знает их имена и аккаунты, скрипт — нет. */
  async function relaySlots() {
    try {
      const shot = await relaySnapshot();
      const list = Array.isArray(shot?.slots) ? shot.slots : [];
      return list.map((slot) => ({
        slotId: String(slot.slotId || slot["Слот"] || "").trim(),
        account: String(slot.account || "").trim(),
        admin: slot.admin === true,
      })).filter((slot) => slot.slotId);
    } catch {
      return [];
    }
  }

  /**
   * Слот этой вкладки — по почте её аккаунта.
   *
   * Слот в книге и есть «контейнер»: у него имя (`admin`, `worker-1`…) и почта
   * Arena. Брать первый попавшийся слот нельзя — тогда все вкладки считали бы
   * себя одним контейнером, и адрес пары указывал бы не на того агента.
   * Почты нет (подпись не прочитана) — слот неизвестен: пусть решает
   * вызывающий, а не догадка.
   */
  async function relayCurrentSlot() {
    // `readAccountEmail` объявлен в 44-accounts.js, то есть ниже по сборке:
    // обращение по имени, а не по значению на момент объявления.
    const read = typeof readAccountEmail === "function"
      ? await readAccountEmail({ expand: false }).catch(() => null)
      : null;
    const email = String((read && read.email) || accountSeen().email || "").trim();
    if (!email) return "";
    const slots = await relaySlots();
    const mine = slots.find((slot) => norm(slot.account) === norm(email));
    return mine ? mine.slotId : "";
  }

  /**
   * Экземпляры из снимка, в форме листа «Экземпляры».
   *
   * Служба отдаёт снимок кратко (`role`, `slot`, `url`), а правила состава и
   * очереди ждут имена колонок (`Роль`, `Слот`, `Agent URL`). Переводим здесь,
   * один раз: иначе каждая функция повторяла бы перевод по-своему и
   * разошлась бы с книгой.
   */
  function relayInstances(shot) {
    const list = Array.isArray(shot?.instances) ? shot.instances : [];
    return list.map((item) => ({
      "Роль": String(item.role || item["Роль"] || "").trim(),
      "Слот": String(item.slot || item["Слот"] || "").trim(),
      "Agent URL": String(item.url || item["Agent URL"] || "").trim(),
      "Состояние": String(item.state || item["Состояние"] || "").trim(),
      "Последняя жизнь": String(item.lastSeen || item["Последняя жизнь"] || "").trim(),
      "Заметка": String(item.note || item["Заметка"] || "").trim(),
    })).filter((item) => item["Роль"]);
  }

  /**
   * Рабочий адрес пары (роль, слот).
   *
   * Возвращает `{ url, state, slot, why }`. Пусто и без причины — это не ответ:
   * вызывающий должен знать, чего именно не хватает («пары нет», «адрес не
   * заполнен», «служба не настроена»), иначе на экране снова появится
   * «Agent URL пуст» там, где дело в другом.
   */
  async function instanceFor(roleName, slotId) {
    const name = String(roleName || "").trim();
    if (!name) return { url: "", state: "", why: "роль не названа" };
    if (!relayConfigured()) return { url: "", state: "", why: "адрес службы Relay не задан в ⚙" };
    let shot = null;
    try {
      shot = await relaySnapshot();
    } catch (error) {
      return { url: "", state: "", why: `служба Relay не ответила: ${firstLine(String((error && error.message) || error))}` };
    }
    const instances = relayInstances(shot);
    // Слот не задан — это «в моём контейнере»: вкладка знает свой слот по
    // почте аккаунта. Без этой подстановки роль с тремя агентами находилась бы
    // «где-то», и задание уезжало бы в чужой контейнер.
    const wantSlot = String(slotId || "").trim() || (await relayCurrentSlot());
    const inSlot = instances.filter((item) => norm(item["Роль"]) === norm(name) &&
      (!wantSlot || norm(item["Слот"]) === norm(wantSlot)));
    const withUrl = inSlot.find((item) => item["Agent URL"]);
    if (withUrl) {
      return { url: withUrl["Agent URL"], state: withUrl["Состояние"], slot: withUrl["Слот"], why: "" };
    }
    if (inSlot.length) {
      const one = inSlot[0];
      return {
        url: "", state: one["Состояние"], slot: one["Слот"],
        why: `экземпляр «${name}» в ${one["Слот"]} есть, но адрес не заполнен`,
      };
    }
    return { url: "", state: "", why: wantSlot ? `пары «${name}» / ${wantSlot} нет в «Экземплярах»` : `«${name}» нет в «Экземплярах»` };
  }

  /**
   * Адрес роли для доставки — без «слота этой вкладки».
   *
   * Нужен там, где адресат не привязан к контейнеру отправителя: обратная связь
   * уходит Warden'у, и его агент живёт в админском слоте, а не в том, откуда
   * пишут. Правило: экземпляр пары, если он есть, затем строка роли.
   *
   * Строка роли — запасной путь, а не равноправный источник: у неадминских
   * ролей её адрес снят (D-015), и пустое значение здесь означает именно
   * «адреса нет», а не «ещё не читали».
   */
  async function roleInstanceUrl(roleName, { slotId = "" } = {}) {
    const found = await instanceFor(roleName, slotId);
    if (found.url) return found.url;
    // Второй заход без слота: у роли может быть агент в другом контейнере —
    // это хуже, чем «свой», но лучше, чем «нет адреса» для обратной связи.
    if (slotId) {
      const any = await instanceFor(roleName, "");
      if (any.url) return any.url;
    }
    return "";
  }

  /**
   * Адрес роли для отправки: свежий или из «Экземпляров».
   *
   * Единственная точка, через которую доставка узнаёт адрес. Прежний код брал
   * `role.url` напрямую, и после D-015 у неадминских ролей там пусто — задание
   * не нашло бы страницу. Строка «Ролей» проверяется первой (у админских ролей
   * адрес там по закону), экземпляры — вторыми, то есть ровно наоборот тому,
   * как выбирается адрес ПАРЫ: здесь слот отправителя не важен, важно, что
   * роль существует и её агент открыт хоть где-то.
   */
  async function roleDeliveryUrl(role) {
    const direct = String(role?.url || "").trim();
    if (direct) return direct;
    const name = String(role?.name || "").trim();
    if (!name) return "";
    return (await roleInstanceUrl(name).catch(() => "")) || "";
  }

  /** Почему адреса нет — человеческим языком, для журнала и пауз. */
  async function roleAddressWhy(roleName, { slotId = "" } = {}) {
    const found = await instanceFor(roleName, slotId);
    if (found.url) return "";
    if (slotId && !found.why.startsWith("пары")) return found.why;
    if (slotId) {
      const any = await instanceFor(roleName, "");
      return any.url ? "" : any.why;
    }
    return found.why;
  }
