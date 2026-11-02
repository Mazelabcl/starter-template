<#
.SYNOPSIS
  Crea un proyecto nuevo desde el starter Mazelab (rama v6) con un solo comando.

.DESCRIPTION
  1. Valida el nombre (sin espacios ni tildes) y que la carpeta no exista.
  2. Clona el starter desde GitHub (si falla, usa la copia local del repo).
  3. Quita el remote "origin" (el proyecto nuevo no apunta al starter).
  4. Copia tu .env con las claves API, si existe (nunca muestra su contenido).
  5. Instala dependencias (npm install).
  6. Abre Claude Code con /kickoff.

  Nota: el archivo es ASCII a proposito (Windows PowerShell 5.1 lee mal las
  tildes en archivos sin BOM). Idioma: espanol neutro.

.EXAMPLE
  nuevo-proyecto mi-cafeteria
  (con el atajo instalado por scripts/instalar-atajo.ps1)

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\nuevo-proyecto.ps1 mi-cafeteria
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$Nombre,

  # Carpeta donde se crea el proyecto.
  [string]$Carpeta = (Join-Path $HOME '.gemini\antigravity\scratch'),

  # Rama del starter que se clona.
  [string]$Rama = 'v6',

  # Repo en GitHub (primer intento).
  [string]$Repo = 'https://github.com/Mazelabcl/starter-template.git',

  # Copia local del starter: respaldo si GitHub falla.
  [string]$Respaldo = (Join-Path $HOME '.gemini\antigravity\scratch\Starter-template\repo'),

  # Si se indica, clona SOLO desde esta ruta (o URL) y no intenta GitHub.
  [string]$Origen = '',

  # .env con tus claves API que se copia al proyecto nuevo.
  [string]$EnvOrigen = (Join-Path $HOME '.gemini\antigravity\scratch\Starter-template\.env'),

  # No abre Claude Code al final (para pruebas).
  [switch]$SinClaude
)

# 'Continue' a proposito: en PowerShell 5.1, con 'Stop', cualquier linea que git
# o npm escriban en stderr (progreso, avisos) se vuelve una excepcion. Los
# errores se revisan con $LASTEXITCODE y los cmdlets usan -ErrorAction Stop.
$ErrorActionPreference = 'Continue'

function Paso($n, $texto) { Write-Host "[$n/6] $texto" -ForegroundColor Cyan }
function Falla($texto) {
  Write-Host "ERROR: $texto" -ForegroundColor Red
  exit 1
}
function Tiene($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }

# --- 1. Validaciones -------------------------------------------------------
Paso 1 "Validando el nombre '$Nombre'..."
if ($Nombre -cnotmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$') {
  Falla "El nombre solo puede tener letras sin tilde, numeros, guion (-), guion bajo (_) o punto, sin espacios. Ejemplo: mi-cafeteria"
}
if (-not (Tiene 'git')) { Falla 'No encuentro git. Instalalo desde https://git-scm.com y vuelve a intentar.' }
if (-not (Tiene 'node')) { Falla 'No encuentro Node.js. Instalalo desde https://nodejs.org y vuelve a intentar.' }

if (-not (Test-Path -LiteralPath $Carpeta)) {
  New-Item -ItemType Directory -Path $Carpeta -Force -ErrorAction Stop | Out-Null
}
$Carpeta = (Resolve-Path -LiteralPath $Carpeta).Path
$destino = Join-Path $Carpeta $Nombre
if (Test-Path -LiteralPath $destino) {
  Falla "Ya existe la carpeta $destino. Elige otro nombre."
}

# --- 2. Clonar ---------------------------------------------------------------
function Clonar($fuente) {
  Write-Host "      git clone -b $Rama $fuente $Nombre"
  & git clone --quiet -b $Rama $fuente $destino
  $ok = ($LASTEXITCODE -eq 0) -and (Test-Path -LiteralPath (Join-Path $destino 'package.json'))
  if (-not $ok -and (Test-Path -LiteralPath $destino)) {
    Remove-Item -LiteralPath $destino -Recurse -Force -ErrorAction SilentlyContinue
  }
  return $ok
}

Paso 2 'Clonando el starter...'
$fuentes = if ($Origen) { @($Origen) } else { @($Repo, $Respaldo) }
$clonado = $false
foreach ($f in $fuentes) {
  if (Clonar $f) { $clonado = $true; $fuenteUsada = $f; break }
  Write-Host "      No pude clonar desde $f (la rama $Rama puede no existir ahi)." -ForegroundColor Yellow
}
if (-not $clonado) { Falla "No pude clonar la rama $Rama desde: $($fuentes -join ' ni desde ')." }
Write-Host "      Clonado desde $fuenteUsada" -ForegroundColor Green

Set-Location -LiteralPath $destino

# --- 3. Quitar el remote -----------------------------------------------------
Paso 3 'Desconectando el proyecto del repo del starter (git remote remove origin)...'
if ((& git remote) -contains 'origin') {
  & git remote remove origin
  if ($LASTEXITCODE -ne 0) { Falla 'No pude quitar el remote origin.' }
} else {
  Write-Host '      (no habia remote origin)'
}

# --- 4. Copiar .env ----------------------------------------------------------
Paso 4 'Copiando tus claves API (.env)...'
$envCopiado = $false
if ($EnvOrigen -and (Test-Path -LiteralPath $EnvOrigen)) {
  Copy-Item -LiteralPath $EnvOrigen -Destination (Join-Path $destino '.env') -ErrorAction Stop
  $envCopiado = $true
  Write-Host '      .env copiado (no muestro su contenido).' -ForegroundColor Green
} else {
  Write-Host "      No encontre $EnvOrigen. El paso siguiente te pedira las claves (puedes saltarlas con Enter)." -ForegroundColor Yellow
}

# --- 5. npm install ----------------------------------------------------------
Paso 5 'Instalando dependencias (npm install)...'
$npm = if (Tiene 'npm.cmd') { 'npm.cmd' } else { 'npm' }
if ($envCopiado) {
  # Con .env ya listo, evitamos que el setup pregunte otra vez por cada clave:
  # instalamos sin scripts y corremos solo la parte de Python.
  & $npm install --ignore-scripts --no-fund --no-audit
  if ($LASTEXITCODE -ne 0) { Falla 'npm install fallo. Revisa el mensaje de arriba.' }
  & node setup.js --python-only
  if ($LASTEXITCODE -ne 0) { Write-Host '      El setup de Python no termino bien; puedes reintentarlo luego con: npm run setup-python' -ForegroundColor Yellow }
} else {
  & $npm install --no-fund --no-audit
  if ($LASTEXITCODE -ne 0) { Falla 'npm install fallo. Revisa el mensaje de arriba.' }
}

# --- 6. Claude Code ----------------------------------------------------------
Write-Host ''
Write-Host "Listo: proyecto creado en $destino" -ForegroundColor Green
if ($SinClaude) {
  Paso 6 'Saltado (-SinClaude).'
  exit 0
}
if (-not (Tiene 'claude')) {
  Write-Host 'No encuentro Claude Code (comando claude). Instalalo con: npm install -g @anthropic-ai/claude-code' -ForegroundColor Yellow
  Write-Host "Luego entra a la carpeta con: cd `"$destino`" y escribe: claude `"/kickoff`""
  exit 0
}
Paso 6 'Abriendo Claude Code con /kickoff...'
& claude '/kickoff'
exit $LASTEXITCODE
