@echo off
REM Double-click to open OpenStage Package Doctor.
REM The first run builds it, which takes a few minutes. After that it opens at once.

setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install the LTS version from https://nodejs.org, then run this again.
  echo.
  pause
  exit /b 1
)

set "EXE=%~dp0app\src-tauri\target\release\openstage-package-doctor.exe"

REM A program built before its files last changed is out of date, so it is built again.
if exist "%EXE%" (
  powershell -NoProfile -Command "$e=(Get-Item -LiteralPath $env:EXE).LastWriteTime; $n=(Get-ChildItem core\src,app\src,app\web\index.html,app\src-tauri\src,app\src-tauri\tauri.conf.json -Recurse -File | Measure-Object -Property LastWriteTime -Maximum).Maximum; if ($n -gt $e) { exit 1 }"
  if not errorlevel 1 goto :run
  echo Package Doctor has changed since it was last built, so it is being built again. This takes a minute or two.
  echo.
)

where cargo >nul 2>nul
if errorlevel 1 (
  echo Rust was not found. Install it from https://rustup.rs, restart this window, then run this again.
  echo.
  pause
  exit /b 1
)
if not exist "%~dp0core\node_modules" (
  pushd core
  call npm ci
  popd
)
if not exist "%~dp0app\node_modules" (
  pushd app
  call npm ci
  popd
)
pushd app
call npx tauri build --no-bundle
popd
if not exist "%EXE%" (
  echo.
  echo The build failed. Scroll up to see why.
  pause
  exit /b 1
)

:run
start "" "%EXE%"
exit /b 0
