# Guarda el token de @BotFather en .env sin mostrarlo en pantalla.
# Uso: clic derecho -> "Ejecutar con PowerShell", o lo abre Claude.
$ErrorActionPreference = "Stop"
$envPath = Join-Path $PSScriptRoot ".env"
if (-not (Test-Path $envPath)) { Copy-Item (Join-Path $PSScriptRoot ".env.example") $envPath }

Write-Host ""
Write-Host "Pega aqui el token que te dio @BotFather y pulsa Enter." -ForegroundColor Yellow
Write-Host "(Con clic derecho se pega. No veras nada al pegarlo: es normal, se oculta a proposito.)" -ForegroundColor Yellow
$secure = Read-Host -AsSecureString "Token"
$token = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)).Trim()

if ($token -notmatch '^\d+:[A-Za-z0-9_-]{30,}$') {
  Write-Host ""
  Write-Host "Eso no parece un token de Telegram (deberia ser numeros, dos puntos y una clave larga, por ejemplo 123456789:AAH...)." -ForegroundColor Red
  Write-Host "No se ha guardado nada. Vuelve a intentarlo." -ForegroundColor Red
  Read-Host "Pulsa Enter para cerrar"
  exit 1
}

$lines = Get-Content $envPath -Encoding UTF8
$found = $false
$lines = $lines | ForEach-Object { if ($_ -match '^\s*TELEGRAM_BOT_TOKEN\s*=') { $found = $true; "TELEGRAM_BOT_TOKEN=$token" } else { $_ } }
if (-not $found) { $lines += "TELEGRAM_BOT_TOKEN=$token" }
[IO.File]::WriteAllLines($envPath, $lines, (New-Object Text.UTF8Encoding $false))

Write-Host ""
Write-Host "Token guardado en .env. Ya puedes cerrar esta ventana y abrir iniciar-bot.bat" -ForegroundColor Green
Read-Host "Pulsa Enter para cerrar"
