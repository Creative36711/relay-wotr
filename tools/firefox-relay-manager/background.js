/* global browser */
const RELAY = "http://127.0.0.1:8787";
const ARENA_HOME = "https://arena.ai/";
const POLL_MS = 5000;
const IDLE_CLOSE_MS = 180000;
const TAB_MAP_KEY = "relayManagedTabsV1";
const STATUS_KEY = "relayManagerStatusV1";
let polling = false;
let latestMode = "manual";
let latestSnapshot = null;
// Один планирующий ход — одно привлечение admin-вкладки: пока id запроса
// тот же, фокус не воруем (D-035).
let focusedTurnId = "";
let focusedPlanTabId = 0;

const norm = (value) => String(value || "").trim().toLocaleLowerCase();
const isArena = (url) => /^https:\/\/(?:www\.)?arena\.ai\//i.test(String(url || ""));

async function readTabMap() {
  const stored = await browser.storage.local.get(TAB_MAP_KEY);
  return stored[TAB_MAP_KEY] && typeof stored[TAB_MAP_KEY] === "object" ? stored[TAB_MAP_KEY] : {};
}
async function writeTabMap(map) {
  await browser.storage.local.set({ [TAB_MAP_KEY]: map });
}
async function publishStatus(status) {
  const value = { at: Date.now(), ...status };
  await browser.storage.local.set({ [STATUS_KEY]: value });
  const badge = status.errors?.length ? "!" : status.connected ? String(status.openManaged || "") : "×";
  await browser.browserAction.setBadgeText({ text: badge.slice(0, 4) });
  await browser.browserAction.setBadgeBackgroundColor({ color: status.errors?.length ? "#ad343e" : status.connected ? "#247a48" : "#777" });
}
async function getIdentities() {
  if (!browser.contextualIdentities?.query) throw new Error("Firefox не предоставил API контейнеров (contextualIdentities)");
  return browser.contextualIdentities.query({});
}
async function findIdentity(containerName, identities) {
  const key = norm(containerName);
  const matches = identities.filter((identity) => norm(identity.name) === key);
  if (!key || matches.length !== 1) {
    throw new Error(matches.length > 1
      ? `имя контейнера «${containerName}» неоднозначно`
      : `контейнер «${containerName || "(пусто)"}» не найден; слот не будет открыт в чужой сессии`);
  }
  return matches[0];
}

function slotHasLocalBusy(slot, shot) {
  return (shot.scriptClients || []).some((client) => client.slotId === slot.slotId && client.localBusy === true);
}
function shouldKeepTab(slot, shot) {
  const hasLiveRun = Array.isArray(slot.runs) && slot.runs.length > 0;
  const localBusy = slotHasLocalBusy(slot, shot);
  const assignedWaiting = (shot.queue || []).some((item) =>
    String(item["Слот"] || "") === slot.slotId && String(item["Статус"] || "").toLowerCase() === "waiting");
  const adminTurn = Boolean(slot.admin && shot.turnRequest);
  const autoCoordinator = Boolean(slot.admin && shot.mode === "auto");
  return hasLiveRun || localBusy || assignedWaiting || adminTurn || autoCoordinator;
}
function scriptAutoActive(slot, shot) {
  if (shot.mode === "auto" && slot.admin) return true;
  return shouldKeepTab(slot, shot) && (slot.admin ? Boolean(shot.turnRequest) : true);
}

async function ensureTab(slot, identity, map, tabs, preferredTabId = 0) {
  const saved = map[slot.slotId];
  if (saved?.tabId) {
    try {
      const existing = await browser.tabs.get(saved.tabId);
      if (existing.cookieStoreId === identity.cookieStoreId && isArena(existing.url || existing.pendingUrl)) {
        saved.lastNeededAt = Date.now();
        saved.idleSince = 0;
        if (existing.discarded) await browser.tabs.reload(existing.id);
        return existing;
      }
      delete map[slot.slotId];
    } catch { delete map[slot.slotId]; }
  }

  // Reuse an already-open Arena tab in the exact identity before creating one.
  // Never move a tab between containers: that would break session isolation.
  const candidates = tabs.filter((tab) => tab.cookieStoreId === identity.cookieStoreId && isArena(tab.url || tab.pendingUrl));
  const reused = candidates.find((tab) => tab.id === preferredTabId) || candidates.find((tab) => tab.active) || candidates[0];
  if (reused) {
    map[slot.slotId] = { tabId: reused.id, cookieStoreId: identity.cookieStoreId, container: identity.name, createdByManager: false, lastNeededAt: Date.now(), idleSince: 0 };
    if (reused.discarded) await browser.tabs.reload(reused.id);
    return reused;
  }

  const created = await browser.tabs.create({ url: ARENA_HOME, cookieStoreId: identity.cookieStoreId, active: false });
  map[slot.slotId] = { tabId: created.id, cookieStoreId: identity.cookieStoreId, container: identity.name, createdByManager: true, lastNeededAt: Date.now(), idleSince: 0 };
  return created;
}
async function setTabMode(tabId, slotId, mode, active, leader = true) {
  try {
    await browser.tabs.sendMessage(tabId, { type: "relay-manager-cycle-mode", slotId, mode, active, leader, browserTabId: tabId });
  } catch { /* page has not loaded its bridge yet; next poll retries */ }
}

// `tabs.update({active:true})` selects a tab inside its window but may leave
// another browser window in front. A coordinator turn must reach a visible,
// foreground document: Arena can defer composer actions and timers in a
// background window. Focus the owning window explicitly, then activate the tab.
async function focusManagedTab(tab) {
  if (Number.isInteger(tab.windowId)) {
    await browser.windows.update(tab.windowId, { focused: true });
  }
  await browser.tabs.update(tab.id, { active: true });
}

async function pollRelay() {
  if (polling) return;
  polling = true;
  const errors = [];
  try {
    const response = await fetch(`${RELAY}/api/snapshot`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Relay ответил HTTP ${response.status}`);
    const shot = await response.json();
    if (!shot || !Array.isArray(shot.slots)) throw new Error("Relay прислал снимок без списка слотов");
    latestSnapshot = shot;
    latestMode = shot.mode === "auto" ? "auto" : "manual";
    const identities = await getIdentities();
    const tabs = await browser.tabs.query({ url: ["https://arena.ai/*", "https://www.arena.ai/*"] });
    const map = await readTabMap();
    const slotErrors = [];
    let openManaged = 0;
    const identityOwners = new Map();

    for (const slot of shot.slots) {
      const hasLiveRun = Array.isArray(slot.runs) && slot.runs.length > 0;
      const needed = shouldKeepTab(slot, shot) && (slot.enabled || hasLiveRun);
      const existingEntry = map[slot.slotId];
      if (needed) {
        try {
          const identity = await findIdentity(slot.container, identities);
          const earlierSlot = identityOwners.get(identity.cookieStoreId);
          if (earlierSlot && earlierSlot !== slot.slotId) {
            throw new Error(`контейнер «${identity.name}» назначен сразу слотам ${earlierSlot} и ${slot.slotId}`);
          }
          identityOwners.set(identity.cookieStoreId, slot.slotId);
          const busyClients = (shot.scriptClients || []).filter((client) => client.slotId === slot.slotId && client.localBusy === true);
          const containerTabs = tabs.filter((candidate) => candidate.cookieStoreId === identity.cookieStoreId && isArena(candidate.url || candidate.pendingUrl));
          const unknownBusy = busyClients.some((client) => !/^ff-\d+$/.test(String(client.tab || "")));
          if (unknownBusy && containerTabs.length > 1) {
            slotErrors.push(`${slot.slotId}: старая ScriptCat-вкладка занята, а в контейнере несколько Arena-вкладок; менеджер ждёт завершения хода, не переключая лидерство`);
            continue;
          }
          const busyTabIds = [...new Set(busyClients.map((client) => Number(String(client.tab || "").match(/^ff-(\d+)$/)?.[1] || 0)).filter(Boolean))];
          if (busyTabIds.length > 1) {
            slotErrors.push(`${slot.slotId}: несколько вкладок одновременно удерживают локальную работу; вкладки не переназначены`);
            continue;
          }
          const preferredTabId = busyTabIds[0] || Number(map[slot.slotId]?.tabId || 0);
          const tab = await ensureTab(slot, identity, map, tabs, preferredTabId);
          openManaged += 1;
          // Активируем Admin и при новом запросе, и если Relay уже ACK-нул
          // его, но ScriptCat всё ещё держит expect:plan. Второй случай важен
          // при обновлении менеджера/перезапуске: turnRequest уже снят, однако
          // ответ Координатора ещё должен быть обработан в Arena.
          const planWait = slot.admin
            ? busyClients.find((client) => client.localWaiting === "expect:plan")
            : null;
          const requestId = String(shot.turnRequest?.id || "");
          const needsTurnFocus = Boolean(slot.admin && requestId && requestId !== focusedTurnId);
          const needsPlanFocus = Boolean(slot.admin && !requestId && planWait && focusedPlanTabId !== tab.id);
          if (needsTurnFocus || needsPlanFocus) {
            try {
              const current = await browser.tabs.get(tab.id);
              await focusManagedTab(current);
              // Фиксируем только успешный фокус: при отказе Firefox следующий
              // опрос попробует снова. Не фокусируем дважды на transition
              // turnRequest → expect:plan в одной и той же вкладке.
              focusedPlanTabId = tab.id;
              focusedTurnId = requestId || `plan:${slot.slotId}:${tab.id}`;
            } catch (error) {
              slotErrors.push(`${slot.slotId}: не удалось вывести вкладку Координатора на передний план — ${error.message || error}`);
            }
          } else if (slot.admin && !requestId && !planWait) {
            // Следующий план, даже в той же вкладке, должен снова получить
            // один focus после завершения нынешнего ожидания.
            focusedTurnId = "";
            focusedPlanTabId = 0;
          }
          const active = scriptAutoActive(slot, shot);
          for (const candidate of tabs) {
            if (candidate.id !== tab.id && candidate.cookieStoreId === identity.cookieStoreId && isArena(candidate.url || candidate.pendingUrl)) {
              await setTabMode(candidate.id, slot.slotId, "manual", false, false);
            }
          }
          await setTabMode(tab.id, slot.slotId, active ? latestMode : "manual", active, true);
        } catch (error) {
          slotErrors.push(`${slot.slotId}: ${error.message}`);
        }
      } else if (existingEntry?.tabId) {
        await setTabMode(existingEntry.tabId, slot.slotId, "manual", false);
        existingEntry.idleSince ||= Date.now();
        if (!slot.admin && existingEntry.createdByManager) {
          try {
            const tab = await browser.tabs.get(existingEntry.tabId);
            if (!tab.active && Date.now() - existingEntry.idleSince >= IDLE_CLOSE_MS) {
              await browser.tabs.remove(tab.id);
              delete map[slot.slotId];
            }
          } catch { delete map[slot.slotId]; }
        }
      }
    }
    await writeTabMap(map);
    errors.push(...slotErrors);
    const recentBindingErrors = (shot.events || [])
      .filter((event) => /менеджер открыл контейнер для слота/.test(String(event.text || "")) && Date.now() - Date.parse(event.at || "") < 10 * 60 * 1000)
      .slice(0, 5)
      .map((event) => String(event.text || ""));
    errors.push(...recentBindingErrors);
    const state = {
      connected: true,
      mode: latestMode,
      openManaged,
      slots: shot.slots.map((slot) => ({ slotId: slot.slotId, container: slot.container, admin: slot.admin, needed: shouldKeepTab(slot, shot), error: slotErrors.find((text) => text.startsWith(`${slot.slotId}:`)) || "" })),
      errors,
    };
    await publishStatus(state);
  } catch (error) {
    errors.push(error.message || String(error));
    await publishStatus({ connected: false, mode: latestMode, openManaged: 0, slots: [], errors });
  } finally {
    polling = false;
  }
}

browser.tabs.onRemoved.addListener(async (tabId) => {
  const map = await readTabMap();
  let changed = false;
  for (const [slotId, entry] of Object.entries(map)) {
    if (entry.tabId === tabId) { delete map[slotId]; changed = true; }
  }
  if (changed) await writeTabMap(map);
});

browser.runtime.onMessage.addListener((message) => {
  if (message?.type === "relay-manager-status") {
    return browser.storage.local.get(STATUS_KEY).then((stored) => stored[STATUS_KEY] || { connected: false, errors: ["ещё нет снимка Relay"] });
  }
  if (message?.type === "relay-manager-poll") return pollRelay().then(() => ({ ok: true }));
  return undefined;
});

browser.runtime.onInstalled.addListener(() => {
  browser.alarms.create("relay-manager-watchdog", { periodInMinutes: 0.5 });
  void pollRelay();
});
browser.runtime.onStartup.addListener(() => {
  browser.alarms.create("relay-manager-watchdog", { periodInMinutes: 0.5 });
  void pollRelay();
});
browser.alarms.onAlarm.addListener(() => { void pollRelay(); });
setInterval(() => { void pollRelay(); }, POLL_MS);
void pollRelay();
