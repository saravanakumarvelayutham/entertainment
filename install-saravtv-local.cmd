@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\windows\install-local-saravtv.ps1"
set "SARAVTV_INSTALL_EXIT=%ERRORLEVEL%"
if not "%SARAVTV_INSTALL_EXIT%"=="0" pause
exit /b %SARAVTV_INSTALL_EXIT%
