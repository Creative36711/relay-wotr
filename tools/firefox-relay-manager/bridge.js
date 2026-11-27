// The privileged add-on talks to this isolated content script. The page and
// userscript never receive browser.tabs or contextualIdentities capabilities.
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
