@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
title Relay — транспорт
cd /d "%~dp0"

set "BOOK_ID=1_MohMfnUvl40CT689gfch_MgPtzqokSw5Bylbl89PFQ"
set "PORT=8787"

rem ─── Ключ сервисного аккаунта ────────────────────────────────────────────
rem Ищем сам, в порядке вероятности. Путь не надо вписывать руками: файл
rem кладут рядом с папкой relay (по README это ../sa.json) или внутрь неё.
set "SA_FILE="
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
if defined SA_FILE (
  set "RELAY_GOOGLE_SA_FILE=%SA_FILE%"
  echo Ключ доступа: %SA_FILE%
) else (
  echo [!] Файл ключа сервисного аккаунта не найден.
  echo     Искал: ..\sa.json, sa.json рядом с этим файлом
  echo            и любой *.json с "client_email" в этих же папках.
  echo.
  echo     Что делать: положите ключ как ..\sa.json
  echo     ^(подробно — relay\README.md, шаг 3^).
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
node src\index.mjs

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
