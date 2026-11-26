// Страница установки моста: код, куда его вставлять, и два поля ввода.
//
// Зачем в продукте. «Скопируйте файл relay/apps-script/Code.gs» — это
// инструкция для того, у кого есть файлы под рукой. Владелец открывает книгу в
// браузере, и лишний шаг «найдите файл в репозитории» ничего не даёт: тот же
// текст можно отдать прямо со службы, одной кнопкой.
//
// Второе назначение — приём адреса и ключа. Раньше они писались в файл
// `relay/bridge.txt` руками, и это самый неочевидный шаг: формат `адрес=ключ`,
// какое расширение, где лежит. Теперь достаточно вставить два значения в поля
// на этой странице: служба сама запишет `bridge.txt` рядом с собой и
// перечитает настройки без перезапуска.
//
// Их можно вставить и в окно запуска (Запустить транспорт.bat) — оно спросит
// то же самое. Это для тех, кто ещё не открывал пульт.
//
// Страница не хранит секретов: код одинаков для всех, ключ владелец вписывает
// в него сам. Поэтому она доступна без пароля — как и пульт.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Где лежит Code.gs относительно этого файла: relay/src → relay/apps-script. */
const CODE_URL = new URL("../apps-script/Code.gs", import.meta.url);

export function bridgeCode() {
  return readFileSync(CODE_URL, "utf8");
}

const escape = (text) =>
  String(text ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

/**
 * HTML страницы установки.
 *
 * `existing` — уже настроенный адрес моста, если он есть: тогда страница не
 * предлагает ставить заново, а проверяет и говорит, что происходит.
 */
export function mountPage({ existing = "", version = "", file = "", canSave = false } = {}) {
  const code = bridgeCode();
  const configured = Boolean(existing);
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Relay — вход в книгу</title>
<style>
  body{margin:0;padding:24px;background:#12151b;color:#e7eaee;font:14px/1.55 system-ui,Segoe UI,Arial,sans-serif}
  h1{font-size:20px;margin:0 0 6px} h2{font-size:15px;margin:22px 0 6px}
  .muted{color:#9aa6b8} .card{background:#191d25;border:1px solid #2b3140;border-radius:10px;padding:16px;margin:12px 0}
  ol{padding-left:22px;margin:8px 0} li{margin:6px 0}
  code{background:#0e1116;border:1px solid #2b3140;border-radius:4px;padding:1px 5px;font-family:ui-monospace,Consolas,monospace}
  textarea{width:100%;height:220px;background:#0e1116;color:#cdd6e4;border:1px solid #2b3140;border-radius:8px;
    padding:10px;font:12px/1.45 ui-monospace,Consolas,monospace;resize:vertical}
  button{background:#285638;border:1px solid #438a5b;color:#fff;border-radius:8px;padding:8px 14px;font:inherit;cursor:pointer}
  button.ghost{background:#242833;border-color:#3a4150}
  .ok{color:#a6e3b5} .warn{color:#ffd479} .bad{color:#ffb4ad}
  a{color:#8fb7e8}
</style></head><body>
<h1>Вход в книгу · версия ${escape(version)}</h1>
<p class="muted">Транспорт живёт на вашем компьютере, книга — в Google. Между ними нужен один мост:
  маленький скрипт внутри книги. Он ставится один раз, ключ Google для него не нужен.</p>

<div class="card">
  ${configured
    ? `<strong>Мост уже настроен:</strong> <code>${escape(existing)}</code>
       <p class="muted" id="probe-line">Проверяю связь…</p>`
    : `<strong class="warn">Мост ещё не настроен.</strong>
       <p class="muted">Служба запущена в демо-режиме: пульт работает, но ничего не помнит.</p>`}
</div>

<h2>Вставьте адрес и ключ</h2>
<div class="card">
  ${canSave ? `
  <p class="muted">Развернули мост — Google показал две вещи: <b>адрес веб-приложения</b> (оканчивается на
    <code>/exec</code>) и <b>идентификатор развёртывания</b>. Вставьте адрес в первое поле и тот же ключ,
    который вписали в <code>Code.gs</code>, — во второе. Нажмите кнопку: служба сама запишет настройку
    и сразу проверит связь. Перезапускать ничего не нужно.</p>
  <p><label for="url">Адрес веб-приложения</label><br />
     <input id="url" type="url" spellcheck="false" autocomplete="off"
            placeholder="https://script.google.com/macros/s/…/exec" value="${escape(existing)}" /></p>
  <p><label for="key">Ключ моста (тот, что внутри Code.gs)</label><br />
     <input id="key" type="password" spellcheck="false" autocomplete="off"
            placeholder="40 символов" /></p>
  <p><button id="save">Сохранить и проверить</button>
     <span id="save-note" class="muted"></span></p>
  <p class="muted">Идентификатор развёртывания в поля не нужен: он служит для обновления развёртывания,
     а не для доступа. Адрес уже содержит его внутри.</p>`
  : `<p class="warn">Записать настройку служба не может: папка только для чтения.
       Тогда допишите вручную в <code>${escape(file || "relay/bridge.txt")}</code> строкой <code>адрес=ключ</code>
       и перезапустите <code>Запустить транспорт.bat</code>.</p>`}
</div>

<h2>Куда вставлять код — и куда НЕ вставлять</h2>
<div class="card">
  <p><span class="bad">Не сюда:</span> проект <b>Gateway</b> из папки Arena. Он живёт отдельно,
     умеет только файлы (логи, payloads) и книгу не читает. Если вставить мост туда,
     он не увидит ни одного листа.</p>
  <p><span class="ok">Сюда:</span> сама таблица → меню <b>Расширения</b> → <b>Apps Script</b>.
     Это создаёт скрипт, привязанный к книге, и он получает доступ к её листам.</p>
</div>

<h2>Порядок</h2>
<div class="card">
  <ol>
    <li>Откройте <a href="https://docs.google.com/spreadsheets/d/1_MohMfnUvl40CT689gfch_MgPtzqokSw5Bylbl89PFQ/edit" target="_blank" rel="noopener">книгу «Relay · WOTR»</a>.</li>
    <li><b>Расширения → Apps Script</b>. Откроется редактор с файлом <code>Код.gs</code>.</li>
    <li>Удалите всё, что там есть, и вставьте код ниже (кнопка «Скопировать»).</li>
    <li>В первой строке замените <code>ЗАМЕНИТЕ-ЭТУ-СТРОКУ-НА-СВОЙ-КЛЮЧ</code> на свою длинную случайную строку.
        Это пароль моста — придумайте его сами, никому не показывайте.</li>
    <li><b>Развернуть → Новое развёртывание → тип «Веб-приложение»</b>.
        «Запуск от имени» — <b>Я</b>, «У кого есть доступ» — <b>Все</b>.
        Скопируйте адрес вида <code>https://script.google.com/macros/s/…/exec</code>.</li>
    <li>Вернитесь на эту страницу и вставьте адрес и ключ в поля выше — служба сохранит их сама.
        Запускать батник заново не нужно.</li>
  </ol>
  <p class="muted">Почему «Все», а не «Только я»: с «Только я» транспорт получил бы страницу входа
     вместо данных. Замок — это ключ внутри скрипта; без него мост ничего не отдаёт.</p>
</div>

<h2>Код моста</h2>
<div class="card">
  <textarea id="code" readonly spellcheck="false">${escape(code)}</textarea>
  <p><button id="copy">Скопировать код</button>
     <button class="ghost" id="check">Проверить связь с мостом</button>
     <span id="note" class="muted"></span></p>
</div>

<script>
  const note = document.getElementById("note");
  const say = (text, cls = "muted") => { note.className = cls; note.textContent = text; };
  document.getElementById("copy").onclick = async () => {
    const area = document.getElementById("code");
    try {
      await navigator.clipboard.writeText(area.value);
      say("Скопировано. Вставьте в редакторе Apps Script вместо всего содержимого.", "ok");
    } catch {
      area.select();
      document.execCommand && document.execCommand("copy");
      say("Выделено — нажмите Ctrl+C, если копирование не сработало.", "warn");
    }
  };
  // Кнопка сохранения есть только там, где файл вообще можно записать
  // (см. canSave выше): без неё поля вели бы в никуда.
  const saveButton = document.getElementById("save");
  if (saveButton) saveButton.onclick = async () => {
    const url = document.getElementById("url").value.trim();
    const key = document.getElementById("key").value.trim();
    const out = document.getElementById("save-note");
    const say = (text, cls = "muted") => { out.className = cls; out.textContent = text; };
    if (!/^https:\\/\\/[^\\s]+\\/exec\\/?$/.test(url)) {
      say("Адрес должен начинаться с https:// и оканчиваться на /exec — скопируйте его из окна развёртывания целиком.", "bad");
      return;
    }
    if (key.length < 20) { say("Ключ короче 20 символов: проверьте, что вставили его целиком.", "bad"); return; }
    say("Сохраняю…");
    const response = await fetch("/api/bridge-config", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url, key }),
    });
    const data = await response.json();
    if (!data.ok) {
      say(data.why || "Не получилось сохранить.", "bad");
      return;
    }
    say(data.why, "ok");
  };

  document.getElementById("check").onclick = async () => {
    say("Проверяю…");
    try {
      const response = await fetch("/api/bridge-probe", { cache: "no-store" });
      const data = await response.json();
      say(data.why || (data.ok ? "Мост отвечает." : "Мост не отвечает."), data.ok ? "ok" : "bad");
    } catch (error) {
      say("Служба не ответила: " + error.message, "bad");
    }
  };
  ${configured ? `
  fetch("/api/bridge-probe", { cache: "no-store" }).then((r) => r.json()).then((data) => {
    const line = document.getElementById("probe-line");
    if (!line) return;
    line.className = data.ok ? "ok" : "bad";
    line.textContent = data.why || (data.ok ? "Мост отвечает." : "Мост не отвечает.");
  }).catch(() => {});` : ""}
</script>
</body></html>`;
}
