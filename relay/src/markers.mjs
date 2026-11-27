// Разбор маркеров хода из текста ответа агента.
//
// Службе нужны ровно два решения протокола (D-025):
//   CF_COORDINATOR_RESULT с next: "done" — миссия готова, ход приёмке;
//   CF_REVIEW_RESULT с verdict: accept | rework | master — судьба приёмки.
// Всё остальное (планы, карточки, арбитраж, вопросы) остаётся в вкладке:
// служба не переписывает протокол, она исполняет его машинерию хода.
//
// Лестница чтения — по мотивам D-067 вкладки: JSON в ответе может стоять
// без имени маркера или с переписанным именем. Мягкие ступени, как и там,
// ничего не разрешают сами: verdict принимается только из закрытого списка,
// next — только непустая строка. Решение принимает вызывающий, а не парсер.

const COORDINATOR = "CF_COORDINATOR_RESULT";
const REVIEW = "CF_REVIEW_RESULT";

/** Закрытый список вердиктов приёмки — как во вкладке (26-review). */
export const REVIEW_VERDICTS = ["accept", "rework", "master"];

const escapeRx = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Мягкое имя: `cf-review-result`, `CF REVIEW RESULT`, `CF_REVIEW_RESULT`. */
function looseHas(text, name) {
  const core = name.replace(/^CF_/, "");
  const pattern = core.split("_").map(escapeRx).join("[\\s_-]*");
  return new RegExp(`CF[\\s_-]*${pattern}`, "i").test(text);
}

/**
 * Последний объект нулевой глубины.
 *
 * Вложенные JSON («question» у Координатора) не главнее внешнего решения:
 * иначе из `{"next":…,"question":{…}}` доставался бы `question` — и вместо
 * решения получалось «JSON без next» (живой случай D-067).
 */
function lastJsonObject(text) {
  const starts = [];
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") {
      if (depth === 0) starts.push(i);
      depth += 1;
    } else if (ch === "}") {
      depth = Math.max(0, depth - 1);
    }
  }
  for (let k = starts.length - 1; k >= 0; k -= 1) {
    // Срез от стартовой скобки до парной: глубина считается заново.
    let end = -1;
    let d = 0;
    let str = false;
    let esc = false;
    for (let i = starts[k]; i < text.length; i += 1) {
      const ch = text[i];
      if (str) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') str = false;
        continue;
      }
      if (ch === '"') str = true;
      else if (ch === "{") d += 1;
      else if (ch === "}") {
        d -= 1;
        if (d === 0) {
          end = i + 1;
          break;
        }
      }
    }
    if (end < 0) continue;
    try {
      const obj = JSON.parse(text.slice(starts[k], end));
      if (obj && typeof obj === "object" && !Array.isArray(obj)) return obj;
    } catch {
      // Не этот кусок — пробуем более ранний объект.
    }
  }
  return null;
}

/**
 * Решение хода из текста ответа.
 *
 * Возвращает `{ kind: "coordinator", next }`, `{ kind: "review", verdict }`
 * или `null` (ход не двигается: чужой маркер, мусор, арбитраж, сдача карточки).
 */
export function parseTurnMarker(raw) {
  const text = String(raw || "");
  if (!text.trim()) return null;
  const obj = lastJsonObject(text);
  if (!obj) return null;

  const verdict = String(obj.verdict ?? "").trim().toLowerCase();
  const next = typeof obj.next === "string" ? obj.next.trim() : "";

  // Приёмка первая: у неё подпись «verdict», но «verdict + action» — это
  // арбитраж (CF_ARBITER_RESULT), и он ход миссии не двигает.
  if (REVIEW_VERDICTS.includes(verdict) && !("action" in obj)) {
    if (looseHas(text, REVIEW) || !next) return { kind: "review", verdict };
  }

  // План Координатора: имя маркера или характерная подпись «next».
  if (next && (looseHas(text, COORDINATOR) || !("verdict" in obj))) {
    return { kind: "coordinator", next };
  }

  return null;
}
