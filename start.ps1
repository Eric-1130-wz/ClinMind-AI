$ErrorActionPreference = 'Stop'
$project = Join-Path $PSScriptRoot 'ClinMind-AI_完整源代码包\ClinMind-AI_完整源代码包\aic_mech'
Set-Location -LiteralPath $project
$env:PYTHONUTF8 = '1'
$python = Join-Path $project '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $python)) {
    python -m venv .venv
    if ($LASTEXITCODE -ne 0) { throw 'Python 3.10+ is required.' }
}
& $python -c "import fastapi, uvicorn, pydantic, networkx, websockets, httpx" 2>$null
if ($LASTEXITCODE -ne 0) {
    & $python -m pip install -r requirements.txt
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
}
& $python main.py
