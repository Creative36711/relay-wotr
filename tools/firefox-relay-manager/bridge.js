// Мост «пульт ↔ менеджер контейнеров».
//
// Зачем. У пульта одна задача требует привилегий браузера: открыть человеку
// нужную вкладку. До 0.1.5 менеджер делал это сам, по своему усмотрению —
// каждый новый ход Координатора поднимал окно Firefox поверх работы владельца.
// Владелец сказал прямо: «пока ты вручную не переключишься на нужную вкладку,
// никакие сообщения не отправляются» — то есть перехват окна был не помощью,
// а требованием присутствия. Теперь менеджер вкладки не переключает вовсе
// (D-022), а пульт может попросить об этом явной кнопкой «Открыть вкладку».
//
// Как. Пульт — страница на 127.0.0.1:8787. Менеджер — расширение Firefox.
// Прямого канала между ними нет, поэтому связь идёт через content script:
// bridge.js живёт на страницах Arena, а страница пульта открывается в той же
// вкладке, куда ScriptCat уходит по `location.assign`. Content script видит
// и событие страницы пульта, и `browser.runtime`.
//
// Безопасность: наружу отсюда не уходит ничего. Пульт просит ровно одно
// действие — «покажи вкладку слота» — и получает ответ. Ни содержимое
// страницы, ни cookies, ни список вкладок не читаются.
(() => {
  const MANAGER_SOURCE = "relay-pult";
  const PAGE_EVENT = "relay-manager-focus";     // пульт → content script
  const ANSWER_EVENT = "relay-manager-focus-result"; // content script → пульт

  const isPult = () => /^http:\/\/127\.0\.0\.1:8787\//.test(String(location.href || ""));

  if (typeof window !== "undefined" && window.addEventListener) {
    window.addEventListener("relay-pult-focus-request", (event) => {
      let detail = event && event.detail;
      if (typeof detail === "string") { try { detail = JSON.parse(detail); } catch { return; } }
      if (!detail || detail.source !== MANAGER_SOURCE) return;
      const requestId = String(detail.requestId || "").slice(0, 60);
      const slotId = String(detail.slotId || "").slice(0, 80);
      if (!requestId || !slotId) return;
      Promise.resolve()
        .then(() => browser.runtime.sendMessage({
          type: PAGE_EVENT, slotId, requestId, from: String(location.href || ""),
        }))
        .then((answer) => {
          window.dispatchEvent(new CustomEvent(ANSWER_EVENT, {
            detail: JSON.stringify({
              source: "relay-container-manager", requestId,
              ok: Boolean(answer && answer.ok), why: String((answer && answer.why) || ""),
            }),
          }));
        })
        .catch((error) => {
          window.dispatchEvent(new CustomEvent(ANSWER_EVENT, {
            detail: JSON.stringify({
              source: "relay-container-manager", requestId, ok: false,
              why: String((error && error.message) || error || "менеджер не ответил").slice(0, 200),
            }),
          }));
        });
      return undefined;
    });
  }

  // Старый канал режима вкладки остаётся: он про автоцикл, а не про фокус.
  browser.runtime.onMessage.addListener((message) => {
    if (!message || message.type !== "relay-manager-cycle-mode") return undefined;
    const detail = JSON.stringify({
      source: "relay-container-manager",
      mode: message.mode === "auto" ? "auto" : "manual",
      active: Boolean(message.active),
      leader: message.leader !== false,
      slotId: String(message.slotId || ""),
      browserTabId: Number(message.browserTabId) || 0,
    });
    window.dispatchEvent(new CustomEvent("relay-container-manager-mode", { detail }));
    return Promise.resolve({ ok: true });
  });

  // Признак для пульта: мост на месте. Без него кнопка честно скажет, что
  // менеджер не установлен, а не сделает вид, что позвала его.
  if (isPult() && typeof window !== "undefined") {
    try {
      window.dispatchEvent(new CustomEvent("relay-manager-bridge-ready", {
        detail: JSON.stringify({ source: "relay-container-manager" }),
      }));
    } catch { /* страница ещё не слушает — не поломка */ }
  }
})();
