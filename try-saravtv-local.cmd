@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\windows\try-local-saravtv.ps1"
set "SARAVTV_TRY_EXIT=%ERRORLEVEL%"
if not "%SARAVTV_TRY_EXIT%"=="0" pause
exit /b %SARAVTV_TRY_EXIT%
