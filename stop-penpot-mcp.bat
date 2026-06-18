@echo off
setlocal
cd /d "%~dp0"
call npm run penpot:mcp:stop
set "EXIT_CODE=%ERRORLEVEL%"
echo.
pause
exit /b %EXIT_CODE%
