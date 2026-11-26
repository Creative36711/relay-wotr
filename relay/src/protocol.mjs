// Протокол «вкладка ↔ служба».
//
// Вкладка стала глупой: она не решает, что делать, и не помнит очередь. Её
// работа — спросить «что мне делать», отправить задание, прочитать ответ и
// рассказать, что произошло. Всё остальное делает служба.
//
// Поэтому протокол намеренно маленький: шесть действий. Если для новой
// возможности требуется седьмое — это повод пересмотреть модель, а не
// дописать ещё один эндпоинт.

export const PROTOCOL_VERSION = 1;

/** Действия вкладки. */
export const ACTIONS = {
  HELLO: "hello",          // «я вкладка такого-то слота» → какой слот опознан
  PULL: "pull",            // «дай работу» → строка очереди или «жди»
  BEAT: "beat",            // «я жива» → продлить выдачу, сказать что жду
  REPORT: "report",        // «прочитала ответ» → разбор маркера и результат
  EVENT: "event",          // «вот что случилось» → строка в общий журнал
  BYE: "bye",              // «вкладка уходит» → выдача помечена брошенной
};

/** Действия пульта (человека). */
export const CONTROL = {
  STEP: "step",            // один шаг цикла вручную
  PAUSE: "pause",
  RESUME: "resume",
  MODE: "mode",            // manual ⇄ auto
  DISPATCH: "dispatch",    // выдать конкретную строку на конкретный слот
  CANCEL: "cancel",        // снять строку из очереди
  INPUT: "input",          // действие человека в интерфейсе — в журнал
  ENQUEUE: "enqueue",       // поставить карточку в очередь
  CANCEL: "cancel",         // снять строку из очереди
  SETUP: "setup",           // мастер настройки: найти базы и записать ключи
};

/**
 * Проверка входящего запроса.
 *
 * Отказы сформулированы так, чтобы их можно было показать человеку: «вкладка
 * не опознана» полезнее, чем `400`.
 */
export function validateRequest(body) {
  if (!body || typeof body !== "object") return { ok: false, why: "пустой запрос" };
  const action = String(body.action || "").trim();
  if (!action) return { ok: false, why: "не указано действие" };
  if (!Object.values(ACTIONS).includes(action) && !Object.values(CONTROL).includes(action)) {
    return { ok: false, why: `неизвестное действие «${action}»` };
  }
  if (body.v !== undefined && Number(body.v) !== PROTOCOL_VERSION) {
    return { ok: false, why: `протокол ${body.v} не поддержан: служба ждёт ${PROTOCOL_VERSION}` };
  }
  return { ok: true, action };
}

/** Ответ «делать нечего»: это нормальный ответ, а не ошибка. */
export const idle = (why = "работы нет", extra = {}) => ({ ok: true, work: null, why, ...extra });

/** Ответ «вот работа». */
export const work = (payload) => ({ ok: true, work: payload });
