@echo off
setlocal

pushd "%~dp0"
call npm.cmd --prefix node-shell run gui
set "UPI_EXIT=%ERRORLEVEL%"
popd

exit /b %UPI_EXIT%
