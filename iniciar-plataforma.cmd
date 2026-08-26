@echo off
title Plataforma Lilian Arruda
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-platform.ps1"
if errorlevel 1 (
  echo.
  echo Nao foi possivel iniciar a plataforma. Consulte os logs informados acima.
  pause
)
