@echo off
setlocal

rem Edit this path to match your Unreal Engine installation.
set "ENGINE_ROOT=C:\WORKSPACE_UE\UnrealEngine"

rem Use Debug, Development, or Shipping. Leave empty to build all configurations.
set "BUILD_CONFIGURATION="

pushd "%~dp0"

if "%ENGINE_ROOT%"=="" goto invalid_engine_root
if not exist "%ENGINE_ROOT%\Engine\Build\BatchFiles\Build.bat" goto invalid_engine_root

echo.
echo ****** [1/5] Installing Node dependencies
call npm.cmd --prefix node-shell install
if errorlevel 1 goto fail

echo.
echo ****** [2/5] Ensuring FlatBuffers compiler
call npm.cmd run ensure-flatc
if errorlevel 1 goto fail

echo.
echo ****** [3/5] Generating protocol bindings
call npm.cmd run generate-protocol
if errorlevel 1 goto fail

echo.
echo ****** [4/5] Building native backend
if "%BUILD_CONFIGURATION%"=="" (
  call npm.cmd run build:native -- --engine-root "%ENGINE_ROOT%"
) else (
  call npm.cmd run build:native -- --engine-root "%ENGINE_ROOT%" --configuration "%BUILD_CONFIGURATION%"
)
if errorlevel 1 goto fail

echo.
echo ****** [5/5] Building renderer
call npm.cmd --prefix node-shell run build:renderer
if errorlevel 1 goto fail

echo.
echo Build completed.
pause
popd
exit /b 0

:invalid_engine_root
echo.
echo Engine root not found or invalid: %ENGINE_ROOT%
echo Expected Build.bat at: "%ENGINE_ROOT%\Engine\Build\BatchFiles\Build.bat"
pause
popd
exit /b 1

:fail
set "UPI_EXIT=%ERRORLEVEL%"
echo.
echo Build failed with exit code %UPI_EXIT%.
pause
popd
exit /b %UPI_EXIT%
