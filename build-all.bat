@echo off
setlocal

rem Edit this path to match your Unreal Engine installation.
set "ENGINE_ROOT=C:\WORKSPACE_UE\UnrealEngine"

rem Use Debug, Development, or Shipping. Leave empty to build all configurations.
set "BUILD_CONFIGURATION="

pushd "%~dp0"

if "%ENGINE_ROOT%"=="" goto invalid_engine_root
if not exist "%ENGINE_ROOT%\Engine\Build\BatchFiles\Build.bat" goto invalid_engine_root

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

:invalid_engine_root
echo.
echo Engine root not found or invalid: %ENGINE_ROOT%
echo Expected Build.bat at: "%ENGINE_ROOT%\Engine\Build\BatchFiles\Build.bat"
popd
exit /b 1

:fail
set "UPI_EXIT=%ERRORLEVEL%"
echo.
echo Build failed with exit code %UPI_EXIT%.
popd
exit /b %UPI_EXIT%
