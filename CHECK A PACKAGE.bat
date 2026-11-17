@echo off
REM Drag one or more course package .zip files onto this file to check them.
REM The report is shown here and also saved beside each package as <name>.report.txt. Nothing in the package changes.

setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install the LTS version from https://nodejs.org, then run this again.
  echo.
  pause
  exit /b 1
)
if not exist "%~dp0core\node_modules" (
  pushd core
  call npm ci
  popd
)
if "%~1"=="" (
  echo Drag a course package .zip onto this file to check it.
  echo.
  pause
  exit /b 0
)

:next
if "%~1"=="" goto :done
node core\src\cli.ts "%~1" > "%~dpn1.report.txt"
type "%~dpn1.report.txt"
echo Saved as "%~dpn1.report.txt"
echo.
shift
goto :next

:done
pause
