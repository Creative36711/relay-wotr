// Схема состояния. Один источник истины для листов Google Sheets и для
// самопроверки: порядок колонок здесь = порядок в таблице.
//
// Почему схема в коде, а не «как получится». Состояние читают три разные
// стороны: служба (relayd), вкладка-исполнитель и человек глазами. Если
// колонки разъедутся, ошибка будет тихой: запишется в соседнюю колонку и
// никто не заметит. Поэтому каждая запись проверяется на длину.

export const SHEETS = {
  state: { name: "Состояние", columns: ["Ключ", "Значение", "Обновлено", "Кем"] },
  slots: {
    name: "Слоты",
    columns: ["Слот", "Контейнер", "Аккаунт", "Админский", "Статус", "Заметка"],
  },
  queue: {
    name: "Очередь",
    columns: [
      "ID", "Создано", "Карточка", "Заголовок", "Роль", "Функция",
      "Слот", "Вид", "Статус", "Взял слот", "Взято в", "Готово в", "Комментарий",
    ],
  },
  runs: {
    name: "Выдачи",
    columns: [
      "Run ID", "Карточка", "Заголовок", "Слот", "Аккаунт", "Роль", "Agent URL",
      "Статус", "Выдан", "Последняя жизнь", "Ожидание", "Попытка", "Маркер", "Ответ",
    ],
  },
  events: {
    name: "События",
    columns: [
      "Время", "Слот", "Аккаунт", "Вкладка", "Вид", "Уровень",
      "Текст", "Карточка", "Run ID", "Длительность мс", "Данные",
    ],
  },
  settings: {
    name: "Настройки",
    columns: ["Ключ", "Значение", "Тип", "Группа", "По умолчанию", "Описание"],
  },
  /**
   * Экземпляры агентов: пара (роль, слот) → живой агент Arena.
   *
   * Почему не колонка в «Ролях». Роль одна, а экземпляров у неё столько,
   * сколько рабочих контейнеров: «Godot World» живёт в worker-1, worker-2 и
   * worker-3 одновременно. В Notion это не выразить ни `url` (одно значение),
   * ни `rich_text` со списком (транспорт не разберёт). Поэтому ключ здесь —
   * пара, а строка роли остаётся про постановку: зона, гейт, репозиторий.
   *
   * `Agent URL` в строке роли после этого не обязателен. Пока он есть, пара
   * с пустым адресом наследует его — старые базы работают как раньше.
   */
  /**
   * Роли: то, без чего нельзя решить «эта роль административная или рабочая».
   *
   * Зачем лист. До сих пор роли читались только из Notion, хотя всё остальное
   * состояние живёт в книге. У владельца сеть до Notion режется фильтром, и
   * цикл формально «не настроен», хотя книга читается и слоты на месте.
   * Лист делает Notion ускорителем, а не условием: заполняется из Notion
   * кнопкой мастера, правится руками, читается при каждом шаге.
   */
  roles: {
    name: "Роли",
    columns: ["Роль", "Функция", "Статус", "Agent URL", "Репозиторий", "Не требуется", "Заметка"],
  },

  agents: {
    name: "Экземпляры",
    columns: [
      "Роль", "Слот", "Agent URL", "Состояние", "Создан",
      "Job ID", "Последняя жизнь", "Заметка",
    ],
  },
};

/** Статусы очереди. `blocked` держит строку, пока не закрыта её причина. */
export const QUEUE_STATES = ["waiting", "blocked", "leased", "done", "cancelled"];

/** Статусы выдачи. `alive` — вкладка отчитывалась недавно. */
export const RUN_STATES = ["issued", "alive", "submitted", "failed", "abandoned"];

/**
 * Административные функции. Их место — только административный слот:
 * Координатор, Warden и Maintainer не делят квоту с исполнителями (D-004),
 * и это правило остаётся, даже когда работа стала параллельной.
 */
export const ADMIN_FNS = ["Coordinator", "Warden", "Reviewer", "Maintainer", "Transport Maintainer"];

/** Функции, которые никогда не уходят на рабочий слот. */
export const ADMIN_ROLE_NAMES = ["Coordinator", "Warden", "Transport Maintainer"];

export const isAdminFunction = (fn) => ADMIN_FNS.includes(String(fn || "").trim());
export const isAdminRole = (name, fn) =>
  ADMIN_ROLE_NAMES.includes(String(name || "").trim()) || isAdminFunction(fn);

/**
 * Приведение строки листа к объекту и обратно.
 * Пустые ячейки остаются пустыми строками, а не `undefined`: Sheets не умеет
 * хранить `undefined`, а `null` превращает в пустую ячейку сам.
 */
export function rowToObject(sheetKey, row) {
  const { columns } = SHEETS[sheetKey];
  const out = {};
  for (let i = 0; i < columns.length; i += 1) out[columns[i]] = String(row?.[i] ?? "");
  return out;
}

export function objectToRow(sheetKey, obj) {
  const { columns } = SHEETS[sheetKey];
  const row = columns.map((column) => {
    const value = obj?.[column];
    if (value === undefined || value === null) return "";
    if (typeof value === "boolean") return value ? "да" : "нет";
    return String(value);
  });
  // Лишние поля — это ошибка вызывающего, а не повод молча потерять данные.
  const extra = Object.keys(obj || {}).filter((key) => !columns.includes(key));
  if (extra.length) throw new Error(`в «${SHEETS[sheetKey].name}» нет колонок: ${extra.join(", ")}`);
  return row;
}

export const truthy = (value) => /^(да|true|1|yes|y)$/i.test(String(value ?? "").trim());
export const falsyOrEmpty = (value) => !String(value ?? "").trim();
