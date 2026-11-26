// Учёт аккаунтов и квот.
//
// Главная поправка к прежней модели: лимит принадлежит аккаунту, а не слоту и
// не роли (D-004). Один и тот же аккаунт может стоять в двух контейнерах, и
// тогда исчерпанная квота останавливает оба — скрипт обязан это видеть и не
// выдавать туда работу.
//
// Мы намеренно не превращаем это в «перекидывание задач»: аккаунт в лимите —
// это пауза для его слотов, а не повод самовольно переписать слот карточки.

import { norm } from "./util.mjs";

export const AVAIL_OK = "ок";
export const AVAIL_LIMIT = "лимит";

/**
 * Метка лимита. Срок — ближайшая полночь по Москве (UTC+3 круглый год).
 *
 * Часы пользователя здесь не участвуют: лимит снимается по времени сервера,
 * иначе смена часового пояса «сдвигала» бы окно.
 */
export function nextMoscowMidnight(now = Date.now()) {
  const MSK = 3 * 60 * 60 * 1000;
  const msk = new Date(now + MSK);
  const next = Date.UTC(msk.getUTCFullYear(), msk.getUTCMonth(), msk.getUTCDate() + 1) - MSK;
  return next;
}

/** Отметка лимита для аккаунта. */
export function limitMark(account, { now = Date.now(), role = "", slot = "" } = {}) {
  return {
    account: norm(account),
    role: String(role || ""),
    slot: String(slot || ""),
    at: new Date(now).toISOString(),
    until: nextMoscowMidnight(now),
  };
}

/**
 * Состояние аккаунтов на момент решения.
 *
 * Возвращает карту «аккаунт → { limited, until, reason }». Просроченная
 * отметка не считается лимитом: окно кончилось, и держать слот закрытым
 * дальше значило бы стоять сутки из-за вчерашней квоты.
 */
export function accountState(accounts = [], { limits = [], now = Date.now() } = {}) {
  const state = new Map();
  for (const account of accounts) {
    const key = norm(account);
    if (!key) continue;
    state.set(key, { account: key, limited: false, until: 0, reason: "" });
  }
  for (const limit of limits) {
    const key = norm(limit?.account);
    if (!key) continue;
    const until = Number(limit.until) || 0;
    if (until <= now) continue;
    state.set(key, {
      account: key,
      limited: true,
      until,
      reason: String(limit.reason || limit.role || "лимит аккаунта"),
    });
  }
  return state;
}

/**
 * Можно ли выдавать работу на этот слот.
 *
 * Три отказа, и каждый назван словами: слот выключен, аккаунт в лимите,
 * слот уже занят другой выдачей. Молчаливый отказ — это и есть та причина,
 * из-за которой раньше «карточка висела, а почему — непонятно».
 */
export function slotGate(slot, { state = new Map(), liveRuns = [], maxParallelPerSlot = 1, now = Date.now() } = {}) {
  if (!slot) return { ok: false, why: "слота нет" };
  if (!slot.enabled) return { ok: false, why: `слот ${slot.slotId} выключен` };
  const account = state.get(norm(slot.account));
  if (account?.limited) {
    const until = new Date(account.until).toISOString();
    return { ok: false, why: `аккаунт слота ${slot.slotId} в лимите до ${until}` };
  }
  const busy = liveRuns.filter((run) => norm(run["Слот"]) === norm(slot.slotId)).length;
  if (busy >= maxParallelPerSlot) {
    return { ok: false, why: `слот ${slot.slotId} занят: ${busy} из ${maxParallelPerSlot}` };
  }
  return { ok: true, why: "", account: account || null, busy, at: now };
}

/** Совместимость: старые отметки «роль ограничена» тоже читаются. */
export const roleLimited = (availability) => norm(availability) === AVAIL_LIMIT;
