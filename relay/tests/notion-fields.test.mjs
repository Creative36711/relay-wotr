// Какие поля Notion читает и пишет каждый слой.
//
// Зачем этот тест вообще существует. Живая база накопила поля, которых никто не
// касается: они выглядят рабочими, человек их заполняет, и ничего не происходит.
// Разбор «на глаз» уже один раз ошибся — `Agent State` читают четыре модуля и
// provisioning-UI, а `Agent Job ID` и `Agent Created At` не пишет никто.
//
// Здесь зафиксировано ровно то, что подтверждено кодом, чтобы следующая чистка
// схемы не выкинула живое поле и не оставила мёртвое.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../..", import.meta.url).pathname;
const srcFiles = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return srcFiles(full);
    return /\.(js|mjs)$/.test(name) ? [full] : [];
  }).filter((file) => !file.includes("/tests/") && !file.includes("/regression-tests/"));

const TAB = srcFiles(join(ROOT, "tools/script-cat/src")).map((file) => readFileSync(file, "utf8")).join("\n");
const SERVICE = srcFiles(join(ROOT, "relay/src")).map((file) => readFileSync(file, "utf8")).join("\n");

const mentions = (text, field) => text.includes(`"${field}"`) || text.includes(`'${field}'`);

/** Живые поля «Ролей»: те, которые читает вкладка или служба. */
const LIVE_ROLE_FIELDS = [
  "Роль", "Функция", "Статус", "Agent URL", "Зона записи", "Гейт", "Репозиторий",
  "Agent Admin", "Agent State", "Previous Agent URL", "Аккаунт", "Доступность",
  "Agent Job ID", "Agent Created At",
];

/** Поля не для кода, а для людей: код их не читает, и это нормально. */
const HUMAN_ROLE_FIELDS = ["Устав"];

/**
 * Поля, которые пишет provisioning. Проверять их «на заполняемость руками»
 * бессмысленно: значение ставится само, а ручная правка будет перезаписана.
 */
const PROVISIONED_ROLE_FIELDS = ["Agent Job ID", "Agent Created At", "Agent State"];

test("живые поля «Ролей» действительно читаются кодом вкладки", () => {
  for (const field of LIVE_ROLE_FIELDS) {
    assert.ok(mentions(TAB, field), `поле «${field}» никто не читает — его место в списке мёртвых`);
  }
});

test("поле «Устав» остаётся для людей и не выдаёт себя за работающее", () => {
  for (const field of HUMAN_ROLE_FIELDS) {
    assert.ok(!mentions(TAB, field), `«${field}» вдруг начало читаться кодом — обновите список`);
  }
});

// Первый заход в этот аудит заключил, что `Agent Job ID` и `Agent Created At`
// никто не пишет: grep искал `props["…"] =`, а поля лежат в литерале объекта
// свойств целиком. Тест ловит именно такую ошибку: пишет ли код поле хоть как-то.
test("поля provisioning действительно пишутся, а не только читаются", () => {
  for (const field of PROVISIONED_ROLE_FIELDS) {
    assert.ok(mentions(TAB, field), `«${field}» должно читаться, иначе его пора удалять`);
    const written = new RegExp(`["']${field}["']\\s*:`).test(TAB);
    assert.ok(written, `«${field}» перестало записываться — тогда оно мёртвое, а не живое`);
  }
});

test("«Проверка» в «Запросах» не используется ни одним слоем", () => {
  assert.ok(!mentions(TAB, "Проверка"), "поле снова читается вкладкой — верните его в шаблон");
  assert.ok(!mentions(SERVICE, "Проверка"), "поле снова читается службой");
});

test("схема «Запросов» в шаблоне не знает мёртвого поля", () => {
  const template = JSON.parse(readFileSync(join(ROOT, "tools/script-cat/NOTION-TEMPLATE.json"), "utf8"));
  const props = template.databases.requests.properties;
  assert.equal(props["Проверка"], undefined, "мёртвое поле вернулось в шаблон");
  assert.ok(props.Check, "«Check» — живое поле, оно остаётся");
  assert.ok(props["Dispatch State"], "«Dispatch State» — живое поле, оно остаётся");
});
