@echo off
setlocal

rem Edit this path to match your Unreal Engine installation.
set "ENGINE_ROOT=C:\Program Files\Epic Games\UE_5.7"

rem Use Debug, Development, or Shipping. Leave empty to build all configurations.
set "BUILD_CONFIGURATION=Development"

pushd "%~dp0"

call npm.cmd --prefix node-shell install
if errorlevel 1 goto fail

call npm.cmd --prefix node-shell run generate-protocol
if errorlevel 1 goto fail

if "%BUILD_CONFIGURATION%"=="" (
  call npm.cmd run build:native -- --engine-root "%ENGINE_ROOT%"
) else (
  call npm.cmd run build:native -- --engine-root "%ENGINE_ROOT%" --configuration "%BUILD_CONFIGURATION%"
)
if errorlevel 1 goto fail

call npm.cmd --prefix node-shell run build:renderer
if errorlevel 1 goto fail

echo.
echo Build completed.
popd
exit /b 0

:fail
set "UPI_EXIT=%ERRORLEVEL%"
echo.
echo Build failed with exit code %UPI_EXIT%.
popd
exit /b %UPI_EXIT%
