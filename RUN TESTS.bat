@echo off
REM Double-click to run Package Doctor's automated tests.

setlocal
cd /d "%~dp0"
if not exist "%~dp0core\node_modules" ( pushd core & call npm ci & popd )
if not exist "%~dp0app\node_modules" ( pushd app & call npm ci & popd )

pushd core
call npm test
set CORE=%errorlevel%
call npx tsc --noEmit
popd
pushd app
call npm test
set APP=%errorlevel%
call npx tsc --noEmit
popd
set RUST=0
where cargo >nul 2>nul
if not errorlevel 1 (
  pushd app\src-tauri
  cargo test --release
  if errorlevel 1 set RUST=1
  popd
) else (
  echo Rust is not installed, so the accessibility check's own tests were not run.
)

echo.
if "%CORE%%APP%%RUST%"=="000" (echo All tests passed.) else (echo Some tests failed. Scroll up to see which.)
pause
