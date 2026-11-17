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

echo.
if "%CORE%%APP%"=="00" (echo All tests passed.) else (echo Some tests failed. Scroll up to see which.)
pause
