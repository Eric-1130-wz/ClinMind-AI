param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$project = Join-Path $PSScriptRoot 'aic_mech'
Set-Location -LiteralPath $project
$env:PYTHONUTF8 = '1'
$env:PYTHONIOENCODING = 'utf-8'
$python = Join-Path $project '.venv\Scripts\python.exe'

function Test-Python($executable, $prefixArgs) {
    try {
        $null = & $executable @prefixArgs -c "import sys; sys.exit(0 if sys.version_info >= (3,10) else 1)" 2>$null
        return $LASTEXITCODE -eq 0
    } catch { return $false }
}

if (-not ((Test-Path -LiteralPath $python) -and (Test-Python $python @()))) {
    $systemPython = $null
    $prefixArgs = @()
    foreach ($name in @('py', 'python')) {
        $candidate = Get-Command $name -ErrorAction SilentlyContinue
        if (-not $candidate) { continue }
        $candidateArgs = @()
        if ($name -eq 'py') { $candidateArgs = @('-3') }
        if (Test-Python $candidate.Source $candidateArgs) {
            $systemPython = $candidate.Source
            $prefixArgs = $candidateArgs
            break
        }
    }
    if (-not $systemPython) {
        throw 'Python 3.10+ is required. Install it from https://www.python.org/downloads/ and enable Add Python to PATH, then run start.cmd again.'
    }
    Write-Host 'Preparing a local Python environment...' -ForegroundColor Cyan
    & $systemPython @prefixArgs -m venv .venv
    if ($LASTEXITCODE -ne 0) { throw 'Could not create .venv. Check Python installation and folder permissions.' }
}

# Probe without printing a traceback (compatible with Windows PowerShell 5.1).
& $python -c "import importlib.util, sys; sys.exit(0 if all(importlib.util.find_spec(m) for m in ('fastapi','uvicorn','pydantic','networkx','numpy','websockets','httpx')) else 1)"
if ($LASTEXITCODE -ne 0) {
    Write-Host 'Installing dependencies. The first launch needs an internet connection...' -ForegroundColor Yellow
    & $python -m pip install --disable-pip-version-check -r requirements.txt
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed. Check your network and run start.cmd again.' }
}

if (-not (Test-Path -LiteralPath '.env')) {
    Copy-Item -LiteralPath '.env.example' -Destination '.env'
}

Write-Host 'ClinMind-AI v2 - keep this window open. Press Ctrl+C to stop.' -ForegroundColor Green
if ($NoBrowser) { & $python main.py } else { & $python main.py --open-browser }
exit $LASTEXITCODE
