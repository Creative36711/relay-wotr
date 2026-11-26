/**
 * Мост Relay ↔ книга «Relay · WOTR — состояние транспорта».
 *
 * Что это. Один файл, который живёт ВНУТРИ таблицы и даёт транспорту читать и
 * писать её листы. Транспорт ходит к вам, вы — к таблице. Отдельного ключа
 * Google не нужно, доступа «добавьте робота в редакторы» тоже: скрипт уже
 * внутри книги и работает от имени владельца.
 *
 * Как установить (один раз, три минуты):
 *
 *   1. Откройте книгу → меню «Расширения» → «Apps Script».
 *      (Это НЕ проект «Gateway» из папки Arena: тот живёт отдельно и умеет
 *      только Drive — логи и файлы. Книгу он не читает. Здесь нужен скрипт,
 *      привязанный именно к таблице.)
 *   2. Удалите то, что там есть, вставьте этот файл целиком.
 *      Файл не нужно носить руками: если транспорт запущен, откройте
 *      http://localhost:8787/api/mount?format=html — та же страница с кнопкой
 *      «Скопировать» и адресом, куда его вставлять.
 *   3. В строке ниже замените ключ на свой — любая длинная случайная строка.
 *   4. «Развернуть» → «Новое развёртывание» → тип «Веб-приложение»,
 *      «Запуск от имени» — «Я», «У кого есть доступ» — «Все».
 *   5. Скопируйте адрес вида https://script.google.com/macros/s/…/exec
 *      и этот же ключ вставьте в файл запуска (или в переменные окружения).
 *
 * Ключ — не «ещё один токен ради галочки»: адрес веб-приложения открыт
 * интернету, и без него любой, кто узнал адрес, мог бы читать и писать книгу.
 */

var SECRET = 'ЗАМЕНИТЕ-ЭТУ-СТРОКУ-НА-СВОЙ-КЛЮЧ';

/** Единая точка ответа: формат всегда JSON, иначе транспорт не разберёт. */
function sendJson_(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function book_() {
  var book = SpreadsheetApp.getActiveSpreadsheet();
  if (!book) throw new Error('скрипт не привязан к книге: создайте его из меню «Расширения» в самой таблице');
  return book;
}

function sheet_(name) {
  var book = book_();
  var sheet = book.getSheetByName(name);
  if (!sheet) throw new Error('листа «' + name + '» нет в книге');
  return sheet;
}

/** Строки листа как строки — ровно то, что вернул бы Sheets API. */
function readValues_(name) {
  var values = sheet_(name).getDataRange().getValues();
  return values.map(function (row) {
    return row.map(function (cell) {
      if (cell instanceof Date) return cell.toISOString();
      return String(cell == null ? '' : cell);
    });
  });
}

function columnLetter_(index) {
  var letters = '';
  var n = Number(index) + 1;
  while (n > 0) {
    var rest = (n - 1) % 26;
    letters = String.fromCharCode(65 + rest) + letters;
    n = Math.floor((n - rest) / 26);
  }
  return letters;
}

function doPost(e) {
  var body = {};
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (error) {
    return sendJson_({ ok: false, why: 'тело запроса не JSON' });
  }
  if (String(body.key || '') !== String(SECRET)) {
    // Ответ не поясняет, какой именно ключ ждут: адрес веб-приложения
    // открыт, и подсказка здесь была бы подсказкой не тому человеку.
    return sendJson_({ ok: false, why: 'неверный ключ моста' });
  }
  try {
    switch (body.action) {
      case 'read': {
        var values = readValues_(body.sheet);
        return sendJson_({ ok: true, header: values[0] || [], rows: values.slice(1) });
      }
      case 'write': {
        var target = sheet_(body.sheet);
        var start = target.getRange(body.range || 'A1');
        var rows = body.values || [];
        if (!rows.length) return sendJson_({ ok: true, updated: 0 });
        target.getRange(start.getRow(), start.getColumn(), rows.length, Math.max.apply(null, rows.map(function (r) { return r.length; })))
          .setValues(rows.map(function (row) {
            var copy = row.slice();
            while (copy.length < Math.max.apply(null, rows.map(function (r) { return r.length; }))) copy.push('');
            return copy;
          }));
        return sendJson_({ ok: true, updated: rows.length });
      }
      case 'append': {
        var sheet = sheet_(body.sheet);
        (body.values || []).forEach(function (row) { sheet.appendRow(row); });
        return sendJson_({ ok: true, appended: (body.values || []).length });
      }
      case 'updateRange': {
        var into = sheet_(body.sheet);
        var rowsToWrite = body.values || [];
        if (!rowsToWrite.length) return sendJson_({ ok: true, updated: 0 });
        var width = Math.max.apply(null, rowsToWrite.map(function (r) { return r.length; }));
        var startColumn = String(body.startColumn || 'A');
        var firstColumn = startColumn.toUpperCase().charCodeAt(0) - 64;
        into.getRange(Number(body.startRow), firstColumn, rowsToWrite.length, width)
          .setValues(rowsToWrite.map(function (row) {
            var copy = row.slice();
            while (copy.length < width) copy.push('');
            return copy;
          }));
        return sendJson_({ ok: true, updated: rowsToWrite.length });
      }
      case 'meta': {
        var titles = book_().getSheets().map(function (item) { return item.getName(); });
        return sendJson_({ ok: true, titles: titles });
      }
      case 'ensureSheet': {
        var book = book_();
        var existing = book.getSheetByName(body.sheet);
        if (existing) return sendJson_({ ok: true, created: false, name: body.sheet });
        var created = book.insertSheet(body.sheet);
        if (body.columns && body.columns.length) {
          created.getRange(1, 1, 1, body.columns.length).setValues([body.columns]);
        }
        return sendJson_({ ok: true, created: true, name: body.sheet });
      }
      // Проход к api.notion.com мимо локальной сети. Служба на машине владельца
      // упирается в VPN или фильтр по домену (TCP есть, TLS рвётся), а отсюда,
      // из Google, запрос идёт по чистому каналу — так же, как раньше шёл из
      // браузера через ScriptCat. Токен приходит на каждый запрос и нигде не
      // хранится: мост, адрес и ключ — владельца. Путь ограничен /v1/, хост
      // зашит здесь же — произвольный адрес скрипт не отдаёт.
      case 'notion': {
        var notionPath = String(body.path || '');
        if (!/^\/v1\//.test(notionPath)) return sendJson_({ ok: false, why: 'путь должен начинаться с /v1/' });
        var notionToken = String(body.token || '');
        if (!notionToken) return sendJson_({ ok: false, why: 'нет токена Notion' });
        var notionMethod = String(body.method || 'GET').toUpperCase();
        if (['GET', 'POST', 'PATCH', 'DELETE'].indexOf(notionMethod) < 0) {
          return sendJson_({ ok: false, why: 'метод ' + notionMethod + ' не поддерживается' });
        }
        var notionOptions = {
          method: notionMethod,
          headers: {
            'Authorization': 'Bearer ' + notionToken,
            'Notion-Version': String(body.notionVersion || '2022-06-28')
          },
          // Свой ответ, а не страница входа: статус Notion доходит как есть.
          muteHttpExceptions: true,
          // Редирект настоящий Notion на /v1/ не отдаёт; свой — это подмена,
          // и она должна быть видна по коду, а не скрыта за следованием.
          followRedirects: false
        };
        var notionPayload = body.payload;
        if (notionPayload !== undefined && notionPayload !== null && notionPayload !== '') {
          notionOptions.headers['Content-Type'] = 'application/json';
          notionOptions.payload = typeof notionPayload === 'string' ? notionPayload : JSON.stringify(notionPayload);
        }
        var notionResponse = UrlFetchApp.fetch('https://api.notion.com' + notionPath, notionOptions);
        return sendJson_({
          ok: true,
          status: notionResponse.getResponseCode(),
          text: notionResponse.getContentText()
        });
      }
      default:
        return sendJson_({ ok: false, why: 'неизвестное действие «' + body.action + '»' });
    }
  } catch (error) {
    return sendJson_({ ok: false, why: String((error && error.message) || error) });
  }
}

/**
 * GET нужен только человеку: открыть адрес в браузере и убедиться, что мост
 * жив. Он не читает книгу и не выдаёт данных — иначе адрес стал бы способом
 * обойти ключ.
 */
function doGet() {
  return sendJson_({ ok: true, service: 'relay-bridge', hint: 'мост жив; транспорт ходит сюда POST-запросами с ключом' });
}
