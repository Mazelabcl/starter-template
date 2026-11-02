<#
.SYNOPSIS
  Instala el atajo "nuevo-proyecto" en tu PowerShell (se corre UNA sola vez).

.DESCRIPTION
  1. Copia scripts\nuevo-proyecto.ps1 a $HOME\.mazelab\nuevo-proyecto.ps1.
  2. Agrega la funcion "nuevo-proyecto" a tu perfil de PowerShell (lo crea si
     no existe). Es idempotente: el bloque va entre comentarios marcadores y,
     si ya estaba, se reemplaza en vez de duplicarse.
  3. Revisa la politica de ejecucion: si no permite cargar tu perfil, la deja
     en RemoteSigned solo para tu usuario (a menos que uses -NoCambiarPolitica).

  Por defecto instala en los perfiles de Windows PowerShell 5.1 y de
  PowerShell 7 (si usas cualquiera de los dos, el atajo funciona).
  Archivo ASCII a proposito (PowerShell 5.1 lee mal tildes sin BOM).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\instalar-atajo.ps1
#>
[CmdletBinding()]
param(
  # Perfil(es) donde se agrega la funcion. Por defecto, 5.1 y 7 del usuario.
  [string[]]$Perfil = @(),

  # Carpeta donde se copia el script.
  [string]$Destino = (Join-Path $HOME '.mazelab'),

  # No toca la politica de ejecucion (solo avisa).
  [switch]$NoCambiarPolitica
)

$ErrorActionPreference = 'Stop'

$inicio = '# >>> mazelab nuevo-proyecto >>> (lo administra instalar-atajo.ps1; no editar a mano)'
$fin = '# <<< mazelab nuevo-proyecto <<<'

$origen = Join-Path $PSScriptRoot 'nuevo-proyecto.ps1'
if (-not (Test-Path -LiteralPath $origen)) {
  Write-Host "ERROR: no encuentro $origen" -ForegroundColor Red
  exit 1
}

# --- 1. Copiar el script ---------------------------------------------------
New-Item -ItemType Directory -Path $Destino -Force | Out-Null
$script = Join-Path $Destino 'nuevo-proyecto.ps1'
Copy-Item -LiteralPath $origen -Destination $script -Force
Write-Host "[1/3] Script copiado a $script" -ForegroundColor Green

# --- 2. Funcion en el perfil -----------------------------------------------
if (-not $Perfil -or $Perfil.Count -eq 0) {
  $docs = [Environment]::GetFolderPath('MyDocuments')
  $Perfil = @(
    (Join-Path $docs 'WindowsPowerShell\Microsoft.PowerShell_profile.ps1'),
    (Join-Path $docs 'PowerShell\Microsoft.PowerShell_profile.ps1')
  )
}

$bloque = @(
  $inicio,
  'function nuevo-proyecto {',
  "  powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$script`" @args",
  '}',
  $fin
) -join "`r`n"

foreach ($p in $Perfil) {
  $dir = Split-Path -Parent $p
  if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  $actual = ''
  if (Test-Path -LiteralPath $p) { $actual = [IO.File]::ReadAllText($p) }
  $patron = '(?s)' + [regex]::Escape($inicio) + '.*?' + [regex]::Escape($fin)
  if ($actual -match $patron) {
    $nuevo = [regex]::Replace($actual, $patron, { param($m) $bloque })
    $accion = 'actualizado'
  } else {
    $sep = if ($actual.Length -gt 0 -and -not $actual.EndsWith("`n")) { "`r`n`r`n" } elseif ($actual.Length -gt 0) { "`r`n" } else { '' }
    $nuevo = $actual + $sep + $bloque + "`r`n"
    $accion = 'agregado'
  }
  # UTF-8 con BOM: lo lee bien tanto PowerShell 5.1 como 7.
  [IO.File]::WriteAllText($p, $nuevo, (New-Object System.Text.UTF8Encoding $true))
  Write-Host "[2/3] Atajo $accion en $p" -ForegroundColor Green
}

# --- 3. Politica de ejecucion ----------------------------------------------
# Se ignora el scope Process: este instalador corre con -ExecutionPolicy Bypass,
# pero las ventanas normales no. Lo que manda es el primer scope definido.
$pol = 'Restricted'
foreach ($s in @('MachinePolicy', 'UserPolicy', 'CurrentUser', 'LocalMachine')) {
  $v = [string](Get-ExecutionPolicy -Scope $s)
  if ($v -ne 'Undefined') { $pol = $v; break }
}
if ($pol -in @('Restricted', 'AllSigned')) {
  if ($NoCambiarPolitica) {
    Write-Host "[3/3] Tu politica de ejecucion es ${pol}: PowerShell no cargara el perfil. Para habilitarlo corre: Set-ExecutionPolicy -Scope CurrentUser RemoteSigned" -ForegroundColor Yellow
  } else {
    Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force
    Write-Host "[3/3] Politica de ejecucion de tu usuario: ${pol} -> RemoteSigned (permite cargar tu perfil y scripts locales)." -ForegroundColor Green
  }
} else {
  Write-Host "[3/3] Politica de ejecucion OK ($pol)." -ForegroundColor Green
}

Write-Host ''
Write-Host 'Listo. Abre una ventana NUEVA de PowerShell y escribe:  nuevo-proyecto mi-proyecto' -ForegroundColor Cyan
Write-Host '(o, en esta misma ventana, primero recarga el perfil con:  . $PROFILE)'
