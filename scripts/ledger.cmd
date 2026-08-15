@echo off
where node >nul 2>nul
if errorlevel 1 (
  echo Error: Node.js 18 or later is required for the optional CLI. 1>&2
  exit /b 127
)
node "%~dp0ledger-cli.mjs" %*
