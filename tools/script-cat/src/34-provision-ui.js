  // ───────────────────────── provisioning: диалог Мастера ─────────────────────────
  // D-024: окно больше ничего не «запрашивает» и никого не «одобряет». Задание
  // даёт служба Relay (карточка → контейнер), а окно честно показывает, что
  // происходит: какое задание в работе, чем закончилось предыдущее и почему
  // шаг сейчас не идёт. Кнопок согласования нет — их не за что нажимать.

  async function provisionOpenDialog() {
    if (typeof projectApproved === "function" && !projectApproved()) {
      log("Provisioning: проект ещё не разрешён к работе.", true); return;
    }
    document.getElementById("cfn-provision-dialog")?.remove();
    const cfg = provisionConfig();
    const box = document.createElement("div");
    box.id = "cfn-provision-dialog";
    box.style.cssText = "position:fixed;inset:0;z-index:2147483001;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center";
    const card = document.createElement("div");
    card.style.cssText = "width:min(720px,94vw);max-height:88vh;overflow:auto;background:#15171c;color:#e7eaee;border:1px solid #2b2f38;border-radius:10px;padding:16px;font:13px/1.45 ui-monospace,Menlo,Consolas,monospace";
    card.innerHTML = `<h3 style="margin:0 0 8px">🤖 Provisioning Arena-агентов</h3><div id="cfn-provision-body">Читаю состояние…</div>
      <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
        <button id="cfn-provision-close" style="padding:6px 10px">Закрыть</button>
      </div>`;
    box.appendChild(card);
    document.body.appendChild(box);
    const body = card.querySelector("#cfn-provision-body");
    card.querySelector("#cfn-provision-close").onclick = () => box.remove();
    box.onclick = (e) => { if (e.target === box) box.remove(); };
    try {
      const request = provisionRequestState();
      const state = provisionState();
      const active = provisionActiveJob();
      let html = `<div style="color:#aab4c3">maxJobs=${cfg.agentProvisionMaxJobs} dailyMax=${cfg.agentProvisionDailyMax} ` +
        `first=${provisionBootstrapClean(provisionBootstrapPrompt()) ? "ok" : "запрещён"}</div>`;
      html += `<p style="margin:8px 0 0">Задание даёт служба Relay: есть роль — выдаётся работа, нет — создаётся агент. ` +
        `Отдельного согласования и админ-роли нет.</p>`;
      if (request) {
        html += `<div style="margin-top:8px">Задание ${escapeHtml(request.requestId)}: ${escapeHtml(request.state)}` +
          `${request.targetSlot ? `, контейнер ${escapeHtml(request.targetSlot)}` : ""}` +
          `${request.roleName ? `, роль «${escapeHtml(request.roleName)}»` : ""}; jobs ${(request.jobIds || []).length}.</div>`;
        if (request.error) html += `<div style="margin-top:6px;color:#ffd479">Причина: ${escapeHtml(request.error)}</div>`;
      } else html += `<div style="margin-top:8px">Задания нет: контур свободен.</div>`;
      if (active) html += `<div style="margin-top:6px">Активный job ${escapeHtml(active.id)}: ${escapeHtml(active.state)} «${escapeHtml(active.roleName)}» ${escapeHtml(active.repo || "repo не задан")}${active.agentUrl ? ` URL ${escapeHtml(active.agentUrl)}` : ""}.</div>`;
      const idle = provisionIdleReason();
      if (idle) html += `<div style="margin-top:8px;color:#ffd479">Шаг сейчас не пойдёт: ${escapeHtml(idle)}.</div>`;
      const history = (state.history || []).slice(-5).map((item) =>
        `${escapeHtml(item.at)} ${escapeHtml(item.reason || "")} jobs ${(item.jobs || []).length}`);
      if (history.length) html += `<div style="margin-top:10px;color:#aab4c3;font-size:12px">Завершено:<br>${history.join("<br>")}</div>`;
      const journal = state.journal.slice(-8).map((e) => `${escapeHtml(e.at)} ${escapeHtml(e.event)} ${escapeHtml(e.reason || e.step || "")}`).join("<br>");
      if (journal) html += `<div style="margin-top:10px;color:#aab4c3;font-size:12px">${journal}</div>`;
      body.innerHTML = html;
    } catch (error) {
      body.textContent = `Не удалось прочитать состояние: ${error.message || error}`;
    }
  }
