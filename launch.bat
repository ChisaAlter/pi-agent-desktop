@echo off
setlocal
set "ROOT=%~dp0"
cd /d "%ROOT%apps\desktop"
echo [Pi Agent] Building...
call pnpm run build >NUL 2>NUL
echo [Pi Agent] Starting...
start "" "%ROOT%apps\desktop\node_modules\.bin\electron.CMD" .
endlocal
