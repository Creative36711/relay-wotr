@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
title Relay — транспорт
cd /d "%~dp0"

set "BOOK_ID=1_MohMfnUvl40CT689gfch_MgPtzqokSw5Bylbl89PFQ"
set "PORT=8787"

rem ─── Мост в книге (Apps Script) ──────────────────────────────────────────
rem Самый короткий вход: адрес веб-приложения и ключ, оба владелец получает
rem в книге. Файл bridge.txt рядом с этим файлом — две строки: адрес, ключ.
rem Есть мост — ключ Google не нужен вообще, поэтому поиск ключа пропускаем.
set "BRIDGE_URL="
set "BRIDGE_KEY="
set "BRIDGE_FILE="
for %%F in ("%~dp0bridge.txt" "%~dp0..\bridge.txt") do (
  if exist "%%~fF" if not defined BRIDGE_FILE set "BRIDGE_FILE=%%~fF"
)
if defined BRIDGE_FILE (
  rem Первая строка — адрес или «адрес=ключ», вторая — ключ. Разбор ниже
  rem принимает обе формы и любой порядок, но не ищет позицию «=» через
  rem findstr: на URL с двоеточиями это теряло адрес (см. примечание ниже).
  set "LINE="
  set "TAIL="
  for /f "usebackq delims=" %%L in ("%BRIDGE_FILE%") do (
    if not defined LINE (
      set "LINE=%%L"
    ) else if not defined TAIL (
      set "TAIL=%%L"
    )
  )
  rem Форма «адрес=ключ» одной строкой: делим по первому «=» через tokens=1,*.
  rem Старый путь (findstr /n, позиция, вычитание) терял адрес на URL с
  rem двоеточиями: findstr /n даёт номер строки, а не позицию «=», и хвост
  rem https:// оставался последним токеном. Адрес получался пустым, и
  rem владелец вводил ключи при каждом запуске при уже лежащем bridge.txt.
  set "PART_A="
  set "PART_B="
  for /f "tokens=1,* delims==" %%A in ("!LINE!") do (
    set "PART_A=%%A"
    set "PART_B=%%B"
  )
  set "HAS_EQ="
  if not "!LINE:=!"=="!LINE!" set "HAS_EQ=1"
  if defined HAS_EQ if defined PART_B (
    if not "!PART_A:~0,4!"=="http" (
      rem Порядок перепутан: «ключ=адрес».
      set "BRIDGE_KEY=!PART_A!"
      set "BRIDGE_URL=!PART_B!"
    ) else (
      set "BRIDGE_URL=!PART_A!"
      set "BRIDGE_KEY=!PART_B!"
    )
  )
  if not defined BRIDGE_URL (
    rem Разделителя нет: две строки подряд — сначала адрес, потом ключ.
    if not "!LINE:~0,4!"=="http" (
      set "BRIDGE_KEY=!LINE!"
      set "BRIDGE_URL=!TAIL!"
    ) else (
      set "BRIDGE_URL=!LINE!"
      set "BRIDGE_KEY=!TAIL!"
    )
  )
  for %%V in ("!BRIDGE_URL!") do set "BRIDGE_URL=%%~V"
  for %%V in ("!BRIDGE_KEY!") do set "BRIDGE_KEY=%%~V"
)
if not defined BRIDGE_URL if defined RELAY_BRIDGE_URL set "BRIDGE_URL=%RELAY_BRIDGE_URL%"
if not defined BRIDGE_KEY if defined RELAY_BRIDGE_KEY set "BRIDGE_KEY=%RELAY_BRIDGE_KEY%"

rem ─── Если моста ещё нет — спросим адрес и ключ здесь же ──────────────────
rem Владелец просил вставлять адрес «при запуске приложения», а не писать
rem файл руками: формат, расширение и место — лишние знания, которых быть не
rem должно. Спрашиваем только когда моста нет; адрес и ключ из прошлого раза
rem (bridge.txt) вопросов не вызывают.
if not defined BRIDGE_URL (
  echo.
  echo Книга ещё не подключена. Можно вставить адрес и ключ прямо сейчас,
  echo или нажать Enter и сделать это позже на странице http://localhost:%PORT%/api/mount
  echo.
  echo   Адрес веб-приложения — тот, что оканчивается на /exec.
  echo   Ключ — тот, что вы заменили в Code.gs. Это два разных текста.
  echo.
  set /p "BRIDGE_URL=Адрес веб-приложения (Enter — пропустить): "
  if defined BRIDGE_URL set /p "BRIDGE_KEY=Ключ моста: "
  if defined BRIDGE_URL if not defined BRIDGE_KEY set "BRIDGE_URL="
  if defined BRIDGE_URL (
    echo !BRIDGE_URL!| findstr /i /c:"/exec" >nul || (
      echo [!] Адрес должен оканчиваться на /exec — это адрес веб-приложения,
      echo     а не идентификатор развёртывания. Пока запускаю демо-режим.
      set "BRIDGE_URL="
      set "BRIDGE_KEY="
    )
  )
  if defined BRIDGE_URL (
    > "%~dp0bridge.txt" echo(!BRIDGE_URL!=!BRIDGE_KEY!
    echo Сохранил в bridge.txt — при следующем запуске спрашивать не буду.
  )
)
if defined BRIDGE_FILE if defined BRIDGE_URL echo Адрес и ключ взяты из bridge.txt — вводить снова не нужно.

rem ─── Ключ сервисного аккаунта ────────────────────────────────────────────
rem Ищем сам, в порядке вероятности. Путь не надо вписывать руками: файл
rem кладут рядом с папкой relay (по README это ../sa.json) или внутрь неё.
set "SA_FILE="
if not defined BRIDGE_URL (
  for %%F in ("%~dp0..\sa.json" "%~dp0sa.json" "%~dp0..\relay-sa.json" "%~dp0relay-sa.json") do (
    if exist "%%~fF" if not defined SA_FILE set "SA_FILE=%%~fF"
  )
  if not defined SA_FILE (
    for %%F in ("%~dp0..\*.json" "%~dp0*.json") do (
      if not defined SA_FILE (
        findstr /m /c:"client_email" "%%~fF" >nul 2>&1 && set "SA_FILE=%%~fF"
      )
    )
  )
)

rem ─── Служебные переменные текущего окна — убираем ────────────────────────
rem Иначе setlocal унаследует чужую книгу или включённый демо-режим из
rem прошлой попытки, и «почему не та книга» будет искать не там.
set "RELAY_DEMO="
set "RELAY_GOOGLE_SA_JSON="

echo ============================================================
echo  Relay — транспорт
echo  Папка: %~dp0
echo ============================================================
echo.

rem ─── Node.js ─────────────────────────────────────────────────────────────
where node >nul 2>&1
if errorlevel 1 (
  echo [!] Node.js не найден.
  echo.
  echo     Скачайте LTS-версию: https://nodejs.org/ru
  echo     При установке оставьте галочку "Add to PATH".
  echo     Потом закройте это окно и запустите файл заново.
  echo.
  pause
  exit /b 1
)
for /f "delims=" %%V in ('node -v 2^>nul') do set "NODE_VERSION=%%V"
echo Node.js: !NODE_VERSION!

rem ─── Книга и ключ ────────────────────────────────────────────────────────
set "RELAY_SPREADSHEET_ID=%BOOK_ID%"
if defined BRIDGE_URL (
  set "RELAY_BRIDGE_URL=%BRIDGE_URL%"
  set "RELAY_BRIDGE_KEY=%BRIDGE_KEY%"
  echo Вход в книгу: мост Apps Script ^(ключ Google не нужен^)
  echo Адрес моста: %BRIDGE_URL%
) else if defined SA_FILE (
  set "RELAY_GOOGLE_SA_FILE=%SA_FILE%"
  echo Ключ доступа: %SA_FILE%
) else (
  echo [!] Вход в книгу не настроен: ни моста, ни ключа.
  echo     Искал: ..\sa.json, sa.json рядом с этим файлом
  echo            и любой *.json с "client_email" в этих же папках.
  echo.
  echo     Самый короткий путь — мост в книге, без ключа Google:
  echo       1. В книге: Расширения - Apps Script
  echo       2. Вставьте файл relay\apps-script\Code.gs, замените ключ
  echo       3. Развернуть - Веб-приложение - доступ "Все"
  echo       4. Вставьте адрес и ключ в поля выше при следующем запуске
  echo     Иначе — положите ключ сервисного аккаунта как ..\sa.json
  echo     ^(подробно — relay\README.md^).
  echo.
  echo     Пока запускаю демо-режим: пульт откроется,
  echo     но книга НЕ подключена и данные не сохранятся.
  echo.
  set "RELAY_DEMO=1"
)
echo Книга: %RELAY_SPREADSHEET_ID%
echo Порт:  %PORT%
echo.

rem ─── Проверка, что зависимости на месте ─────────────────────────────────
if not exist "src\index.mjs" (
  echo [!] Не найден src\index.mjs — этот файл должен лежать в папке relay.
  echo     Похоже, его скопировали в другое место.
  pause
  exit /b 1
)

rem ─── Запуск ──────────────────────────────────────────────────────────────
echo Запускаю транспорт. Это окно закрывать нельзя —
echo закроете, и транспорт остановится.
echo Браузер откроется сам: http://localhost:%PORT%
echo.
start "" /min cmd /c "timeout /t 2 >nul & start "" http://localhost:%PORT%"
rem ─── Прокси: ничего не спрашиваем ───────────────────────────────────────
rem Вопрос «какой у вас прокси» снят: у владельца его нет (VPN работает
rem клиентом на весь трафик), а пустое поле только путает. Но если прокси
rem задан снаружи — в переменной окружения — Node 22 применит его лишь с
rem флагом --use-env-proxy. Флаг ставим сами, молча: ровно один случай, когда
rem он нужен, и никакой настройки в окне.
set "NODE_EXTRA_FLAGS="
if defined HTTPS_PROXY set "NODE_EXTRA_FLAGS=--use-env-proxy"
if defined HTTP_PROXY if not defined HTTPS_PROXY set "NODE_EXTRA_FLAGS=--use-env-proxy"
node %NODE_EXTRA_FLAGS% src\index.mjs

rem ─── Если транспорт упал ─────────────────────────────────────────────────
echo.
echo ============================================================
echo  Транспорт остановился.
echo ============================================================
echo Если выше была ошибка — прочитайте её: чаще всего это
echo закрытый доступ к книге (нужно добавить client_email
echo из ключа в "Настройки доступа" книги с ролью Редактор).
echo.
pause
endlocal
