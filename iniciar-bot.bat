@echo off
rem Arranca el bot. Deja esta ventana abierta mientras quieras que el bot funcione; cerrarla lo apaga.
cd /d "%~dp0"
if not exist .env (
  echo Falta el archivo .env con el token del bot. Copia .env.example como .env y pon el token de @BotFather.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Instalando dependencias...
  call npm install
)
echo Bot arrancando. Cierra esta ventana para apagarlo.
node src\index.js
pause
