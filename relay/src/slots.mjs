// Слоты: где живёт работа.
//
// Слот — это контейнер браузера плюс аккаунт Arena внутри него. Роли к слоту
// не привязаны: в любом рабочем слоте доступны все рабочие роли, а выбирает
// и роль, и слот Координатор (или диспетчер — по правилу, не наугад).
// Административные функции живут только в административном слоте.
//
// Здесь нет ни одного знания о конкретном контейнере: список приходит из
// таблицы. Новый контейнер — новая строка, код не меняется.

import { SHEETS, isAdminRole, rowToObject, truthy } from "./schema.mjs";

/**
 * Разбор листа «Слоты».
 *
 * `slotId` — единственный ключ, по которому дальше идёт всё: очередь, выдачи,
 * события. Контейнер и аккаунт — свойства слота, а не ключ: человек может
 * переименовать контейнер, и это не должно ломать историю.
 */
export function parseSlots(rows) {
  const slots = [];
  for (const raw of rows || []) {
    const row = rowToObject("slots", raw);
    const id = row["Слот"].trim();
    if (!id) continue;
    slots.push({
      slotId: id,
      container: row["Контейнер"].trim(),
      account: row["Аккаунт"].trim().toLowerCase(),
      admin: truthy(row["Админский"]),
      status: row["Статус"].trim() || "активен",
      note: row["Заметка"],
      enabled: (row["Статус"].trim() || "активен").toLowerCase() === "активен",
    });
  }
  return slots;
}

export const activeSlots = (slots) => slots.filter((slot) => slot.enabled);

export const adminSlots = (slots) => activeSlots(slots).filter((slot) => slot.admin);
export const workerSlots = (slots) => activeSlots(slots).filter((slot) => !slot.admin);

export function slotById(slots, id) {
  const key = String(id || "").trim();
  return slots.find((slot) => slot.slotId === key) || null;
}

export function slotByAccount(slots, account) {
  const mail = String(account || "").trim().toLowerCase();
  if (!mail) return null;
  return slots.find((slot) => slot.account === mail) || null;
}

/**
 * Может ли этот слот взять эту роль.
 *
 * Два правила, и оба — не вкусовые:
 *   1. Административная функция не уходит на рабочий слот: иначе лимит
 *      исполнительского аккаунта отрежет Координатора (D-004).
 *   2. Административный слот не берёт рабочие роли: он один и держит
 *      Координатора, Warden и Maintainer.
 */
export function slotAcceptsRole(slot, role) {
  if (!slot || !slot.enabled) return { ok: false, why: "слот выключен" };
  const adminRole = isAdminRole(role?.name, role?.fn);
  if (adminRole && !slot.admin) return { ok: false, why: "административная роль не уходит на рабочий слот" };
  if (!adminRole && slot.admin) return { ok: false, why: "административный слот не берёт рабочие роли" };
  return { ok: true, why: "" };
}

/**
 * Описание слотов для промпта Координатора и для пульта.
 *
 * Координатор должен видеть не только «кто свободен», но и «почему занят»:
 * иначе он начнёт выдавать карточки вслепую и упрётся в лимит аккаунта.
 */
export function slotPlanNote(slots, { leases = [], runs = [], accountLimits = new Map(), now = Date.now() } = {}) {
  const bus = new Map();
  for (const run of runs) {
    if (!run.slot) continue;
    if (!["issued", "alive"].includes(String(run.status || "").toLowerCase())) continue;
    bus.set(run.slot, (bus.get(run.slot) || 0) + 1);
  }
  const notes = [];
  for (const slot of activeSlots(slots)) {
    const leased = leases.filter((item) => item.slot === slot.slotId).length;
    const busy = (bus.get(slot.slotId) || 0) + leased;
    const limit = accountLimits.get(slot.account);
    const until = limit && Number(limit.until) > now ? limit.until : 0;
    const parts = [`${slot.slotId} (${slot.container || "контейнер не назван"})`];
    if (slot.admin) parts.push("административный");
    parts.push(busy > 0 ? `занят: ${busy}` : "свободен");
    if (until) parts.push(`аккаунт в лимите до ${new Date(until).toISOString()}`);
    notes.push(parts.join(", "));
  }
  return notes;
}

export const SLOT_COLUMNS = SHEETS.slots.columns;
