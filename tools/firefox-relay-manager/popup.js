const summary = document.getElementById("summary");
const list = document.getElementById("slots");
const when = (stamp) => stamp ? new Date(stamp).toLocaleTimeString("ru-RU") : "";

async function render() {
  await browser.runtime.sendMessage({ type: "relay-manager-poll" }).catch(() => {});
  const status = await browser.runtime.sendMessage({ type: "relay-manager-status" });
  list.replaceChildren();
  if (!status.connected) {
    summary.textContent = `Relay не отвечает${status.at ? ` (проверка ${when(status.at)})` : ""}. Нужен запущенный Node Relay на 127.0.0.1:8787.`;
    summary.className = "err";
  } else {
    summary.textContent = `Relay подключён · режим ${status.mode === "auto" ? "автоцикл" : "ручной"} · вкладок-слотов: ${status.openManaged}`;
    summary.className = "ok";
  }
  for (const slot of status.slots || []) {
    const row = document.createElement("li");
    row.textContent = `${slot.admin ? "Admin" : slot.slotId} · ${slot.container || "контейнер не указан"} · ${slot.needed ? "вкладка нужна" : "ожидание"}`;
    if (slot.error) {
      const detail = document.createElement("div");
      detail.className = "err";
      detail.textContent = slot.error;
      row.append(detail);
    } else row.className = "ok";
    list.append(row);
  }
  for (const error of status.errors || []) {
    const row = document.createElement("li");
    row.className = "err";
    row.textContent = error;
    list.append(row);
  }
}

document.getElementById("refresh").addEventListener("click", () => { void render(); });
void render();
